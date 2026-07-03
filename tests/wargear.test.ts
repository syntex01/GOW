import { describe, it, expect } from 'vitest';
import { DATASHEETS } from '../src/engine/data/index';
import { WARGEAR } from '../src/engine/data/wargear';
import { resolveUnitWeapons } from '../src/engine/factory';

/**
 * Integrity guard for the researched wargear catalogue: every option must
 * reference weapons and choices that actually exist, so no loadout can silently
 * drop a unit's weapons or dangle a broken id.
 */
describe('wargear catalogue integrity', () => {
  for (const [dsId, cat] of Object.entries(WARGEAR)) {
    describe(dsId, () => {
      const ds = DATASHEETS[dsId];
      it('targets a real datasheet', () => {
        expect(ds, `WARGEAR key ${dsId} has no datasheet`).toBeDefined();
      });
      if (!ds) return;

      const dsWeaponIds = new Set(ds.weapons.map((w) => w.id));
      const extraIds = new Set(cat.extraWeapons.map((w) => w.id));
      const resolvable = new Set([...dsWeaponIds, ...extraIds]);

      it('extra weapons are well-formed and non-colliding', () => {
        for (const w of cat.extraWeapons) {
          expect(w.id, 'extra weapon id').toBeTruthy();
          expect(w.ap, `${w.id} ap must be a non-negative magnitude`).toBeGreaterThanOrEqual(0);
          // an extra weapon id should not silently duplicate a base weapon id
          expect(dsWeaponIds.has(w.id), `${w.id} collides with a base weapon id`).toBe(false);
        }
      });

      for (const opt of cat.options) {
        it(`option "${opt.id}" is internally consistent`, () => {
          const choiceIds = opt.choices.map((c) => c.id);
          expect(choiceIds, 'defaultChoiceId must be a listed choice').toContain(opt.defaultChoiceId);
          expect(new Set(choiceIds).size, 'choice ids unique').toBe(choiceIds.length);
          for (const c of opt.choices) {
            for (const rid of c.remove) {
              expect(dsWeaponIds.has(rid), `${opt.id}/${c.id} removes unknown weapon ${rid}`).toBe(true);
            }
            for (const aid of c.add) {
              expect(resolvable.has(aid), `${opt.id}/${c.id} adds unresolvable weapon ${aid}`).toBe(true);
            }
          }
        });
      }

      it('every choice resolves to a non-empty, unique weapon set', () => {
        // Default loadout is non-empty.
        const def = resolveUnitWeapons(ds);
        expect(def.length, 'default loadout empty').toBeGreaterThan(0);
        // Each single-option pick resolves cleanly with no duplicate weapon ids.
        for (const opt of cat.options) {
          for (const c of opt.choices) {
            const weapons = resolveUnitWeapons(ds, { [opt.id]: c.id });
            const ids = weapons.map((w) => w.id);
            expect(new Set(ids).size, `${opt.id}/${c.id} duplicates a weapon`).toBe(ids.length);
            expect(weapons.length, `${opt.id}/${c.id} leaves no weapons`).toBeGreaterThan(0);
          }
        }
      });
    });
  }
});

describe('resolveUnitWeapons swap behaviour', () => {
  it('applies a real swap: Necron Warriors Gauss Flayer -> Gauss Reaper', () => {
    const ds = DATASHEETS['necron_warriors'];
    const opt = WARGEAR['necron_warriors'].options[0];
    const reaper = opt.choices.find((c) => c.id.includes('reaper'))!;
    const base = resolveUnitWeapons(ds).map((w) => w.id);
    const swapped = resolveUnitWeapons(ds, { [opt.id]: reaper.id }).map((w) => w.id);
    expect(base).toContain('gauss_flayer');
    expect(swapped).not.toContain('gauss_flayer');
    expect(swapped).toContain('gauss_reaper');
  });

  it('an unknown option id falls back to the default loadout', () => {
    const ds = DATASHEETS['necron_warriors'];
    const def = resolveUnitWeapons(ds).map((w) => w.id).sort();
    const bogus = resolveUnitWeapons(ds, { nonsense: 'whatever' }).map((w) => w.id).sort();
    expect(bogus).toEqual(def);
  });
});
