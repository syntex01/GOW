import { describe, it, expect } from 'vitest';
import type {
  ModelInstance,
  UnitInstance,
  Characteristics,
  Objective,
  PlayerId,
  Vec2,
} from '../src/engine/types';
import {
  modelGap,
  inEngagementRange,
  isCoherent,
  computeObjectiveControl,
  isBelowHalfStrength,
  unitObjectiveControl,
} from '../src/engine/geometry';

const STAT: Characteristics = {
  move: 6,
  toughness: 4,
  save: 3,
  wounds: 2,
  leadership: 6,
  objectiveControl: 1,
};

let seq = 0;
function model(pos: Vec2, opts: Partial<ModelInstance> = {}): ModelInstance {
  return {
    id: `m${seq++}`,
    modelName: 'M',
    wounds: opts.wounds ?? 2,
    maxWounds: opts.maxWounds ?? 2,
    position: pos,
    alive: opts.alive ?? true,
    baseRadius: opts.baseRadius ?? 0.5, // 1" diameter base
  };
}

function unit(
  models: ModelInstance[],
  owner: PlayerId,
  stat: Partial<Characteristics> = {},
): UnitInstance {
  return {
    id: `u${seq++}`,
    datasheetId: 'ds',
    name: 'unit',
    ownerId: owner,
    models,
    statline: { ...STAT, ...stat },
    weapons: [],
    abilities: [],
    keywords: [],
    isCharacter: false,
    moveState: 'none',
    advanceRoll: 0,
    hasShot: false,
    hasChargedThisTurn: false,
    hasFought: false,
    isBattleShocked: false,
    inReserves: false,
    deepStrike: false,
    attachedLeaderIds: [],
    startingModelCount: models.length,
  };
}

describe('modelGap', () => {
  it('subtracts both base radii from centre-to-centre distance', () => {
    const a = model({ x: 0, y: 0 }, { baseRadius: 0.5 });
    const b = model({ x: 5, y: 0 }, { baseRadius: 0.5 });
    // centre distance 5, minus 0.5 + 0.5 = 4
    expect(modelGap(a, b)).toBeCloseTo(4);
  });
  it('never goes negative (overlapping bases)', () => {
    const a = model({ x: 0, y: 0 }, { baseRadius: 1 });
    const b = model({ x: 0.5, y: 0 }, { baseRadius: 1 });
    expect(modelGap(a, b)).toBe(0);
  });
});

describe('inEngagementRange', () => {
  it('true when edge gap <= 1"', () => {
    const a = unit([model({ x: 0, y: 0 }, { baseRadius: 0.5 })], 'A');
    // centre distance 2, edge gap = 2 - 1 = 1 -> within engagement range
    const b = unit([model({ x: 2, y: 0 }, { baseRadius: 0.5 })], 'B');
    expect(inEngagementRange(a, b)).toBe(true);
  });
  it('false when edge gap > 1"', () => {
    const a = unit([model({ x: 0, y: 0 }, { baseRadius: 0.5 })], 'A');
    // centre distance 3, edge gap = 3 - 1 = 2 -> out of range
    const b = unit([model({ x: 3, y: 0 }, { baseRadius: 0.5 })], 'B');
    expect(inEngagementRange(a, b)).toBe(false);
  });
});

describe('isCoherent', () => {
  it('true for a tight line of models (<=2" gaps)', () => {
    // 5 models spaced 1.5" centre-to-centre, radius 0 for simplicity -> gap 1.5 <= 2
    const ms = [0, 1.5, 3, 4.5, 6].map((x) => model({ x, y: 0 }, { baseRadius: 0 }));
    const u = unit(ms, 'A');
    expect(isCoherent(u)).toBe(true);
  });
  it('false for a broken formation (one model far away)', () => {
    const ms = [
      model({ x: 0, y: 0 }, { baseRadius: 0 }),
      model({ x: 1.5, y: 0 }, { baseRadius: 0 }),
      model({ x: 50, y: 0 }, { baseRadius: 0 }), // stranded
    ];
    const u = unit(ms, 'A');
    expect(isCoherent(u)).toBe(false);
  });
  it('single-model unit is always coherent', () => {
    expect(isCoherent(unit([model({ x: 0, y: 0 })], 'A'))).toBe(true);
  });
  it('7+ models need 2 neighbours each', () => {
    // A straight chain: endpoints only have 1 neighbour within 2" -> not coherent for 7+.
    const chain = Array.from({ length: 7 }, (_, i) => model({ x: i * 1.5, y: 0 }, { baseRadius: 0 }));
    expect(isCoherent(unit(chain, 'A'))).toBe(false);
    // A tightly clustered blob where each model is within 2" of >=2 others -> coherent.
    const blob = [
      model({ x: 0, y: 0 }, { baseRadius: 0 }),
      model({ x: 1, y: 0 }, { baseRadius: 0 }),
      model({ x: 0, y: 1 }, { baseRadius: 0 }),
      model({ x: 1, y: 1 }, { baseRadius: 0 }),
      model({ x: 0.5, y: 0.5 }, { baseRadius: 0 }),
      model({ x: 1.5, y: 0.5 }, { baseRadius: 0 }),
      model({ x: 0.5, y: 1.5 }, { baseRadius: 0 }),
    ];
    expect(isCoherent(unit(blob, 'A'))).toBe(true);
  });
});

describe('computeObjectiveControl', () => {
  it('picks the side with more OC within range', () => {
    const obj: Objective = { id: 'o', position: { x: 10, y: 10 }, radius: 3 };
    // A: 3 models OC1 = 3. B: 1 model OC1 = 1. Both within radius.
    const a = unit(
      [
        model({ x: 10, y: 10 }, { baseRadius: 0 }),
        model({ x: 10.5, y: 10 }, { baseRadius: 0 }),
        model({ x: 9.5, y: 10 }, { baseRadius: 0 }),
      ],
      'A',
    );
    const b = unit([model({ x: 11, y: 10 }, { baseRadius: 0 })], 'B');
    const units = { [a.id]: a, [b.id]: b };
    computeObjectiveControl([obj], units);
    expect(obj.controlledBy).toBe('A');
  });

  it('contested (equal OC) -> uncontrolled', () => {
    const obj: Objective = { id: 'o', position: { x: 10, y: 10 }, radius: 3 };
    const a = unit([model({ x: 10, y: 10 }, { baseRadius: 0 })], 'A');
    const b = unit([model({ x: 10.5, y: 10 }, { baseRadius: 0 })], 'B');
    computeObjectiveControl([obj], { [a.id]: a, [b.id]: b });
    expect(obj.controlledBy).toBeUndefined();
  });

  it('battle-shocked units contribute 0 OC', () => {
    const obj: Objective = { id: 'o', position: { x: 10, y: 10 }, radius: 3 };
    const a = unit([model({ x: 10, y: 10 }, { baseRadius: 0 })], 'A');
    a.isBattleShocked = true;
    const b = unit([model({ x: 10.5, y: 10 }, { baseRadius: 0 })], 'B');
    expect(unitObjectiveControl(a)).toBe(0);
    computeObjectiveControl([obj], { [a.id]: a, [b.id]: b });
    expect(obj.controlledBy).toBe('B');
  });

  it('units out of range do not contribute', () => {
    const obj: Objective = { id: 'o', position: { x: 10, y: 10 }, radius: 3 };
    const a = unit([model({ x: 100, y: 100 }, { baseRadius: 0 })], 'A');
    computeObjectiveControl([obj], { [a.id]: a });
    expect(obj.controlledBy).toBeUndefined();
  });
});

describe('isBelowHalfStrength', () => {
  it('multi-model unit: at or below half models', () => {
    const ms = Array.from({ length: 10 }, (_, i) => model({ x: i, y: 0 }));
    const u = unit(ms, 'A'); // startingModelCount = 10
    expect(isBelowHalfStrength(u)).toBe(false);
    // kill 5 -> 5 alive, 5*2 <= 10 -> below half
    for (let i = 0; i < 5; i++) ms[i].alive = false;
    expect(isBelowHalfStrength(u)).toBe(true);
  });

  it('multi-model unit: just above half is not below', () => {
    const ms = Array.from({ length: 10 }, (_, i) => model({ x: i, y: 0 }));
    const u = unit(ms, 'A');
    for (let i = 0; i < 4; i++) ms[i].alive = false; // 6 alive, 12 > 10
    expect(isBelowHalfStrength(u)).toBe(false);
  });

  it('single-model unit: below half wounds', () => {
    const m = model({ x: 0, y: 0 }, { wounds: 6, maxWounds: 6 });
    const u = unit([m], 'A');
    u.startingModelCount = 1;
    expect(isBelowHalfStrength(u)).toBe(false);
    m.wounds = 3; // 3*2 <= 6 -> below half
    expect(isBelowHalfStrength(u)).toBe(true);
    m.wounds = 4; // 8 > 6
    expect(isBelowHalfStrength(u)).toBe(false);
  });
});
