import Phaser from 'phaser'
import { audio, type SfxName } from '../core/audio'
import type { MatchStats } from '../core/events'
import { Rng } from '../core/rng'
import { ABILITIES_BY_ID } from '../data/abilities'
import { ageDef } from '../data/ages'
import type { TurretDef, UnitDef, WeaponVisual } from '../data/types'
import { TURRETS_BY_ID } from '../data/turrets'
import type Vfx from '../gfx/vfx'
import Army, { type ArmyModifiers, defaultModifiers } from './army'
import Base, { type TurretSlot } from './base'
import Projectile, { ballisticAngle } from './projectile'
import Unit, { type UnitWorld } from './unit'
import { ADVANCE_DIR, OPPOSITE, type Damageable, type DamageType, type Faction } from './types'

export interface BattlefieldConfig {
  worldWidth: number
  groundY: number
  airY: number
  startingGold: number
  playerModifiers?: Partial<ArmyModifiers>
  enemyModifiers?: Partial<ArmyModifiers>
  /** Enemy starts at this age (campaign levels use it to set the challenge). */
  enemyStartAge?: number
  seed?: number
}

export interface DamageEvent {
  amount: number
  type: DamageType
  knockback: number
  splash?: number
  crit?: number
  bonusVs?: Partial<Record<string, number>>
}

const WEAPON_SFX: Partial<Record<WeaponVisual, SfxName>> = {
  club: 'melee_heavy',
  spear: 'melee_light',
  sword: 'melee_light',
  axe: 'melee_heavy',
  lance: 'melee_heavy',
  saber: 'melee_light',
  sling: 'bow',
  bow: 'bow',
  musket: 'gunshot',
  grenade: 'bow',
  rifle: 'gunshot',
  lmg: 'machinegun',
  rpg: 'cannon',
  laser: 'laser',
  railgun: 'railgun',
  plasma: 'plasma',
  staff: 'heal',
  fist: 'melee_light',
  none: 'melee_heavy'
}

/** Weapons that eject brass and cough propellant smoke. */
const FIREARMS = new Set<WeaponVisual>(['musket', 'rifle', 'lmg'])

/** Longest real frame the simulation will honour, to avoid a spiral of death. */
const MAX_FRAME_MS = 100
/** Target length of one simulation sub-step. */
const SUBSTEP_MS = 20
/** Hard ceiling on sub-steps per frame so a stall cannot lock the tab. */
const MAX_SUBSTEPS = 16

function emptyStats(): MatchStats {
  return {
    unitsBuilt: 0,
    unitsLost: 0,
    kills: 0,
    goldEarned: 0,
    goldSpent: 0,
    damageDealt: 0,
    damageTaken: 0,
    agesReached: 1,
    abilitiesUsed: 0,
    durationMs: 0,
    score: 0,
    wavesSurvived: 0
  }
}

function mergeModifiers(patch?: Partial<ArmyModifiers>): ArmyModifiers {
  return { ...defaultModifiers(), ...(patch ?? {}) }
}

/**
 * Owns the whole battle: both armies, every unit and projectile, combat
 * resolution, special abilities, and the running match statistics.
 */
export default class Battlefield {
  readonly scene: Phaser.Scene
  readonly config: BattlefieldConfig
  readonly vfx: Vfx
  readonly rng: Rng

  readonly player: Army
  readonly enemy: Army
  readonly playerBase: Base
  readonly enemyBase: Base

  units: Unit[] = []
  projectiles: Projectile[] = []

  speedScale = 1
  elapsedMs = 0
  /** Leftover real time not yet consumed by a fixed sub-step. */
  private accumulator = 0
  finished = false
  victory = false

  /**
   * Statistics are kept for both sides. In a networked match each client is
   * playing a different faction, so a single "player" record would show the
   * guest their opponent's numbers.
   */
  private statsByFaction: Record<Faction, MatchStats> = {
    player: emptyStats(),
    enemy: emptyStats()
  }

  /** The left-hand side's record; kept for single-player call sites. */
  get stats(): MatchStats {
    return this.statsByFaction.player
  }

  statsFor(faction: Faction): MatchStats {
    return this.statsByFaction[faction]
  }

  onMatchEnd?: (victory: boolean) => void
  onAgeAdvanced?: (faction: Faction, age: number) => void
  onAbilityUsed?: (faction: Faction, abilityId: string) => void
  onUnitKilled?: (faction: Faction) => void

  private world: UnitWorld
  private baseHealthGfx: Phaser.GameObjects.Graphics
  private beams: { gfx: Phaser.GameObjects.Graphics; ttl: number }[] = []

  constructor(scene: Phaser.Scene, config: BattlefieldConfig, vfx: Vfx) {
    this.scene = scene
    this.config = config
    this.vfx = vfx
    this.rng = new Rng(config.seed ?? Date.now())

    const playerMods = mergeModifiers(config.playerModifiers)
    const enemyMods = mergeModifiers(config.enemyModifiers)

    this.player = new Army('player', config.startingGold, playerMods)
    this.enemy = new Army('enemy', config.startingGold, enemyMods)
    this.enemy.age = Math.max(0, Math.min(4, config.enemyStartAge ?? 0))

    this.world = { groundY: config.groundY, airY: config.airY, vfx, speedScale: 1 }

    const margin = 150
    this.playerBase = new Base(
      scene,
      'player',
      margin,
      config.groundY,
      ageDef(this.player.age).baseHp * playerMods.baseHp,
      vfx
    )
    this.enemyBase = new Base(
      scene,
      'enemy',
      config.worldWidth - margin,
      config.groundY,
      ageDef(this.enemy.age).baseHp * enemyMods.baseHp,
      vfx
    )
    this.playerBase.setAge(this.player.age, ageDef(this.player.age).baseHp * playerMods.baseHp)
    this.enemyBase.setAge(this.enemy.age, ageDef(this.enemy.age).baseHp * enemyMods.baseHp)

    this.playerBase.onTurretFire = this.handleTurretFire
    this.enemyBase.onTurretFire = this.handleTurretFire
    this.playerBase.onDestroyed = () => this.endMatch(false)
    this.enemyBase.onDestroyed = () => this.endMatch(true)

    this.baseHealthGfx = scene.add.graphics().setDepth(290)
  }

  armyFor(faction: Faction): Army {
    return faction === 'player' ? this.player : this.enemy
  }

  baseFor(faction: Faction): Base {
    return faction === 'player' ? this.playerBase : this.enemyBase
  }

  // ───────────────────────────── Main loop ─────────────────────────────

  update(rawDtMs: number): void {
    if (this.finished) {
      this.updateBeams(rawDtMs)
      return
    }
    if (this.vfx.isHitStopped()) return

    // Fixed timestep with an accumulator. Every simulate() call advances
    // exactly SUBSTEP_MS, which is what makes the game behave identically at
    // 20 fps and 144 fps — and what makes a networked match reproducible on
    // both machines from the same inputs.
    this.accumulator += Math.min(MAX_FRAME_MS, rawDtMs) * this.speedScale
    let steps = 0
    while (this.accumulator >= SUBSTEP_MS && steps < MAX_SUBSTEPS) {
      this.simulate(SUBSTEP_MS)
      this.accumulator -= SUBSTEP_MS
      steps += 1
      if (this.finished) break
    }
    // If we could not keep up, drop the backlog rather than spiralling.
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0

    this.updateBeams(rawDtMs)
    this.drawBaseHealth()
  }

  /**
   * Advances the simulation by an exact number of fixed sub-steps, bypassing
   * wall-clock time entirely. Networked matches drive the world through this
   * so both peers execute precisely the same sequence.
   */
  stepFixed(count: number): void {
    for (let i = 0; i < count && !this.finished; i += 1) this.simulate(SUBSTEP_MS)
    this.updateBeams(SUBSTEP_MS * count)
    this.drawBaseHealth()
  }

  /** Sub-steps per second, for netcode that needs to line ticks up. */
  static get stepMs(): number {
    return SUBSTEP_MS
  }

  /**
   * A cheap fingerprint of everything that matters to the outcome. Peers swap
   * these periodically; a mismatch means the two simulations have drifted and
   * the match can be stopped honestly instead of silently diverging.
   *
   * Values are quantised so that harmless last-bit float noise does not raise
   * a false alarm, while any real divergence changes the hash immediately.
   */
  stateHash(): number {
    let h = 0x811c9dc5
    const mix = (value: number) => {
      // FNV-1a over the quantised integer.
      let v = Math.round(value) | 0
      for (let i = 0; i < 4; i += 1) {
        h ^= v & 0xff
        h = Math.imul(h, 0x01000193)
        v >>>= 8
      }
    }

    mix(Math.round(this.elapsedMs))
    for (const army of [this.player, this.enemy]) {
      mix(army.gold)
      mix(army.xp)
      mix(army.age)
      mix(army.queue.length)
      mix(army.incomeLevel)
    }
    mix(this.playerBase.hp * 10)
    mix(this.enemyBase.hp * 10)
    mix(this.units.length)
    for (const u of this.units) {
      if (!u.alive) continue
      mix(u.id)
      mix(u.x * 10)
      mix(u.y * 10)
      mix(u.hp * 10)
    }
    mix(this.projectiles.length)
    return h >>> 0
  }

  /** One fixed-length slice of simulation. */
  private simulate(dtMs: number): void {
    this.elapsedMs += dtMs
    this.statsByFaction.player.durationMs = this.elapsedMs
    this.statsByFaction.enemy.durationMs = this.elapsedMs
    this.world.speedScale = this.speedScale

    this.tickArmy(this.player, dtMs)
    this.tickArmy(this.enemy, dtMs)

    this.updateUnits(dtMs)
    this.updateProjectiles(dtMs)
    this.updateTurrets(dtMs)
  }

  private tickArmy(army: Army, dtMs: number): void {
    const before = army.gold
    const { ready } = army.tick(dtMs)
    this.statsFor(army.faction).goldEarned += Math.max(0, army.gold - before)
    for (const def of ready) this.spawnUnit(army.faction, def)
  }

  private updateUnits(dtMs: number): void {
    const alive: Unit[] = []
    for (const u of this.units) if (u.alive) alive.push(u)
    this.units = alive

    const playerUnits: Unit[] = []
    const enemyUnits: Unit[] = []
    for (const u of alive) (u.faction === 'player' ? playerUnits : enemyUnits).push(u)
    playerUnits.sort((a, b) => a.x - b.x)
    enemyUnits.sort((a, b) => a.x - b.x)

    this.player.population = playerUnits.reduce((n, u) => n + u.def.pop, 0)
    this.enemy.population = enemyUnits.reduce((n, u) => n + u.def.pop, 0)

    this.applyAuras(playerUnits, enemyUnits)

    const playerTargets: Damageable[] = [...enemyUnits, this.enemyBase]
    const enemyTargets: Damageable[] = [...playerUnits, this.playerBase]

    this.stepSide(playerUnits, playerTargets, dtMs)
    this.stepSide(enemyUnits, enemyTargets, dtMs)
  }

  /** Aegis-style auras grant nearby allies flat damage reduction. */
  private applyAuras(playerUnits: Unit[], enemyUnits: Unit[]): void {
    for (const group of [playerUnits, enemyUnits]) {
      const emitters = group.filter(u => u.def.attack.kind === 'aura')
      for (const u of group) {
        let best = 0
        for (const e of emitters) {
          const attack = e.def.attack
          if (attack.kind !== 'aura') continue
          if (Math.abs(e.x - u.x) <= attack.radius) best = Math.max(best, attack.damageReduction)
        }
        u.auraShield = best
        u.setAuraVisual(best > 0)
      }
    }
  }

  private stepSide(units: Unit[], targets: Damageable[], dtMs: number): void {
    const dir = units.length > 0 ? ADVANCE_DIR[units[0].faction] : 1
    // Walk the sorted list from the front so each unit knows who is ahead of it.
    const order = dir === 1 ? [...units].reverse() : units
    let aheadX: number | null = null

    for (const unit of order) {
      const blocker = unit.layer === 'air' ? null : aheadX
      const target = this.pickTarget(unit, targets)
      unit.update(dtMs, blocker, target)
      if (unit.layer === 'ground' && unit.alive) {
        aheadX = unit.x - dir * (unit.radius + 2)
      }
    }
  }

  private pickTarget(unit: Unit, candidates: Damageable[]): Damageable | null {
    let best: Damageable | null = null
    let bestDist = Infinity
    for (const c of candidates) {
      if (!unit.canTarget(c)) continue
      const dist = unit.distanceTo(c)
      if (dist > unit.def.range) continue
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
    if (best) return best

    // Nothing in range: keep the nearest enemy as a facing/aim reference.
    let nearest: Damageable | null = null
    let nearestDist = Infinity
    for (const c of candidates) {
      if (!unit.canTarget(c)) continue
      const dist = unit.distanceTo(c)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = c
      }
    }
    unit.target = nearest
    return null
  }

  private updateProjectiles(dtMs: number): void {
    if (this.projectiles.length === 0) return
    const alivePlayer: Damageable[] = [this.playerBase]
    const aliveEnemy: Damageable[] = [this.enemyBase]
    for (const u of this.units) {
      if (!u.alive) continue
      ;(u.faction === 'player' ? alivePlayer : aliveEnemy).push(u)
    }

    const remaining: Projectile[] = []
    for (const p of this.projectiles) {
      const candidates = p.faction === 'player' ? aliveEnemy : alivePlayer
      const result = p.update(dtMs, candidates)
      if (result.hit) {
        this.resolveProjectileHit(p, result.hit)
      } else if (!result.done) {
        remaining.push(p)
      } else if (p.config.splash && p.config.splash > 0) {
        // Ground detonation still hurts anything nearby.
        this.applySplash(p.x, p.y, p.config.splash, p.faction, {
          amount: p.config.damage,
          type: p.config.damageType,
          knockback: p.config.knockback,
          bonusVs: p.config.bonusVs
        })
      }
    }
    this.projectiles = remaining
  }

  private resolveProjectileHit(p: Projectile, target: Damageable): void {
    const event: DamageEvent = {
      amount: p.config.damage,
      type: p.config.damageType,
      knockback: p.config.knockback,
      bonusVs: p.config.bonusVs,
      crit: p.config.crit
    }
    if (p.config.splash && p.config.splash > 0) {
      this.applySplash(p.x, p.y, p.config.splash, p.faction, event)
    } else {
      this.applyDamage(p.config.owner ?? null, target, event)
      const sfx: SfxName = p.config.damageType === 'energy' ? 'plasma' : 'arrow_hit'
      audio.play(sfx, 0.35)
    }
  }

  private updateTurrets(dtMs: number): void {
    const playerTargets: Damageable[] = []
    const enemyTargets: Damageable[] = []
    for (const u of this.units) {
      if (!u.alive) continue
      ;(u.faction === 'player' ? playerTargets : enemyTargets).push(u)
    }
    this.playerBase.update(dtMs, enemyTargets)
    this.enemyBase.update(dtMs, playerTargets)
  }

  private updateBeams(dtMs: number): void {
    const remaining: typeof this.beams = []
    for (const beam of this.beams) {
      beam.ttl -= dtMs
      beam.gfx.setAlpha(Math.max(0, beam.ttl / 140))
      if (beam.ttl > 0) remaining.push(beam)
      else beam.gfx.destroy()
    }
    this.beams = remaining
  }

  private drawBaseHealth(): void {
    this.baseHealthGfx.clear()
    if (this.playerBase.alive) this.playerBase.drawHealthBar(this.baseHealthGfx)
    if (this.enemyBase.alive) this.enemyBase.drawHealthBar(this.baseHealthGfx)
  }

  // ───────────────────────────── Spawning ─────────────────────────────

  spawnUnit(faction: Faction, def: UnitDef): Unit {
    const base = this.baseFor(faction)
    const dir = ADVANCE_DIR[faction]
    const spawnX = base.x + dir * (base.radius + 30)

    const unit = new Unit(this.scene, def, faction, spawnX, this.world, this.rng.spread(26))
    const army = this.armyFor(faction)
    unit.hp *= army.modifiers.unitHp
    unit.maxHp *= army.modifiers.unitHp

    unit.onFire = this.handleUnitFire
    unit.onHealPulse = this.handleHealPulse
    unit.onDeath = this.handleUnitDeath

    this.units.push(unit)
    const stats = this.statsFor(faction)
    stats.unitsBuilt += 1
    stats.goldSpent += def.cost
    audio.play('spawn', 0.3)
    return unit
  }

  // ───────────────────────────── Combat ─────────────────────────────

  /**
   * After the opening minutes, every weapon slowly gets sharper. Two evenly
   * matched commanders can otherwise grind at the midline forever; this makes
   * the front line brittle enough that someone eventually breaks through.
   */
  get escalation(): number {
    const minutes = this.elapsedMs / 60000
    return 1 + Math.max(0, minutes - 3) * 0.12
  }

  private handleUnitFire = (unit: Unit, target: Damageable): void => {
    const attack = unit.def.attack
    const army = this.armyFor(unit.faction)
    const damage = unit.def.damage * army.modifiers.unitDamage * this.escalation
    const sfx = WEAPON_SFX[unit.def.visual.weapon] ?? 'melee_light'

    if (attack.kind === 'melee') {
      audio.play(sfx, 0.4)
      const event: DamageEvent = {
        amount: damage,
        type: unit.def.damageType,
        knockback: attack.knockback,
        crit: unit.def.crit,
        bonusVs: unit.def.bonusVs
      }
      if (attack.splash && attack.splash > 0) {
        this.applySplash(target.x, target.y + target.centerOffsetY, attack.splash, unit.faction, event, unit)
      } else {
        this.applyDamage(unit, target, event)
      }
      // Heavy melee gets a beat of hit-stop so the blow lands with weight.
      if (attack.knockback > 140) this.vfx.hitStop(45)
      return
    }

    if (attack.kind === 'projectile') {
      const muzzle = unit.muzzleWorld()
      const dx = target.x - muzzle.x
      const dy = target.y + target.centerOffsetY - muzzle.y
      const angle =
        attack.gravity > 0
          ? ballisticAngle(dx, dy, attack.speed, attack.gravity)
          : Math.atan2(dy, dx)
      const spread = this.rng.spread(attack.spread)
      const finalAngle = angle + spread

      audio.play(sfx, 0.45)
      this.vfx.muzzleFlash(
        muzzle.x,
        muzzle.y,
        finalAngle,
        unit.def.damageType === 'energy' ? 0x8ff0ff : 0xffd08a,
        unit.def.height / 46
      )
      if (FIREARMS.has(unit.def.visual.weapon)) {
        this.vfx.gunSmoke(muzzle.x, muzzle.y, finalAngle, unit.dir)
      }

      this.projectiles.push(
        new Projectile(
          this.scene,
          {
            faction: unit.faction,
            projectile: attack.projectile,
            x: muzzle.x,
            y: muzzle.y,
            vx: Math.cos(finalAngle) * attack.speed,
            vy: Math.sin(finalAngle) * attack.speed,
            gravity: attack.gravity,
            damage,
            damageType: unit.def.damageType,
            knockback: attack.knockback,
            splash: attack.splash,
            homing: attack.homing,
            target,
            hitsAir: unit.def.hitsAir ?? false,
            owner: unit,
            bonusVs: unit.def.bonusVs,
            crit: unit.def.crit
          },
          this.config.groundY,
          this.vfx
        )
      )
      return
    }

    if (attack.kind === 'beam') {
      audio.play('laser', 0.5)
      const muzzle = unit.muzzleWorld()
      this.fireBeam(muzzle.x, muzzle.y, target, unit, {
        amount: damage,
        type: unit.def.damageType,
        knockback: attack.knockback
      })
    }
  }

  private handleHealPulse = (unit: Unit): void => {
    const attack = unit.def.attack
    if (attack.kind !== 'heal') return
    const allies = this.units.filter(
      u => u.alive && u.faction === unit.faction && u !== unit && Math.abs(u.x - unit.x) <= attack.radius
    )
    const wounded = allies.filter(u => u.hp < u.maxHp)
    if (wounded.length === 0) return

    audio.play('heal', 0.35)
    this.vfx.healPulse(unit.x, unit.centerY, attack.radius)
    // Two targets per pulse: enough to matter, not enough that a pair of
    // healers makes the front line unkillable.
    wounded
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, 2)
      .forEach(ally => ally.heal(attack.amount))
    unit.markHealPulse()
  }

  private handleUnitDeath = (unit: Unit): void => {
    const winner = OPPOSITE[unit.faction]
    this.armyFor(winner).rewardKill(unit.def.bounty, unit.def.xp)
    this.statsFor(winner).kills += 1
    this.statsFor(winner).goldEarned += unit.def.bounty
    this.statsFor(unit.faction).unitsLost += 1
    this.vfx.floatingLabel(unit.x, unit.centerY - unit.def.height * 0.4, `+${unit.def.bounty}`, '#f2c14e')
    audio.play('coin', 0.25)
    this.onUnitKilled?.(winner)
  }

  private handleTurretFire = (base: Base, slot: TurretSlot, target: Damageable): void => {
    const def = slot.def
    if (!def) return
    const index = base.slots.indexOf(slot)
    const muzzle = base.turretMuzzle(index)
    const attack = def.attack
    if (attack.kind !== 'projectile') return

    const dx = target.x - muzzle.x
    const dy = target.y + target.centerOffsetY - muzzle.y
    const angle = attack.gravity > 0 ? ballisticAngle(dx, dy, attack.speed, attack.gravity) : Math.atan2(dy, dx)
    const finalAngle = angle + this.rng.spread(attack.spread)

    audio.play(this.turretSfx(def), 0.4)
    this.vfx.muzzleFlash(muzzle.x, muzzle.y, finalAngle, def.age >= 4 ? 0x8ff0ff : 0xffd08a, 1.4)

    this.projectiles.push(
      new Projectile(
        this.scene,
        {
          faction: base.faction,
          projectile: attack.projectile,
          x: muzzle.x,
          y: muzzle.y,
          vx: Math.cos(finalAngle) * attack.speed,
          vy: Math.sin(finalAngle) * attack.speed,
          gravity: attack.gravity,
          damage: def.damage,
          damageType: def.damageType,
          knockback: attack.knockback,
          splash: attack.splash,
          homing: attack.homing,
          target,
          hitsAir: def.hitsAir,
          owner: base
        },
        this.config.groundY,
        this.vfx
      )
    )
  }

  private turretSfx(def: TurretDef): SfxName {
    switch (def.barrel) {
      case 'sling':
        return 'bow'
      case 'coil':
        return def.age >= 4 ? 'laser' : 'cannon'
      case 'dish':
        return 'plasma'
      case 'twin':
        return def.age >= 3 ? 'machinegun' : 'gunshot'
      default:
        return def.damageType === 'explosive' ? 'cannon' : def.age >= 4 ? 'railgun' : 'gunshot'
    }
  }

  private fireBeam(x: number, y: number, target: Damageable, owner: Unit, event: DamageEvent): void {
    const gfx = this.scene.add.graphics().setDepth(260).setBlendMode(Phaser.BlendModes.ADD)
    gfx.lineStyle(6, 0x8ff0ff, 0.85)
    gfx.lineBetween(x, y, target.x, target.y + target.centerOffsetY)
    gfx.lineStyle(2, 0xffffff, 1)
    gfx.lineBetween(x, y, target.x, target.y + target.centerOffsetY)
    this.beams.push({ gfx, ttl: 140 })
    this.applyDamage(owner, target, event)
  }

  /** Core damage pipeline: modifiers, crits, stats, then the target's own logic. */
  applyDamage(attacker: Damageable | null, target: Damageable, event: DamageEvent): void {
    if (!target.alive) return
    let amount = event.amount
    const bonus = event.bonusVs?.[target.armor]
    if (bonus) amount *= bonus
    const crit = event.crit ? this.rng.chance(event.crit) : false
    if (crit) amount *= 2

    if (attacker) this.statsFor(attacker.faction).damageDealt += amount
    this.statsFor(target.faction).damageTaken += amount

    target.takeDamage(amount, event.type, attacker ?? undefined, event.knockback)
  }

  /** Radial damage with linear falloff and outward knockback. */
  applySplash(
    x: number,
    y: number,
    radius: number,
    faction: Faction,
    event: DamageEvent,
    attacker: Damageable | null = null
  ): void {
    const targets: Damageable[] = [...this.units, this.playerBase, this.enemyBase]
    for (const t of targets) {
      if (!t.alive || t.faction === faction) continue
      const dx = t.x - x
      const dy = t.y + t.centerOffsetY - y
      const dist = Math.sqrt(dx * dx + dy * dy) - t.radius
      if (dist > radius) continue
      const falloff = Phaser.Math.Clamp(1 - dist / radius, 0.32, 1)
      this.applyDamage(attacker, t, {
        ...event,
        amount: event.amount * falloff,
        knockback: event.knockback * falloff
      })
    }
  }

  // ───────────────────────────── Player actions ─────────────────────────────

  queueUnit(faction: Faction, unitId: string): boolean {
    return this.armyFor(faction).enqueue(unitId)
  }

  evolve(faction: Faction): boolean {
    const army = this.armyFor(faction)
    if (!army.evolve()) return false
    const def = ageDef(army.age)
    const base = this.baseFor(faction)
    base.setAge(army.age, def.baseHp * army.modifiers.baseHp)
    this.statsFor(faction).agesReached = army.age + 1
    audio.play('evolve', 0.8)
    this.vfx.flash(0xffffff, 320, 0.5)
    this.vfx.explosion(base.x, base.y - 120, 200, 0xffe08a, true)
    this.onAgeAdvanced?.(faction, army.age)
    return true
  }

  buildTurret(faction: Faction, slotIndex: number, turretId: string): boolean {
    const army = this.armyFor(faction)
    const def = TURRETS_BY_ID[turretId]
    const base = this.baseFor(faction)
    if (!def || def.age > army.age) return false
    if (base.slots[slotIndex]?.def) return false
    if (army.gold < def.cost) return false
    army.gold -= def.cost
    this.statsFor(faction).goldSpent += def.cost
    base.buildTurret(slotIndex, turretId)
    audio.play('shield', 0.5)
    return true
  }

  sellTurret(faction: Faction, slotIndex: number): boolean {
    const base = this.baseFor(faction)
    const refund = base.sellTurret(slotIndex)
    if (refund <= 0) return false
    this.armyFor(faction).gold += refund
    audio.play('coin', 0.4)
    return true
  }

  useAbility(faction: Faction): boolean {
    const army = this.armyFor(faction)
    if (!army.consumeAbility()) return false
    const ability = army.ability
    this.statsFor(faction).abilitiesUsed += 1
    audio.play('ability', 0.9)
    this.onAbilityUsed?.(faction, ability.id)
    this.runAbility(faction, ability.id)
    return true
  }

  // ───────────────────────────── Abilities ─────────────────────────────

  private runAbility(faction: Faction, abilityId: string): void {
    const def = ABILITIES_BY_ID[abilityId]
    const dir = ADVANCE_DIR[faction]
    const ownBase = this.baseFor(faction)
    const foeBase = this.baseFor(OPPOSITE[faction])
    // The strike zone covers the enemy two-thirds of the field.
    const from = ownBase.x + dir * this.config.worldWidth * 0.28
    const to = foeBase.x - dir * 60
    const power = 1 + this.armyFor(faction).age * 0.55

    switch (abilityId) {
      case 'meteor_shower':
        this.dropBarrage(faction, from, to, 14, 190, 260 * power, 'boulder', 'explosive', 130, 260, def.color)
        break
      case 'arrow_storm':
        this.dropBarrage(faction, from, to, 46, 60, 62 * power, 'arrow', 'pierce', 0, 30, def.color)
        break
      case 'cannonade':
        this.rollingBarrage(faction, to, from, 16, 300 * power, def.color)
        break
      case 'airstrike':
        this.airstrike(faction, from, to, 420 * power, def.color)
        break
      case 'ion_cannon':
        this.ionCannon(faction, to, from, 240 * power, def.color)
        break
      default:
        break
    }
  }

  /** Rains projectiles from off-screen across a span of the battlefield. */
  private dropBarrage(
    faction: Faction,
    from: number,
    to: number,
    count: number,
    intervalMs: number,
    damage: number,
    projectile: 'boulder' | 'arrow' | 'bomb',
    type: DamageType,
    splash: number,
    knockback: number,
    color: number
  ): void {
    this.vfx.flash(color, 260, 0.28)
    for (let i = 0; i < count; i += 1) {
      this.scene.time.delayedCall(i * intervalMs, () => {
        if (this.finished) return
        const t = count === 1 ? 0.5 : i / (count - 1)
        const x = Phaser.Math.Linear(from, to, t) + this.rng.spread(90)
        const startY = this.config.groundY - 900
        const speed = 900
        const angle = Math.PI / 2 + this.rng.spread(0.14)
        this.projectiles.push(
          new Projectile(
            this.scene,
            {
              faction,
              projectile,
              x: x - Math.cos(angle) * 200,
              y: startY,
              vx: Math.cos(angle) * speed * 0.2,
              vy: Math.sin(angle) * speed,
              gravity: 500,
              damage,
              damageType: type,
              knockback,
              splash: splash > 0 ? splash : undefined,
              hitsAir: true
            },
            this.config.groundY,
            this.vfx
          )
        )
      })
    }
  }

  /** A line of explosions marching across the field. */
  private rollingBarrage(faction: Faction, from: number, to: number, count: number, damage: number, color: number): void {
    this.vfx.flash(color, 300, 0.3)
    for (let i = 0; i < count; i += 1) {
      this.scene.time.delayedCall(i * 140, () => {
        if (this.finished) return
        const x = Phaser.Math.Linear(from, to, i / Math.max(1, count - 1)) + this.rng.spread(40)
        const y = this.config.groundY - 18
        this.vfx.explosion(x, y, 150, color, true)
        audio.play('explosion', 0.7)
        this.applySplash(x, y, 150, faction, { amount: damage, type: 'explosive', knockback: 340 })
      })
    }
  }

  /** A bomber flies the length of the field, releasing a stick of bombs. */
  private airstrike(faction: Faction, from: number, to: number, damage: number, color: number): void {
    const dir = Math.sign(to - from) || 1
    const y = this.config.groundY - 430
    const plane = this.scene.add
      .image(from - dir * 300, y, 'proj:rocket')
      .setDepth(340)
      .setScale(3.4, 2.6)
      .setFlipX(dir < 0)
      .setTint(0xdfe6ea)

    this.vfx.flash(color, 220, 0.2)
    this.scene.tweens.add({
      targets: plane,
      x: to + dir * 400,
      duration: 2300,
      ease: 'Linear',
      onComplete: () => plane.destroy()
    })

    for (let i = 0; i < 12; i += 1) {
      this.scene.time.delayedCall(360 + i * 130, () => {
        if (this.finished) return
        this.projectiles.push(
          new Projectile(
            this.scene,
            {
              faction,
              projectile: 'bomb',
              x: plane.x,
              y: plane.y + 12,
              vx: dir * 200,
              vy: 40,
              gravity: 900,
              damage,
              damageType: 'explosive',
              knockback: 420,
              splash: 140,
              hitsAir: false
            },
            this.config.groundY,
            this.vfx
          )
        )
      })
    }
  }

  /** A sweeping orbital beam that cooks everything beneath it. */
  private ionCannon(faction: Faction, from: number, to: number, damagePerTick: number, color: number): void {
    const steps = 26
    const beam = this.scene.add.graphics().setDepth(345).setBlendMode(Phaser.BlendModes.ADD)
    this.vfx.flash(color, 420, 0.45)
    this.vfx.shake(0.008, 2400)

    for (let i = 0; i <= steps; i += 1) {
      this.scene.time.delayedCall(i * 88, () => {
        if (this.finished) {
          beam.destroy()
          return
        }
        const x = Phaser.Math.Linear(from, to, i / steps)
        beam.clear()
        beam.fillStyle(color, 0.28)
        beam.fillRect(x - 46, 0, 92, this.config.groundY)
        beam.fillStyle(0xffffff, 0.85)
        beam.fillRect(x - 10, 0, 20, this.config.groundY)
        this.vfx.explosion(x, this.config.groundY - 20, 120, color)
        this.applySplash(x, this.config.groundY - 40, 130, faction, {
          amount: damagePerTick,
          type: 'energy',
          knockback: 200
        })
        if (i % 4 === 0) audio.play('plasma', 0.6)
        if (i === steps) {
          this.scene.tweens.add({
            targets: beam,
            alpha: 0,
            duration: 320,
            onComplete: () => beam.destroy()
          })
        }
      })
    }
  }

  // ───────────────────────────── Match end ─────────────────────────────

  private endMatch(victory: boolean): void {
    if (this.finished) return
    this.finished = true
    this.victory = victory
    this.statsByFaction.player.score = this.computeScore('player', victory)
    this.statsByFaction.enemy.score = this.computeScore('enemy', !victory)
    const loser = victory ? this.enemyBase : this.playerBase
    loser.playDestruction()
    this.vfx.shake(0.02, 1400)
    this.vfx.flash(0xffffff, 500, 0.6)
    audio.play(victory ? 'victory' : 'defeat', 1)
    this.scene.time.delayedCall(1800, () => this.onMatchEnd?.(victory))
  }

  private computeScore(faction: Faction, victory: boolean): number {
    const s = this.statsFor(faction)
    const base = this.baseFor(faction)
    const survivalBonus = Math.round((base.hp / base.maxHp) * 4000)
    const speedBonus = victory ? Math.max(0, 6000 - Math.round(this.elapsedMs / 100)) : 0
    return Math.max(
      0,
      s.kills * 55 +
        Math.round(s.damageDealt / 24) +
        s.agesReached * 900 +
        (victory ? 5000 : 0) +
        survivalBonus +
        speedBonus -
        s.unitsLost * 18
    )
  }

  /** Used by Endless mode to award a survived wave. */
  registerWave(wave: number): void {
    this.statsByFaction.player.wavesSurvived = wave
    this.statsByFaction.enemy.wavesSurvived = wave
  }

  destroy(): void {
    this.units.forEach(u => u.destroy())
    this.projectiles.forEach(p => p.destroy())
    this.beams.forEach(b => b.gfx.destroy())
    this.playerBase.destroy()
    this.enemyBase.destroy()
    this.baseHealthGfx.destroy()
  }
}
