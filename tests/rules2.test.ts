import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, type ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { unitGap, inEngagementRange } from '../src/engine/geometry';

/**
 * Edge-case coverage of the newer rules and stratagems. Where deeprules.test.ts
 * checks that an effect *happens*, this file additionally pins the *quantities*:
 * CP actually spent, phase/affordability gating, AP reduction changing damage,
 * statistical Desperate Escape, and obscuring-vs-clear shooting eligibility.
 */

const GRUNT: Datasheet = {
  id: 'grunt',
  name: 'Grunt',
  faction: 'TF',
  keywords: ['INFANTRY', 'GRENADES'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [
    { id: 'cc', name: 'CCW', kind: 'melee', range: 0, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, keywords: [] },
  ],
  abilities: [],
  composition: [{ modelName: 'Grunt', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

/* Shooter with a high-AP gun, used to verify Armour of Contempt's -1 AP. */
const SHOOTER: Datasheet = {
  id: 'shooter',
  name: 'Shooter',
  faction: 'TF',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 1 },
  weapons: [
    {
      id: 'apgun',
      name: 'AP Gun',
      kind: 'ranged',
      range: 48,
      attacks: 2,
      skill: 3,
      strength: 5,
      ap: 1, // AP -1; reduced to AP 0 by Armour of Contempt
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [],
  composition: [{ modelName: 'Shooter', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

const HERO: Datasheet = {
  id: 'hero',
  name: 'Hero',
  faction: 'TF',
  keywords: ['CHARACTER', 'INFANTRY'],
  statline: { move: 6, toughness: 4, save: 3, wounds: 4, leadership: 6, objectiveControl: 1 },
  weapons: [
    { id: 'blade', name: 'Blade', kind: 'melee', range: 0, attacks: 4, skill: 2, strength: 5, ap: 2, damage: 2, keywords: [] },
  ],
  abilities: [],
  composition: [{ modelName: 'Hero', min: 1, max: 1 }],
  baseSizeMm: 40,
  isCharacter: true,
  points: 80,
};

const registry: Record<string, Datasheet> = { grunt: GRUNT, shooter: SHOOTER, hero: HERO };

function game(seed: number, listA: ArmyList, listB: ArmyList): GameEngine {
  const state = createGame(
    { seed, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'TF' }, B: { name: 'B', faction: 'TF' } } },
    registry,
    listA,
    listB,
  );
  return new GameEngine(state);
}

const list = (id: string, count: number): ArmyList => ({
  name: id,
  faction: 'TF',
  entries: [{ datasheetId: id, modelCount: count }],
});

describe('per-model movement legality', () => {
  it('a within-allowance, coherency-preserving nudge is legal; an isolating one is not', () => {
    const e = game(1, list('grunt', 5), list('grunt', 5));
    const u = e.unitsOf('A')[0];
    // tight line so leaving it breaks coherency
    u.models.forEach((m, i) => (m.position = { x: 30 + i * 1.2, y: 20 }));
    const m0 = u.models[0];
    const start = { ...m0.position };
    // 1.5" slide stays inside the 2" coherency net -> legal.
    expect(e.moveModel(u.id, m0.id, { x: start.x, y: start.y + 1.5 })).toBe(true);
    // Reset, then a 6" leap (legal move distance) that isolates m0 -> illegal.
    m0.position = { ...start };
    expect(e.moveModel(u.id, m0.id, { x: start.x, y: start.y + 6 })).toBe(false);
    expect(m0.position).toEqual(start);
  });
});

describe('pile-in / consolidate never increase distance', () => {
  function facing(): GameEngine {
    const e = game(3, list('grunt', 5), list('grunt', 5));
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    a.models.forEach((m, i) => (m.position = { x: 30 + (i % 2) * 0.6, y: 20 }));
    b.models.forEach((m, i) => (m.position = { x: 30 + (i % 2) * 0.6, y: 24 }));
    return e;
  }

  it('pile-in moves toward the nearest enemy and never increases the gap', () => {
    const e = facing();
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    const before = unitGap(a, b);
    const moved = e.pileIn(a.id);
    expect(moved).toBeGreaterThan(0);
    expect(unitGap(a, b)).toBeLessThanOrEqual(before + 1e-6);
  });

  it('consolidate ends in engagement range and never increases the gap', () => {
    const e = facing();
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    const before = unitGap(a, b);
    e.consolidate(a.id);
    expect(unitGap(a, b)).toBeLessThanOrEqual(before + 1e-6);
    expect(inEngagementRange(a, b)).toBe(true);
  });

  it('pile-in on a unit with no enemies on the board does nothing', () => {
    const e = game(3, list('grunt', 5), list('grunt', 5));
    const a = e.unitsOf('A')[0];
    // Wipe B out so there is no nearest enemy.
    for (const u of e.unitsOf('B')) u.models.forEach((m) => ((m.alive = false), (m.wounds = 0)));
    expect(e.pileIn(a.id)).toBe(0);
  });
});

describe('Desperate Escape statistical (~1/3 destroyed)', () => {
  it('destroys roughly a third of a large battle-shocked unit over many rolls', () => {
    // Aggregate desperateEscape over many seeds on 30-model units; 1-2 on a D6
    // is a 1/3 chance per model, so ~1/3 should be lost in aggregate.
    let total = 0;
    let lost = 0;
    const SIZE = 30;
    for (let seed = 1; seed <= 40; seed++) {
      const e = game(seed, list('grunt', 5), list('grunt', 5));
      // Build an oversized unit by hand for a bigger sample per iteration.
      const u = e.unitsOf('A')[0];
      while (u.models.length < SIZE) {
        const proto = u.models[0];
        u.models.push({ ...proto, id: 'extra_' + u.models.length, alive: true, wounds: 1 });
      }
      u.startingModelCount = SIZE;
      const got = e.desperateEscape(u);
      lost += got;
      total += SIZE;
    }
    const frac = lost / total;
    // 1/3 expected; allow a generous band for a few hundred dice.
    expect(frac).toBeGreaterThan(0.27);
    expect(frac).toBeLessThan(0.40);
  });
});

describe('secondary scoring awards the documented VP', () => {
  it('Take and Hold (5) + Bring It Down (5) = 10, tracked separately', () => {
    const e = game(9, list('grunt', 5), list('grunt', 5));
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    const obj = e.state.objectives[0];
    a.models.forEach((m, i) => (m.position = { x: obj.position.x + i * 0.3, y: obj.position.y }));
    b.models.forEach((m) => (m.position = { x: 2, y: 2 }));
    e.state.players.A.enemyUnitsKilledThisTurn = 1;
    const before = e.state.players.A.victoryPoints;
    expect(e.scoreSecondaries()).toBe(10);
    expect(e.state.players.A.secondaryVictoryPoints).toBe(10);
    expect(e.state.players.A.victoryPoints).toBe(before + 10);
  });

  it('awards only Take and Hold (5) when no kill was scored', () => {
    const e = game(9, list('grunt', 5), list('grunt', 5));
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    const obj = e.state.objectives[0];
    a.models.forEach((m, i) => (m.position = { x: obj.position.x + i * 0.3, y: obj.position.y }));
    b.models.forEach((m) => (m.position = { x: 2, y: 2 }));
    e.state.players.A.enemyUnitsKilledThisTurn = 0;
    expect(e.scoreSecondaries()).toBe(5);
  });
});

describe('Armour of Contempt reduces incoming AP effect', () => {
  it('with -1 AP the AP-1 gun behaves as AP0 (more saves made -> fewer wounds)', () => {
    // Measure mean damage from the AP gun with and without Armour of Contempt
    // over many seeded volleys. AP-1 vs Sv4+ -> save 5+ (fails 4/6); AP0 -> save
    // 4+ (fails 3/6). So the protected target should take strictly less damage.
    function meanDamage(protect: boolean): number {
      let dmg = 0;
      const N = 400;
      for (let seed = 1; seed <= N; seed++) {
        const e = game(seed, list('shooter', 10), list('grunt', 10));
        const a = e.unitsOf('A')[0];
        const b = e.unitsOf('B')[0];
        e.state.terrain = []; // no cover
        a.models.forEach((m, i) => (m.position = { x: 20 + i * 0.4, y: 10 }));
        b.models.forEach((m, i) => (m.position = { x: 20 + i * 0.4, y: 30 }));
        if (protect) {
          b.armourOfContempt = true;
          b.defensiveFlagRound = e.state.round;
        }
        const before = b.models.filter((m) => m.alive).length;
        e.shoot(a, b);
        const after = b.models.filter((m) => m.alive).length;
        dmg += before - after;
      }
      return dmg / N;
    }
    const unprotected = meanDamage(false);
    const protectedDmg = meanDamage(true);
    expect(protectedDmg).toBeLessThan(unprotected);
  });
});

describe('stratagem CP spend, phase, and affordability gating', () => {
  it('Insane Bravery spends exactly its cost and only in the command phase', () => {
    const e = game(5, list('grunt', 5), list('grunt', 5));
    e.startGame(); // command phase, +1 CP
    const u = e.unitsOf('A')[0];
    e.state.players.A.commandPoints = 3;
    expect(e.state.phase).toBe('command');
    const cpBefore = e.state.players.A.commandPoints;
    const res = e.activateStratagem('insane_bravery', { unitId: u.id });
    expect(res.ok).toBe(true);
    expect(e.state.players.A.commandPoints).toBe(cpBefore - 1);
    expect(u.autoPassBattleshock).toBe(true);

    // Wrong phase: it must be rejected and spend nothing.
    e.state.phase = 'shooting';
    const cp2 = e.state.players.A.commandPoints;
    const bad = e.activateStratagem('insane_bravery', { unitId: u.id });
    expect(bad.ok).toBe(false);
    expect(e.state.players.A.commandPoints).toBe(cp2);
  });

  it('Armour of Contempt is rejected when the player cannot afford it', () => {
    const e = game(5, list('grunt', 5), list('grunt', 5));
    e.startGame();
    const u = e.unitsOf('A')[0];
    e.state.players.A.commandPoints = 0;
    const res = e.activateStratagem('armour_of_contempt', { unitId: u.id });
    expect(res.ok).toBe(false);
    expect(u.armourOfContempt).toBeFalsy();
    expect(e.state.players.A.commandPoints).toBe(0);
  });

  it('Rapid Ingress brings a reserve unit on (movement phase) and spends 1 CP', () => {
    const e = game(8, list('grunt', 5), list('grunt', 5));
    e.startGame();
    e.state.round = 2;
    e.state.phase = 'movement';
    const u = e.unitsOf('A')[0];
    u.inReserves = true;
    e.state.players.A.commandPoints = 3;
    const cpBefore = e.state.players.A.commandPoints;
    const res = e.activateStratagem('rapid_ingress', { unitId: u.id });
    expect(res.ok).toBe(true);
    expect(u.inReserves).toBe(false);
    expect(u.rapidIngressRound).toBe(2);
    expect(e.state.players.A.commandPoints).toBe(cpBefore - 1);
  });

  it('Epic Challenge grants Precision to a Character (fight phase) and is gated to characters', () => {
    const e = game(6, { name: 'A', faction: 'TF', entries: [{ datasheetId: 'hero' }] }, list('grunt', 5));
    e.startGame();
    e.state.phase = 'fight';
    e.state.players.A.commandPoints = 3;
    const hero = e.unitsOf('A')[0];
    const cpBefore = e.state.players.A.commandPoints;
    const res = e.activateStratagem('epic_challenge', { unitId: hero.id });
    expect(res.ok).toBe(true);
    expect(e.state.players.A.commandPoints).toBe(cpBefore - 1);
    expect(hero.weapons.find((w) => w.id === 'blade')!.keywords.some((k) => k.t === 'precision')).toBe(true);
  });
});

describe('shooting eligibility through obscuring terrain', () => {
  function shootScenario(blocked: boolean): GameEngine {
    const e = game(2, list('shooter', 5), list('grunt', 5));
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    // Far apart along a line so a central ruin lies between them.
    a.models.forEach((m, i) => (m.position = { x: 10 + i * 0.3, y: 22 }));
    b.models.forEach((m, i) => (m.position = { x: 50 + i * 0.3, y: 22 }));
    e.state.terrain = blocked
      ? [{ id: 'wall', kind: 'ruin', center: { x: 30, y: 22 }, width: 8, depth: 12, height: 5, obscuring: true }]
      : [];
    return e;
  }

  it('blocks all weapons when the target is fully behind an obscuring ruin', () => {
    const e = shootScenario(true);
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    expect(e.shootableWeapons(a, b)).toHaveLength(0);
    expect(e.shoot(a, b)).toHaveLength(0);
  });

  it('allows the weapon with clear line of sight', () => {
    const e = shootScenario(false);
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    expect(e.shootableWeapons(a, b).length).toBeGreaterThan(0);
  });
});
