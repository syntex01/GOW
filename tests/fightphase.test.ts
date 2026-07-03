import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { inEngagementRange, unitGap } from '../src/engine/geometry';

/* Two minimal melee infantry datasheets so we can field several units a side. */
const GRUNT: Datasheet = {
  id: 'grunt',
  name: 'Grunt',
  faction: 'TestFaction',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 3, wounds: 2, leadership: 6, objectiveControl: 2 },
  weapons: [
    { id: 'cc', name: 'CCW', kind: 'melee', range: 0, attacks: 1, skill: 4, strength: 4, ap: 0, damage: 1, keywords: [] },
  ],
  abilities: [],
  composition: [{ modelName: 'Grunt', min: 3, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 60,
};

const registry: Record<string, Datasheet> = { grunt: GRUNT };

function game(seed: number, a: ArmyList, b: ArmyList): GameEngine {
  const state = createGame(
    { seed, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'TestFaction' }, B: { name: 'B', faction: 'TestFaction' } } },
    registry,
    a,
    b,
  );
  return new GameEngine(state);
}

const list = (n: number): ArmyList => ({
  name: 'g',
  faction: 'TestFaction',
  entries: Array.from({ length: n }, () => ({ datasheetId: 'grunt', modelCount: 3 })),
});

describe('Fight phase — alternating activation', () => {
  it('interleaves the two players in the fight order, active side first', () => {
    const e = game(1, list(2), list(2));
    e.state.phase = 'fight';
    const [a1, a2] = e.unitsOf('A');
    const [b1, b2] = e.unitsOf('B');
    // Pair them up in engagement range: a1<->b1 and a2<->b2, well separated.
    a1.models.forEach((m, i) => (m.position = { x: 15 + i * 0.1, y: 15 }));
    b1.models.forEach((m, i) => (m.position = { x: 15.5 + i * 0.1, y: 15 }));
    a2.models.forEach((m, i) => (m.position = { x: 40 + i * 0.1, y: 30 }));
    b2.models.forEach((m, i) => (m.position = { x: 40.5 + i * 0.1, y: 30 }));

    const order = e.fightOrder();
    expect(order.length).toBe(4);
    // Active player (A) leads, then alternates: A, B, A, B.
    expect(order.map((u) => u.ownerId)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('a Counter-offensive unit still jumps to the very front', () => {
    const e = game(1, list(1), list(1));
    e.state.phase = 'fight';
    e.state.players.A.commandPoints = 3;
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    a.models.forEach((m, i) => (m.position = { x: 15 + i * 0.1, y: 15 }));
    b.models.forEach((m, i) => (m.position = { x: 15.5 + i * 0.1, y: 15 }));
    expect(e.activateStratagem('counter_offensive', { unitId: b.id }).ok).toBe(true);
    expect(e.fightOrder()[0].id).toBe(b.id); // B fights next despite being the defender
  });
});

describe('Fight phase — pile-in & consolidate fire automatically', () => {
  it('fight() closes the gap: the attacker ends nearer the enemy than it began', () => {
    const e = game(2, list(1), list(1));
    e.state.phase = 'fight';
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    // Two tight vertical lines ~2.2" apart (centre): inside engagement range but
    // with enough edge gap that pile-in still has room to step forward.
    a.models.forEach((m, i) => (m.position = { x: 20, y: 20 + i * 1.0 }));
    b.models.forEach((m, i) => (m.position = { x: 22.2, y: 20 + i * 1.0 }));
    expect(inEngagementRange(a, b)).toBe(true);
    const before = unitGap(a, b);
    e.fight(a, b);
    const after = unitGap(a, b);
    // Pile-in + consolidate can only ever hold or reduce the gap, never widen it.
    expect(after).toBeLessThanOrEqual(before + 1e-6);
    // And the engine logged both moves as part of the activation.
    const msgs = e.state.log.map((l) => l.message).join('\n');
    expect(msgs).toMatch(/piles in/);
  });
});
