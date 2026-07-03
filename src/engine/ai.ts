import type { GameEngine } from './game';
import type { PlayerId, UnitInstance } from './types';
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

/** Candidate deep-strike points: the goal first, then a widening ring search. */
function deepStrikeCandidates(
  goal: { x: number; y: number },
  board: { width: number; height: number },
): Array<{ x: number; y: number }> {
  const out = [goal];
  for (let radius = 4; radius <= 24; radius += 4) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = goal.x + Math.cos(ang) * radius;
      const y = goal.y + Math.sin(ang) * radius;
      if (x > 3 && x < board.width - 3 && y > 3 && y < board.height - 3) out.push({ x, y });
    }
  }
  return out;
}

function playPhase(e: GameEngine): void {
  const phase = e.state.phase;
  const own = e.unitsOf(e.active).filter((u) => e.isAlive(u) && !u.inReserves);

  if (phase === 'movement') {
    // Bring reserves on by Deep Strike (round 2+), aiming near a target
    // objective and searching outward for a legal (>9" from enemies) spot.
    if (e.state.round >= 2) {
      for (const r of e.reservesOf(e.active)) {
        const goal = moveGoal(e, r) ?? { x: e.state.board.width / 2, y: e.state.board.height / 2 };
        // Try the goal, then spiral outward; deepStrikeArrive is a no-op on
        // failure, so the first ok placement wins.
        const candidates = deepStrikeCandidates(goal, e.state.board);
        for (const c of candidates) {
          if (e.deepStrikeArrive(r.id, c).ok) break;
        }
      }
    }
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
      const enemy = e
        .targetableEnemiesOf(u.ownerId)
        .find((en) => inEngagementRange(u, en) && e.isAlive(en));
      if (enemy) e.fight(u, enemy);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Reactive stratagems — how the AI DEFENDS on the human's turn.        *
 * Each is called by the HUD just before the human's action resolves,   *
 * spends the AI's own command points, and returns what it did so the   *
 * UI can toast + play FX. All are no-ops unless the AI both owns the    *
 * defender and can afford / legally use the reaction.                   *
 * ------------------------------------------------------------------ */

/** The player who is NOT the given unit's owner. */
function opponentOf(u: UnitInstance): PlayerId {
  return u.ownerId === 'A' ? 'B' : 'A';
}

/**
 * When a human unit declares a charge, the AI defender may Fire Overwatch at
 * the charging unit with its best-placed shooter (most weapons in range + LoS,
 * not yet used this round). Returns the fired shooter + result message, if any.
 */
export function aiReactToCharge(
  e: GameEngine,
  charger: UnitInstance,
): { fired: boolean; shooterId?: string; message?: string } {
  const defender = opponentOf(charger);
  if (!e.reactiveStratagemsFor(defender).some((s) => s.id === 'fire_overwatch')) return { fired: false };
  let best: UnitInstance | undefined;
  let bestN = 0;
  for (const u of e.unitsOf(defender)) {
    if (!e.onBoard(u) || u.overwatchUsedRound === e.state.round) continue;
    const n = e.shootableWeapons(u, charger).length;
    if (n > bestN) {
      bestN = n;
      best = u;
    }
  }
  if (!best || bestN === 0) return { fired: false };
  const res = e.activateStratagem('fire_overwatch', { unitId: best.id, targetUnitId: charger.id }, defender);
  return { fired: res.ok, shooterId: best.id, message: res.message };
}

/**
 * When a human unit targets an AI unit with shooting, the AI defender may spend
 * a CP on Armour of Contempt (incoming attacks suffer -1 AP) — but only when the
 * incoming fire actually has AP to shave off, so it isn't wasted on bolters.
 */
export function aiReactToShooting(
  e: GameEngine,
  shooter: UnitInstance,
  target: UnitInstance,
): { used: boolean; message?: string } {
  const defender = target.ownerId;
  if (defender === e.active) return { used: false }; // reactions are the defender's only
  if (target.armourOfContempt) return { used: false };
  if (!e.reactiveStratagemsFor(defender).some((s) => s.id === 'armour_of_contempt')) return { used: false };
  const dangerous = shooter.weapons.some((w) => w.kind === 'ranged' && w.ap >= 1);
  if (!dangerous) return { used: false };
  const res = e.activateStratagem('armour_of_contempt', { unitId: target.id }, defender);
  return { used: res.ok, message: res.message };
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

/**
 * Play the AI's CURRENT phase and advance one step. Returns true while it is
 * still the same player's turn — the UI calls this in a loop with a delay and a
 * refresh between calls so the enemy turn is visibly played out, not teleported.
 */
export function aiStep(e: GameEngine): boolean {
  const me = e.active;
  playPhase(e);
  e.advancePhase();
  return e.active === me && e.winner() === undefined;
}
