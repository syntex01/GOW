import type { ModelInstance, UnitInstance, Vec2, Objective, PlayerId, TerrainPiece } from './types';

export const ENGAGEMENT_RANGE = 1; // inches
export const COHERENCY_DISTANCE = 2; // inches between models in a unit

/** Fallback model height (inches) when an instance doesn't specify one. */
export const DEFAULT_MODEL_HEIGHT = 1.4;

/** A model's physical height in inches (for terrain clearance checks). */
export function modelHeight(m: ModelInstance): number {
  return m.heightInches ?? DEFAULT_MODEL_HEIGHT;
}

/** Max model height (inches) allowed within a terrain footprint (0 = solid). */
function terrainClearance(t: TerrainPiece): number {
  return t.clearance ?? 0;
}

/** Does this terrain piece keep `m` out of its footprint (too tall to fit)? */
export function terrainBlocksModel(m: ModelInstance, t: TerrainPiece): boolean {
  return modelHeight(m) > terrainClearance(t) + 1e-6;
}

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

/* ------------------------------- terrain --------------------------------- */

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function footprint(t: TerrainPiece): Rect {
  return {
    minX: t.center.x - t.width / 2,
    maxX: t.center.x + t.width / 2,
    minY: t.center.y - t.depth / 2,
    maxY: t.center.y + t.depth / 2,
  };
}

function pointInRect(p: Vec2, r: Rect, pad = 0): boolean {
  return p.x >= r.minX - pad && p.x <= r.maxX + pad && p.y >= r.minY - pad && p.y <= r.maxY + pad;
}

/** Does segment p1->p2 cross the axis-aligned rectangle r? (Liang–Barsky.) */
function segmentIntersectsRect(p1: Vec2, p2: Vec2, r: Rect): boolean {
  if (pointInRect(p1, r) || pointInRect(p2, r)) return true;
  let t0 = 0;
  let t1 = 1;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, p1.x - r.minX) &&
    clip(dx, r.maxX - p1.x) &&
    clip(-dy, p1.y - r.minY) &&
    clip(dy, r.maxY - p1.y)
  );
}

/** Is any living model of the unit standing within/adjacent to this terrain? */
function unitTouchesTerrain(u: UnitInstance, t: TerrainPiece, pad = 1): boolean {
  const r = footprint(t);
  return aliveModels(u).some((m) => pointInRect(m.position, r, m.baseRadius + pad));
}

/**
 * Line of sight from `a` to `b`. Obscuring terrain (ruins) blocks LoS when the
 * sight line between the two closest models passes through its footprint and
 * neither unit is standing within/adjacent to that piece (mirrors how ruins
 * work on the tabletop: you can see in/out when you're there, not through).
 */
export function hasLineOfSight(a: UnitInstance, b: UnitInstance, terrain: TerrainPiece[]): boolean {
  const pa = closestModelTo(a, unitCentroid(b));
  const pb = closestModelTo(b, unitCentroid(a));
  if (!pa || !pb) return false;
  for (const t of terrain) {
    if (!t.obscuring) continue;
    if (unitTouchesTerrain(a, t) || unitTouchesTerrain(b, t)) continue;
    if (segmentIntersectsRect(pa.position, pb.position, footprint(t))) return false;
  }
  return true;
}

/** The living model of `u` closest to a point. */
function closestModelTo(u: UnitInstance, p: Vec2): ModelInstance | undefined {
  let best: ModelInstance | undefined;
  let bd = Infinity;
  for (const m of aliveModels(u)) {
    const d = dist(m.position, p);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/** A unit benefits from cover if any living model is within a terrain footprint. */
export function unitInCover(u: UnitInstance, terrain: TerrainPiece[]): boolean {
  return terrain.some((t) =>
    aliveModels(u).some((m) => pointInRect(m.position, footprint(t), m.baseRadius)),
  );
}

/* ------------------------- raycast pathing + cover ----------------------- */

/** Smallest t>=0 at which the ray from `o` along unit `d` ENTERS rect `r`, or
 *  null if it never does (slab method). t is a distance since `d` is unit. */
function rayRectEntry(o: Vec2, d: Vec2, r: Rect): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [o.x, d.x, r.minX, r.maxX],
    [o.y, d.y, r.minY, r.maxY],
  ];
  for (const [oi, di, lo, hi] of axes) {
    if (Math.abs(di) < 1e-9) {
      if (oi < lo || oi > hi) return null; // parallel and outside the slab
    } else {
      let t1 = (lo - oi) / di;
      let t2 = (hi - oi) / di;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0; // 0 means the ray starts inside the rect
}

/**
 * How far a base of `baseRadius` and physical `heightInches` can travel from
 * `from` along unit direction `dir`, before it is stopped by the board edge or
 * by a terrain footprint it is too tall to enter (a wall / a too-low ceiling).
 * Capped at `maxDist`. This is the straight-line movement raycast.
 */
export function pathClearDistance(
  from: Vec2,
  dir: Vec2,
  maxDist: number,
  baseRadius: number,
  heightInches: number,
  terrain: TerrainPiece[],
  board: { width: number; height: number },
): number {
  let best = maxDist;
  // Board edges: the base centre must stay within [baseRadius, size-baseRadius].
  if (dir.x > 1e-9) best = Math.min(best, (board.width - baseRadius - from.x) / dir.x);
  else if (dir.x < -1e-9) best = Math.min(best, (baseRadius - from.x) / dir.x);
  if (dir.y > 1e-9) best = Math.min(best, (board.height - baseRadius - from.y) / dir.y);
  else if (dir.y < -1e-9) best = Math.min(best, (baseRadius - from.y) / dir.y);
  // Terrain the model is too tall to enter blocks the path at its near edge.
  for (const t of terrain) {
    if (heightInches <= (t.clearance ?? 0) + 1e-6) continue; // low enough to pass
    const entry = rayRectEntry(from, dir, footprint(t));
    if (entry !== null) best = Math.min(best, Math.max(0, entry - baseRadius));
  }
  return Math.max(0, Math.min(best, maxDist));
}

/**
 * Furthest a whole unit can rigidly translate along `dir` (unit vector) before
 * ANY of its models is blocked — the unit only moves as far as its most-blocked
 * model. Used to clamp a movement destination to the first obstacle.
 */
export function unitPathClearDistance(
  u: UnitInstance,
  dir: Vec2,
  maxDist: number,
  terrain: TerrainPiece[],
  board: { width: number; height: number },
): number {
  let best = maxDist;
  for (const m of aliveModels(u)) {
    best = Math.min(
      best,
      pathClearDistance(m.position, dir, maxDist, m.baseRadius, modelHeight(m), terrain, board),
    );
  }
  return best;
}

/**
 * Cover of `target` relative to `shooter`:
 *  - 'full'    — no line of sight (fully obscured; can't be targeted),
 *  - 'partial' — visible but standing in/behind cover (gets Benefit of Cover),
 *  - 'none'    — in the open.
 */
export function coverState(
  shooter: UnitInstance,
  target: UnitInstance,
  terrain: TerrainPiece[],
): 'none' | 'partial' | 'full' {
  if (!hasLineOfSight(shooter, target, terrain)) return 'full';
  if (unitInCover(target, terrain)) return 'partial';
  return 'none';
}

/* ----------------------------- base / clipping --------------------------- *
 * Tabletop-faithful spacing: every model occupies a round base of `baseRadius`
 * inches. Bases may not overlap each other, and may not overlap terrain a model
 * is too tall to enter (solid ruins by default). `resolveCollisions` nudges
 * overlapping/clipping models apart with a few relaxation passes — gentle, so it
 * only moves models that are actually intersecting and otherwise leaves legal
 * layouts untouched. Called after deployment and after movement.
 * ------------------------------------------------------------------------- */

/** Push a model's base outside terrain `t`'s footprint if it overlaps it. */
function pushOutOfTerrain(m: ModelInstance, t: TerrainPiece): void {
  const r = footprint(t);
  const cx = Math.max(r.minX, Math.min(m.position.x, r.maxX));
  const cy = Math.max(r.minY, Math.min(m.position.y, r.maxY));
  const inside = cx === m.position.x && cy === m.position.y;
  if (inside) {
    // Centre is within the rect: eject along the nearest edge (smallest push).
    const left = m.position.x - r.minX;
    const right = r.maxX - m.position.x;
    const down = m.position.y - r.minY;
    const up = r.maxY - m.position.y;
    const min = Math.min(left, right, down, up);
    if (min === left) m.position.x = r.minX - m.baseRadius;
    else if (min === right) m.position.x = r.maxX + m.baseRadius;
    else if (min === down) m.position.y = r.minY - m.baseRadius;
    else m.position.y = r.maxY + m.baseRadius;
    return;
  }
  // Centre outside: only act if the base disc still clips the rect edge.
  const dx = m.position.x - cx;
  const dy = m.position.y - cy;
  const d = Math.hypot(dx, dy);
  if (d < m.baseRadius && d > 1e-6) {
    const push = (m.baseRadius - d) / d;
    m.position.x += dx * push;
    m.position.y += dy * push;
  }
}

/**
 * Relax model positions so no two bases overlap and no base clips terrain it is
 * too tall to enter. Mutates positions in place. Iterative (a few passes is
 * plenty for the small model counts here); each pass also clamps to the board.
 */
export function resolveCollisions(
  units: Record<string, UnitInstance>,
  terrain: TerrainPiece[],
  board: { width: number; height: number },
  iterations = 6,
): void {
  const models: ModelInstance[] = [];
  for (const u of Object.values(units)) for (const m of aliveModels(u)) models.push(m);
  if (models.length === 0) return;

  for (let iter = 0; iter < iterations; iter++) {
    // Separate overlapping bases (split the overlap between the two models).
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const a = models[i];
        const b = models[j];
        const minD = a.baseRadius + b.baseRadius;
        if (minD <= 0) continue;
        let dx = b.position.x - a.position.x;
        let dy = b.position.y - a.position.y;
        let d = Math.hypot(dx, dy);
        if (d >= minD - 1e-6) continue;
        if (d < 1e-6) {
          // Coincident: nudge apart on a deterministic axis derived from index.
          dx = ((i + j) % 2 === 0 ? 1 : 0) || 1;
          dy = (i + j) % 2 === 0 ? 0 : 1;
          d = 1;
        }
        const push = (minD - d) / 2 / d;
        a.position.x -= dx * push;
        a.position.y -= dy * push;
        b.position.x += dx * push;
        b.position.y += dy * push;
      }
    }
    // Eject from terrain too tall to enter.
    for (const m of models) {
      for (const t of terrain) {
        if (terrainBlocksModel(m, t)) pushOutOfTerrain(m, t);
      }
    }
    // Keep everyone on the table.
    for (const m of models) {
      m.position.x = Math.max(m.baseRadius, Math.min(board.width - m.baseRadius, m.position.x));
      m.position.y = Math.max(m.baseRadius, Math.min(board.height - m.baseRadius, m.position.y));
    }
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
