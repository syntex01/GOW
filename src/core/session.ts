import type { MatchStats } from './events'
import type { MatchSetup } from '../data/levels'
import type Peer from '../net/peer'
import type { PeerState } from '../net/peer'
import type { NetMessage } from '../net/protocol'
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
  /** Live peer link for a networked match; null in single-player. */
  peer: Peer | null = null
  /** Name the opponent chose, for the HUD. */
  opponentName = 'Opponent'
  /** Set by whichever scene currently owns the peer link. */
  onNetMessage: ((message: NetMessage) => void) | null = null
  /**
   * Link-health handler, owned by the same scene as `onNetMessage`. A peer that
   * simply vanishes never sends a `bye`, so without this the battle scene would
   * wait for input that is never coming.
   */
  onNetState: ((state: PeerState, detail?: string) => void) | null = null
  /**
   * Messages that arrived while no scene owned the link — during the lobby to
   * battle handover, for instance. Lockstep sends each tick exactly once, so
   * dropping even one would stall the match forever.
   */
  private inbox: NetMessage[] = []
  /** Explains why the last networked match stopped, shown back on the menu. */
  netEndReason: string | null = null

  /** Entry point for everything arriving on the wire. */
  deliver(message: NetMessage): void {
    if (this.onNetMessage) this.onNetMessage(message)
    else this.bufferNet(message)
  }

  /** Holds a message for whoever takes ownership next. */
  bufferNet(message: NetMessage): void {
    this.inbox.push(message)
    if (this.inbox.length > 1024) this.inbox.shift()
  }

  /** Entry point for link-health changes. */
  deliverState(state: PeerState, detail?: string): void {
    this.onNetState?.(state, detail)
  }

  /** Installs a handler and immediately replays anything that queued up. */
  setNetHandler(
    handler: ((message: NetMessage) => void) | null,
    onState: ((state: PeerState, detail?: string) => void) | null = null
  ): void {
    this.onNetMessage = handler
    this.onNetState = onState
    if (!handler) return
    const pending = this.inbox
    this.inbox = []
    for (const message of pending) handler(message)
  }

  start(setup: MatchSetup): void {
    this.setup = setup
    this.result = null
  }

  /** Tears the peer link down and returns to single-player defaults. */
  endNetworkMatch(reason = 'ended'): void {
    this.peer?.close(reason)
    this.peer = null
    this.onNetMessage = null
    this.onNetState = null
    this.inbox = []
  }
}

export const session = new Session()
