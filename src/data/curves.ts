import type { UnitDef } from './types'

/**
 * The three curves.
 *
 * The roster was authored age by age, and each age was tuned against itself.
 * That produced good matchups and a bad GAME: the cheapest soldier went 60 →
 * 150 → 310 → 460 → 760 gold while income went 16 → 374, so the price of a body
 * rose almost exactly as fast as the money to buy it. The field therefore held
 * about the same number of soldiers in the last age as in the first, and the
 * dearest thing you could buy at age five was 5,200 gold — fourteen seconds of
 * income. There was nothing to swarm with and nothing to save for.
 *
 * This pass re-lays the band each age spans, without touching the order of the
 * units inside it:
 *
 *  - **Line units — flat cost, linear power.** The cheapest soldier of every
 *    age costs the same 200 gold. Its power grows ×1, ×2, ×3, ×4, ×5. At age
 *    one that is a soldier every twelve seconds; at age five, several a second.
 *    The line unit is never obsolete and never expensive — what changes is how
 *    many of them the ground can hold.
 *
 *  - **Elite units — exponential cost, exponential power.** The dearest of each
 *    age costs ×2.6 an age and hits ×3.6 an age. An age-five elite is around
 *    27,000 gold — roughly a minute of income at EVERY age, but what a minute
 *    buys goes from "a good soldier" to "a thing that kills a company".
 *
 *  - **Everything between** interpolates geometrically along the same curve, so
 *    a unit's position within its age is exactly preserved.
 *
 * The two diverge on purpose. Quantity gets cheaper per point of power as the
 * war runs; quality gets more concentrated. Neither wins: a hundred line units
 * beat one elite, and one elite beats twenty.
 */

/** What the cheapest soldier of any age costs. Never changes — that is the point. */
export const LINE_COST = 200

/** The dearest soldier of age zero, and what that price does each age. */
export const ELITE_COST_BASE = 600
export const ELITE_COST_STEP = 2.6

/** What an elite's power does each age. Ahead of its cost, so quality concentrates. */
export const ELITE_POWER_STEP = 3.0

/**
 * The authored cost band of each age: the cheapest and dearest unit in the
 * combined roster, neutral and creed together.
 *
 * Held as CONSTANTS rather than measured from the live arrays because the
 * neutral roster and the creed rosters live in two modules and one imports the
 * other — deriving the bounds would make the result depend on which module a
 * caller happened to load first. Same numbers, no ordering hazard.
 */
export const BAND_COST: ReadonlyArray<readonly [number, number]> = [
  [60, 250],
  [150, 580],
  [310, 760],
  [460, 1400],
  [760, 5200]
]

/**
 * Power per gold as it stands before this pass, normalised to age zero.
 *
 * These are measured, not guessed: `scratchpad/curve.mjs` fights a fixed budget
 * of each age against the age below and reports what a coin bought. After the
 * per-age scalar in `units.ts` closed the age-four crater, the ladder ran
 * 173 / 234 / 315 / 428 / 576 — which is this, normalised. The curve pass is
 * layered on top of that baseline rather than replacing it, so the measurement
 * stays the thing the numbers are anchored to.
 */
export const MEASURED_PG = [1, 1.353, 1.821, 2.474, 3.329] as const

/**
 * How much cheaper or dearer a unit's build time gets along with its price.
 *
 * Sub-linear on purpose. A line unit at a quarter of its old price should pour
 * out faster, and an elite at five times its old price should feel heavy to
 * commit to — but if build time tracked cost outright, an age-five elite would
 * take half a minute on the pad and the Muster Yard's slots would stop meaning
 * anything.
 */
const BUILD_TIME_EXPONENT = 0.35

/**
 * How much longer everything takes to build than it was authored to.
 *
 * A bare yard turned soldiers out fast enough that the Muster Yard was a
 * convenience: you could keep a line up without one, so its slots bought you
 * throughput you did not need yet. Training is now slow enough that PRODUCTION
 * is a bottleneck in its own right — the whole point of having four of them —
 * and the yard is the answer to it rather than a discount on it.
 */
export const TRAIN_TIME_SCALE = 2.4

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** What the dearest unit of an age costs once the curve is laid. */
export function eliteCost(age: number): number {
  return ELITE_COST_BASE * Math.pow(ELITE_COST_STEP, clamp(age, 0, 4))
}

/**
 * Where a unit sits between the line and the elite of its own age, in [0, 1].
 *
 * Measured in LOG space, so that geometric interpolation across the new band
 * reproduces the unit's position exactly rather than crushing the middle of the
 * roster toward one end.
 */
export function bandPosition(unit: UnitDef): number {
  const [lo, hi] = BAND_COST[clamp(unit.age, 0, 4)]
  return clamp(Math.log(unit.cost / lo) / Math.log(hi / lo), 0, 1)
}

/** Target power per gold for a unit at position `t` in age `age`, vs age zero. */
export function targetPowerPerGold(age: number, t: number): number {
  const a = clamp(age, 0, 4)
  const line = a + 1
  const elite = Math.pow(ELITE_POWER_STEP / ELITE_COST_STEP, a)
  return Math.pow(line, 1 - t) * Math.pow(elite, t)
}

/**
 * Re-lays cost and power across a roster in place.
 *
 * Safe to run over the neutral roster and each creed roster separately: every
 * number it uses is a constant, so a unit's result depends only on the unit.
 *
 * Because the multiplier applied to a unit depends only on where it sits in its
 * own age band, two units at the same price are scaled identically — every
 * hand-tuned same-price matchup in the combos codex survives unchanged. What
 * moves is the relationship between the cheap end of an age and the dear end,
 * which is exactly the thing this is meant to move.
 */
export function relayCurves(units: UnitDef[]): void {
  for (const unit of units) {
    const age = clamp(unit.age, 0, 4)
    const t = bandPosition(unit)
    const target = LINE_COST * Math.pow(eliteCost(age) / LINE_COST, t)
    const cost = Math.max(LINE_COST, Math.round(target / 10) * 10)
    const costMul = cost / unit.cost
    const powMul = (targetPowerPerGold(age, t) / MEASURED_PG[age]) * costMul

    unit.cost = cost
    unit.bounty = Math.max(1, Math.round(unit.bounty * costMul))
    unit.xp = Math.max(1, Math.round(unit.xp * costMul))
    unit.hp = Math.max(1, Math.round(unit.hp * powMul))
    unit.damage = Math.round(unit.damage * powMul)
    // Self-repair is authored as a FRACTION of a unit's health, expressed in
    // points a second. Leaving it alone while multiplying health by five would
    // quietly turn a self-repairing elite into one that barely repairs at all.
    if (unit.regen) unit.regen = Math.max(1, Math.round(unit.regen * powMul))
    unit.buildMs = Math.max(700, Math.round(unit.buildMs * Math.pow(costMul, BUILD_TIME_EXPONENT) * TRAIN_TIME_SCALE))
  }
}
