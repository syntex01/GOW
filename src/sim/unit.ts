import Phaser from 'phaser'
import { audio } from '../core/audio'
import { rng } from '../core/rng'
import type { UnitDef } from '../data/types'
import { getUnitArt, unitPartKey } from '../gfx/textureFactory'
import { RES } from '../gfx/unitArt'
import { FACTION_COLOR } from '../gfx/palette'
import type Vfx from '../gfx/vfx'
import { ADVANCE_DIR, damageMultiplier, type ArmorType, type Damageable, type DamageType, type Faction, type Layer } from './types'

export type UnitState = 'advance' | 'engage' | 'dead'

export interface UnitWorld {
  groundY: number
  airY: number
  vfx: Vfx
  /** Time scale applied by the "fast forward" toggle. */
  speedScale: number
}

/** Subtle warm grade applied to hostile units on top of their own palette. */
const ENEMY_GRADE = 0xffb0a4

/** Duration of the white hit flash, in milliseconds. */
const FLASH_MS = 70

const GRAVITY = 2400
const GROUND_FRICTION = 6.5
const AIR_DRAG = 1.2
/** Minimum gap kept between friendly units so columns queue up instead of stacking. */
const QUEUE_GAP = 6

let nextId = 1

export default class Unit implements Damageable {
  readonly id = nextId++
  readonly def: UnitDef
  readonly faction: Faction
  readonly layer: Layer
  readonly armor: ArmorType
  readonly dir: 1 | -1

  x: number
  y: number
  hp: number
  maxHp: number
  alive = true
  radius: number
  centerOffsetY: number

  state: UnitState = 'advance'
  target: Damageable | null = null

  /** Horizontal knockback velocity, decays with friction. */
  vx = 0
  /** Vertical velocity — only non-zero while a unit is airborne from a big hit. */
  vy = 0
  private airborne = false
  private stagger = 0

  private attackCooldown = 0
  private swing = 0
  private burstLeft = 0
  private burstTimer = 0
  private animTime = 0
  private stepPhase = 0
  private flashTimer = 0
  private healPulseTimer = 0

  /** Damage reduction granted by a nearby aura unit; recomputed each tick. */
  auraShield = 0

  private world: UnitWorld
  private scene: Phaser.Scene
  private container: Phaser.GameObjects.Container
  private parts: Record<string, Phaser.GameObjects.Image> = {}
  private shadow: Phaser.GameObjects.Image
  private teamRing: Phaser.GameObjects.Image
  private hpBarBg: Phaser.GameObjects.Rectangle
  private hpBar: Phaser.GameObjects.Rectangle
  private scaleFactor: number

  /** Called by the battlefield when this unit fires; wired up on spawn. */
  onFire?: (unit: Unit, target: Damageable) => void
  onDeath?: (unit: Unit, killer?: Damageable) => void
  onHealPulse?: (unit: Unit) => void
  onDamageDealt?: (unit: Unit, amount: number) => void

  constructor(
    scene: Phaser.Scene,
    def: UnitDef,
    faction: Faction,
    x: number,
    world: UnitWorld,
    spawnJitter?: number
  ) {
    this.scene = scene
    this.def = def
    this.faction = faction
    this.layer = def.layer
    this.armor = def.armor
    this.dir = ADVANCE_DIR[faction]
    this.world = world

    this.hp = def.hp
    this.maxHp = def.hp
    this.radius = def.height * 0.24 * (def.visual.bulk ?? 1)
    this.centerOffsetY = -def.height * 0.5

    this.x = x
    // Air lane jitter is gameplay-affecting (it changes engagement range),
    // so it comes from the caller's deterministic stream, not the shared
    // cosmetic one.
    this.y = def.layer === 'air' ? world.airY + (spawnJitter ?? 0) : world.groundY

    this.scaleFactor = 1 / RES
    this.container = scene.add.container(this.x, this.y)
    this.container.setDepth(def.layer === 'air' ? 260 : 120)

    this.shadow = scene.add
      .image(this.x, world.groundY + 2, 'fx:shadow')
      .setDepth(60)
      .setAlpha(def.layer === 'air' ? 0.22 : 0.4)
      .setDisplaySize(def.height * 0.9, def.height * 0.26)

    // A faction-coloured ring on the ground: the fastest read of whose side a
    // soldier is on, even in a crowded melee.
    this.teamRing = scene.add
      .image(this.x, world.groundY + 1, 'fx:soft')
      .setDepth(61)
      .setTint(FACTION_COLOR[faction])
      .setAlpha(0.62)
      .setDisplaySize(def.height * 0.78, def.height * 0.26)

    this.buildRig()

    const barW = Math.max(24, def.height * 0.62)
    this.hpBarBg = scene.add.rectangle(0, 0, barW + 2, 5, 0x08111f, 0.85).setDepth(280).setOrigin(0.5)
    this.hpBar = scene.add
      .rectangle(0, 0, barW, 3, FACTION_COLOR[faction], 1)
      .setDepth(281)
      .setOrigin(0, 0.5)
    this.hpBarBg.setVisible(false)
    this.hpBar.setVisible(false)

    // Spawn pop.
    this.container.setScale(this.scaleFactor * 0.6)
    scene.tweens.add({
      targets: this.container,
      scaleX: this.scaleFactor * this.dir,
      scaleY: this.scaleFactor,
      duration: 220,
      ease: 'Back.easeOut'
    })
  }

  // ───────────────────────────── Rendering rig ─────────────────────────────

  private addPart(name: string, depth = 0): Phaser.GameObjects.Image | undefined {
    const art = getUnitArt(this.def.id)
    if (!art.parts.includes(name)) return undefined
    const key = unitPartKey(this.def.id, name)
    const [ox, oy] = art.origins[name] ?? [0.5, 0.5]
    const img = this.scene.add.image(0, 0, key).setOrigin(ox, oy)
    this.container.add(img)
    img.setData('depth', depth)
    this.parts[name] = img
    return img
  }

  private buildRig(): void {
    const art = getUnitArt(this.def.id)
    const m = art.metrics
    const R = RES
    const kind = this.def.visual.kind

    if (kind === 'vehicle') {
      this.addPart('track', 0)
      this.addPart('wheel', 1)
      this.addPart('wheel2', 1)
      this.addPart('body', 2)
      if (art.parts.includes('wheel')) {
        // Two wheel instances share one texture.
        const second = this.scene.add
          .image(0, 0, unitPartKey(this.def.id, 'wheel'))
          .setOrigin(0.5, 0.5)
        this.container.add(second)
        this.parts.wheelB = second
      }
      if (art.parts.includes('leg')) {
        const legB = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'leg')).setOrigin(0.5, 0.06)
        this.container.add(legB)
        this.parts.legB = legB
        this.addPart('leg', 1)
        this.parts.legF = this.parts.leg
      }
      this.container.sort('depth')
      this.layoutStatic(m, R)
      return
    }

    if (kind === 'aircraft') {
      this.addPart('rotor', 0)
      this.addPart('body', 1)
      if (this.def.visual.chassis === 'quad') {
        const extras = ['rotorA', 'rotorB', 'rotorC']
        extras.forEach(name => {
          const img = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'rotor')).setOrigin(0.5)
          this.container.add(img)
          this.parts[name] = img
        })
      }
      this.layoutStatic(m, R)
      return
    }

    if (kind === 'mech') {
      const legB = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'leg')).setOrigin(0.5, 0.06)
      legB.setTint(0xbfbfbf)
      this.container.add(legB)
      this.parts.legB = legB
      this.addPart('torso', 2)
      this.addPart('head', 3)
      const legF = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'leg')).setOrigin(0.5, 0.06)
      this.container.add(legF)
      this.parts.legF = legF
      this.addPart('arm', 4)
      this.addPart('weapon', 5)
      this.layoutStatic(m, R)
      return
    }

    // Humanoid / rider.
    this.addPart('cape')
    if (kind === 'rider') {
      const mountLegB = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'mountLeg')).setOrigin(0.5, 0.08)
      mountLegB.setTint(0xb4b4b4)
      this.container.add(mountLegB)
      this.parts.mountLegB = mountLegB
      const mountLegB2 = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'mountLeg')).setOrigin(0.5, 0.08)
      mountLegB2.setTint(0xb4b4b4)
      this.container.add(mountLegB2)
      this.parts.mountLegB2 = mountLegB2
      this.addPart('mount')
      const mountLegF = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'mountLeg')).setOrigin(0.5, 0.08)
      this.container.add(mountLegF)
      this.parts.mountLegF = mountLegF
      const mountLegF2 = this.scene.add.image(0, 0, unitPartKey(this.def.id, 'mountLeg')).setOrigin(0.5, 0.08)
      this.container.add(mountLegF2)
      this.parts.mountLegF2 = mountLegF2
    } else {
      this.addPart('legB')
      this.addPart('legF')
    }
    this.addPart('armB')
    this.addPart('torso')
    this.addPart('head')
    this.addPart('shield')
    this.addPart('armF')
    this.addPart('weapon')

    this.layoutStatic(m, RES)
  }

  /** Positions the parts that never move relative to the body. */
  private layoutStatic(m: ReturnType<typeof getUnitArt>['metrics'], R: number): void {
    const p = this.parts
    const kind = this.def.visual.kind

    if (kind === 'vehicle' || kind === 'aircraft') {
      if (p.body) p.body.setPosition(0, kind === 'aircraft' ? 0 : -m.height * 0.42 * R)
      return
    }
    if (kind === 'mech') {
      if (p.torso) p.torso.setPosition(0, m.hipY * R)
      if (p.head) p.head.setPosition(m.headR * 0.2 * R, m.neckY * R)
      if (p.arm) p.arm.setPosition(m.bodyW * 0.28 * R, m.shoulderY * R)
      return
    }

    if (p.torso) p.torso.setPosition(0, m.hipY * R)
    if (p.head) p.head.setPosition(m.headR * 0.22 * R, m.neckY * R)
    if (p.cape) p.cape.setPosition(-m.bodyW * 0.24 * R, (m.shoulderY - m.torsoH * 0.06) * R)
    if (p.shield) p.shield.setPosition(m.bodyW * 0.42 * R, (m.shoulderY + m.torsoH * 0.25) * R)
    if (p.armB) p.armB.setPosition(-m.bodyW * 0.12 * R, m.shoulderY * R)
    if (p.armF) p.armF.setPosition(m.bodyW * 0.24 * R, m.shoulderY * R)
    if (p.legB) p.legB.setPosition(-m.bodyW * 0.14 * R, m.hipY * R)
    if (p.legF) p.legF.setPosition(m.bodyW * 0.14 * R, m.hipY * R)
  }

  // ─────────────────────────────── Simulation ───────────────────────────────

  /** Where projectiles fired by this unit originate, in world space. */
  muzzleWorld(): { x: number; y: number } {
    const attack = this.def.attack
    const offset = attack.kind === 'projectile' ? (attack.muzzle ?? [14, -this.def.height * 0.55]) : [10, -this.def.height * 0.55]
    return {
      x: this.x + offset[0] * this.dir,
      y: this.y + offset[1]
    }
  }

  /** Vertical centre used for aiming and hit tests. */
  get centerY(): number {
    return this.y + this.centerOffsetY
  }

  /** Front edge in the direction of travel. */
  get frontX(): number {
    return this.x + this.radius * this.dir
  }

  distanceTo(other: Damageable): number {
    const dx = Math.abs(other.x - this.x)
    const dy = Math.abs(other.y + other.centerOffsetY - this.centerY)
    // sqrt is correctly rounded by IEEE-754; Math.hypot is not specified
    // exactly, so it can differ between engines and break lockstep.
    return Math.max(0, Math.sqrt(dx * dx + dy * dy) - other.radius - this.radius * 0.4)
  }

  canTarget(other: Damageable): boolean {
    if (!other.alive) return false
    if (other.layer === 'air' && !this.def.hitsAir) return false
    return true
  }

  takeDamage(amount: number, type: DamageType, source?: Damageable, knockback = 0): void {
    if (!this.alive) return
    const mult = damageMultiplier(type, this.armor)
    const reduced = amount * mult * (1 - this.auraShield)
    this.hp -= reduced
    this.flashTimer = FLASH_MS

    const color = type === 'energy' ? 0x9fe8ff : type === 'explosive' ? 0xffa640 : 0xffe08a
    const organic = this.def.visual.kind === 'humanoid' || this.def.visual.kind === 'rider'
    this.world.vfx.impact(this.x, this.centerY, color, Math.min(2, reduced / 60 + 0.5), organic)
    this.world.vfx.damageNumber(this.x, this.centerY - this.def.height * 0.35, reduced, mult > 1.15 ? 0xffd166 : 0xffffff, mult > 1.3)

    if (knockback > 0) {
      const impulse = (knockback / Math.max(0.4, this.def.mass)) * 1.6
      this.vx += -this.dir * impulse
      if (impulse > 150 && this.layer === 'ground') {
        this.vy = -Math.min(560, impulse * 1.5)
        this.airborne = true
      }
      this.stagger = Math.min(420, impulse * 1.4)
    }

    if (this.hp <= 0) this.kill(source)
  }

  heal(amount: number): void {
    if (!this.alive) return
    const before = this.hp
    this.hp = Math.min(this.maxHp, this.hp + amount)
    if (this.hp > before) {
      this.healPulseTimer = 180
      this.world.vfx.damageNumber(this.x, this.centerY - this.def.height * 0.4, this.hp - before, 0x9ff0c8)
    }
  }

  kill(killer?: Damageable): void {
    if (!this.alive) return
    this.alive = false
    this.state = 'dead'
    this.hp = 0
    this.hpBar.destroy()
    this.hpBarBg.destroy()
    this.teamRing.setAlpha(0.25)

    const kind = this.def.visual.kind
    const mechanical = kind === 'vehicle' || kind === 'mech' || kind === 'aircraft'
    if (mechanical) {
      this.world.vfx.scrap(this.x, this.centerY, 1.2)
      this.world.vfx.explosion(this.x, this.centerY, this.def.height * 1.1, 0xffa640, this.def.height > 70)
      audio.play('death_mech', 0.6)
    } else {
      this.world.vfx.gore(this.x, this.centerY, 1)
      audio.play('death', 0.5)
    }

    this.onDeath?.(this, killer)
    this.playDeathAnimation(mechanical)
  }

  /** Limbs splay, the body topples, and the corpse fades into the ground. */
  private playDeathAnimation(mechanical: boolean): void {
    const tumbleDir = this.vx !== 0 ? Math.sign(this.vx) : -this.dir
    this.container.setDepth(80)

    Object.entries(this.parts).forEach(([name, part]) => {
      if (name === 'weapon' || name === 'shield') {
        this.scene.tweens.add({
          targets: part,
          x: part.x + rng.spread(30),
          y: part.y - rng.range(10, 40),
          rotation: part.rotation + rng.spread(6),
          alpha: 0,
          duration: 900,
          ease: 'Quad.easeOut'
        })
        return
      }
      this.scene.tweens.add({
        targets: part,
        rotation: part.rotation + rng.spread(mechanical ? 0.5 : 1.4),
        x: part.x + rng.spread(mechanical ? 4 : 10),
        duration: 420,
        ease: 'Quad.easeOut'
      })
    })

    this.scene.tweens.add({
      targets: this.container,
      rotation: tumbleDir * (Math.PI / 2) * (mechanical ? 0.35 : 0.95),
      y: this.layer === 'air' ? this.world.groundY : this.y,
      duration: this.layer === 'air' ? 900 : 380,
      ease: this.layer === 'air' ? 'Quad.easeIn' : 'Bounce.easeOut',
      onComplete: () => {
        if (this.layer === 'air') {
          this.world.vfx.explosion(this.x, this.world.groundY - 20, 90, 0xffa640, true)
        }
        this.scene.tweens.add({
          targets: [this.container, this.shadow, this.teamRing],
          alpha: 0,
          duration: 1600,
          delay: 1400,
          onComplete: () => this.destroy()
        })
      }
    })
  }

  /**
   * @param blockerFrontX  X of the rear edge of the friendly unit ahead, or null.
   * @param nearest        Current best target, chosen by the battlefield.
   */
  update(dtMs: number, blockerX: number | null, nearest: Damageable | null): void {
    if (!this.alive) return
    const dt = dtMs / 1000

    this.animTime += dtMs
    if (this.flashTimer > 0) this.flashTimer -= dtMs
    if (this.healPulseTimer > 0) this.healPulseTimer -= dtMs
    if (this.stagger > 0) this.stagger -= dtMs
    if (this.attackCooldown > 0) this.attackCooldown -= dtMs
    if (this.def.regen) this.hp = Math.min(this.maxHp, this.hp + this.def.regen * dt)

    // Knockback physics.
    if (this.airborne) {
      this.vy += GRAVITY * dt
      this.y += this.vy * dt
      this.vx -= this.vx * AIR_DRAG * dt
      if (this.y >= this.world.groundY) {
        this.y = this.world.groundY
        this.airborne = false
        if (Math.abs(this.vy) > 200) {
          this.world.vfx.footDust(this.x, this.world.groundY)
          this.world.vfx.impact(this.x, this.world.groundY - 6, 0xbfae8a, 0.6, false)
        }
        this.vy = 0
      }
    } else if (this.vx !== 0) {
      const decel = GROUND_FRICTION * dt
      this.vx -= this.vx * Math.min(1, decel)
      if (Math.abs(this.vx) < 4) this.vx = 0
    }
    this.x += this.vx * dt

    this.target = nearest
    const staggered = this.stagger > 0

    if (nearest && this.distanceTo(nearest) <= this.def.range) {
      this.state = 'engage'
      if (!staggered) this.tryAttack(nearest, dtMs)
    } else {
      this.state = 'advance'
      if (!staggered) this.advance(dt, blockerX)
    }

    this.handleBurst(dtMs)
    this.updateVisual(dtMs)
  }

  private advance(dt: number, blockerX: number | null): void {
    const step = this.def.speed * dt * this.dir
    const nextX = this.x + step
    if (blockerX !== null) {
      const limit = blockerX - this.dir * (this.radius + QUEUE_GAP)
      if ((this.dir === 1 && nextX > limit) || (this.dir === -1 && nextX < limit)) {
        this.x = limit
        return
      }
    }
    this.x = nextX
    this.stepPhase += Math.abs(step)
  }

  private tryAttack(target: Damageable, dtMs: number): void {
    void dtMs
    if (this.attackCooldown > 0) return
    const attack = this.def.attack

    if (attack.kind === 'heal' || attack.kind === 'aura') {
      this.attackCooldown = this.def.attackMs
      this.onHealPulse?.(this)
      return
    }

    this.attackCooldown = this.def.attackMs
    this.swing = 1

    if (attack.kind === 'projectile' && attack.burst) {
      this.burstLeft = attack.burst.rounds
      this.burstTimer = 0
      return
    }

    this.fireOnce(target)
  }

  private handleBurst(dtMs: number): void {
    if (this.burstLeft <= 0) return
    const attack = this.def.attack
    if (attack.kind !== 'projectile' || !attack.burst) {
      this.burstLeft = 0
      return
    }
    this.burstTimer -= dtMs
    if (this.burstTimer > 0) return
    const target = this.target
    if (!target || !target.alive) {
      this.burstLeft = 0
      return
    }
    this.fireOnce(target)
    this.burstLeft -= 1
    this.burstTimer = attack.burst.gapMs
  }

  private fireOnce(target: Damageable): void {
    this.onFire?.(this, target)
  }

  /** Support units call this from the battlefield after resolving their radius. */
  markHealPulse(): void {
    this.healPulseTimer = 200
  }

  /** Damage bookkeeping hook used for match statistics. */
  reportDamage(amount: number): void {
    this.onDamageDealt?.(this, amount)
  }

  // ─────────────────────────── Procedural animation ───────────────────────────

  private updateVisual(dtMs: number): void {
    const art = getUnitArt(this.def.id)
    const m = art.metrics
    const R = RES
    const p = this.parts
    const moving = this.state === 'advance' && this.stagger <= 0
    const kind = this.def.visual.kind

    // Facing: flip the whole container.
    this.container.setScale(this.scaleFactor * this.dir, this.scaleFactor)
    this.container.setPosition(this.x, this.y)
    this.shadow.setPosition(this.x, this.world.groundY + 2)
    this.shadow.setAlpha(this.layer === 'air' ? 0.18 : 0.4)
    this.teamRing.setPosition(this.x, this.world.groundY + 1)

    if (this.swing > 0) this.swing = Math.max(0, this.swing - dtMs / (this.def.attackMs * 0.42))

    const gait = this.stepPhase / Math.max(12, this.def.height * 0.32)
    const walk = moving ? Math.sin(gait) : 0
    const walk2 = moving ? Math.sin(gait + Math.PI) : 0
    const bob = moving ? Math.abs(Math.sin(gait)) * this.def.height * 0.035 : 0
    // A slow idle breath keeps stationary units alive on screen.
    const breathe = Math.sin(this.animTime / 620) * this.def.height * 0.012

    // Footfall dust twice per gait cycle.
    if (moving && this.layer === 'ground') {
      const phase = Math.floor(gait / Math.PI)
      if (phase !== this.lastStepPhase) {
        this.lastStepPhase = phase
        this.world.vfx.footDust(this.x - this.dir * this.radius * 0.4, this.world.groundY)
      }
    }

    if (kind === 'aircraft') {
      const hover = Math.sin(this.animTime / 380) * 6
      this.container.setY(this.y + hover)
      const spin = (this.animTime / 1000) * 26
      if (p.rotor) p.rotor.setPosition(-m.height * 0.04 * R, -m.height * 0.34 * R).setScale(1, Math.cos(spin) * 0.9 + 0.1)
      ;['rotorA', 'rotorB', 'rotorC'].forEach((name, i) => {
        const part = p[name]
        if (!part) return
        const offsets: [number, number][] = [
          [-m.height * 0.42, -m.height * 0.14],
          [m.height * 0.42, -m.height * 0.14],
          [m.height * 0.42, m.height * 0.16]
        ]
        part.setPosition(offsets[i][0] * R, offsets[i][1] * R).setScale(Math.cos(spin + i) * 0.9 + 0.1, 1)
      })
      if (p.body) p.body.setRotation(Phaser.Math.Clamp(this.vx / 900, -0.14, 0.14) + (moving ? 0.06 : 0))
      this.updateHpBar()
      this.applyTints()
      return
    }

    if (kind === 'vehicle') {
      const roll = (this.stepPhase / Math.max(8, this.def.height * 0.28)) * 1.4
      if (p.body) p.body.setPosition(0, -m.height * 0.42 * R + bob * 0.3 * R)
      if (p.track) p.track.setPosition(0, -m.height * 0.14 * R)
      if (p.wheel) p.wheel.setPosition(-m.height * 0.42 * R, -m.height * 0.2 * R).setRotation(roll)
      if (p.wheelB) p.wheelB.setPosition(m.height * 0.42 * R, -m.height * 0.2 * R).setRotation(roll)
      if (p.legB) p.legB.setPosition(-m.height * 0.18 * R, -m.height * 0.2 * R).setRotation(walk * 0.4)
      if (p.legF) p.legF.setPosition(m.height * 0.18 * R, -m.height * 0.2 * R).setRotation(walk2 * 0.4)
      // Recoil kick right after firing.
      if (p.body) p.body.setX(-this.swing * this.def.height * 0.18 * R)
      this.updateHpBar()
      this.applyTints()
      return
    }

    if (kind === 'mech') {
      const stride = 0.55
      if (p.legB) p.legB.setPosition(-m.bodyW * 0.46 * R, m.hipY * R).setRotation(walk * stride)
      if (p.legF) p.legF.setPosition(m.bodyW * 0.46 * R, m.hipY * R).setRotation(walk2 * stride)
      if (p.torso) p.torso.setPosition(0, (m.hipY - bob) * R + breathe * R)
      if (p.head) p.head.setPosition(m.headR * 0.2 * R, (m.neckY - bob) * R)
      const aim = this.aimAngle()
      if (p.arm) p.arm.setPosition(m.bodyW * 0.28 * R, (m.shoulderY - bob) * R).setRotation(aim - Math.PI / 2 - this.swing * 0.5)
      if (p.weapon) {
        const armLen = m.armLen * 1.05 * R
        p.weapon
          .setPosition(
            m.bodyW * 0.28 * R + Math.cos(aim) * armLen,
            (m.shoulderY - bob) * R + Math.sin(aim) * armLen
          )
          .setRotation(aim - this.swing * 0.3)
      }
      this.updateHpBar()
      this.applyTints()
      return
    }

    // Humanoid / rider.
    const stride = kind === 'rider' ? 0.28 : 0.62
    if (kind === 'rider') {
      const gallop = Math.sin(gait * 1.6)
      const gallop2 = Math.sin(gait * 1.6 + Math.PI * 0.6)
      const mountY = -m.height * 0.34
      if (p.mount) p.mount.setPosition(-m.height * 0.06 * R, (mountY - bob * 0.6) * R)
      const legPairs: [string, number, number][] = [
        ['mountLegB', -m.height * 0.3, gallop],
        ['mountLegB2', m.height * 0.24, gallop2],
        ['mountLegF', -m.height * 0.26, gallop2],
        ['mountLegF2', m.height * 0.28, gallop]
      ]
      legPairs.forEach(([name, ox, swing]) => {
        const part = p[name]
        if (part) part.setPosition(ox * R, (mountY + m.height * 0.08) * R).setRotation(swing * 0.7)
      })
      if (p.torso) p.torso.setPosition(-m.height * 0.02 * R, (m.hipY - m.height * 0.16 - bob * 0.5) * R + breathe * R)
      if (p.head) p.head.setPosition((m.headR * 0.22 - m.height * 0.02) * R, (m.neckY - m.height * 0.16 - bob * 0.5) * R)
    } else {
      if (p.legB) p.legB.setPosition(-m.bodyW * 0.14 * R, m.hipY * R).setRotation(walk * stride)
      if (p.legF) p.legF.setPosition(m.bodyW * 0.14 * R, m.hipY * R).setRotation(walk2 * stride)
      if (p.torso) p.torso.setPosition(0, (m.hipY - bob) * R + breathe * R)
      if (p.head)
        p.head
          .setPosition(m.headR * 0.22 * R, (m.neckY - bob) * R)
          .setRotation(Math.sin(this.animTime / 700) * 0.04)
    }

    const shoulderY = (kind === 'rider' ? m.shoulderY - m.height * 0.16 : m.shoulderY) - bob
    const aim = this.aimAngle()
    const isMelee = this.def.attack.kind === 'melee'

    // Back arm swings with the gait; front arm holds the weapon.
    if (p.armB) {
      p.armB
        .setPosition(-m.bodyW * 0.12 * R, shoulderY * R)
        .setRotation(kind === 'rider' ? -0.4 : walk2 * 0.5 + 0.1)
    }
    if (p.armF) {
      const swingAngle = isMelee ? this.meleeArmAngle() : aim - Math.PI / 2 - this.swing * 0.35
      p.armF.setPosition(m.bodyW * 0.24 * R, shoulderY * R).setRotation(swingAngle)
    }
    if (p.shield) {
      p.shield.setPosition(m.bodyW * 0.5 * R, (shoulderY + m.torsoH * 0.3) * R).setRotation(Math.sin(this.animTime / 900) * 0.05)
    }
    if (p.cape) {
      p.cape
        .setPosition(-m.bodyW * 0.26 * R, (shoulderY - m.torsoH * 0.05) * R)
        .setRotation(-0.16 - walk * 0.14 - Math.min(0.4, Math.abs(this.def.speed) / 400))
    }
    if (p.weapon && p.armF) {
      // A limb drawn top-down points along its rotation plus a quarter turn.
      const handAngle = p.armF.rotation + Math.PI / 2
      const armLen = m.armLen * R * 0.94
      p.weapon
        .setPosition(
          p.armF.x + Math.cos(handAngle) * armLen,
          p.armF.y + Math.sin(handAngle) * armLen
        )
        // Melee weapons stay roughly in line with the forearm's swing; ranged
        // weapons point straight down the firing line.
        .setRotation(isMelee ? p.armF.rotation + 0.18 : handAngle)
    }

    this.updateHpBar()
    this.applyTints()
    this.emitLight()
  }

  /** Future-age gear and shield auras cast their own light. */
  private emitLight(): void {
    const v = this.def.visual
    if (v.torso === 'exo' || v.helmet === 'visor' || v.helmet === 'halo') {
      const pulse = 0.7 + Math.sin(this.animTime / 340) * 0.12
      this.world.vfx.light(this.x, this.centerY, this.def.height * 0.9, v.accent, pulse * 0.5)
    }
    if (this.auraShield > 0) {
      this.world.vfx.light(this.x, this.centerY, this.def.height * 1.5, 0x74f0ff, 0.45)
    }
  }

  private lastStepPhase = -1

  /**
   * Melee arm angle: rest low, wind the weapon back, then snap it forward and
   * settle. `swing` counts down from 1 over the first part of the attack.
   */
  private meleeArmAngle(): number {
    const REST = -0.35
    const WINDUP = -1.65
    const STRIKE = 0.85
    if (this.swing <= 0) return REST
    const t = 1 - this.swing
    if (t < 0.4) return Phaser.Math.Linear(REST, WINDUP, t / 0.4)
    if (t < 0.72) return Phaser.Math.Linear(WINDUP, STRIKE, (t - 0.4) / 0.32)
    return Phaser.Math.Linear(STRIKE, REST, (t - 0.72) / 0.28)
  }

  private aimAngle(): number {
    const target = this.target
    if (!target) return 0
    const muzzle = this.muzzleWorld()
    const dx = (target.x - muzzle.x) * this.dir
    const dy = target.y + target.centerOffsetY - muzzle.y
    // Ballistic weapons lead upward so the arc reads correctly.
    const attack = this.def.attack
    let lift = 0
    if (attack.kind === 'projectile' && attack.gravity > 0) {
      const range = Math.max(40, Math.abs(dx))
      lift = -Math.min(0.9, (attack.gravity * range) / (2 * attack.speed * attack.speed) * 3)
    }
    return Phaser.Math.Clamp(Math.atan2(dy, Math.max(20, dx)) + lift, -1.35, 1.1)
  }

  private updateHpBar(): void {
    const damaged = this.hp < this.maxHp - 0.5
    this.hpBarBg.setVisible(damaged)
    this.hpBar.setVisible(damaged)
    if (!damaged) return
    const barW = Math.max(24, this.def.height * 0.62)
    const y = this.container.y - this.def.height - 12
    this.hpBarBg.setPosition(this.x, y)
    this.hpBar.setPosition(this.x - barW / 2, y)
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1)
    this.hpBar.width = barW * ratio
    this.hpBar.fillColor = ratio > 0.5 ? FACTION_COLOR[this.faction] : ratio > 0.25 ? 0xfbbf24 : 0xf87171
  }

  private applyTints(): void {
    if (this.flashTimer > FLASH_MS * 0.45) {
      // A very short solid-white pop reads as a hit without erasing the unit's
      // artwork — in a heavy melee everything is being hit constantly.
      Object.values(this.parts).forEach(part => part.setTintFill(0xffffff))
    } else if (this.flashTimer > 0) {
      Object.values(this.parts).forEach(part => part.setTint(0xffb0b0))
    } else if (this.healPulseTimer > 0) {
      Object.values(this.parts).forEach(part => part.setTint(0x9ff0c8))
    } else if (this.faction === 'enemy') {
      Object.values(this.parts).forEach(part => part.setTint(ENEMY_GRADE))
    } else {
      Object.values(this.parts).forEach(part => part.clearTint())
    }
  }

  /** Shows a shimmering barrier around units protected by an Aegis Bearer. */
  setAuraVisual(active: boolean): void {
    if (active && !this.auraSprite) {
      this.auraSprite = this.scene.add
        .image(this.x, this.centerY, 'fx:soft')
        .setDepth(115)
        .setTint(0x74f0ff)
        .setAlpha(0.22)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(this.def.height * 1.5, this.def.height * 1.7)
    } else if (!active && this.auraSprite) {
      this.auraSprite.destroy()
      this.auraSprite = undefined
    }
    if (this.auraSprite) {
      this.auraSprite.setPosition(this.x, this.centerY)
      this.auraSprite.setAlpha(0.16 + Math.sin(this.animTime / 260) * 0.06)
    }
  }

  private auraSprite?: Phaser.GameObjects.Image

  destroy(): void {
    this.container.destroy()
    this.shadow.destroy()
    this.teamRing.destroy()
    this.auraSprite?.destroy()
    if (this.hpBar.active) this.hpBar.destroy()
    if (this.hpBarBg.active) this.hpBarBg.destroy()
  }
}
