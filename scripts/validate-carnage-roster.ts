import { CARNAGE_BLOCKED_TECHS, carnageRosterForAge } from '../src/data/carnage'
import { FACTION_UNITS } from '../src/data/factions'
import { baseIdFor } from '../src/data/morphs'
import { TECHS, TECHS_BY_ID } from '../src/data/tech'
import Army from '../src/sim/army'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function same(actual: readonly string[], expected: readonly string[], label: string): void {
  assert(
    actual.length === expected.length && actual.every((value, index) => value === expected[index]),
    `${label}\nexpected: ${expected.join(', ')}\nactual:   ${actual.join(', ')}`
  )
}

const fullCarnage = [
  'butchery',
  'death_throes',
  'flenser_rite',
  'the_butcher',
  'flensing_hosts',
  'ripjaw_brood',
  'skinriders',
  'brain_thieves',
  'mind_flayers',
  'carrion_choir',
  'charnel_engine',
  'shrike_rite',
  'headsman_rite',
  'the_hunger_made_flesh',
  'the_maw',
  'widow_hatchery',
  'widow_queen',
  'flesh_architecture',
  'incarnation_rite'
]

const expected: Record<number, readonly string[]> = {
  1: ['nk_husk', 'archer', 'pikeman', 'knight', 'monk'],
  2: ['nk_husk', 'nk_flenser', 'nk_ripjaw', 'nk_brainstealer', 'surgeon'],
  3: ['nk_husk', 'nk_butcher', 'nk_ripjaw_alpha', 'nk_broodnurse', 'nk_carrion', 'nk_shrike', 'nk_monstrum', 'nk_widow'],
  4: [
    'nk_husk',
    'nk_flensing_host',
    'nk_skinrider',
    'nk_mindflayer',
    'nk_charnel_engine',
    'nk_headsman',
    'nk_maw',
    'nk_widow_queen',
    'nk_fleshwall',
    'nk_incarnation'
  ]
}

for (const age of [1, 2, 3, 4]) {
  const army = new Army('player', 999_999)
  army.age = age
  for (const id of fullCarnage) army.techs.add(id)
  same(army.roster.map(def => baseIdFor(def.id)), expected[age], `full Carnage age ${age}`)
}

const commitmentOnly = new Army('player', 999_999)
commitmentOnly.age = 1
commitmentOnly.techs.add('butchery')
assert(commitmentOnly.roster.some(def => baseIdFor(def.id) === 'swordsman'), 'Butchery must corrupt, not immediately replace, Man-at-Arms')
commitmentOnly.techs.add('death_throes')
assert(commitmentOnly.roster.some(def => baseIdFor(def.id) === 'nk_husk'), 'Death Throes must unlock Husk')
commitmentOnly.age = 4
assert(commitmentOnly.roster.some(def => baseIdFor(def.id) === 'nk_husk'), 'Husk must persist into age 4')
assert(!commitmentOnly.roster.some(def => baseIdFor(def.id) === 'ripper'), 'Ripper must never return after Husk takes the slot')

const machineProbe = new Army('player', 999_999)
machineProbe.age = 4
for (const id of ['butchery', ...CARNAGE_BLOCKED_TECHS]) machineProbe.techs.add(id)
const machineIds = new Set(['catapult', 'field_cannon', 'mortar_team', 'railgun_walker', 'bazooka', 'missile_battery', 'battle_tank', 'plasma_mech', 'gunship', 'drone_swarm', 'titan'])
assert(
  machineProbe.roster.every(def => !machineIds.has(baseIdFor(def.id))),
  'Carnage commitment leaked a conventional machine onto the roster'
)

const withoutCapstone = carnageRosterForAge(4, new Set(fullCarnage.filter(id => id !== 'incarnation_rite')))
assert(!withoutCapstone.some(def => def.id === 'nk_incarnation'), 'Incarnation must remain optional')

// THE HERALD CONTRACT.
//
// These two assertions previously read `!invest` and `damage > 0`, pinning the
// capstone as a plain deployable body. That was the fix for a real complaint —
// the card used to place nothing on the field — but it unhooked the possession
// system without deleting it, stranding ~165 lines of live simulation behind a
// flag nothing set. The Herald keeps the fix and the mechanic: it invests AND
// it deploys.
//
// What must stay true: it pays into the offer, and it is a body the opponent
// can see and kill. It deliberately does NO damage, so damage is not asserted.
const incarnation = FACTION_UNITS.find(def => def.id === 'nk_incarnation')
assert(incarnation, 'Incarnation definition missing')
assert(incarnation.invest === 'incarnation', 'Herald must pay into the Incarnation')
assert(incarnation.noncombat, 'Herald must be noncombat — it channels, it does not fight')
assert(incarnation.hp > 1 && incarnation.pop > 0, 'Herald must be a real body the opponent can kill')
assert(incarnation.damage === 0, 'Herald must not fight')
assert(TECHS_BY_ID.death_throes?.unlocks === 'nk_husk', 'Death Throes must own the Husk unlock')

const occupied = new Set<string>()
for (const node of TECHS.filter(node => node.branch === 'carnage')) {
  const key = `${node.ring}:${node.row}`
  assert(!occupied.has(key), `Carnage tree collision at ${key}`)
  occupied.add(key)
  for (const parentId of [...node.requires, ...(node.requiresAny ?? [])]) {
    const parent = TECHS_BY_ID[parentId]
    if (parent?.branch === 'carnage') {
      assert(parent.ring < node.ring, `${node.id} points backwards to ${parent.id}`)
    }
  }
}

for (const id of ['butchery', 'death_throes', 'flensing_hosts', 'mind_flayers', 'charnel_engine', 'incarnation_rite']) {
  assert(TECHS_BY_ID[id]?.prominence, `${id} is missing explicit visual prominence`)
}

console.log('Carnage roster progression, machine lockout, deployable capstone and tree layout: OK')
