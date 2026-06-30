/**
 * Transport — the minimal pipe abstraction the rest of the net layer talks to.
 *
 * A Transport is a bidirectional, message-oriented channel between exactly two
 * peers: a `host` (which owns the room) and a `guest` (which joins it). It knows
 * nothing about the game; it just ships `NetMessage`s and reports connection
 * status. Concrete implementations: `PeerTransport` (WebRTC over peerjs) and
 * `LoopbackTransport` (in-process, for tests / pass-and-play).
 */

/** Messages exchanged over the wire. Always JSON-serializable. */
export type NetMessage =
  /** A full authoritative GameState snapshot from the active player. */
  | { t: 'state'; state: unknown; seq: number }
  /** Greeting sent right after a connection opens (optional display name). */
  | { t: 'hello'; name?: string }
  /** Free-text chat line. */
  | { t: 'chat'; text: string };

/** Coarse connection lifecycle state surfaced to the UI. */
export type NetStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface Transport {
  /** Open the channel. Resolves once connected (or rejects on failure). */
  connect(): Promise<void>;
  /** Send a message to the peer. No-op if not currently connected. */
  send(msg: NetMessage): void;
  /** Register a callback invoked for each inbound message. */
  onMessage(cb: (m: NetMessage) => void): void;
  /** Register a callback invoked on every status change. */
  onStatus(cb: (s: NetStatus) => void): void;
  /** Tear down the channel and release resources. */
  close(): void;
  /** Whether this endpoint created the room ('host') or joined it ('guest'). */
  readonly role: 'host' | 'guest';
  /** The shared room code (host id) used to pair the two peers. */
  readonly roomCode: string;
}
