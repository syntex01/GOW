import { describe, it, expect } from 'vitest';
import { createGame } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { DATASHEETS, SAMPLE_ARMIES } from '../src/engine/data/index';
import { runAiTurn } from '../src/engine/ai';

function engineAtPlayerB(seed: number): GameEngine {
  const state = createGame(
    { seed, players: { A: { name: 'Necrons', faction: 'Necrons' }, B: { name: 'Marines', faction: 'Ultramarines' } } },
    DATASHEETS,
    SAMPLE_ARMIES.necrons,
    SAMPLE_ARMIES.ultramarines,
  );
  const e = new GameEngine(state);
  e.startGame();
  // Pass A's turn straight to B.
  for (let i = 0; i < 6; i++) e.advancePhase();
  expect(e.active).toBe('B');
  return e;
}

describe('AI opponent', () => {
  it('plays a full turn and hands control back to the opponent', () => {
    const e = engineAtPlayerB(4242);
    const logBefore = e.state.log.length;
    runAiTurn(e);
    expect(e.active).toBe('A'); // control returned
    expect(e.state.log.length).toBeGreaterThan(logBefore); // it did things
  });

  it('is deterministic for a fixed seed', () => {
    const run = () => {
      const e = engineAtPlayerB(99);
      runAiTurn(e);
      return e.state.log.map((l) => l.message).join('|');
    };
    expect(run()).toEqual(run());
  });

  it('never throws even across several AI-vs-AI turns', () => {
    const e = engineAtPlayerB(7);
    expect(() => {
      for (let t = 0; t < 8 && e.winner() === undefined; t++) runAiTurn(e);
    }).not.toThrow();
  });
});
