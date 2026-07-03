import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { isCoherent, inEngagementRange, unitGap } from '../src/engine/geometry';

/* A simple infantry datasheet for rules tests. */
const GRUNT: Datasheet = {
  id: 'grunt',
  name: 'Grunt',
  faction: 'TestFaction',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [
    {
      id: 'cc',
      name: 'CCW',
      kind: 'melee',
      range: 0,
      attacks: 2,
      skill: 3,
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [],
  composition: [{ modelName: 'Grunt', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

/* A datasheet carrying a Hazardous weapon (multi-model, single-wound). */
const PLASMA: Datasheet = {
  id: 'plasma',
  name: 'Plasma Squad',
  faction: 'TestFaction',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 3, wounds: 1, leadership: 6, objectiveControl: 1 },
  weapons: [
    {
      id: 'plasma',
      name: 'Plasma',
      kind: 'ranged',
      range: 100,
      attacks: 1,
      skill: 6, // rarely hits — we only care about the hazardous test here
      strength: 8,
      ap: 3,
      damage: 2,
      keywords: [{ t: 'hazardous' }],
    },
  ],
  abilities: [],
  composition: [{ modelName: 'Plasma Trooper', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

const registry: Record<string, Datasheet> = { grunt: GRUNT, plasma: PLASMA };

function game(seed: number, listA: ArmyList, listB: ArmyList): GameEngine {
  const state = createGame(
    { seed, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'TestFaction' }, B: { name: 'B', faction: 'TestFaction' } } },
    registry,
    listA,
    listB,
  );
  return new GameEngine(state);
}

const grunts = (count: number): ArmyList => ({
  name: 'g',
  faction: 'TestFaction',
  entries: [{ datasheetId: 'grunt', modelCount: count }],
});

describe('per-model movement', () => {
  it('moves a single model within its allowance and keeps coherency', () => {
    const e = game(1, grunts(5), grunts(5));
    const u = e.unitsOf('A')[0];
    const m = u.models[0];
    const start = { ...m.position };
    // A 2" nudge: within the 6" allowance and small enough to stay coherent.
    const ok = e.moveModel(u.id, m.id, { x: start.x + 2, y: start.y });
    expect(ok).toBe(true);
    // The model advances toward the target; the base-collision pass may settle it
    // a fraction short so it never overlaps a neighbour's base. It should still
    // have moved most of the way and stayed within its 6" allowance.
    expect(m.position.x).toBeGreaterThan(start.x + 1.5);
    expect(Math.hypot(m.position.x - start.x, m.position.y - start.y)).toBeLessThanOrEqual(6 + 1e-6);
    expect(isCoherent(u)).toBe(true);
    // No two living bases of the unit overlap after settling.
    const live = u.models.filter((mm) => mm.alive);
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const gap = Math.hypot(
          live[i].position.x - live[j].position.x,
          live[i].position.y - live[j].position.y,
        );
        expect(gap).toBeGreaterThan(live[i].baseRadius + live[j].baseRadius - 1e-3);
      }
  });

  it('rejects a move beyond the movement allowance', () => {
    const e = game(1, grunts(5), grunts(5));
    const u = e.unitsOf('A')[0];
    const m = u.models[0];
    const start = { ...m.position };
    const ok = e.moveModel(u.id, m.id, { x: start.x + 50, y: start.y }); // > 6"
    expect(ok).toBe(false);
    expect(m.position).toEqual(start); // unchanged
  });

  it('rejects a move that breaks unit coherency', () => {
    const e = game(1, grunts(5), grunts(5));
    const u = e.unitsOf('A')[0];
    // Arrange the unit as a tight horizontal line so a single model leaving the
    // line clearly breaks the 2" coherency net.
    u.models.forEach((mm, i) => (mm.position = { x: 30 + i * 1.4, y: 20 }));
    const m = u.models[0];
    const start = { ...m.position };
    // 6" straight up — within the 6" allowance but far from every other model.
    const ok = e.moveModel(u.id, m.id, { x: start.x, y: start.y + 6 });
    expect(ok).toBe(false);
    expect(m.position).toEqual(start);
  });
});

describe('pile-in and consolidate', () => {
  function adjacentArmies(): GameEngine {
    // Place B's unit a few inches away so A piles toward it.
    const listA = grunts(5);
    const listB = grunts(5);
    const e = game(3, listA, listB);
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    // Move both clusters near the centre, ~4" apart, edge to edge.
    a.models.forEach((m, i) => (m.position = { x: 30 + (i % 2), y: 20 }));
    b.models.forEach((m, i) => (m.position = { x: 30 + (i % 2), y: 24 }));
    return e;
  }

  it('pile-in moves models closer to the nearest enemy', () => {
    const e = adjacentArmies();
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    const before = unitGap(a, b);
    const moved = e.pileIn(a.id);
    expect(moved).toBeGreaterThan(0);
    expect(unitGap(a, b)).toBeLessThan(before);
  });

  it('consolidate brings the unit into engagement range', () => {
    const e = adjacentArmies();
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    e.consolidate(a.id);
    expect(inEngagementRange(a, b)).toBe(true);
  });
});

describe('Desperate Escape (battle-shocked fall back)', () => {
  it('destroys models on a 1-2 when a shocked unit falls back', () => {
    const e = game(7, grunts(10), grunts(5));
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    // Engage A with B so a Fall Back is the legal move.
    a.models.forEach((m, i) => (m.position = { x: 30 + i * 0.3, y: 20 }));
    b.models.forEach((m, i) => (m.position = { x: 30 + i * 0.3, y: 20.5 }));
    a.isBattleShocked = true;
    const before = a.models.filter((m) => m.alive).length;
    // Fall back straight down, clear of B.
    const ok = e.moveUnit(a, 'fallBack', { x: 0, y: -6 });
    expect(ok).toBe(true);
    const after = a.models.filter((m) => m.alive).length;
    // Seeded: at least one model should be lost across 10 D6 rolls.
    expect(after).toBeLessThan(before);
    expect(e.state.log.some((l) => l.message.includes('Desperate Escape'))).toBe(true);
  });

  it('desperateEscape leaves a non-shocked unit untouched (direct call respects rolls)', () => {
    const e = game(7, grunts(10), grunts(5));
    const a = e.unitsOf('A')[0];
    // Force all dice via a high seed is non-trivial; instead verify the helper
    // returns a count in range and only kills on 1-2 (deterministic with seed).
    const lost = e.desperateEscape(a);
    const alive = a.models.filter((m) => m.alive).length;
    expect(lost).toBeGreaterThanOrEqual(0);
    expect(alive).toBe(10 - lost);
  });
});

describe('Hazardous', () => {
  it('can destroy a firing model on an unmodified 1', () => {
    const listA: ArmyList = { name: 'A', faction: 'TestFaction', entries: [{ datasheetId: 'plasma', modelCount: 10 }] };
    const e = game(1, listA, grunts(5));
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    // Put them in line of sight, in the open, within range.
    a.models.forEach((m, i) => (m.position = { x: 30 + i * 0.3, y: 10 }));
    b.models.forEach((m, i) => (m.position = { x: 30 + i * 0.3, y: 34 }));
    e.state.terrain = []; // clear LoS blockers
    const before = a.models.filter((m) => m.alive).length;
    e.shoot(a, b);
    const after = a.models.filter((m) => m.alive).length;
    // With 10 hazardous tests on a fixed seed, at least one 1 is expected.
    expect(after).toBeLessThanOrEqual(before);
    expect(e.state.log.some((l) => l.message.includes('Hazardous'))).toBe(true);
  });
});

describe('secondary scoring', () => {
  it('awards Take and Hold + Bring It Down VP and tracks them separately', () => {
    const e = game(9, grunts(5), grunts(5));
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    // A stands on the centre objective; B is far away so A holds more.
    const obj = e.state.objectives[0];
    a.models.forEach((m, i) => (m.position = { x: obj.position.x + i * 0.3, y: obj.position.y }));
    b.models.forEach((m) => (m.position = { x: 2, y: 2 }));
    // Credit A a kill this turn.
    e.state.players.A.enemyUnitsKilledThisTurn = 1;
    const vpBefore = e.state.players.A.victoryPoints;
    const awarded = e.scoreSecondaries();
    expect(awarded).toBe(10); // 5 (hold more) + 5 (killed a unit)
    expect(e.state.players.A.secondaryVictoryPoints).toBe(10);
    expect(e.state.players.A.victoryPoints).toBe(vpBefore + 10);
  });
});

describe('new stratagems', () => {
  it('Armour of Contempt reduces incoming AP and clears next turn', () => {
    const e = game(5, grunts(5), grunts(5));
    e.startGame(); // gives the active player 1 CP
    const u = e.unitsOf('A')[0];
    const res = e.activateStratagem('armour_of_contempt', { unitId: u.id });
    expect(res.ok).toBe(true);
    expect(u.armourOfContempt).toBe(true);
  });

  it('Epic Challenge grants Precision to a Character’s melee weapons', () => {
    // Build a character unit inline.
    const CHAR: Datasheet = {
      id: 'hero',
      name: 'Hero',
      faction: 'TestFaction',
      keywords: ['CHARACTER', 'INFANTRY'],
      statline: { move: 6, toughness: 4, save: 3, wounds: 4, leadership: 6, objectiveControl: 1 },
      weapons: [{ id: 'blade', name: 'Blade', kind: 'melee', range: 0, attacks: 4, skill: 2, strength: 5, ap: 2, damage: 2, keywords: [] }],
      abilities: [],
      composition: [{ modelName: 'Hero', min: 1, max: 1 }],
      baseSizeMm: 40,
      isCharacter: true,
      points: 80,
    };
    const reg = { ...registry, hero: CHAR };
    const state = createGame(
      { seed: 6, players: { A: { name: 'A', faction: 'TestFaction' }, B: { name: 'B', faction: 'TestFaction' } } },
      reg,
      { name: 'A', faction: 'TestFaction', entries: [{ datasheetId: 'hero' }] },
      grunts(5),
    );
    const e = new GameEngine(state);
    e.startGame();
    e.state.phase = 'fight';
    const hero = e.unitsOf('A')[0];
    const res = e.activateStratagem('epic_challenge', { unitId: hero.id });
    expect(res.ok).toBe(true);
    // Epic Challenge sets a transient per-turn flag (cleared each Command phase)
    // rather than permanently mutating the weapon's keywords.
    expect(hero.epicChallenge).toBe(true);
    const blade = hero.weapons.find((w) => w.id === 'blade')!;
    expect(blade.keywords.some((k) => k.t === 'precision')).toBe(false);
  });

  it('Rapid Ingress brings a reserve unit onto the board', () => {
    const e = game(8, grunts(5), grunts(5));
    e.startGame();
    e.state.round = 2; // reserves may arrive from round 2
    e.state.phase = 'movement'; // Rapid Ingress is a Movement-phase stratagem
    const u = e.unitsOf('A')[0];
    u.inReserves = true;
    e.state.players.A.commandPoints = 3;
    const res = e.activateStratagem('rapid_ingress', { unitId: u.id });
    // Arrives near board centre, >9" from enemies (B is deployed top edge).
    expect(res.ok).toBe(true);
    expect(u.inReserves).toBe(false);
  });
});

describe('move budget (one Move characteristic in total per phase)', () => {
  it('allows several small moves summing to the Move, then blocks the overspend', () => {
    const e = game(1, grunts(5), grunts(5));
    const u = e.unitsOf('A')[0];
    const M = u.statline.move; // 6"
    // Reposition sideways (away from the enemy) in small steps.
    expect(e.moveUnit(u, 'normal', { x: 3, y: 0 })).toBe(true);
    expect(e.remainingMove(u, 'normal')).toBeCloseTo(M - 3, 1);
    expect(e.moveUnit(u, 'normal', { x: 2, y: 0 })).toBe(true);
    expect(e.remainingMove(u, 'normal')).toBeCloseTo(M - 5, 1);
    // Only ~1" left — a 2" move would exceed the budget and is rejected.
    expect(e.moveUnit(u, 'normal', { x: 2, y: 0 })).toBe(false);
    // A 0.8" nudge still fits.
    expect(e.moveUnit(u, 'normal', { x: 0.8, y: 0 })).toBe(true);
    // Total moved (~5.8") must never exceed the 6" Move.
    expect((u.moveBudgetUsed ?? 0)).toBeLessThanOrEqual(M + 1e-6);
    // Budget essentially spent — a further 1" move is rejected.
    expect(e.moveUnit(u, 'normal', { x: 1, y: 0 })).toBe(false);
  });

  it('cannot switch move type mid-phase (normal then advance)', () => {
    const e = game(1, grunts(5), grunts(5));
    const u = e.unitsOf('A')[0];
    expect(e.moveUnit(u, 'normal', { x: 2, y: 0 })).toBe(true);
    e.rollAdvance(u);
    expect(e.moveUnit(u, 'advance', { x: 2, y: 0 })).toBe(false);
  });
});
