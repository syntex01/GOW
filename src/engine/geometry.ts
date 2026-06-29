import type { ModelInstance, UnitInstance, Vec2, Objective, PlayerId } from './types';

export const ENGAGEMENT_RANGE = 1; // inches
export const COHERENCY_DISTANCE = 2; // inches between models in a unit

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Edge-to-edge distance between two models (accounts for base radii). */
export function modelGap(a: ModelInstance, b: ModelInstance): number {
  return Math.max(0, dist(a.position, b.position) - a.baseRadius - b.baseRadius);
}

export function aliveModels(u: UnitInstance): ModelInstance[] {
  return u.models.filter((m) => m.alive);
}

/** Closest edge-to-edge gap between any two living models of two units. */
export function unitGap(a: UnitInstance, b: UnitInstance): number {
  let best = Infinity;
  for (const ma of aliveModels(a)) {
    for (const mb of aliveModels(b)) {
      const g = modelGap(ma, mb);
      if (g < best) best = g;
    }
  }
  return best;
}

/** Are two units within engagement range of each other? */
export function inEngagementRange(a: UnitInstance, b: UnitInstance): boolean {
  return unitGap(a, b) <= ENGAGEMENT_RANGE + 1e-6;
}

/** Closest model-to-model gap from a unit to a point. */
export function unitGapToPoint(u: UnitInstance, p: Vec2): number {
  let best = Infinity;
  for (const m of aliveModels(u)) {
    const g = Math.max(0, dist(m.position, p) - m.baseRadius);
    if (g < best) best = g;
  }
  return best;
}

/** Centroid of a unit's living models. */
export function unitCentroid(u: UnitInstance): Vec2 {
  const models = aliveModels(u);
  if (models.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const m of models) {
    x += m.position.x;
    y += m.position.y;
  }
  return { x: x / models.length, y: y / models.length };
}

/**
 * Unit coherency: every model must be within COHERENCY_DISTANCE of at least one
 * other model in the unit (two others for units of 7+). Returns true if coherent.
 */
export function isCoherent(u: UnitInstance): boolean {
  const models = aliveModels(u);
  if (models.length <= 1) return true;
  const needed = models.length >= 7 ? 2 : 1;
  for (const m of models) {
    let neighbours = 0;
    for (const o of models) {
      if (o.id === m.id) continue;
      if (modelGap(m, o) <= COHERENCY_DISTANCE + 1e-6) neighbours++;
    }
    if (neighbours < needed) return false;
  }
  return true;
}

/** Total objective control of a unit (sum of OC over living models). */
export function unitObjectiveControl(u: UnitInstance): number {
  const oc = u.statline.objectiveControl;
  // Battle-shocked units have OC 0.
  if (u.isBattleShocked) return 0;
  return aliveModels(u).length * oc;
}

/**
 * Determine which player controls each objective. A player controls an objective
 * if the total OC of their units within the marker's range exceeds the enemy's.
 */
export function computeObjectiveControl(
  objectives: Objective[],
  units: Record<string, UnitInstance>,
): void {
  for (const obj of objectives) {
    const totals: Record<PlayerId, number> = { A: 0, B: 0 };
    for (const u of Object.values(units)) {
      if (aliveModels(u).length === 0) continue;
      if (unitGapToPoint(u, obj.position) <= obj.radius + 1e-6) {
        totals[u.ownerId] += unitObjectiveControl(u);
      }
    }
    if (totals.A > totals.B) obj.controlledBy = 'A';
    else if (totals.B > totals.A) obj.controlledBy = 'B';
    else obj.controlledBy = undefined;
  }
}

/** Number of living models in a unit at/under half its starting strength? */
export function isBelowHalfStrength(u: UnitInstance): boolean {
  const alive = aliveModels(u).length;
  if (u.startingModelCount === 1) {
    // Single-model unit: below half wounds.
    const m = u.models[0];
    return m.alive && m.wounds * 2 <= m.maxWounds;
  }
  return alive * 2 <= u.startingModelCount;
}
