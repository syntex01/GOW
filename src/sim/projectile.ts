import Phaser from 'phaser'
import { rng } from '../core/rng'
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
  private gravity: number
  private sprite: Phaser.GameObjects.Image
  private scene: Phaser.Scene
  private vfx: Vfx
  private groundY: number
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
    this.vfx = vfx

    this.sprite = scene.add
      .image(this.x, this.y, `proj:${config.projectile}`)
      .setDepth(250)
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
      const desired = Math.atan2(target.y + target.centerOffsetY - this.y, target.x - this.x)
      let current = Math.atan2(this.vy, this.vx)
      let diff = Phaser.Math.Angle.Wrap(desired - current)
      const maxTurn = this.config.homing * dt
      diff = Phaser.Math.Clamp(diff, -maxTurn, maxTurn)
      current += diff
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy)
      this.vx = Math.cos(current) * speed
      this.vy = Math.sin(current) * speed
    }

    this.vy += this.gravity * dt

    const prevX = this.x
    const prevY = this.y
    this.x += this.vx * dt
    this.y += this.vy * dt

    this.sprite.setPosition(this.x, this.y)
    this.sprite.setRotation(Math.atan2(this.vy, this.vx))

    const lit = PROJECTILE_LIGHT[this.config.projectile]
    if (lit) this.vfx.light(this.x, this.y, lit.radius, lit.color, lit.intensity)

    this.emitTrail(dtMs)

    // Swept hit test against the segment travelled this frame.
    let best: Damageable | null = null
    let bestT = Infinity
    for (const c of candidates) {
      if (!c.alive) continue
      if (c.faction === this.faction) continue
      if (c.layer === 'air' && !this.config.hitsAir) continue
      const cy = c.y + c.centerOffsetY
      const t = segmentHit(prevX, prevY, this.x, this.y, c.x, cy, c.radius + 6)
      if (t !== null && t < bestT) {
        bestT = t
        best = c
      }
    }

    if (best) {
      this.x = prevX + (this.x - prevX) * bestT
      this.y = prevY + (this.y - prevY) * bestT
      this.detonate(false)
      return { hit: best, done: true }
    }

    if (this.y >= this.groundY) {
      this.y = this.groundY
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
      .setDepth(248)
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
      this.vfx.footDust(this.x, this.groundY)
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
    this.sprite.setDepth(70)
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
 * Solves the launch angle needed for a ballistic shot to land on a target.
 * Falls back to a flat 45° lob when the target is out of reach.
 */
export function ballisticAngle(dx: number, dy: number, speed: number, gravity: number): number {
  if (gravity <= 0) return Math.atan2(dy, dx)
  const s2 = speed * speed
  const root = s2 * s2 - gravity * (gravity * dx * dx + 2 * dy * s2)
  if (root < 0) return Math.atan2(dy, dx) - 0.5
  // Low-arc solution keeps shots readable and fast.
  return Math.atan((s2 - Math.sqrt(root)) / (gravity * dx))
}
