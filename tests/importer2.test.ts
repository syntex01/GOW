import { describe, it, expect } from 'vitest';
import { importRosterText } from '../src/import/rosterImport';
import { NAME_TO_DATASHEET_ID, DATASHEETS } from '../src/engine/data';

/**
 * Importer coverage against the *real* data module's NAME_TO_DATASHEET_ID,
 * exercising the newly-added units and the Orks faction (including loose
 * aliases like "truck" for the Trukk). import.test.ts uses an inline map; this
 * file pins the shipped aliases end-to-end.
 */

describe('importer2: new units + Orks aliases map to the right ids', () => {
  it('maps every shipped alias to a known datasheet', () => {
    for (const [alias, id] of Object.entries(NAME_TO_DATASHEET_ID)) {
      expect(DATASHEETS[id], `alias "${alias}" -> "${id}"`).toBeDefined();
    }
  });

  it('imports an Ork list with the misspelled "truck" alias', () => {
    const text = `+++ Da Green Tide (1000 Points) +++
Faction: Orks

CHARACTERS
Warboss (75 Points)

BATTLELINE
Ork Boyz (80 Points)
  • 10x Boy

OTHER DATASHEETS
Nobz (105 Points)
  • 5x Nob

DEDICATED TRANSPORTS
truck (70 Points)`;
    const res = importRosterText(text);
    const ids = res.army.entries.map((e) => e.datasheetId);
    expect(res.army.faction).toBe('Orks');
    expect(ids).toContain('ork_warboss');
    expect(ids).toContain('ork_boyz');
    expect(ids).toContain('ork_nobz');
    expect(ids).toContain('ork_trukk'); // "truck" alias
    expect(res.unmatched).toEqual([]);
    const boyz = res.army.entries.find((e) => e.datasheetId === 'ork_boyz');
    expect(boyz?.modelCount).toBe(10);
  });

  it('imports the newer Necron and Ultramarine units by alias', () => {
    const text = `Faction: Necrons
5 Immortals
5 Lychguard
3 Canoptek Scarab Swarms
5 Hellblasters
5 Assault Intercessors
5 Terminators`;
    const res = importRosterText(text);
    const ids = res.army.entries.map((e) => e.datasheetId);
    expect(ids).toContain('necron_immortals');
    expect(ids).toContain('necron_lychguard');
    expect(ids).toContain('necron_scarabs');
    expect(ids).toContain('ultramarines_hellblasters');
    expect(ids).toContain('ultramarines_assault_intercessors');
    expect(ids).toContain('ultramarines_terminators');
    expect(res.unmatched).toEqual([]);
  });

  it('resolves short single-word aliases (boyz / nobz / overlord)', () => {
    const res = importRosterText('Orks\n10 boyz\n5 nobz\n1 warboss');
    const ids = res.army.entries.map((e) => e.datasheetId);
    expect(ids).toEqual(
      expect.arrayContaining(['ork_boyz', 'ork_nobz', 'ork_warboss']),
    );
  });

  it('mixed/garbled input never throws and reports the unmatched names', () => {
    const text = `Orks!!!
???
10x Boyz
%%% not a unit %%%
Squiggoth Of Doom (300 Points)
truck
+++ +++`;
    let res!: ReturnType<typeof importRosterText>;
    expect(() => (res = importRosterText(text))).not.toThrow();
    const ids = res.army.entries.map((e) => e.datasheetId);
    // Real units still come through.
    expect(ids).toContain('ork_boyz');
    expect(ids).toContain('ork_trukk');
    // The fictional unit is reported as unmatched, with a warning.
    expect(res.unmatched).toContain('Squiggoth Of Doom');
    expect(res.warnings.some((w) => w.includes('Squiggoth Of Doom'))).toBe(true);
  });

  it('never throws on degenerate inputs', () => {
    for (const bad of ['', '\n\n\n', '+++ +++', '????', '   ']) {
      expect(() => importRosterText(bad)).not.toThrow();
    }
    // @ts-expect-error intentional non-string input
    expect(() => importRosterText(null)).not.toThrow();
  });
});
