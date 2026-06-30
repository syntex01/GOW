/**
 * LoopbackTransport — an in-process Transport pair.
 *
 * Two linked transports deliver each other's messages on a microtask (so the
 * async ordering matches a real network without flakiness). Used by tests and
 * by local "pass-and-play" where both seats live in one tab.
 */

import type { NetMessage, NetStatus, Transport } from './Transport';

class LoopbackTransport implements Transport {
  readonly role: 'host' | 'guest';
  readonly roomCode: string;

  /** The opposite end of the pipe; set by createLoopbackPair. */
  private peer: LoopbackTransport | null = null;
  private messageCbs: Array<(m: NetMessage) => void> = [];
  private statusCbs: Array<(s: NetStatus) => void> = [];
  private connected = false;

  constructor(role: 'host' | 'guest', roomCode: string) {
    this.role = role;
    this.roomCode = roomCode;
  }

  /** @internal Wire the two ends together. */
  _link(peer: LoopbackTransport): void {
    this.peer = peer;
  }

  async connect(): Promise<void> {
    this.connected = true;
    // Report connected on a microtask so callers can attach handlers first.
    queueMicrotask(() => this.emitStatus('connected'));
  }

  send(msg: NetMessage): void {
    if (!this.connected || !this.peer) return;
    // Clone via JSON so callers can't observe shared references (mirrors a wire).
    const copy = JSON.parse(JSON.stringify(msg)) as NetMessage;
    queueMicrotask(() => this.peer?.deliver(copy));
  }

  onMessage(cb: (m: NetMessage) => void): void {
    this.messageCbs.push(cb);
  }

  onStatus(cb: (s: NetStatus) => void): void {
    this.statusCbs.push(cb);
  }

  close(): void {
    if (!this.connected) return;
    this.connected = false;
    this.emitStatus('disconnected');
    // Notify the peer that we've gone away.
    const peer = this.peer;
    if (peer?.connected) {
      peer.connected = false;
      queueMicrotask(() => peer.emitStatus('disconnected'));
    }
  }

  /** @internal Receive a message from the peer. */
  private deliver(msg: NetMessage): void {
    if (!this.connected) return;
    for (const cb of this.messageCbs) cb(msg);
  }

  private emitStatus(s: NetStatus): void {
    for (const cb of this.statusCbs) cb(s);
  }
}

/** Create a host+guest pair of transports linked to each other. */
export function createLoopbackPair(
  roomCode = 'LOOPBACK',
): { host: Transport; guest: Transport } {
  const host = new LoopbackTransport('host', roomCode);
  const guest = new LoopbackTransport('guest', roomCode);
  host._link(guest);
  guest._link(host);
  return { host, guest };
}
