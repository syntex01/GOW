import Phaser from 'phaser'
import type { Faction } from '../sim/types'

/** Payloads for every cross-scene event, so listeners stay type-safe. */
export interface GameEventMap {
  'hud:sync': HudSnapshot
  'hud:flash': { message: string; tone: 'info' | 'warn' | 'good' }
  /** Open or close the research screen. */
  'hud:tech': void
  'match:ended': { victory: boolean; stats: MatchStats }
  'match:paused': { paused: boolean }
  'ability:used': { faction: Faction; abilityId: string }
  'age:advanced': { faction: Faction; age: number }
  'settings:changed': void
}

export interface HudSideSnapshot {
  gold: number
  xp: number
  xpToNext: number
  age: number
  baseHp: number
  baseMaxHp: number
  population: number
  populationCap: number
}

export interface HudSnapshot {
  player: HudSideSnapshot
  enemy: HudSideSnapshot
  queue: { unitId: string; progress: number }[]
  abilityCharge: number
  abilityReady: boolean
  elapsedMs: number
  wave: number
  speed: number
}

export interface MatchStats {
  unitsBuilt: number
  unitsLost: number
  kills: number
  goldEarned: number
  goldSpent: number
  damageDealt: number
  damageTaken: number
  agesReached: number
  abilitiesUsed: number
  durationMs: number
  score: number
  wavesSurvived: number
}

class TypedEmitter {
  private emitter = new Phaser.Events.EventEmitter()

  on<K extends keyof GameEventMap>(
    key: K,
    handler: (payload: GameEventMap[K]) => void,
    context?: unknown
  ): void {
    this.emitter.on(key as string, handler, context)
  }

  once<K extends keyof GameEventMap>(
    key: K,
    handler: (payload: GameEventMap[K]) => void,
    context?: unknown
  ): void {
    this.emitter.once(key as string, handler, context)
  }

  off<K extends keyof GameEventMap>(
    key: K,
    handler: (payload: GameEventMap[K]) => void,
    context?: unknown
  ): void {
    this.emitter.off(key as string, handler, context)
  }

  emit<K extends keyof GameEventMap>(key: K, payload: GameEventMap[K]): void {
    this.emitter.emit(key as string, payload)
  }

  removeAll(): void {
    this.emitter.removeAllListeners()
  }
}

export const gameEvents = new TypedEmitter()
