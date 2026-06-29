import { describe, it, expect } from 'vitest';
import { importRosterText, detectFaction } from '../src/import/rosterImport';
import { SAMPLE_NECRONS, SAMPLE_ULTRAMARINES } from '../src/import/sampleRosters';

/**
 * Inline name->id map so these tests don't depend on the data module
 * (which a sibling agent produces in parallel).
 */
const NAME_TO_ID: Record<string, string> = {
  overlord: 'necron_overlord',
  'necron overlord': 'necron_overlord',
  'necron warriors': 'necron_warriors',
  captain: 'ultramarines_captain',
  'intercessor squad': 'ultramarines_intercessors',
  intercessors: 'ultramarines_intercessors',
};

const opts = { nameToId: NAME_TO_ID };

describe('detectFaction', () => {
  it('reads an explicit Faction: line', () => {
    expect(detectFaction(SAMPLE_NECRONS)).toBe('Necrons');
    expect(detectFaction(SAMPLE_ULTRAMARINES)).toBe('Ultramarines');
  });

  it('falls back to a keyword in plain text', () => {
    expect(detectFaction('Necrons\n10 Necron Warriors')).toBe('Necrons');
  });

  it('returns undefined when nothing matches', () => {
    expect(detectFaction('just some random text')).toBeUndefined();
  });

  it('never throws on bad input', () => {
    // @ts-expect-error intentional bad input
    expect(detectFaction(null)).toBeUndefined();
  });
});

describe('importRosterText — sample Necrons (GW app style)', () => {
  const res = importRosterText(SAMPLE_NECRONS, opts);

  it('detects the army name and faction', () => {
    expect(res.army.name).toBe('Awakened Host');
    expect(res.army.faction).toBe('Necrons');
  });

  it('produces the right datasheet ids', () => {
    const ids = res.army.entries.map((e) => e.datasheetId);
    expect(ids).toContain('necron_overlord');
    expect(ids).toContain('necron_warriors');
    expect(ids).toHaveLength(2);
  });

  it('infers model count from the largest Nx sub-bullet', () => {
    const warriors = res.army.entries.find((e) => e.datasheetId === 'necron_warriors');
    expect(warriors?.modelCount).toBe(20);
  });

  it('leaves character model count unset (single model)', () => {
    const overlord = res.army.entries.find((e) => e.datasheetId === 'necron_overlord');
    expect(overlord?.modelCount).toBeUndefined();
  });

  it('reports detected points as a warning', () => {
    expect(res.warnings.some((w) => w.includes('1000'))).toBe(true);
  });

  it('has no unmatched units', () => {
    expect(res.unmatched).toEqual([]);
  });
});

describe('importRosterText — sample Ultramarines (BattleScribe style)', () => {
  const res = importRosterText(SAMPLE_ULTRAMARINES, opts);

  it('detects army name and faction', () => {
    expect(res.army.name).toBe('Strike Force');
    expect(res.army.faction).toBe('Ultramarines');
  });

  it('matches captain and intercessor squad, skipping +Config+ frames', () => {
    const ids = res.army.entries.map((e) => e.datasheetId);
    expect(ids).toContain('ultramarines_captain');
    expect(ids).toContain('ultramarines_intercessors');
    expect(ids).toHaveLength(2);
  });

  it('infers the squad body count from the largest Nx sub-bullet', () => {
    const sq = res.army.entries.find((e) => e.datasheetId === 'ultramarines_intercessors');
    expect(sq?.modelCount).toBe(4);
  });

  it('strips wargear after the colon for the captain', () => {
    const cap = res.army.entries.find((e) => e.datasheetId === 'ultramarines_captain');
    expect(cap).toBeDefined();
    expect(cap?.modelCount).toBeUndefined();
  });
});

describe('importRosterText — Example A shape (explicit unit-level count)', () => {
  const text = `+++ My Army (500 Points) +++
Faction: Necrons

CHARACTERS
Overlord (85 Points)
  • Tachyon Arrow

BATTLELINE
Necron Warriors (200 Points)
  • 10x Necron Warrior
  • 10x Gauss Flayer`;
  const res = importRosterText(text, opts);

  it('parses both units with correct ids', () => {
    expect(res.army.entries.map((e) => e.datasheetId).sort()).toEqual(
      ['necron_overlord', 'necron_warriors'].sort(),
    );
  });

  it('infers 10 warriors from the bullets', () => {
    const w = res.army.entries.find((e) => e.datasheetId === 'necron_warriors');
    expect(w?.modelCount).toBe(10);
  });
});

describe('importRosterText — Example C shape (plain list with leading counts)', () => {
  const text = `Necrons
10 Necron Warriors
1 Overlord`;
  const res = importRosterText(text, opts);

  it('detects faction from the bare keyword line', () => {
    expect(res.army.faction).toBe('Necrons');
  });

  it('uses the leading explicit count as the model count', () => {
    const w = res.army.entries.find((e) => e.datasheetId === 'necron_warriors');
    expect(w?.modelCount).toBe(10);
    const o = res.army.entries.find((e) => e.datasheetId === 'necron_overlord');
    // "1 Overlord" -> explicit count of 1.
    expect(o?.modelCount).toBe(1);
  });
});

describe('importRosterText — resilience', () => {
  it('never throws on empty input and warns', () => {
    const res = importRosterText('', opts);
    expect(res.army.entries).toEqual([]);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('never throws on garbage input', () => {
    const res = importRosterText('\n\n???\n+++ +++\n', opts);
    expect(Array.isArray(res.army.entries)).toBe(true);
  });

  it('collects unmatched unit names with a warning each', () => {
    const text = `Necrons
Lokhust Heavy Destroyer (50 Points)
10 Necron Warriors`;
    const res = importRosterText(text, opts);
    expect(res.unmatched).toContain('Lokhust Heavy Destroyer');
    expect(res.warnings.some((w) => w.includes('Lokhust Heavy Destroyer'))).toBe(true);
    // The known unit still comes through.
    expect(res.army.entries.map((e) => e.datasheetId)).toContain('necron_warriors');
  });
});
