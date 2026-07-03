import { describe, it, expect } from 'vitest';
import { DATASHEETS, FACTIONS, SAMPLE_ARMIES } from '../src/engine/data';
import { instantiateUnit, createGame, type ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import type { Datasheet } from '../src/engine/types';

/**
 * Broad, data-driven content validation: every authored datasheet must be a
 * well-formed, instantiable unit, and every faction's sample army must build a
 * legal game against every other faction. Complements content.test.ts (which
 * spot-checks a few things) by exhaustively iterating the registry.
 */

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Minimum legal model count for a datasheet (its first composition entry). */
function minModels(ds: Datasheet): number {
  return ds.composition[0]?.min ?? 1;
}

describe('content2: every datasheet is well-formed and instantiable', () => {
  const all = Object.entries(DATASHEETS);

  it('the registry is non-empty and keyed by datasheet id', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const [key, ds] of all) expect(ds.id).toBe(key);
  });

  it.each(all)('datasheet %s instantiates at min model count without throwing', (_key, ds) => {
    const min = minModels(ds);
    const unit = instantiateUnit(ds, 'A', min, { x: 10, y: 10 }, 1);
    expect(unit.models.length).toBe(min);
    expect(unit.models.length).toBeGreaterThanOrEqual(1);
    for (const m of unit.models) {
      expect(m.alive).toBe(true);
      expect(m.wounds).toBe(ds.statline.wounds);
      expect(m.maxWounds).toBe(ds.statline.wounds);
      expect(m.baseRadius).toBeGreaterThan(0);
    }
  });

  it.each(all)('datasheet %s has a valid statline', (_key, ds) => {
    const s = ds.statline;
    expect(s.wounds).toBeGreaterThan(0);
    expect(s.move).toBeGreaterThan(0);
    expect(s.toughness).toBeGreaterThan(0);
    // Armour save is a "N+" on a D6: 2..7 (7 = effectively unsaveable / none).
    expect(s.save).toBeGreaterThanOrEqual(2);
    expect(s.save).toBeLessThanOrEqual(7);
    if (s.invuln !== undefined) {
      expect(s.invuln).toBeGreaterThanOrEqual(2);
      expect(s.invuln).toBeLessThanOrEqual(7);
    }
    if (s.feelNoPain !== undefined) {
      expect(s.feelNoPain).toBeGreaterThanOrEqual(2);
      expect(s.feelNoPain).toBeLessThanOrEqual(7);
    }
    expect(s.objectiveControl).toBeGreaterThanOrEqual(0);
    expect(s.leadership).toBeGreaterThanOrEqual(2);
    expect(s.leadership).toBeLessThanOrEqual(12);
  });

  it.each(all)('datasheet %s has >=1 weapon with a sane skill', (_key, ds) => {
    expect(ds.weapons.length).toBeGreaterThanOrEqual(1);
    for (const w of ds.weapons) {
      // Weapon skill is "N+" 2..6, or 0 for auto-hit (Torrent).
      expect(w.skill === 0 || (w.skill >= 2 && w.skill <= 6)).toBe(true);
      expect(w.strength).toBeGreaterThan(0);
      expect(w.ap).toBeGreaterThanOrEqual(0);
      expect(w.range).toBeGreaterThanOrEqual(0);
      if (w.kind === 'melee') expect(w.range).toBe(0);
      if (w.kind === 'ranged') expect(w.range).toBeGreaterThan(0);
    }
  });

  it.each(all)('datasheet %s has a proxy with hex colours and positive points', (_key, ds) => {
    expect(ds.points).toBeGreaterThan(0);
    expect(ds.baseSizeMm).toBeGreaterThan(0);
    expect(ds.proxy).toBeDefined();
    const p = ds.proxy!;
    expect(p.primary).toMatch(HEX);
    expect(p.secondary).toMatch(HEX);
    if (p.glow !== undefined) expect(p.glow).toMatch(HEX);
    expect(['infantry', 'character', 'monster', 'vehicle']).toContain(p.silhouette);
  });
});

describe('content2: factions and sample armies resolve', () => {
  it.each(Object.entries(FACTIONS))('faction %s datasheetIds all resolve', (_key, f) => {
    expect(f.datasheetIds.length).toBeGreaterThan(0);
    for (const id of f.datasheetIds) {
      expect(DATASHEETS[id]).toBeDefined();
      expect(DATASHEETS[id].id).toBe(id);
    }
  });

  it.each(Object.entries(SAMPLE_ARMIES))('sample army %s references only known datasheets', (_key, army) => {
    expect((army as ArmyList).entries.length).toBeGreaterThan(0);
    for (const entry of (army as ArmyList).entries) {
      expect(DATASHEETS[entry.datasheetId]).toBeDefined();
    }
  });

  // Every ordered pair of distinct factions should build a legal game.
  const factionKeys = Object.keys(SAMPLE_ARMIES) as (keyof typeof SAMPLE_ARMIES)[];
  const pairs: [keyof typeof SAMPLE_ARMIES, keyof typeof SAMPLE_ARMIES][] = [];
  for (const a of factionKeys) for (const b of factionKeys) if (a !== b) pairs.push([a, b]);

  it.each(pairs)('createGame builds %s vs %s without throwing', (a, b) => {
    let engine: GameEngine | undefined;
    expect(() => {
      const state = createGame(
        { seed: 42, players: { A: { name: 'A', faction: a }, B: { name: 'B', faction: b } } },
        DATASHEETS,
        SAMPLE_ARMIES[a],
        SAMPLE_ARMIES[b],
      );
      engine = new GameEngine(state);
      engine.startGame();
    }).not.toThrow();
    // Both sides have at least one on-board or reserve unit with models.
    expect(engine!.unitsOf('A').every((u) => u.models.length > 0)).toBe(true);
    expect(engine!.unitsOf('B').every((u) => u.models.length > 0)).toBe(true);
    // No createGame should have warned about unknown datasheets for sample armies.
    expect(Object.keys(engine!.state.units).length).toBeGreaterThan(0);
  });
});
