import type { Datasheet } from './types';
import type { ArmyList } from './factory';

/**
 * Army-list legality — a lightweight, original implementation of the standard
 * matched-play checks so a list can be validated before a battle:
 *   - points total against the chosen limit,
 *   - single-faction consistency,
 *   - the "Rule of Three" datasheet-count cap (Battleline units are exempt up to
 *     six, everything else is capped at three),
 *   - unit sizes within their datasheet's composition brackets,
 *   - a Character present to be the Warlord.
 *
 * `issues` are hard violations (the list is illegal); `warnings` are advisories
 * that don't by themselves make the list illegal. Nothing here reproduces any
 * copyrighted text — it validates the (uncopyrightable) game structure only.
 */

export interface ArmyValidation {
  points: number;
  limit: number;
  legal: boolean;
  issues: string[];
  warnings: string[];
}

/** Common matched-play points ceilings (Incursion / Strike Force / Onslaught). */
export const POINTS_LIMITS = [500, 1000, 2000, 3000] as const;

/** The unit size a datasheet's printed points are priced at (its minimum). */
function baseSize(ds: Datasheet): number {
  return Math.max(1, ds.composition[0]?.min ?? 1);
}

/**
 * Points for a single list entry. A datasheet's `points` is the list price of
 * the unit as authored (a squad, not a per-model rate). Composition minimums in
 * this data are loose (often 1), so scaling linearly by min would massively
 * inflate multi-model squads (a 5-model Intercessor priced at 80 would read as
 * 400). We therefore scale from the minimum ONLY when it is a real multi-model
 * bracket (>1); otherwise `points` is treated as the flat squad price.
 */
export function entryPoints(ds: Datasheet, modelCount: number): number {
  const min = baseSize(ds);
  const n = modelCount || min;
  if (min > 1) return Math.round(ds.points * (n / min));
  return ds.points;
}

/** Total points of an army list. */
export function armyPoints(army: ArmyList, datasheets: Record<string, Datasheet>): number {
  let total = 0;
  for (const e of army.entries) {
    const ds = datasheets[e.datasheetId];
    if (ds) total += entryPoints(ds, e.modelCount ?? baseSize(ds));
  }
  return total;
}

/**
 * Validate an army list against a points limit and the core list-building rules.
 * Unknown datasheet ids are reported as issues (an importer should have dropped
 * them, so their presence means a malformed list).
 */
export function validateArmy(
  army: ArmyList,
  datasheets: Record<string, Datasheet>,
  opts: { pointsLimit?: number } = {},
): ArmyValidation {
  const limit = opts.pointsLimit ?? 1000;
  const issues: string[] = [];
  const warnings: string[] = [];

  const points = armyPoints(army, datasheets);
  if (points > limit) issues.push(`Over points: ${points} / ${limit} (by ${points - limit}).`);
  else if (points < limit * 0.5) warnings.push(`Well under the ${limit} pt limit (${points} pts).`);

  // Faction consistency + datasheet-count cap.
  const counts: Record<string, number> = {};
  let characters = 0;
  const wrongFaction: string[] = [];
  for (const e of army.entries) {
    const ds = datasheets[e.datasheetId];
    if (!ds) {
      issues.push(`Unknown datasheet: ${e.datasheetId}.`);
      continue;
    }
    counts[ds.id] = (counts[ds.id] ?? 0) + 1;
    if (ds.isCharacter) characters += 1;
    if (army.faction && ds.faction.toLowerCase() !== army.faction.toLowerCase()) {
      wrongFaction.push(ds.name);
    }
    // Unit size within the datasheet's composition bracket.
    const comp = ds.composition[0];
    const n = e.modelCount ?? comp?.min ?? 1;
    if (comp && (n < comp.min || n > comp.max)) {
      issues.push(`${ds.name}: ${n} models is outside its ${comp.min}–${comp.max} bracket.`);
    }
  }

  if (wrongFaction.length) {
    issues.push(`Not a single-faction (${army.faction}) list: ${[...new Set(wrongFaction)].join(', ')}.`);
  }

  // Rule of Three: max 3 of each datasheet; Battleline exempt up to 6.
  for (const [id, count] of Object.entries(counts)) {
    const ds = datasheets[id];
    if (!ds) continue;
    const battleline = ds.keywords.map((k) => k.toUpperCase()).includes('BATTLELINE');
    if (!battleline && count > 3) {
      issues.push(`Rule of Three: ${count}× ${ds.name} (max 3 of a non-Battleline datasheet).`);
    } else if (battleline && count > 6) {
      issues.push(`${count}× ${ds.name} (max 6 Battleline of one datasheet).`);
    }
  }

  if (characters === 0) warnings.push('No Character in the list — you need one to be your Warlord.');
  if (army.entries.length === 0) issues.push('The list is empty.');

  return { points, limit, legal: issues.length === 0, issues, warnings };
}
