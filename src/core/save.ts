import type { MatchStats } from './events'

const STORAGE_KEY = 'gow.save.v1'

export type Difficulty = 'recruit' | 'veteran' | 'warlord' | 'nightmare'

export const DIFFICULTIES: Difficulty[] = ['recruit', 'veteran', 'warlord', 'nightmare']

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  recruit: 'Recruit',
  veteran: 'Veteran',
  warlord: 'Warlord',
  nightmare: 'Nightmare'
}

export interface Settings {
  difficulty: Difficulty
  musicVolume: number
  sfxVolume: number
  screenShake: boolean
  showDamageNumbers: boolean
  bloodEffects: boolean
  particleQuality: 'low' | 'medium' | 'high'
  autoSpeed: boolean
}

export interface CampaignProgress {
  /** Level id -> best star rating (0-3). Absent means not yet beaten. */
  stars: Record<string, number>
  /** Highest level index unlocked. */
  unlocked: number
}

export interface Achievement {
  id: string
  name: string
  description: string
  /** Progress needed to unlock. */
  target: number
}

export interface SaveData {
  version: number
  settings: Settings
  campaign: CampaignProgress
  endlessBest: Record<Difficulty, number>
  achievements: Record<string, number>
  lifetime: MatchStats
  totalPlaytimeMs: number
  matchesPlayed: number
  matchesWon: number
}

const EMPTY_STATS: MatchStats = {
  unitsBuilt: 0,
  unitsLost: 0,
  kills: 0,
  goldEarned: 0,
  goldSpent: 0,
  damageDealt: 0,
  damageTaken: 0,
  agesReached: 0,
  abilitiesUsed: 0,
  durationMs: 0,
  score: 0,
  wavesSurvived: 0
}

function defaults(): SaveData {
  return {
    version: 1,
    settings: {
      difficulty: 'veteran',
      musicVolume: 0.45,
      sfxVolume: 0.7,
      screenShake: true,
      showDamageNumbers: true,
      bloodEffects: true,
      particleQuality: 'high',
      autoSpeed: false
    },
    campaign: { stars: {}, unlocked: 0 },
    endlessBest: { recruit: 0, veteran: 0, warlord: 0, nightmare: 0 },
    achievements: {},
    lifetime: { ...EMPTY_STATS },
    totalPlaytimeMs: 0,
    matchesPlayed: 0,
    matchesWon: 0
  }
}

/** Merge stored data over defaults so new fields appear for old saves. */
function hydrate(raw: unknown): SaveData {
  const base = defaults()
  if (!raw || typeof raw !== 'object') return base
  const stored = raw as Partial<SaveData>
  return {
    ...base,
    ...stored,
    settings: { ...base.settings, ...(stored.settings ?? {}) },
    campaign: {
      stars: { ...(stored.campaign?.stars ?? {}) },
      unlocked: stored.campaign?.unlocked ?? 0
    },
    endlessBest: { ...base.endlessBest, ...(stored.endlessBest ?? {}) },
    achievements: { ...(stored.achievements ?? {}) },
    lifetime: { ...base.lifetime, ...(stored.lifetime ?? {}) }
  }
}

class SaveStore {
  private data: SaveData
  private available: boolean

  constructor() {
    this.available = SaveStore.probeStorage()
    this.data = hydrate(this.read())
  }

  private static probeStorage(): boolean {
    try {
      const probe = '__gow_probe__'
      window.localStorage.setItem(probe, '1')
      window.localStorage.removeItem(probe)
      return true
    } catch {
      return false
    }
  }

  private read(): unknown {
    if (!this.available) return null
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  private flush(): void {
    if (!this.available) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data))
    } catch {
      /* Quota or private mode — play on without persistence. */
    }
  }

  get settings(): Settings {
    return this.data.settings
  }

  get campaign(): CampaignProgress {
    return this.data.campaign
  }

  get lifetime(): MatchStats {
    return this.data.lifetime
  }

  get all(): Readonly<SaveData> {
    return this.data
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch }
    this.flush()
  }

  recordCampaignResult(levelId: string, levelIndex: number, stars: number): void {
    const previous = this.data.campaign.stars[levelId] ?? 0
    if (stars > previous) this.data.campaign.stars[levelId] = stars
    if (stars > 0) {
      this.data.campaign.unlocked = Math.max(this.data.campaign.unlocked, levelIndex + 1)
    }
    this.flush()
  }

  recordEndless(difficulty: Difficulty, waves: number): boolean {
    const best = this.data.endlessBest[difficulty] ?? 0
    if (waves > best) {
      this.data.endlessBest[difficulty] = waves
      this.flush()
      return true
    }
    return false
  }

  recordMatch(stats: MatchStats, victory: boolean): void {
    const life = this.data.lifetime
    life.unitsBuilt += stats.unitsBuilt
    life.unitsLost += stats.unitsLost
    life.kills += stats.kills
    life.goldEarned += stats.goldEarned
    life.goldSpent += stats.goldSpent
    life.damageDealt += stats.damageDealt
    life.damageTaken += stats.damageTaken
    life.abilitiesUsed += stats.abilitiesUsed
    life.durationMs += stats.durationMs
    life.score += stats.score
    life.agesReached = Math.max(life.agesReached, stats.agesReached)
    life.wavesSurvived = Math.max(life.wavesSurvived, stats.wavesSurvived)
    this.data.totalPlaytimeMs += stats.durationMs
    this.data.matchesPlayed += 1
    if (victory) this.data.matchesWon += 1
    this.flush()
  }

  /** Bumps an achievement counter and returns true the moment it completes. */
  bumpAchievement(id: string, amount: number, target: number): boolean {
    const before = this.data.achievements[id] ?? 0
    if (before >= target) return false
    const after = before + amount
    this.data.achievements[id] = after
    this.flush()
    return after >= target
  }

  achievementProgress(id: string): number {
    return this.data.achievements[id] ?? 0
  }

  reset(): void {
    this.data = defaults()
    this.flush()
  }
}

export const save = new SaveStore()

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_blood', name: 'First Blood', description: 'Destroy your first enemy unit.', target: 1 },
  { id: 'centurion', name: 'Centurion', description: 'Destroy 100 enemy units.', target: 100 },
  { id: 'legion', name: 'Legion', description: 'Destroy 1000 enemy units.', target: 1000 },
  { id: 'evolved', name: 'Evolution', description: 'Reach the Future Age in a single battle.', target: 1 },
  { id: 'flawless', name: 'Flawless', description: 'Win a battle without losing any base health.', target: 1 },
  { id: 'demolition', name: 'Demolition Expert', description: 'Use 25 special abilities.', target: 25 },
  { id: 'warlord', name: 'Warlord', description: 'Win a battle on Warlord difficulty.', target: 1 },
  { id: 'nightmare', name: 'Nightmare Walker', description: 'Win a battle on Nightmare difficulty.', target: 1 },
  { id: 'survivor', name: 'Survivor', description: 'Survive 20 waves in Endless mode.', target: 20 },
  { id: 'campaigner', name: 'Campaigner', description: 'Complete every campaign mission.', target: 12 },
  { id: 'perfectionist', name: 'Perfectionist', description: 'Earn 36 campaign stars.', target: 36 },
  { id: 'tycoon', name: 'War Economy', description: 'Earn 100,000 gold across all battles.', target: 100000 }
]
