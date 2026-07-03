import { describe, it, expect } from 'vitest';
import { resolveWeapon, type AttackOptions } from '../src/engine/combat';
import type { Rng } from '../src/engine/dice';
import type { Datasheet, UnitInstance, Weapon } from '../src/engine/types';
import { createGame, type ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';

function scriptedRng(rolls: number[]): Rng {
  const q = [...rolls];
  return { die: () => q.shift() ?? 1, next: () => 0 } as unknown as Rng;
}

function unit(over: Partial<UnitInstance>): UnitInstance {
  return {
    id: 'u', datasheetId: 'd', name: 'U', ownerId: 'A', models: [],
    statline: { move: 6, toughness: 4, save: 6, wounds: 3, leadership: 6, objectiveControl: 1 },
    weapons: [], abilities: [], keywords: [], isCharacter: false,
    moveState: 'none', advanceRoll: 0, hasShot: false, hasChargedThisTurn: false,
    hasFought: false, isBattleShocked: false, inReserves: false, deepStrike: false,
    attachedLeaderIds: [], startingModelCount: 1,
    ...over,
  } as UnitInstance;
}

const HAZARD: Weapon = {
  id: 'plasma', name: 'Plasma (Supercharge)', kind: 'ranged', range: 24, attacks: 1,
  skill: 2, strength: 6, ap: 2, damage: 2, keywords: [{ t: 'hazardous' }],
};

describe('plasma standard-profile downgrade opts', () => {
  it('suppressHazardous stops the attacker self-wounding on a rolled 1', () => {
    const attacker = unit({
      models: [{ id: 'a', modelName: 'A', wounds: 1, maxWounds: 1, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    const target = unit({
      id: 't', statline: { move: 6, toughness: 4, save: 6, wounds: 10, leadership: 6, objectiveControl: 1 },
      models: [{ id: 'm', modelName: 'M', wounds: 10, maxWounds: 10, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    // Rolls: hit=1 (miss) so no target damage; hazardous check would roll the next
    // die = 1 (mishap) — but suppressHazardous skips that roll entirely.
    const opts: AttackOptions = { suppressHazardous: true, firingModels: 1 };
    resolveWeapon(HAZARD, attacker, target, scriptedRng([1, 1, 1, 1]), opts);
    expect(attacker.models[0].alive).toBe(true);
  });

  it('without suppression, a Hazardous 1 destroys a single-wound firer', () => {
    const attacker = unit({
      models: [{ id: 'a', modelName: 'A', wounds: 1, maxWounds: 1, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    const target = unit({
      id: 't', statline: { move: 6, toughness: 4, save: 6, wounds: 10, leadership: 6, objectiveControl: 1 },
      models: [{ id: 'm', modelName: 'M', wounds: 10, maxWounds: 10, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    // hit=1 (miss), then the Hazardous check rolls a 1 → mishap kills the firer.
    resolveWeapon(HAZARD, attacker, target, scriptedRng([1, 1]), { firingModels: 1 });
    expect(attacker.models[0].alive).toBe(false);
  });

  it('damageBonus floors an unsaved wound at 1 damage', () => {
    const attacker = unit({
      models: [{ id: 'a', modelName: 'A', wounds: 1, maxWounds: 1, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    const target = unit({
      id: 't', statline: { move: 6, toughness: 4, save: 6, wounds: 10, leadership: 6, objectiveControl: 1 },
      models: [{ id: 'm', modelName: 'M', wounds: 10, maxWounds: 10, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    // hit=6, wound=6, save=1(fail), damage roll=2 → 2 + (-1) = 1 damage (floored).
    const res = resolveWeapon(HAZARD, attacker, target, scriptedRng([6, 6, 1, 2]), {
      damageBonus: -1, suppressHazardous: true, firingModels: 1,
    });
    expect(res.damageInflicted).toBe(1);
  });
});

describe('shoot() weapon subset (split fire)', () => {
  const GUNS: Datasheet = {
    id: 'guns', name: 'Guns', faction: 'x', keywords: ['INFANTRY'],
    statline: { move: 6, toughness: 4, save: 4, wounds: 2, leadership: 7, objectiveControl: 1 },
    weapons: [
      { id: 'rifle', name: 'Rifle', kind: 'ranged', range: 24, attacks: 2, skill: 3, strength: 4, ap: 0, damage: 1, keywords: [] },
      { id: 'cannon', name: 'Cannon', kind: 'ranged', range: 24, attacks: 2, skill: 3, strength: 8, ap: 2, damage: 2, keywords: [] },
      { id: 'ccw', name: 'CCW', kind: 'melee', range: 0, attacks: 1, skill: 3, strength: 4, ap: 0, damage: 1, keywords: [] },
    ],
    abilities: [], composition: [{ modelName: 'G', min: 3, max: 3 }],
    baseSizeMm: 32, isCharacter: false, points: 50,
  };
  const ENEMY: Datasheet = { ...GUNS, id: 'enemy', name: 'Enemy', weapons: [GUNS.weapons[2]] };
  const reg: Record<string, Datasheet> = { guns: GUNS, enemy: ENEMY };

  function game(): { e: GameEngine; a: UnitInstance; b: UnitInstance } {
    const la: ArmyList = { name: 'A', faction: 'x', entries: [{ datasheetId: 'guns', modelCount: 3 }] };
    const lb: ArmyList = { name: 'B', faction: 'x', entries: [{ datasheetId: 'enemy', modelCount: 3 }] };
    const state = createGame(
      { seed: 3, board: { width: 60, height: 44 }, players: { A: { name: 'A', faction: 'x' }, B: { name: 'B', faction: 'x' } } },
      reg, la, lb,
    );
    const e = new GameEngine(state);
    const a = e.unitsOf('A')[0];
    const b = e.unitsOf('B')[0];
    a.models.forEach((m, i) => (m.position = { x: 20 + i * 0.5, y: 20 }));
    b.models.forEach((m, i) => (m.position = { x: 30 + i * 0.5, y: 20 }));
    e.state.phase = 'shooting';
    return { e, a, b };
  }

  it('fires only the weapons named in weaponIds', () => {
    const { e, a, b } = game();
    const res = e.shoot(a, b, undefined, ['rifle']);
    expect(res).toHaveLength(1);
    expect(res[0].weaponName).toBe('Rifle');
  });

  it('fires all eligible weapons when weaponIds is omitted', () => {
    const { e, a, b } = game();
    const res = e.shoot(a, b);
    expect(res.map((r) => r.weaponName).sort()).toEqual(['Cannon', 'Rifle']);
  });
});
