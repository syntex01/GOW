import type Battlefield from '../sim/battlefield'
import type { Faction } from '../sim/types'
import { OPPOSITE } from '../sim/types'
import {
  HASH_INTERVAL_TICKS,
  INPUT_DELAY_TICKS,
  TICK_SUBSTEPS,
  type Command,
  type TickMessage
} from './protocol'

export interface LockstepCallbacks {
  /** Ship one tick's commands to the peer. */
  send: (message: TickMessage) => void
  /** Raised once if the two simulations ever disagree. */
  onDesync: (tick: number, mine: number, theirs: number) => void
  /** Called when the peer's input stops arriving, and again when it resumes. */
  onStall: (stalled: boolean) => void
  /**
   * The peer's input has been missing long enough that it is not coming back.
   * The transport can still look healthy here — a frozen tab holds its data
   * channel open — so the command stream drying up is the only symptom.
   */
  onLost: () => void
}

/** How long the peer's input may be missing before the match is called off. */
const STALL_TIMEOUT_MS = 30000

/**
 * The single place a command turns into a change in the world. Single-player
 * calls it directly; networked play routes every command through it on both
 * peers, in the same order, which is what keeps the simulations identical.
 */
export function applyCommand(bf: Battlefield, faction: Faction, command: Command): void {
  const army = bf.armyFor(faction)
  switch (command.t) {
    case 'unit':
      bf.queueUnit(faction, command.id, command.lane ?? 1)
      break
    case 'evolve':
      bf.evolve(faction)
      break
    case 'ability':
      bf.useAbility(faction)
      break
    case 'econ':
      army.buyIncomeUpgrade()
      break
    case 'turret':
      bf.buildTurret(faction, command.slot, command.id)
      break
    case 'sell':
      bf.sellTurret(faction, command.slot)
      break
    case 'cancel':
      army.cancelLast()
      break
    case 'tech':
      bf.buyTech(faction, command.id)
      break
  }
}

/**
 * Deterministic lockstep.
 *
 * Neither peer is authoritative and no game state is ever transmitted. Both run
 * the identical fixed-step simulation and exchange only the commands each
 * player issues, scheduled a couple of ticks into the future. A tick executes
 * only once *both* sides' commands for it are known, which is what guarantees
 * the two worlds stay in step.
 *
 * Periodic state fingerprints are compared as a safety net: if the simulations
 * ever diverge — say a browser's `Math.sin` rounds differently — the match is
 * stopped and reported rather than allowed to drift into two different games.
 */
export default class LockstepDriver {
  readonly localFaction: Faction
  private bf: Battlefield
  private callbacks: LockstepCallbacks

  /** Next tick that will execute. */
  private tick = 0
  /** Commands the local player has issued for the upcoming scheduled tick. */
  private pending: Command[] = []
  private localQueue = new Map<number, Command[]>()
  private remoteQueue = new Map<number, Command[]>()
  /** Fingerprints we produced, kept until the peer's copy arrives. */
  private localHashes = new Map<number, number>()
  private accumulator = 0
  private stalled = false
  private stallMs = 0
  private finished = false

  desynced = false

  constructor(bf: Battlefield, localFaction: Faction, callbacks: LockstepCallbacks) {
    this.bf = bf
    this.localFaction = localFaction
    this.callbacks = callbacks
    // Seed the pipeline. The opening ticks are committed empty on both sides
    // because no command can have been issued yet — but they still have to be
    // *sent*, or each peer sits waiting for the other's tick 0 forever.
    for (let i = 0; i < INPUT_DELAY_TICKS; i += 1) {
      this.commitLocal(i, [])
      callbacks.send({ k: 'tick', n: i, c: [] })
    }
  }

  get currentTick(): number {
    return this.tick
  }

  get isStalled(): boolean {
    return this.stalled
  }

  /** Queues a command; it will execute INPUT_DELAY_TICKS from now on both peers. */
  issue(command: Command): void {
    if (this.finished || this.desynced) return
    this.pending.push(command)
  }

  private commitLocal(tick: number, commands: Command[]): void {
    this.localQueue.set(tick, commands)
  }

  /** Feeds a tick message received from the peer. */
  receive(message: TickMessage): void {
    this.remoteQueue.set(message.n, message.c)
    if (message.h) this.checkHash(message.h.n, message.h.v)
  }

  private checkHash(tick: number, theirs: number): void {
    const mine = this.localHashes.get(tick)
    if (mine === undefined) return
    this.localHashes.delete(tick)
    if (mine !== theirs && !this.desynced) {
      this.desynced = true
      this.callbacks.onDesync(tick, mine, theirs)
    }
  }

  /**
   * Advances real time into simulation ticks. Returns the number of ticks
   * executed this frame, which the caller can use for diagnostics.
   */
  update(deltaMs: number, tickMs: number): number {
    if (this.finished || this.desynced) return 0

    this.accumulator += Math.min(250, deltaMs)
    let executed = 0

    // Catch up at most a few ticks per frame so a hitch cannot freeze the app.
    while (this.accumulator >= tickMs && executed < 4) {
      const scheduled = this.tick + INPUT_DELAY_TICKS
      if (!this.localQueue.has(scheduled)) {
        // Publish this frame's intent for its future tick.
        const commands = this.pending
        this.pending = []
        this.commitLocal(scheduled, commands)
        const message: TickMessage = { k: 'tick', n: scheduled, c: commands }
        const hashTick = this.tick - HASH_INTERVAL_TICKS
        const hash = this.localHashes.get(hashTick)
        if (hash !== undefined) message.h = { n: hashTick, v: hash }
        this.callbacks.send(message)
      }

      const localCommands = this.localQueue.get(this.tick)
      const remoteCommands = this.remoteQueue.get(this.tick)
      if (localCommands === undefined || remoteCommands === undefined) {
        // Waiting on the peer — hold the clock rather than running ahead.
        this.stallMs += deltaMs
        if (!this.stalled && this.stallMs > 600) {
          this.stalled = true
          this.callbacks.onStall(true)
        }
        if (this.stallMs > STALL_TIMEOUT_MS) {
          this.finished = true
          this.callbacks.onLost()
        }
        return executed
      }

      if (this.stalled) {
        this.stalled = false
        this.stallMs = 0
        this.callbacks.onStall(false)
      }
      this.stallMs = 0

      this.executeTick(localCommands, remoteCommands)
      this.localQueue.delete(this.tick)
      this.remoteQueue.delete(this.tick)
      this.tick += 1
      this.accumulator -= tickMs
      executed += 1
    }

    return executed
  }

  /** Runs exactly one tick with an explicit command pair. Used by tests. */
  executeTick(localCommands: Command[], remoteCommands: Command[]): void {
    // Command order is fixed — local side first, then remote — so both peers
    // apply them in precisely the same sequence.
    for (const c of localCommands) this.apply(this.localFaction, c)
    for (const c of remoteCommands) this.apply(OPPOSITE[this.localFaction], c)

    this.bf.stepFixed(TICK_SUBSTEPS)

    if (this.tick % HASH_INTERVAL_TICKS === 0) {
      this.localHashes.set(this.tick, this.bf.stateHash())
      // Never let unmatched fingerprints accumulate forever.
      if (this.localHashes.size > 16) {
        const oldest = this.localHashes.keys().next().value
        if (oldest !== undefined) this.localHashes.delete(oldest)
      }
    }

    if (this.bf.finished) this.finished = true
  }

  private apply(faction: Faction, command: Command): void {
    applyCommand(this.bf, faction, command)
  }

  stop(): void {
    this.finished = true
  }
}
