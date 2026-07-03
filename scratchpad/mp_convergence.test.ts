/**
 * Two-peer convergence over LoopbackTransport.
 *
 * We model the snapshot-authoritative protocol exactly as HUD.ts does:
 *  - The ACTIVE player mutates its own GameEngine, then broadcastState(engine.state).
 *  - The peer's NetController.onRemoteState fires; we apply it wholesale
 *    (engine.state = clone; rng reseeded) — mirroring GameUI.applyRemoteState.
 *  - Broadcast gating mirrors HUD.refresh(): host 'A' may broadcast from the
 *    start; guest 'B' only after it has received the host's first snapshot;
 *    never while applying a remote snapshot.
 *
 * Convergence == the two engines' GameState are structurally identical after a
 * JSON round-trip (the wire representation).
 */
import { describe, it, expect } from 'vitest';
import type { Datasheet, GameState } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { NetController } from '../src/net/NetController';
import { createLoopbackPair } from '../src/net/LoopbackTransport';
import type { NetMessage, NetStatus, Transport } from '../src/net/Transport';

/* ------------------------------------------------------------------ fixtures */

const TROOPER: Datasheet = {
  id: 'trooper',
  name: 'Trooper',
  faction: 'TestFaction',
  keywords: ['Infantry'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [
    {
      id: 'rifle',
      name: 'Rifle',
      kind: 'ranged',
      range: 100, // long range so position never matters
      attacks: 4,
      skill: 2,
      strength: 8,
      ap: 5,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [],
  composition: [{ modelName: 'Trooper', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};
const registry: Record<string, Datasheet> = { trooper: TROOPER };

function freshState(seed = 4242): GameState {
  const list = (name: string): ArmyList => ({
    name,
    faction: 'TestFaction',
    entries: [{ datasheetId: 'trooper', modelCount: 5 }],
  });
  return createGame(
    {
      seed,
      players: {
        A: { name: 'Alice', faction: 'TestFaction' },
        B: { name: 'Bob', faction: 'TestFaction' },
      },
    },
    registry,
    list('A'),
    list('B'),
  );
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

/** Drain microtasks + macrotask queue (LoopbackTransport delivers on microtasks). */
const flush = () => new Promise<void>((res) => setTimeout(res, 0));

/**
 * A test peer: an engine + a NetController, wired to mirror GameUI's online
 * gating (applyRemoteState + refresh-broadcast discipline).
 */
class Peer {
  engine: GameEngine;
  net: NetController;
  readonly seat: 'A' | 'B';
  applyingRemote = false;
  hasReceivedRemote = false;
  /** Snapshots we accepted from the peer, in order (for out-of-order checks). */
  appliedSeqs: number[] = [];

  constructor(transport: Transport, state: GameState) {
    this.engine = new GameEngine(clone(state));
    this.engine.startGame();
    this.net = new NetController(transport);
    this.seat = this.net.localPlayer;
    this.net.onRemoteState((s) => this.applyRemote(s));
  }

  /** Mirrors GameUI.applyRemoteState. */
  private applyRemote(s: unknown): void {
    this.applyingRemote = true;
    this.hasReceivedRemote = true;
    this.engine.state = s as GameState;
    this.applyingRemote = false;
  }

  /** Mirrors HUD.refresh()'s broadcast gate: run AFTER a local mutation. */
  broadcast(): void {
    if (this.applyingRemote) return;
    if (this.seat === 'A' || this.hasReceivedRemote) {
      this.net.broadcastState(this.engine.state);
    }
  }
}

async function connectPair(state: GameState): Promise<{ a: Peer; b: Peer }> {
  const { host, guest } = createLoopbackPair('ROOM');
  const a = new Peer(host, state);
  const b = new Peer(guest, state);
  await a.net.connect();
  await b.net.connect();
  await flush();
  return { a, b };
}

/** Structural equality of the two live GameStates as seen on the wire. */
function expectConverged(a: Peer, b: Peer): void {
  expect(wire(a.engine.state)).toEqual(wire(b.engine.state));
}

/* -------------------------------------------------------------------- tests */

describe('two-peer snapshot convergence over loopback', () => {
  it('initial deployment is identical on both peers', async () => {
    const { a, b } = await connectPair(freshState());
    expectConverged(a, b);
  });

  it('active player A plays a full turn; B converges after each broadcast', async () => {
    const { a, b } = await connectPair(freshState());

    // Opening host push so the guest has received state (mirrors setupOnline).
    a.broadcast();
    await flush();
    expect(b.hasReceivedRemote).toBe(true);
    expectConverged(a, b);

    // A: command -> movement
    a.engine.advancePhase();
    a.broadcast();
    await flush();
    expect(b.engine.state.phase).toBe('movement');
    expectConverged(a, b);

    // A: move a unit
    const aUnit = a.engine.unitsOf('A')[0];
    const okMove = a.engine.moveUnit(aUnit, 'normal', { x: 3, y: 0 });
    expect(okMove).toBe(true);
    a.broadcast();
    await flush();
    expectConverged(a, b);

    // A: movement -> shooting, then shoot B's unit
    a.engine.advancePhase();
    a.broadcast();
    await flush();
    const attacker = a.engine.unitsOf('A')[0];
    const target = a.engine.unitsOf('B')[0];
    a.engine.shoot(attacker, target);
    a.broadcast();
    await flush();
    const woundSum = (s: GameState, id: string) =>
      s.units[id].models.reduce((n, m) => n + (m.alive ? m.wounds : 0), 0);
    // Whatever A's dice produced (kills, or nothing if LOS was blocked), B's
    // snapshot must mirror it exactly — combat results are baked into the wire.
    expect(woundSum(b.engine.state, target.id)).toBe(woundSum(a.engine.state, target.id));
    expectConverged(a, b);
  });

  it('turn hand-off then reverse: B becomes active, plays, A converges', async () => {
    const { a, b } = await connectPair(freshState());
    a.broadcast();
    await flush();

    // A walks all the way to end and passes the turn to B.
    for (let i = 0; i < 6; i++) {
      a.engine.advancePhase();
      a.broadcast();
      await flush();
    }
    expect(a.engine.active).toBe('B');
    expectConverged(a, b);
    expect(b.engine.active).toBe('B'); // guest now sees it is its turn

    // Now B is authoritative: it acts and broadcasts; A must converge.
    b.engine.advancePhase(); // command -> movement
    b.broadcast();
    await flush();
    const bUnit = b.engine.unitsOf('B')[0];
    b.engine.moveUnit(bUnit, 'normal', { x: -4, y: 0 });
    b.broadcast();
    await flush();
    expect(a.engine.state.phase).toBe('movement');
    expectConverged(a, b);

    // B shoots A.
    b.engine.advancePhase(); // movement -> shooting
    b.broadcast();
    await flush();
    const bAtt = b.engine.unitsOf('B')[0];
    const aTgt = b.engine.unitsOf('A')[0];
    b.engine.shoot(bAtt, aTgt);
    b.broadcast();
    await flush();
    expectConverged(a, b);

    // B passes back to A; another full round to exercise round increment.
    for (let i = 0; i < 6; i++) {
      // advance from current phase (shooting) through end
      b.engine.advancePhase();
      b.broadcast();
      await flush();
      if (b.engine.active === 'A') break;
    }
    expect(a.engine.active).toBe('A');
    expect(a.engine.state.round).toBeGreaterThanOrEqual(2);
    expectConverged(a, b);
  });

  it('mid-game GameState survives a JSON round-trip with no data loss', async () => {
    const state = freshState();
    const eng = new GameEngine(state);
    eng.startGame();
    eng.advancePhase(); // movement
    eng.moveUnit(eng.unitsOf('A')[0], 'normal', { x: 2, y: 1 });
    eng.advancePhase(); // shooting
    eng.shoot(eng.unitsOf('A')[0], eng.unitsOf('B')[0]);

    const round = wire(eng.state) as GameState;
    // Deep structural equality (the invariant the sync relies on).
    expect(round).toEqual(clone(eng.state));

    // No NaN/Infinity anywhere: JSON silently turns these into null, which would
    // desync positions/stats without any error. Scan the whole graph.
    const bad: string[] = [];
    const scan = (v: unknown, path: string) => {
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) bad.push(`${path} = ${v}`);
      } else if (v && typeof v === 'object') {
        for (const [k, vv] of Object.entries(v)) scan(vv, `${path}.${k}`);
      }
    };
    scan(eng.state, 'state');
    expect(bad, `non-finite numbers would not survive JSON: ${bad.join(', ')}`).toEqual([]);
  });
});

/* ---- Direct NetController protocol tests (seq dedup / stale / resync) ------ */

/**
 * A hand-driven transport so we can inject messages in ANY order (Loopback is
 * strictly FIFO). Same NetController under test.
 */
class ManualTransport implements Transport {
  readonly role: 'host' | 'guest';
  readonly roomCode = 'MANUAL';
  private msgCbs: Array<(m: NetMessage) => void> = [];
  private statusCbs: Array<(s: NetStatus) => void> = [];
  sent: NetMessage[] = [];
  constructor(role: 'host' | 'guest') {
    this.role = role;
  }
  async connect(): Promise<void> {
    for (const cb of this.statusCbs) cb('connected');
  }
  send(m: NetMessage): void {
    this.sent.push(clone(m));
  }
  onMessage(cb: (m: NetMessage) => void): void {
    this.msgCbs.push(cb);
  }
  onStatus(cb: (s: NetStatus) => void): void {
    this.statusCbs.push(cb);
  }
  close(): void {}
  /** Inject an inbound message right now. */
  inject(m: NetMessage): void {
    for (const cb of this.msgCbs) cb(clone(m));
  }
}

describe('NetController seq / stale / resync protocol', () => {
  it('drops an out-of-order (older seq) snapshot; keeps the newer state', async () => {
    const t = new ManualTransport('guest');
    const net = new NetController(t);
    await net.connect();
    const applied: number[] = [];
    net.onRemoteState((s) => applied.push((s as { round: number }).round));

    net.onRemoteState(() => {});
    // Deliver seq 3 (round 3), then a STALE seq 2 (round 99) out of order.
    t.inject({ t: 'state', state: { round: 3 }, seq: 3 });
    t.inject({ t: 'state', state: { round: 99 }, seq: 2 });
    t.inject({ t: 'state', state: { round: 4 }, seq: 4 });

    // The stale seq-2 must be dropped; only 3 then 4 applied.
    expect(applied).toEqual([3, 4]);
  });

  it('drops a duplicate seq', async () => {
    const t = new ManualTransport('guest');
    const net = new NetController(t);
    await net.connect();
    const applied: number[] = [];
    net.onRemoteState((s) => applied.push((s as { round: number }).round));
    t.inject({ t: 'state', state: { round: 1 }, seq: 1 });
    t.inject({ t: 'state', state: { round: 1 }, seq: 1 }); // dup
    expect(applied).toEqual([1]);
  });

  it('resync (sync-request -> pushState) reconverges a peer that missed a snapshot', async () => {
    // Host authoritative; guest simulated missing a mid-stream snapshot, then
    // asks for a fresh one.
    const { host, guest } = createLoopbackPair('RS');
    const state = freshState();
    const a = new Peer(host, state);
    const b = new Peer(guest, state);
    // Host answers sync-requests by pushing current state (mirrors main.ts).
    a.net.onSyncRequest(() => a.net.broadcastState(a.engine.state));
    await a.net.connect();
    await b.net.connect();
    await flush();

    // Host advances several times but pretend guest is briefly deaf: we detach B's
    // remote handler so the snapshots are received-but-ignored (a dropped frame).
    const savedB = (b as unknown as { net: NetController }).net;
    // Simulate loss by NOT broadcasting during this window at all.
    a.engine.advancePhase();
    a.engine.advancePhase();
    a.engine.moveUnit(a.engine.unitsOf('A')[0], 'normal', { x: 5, y: 0 });
    // Host never broadcast these — guest is now behind.
    expect(wire(a.engine.state)).not.toEqual(wire(b.engine.state));

    // Guest requests a resync; host answers with current authoritative state.
    b.net.requestSync();
    await flush();
    expect(wire(a.engine.state)).toEqual(wire(b.engine.state));
    void savedB;
  });

  it('a stale push from the NO-LONGER-active player clobbers the peer (authority is behavioral, not enforced)', async () => {
    // This documents the protocol's reliance on the active-player discipline: the
    // seq dedup is per-DIRECTION, so a late/erroneous push from the side that has
    // already handed off the turn is accepted (its seq is legitimately higher)
    // and overwrites the new active player's progress.
    const { host, guest } = createLoopbackPair('AUTH');
    const state = freshState();
    const a = new Peer(host, state);
    const b = new Peer(guest, state);
    await a.net.connect();
    await b.net.connect();
    await flush();

    // A hands the turn to B and broadcasts the hand-off.
    const passTurn = () => {
      for (let i = 0; i < 6; i++) a.engine.advancePhase();
    };
    a.broadcast();
    await flush();
    // Snapshot A's PRE-handoff state to replay as a stale push later.
    const stalePre = clone(a.engine.state);
    passTurn();
    a.broadcast();
    await flush();
    expect(b.engine.active).toBe('B');

    // B (now active) makes progress and broadcasts.
    b.engine.advancePhase();
    b.engine.moveUnit(b.engine.unitsOf('B')[0], 'normal', { x: -3, y: 0 });
    b.broadcast();
    await flush();
    expectConverged(a, b);

    // Now A erroneously pushes its STALE pre-handoff state (e.g. a mis-fired
    // heartbeat / a bug in the isLocalTurn guard). It carries a higher A-seq, so
    // B accepts it — silently reverting the game to A's turn and losing B's move.
    a.engine.state = stalePre; // rewind A to the stale snapshot
    a.net.broadcastState(a.engine.state); // bypass the discipline gate on purpose
    await flush();

    // Demonstrated desync: B has been dragged back to A's turn / round-1 command.
    expect(b.engine.active).toBe('A');
    expect(wire(b.engine.state)).toEqual(wire(stalePre));
    // A and B still agree structurally (both stale) — but the GAME STATE is wrong:
    // B's legitimate move was destroyed with no error surfaced.
  });

  it('the NON-active player can mutate shared state via the stratagem panel and clobber the active turn', async () => {
    // Reproduces the ungated stratagem path: HUD.renderStratagems enables any
    // affordable, right-phase, non-reaction stratagem based on the ACTIVE
    // player's CP — with NO canLocalAct()/localPlayer check — and main.ts calls
    // engine.activateStratagem(id, sel) (defaulting actingPlayer to the active
    // player) then ui.refresh(), which broadcasts. So during A's turn, B's client
    // can spend A's CP, apply an effect to A's unit, and push it to A.
    const { a, b } = await connectPair(freshState());
    a.broadcast();
    await flush();

    // Advance A into its shooting phase; B tracks it.
    a.engine.advancePhase(); // movement
    a.engine.advancePhase(); // shooting
    a.broadcast();
    await flush();
    expect(a.engine.active).toBe('A');
    expect(b.engine.active).toBe('A'); // B sees it is A's turn (B is the defender)

    const aUnitId = a.engine.unitsOf('A')[0].id;
    const aCpBefore = a.engine.state.players.A.commandPoints;
    expect(aCpBefore).toBeGreaterThanOrEqual(1); // enough for Command Re-roll (1CP)

    // 'command_reroll' is when:'either', phase:'any' — renderStratagems marks it
    // ENABLED on B's client during A's turn. B "clicks" it (as main.ts would):
    const res = b.engine.activateStratagem('command_reroll', { unitId: aUnitId });
    expect(res.ok).toBe(true); // engine happily applies it for the active player A
    b.broadcast(); // HUD.refresh() would broadcast — B has hasReceivedRemote
    await flush();

    // A's OWN authoritative state has been overwritten by B: A's CP was spent and
    // A's unit got a re-roll flag that A never activated — during A's own turn.
    expect(a.engine.state.players.A.commandPoints).toBe(aCpBefore - 1);
    expect(a.engine.state.units[aUnitId].pendingRerollHits).toBe(true);
    expect(a.engine.active).toBe('A'); // still A's turn — B illegitimately acted in it
  });
});
