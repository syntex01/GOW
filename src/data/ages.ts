import type { AgeDef } from './types'

/**
 * Five ages of escalating warfare. Each one raises base health, income and
 * population cap, unlocks a new roster, and swaps in a stronger special ability.
 */
export const AGES: AgeDef[] = [
  {
    index: 0,
    name: 'Stone Age',
    xpToAdvance: 700,
    evolveCost: 700,
    baseHp: 6000,
    income: 16,
    populationCap: 12,
    abilityId: 'meteor_shower',
    description: 'Clubs, slings and sharpened bone. Numbers win here.'
  },
  {
    index: 1,
    name: 'Medieval Age',
    xpToAdvance: 1900,
    evolveCost: 1700,
    baseHp: 11000,
    income: 30,
    populationCap: 15,
    abilityId: 'arrow_storm',
    description: 'Steel, siege engines and disciplined ranks.'
  },
  {
    index: 2,
    name: 'Renaissance',
    xpToAdvance: 3600,
    evolveCost: 3400,
    baseHp: 19000,
    income: 52,
    populationCap: 18,
    abilityId: 'cannonade',
    description: 'Gunpowder rewrites the rules. Range starts to matter.'
  },
  {
    index: 3,
    name: 'Modern Age',
    xpToAdvance: 6400,
    evolveCost: 6500,
    baseHp: 32000,
    income: 86,
    populationCap: 21,
    abilityId: 'airstrike',
    description: 'Armour, artillery and the first machines that fly.'
  },
  {
    index: 4,
    name: 'Future Age',
    xpToAdvance: Number.POSITIVE_INFINITY,
    evolveCost: 0,
    baseHp: 52000,
    income: 130,
    populationCap: 26,
    abilityId: 'ion_cannon',
    description: 'Directed energy, walking artillery, orbital fire support.'
  }
]

export const MAX_AGE = AGES.length - 1

export function ageDef(index: number): AgeDef {
  return AGES[Math.max(0, Math.min(MAX_AGE, index))]
}
