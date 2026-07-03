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
  private syncReqCbs: Array<() => void> = [];
  private joinCbs: Array<(join: { army: unknown; faction: string; name?: string; session?: string }) => void> = [];
  private _status: NetStatus = 'disconnected';
  /** True once we have ever been fully connected. Lets sends survive a transient
   *  post-connection 'error' (the DataConnection is usually still open), instead
   *  of the coarse status permanently gagging sync with no path back. */
  private everConnected = false;

  constructor(transport: Transport) {
    this.transport = transport;
    this.localPlayer = transport.role === 'host' ? 'A' : 'B';

    this.transport.onStatus((s) => {
      this._status = s;
      if (s === 'connected') this.everConnected = true;
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
      } else if (m.t === 'sync-request') {
        // Peer asked for a fresh snapshot (joined, or missed one) — let the host
        // re-broadcast its authoritative state.
        for (const cb of this.syncReqCbs) cb();
      } else if (m.t === 'join') {
        for (const cb of this.joinCbs) cb({ army: m.army, faction: m.faction, name: m.name, session: m.session });
      }
      // 'hello' is informational; no controller-level handling needed for v1.
    });
  }

  /** Whether the link is usable for sending: connected, or a transient error
   *  after having been connected (a true 'disconnected'/close blocks sends). */
  private canSend(): boolean {
    return this._status === 'connected' || (this.everConnected && this._status === 'error');
  }

  /** Open the underlying transport. */
  connect(): Promise<void> {
    return this.transport.connect();
  }

  /** Broadcast a full authoritative state snapshot to the peer. */
  broadcastState(state: unknown): void {
    if (!this.canSend()) return;
    this.transport.send({ t: 'state', state, seq: ++this.sendSeq });
  }

  /** Ask the peer to (re)send its full state. Used by a guest on connect and to
   *  recover a dropped snapshot. */
  requestSync(): void {
    if (!this.canSend()) return;
    this.transport.send({ t: 'sync-request' });
  }

  /** Fired when the peer requests a fresh snapshot (answer with broadcastState). */
  onSyncRequest(cb: () => void): void {
    this.syncReqCbs.push(cb);
  }

  /** Guest → host: hand the host our chosen army so it can build the shared game
   *  with the army we actually configured. `session` reclaims a seat on rejoin. */
  sendJoin(army: unknown, faction: string, name?: string, session?: string): void {
    if (!this.canSend()) return;
    this.transport.send({ t: 'join', army, faction, name, session });
  }

  /** Host: fired when the guest sends its army (initial join or a reconnect). */
  onJoin(cb: (join: { army: unknown; faction: string; name?: string; session?: string }) => void): void {
    this.joinCbs.push(cb);
  }

  /** Send a chat line to the peer. */
  sendChat(text: string): void {
    if (!this.canSend()) return;
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
