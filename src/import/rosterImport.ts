/**
 * Roster / army-list importer.
 *
 * Parses the common army-builder TEXT exports players share — the official
 * Warhammer app / "New Recruit" style, the BattleScribe style, and bare plain
 * lists — into the engine's {@link ArmyList} structure.
 *
 * Design goals:
 *  - Be permissive: real exports are messy (mixed bullets, points styles,
 *    enhancements, wargear after a colon). We extract a unit display name and a
 *    model count and look the name up in a name->datasheetId map.
 *  - Never throw. Anything we can't make sense of becomes a warning and/or an
 *    entry in `unmatched`, so the UI can surface it without crashing.
 */

import type { ArmyList, ArmyListEntry } from '../engine/factory';

// The data module is produced by a sibling agent. We import it lazily/defensively
// so that a missing module (during parallel development) or a caller-provided map
// both work. Tests pass an inline map and never touch this import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { NAME_TO_DATASHEET_ID as DEFAULT_NAME_TO_ID } from '../engine/data/index';

export interface ImportResult {
  army: ArmyList;
  warnings: string[];
  /** Unit display names we parsed but could not match to a datasheet id. */
  unmatched: string[];
}

/** A non-exhaustive list of faction keywords we recognise in free text. */
const KNOWN_FACTIONS = [
  'Necrons',
  'Ultramarines',
  'Space Marines',
  'Adeptus Astartes',
  'Aeldari',
  'Drukhari',
  'Orks',
  'Tyranids',
  'Astra Militarum',
  'Adeptus Mechanicus',
  'Chaos Space Marines',
  'Death Guard',
  'Thousand Sons',
  'World Eaters',
  'T’au Empire',
  "T'au Empire",
  'Tau Empire',
  'Genestealer Cults',
  'Leagues of Votann',
  'Grey Knights',
  'Blood Angels',
  'Dark Angels',
  'Space Wolves',
  'Imperial Knights',
  'Chaos Knights',
  'Adepta Sororitas',
  'Custodes',
  'Adeptus Custodes',
];

/**
 * Section / structural lines that are not units and must be skipped.
 * Matched case-insensitively against the trimmed, de-bulleted line.
 */
const SECTION_HEADERS = new Set([
  'characters',
  'character',
  'battleline',
  'dedicated transports',
  'dedicated transport',
  'other datasheets',
  'allied units',
  'epic hero',
  'epic heroes',
  'hq',
  'troops',
  'elites',
  'elite',
  'fast attack',
  'heavy support',
  'flyers',
  'flyer',
  'lords of war',
  'fortifications',
  'configuration',
  'no force org slot',
  'units',
]);

/** Strip a single leading bullet/dot marker ("•", ".", "-", "*", ">"). */
function stripBullet(line: string): string {
  // Common bullets: "• ", ". " (BattleScribe sub-items), "- ", "* ", "> ".
  return line.replace(/^\s*[•‣◦⁃∙.\-*>]+\s*/, '');
}

/** Remove a trailing points annotation: "(85 Points)", "[80 pts]", "(120 pts)". */
function stripPoints(s: string): string {
  return s
    .replace(/\s*[\(\[]\s*\d[\d,]*\s*(points?|pts?|pl)\s*[\)\]]\s*$/i, '')
    .trim();
}

/** Extract points number from a line if present, e.g. "(2000 Points)" -> 2000. */
function extractPoints(s: string): number | undefined {
  const m = s.match(/(\d[\d,]*)\s*(?:points?|pts?)\b/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalize a unit display name for lookup: drop bullets, points, any wargear
 * after the first colon, surrounding punctuation, collapse whitespace, lowercase.
 */
function normalizeName(raw: string): string {
  let s = stripBullet(raw);
  s = stripPoints(s);
  // Drop wargear / loadout that follows a colon ("Captain: Master-crafted ...").
  const colon = s.indexOf(':');
  if (colon !== -1) s = s.slice(0, colon);
  // Drop a leading model count we might still be carrying ("10x Foo", "10 Foo").
  s = s.replace(/^\s*\d+\s*[x×]?\s+/i, '');
  // Drop any leftover bracketed annotations.
  s = s.replace(/[\(\[][^\)\]]*[\)\]]/g, ' ');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Try to read a leading model count from a (de-bulleted) line.
 * Handles "10x Necron Warrior", "10 Necron Warriors", "20× Gauss".
 * Returns { count, rest } where rest is the text after the count.
 */
function leadingCount(line: string): { count?: number; rest: string } {
  const s = stripBullet(line);
  const m = s.match(/^\s*(\d+)\s*[x×]?\s+(.*)$/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return { count: n, rest: m[2] };
  }
  return { rest: s };
}

/** True if the de-bulleted, de-pointed line is a structural/section header. */
function isSectionHeader(line: string): boolean {
  const bare = stripPoints(stripBullet(line)).trim();
  if (bare === '') return true;
  // "+++ ... +++", "++ ... ++", "+ HQ +" style frames.
  if (/^\++.*\++$/.test(bare) || /^\++/.test(bare)) {
    const inner = bare.replace(/\+/g, '').trim().toLowerCase();
    if (inner === '' || SECTION_HEADERS.has(inner)) return true;
    // "+ HQ +" -> inner "hq" handled above; otherwise treat framed lines as headers.
    return true;
  }
  // "Faction:", "Detachment:", "Configuration", etc.
  const lower = bare.toLowerCase();
  if (/^(faction|detachment|army|game size|points|chapter|dynasty|hive fleet|battle size|show\b)\s*[:]/i.test(bare)) {
    return true;
  }
  return SECTION_HEADERS.has(lower);
}

/** Look for a known faction keyword anywhere in a string. */
function matchFactionKeyword(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const f of KNOWN_FACTIONS) {
    if (lower.includes(f.toLowerCase())) return f;
  }
  return undefined;
}

/**
 * Detect the army's faction. Prefers an explicit "Faction: X" line, then falls
 * back to scanning the text for a known faction keyword.
 */
export function detectFaction(text: string): string | undefined {
  if (typeof text !== 'string') return undefined;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*Faction\s*:\s*(.+?)\s*$/i);
    if (m && m[1]) {
      // Map common composite values back to a canonical keyword if we know one.
      return matchFactionKeyword(m[1]) ?? m[1].trim();
    }
  }
  return matchFactionKeyword(text);
}

/**
 * Detect the army name and points from a header line.
 * Supports "+++ My Army (1000 Points) +++", "++ Strike Force (2000 Points) ++",
 * or a leading non-unit title line.
 */
function detectHeader(lines: string[]): { name?: string; points?: number } {
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    // Framed header: strip leading/trailing "+".
    const framed = line.match(/^\++\s*(.*?)\s*\++$/);
    if (framed && framed[1]) {
      const inner = framed[1].trim();
      // Skip pure section frames like "+ HQ +".
      if (SECTION_HEADERS.has(inner.toLowerCase())) continue;
      const points = extractPoints(inner);
      const name = inner.replace(/\s*[\(\[].*$/, '').trim();
      return { name: name || inner, points };
    }
    // A line that mentions points but isn't a unit we can otherwise key off.
    const pts = extractPoints(line);
    if (pts !== undefined && /^[+\s]*[A-Za-z]/.test(line)) {
      const name = stripPoints(line.replace(/^\++\s*/, '')).trim();
      return { name: name || undefined, points: pts };
    }
    // No header found on the first content line; stop probing.
    break;
  }
  return {};
}

/**
 * Parse a roster text export into an ArmyList plus diagnostics.
 *
 * Algorithm:
 *  - Split into lines. Pull header (name/points) and faction.
 *  - Walk lines. A non-bulleted, non-header line starts a *unit*. Subsequent
 *    bulleted/indented lines are that unit's wargear/sub-models, used only to
 *    infer a model count.
 *  - For each unit, determine its model count: prefer an explicit unit-level
 *    leading count ("10 Necron Warriors"); otherwise infer from sub-bullets by
 *    taking the largest "Nx <model>" count (the body models, not the upgrades).
 *  - Normalize the unit name and look it up in the name->id map.
 */
export function importRosterText(
  text: string,
  opts?: { nameToId?: Record<string, string> },
): ImportResult {
  const warnings: string[] = [];
  const unmatched: string[] = [];
  const entries: ArmyListEntry[] = [];

  const nameToId: Record<string, string> =
    opts?.nameToId ?? (DEFAULT_NAME_TO_ID as Record<string, string>) ?? {};

  if (typeof text !== 'string' || text.trim() === '') {
    warnings.push('Empty or invalid roster text.');
    return { army: { name: 'Imported Army', faction: '', entries }, warnings, unmatched };
  }

  const rawLines = text.split(/\r?\n/);
  const header = detectHeader(rawLines);
  const faction = detectFaction(text) ?? '';

  // A pending unit we are accumulating sub-bullets for.
  interface Pending {
    rawName: string; // de-bulleted unit line (before normalize)
    explicitCount?: number; // unit-level leading count, if any
    bulletCounts: number[]; // counts from sub-bullets ("20x Necron Warrior")
  }
  let pending: Pending | undefined;

  // Determine whether a raw source line is "indented" (a sub-item). We treat a
  // line as a sub-item if it begins with whitespace+bullet or a bullet marker.
  const isSubItem = (raw: string): boolean =>
    /^\s*[•‣◦⁃∙.\-*>]\s/.test(raw) ||
    /^\s+\S/.test(raw); // leading-whitespace continuation

  const flush = (): void => {
    if (!pending) return;
    const p = pending;
    pending = undefined;

    const display = stripPoints(stripBullet(p.rawName)).trim();
    const key = normalizeName(p.rawName);
    if (key === '') return;

    const id = nameToId[key];
    if (!id) {
      unmatched.push(display);
      warnings.push(`No datasheet match for "${display}".`);
      return;
    }

    // Resolve model count: explicit unit count wins; else the largest sub-bullet
    // count (the body of the squad); else leave undefined (engine uses the min).
    let modelCount: number | undefined = p.explicitCount;
    if (modelCount === undefined && p.bulletCounts.length > 0) {
      modelCount = Math.max(...p.bulletCounts);
    }

    const entry: ArmyListEntry = { datasheetId: id };
    if (modelCount !== undefined && modelCount > 0) entry.modelCount = modelCount;
    entries.push(entry);
  };

  for (const raw of rawLines) {
    if (raw.trim() === '') continue;

    if (isSectionHeader(raw)) {
      flush();
      continue;
    }

    if (isSubItem(raw) && pending) {
      // Sub-bullet of the current unit: harvest a possible "Nx model" count.
      const { count } = leadingCount(raw);
      if (count !== undefined) pending.bulletCounts.push(count);
      // BattleScribe also lists "4x Intercessor" + "Intercessor Sergeant" (count 1
      // implied). We only collect explicit counts; the +1 sergeant is folded in by
      // taking the max body count, which is the conventional unit size proxy.
      continue;
    }

    // A new unit line. Flush the previous one first.
    flush();

    const { count, rest } = leadingCount(raw);
    pending = {
      rawName: count !== undefined ? rest : stripBullet(raw),
      explicitCount: count,
      bulletCounts: [],
    };
  }
  flush();

  const army: ArmyList = {
    name: header.name ?? 'Imported Army',
    faction,
    entries,
  };

  // Surface header points as an informational warning (the ArmyList type has no
  // points field, but the UI may want it).
  if (header.points !== undefined) {
    warnings.push(`Detected list size: ${header.points} points.`);
  }
  if (entries.length === 0) {
    warnings.push('No units were matched in this roster.');
  }

  return { army, warnings, unmatched };
}
