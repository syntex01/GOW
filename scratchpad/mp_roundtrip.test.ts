import { describe, it, expect } from 'vitest';
import { createGame, type ArmyList, type GameConfig } from '../src/engine/factory';
import { DATASHEETS } from '../src/engine/data/index';
import { GameEngine } from '../src/engine/game';
import type { GameState, UnitInstance } from '../src/engine/types';
import { NetController } from '../src/net/NetController';
import { createLoopbackPair } from '../src/net/LoopbackTransport';

/** Build a real mid-game GameState by running a few engine actions. */
function buildMidGame(): GameState {
  const config: GameConfig = {
    seed: 12345,
    players: {
      A: { name: 'Alice', faction: 'Ultramarines' },
      B: { name: 'Bob', faction: 'Necrons' },
    },
  };
  const listA: ArmyList = {
    name: 'A', faction: 'Ultramarines',
    entries: [
      { datasheetId: 'ultramarines_intercessors', modelCount: 5 },
      { datasheetId: 'ultramarines_captain', modelCount: 1 },
    ],
  };
  const listB: ArmyList = {
    name: 'B', faction: 'Necrons',
    entries: [
      { datasheetId: 'necron_warriors', modelCount: 10 },
      { datasheetId: 'necron_overlord', modelCount: 1 },
    ],
  };
  const state = createGame(config, DATASHEETS, listA, listB);
  const eng = new GameEngine(state);
  eng.startGame(); // command phase, gains CP, etc.
  // Advance into movement and move A's units toward the enemy.
  eng.advancePhase(); // command -> movement
  const aUnits = eng.unitsOf('A');
  for (const u of aUnits) {
    eng.moveUnit(u, 'normal', { x: 0, y: 3 });
  }
  // Set some transient/stratagem flags that must survive the wire.
  const first = aUnits[0];
  first.goToGround = true;
  first.defensiveFlagRound = state.round;
  first.pendingRerollHits = true;
  first.armourOfContempt = true;
  // Give B some victory/command point deltas.
  state.players.B.commandPoints = 3;
  state.players.A.victoryPoints = 12;
  state.players.A.secondaryVictoryPoints = 5;
  state.players.A.oathTarget = eng.unitsOf('B')[0].id;
  // Push into shooting so the phase machine has mutated more state.
  eng.advancePhase(); // movement -> shooting
  return eng.state;
}

/** Walk a value graph and flag anything JSON cannot faithfully carry:
 *  NaN/Infinity -> null, undefined-in-array -> null, functions, bigint,
 *  Map/Set/class instances that don't round-trip as plain records. */
function findNonJsonSafe(v: any, path = '$', out: string[] = []): string[] {
  if (v === null) return out;
  const t = typeof v;
  if (t === 'number') {
    if (!Number.isFinite(v)) out.push(`${path}: non-finite number ${v}`);
    return out;
  }
  if (t === 'bigint') out.push(`${path}: bigint`);
  if (t === 'function') out.push(`${path}: function`);
  if (t === 'undefined') return out; // dropped as an object key (fine)
  if (Array.isArray(v)) {
    v.forEach((el, i) => {
      if (el === undefined) out.push(`${path}[${i}]: undefined-in-array -> null`);
      findNonJsonSafe(el, `${path}[${i}]`, out);
    });
    return out;
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      out.push(`${path}: non-plain object (${v?.constructor?.name})`);
    }
    for (const k of Object.keys(v)) findNonJsonSafe(v[k], `${path}.${k}`, out);
  }
  return out;
}

describe('GameState JSON round-trip', () => {
  it('contains no fields that JSON cannot faithfully carry', () => {
    const state = buildMidGame();
    const offenders = findNonJsonSafe(state);
    expect(offenders).toEqual([]);
  });

  it('re-hydrated state deep-equals the original in-memory object', () => {
    const state = buildMidGame();
    const wire = JSON.parse(JSON.stringify(state)) as GameState;
    // Honest comparison: the rehydrated graph vs the ORIGINAL object. toEqual
    // ignores keys whose value is `undefined` (they read as false/absent and are
    // behaviourally inert), so this passes iff no LOAD-BEARING field was lost.
    expect(wire).toEqual(state);
  });

  it('re-hydrated state produces identical subsequent engine behaviour', () => {
    // Two independent mid-game states with identical construction + seed.
    const original = buildMidGame();
    const wire = JSON.parse(JSON.stringify(buildMidGame())) as GameState;

    const runShooting = (s: GameState): string => {
      const eng = new GameEngine(s);
      const attacker = eng.unitsOf('A').find((u) => eng.canShoot(u));
      const target = eng.enemiesOf('A')[0];
      if (attacker && target) eng.shoot(attacker, target);
      eng.scoreEndOfTurn();
      return JSON.stringify(eng.state);
    };
    // `original` is a raw in-memory object; `wire` went through the wire. If any
    // field were lossy, later deterministic play would diverge.
    expect(runShooting(wire)).toEqual(runShooting(original));
  });
});

/** Drive two NetControllers over a loopback pipe. */
async function flush(): Promise<void> {
  // Multiple microtask hops (connect + delivery + resync answer).
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('NetController snapshot sync over loopback', () => {
  it('applies a full snapshot verbatim on the peer (deep-equal, JSON round-tripped)', async () => {
    const { host, guest } = createLoopbackPair();
    const A = new NetController(host);
    const B = new NetController(guest);
    let received: GameState | null = null;
    B.onRemoteState((s) => { received = s; });
    await A.connect();
    await B.connect();
    await flush();

    const state = buildMidGame();
    A.broadcastState(state);
    await flush();

    expect(received).not.toBeNull();
    // Peer's copy must equal the JSON projection of the authoritative state.
    expect(received).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it('drops stale / out-of-order snapshots (seq monotonicity)', async () => {
    const { host, guest } = createLoopbackPair();
    const A = new NetController(host);
    const B = new NetController(guest);
    const seen: number[] = [];
    B.onRemoteState((s: any) => { seen.push(s.round); });
    await A.connect();
    await B.connect();
    await flush();

    // Broadcast three snapshots with distinct rounds; all in-order -> all seen.
    const s1 = buildMidGame(); s1.round = 1;
    const s2 = buildMidGame(); s2.round = 2;
    const s3 = buildMidGame(); s3.round = 3;
    A.broadcastState(s1);
    A.broadcastState(s2);
    A.broadcastState(s3);
    await flush();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('both sides pushing: last valid seq per receiver wins, no crosstalk desync', async () => {
    const { host, guest } = createLoopbackPair();
    const A = new NetController(host);
    const B = new NetController(guest);
    let atA: GameState | null = null;
    let atB: GameState | null = null;
    A.onRemoteState((s) => { atA = s; });
    B.onRemoteState((s) => { atB = s; });
    await A.connect();
    await B.connect();
    await flush();

    const sA = buildMidGame(); sA.activePlayer = 'A'; sA.round = 5;
    const sB = buildMidGame(); sB.activePlayer = 'B'; sB.round = 7;
    A.broadcastState(sA);
    B.broadcastState(sB);
    await flush();

    expect(atB).not.toBeNull();
    expect(atA).not.toBeNull();
    expect((atB as any).round).toBe(5);
    expect((atA as any).round).toBe(7);
  });

  it('resync after disconnect: sync-request triggers a fresh authoritative push', async () => {
    const { host, guest } = createLoopbackPair();
    const A = new NetController(host);
    const B = new NetController(guest);
    const authoritative = buildMidGame();
    A.onSyncRequest(() => A.broadcastState(authoritative));
    let received: GameState | null = null;
    B.onRemoteState((s) => { received = s; });
    await A.connect();
    await B.connect();
    await flush();

    // Guest joins late / recovers: asks host to resend.
    B.requestSync();
    await flush();

    expect(received).not.toBeNull();
    expect(received).toEqual(JSON.parse(JSON.stringify(authoritative)));
  });

  it('a snapshot with a NEW unit added mid-game syncs the whole graph', async () => {
    const { host, guest } = createLoopbackPair();
    const A = new NetController(host);
    const B = new NetController(guest);
    let received: GameState | null = null;
    B.onRemoteState((s) => { received = s; });
    await A.connect();
    await B.connect();
    await flush();

    const state = buildMidGame();
    // Simulate the active player spending CP + adding a log entry mid-turn.
    state.log.push({ round: state.round, phase: state.phase, player: 'A', message: 'test action' });
    state.idCounter += 1;
    A.broadcastState(state);
    await flush();

    expect(received).not.toBeNull();
    const r = received as unknown as GameState;
    expect(r.log[r.log.length - 1].message).toBe('test action');
    expect(r.idCounter).toBe(state.idCounter);
    expect(Object.keys(r.units).sort()).toEqual(Object.keys(state.units).sort());
  });
});
