import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/dice';
import { NetController } from '../src/net/NetController';
import { createLoopbackPair } from '../src/net/LoopbackTransport';
import type { NetMessage, NetStatus, Transport } from '../src/net/Transport';
import { createGame } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { DATASHEETS, SAMPLE_ARMIES } from '../src/engine/data/index';
import type { ArmyList } from '../src/engine/factory';
import type { GameState } from '../src/engine/types';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function sampleState(): GameState {
  return createGame(
    { seed: 1234, players: { A: { name: 'Host', faction: 'necrons' }, B: { name: 'Guest', faction: 'ultramarines' } } },
    DATASHEETS,
    SAMPLE_ARMIES.necrons,
    SAMPLE_ARMIES.ultramarines,
  );
}

/** A Transport whose status we drive by hand and whose sends we can inspect. */
class MockTransport implements Transport {
  readonly role: 'host' | 'guest' = 'host';
  readonly roomCode = 'ROOM';
  sent: NetMessage[] = [];
  private statusCb: ((s: NetStatus) => void) | null = null;
  connect(): Promise<void> { return Promise.resolve(); }
  send(m: NetMessage): void { this.sent.push(m); }
  onMessage(): void { /* unused */ }
  onStatus(cb: (s: NetStatus) => void): void { this.statusCb = cb; }
  close(): void { /* unused */ }
  emit(s: NetStatus): void { this.statusCb?.(s); }
}

describe('MP fix — RNG position survives a snapshot (dice continue, not repeat)', () => {
  it('reconstructing from the live seed continues the sequence; from the original it repeats', () => {
    const a = new Rng(1234);
    const first = a.dice(12); // advance the stream
    const livePos = a.seed; // what transmit() stamps into state.rngSeed

    // Applying a snapshot rebuilds the rng from the stamped live position.
    const continued = new Rng(livePos);
    // A fresh engine seeded from the ORIGINAL game seed (the pre-fix behaviour).
    const restarted = new Rng(1234);

    const nextFromA = a.dice(12);
    expect(continued.dice(12)).toEqual(nextFromA); // fix: dice continue on the peer
    expect(restarted.dice(12)).toEqual(first); // bug: original-seed rewind repeats rolls
  });
});

describe('MP fix — sends survive a transient post-connection error', () => {
  it('keeps broadcasting through an "error" once connected, and stops only on disconnect', () => {
    const t = new MockTransport();
    const ctl = new NetController(t);

    ctl.broadcastState({}); // not connected yet
    expect(t.sent.length).toBe(0);

    t.emit('connected');
    ctl.broadcastState({});
    expect(t.sent.length).toBe(1);

    t.emit('error'); // transient broker hiccup, channel still open
    ctl.broadcastState({});
    expect(t.sent.length, 'must still send through a transient error').toBe(2);

    t.emit('disconnected'); // real teardown
    ctl.broadcastState({});
    expect(t.sent.length, 'must stop sending once truly disconnected').toBe(2);
  });
});

describe('MP fix — guest army handshake', () => {
  it('delivers the guest army to the host so it can build the shared game', async () => {
    const { host, guest } = createLoopbackPair('ROOM');
    const hostCtl = new NetController(host);
    const guestCtl = new NetController(guest);

    let joined: { army: unknown; faction: string; name?: string } | null = null;
    hostCtl.onJoin((j) => (joined = j));

    await host.connect();
    await guest.connect();
    await flush();

    const guestArmy: ArmyList = {
      name: 'Guest Warhost',
      faction: 'orks',
      entries: [{ datasheetId: 'ork_boyz', modelCount: 10 }],
    };
    guestCtl.sendJoin(guestArmy, guestArmy.faction, guestArmy.name);
    await flush();

    expect(joined).not.toBeNull();
    expect(joined!.faction).toBe('orks');
    expect((joined!.army as ArmyList).entries[0].datasheetId).toBe('ork_boyz');
  });
});

describe('MP fix — online reaction round-trip', () => {
  it('carries a reaction-window to the defender and the choice back to the active player', async () => {
    const { host, guest } = createLoopbackPair('ROOM');
    const active = new NetController(host);
    const defender = new NetController(guest);

    let window: { kind: string; attackerId: string; targetId: string } | null = null;
    defender.onReactionWindow((m) => {
      window = m;
      // Defender answers with a Fire Overwatch choice.
      defender.sendReaction('fire_overwatch', 'unitB', 'unitA');
    });
    let reply: { stratId: string; unitId?: string; targetUnitId?: string } | null = null;
    active.onReaction((m) => (reply = m));

    await host.connect();
    await guest.connect();
    await flush();

    active.sendReactionWindow('shooting', 'unitA', 'unitB');
    await flush();
    await flush();

    expect(window).not.toBeNull();
    expect(window!.kind).toBe('shooting');
    expect(reply).not.toBeNull();
    expect(reply!.stratId).toBe('fire_overwatch');
    expect(reply!.unitId).toBe('unitB');
  });
});

describe('MP — GameState survives a JSON round-trip after real play', () => {
  it('deep-equals itself through stringify/parse mid-game', () => {
    const state = sampleState();
    const e = new GameEngine(state);
    // Exercise a few phases so the state carries live per-turn flags, log, etc.
    e.startCommandPhase();
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    a.models.forEach((m, i) => (m.position = { x: 20 + i * 0.4, y: 20 }));
    b.models.forEach((m, i) => (m.position = { x: 26 + i * 0.4, y: 20 }));
    e.state.phase = 'shooting';
    e.shoot(a, b);

    const roundTrip = JSON.parse(JSON.stringify(e.state)) as GameState;
    expect(roundTrip).toEqual(e.state); // no lossy field silently desyncs the peer
  });
});
