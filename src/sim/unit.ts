import Phaser from 'phaser'
import { audio } from '../core/audio'
import { rng } from '../core/rng'
import type { UnitDef } from '../data/types'
import { getUnitArt, unitPartKey } from '../gfx/textureFactory'
import { RES } from '../gfx/unitArt'
import { blendPoses, evaluate, partRotation, samplePose, type Additive, type Pose } from '../gfx/rig'
import { FACTION_COLOR } from '../gfx/palette'
import type Vfx from '../gfx/vfx'
import type { Rng } from '../core/rng'
import type PhysicsWorld from './physics'
import { ballisticReach } from './projectile'
import type { TechId } from '../data/tech'
import { ADVANCE_DIR, LANE_Y, damageMultiplier, type ArmorType, type Damageable, type DamageType, type Faction, type Layer } from './types'

export type UnitState = 'advance' | 'engage' | 'dead'

export interface UnitWorld {
  groundY: number
  airY: number
  vfx: Vfx
  /** Time scale applied by the "fast forward" toggle. */
  speedScale: number
  /** Where a soldier's remains go. */
  physics: PhysicsWorld
  /** The deterministic stream, so debris lands identically on both peers. */
  rng: Rng
  /** A soldier carrying a demolition charge died. */
  onDeathCharge?: (unit: Unit) => void
  /** How soaked the ground is under a point, for Bloodlust. */
  goreAt?: (x: number) => number
  /** A unit wants to eat the remains around it, for Bonepickers. */
  scavenge?: (unit: Unit) => void
  /** Ground relief under a point of a lane — mounds up, craters down. */
  reliefAt?: (x: number, lane: number) => number
  /** Front of a side's own fortress — as far back as anything will give ground. */
  homeX: (faction: Faction) => number
  /** A blocked flanker wants to move itself to a clear adjacent lane. */
  requestFlank?: (unit: Unit) => void
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
/** A swarm packs its file far tighter — more bodies per stretch of road. */
const SWARM_GAP = 2
/** How much slack counts as "closed up behind the rank ahead". */
const CLOSE_SLACK = 8
/**
 * How long a unit keeps firing after the rank ahead of it steps away. Without
 * it a shuffling front line makes every archer behind it stutter between one
 * step and one arrow, and nobody ever finishes a draw.
 */
const HOLD_MS = 600
/** Knockback impulse below which a hit hurts but does not interrupt. */
const STAGGER_FLOOR = 60
/** How fast knockback resistance bleeds off, in stacks per second. */
const KNOCK_RECOVERY = 1.6

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
  /** Which of the five files this soldier walks. Fixed at spawn — unless
   * the soldier is a flanker, whose own rule may move it once blocked. */
  lane = 2
  /** The ground line of this soldier's lane, in world pixels. */
  groundLine: number
  hp: number
  maxHp: number
  alive = true
  radius: number
  centerOffsetY: number

  state: UnitState = 'advance'
  target: Damageable | null = null

  /**
   * How the last hit landed. Death needs to know: a body that took one jab too
   * many falls over, one that took a shell comes apart, and both are thrown in
   * the direction the blow came from.
   */
  private overkill = 0
  private lastHitType: DamageType = 'blunt'
  private lastHitDir = 0

  /** Horizontal knockback velocity, decays with friction. */
  vx = 0
  /** Vertical velocity — only non-zero while a unit is airborne from a big hit. */
  vy = 0
  private airborne = false
  private stagger = 0
  /** Move this soldier to another lane. Only the battlefield calls this. */
  setLane(lane: number): void {
    this.lane = Math.max(0, Math.min(LANE_Y.length - 1, lane))
    this.groundLine = this.world.groundY + LANE_Y[this.lane]
    if (this.layer === 'ground' && !this.airborne) this.y = this.groundLine
    this.blockedMs = 0
    this.world.vfx.footDust(this.x, this.groundLine)
    this.setStage(this.stageY)
  }

  /** Stage this soldier on the path and sort it among its neighbours. Depth
   * runs with the lane first and the stage within it, so a near-file soldier
   * always draws over a far-file one — the ground plane's own sorting rule. */
  setStage(offset: number): void {
    this.stageY = offset
    if (this.layer === 'ground') {
      this.container.setDepth(120 + (LANE_Y[this.lane] + 68) * 0.08 + offset * 0.02)
    }
  }

  /** Grace left on the licence to shoot from formation. See formedUp(). */
  private holdMs = 0
  /** Recent shoves, each one making the next one count for less. */
  private knockStacks = 0
  /** How long this soldier has been pressed against its own line, in ms. */
  private blockedMs = 0
  /** Lanes the current shot crosses: 0 own file, 1 next door, 2 plunging. */
  crossLaneShot = 0
  /** True while this flanker's file is clear ahead — set by the battlefield. */
  raiding = false
  /** Weight of the ranks pressing in behind this one. Set by the battlefield. */
  press = 1
  /** Position in this match's spawn order. Set by the battlefield. */
  seq = 0
  /**
   * How far up the battle path this soldier stands, in pixels below the feet
   * line. Purely visual: the simulation stays one-dimensional, but the army
   * is drawn on a ground plane now, and a rank staged a few pixels deeper
   * sorts behind the rank in front — which is what makes twenty soldiers read
   * as a formation on a field instead of a queue on a wire.
   */
  stageY = 0

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

  /** The owning army's researched behaviours, or null outside a battle. */
  techs: ReadonlySet<TechId> | null = null

  /**
   * Bloodlust: how much faster this soldier is moving and swinging because of
   * what is underfoot. 1 on clean ground, up to 1.45 on a killing field — so
   * the tech rewards fighting where the fighting has already been.
   */
  /**
   * Where the archetype rig is in its current clip, and what it is fading out
   * of. Cross-fading matters more than it sounds: snapping from a walk pose to
   * an attack pose on the frame a unit comes into range is the single most
   * obvious way to make a rig look like a puppet.
   */
  /**
   * Where the unit was when the rig was last driven.
   *
   * Animation is paced by ground actually covered, not by intent. A soldier
   * queued behind a stalled front rank is still in the `advance` state — it
   * simply cannot move — so keying the walk off the state marched the whole
   * column in place. Distance is also what stops the feet skating: a fast unit
   * takes quick steps and a slow one plods, without either being tuned.
   */
  private lastVisualX = 0
  /** Smoothed ground speed, px/s, used to decide whether the unit is walking. */
  private paceAvg = 0
  private walkingNow = false
  private clipPhase = 0
  private prevPose: Pose | null = null
  private blendLeft = 0
  private lastClip = ''

  private frenzy = 1
  private scavengeTimer = 0

  /** Sappers: how long this soldier has been stuck against the enemy line. */
  burrowTimer = 0
  /** EMP: milliseconds this machine is dead in the water. */
  private disabledFor = 0
  private miredFor = 0
  /** True for a soldier that has already been brought back once. */
  risen = false
  /** Blight: how long this soldier has held its ground, in milliseconds. */
  rooting = 0
  /**
   * Army-wide research multipliers, stamped on at spawn.
   *
   * They live on the soldier rather than on the def because a def is shared by
   * every copy ever built, and research is meant to equip the next wave without
   * retrofitting the one already dying in the lane.
   */
  speedMult = 1
  rangeMult = 1
  toughness = 1
  damageMult = 1

  /**
   * Veterancy.
   *
   * Research changes the wave you build next; this changes the soldier standing
   * in front of you, while you watch. A unit that keeps killing keeps getting
   * better and keeps looking like it — three promotions, each one worth
   * defending, which is the whole argument for pulling a hurt veteran back
   * instead of feeding it. Purely a function of confirmed kills, so it is as
   * deterministic as everything else in the simulation.
   */
  kills = 0
  rank = 0
  /** Rank pips drawn over the soldier, created on the first promotion. */
  private rankMark?: Phaser.GameObjects.Text

  /** Aegis: how many friendly soldiers are shoulder to shoulder with this one. */
  linked = 0

  /**
   * Carnage ground rule: how much this soldier is feeding off the mound of
   * the dead it stands on, 0..1. Set by the battlefield's creed pass; it makes
   * the soldier swing faster and hit harder for exactly as long as it holds
   * the high ground its own killing built.
   */
  groundFury = 0
  /**
   * Occult ground rule: how badly haunted the ground under this soldier is,
   * 0..1. Set by the battlefield's creed pass on *enemies* of the occult side;
   * a soldier fighting on fed ground swings softer and walks slower.
   */
  dread = 0

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
    spawnJitter?: number,
    lane = 2
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
    this.lane = Math.max(0, Math.min(LANE_Y.length - 1, lane))
    this.groundLine = world.groundY + LANE_Y[this.lane]
    // Air lane jitter is gameplay-affecting (it changes engagement range),
    // so it comes from the caller's deterministic stream, not the shared
    // cosmetic one.
    this.y = def.layer === 'air' ? world.airY + (spawnJitter ?? 0) : this.groundLine

    this.scaleFactor = 1 / RES
    this.container = scene.add.container(this.x, this.y)
    this.container.setDepth(def.layer === 'air' ? 260 : 120)


    this.shadow = scene.add
      .image(this.x, this.groundLine + 2, 'fx:shadow')
      .setDepth(60)
      .setAlpha(def.layer === 'air' ? 0.22 : 0.4)
      .setDisplaySize(def.height * 0.9, def.height * 0.26)

    // A faction-coloured ring on the ground: the fastest read of whose side a
    // soldier is on, even in a crowded melee.
    this.teamRing = scene.add
      .image(this.x, this.groundLine + 1, 'fx:soft')
      .setDepth(61)
      .setTint(FACTION_COLOR[faction])
      .setAlpha(0.62)
      .setDisplaySize(def.height * 0.78, def.height * 0.26)

    // Seed the pacing reference, or the first frame reads the whole spawn
    // offset as distance travelled and snaps the walk cycle.
    this.lastVisualX = this.x
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

    // Archetype-driven units get their parts straight from the skeleton, in
    // bone depth order, and nothing here needs to know what body plan it is.
    if (art.rig) {
      const ordered = [...art.rig.skeleton]
        .filter(b => b.part && art.parts.includes(b.part))
        .sort((a, b) => a.depth - b.depth)
      for (const b of ordered) this.addPart(b.part as string, b.depth)
      return
    }

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

  /**
   * Weapon reach after research. Everything that asks "can I hit it" uses this.
   *
   * Clamped to what the weapon can physically throw. A lobbed shot aimed past
   * its own maximum range does not fall a little short — it falls *hugely*
   * short, landing in the middle of the friendly front line, which is what the
   * catapults and mortars were doing before their muzzle speeds were fixed.
   * Keeping the clamp here means a future data edit cannot bring that back.
   */
  get reach(): number {
    const wanted = this.def.range * this.rangeMult
    const attack = this.def.attack
    if (attack.kind !== 'projectile' || attack.gravity <= 0) return wanted
    return Math.min(wanted, ballisticReach(attack.speed, attack.gravity))
  }

  /**
   * Closest a target may stand before this weapon cannot be brought to bear.
   * Research that extends reach opens the dead zone up by the same proportion:
   * a longer throw is a longer minimum arc, not a free upgrade.
   */
  get minReach(): number {
    return (this.def.minRange ?? 0) * this.rangeMult
  }

  takeDamage(amount: number, type: DamageType, source?: Damageable, knockback = 0): void {
    if (!this.alive) return
    const mult = damageMultiplier(type, this.armor)
    // Aegis: a soldier in formation takes a share, not the whole blow. Break
    // the formation and the protection goes with it.
    const shared = this.linked > 0 ? 1 - Math.min(0.4, this.linked * 0.14) : 1
    // Rooted: a soldier that has not moved is dug in, and it shows.
    const dugIn = 1 - Math.min(0.35, (this.rooting / 4000) * 0.35)
    const reduced = (amount * mult * (1 - this.auraShield) * shared * dugIn) / this.toughness
    const before = this.hp
    this.hp -= reduced
    this.lastHitType = type
    if (source) this.lastHitDir = Math.sign(this.x - source.x) || -this.dir
    // Overkill as a fraction of the unit's own health: how far past dead the
    // blow carried it, which is a better measure of violence than raw damage.
    if (this.hp <= 0) this.overkill = Math.min(2, (reduced - Math.max(0, before)) / Math.max(1, this.maxHp * 0.5))
    this.flashTimer = FLASH_MS

    const color = type === 'energy' ? 0x9fe8ff : type === 'explosive' ? 0xffa640 : 0xffe08a
    const organic = this.def.visual.kind === 'humanoid' || this.def.visual.kind === 'rider'
    this.world.vfx.impact(this.x, this.centerY, color, Math.min(2, reduced / 60 + 0.5), organic)
    this.world.vfx.damageNumber(this.x, this.centerY - this.def.height * 0.35, reduced, mult > 1.15 ? 0xffd166 : 0xffffff, mult > 1.3)

    if (knockback > 0) {
      // Diminishing returns. Massed light fire used to pin a line in place
      // forever: every pebble set the stagger timer and added its own shove, so
      // a front rank under fire from twenty slingers spent most of each second
      // unable to act and was pushed back as fast as it could walk. That, and
      // not the damage, is what made long range with knockback strictly the
      // best thing to buy. Each shove now counts for less than the last, and
      // the stacks bleed off over about a second of not being hit.
      const impulse = (knockback / Math.max(0.4, this.def.mass)) * 1.6 / (1 + this.knockStacks)
      this.knockStacks = Math.min(6, this.knockStacks + 1)
      this.vx += -this.dir * impulse
      if (impulse > 150 && this.layer === 'ground') {
        this.vy = -Math.min(560, impulse * 1.5)
        this.airborne = true
      }
      // Only a blow heavy enough to actually shift a soldier interrupts it —
      // and a soldier drilled into an Iron Line takes half again as much.
      const floor = this.techs?.has('iron_line') && this.layer === 'ground' ? STAGGER_FLOOR * 1.6 : STAGGER_FLOOR
      if (impulse > floor) this.stagger = Math.max(this.stagger, Math.min(420, impulse * 1.4))
    }

    if (this.hp <= 0) this.kill(source)
  }

  /** Bogs this unit down — it can still fight, it just cannot get anywhere. */
  mire(ms: number): void {
    this.miredFor = Math.max(this.miredFor, ms)
  }

  /** Shuts this unit down for a while. It cannot move, turn or shoot. */
  disable(ms: number): void {
    this.disabledFor = Math.max(this.disabledFor, ms)
  }

  get disabled(): boolean {
    return this.disabledFor > 0
  }

  /** Throws this unit bodily. Used by blasts strong enough to lift a man. */
  launch(vx: number, vy: number): void {
    if (!this.alive || this.layer !== 'ground') return
    this.vx += vx
    this.vy = vy
    this.airborne = true
    this.stagger = Math.max(this.stagger, 420)
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
    this.rankMark?.destroy()
    this.rankMark = undefined
    this.teamRing.setAlpha(0.25)

    const kind = this.def.visual.kind
    const mechanical = kind === 'vehicle' || kind === 'mech' || kind === 'aircraft'
    if (mechanical) {
      this.world.vfx.explosion(this.x, this.centerY, this.def.height * 1.1, 0xffa640, this.def.height > 70)
      audio.play('death_mech', 0.6)
    } else {
      audio.play('death', 0.5)
    }

    this.onDeath?.(this, killer)

    // How hard the killing blow landed decides whether this is a body that
    // falls over or a body that comes apart. Overkill is the honest measure:
    // a spearman finished by one more jab topples, one hit by a shell does not
    // stay in one piece.
    // Butchery makes every death a dismemberment; demolition means the body
    // was carrying something that has not gone off yet.
    const butchery = this.techs?.has('butchery') ?? false
    if (this.techs?.has('demolition')) this.world.onDeathCharge?.(this)
    // How readily a body comes apart is the era speaking. Two stone-age
    // spearmen kill each other and both fall over whole; by the last age the
    // same field is a slaughterhouse. Carnage research drags the bar down a
    // whole age early, wherever it happens in history.
    const era = this.def.age
    const bar = [1.2, 0.9, 0.65, 0.45, 0.3][era] - (this.techs?.has('bloodlust') || butchery ? 0.15 : 0)
    const explosiveTears = this.lastHitType === 'explosive' && era >= 1
    if (butchery || this.overkill >= bar || explosiveTears) {
      this.dismember(mechanical)
    } else {
      this.bleedOut(mechanical)
      this.playDeathAnimation(mechanical)
    }
  }

  /**
   * The unit comes apart. Each rigged part becomes a physics body carrying its
   * own sprite, thrown outward from the point of impact — so what lands on the
   * ground is recognisably the soldier who was standing there.
   */
  private dismember(mechanical: boolean): void {
    const physics = this.world.physics
    const rand = this.world.rng
    const away = this.lastHitDir || -this.dir
    const power = 120 + Math.min(340, this.overkill * 320)

    for (const [name, part] of Object.entries(this.parts)) {
      if (!part.visible) continue
      const worldX = this.x + part.x * this.scaleFactor * this.dir
      const worldY = this.y + part.y * this.scaleFactor
      const heavy = name === 'torso' || name === 'body' || name === 'mount'
      physics.spawn(
        mechanical ? 'scrap' : 'gib',
        worldX,
        worldY,
        away * rand.range(power * 0.35, power) + rand.spread(90),
        -rand.range(power * 0.5, power * 1.25),
        {
          texture: part.texture.key,
          originX: part.originX,
          originY: part.originY,
          flip: this.dir < 0,
          rot: part.rotation,
          spin: rand.spread(mechanical ? 5 : 11),
          mass: heavy ? 2.2 : 0.9,
          size: this.scaleFactor,
          color: part.tintTopLeft ?? 0xffffff,
          faction: this.faction,
          // Only flesh bleeds, and the bigger pieces bleed for longer.
          bleed: mechanical ? 0 : heavy ? 1400 : 700,
          floor: this.groundLine
        }
      )
    }

    // A burst of droplets thrown along the direction of the killing blow —
    // a trickle in the early ages, a butcher's yard by the late ones.
    const eraBlood = [0.35, 0.55, 0.8, 1, 1.2][this.def.age]
    const spray = mechanical ? 0 : Math.round((10 + this.overkill * 10) * eraBlood)
    for (let i = 0; i < spray; i += 1) {
      physics.spawn(
        'blood',
        this.x,
        this.centerY,
        away * rand.range(40, 320) + rand.spread(140),
        -rand.range(60, 300),
        { size: rand.range(0.5, 1.1), floor: this.groundLine }
      )
    }
    if (mechanical) this.world.vfx.scrap(this.x, this.centerY, 1.2)

    // The rig itself is gone — its pieces are physics now.
    this.container.setVisible(false)
    this.scene.tweens.add({
      targets: [this.shadow, this.teamRing],
      alpha: 0,
      duration: 500,
      onComplete: () => this.destroy()
    })
  }

  /** A body that stays whole still empties itself onto the ground. */
  private bleedOut(mechanical: boolean): void {
    if (mechanical) {
      this.world.vfx.scrap(this.x, this.centerY, 1.2)
      return
    }
    const physics = this.world.physics
    const rand = this.world.rng
    const away = this.lastHitDir || -this.dir
    const drops = Math.max(3, Math.round(8 * [0.35, 0.55, 0.8, 1, 1.2][this.def.age]))
    for (let i = 0; i < drops; i += 1) {
      physics.spawn(
        'blood',
        this.x + rand.spread(this.def.height * 0.12),
        this.centerY,
        away * rand.range(20, 150) + rand.spread(90),
        -rand.range(40, 210),
        { size: rand.range(0.5, 1), floor: this.groundLine }
      )
    }
    this.world.vfx.gore(this.x, this.centerY, 1)
  }

  /** Limbs splay, the body topples, and the corpse fades into the ground. */
  private playDeathAnimation(mechanical: boolean): void {
    const tumbleDir = this.vx !== 0 ? Math.sign(this.vx) : -this.dir
    this.container.setDepth(80 + this.stageY * 0.05)

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
    if (this.knockStacks > 0) this.knockStacks = Math.max(0, this.knockStacks - (dtMs / 1000) * KNOCK_RECOVERY)
    if (this.attackCooldown > 0) this.attackCooldown -= dtMs
    if (this.miredFor > 0) this.miredFor -= dtMs
    if (this.disabledFor > 0) {
      this.disabledFor -= dtMs
      // A disabled machine still falls, still gets shot, and still slides —
      // it just stops deciding things.
      this.x += this.vx * dt
      this.container.setPosition(this.x, this.y + this.stageY)
      return
    }
    if (this.def.regen) this.hp = Math.min(this.maxHp, this.hp + this.def.regen * dt)

    this.frenzy =
      this.techs?.has('bloodlust') && this.layer === 'ground'
        ? 1 + Math.min(0.45, (this.world.goreAt?.(this.x) ?? 0) * 0.45)
        : 1
    // The ground rules speak here too: a carnage soldier on its mound works
    // faster; anyone standing on the occult's fed ground works slower. Both
    // are capped and both end the moment the soldier steps off the ground
    // that caused them.
    this.frenzy *= (1 + this.groundFury * 0.28) * (1 - this.dread * 0.12)
    // Bonepickers feed on what is lying around them while they are hurt.
    if (this.techs?.has('bonepickers') && this.hp < this.maxHp * 0.92) {
      this.scavengeTimer -= dtMs
      if (this.scavengeTimer <= 0) {
        this.scavengeTimer = 500
        this.world.scavenge?.(this)
      }
    }

    // Knockback physics.
    if (this.airborne) {
      this.vy += GRAVITY * dt
      this.y += this.vy * dt
      this.vx -= this.vx * AIR_DRAG * dt
      if (this.y >= this.groundLine) {
        this.y = this.groundLine
        this.airborne = false
        if (Math.abs(this.vy) > 200) {
          this.world.vfx.footDust(this.x, this.groundLine)
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

    if (this.holdMs > 0) this.holdMs -= dtMs
    if (nearest && this.distanceTo(nearest) <= this.reach && this.formedUp(blockerX)) {
      this.state = 'engage'
      if (!staggered) this.tryAttack(nearest, dtMs)
    } else {
      this.state = 'advance'
      if (!staggered) {
        if (this.overrun()) this.giveGround(dt)
        else this.advance(dt, blockerX)
      }
    }

    this.handleBurst(dtMs)
    this.updateVisual(dtMs)
  }

  /**
   * Whether this unit has taken up its place in the line and may open fire.
   *
   * A unit at the front stops at its own reach and shoots, which is what makes
   * a bow worth carrying. A unit with a friendly rank ahead of it does not: it
   * closes right up behind that rank first, so archers stand behind the shield
   * wall instead of loosing arrows into its back from the far edge of their
   * range. Once it is formed up it keeps shooting for a moment after the rank
   * ahead steps off, so a front line shuffling forward does not reduce every
   * archer behind it to one step, one arrow, one step.
   */
  private formedUp(blockerX: number | null): boolean {
    if (blockerX === null) return true
    const gap = this.def.conduct === 'swarm' ? SWARM_GAP : QUEUE_GAP
    const limit = blockerX - this.dir * (this.radius + gap)
    if ((limit - this.x) * this.dir <= CLOSE_SLACK) {
      this.holdMs = HOLD_MS
      return true
    }
    return this.holdMs > 0
  }

  /** Something has got inside the arc this weapon can be brought to bear in. */
  private overrun(): boolean {
    return this.minReach > 0 && this.target !== null && this.distanceTo(this.target) < this.minReach
  }

  /**
   * A crew whose engine has been charged backs away rather than standing there
   * cranking a windlass at a swordsman. It gives ground slowly and never past
   * its own fortress, so a charge that reaches the artillery is rewarded with
   * a rout instead of a stalemate.
   */
  private giveGround(dt: number): void {
    const step = this.def.speed * this.speedMult * 0.55 * dt * this.dir
    const wall = this.world.homeX(this.faction) + this.dir * this.radius
    this.x = this.dir === 1 ? Math.max(wall, this.x - step) : Math.min(wall, this.x - step)
    this.stepPhase += Math.abs(step)
  }

  private advance(dt: number, blockerX: number | null): void {
    // An open road is an invitation: a flanker in an enemy-free file rides it.
    const raid = this.raiding ? 1.3 : 1
    const step = this.def.speed * this.speedMult * this.frenzy * raid * (this.miredFor > 0 ? 0.35 : 1) * dt * this.dir
    const nextX = this.x + step
    if (blockerX !== null) {
      const gap = this.def.conduct === 'swarm' ? SWARM_GAP : QUEUE_GAP
      const limit = blockerX - this.dir * (this.radius + gap)
      if ((this.dir === 1 && nextX > limit) || (this.dir === -1 && nextX < limit)) {
        this.x = limit
        // The knight's move. A flanker does not wait in a queue: blocked long
        // enough, it asks the field for a clear adjacent lane and takes it.
        // The rule is fixed and the clock is simulation time, so both peers
        // watch the same soldier make the same decision at the same tick.
        // Pack Tactics cuts the patience to almost nothing.
        this.blockedMs += dt * 1000
        const patience = this.techs?.has('pack_tactics') ? 550 : 1500
        if (this.def.flanker && this.blockedMs > patience) this.world.requestFlank?.(this)
        return
      }
    }
    this.x = nextX
    this.stepPhase += Math.abs(step)
    this.blockedMs = 0
  }

  private tryAttack(target: Damageable, dtMs: number): void {
    void dtMs
    if (this.attackCooldown > 0) return
    const attack = this.def.attack

    if (attack.kind === 'heal' || attack.kind === 'aura') {
      this.attackCooldown = this.def.attackMs / this.frenzy
      this.onHealPulse?.(this)
      return
    }

    this.attackCooldown = this.def.attackMs / this.frenzy
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

    if (art.rig) {
      this.updateRig(dtMs, art.rig, moving)
      this.updateHpBar()
      this.applyTints()
      return
    }

    // Facing: flip the whole container.
    this.container.setScale(this.scaleFactor * this.dir, this.scaleFactor)
    this.container.setPosition(this.x, this.y + this.stageY)
    this.shadow.setPosition(this.x, this.groundLine + this.stageY + 2)
    this.shadow.setAlpha(this.layer === 'air' ? 0.18 : 0.4)
    this.teamRing.setPosition(this.x, this.groundLine + this.stageY + 1)

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

  /** Kills needed for each rank. Deliberately reachable inside one push. */
  private static readonly RANK_KILLS = [2, 5, 9]

  /**
   * Credits a kill and promotes if that was enough.
   *
   * The gains are small individually and large together: a rank-three soldier
   * hits about half again as hard as it did and shrugs off about a fifth more,
   * which is enough that losing one hurts.
   */
  creditKill(): void {
    this.kills += 1
    while (this.rank < Unit.RANK_KILLS.length && this.kills >= Unit.RANK_KILLS[this.rank]) {
      this.rank += 1
      this.damageMult *= 1.15
      this.toughness *= 1.07
      this.speedMult *= 1.04
      this.rangeMult *= 1.03
      const grown = this.maxHp * 1.1
      this.hp += grown - this.maxHp
      this.maxHp = grown
      this.showRank()
    }
  }

  /** The visible half of a promotion: pips, a flash, and a slightly bigger soldier. */
  private showRank(): void {
    const colour = this.rank >= 3 ? '#f2c14e' : this.rank === 2 ? '#e9eefb' : '#c9a227'
    if (!this.rankMark) {
      this.rankMark = this.scene.add
        .text(this.x, this.container.y - this.def.height - 22, '', {
          fontFamily: '"Trebuchet MS", system-ui, sans-serif',
          fontSize: '11px',
          color: colour,
          stroke: '#05070d',
          strokeThickness: 3
        })
        .setOrigin(0.5)
        .setDepth(282)
    }
    this.rankMark.setText('▲'.repeat(this.rank)).setColor(colour)
    // A veteran stands a little taller. Two percent per rank is under the
    // threshold of "that sprite is the wrong size" and over the threshold of
    // "that one has been here a while".
    this.scaleFactor *= 1.02
    this.world.vfx.floatingLabel(this.x, this.centerY - this.def.height * 0.5, 'PROMOTED', colour)
  }

  /**
   * Drives an archetype rig for one frame.
   *
   * Clip selection, phase, cross-fade, additive layers, forward kinematics,
   * then the transforms onto the Phaser images. Everything the old
   * per-body-plan animation code did by hand, done once for every body plan.
   */
  private updateRig(dtMs: number, rig: NonNullable<ReturnType<typeof getUnitArt>['rig']>, moving: boolean): void {
    const R = RES
    const height = this.def.height

    this.container.setScale(this.scaleFactor * this.dir, this.scaleFactor)
    // A soldier stands on whatever the war has made of the ground: up on the
    // mounds, down into the craters. Purely visual — ballistics and reach stay
    // on the flat sim line, so the balance measurements keep their meaning.
    const relief = this.layer === 'ground' ? Math.max(-12, Math.min(20, this.world.reliefAt?.(this.x, this.lane) ?? 0)) : 0
    this.container.setPosition(this.x, this.y + this.stageY - relief)
    this.shadow.setPosition(this.x, this.groundLine + this.stageY - relief + 2)
    this.shadow.setAlpha(this.layer === 'air' ? 0.18 : 0.4)
    this.teamRing.setPosition(this.x, this.groundLine + this.stageY - relief + 1)

    // How far the unit actually got since the last frame. Everything about
    // which clip plays, and how fast, comes from this rather than from what the
    // unit was trying to do.
    const travelled = Math.abs(this.x - this.lastVisualX)
    this.lastVisualX = this.x

    // A queue that is slowly compressing creeps forward a fraction of a pixel
    // per frame, which sits right on any fixed threshold and makes the whole
    // column flicker between standing and walking. So: smooth the pace, and
    // give it hysteresis — it takes a quarter of the unit's own speed to start
    // walking and a tenth to stop. Scaled to the unit's speed rather than a
    // constant, or a titan and a drone would need different numbers.
    const instant = dtMs > 0 ? (travelled * 1000) / dtMs : 0
    this.paceAvg += (instant - this.paceAvg) * Math.min(1, dtMs / 120)
    const nominal = Math.max(1, this.def.speed * this.speedMult)
    this.walkingNow = this.walkingNow
      ? this.paceAvg > nominal * 0.1
      : this.paceAvg > nominal * 0.25
    const walking = moving && this.walkingNow

    const attacking = this.swing > 0
    const name: 'idle' | 'walk' | 'attack' = attacking ? 'attack' : walking ? 'walk' : 'idle'
    const clip = rig.clips[name]

    if (name !== this.lastClip) {
      // Freeze the pose we are leaving and fade out of it.
      const from = rig.clips[this.lastClip as 'idle' | 'walk' | 'attack']
      this.prevPose = from ? samplePose(from, this.clipPhase) : null
      this.blendLeft = 110
      this.clipPhase = 0
      this.lastClip = name
    }

    if (name === 'walk') {
      // One clip cycle per two strides, tied to distance actually covered.
      const strideLength = Math.max(10, height * 0.62)
      this.clipPhase += travelled / (strideLength * 2)
    } else if (name === 'attack') {
      // The clip runs across the swing, so the contact pose lands with the hit.
      this.clipPhase = 1 - this.swing
    } else {
      this.clipPhase += dtMs / clip.duration
    }
    if (clip.loop) this.clipPhase %= 1
    else this.clipPhase = Math.min(1, this.clipPhase)

    let pose = samplePose(clip, this.clipPhase)
    if (this.blendLeft > 0 && this.prevPose) {
      this.blendLeft = Math.max(0, this.blendLeft - dtMs)
      pose = blendPoses(this.prevPose, pose, 1 - this.blendLeft / 110)
    }

    // Additive layers. Aim is expressed relative to level, so a unit shooting
    // at something above it raises its arms without any clip knowing about it.
    const aim = this.aimAngle()
    const ranged = this.def.attack.kind !== 'melee'
    const additive: Additive = {
      aim: ranged ? aim * this.dir : 0,
      recoil: attacking && ranged ? this.swing : 0,
      breathe: Math.sin(this.animTime / 620),
      // A flat half-unit of lean on every walking soldier read as the whole
      // army falling forward. Enough to show intent, not enough to topple.
      lean: moving ? 0.26 : 0,
      flinch: this.flashTimer > 0 ? this.flashTimer / 140 : 0
    }

    const transforms = evaluate(rig.skeleton, pose, additive)

    for (const b of rig.skeleton) {
      if (!b.part) continue
      const img = this.parts[b.part]
      if (!img) continue
      const t = transforms[b.name]
      if (!t) continue
      img.setPosition(t.x * height * R, t.y * height * R)
      img.setRotation(partRotation(t.angle, t.orient))
    }

    // Footfall dust on the two contact poses of the walk cycle.
    if (walking && this.layer === 'ground') {
      const phase = Math.floor(this.clipPhase * 2)
      if (phase !== this.lastStepPhase) {
        this.lastStepPhase = phase
        this.world.vfx.footDust(this.x - this.dir * this.radius * 0.4, this.world.groundY)
      }
    }

    if (this.swing > 0) this.swing = Math.max(0, this.swing - dtMs / (this.def.attackMs * 0.42))
  }

  private updateHpBar(): void {
    this.rankMark?.setPosition(this.x, this.container.y - this.def.height - 24)
    const damaged = this.hp < this.maxHp - 0.5
    this.hpBarBg.setVisible(damaged)
    this.hpBar.setVisible(damaged)
    if (!damaged) return
    const barW = Math.max(24, this.def.height * 0.62)
    const y = this.container.y - this.def.height - 12
    this.hpBarBg.setPosition(this.x, y + this.stageY)
    this.hpBar.setPosition(this.x - barW / 2, y + this.stageY)
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
    this.rankMark?.destroy()
    if (this.hpBar.active) this.hpBar.destroy()
    if (this.hpBarBg.active) this.hpBarBg.destroy()
  }
}
