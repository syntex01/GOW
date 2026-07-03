import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';

const OATH_TROOPS: Datasheet = {
  id: 'oathtroops',
  name: 'Oath Troops',
  faction: 'T',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 3, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [{ id: 'g', name: 'Gun', kind: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, keywords: [] }],
  abilities: [{ name: 'Oath of Moment', text: 'Reroll vs the sworn target.', effect: { t: 'oathOfMoment' } }],
  composition: [{ modelName: 'Trooper', min: 5, max: 10 }],
  baseSizeMm: 32, isCharacter: false, points: 100,
};
const BIG: Datasheet = { ...OATH_TROOPS, id: 'big', name: 'Big Blob', abilities: [], statline: { ...OATH_TROOPS.statline, wounds: 5 } };
const SMALL: Datasheet = { ...OATH_TROOPS, id: 'small', name: 'Small Blob', abilities: [], statline: { ...OATH_TROOPS.statline, wounds: 1 } };

const registry: Record<string, Datasheet> = { oathtroops: OATH_TROOPS, big: BIG, small: SMALL };

function game(): GameEngine {
  const a: ArmyList = { name: 'A', faction: 'T', entries: [{ datasheetId: 'oathtroops', modelCount: 5 }] };
  const b: ArmyList = { name: 'B', faction: 'T', entries: [{ datasheetId: 'small', modelCount: 1 }, { datasheetId: 'big', modelCount: 5 }] };
  const state = createGame(
    { seed: 3, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'T' }, B: { name: 'B', faction: 'T' } } },
    registry, a, b,
  );
  return new GameEngine(state);
}

describe('Oath of Moment designation', () => {
  it('swears the Oath against the juiciest (highest-wounds) enemy unit', () => {
    const e = game();
    e.state.activePlayer = 'A';
    e.startCommandPhase();
    const big = e.unitsOf('B').find((u) => u.datasheetId === 'big')!;
    expect(e.state.players.A.oathTarget).toBe(big.id); // 25W blob beats the 1W unit
  });

  it('no Oath target for a player without an OATH-capable unit', () => {
    const e = game();
    e.state.activePlayer = 'B'; // B has no oathOfMoment units
    e.startCommandPhase();
    expect(e.state.players.B.oathTarget).toBeUndefined();
  });
});
