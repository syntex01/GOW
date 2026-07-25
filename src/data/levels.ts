import type { Difficulty } from '../core/save'
import type { ArmyModifiers } from '../sim/army'

export type GameMode = 'campaign' | 'endless' | 'skirmish'

export interface LevelDef {
  id: string
  name: string
  briefing: string
  /** Age the enemy commander starts in. */
  enemyStartAge: number
  /** Age the player starts in — most missions start at Stone. */
  playerStartAge: number
  startingGold: number
  difficulty: Difficulty
  enemyModifiers: Partial<ArmyModifiers>
  playerModifiers: Partial<ArmyModifiers>
  /** Beat the mission under this many seconds for the third star. */
  parSeconds: number
  /** Finish with at least this share of base health for the second star. */
  healthStar: number
}

/**
 * Twelve missions that teach, then test: each introduces a wrinkle (air power,
 * siege range, economy starvation) before the final gauntlet combines them.
 */
export const LEVELS: LevelDef[] = [
  {
    id: 'l1_first_blood',
    name: '1 — First Blood',
    briefing:
      'A rival tribe has crossed the river. Field clubmen, hold the line, and learn what a war costs.',
    enemyStartAge: 0,
    playerStartAge: 0,
    startingGold: 700,
    difficulty: 'recruit',
    enemyModifiers: { income: 0.65, unitHp: 0.8, unitDamage: 0.8 },
    playerModifiers: {},
    parSeconds: 260,
    healthStar: 0.75
  },
  {
    id: 'l2_the_long_shot',
    name: '2 — The Long Shot',
    briefing: 'They have slingers on the ridge. Answer range with range, or bring something that survives it.',
    enemyStartAge: 0,
    playerStartAge: 0,
    startingGold: 800,
    difficulty: 'recruit',
    enemyModifiers: { income: 0.85 },
    playerModifiers: {},
    parSeconds: 280,
    healthStar: 0.7
  },
  {
    id: 'l3_iron_dawn',
    name: '3 — Iron Dawn',
    briefing:
      'The enemy has already found steel. Evolve quickly — a Stone Age army cannot hold against mail and pike.',
    enemyStartAge: 1,
    playerStartAge: 0,
    startingGold: 1100,
    difficulty: 'veteran',
    enemyModifiers: { income: 0.8, unitHp: 0.9 },
    playerModifiers: { income: 1.15 },
    parSeconds: 330,
    healthStar: 0.65
  },
  {
    id: 'l4_siegeworks',
    name: '4 — Siegeworks',
    briefing: 'Catapults will out-range your walls. Rush them down or build defences that reach further.',
    enemyStartAge: 1,
    playerStartAge: 1,
    startingGold: 1400,
    difficulty: 'veteran',
    enemyModifiers: { income: 1.05 },
    playerModifiers: {},
    parSeconds: 320,
    healthStar: 0.6
  },
  {
    id: 'l5_lean_years',
    name: '5 — Lean Years',
    briefing: 'The treasury is dry. Half income, full enemy. Every coin has to earn its keep.',
    enemyStartAge: 1,
    playerStartAge: 1,
    startingGold: 900,
    difficulty: 'veteran',
    enemyModifiers: { income: 1.15 },
    playerModifiers: { income: 0.6 },
    parSeconds: 380,
    healthStar: 0.55
  },
  {
    id: 'l6_powder_and_shot',
    name: '6 — Powder and Shot',
    briefing: 'Gunpowder changes everything. Musket volleys shred anything without armour.',
    enemyStartAge: 2,
    playerStartAge: 1,
    startingGold: 1800,
    difficulty: 'veteran',
    enemyModifiers: { income: 1.0 },
    playerModifiers: { income: 1.2 },
    parSeconds: 360,
    healthStar: 0.6
  },
  {
    id: 'l7_the_grand_battery',
    name: '7 — The Grand Battery',
    briefing: 'Their field cannons will level your fortress from beyond your walls. Close the distance.',
    enemyStartAge: 2,
    playerStartAge: 2,
    startingGold: 2400,
    difficulty: 'warlord',
    enemyModifiers: { income: 1.15, unitHp: 1.05 },
    playerModifiers: {},
    parSeconds: 340,
    healthStar: 0.55
  },
  {
    id: 'l8_steel_rain',
    name: '8 — Steel Rain',
    briefing: 'Modern armour rolls out today. Rocket teams and pikes of the future — bring anti-tank.',
    enemyStartAge: 3,
    playerStartAge: 2,
    startingGold: 3000,
    difficulty: 'warlord',
    enemyModifiers: { income: 0.95 },
    playerModifiers: { income: 1.25 },
    parSeconds: 400,
    healthStar: 0.5
  },
  {
    id: 'l9_air_superiority',
    name: '9 — Air Superiority',
    briefing:
      'Gunships own the sky and your ground troops cannot reach them. Build SAM batteries before they arrive.',
    enemyStartAge: 3,
    playerStartAge: 3,
    startingGold: 3600,
    difficulty: 'warlord',
    enemyModifiers: { income: 1.2 },
    playerModifiers: {},
    parSeconds: 360,
    healthStar: 0.5
  },
  {
    id: 'l10_the_last_frontier',
    name: '10 — The Last Frontier',
    briefing: 'Directed energy weapons make armour irrelevant. Adapt or be vaporised.',
    enemyStartAge: 4,
    playerStartAge: 3,
    startingGold: 4200,
    difficulty: 'warlord',
    enemyModifiers: { income: 1.0, unitHp: 1.05 },
    playerModifiers: { income: 1.3 },
    parSeconds: 420,
    healthStar: 0.45
  },
  {
    id: 'l11_titanfall',
    name: '11 — Titanfall',
    briefing: 'They are fielding Titans. Nothing you own beats one head-on. Find another way.',
    enemyStartAge: 4,
    playerStartAge: 4,
    startingGold: 5200,
    difficulty: 'nightmare',
    enemyModifiers: { income: 1.25, unitHp: 1.1, unitDamage: 1.05 },
    playerModifiers: {},
    parSeconds: 400,
    healthStar: 0.4
  },
  {
    id: 'l12_end_of_war',
    name: '12 — End of War',
    briefing:
      'The final commander holds every advantage: economy, armour and orbital fire. Take the fortress anyway.',
    enemyStartAge: 4,
    playerStartAge: 4,
    startingGold: 6000,
    difficulty: 'nightmare',
    enemyModifiers: { income: 1.55, unitHp: 1.22, unitDamage: 1.18, baseHp: 1.25, abilityRate: 1.2 },
    playerModifiers: { income: 1.1 },
    parSeconds: 460,
    healthStar: 0.35
  }
]

export const LEVELS_BY_ID: Record<string, LevelDef> = Object.fromEntries(LEVELS.map(l => [l.id, l]))

/** Star rating: 1 for the win, +1 for holding the fortress, +1 for speed. */
export function computeStars(level: LevelDef, healthRatio: number, seconds: number): number {
  let stars = 1
  if (healthRatio >= level.healthStar) stars += 1
  if (seconds <= level.parSeconds) stars += 1
  return stars
}

export interface MatchSetup {
  mode: GameMode
  level?: LevelDef
  difficulty: Difficulty
  /** Endless only: seconds between escalation waves. */
  waveSeconds?: number
}

export const ENDLESS_WAVE_SECONDS = 45
