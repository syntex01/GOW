import { LANE_COUNT } from './types'

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

  constructor(private readonly worldWidth: number) {
    this.buckets = Math.ceil(worldWidth / RELIEF_BUCKET) + 1
    this.relief = Array.from({ length: LANE_COUNT }, () => new Float32Array(this.buckets))
    this.disturbed = Array.from({ length: LANE_COUNT }, () => new Float32Array(this.buckets))
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
   * toward level ground at a rate set by the world's era — and a little
   * neighbourly diffusion keeps healed ground from terracing.
   */
  settle(dtMs: number, nowMs: number, era: number): void {
    const half = HEAL_HALFLIFE_MS[Math.max(0, Math.min(HEAL_HALFLIFE_MS.length - 1, era))]
    const decay = Math.pow(0.5, dtMs / half)
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const row = this.relief[lane]
      const marks = this.disturbed[lane]
      for (let i = 0; i < this.buckets; i += 1) {
        if (row[i] === 0) continue
        if (nowMs - marks[i] < PEACE_DELAY_MS) continue
        row[i] *= decay
        if (Math.abs(row[i]) < 0.4) row[i] = 0
      }
    }
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
      for (let i = 0; i < this.buckets; i += 4) mix(Math.round(row[i] * 4))
    }
  }

  /** Read-only view for the renderer. */
  laneRelief(lane: number): Float32Array {
    return this.relief[lane]
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
    }
  }
}
