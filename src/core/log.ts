import { PROTOCOL_VERSION } from '../net/protocol'

/**
 * The session's black box.
 *
 * When two players three time zones apart say "it just didn't work", a
 * harness on one machine proves nothing. This ring buffer records what THIS
 * copy of the game actually did — every lobby status, every ICE candidate
 * type and connection-state change, the match seed and role, a state
 * fingerprint every hash interval, and the exact tick a desync was declared
 * with both hashes — cheap enough to be always on.
 *
 * Two players export their logs after a bad session, and diffing the `hash`
 * lines finds the first tick the worlds disagreed; the `net` lines tell the
 * connection story candidate by candidate. F9 saves it in battle; the
 * multiplayer screen has a button. The newest log is also persisted so it
 * survives a closed tab.
 */

interface Entry {
  at: number
  tag: string
  msg: string
}

const STORE_KEY = 'gow.debuglog.v1'
const MAX_ENTRIES = 5000

class GameLog {
  private entries: Entry[] = []
  private readonly startedAt = Date.now()

  constructor() {
    if (typeof window === 'undefined') return
    window.addEventListener('error', event => this.log('error', `${event.message} @${event.filename?.split('/').pop()}:${event.lineno}`))
    window.addEventListener('unhandledrejection', event => this.log('error', `unhandled rejection: ${String(event.reason).slice(0, 300)}`))
    // A closed tab should not take the evidence with it.
    window.addEventListener('beforeunload', () => this.persist())
  }

  log(tag: string, msg: string): void {
    this.entries.push({ at: Date.now() - this.startedAt, tag, msg })
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, 1000)
  }

  /** The whole session as text, headed by everything version-shaped. */
  dump(): string {
    const lines = [
      `GOW session log — exported ${new Date().toISOString()}`,
      `protocol v${PROTOCOL_VERSION}`,
      typeof navigator !== 'undefined' ? `ua: ${navigator.userAgent}` : '',
      typeof location !== 'undefined' ? `page: ${location.protocol}//${location.host || '(local file)'}` : '',
      `session start: ${new Date(this.startedAt).toISOString()}`,
      `entries: ${this.entries.length}`,
      ''
    ]
    for (const e of this.entries) {
      lines.push(`${(e.at / 1000).toFixed(3).padStart(9, ' ')}  ${e.tag.padEnd(7, ' ')} ${e.msg}`)
    }
    return lines.join('\n')
  }

  /** Saves the current dump so it can still be exported after a restart. */
  persist(): void {
    try {
      window.localStorage.setItem(STORE_KEY, this.dump())
    } catch {
      /* storage full or blocked — the in-memory log still works */
    }
  }

  /** Downloads this session's log, with the previously saved one appended. */
  download(): void {
    let text = this.dump()
    try {
      const prev = window.localStorage.getItem(STORE_KEY)
      // The persisted copy is usually an earlier snapshot of THIS session;
      // only append it when it starts differently (i.e. a previous run).
      if (prev && prev.split('\n')[4] !== text.split('\n')[4]) {
        text += '\n\n══════════ previous session (recovered) ══════════\n' + prev
      }
    } catch {
      /* fine without it */
    }
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gow-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    this.log('log', 'log exported')
  }
}

export const gameLog = new GameLog()
