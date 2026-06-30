/**
 * NetController — the game-facing wrapper around a Transport.
 *
 * It owns the authoritative full-state sync protocol:
 *  - The active player calls `broadcastState(state)` after each local action;
 *    the controller tags it with a monotonically increasing `seq` and sends it.
 *  - Inbound 'state' messages are de-duplicated by `seq`: only a strictly newer
 *    seq fires `onRemoteState`, so stale / out-of-order snapshots are dropped.
 *
 * It is transport-agnostic: hand it a LoopbackTransport in tests or a
 * PeerTransport in the browser — the contract is identical.
 *
 * Convention: host is player 'A', guest is player 'B'.
 */

import type { NetMessage, NetStatus, Transport } from './Transport';

export class NetController {
  private transport: Transport;
  /** Which seat this endpoint controls. */
  readonly localPlayer: 'A' | 'B';

  /** Highest seq we've sent. */
  private sendSeq = 0;
  /** Highest seq we've accepted from the peer (-1 = none yet). */
  private recvSeq = -1;

  private remoteStateCbs: Array<(state: any) => void> = [];
  private statusCbs: Array<(s: NetStatus) => void> = [];
  private chatCbs: Array<(text: string) => void> = [];
  private _status: NetStatus = 'disconnected';

  constructor(transport: Transport) {
    this.transport = transport;
    this.localPlayer = transport.role === 'host' ? 'A' : 'B';

    this.transport.onStatus((s) => {
      this._status = s;
      for (const cb of this.statusCbs) cb(s);
    });

    this.transport.onMessage((m: NetMessage) => {
      if (m.t === 'state') {
        // Drop stale or duplicate snapshots; only advance on a strictly newer seq.
        if (typeof m.seq !== 'number' || m.seq <= this.recvSeq) return;
        this.recvSeq = m.seq;
        for (const cb of this.remoteStateCbs) cb(m.state);
      } else if (m.t === 'chat') {
        for (const cb of this.chatCbs) cb(m.text);
      }
      // 'hello' is informational; no controller-level handling needed for v1.
    });
  }

  /** Open the underlying transport. */
  connect(): Promise<void> {
    return this.transport.connect();
  }

  /** Broadcast a full authoritative state snapshot to the peer. */
  broadcastState(state: unknown): void {
    if (this._status !== 'connected') return;
    this.transport.send({ t: 'state', state, seq: ++this.sendSeq });
  }

  /** Send a chat line to the peer. */
  sendChat(text: string): void {
    if (this._status !== 'connected') return;
    this.transport.send({ t: 'chat', text });
  }

  /** Fired when a newer-seq authoritative state arrives. */
  onRemoteState(cb: (state: any) => void): void {
    this.remoteStateCbs.push(cb);
  }

  /** Fired on every connection status change. */
  onStatus(cb: (s: NetStatus) => void): void {
    this.statusCbs.push(cb);
  }

  /** Fired when a chat message arrives. */
  onChat(cb: (text: string) => void): void {
    this.chatCbs.push(cb);
  }

  /** Current connection status. */
  get status(): NetStatus {
    return this._status;
  }

  /** The shared room code (host id). */
  get roomCode(): string {
    return this.transport.roomCode;
  }

  /** Tear down the connection. */
  close(): void {
    this.transport.close();
  }
}
