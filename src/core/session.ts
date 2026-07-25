import type { MatchStats } from './events'
import type { MatchSetup } from '../data/levels'
import { save } from './save'

export interface MatchResult {
  victory: boolean
  stats: MatchStats
  setup: MatchSetup
  stars: number
  newRecord: boolean
  unlockedAchievements: string[]
}

/** Carries the chosen match configuration and its outcome between scenes. */
class Session {
  setup: MatchSetup = { mode: 'skirmish', difficulty: save.settings.difficulty }
  result: MatchResult | null = null

  start(setup: MatchSetup): void {
    this.setup = setup
    this.result = null
  }
}

export const session = new Session()
