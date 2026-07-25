import type { AbilityDef } from './types'

/**
 * One screen-clearing special per age. Charge builds passively and, faster,
 * from kills — so a side that is winning the fight also earns the panic button.
 */
export const ABILITIES: AbilityDef[] = [
  {
    id: 'meteor_shower',
    name: 'Meteor Shower',
    short: 'METEORS',
    age: 0,
    chargeSeconds: 62,
    description: 'Fourteen burning rocks fall across the enemy half of the field.',
    color: 0xff8a3d
  },
  {
    id: 'arrow_storm',
    name: 'Arrow Storm',
    short: 'ARROW STORM',
    age: 1,
    chargeSeconds: 58,
    description: 'A blackout volley of arrows saturates the approach.',
    color: 0xd7dee8
  },
  {
    id: 'cannonade',
    name: 'Cannonade',
    short: 'CANNONADE',
    age: 2,
    chargeSeconds: 56,
    description: 'A rolling barrage marches from the enemy base toward yours.',
    color: 0xffc46b
  },
  {
    id: 'airstrike',
    name: 'Air Strike',
    short: 'AIR STRIKE',
    age: 3,
    chargeSeconds: 54,
    description: 'A bomber run carpets the field with high explosive.',
    color: 0x8fd6ff
  },
  {
    id: 'ion_cannon',
    name: 'Orbital Ion Cannon',
    short: 'ION CANNON',
    age: 4,
    chargeSeconds: 52,
    description: 'A sustained orbital beam sweeps the battlefield clean.',
    color: 0x9d7bff
  }
]

export const ABILITIES_BY_ID: Record<string, AbilityDef> = Object.fromEntries(ABILITIES.map(a => [a.id, a]))

export function abilityForAge(age: number): AbilityDef {
  return ABILITIES[Math.max(0, Math.min(ABILITIES.length - 1, age))]
}
