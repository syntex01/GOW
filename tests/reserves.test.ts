import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';

const TROOPER: Datasheet = {
  id: 'trooper',
  name: 'Trooper',
  faction: 'TestFaction',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [
    {
      id: 'rifle',
      name: 'Rifle',
      kind: 'ranged',
      range: 100,
      attacks: 2,
      skill: 3,
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [],
    },
    {
      id: 'ccw',
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
  abilities: [{ name: 'Deep Strike', text: 'Sets up in reserves.', effect: { t: 'deepStrike' } }],
  composition: [{ modelName: 'Trooper', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

// A character with a Leader ability that can lead Troopers, plus a reroll aura.
const HERO: Datasheet = {
  id: 'hero',
  name: 'Hero',
  faction: 'TestFaction',
  keywords: ['INFANTRY', 'CHARACTER'],
  statline: { move: 6, toughness: 4, save: 3, invuln: 4, wounds: 4, leadership: 6, objectiveControl: 1 },
  weapons: [
    {
      id: 'hero_blade',
      name: 'Blade',
      kind: 'melee',
      range: 0,
      attacks: 4,
      skill: 2,
      strength: 5,
      ap: 1,
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [
    { name: 'Leader', text: 'Leads Troopers.', effect: { t: 'leader', canLeadDatasheetIds: ['trooper'] } },
    { name: 'Tactical Precision', text: 'Aura: re-roll hits.', effect: { t: 'reroll', phase: 'hit', scope: 'all' } },
  ],
  composition: [{ modelName: 'Hero', min: 1, max: 1 }],
  baseSizeMm: 40,
  isCharacter: true,
  points: 80,
};

const registry: Record<string, Datasheet> = { trooper: TROOPER, hero: HERO };

function gameWith(entriesA: ArmyList['entries'], seed = 5): GameEngine {
  const listA: ArmyList = { name: 'A', faction: 'TestFaction', entries: entriesA };
  const listB: ArmyList = {
    name: 'B',
    faction: 'TestFaction',
    entries: [{ datasheetId: 'trooper', modelCount: 5 }],
  };
  const state = createGame(
    { seed, players: { A: { name: 'A', faction: 'TF' }, B: { name: 'B', faction: 'TF' } } },
    registry,
    listA,
    listB,
  );
  return new GameEngine(state);
}

describe('reserves deployment', () => {
  it('does not place reserve units on the board and lists them in reservesOf', () => {
    const g = gameWith([
      { datasheetId: 'trooper', modelCount: 5, instanceId: 'onboard' },
      { datasheetId: 'trooper', modelCount: 5, instanceId: 'reserve', inReserves: true },
    ]);
    g.startGame();
    const reserves = g.reservesOf('A');
    expect(reserves).toHaveLength(1);
    const res = reserves[0];
    expect(res.inReserves).toBe(true);
    expect(res.deepStrike).toBe(true);
    // Reserve units are excluded from the enemy's view of the board.
    expect(g.enemiesOf('B').some((u) => u.id === res.id)).toBe(false);
    // And from being charge targets.
    const bUnit = g.unitsOf('B')[0];
    expect(g.chargeTargets(bUnit).some((u) => u.id === res.id)).toBe(false);
  });
});

describe('deep strike legality (>9" rule)', () => {
  it('refuses to arrive in round 1', () => {
    const g = gameWith([{ datasheetId: 'trooper', modelCount: 5, inReserves: true }]);
    g.startGame();
    const res = g.reservesOf('A')[0];
    const r = g.deepStrikeArrive(res.id, { x: 30, y: 22 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/round 1/);
  });

  it('refuses arrival within 9" of an enemy model', () => {
    const g = gameWith([{ datasheetId: 'trooper', modelCount: 5, inReserves: true }]);
    g.startGame();
    g.state.round = 2;
    const res = g.reservesOf('A')[0];
    const enemy = g.unitsOf('B')[0];
    const ep = enemy.models[0].position;
    // Drop right on top of the enemy -> illegal.
    const r = g.deepStrikeArrive(res.id, { x: ep.x, y: ep.y });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/9"/);
    expect(res.inReserves).toBe(true); // unchanged
  });

  it('arrives when every model is >9" from all enemies and on the board', () => {
    const g = gameWith([{ datasheetId: 'trooper', modelCount: 5, inReserves: true }]);
    g.startGame();
    g.state.round = 2;
    // Move enemy to one corner so the centre is clear.
    const enemy = g.unitsOf('B')[0];
    enemy.models.forEach((m, i) => { m.position = { x: 2 + i * 0.1, y: 2 }; });
    const res = g.reservesOf('A')[0];
    const r = g.deepStrikeArrive(res.id, { x: 40, y: 30 });
    expect(r.ok).toBe(true);
    expect(res.inReserves).toBe(false);
    expect(g.enemiesOf('B').some((u) => u.id === res.id)).toBe(true);
    // Now they have a board presence and are a legal charge target.
    expect(res.moveState).toBe('normal');
  });
});

describe('reserve destruction timing', () => {
  it('keeps reserves alive through round 3 but destroys them at round 4 command', () => {
    const g = gameWith([{ datasheetId: 'trooper', modelCount: 5, inReserves: true }]);
    g.startGame();
    const res = g.reservesOf('A')[0];

    // Simulate the start of A's round-3 command phase: still alive.
    g.state.round = 3;
    g.state.activePlayer = 'A';
    g.state.phase = 'command';
    g.startCommandPhase();
    expect(g.isAlive(res)).toBe(true);
    expect(res.inReserves).toBe(true);

    // Start of A's round-4 command phase: destroyed.
    g.state.round = 4;
    g.state.phase = 'command';
    g.startCommandPhase();
    expect(g.isAlive(res)).toBe(false);
    expect(g.state.log.some((l) => l.message.includes('never arrived'))).toBe(true);
  });
});

describe('leader attachment', () => {
  it('links the leader to its bodyguard and protects it from being targeted', () => {
    const g = gameWith([
      { datasheetId: 'trooper', modelCount: 5, instanceId: 'squad' },
      { datasheetId: 'hero', instanceId: 'boss', attachTo: 'squad' },
    ]);
    g.startGame();
    const squad = g.unitsOf('A').find((u) => u.datasheetId === 'trooper')!;
    const boss = g.unitsOf('A').find((u) => u.datasheetId === 'hero')!;

    // The link is recorded both ways.
    expect(boss.leadingUnitId).toBe(squad.id);
    expect(squad.attachedLeaderIds).toContain(boss.id);

    // While the bodyguard lives, the leader is not a legal target.
    expect(g.isProtectedLeader(boss)).toBe(true);
    expect(g.targetableEnemiesOf('B').some((u) => u.id === boss.id)).toBe(false);
    const bUnit = g.unitsOf('B')[0];
    expect(g.chargeTargets(bUnit).some((u) => u.id === boss.id)).toBe(false);

    // Enemy shooting at the protected leader does nothing.
    g.state.phase = 'shooting';
    const shotsBefore = g.state.log.length;
    const results = g.shoot(bUnit, boss);
    expect(results).toHaveLength(0);
    expect(g.state.log.length).toBeGreaterThan(shotsBefore); // a refusal was logged

    // Once the bodyguard is wiped out, the leader becomes targetable again.
    squad.models.forEach((m) => { m.alive = false; m.wounds = 0; });
    expect(g.isProtectedLeader(boss)).toBe(false);
    expect(g.targetableEnemiesOf('B').some((u) => u.id === boss.id)).toBe(true);
  });

  it('confers the leader aura (re-roll hits) to the bodyguard unit', () => {
    const g = gameWith([
      { datasheetId: 'trooper', modelCount: 5, instanceId: 'squad' },
      { datasheetId: 'hero', instanceId: 'boss', attachTo: 'squad' },
    ]);
    g.startGame();
    g.state.terrain = [];
    const squad = g.unitsOf('A').find((u) => u.datasheetId === 'trooper')!;
    const bUnit = g.unitsOf('B')[0];
    g.state.phase = 'shooting';
    // The squad should shoot; the conferred re-roll should not throw and should
    // produce a result. (Behavioural smoke test of aura conferral path.)
    const results = g.shoot(squad, bUnit);
    expect(results.length).toBeGreaterThan(0);
  });
});
