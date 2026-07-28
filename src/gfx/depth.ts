import { LANE_Y } from '../sim/types'

/**
 * One place that decides what draws in front of what.
 *
 * Depth used to be a scattering of magic numbers across a dozen files, and the
 * numbers disagreed. Soldiers were sorted by their lane (`120 + laneY*0.08`)
 * but corpses were sorted by a different formula in a different band
 * (`80 + stage*0.05`), so a body lying in the near file drew BEHIND a tree in
 * the far file. The fortress sat at 40 — under the lane strips it stands on.
 * Nothing was wrong in isolation; the set of them could not be made consistent
 * because there was no set, only twenty-odd literals.
 *
 * The rule now, and it is the only rule: **anything standing on the ground
 * plane is sorted by the ground line it stands on.** Further up the screen is
 * further away and draws first. Everything else is a fixed band above or below
 * that, and those bands live here as named constants so a new effect can be
 * placed by reading rather than by guessing.
 */

/** Fixed bands, from the back of the world to the front of the glass. */
export const BAND = {
  /** Sky, parallax ridges, distant cities. All behind the ground plane. */
  sky: -1000,
  /** The lane strips: relief, craters and creed tint, painted on the road. */
  terrain: 60,
  /** Zones, scorch and shadows — markings ON the road, under everything. */
  decal: 63,
  /** Spent shells and settled debris lying in the dirt. */
  litter: 70,
  /**
   * The fortress and everything bolted to it.
   *
   * Deliberately BELOW the sorted band rather than inside it. By its own
   * ground line a fortress stands at the middle file, which would put soldiers
   * in the two far files behind it — correct perspective, and unreadable, since
   * those files can attack the gate at the later generations and a player
   * cannot fight what a wall is covering. The win condition is the one object
   * that never occludes a soldier.
   */
  fortress: 100,
  /**
   * Gibs, wreckage and torn limbs in flight. Above the fortress, below the
   * living — flying gore reads as clutter thrown up off the road, and putting
   * it over the soldiers would hide the fight behind its own consequences.
   * Settled bodies drop out of this band into `litter`.
   */
  debris: 110,
  /** The sorted band. See `onGround`. */
  ground: 120,
  /** Shells in flight, over the heads of everyone on the road. */
  projectile: 248,
  /** Aircraft, over the shells. */
  air: 260,
  /** Health bars, damage numbers, unit chrome. */
  chrome: 280,
  /** Explosions, flashes, gore — read over everything in the world. */
  effect: 300
} as const

/**
 * How much depth one file is worth.
 *
 * Files are 34px apart, so the whole board spans `136 * SLOPE` = 10.88 of
 * depth. Anything that wants to sort WITHIN a file has that much room.
 */
const SLOPE = 0.08

/**
 * Sub-slots inside a single file, smallest first. The budget is one file's
 * worth of depth (2.72), so these are deliberately tiny — they order things
 * standing on the same ground line without ever reaching into the next file.
 */
export const SLOT = {
  /** Bodies lie under the living, and under the furniture. */
  corpse: -0.06,
  /** Outworks: raised, so a soldier walks in front of his own granary. */
  building: -0.04,
  /** Trees, carts, boulders. */
  prop: -0.02,
  /** Soldiers, and anything else that walks. */
  unit: 0
} as const

/**
 * The depth of something standing on the ground plane at this lane.
 *
 * `slot` separates things sharing a ground line (a corpse under a soldier);
 * `nudge` orders things sharing both, and is what a formation's stage offset
 * feeds so a soldier at the back of a file draws behind one at the front.
 */
export function onGround(lane: number, slot: number = SLOT.unit, nudge = 0): number {
  const laneY = LANE_Y[Math.max(0, Math.min(LANE_Y.length - 1, lane))]
  return BAND.ground + (laneY + 68) * SLOPE + slot + nudge
}

/**
 * The same, for something positioned by world y rather than by lane index —
 * a building on a plot, say, whose y is derived from its lane but carried
 * around as a coordinate.
 */
export function onGroundAtY(y: number, groundY: number, slot: number = SLOT.unit, nudge = 0): number {
  return BAND.ground + (y - groundY + 68) * SLOPE + slot + nudge
}
