import Phaser from 'phaser'
import { BAND } from '../gfx/depth'
import { RES } from '../gfx/pixel'
import { rng } from '../core/rng'
import { datan, datan2, dcos, dlen, dsin } from './dmath'
import type { ProjectileId } from '../data/types'
import type Vfx from '../gfx/vfx'
import type { Damageable, DamageType, Faction } from './types'

export interface ProjectileConfig {
  faction: Faction
  projectile: ProjectileId
  x: number
  y: number
  vx: number
  vy: number
  gravity: number
  damage: number
  damageType: DamageType
  knockback: number
  splash?: number
  homing?: number
  target?: Damageable | null
  hitsAir: boolean
  /** Who fired it — used for kill attribution and stats. */
  owner?: Damageable
  /** The file this shot was fired down. Terrain and cover live per lane. */
  lane?: number
  bonusVs?: Partial<Record<string, number>>
  crit?: number
}

/** Visual behaviour per projectile type. */
const TRAIL: Partial<Record<ProjectileId, { color: number; rate: number; additive: boolean }>> = {
  rocket: { color: 0xffa640, rate: 26, additive: true },
  mortar: { color: 0x9aa0a6, rate: 42, additive: false },
  laserbolt: { color: 0x5ce1ff, rate: 18, additive: true },
  plasmaball: { color: 0x7affe0, rate: 16, additive: true },
  railslug: { color: 0xffd06a, rate: 12, additive: true },
  cannonball: { color: 0x8a929c, rate: 60, additive: false },
  shell: { color: 0xc8c8b0, rate: 50, additive: false },
  boulder: { color: 0x9a8f7a, rate: 55, additive: false }
}

const STICKY: ProjectileId[] = ['arrow', 'bolt']

/**
 * How hard the air pushes back. Small enough that a shot still lands roughly
 * where it was aimed, large enough that a long lob falls short — which is what
 * makes wind worth reading before committing to artillery.
 */
const DRAG_COEFFICIENT = 0.12

/** Projectiles that cast light while in flight. */
const PROJECTILE_LIGHT: Partial<Record<ProjectileId, { color: number; radius: number; intensity: number }>> = {
  laserbolt: { color: 0x5ce1ff, radius: 72, intensity: 0.85 },
  plasmaball: { color: 0x7affe0, radius: 96, intensity: 1 },
  railslug: { color: 0xffd06a, radius: 88, intensity: 0.95 },
  rocket: { color: 0xffa640, radius: 64, intensity: 0.7 },
  shell: { color: 0xffd08a, radius: 40, intensity: 0.35 },
  cannonball: { color: 0xffc07a, radius: 34, intensity: 0.25 }
}

export default class Projectile {
  readonly faction: Faction
  readonly config: ProjectileConfig
  x: number
  y: number
  vx: number
  vy: number
  alive = true
  /** Ricochet Rounds: skips left before the shot commits. */
  ricochets = 0
  /** Penetrators: bodies it may pass through. */
  penetration = 0
  /** Targets already resolved, so one shot cannot hit the same body twice. */
  private deflected = new Set<Damageable>()
  /** Sideways push from the age's weather, set by the battlefield. */
  wind = 0
  /** Cluster Shells: splits at the top of its arc. */
  cluster = false
  private split = false
  onSplit?: (p: Projectile) => void
  private gravity: number
  private sprite: Phaser.GameObjects.Image
  private scene: Phaser.Scene
  private vfx: Vfx
  private groundY: number
  /** How far the burial mounds rise above the flat line where this shot now flies. */
  private moundRise = 0
  /** Where the shot was born — the mound under the muzzle never blocks it. */
  private readonly bornX: number

  /** THE FLESH WALL RULE: a tall mound is real cover. The battlefield sets
   * this every step from the relief under the shot, so flat fire slams into
   * the piled dead and lobbed shells burst on the crest instead of sailing
   * through a hill that is visibly there. */
  setMoundRise(height: number): void {
    this.moundRise = height
  }
  private life = 0
  private trailTimer = 0
  private trailEmitter?: Phaser.GameObjects.Particles.ParticleEmitter

  constructor(scene: Phaser.Scene, config: ProjectileConfig, groundY: number, vfx: Vfx) {
    this.scene = scene
    this.config = config
    this.faction = config.faction
    this.x = config.x
    this.y = config.y
    this.vx = config.vx
    this.vy = config.vy
    this.gravity = config.gravity
    this.groundY = groundY
    this.bornX = config.x
    this.vfx = vfx

    this.sprite = scene.add
      .image(this.x, this.y, `proj:${config.projectile}`)
      .setScale(1 / RES)
      .setDepth(BAND.projectile + 2)
      .setRotation(Math.atan2(this.vy, this.vx))

    const glowing = ['laserbolt', 'plasmaball', 'railslug'].includes(config.projectile)
    if (glowing) this.sprite.setBlendMode(Phaser.BlendModes.ADD)
    if (this.vx < 0 && !glowing) this.sprite.setFlipY(true)
  }

  /**
   * Integrates motion and resolves the first hit along this frame's path.
   * Returns the object it struck, or null.
   */
  update(dtMs: number, candidates: Damageable[]): { hit: Damageable | null; done: boolean } {
    if (!this.alive) return { hit: null, done: true }
    const dt = dtMs / 1000
    this.life += dtMs

    // Homing: steer velocity toward the target's centre.
    const target = this.config.target
    if (this.config.homing && target && target.alive) {
      const aimY = target.flatContact ? this.y : target.y + target.centerOffsetY
      const desired = datan2(aimY - this.y, target.x - this.x)
      let current = datan2(this.vy, this.vx)
      let diff = Phaser.Math.Angle.Wrap(desired - current)
      const maxTurn = this.config.homing * dt
      diff = Phaser.Math.Clamp(diff, -maxTurn, maxTurn)
      current += diff
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy)
      this.vx = dcos(current) * speed
      this.vy = dsin(current) * speed
    }

    this.vy += this.gravity * dt

    // Air. Only things that actually arc are slowed noticeably — a rail slug
    // does not care about the breeze, a thrown boulder does — so drag scales
    // with the projectile's own gravity rather than being applied flat.
    if (this.gravity > 0) {
      const speed = dlen(this.vx, this.vy)
      if (speed > 1) {
        const drag = DRAG_COEFFICIENT * speed * dt
        const scale = Math.max(0, 1 - drag / speed)
        this.vx *= scale
        this.vy *= scale
      }
      this.vx += this.wind * dt
    }

    const prevX = this.x
    const prevY = this.y
    this.x += this.vx * dt
    this.y += this.vy * dt

    this.sprite.setPosition(this.x, this.y)
    this.sprite.setRotation(Math.atan2(this.vy, this.vx))

    const lit = PROJECTILE_LIGHT[this.config.projectile]
    if (lit) this.vfx.light(this.x, this.y, lit.radius, lit.color, lit.intensity)

    // Cluster shells come apart at the top of the arc, where the vertical
    // speed crosses zero — the one moment that is unambiguous for any lob.
    if (this.cluster && !this.split && this.config.gravity > 0 && this.vy >= 0 && this.life > 120) {
      this.split = true
      this.onSplit?.(this)
    }

    this.emitTrail(dtMs)

    // Swept hit test against the segment travelled this frame.
    let best: Damageable | null = null
    let bestT = Infinity
    for (const c of candidates) {
      if (!c.alive) continue
      if (c.faction === this.faction) continue
      // A body already ricocheted off or penetrated through is behind us.
      if (this.deflected.has(c)) continue
      if (c.layer === 'air' && !this.config.hitsAir) continue
      // A wall is hit wherever the shell meets it, at whatever height that is.
      // Measuring to a fortress's centre made shots from the near two files
      // sail past a building they were fired point-blank into: 210/252/210/0/0
      // damage by file, with the shooters correctly in range and firing.
      const cy = c.flatContact ? this.y : c.y + c.centerOffsetY
      const t = segmentHit(prevX, prevY, this.x, this.y, c.x, cy, c.radius + 6)
      if (t !== null && t < bestT) {
        bestT = t
        best = c
      }
    }

    if (best) {
      this.x = prevX + (this.x - prevX) * bestT
      this.y = prevY + (this.y - prevY) * bestT

      // Ricochet: a flat shot that catches armour at a shallow angle skips off
      // it rather than stopping. The angle test is what makes it a skill —
      // long-range fire glances, point-blank fire does not.
      if (this.ricochets > 0 && (best.armor === 'heavy' || best.armor === 'structure')) {
        const speed = dlen(this.vx, this.vy)
        const incidence = Math.abs(this.vy) / Math.max(1, speed)
        if (incidence < 0.42) {
          this.ricochets -= 1
          this.deflected.add(best)
          this.vy = -Math.abs(this.vy) - speed * 0.12
          this.vx *= 0.82
          this.y -= 4
          return { hit: null, done: false }
        }
      }

      // Penetrators pass through the first body and carry on into the next.
      if (this.penetration > 0 && !this.deflected.has(best)) {
        this.penetration -= 1
        this.deflected.add(best)
        return { hit: best, done: false }
      }

      this.detonate(false)
      return { hit: best, done: true }
    }

    const wallRise = Math.abs(this.x - this.bornX) > 40 ? this.moundRise : 0
    if (this.y >= this.groundY - wallRise) {
      this.y = this.groundY - wallRise
      this.detonate(true)
      return { hit: null, done: true }
    }

    if (this.life > 9000 || this.x < -400 || this.x > 40000) {
      this.destroy()
      return { hit: null, done: true }
    }

    return { hit: null, done: false }
  }

  private emitTrail(dtMs: number): void {
    const trail = TRAIL[this.config.projectile]
    if (!trail) return
    this.trailTimer -= dtMs
    if (this.trailTimer > 0) return
    this.trailTimer = trail.rate

    const puff = this.scene.add
      .image(this.x, this.y, 'fx:soft')
      .setDepth(BAND.projectile)
      .setTint(trail.color)
      .setAlpha(trail.additive ? 0.7 : 0.4)
      .setScale(trail.additive ? 0.16 : 0.2)
    if (trail.additive) puff.setBlendMode(Phaser.BlendModes.ADD)

    this.scene.tweens.add({
      targets: puff,
      alpha: 0,
      scale: trail.additive ? 0.05 : 0.42,
      duration: trail.additive ? 220 : 620,
      onComplete: () => puff.destroy()
    })
  }

  /** Plays impact visuals; the battlefield applies the damage. */
  private detonate(groundHit: boolean): void {
    const { splash, projectile, damageType } = this.config
    if (splash && splash > 0) {
      const big = splash > 110
      this.vfx.explosion(this.x, this.y, splash, damageType === 'energy' ? 0x7affe0 : 0xffa640, big)
    } else if (groundHit) {
      // Stopping ON the piled dead is not the same event as hitting dirt.
      if (this.moundRise > 0) this.vfx.wallBlock(this.x, this.groundY - this.moundRise)
      else this.vfx.footDust(this.x, this.groundY)
      if (STICKY.includes(projectile)) {
        this.stickInGround()
        return
      }
    } else if (damageType === 'energy') {
      this.vfx.energyBurst(this.x, this.y, 0x7affe0, 1)
    }
    this.destroy()
  }

  /** Spent arrows quiver in the dirt for a while — cheap but very readable. */
  private stickInGround(): void {
    this.alive = false
    this.sprite.setDepth(BAND.litter)
    this.sprite.setRotation(Math.atan2(this.vy, this.vx))
    this.sprite.y = this.groundY - 2
    this.sprite.x += rng.spread(4)
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      delay: 5000,
      duration: 1500,
      onComplete: () => this.sprite.destroy()
    })
  }

  destroy(): void {
    if (!this.alive) return
    this.alive = false
    this.trailEmitter?.destroy()
    this.sprite.destroy()
  }
}

/**
 * Earliest intersection (0..1) of segment AB with a circle, or null.
 * Used for swept collision so fast rounds never tunnel through targets.
 */
function segmentHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  r: number
): number | null {
  const dx = bx - ax
  const dy = by - ay
  const fx = ax - cx
  const fy = ay - cy

  const a = dx * dx + dy * dy
  if (a < 1e-6) {
    return fx * fx + fy * fy <= r * r ? 0 : null
  }
  const b = 2 * (fx * dx + fy * dy)
  const c = fx * fx + fy * fy - r * r
  let disc = b * b - 4 * a * c
  if (disc < 0) return null
  disc = Math.sqrt(disc)
  const t1 = (-b - disc) / (2 * a)
  const t2 = (-b + disc) / (2 * a)
  if (t1 >= 0 && t1 <= 1) return t1
  if (t2 >= 0 && t2 <= 1) return t2
  return null
}

/**
 * Solves the launch angle a ballistic shot needs to land on its target.
 *
 * This was wrong in two ways at once, and between them they are why arcing
 * weapons spent their time throwing stones into the dirt.
 *
 * The textbook solution is written for maths axes, where y points up. Screen
 * axes point y *down*. Feeding a screen-space `dy` into the maths-space formula
 * and returning the result unchanged gave a *downward* angle for a target on
 * the same level: a slinger aiming at someone two hundred pixels away threw the
 * stone eighteen degrees into the ground, and it landed at the feet of the
 * front line — which is exactly where friendly troops are standing.
 *
 * The second error was `Math.atan`, whose range is a half turn wide. Every
 * answer it gives points to the right. Anything shooting left — which is the
 * whole enemy army — fired backwards over its own fortress.
 *
 * So: mirror leftward shots, convert into maths axes to solve, convert the
 * answer back. Then hand it to the drag correction below, because the analytic
 * solution assumes a vacuum and the projectiles do not fly in one.
 */
function vacuumAngle(dx: number, dy: number, speed: number, gravity: number): number {
  const dir = dx < 0 ? -1 : 1
  const x = Math.max(1e-3, Math.abs(dx))
  // Into maths axes: a target *above* the muzzle has a positive height here.
  const y = -dy
  const s2 = speed * speed
  const root = s2 * s2 - gravity * (gravity * x * x + 2 * y * s2)
  // Out of reach at this muzzle speed. Forty-five degrees is the throw that
  // carries furthest, so the shot at least falls as close as it can.
  const theta = root < 0 ? Math.PI / 4 : datan((s2 - Math.sqrt(root)) / (gravity * x))
  // Back into screen axes, mirrored for a shot travelling left.
  return dir > 0 ? -theta : Math.PI + theta
}

/**
 * Per-second velocity damping applied to anything that arcs.
 *
 * Must match the drag the projectile itself integrates, or the aim solver is
 * solving a different problem from the one the shot flies.
 */
export const PROJECTILE_DRAG = DRAG_COEFFICIENT

/** Fixed integration step for the aim solver. Small enough to be accurate,
 *  fixed so that two machines in lockstep always get the same answer. */
const SOLVER_STEP = 1 / 60

/**
 * Height error of a shot fired at `angle`, at the moment it reaches the
 * target's horizontal distance. Positive means the shot passed below it.
 *
 * Integrated exactly the way `update()` integrates, drag included, so what the
 * solver predicts is what the projectile actually does.
 */
function missBy(angle: number, dx: number, dy: number, speed: number, gravity: number): number {
  let x = 0
  let y = 0
  let vx = dcos(angle) * speed
  let vy = dsin(angle) * speed
  const goal = Math.abs(dx)
  const sign = dx < 0 ? -1 : 1
  // Six seconds is longer than any shot in the game stays up.
  for (let step = 0; step < 360; step += 1) {
    const prevX = x
    const prevY = y
    vy += gravity * SOLVER_STEP
    if (gravity > 0) {
      const scale = Math.max(0, 1 - PROJECTILE_DRAG * SOLVER_STEP)
      vx *= scale
      vy *= scale
    }
    x += vx * SOLVER_STEP
    y += vy * SOLVER_STEP
    const travelled = sign * x
    if (travelled >= goal) {
      // Interpolate to the exact crossing so the error is smooth in the angle,
      // which is what lets the secant step below converge.
      const prevTravelled = sign * prevX
      const span = travelled - prevTravelled
      const t = span > 1e-6 ? (goal - prevTravelled) / span : 0
      return prevY + (y - prevY) * t - dy
    }
    // Fell short: it is already on its way down and below the target.
    if (vy > 0 && y > dy + 4000) break
  }
  return y - dy
}

/**
 * Launch angle for a shot that has to travel `dx, dy` at `speed`.
 *
 * Starts from the vacuum solution and then corrects it against a real
 * integration of the trajectory, because these projectiles are dragged and a
 * vacuum solution always falls short. Two secant steps take a lob that was
 * landing tens of pixels early to within a pixel or two, which is well inside
 * the weapon's own spread.
 *
 * Deterministic: fixed step, fixed iteration count, no clock and no randomness.
 */
export function ballisticAngle(dx: number, dy: number, speed: number, gravity: number): number {
  if (gravity <= 0) return datan2(dy, dx)

  let a0 = vacuumAngle(dx, dy, speed, gravity)
  let e0 = missBy(a0, dx, dy, speed, gravity)
  if (Math.abs(e0) < 0.5) return a0

  // Nudge upward — the sign of "up" flips with the direction of travel, since a
  // leftward shot lives on the far side of the half turn.
  const up = dx < 0 ? 0.06 : -0.06
  let a1 = a0 + up
  let e1 = missBy(a1, dx, dy, speed, gravity)

  for (let i = 0; i < 3; i += 1) {
    const spread = e1 - e0
    if (Math.abs(spread) < 1e-6) break
    const next = a1 - e1 * ((a1 - a0) / spread)
    if (!Number.isFinite(next)) break
    a0 = a1
    e0 = e1
    a1 = next
    e1 = missBy(a1, dx, dy, speed, gravity)
    if (Math.abs(e1) < 0.5) break
  }
  return Math.abs(e1) < Math.abs(e0) ? a1 : a0
}

/**
 * How far a weapon can actually throw, drag included.
 *
 * Used to keep a unit from opening fire on something its ammunition cannot
 * reach — the shot would land short every time, in among its own front line.
 */
const reachMemo = new Map<string, number>()

export function ballisticReach(speed: number, gravity: number): number {
  if (gravity <= 0) return Infinity
  // Asked once per target check, per unit, per frame. The answer only depends
  // on the two numbers, so it is worth remembering.
  const key = `${speed}|${gravity}`
  const cached = reachMemo.get(key)
  if (cached !== undefined) return cached
  const value = computeReach(speed, gravity)
  reachMemo.set(key, value)
  return value
}

function computeReach(speed: number, gravity: number): number {
  let x = 0
  let y = 0
  const angle = -Math.PI / 4
  let vx = dcos(angle) * speed
  let vy = dsin(angle) * speed
  for (let step = 0; step < 600; step += 1) {
    vy += gravity * SOLVER_STEP
    const scale = Math.max(0, 1 - PROJECTILE_DRAG * SOLVER_STEP)
    vx *= scale
    vy *= scale
    x += vx * SOLVER_STEP
    y += vy * SOLVER_STEP
    if (y >= 0 && step > 2) break
  }
  return x
}
