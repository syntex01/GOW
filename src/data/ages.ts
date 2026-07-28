import type { AgeDef } from './types'

/**
 * Five ages of escalating warfare. Each one raises base health, income and
 * population cap, unlocks a new roster, and swaps in a stronger special ability.
 */
/**
 * The five ages, and the curves that run through them.
 *
 * Everything here is exponential on purpose, and the exponents are chosen
 * against each other rather than picked to feel right:
 *
 *  income        x2.2 an age   16 -> 374 a second
 *  cost to age   x2.6 an age   progression outruns income slightly, so ageing
 *                              is always a decision and never something that
 *                              simply happens to you while you were busy
 *  fortress hp   x2.4 an age, anchored at 8000 rather than the old 6000 —
 *                              population at the first age went up by a third
 *                              and a wall that did not move with it turned the
 *                              opening into a rush. Armies get roughly x2.5 more
 *                              once income and power-per-gold are multiplied
 *                              together, so a wall that grew any slower would
 *                              make every late game a two-minute race
 *  population    NO CAP        there is no unit limit at all. The cap existed
 *                              to stop the field filling up, and filling the
 *                              field is now the entire point: a standard
 *                              soldier costs the same at every age, so how many
 *                              you can field is decided by how much you earn
 *                              and what your buildings do for you, which is a
 *                              decision. An arbitrary ceiling is not.
 *
 * Before this, income grew x8.1 across a match while the cost of progressing
 * barely moved, so the late game was: age up almost for free, then have nothing
 * left to spend money on.
 */
export const AGES: AgeDef[] = [
  {
    index: 0,
    name: 'Stone Age',
    xpToAdvance: 700,
    evolveCost: 1800,
    baseHp: 26000,
    income: 16,
    populationCap: Number.POSITIVE_INFINITY,
    abilityId: 'meteor_shower',
    description: 'Clubs, slings and sharpened bone. Every warrior is precious here.'
  },
  {
    index: 1,
    name: 'Medieval Age',
    xpToAdvance: 1820,
    evolveCost: 4700,
    baseHp: 65000,
    income: 35,
    populationCap: Number.POSITIVE_INFINITY,
    abilityId: 'arrow_storm',
    description: 'Steel, siege engines and disciplined ranks.'
  },
  {
    index: 2,
    name: 'Renaissance',
    xpToAdvance: 4730,
    evolveCost: 12300,
    baseHp: 162500,
    income: 77,
    populationCap: Number.POSITIVE_INFINITY,
    abilityId: 'cannonade',
    description: 'Gunpowder rewrites the rules. Range starts to matter.'
  },
  {
    index: 3,
    name: 'Modern Age',
    xpToAdvance: 12300,
    evolveCost: 32000,
    baseHp: 406000,
    income: 170,
    populationCap: Number.POSITIVE_INFINITY,
    abilityId: 'airstrike',
    description: 'Armour, artillery and the first machines that fly.'
  },
  {
    index: 4,
    name: 'Future Age',
    xpToAdvance: Number.POSITIVE_INFINITY,
    evolveCost: 0,
    baseHp: 1015000,
    income: 374,
    populationCap: Number.POSITIVE_INFINITY,
    abilityId: 'ion_cannon',
    description: 'Directed energy, walking artillery, orbital fire support.'
  }
]

export const MAX_AGE = AGES.length - 1

export function ageDef(index: number): AgeDef {
  return AGES[Math.max(0, Math.min(MAX_AGE, index))]
}
