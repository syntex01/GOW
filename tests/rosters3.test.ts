import { describe, it, expect } from 'vitest';
import {
  DATASHEETS,
  FACTIONS,
  NAME_TO_DATASHEET_ID,
  SAMPLE_ARMIES,
} from '../src/engine/data';
import { instantiateUnit, createGame } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { resolveWeapon } from '../src/engine/combat';
import { Rng } from '../src/engine/dice';
import type { Datasheet } from '../src/engine/types';

/**
 * Validation for the expanded Necron/Ultramarines rosters and the new Chaos
 * Space Marines faction. Complements content2.test.ts by spot-checking the
 * specific new datasheets, the new faction/sample army, weapon resolution and
 * importer aliases.
 */

const HEX = /^#[0-9a-fA-F]{3,8}$/;

const NEW_IDS = [
  // Necrons
  'necron_skorpekh_destroyers',
  'necron_wraiths',
  'necron_doomsday_ark',
  'necron_royal_warden',
  // Ultramarines
  'ultramarines_redemptor',
  'ultramarines_bladeguard',
  'ultramarines_lieutenant',
  'ultramarines_eradicators',
  // Chaos
  'chaos_legionaries',
  'chaos_chosen',
  'chaos_lord',
  'chaos_cultists',
  'chaos_raptors',
  'chaos_helbrute',
  'chaos_master_of_possession',
];

const minModels = (ds: Datasheet): number => ds.composition[0]?.min ?? 1;

describe('rosters3: new datasheets are well-formed and instantiable', () => {
  const entries = NEW_IDS.map((id) => [id, DATASHEETS[id]] as const);

  it('all new datasheets are registered', () => {
    for (const [id, ds] of entries) {
      expect(ds, `missing datasheet ${id}`).toBeDefined();
      expect(ds.id).toBe(id);
    }
  });

  it.each(entries)('%s instantiates at min count with a sane statline + proxy', (_id, ds) => {
    const min = minModels(ds);
    const unit = instantiateUnit(ds, 'A', min, { x: 10, y: 10 }, 1);
    expect(unit.models.length).toBe(min);
    expect(unit.models.length).toBeGreaterThanOrEqual(1);

    const s = ds.statline;
    expect(s.wounds).toBeGreaterThan(0);
    expect(s.move).toBeGreaterThan(0);
    // Save 2..7, or there is an invuln to rely on.
    expect((s.save >= 2 && s.save <= 7) || s.invuln !== undefined).toBe(true);
    if (s.invuln !== undefined) {
      expect(s.invuln).toBeGreaterThanOrEqual(2);
      expect(s.invuln).toBeLessThanOrEqual(7);
    }

    expect(ds.weapons.length).toBeGreaterThanOrEqual(1);
    expect(ds.points).toBeGreaterThan(0);

    const p = ds.proxy!;
    expect(p).toBeDefined();
    expect(p.primary).toMatch(HEX);
    expect(p.secondary).toMatch(HEX);
    if (p.glow !== undefined) expect(p.glow).toMatch(HEX);
  });
});

describe('rosters3: chaos faction and sample army', () => {
  it('FACTIONS.chaos resolves to known datasheets', () => {
    expect(FACTIONS.chaos).toBeDefined();
    expect(FACTIONS.chaos.datasheetIds.length).toBeGreaterThan(0);
    for (const id of FACTIONS.chaos.datasheetIds) {
      expect(DATASHEETS[id]).toBeDefined();
    }
  });

  it('SAMPLE_ARMIES.chaos references only known datasheets', () => {
    expect(SAMPLE_ARMIES.chaos.entries.length).toBeGreaterThanOrEqual(5);
    for (const e of SAMPLE_ARMIES.chaos.entries) {
      expect(DATASHEETS[e.datasheetId]).toBeDefined();
    }
  });

  // Chaos must build a legal game vs every other faction.
  const others = (Object.keys(SAMPLE_ARMIES) as (keyof typeof SAMPLE_ARMIES)[]).filter(
    (k) => k !== 'chaos',
  );
  it.each(others)('createGame builds chaos vs %s', (other) => {
    const state = createGame(
      { seed: 7, players: { A: { name: 'A', faction: 'chaos' }, B: { name: 'B', faction: other } } },
      DATASHEETS,
      SAMPLE_ARMIES.chaos,
      SAMPLE_ARMIES[other],
    );
    const engine = new GameEngine(state);
    engine.startGame();
    expect(Object.keys(engine.state.units).length).toBeGreaterThan(0);
    // The Chaos Lord should be linked as a Leader to the Legionaries.
    const lord = Object.values(state.units).find((u) => u.datasheetId === 'chaos_lord');
    expect(lord?.leadingUnitId).toBeDefined();
  });
});

describe('rosters3: representative new weapons resolve', () => {
  const target = instantiateUnit(DATASHEETS['necron_warriors'], 'B', 10, { x: 30, y: 30 }, -1);
  const weaponCases: [string, string][] = [
    ['necron_doomsday_ark', 'doomsday_cannon'],
    ['necron_wraiths', 'particle_caster'],
    ['ultramarines_redemptor', 'heavy_onslaught_gatling'],
    ['ultramarines_eradicators', 'melta_rifle'],
    ['chaos_lord', 'lord_daemon_hammer'],
    ['chaos_chosen', 'paired_accursed_weapons'],
    ['chaos_master_of_possession', 'rite_of_possession'],
  ];

  it.each(weaponCases)('%s / %s resolves without error', (dsId, weaponId) => {
    const ds = DATASHEETS[dsId];
    const attacker = instantiateUnit(ds, 'A', minModels(ds), { x: 30, y: 31 }, 1);
    const weapon = ds.weapons.find((w) => w.id === weaponId)!;
    expect(weapon).toBeDefined();
    const tgt = instantiateUnit(DATASHEETS['necron_warriors'], 'B', 10, { x: 30, y: 30 }, -1);
    const rng = new Rng(123);
    const res = resolveWeapon(weapon, attacker, tgt, rng, { halfRange: true });
    expect(res.attacks).toBeGreaterThanOrEqual(0);
    expect(res.weaponName).toBe(weapon.name);
  });

  it('keeps the shared target untouched (sanity: instances are independent)', () => {
    expect(target.models.every((m) => m.alive)).toBe(true);
  });
});

describe('rosters3: importer aliases resolve for new units', () => {
  const aliasCases: [string, string][] = [
    ['csm', 'chaos_legionaries'],
    ['legionaries', 'chaos_legionaries'],
    ['chaos lord', 'chaos_lord'],
    ['helbrute', 'chaos_helbrute'],
    ['cultists', 'chaos_cultists'],
    ['raptors', 'chaos_raptors'],
    ['chosen', 'chaos_chosen'],
    ['master of possession', 'chaos_master_of_possession'],
    ['skorpekh destroyers', 'necron_skorpekh_destroyers'],
    ['canoptek wraiths', 'necron_wraiths'],
    ['doomsday ark', 'necron_doomsday_ark'],
    ['royal warden', 'necron_royal_warden'],
    ['redemptor', 'ultramarines_redemptor'],
    ['bladeguard', 'ultramarines_bladeguard'],
    ['lieutenant', 'ultramarines_lieutenant'],
    ['eradicators', 'ultramarines_eradicators'],
  ];

  it.each(aliasCases)('alias "%s" -> %s', (alias, id) => {
    expect(NAME_TO_DATASHEET_ID[alias]).toBe(id);
    expect(DATASHEETS[id]).toBeDefined();
  });
});
