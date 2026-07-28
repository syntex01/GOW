/**
 * What a commander can do to the seat itself.
 *
 * The outworks are things you build BESIDE a fortress and an enemy can burn.
 * These are things you do TO the fortress, and nobody can take them off you —
 * which is exactly why there are only three of them and each one costs real
 * money. They are the turtle's half of the argument the building system is
 * having: outworks make your economy reachable, tracks make your gate harder,
 * and the whole point is that you cannot afford to do both.
 *
 * RAMPARTS is the load-bearing one, and it closes the central loop. Every
 * age-up widens the front that can reach your gate — a camp is dug out of one
 * file, the capital you retire into at the last age can be attacked from all
 * five. Ramparts buy that back. Take them all and the only file that can touch
 * your gate is the middle one, at which point the profitable attack on you is
 * against your flanks, which is where your economy stands. Turtling does not
 * remove the war; it relocates it.
 */

export type FortressTrackId = 'ramparts' | 'barbican' | 'cellars'

export interface TrackLevel {
  cost: number
  /** What this level does, in numbers, for the panel. */
  effect: string
}

export interface FortressTrack {
  id: FortressTrackId
  name: string
  /** One line of what the track is for. */
  blurb: string
  color: number
  levels: TrackLevel[]
}

export const FORTRESS_TRACKS: FortressTrack[] = [
  {
    id: 'ramparts',
    name: 'Ramparts',
    blurb: 'Stone, and less of a front to hold.',
    color: 0x9fb4d6,
    levels: [
      { cost: 900, effect: '+25% fortress health.' },
      {
        cost: 2100,
        effect:
          '+55% fortress health, and attackers in the flanking gate files take 22 damage a second from murder holes while they are in reach of the wall.'
      },
      {
        cost: 4400,
        effect:
          '+90% fortress health, and ONLY the middle file can reach your gate at all — whatever generation your seat is.'
      }
    ]
  },
  {
    id: 'barbican',
    name: 'Barbican',
    blurb: 'The gatehouse, and the guns on it.',
    color: 0xffb347,
    levels: [
      {
        cost: 800,
        effect: '+45% turret health, and turrets mend 1.2% a second while nothing is in reach of them.'
      },
      {
        cost: 1900,
        effect: '+95% turret health, and your fortress’s wounds no longer slow its guns.'
      }
    ]
  },
  {
    id: 'cellars',
    name: 'Deep Cellars',
    blurb: 'Stores an enemy standing in your yard cannot get at.',
    color: 0xd8b45a,
    levels: [
      { cost: 750, effect: 'A siege can cut at most 55% of your income instead of 70%.' },
      {
        cost: 1800,
        effect: 'At most 45%, and a building razed on your ground refunds half what it cost to raise.'
      }
    ]
  }
]

export const TRACKS_BY_ID: Record<FortressTrackId, FortressTrack> = Object.fromEntries(
  FORTRESS_TRACKS.map(t => [t.id, t])
) as Record<FortressTrackId, FortressTrack>

/**
 * Later ages pay more for the same stone, on the same curve the economy
 * upgrade uses — otherwise a commander who banks through to the last age buys
 * the whole fortress out of pocket change.
 */
export function trackCost(track: FortressTrack, level: number, age: number): number {
  const base = track.levels[level]?.cost
  if (base === undefined) return 0
  return Math.round(base * (1 + age * 0.55))
}

/**
 * Which files may reach a gate, by ramparts owned.
 *
 * Only the last level actually narrows anything — the first two buy health and
 * murder holes. Kept as a table anyway so the rule is read from data rather
 * than from a comparison buried in the battlefield.
 */
export const RAMPART_LANES: ReadonlySet<number>[] = [
  new Set([0, 1, 2, 3, 4]),
  new Set([0, 1, 2, 3, 4]),
  new Set([0, 1, 2, 3, 4]),
  new Set([2])
]

/** Fortress health multiplier from ramparts owned. */
export const RAMPART_HP = [1, 1.25, 1.55, 1.9]

/** Turret health multiplier from barbican levels owned. */
export const BARBICAN_HP = [1, 1.45, 1.95]

/** The most a siege can cut, by cellar levels owned. */
export const CELLAR_SIEGE_CAP = [0.7, 0.55, 0.45]

/**
 * Murder holes: damage a second dealt to attackers standing in a flanking gate
 * file, once the second rampart is up. The middle file is the gate itself and
 * is deliberately exempt — this punishes spreading out around the walls, not
 * the honest attack straight up the road.
 */
export const MURDER_HOLE_DPS = 22
