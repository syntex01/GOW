import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';

const BOYZ: Datasheet = {
  id: 'boyz', name: 'Boyz', faction: 'orks', keywords: ['INFANTRY', 'ORKS'],
  statline: { move: 6, toughness: 5, save: 5, wounds: 1, leadership: 7, objectiveControl: 2 },
  weapons: [{ id: 'choppa', name: 'Choppa', kind: 'melee', range: 0, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, keywords: [] }],
  abilities: [{ name: 'Waaagh!', text: 'Green tide.' }],
  composition: [{ modelName: 'Boy', min: 5, max: 10 }],
  baseSizeMm: 32, isCharacter: false, points: 80,
};
const ENEMY: Datasheet = { ...BOYZ, id: 'enemy', name: 'Enemy', faction: 'X', keywords: ['INFANTRY'], abilities: [] };
const registry: Record<string, Datasheet> = { boyz: BOYZ, enemy: ENEMY };

function game(): GameEngine {
  const a: ArmyList = { name: 'A', faction: 'orks', entries: [{ datasheetId: 'boyz', modelCount: 5 }] };
  const b: ArmyList = { name: 'B', faction: 'X', entries: [{ datasheetId: 'enemy', modelCount: 5 }] };
  const state = createGame(
    { seed: 5, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'orks' }, B: { name: 'B', faction: 'X' } } },
    registry, a, b,
  );
  const e = new GameEngine(state);
  // Put the Orks ~8" from the enemy (within the 12" Waaagh trigger threat).
  const boyz = e.unitsOf('A')[0];
  const enemy = e.unitsOf('B')[0];
  boyz.models.forEach((m, i) => (m.position = { x: 20 + i * 0.5, y: 20 }));
  enemy.models.forEach((m, i) => (m.position = { x: 28 + i * 0.5, y: 20 }));
  return e;
}

describe('Waaagh!', () => {
  it('is not called in round 1, and fires once from round 2 when Orks threaten the enemy', () => {
    const e = game();
    e.state.activePlayer = 'A';
    e.state.round = 1;
    e.startCommandPhase();
    expect(e.state.players.A.waaaghUsed).toBeFalsy();

    e.state.round = 2;
    e.startCommandPhase();
    expect(e.state.players.A.waaaghUsed).toBe(true);
    expect(e.state.players.A.waaaghRound).toBe(2);
  });

  it('grants +1 melee attack while active', () => {
    const e = game();
    e.state.activePlayer = 'A';
    e.state.round = 2;
    e.startCommandPhase(); // calls the Waaagh!
    const boyz = e.unitsOf('A')[0];
    const enemy = e.unitsOf('B')[0];
    // 5 Boyz × (2 base + 1 Waaagh) = 15 attacks; without Waaagh it would be 10.
    e.state.phase = 'fight';
    const res = e.fight(boyz, enemy);
    const attacks = res.reduce((a, r) => a + r.attacks, 0);
    expect(attacks).toBe(15);
  });
});
