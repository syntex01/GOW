import { describe, it, expect } from 'vitest';
import { createGame } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { DATASHEETS, SAMPLE_ARMIES } from '../src/engine/data/index';
import { runAiTurn } from '../src/engine/ai';
import type { UnitInstance } from '../src/engine/types';

function freshEngine(seed: number): GameEngine {
  const state = createGame(
    { seed, players: { A: { name: 'Necrons', faction: 'Necrons' }, B: { name: 'Marines', faction: 'Ultramarines' } } },
    DATASHEETS,
    SAMPLE_ARMIES.necrons,
    SAMPLE_ARMIES.ultramarines,
  );
  const e = new GameEngine(state);
  e.startGame();
  return e;
}

const bUnitByDatasheet = (e: GameEngine, ds: string): UnitInstance =>
  e.unitsOf('B').find((u) => u.datasheetId === ds)!;

describe('strategic reserves and deep strike', () => {
  it('declaring reserves removes the unit (and its leader) from the table', () => {
    const e = freshEngine(11);
    const intercessors = bUnitByDatasheet(e, 'ultramarines_intercessors');
    const res = e.sendToReserves(intercessors.id);
    expect(res.ok).toBe(true);
    expect(intercessors.inReserves).toBe(true);
    // Reserve units are not present for targeting / objectives.
    expect(e.enemiesOf('A').some((u) => u.id === intercessors.id)).toBe(false);
  });

  it('reserves cannot arrive in round 1 but can from round 2', () => {
    const e = freshEngine(12);
    const intercessors = bUnitByDatasheet(e, 'ultramarines_intercessors');
    e.sendToReserves(intercessors.id);
    const early = e.deepStrikeArrive(intercessors.id, { x: 30, y: 22 });
    expect(early.ok).toBe(false); // round 1

    // Advance to battle round 2.
    while (!(e.state.round === 2)) e.advancePhase();
    const ok = e.deepStrikeArrive(intercessors.id, { x: 30, y: 30 });
    // Either it placed, or the chosen point was illegal (<9"): if illegal, a
    // far corner must work.
    const arrived = ok.ok || e.deepStrikeArrive(intercessors.id, { x: 6, y: 22 }).ok;
    expect(arrived).toBe(true);
    expect(intercessors.inReserves).toBe(false);
  });

  it('the AI brings its reserves on by deep strike in round 2', () => {
    const e = freshEngine(20);
    const intercessors = bUnitByDatasheet(e, 'ultramarines_intercessors');
    e.sendToReserves(intercessors.id);
    expect(intercessors.inReserves).toBe(true);

    // Play to the start of B's round-2 turn.
    while (!(e.state.round === 2 && e.active === 'B')) e.advancePhase();
    runAiTurn(e);
    expect(intercessors.inReserves).toBe(false); // AI found a legal spot
  });
});
