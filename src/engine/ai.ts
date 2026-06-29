import type { GameEngine } from './game';
import type { UnitInstance } from './types';
import { unitCentroid, unitGap, inEngagementRange, unitGapToPoint } from './geometry';

/**
 * A lightweight heuristic opponent so a single player can test armies solo.
 * It is intentionally simple and deterministic (it uses the engine's seeded
 * RNG for all dice): advance toward the nearest objective/enemy, shoot the best
 * available target, charge when in range, and fight when engaged. Good enough to
 * pressure-test a list; not a competitive tactician.
 */

function nearestEnemy(e: GameEngine, u: UnitInstance): UnitInstance | undefined {
  let best: UnitInstance | undefined;
  let bd = Infinity;
  for (const en of e.enemiesOf(u.ownerId)) {
    const d = unitGap(u, en);
    if (d < bd) {
      bd = d;
      best = en;
    }
  }
  return best;
}

/** Pick a destination: the closest uncontrolled/contested objective, else the enemy. */
function moveGoal(e: GameEngine, u: UnitInstance): { x: number; y: number } | undefined {
  let best: { x: number; y: number } | undefined;
  let bd = Infinity;
  for (const obj of e.state.objectives) {
    if (obj.controlledBy === u.ownerId) continue; // already ours
    const d = unitGapToPoint(u, obj.position);
    if (d < bd) {
      bd = d;
      best = obj.position;
    }
  }
  if (best) return best;
  const enemy = nearestEnemy(e, u);
  return enemy ? unitCentroid(enemy) : undefined;
}

function playPhase(e: GameEngine): void {
  const phase = e.state.phase;
  const own = e.unitsOf(e.active).filter((u) => e.isAlive(u) && !u.inReserves);

  if (phase === 'movement') {
    for (const u of own) {
      if (e.enemiesOf(u.ownerId).some((en) => inEngagementRange(u, en))) continue;
      const goal = moveGoal(e, u);
      if (!goal) continue;
      const from = unitCentroid(u);
      const dx = goal.x - from.x;
      const dy = goal.y - from.y;
      const d = Math.hypot(dx, dy) || 1;
      const allow = e.moveAllowance(u, 'normal');
      const step = Math.min(allow, Math.max(0, d - 2));
      if (step > 0.05) e.moveUnit(u, 'normal', { x: (dx / d) * step, y: (dy / d) * step });
    }
  } else if (phase === 'shooting') {
    for (const u of own) {
      if (!e.canShoot(u)) continue;
      // Prefer the target we can actually shoot with the most weapons.
      let bestTarget: UnitInstance | undefined;
      let bestWeapons = 0;
      for (const en of e.enemiesOf(e.active)) {
        const n = e.shootableWeapons(u, en).length;
        if (n > bestWeapons) {
          bestWeapons = n;
          bestTarget = en;
        }
      }
      if (bestTarget) e.shoot(u, bestTarget);
    }
  } else if (phase === 'charge') {
    for (const u of own) {
      const targets = e.chargeTargets(u);
      if (targets.length) e.charge(u, targets[0]);
    }
  } else if (phase === 'fight') {
    for (const u of e.fightOrder()) {
      if (u.hasFought || !e.isAlive(u)) continue;
      const enemy = e.enemiesOf(u.ownerId).find((en) => inEngagementRange(u, en) && e.isAlive(en));
      if (enemy) e.fight(u, enemy);
    }
  }
}

/**
 * Play out the active player's entire turn (from wherever it currently is)
 * until control passes back to the opponent. Safe to call at the start of the
 * AI player's command phase.
 */
export function runAiTurn(e: GameEngine): void {
  const me = e.active;
  let guard = 0;
  while (e.active === me && guard < 50) {
    playPhase(e);
    e.advancePhase();
    guard++;
    if (e.winner() !== undefined) break;
  }
}
