import { describe, it, expect } from 'vitest';
import type { UnitInstance, ModelInstance, Characteristics, TerrainPiece, Vec2 } from '../src/engine/types';
import { hasLineOfSight, unitInCover } from '../src/engine/geometry';

const STAT: Characteristics = {
  move: 6,
  toughness: 4,
  save: 3,
  wounds: 1,
  leadership: 6,
  objectiveControl: 1,
};

function model(pos: Vec2): ModelInstance {
  return { id: 'm' + pos.x + '_' + pos.y, modelName: 'm', wounds: 1, maxWounds: 1, position: pos, alive: true, baseRadius: 0.5 };
}

function unit(id: string, owner: 'A' | 'B', positions: Vec2[]): UnitInstance {
  return {
    id,
    datasheetId: 'd',
    name: id,
    ownerId: owner,
    models: positions.map(model),
    statline: { ...STAT },
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
    startingModelCount: positions.length,
  };
}

const ruin = (center: Vec2, w: number, d: number): TerrainPiece => ({
  id: 'r',
  kind: 'ruin',
  center,
  width: w,
  depth: d,
  height: 4,
  obscuring: true,
});

describe('line of sight', () => {
  it('open ground: LoS is clear', () => {
    const a = unit('a', 'A', [{ x: 10, y: 10 }]);
    const b = unit('b', 'B', [{ x: 30, y: 10 }]);
    expect(hasLineOfSight(a, b, [])).toBe(true);
  });

  it('an obscuring ruin between two distant units blocks LoS', () => {
    const a = unit('a', 'A', [{ x: 10, y: 10 }]);
    const b = unit('b', 'B', [{ x: 30, y: 10 }]);
    const t = [ruin({ x: 20, y: 10 }, 6, 6)];
    expect(hasLineOfSight(a, b, t)).toBe(false);
  });

  it('a ruin off to the side does not block LoS', () => {
    const a = unit('a', 'A', [{ x: 10, y: 10 }]);
    const b = unit('b', 'B', [{ x: 30, y: 10 }]);
    const t = [ruin({ x: 20, y: 25 }, 6, 6)];
    expect(hasLineOfSight(a, b, t)).toBe(true);
  });

  it('a unit standing in the ruin can see out (and be seen)', () => {
    const a = unit('a', 'A', [{ x: 20, y: 10 }]); // inside the ruin
    const b = unit('b', 'B', [{ x: 40, y: 10 }]);
    const t = [ruin({ x: 20, y: 10 }, 6, 6)];
    expect(hasLineOfSight(a, b, t)).toBe(true);
  });
});

describe('cover', () => {
  it('a model inside a terrain footprint gets cover', () => {
    const b = unit('b', 'B', [{ x: 20, y: 10 }]);
    const t = [ruin({ x: 20, y: 10 }, 6, 6)];
    expect(unitInCover(b, t)).toBe(true);
  });

  it('a model in the open does not get cover', () => {
    const b = unit('b', 'B', [{ x: 40, y: 10 }]);
    const t = [ruin({ x: 20, y: 10 }, 6, 6)];
    expect(unitInCover(b, t)).toBe(false);
  });
});
