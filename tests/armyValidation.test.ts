import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import type { ArmyList } from '../src/engine/factory';
import { validateArmy, armyPoints, entryPoints } from '../src/engine/armyValidation';

const ds = (over: Partial<Datasheet> & Pick<Datasheet, 'id' | 'name'>): Datasheet => ({
  faction: 'Necrons',
  keywords: ['INFANTRY'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [],
  abilities: [],
  composition: [{ modelName: over.name, min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100, // priced at the min bracket (5)
  ...over,
});

const registry: Record<string, Datasheet> = {
  warriors: ds({ id: 'warriors', name: 'Warriors', keywords: ['INFANTRY', 'BATTLELINE'] }),
  wraiths: ds({ id: 'wraiths', name: 'Wraiths', composition: [{ modelName: 'Wraith', min: 3, max: 6 }], points: 110 }),
  lord: ds({ id: 'lord', name: 'Overlord', isCharacter: true, composition: [{ modelName: 'Overlord', min: 1, max: 1 }], points: 85 }),
  outsider: ds({ id: 'outsider', name: 'Ork Boy', faction: 'Orks' }),
};

const list = (entries: ArmyList['entries']): ArmyList => ({ name: 'L', faction: 'Necrons', entries });

describe('points scaling', () => {
  it('scales linearly from the minimum bracket', () => {
    expect(entryPoints(registry.warriors, 5)).toBe(100); // min bracket
    expect(entryPoints(registry.warriors, 10)).toBe(200); // double models, double points
  });
  it('sums the whole army', () => {
    const pts = armyPoints(list([
      { datasheetId: 'warriors', modelCount: 10 }, // 200
      { datasheetId: 'lord', modelCount: 1 }, // 85
    ]), registry);
    expect(pts).toBe(285);
  });
});

describe('validateArmy', () => {
  it('accepts a legal single-faction list under the limit with a Character', () => {
    const v = validateArmy(list([
      { datasheetId: 'warriors', modelCount: 10 },
      { datasheetId: 'lord', modelCount: 1 },
    ]), registry, { pointsLimit: 1000 });
    expect(v.legal).toBe(true);
    expect(v.issues).toEqual([]);
    expect(v.points).toBe(285);
  });

  it('flags going over the points limit', () => {
    const v = validateArmy(list([{ datasheetId: 'warriors', modelCount: 10 }]), registry, { pointsLimit: 100 });
    expect(v.legal).toBe(false);
    expect(v.issues.some((i) => /Over points/.test(i))).toBe(true);
  });

  it('enforces the Rule of Three for non-Battleline datasheets', () => {
    const v = validateArmy(list([
      { datasheetId: 'wraiths', modelCount: 3 },
      { datasheetId: 'wraiths', modelCount: 3 },
      { datasheetId: 'wraiths', modelCount: 3 },
      { datasheetId: 'wraiths', modelCount: 3 },
      { datasheetId: 'lord', modelCount: 1 },
    ]), registry, { pointsLimit: 2000 });
    expect(v.issues.some((i) => /Rule of Three/.test(i))).toBe(true);
  });

  it('exempts Battleline from the cap (4× is fine)', () => {
    const v = validateArmy(list([
      { datasheetId: 'warriors', modelCount: 5 },
      { datasheetId: 'warriors', modelCount: 5 },
      { datasheetId: 'warriors', modelCount: 5 },
      { datasheetId: 'warriors', modelCount: 5 },
      { datasheetId: 'lord', modelCount: 1 },
    ]), registry, { pointsLimit: 2000 });
    expect(v.issues.some((i) => /Rule of Three/.test(i))).toBe(false);
  });

  it('rejects an out-of-faction unit and a bad unit size', () => {
    const v = validateArmy(list([
      { datasheetId: 'outsider', modelCount: 5 },
      { datasheetId: 'warriors', modelCount: 99 }, // over the 10 max
    ]), registry, { pointsLimit: 2000 });
    expect(v.legal).toBe(false);
    expect(v.issues.some((i) => /single-faction/.test(i))).toBe(true);
    expect(v.issues.some((i) => /outside its 5–10 bracket/.test(i))).toBe(true);
  });

  it('warns when there is no Character', () => {
    const v = validateArmy(list([{ datasheetId: 'warriors', modelCount: 5 }]), registry, { pointsLimit: 2000 });
    expect(v.warnings.some((w) => /Warlord/.test(w))).toBe(true);
  });
});
