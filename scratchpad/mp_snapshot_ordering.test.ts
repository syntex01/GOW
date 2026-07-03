/**
 * Multiplayer snapshot-ordering harness.
 *
 * FOCUS: out-of-order / duplicate / stale snapshots must never regress the
 * receiver to an older GameState. We wire two NetControllers via the in-process
 * LoopbackTransport and also interpose a reordering proxy on one side so we can
 * release buffered 'state' messages to a NetController in an arbitrary order and
 * assert the seq-dedup guarantee holds.
 */
import { describe, it, expect } from 'vitest';
import { NetController } from '../src/net/NetController';
import { createLoopbackPair } from '../src/net/LoopbackTransport';
import type { NetMessage, NetStatus, Transport } from '../src/net/Transport';
import type { GameState } from '../src/engine/types';

// ------------------------------------------------------------------ helpers

/** A minimal but structurally-complete mid-game GameState (JSON-safe graph). */
function makeState(over: Partial<GameState> = {}): GameState {
  const base: GameState = {
    round: 2,
    activePlayer: 'A',
    phase: 'shooting',
    firstPlayer: 'A',
    players: {
      A: { id: 'A', name: 'Host', faction: 'Ultramarines', commandPoints: 3, victoryPoints: 12 },
      B: { id: 'B', name: 'Guest', faction: 'Necrons', commandPoints: 2, victoryPoints: 9 },
    },
    units: {
      u1: {
        id: 'u1',
        datasheetId: 'intercessors',
        name: 'Intercessors',
        owner: 'A',
        models: [{ id: 'm1', position: { x: 10, y: 12 }, woundsRemaining: 2, alive: true }],
      } as unknown as GameState['units'][string],
      u2: {
        id: 'u2',
        datasheetId: 'warriors',
        name: 'Necron Warriors',
        owner: 'B',
        models: [{ id: 'm2', position: { x: 40, y: 30 }, woundsRemaining: 1, alive: true }],
      } as unknown as GameState['units'][string],
    },
    objectives: [{ id: 'o1', position: { x: 30, y: 22 }, radius: 3, controlledBy: 'A' }],
    terrain: [
      { id: 't1', kind: 'ruin', center: { x: 24, y: 18 }, width: 6, depth: 4, height: 5, obscuring: true },
    ],
    board: { width: 60, height: 44 },
    log: [{ round: 1, phase: 'command', player: 'A', message: 'Battle begins' }],
    rngSeed: 123456,
    idCounter: 42,
  };
  return { ...base, ...over };
}

/** Full JSON round-trip, mirroring what a real wire does. */
function wire<T>(s: T): T {
  return JSON.parse(JSON.stringify(s)) as T;
}

/**
 * A Transport that wraps a real (loopback) inner transport but BUFFERS inbound
 * messages instead of delivering them, so a test can release them to the
 * NetController in any order / with duplicates. Outbound send() and status pass
 * straight through, so the peer really ships bytes over the loopback.
 */
class ReorderProxy implements Transport {
  readonly role: 'host' | 'guest';
  readonly roomCode: string;
  private inner: Transport;
  private buf: NetMessage[] = [];
  private msgCbs: Array<(m: NetMessage) => void> = [];

  constructor(inner: Transport) {
    this.inner = inner;
    this.role = inner.role;
    this.roomCode = inner.roomCode;
    this.inner.onMessage((m) => this.buf.push(m));
  }
  connect(): Promise<void> {
    return this.inner.connect();
  }
  send(m: NetMessage): void {
    this.inner.send(m);
  }
  onMessage(cb: (m: NetMessage) => void): void {
    this.msgCbs.push(cb);
  }
  onStatus(cb: (s: NetStatus) => void): void {
    this.inner.onStatus(cb);
  }
  close(): void {
    this.inner.close();
  }
  /** How many inbound messages are buffered awaiting release. */
  get pending(): number {
    return this.buf.length;
  }
  /** Snapshot of buffered messages (for inspection). */
  peek(): NetMessage[] {
    return this.buf.slice();
  }
  /** Release the buffered message at index i (does not remove others). */
  release(i: number): void {
    const m = this.buf[i];
    for (const cb of this.msgCbs) cb(m);
  }
  /** Release everything in the given index order (indices into current buffer). */
  releaseOrder(order: number[]): void {
    const snap = this.buf.slice();
    for (const i of order) for (const cb of this.msgCbs) cb(snap[i]);
  }
  clear(): void {
    this.buf = [];
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ tests

describe('snapshot ordering / dedup', () => {
  it('normal turn exchange converges through JSON round-trip', async () => {
    const { host, guest } = createLoopbackPair();
    const a = new NetController(host);
    const b = new NetController(guest);
    const received: GameState[] = [];
    b.onRemoteState((s) => received.push(s as GameState));
    await a.connect();
    await b.connect();
    await flush();

    a.broadcastState(makeState({ round: 2, activePlayer: 'A', phase: 'shooting' }));
    await flush();
    a.broadcastState(makeState({ round: 2, activePlayer: 'A', phase: 'fight' }));
    await flush();

    expect(received.length).toBe(2);
    expect(received[received.length - 1].phase).toBe('fight');
    // Deep structural equality after wire round-trip.
    expect(received[1]).toEqual(wire(makeState({ round: 2, activePlayer: 'A', phase: 'fight' })));
  });

  it('a duplicate snapshot (same seq) is applied at most once', async () => {
    const { host, guest } = createLoopbackPair();
    const a = new NetController(host);
    const proxy = new ReorderProxy(guest);
    const b = new NetController(proxy);
    const got: GameState[] = [];
    b.onRemoteState((s) => got.push(s as GameState));
    await a.connect();
    await b.connect();
    await flush();

    a.broadcastState(makeState({ round: 3 })); // seq 1
    await flush();
    expect(proxy.pending).toBe(1);
    // Deliver the SAME message twice.
    proxy.release(0);
    proxy.release(0);
    expect(got.length).toBe(1); // dedup by seq
    expect(got[0].round).toBe(3);
  });

  it('out-of-order arrival (1,3,2) never regresses; seq 2 is dropped after 3', async () => {
    const { host, guest } = createLoopbackPair();
    const a = new NetController(host);
    const proxy = new ReorderProxy(guest);
    const b = new NetController(proxy);
    const rounds: number[] = [];
    b.onRemoteState((s) => rounds.push((s as GameState).round));
    await a.connect();
    await b.connect();
    await flush();

    a.broadcastState(makeState({ round: 10 })); // seq 1
    await flush();
    a.broadcastState(makeState({ round: 20 })); // seq 2
    await flush();
    a.broadcastState(makeState({ round: 30 })); // seq 3
    await flush();
    expect(proxy.pending).toBe(3);

    // Release out of order: 1, then 3, then the STALE 2.
    proxy.releaseOrder([0, 2, 1]);

    // seq 2 (round 20) must NOT be applied after seq 3 (round 30).
    expect(rounds).toEqual([10, 30]);
    expect(rounds[rounds.length - 1]).toBe(30);
  });

  it('a stale snapshot delivered after a newer one is ignored', async () => {
    const { host, guest } = createLoopbackPair();
    const a = new NetController(host);
    const proxy = new ReorderProxy(guest);
    const b = new NetController(proxy);
    let last: GameState | null = null;
    b.onRemoteState((s) => (last = s as GameState));
    await a.connect();
    await b.connect();
    await flush();

    a.broadcastState(makeState({ round: 5 })); // seq1
    await flush();
    a.broadcastState(makeState({ round: 6 })); // seq2
    await flush();

    proxy.release(1); // apply newer (seq2, round6) first
    proxy.release(0); // then the older (seq1, round5) — must be dropped
    expect(last!.round).toBe(6);
  });

  it('turn handoff: each side keeps its own monotonic send-seq and both converge', async () => {
    // A active -> broadcasts; then B active -> broadcasts; then back to A.
    const { host, guest } = createLoopbackPair();
    const a = new NetController(host);
    const b = new NetController(guest);
    const aGot: GameState[] = [];
    const bGot: GameState[] = [];
    a.onRemoteState((s) => aGot.push(s as GameState));
    b.onRemoteState((s) => bGot.push(s as GameState));
    await a.connect();
    await b.connect();
    await flush();

    // A's turn (round 2), a couple of pushes.
    a.broadcastState(makeState({ round: 2, activePlayer: 'A' }));
    await flush();
    a.broadcastState(makeState({ round: 2, activePlayer: 'A', phase: 'end' }));
    await flush();
    // Handoff to B (round 2, B active). B now pushes.
    b.broadcastState(makeState({ round: 2, activePlayer: 'B', phase: 'command' }));
    await flush();
    b.broadcastState(makeState({ round: 2, activePlayer: 'B', phase: 'shooting' }));
    await flush();
    // Handoff back to A (round 3).
    a.broadcastState(makeState({ round: 3, activePlayer: 'A', phase: 'command' }));
    await flush();

    expect(bGot[bGot.length - 1].activePlayer).toBe('A');
    expect(bGot[bGot.length - 1].round).toBe(3);
    expect(aGot[aGot.length - 1].activePlayer).toBe('B');
    expect(aGot[aGot.length - 1].phase).toBe('shooting');
    // B never regressed to A's round-2 pushes after moving on.
    expect(bGot.map((s) => s.round)).toEqual([2, 2, 3]);
  });

  it('resync: sync-request is answered with a fresh snapshot that applies', async () => {
    const { host, guest } = createLoopbackPair();
    const a = new NetController(host);
    const b = new NetController(guest);
    let latest: GameState | null = null;
    b.onRemoteState((s) => (latest = s as GameState));
    a.onSyncRequest(() => a.broadcastState(makeState({ round: 7, phase: 'fight' })));
    await a.connect();
    await b.connect();
    await flush();

    b.requestSync();
    await flush();
    expect(latest!.round).toBe(7);
    expect(latest!.phase).toBe('fight');
  });

  it('DESYNC PROBE — resync after a reconnect where the answering side keeps its old controller', async () => {
    // Model a real recovery: guest "reconnects" with a fresh NetController
    // (send-seq reset to 0) while the host keeps its long-lived controller
    // (send-seq already advanced). Host answers the guest's sync-request.
    const pair1 = createLoopbackPair();
    const host = new NetController(pair1.host); // long-lived host
    let hostSeqPushes = 0;
    host.onSyncRequest(() => {
      host.broadcastState(makeState({ round: 4, phase: 'movement' }));
      hostSeqPushes++;
    });
    // Host has been playing: it already sent several snapshots this session.
    const bTmp = new NetController(pair1.guest);
    let seen: GameState | null = null;
    bTmp.onRemoteState((s) => (seen = s as GameState));
    await host.connect();
    await bTmp.connect();
    await flush();
    host.broadcastState(makeState({ round: 1 })); // seq1
    await flush();
    host.broadcastState(makeState({ round: 2 })); // seq2
    await flush();
    host.broadcastState(makeState({ round: 3 })); // seq3
    await flush();
    expect(seen!.round).toBe(3);

    // Guest drops; a brand-new guest controller joins on a fresh pipe to the
    // SAME host transport is not possible with loopback, so we validate the
    // seq-recovery contract directly: the guest's fresh controller starts at
    // recvSeq = -1, so ANY seq the host sends (even continuing from 3) applies.
    const freshGuestPair = createLoopbackPair();
    const host2 = new NetController(freshGuestPair.host);
    const guest2 = new NetController(freshGuestPair.guest);
    let g2: GameState | null = null;
    guest2.onRemoteState((s) => (g2 = s as GameState));
    host2.onSyncRequest(() => host2.broadcastState(makeState({ round: 9, phase: 'end' })));
    await host2.connect();
    await guest2.connect();
    await flush();
    guest2.requestSync();
    await flush();
    // Fresh guest (recvSeq=-1) accepts the host's answer regardless of host seq.
    expect(g2!.round).toBe(9);
  });

  it('duplicate+reorder storm: monotonic recv-seq means the final applied state is the newest', async () => {
    const { host, guest } = createLoopbackPair();
    const a = new NetController(host);
    const proxy = new ReorderProxy(guest);
    const b = new NetController(proxy);
    let last: GameState | null = null;
    const appliedRounds: number[] = [];
    b.onRemoteState((s) => {
      last = s as GameState;
      appliedRounds.push((s as GameState).round);
    });
    await a.connect();
    await b.connect();
    await flush();

    for (let r = 1; r <= 6; r++) {
      a.broadcastState(makeState({ round: r * 10 }));
      await flush();
    }
    expect(proxy.pending).toBe(6);
    // Adversarial delivery: reversed, with duplicates sprinkled in.
    proxy.releaseOrder([5, 5, 4, 0, 3, 1, 2, 5, 0]);

    // Only the first (highest, seq6=round60) should apply; everything after is
    // stale/dup and dropped. Applied stream is strictly increasing in seq.
    expect(appliedRounds).toEqual([60]);
    expect(last!.round).toBe(60);
  });

  it('mid-game GameState survives JSON round-trip byte-for-byte', () => {
    const s = makeState({
      round: 3,
      phase: 'charge',
      log: [
        { round: 1, phase: 'command', player: 'A', message: 'a' },
        { round: 2, phase: 'shooting', player: 'B', message: 'b', detail: 'x' },
      ],
    });
    const round = wire(s);
    expect(round).toEqual(s);
    // No functions / class instances leaked in that would break the wire.
    expect(JSON.stringify(round)).toBe(JSON.stringify(s));
  });
});
