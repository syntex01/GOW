export type DifficultySetting = 'easy' | 'normal' | 'hard'

export interface PlayerSettings {
  difficulty: DifficultySetting
  audioEnabled: boolean
  fastForward: boolean
}

export interface MatchSnapshot {
  age: number
  playerResources: number
  enemyResources: number
  playerBaseHp: number
  enemyBaseHp: number
}

class GameState {
  private settings: PlayerSettings = {
    difficulty: 'normal',
    audioEnabled: true,
    fastForward: false
  }

  private lastSnapshot: MatchSnapshot = {
    age: 1,
    playerResources: 100,
    enemyResources: 100,
    playerBaseHp: 100,
    enemyBaseHp: 100
  }

  getSettings(): PlayerSettings {
    return { ...this.settings }
  }

  updateSettings(partial: Partial<PlayerSettings>) {
    this.settings = { ...this.settings, ...partial }
  }

  resetMatchSnapshot() {
    this.lastSnapshot = {
      age: 1,
      playerResources: 100,
      enemyResources: 100,
      playerBaseHp: 100,
      enemyBaseHp: 100
    }
  }

  setMatchSnapshot(snapshot: MatchSnapshot) {
    this.lastSnapshot = { ...snapshot }
  }

  getMatchSnapshot(): MatchSnapshot {
    return { ...this.lastSnapshot }
  }
}

export const gameState = new GameState()
