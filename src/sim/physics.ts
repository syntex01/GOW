import type { Rng } from '../core/rng'
import type { Faction } from './types'

/**
 * The physics world.
 *
 * Every loose object in the game lives here: gibs, scrap, shell casings, blood
 * droplets, rubble knocked off a fortress, and the shrapnel that some techs
 * turn into a real weapon. They are all point masses with a radius and a spin,
 * integrated in the same fixed sub-steps as the rest of the simulation.
 *
 * This is deliberately part of the *simulation*, not the effects layer. A
 * corpse that blocks a shot, shrapnel that wounds, and blood that a unit can
 * smell all change the outcome of a match, so they have to be as deterministic
 * as anything else — same seed, same fixed step, same result on both peers.
 * The only thing kept out of the simulation is how the mess is drawn.
 */

export type BodyKind =
  /** Flesh. Bleeds a trail, stains where it lands, can be eaten by techs. */
  | 'gib'
  /** Metal wreckage. Sparks, does not bleed, can be salvaged for gold. */
  | 'scrap'
  /** Spent brass. Purely for texture — small, bouncy, short-lived. */
  | 'casing'
  /** A droplet in flight. Stains whatever it hits, then disappears. */
  | 'blood'
  /** Masonry knocked out of a fortress. */
  | 'rubble'
  /** A fragment that damages what it hits. */
  | 'shrapnel'

export interface Body {
  kind: BodyKind
  x: number
  y: number
  vx: number
  vy: number
  /** Radians. Bodies tumble; the renderer reads this straight off. */
  rot: number
  spin: number
  radius: number
  mass: number
  /** 0 = lands dead, 1 = perfectly elastic. */
  restitution: number
  /** Sliding friction applied while resting on the ground. */
  friction: number
  /**
   * The ground line this body falls to. Lanes put soldiers on three
   * different lines, and a man's remains land on the line he stood on.
   */
  floor?: number
  /** Air resistance coefficient. */
  drag: number
  /** Milliseconds left before the body is removed. Infinity for permanent. */
  ttl: number
  /** True once the body has come to rest on the ground. */
  settled: boolean
  /** Whose side this came from, where that matters. */
  faction: Faction | null
  /** Damage carried by shrapnel. */
  damage: number
  /** How much blood is left to shed along the way. */
  bleed: number
  /** Sprite tint, chosen at spawn so the renderer needs no lookup. */
  color: number
  /** Scale hint for the renderer, 1 = nominal for the kind. */
  size: number
  /** Set when the body has been consumed and should be reaped. */
  dead: boolean
  /** Frames a shrapnel body must wait before it can hit anything. */
  armTime: number
  /**
   * Renderer hints. These never enter the fingerprint — which texture a chunk
   * of a soldier happens to wear cannot change the outcome of the match, and
   * hashing it would make the art a determinism hazard.
   */
  texture: string
  originX: number
  originY: number
  flip: boolean
}

export interface Wall {
  /** Left and right extents in world space. */
  x0: number
  x1: number
  /** Top of the wall; below this is solid. */
  top: number
}

/** What the world tells its owner when something interesting happens. */
export interface PhysicsCallbacks {
  /** A body touched down or hit a wall hard enough to leave a mark. */
  onStain: (body: Body, x: number, y: number, speed: number, onWall: boolean) => void
  /** A bleeding body shed a droplet mid-flight. */
  onDrip: (x: number, y: number, vx: number, vy: number, color: number) => void
  /** A shrapnel body reached something it can hurt. */
  onShrapnel: (body: Body) => void
  /** A body came to rest and will now persist. */
  onSettle: (body: Body) => void
}

const GRAVITY = 1500
/** Below this speed a bouncing body is treated as having landed. */
const REST_SPEED = 26
/** Hard ceiling so a pathological match cannot allocate without bound. */
const MAX_BODIES = 1400
/**
 * How many settled pieces the field keeps. Corpses are meant to pile up — that
 * is the point — but past a few hundred the renderer is drawing a carpet
 * nobody can read, so the oldest quietly go.
 */
const MAX_SETTLED = 320

export default class PhysicsWorld {
  readonly bodies: Body[] = []
  private groundY: number
  private worldWidth: number
  private rng: Rng
  private callbacks: PhysicsCallbacks
  private walls: Wall[] = []
  /** Sideways push from the age's weather, in px/s². */
  wind = 0

  constructor(groundY: number, worldWidth: number, rng: Rng, callbacks: PhysicsCallbacks) {
    this.groundY = groundY
    this.worldWidth = worldWidth
    this.rng = rng
    this.callbacks = callbacks
  }

  setWalls(walls: Wall[]): void {
    this.walls = walls
  }

  get count(): number {
    return this.bodies.length
  }

  /**
   * Adds a body. Everything has a sensible default for its kind so callers
   * only state what actually differs.
   */
  spawn(kind: BodyKind, x: number, y: number, vx: number, vy: number, options: Partial<Body> = {}): Body | null {
    if (this.bodies.length >= MAX_BODIES) {
      // Drop the oldest cosmetic body rather than refusing the new one: losing
      // a droplet is invisible, losing a gib is not.
      const index = this.bodies.findIndex(b => b.kind === 'blood' || b.kind === 'casing')
      if (index < 0) return null
      this.bodies.splice(index, 1)
    }
    const defaults = KIND_DEFAULTS[kind]
    const body: Body = {
      kind,
      x,
      y,
      vx,
      vy,
      rot: 0,
      spin: 0,
      radius: defaults.radius,
      mass: defaults.mass,
      restitution: defaults.restitution,
      friction: defaults.friction,
      drag: defaults.drag,
      ttl: defaults.ttl,
      settled: false,
      faction: null,
      damage: 0,
      bleed: 0,
      color: defaults.color,
      size: 1,
      dead: false,
      armTime: 0,
      texture: defaults.texture,
      originX: 0.5,
      originY: 0.5,
      flip: false,
      ...options
    }
    this.bodies.push(body)
    return body
  }

  /**
   * A radial impulse. This is what an explosion actually *is* in this game:
   * everything within the radius — debris, gibs, and via the caller the units
   * themselves — gets pushed away with a force that falls off with distance.
   */
  blast(x: number, y: number, radius: number, strength: number): void {
    const r2 = radius * radius
    for (const body of this.bodies) {
      const dx = body.x - x
      const dy = body.y - y
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const d = Math.sqrt(d2) || 0.0001
      const falloff = 1 - d / radius
      const push = (strength * falloff * falloff) / Math.max(0.05, body.mass)
      body.vx += (dx / d) * push
      // Bias upward: a blast that only pushes sideways looks like a shove.
      body.vy += (dy / d) * push - push * 0.45
      body.spin += this.rng.spread(push * 0.05)
      body.settled = false
    }
  }

  /** A directional gust, used by shockwave fronts and thruster wash. */
  push(x: number, y: number, radius: number, dx: number, dy: number, strength: number): void {
    const r2 = radius * radius
    for (const body of this.bodies) {
      const ox = body.x - x
      const oy = body.y - y
      if (ox * ox + oy * oy > r2) continue
      const scale = strength / Math.max(0.05, body.mass)
      body.vx += dx * scale
      body.vy += dy * scale
      body.settled = false
    }
  }

  /** Advances every body by one fixed sub-step. */
  step(dtMs: number): void {
    const dt = dtMs / 1000
    if (dt <= 0) return
    const cb = this.callbacks
    let write = 0

    for (let i = 0; i < this.bodies.length; i += 1) {
      const b = this.bodies[i]
      b.ttl -= dtMs
      if (b.dead || b.ttl <= 0) continue

      if (!b.settled) {
        // Quadratic drag, which is what makes a light gib flutter and a heavy
        // one drop like a stone from the same explosion.
        const speed = Math.hypot(b.vx, b.vy)
        if (speed > 0.01 && b.drag > 0) {
          const decel = b.drag * speed * dt
          const scale = Math.max(0, 1 - decel / Math.max(speed, 0.01))
          b.vx *= scale
          b.vy *= scale
        }
        b.vy += GRAVITY * dt
        b.vx += this.wind * dt * (b.kind === 'blood' ? 1.6 : 0.35)

        b.x += b.vx * dt
        b.y += b.vy * dt
        b.rot += b.spin * dt

        // Bleeding bodies leave a trail behind them, which is what sells a gib
        // as flesh rather than as a tumbling rock.
        if (b.bleed > 0 && speed > 90) {
          b.bleed -= dtMs
          if (this.rng.chance(Math.min(0.5, dtMs / 90))) {
            cb.onDrip(b.x, b.y, b.vx * 0.2 + this.rng.spread(30), b.vy * 0.2 - this.rng.range(10, 60), b.color)
          }
        }

        this.collideWalls(b, speed)
        this.collideGround(b)
      }

      if (b.kind === 'shrapnel') {
        b.armTime -= dtMs
        if (b.armTime <= 0 && !b.settled) cb.onShrapnel(b)
      }

      // Bodies that wander off the edges are gone.
      if (b.x < -80 || b.x > this.worldWidth + 80) continue
      if (b.dead) continue
      this.bodies[write] = b
      write += 1
    }
    this.bodies.length = write
  }

  private collideGround(b: Body): void {
    const floor = b.floor ?? this.groundY
    if (b.y < floor) return
    const impactSpeed = Math.abs(b.vy)
    b.y = floor

    if (impactSpeed > REST_SPEED) {
      // Bounce, losing energy to restitution, and scrub sideways speed.
      b.vy = -impactSpeed * b.restitution
      b.vx *= 1 - b.friction * 0.5
      b.spin *= 0.6
      this.callbacks.onStain(b, b.x, floor, impactSpeed, false)
      if (b.kind === 'blood') b.dead = true
    } else {
      b.vy = 0
      b.vx *= 1 - b.friction
      b.spin *= 0.75
      if (Math.abs(b.vx) < 6 && Math.abs(b.spin) < 0.5) {
        b.vx = 0
        b.spin = 0
        b.settled = true
        this.callbacks.onStain(b, b.x, floor, impactSpeed, false)
        this.callbacks.onSettle(b)
        if (b.kind === 'blood') b.dead = true
        else this.trimSettled()
      }
    }
  }

  private collideWalls(b: Body, speed: number): void {
    for (const wall of this.walls) {
      if (b.x < wall.x0 - b.radius || b.x > wall.x1 + b.radius) continue
      if (b.y < wall.top) continue
      // Push out along whichever face it entered through — the shallower
      // penetration wins, which is what keeps a gib from popping through a
      // fortress instead of sliding down it.
      const fromLeft = Math.abs(b.x - wall.x0)
      const fromRight = Math.abs(wall.x1 - b.x)
      const fromTop = Math.abs(b.y - wall.top)
      if (fromTop <= fromLeft && fromTop <= fromRight) {
        b.y = wall.top
        b.vy = -Math.abs(b.vy) * b.restitution
      } else if (fromLeft < fromRight) {
        b.x = wall.x0 - b.radius
        b.vx = -Math.abs(b.vx) * b.restitution
      } else {
        b.x = wall.x1 + b.radius
        b.vx = Math.abs(b.vx) * b.restitution
      }
      b.spin *= 0.5
      // Only a hard impact marks a wall. Every glancing bounce staining it
      // drenches a fortress from a single explosion.
      if (speed > 260) this.callbacks.onStain(b, b.x, b.y, speed, true)
      if (b.kind === 'blood') b.dead = true
      return
    }
  }

  /** Retires the oldest settled debris once the field is carpeted. */
  private trimSettled(): void {
    let settled = 0
    for (const b of this.bodies) if (b.settled) settled += 1
    let excess = settled - MAX_SETTLED
    if (excess <= 0) return
    for (const b of this.bodies) {
      if (excess <= 0) break
      if (!b.settled) continue
      b.dead = true
      excess -= 1
    }
  }

  /** Removes everything. Used when a match ends or restarts. */
  clear(): void {
    this.bodies.length = 0
  }

  /**
   * A compact fingerprint of the parts of the world that can change the
   * outcome of a match. Droplets and casings are deliberately excluded: there
   * are hundreds of them, they cannot affect anything, and hashing them would
   * make desync detection expensive for no gain.
   */
  hash(): number {
    let h = 2166136261
    const mix = (v: number) => {
      h ^= v | 0
      h = Math.imul(h, 16777619)
    }
    for (const b of this.bodies) {
      if (b.kind === 'blood' || b.kind === 'casing') continue
      mix(Math.round(b.x))
      mix(Math.round(b.y))
      mix(b.settled ? 1 : 0)
    }
    return h >>> 0
  }
}

interface KindDefaults {
  radius: number
  mass: number
  restitution: number
  friction: number
  drag: number
  ttl: number
  color: number
  texture: string
}

/**
 * Material properties. These are the numbers that make each kind of debris
 * feel like the thing it is: brass pings and skitters, flesh lands wet and
 * stops, masonry thuds, blood does not bounce at all.
 */
const KIND_DEFAULTS: Record<BodyKind, KindDefaults> = {
  gib: { radius: 3, mass: 1.1, restitution: 0.18, friction: 0.5, drag: 0.9, ttl: Infinity, color: 0x9e1f22, texture: 'fx:debris' },
  scrap: { radius: 3, mass: 1.6, restitution: 0.34, friction: 0.34, drag: 0.7, ttl: Infinity, color: 0x6b6355, texture: 'fx:debris' },
  casing: { radius: 1.2, mass: 0.2, restitution: 0.52, friction: 0.28, drag: 1.6, ttl: 5200, color: 0xd8b451, texture: 'fx:shard' },
  blood: { radius: 1, mass: 0.12, restitution: 0, friction: 1, drag: 1.4, ttl: 4200, color: 0x8e1418, texture: 'fx:blood' },
  rubble: { radius: 3.4, mass: 2.4, restitution: 0.22, friction: 0.46, drag: 0.5, ttl: Infinity, color: 0x8b8478, texture: 'fx:debris' },
  shrapnel: { radius: 1.8, mass: 0.5, restitution: 0.24, friction: 0.6, drag: 0.55, ttl: 2600, color: 0xc9d2dd, texture: 'fx:shard' }
}
