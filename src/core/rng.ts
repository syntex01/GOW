/**
 * Small, fast, seedable PRNG (mulberry32). Deterministic seeds make balance
 * testing and replayable "daily challenge" runs possible.
 */
export class Rng {
  private state: number

  constructor(seed: number = Date.now() >>> 0) {
    this.state = seed >>> 0 || 1
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  /** Weighted pick. `weights[i]` corresponds to `items[i]`; non-positive weights are skipped. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T | undefined {
    let total = 0
    for (let i = 0; i < items.length; i += 1) total += Math.max(0, weights[i] ?? 0)
    if (total <= 0) return undefined
    let roll = this.next() * total
    for (let i = 0; i < items.length; i += 1) {
      roll -= Math.max(0, weights[i] ?? 0)
      if (roll <= 0) return items[i]
    }
    return items[items.length - 1]
  }

  /** Symmetric jitter around zero, i.e. a value in (-amount, amount). */
  spread(amount: number): number {
    return (this.next() * 2 - 1) * amount
  }
}

/** Shared instance for cosmetic randomness that does not need determinism. */
export const rng = new Rng()
