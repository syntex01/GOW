import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { aiReactToCharge, aiReactToShooting } from '../src/engine/ai';

/* A shooty datasheet with an AP-1 ranged gun (so Armour of Contempt matters). */
const SHOOTA: Datasheet = {
  id: 'shoota',
  name: 'Shootas',
  faction: 'TestFaction',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [
    { id: 'gun', name: 'Gun', kind: 'ranged', range: 24, attacks: 2, skill: 3, strength: 5, ap: 1, damage: 1, keywords: [] },
    { id: 'cc', name: 'CCW', kind: 'melee', range: 0, attacks: 1, skill: 4, strength: 4, ap: 0, damage: 1, keywords: [] },
  ],
  abilities: [],
  composition: [{ modelName: 'Shoota', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

const registry: Record<string, Datasheet> = { shoota: SHOOTA };

function game(seed = 1): GameEngine {
  const list: ArmyList = { name: 'g', faction: 'TestFaction', entries: [{ datasheetId: 'shoota', modelCount: 5 }] };
  const state = createGame(
    { seed, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'TestFaction' }, B: { name: 'B', faction: 'TestFaction' } } },
    registry,
    list,
    list,
  );
  return new GameEngine(state);
}

describe('reactiveStratagemsFor', () => {
  it('offers opponents-turn reactions to the DEFENDER only', () => {
    const e = game();
    e.state.activePlayer = 'A';
    e.state.phase = 'shooting';
    e.state.players.B.commandPoints = 3;
    const forB = e.reactiveStratagemsFor('B').map((s) => s.id);
    expect(forB).toContain('armour_of_contempt');
    expect(forB).toContain('go_to_ground');
    // The active player gets nothing from the reaction API (they act normally).
    expect(e.reactiveStratagemsFor('A')).toEqual([]);
    // 'your-turn'-only stratagems are never reactions.
    expect(forB).not.toContain('insane_bravery');
  });
});

describe('activateStratagem spends the acting player, not always the active one', () => {
  it('a reaction debits the DEFENDER’s CP', () => {
    const e = game();
    e.state.activePlayer = 'A';
    e.state.phase = 'shooting';
    e.state.players.A.commandPoints = 5;
    e.state.players.B.commandPoints = 2;
    const target = e.unitsOf('B')[0];
    const res = e.activateStratagem('armour_of_contempt', { unitId: target.id }, 'B');
    expect(res.ok).toBe(true);
    expect(target.armourOfContempt).toBe(true);
    expect(e.state.players.B.commandPoints).toBe(1); // B paid
    expect(e.state.players.A.commandPoints).toBe(5); // A untouched
  });
});

describe('AI reactions', () => {
  it('AI defender uses Armour of Contempt against AP fire, then not again', () => {
    const e = game();
    e.state.activePlayer = 'A'; // human A shoots AI B
    e.state.phase = 'shooting';
    e.state.players.B.commandPoints = 2;
    const shooter = e.unitsOf('A')[0];
    const target = e.unitsOf('B')[0];
    const r = aiReactToShooting(e, shooter, target);
    expect(r.used).toBe(true);
    expect(target.armourOfContempt).toBe(true);
    expect(e.state.players.B.commandPoints).toBe(1);
    // Already braced → no second spend.
    expect(aiReactToShooting(e, shooter, target).used).toBe(false);
  });

  it('AI defender Fires Overwatch at a charging unit within range', () => {
    const e = game();
    e.state.activePlayer = 'A'; // human A charges AI B
    e.state.phase = 'charge';
    e.state.players.B.commandPoints = 2;
    const charger = e.unitsOf('A')[0];
    const defender = e.unitsOf('B')[0];
    // Put the charger ~8" from the AI unit: within charge range and gun range.
    charger.models.forEach((m, i) => (m.position = { x: 20 + i * 0.5, y: 20 }));
    defender.models.forEach((m, i) => (m.position = { x: 28 + i * 0.5, y: 20 }));
    e.state.terrain = []; // clear LoS
    const r = aiReactToCharge(e, charger);
    expect(r.fired).toBe(true);
    expect(defender.overwatchUsedRound).toBe(e.state.round);
    expect(e.state.players.B.commandPoints).toBe(1);
  });
});
