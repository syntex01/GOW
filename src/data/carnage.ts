import { FACTION_UNITS } from './factions'
import type { TechId } from './tech'
import type { UnitDef } from './types'
import { rosterForAge, UNITS_BY_ID } from './units'

/** Researching this node is the irreversible roster commitment to Carnage. */
export const CARNAGE_COMMIT_TECH: TechId = 'butchery'

/** Machine doctrines that cease to be researchable after the commitment. */
export const CARNAGE_BLOCKED_TECHS: ReadonlySet<TechId> = new Set<TechId>([
  'siege_train',
  'shaped_charges',
  'armoured_corps',
  'rotary_wing',
  'titan_program'
])

/**
 * Functional command-bar positions. A slot can change body, but it never
 * duplicates its job. This is deliberately independent of unit role: Shrike is
 * melee while the Rocket Team it replaces is ranged, yet both occupy the same
 * execution-specialist decision.
 */
export type CarnageSlot =
  | 'swarm'
  | 'phalanx'
  | 'biologicalRanged'
  | 'antiHorde'
  | 'fastAssault'
  | 'corpseSupport'
  | 'execution'
  | 'heavy'
  | 'airHunter'
  | 'screen'
  | 'capstone'

interface CarnageStage {
  unitId: string
  tech: TechId
  age: number
}

interface SlotLayout {
  slot: CarnageSlot
  /** Current-age standard body used only until Carnage takes the slot. */
  fallbackId?: string
}

type WarAge = 1 | 2 | 3 | 4

const UNIT_BY_ID: Record<string, UnitDef> = {
  ...UNITS_BY_ID,
  ...Object.fromEntries(FACTION_UNITS.map(unit => [unit.id, unit]))
}

/**
 * The replacement ladders. Stages are ordered by age. Once the first stage of
 * a ladder is researched, later standard successors never return: the highest
 * owned Carnage stage at the current age owns that slot.
 */
const CARNAGE_STAGES: Partial<Record<CarnageSlot, readonly CarnageStage[]>> = {
  swarm: [{ unitId: 'nk_husk', tech: 'death_throes', age: 1 }],
  biologicalRanged: [
    { unitId: 'nk_brainstealer', tech: 'brain_thieves', age: 2 },
    { unitId: 'nk_broodnurse', tech: 'brain_thieves', age: 3 },
    { unitId: 'nk_mindflayer', tech: 'mind_flayers', age: 4 }
  ],
  antiHorde: [
    { unitId: 'nk_flenser', tech: 'flenser_rite', age: 2 },
    { unitId: 'nk_butcher', tech: 'the_butcher', age: 3 },
    { unitId: 'nk_flensing_host', tech: 'flensing_hosts', age: 4 }
  ],
  fastAssault: [
    { unitId: 'nk_ripjaw', tech: 'ripjaw_brood', age: 2 },
    { unitId: 'nk_ripjaw_alpha', tech: 'ripjaw_brood', age: 3 },
    { unitId: 'nk_skinrider', tech: 'skinriders', age: 4 }
  ],
  corpseSupport: [
    { unitId: 'nk_carrion', tech: 'carrion_choir', age: 3 },
    { unitId: 'nk_charnel_engine', tech: 'charnel_engine', age: 4 }
  ],
  execution: [
    { unitId: 'nk_shrike', tech: 'shrike_rite', age: 3 },
    { unitId: 'nk_headsman', tech: 'headsman_rite', age: 4 }
  ],
  heavy: [
    { unitId: 'nk_monstrum', tech: 'the_hunger_made_flesh', age: 3 },
    { unitId: 'nk_maw', tech: 'the_maw', age: 4 }
  ],
  airHunter: [
    { unitId: 'nk_widow', tech: 'widow_hatchery', age: 3 },
    { unitId: 'nk_widow_queen', tech: 'widow_queen', age: 4 }
  ],
  screen: [{ unitId: 'nk_fleshwall', tech: 'flesh_architecture', age: 4 }],
  capstone: [{ unitId: 'nk_incarnation', tech: 'incarnation_rite', age: 4 }]
}

/**
 * The visible slot order at each age. Machine fallbacks are named here to make
 * the intended replacement explicit, then rejected below after commitment.
 */
const CARNAGE_LAYOUT: Record<WarAge, readonly SlotLayout[]> = {
  1: [
    { slot: 'swarm', fallbackId: 'swordsman' },
    { slot: 'biologicalRanged', fallbackId: 'archer' },
    { slot: 'phalanx', fallbackId: 'pikeman' },
    { slot: 'heavy', fallbackId: 'knight' },
    { slot: 'corpseSupport', fallbackId: 'monk' }
  ],
  2: [
    { slot: 'swarm', fallbackId: 'duelist' },
    { slot: 'antiHorde', fallbackId: 'grenadier' },
    { slot: 'fastAssault', fallbackId: 'cuirassier' },
    { slot: 'biologicalRanged', fallbackId: 'musketeer' },
    { slot: 'corpseSupport', fallbackId: 'surgeon' }
  ],
  3: [
    { slot: 'swarm', fallbackId: 'shock_trooper' },
    { slot: 'antiHorde', fallbackId: 'machinegunner' },
    { slot: 'fastAssault' },
    { slot: 'biologicalRanged', fallbackId: 'rifleman' },
    { slot: 'corpseSupport', fallbackId: 'medic' },
    { slot: 'execution', fallbackId: 'bazooka' },
    { slot: 'heavy', fallbackId: 'battle_tank' },
    { slot: 'airHunter', fallbackId: 'gunship' }
  ],
  4: [
    { slot: 'swarm', fallbackId: 'ripper' },
    { slot: 'antiHorde' },
    { slot: 'fastAssault' },
    { slot: 'biologicalRanged', fallbackId: 'laser_trooper' },
    { slot: 'corpseSupport', fallbackId: 'nano_medic' },
    { slot: 'execution', fallbackId: 'missile_battery' },
    { slot: 'heavy', fallbackId: 'plasma_mech' },
    { slot: 'airHunter', fallbackId: 'drone_swarm' },
    { slot: 'screen', fallbackId: 'shield_bearer' },
    { slot: 'capstone', fallbackId: 'titan' }
  ]
}

const EMPTY_UNLOCKS: ReadonlySet<string> = new Set<string>()

function unit(id: string): UnitDef {
  const found = UNIT_BY_ID[id]
  if (!found) throw new Error(`Carnage roster references unknown unit: ${id}`)
  return found
}

function ownsStage(stage: CarnageStage, techs: ReadonlySet<string>, unlocked: ReadonlySet<string>): boolean {
  return techs.has(stage.tech) || unlocked.has(stage.unitId)
}

function replacementFor(
  slot: CarnageSlot,
  age: number,
  techs: ReadonlySet<string>,
  unlocked: ReadonlySet<string>
): UnitDef | null {
  let chosen: CarnageStage | null = null
  for (const stage of CARNAGE_STAGES[slot] ?? []) {
    if (stage.age <= age && ownsStage(stage, techs, unlocked)) chosen = stage
  }
  return chosen ? unit(chosen.unitId) : null
}

export function isCarnageCommitted(techs: ReadonlySet<string>): boolean {
  return techs.has(CARNAGE_COMMIT_TECH) || techs.has('ascend_nekrotics')
}

/**
 * Exact Carnage command bar for an age.
 *
 * Standard soldiers remain only while their slot has not been taken. A
 * researched Carnage body persists through every later age, selecting a newer
 * form only when its own ladder says so. Conventional line-tech machines are
 * never accepted as fallbacks after Butchery.
 */
export function carnageRosterForAge(
  age: number,
  techs: ReadonlySet<string>,
  unlocked: ReadonlySet<string> = EMPTY_UNLOCKS
): UnitDef[] {
  const clamped = Math.max(0, Math.min(4, Math.floor(age)))
  if (clamped === 0) return rosterForAge(0)

  const out: UnitDef[] = []
  const seen = new Set<string>()
  for (const entry of CARNAGE_LAYOUT[clamped as WarAge]) {
    const replacement = replacementFor(entry.slot, clamped, techs, unlocked)
    const fallback = entry.fallbackId ? unit(entry.fallbackId) : null
    // A machine fallback is intentionally an EMPTY slot after commitment. The
    // matching Carnage research fills it; the old doctrine never leaks back in.
    const chosen = replacement ?? (fallback?.lineTech ? null : fallback)
    if (!chosen || seen.has(chosen.id)) continue
    seen.add(chosen.id)
    out.push(chosen)
  }
  return out
}

const REPLACEMENT_SUMMARIES: Record<TechId, string> = {
  butchery:
    'commits the roster to Carnage: standard machines close, and every later Carnage replacement permanently owns its functional slot',
  death_throes: 'replaces the basic-infantry slot with Husk; the same Husk card grows through every later age',
  flenser_rite: 'replaces the anti-horde slot with Flenser; Butcher and Flensing Host inherit that slot and its earlier buffs',
  the_butcher: 'evolves the anti-horde slot from Flenser to Butcher without adding another card',
  flensing_hosts: 'evolves the anti-horde slot from Butcher to Flensing Host',
  ripjaw_brood: 'replaces the fast-assault slot with Ripjaw; it becomes Ripjaw Alpha automatically in age 3',
  skinriders: 'evolves the fast-assault slot from Ripjaw Alpha to Skinrider',
  brain_thieves: 'replaces the firearm slot with Brain Stealer; it becomes Brood Nurse automatically in age 3',
  mind_flayers: 'evolves the biological-ranged slot from Brood Nurse to Mind Flayer',
  carrion_choir: 'replaces the modern medic slot with Carrion Choir',
  charnel_engine: 'evolves the corpse-support slot from Carrion Choir to Charnel Engine',
  shrike_rite: 'fills the disabled rocket slot with Shrike, an organic execution specialist',
  headsman_rite: 'evolves the execution slot from Shrike to Headsman',
  the_hunger_made_flesh: 'fills the disabled armour slot with Monstrum',
  the_maw: 'evolves the heavy-monster slot from Monstrum to Great Maw',
  widow_hatchery: 'fills the disabled aircraft slot with Carrion Widow',
  widow_queen: 'evolves the air-hunter slot from Carrion Widow to Widow Queen',
  flesh_architecture: 'replaces the Aegis screen slot with Flesh Wall',
  incarnation_rite: 'fills the disabled Titan slot with the Herald of Slaughter, which channels the Incarnation on the field'
}

export function carnageReplacementSummary(techId: TechId): string | null {
  return REPLACEMENT_SUMMARIES[techId] ?? null
}
