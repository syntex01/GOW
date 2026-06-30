import { describe, it, expect, beforeEach } from 'vitest';
import { createLoopbackPair } from '../src/net/LoopbackTransport';
import { NetController } from '../src/net/NetController';
import { saveGame, loadGame, listSaves, clearSave } from '../src/net/persistence';
import { createGame } from '../src/engine/factory';
import { DATASHEETS, SAMPLE_ARMIES } from '../src/engine/data/index';
import type { GameState } from '../src/engine/types';

/** Build a representative GameState via the real factory. */
function sampleState(): GameState {
  return createGame(
    {
      seed: 1234,
      players: {
        A: { name: 'Host', faction: 'necrons' },
        B: { name: 'Guest', faction: 'ultramarines' },
      },
    },
    DATASHEETS,
    SAMPLE_ARMIES.necrons,
    SAMPLE_ARMIES.ultramarines,
  );
}

/** Wait for queued microtasks (loopback delivers on a microtask). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('NetController over LoopbackTransport', () => {
  it('delivers a host state broadcast to the guest intact', async () => {
    const { host, guest } = createLoopbackPair('ROOM1');
    const hostCtl = new NetController(host);
    const guestCtl = new NetController(guest);

    expect(hostCtl.localPlayer).toBe('A');
    expect(guestCtl.localPlayer).toBe('B');

    let received: GameState | null = null;
    guestCtl.onRemoteState((s) => {
      received = s;
    });

    await hostCtl.connect();
    await guestCtl.connect();
    await flush();

    const state = sampleState();
    hostCtl.broadcastState(state);
    await flush();

    expect(received).not.toBeNull();
    expect(received).toEqual(state); // deep-equal, round-tripped through JSON
  });

  it('drops stale / out-of-order states by seq', async () => {
    const { host, guest } = createLoopbackPair('ROOM2');
    const hostCtl = new NetController(host);
    const guestCtl = new NetController(guest);

    const seen: number[] = [];
    guestCtl.onRemoteState((s: any) => {
      seen.push(s.round);
    });

    await hostCtl.connect();
    await guestCtl.connect();
    await flush();

    // Broadcast seq 1 (round 1) then seq 2 (round 2).
    const s1 = sampleState();
    s1.round = 1;
    hostCtl.broadcastState(s1);
    const s2 = sampleState();
    s2.round = 2;
    hostCtl.broadcastState(s2);
    await flush();

    // Inject a stale seq-1 frame directly on the wire; it must be dropped.
    host.send({ t: 'state', state: { round: 99 }, seq: 1 });
    await flush();

    expect(seen).toEqual([1, 2]); // round-99 stale frame never delivered
  });
});

describe('persistence', () => {
  beforeEach(() => {
    // Minimal in-memory localStorage shim for the test environment.
    const map = new Map<string, string>();
    const shim: Storage = {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    (globalThis as any).localStorage = shim;
  });

  it('round-trips a state through save/load', () => {
    const state = sampleState();
    saveGame(state, 'slot1');
    const loaded = loadGame('slot1');
    expect(loaded).toEqual(state);
  });

  it('lists and clears saves; missing slots return null', () => {
    expect(loadGame('nope')).toBeNull();
    saveGame({ a: 1 }, 'autosave');
    saveGame({ b: 2 }, 'manual');
    expect(listSaves().sort()).toEqual(['autosave', 'manual']);
    clearSave('autosave');
    expect(listSaves()).toEqual(['manual']);
  });

  it('never throws when localStorage is unavailable', () => {
    (globalThis as any).localStorage = undefined;
    expect(() => saveGame({ a: 1 })).not.toThrow();
    expect(loadGame()).toBeNull();
    expect(listSaves()).toEqual([]);
    expect(() => clearSave()).not.toThrow();
  });
});
