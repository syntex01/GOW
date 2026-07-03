import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList, resetIds } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';

const BODYGUARD: Datasheet = {
  id: 'guard',
  name: 'Guard',
  faction: 'T',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 3, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [{ id: 'gcc', name: 'CCW', kind: 'melee', range: 0, attacks: 1, skill: 4, strength: 4, ap: 0, damage: 1, keywords: [] }],
  abilities: [],
  composition: [{ modelName: 'Guard', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

const LEADER: Datasheet = {
  id: 'boss',
  name: 'Boss',
  faction: 'T',
  keywords: ['INFANTRY', 'CHARACTER'],
  statline: { move: 6, toughness: 4, save: 6, wounds: 5, leadership: 6, objectiveControl: 1 },
  weapons: [{ id: 'bcc', name: 'Fist', kind: 'melee', range: 0, attacks: 3, skill: 3, strength: 6, ap: 1, damage: 2, keywords: [] }],
  abilities: [{ name: 'Leader', text: 'Leads Guard.', effect: { t: 'leader', canLeadDatasheetIds: ['guard'] } }],
  composition: [{ modelName: 'Boss', min: 1, max: 1 }],
  baseSizeMm: 40,
  isCharacter: true,
  points: 80,
};

// A sniper whose gun has Precision, plenty of high-strength shots.
const SNIPER: Datasheet = {
  id: 'sniper',
  name: 'Sniper',
  faction: 'T',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [
    { id: 'rail', name: 'Rail', kind: 'ranged', range: 48, attacks: 6, skill: 2, strength: 8, ap: 3, damage: 2, keywords: [{ t: 'precision' }] },
  ],
  abilities: [],
  composition: [{ modelName: 'Sniper', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

const registry: Record<string, Datasheet> = { guard: BODYGUARD, boss: LEADER, sniper: SNIPER };

function game(seed: number): GameEngine {
  resetIds();
  const listA: ArmyList = { name: 'A', faction: 'T', entries: [{ datasheetId: 'sniper', modelCount: 5 }] };
  const listB: ArmyList = {
    name: 'B',
    faction: 'T',
    entries: [
      { datasheetId: 'guard', modelCount: 5, instanceId: 'g1' },
      { datasheetId: 'boss', attachTo: 'g1' },
    ],
  };
  const state = createGame(
    { seed, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'T' }, B: { name: 'B', faction: 'T' } } },
    registry,
    listA,
    listB,
  );
  const e = new GameEngine(state);
  // Line the sniper up 20" from the bodyguard with clear LoS.
  e.state.terrain = [];
  const sniper = e.unitsOf('A')[0];
  const guard = e.state.units['g1'] ?? e.unitsOf('B').find((u) => u.datasheetId === 'guard')!;
  sniper.models.forEach((m, i) => (m.position = { x: 10 + i * 0.5, y: 20 }));
  guard.models.forEach((m, i) => (m.position = { x: 30 + i * 0.5, y: 20 }));
  return e;
}

describe('Precision snipes the attached leader', () => {
  it('the leader is protected from normal fire but hit by a Precision weapon', () => {
    const e = game(7);
    const sniper = e.unitsOf('A')[0];
    const guard = e.unitsOf('B').find((u) => u.datasheetId === 'guard')!;
    const boss = e.unitsOf('B').find((u) => u.datasheetId === 'boss')!;
    // The leader is attached and therefore protected from being targeted directly.
    expect(boss.leadingUnitId).toBe(guard.id);
    expect(e.isProtectedLeader(boss)).toBe(true);

    const bossWoundsBefore = boss.models.reduce((a, m) => a + m.wounds, 0);
    e.state.phase = 'shooting';
    e.shoot(sniper, guard); // Precision weapon → routes to the boss
    const bossWoundsAfter = boss.models.reduce((a, m) => a + m.wounds, 0);
    expect(bossWoundsAfter).toBeLessThan(bossWoundsBefore); // the character took the hits
  });

  it('a non-Precision weapon leaves the attached leader untouched', () => {
    const e = game(7);
    const sniper = e.unitsOf('A')[0];
    // Strip Precision from the gun so it is ordinary fire.
    sniper.weapons[0].keywords = [];
    const guard = e.unitsOf('B').find((u) => u.datasheetId === 'guard')!;
    const boss = e.unitsOf('B').find((u) => u.datasheetId === 'boss')!;
    const bossBefore = boss.models.reduce((a, m) => a + m.wounds, 0);
    e.state.phase = 'shooting';
    e.shoot(sniper, guard);
    const bossAfter = boss.models.reduce((a, m) => a + m.wounds, 0);
    expect(bossAfter).toBe(bossBefore); // only the bodyguard can be hit
  });
});
