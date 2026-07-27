import { LANE_COUNT } from './types'
import { halfLifeDecay } from './dmath'

/**
 * The ground remembers.
 *
 * A per-lane relief field over the battlefield: the dead decompose into
 * height, heavy shells carve craters that destroy some of that mass and throw
 * the rest onto the rim, and long enough peace lets the ground settle back
 * toward the clean field the match began with — quickly in the early ages,
 * barely at all by the last one.
 *
 * This is simulation state, not decoration. A mound tall enough blocks flat
 * shots in its lane, so it lives on the same deterministic footing as
 * everything else: integer buckets, fixed-step updates, and a place in the
 * state fingerprint.
 */

/** World pixels per relief bucket. */
export const RELIEF_BUCKET = 8

/** The most soil a mound can hold, in pixels of height. */
export const RELIEF_CAP = 26

/** The deepest a crater can bite. */
export const CRATER_CAP = 18

/** A mound this tall stops a shot that flies into its face. */
export const RELIEF_BLOCK_HEIGHT = 13

/** How long a stretch must stay quiet before the ground starts to heal. */
const PEACE_DELAY_MS = 16000

/**
 * Half-life of relief during peace, per world era. The stone age heals in
 * half a minute; the fusion age keeps its scars for most of a match.
 */
const HEAL_HALFLIFE_MS = [18000, 32000, 64000, 150000, 380000] as const

export default class Terrain {
  private readonly buckets: number
  /** Signed height per lane per bucket: mounds above zero, craters below. */
  private readonly relief: Float32Array[]
  /** Sim-time stamp of the last disturbance near each bucket, per lane. */
  private readonly disturbed: Float32Array[]
  /**
   * How haunted each bucket is, 0..1. The occult creed does not build mounds —
   * it consumes the dead where they fall and leaves this behind instead:
   * ground that remembers being fed, and makes whoever stands on it worse at
   * their job. Simulation state like the relief, and hashed like it.
   */
  private readonly haunt: Float32Array[]

  constructor(private readonly worldWidth: number) {
    this.buckets = Math.ceil(worldWidth / RELIEF_BUCKET) + 1
    this.relief = Array.from({ length: LANE_COUNT }, () => new Float32Array(this.buckets))
    this.disturbed = Array.from({ length: LANE_COUNT }, () => new Float32Array(this.buckets))
    this.haunt = Array.from({ length: LANE_COUNT }, () => new Float32Array(this.buckets))
  }

  private index(x: number): number {
    const i = Math.round(x / RELIEF_BUCKET)
    return i < 0 ? 0 : i >= this.buckets ? this.buckets - 1 : i
  }

  /** Ground height at a point: positive mound, negative crater. */
  heightAt(x: number, lane: number): number {
    return this.relief[lane]?.[this.index(x)] ?? 0
  }

  /**
   * Soil arrives — a body gone back into the ground, rubble, thrown earth.
   * Spread over a few buckets so a mound is a mound, not a spike.
   */
  addMass(x: number, lane: number, amount: number, nowMs: number, capBonus = 0): void {
    const row = this.relief[lane]
    if (!row) return
    const centre = this.index(x)
    const shares = [0.2, 0.6, 0.2]
    for (let k = -1; k <= 1; k += 1) {
      const i = centre + k
      if (i < 0 || i >= this.buckets) continue
      row[i] = Math.min(RELIEF_CAP + capBonus, row[i] + amount * shares[k + 1])
      this.disturbed[lane][i] = nowMs
    }
  }

  /**
   * A shell lands. Mass inside the bowl is partly destroyed and partly thrown
   * onto the rim — the ground is conserved imperfectly, the way ground is.
   * Returns how deep the centre ended up, for whoever wants to draw dust.
   */
  crater(x: number, lane: number, radius: number, depth: number, nowMs: number): number {
    const row = this.relief[lane]
    if (!row) return 0
    const centre = this.index(x)
    const span = Math.max(1, Math.round(radius / RELIEF_BUCKET))
    const bite = Math.min(CRATER_CAP, depth)
    let displaced = 0
    for (let k = -span; k <= span; k += 1) {
      const i = centre + k
      if (i < 0 || i >= this.buckets) continue
      const falloff = 1 - Math.abs(k) / (span + 1)
      const cut = bite * falloff
      const before = row[i]
      row[i] = Math.max(-CRATER_CAP, before - cut)
      // A third of what the blast lifted travels; the rest is simply gone.
      displaced += Math.max(0, before - row[i]) * 0.35
      this.disturbed[lane][i] = nowMs
    }
    for (const rim of [centre - span - 1, centre + span + 1]) {
      if (rim < 0 || rim >= this.buckets) continue
      row[rim] = Math.min(RELIEF_CAP, row[rim] + displaced / 2 + bite * 0.15)
      this.disturbed[lane][rim] = nowMs
    }
    return row[centre]
  }

  /**
   * Peace, doing its slow work. Buckets left alone long enough ease back
   * toward level ground at a rate set by the world's era — and, when a creed
   * has laid claim to a stretch, by the creed: `healScale` returns a
   * multiplier on the half-life for one bucket. Above 1 the ground clings to
   * its scars (a carnage army's monuments, an ordnance army's no-man's-land),
   * below 1 it is being actively repaired (engineering fill crews), and
   * Infinity freezes it entirely (blight ground that is no longer ground).
   */
  settle(
    dtMs: number,
    nowMs: number,
    era: number,
    healScale?: (lane: number, x: number, height: number) => number
  ): void {
    const half = HEAL_HALFLIFE_MS[Math.max(0, Math.min(HEAL_HALFLIFE_MS.length - 1, era))]
    const baseDecay = halfLifeDecay(dtMs, half)
    const hauntDecay = halfLifeDecay(dtMs, half * 1.5)
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const row = this.relief[lane]
      const marks = this.disturbed[lane]
      const spirits = this.haunt[lane]
      for (let i = 0; i < this.buckets; i += 1) {
        if (nowMs - marks[i] < PEACE_DELAY_MS) continue
        if (spirits[i] > 0) {
          spirits[i] *= hauntDecay
          if (spirits[i] < 0.03) spirits[i] = 0
        }
        if (row[i] === 0) continue
        const scale = healScale ? healScale(lane, i * RELIEF_BUCKET, row[i]) : 1
        if (scale === Infinity) continue
        row[i] *= scale === 1 ? baseDecay : halfLifeDecay(dtMs, half * scale)
        if (Math.abs(row[i]) < 0.4) row[i] = 0
      }
    }
  }

  /** The occult ground takes another body. Intensity saturates at 1. */
  addHaunt(x: number, lane: number, amount: number, nowMs: number): void {
    const row = this.haunt[lane]
    if (!row) return
    const centre = this.index(x)
    for (let k = -1; k <= 1; k += 1) {
      const i = centre + k
      if (i < 0 || i >= this.buckets) continue
      row[i] = Math.min(1, row[i] + amount * (k === 0 ? 1 : 0.5))
      this.disturbed[lane][i] = nowMs
    }
  }

  /** How haunted the ground under a point is, 0..1. */
  hauntAt(x: number, lane: number): number {
    return this.haunt[lane]?.[this.index(x)] ?? 0
  }

  /**
   * Drains up to `amount` of mound from a bucket and returns what was taken.
   * The engineering creed's quarry crews eat the dead for parts with this.
   */
  quarry(lane: number, bucket: number, amount: number): number {
    const row = this.relief[lane]
    if (!row || bucket < 0 || bucket >= this.buckets || row[bucket] <= 0) return 0
    const taken = Math.min(row[bucket], amount)
    row[bucket] -= taken
    if (row[bucket] < 0.4) row[bucket] = 0
    return taken
  }

  /** True when a shot at this height flies into the face of a mound. */
  blocksShot(x: number, lane: number, shotYAboveGround: number): boolean {
    const h = this.heightAt(x, lane)
    return h >= RELIEF_BLOCK_HEIGHT && shotYAboveGround < h
  }

  /** Ratio of ground currently scarred, 0..1 — the "grit" of the world. */
  scarring(): number {
    let scarred = 0
    let total = 0
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const row = this.relief[lane]
      for (let i = 0; i < this.buckets; i += 1) {
        total += 1
        if (Math.abs(row[i]) > 2) scarred += 1
      }
    }
    return total > 0 ? scarred / total : 0
  }

  /** Folds the field into the deterministic state fingerprint. */
  hash(mix: (value: number) => void): void {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const row = this.relief[lane]
      const spirits = this.haunt[lane]
      for (let i = 0; i < this.buckets; i += 4) {
        mix(Math.round(row[i] * 4))
        mix(Math.round(spirits[i] * 8))
      }
    }
  }

  /** Read-only view for the renderer. */
  laneRelief(lane: number): Float32Array {
    return this.relief[lane]
  }

  /** Read-only view of the haunting for the renderer. */
  laneHaunt(lane: number): Float32Array {
    return this.haunt[lane]
  }

  get bucketCount(): number {
    return this.buckets
  }

  get width(): number {
    return this.worldWidth
  }

  clear(): void {
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      this.relief[lane].fill(0)
      this.disturbed[lane].fill(0)
      this.haunt[lane].fill(0)
    }
  }
}
