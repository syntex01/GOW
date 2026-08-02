import Phaser from 'phaser'
import { audio } from '../core/audio'
import { BAND, SLOT, onGround } from '../gfx/depth'
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

/**
 * How long a half-fired burst waits for a new target before giving up. Long
 * enough to traverse onto the next body in a line, short enough that a gunner
 * left alone on the field stops shooting at nothing.
 */
const BURST_GRACE_MS = 420

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
  /** How badly a side is outnumbered right now, 0..1, for The Hunger. */
  outnumbered?: (faction: Faction) => number
  /**
   * Kills scored by every living body of one squad-def on one side, for the
   * Flensing Host. Three butchers sharing a nervous system means the frenzy is
   * a property of the CARD, not of whichever of the three happened to land it.
   */
  hostKills?: (faction: Faction, defId: string) => number
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

/**
 * Tiny conduct glyphs, drawn once and floated over the soldiers that carry a
 * fixed rule: chevron for the phalanx, block for the screen, diamond for the
 * hunt, dots for the swarm, arrows for the flanker. The chess-piece read at
 * a glance — which rule is this piece playing by — without opening a card.
 */
function ensureConductGlyphs(scene: Phaser.Scene): void {
  if (scene.textures.exists('glyph:phalanx')) return
  const make = (key: string, rows: string[]): void => {
    const canvas = document.createElement('canvas')
    canvas.width = rows[0].length
    canvas.height = rows.length
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) if (row[x] === '#') ctx.fillRect(x, y, 1, 1)
    })
    scene.textures.addCanvas(key, canvas)
  }
  make('glyph:phalanx', ['...#...', '..###..', '.##.##.', '##...##'])
  make('glyph:screen', ['#####', '#####', '#####', '.###.'])
  make('glyph:hunt', ['..#..', '.###.', '#####', '.###.', '..#..'])
  make('glyph:swarm', ['#.#.#', '.....', '#.#.#'])
  make('glyph:flank', ['#..#..', '.#..#.', '..#..#', '.#..#.', '#..#..'])
}

/** The glyph a def wears, if any. Flanking trumps — it is the rarer read. */
function glyphKeyFor(def: UnitDef): string | null {
  if (def.flanker) return 'glyph:flank'
  if (def.conduct) return `glyph:${def.conduct}`
  return null
}

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
/** The three spoils, as the sack over a Bonewright's shoulder. */
const BURDEN_TEXTURE = { meat: 'fx:meat', skull: 'fx:skull', bone: 'fx:bone' } as const
const BURDEN_COLOR = { meat: 0xc4544a, skull: 0xe6dfc4, bone: 0xd8cfae } as const
/** How long a flanker stands blocked before it asks the field for a new file. */
const FLANK_PATIENCE_MS = 1500
/**
 * How often a wounded Bonepicker stoops for a mouthful, and how long the stoop
 * lasts. Slow on purpose: the healing is now something you watch happen rather
 * than a number ticking up, so it has to be legible at the pace of a fight.
 */
const BONEPICKER_MS = 3000
const BONEPICKER_STOOP_MS = 620
/** Knockback impulse below which a hit hurts but does not interrupt. */
const STAGGER_FLOOR = 60
/**
 * DEATH THROES — the carnage node that will not admit a soldier has died.
 *
 * Held here rather than on the def because it is a property of the RESEARCH,
 * not of any one soldier: everything you field does this once the node is in.
 */
/** How long a body keeps fighting after the blow that killed it. */
const THROES_MS = 2000
/** Attack rate multiplier while it is happening. Twice as fast, exactly. */
const THROES_HASTE = 2
/**
 * How much health a body has left to be shot off it during the throes.
 *
 * The node promises two seconds, so this has to be generous enough that an
 * ordinary exchange does not cut it to a quarter of a second — measured, a
 * fifth of a bar meant a body in a five-on-five scrum lasted about two hundred
 * milliseconds, which is not a mechanic, it is a flicker. At three fifths it
 * survives a normal trade and still dies early to a side that decides to spend
 * its volley finishing a corpse, which is the counter-play worth keeping.
 */
const THROES_POOL = 0.6
/** How often a body in throes throws blood while it is emptying itself. */
const THROES_BLEED_MS = 130
/** How fast knockback resistance bleeds off, in stacks per second. */
const KNOCK_RECOVERY = 1.6
/**
 * The hardest a blow can throw a soldier, as a multiple of its own march.
 *
 * The diminishing-returns system below was built against massed LIGHT fire and
 * is blind to a single heavy one: stacks bleed off at 1.6/s, so a gun that
 * fires every 2.7 seconds always lands at zero stacks and always lands at full
 * force. A Titan — reach 410 against a line soldier's 380, splash 110,
 * knockback 520 — therefore launched the entire front rank backwards faster
 * than it could walk, every volley, forever. Measured: a hundred and thirty
 * seven line soldiers never landed a single shot on one.
 *
 * A range advantage plus a shove should not add up to being untouchable. A
 * heavy blow still throws a light soldier — it may not throw one out of the
 * war.
 *
 * Friction works out so that displacement is roughly the initial velocity in
 * pixels, which makes this number readable: a single blow costs a soldier
 * about three quarters of a second of marching. A weapon on a 2.7-second
 * reload therefore takes back a third of what its target walks between
 * volleys, so a rank that has closed STAYS closed — measured, the lead soldier
 * used to be shoved from 98 pixels out to 452 over five seconds and never got
 * back inside its own 380 of reach.
 */
const KNOCK_SPEED_CAP = 0.75
/** What fraction of its march a staggered soldier keeps while closing. */
const STAGGER_ADVANCE = 0.55

/**
 * The files a thing of the given width occupies, centred on `lane` and clipped
 * to the board. A machine pushed against the edge of the field genuinely covers
 * fewer files — it does not wrap around, and it does not slide inward.
 */
export function spannedLanes(lane: number, span: number): number[] {
  if (span <= 1) return [lane]
  const half = Math.floor(span / 2)
  const out: number[] = []
  for (let l = lane - half; l <= lane + half; l += 1) {
    if (l >= 0 && l < LANE_Y.length) out.push(l)
  }
  return out
}

let nextId = 1

/**
 * Unit ids are hashed into the lockstep fingerprint, and this counter is
 * module-global — the menu parade also builds Units, and two players never
 * spend the same number of frames on the menu. Every battlefield therefore
 * resets the counter at construction, so both peers number their armies from
 * one and the fingerprint reflects the simulation instead of the menus.
 */
export function resetUnitIds(): void {
  nextId = 1
}

export default class Unit implements Damageable {
  readonly id = nextId++
  readonly def: UnitDef
  readonly faction: Faction
  readonly layer: Layer
  readonly armor: ArmorType
  readonly dir: 1 | -1
  /**
   * Which way the art is turned. Normally the way the army is going; a body on
   * an errand — a Bonewright carrying a sack back to the wall — turns round.
   * Purely cosmetic, and derived from simulation state, so it never enters the
   * fingerprint.
   */
  facing: 1 | -1 = 1
  /**
   * A destination that replaces the advance rule outright.
   *
   * Set only on `noncombat` bodies. A soldier marches at the enemy because that
   * is what the advance is; a gatherer walks to a specific piece of ground and
   * then walks back, so it needs somewhere to be told about.
   */
  errandX: number | null = null

  x: number
  y: number
  /** Which of the five files this soldier walks. Fixed at spawn — unless
   * the soldier is a flanker, whose own rule may move it once blocked. */
  lane = 2
  /**
   * Every file this unit occupies. One entry for a soldier; three for a war
   * machine wide enough to stand across its neighbours. Kept as a list rather
   * than derived on the fly because it is read in the inner targeting loop.
   */
  lanes: number[] = [2]
  /**
   * A machine wide enough to straddle files is reachable from any of them, at
   * whatever height its attacker happens to stand.
   *
   * Same rule as a fortress, and for the same reason: a Titan is 250 pixels
   * tall, so its centre of mass sits 125 above the ground line, and measuring
   * to it would put a swordsman in the next file 130 pixels away against a
   * reach of 40. He would walk forever and never swing at a thing he is
   * standing underneath. Which files may hit it is a RULE — `lanes` — not an
   * accident of how tall the art turned out.
   */
  readonly flatContact: boolean
  /** The ground line of this soldier's lane, in world pixels. */
  groundLine: number
  /** Smoothed visual ride over the terrain relief — lift in px, lean in rad. */
  private visualLift = 0
  private visualTilt = 0
  /** Banner garrison stamps, re-applied by the sim every tick. */
  bannerZeal = 0
  bannerReach = 0
  /** The occult took this one's soul as it died: it cannot rise again. */
  banished = false
  /** Standing in own blight: hostile control drains three times as fast. */
  cleansing = false
  /** Effect latches, so a per-tick rule shows its effect once per event. */
  buriedShown = false
  private wardShown = false
  private purgeShow = 0
  hp: number
  maxHp: number
  /**
   * The health this body was fielded with, before anything grew it.
   *
   * The Monstrum's appetite is priced against this rather than against a flat
   * number of points, so the growth the rule exists to show stays the same
   * fraction of the body however the stat curves are re-laid.
   */
  readonly spawnMaxHp: number
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
  /**
   * The same measurement, unclamped and in units of the soldier's own max hp.
   *
   * `overkill` is capped at 2 because everything that reads it — how far the
   * pieces are thrown, how much blood comes out — saturates anyway. Death
   * Throes needs to tell "one jab too many" from "a shell", and at the cap
   * those are the same number.
   */
  private overkillFrac = 0
  private lastHitType: DamageType = 'blunt'
  private lastHitDir = 0
  /**
   * Whether the last blow that landed was a critical.
   *
   * Butchery reads it: a crit KILL takes the body apart completely, and an
   * ordinary one does not. Set on every hit, so it can never be stale.
   */
  private lastHitCrit = false

  /**
   * The killing blow, for whoever has to clean up afterwards.
   *
   * The spoils a body leaves are decided by how it died — a spear leaves a
   * skull, a club leaves meat, a shell leaves a stain — so the death handler
   * needs both of these, and neither is otherwise readable from outside.
   */
  get lastDamageType(): DamageType {
    return this.lastHitType
  }

  get lastOverkill(): number {
    return this.overkillFrac
  }

  get lastWasCrit(): boolean {
    return this.lastHitCrit
  }

  /**
   * Death Throes. Milliseconds this body has left on its feet after dying.
   *
   * While this is running the soldier is `alive` in every sense the rest of the
   * simulation cares about — it holds its file, it swings, it can be shot — but
   * it is already dead, so nothing may heal it and it may not enter the state
   * twice.
   */
  throesMs = 0
  private throesSpent = false
  private throesBleed = 0
  /** Both arms are off. It can walk and bleed; it cannot swing. */
  armsGone = false

  /**
   * Gold's worth of enemy this soldier has personally killed.
   *
   * The Incarnation of Slaughter auditions on it: the most expensive melee body
   * to kill three times its own price gets taken. Counted per soldier, in the
   * victims' per-head price, so a squad card cannot inflate it.
   */
  slain = 0
  /**
   * POSSESSED. Milliseconds this body has left as the Incarnation, and the
   * accelerating bleed that is going to end it.
   */
  incarnateMs = 0
  incarnateFor = 0
  get incarnate(): boolean {
    return this.incarnateMs > 0
  }
  /**
   * The Incarnation took somebody else's soldier. It no longer knows whose side
   * it was on and will swing at the nearest living thing, friend or otherwise.
   */
  rogue = false
  /** Permanent growth a Monstrum has eaten its way into, for the read. */
  gorged = 0
  /**
   * THE LEAP. Which beat of the hit-and-run a Ripjaw is on, and how long is
   * left of it. 0 stalk · 1 in the air · 2 striking · 3 withdrawing.
   */
  leapPhase = 0
  leapMs = 0
  /**
   * THE STEP. Time left before the demon-lord may blink to fresh ground.
   *
   * Separate from `leapMs` because the two are different fantasies on different
   * clocks — a Ripjaw's leap is a physical arc the physics owns, while a step
   * is instantaneous and ignores everything in between.
   */
  stepMs = 0
  /**
   * A deliberate leap does not hurt on landing. Without this the fall-damage
   * rule — which exists to punish being THROWN — would bill a raider for every
   * jump it made on purpose.
   */
  landsSoft = false
  /** The Shrike took the head off this one. It drops where the body does. */
  beheaded = false
  /**
   * Shared clock for the bodies that work on what is lying around them — the
   * Monstrum's bite, the Flesh Wall's mending, the Flesh Wagon's rendering. One
   * field because no unit is more than one of those things.
   */
  eatTimer = 0

  /**
   * A Monstrum wears its meals. The rig is scaled up as it feeds, so an
   * opponent can see how badly they have fed it from across the field — the
   * growth is the warning, and it has to be legible before it is lethal.
   */
  setGorge(total: number): void {
    const grow = Math.min(0.85, total * 0.014)
    this.gorgeScale = 1 + grow
  }

  /**
   * A carrier holding brains gets visibly heavier, on the same scale channel the
   * Monstrum's gorge uses — a body that has been fed reads as fed whatever fed
   * it, and one soldier cannot be doing both.
   */
  private applyBrainWeight(): void {
    this.gorgeScale = 1 + Math.min(0.4, this.brainShow * 0.03)
  }

  private gorgeScale = 1

  /**
   * Crabs are drawn as a count of small clinging things rather than as sprites,
   * so a rank carrying eighty of them between it costs eighty numbers and not
   * eighty game objects. The visual is one badge and a tint: past a handful the
   * soldier reads as infested from across the board, which is the information
   * that matters — the exact number is on the health bar's business.
   */
  setCrabs(total: number): void {
    this.crabShow = total
  }

  /** Brains a carrier is holding, so the body visibly gets heavier with them. */
  setBrains(total: number): void {
    this.brainShow = total
    this.applyBrainWeight()
  }

  private crabShow = 0
  private brainShow = 0

  get inThroes(): boolean {
    return this.throesMs > 0
  }

  /** Horizontal knockback velocity, decays with friction. */
  vx = 0
  /** Vertical velocity — only non-zero while a unit is airborne from a big hit. */
  vy = 0
  private airborne = false
  stagger = 0
  /**
   * Plunder.
   *
   * A soldier who reaches the enemy's wall in a file that is not allowed to
   * attack it, with nothing else in reach, used to stand there for the rest of
   * the match — measured: six of them walked the length of the board, arrived,
   * and held zero targets for seventy-five seconds. The wall being SOLID in
   * every file and only the gate files being allowed to hit it are two rules
   * that did not compose.
   *
   * He is not stuck now, he is looting. He stands in the yard cutting the
   * supply line (which was already a rule and had no visible payoff), and then
   * he leaves the board with what he could carry and sends part of his price
   * home. It is a REFUND, never a profit — the rest is the tempo you paid for
   * sending him up a flank instead of at the gate.
   */
  plunderMs = 0
  /** Set once he has finished looting: walks off the board and is gone. */
  leaving = false

  /** Move this soldier to another lane. Only the battlefield calls this. */
  setLane(lane: number): void {
    this.lane = Math.max(0, Math.min(LANE_Y.length - 1, lane))
    this.lanes = spannedLanes(this.lane, this.def.laneSpan ?? 1)
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
    // The dead keep their file but not their place in it. Re-staging a corpse
    // lifted it back out of the ground and into the living order, so a body
    // drew over the soldier standing on it.
    if (this.layer === 'ground' && this.alive) {
      this.container.setDepth(onGround(this.lane, SLOT.unit, offset * 0.02))
    }
  }

  /** Grace left on the licence to shoot from formation. See formedUp(). */
  private holdMs = 0
  /** Recent shoves, each one making the next one count for less. */
  private knockStacks = 0
  /** How long this soldier has been pressed against its own line, in ms. */
  private blockedMs = 0

  /**
   * A bound ward: a flat pool that drinks part of ONE blow rather than shaving
   * every blow. Refills when this soldier kills — see `drills.ts`.
   *
   * Deliberately flat rather than a percentage. The Bonecrusher is a screen,
   * so its job is to eat the biggest thing pointed at the line; an absorb that
   * blunts one heavy hit does that, where a percentage would just make it
   * quietly better against chip damage it was already surviving.
   */
  ward = 0
  wardMax = 0
  /**
   * A raider mid-pounce. Brief, and only ever set by Beast Sense.
   *
   * Without it the drill was aim without legs: a raptor still spent six
   * seconds walking into a gun line's teeth to reach the file it had picked,
   * and arrived dead. The lunge is what makes the decision pay.
   */
  lungeMs = 0

  /**
   * How many friendly soldiers are packed in ahead of this one in its file.
   * Set by the battlefield each step; 0 means it is the front rank.
   */
  ranksAhead = 0

  /**
   * Whether this soldier can physically bring its weapon to bear from where it
   * is standing.
   *
   * The press rule has always been written as "only the front rank of a column
   * can physically reach the enemy, and the ranks behind put their shoulders
   * into the blow" — that is what `press` IS. The simulation never enforced the
   * first half of it, so a rank that was already being counted as a shoulder
   * was ALSO swinging its own weapon, and a deep file got paid twice.
   *
   * A shooter is unaffected: it looses over the men in front, which is the
   * whole reason to stand behind them.
   */
  private canBringToBear(): boolean {
    if (this.def.attack.kind !== 'melee') return true
    // Long hafts reach over exactly one man. Two is a crowd.
    return this.ranksAhead <= (this.def.drill?.overhead ? 1 : 0)
  }
  /** Health a second left behind by a Shaman's hands, and how long is left of it. */
  mendRate = 0
  mendMs = 0
  /** Lanes the current shot crosses: 0 own file, 1 next door, 2 plunging. */
  crossLaneShot = 0
  /**
   * The derelict seat that sent this soldier out for free, if any. Held so the
   * seat's standing cap is released when it dies — otherwise an outpost stops
   * producing forever the first time its three soldiers are killed.
   */
  fromSeat: { aliveFromHere: number } | null = null

  /**
   * Eats no supply. A Thrall Pit's turned dead are somebody else's soldiers
   * being spent, so an occult commander stops paying their own cap for them.
   */
  freeUpkeep = false
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

  attackCooldown = 0
  private swing = 0
  private burstLeft = 0
  private burstTimer = 0
  /**
   * How long a half-fired burst will wait for something else to shoot at.
   *
   * A burst used to be thrown away the instant its target died, which punished
   * exactly the weapons that were good at their job: a machine gunner that
   * killed on round two lost rounds three through eight AND still paid the full
   * cooldown, so the highest nominal damage in its age measured as the worst
   * unit in it. A gunner mid-burst now traverses onto whatever is next, and
   * only stops when there is genuinely nothing left in front of it.
   */
  private burstGrace = 0
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
  /** Milliseconds left of a Bonepicker's stoop — the animation reads this. */
  private stoopMs = 0

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

  /** Acolyte's dying curse: while this runs, the soldier swings 20% softer. */
  cursedFor = 0
  /** The Hexer's mark: while this runs, everything hits this soldier 25% harder. */
  hexedFor = 0
  /** Cooldown for pulsing specials — the Thrallmaster's chant, the Mycelic's roots. */
  pulseTimer = 0
  /** Toxin: damage per second still working through this soldier's blood. */
  poisonDps = 0
  poisonFor = 0
  /** The Seer's terror: while this runs, this soldier swings 15% slower. */
  terrorFor = 0
  /**
   * CRABS RIDING THIS SOLDIER. The Brain Stealer's whole mechanism.
   *
   * They do almost nothing on their own — a couple of points a second each — and
   * they never fall off. What they change is the height at which this soldier can
   * simply be FINISHED: every crab raises the execute line by one percent of his
   * maximum health, so a rank that has been spat on for thirty seconds dies to
   * chip damage all at once. And a soldier who dies while carrying them has one
   * of them walk his head home. See `Battlefield.updateCrabs`.
   */
  crabs = 0
  /** Which side put them there, so it is the side that is paid for them. */
  crabFaction: Faction = 'enemy'
  /** Brains this soldier has been brought. It turns them into research, slowly. */
  brains = 0
  /**
   * A Skinrider is on this soldier's back, and while it is there he cannot swing.
   * Refreshed by every blow the rider lands, so shaking one off means killing it.
   */
  riddenFor = 0
  /** Charge: the first blow after arriving lands half again as hard. */
  chargeReady = true
  private disengagedMs = 0

  private world: UnitWorld
  private scene: Phaser.Scene
  private container: Phaser.GameObjects.Container
  private parts: Record<string, Phaser.GameObjects.Image> = {}
  private shadow: Phaser.GameObjects.Image
  private teamRing: Phaser.GameObjects.Image
  /** The conduct glyph floated over rule-carrying soldiers, if any. */
  private conductMark?: Phaser.GameObjects.Image
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
    this.facing = this.dir
    this.world = world

    this.hp = def.hp
    this.maxHp = def.hp
    this.spawnMaxHp = def.hp
    this.ward = def.drill?.ward ?? 0
    this.wardMax = this.ward
    this.radius = def.height * 0.24 * (def.visual.bulk ?? 1)
    this.centerOffsetY = -def.height * 0.5

    this.x = x
    this.lane = Math.max(0, Math.min(LANE_Y.length - 1, lane))
    this.lanes = spannedLanes(this.lane, def.laneSpan ?? 1)
    this.flatContact = (def.laneSpan ?? 1) > 1
    this.groundLine = world.groundY + LANE_Y[this.lane]
    // Air lane jitter is gameplay-affecting (it changes engagement range),
    // so it comes from the caller's deterministic stream, not the shared
    // cosmetic one.
    this.y = def.layer === 'air' ? world.airY + (spawnJitter ?? 0) : this.groundLine

    this.scaleFactor = 1 / RES
    this.container = scene.add.container(this.x, this.y)
    this.container.setDepth(def.layer === 'air' ? BAND.air : onGround(lane))


    this.shadow = scene.add
      .image(this.x, this.groundLine + 2, 'fx:shadow')
      .setDepth(BAND.decal + 4)
      .setAlpha(def.layer === 'air' ? 0.22 : 0.4)
      .setDisplaySize(def.height * 0.9, def.height * 0.26)

    // A faction-coloured ring on the ground: the fastest read of whose side a
    // soldier is on, even in a crowded melee.
    this.teamRing = scene.add
      .image(this.x, this.groundLine + 1, 'fx:soft')
      .setDepth(BAND.decal + 5)
      .setTint(FACTION_COLOR[faction])
      .setAlpha(0.62)
      .setDisplaySize(def.height * 0.78, def.height * 0.26)

    // The conduct glyph: which fixed rule this piece plays by, at a glance.
    ensureConductGlyphs(scene)
    const glyphKey = glyphKeyFor(def)
    if (glyphKey) {
      // Beside the team ring, like the stand of a chess piece — clear of the
      // head, the rank pips and the health bar.
      this.conductMark = scene.add
        .image(this.x + this.dir * (this.radius + 7), this.groundLine + 1, glyphKey)
        .setDepth(BAND.decal + 6)
        .setTint(FACTION_COLOR[faction])
        .setAlpha(0.9)
    }

    // Seed the pacing reference, or the first frame reads the whole spawn
    // offset as distance travelled and snaps the walk cycle.
    this.lastVisualX = this.x
    this.buildRig()

    const barW = Math.max(24, def.height * 0.62)
    this.hpBarBg = scene.add.rectangle(0, 0, barW + 2, 5, 0x08111f, 0.85).setDepth(BAND.chrome).setOrigin(0.5)
    this.hpBar = scene.add
      .rectangle(0, 0, barW, 3, FACTION_COLOR[faction], 1)
      .setDepth(BAND.chrome + 1)
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
    // A wall is at your height whatever file you are standing in. Only bodies
    // are measured to their centre.
    const dy = other.flatContact ? 0 : Math.abs(other.y + other.centerOffsetY - this.centerY)
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
   * High-ground volleys: a shooter standing on a mound of the settled dead
   * sees further and throws further — 12% more reach on ground six pixels or
   * higher. Positioning rule, open to both sides, and its counter is built
   * into the world: shell the mound away, quarry it, or fight on the flat.
   */
  /**
   * The visual ride over the relief. The drawn ground is 1.5× the sim's mound
   * height (and 1:1 for craters), so the feet track THE PICTURE, not the sim
   * numbers — anything else buries soldiers to the shins in their own dead.
   * Lift and lean are smoothed so the 8px relief buckets read as a slope
   * being climbed rather than a staircase being teleported up.
   */
  private updateGroundRide(dtMs: number): void {
    if (this.layer !== 'ground') {
      this.visualLift = 0
      this.visualTilt = 0
      return
    }
    const surface = (x: number): number => {
      const h = this.world.reliefAt?.(x, this.lane) ?? 0
      return h > 0 ? Math.min(27, h * 1.5) : Math.max(-12, h)
    }
    let lift = surface(this.x)
    const slope = (surface(this.x + 14) - surface(this.x - 14)) / 28
    let tilt = Math.max(-0.16, Math.min(0.16, -Math.atan(slope) * 0.55))
    // A Bonepicker's stoop. Folded in here so both draw paths — rigged and
    // sprite-stack — get it for nothing: the soldier drops and leans forward
    // over whatever it is eating, then straightens up again.
    if (this.stoopMs > 0) {
      const t = 1 - Math.abs(this.stoopMs / BONEPICKER_STOOP_MS - 0.5) * 2
      lift -= this.def.height * 0.2 * t
      tilt += 0.5 * t
    }
    const blend = Math.min(1, dtMs / 110)
    this.visualLift += (lift - this.visualLift) * blend
    this.visualTilt += (tilt - this.visualTilt) * blend
  }

  get highGround(): number {
    if (this.layer !== 'ground') return 1
    const attack = this.def.attack
    if (attack.kind !== 'projectile' && attack.kind !== 'beam') return 1
    const h = this.world.reliefAt?.(this.x, this.lane) ?? 0
    return h >= 6 ? 1.12 : 1
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
    const planted = this.def.special === 'siege_mode' ? 1 + 0.4 * (this.rooting / 4000) : 1
    const wanted = this.def.range * this.rangeMult * this.highGround * planted * (1 + this.bannerReach)
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

  takeDamage(amount: number, type: DamageType, source?: Damageable, knockback = 0, crit = false): void {
    if (!this.alive) return
    this.lastHitCrit = crit
    let mult = damageMultiplier(type, this.armor)
    // THE HEX UNMAKES EVERY WARD: while the mark burns, plating does not
    // glance, formations do not share, roots do not hold and barriers do not
    // barrier. This is how the occult opens an engineering line — not by
    // hitting harder, but by making the engineering stop being true.
    const hexed = this.hexedFor > 0
    // The moment a hex actually costs this unit a ward, show it coming apart.
    if (hexed && !this.wardShown && (this.def.special === 'plating' || this.linked > 0 || this.rooting > 0 || this.auraShield > 0)) {
      this.wardShown = true
      this.world.vfx.wardBreak(this.x, this.centerY)
    }
    if (!hexed) this.wardShown = false
    // Plating: purpose-built against small arms — pierce and slash glance off.
    if (!hexed && this.def.special === 'plating' && (type === 'pierce' || type === 'slash')) mult *= 0.75
    // Aegis: a soldier in formation takes a share, not the whole blow. Break
    // the formation and the protection goes with it.
    const shared = !hexed && this.linked > 0 ? 1 - Math.min(0.4, this.linked * 0.14) : 1
    // Rooted: a soldier that has not moved is dug in, and it shows.
    const dugIn = hexed ? 1 : 1 - Math.min(0.35, (this.rooting / 4000) * 0.35)
    let reduced = (amount * mult * (1 - (hexed ? 0 : this.auraShield)) * shared * dugIn) / this.toughness
    // The ward drinks its share of this blow and is spent by it. A hex unmakes
    // every other barrier in the game, so it unmakes this one too.
    let warded = false
    if (!hexed && this.ward > 0) {
      const drunk = Math.min(this.ward, reduced)
      this.ward -= drunk
      reduced -= drunk
      warded = true
      this.world.vfx.impact(this.x, this.centerY, 0xb46bff, 0.9, false)
    }
    const before = this.hp
    this.hp -= reduced
    this.lastHitType = type
    if (source) this.lastHitDir = Math.sign(this.x - source.x) || -this.dir
    // Overkill as a fraction of the unit's own health: how far past dead the
    // blow carried it, which is a better measure of violence than raw damage.
    if (this.hp <= 0) {
      const past = reduced - Math.max(0, before)
      this.overkillFrac = past / Math.max(1, this.maxHp)
      this.overkill = Math.min(2, past / Math.max(1, this.maxHp * 0.5))
    }
    this.flashTimer = FLASH_MS

    const color = type === 'energy' ? 0x9fe8ff : type === 'explosive' ? 0xffa640 : 0xffe08a
    const organic = this.def.visual.kind === 'humanoid' || this.def.visual.kind === 'rider'
    this.world.vfx.impact(this.x, this.centerY, color, Math.min(2, reduced / 60 + 0.5), organic)
    this.world.vfx.damageNumber(this.x, this.centerY - this.def.height * 0.35, reduced, mult > 1.15 ? 0xffd166 : 0xffffff, mult > 1.3)

    // A soldier behind a standing ward is not moved by anything. This is half
    // of what the ward is for: a gun line used to walk a screen backwards for
    // the whole engagement, and a screen that can be pushed is not a screen.
    if (knockback !== 0 && warded && this.ward > 0) knockback = 0
    if (knockback !== 0) {
      // A NEGATIVE shove is a PULL. The Great Maw does not push things away
      // from itself; it drags them in, which is the whole reason it is a threat
      // rather than a slow gun. A dragged body is not thrown, so it never goes
      // airborne — it just loses the argument about where it is standing.
      const pull = knockback < 0
      knockback = Math.abs(knockback)
      // Diminishing returns. Massed light fire used to pin a line in place
      // forever: every pebble set the stagger timer and added its own shove, so
      // a front rank under fire from twenty slingers spent most of each second
      // unable to act and was pushed back as fast as it could walk. That, and
      // not the damage, is what made long range with knockback strictly the
      // best thing to buy. Each shove now counts for less than the last, and
      // the stacks bleed off over about a second of not being hit.
      const raw = (knockback / Math.max(0.4, this.def.mass)) * 1.6 / (1 + this.knockStacks)
      const impulse = Math.min(raw, Math.max(120, this.def.speed * KNOCK_SPEED_CAP))
      this.knockStacks = Math.min(6, this.knockStacks + 1)
      this.vx += (pull ? this.dir : -this.dir) * impulse
      if (!pull && impulse > 150 && this.layer === 'ground') {
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

  /** Bend this body over the ground for a moment. Purely something to look at. */
  stoop(ms = BONEPICKER_STOOP_MS): void {
    this.stoopMs = Math.max(this.stoopMs, ms)
  }

  /**
   * WHAT IS IN THE SACK, drawn over the carrier's shoulder.
   *
   * A gatherer walking home is the visible half of the harvest, and until this
   * existed you could see one walking but not what it had been walking for. Now
   * the last thing it picked up rides above it — a red lump, a skull, a femur —
   * so a whole economy is legible from across the field without a single number.
   */
  showBurden(kind: 'meat' | 'skull' | 'bone' | null): void {
    if (!kind) {
      this.burden?.destroy()
      this.burden = undefined
      return
    }
    const key = BURDEN_TEXTURE[kind]
    if (!this.scene.textures.exists(key)) return
    if (!this.burden) {
      this.burden = this.scene.add.image(this.x, this.centerY, key).setDepth(BAND.ground + 6)
    }
    this.burden.setTexture(key).setTint(BURDEN_COLOR[kind]).setScale(this.scaleFactor * 1.25)
  }

  private burden?: Phaser.GameObjects.Image

  private updateBurdenVisual(): void {
    if (!this.burden) return
    if (!this.alive) {
      this.burden.destroy()
      this.burden = undefined
      return
    }
    // Rides on the shoulder away from the way it is walking, and bobs with the
    // gait so it reads as carried rather than as a decal.
    this.burden.setPosition(
      this.x - this.facing * this.def.height * 0.24,
      this.centerY - this.def.height * 0.52 + Math.sin(this.animTime / 160) * 1.5
    )
    this.burden.setFlipX(this.facing < 0)
  }

  heal(amount: number): void {
    if (!this.alive || this.inThroes) return
    const before = this.hp
    this.hp = Math.min(this.maxHp, this.hp + amount)
    if (this.hp > before) {
      this.healPulseTimer = 180
      this.world.vfx.damageNumber(this.x, this.centerY - this.def.height * 0.4, this.hp - before, 0x9ff0c8)
    }
  }

  kill(killer?: Damageable): void {
    if (!this.alive) return
    // DEATH THROES. The body has not been told. It loses a limb or two to the
    // blow that killed it and then goes on fighting for two seconds, and only
    // when that runs out does the rest of this method happen.
    if (this.tryThroes(killer)) return
    // The ward reknits on a kill. It is the whole reason a warded screen holds
    // a file rather than merely surviving the first exchange in it.
    if (killer instanceof Unit && killer.wardMax > 0 && killer.alive) killer.ward = killer.wardMax
    // A dead soldier is dropped from the aura pass, so nothing would come back
    // to clear its glow — take it down here rather than leaving it burning
    // over a corpse.
    this.ward = 0
    this.wardSprite?.destroy()
    this.wardSprite = undefined
    this.showBurden(null)
    this.alive = false
    this.state = 'dead'
    this.hp = 0
    this.hpBar.destroy()
    this.hpBarBg.destroy()
    this.rankMark?.destroy()
    this.rankMark = undefined
    this.conductMark?.destroy()
    this.conductMark = undefined
    this.teamRing.setAlpha(0.25)
    // Out of the living order and into the ground, in its own file. Set here
    // rather than in the topple animation, because a body that comes apart is
    // still a body: the dismember branch used to leave the wreckage sorted as
    // if it were standing up and fighting.
    if (this.layer === 'ground') {
      this.container.setDepth(onGround(this.lane, SLOT.corpse, this.stageY * 0.002))
    }

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
    //
    // BUTCHERY is the exception, and a precise one: a body finished by a
    // CRITICAL comes apart completely, however small the blow was. Paired with
    // the ten points of crit chance the node also grants, that is what makes a
    // butcher's line a butcher's line — it is not that everything they kill
    // bursts, it is that the good hits do, and they land more good hits.
    //
    // Demolition means the body was carrying something that has not gone off.
    const butchered = (this.techs?.has('butchery') ?? false) && this.lastHitCrit
    if (this.techs?.has('demolition')) this.world.onDeathCharge?.(this)
    // How readily a body comes apart is the era speaking. Two stone-age
    // spearmen kill each other and both fall over whole; by the last age the
    // same field is a slaughterhouse. Bloodlust drags the bar down a whole age
    // early, wherever it happens in history.
    const era = this.def.age
    const bar = [1.2, 0.9, 0.65, 0.45, 0.3][era] - (this.techs?.has('bloodlust') ? 0.15 : 0)
    const explosiveTears = this.lastHitType === 'explosive' && era >= 1
    if (butchered || this.overkill >= bar || explosiveTears) {
      this.dismember(mechanical)
    } else {
      this.bleedOut(mechanical)
      this.playDeathAnimation(mechanical)
    }
  }

  /**
   * DEATH THROES — two more seconds, taken out of the enemy.
   *
   * Returns true when the body has been put into its throes and the real death
   * must be deferred. The gate is the honest one: how far past dead the killing
   * blow carried it, measured in its own max health. A jab, an arrow, one more
   * swing of a club — the body has not registered it and keeps working. A
   * shell, a boulder, a Titan's fist — there is nothing left standing to argue
   * with, and that is the counter to the whole node.
   *
   * Machines are excluded. A wrecked chassis does not get angry.
   */
  private tryThroes(killer?: Damageable): boolean {
    if (this.throesSpent || !(this.techs?.has('death_throes') ?? false)) return false
    if (this.layer !== 'ground') return false
    const kind = this.def.visual.kind
    if (kind !== 'humanoid' && kind !== 'rider') return false
    if (this.overkillFrac > 1) return false

    this.throesSpent = true
    this.throesMs = THROES_MS
    this.throesBleed = 0
    // Something is left to shoot off it, so a side that keeps firing into the
    // corpse still ends this early. It is two seconds of swings, not a shield.
    this.hp = Math.max(1, this.maxHp * THROES_POOL)
    this.state = 'engage'
    this.severLimbs()
    this.world.vfx.gore(this.x, this.centerY, 1.4)
    this.world.vfx.floatingLabel(this.x, this.centerY - this.def.height * 0.7, 'still up', '#c0392b')
    void killer
    return true
  }

  /**
   * The blow took something with it. Arms only — a rig walking on half a leg
   * reads as a bug rather than as an atrocity, and the arms are where the
   * mechanic lives anyway.
   */
  private severLimbs(): void {
    const front = ['upperArmF', 'foreArmF', 'handF', 'weapon']
    const back = ['upperArmB', 'foreArmB', 'handB']
    // A heavier blow takes both. Anything gentler takes one, and usually the
    // off hand — most bodies in throes are still swinging, which is the point.
    const both = this.overkillFrac > 0.6
    const groups = both ? [front, back] : this.world.rng.chance(0.35) ? [front] : [back]
    let lostWeapon = both
    for (const group of groups) {
      if (group === front) lostWeapon = true
      for (const name of group) this.throwLimb(name)
    }
    // Losing the weapon hand is losing the weapon. What is left can walk into
    // the enemy and bleed on them, and that is all.
    this.armsGone = lostWeapon
  }

  /** One rigged part, taken off the body and thrown as a physics gib. */
  private throwLimb(name: string): void {
    const part = this.parts[name]
    if (!part || !part.visible) return
    const rand = this.world.rng
    const away = this.lastHitDir || -this.dir
    // Same rule as `dismember`: the spawn point comes from the SIMULATION's
    // stream, never off the animated sprite, whose bone chain runs on
    // transcendentals that are not bit-identical across engines.
    const scatter = this.def.height * 0.3
    this.world.physics.spawn(
      'gib',
      this.x + rand.spread(scatter) * this.dir,
      this.y - this.def.height * 0.55 + rand.spread(scatter * 0.6),
      away * rand.range(60, 190) + rand.spread(60),
      -rand.range(80, 260),
      {
        texture: part.texture.key,
        originX: part.originX,
        originY: part.originY,
        flip: this.dir < 0,
        rot: part.rotation,
        spin: rand.spread(9),
        mass: 0.9,
        size: this.scaleFactor,
        color: part.tintTopLeft ?? 0xffffff,
        faction: this.faction,
        bleed: 900,
        floor: this.groundLine
      }
    )
    part.setVisible(false)
  }

  /** Counts the throes down, empties the body onto the ground, then ends it. */
  private stepThroes(dtMs: number): void {
    this.throesMs -= dtMs
    this.throesBleed -= dtMs
    if (this.throesBleed <= 0) {
      this.throesBleed = THROES_BLEED_MS
      const rand = this.world.rng
      for (let i = 0; i < 2; i += 1) {
        this.world.physics.spawn(
          'blood',
          this.x + rand.spread(this.def.height * 0.2),
          this.centerY - rand.range(0, this.def.height * 0.3),
          rand.spread(120),
          -rand.range(20, 140),
          { size: rand.range(0.5, 1), floor: this.groundLine }
        )
      }
    }
    if (this.throesMs <= 0) {
      this.throesMs = 0
      this.hp = 0
      this.kill()
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
      // Deterministic spawn coordinates, from the simulation's own stream.
      //
      // These used to be read straight off the ANIMATED sprite part —
      // `part.x`/`part.y` are written by the rig, whose bone chain and IK run on
      // Math.sin, cos, atan2, acos and hypot. Those are not bit-identical
      // between engines, which is the entire reason `sim/dmath.ts` exists, and
      // `physics.hash()` mixes every gib's rounded position. So a body coming
      // apart put a Chrome-shaped number and an Android-WebView-shaped number
      // into the fingerprint, and a cross-platform match forked on the first
      // dismemberment. This was the door the transcendentals came back in
      // through.
      //
      // The visual is unchanged — the body still carries the part's texture,
      // origin and rotation. Only WHERE the physics thinks it started is now
      // the simulation's business rather than the animation's.
      const scatter = this.def.height * 0.42
      const worldX = this.x + rand.spread(scatter) * this.dir
      const worldY = this.y - this.def.height * 0.5 + rand.spread(scatter * 0.7)
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
          // TORN LIMBS ARE SPECTACLE, NOT INCOME.
          //
          // They used to lie on the field forever and be the fuel every remains
          // rule read — so a match accumulated three visually similar kinds of
          // debris meaning three different things, and none of them was legible.
          // The economy runs on SPOILS now: tinted, iconic, priced, decaying.
          // These are the moment of death and nothing else, so they land, they
          // are seen, and they go.
          ttl: 5200,
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
    let drops = Math.max(3, Math.round(8 * [0.35, 0.55, 0.8, 1, 1.2][this.def.age]))
    // A banished body is mostly gone before it lands.
    if (this.banished) drops = Math.max(1, Math.round(drops * 0.5))
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
    // The garden cleanses: own blight underfoot burns hostile control off.
    const purge = this.cleansing ? 3 : 1
    if (purge > 1 && (this.miredFor > 0 || this.hexedFor > 0 || this.terrorFor > 0)) {
      this.purgeShow -= dtMs
      if (this.purgeShow <= 0) {
        this.purgeShow = 700
        this.world.vfx.cleanse(this.x, this.groundLine - 6)
      }
    }
    this.cleansing = false
    if (this.miredFor > 0) this.miredFor -= dtMs * purge
    if (this.cursedFor > 0) this.cursedFor -= dtMs
    if (this.hexedFor > 0) this.hexedFor -= dtMs * purge
    if (this.terrorFor > 0) this.terrorFor -= dtMs * purge
    // A rider is shaken off by killing it, not by waiting — but if it stops
    // landing blows (it died, or it was knocked clear) the hold lapses quickly.
    if (this.riddenFor > 0) this.riddenFor -= dtMs
    if (this.poisonFor > 0) {
      this.poisonFor -= dtMs
      this.hp -= this.poisonDps * (dtMs / 1000)
      if (this.hp <= 0) this.kill()
      if (this.poisonFor <= 0) this.poisonDps = 0
    }
    // The charge re-arms after a moment out of the fight.
    if (this.state !== 'engage') {
      this.disengagedMs += dtMs
      if (this.disengagedMs > 1500) this.chargeReady = true
    } else {
      this.disengagedMs = 0
    }
    if (this.disabledFor > 0) {
      this.disabledFor -= dtMs
      // A disabled machine still falls, still gets shot, and still slides —
      // it just stops deciding things.
      this.x += this.vx * dt
      this.container.setPosition(this.x, this.y + this.stageY - this.visualLift)
      return
    }
    // Death Throes runs before anything that could put health back: a body
    // that has already died does not regenerate, does not take a mend and
    // cannot be scavenged back onto its feet. It only empties.
    if (this.throesMs > 0) {
      this.stepThroes(dtMs)
      if (!this.alive) return
    }
    if (this.def.regen && !this.inThroes) this.hp = Math.min(this.maxHp, this.hp + this.def.regen * dt)
    if (this.lungeMs > 0) this.lungeMs -= dt * 1000
    // Spore Touch: what a Shaman mends keeps mending.
    if (this.mendMs > 0) {
      this.mendMs -= dt * 1000
      if (!this.inThroes) this.hp = Math.min(this.maxHp, this.hp + this.mendRate * dt)
    }

    this.frenzy =
      this.techs?.has('bloodlust') && this.layer === 'ground'
        ? 1 + Math.min(0.45, (this.world.goreAt?.(this.x) ?? 0) * 0.45)
        : 1
    // The ground rules speak here too: a carnage soldier on its mound works
    // faster; anyone standing on the occult's fed ground works slower. Both
    // are capped and both end the moment the soldier steps off the ground
    // that caused them.
    this.frenzy *= (1 + this.groundFury * 0.28) * (1 - this.dread * 0.12) * (this.terrorFor > 0 ? 0.85 : 1)
    // THE HUNGER. The fewer of you there are, the harder what is left of you
    // fights — up to half again as fast once you are badly outnumbered.
    //
    // Measured against the ENEMY's living count rather than your own population
    // cap, and deliberately so: a cap-based reading would hand the bonus out at
    // full strength on the opening frame of a match, when both sides have nothing
    // on the field, turning a last-stand node into a rush node. A ratio cannot do
    // that — two empty fields are not outnumbered.
    if (this.techs?.has('the_hunger')) {
      this.frenzy *= 1 + 0.5 * (this.world.outnumbered?.(this.faction) ?? 0)
    }
    // The carnage banner rally: fury for the garrison holding the flag.
    this.frenzy *= 1 + this.bannerZeal
    // Bonepickers feed on what is lying around them while they are hurt.
    //
    // It used to happen four times a second and entirely in the numbers: a
    // wounded soldier standing on a heap simply had a health bar that went up.
    // Now it is an ACT — the soldier stoops, the piece bursts, and the ground
    // gets messier — and because you can see it, it is on a clock you can read.
    if (this.stoopMs > 0) this.stoopMs -= dtMs
    if (this.techs?.has('bonepickers') && this.hp < this.maxHp * 0.92 && !this.inThroes) {
      this.scavengeTimer -= dtMs
      if (this.scavengeTimer <= 0) {
        this.scavengeTimer = BONEPICKER_MS
        // The bend-down is what the animation reads; the world decides whether
        // there was actually anything down there to eat.
        this.stoopMs = BONEPICKER_STOOP_MS
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
        const fall = Math.abs(this.vy)
        if (fall > 200) {
          this.world.vfx.footDust(this.x, this.groundLine)
          this.world.vfx.impact(this.x, this.world.groundY - 6, 0xbfae8a, 0.6, false)
        }
        // LANDING BADLY. Being thrown was a free ride until now: a blast
        // that launched a soldier merely carried it out of the melee, which
        // is why the throwing techs measured as a mercy to the enemy. A hard
        // landing costs, and it costs the heavy most — armour does not help
        // you meet the ground. Capped, so this never one-shots.
        if (fall > 360 && this.alive && !this.landsSoft) {
          const hurt = Math.min(this.maxHp * 0.22, (fall - 360) * 0.11 * (0.7 + this.def.mass * 0.15))
          if (hurt > 1) {
            this.takeDamage(hurt, 'blunt')
            this.stagger = Math.max(this.stagger, 260)
            this.world.vfx.impact(this.x, this.groundLine - 6, 0xd8c8a8, 0.8, true)
          }
        }
        this.landsSoft = false
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
    // AN ERRAND OUTRANKS A FIGHT.
    //
    // This used to sit below the engagement test, which quietly cancelled the
    // Ripjaw's whole raid: it landed next to something alive, the engage branch
    // won every frame, and the withdrawal it had been given never moved it a
    // pixel. Measured over eight seconds it leapt three times and travelled
    // thirty-six pixels in total, fighting from where it stood — the exact
    // opposite of leap in, bite, leave. The comment on the withdrawal phase
    // already claimed it "cannot be engaged into standing still"; now it cannot.
    if (this.errandX !== null) {
      this.state = 'advance'
      this.walkTo(this.errandX, staggered ? dt * STAGGER_ADVANCE : dt, this.leapPhase !== 3)
    } else if (nearest && this.distanceTo(nearest) <= this.reach && this.formedUp(blockerX) && this.canBringToBear()) {
      this.state = 'engage'
      if (!staggered) this.tryAttack(nearest, dtMs)
    } else {
      this.state = 'advance'
      // A soldier being shot at from beyond its own reach does not stand there
      // flinching — it puts its head down and runs at whatever is shooting it.
      //
      // Stagger stopping a unit from SHOOTING is the point of stagger. Stagger
      // stopping it from CLOSING turns any reach edge over a splash weapon into
      // an absolute lock, because the rank never covers the last thirty pixels:
      // 137 line soldiers were measured landing zero hits on a single Titan
      // that outranged them by 30. It still slows the charge, so a heavy blow
      // reads as a heavy blow.
      const pace = staggered ? dt * STAGGER_ADVANCE : dt
      if (this.overrun()) this.giveGround(pace)
      else this.advance(pace, blockerX)
    }

    this.handleBurst(dtMs)
    // THE ARTWORK IS NOT THE SIMULATION.
    //
    // This used to call `updateVisual` directly, which meant the rig was posed,
    // every bone's sprite repositioned, and every tint reapplied once per
    // SUBSTEP. Substeps run at fifty a second and the fast-forward toggle runs
    // several of them per drawn frame, so at 4x the game rebuilt each soldier's
    // pose four times and showed one of them. Profiled at four hundred bodies,
    // rig and sprite work was 23% of what looked like simulation cost.
    //
    // The debt is banked instead and flushed once per rendered frame, with the
    // same total dt — so the animation advances at exactly the same rate and the
    // work happens once.
    this.visualDebtMs += dtMs
    this.updateBurdenVisual()
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

  /**
   * Walk to a place rather than at an enemy. Queues against nothing and blocks
   * nothing — a gatherer threads through the line it is scavenging behind.
   */
  private walkTo(x: number, dt: number, turn = true): void {
    const step = this.def.speed * this.speedMult * dt
    const gap = x - this.x
    if (Math.abs(gap) <= step) {
      this.x = x
      return
    }
    const way = gap > 0 ? 1 : -1
    // `turn` is what separates a labourer from a raider. A Bonewright carrying a
    // sack home genuinely turns round and walks away. A Ripjaw breaking off a
    // kill backs out of reach still pointing at what it just bit — it keeps its
    // head to the enemy, which is both what the animal should do and what stops
    // the withdrawal reading as the model having flipped the wrong way.
    if (turn) this.facing = way
    this.x += way * step
    this.stepPhase += step
    this.blockedMs = 0
  }

  private advance(dt: number, blockerX: number | null): void {
    // Anything moving forward faces forward. Without this a unit that ever ran an
    // errand backwards kept the mirrored sprite for the rest of its life, because
    // `facing` was only ever written by `walkTo` — so a Ripjaw that withdrew once
    // spent the remainder of the match running head-first the wrong way.
    this.facing = this.dir
    // An open road is an invitation: a flanker in an enemy-free file rides it.
    const raid = this.raiding || this.lungeMs > 0 ? 1.3 : 1
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
        this.blockedMs += dt * 1000
        if (this.def.flanker && this.blockedMs > FLANK_PATIENCE_MS) this.world.requestFlank?.(this)
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
    // No arms, no argument. A body in its throes that lost the weapon hand can
    // still walk into the line and hold a file; it cannot swing at anything.
    if (this.armsGone) return
    // Something is on this soldier's back. It cannot get an arm behind itself.
    if (this.riddenFor > 0) return
    const attack = this.def.attack

    // FRENZY, and the Host's version of it: three bodies cut from one and still
    // sharing it, so a kill by any of them quickens all three. Read through the
    // world rather than off this soldier, because the count is not his.
    const frenzied =
      this.def.special === 'frenzy'
        ? 1 + Math.min(0.64, this.kills * 0.08)
        : this.def.special === 'host_frenzy'
          ? 1 + Math.min(0.8, (this.world.hostKills?.(this.faction, this.def.id) ?? this.kills) * 0.06)
          : 1
    // Twice as fast while it is dying. Nothing else about the blow changes —
    // the node buys swings, not damage.
    const haste = this.frenzy * frenzied * (this.inThroes ? THROES_HASTE : 1)
    if (attack.kind === 'heal' || attack.kind === 'aura') {
      this.attackCooldown = this.def.attackMs / haste
      this.onHealPulse?.(this)
      return
    }

    this.attackCooldown = this.def.attackMs / haste
    this.swing = 1

    if (attack.kind === 'projectile' && attack.burst) {
      this.burstLeft = attack.burst.rounds
      this.burstTimer = 0
      this.burstGrace = BURST_GRACE_MS
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
      // Nothing to shoot at this instant. Hold the remaining rounds briefly —
      // the battlefield re-targets every tick, so a new body usually presents
      // itself well inside the grace window.
      this.burstGrace -= dtMs
      if (this.burstGrace <= 0) this.burstLeft = 0
      return
    }
    this.burstGrace = BURST_GRACE_MS
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

  /** Animation time owed to the rig, paid off once per drawn frame. */
  private visualDebtMs = 0

  /**
   * Pose the rig for everything banked since the last drawn frame. Called once
   * per frame by the scene, never from the simulation — and called even while
   * the scene is paused, so a harness that steps the field by hand and then
   * screenshots still sees the pose it stepped to.
   */
  flushVisual(): void {
    if (this.visualDebtMs <= 0) return
    const owed = this.visualDebtMs
    this.visualDebtMs = 0
    this.updateVisual(owed)
  }

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
    this.container.setScale(this.scaleFactor * this.facing * this.gorgeScale, this.scaleFactor * this.gorgeScale)
    this.updateGroundRide(dtMs)
    this.container.setPosition(this.x, this.y + this.stageY - this.visualLift)
    this.container.setRotation(this.visualTilt * this.dir)
    this.shadow.setPosition(this.x, this.groundLine + this.stageY - this.visualLift + 2)
    this.shadow.setAlpha(this.layer === 'air' ? 0.18 : 0.4)
    this.teamRing.setPosition(this.x, this.groundLine + this.stageY - this.visualLift + 1)
    this.conductMark?.setPosition(this.x + this.dir * (this.radius + 7), this.groundLine + this.stageY - this.visualLift + 1)

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
    if (this.def.special === 'soul_harvest') {
      this.attackCooldown = 0
      this.heal(this.maxHp * 0.12)
    }
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
        .setDepth(BAND.chrome + 2)
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

    this.container.setScale(this.scaleFactor * this.facing * this.gorgeScale, this.scaleFactor * this.gorgeScale)
    // A soldier stands on whatever the war has made of the ground: up on the
    // mounds, down into the craters. Purely visual — ballistics and reach stay
    // on the flat sim line, so the balance measurements keep their meaning.
    this.updateGroundRide(dtMs)
    const relief = this.visualLift
    this.container.setPosition(this.x, this.y + this.stageY - relief)
    this.container.setRotation(this.visualTilt * this.dir)
    this.shadow.setPosition(this.x, this.groundLine + this.stageY - relief + 2)
    this.shadow.setAlpha(this.layer === 'air' ? 0.18 : 0.4)
    this.teamRing.setPosition(this.x, this.groundLine + this.stageY - relief + 1)
    this.conductMark?.setPosition(this.x + this.dir * (this.radius + 7), this.groundLine + this.stageY - relief + 1)

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
    // The enemy's colour grade multiplies into every status tint, so a
    // dreaded enemy still reads as an enemy.
    const graded = (c: number): number =>
      this.faction === 'enemy'
        ? ((((c >> 16) * (ENEMY_GRADE >> 16)) / 255) << 16) |
          (((((c >> 8) & 0xff) * ((ENEMY_GRADE >> 8) & 0xff)) / 255) << 8) |
          (((c & 0xff) * (ENEMY_GRADE & 0xff)) / 255)
        : c
    if (this.flashTimer > FLASH_MS * 0.45) {
      // A very short solid-white pop reads as a hit without erasing the unit's
      // artwork — in a heavy melee everything is being hit constantly.
      Object.values(this.parts).forEach(part => part.setTintFill(0xffffff))
    } else if (this.flashTimer > 0) {
      Object.values(this.parts).forEach(part => part.setTint(0xffb0b0))
    } else if (this.healPulseTimer > 0) {
      Object.values(this.parts).forEach(part => part.setTint(0x9ff0c8))
    } else if (this.groundFury > 0.15) {
      // Fighting from the mound: an ember shimmer, pulsing with the work.
      const hot = Math.sin(this.animTime / 130) > 0
      Object.values(this.parts).forEach(part => part.setTint(graded(hot ? 0xffb890 : 0xffd6b6)))
    } else if (this.dread > 0.15) {
      // Standing on the hungry ground: the colour drains toward the violet.
      Object.values(this.parts).forEach(part => part.setTint(graded(0xb2a6d6)))
    } else if (this.crabShow > 0) {
      // INFESTED. The crabs are a count rather than a sprite each — eighty of
      // them across a rank costs eighty numbers, not eighty game objects — so
      // the read has to come from the body: pale carapace creeping over the
      // colour, deepening with how many are on it. Past a handful a soldier
      // looks wrong from across the board, which is the information that
      // matters; the exact number is the health bar's business.
      const t = Math.min(1, this.crabShow / 12)
      const shade =
        (Math.round(0xff - 0x38 * t) << 16) | (Math.round(0xff - 0x20 * t) << 8) | Math.round(0xff - 0x62 * t)
      Object.values(this.parts).forEach(part => part.setTint(graded(shade)))
    } else if (this.faction === 'enemy') {
      Object.values(this.parts).forEach(part => part.setTint(ENEMY_GRADE))
    } else {
      Object.values(this.parts).forEach(part => part.clearTint())
    }
  }

  /** Shows a shimmering barrier around units protected by an Aegis Bearer. */
  setAuraVisual(active: boolean): void {
    this.updateWardVisual()
    if (active && !this.auraSprite) {
      this.auraSprite = this.scene.add
        .image(this.x, this.centerY, 'fx:soft')
        .setDepth(BAND.ground - 5)
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

  /**
   * The bound ward, as a slight purple glow.
   *
   * Deliberately dim, and deliberately gone the moment the ward is spent: the
   * whole tactical point is that an opponent can look at a Bonecrusher and
   * tell whether the first heavy blow has already been paid for.
   */
  private wardSprite?: Phaser.GameObjects.Image

  private updateWardVisual(): void {
    const lit = this.alive && this.ward > 0
    if (lit && !this.wardSprite) {
      this.wardSprite = this.scene.add
        .image(this.x, this.centerY, 'fx:soft')
        .setDepth(BAND.ground - 4)
        .setTint(0xb46bff)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(this.def.height * 1.35, this.def.height * 1.55)
    } else if (!lit && this.wardSprite) {
      this.wardSprite.destroy()
      this.wardSprite = undefined
    }
    if (this.wardSprite) {
      this.wardSprite.setPosition(this.x, this.centerY)
      // Fades with what is left in it, so a half-spent ward reads as one.
      const share = this.wardMax > 0 ? this.ward / this.wardMax : 0
      this.wardSprite.setAlpha(0.06 + share * (0.12 + Math.sin(this.animTime / 300) * 0.04))
    }
  }

  destroy(): void {
    this.burden?.destroy()
    this.burden = undefined
    this.wardSprite?.destroy()
    this.wardSprite = undefined
    this.container.destroy()
    this.shadow.destroy()
    this.teamRing.destroy()
    this.auraSprite?.destroy()
    this.rankMark?.destroy()
    this.conductMark?.destroy()
    if (this.hpBar.active) this.hpBar.destroy()
    if (this.hpBarBg.active) this.hpBarBg.destroy()
  }
}
