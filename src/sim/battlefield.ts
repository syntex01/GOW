import Phaser from 'phaser'
import { audio, type SfxName } from '../core/audio'
import type { MatchStats } from '../core/events'
import { Rng } from '../core/rng'
import { datan2, dcos, dsin, halfLifeDecay } from './dmath'
import { ABILITIES_BY_ID } from '../data/abilities'
import { ageDef } from '../data/ages'
import { AGE_THEMES } from '../gfx/palette'
import { rosterForAge } from '../data/units'
import type { TurretDef, UnitDef, WeaponVisual } from '../data/types'
import { TECHS_BY_ID, TECH_ORDER, type TechId } from '../data/tech'
import { FACTION_UNITS, type FactionId } from '../data/factions'
import { TURRETS_BY_ID } from '../data/turrets'
import { ensureUnitArt } from '../gfx/textureFactory'
import type Vfx from '../gfx/vfx'
import Army, { type ArmyModifiers, defaultModifiers } from './army'
import Base, { type TurretSlot } from './base'
import { BASE_H, BASE_W } from '../gfx/propArt'
import Projectile, { ballisticAngle } from './projectile'
import PhysicsWorld, { type Body } from './physics'
import Terrain, { RELIEF_BUCKET } from './terrain'
import Unit, { resetUnitIds, type UnitWorld } from './unit'
import { ADVANCE_DIR, LANE_COUNT, LANE_Y, OPPOSITE, type Damageable, type DamageType, type Faction, type TechBranchLean } from './types'

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
/** How many of the nearest enemies a shooter will spread its fire across. */
const FIRE_SPREAD = 4
/** Damage kept by a shot that crosses 0, 1 or 2 lane boundaries. */
const CROSS_LANE_DAMAGE = [1, 0.5, 0.32] as const
/** How far back a rank still counts as pressing into the fight ahead of it. */
const PRESS_REACH = 105
/** Extra share of a blow contributed by each supporting rank. */
const PRESS_BONUS = 0.5
/** Ranks beyond this are too far back to lean on anything. */
const MAX_PRESS = 4

/** The protective field a unit projects, from either place it can be declared. */
function auraOf(def: UnitDef): { damageReduction: number; radius: number } | null {
  if (def.special === 'barrier') return { damageReduction: 0.15, radius: 110 }
  if (def.aura) return def.aura
  return def.attack.kind === 'aura' ? def.attack : null
}

/** Path unit defs by id, for the specials that summon their own kind. */
const FACTION_UNITS_BY_ID: Record<string, UnitDef> = Object.fromEntries(FACTION_UNITS.map(u => [u.id, u]))

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
  // Spreading the patch directly would let an explicitly-undefined key wipe out
  // its default, and a single undefined multiplier turns an army's gold into
  // NaN for the rest of the match — a silent loss, with no error anywhere.
  const merged = defaultModifiers()
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      merged[key as keyof ArmyModifiers] = value
    }
  }
  return merged
}

/** The furniture of the clean opening board. */
export type PropKind = 'tree' | 'well' | 'cart' | 'boulder'

/**
 * Person-scaled field furniture. `blockH` is how high the thing stops a shot;
 * `mass` is how much ground it becomes when it falls; `chunks` is how much of
 * it goes flying when it does.
 */
export const PROP_SPECS: Record<
  PropKind,
  { hp: number; radius: number; blockH: number; mass: number; chunks: number; dust: number }
> = {
  // Taller than any soldier — a real tree, and real cover for a whole file.
  tree: { hp: 340, radius: 12, blockH: 64, mass: 6, chunks: 5, dust: 0x7a6a44 },
  // Chest-high stone; stops low shots, takes a while to knock apart.
  well: { hp: 560, radius: 14, blockH: 32, mass: 8, chunks: 6, dust: 0xa8a8a0 },
  // Shoulder-high wood; decent cover, comes apart fast.
  cart: { hp: 380, radius: 20, blockH: 40, mass: 6, chunks: 6, dust: 0x9a7a4e },
  // Waist-high granite; the most stubborn thing on the opening board.
  boulder: { hp: 900, radius: 16, blockH: 28, mass: 10, chunks: 5, dust: 0x8a8a86 }
}

/**
 * Owns the whole battle: both armies, every unit and projectile, combat
 * resolution, special abilities, and the running match statistics.
 */
/** What a banner pays when held. */
export type BannerKind = 'gold' | 'xp' | 'ability'

/**
 * The field's prizes, era by era. One mid-lane scrum flag for the stone age;
 * by the final age five objectives stagger across every lane, and the two
 * richest sit nearest the fortresses that want them least contested.
 */
const BANNER_ERAS: { at: number; lane: number; kind: BannerKind }[][] = [
  [{ at: 0.5, lane: 2, kind: 'gold' }],
  [
    { at: 0.38, lane: 1, kind: 'gold' },
    { at: 0.62, lane: 3, kind: 'xp' }
  ],
  [
    { at: 0.3, lane: 0, kind: 'gold' },
    { at: 0.5, lane: 2, kind: 'xp' },
    { at: 0.7, lane: 4, kind: 'gold' }
  ],
  [
    { at: 0.26, lane: 3, kind: 'gold' },
    { at: 0.42, lane: 1, kind: 'xp' },
    { at: 0.58, lane: 2, kind: 'ability' },
    { at: 0.74, lane: 0, kind: 'gold' }
  ],
  [
    { at: 0.24, lane: 0, kind: 'gold' },
    { at: 0.38, lane: 3, kind: 'xp' },
    { at: 0.5, lane: 2, kind: 'ability' },
    { at: 0.62, lane: 1, kind: 'xp' },
    { at: 0.76, lane: 4, kind: 'gold' }
  ]
]

/**
 * Experience paid per point of damage dealt. Calibrated against the roster:
 * a Clubman has 260 hp and pays 26 experience when killed, so grinding one
 * down is worth about a third of the kill, and the kill still pays in full.
 */
const XP_PER_DAMAGE = 0.03

/** Creed colours for the banner rally pulse. */
const BRANCH_FX_COLOR: Record<string, number> = {
  carnage: 0xd93b2b,
  ordnance: 0xffa640,
  engineering: 0x8fd0ff,
  occult: 0xb46bff,
  blight: 0x8fd694
}

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

  /**
   * Every loose object on the field. Part of the simulation rather than the
   * effects layer, because corpses block shots and shrapnel wounds.
   */
  readonly physics: PhysicsWorld

  /**
   * How soaked each slice of ground is, 0..1, in buckets across the world.
   *
   * The splatter a player sees is a texture, which cannot be hashed cheaply
   * and must never drive the outcome of a networked match. This is the version
   * the *simulation* keeps: coarse, deterministic, and the only thing gameplay
   * is ever allowed to read.
   */
  readonly goreMap: Float32Array
  /** Sim-time of the last blow landed anywhere — the peace clock's zero. */
  lastViolenceMs = 0
  /** The ground itself: mounds of the dead, craters, and slow healing. */
  readonly terrain: Terrain
  /** Bodies quietly becoming ground. */
  decomposing: { x: number; lane: number; mass: number; dueMs: number }[] = []
  /**
   * What stood on the field before anyone fought over it. Trees, wells,
   * carts and boulders block shots in their lane until something knocks them
   * down — the clean world the match opens with, and the first thing
   * artillery erases. Everything is person-scaled: a tree towers over a
   * soldier, a well comes up to his chest, a cart to his shoulder.
   */
  readonly props: { x: number; lane: number; kind: PropKind; hp: number; maxHp: number; radius: number; blockH: number; alive: boolean; diedAt: number }[] = []
  /** A prop changed (took damage or fell); the scene should repaint it. */
  onPropChanged?: (index: number) => void
  /**
   * The creeds' ground rules run on their own coarse clock — walking every
   * relief bucket per sub-step would be waste, and none of these effects need
   * sub-frame reaction time.
   */
  private creedClock = 0
  /**
   * Engineering's quarry ledger: mound mass eaten on the own half, banked
   * until it is worth a whole coin. Part of the fingerprint because it turns
   * into gold, and gold decides matches.
   */
  private quarryBank: Record<Faction, number> = { player: 0, enemy: 0 }

  /**
   * War banners — the field's prizes, and the anti-stall rule.
   *
   * A banner lives in ONE LANE: only soldiers walking that lane can flip it,
   * so map control is played with the same placement decision as everything
   * else. The set of banners GROWS WITH THE WAR — one scrum flag in the
   * stone age, five staggered objectives by the end — and they are not all
   * gold: beacons pay evolution XP and reliquaries feed the commander's
   * ability. A holder's creed lean adds its own signature on top (see
   * updateBanners). An army that refuses to leave its walls is donating all
   * of it to the player who walks out and takes the field.
   */
  readonly banners: { x: number; lane: number; kind: BannerKind; hold: number }[] = []
  /** Banners currently paying each side, for the HUD. */
  bannersOwned: Record<Faction, number> = { player: 0, enemy: 0 }
  private bannerCarry: Record<Faction, number> = { player: 0, enemy: 0 }
  private bannerEra = -1
  private boneCarry: Record<Faction, number> = { player: 0, enemy: 0 }
  private bannerFx = 0
  /** Blight's sprouting scan cursor, so zone growth staggers over frames. */
  private bloomClock = 0
  /** Spawn counter for this match, so nothing depends on a global id. */
  private spawnSeq = 0
  private readonly goreBucketWidth: number

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
    // Ids restart at one for every match. The counter is shared with menu
    // decorations, and unit ids are part of the lockstep fingerprint — two
    // peers must not inherit two different menu histories.
    resetUnitIds()
    this.rng = new Rng(config.seed ?? Date.now())

    const playerMods = mergeModifiers(config.playerModifiers)
    const enemyMods = mergeModifiers(config.enemyModifiers)

    this.player = new Army('player', config.startingGold, playerMods)
    this.enemy = new Army('enemy', config.startingGold, enemyMods)
    this.enemy.age = Math.max(0, Math.min(4, config.enemyStartAge ?? 0))
    this.relayoutBanners()

    // The physics world is created below; the unit world holds the same one.
    this.world = {
      groundY: config.groundY,
      airY: config.airY,
      vfx,
      speedScale: 1,
      physics: null as never,
      rng: this.rng,
      goreAt: x => this.goreAt(x),
      scavenge: unit => this.scavenge(unit),
      onDeathCharge: unit => this.detonateCorpse(unit),
      requestFlank: unit => this.handleFlank(unit),
      reliefAt: (x, lane) => this.terrain.heightAt(x, lane),
      homeX: faction => {
        const base = this.baseFor(faction)
        return base.x + ADVANCE_DIR[faction] * base.radius
      }
    }

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
    const shedRubble = (x: number, y: number, amount: number) => {
      const chunks = Math.min(4, 1 + Math.floor(amount / 90))
      for (let i = 0; i < chunks; i += 1) {
        this.physics.spawn('rubble', x, y, this.rng.spread(150), -this.rng.range(40, 200), {
          size: this.rng.range(0.45, 1),
          spin: this.rng.spread(9),
          ttl: 14000
        })
      }
    }
    this.playerBase.onWallHit = shedRubble
    this.enemyBase.onWallHit = shedRubble

    this.playerBase.onDestroyed = () => this.endMatch(false)
    this.enemyBase.onDestroyed = () => this.endMatch(true)

    // One bucket per 16 world pixels: fine enough that a unit can tell soaked
    // ground from clean, coarse enough to stay cheap and to hash.
    this.goreBucketWidth = 16
    this.goreMap = new Float32Array(Math.ceil(config.worldWidth / this.goreBucketWidth) + 1)
    this.terrain = new Terrain(config.worldWidth)
    // The clean opening board: a handful of trees, wells, carts and boulders
    // on the middle ground, dealt from the match seed so both peers stand the
    // same world.
    const propCount = 5 + this.rng.int(0, 3)
    for (let i = 0; i < propCount; i += 1) {
      const x = config.worldWidth * (0.28 + this.rng.next() * 0.44)
      const lane = this.rng.int(0, LANE_COUNT - 1)
      const roll = this.rng.next()
      const kind: PropKind = roll < 0.4 ? 'tree' : roll < 0.55 ? 'well' : roll < 0.75 ? 'cart' : 'boulder'
      const spec = PROP_SPECS[kind]
      this.props.push({
        x,
        lane,
        kind,
        hp: spec.hp,
        maxHp: spec.hp,
        radius: spec.radius,
        blockH: spec.blockH,
        alive: true,
        diedAt: 0
      })
    }

    this.physics = new PhysicsWorld(config.groundY, config.worldWidth, this.rng, {
      onStain: (body, x, y, speed, onWall) => this.handleStain(body, x, y, speed, onWall),
      onDrip: (x, y, vx, vy, color) => {
        this.physics.spawn('blood', x, y, vx, vy, { color, size: 0.6 })
      },
      onShrapnel: body => this.handleShrapnel(body),
      onSettle: body => this.handleSettle(body)
    })
    this.world.physics = this.physics
    this.physics.setWalls([
      { x0: this.playerBase.x - BASE_W * 0.5, x1: this.playerBase.x + BASE_W * 0.5, top: config.groundY - BASE_H * 0.8 },
      { x0: this.enemyBase.x - BASE_W * 0.5, x1: this.enemyBase.x + BASE_W * 0.5, top: config.groundY - BASE_H * 0.8 }
    ])

    this.updateWind()
    this.baseHealthGfx = scene.add.graphics().setDepth(290)
  }

  // ───────────────────────────── Physics glue ─────────────────────────────

  /** Bucket index for a world x, clamped to the map. */
  private goreBucket(x: number): number {
    const i = Math.floor(x / this.goreBucketWidth)
    return i < 0 ? 0 : i >= this.goreMap.length ? this.goreMap.length - 1 : i
  }

  /** How soaked the ground is under a point, 0..1. */
  goreAt(x: number): number {
    return this.goreMap[this.goreBucket(x)]
  }

  /**
   * Something landed. The simulation records it in the gore map; the scene
   * paints it. Only the first of those two can ever change the match.
   */
  private handleStain(body: Body, x: number, y: number, speed: number, onWall: boolean): void {
    if (body.kind === 'blood' || body.kind === 'gib') {
      const i = this.goreBucket(x)
      this.goreMap[i] = Math.min(1, this.goreMap[i] + (body.kind === 'gib' ? 0.16 : 0.03))
    }
    this.onStain?.(body, x, y, speed, onWall)
  }

  private handleSettle(body: Body): void {
    this.handleSalvage(body)
    this.onSettle?.(body)
  }

  /** A fragment reached something it can hurt. */
  private handleShrapnel(body: Body): void {
    for (const t of this.units) {
      if (!t.alive || t.faction === body.faction) continue
      const dx = t.x - body.x
      const dy = t.y + t.centerOffsetY - body.y
      if (dx * dx + dy * dy > (t.radius + 6) * (t.radius + 6)) continue
      this.applyDamage(null, t, { amount: body.damage, type: 'pierce', knockback: 40 })
      body.dead = true
      return
    }
  }

  /**
   * Bonepickers. A wounded soldier eats the nearest piece of the dead, which
   * removes it from the field — so the tech trades the corpse wall you might
   * have built for the health you need now.
   */
  private scavenge(unit: Unit): void {
    const reach = unit.def.height * 0.7
    for (const body of this.physics.bodies) {
      if (!body.settled || body.kind !== 'gib' || body.dead) continue
      if (Math.abs(body.x - unit.x) > reach) continue
      body.dead = true
      unit.heal(unit.maxHp * 0.06 + 8)
      this.vfx.impact(body.x, body.y - 6, 0xc0392b, 0.7, true)
      return
    }
  }

  /** Demolition charges. The body was armed, and whatever killed it is close. */
  private detonateCorpse(unit: Unit): void {
    const power = 40 + unit.def.height * 1.4
    this.vfx.explosion(unit.x, unit.centerY, power * 1.6, 0xffb347, false)
    this.applySplash(unit.x, unit.centerY, power, unit.faction, {
      amount: unit.def.damage * 1.3 + 40,
      type: 'explosive',
      knockback: 320
    })
  }

  /**
   * Salvage. Wreckage that comes to rest is stripped where it lies, which
   * quietly turns a losing engagement into an income stream.
   */
  private handleSalvage(body: Body): void {
    if (body.kind !== 'scrap' && body.kind !== 'shrapnel') return
    for (const faction of ['player', 'enemy'] as Faction[]) {
      if (!this.armyFor(faction).hasTech('salvage')) continue
      // Only what falls on your own half is yours to strip.
      const ownHalf = faction === 'player' ? body.x < this.config.worldWidth / 2 : body.x >= this.config.worldWidth / 2
      if (!ownHalf) continue
      const value = Math.round(12 + body.size * 18)
      this.armyFor(faction).gold += value
      this.statsFor(faction).goldEarned += value
      body.dead = true
      this.vfx.damageNumber(body.x, body.y - 14, value, 0xf2c14e)
      return
    }
  }

  /**
   * Corpse walls. Remains stop shots, so a side that has been losing ground
   * ends up with cover exactly where it needs it.
   */
  /** Which lane's ground line a world y sits closest to. */
  laneAtY(y: number): number {
    let best = 2
    let bestD = Infinity
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const d = Math.abs(y - (this.config.groundY + LANE_Y[lane]))
      if (d < bestD) {
        bestD = d
        best = lane
      }
    }
    return best
  }

  private damageProp(index: number, amount: number): void {
    const prop = this.props[index]
    if (!prop || !prop.alive || amount <= 0) return
    prop.hp -= amount
    if (prop.hp <= 0) {
      prop.alive = false
      prop.diedAt = this.elapsedMs
      const ground = this.config.groundY + LANE_Y[prop.lane]
      // What falls becomes ground: a stump's worth for a tree, a scatter of
      // stone for a well — the first scar tissue of the match.
      this.terrain.addMass(prop.x, prop.lane, PROP_SPECS[prop.kind].mass, this.elapsedMs)
      for (let i = 0; i < PROP_SPECS[prop.kind].chunks; i += 1) {
        this.physics.spawn(
          'rubble',
          prop.x + this.rng.spread(prop.radius),
          ground - prop.blockH * 0.5,
          this.rng.spread(120),
          -this.rng.range(60, 200),
          { size: this.rng.range(0.5, 1), floor: ground }
        )
      }
      this.vfx.impact(prop.x, ground - prop.blockH * 0.5, PROP_SPECS[prop.kind].dust, 1.4, false)
    }
    this.onPropChanged?.(index)
  }

  blockedByRemains(x: number, y: number, faction: Faction): boolean {
    const foe = this.armyFor(OPPOSITE[faction])
    if (!foe.hasTech('corpse_wall')) return false
    for (const body of this.physics.bodies) {
      if (!body.settled || body.dead) continue
      if (body.kind !== 'gib' && body.kind !== 'scrap' && body.kind !== 'rubble') continue
      if (Math.abs(body.x - x) > 7) continue
      if (y < body.y - 16 || y > body.y + 8) continue
      return true
    }
    return false
  }

  /**
   * Sappers, EMP, Aegis and Necropolis. These four need a view of the whole
   * field rather than of one unit, so they run once per sub-step here instead
   * of inside the units themselves.
   */
  private runArmyBehaviours(dtMs: number): void {
    for (const faction of ['player', 'enemy'] as Faction[]) {
      const army = this.armyFor(faction)
      if (army.techs.size === 0) continue
      const dir = ADVANCE_DIR[faction]

      // Sappers: a melee soldier that has been stuck against the front line
      // for a few seconds goes under it and comes up on the far side. It turns
      // a grinding stalemate into a flanking problem for the other player.
      // Bone Harvest: remains on your half pay out for as long as they lie
      // there. The bodies are not consumed — bonepickers and corpse walls
      // still get their material.
      if (army.hasTech('bone_harvest')) {
        let gibs = 0
        for (const body of this.physics.bodies) {
          if (body.kind === 'gib' && body.settled && this.halfOwner(body.x) === faction) gibs += 1
          if (gibs >= 24) break
        }
        if (gibs > 0) {
          const gained = gibs * 0.45 * (dtMs / 1000) + this.boneCarry[faction]
          const whole = Math.floor(gained)
          this.boneCarry[faction] = gained - whole
          if (whole > 0) {
            army.gold += whole
            this.statsFor(faction).goldEarned += whole
          }
        } else {
          this.boneCarry[faction] = 0
        }
      }

      // Autoforge: a turret blown off the wall prints itself back after
      // twenty seconds, at half strength, free of charge.
      if (army.hasTech('autoforge')) {
        const base = this.baseFor(faction)
        base.slots.forEach((slot, slotIndex) => {
          if (slot.def || !slot.wreck) return
          slot.wreck.sinceMs += dtMs
          if (slot.wreck.sinceMs < 20000) return
          const wreckDef = slot.wreck.def
          slot.wreck = undefined
          base.buildTurret(slotIndex, wreckDef.id)
          slot.hp = wreckDef.hp * 0.5
          this.vfx.floatingLabel(base.x, base.y - 220, 'autoforged', '#8fd4ff')
        })
      }

      if (army.hasTech('sappers')) {
        for (const u of this.units) {
          if (u.faction !== faction || !u.alive) continue
          if (u.def.attack.kind !== 'melee' || u.layer !== 'ground') continue
          u.burrowTimer = u.state === 'engage' ? u.burrowTimer + dtMs : 0
          if (u.burrowTimer < 4200) continue
          u.burrowTimer = 0
          const front = this.frontLine(OPPOSITE[faction])
          if (front === null) continue
          this.vfx.footDust(u.x, this.config.groundY)
          u.x = front + dir * 70
          this.vfx.footDust(u.x, this.config.groundY)
        }
      }

      // Aegis: soldiers standing shoulder to shoulder spread what they take.
      if (army.hasTech('aegis')) {
        for (const u of this.units) {
          if (u.faction !== faction || !u.alive) continue
          let neighbours = 0
          for (const o of this.units) {
            if (o === u || o.faction !== faction || !o.alive) continue
            if (Math.abs(o.x - u.x) < u.def.height * 0.9) neighbours += 1
          }
          u.linked = Math.min(3, neighbours)
        }
      }

      // Engineering — machines knit themselves back together, and the Cyborgs
      // extend that to the whole army because they *are* machines.
      if (army.hasTech('nanite_field') || army.ascendedTo === 'cyborgs') {
        const all = army.ascendedTo === 'cyborgs'
        for (const u of this.units) {
          if (u.faction !== faction || !u.alive) continue
          if (!all && !this.isMachine(u)) continue
          u.heal(u.maxHp * 0.012 * (dtMs / 1000))
        }
      }

      // Blight — a soldier that holds still digs in, and heals from ground it
      // has already poisoned.
      if (army.hasTech('rooted') || army.ascendedTo === 'hollow_bloom') {
        for (const u of this.units) {
          if (u.faction !== faction || !u.alive) continue
          u.rooting = u.state === 'engage' ? Math.min(4000, u.rooting + dtMs) : 0
        }
      }
      if (army.hasTech('verdant_tide') || army.ascendedTo === 'hollow_bloom') {
        for (const u of this.units) {
          if (u.faction !== faction || !u.alive) continue
          if (!this.zones.some(z => z.faction === faction && z.kind === 'spore' && Math.abs(z.x - u.x) < z.radius)) continue
          u.heal(u.maxHp * 0.02 * (dtMs / 1000))
        }
      }

      // Necropolis: enough of the dead lying on your own ground and some of
      // them get up again.
      if (army.hasTech('necropolis')) {
        this.necroTimer[faction] -= dtMs
        if (this.necroTimer[faction] <= 0) {
          this.necroTimer[faction] = 4000
          this.tryRaiseDead(faction)
        }
      }
    }
  }

  /** X of the enemy's leading unit, or null if they have none on the field. */
  private frontLine(faction: Faction): number | null {
    let front: number | null = null
    for (const u of this.units) {
      if (u.faction !== faction || !u.alive) continue
      if (front === null) front = u.x
      else front = faction === 'player' ? Math.max(front, u.x) : Math.min(front, u.x)
    }
    return front
  }

  private necroTimer: Record<Faction, number> = { player: 4000, enemy: 4000 }

  /** Consumes a pile of settled remains and returns a soldier to the field. */
  private tryRaiseDead(faction: Faction): void {
    const half = this.config.worldWidth / 2
    const mine: Body[] = []
    for (const b of this.physics.bodies) {
      if (!b.settled || b.dead || b.kind !== 'gib') continue
      if (faction === 'player' ? b.x >= half : b.x < half) continue
      mine.push(b)
    }
    if (mine.length < 12) return
    const army = this.armyFor(faction)
    const roster = rosterForAge(army.age)
    if (roster.length === 0) return
    // The cheapest thing the age can field: what gets up is rabble, not elite.
    const def = roster.reduce((a, b) => (b.cost < a.cost ? b : a))
    const x = mine[0].x
    for (let i = 0; i < 12; i += 1) mine[i].dead = true
    const risen = this.spawnUnit(faction, def, x)
    risen.hp = risen.maxHp * 0.5
    this.vfx.impact(x, this.config.groundY - 20, 0x8fd694, 1.4, true)
  }

  /**
   * Ground effects: fire, contagion, spores.
   *
   * Three creeds all wanted "an area that keeps hurting whatever stands in
   * it", so they share one system rather than each growing their own. A zone
   * is deterministic, ticks on the fixed sub-step, and belongs to the side
   * that made it.
   */
  readonly zones: {
    x: number
    radius: number
    ttl: number
    dps: number
    faction: Faction
    kind: 'fire' | 'plague' | 'spore'
    spread: number
    lane: number
    /** Accumulator for fire consuming the settled dead inside it. */
    burn?: number
    /** Purely visual clock, so a per-tick rule emits an effect occasionally. */
    fx?: number
  }[] = []

  /** Lays down a patch of hostile ground. */
  addZone(
    x: number,
    radius: number,
    ttl: number,
    dps: number,
    faction: Faction,
    kind: 'fire' | 'plague' | 'spore',
    spread = 0,
    lane = -1
  ): void {
    if (this.zones.length > 60) this.zones.shift()
    // lane -1 burns every lane — the shape of an ability rather than a death.
    this.zones.push({ x, radius, ttl, dps, faction, kind, spread, lane })
  }

  private updateZones(dtMs: number): void {
    if (this.zones.length === 0) return
    const dt = dtMs / 1000
    let write = 0
    for (const zone of this.zones) {
      zone.ttl -= dtMs
      // Fire beats growth: a spore zone overlapped by enemy fire burns off
      // several times faster than it would fade. This is the counter-play
      // between the burning creeds and the growing one, fought on the ground
      // itself.
      if (zone.kind === 'spore') {
        for (const fire of this.zones) {
          if (fire.kind !== 'fire' || fire.faction === zone.faction) continue
          if (fire.ttl <= 0) continue
          if (fire.lane !== -1 && zone.lane !== -1 && fire.lane !== zone.lane) continue
          if (Math.abs(fire.x - zone.x) < fire.radius + zone.radius) {
            zone.ttl -= dtMs * 3
            break
          }
        }
      }
      if (zone.ttl <= 0) continue
      // Ashfall and mycelium make their zones creep outward on their own.
      if (zone.spread > 0) zone.radius = Math.min(260, zone.radius + zone.spread * dt)

      // ORDNANCE COUNTERS CARNAGE: fire eats the dead. A burning zone
      // consumes the settled remains inside it — the fuel that bonepickers,
      // corpse walls, necropolis and the harvest all run on — and an
      // ordnance lean stokes the rate. Fire also SCOURS THE HAUNT: the
      // occult's ash-rings burn out of ground a fire crosses.
      if (zone.kind === 'fire') {
        if (zone.lane >= 0 && this.terrain.hauntAt(zone.x, zone.lane) > 0.05) {
          this.terrain.scourHaunt(zone.x, zone.lane, 0.25 * dt)
          zone.fx = (zone.fx ?? 0) + dtMs
          if (zone.fx >= 500) {
            zone.fx = 0
            this.vfx.scour(zone.x, this.config.groundY + LANE_Y[Math.max(0, zone.lane)] - 6)
          }
        }
        // A GROWN GARDEN SMOTHERS EMBERS: wet rot starves flame — but only
        // a garden big enough to matter, and slower than fire burns spores.
        for (const other of this.zones) {
          if (other.kind !== 'spore' || other.faction === zone.faction || other.radius < 110) continue
          if (other.lane !== -1 && zone.lane !== -1 && other.lane !== zone.lane) continue
          if (Math.abs(other.x - zone.x) < other.radius + zone.radius) {
            zone.ttl -= dtMs
            zone.fx = (zone.fx ?? 0) + dtMs
            if (zone.fx >= 600) {
              zone.fx = 0
              this.vfx.smother(zone.x, this.config.groundY + LANE_Y[Math.max(0, zone.lane)] - 6)
            }
            break
          }
        }
        zone.burn = (zone.burn ?? 0) + dtMs
        const stoke = this.leanCache[zone.faction] === 'ordnance' ? 1 + 2 * this.leanPower[zone.faction] : 1
        if (zone.burn >= 800 / stoke) {
          zone.burn = 0
          for (let bi = 0; bi < this.physics.bodies.length; bi += 1) {
            const body = this.physics.bodies[bi]
            if (body.kind !== 'gib' || !body.settled) continue
            if (Math.abs(body.x - zone.x) > zone.radius) continue
            this.physics.bodies.splice(bi, 1)
            this.vfx.impact(body.x, this.config.groundY - 6, 0xff9a40, 0.5, false)
            break
          }
        }
      }

      // THE GARDEN EATS THE DEAD FIRST: spores digest settled remains and
      // GROW on them — blight's answer to the meat engine. Slower than fire
      // (the rot takes its time), and it feeds the zone instead of the void.
      if (zone.kind === 'spore') {
        zone.burn = (zone.burn ?? 0) + dtMs
        if (zone.burn >= 1500) {
          zone.burn = 0
          for (let bi = 0; bi < this.physics.bodies.length; bi += 1) {
            const body = this.physics.bodies[bi]
            if (body.kind !== 'gib' || !body.settled) continue
            if (Math.abs(body.x - zone.x) > zone.radius) continue
            this.physics.bodies.splice(bi, 1)
            zone.ttl = Math.min(zone.ttl + 900, 45000)
            zone.radius = Math.min(260, zone.radius + 2)
            this.vfx.digest(body.x, this.config.groundY - 6)
            break
          }
        }
        // THE CIRCLE TITHES THE GROWTH: hostile spores creeping over haunted
        // ground are drunk by the congregation — the zone withers and the
        // dark ability feeds on it.
        const foe = OPPOSITE[zone.faction]
        if (this.leanCache[foe] === 'occult' && this.terrain.hauntAt(zone.x, Math.max(0, zone.lane)) > 0.3) {
          const power = this.leanPower[foe]
          zone.ttl -= dtMs * 0.5 * power
          const circle = this.armyFor(foe)
          circle.abilityCharge = Math.min(1, circle.abilityCharge + 0.002 * power * dt)
          zone.fx = (zone.fx ?? 0) + dtMs
          if (zone.fx >= 700) {
            zone.fx = 0
            this.vfx.tithe(zone.x, this.config.groundY + LANE_Y[Math.max(0, zone.lane)] - 8)
          }
        }
      }

      // THE GARDEN CLEANSES: your own soldiers standing in your blight shed
      // hostile control — mire, hex and terror drain three times as fast.
      // The blight answers the occult by being somewhere to stand.
      if (zone.kind === 'spore') {
        for (const u of this.units) {
          if (!u.alive || u.faction !== zone.faction || u.layer === 'air') continue
          if (Math.abs(u.x - zone.x) > zone.radius) continue
          if (zone.lane >= 0 && u.lane !== zone.lane) continue
          u.cleansing = true
        }
      }
      // FIELD HYGIENE: engineering work crews smother hostile ground-fires
      // and cut back hostile growth on their own half. Slowly for spores,
      // briskly for fire — sand and shovels beat flame before fungus.
      if (this.leanCache[this.halfOwner(zone.x)] === 'engineering' && zone.faction !== this.halfOwner(zone.x)) {
        const crews = this.leanPower[this.halfOwner(zone.x)]
        if (zone.kind === 'fire') zone.ttl -= dtMs * 1.5 * crews
        else if (zone.kind === 'spore') zone.ttl -= dtMs * 0.75 * crews
      }
      for (const u of this.units) {
        if (!u.alive || u.faction === zone.faction) continue
        if (Math.abs(u.x - zone.x) > zone.radius) continue
        if (u.layer === 'air') continue
        if (zone.lane >= 0 && u.lane !== zone.lane) continue
        this.applyDamage(null, u, { amount: zone.dps * dt, type: zone.kind === 'fire' ? 'explosive' : 'energy', knockback: 0 })
        // Deep Roots turns blighted ground into a bog for anyone else.
        if (zone.kind === 'spore' && this.armyFor(zone.faction).hasTech('deep_roots')) u.mire(220)
      }
      this.zones[write] = zone
      write += 1
    }
    this.zones.length = write
  }

  /** Set by the scene so it can paint what the simulation decided happened. */
  onStain?: (body: Body, x: number, y: number, speed: number, onWall: boolean) => void
  /**
   * A soldier has fallen and stayed down. The scene lays it into the heap
   * where it landed, so the ground a battle has been fought over slowly turns
   * into a rampart of the men who fought it.
   */
  onCorpse?: (unit: Unit) => void
  onSettle?: (body: Body) => void

  /**
   * Researches a behaviour. Routed through here rather than called on the army
   * directly so that a networked match applies it as a command, in tick order,
   * on both peers.
   */
  buyTech(faction: Faction, id: string): boolean {
    const army = this.armyFor(faction)
    const bought = army.buyTech(id as TechId)
    if (bought) {
      const node = TECHS_BY_ID[id]
      this.statsFor(faction).goldSpent += node.cost
      this.refreshLeans()
      this.onTechResearched?.(faction, id)
      if (node.becomes) this.onAscended?.(faction, node.becomes)
    }
    return bought
  }

  onTechResearched?: (faction: Faction, id: TechId) => void
  onAscended?: (faction: Faction, becomes: FactionId) => void

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
      // Owned behaviours change how the simulation runs, so they are part of
      // the fingerprint — packed as a bitmask over a stable order.
      let techBits = 0
      for (let i = 0; i < TECH_ORDER.length; i += 1) {
        if (army.hasTech(TECH_ORDER[i])) techBits |= 1 << i
      }
      mix(techBits)
    }
    mix(this.playerBase.hp * 10)
    mix(this.enemyBase.hp * 10)
    mix(this.units.length)
    for (const u of this.units) {
      if (!u.alive) continue
      mix(u.id)
      mix(u.lane)
      mix(u.x * 10)
      mix(u.y * 10)
      mix(u.hp * 10)
    }
    mix(this.projectiles.length)
    // The ground and what stands on it change outcomes, so they are part of
    // the fingerprint alongside the debris and the stains.
    this.terrain.hash(mix)
    for (const prop of this.props) mix(prop.alive ? Math.round(prop.hp) : -1)
    mix(Math.round(this.quarryBank.player * 100))
    mix(Math.round(this.quarryBank.enemy * 100))
    for (const banner of this.banners) {
      mix(Math.round(banner.hold * 10))
      mix(banner.lane * 8 + (banner.kind === 'gold' ? 0 : banner.kind === 'xp' ? 1 : 2))
    }
    mix(this.physics.hash())
    for (let i = 0; i < this.goreMap.length; i += 1) mix(Math.round(this.goreMap[i] * 20))

    return h >>> 0
  }

  /** One fixed-length slice of simulation. */
  private simulate(dtMs: number): void {
    this.elapsedMs += dtMs
    this.statsByFaction.player.durationMs = this.elapsedMs
    this.statsByFaction.enemy.durationMs = this.elapsedMs
    this.world.speedScale = this.speedScale

    // The siege is read BEFORE income is paid, so a wall full of enemies costs
    // you this tick's gold rather than last tick's.
    this.updateSiege()
    this.tickArmy(this.player, dtMs)
    this.tickArmy(this.enemy, dtMs)

    this.updateUnits(dtMs)
    this.updateProjectiles(dtMs)
    this.updateBanners(dtMs)
    this.updateGround(dtMs)
    this.updateCreedGround(dtMs)
    this.updateUnitSpecials(dtMs)
    this.updateTurrets(dtMs)
    // Debris advances on the same fixed sub-step as everything else, so a
    // corpse lands in the same place on both machines.
    this.physics.step(dtMs)
    this.runArmyBehaviours(dtMs)
    this.updateZones(dtMs)
  }

  /**
   * The ground's own turn: bodies due to decompose become height, and peace
   * heals what war piled up — at the pace of whichever era the world is in,
   * bent by whichever creeds have laid claim to each half.
   */
  /** The war decides how many prizes the field holds and what they pay. */
  private relayoutBanners(): void {
    const era = Math.max(0, Math.min(BANNER_ERAS.length - 1, this.era))
    if (era === this.bannerEra) return
    const old = this.banners.slice()
    this.banners.length = 0
    for (const spec of BANNER_ERAS[era]) {
      const x = this.config.worldWidth * spec.at
      // A flag already flying near this spot keeps its allegiance across the
      // age — armies do not forget who holds a hill just because the war grew.
      let hold = 0
      let bestD = 260
      for (const prev of old) {
        const d = Math.abs(prev.x - x)
        if (d < bestD) {
          bestD = d
          hold = prev.hold
        }
      }
      this.banners.push({ x, lane: spec.lane, kind: spec.kind, hold })
    }
    this.bannerEra = era
  }

  /**
   * Flags flip by presence IN THEIR LANE, pay by ownership, and keep their
   * grip when nobody is near — map control persists until contested. What a
   * held banner pays depends on its kind, and the holder's creed lean adds
   * its signature: carnage rallies the garrison's fury, ordnance uses the
   * flag as a spotting post, engineering strips the prize for more gold,
   * occult tithes every flag to the dark, and blight lets the garrison feed.
   */
  private updateBanners(dtMs: number): void {
    this.relayoutBanners()
    const dt = dtMs / 1000
    const owned: Record<Faction, number> = { player: 0, enemy: 0 }
    for (const unit of this.units) {
      unit.bannerZeal = 0
      unit.bannerReach = 0
    }
    const era = this.bannerEra
    const goldShare = [0.22, 0.17, 0.14, 0.12, 0.1][era] ?? 0.1
    for (const banner of this.banners) {
      let players = 0
      let enemies = 0
      for (const unit of this.units) {
        if (!unit.alive || unit.layer === 'air' || unit.lane !== banner.lane) continue
        const dx = unit.x - banner.x
        if (dx > -130 && dx < 130) {
          if (unit.faction === 'player') players += 1
          else enemies += 1
        }
      }
      if (players > 0 && enemies === 0) {
        banner.hold = Math.min(100, banner.hold + 26 * dt * Math.min(3, players))
      } else if (enemies > 0 && players === 0) {
        banner.hold = Math.max(-100, banner.hold - 26 * dt * Math.min(3, enemies))
      }
      const holder: Faction | null = banner.hold >= 50 ? 'player' : banner.hold <= -50 ? 'enemy' : null
      if (!holder) continue
      owned[holder] += 1
      const army = this.armyFor(holder)
      const lean = this.leanCache[holder]
      const power = this.leanPower[holder]
      // The prize itself.
      if (banner.kind === 'gold') {
        const boost = lean === 'engineering' ? 1 + 0.5 * power : 1
        this.bannerCarry[holder] += army.incomePerSecond * goldShare * boost * dt
      } else if (banner.kind === 'xp') {
        army.xp += army.xpToAdvance * 0.008 * dt
      } else {
        army.abilityCharge = Math.min(1, army.abilityCharge + 0.0045 * dt)
      }
      // The creed's signature on a held flag.
      if (lean === 'occult' && power > 0) {
        army.abilityCharge = Math.min(1, army.abilityCharge + 0.0075 * power * dt)
      }
      // A held flag beats like a drum in its holder's creed colour.
      if (lean && power > 0) {
        this.bannerFx += dtMs
        if (this.bannerFx >= 1400) {
          this.bannerFx = 0
          this.vfx.rally(banner.x, this.config.groundY + LANE_Y[banner.lane] - 10, BRANCH_FX_COLOR[lean] ?? 0xffd66e)
        }
      }
      if ((lean === 'carnage' || lean === 'ordnance' || lean === 'blight') && power > 0) {
        for (const unit of this.units) {
          if (!unit.alive || unit.faction !== holder || unit.lane !== banner.lane) continue
          if (Math.abs(unit.x - banner.x) > 170) continue
          if (lean === 'carnage') unit.bannerZeal = Math.max(unit.bannerZeal, 0.12 * power)
          else if (lean === 'ordnance') unit.bannerReach = Math.max(unit.bannerReach, 0.1 * power)
          else unit.heal(unit.maxHp * 0.012 * power * dt)
        }
      }
    }
    this.bannersOwned = owned
    for (const faction of ['player', 'enemy'] as const) {
      const whole = Math.floor(this.bannerCarry[faction])
      if (whole > 0) {
        this.bannerCarry[faction] -= whole
        this.armyFor(faction).gold += whole
      }
    }
  }

  private updateGround(dtMs: number): void {
    let write = 0
    for (const entry of this.decomposing) {
      if (this.elapsedMs >= entry.dueMs) {
        this.terrain.addMass(entry.x, entry.lane, entry.mass, this.elapsedMs, this.era >= 3 ? 8 : 0)
      } else {
        this.decomposing[write] = entry
        write += 1
      }
    }
    this.decomposing.length = write
    this.terrain.settle(dtMs, this.elapsedMs, this.era, this.creedHealScale)
    if (this.elapsedMs - this.lastViolenceMs > 15000) {
      const dry = halfLifeDecay(dtMs, [20000, 40000, 90000, 200000, 480000][this.era])
      for (let i = 0; i < this.goreMap.length; i += 1) {
        if (this.goreMap[i] === 0) continue
        this.goreMap[i] *= dry
        if (this.goreMap[i] < 0.01) this.goreMap[i] = 0
      }
    }
  }

  /**
   * How each creed bends the healing of one bucket of ground. This is where
   * the five directions stop sharing a battlefield:
   *
   *  - Carnage will not give its mounds back — they are monuments.
   *  - Ordnance craters bitten into the *enemy's* half stay bitten; broken
   *    ground is the whole point of shelling it.
   *  - Engineering fills craters on its own half several times faster —
   *    repair crews — while its mounds barely need help (the quarry eats them).
   *  - Blight ground under a live spore zone does not heal at all; it is not
   *    ground any more.
   */
  private creedHealScale = (lane: number, x: number, height: number): number => {
    const owner = this.halfOwner(x)
    const foe = OPPOSITE[owner]
    if (height > 0) {
      if (this.leanCache[owner] === 'carnage') return 1 + 5 * this.leanPower[owner]
      if (this.leanCache[owner] === 'blight' && this.leanPower[owner] > 0) {
        for (const z of this.zones) {
          if (z.kind !== 'spore' || z.faction !== owner) continue
          if (z.lane !== -1 && z.lane !== lane) continue
          if (Math.abs(z.x - x) < z.radius) return Infinity
        }
      }
    } else if (height < 0) {
      if (this.leanCache[owner] === 'engineering') return Math.max(0.15, 1 - 0.85 * this.leanPower[owner])
      if (this.leanCache[foe] === 'ordnance') return 1 + 4 * this.leanPower[foe]
    }
    return 1
  }

  /**
   * The creeds' standing claims on the field, run on a half-second clock.
   *
   * This is the system that makes the five research directions *play*
   * differently rather than look differently. Each lean turns the living
   * battlefield into a different machine:
   *
   *  - CARNAGE fights from the mounds its killing builds: soldiers standing
   *    on the piled dead swing faster and hit harder.
   *  - ORDNANCE turns its craters into no-man's-land: enemies caught in a
   *    bowl wade, and its shells hit them harder down there.
   *  - ENGINEERING refuses the grit entirely: mounds on its half are quarried
   *    into gold, craters are filled, and its fallen trees and huts are
   *    rebuilt. A clean half *is* its apocalypse.
   *  - OCCULT consumes the dead before they can become ground (handled in the
   *    death path) and curses where they fell: enemies standing on haunted
   *    ground swing softer and walk slower.
   *  - BLIGHT lets its mounds sprout: high ground on its half seeds spore
   *    territory that heals its own (via Verdant Tide) and mires the enemy
   *    (via Deep Roots), and holds the mound beneath it forever.
   *
   * Every number scales with `leanStrength`, so two nodes of dabbling buys a
   * whisper of this and a full creed buys the machine.
   */
  private updateCreedGround(dtMs: number): void {
    this.creedClock -= dtMs
    if (this.creedClock > 0) return
    const interval = 500
    this.creedClock = interval
    this.refreshLeans()

    // Ground conditions on the soldiers themselves. Cleared and re-stamped
    // each pass so stepping off the mound — or off the haunt — ends it.
    for (const u of this.units) {
      if (!u.alive) continue
      u.groundFury = 0
      u.dread = 0
      if (u.layer !== 'ground') continue
      const own = this.leanCache[u.faction]
      const ownPower = this.leanPower[u.faction]

      if (own === 'carnage' && ownPower > 0) {
        const h = this.terrain.heightAt(u.x, u.lane)
        if (h >= 4) u.groundFury = Math.min(1, (h - 3) / 12) * ownPower
      }
      const foe = OPPOSITE[u.faction]
      const foeLean = this.leanCache[foe]
      const foePower = this.leanPower[foe]
      if (foeLean === 'occult' && foePower > 0 && !this.isMachine(u)) {
        const haunt = this.terrain.hauntAt(u.x, u.lane)
        if (haunt > 0.2) u.dread = Math.min(1, haunt) * foePower
      }
      if (foeLean === 'ordnance' && foePower > 0) {
        // Broken ground is hard going: a soldier down in a bowl wades.
        if (this.terrain.heightAt(u.x, u.lane) <= -6) u.mire(interval + 150)
      }
      // THE DEAD BURY THE LINE: against a carnage lean, a soldier that has
      // stood planted long enough for the corpses to pile against it is
      // half-buried — mired, and its roots can sink no deeper. The meat
      // engine's answer to the fortress line that will not move.
      if (foeLean === 'carnage' && foePower > 0 && u.rooting >= 2000) {
        let pile = 0
        for (const body of this.physics.bodies) {
          if (body.kind !== 'gib' || !body.settled) continue
          if (Math.abs(body.x - u.x) <= 42) pile += 1
          if (pile >= 5) break
        }
        if (pile >= 5) {
          u.mire(interval + 150)
          u.rooting = Math.min(u.rooting, 2000)
          // Once per burial, not once per pass: the clods heap up when the
          // pile closes, and again only if the soldier gets free and re-digs.
          if (!u.buriedShown) {
            u.buriedShown = true
            this.vfx.buried(u.x, u.groundLine)
          }
        } else {
          u.buriedShown = false
        }
      }
    }

    for (const faction of ['player', 'enemy'] as Faction[]) {
      const lean = this.leanCache[faction]
      const power = this.leanPower[faction]
      if (!lean || power <= 0) continue

      if (lean === 'engineering') this.runQuarry(faction, power, interval)
      if (lean === 'blight') this.runBloom(faction, power)
    }
  }

  /**
   * Engineering: quarry crews eat the mounds on their own half for parts.
   * The dead are stock, the craters get filled by `creedHealScale`, and the
   * furniture gets rebuilt — the only creed whose half gets *cleaner* as the
   * war goes on, and gets paid for it.
   */
  private runQuarry(faction: Faction, power: number, intervalMs: number): void {
    const mid = this.config.worldWidth / 2
    const from = faction === 'player' ? 0 : Math.ceil(mid / RELIEF_BUCKET)
    const to = faction === 'player' ? Math.floor(mid / RELIEF_BUCKET) : this.terrain.bucketCount
    // Total bite per pass, spread across however many mounds exist.
    let budget = 2.6 * power * (intervalMs / 1000)
    for (let lane = 0; lane < LANE_COUNT && budget > 0; lane += 1) {
      const row = this.terrain.laneRelief(lane)
      for (let i = from; i < to && budget > 0; i += 1) {
        if (row[i] <= 0.5) continue
        // Blight denies the quarry: crews will not dig ground the enemy's
        // growth has claimed. Burn it or fight over it first.
        const bx = i * RELIEF_BUCKET
        const overgrown = this.zones.some(
          z => z.kind === 'spore' && z.faction !== faction && (z.lane === -1 || z.lane === lane) && Math.abs(z.x - bx) < z.radius
        )
        if (overgrown) continue
        const taken = this.terrain.quarry(lane, i, Math.min(budget, 1.2))
        budget -= taken
        this.quarryBank[faction] += taken * 3
      }
    }
    if (this.quarryBank[faction] >= 6) {
      const coins = Math.floor(this.quarryBank[faction])
      this.quarryBank[faction] -= coins
      this.armyFor(faction).gold += coins
      this.statsFor(faction).goldEarned += coins
      const x = faction === 'player' ? mid * 0.5 : mid * 1.5
      this.vfx.floatingLabel(x, this.config.groundY - 40, `+${coins} salvage`, '#8fd0ff')
    }

    // Rebuild crews: a felled tree or hut on the own half is stood back up
    // after half a minute, at partial strength. Cover is a renewable resource
    // for exactly one creed.
    for (let i = 0; i < this.props.length; i += 1) {
      const prop = this.props[i]
      if (prop.alive || this.halfOwner(prop.x) !== faction) continue
      if (this.elapsedMs - prop.diedAt < 30000) continue
      prop.alive = true
      prop.hp = prop.maxHp * 0.6
      this.vfx.impact(prop.x, this.config.groundY + LANE_Y[prop.lane] - prop.blockH * 0.5, 0x8fd0ff, 1.2, false)
      this.onPropChanged?.(i)
    }
  }

  /**
   * Blight: mounds on the own half sprout. High ground made of the dead seeds
   * a spore zone that stays as long as the mound feeds it — and the mound
   * stays as long as the zone shades it. Territory, not terrain.
   */
  private runBloom(faction: Faction, power: number): void {
    this.bloomClock -= 1
    if (this.bloomClock > 0) return
    this.bloomClock = 4 // every 4th creed pass: one sprout scan per 2 seconds
    const mid = this.config.worldWidth / 2
    const from = faction === 'player' ? 0 : Math.ceil(mid / RELIEF_BUCKET)
    const to = faction === 'player' ? Math.floor(mid / RELIEF_BUCKET) : this.terrain.bucketCount
    const spread = this.armyFor(faction).hasTech('mycelium') ? 7 : 0
    let planted = 0
    for (let lane = 0; lane < LANE_COUNT && planted < 2; lane += 1) {
      const row = this.terrain.laneRelief(lane)
      for (let i = from; i < to && planted < 2; i += 1) {
        if (row[i] < 6) continue
        const x = i * RELIEF_BUCKET
        let covered = false
        for (const z of this.zones) {
          if (z.kind !== 'spore' || z.faction !== faction) continue
          if (z.lane !== -1 && z.lane !== lane) continue
          if (Math.abs(z.x - x) < z.radius) {
            covered = true
            break
          }
        }
        if (covered) continue
        this.addZone(x, 30 + 18 * power, 16000, 3 + 4 * power, faction, 'spore', spread, lane)
        planted += 1
      }
    }
  }

  /**
   * The pulsing unit specials: the Thrallmaster's chant, the Mycelic's roots,
   * the Drone Host's fabricator, the Standing Bastion's evergreen stance.
   * Each is the signature of exactly one soldier, which is what makes a path
   * army read as a different game rather than a different palette.
   */
  private updateUnitSpecials(dtMs: number): void {
    for (const u of this.units) {
      if (!u.alive) continue
      const sp = u.def.special
      if (!sp) continue
      if (sp === 'siege_mode') {
        u.rooting = u.state === 'engage' || u.attackCooldown > 0 ? Math.min(4000, u.rooting + dtMs) : Math.max(0, u.rooting - dtMs * 2)
        continue
      }
      if (sp === 'terror') {
        u.pulseTimer -= dtMs
        if (u.pulseTimer <= 0) {
          u.pulseTimer = 600
          for (const e of this.units) {
            if (!e.alive || e.faction === u.faction) continue
            // Fearless steel: a machine has no heart for terror to grip.
            if (Math.abs(e.x - u.x) <= 170 && !this.isMachine(e)) e.terrorFor = 800
          }
        }
        continue
      }
      if (sp === 'stagger_ward') {
        for (const a of this.units) {
          if (!a.alive || a.faction !== u.faction || a === u) continue
          if (Math.abs(a.x - u.x) <= 130) a.stagger = 0
        }
        continue
      }
      if (sp === 'spore_trail') {
        u.pulseTimer -= dtMs
        if (u.pulseTimer <= 0) {
          u.pulseTimer = 1500
          this.addZone(u.x, 34, 4000, 8, u.faction, 'spore', 0, u.lane)
        }
        continue
      }
      if (sp === 'evergreen') {
        const army = this.armyFor(u.faction)
        // Rooted research already grows the whole army's stance; the Bastion
        // only needs its own rule when nothing else provides it.
        if (!army.hasTech('rooted') && army.ascendedTo !== 'hollow_bloom') {
          u.rooting = u.state === 'engage' ? Math.min(4000, u.rooting + dtMs) : 0
        }
        continue
      }
      if (sp !== 'enthrall' && sp !== 'entangle' && sp !== 'fabricate' && sp !== 'summoner') continue
      u.pulseTimer -= dtMs
      if (u.pulseTimer > 0) continue
      if (sp === 'enthrall') {
        u.pulseTimer = 10000
        let caught = 0
        for (const e of this.units) {
          if (!e.alive || e.faction === u.faction || e.layer === 'air') continue
          if (Math.abs(e.x - u.x) <= 200) {
            e.mire(1300)
            caught += 1
          }
        }
        if (caught > 0) this.vfx.impact(u.x, u.centerY, 0xb46bff, 1.3, false)
      } else if (sp === 'entangle') {
        u.pulseTimer = 8000
        let caught = 0
        for (const e of this.units) {
          if (!e.alive || e.faction === u.faction || e.layer === 'air') continue
          if (Math.abs(e.x - u.x) <= 180) {
            e.mire(1100)
            caught += 1
          }
        }
        if (caught > 0) this.vfx.impact(u.x, u.centerY, 0x8fd694, 1.2, false)
      } else {
        // The printing specials: the Drone Host fabricates gnats, the
        // Archmage calls in the shades it is owed. Same clockwork, very
        // different debts.
        const plan = sp === 'fabricate'
          ? { id: 'cy_gnat', cap: 3, everyMs: 7000, glow: 0x8fe8ff }
          : { id: 'dc_shade', cap: 4, everyMs: 9000, glow: 0xb46bff }
        u.pulseTimer = plan.everyMs
        const def = FACTION_UNITS_BY_ID[plan.id]
        if (!def) continue
        const owned = this.units.filter(g => g.alive && g.faction === u.faction && g.def.id === plan.id).length
        if (owned >= plan.cap) continue
        const printed = this.spawnUnit(u.faction, def, u.x + ADVANCE_DIR[u.faction] * 30, u.lane)
        printed.risen = true
        this.vfx.impact(printed.x, printed.y, plan.glow, 1, false)
      }
    }
  }

  /** The world's era: however far EITHER commander has pushed the ages. */
  get era(): number {
    return Math.max(this.player.age, this.enemy.age)
  }

  /**
   * Which direction an army has leant its research — the emergent flavour of
   * its half of the apocalypse. Core nodes belong to everyone and say nothing.
   */
  leanOf(faction: Faction): TechBranchLean {
    const counts: Record<string, number> = {}
    const army = this.armyFor(faction)
    for (const id of army.techs) {
      const branch = TECHS_BY_ID[id]?.branch
      if (!branch || branch === 'core') continue
      counts[branch] = (counts[branch] ?? 0) + 1
    }
    let best: TechBranchLean = null
    let bestN = 1
    for (const [branch, n] of Object.entries(counts)) {
      if (n > bestN) {
        best = branch as TechBranchLean
        bestN = n
      }
    }
    return best
  }

  /**
   * How deep the commitment to the lean runs, 0..1. Two nodes in a direction
   * is a quarter-strength lean; five or more is the full creed. Every ground
   * rule scales with this, which is what keeps the early game clean and makes
   * the late game an expression of the road taken to it.
   */
  leanStrength(faction: Faction): number {
    const lean = this.leanCache[faction]
    if (!lean) return 0
    let n = 0
    for (const id of this.armyFor(faction).techs) {
      if (TECHS_BY_ID[id]?.branch === lean) n += 1
    }
    return Math.min(1, Math.max(0, (n - 1) / 4))
  }

  /**
   * The leans are read every sub-step by damage and death paths, so they are
   * cached and refreshed only when research actually changes — recomputing a
   * tally over the tech set inside applyDamage would be pure waste.
   */
  private leanCache: Record<Faction, TechBranchLean> = { player: null, enemy: null }
  private leanPower: Record<Faction, number> = { player: 0, enemy: 0 }

  private refreshLeans(): void {
    for (const faction of ['player', 'enemy'] as Faction[]) {
      this.leanCache[faction] = this.leanOf(faction)
      this.leanPower[faction] = this.leanStrength(faction)
    }
  }

  /** Which commander's half of the field a point lies on. */
  halfOwner(x: number): Faction {
    return x < this.config.worldWidth / 2 ? 'player' : 'enemy'
  }

  /** How far in front of a fortress its supply yard reaches. */
  private static readonly SIEGE_REACH = 300
  /** Supply cut per point of enemy population standing in the yard. */
  private static readonly SIEGE_PER_POP = 0.07
  /** However bad it gets, something still comes in. */
  private static readonly SIEGE_MAX = 0.7

  /**
   * Besieged supply.
   *
   * Reaching a fortress used to be worth only the damage you did to it, which
   * made ignoring a lane nearly free — you could walk past a defence, sit on
   * the wall, and the defender's economy never noticed. Now anything standing
   * in the defender's yard cuts their income while it stands there, weighted
   * by how much of the field it takes up. Lane coverage stops being optional
   * and becomes the cheapest economic decision on the board.
   *
   * It scales by population rather than headcount so a colossus in your yard
   * is the crisis it looks like, and a lone scout is a nuisance.
   */
  private updateSiege(): void {
    const reach = Battlefield.SIEGE_REACH
    let onPlayer = 0
    let onEnemy = 0
    for (const unit of this.units) {
      if (!unit.alive) continue
      if (unit.faction === 'enemy') {
        if (unit.x < this.playerBase.x + reach) onPlayer += unit.def.pop
      } else if (unit.x > this.enemyBase.x - reach) onEnemy += unit.def.pop
    }
    const cut = (pop: number): number =>
      pop <= 0 ? 0 : Math.min(Battlefield.SIEGE_MAX, pop * Battlefield.SIEGE_PER_POP)
    this.player.siege = cut(onPlayer)
    this.enemy.siege = cut(onEnemy)
  }

  private tickArmy(army: Army, dtMs: number): void {
    const before = army.gold
    const { ready } = army.tick(dtMs)
    this.statsFor(army.faction).goldEarned += Math.max(0, army.gold - before)
    for (const entry of ready) {
      // Blood Pact bought the time with the fortress's own health. It is a
      // real cost: rushing the whole match will kill you without a shot fired.
      if (army.instantBuild) {
        const base = this.baseFor(army.faction)
        base.hp = Math.max(1, base.hp - entry.def.buildMs * 0.045)
      }
      // The quantity paths' chaff arrives in squads: one card, several
      // soldiers, staggered a step apart so they walk out as a file.
      const copies = entry.def.squad ?? 1
      for (let c = 0; c < copies; c += 1) {
        const unit = this.spawnUnit(army.faction, entry.def, undefined, entry.lane)
        if (copies > 1) unit.x -= ADVANCE_DIR[army.faction] * c * 14
      }
    }
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
    // Deeds only ever go one way, so that a demand once met stays met.
    for (const [army, count, base] of [
      [this.player, playerUnits.length, this.playerBase],
      [this.enemy, enemyUnits.length, this.enemyBase]
    ] as const) {
      army.deeds.peakArmy = Math.max(army.deeds.peakArmy, count)
      army.deeds.goldEarned = this.statsFor(army.faction).goldEarned
      army.deeds.baseHeld = Math.min(army.deeds.baseHeld, (base.hp / base.maxHp) * 100)
    }

    // Each lane runs the whole one-dimensional fight — frontage, press,
    // blocking — on its own. The lanes only touch through the fixed cross-lane
    // rules in pickTarget, which is the entire chess of it.
    const split = (flat: Unit[]): { lanes: Unit[][]; air: Unit[] } => {
      const lanes: Unit[][] = Array.from({ length: LANE_COUNT }, () => [])
      const air: Unit[] = []
      for (const u of flat) (u.layer === 'air' ? air : lanes[u.lane]).push(u)
      return { lanes, air }
    }
    const player = split(playerUnits)
    const enemy = split(enemyUnits)

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      this.applyAuras(player.lanes[lane], enemy.lanes[lane])
      this.stepSide(player.lanes[lane], enemy.lanes, enemy.air, this.enemyBase, dtMs)
      this.stepSide(enemy.lanes[lane], player.lanes, player.air, this.playerBase, dtMs)
    }
    // Air rides above the lanes: it queues against nothing and sees everything.
    this.stepSide(player.air, enemy.lanes, enemy.air, this.enemyBase, dtMs)
    this.stepSide(enemy.air, player.lanes, player.air, this.playerBase, dtMs)
  }

  /**
   * The knight's move. A blocked flanker asked for a way around: give it the
   * adjacent lane with the fewest enemies, provided nothing hostile stands in
   * that lane within the stretch it is about to cross. Fixed rule, fixed
   * numbers, simulation state only — both peers move the same piece.
   */
  private handleFlank = (unit: Unit): void => {
    const options: { lane: number; enemies: number }[] = []
    for (const lane of [unit.lane - 1, unit.lane + 1]) {
      if (lane < 0 || lane >= LANE_COUNT) continue
      let ahead = 0
      let total = 0
      for (const u of this.units) {
        if (!u.alive || u.faction === unit.faction || u.layer === 'air' || u.lane !== lane) continue
        total += 1
        const dx = (u.x - unit.x) * unit.dir
        if (dx > -20 && dx < 260) ahead += 1
      }
      if (ahead === 0) options.push({ lane, enemies: total })
    }
    if (options.length === 0) return
    options.sort((a, b) => a.enemies - b.enemies || a.lane - b.lane)
    unit.setLane(options[0].lane)
  }

  /**
   * Aegis-style auras grant nearby allies flat damage reduction. A unit may
   * carry one as a property and still fight; the older form, where the aura
   * occupied the attack slot, is still honoured.
   */
  private applyAuras(playerUnits: Unit[], enemyUnits: Unit[]): void {
    for (const group of [playerUnits, enemyUnits]) {
      const emitters = group.filter(u => auraOf(u.def) !== null)
      for (const u of group) {
        let best = 0
        for (const e of emitters) {
          const aura = auraOf(e.def)
          if (!aura) continue
          if (Math.abs(e.x - u.x) <= aura.radius) best = Math.max(best, aura.damageReduction)
        }
        u.auraShield = best
        u.setAuraVisual(best > 0)
      }
    }
  }

  private stepSide(
    units: Unit[],
    enemyLanes: Unit[][],
    enemyAir: Unit[],
    enemyBase: Base,
    dtMs: number
  ): void {
    const dir = units.length > 0 ? ADVANCE_DIR[units[0].faction] : 1
    // Walk the sorted list from the front so each unit knows who is ahead of it.
    const order = dir === 1 ? [...units].reverse() : units
    let aheadX: number | null = null

    for (let i = 0; i < order.length; i += 1) {
      const unit = order[i]
      // The weight of the press. Only the front rank of a column can physically
      // reach the enemy, so a melee squad otherwise delivers the damage of one
      // man however many you bought, while every soldier in a ranged squad
      // shoots. The ranks crowding up behind a fighter put their shoulders into
      // the blow, which is what makes buying the second twenty worth anything.
      let support = 0
      const cap = unit.def.conduct === 'swarm' ? MAX_PRESS + 2 : MAX_PRESS
      for (let j = i + 1; j < order.length && support < cap; j += 1) {
        if (Math.abs(order[j].x - unit.x) > PRESS_REACH) break
        support += 1
      }
      unit.press = 1 + support * (unit.techs?.has('iron_line') ? PRESS_BONUS + 0.15 : PRESS_BONUS)
      const blocker = unit.layer === 'air' ? null : aheadX
      if (unit.def.flanker) {
        // An open file ahead is a road: raiders ride it a third faster.
        let clear = true
        for (const foe of enemyLanes[unit.lane]) {
          const dx = (foe.x - unit.x) * dir
          if (dx > -40 && dx < 360) {
            clear = false
            break
          }
        }
        unit.raiding = clear
      }
      const target = this.pickTarget(unit, enemyLanes, enemyAir, enemyBase)
      unit.update(dtMs, blocker, target)
      if (unit.layer === 'ground' && unit.alive) {
        aheadX = unit.x - dir * (unit.radius + 2)
      }
    }
  }

  /**
   * THE RULEBOOK — one unified counter web across unit, tech and position.
   * Every piece sees the board a fixed way; every strength has a documented
   * answer, and most have two. This comment is the design contract:
   *
   * Vision (position):
   *  - melee and tanks fight their own file, full stop;
   *  - shooters spill to the next file at 1/2 damage only when theirs is
   *    empty — and two files over at 1/3 with Plunging Volleys;
   *  - siege bombards whichever file is thickest, minimum range inside;
   *  - aircraft ignore files in both directions; the fortress ends them all.
   *
   * Conducts (unit):        strong into            answered by
   *  - SWARM  (tight+deep)  anything 3x its price  bombard, cleave, splash
   *  - PHALANX (intercept)  flankers, cavalry      shooters, bombard
   *  - SCREEN (taunt)       hunters, gun lines     bombard, air, swarms
   *  - HUNT  (kill weakest) healers, crews, siege  screens, phalanx walls
   *  - FLANK (knight move)  bombard/spill files    phalanx, a held wide file
   *  - SPILL (support fire) the file next door     flank into the empty file
   *  - BOMBARD (densest)    stacked files          spread files, flank, air
   *  - FLIGHT (no files)    everything grounded    pierce/energy hitsAir
   *
   * Doctrines (tech): Phalanx Doctrine sharpens interception ×2.1; Pack
   * Tactics cuts a flanker's patience to half a second; Iron Line deepens
   * the press and shrugs light stagger; Plunging Volleys buys the third
   * file at a third strength. Each doctrine strengthens one edge of the
   * web and none of them removes a counter.
   */
  private pickTarget(unit: Unit, enemyLanes: Unit[][], enemyAir: Unit[], enemyBase: Base): Damageable | null {
    unit.crossLaneShot = 0
    const attack = unit.def.attack
    const melee = attack.kind === 'melee'
    const flying = unit.layer === 'air'
    const siege = unit.def.role === 'siege'

    const gather = (list: readonly Damageable[], out: { target: Damageable; dist: number }[]): void => {
      for (const c of list) {
        if (!unit.canTarget(c)) continue
        const dist = unit.distanceTo(c)
        if (dist > unit.reach || dist < unit.minReach) continue
        out.push({ target: c, dist })
      }
    }

    const pickFrom = (pool: { target: Damageable; dist: number }[]): Damageable => {
      // A screen's whole purpose is to be dealt with first: while one stands
      // in the pool, everything that is not a shell or a wing must cut it
      // down before touching what it protects. Bombardment and aircraft
      // ignoring the taunt is the counter to the screen itself.
      if (!siege && !flying) {
        const screens = pool.filter(e => e.target instanceof Unit && e.target.def.conduct === 'screen')
        if (screens.length > 0) pool = screens
      }
      // A hunter ignores the nearest man and opens the softest one in reach —
      // rear-lane healers and gun crews stop being safe by geometry alone.
      if (unit.def.conduct === 'hunt') {
        pool.sort((a, b) => {
          const ha = a.target instanceof Unit ? a.target.hp / a.target.maxHp : 2
          const hb = b.target instanceof Unit ? b.target.hp / b.target.maxHp : 2
          return ha - hb || a.dist - b.dist
        })
        return pool[0].target
      }
      pool.sort((a, b) => a.dist - b.dist)
      // Shooters spread their fire across the front of the enemy formation
      // instead of every one of them deleting the same man; which of the
      // front few a soldier picks comes from its spawn order, so it is
      // spread but not random, and both peers pick the same one.
      const spread = melee ? 1 : Math.min(FIRE_SPREAD, pool.length)
      return pool[unit.seq % spread].target
    }

    const own: { target: Damageable; dist: number }[] = []
    if (siege || flying) {
      // Bombardment: the thickest lane in reach eats the shell.
      let best: { target: Damageable; dist: number }[] = []
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const pool: { target: Damageable; dist: number }[] = []
        gather(enemyLanes[lane], pool)
        if (pool.length > best.length || (pool.length === best.length && lane === unit.lane && pool.length > 0)) {
          if (pool.length > 0) best = pool
        }
      }
      gather(enemyAir, best)
      gather([enemyBase], best)
      if (best.length > 0) return pickFrom(best)
    } else {
      gather(enemyLanes[unit.lane], own)
      if (!melee) gather(enemyAir, own)
      gather([enemyBase], own)
      if (own.length > 0) return pickFrom(own)
      if (!melee) {
        // Spill into the lane next door, at a price. A gun line can help its
        // neighbour, but it can never hold two lanes for the cost of one.
        const spill: { target: Damageable; dist: number }[] = []
        for (const lane of [unit.lane - 1, unit.lane + 1]) {
          if (lane >= 0 && lane < LANE_COUNT) gather(enemyLanes[lane], spill)
        }
        if (spill.length > 0) {
          unit.crossLaneShot = 1
          return pickFrom(spill)
        }
        // Plunging Volleys: arcing fire reaches two files over, at a third
        // strength — bought, not given, and the price never disappears.
        if (unit.techs?.has('plunging_volleys')) {
          const plunge: { target: Damageable; dist: number }[] = []
          for (const lane of [unit.lane - 2, unit.lane + 2]) {
            if (lane >= 0 && lane < LANE_COUNT) gather(enemyLanes[lane], plunge)
          }
          if (plunge.length > 0) {
            unit.crossLaneShot = 2
            return pickFrom(plunge)
          }
        }
      }
    }

    // Nothing in range: keep the nearest enemy anywhere as an aim reference.
    let nearest: Damageable | null = null
    let nearestDist = Infinity
    const consider = (c: Damageable): void => {
      if (!unit.canTarget(c)) return
      const dist = unit.distanceTo(c)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = c
      }
    }
    for (const laneUnits of enemyLanes) for (const c of laneUnits) consider(c)
    for (const c of enemyAir) consider(c)
    consider(enemyBase)
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
      // Corpse walls stop a shot in flight. Checked before the hit test so a
      // pile of the dead genuinely shields whatever stands behind it.
      if (this.blockedByRemains(p.x, p.y, p.faction)) {
        this.vfx.impact(p.x, p.y, 0x7a1216, 0.8, true)
        p.destroy()
        continue
      }
      // The ground the war has built stops shots the flat field never did: a
      // mound of the dead is cover for whoever stands behind it.
      const lane = p.config.lane ?? 2
      const groundLine = this.config.groundY + LANE_Y[lane]
      if (this.terrain.blocksShot(p.x, lane, groundLine - p.y)) {
        this.vfx.impact(p.x, p.y, 0x6b5a42, 0.9, false)
        p.destroy()
        continue
      }
      // Standing timber and huts take the hit meant for the man behind them.
      let struckProp = false
      for (let i = 0; i < this.props.length; i += 1) {
        const prop = this.props[i]
        if (!prop.alive || prop.lane !== lane) continue
        if (Math.abs(p.x - prop.x) > prop.radius) continue
        if (p.y < groundLine - prop.blockH) continue
        this.damageProp(i, p.config.damage)
        this.vfx.impact(p.x, p.y, prop.kind === 'tree' ? 0x5c7a3a : 0xa89880, 0.9, false)
        p.destroy()
        struckProp = true
        break
      }
      if (struckProp) continue
      {
        // Mounds are cover: shots collide with the piled dead. Only serious
        // relief (12+) blocks — a shin-high hump never eats a musket ball.
        const shotLane = p.config.lane ?? this.laneAtY(p.y)
        const rise = this.terrain.heightAt(p.x, shotLane)
        // 1.5×: the wall the shot hits is the wall the player SEES drawn.
        p.setMoundRise(rise >= 12 ? rise * 1.5 : 0)
      }
      const result = p.update(dtMs, candidates)
      if (result.hit) {
        this.resolveProjectileHit(p, result.hit)
        // A penetrator reports its hit and keeps flying into the next body.
        if (!result.done) remaining.push(p)
      } else if (!result.done) {
        remaining.push(p)
      } else if (p.config.splash && p.config.splash > 0) {
        // Ground detonation still hurts anything nearby.
        this.applySplash(p.x, p.y, p.config.splash, p.faction, {
          amount: p.config.damage,
          type: p.config.damageType,
          knockback: p.config.knockback,
          bonusVs: p.config.bonusVs
        }, p.config.owner ?? null)
        this.dropImpactSpecial(p)
      }
    }
    this.projectiles = remaining
  }

  /** What a path unit's shot leaves on the ground where it lands. */
  private dropImpactSpecial(p: Projectile): void {
    const owner = p.config.owner
    if (!(owner instanceof Unit)) return
    const lane = p.config.lane ?? this.laneAtY(p.y)
    switch (owner.def.special) {
      case 'incendiary_shot':
        this.addZone(p.x, 42, 3000, 22, p.faction, 'fire', 0, lane)
        break
      case 'plague_shot':
        this.addZone(p.x, 46, 3500, 18, p.faction, 'plague', 0, lane)
        break
      case 'spore_shot':
        this.addZone(p.x, 36, 3500, 6, p.faction, 'spore', 0, lane)
        break
      case 'seed_shot':
        // The Titan Bloom's fruit sometimes takes root where it bursts.
        if (this.rng.chance(0.3)) {
          const def = FACTION_UNITS_BY_ID['hb_sporeling']
          if (def) {
            const grown = this.spawnUnit(p.faction, def, p.x, lane)
            grown.hp = grown.maxHp * 0.7
            this.vfx.impact(p.x, this.config.groundY + LANE_Y[lane] - 12, 0x8fd694, 1.1, false)
          }
        }
        break
    }
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
      this.applySplash(p.x, p.y, p.config.splash, p.faction, event, p.config.owner ?? null)
    } else {
      this.applyDamage(p.config.owner ?? null, target, event)
      const sfx: SfxName = p.config.damageType === 'energy' ? 'plasma' : 'arrow_hit'
      audio.play(sfx, 0.35)
    }
    this.dropImpactSpecial(p)
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

  /**
   * Stamps the owning army's researched behaviours onto a shot. Every
   * projectile in the game goes through here, so a tech applies to unit fire,
   * turret fire and abilities alike without each call site knowing about it.
   */
  private equipProjectile(p: Projectile): Projectile {
    const army = this.armyFor(p.faction)
    p.wind = this.physics.wind
    // Ricochet is for solid shot. A rocket does not skip off armour — it
    // detonates on it — and letting explosive rounds deflect quietly turned
    // this tech into a way to disarm your own launchers against structures.
    if (army.hasTech('ricochet') && p.config.damageType !== 'explosive') p.ricochets = 2
    const shooterSpecial = p.config.owner instanceof Unit ? p.config.owner.def.special : undefined
    if (army.hasTech('penetrator') || shooterSpecial === 'penetrator_shot') p.penetration = 1
    if ((army.hasTech('cluster') || shooterSpecial === 'cluster_shot') && p.config.gravity > 0) {
      p.cluster = true
      p.onSplit = parent => this.splitCluster(parent)
    }
    this.projectiles.push(p)
    return p
  }

  /** A cluster shell coming apart at the top of its arc. */
  private splitCluster(parent: Projectile): void {
    for (let i = -1; i <= 1; i += 2) {
      const child = new Projectile(
        this.scene,
        {
          ...parent.config,
          x: parent.x,
          y: parent.y,
          vx: parent.vx * 0.7 + i * 90,
          vy: parent.vy - 40,
          damage: parent.config.damage * 0.5,
          splash: (parent.config.splash ?? 0) * 0.7
        },
        this.config.groundY,
        this.vfx
      )
      // Children do not split again, or one shell becomes an artillery barrage.
      child.ricochets = parent.ricochets
      this.projectiles.push(child)
    }
  }

  spawnUnit(faction: Faction, def: UnitDef, atX?: number, lane = 2): Unit {
    // Doctrine morphs derive defs at runtime, so the sprite for this one may
    // not have been drawn yet. Cosmetic only — it cannot move the hash.
    ensureUnitArt(this.scene, def)
    const base = this.baseFor(faction)
    const dir = ADVANCE_DIR[faction]
    const spawnX = atX ?? base.x + dir * (base.radius + 30)

    const unit = new Unit(this.scene, def, faction, spawnX, this.world, this.rng.spread(26), lane)
    const army = this.armyFor(faction)
    unit.hp *= army.modifiers.unitHp
    unit.maxHp *= army.modifiers.unitHp
    unit.speedMult = army.modifiers.unitSpeed
    unit.rangeMult = army.modifiers.unitRange
    unit.toughness = army.modifiers.toughness

    unit.techs = army.techs
    unit.onFire = this.handleUnitFire
    unit.onHealPulse = this.handleHealPulse
    unit.onDeath = this.handleUnitDeath

    this.units.push(unit)
    // Spawn order within *this* match, not the global counter. The menu parade
    // builds units too, so a peer that lingered on the menu would carry a
    // different id for the same soldier — and anything keyed on that id would
    // then diverge across the wire.
    unit.seq = this.spawnSeq
    this.spawnSeq += 1
    // Stand the soldier somewhere on the width of the battle path.
    // Deterministic from spawn order, so both peers stage every man alike.
    unit.setStage(unit.layer === 'ground' ? ((unit.seq * 2654435761) >>> 0) % 13 : 0)
    const stats = this.statsFor(faction)
    stats.unitsBuilt += 1
    stats.goldSpent += def.cost
    army.deeds.built += 1
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

  /**
   * The heaviest shove a melee attacker can land and still keep up with its
   * target, expressed in the same units as `AttackSpec.knockback`. Heavier
   * blows are still felt as damage and stagger — they just do not turn a fight
   * into a foot race the attacker cannot win.
   */
  private reachableShove(unit: Unit, target: Damageable): number {
    const speed = unit.def.speed * unit.speedMult * this.armyFor(unit.faction).modifiers.unitSpeed
    const mass = target instanceof Unit ? Math.max(0.4, target.def.mass) : 6
    // A quarter of what the attacker could chase down, not all of it. Shoving a
    // target the full distance you can walk means re-closing after every blow,
    // and the attack uptime that costs is most of what a melee unit has.
    return (speed * mass * 0.28) / 1.6
  }

  private handleUnitFire = (unit: Unit, target: Damageable): void => {
    const attack = unit.def.attack
    const army = this.armyFor(unit.faction)
    const damage =
      unit.def.damage *
      unit.damageMult *
      army.modifiers.unitDamage *
      this.escalation *
      // Full strength in your own file, half next door, a third two over —
      // supporting fire, never coverage of two lanes for the price of one.
      CROSS_LANE_DAMAGE[unit.crossLaneShot] *
      // The ground rules: a carnage soldier hits harder from its mound, and
      // anyone hits softer from the occult's haunted ground.
      (1 + 0.18 * unit.groundFury) *
      (1 - 0.15 * unit.dread) *
      // An Acolyte's dying curse hangs on whoever struck it down.
      (unit.cursedFor > 0 ? 0.8 : 1)
    const sfx = WEAPON_SFX[unit.def.visual.weapon] ?? 'melee_light'

    if (attack.kind === 'melee') {
      audio.play(sfx, 0.4)
      // Braced spears read a charge before it lands: a phalanx striking a
      // flanker hits half again as hard, and drilled to doctrine, double.
      // This is the counter that keeps the knight's move honest.
      // Strong enough that the matchup is a verdict, not a coin flip: a
      // charge into set spears loses, every time, at equal gold.
      const intercept =
        unit.def.conduct === 'phalanx' && target instanceof Unit && target.def.flanker
          ? unit.techs?.has('phalanx_doctrine')
            ? 2.4
            : 1.85
          : 1
      // Mobbing: a swarm dragging down something three times its price hits
      // a third harder — the many beat the one, and the answer to the many
      // is cleave, splash and bombardment, never a bigger single blade.
      // Price is per SOLDIER: a squad card carries the whole squad's cost,
      // and comparing card price to card price silently disarmed the bonus
      // for exactly the chaff it exists for.
      const mob =
        unit.def.conduct === 'swarm' &&
        target instanceof Unit &&
        target.def.cost / (target.def.squad ?? 1) >= (unit.def.cost / (unit.def.squad ?? 1)) * 3
          ? 1.6
          : 1
      // Backstab: a flanker reaching a soldier whose attention is already
      // spent on someone else hits a quarter harder. This is the payoff the
      // knight's move is riding for — and why a screen that *turns* to face
      // the charge, or a phalanx that reads it, takes that payoff away.
      const backstab =
        unit.def.flanker && target instanceof Unit && target.target !== null && target.target !== unit ? 1.25 : 1
      // The Detonant does not fight. It arrives.
      if (unit.def.special === 'kamikaze') {
        this.applySplash(target.x, target.y + target.centerOffsetY, 140, unit.faction, {
          amount: 320,
          type: 'explosive',
          knockback: 300
        }, unit)
        unit.kill()
        return
      }
      const charged = unit.def.special === 'charge' && unit.chargeReady ? 1.8 : 1
      if (charged > 1) unit.chargeReady = false
      const event: DamageEvent = {
        amount: damage * unit.press * intercept * mob * backstab * charged,
        type: unit.def.damageType,
        // You cannot shove a man further than you can follow him. Without this
        // a melee line knocks its own target out of its own reach on every
        // blow and spends the fight chasing, landing one hit per pursuit while
        // being shot the whole way — twenty clubmen drove nineteen slingers
        // three hundred pixels backwards and lost.
        knockback: Math.min(attack.knockback, this.reachableShove(unit, target)),
        crit: unit.def.crit,
        bonusVs: unit.def.bonusVs
      }
      if (attack.splash && attack.splash > 0) {
        this.applySplash(target.x, target.y + target.centerOffsetY, attack.splash, unit.faction, event, unit, unit.lane)
      } else {
        this.applyDamage(unit, target, event)
      }
      // The Pyre Knight's blows set the ground itself alight.
      if (unit.def.special === 'scorch_touch') {
        this.addZone(target.x, 38, 2000, 14, unit.faction, 'fire', 0, target instanceof Unit ? target.lane : unit.lane)
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
          : datan2(dy, dx)
      const spread = this.rng.spread(attack.spread * this.accuracyPenalty(unit.faction))
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
        // Brass. Purely texture, but a firing line that leaves nothing behind
        // reads as a line of statues.
        this.physics.spawn(
          'casing',
          muzzle.x,
          muzzle.y,
          -unit.dir * this.rng.range(40, 130),
          -this.rng.range(60, 170),
          { spin: this.rng.spread(24), size: 0.7 }
        )
      }

      this.equipProjectile(
        new Projectile(
          this.scene,
          {
            faction: unit.faction,
            projectile: attack.projectile,
            x: muzzle.x,
            y: muzzle.y,
            vx: dcos(finalAngle) * attack.speed,
            vy: dsin(finalAngle) * attack.speed,
            gravity: attack.gravity,
            damage,
            damageType: unit.def.damageType,
            knockback: attack.knockback,
            splash: attack.splash,
            homing: attack.homing,
            target,
            hitsAir: unit.def.hitsAir ?? false,
            owner: unit,
            lane: target instanceof Unit ? target.lane : unit.lane,
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
    // Full strength in the healer's own lane, half across the boundary — the
    // same shape as spill fire, so support placement is a real decision too.
    const share = (u: Unit): number => (u.layer === 'air' || u.lane === unit.lane ? 1 : 0.5)
    if (wounded.length === 0) return

    audio.play('heal', 0.35)
    this.vfx.healPulse(unit.x, unit.centerY, attack.radius)
    if (unit.def.special === 'bog_pulse') {
      for (const e of this.units) {
        if (!e.alive || e.faction === unit.faction || e.layer === 'air') continue
        if (Math.abs(e.x - unit.x) <= attack.radius) e.mire(800)
      }
    }
    // Three targets per pulse: enough that a healer pays for the body it costs
    // you, not so many that a pair of them makes the front line unkillable.
    wounded
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, 3)
      .forEach(ally => ally.heal(attack.amount * share(ally)))
    unit.markHealPulse()
  }

  private handleUnitDeath = (unit: Unit, killer?: Damageable): void => {
    const winner = OPPOSITE[unit.faction]
    // Veterancy is credited to the soldier that actually landed the blow, not
    // to the side — the point is that this one is now worth pulling back.
    if (killer instanceof Unit && killer.alive && killer.faction === winner) killer.creditKill()
    const spoils = this.armyFor(winner).modifiers.bounty
    this.armyFor(winner).rewardKill(unit.def.bounty * spoils, unit.def.xp * spoils)
    this.statsFor(winner).kills += 1
    this.statsFor(winner).goldEarned += unit.def.bounty
    this.statsFor(unit.faction).unitsLost += 1
    this.armyFor(winner).deeds.kills += 1
    this.armyFor(unit.faction).deeds.losses += 1
    this.vfx.floatingLabel(unit.x, unit.centerY - unit.def.height * 0.4, `+${unit.def.bounty}`, '#f2c14e')
    audio.play('coin', 0.25)
    this.onUnitKilled?.(winner)
    this.onCorpse?.(unit)
    // The body starts its way into the ground. Early-age dead are soil in
    // seconds; the late ages leave more mass and take far longer to settle.
    // What the ground *does* with the body depends on whose half it fell on:
    // a carnage half renders it down fast and keeps most of it — mounds are
    // the point — while an occult half consumes it almost entirely, feeding
    // the dark ability and leaving haunted ground where a mound would rise.
    if (unit.layer === 'ground') {
      const age = unit.def.age
      const half = this.halfOwner(unit.x)
      const halfLean = this.leanCache[half]
      const halfPower = this.leanPower[half]
      let mass = unit.def.height * (0.055 + age * 0.02)
      let delay = [9000, 14000, 21000, 30000, 40000][age]
      if (halfLean === 'carnage') {
        mass *= 1 + 0.6 * halfPower
        delay *= 1 - 0.45 * halfPower
      } else if (halfLean === 'occult' && halfPower > 0) {
        mass *= 1 - 0.8 * halfPower
        delay *= 0.5
        const occult = this.armyFor(half)
        occult.abilityCharge = Math.min(1, occult.abilityCharge + 0.02 + 0.02 * halfPower)
        this.terrain.addHaunt(unit.x, unit.lane, 0.3 + 0.3 * halfPower, this.elapsedMs)
        this.vfx.impact(unit.x, this.config.groundY + LANE_Y[unit.lane] - 16, 0xb46bff, 0.8, false)
      }
      this.decomposing.push({ x: unit.x, lane: unit.lane, mass, dueMs: this.elapsedMs + delay })
    }
    // THE BANISHMENT: a congregation of the occult (a lean) takes the soul
    // as its tithe — a body it killed cannot rise again, for anyone, and it
    // comes apart into half the usable remains.
    if (this.leanCache[winner] === 'occult') {
      unit.banished = true
      this.vfx.banish(unit.x, unit.centerY)
    }
    // DROWN THE GARDEN: a carnage-lean kill inside hostile blight splatters
    // enough blood to scald the growth back. Fight IN the zones to clear them.
    if (this.leanCache[winner] === 'carnage') {
      for (const zone of this.zones) {
        if (zone.kind !== 'spore' || zone.faction === winner) continue
        if (zone.lane >= 0 && zone.lane !== unit.lane) continue
        if (Math.abs(zone.x - unit.x) > zone.radius) continue
        zone.radius -= 16
        if (zone.radius < 16) zone.ttl = 0
        this.vfx.impact(unit.x, this.config.groundY + LANE_Y[unit.lane] - 10, 0xa03830, 0.8, false)
        this.vfx.smother(unit.x, this.config.groundY + LANE_Y[unit.lane] - 6)
        break
      }
    }
    this.applyDeathDoctrines(unit, winner, killer)
  }

  /**
   * Everything that happens *because* something died. Kept in one place: half
   * the research tree hooks in here, and scattering it through the death path
   * would make the interactions between creeds impossible to see.
   */
  private applyDeathDoctrines(unit: Unit, winner: Faction, slayer?: Damageable): void {
    const killer = this.armyFor(winner)
    const owner = this.armyFor(unit.faction)
    const groundY = this.config.groundY

    // Carnage — the killer poisons the ground where the body fell.
    if (killer.hasTech('plague_wind')) {
      this.addZone(unit.x, 70, 6000, 26, winner, 'plague', 0, unit.lane)
    }
    // Cinder Host doctrine, and Incendiary before it: bodies burn where they land.
    if (killer.ascendedTo === 'cinder_host' || (killer.hasTech('incendiary') && killer.hasTech('ashfall'))) {
      this.addZone(unit.x, 60, 5200, 40, winner, 'fire', killer.hasTech('ashfall') ? 16 : 0, unit.lane)
    }
    // Blight — the dead burst, and their own side's ground spreads.
    if (owner.hasTech('spore_cloud')) {
      this.addZone(unit.x, 72, 8000, 20, unit.faction, 'spore', owner.hasTech('mycelium') ? 10 : 0)
    }
    // Contagion: anything that dies standing in blight bursts as well,
    // whichever side it fought for — the blight does not ask whose body it is.
    for (const holderFaction of ['player', 'enemy'] as Faction[]) {
      const holder = this.armyFor(holderFaction)
      if (!holder.hasTech('contagion')) continue
      const inBlight = this.zones.some(
        z =>
          z.faction === holderFaction &&
          z.kind === 'spore' &&
          Math.abs(z.x - unit.x) < z.radius &&
          (z.lane === -1 || z.lane === unit.lane)
      )
      if (inBlight) this.addZone(unit.x, 54, 5000, 14, holderFaction, 'spore', 0, unit.lane)
    }
    // Occult — the ability feeds on death, and the enemy flinches at it.
    if (killer.hasTech('soul_tithe') || killer.ascendedTo === 'dark_circle') {
      killer.abilityCharge = Math.min(1, killer.abilityCharge + 0.05)
    }
    if (killer.hasTech('evil_eye')) {
      for (const u of this.units) {
        if (!u.alive || u.faction === winner) continue
        if (Math.abs(u.x - unit.x) < 130) u.mire(700)
      }
    }
    // Occult — the line closes up over its own dead.
    if (owner.hasTech('sacrament')) {
      for (const u of this.units) {
        if (!u.alive || u.faction !== unit.faction) continue
        if (Math.abs(u.x - unit.x) < 170) u.heal(u.maxHp * 0.09)
      }
    }
    // Occult — some of what you kill gets back up on your side.
    // You cannot puppet what lies in six pieces: a butchered army's dead
    // are torn too thoroughly for the thrall-rite to take.
    if (killer.hasTech('mind_thrall') && !owner.hasTech('butchery') && this.rng.chance(0.22)) {
      const risen = this.spawnUnit(winner, unit.def, unit.x)
      risen.hp = risen.maxHp * 0.4
      this.vfx.impact(unit.x, groundY - 24, 0xb46bff, 1.3, false)
    }
    // Nekrotic doctrine — your own fallen get up once, on their own.
    if (owner.ascendedTo === 'nekrotics' && !unit.risen && !unit.banished) {
      const risen = this.spawnUnit(unit.faction, unit.def, unit.x)
      risen.hp = risen.maxHp * 0.45
      risen.risen = true
      this.vfx.impact(unit.x, groundY - 24, 0x7fd6a0, 1.3, true)
    }

    // ── The units' own signature deaths ──
    switch (unit.def.special) {
      case 'gravebound':
        // A Husk is only mostly dead, once — unless the soul was tithed.
        if (!unit.risen && !unit.banished && this.rng.chance(0.25)) {
          const back = this.spawnUnit(unit.faction, unit.def, unit.x, unit.lane)
          back.hp = back.maxHp * 0.45
          back.risen = true
          this.vfx.impact(unit.x, groundY + LANE_Y[unit.lane] - 14, 0x9fd6a0, 0.9, true)
        }
        break
      case 'death_burst':
        // An Emberling is a delivery mechanism.
        this.applySplash(unit.x, unit.centerY, 60, unit.faction, { amount: 70, type: 'explosive', knockback: 90 })
        break
      case 'spore_burst':
        this.addZone(unit.x, 44, 6000, 12, unit.faction, 'spore', 0, unit.lane)
        break
      case 'bone_rampart':
        // The Ossuary Walker dies into architecture.
        this.terrain.addMass(unit.x, unit.lane, 12, this.elapsedMs)
        for (let i = 0; i < 6; i += 1) {
          this.physics.spawn('gib', unit.x + this.rng.spread(20), unit.centerY, this.rng.spread(160), -this.rng.range(60, 220), {
            size: this.rng.range(0.6, 1.1),
            floor: groundY + LANE_Y[unit.lane]
          })
        }
        break
      case 'death_curse':
        // Striking down an Acolyte costs the striker their nerve.
        if (slayer instanceof Unit && slayer.alive) slayer.cursedFor = 5000
        break
    }
    // The Gravetide's kills feed the tide: some of what it slays gets up a Husk.
    if (slayer instanceof Unit && slayer.def.special === 'raise_tide' && unit.layer === 'ground' && this.rng.chance(0.25)) {
      const def = FACTION_UNITS_BY_ID['nk_husk']
      if (def) {
        const husk = this.spawnUnit(slayer.faction, def, unit.x, unit.lane)
        husk.hp = husk.maxHp * 0.6
        husk.risen = true
        this.vfx.impact(unit.x, groundY + LANE_Y[unit.lane] - 14, 0x7fd6a0, 1.1, true)
      }
    }
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
    const angle = attack.gravity > 0 ? ballisticAngle(dx, dy, attack.speed, attack.gravity) : datan2(dy, dx)
    const finalAngle = angle + this.rng.spread(attack.spread * this.accuracyPenalty(base.faction))

    audio.play(this.turretSfx(def), 0.4)
    this.vfx.muzzleFlash(muzzle.x, muzzle.y, finalAngle, def.age >= 4 ? 0x8ff0ff : 0xffd08a, 1.4)

    this.equipProjectile(
      new Projectile(
        this.scene,
        {
          faction: base.faction,
          projectile: attack.projectile,
          x: muzzle.x,
          y: muzzle.y,
          vx: dcos(finalAngle) * attack.speed,
          vy: dsin(finalAngle) * attack.speed,
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
    // Snapped to the art grid at both ends and given an even thickness, so a
    // beam lands on whole pixels instead of smearing a soft diagonal across a
    // scene where nothing else has one.
    const snap = (v: number) => Math.round(v / 2) * 2
    const x0 = snap(x)
    const y0 = snap(y)
    const x1 = snap(target.x)
    const y1 = snap(target.y + target.centerOffsetY)
    const gfx = this.scene.add.graphics().setDepth(260).setBlendMode(Phaser.BlendModes.ADD)
    gfx.lineStyle(6, 0x8ff0ff, 0.85)
    gfx.lineBetween(x0, y0, x1, y1)
    gfx.lineStyle(2, 0xffffff, 1)
    gfx.lineBetween(x0, y0, x1, y1)
    this.beams.push({ gfx, ttl: 140 })
    this.applyDamage(owner, target, event)
  }

  /**
   * Black Sun. The light goes wrong and the *enemy's* aim goes with it, which
   * is a defence that costs the attacker rather than protecting the defender.
   */
  private accuracyPenalty(shooter: Faction): number {
    const foe = this.armyFor(OPPOSITE[shooter])
    return foe.hasTech('black_sun') || foe.ascendedTo === 'dark_circle' ? 3.2 : 1
  }

  /** True for the things an EMP can actually shut down. */
  private isMachine(target: Damageable): boolean {
    const kind = (target as Unit).def?.visual?.kind
    return kind === 'vehicle' || kind === 'mech' || kind === 'aircraft'
  }

  /** Core damage pipeline: modifiers, crits, stats, then the target's own logic. */
  applyDamage(attacker: Damageable | null, target: Damageable, event: DamageEvent): void {
    this.lastViolenceMs = this.elapsedMs
    if (!target.alive) return
    let amount = event.amount
    const bonus = event.bonusVs?.[target.armor]
    if (bonus) amount *= bonus
    const crit = event.crit ? this.rng.chance(event.crit) : false
    if (crit) amount *= 2

    // The Hexer's mark: a marked soldier is structurally uncertain, and
    // everything that reaches it finds the flaw.
    if (target instanceof Unit && target.hexedFor > 0) amount *= 1.25
    // The Shrike finishes what is already bleeding out.
    if (
      attacker instanceof Unit &&
      attacker.def.special === 'execute' &&
      target instanceof Unit &&
      target.hp < target.maxHp * 0.3
    ) {
      amount *= 2
    }
    if (attacker instanceof Unit && attacker.def.special === 'hex_shot' && target instanceof Unit) {
      target.hexedFor = 4000
    }

    // Ordnance ground rule: a soldier caught down in a crater bowl has no
    // cover and nowhere to go, and the creed that dug the bowl knows it.
    if (
      attacker &&
      event.type === 'explosive' &&
      this.leanCache[attacker.faction] === 'ordnance' &&
      target instanceof Unit &&
      target.layer === 'ground' &&
      this.terrain.heightAt(target.x, target.lane) <= -4
    ) {
      amount *= 1 + 0.25 * this.leanPower[attacker.faction]
    }

    if (attacker) this.statsFor(attacker.faction).damageDealt += amount
    this.statsFor(target.faction).damageTaken += amount

    // WAR EXPERIENCE.
    //
    // Ages used to advance on KILLS alone. Two armies that walk past each
    // other in different lanes and besiege opposite fortresses therefore
    // killed nothing, learned nothing, and could never evolve — both sides
    // frozen at the same age for as long as the bypass held, with a full
    // treasury and an experience bar that would not move. Fighting itself
    // now teaches: every blow landed on an enemy soldier or fortress pays
    // experience, at roughly a third of what the finishing blow is worth, so
    // killing remains what you actually want to do.
    if (attacker && attacker.faction !== target.faction) {
      const army = this.armyFor(attacker.faction)
      army.xp += amount * XP_PER_DAMAGE * army.modifiers.bounty
    }

    target.takeDamage(amount, event.type, attacker ?? undefined, event.knockback)

    // On-hit riders: the Butcher drinks the wound, the Flagellant tithes it,
    // the Petardier's concussion knocks the reply out of rhythm, and the
    // Gall Tosser's toxin keeps working after the dart is gone.
    if (attacker instanceof Unit && attacker.alive && target instanceof Unit) {
      switch (attacker.def.special) {
        case 'lifesteal':
          attacker.heal(amount * 0.4)
          break
        case 'soul_siphon': {
          attacker.heal(amount * 0.25)
          const cult = this.armyFor(attacker.faction)
          cult.abilityCharge = Math.min(1, cult.abilityCharge + 0.004)
          break
        }
        case 'suppress':
          target.attackCooldown = Math.min(target.def.attackMs * 1.6, target.attackCooldown + 350)
          break
        case 'toxin':
          target.poisonFor = 3000
          target.poisonDps = Math.max(target.poisonDps, amount * 0.12)
          break
      }
    }

    // The Iron Inquisitor answers every blow in kind: a fifth of any melee
    // strike arcs back into the striker. The reflection carries no source,
    // so two mirrors cannot trap each other.
    if (
      target instanceof Unit &&
      target.def.special === 'reflect' &&
      attacker instanceof Unit &&
      attacker.alive &&
      attacker.def.attack.kind === 'melee'
    ) {
      attacker.takeDamage(amount * 0.2, 'energy')
    }

    // EMP: an energy hit shuts a machine down outright for a few seconds,
    // which is a hard counter to armour rather than a discount on it.
    if (
      event.type === 'energy' &&
      attacker &&
      (this.armyFor(attacker.faction).hasTech('emp') ||
        (attacker instanceof Unit && attacker.def.special === 'emp_shot')) &&
      this.isMachine(target)
    ) {
      const machine = target as Unit
      // The Cyborgs are past being switched off.
      if (machine.alive && this.armyFor(machine.faction).ascendedTo !== 'cyborgs') {
        machine.disable(2600)
        this.vfx.impact(machine.x, machine.y + machine.centerOffsetY, 0x8fe8ff, 1.2, false)
      }
    }
  }

  /** Radial damage with linear falloff and outward knockback. */
  applySplash(
    x: number,
    y: number,
    radius: number,
    faction: Faction,
    event: DamageEvent,
    attacker: Damageable | null = null,
    laneLock?: number
  ): void {
    const targets: Damageable[] = [...this.units, this.playerBase, this.enemyBase]
    for (const t of targets) {
      if (!t.alive || t.faction === faction) continue
      // A swung weapon sweeps the swinger's own file. Shells do not care.
      if (laneLock !== undefined && t instanceof Unit && t.layer === 'ground' && t.lane !== laneLock) continue
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

    if (attacker instanceof Unit && attacker.def.special === 'gravity_well') {
      for (const u of this.units) {
        if (!u.alive || u.faction === faction || u.layer !== 'ground') continue
        const dx = u.x - x
        if (Math.abs(dx) > radius * 1.4 || Math.abs(dx) < 8) continue
        u.launch(-Math.sign(dx) * 200, -150)
      }
    }
    if (attacker instanceof Unit && attacker.def.special === 'dread_wave') {
      for (const u of this.units) {
        if (!u.alive || u.faction === faction || u.layer === 'air') continue
        if (Math.abs(u.x - x) <= radius) u.mire(900)
      }
    }

    // Heavy explosive ordnance rearranges the ground itself: mass in the bowl
    // is partly destroyed and partly thrown to the rim. Gated by era so the
    // stone age stays a field and the last age becomes the moon.
    if (event.type === 'explosive' && radius >= 70 && this.era >= 1 && laneLock === undefined) {
      const lane = this.laneAtY(y)
      const deep = this.leanCache[faction] === 'ordnance' ? 1 + 0.5 * this.leanPower[faction] : 1
      const depth = Math.min(16, (radius * 0.08 + event.amount * 0.008) * (0.5 + this.era * 0.18) * deep)
      this.terrain.crater(x, lane, radius * 0.55, depth, this.elapsedMs)
    }

    // Incendiary: a blast big enough to crack the ground leaves it burning.
    // Ashfall is the upgrade that spreads kill-fires; this rule is the
    // node's own, and it works from the first shell.
    if (radius >= 50 && this.armyFor(faction).hasTech('incendiary')) {
      this.addZone(x, 40, 2600, 12, faction, 'fire', 0, this.laneAtY(y))
    }

    // Whatever stood in the blast takes it too.
    for (let i = 0; i < this.props.length; i += 1) {
      const prop = this.props[i]
      if (!prop.alive || Math.abs(prop.x - x) > radius + prop.radius) continue
      this.damageProp(i, event.amount * 0.8)
    }

    const army = this.armyFor(faction)
    // Overpressure turns a shove into a throw. The impulse is what does the
    // work — units leave the ground and come down somewhere else.
    const force = army.hasTech('overpressure') ? 3.4 : 1
    // Powder Discipline: the same charge, packed properly, throws harder.
    const packed = army.hasTech('powder_discipline') ? 1.15 : 1
    this.physics.blast(x, y, radius * 1.6 * (force > 1 ? 1.35 : 1), (event.knockback * 1.5 + 220) * force * packed)
    if (force > 1) {
      for (const u of this.units) {
        if (!u.alive || u.faction === faction || u.layer !== 'ground') continue
        const dx = u.x - x
        const d = Math.abs(dx)
        if (d > radius * 1.5) continue
        const falloff = 1 - d / (radius * 1.5)
        u.launch(Math.sign(dx || 1) * 260 * falloff, -420 * falloff)
      }
    }

    // Shrapnel: the explosion throws fragments that are real objects with
    // somewhere to be. They arc, fall, and wound whatever they reach.
    if (army.hasTech('shrapnel')) {
      const count = Math.min(14, 5 + Math.round(radius / 26))
      for (let i = 0; i < count; i += 1) {
        const a = this.rng.range(-Math.PI, 0)
        const speed = this.rng.range(260, 620)
        this.physics.spawn('shrapnel', x, y, dcos(a) * speed, dsin(a) * speed, {
          faction,
          damage: Math.max(8, event.amount * 0.16),
          armTime: 40,
          spin: this.rng.spread(14)
        })
      }
    }

    // Explosive hits chip the ground and throw up dirt.
    if (event.type === 'explosive' && y > this.config.groundY - 60) {
      const chunks = Math.min(9, 3 + Math.round(radius / 40))
      for (let i = 0; i < chunks; i += 1) {
        this.physics.spawn(
          'rubble',
          x + this.rng.spread(radius * 0.4),
          this.config.groundY - 2,
          this.rng.spread(220),
          -this.rng.range(120, 380),
          { size: this.rng.range(0.5, 1.1), spin: this.rng.spread(8), ttl: 9000 }
        )
      }
    }
  }

  // ───────────────────────────── Player actions ─────────────────────────────

  queueUnit(faction: Faction, unitId: string, lane = 2): boolean {
    return this.armyFor(faction).enqueue(unitId, lane)
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
    this.updateWind()
    return true
  }

  /**
   * Weather blows debris and lobbed shots downrange. Taken from the player's
   * age so both sides fight in the same conditions, and derived rather than
   * rolled so it stays identical on both peers.
   */
  private updateWind(): void {
    const weather = AGE_THEMES[Math.max(0, Math.min(AGE_THEMES.length - 1, this.player.age))].weather
    const strength: Record<string, number> = { clear: 0, embers: 14, ash: -26, rain: -42, snow: 18 }
    this.physics.wind = strength[weather] ?? 0
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
        this.equipProjectile(
          new Projectile(
            this.scene,
            {
              faction,
              projectile,
              x: x - dcos(angle) * 200,
              y: startY,
              vx: dcos(angle) * speed * 0.2,
              vy: dsin(angle) * speed,
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
        this.equipProjectile(
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
