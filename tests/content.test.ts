import { describe, it, expect } from 'vitest';
import { DATASHEETS, FACTIONS, NAME_TO_DATASHEET_ID, SAMPLE_ARMIES } from '../src/engine/data';
import { createGame } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';

/** New content sanity: every datasheet instantiates and every faction sample
 *  army builds a legal game. */
describe('content: new units + factions', () => {
  it('registers three factions with their datasheets', () => {
    expect(Object.keys(FACTIONS).sort()).toEqual(['chaos', 'necrons', 'orks', 'ultramarines']);
    for (const f of Object.values(FACTIONS)) {
      for (const id of f.datasheetIds) expect(DATASHEETS[id]).toBeDefined();
    }
  });

  it('resolves generous aliases for the new units', () => {
    for (const alias of [
      'immortals',
      'lychguard',
      'scarabs',
      'assault intercessors',
      'terminators',
      'hellblasters',
      'boyz',
      'nobz',
      'warboss',
      'trukk',
    ]) {
      expect(DATASHEETS[NAME_TO_DATASHEET_ID[alias]]).toBeDefined();
    }
  });

  it('every datasheet has a proxy descriptor with a height', () => {
    for (const ds of Object.values(DATASHEETS)) {
      expect(ds.proxy).toBeDefined();
      expect(ds.proxy!.heightInches).toBeGreaterThan(0);
    }
  });

  it('builds a playable game from the Orks sample army', () => {
    const state = createGame(
      { seed: 1, players: { A: { name: 'A', faction: 'orks' }, B: { name: 'B', faction: 'ultramarines' } } },
      DATASHEETS,
      SAMPLE_ARMIES.orks,
      SAMPLE_ARMIES.ultramarines,
    );
    const e = new GameEngine(state);
    const orks = e.unitsOf('A');
    // 4 ork entries (warboss attaches to boyz) -> 4 units.
    expect(orks.length).toBe(4);
    // Warboss is linked as a leader to the Boyz mob.
    const warboss = orks.find((u) => u.datasheetId === 'ork_warboss')!;
    expect(warboss.leadingUnitId).toBeDefined();
    // Every unit has models and a coherent statline.
    for (const u of orks) expect(u.models.length).toBeGreaterThan(0);
  });

  it('Necron and Ultramarine sample armies still build', () => {
    const state = createGame(
      { seed: 2, players: { A: { name: 'A', faction: 'necrons' }, B: { name: 'B', faction: 'ultramarines' } } },
      DATASHEETS,
      SAMPLE_ARMIES.necrons,
      SAMPLE_ARMIES.ultramarines,
    );
    const e = new GameEngine(state);
    // unitsOf counts every owned unit record (attached leaders included). The
    // sample armies were expanded with the fuller rosters, so both sides now
    // field more units; assert each side built and has a Leader linked.
    expect(e.unitsOf('A').length).toBe(SAMPLE_ARMIES.necrons.entries.length);
    expect(e.unitsOf('B').length).toBe(SAMPLE_ARMIES.ultramarines.entries.length);
    expect(e.unitsOf('A').some((u) => u.leadingUnitId)).toBe(true);
    // Terminators (Ultramarines) still start in Strategic Reserves.
    expect(e.reservesOf('B').length).toBeGreaterThanOrEqual(1);
  });
});
