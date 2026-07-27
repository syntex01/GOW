import type { Faction } from '../sim/types'

/**
 * Wire protocol version — peers refuse to connect across a mismatch, at
 * paste time, in words. Bumped whenever the command stream's *semantics*
 * change, not only its shape: v3 fixed same-tick command ordering; v4 made
 * every sim transcendental deterministic and stopped local difficulty
 * settings from configuring a networked match. Any of those, split across
 * two builds, connects fine and then silently forks the world.
 */
export const PROTOCOL_VERSION = 4

/**
 * Everything a player can do during a match. Commands are the *only* thing
 * that crosses the wire: both peers run the same deterministic simulation and
 * feed it the same command stream, so the worlds stay identical without ever
 * shipping game state.
 */
export type Command =
  | { t: 'unit'; id: string; lane: number }
  | { t: 'evolve' }
  | { t: 'ability' }
  | { t: 'econ' }
  | { t: 'turret'; slot: number; id: string }
  | { t: 'sell'; slot: number }
  | { t: 'cancel' }
  | { t: 'tech'; id: string }

/** One tick's worth of a peer's intent, plus an optional integrity check. */
export interface TickMessage {
  k: 'tick'
  /** The tick these commands execute on (already offset by the input delay). */
  n: number
  c: Command[]
  /** State fingerprint for a recent tick, used to catch divergence. */
  h?: { n: number; v: number }
}

export interface HelloMessage {
  k: 'hello'
  v: number
  /** Shared match seed, chosen by the host. */
  seed: number
  /** Which side the *sender* controls. */
  side: Faction
  name: string
}

export interface StartMessage {
  k: 'start'
  seed: number
  /** Wall-clock-free: both peers begin at tick 0 once this is exchanged. */
  at: number
}

export interface ChatMessage {
  k: 'chat'
  m: string
}

export interface ByeMessage {
  k: 'bye'
  reason: string
}

export type NetMessage = TickMessage | HelloMessage | StartMessage | ChatMessage | ByeMessage

/** Sub-steps executed per network tick. The sim step is 20 ms, so this is 100 ms. */
export const TICK_SUBSTEPS = 5

/**
 * How many ticks ahead commands are scheduled. Two ticks (200 ms) absorbs
 * typical peer-to-peer latency without the players ever noticing: every action
 * in this game is a build order, not a twitch input.
 */
export const INPUT_DELAY_TICKS = 2

/** How often peers exchange a state fingerprint. */
export const HASH_INTERVAL_TICKS = 12
