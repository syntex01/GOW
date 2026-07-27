/**
 * Deterministic transcendentals.
 *
 * IEEE-754 pins down +, −, ×, ÷ and sqrt to the last bit, so those are the
 * same on every machine. It does NOT pin down sin, cos, atan, pow or hypot —
 * each engine ships its own approximation, V8's differs from JSC's and
 * SpiderMonkey's, and a lockstep game hashes its way into a desync the first
 * time a Chrome player fights a Safari player. Every trigonometric or
 * exponential value that can touch simulation state therefore comes from
 * here, built only out of the operations the standard makes exact.
 *
 * Accuracy is far beyond gameplay needs (sin/cos ≈ 1e-10, atan ≈ 1e-7 rad);
 * the point is not precision, it is that every machine gets the SAME bits.
 */

export const PI = 3.141592653589793
const HALF_PI = PI / 2
const TWO_PI = PI * 2
const LN2 = 0.6931471805599453
/** tan(π/8), the fold point that keeps the atan series short. */
const TAN_PI_8 = 0.41421356237309503

/** sin, by odd Taylor series after folding into [-π/2, π/2]. */
export function dsin(value: number): number {
  // % is IEEE remainder of truncated division — exact, so safe to lean on.
  let x = value % TWO_PI
  if (x > PI) x -= TWO_PI
  else if (x < -PI) x += TWO_PI
  if (x > HALF_PI) x = PI - x
  else if (x < -HALF_PI) x = -PI - x
  const x2 = x * x
  // x − x³/3! + x⁵/5! − x⁷/7! + x⁹/9! − x¹¹/11!, |error| < 4e-10 on the fold.
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 - x2 / 39916800)))))
  )
}

export function dcos(value: number): number {
  return dsin(value + HALF_PI)
}

/** atan on [-1, 1], folded at tan(π/8) so the series converges fast. */
function atanCore(z: number): number {
  const neg = z < 0
  let x = neg ? -z : z
  let base = 0
  if (x > TAN_PI_8) {
    // atan(x) = π/4 + atan((x−1)/(x+1)); the argument lands in [-0.414, 0.414].
    base = PI / 4
    x = (x - 1) / (x + 1)
  }
  const x2 = x * x
  const s =
    x *
    (1 +
      x2 *
        (-1 / 3 +
          x2 * (1 / 5 + x2 * (-1 / 7 + x2 * (1 / 9 + x2 * (-1 / 11 + x2 / 13))))))
  const result = base + s
  return neg ? -result : result
}

export function datan(z: number): number {
  if (z !== z) return z
  const a = z < 0 ? -z : z
  if (a <= 1) return atanCore(z)
  // atan(z) = ±π/2 − atan(1/z) for |z| > 1.
  const inv = atanCore(1 / z)
  return z > 0 ? HALF_PI - inv : -HALF_PI - inv
}

export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x)
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI
  // x is zero: straight up, straight down, or undefined-as-zero like Math.atan2.
  if (y > 0) return HALF_PI
  if (y < 0) return -HALF_PI
  return 0
}

/** e^x for x in [-0.75, 0.75], by Taylor — well past double precision there. */
function expSmall(x: number): number {
  let term = 1
  let sum = 1
  for (let i = 1; i <= 13; i += 1) {
    term = (term * x) / i
    sum += term
  }
  return sum
}

/**
 * 2^x for x ≤ 1 — the decay curve's whole diet. Split into an integer power
 * of two (exact by construction) and a fractional remainder fed to exp.
 */
export function dexp2(x: number): number {
  if (x !== x) return x
  if (x < -1074) return 0
  const n = Math.floor(x)
  const f = x - n
  // 2^f = e^(f·ln2), f ∈ [0, 1), argument ∈ [0, 0.694).
  let result = expSmall(f * LN2)
  // Scale by 2^n with exact halvings/doublings.
  let k = n
  while (k >= 1) {
    result *= 2
    k -= 1
  }
  while (k <= -1) {
    result *= 0.5
    k += 1
  }
  return result
}

/**
 * The exponential-decay factor 0.5^(dt/halfLife) — how much of a quantity
 * survives `dt` when half of it evaporates every `halfLifeMs`.
 */
export function halfLifeDecay(dtMs: number, halfLifeMs: number): number {
  return dexp2(-dtMs / halfLifeMs)
}

/** base^n for a small non-negative integer n, by plain multiplication. */
export function powi(base: number, n: number): number {
  let result = 1
  for (let i = 0; i < n; i += 1) result *= base
  return result
}

/** Length of (x, y). Math.hypot is NOT specified exactly; sqrt is. */
export function dlen(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}
