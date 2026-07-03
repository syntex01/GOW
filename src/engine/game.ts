import type {
  GameState,
  UnitInstance,
  PlayerId,
  Phase,
  Vec2,
  Weapon,
  AbilityEffect,
} from './types';
import { Rng, rollDice } from './dice';
import { resolveWeapon, AttackResult, AttackOptions } from './combat';
import {
  aliveModels,
  dist,
  inEngagementRange,
  unitGap,
  unitCentroid,
  computeObjectiveControl,
  isBelowHalfStrength,
  hasLineOfSight,
  coverState,
  isCoherent,
  ENGAGEMENT_RANGE,
  resolveCollisions,
} from './geometry';
import { CORE_STRATAGEMS, findStratagem, Stratagem } from './stratagems';

const PHASE_ORDER: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight', 'end'];
export const MAX_PRIMARY_VP = 50;

/** A high-level, stateful wrapper around GameState that enforces the turn rules. */
export class GameEngine {
  state: GameState;
  rng: Rng;

  constructor(state: GameState) {
    this.state = state;
    this.rng = new Rng(state.rngSeed);
  }

  // ---------------------------------------------------------------- logging
  log(message: string, detail?: string): void {
    this.state.log.push({
      round: this.state.round,
      phase: this.state.phase,
      player: this.state.activePlayer,
      message,
      ...(detail ? { detail } : {}),
    });
  }

  get active(): PlayerId {
    return this.state.activePlayer;
  }

  unitsOf(player: PlayerId): UnitInstance[] {
    return Object.values(this.state.units).filter((u) => u.ownerId === player);
  }

  enemiesOf(player: PlayerId): UnitInstance[] {
    return Object.values(this.state.units).filter(
      (u) => u.ownerId !== player && aliveModels(u).length > 0 && !u.inReserves,
    );
  }

  /** A unit is destroyed if it has no living models. */
  isAlive(u: UnitInstance): boolean {
    return aliveModels(u).length > 0;
  }

  /** A unit has a board presence if it is alive and not in reserves. */
  onBoard(u: UnitInstance): boolean {
    return !u.inReserves && aliveModels(u).length > 0;
  }

  /**
   * Is `u` currently an attached leader shielded by a living bodyguard? Such a
   * unit cannot be targeted by enemy shooting or charges.
   */
  isProtectedLeader(u: UnitInstance): boolean {
    if (!u.leadingUnitId) return false;
    const bodyguard = this.state.units[u.leadingUnitId];
    return !!bodyguard && this.onBoard(bodyguard);
  }

  /**
   * Enemy units a player may legally target (shooting/charging): on the board
   * and not currently shielded as an attached leader.
   */
  targetableEnemiesOf(player: PlayerId): UnitInstance[] {
    return this.enemiesOf(player).filter((u) => !this.isProtectedLeader(u));
  }

  /**
   * A living attached leader shielded inside `bodyguard`, if any — the legal
   * victim for a Precision attack, which can pick the character out of the unit
   * it is hiding in (this is what makes Epic Challenge / Precision meaningful).
   */
  private attachedLeaderOf(bodyguard: UnitInstance): UnitInstance | undefined {
    for (const id of bodyguard.attachedLeaderIds ?? []) {
      const l = this.state.units[id];
      if (l && this.isAlive(l)) return l;
    }
    return undefined;
  }

  hasEffect(u: UnitInstance, t: AbilityEffect['t']): boolean {
    return u.abilities.some((a) => a.effect?.t === t);
  }

  /** Is `unit` currently benefiting from a called Waaagh! (an Ork unit whose
   *  army called the Waaagh! this battle round)? */
  private waaaghActive(unit: UnitInstance): boolean {
    return (
      unit.keywords.includes('ORKS') &&
      this.state.players[unit.ownerId].waaaghRound === this.state.round
    );
  }

  // ---------------------------------------------------------------- phase flow
  /** Advance to the next phase, wrapping into the next player's turn. */
  advancePhase(): void {
    const idx = PHASE_ORDER.indexOf(this.state.phase);
    if (this.state.phase === 'end') {
      this.scoreEndOfTurn();
      this.scoreSecondaries(); // fixed-mission secondaries, folded into VP
      this.passTurn();
      return;
    }
    const next = PHASE_ORDER[idx + 1];
    this.state.phase = next;
    if (next === 'end') {
      // nothing automatic; scoring happens on leaving 'end'
    }
  }

  private passTurn(): void {
    const wasFirst = this.state.activePlayer === this.state.firstPlayer;
    this.state.activePlayer = this.state.activePlayer === 'A' ? 'B' : 'A';
    if (!wasFirst) this.state.round += 1; // both players have gone -> new battle round
    this.state.phase = 'command';
    this.startCommandPhase();
  }

  /** Set up the very first command phase of the game. */
  startGame(): void {
    this.state.phase = 'command';
    this.startCommandPhase();
  }

  // ---------------------------------------------------------------- command
  startCommandPhase(): void {
    const p = this.state.players[this.active];
    p.commandPoints += 1;
    this.log(`${p.name} gains 1CP (now ${p.commandPoints}).`);

    // Strategic Reserves: any of the active player's units still in reserve at
    // the start of their command phase from battle round 4 onward are destroyed.
    this.destroyOverdueReserves();

    // Reset per-turn secondary tracking for the active player.
    p.enemyUnitsKilledThisTurn = 0;

    // Reset per-turn unit status for the active player.
    for (const u of this.unitsOf(this.active)) {
      u.moveState = 'none';
      u.advanceRoll = 0;
      u.moveBudgetUsed = 0;
      u.hasShot = false;
      u.hasChargedThisTurn = false;
      u.hasFought = false;
      u.fightsNext = false;
      u.epicChallenge = false; // Epic Challenge Precision lasts one turn only
      // Clear transient defensive flags set during the opponent's turn that
      // were meant to last "until your next turn".
      if (u.defensiveFlagRound !== undefined && u.defensiveFlagRound < this.state.round) {
        u.goToGround = false;
        u.smokescreen = false;
        u.armourOfContempt = false;
        u.defensiveFlagRound = undefined;
      }
    }

    // Oath of Moment: if the active player fields any OATH-capable unit, mark one
    // enemy unit as the Oath target for this turn — its attacks against that unit
    // re-roll hits and wounds. With no picker UI we auto-designate the juiciest
    // target (the enemy unit with the most current wounds on the board).
    p.oathTarget = undefined;
    if (this.unitsOf(this.active).some((u) => this.isAlive(u) && this.hasEffect(u, 'oathOfMoment'))) {
      let best: UnitInstance | undefined;
      let bestW = -1;
      for (const e of this.targetableEnemiesOf(this.active)) {
        const w = aliveModels(e).reduce((a, m) => a + m.wounds, 0);
        if (w > bestW) { bestW = w; best = e; }
      }
      if (best) {
        p.oathTarget = best.id;
        this.log(`${p.name} swears the Oath of Moment against ${best.name}.`);
      }
    }

    // Waaagh!: a once-per-game Ork army buff. With no "call the Waaagh!" button
    // we auto-call it from battle round 2 the first time the Orks have a unit
    // within charge threat of an enemy — the natural green-tide timing. For that
    // battle round Ork units gain +1 melee Attack, +1 to Advance/Charge, and a
    // 5+ invulnerable save.
    if (
      !p.waaaghUsed &&
      this.state.round >= 2 &&
      this.unitsOf(this.active).some(
        (u) => this.isAlive(u) && u.keywords.includes('ORKS') && this.enemiesOf(this.active).some((e) => unitGap(u, e) <= 12),
      )
    ) {
      p.waaaghUsed = true;
      p.waaaghRound = this.state.round;
      this.log(`${p.name} calls the WAAAGH! (+1 melee Attack, +1 Advance/Charge, 5+ invuln this round).`);
    }

    // Reanimation-style abilities restore wounds at the start of the turn.
    for (const u of this.unitsOf(this.active)) {
      const eff = u.abilities.find((a) => a.effect?.t === 'reanimation')?.effect;
      if (eff && eff.t === 'reanimation') {
        // Their Number is Legion: re-roll the reanimation dice (take the better).
        const legion = u.abilities.some((a) => /number is legion/i.test(a.name));
        let restored = rollDice('D3', this.rng);
        if (legion) restored = Math.max(restored, rollDice('D3', this.rng));
        this.reanimate(u, restored);
      }
    }

    // Battle-shock tests for units below half strength.
    for (const u of this.unitsOf(this.active)) {
      u.isBattleShocked = false;
      if (isBelowHalfStrength(u) && this.isAlive(u)) {
        // Insane Bravery: auto-pass and consume the one-shot flag.
        if (u.autoPassBattleshock) {
          u.autoPassBattleshock = false;
          this.log(`${u.name} auto-passes its battle-shock test (Insane Bravery).`);
          continue;
        }
        const roll = this.rng.die() + this.rng.die();
        const passed = roll >= u.statline.leadership;
        u.isBattleShocked = !passed;
        this.log(
          `${u.name} battle-shock test: rolled ${roll} vs ${u.statline.leadership}+ — ${
            passed ? 'passed' : 'FAILED (battle-shocked)'
          }.`,
        );
      }
    }
  }

  /**
   * Destroy any of the active player's units still in Strategic Reserves at the
   * start of their command phase once it is too late to arrive. Reserves must be
   * on the board by the end of battle round 3, so from round 4's command phase
   * onward any survivors are slain.
   */
  private destroyOverdueReserves(): void {
    if (this.state.round < 4) return;
    for (const u of this.unitsOf(this.active)) {
      if (u.inReserves && this.isAlive(u)) {
        for (const m of u.models) {
          m.alive = false;
          m.wounds = 0;
        }
        u.inReserves = false; // no longer pending — it is gone for good
        this.log(`${u.name} never arrived from Reserves and is destroyed.`);
      }
    }
  }

  private reanimate(u: UnitInstance, woundsToRestore: number): void {
    // A wholly destroyed unit stays destroyed — reanimation can't raise a unit
    // that has no living models (this also stops an overdue Reserves unit, just
    // slain by destroyOverdueReserves, from coming back as an invisible ghost).
    if (!u.models.some((m) => m.alive)) return;
    let pool = woundsToRestore;
    // First heal a damaged living model, then raise slain models.
    const damaged = u.models.find((m) => m.alive && m.wounds < m.maxWounds);
    if (damaged) {
      const heal = Math.min(pool, damaged.maxWounds - damaged.wounds);
      damaged.wounds += heal;
      pool -= heal;
    }
    while (pool > 0) {
      const dead = u.models.find((m) => !m.alive);
      if (!dead) break;
      if (pool >= dead.maxWounds) {
        dead.alive = true;
        dead.wounds = dead.maxWounds;
        dead.position = this.reviveNear(u);
        pool -= dead.maxWounds;
      } else break; // not enough to fully restore a model
    }
    if (pool < woundsToRestore) this.log(`${u.name} reanimates (restored ${woundsToRestore - pool}W).`);
  }

  private reviveNear(u: UnitInstance): Vec2 {
    const c = unitCentroid(u);
    return { x: c.x + (this.rng.next() - 0.5), y: c.y + (this.rng.next() - 0.5) };
  }

  // ---------------------------------------------------------------- movement
  /** Maximum movement allowance for a unit given a move mode. */
  moveAllowance(u: UnitInstance, mode: 'normal' | 'advance' | 'fallBack'): number {
    if (mode === 'advance') return u.statline.move + u.advanceRoll;
    return u.statline.move;
  }

  /** Roll the Advance die for a unit, storing the bonus. Returns the roll. */
  rollAdvance(u: UnitInstance): number {
    u.advanceRoll = this.rng.die();
    return u.advanceRoll;
  }

  /**
   * Rigidly translate a whole unit by `delta`, validating the move is legal for
   * the chosen mode. Returns false (and does nothing) if illegal.
   */
  /** Mode a unit has committed to this phase (it can't switch mid-phase), or null. */
  private committedMoveMode(u: UnitInstance): 'normal' | 'advance' | 'fallBack' | null {
    return u.moveState === 'advanced'
      ? 'advance'
      : u.moveState === 'fellBack'
        ? 'fallBack'
        : u.moveState === 'normal'
          ? 'normal'
          : null;
  }

  /** Inches of move a unit still has this phase for `mode` (its budget minus spent). */
  remainingMove(u: UnitInstance, mode: 'normal' | 'advance' | 'fallBack' = 'normal'): number {
    if (u.moveState === 'remainedStationary') return 0;
    return Math.max(0, this.moveAllowance(u, mode) - (u.moveBudgetUsed ?? 0));
  }

  moveUnit(
    u: UnitInstance,
    mode: 'normal' | 'advance' | 'fallBack',
    delta: Vec2,
  ): boolean {
    // A unit moves up to its Move characteristic IN TOTAL this phase, optionally
    // across several repositionings. It can't switch move type once committed,
    // and a unit that chose to Remain Stationary doesn't move.
    if (u.moveState === 'remainedStationary') return false;
    const committed = this.committedMoveMode(u);
    if (committed && committed !== mode) return false;

    const firstMove = (u.moveBudgetUsed ?? 0) === 0;
    const remaining = this.moveAllowance(u, mode) - (u.moveBudgetUsed ?? 0);
    const moved = Math.hypot(delta.x, delta.y);
    if (moved > remaining + 1e-6) return false; // would exceed the remaining budget

    const startEngaged = this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e));
    if (mode === 'normal' && startEngaged) return false; // must Fall Back to leave combat

    // Apply.
    for (const m of aliveModels(u)) {
      m.position = { x: m.position.x + delta.x, y: m.position.y + delta.y };
    }

    // Normal/Advance/Fall-Back moves may not end within engagement range.
    const endEngaged = this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e));
    if (endEngaged) {
      for (const m of aliveModels(u)) {
        m.position = { x: m.position.x - delta.x, y: m.position.y - delta.y };
      }
      return false;
    }

    u.moveState = mode === 'advance' ? 'advanced' : mode === 'fallBack' ? 'fellBack' : 'normal';
    u.moveBudgetUsed = (u.moveBudgetUsed ?? 0) + moved;
    this.clampToBoard(u);
    this.settlePositions();
    this.log(
      `${u.name} ${mode === 'fallBack' ? 'falls back' : mode === 'advance' ? 'advances' : 'moves'} ` +
        `${moved.toFixed(1)}".`,
    );
    // Desperate Escape fires once, on the first Fall Back move of a shocked unit.
    if (mode === 'fallBack' && u.isBattleShocked && firstMove) this.desperateEscape(u);
    return true;
  }

  /**
   * Desperate Escape: when a Battle-shocked unit Falls Back, roll one D6 per
   * living model; on a 1 or 2 that model is destroyed. Mutates the unit and
   * logs the result. Returns the number of models lost.
   */
  desperateEscape(u: UnitInstance): number {
    let lost = 0;
    for (const m of aliveModels(u)) {
      const roll = this.rng.die();
      if (roll <= 2) {
        m.wounds = 0;
        m.alive = false;
        lost += 1;
      }
    }
    if (lost > 0) {
      this.log(`${u.name} suffers Desperate Escape: ${lost} model(s) destroyed falling back.`);
      this.cleanupDestroyed();
    }
    return lost;
  }

  remainStationary(u: UnitInstance): void {
    u.moveState = 'remainedStationary';
  }

  private clampToBoard(u: UnitInstance): void {
    for (const m of u.models) {
      m.position.x = Math.max(m.baseRadius, Math.min(this.state.board.width - m.baseRadius, m.position.x));
      m.position.y = Math.max(m.baseRadius, Math.min(this.state.board.height - m.baseRadius, m.position.y));
    }
  }

  /**
   * Settle every model base so none overlaps another base or solid terrain it is
   * too tall to enter. Called after any move so the board never shows clipping
   * figures and the tabletop "bases can't overlap" rule always holds.
   */
  private settlePositions(): void {
    resolveCollisions(this.state.units, this.state.terrain, this.state.board);
  }

  /**
   * Move a single model of a unit to `to`. The move is legal only if (a) the
   * model travels no further than its unit's normal Move allowance, and (b) the
   * unit remains in coherency afterwards. Returns false and changes nothing if
   * either check fails. Complements the rigid whole-unit moveUnit.
   */
  moveModel(unitId: string, modelId: string, to: Vec2): boolean {
    const u = this.state.units[unitId];
    if (!u) return false;
    const m = u.models.find((mm) => mm.id === modelId && mm.alive);
    if (!m) return false;
    const allowance = u.statline.move;
    if (dist(m.position, to) > allowance + 1e-6) return false;
    const from = m.position;
    m.position = { x: to.x, y: to.y };
    if (!isCoherent(u)) {
      m.position = from; // revert
      return false;
    }
    this.clampToBoard(u);
    this.settlePositions();
    return true;
  }

  /**
   * Step each living model of `u` up to `maxInches` straight toward the closest
   * enemy model. Shared by Pile-in and Consolidate. A model never overshoots its
   * target's base (it stops at engagement range). Returns the total distance
   * the unit's models collectively moved.
   */
  private moveTowardClosestEnemy(u: UnitInstance, maxInches: number): number {
    const enemies = this.enemiesOf(u.ownerId);
    let moved = 0;
    for (const m of aliveModels(u)) {
      // Find the closest enemy model centre.
      let target: Vec2 | undefined;
      let bd = Infinity;
      for (const e of enemies) {
        for (const em of aliveModels(e)) {
          const d = dist(m.position, em.position) - m.baseRadius - em.baseRadius;
          if (d < bd) {
            bd = d;
            target = em.position;
          }
        }
      }
      if (!target) break;
      const dx = target.x - m.position.x;
      const dy = target.y - m.position.y;
      const d = Math.hypot(dx, dy) || 1;
      // Don't move past engagement range into the model; leave a small gap.
      const desired = Math.max(0, bd - ENGAGEMENT_RANGE * 0.5);
      const step = Math.min(maxInches, desired);
      if (step <= 1e-6) continue;
      m.position = { x: m.position.x + (dx / d) * step, y: m.position.y + (dy / d) * step };
      moved += step;
    }
    this.clampToBoard(u);
    this.settlePositions();
    return moved;
  }

  /**
   * Pile-in: at the start of a unit's fight, each model may move up to 3" and
   * must end closer to the closest enemy model. Modelled by stepping each model
   * straight toward its nearest enemy. Returns the distance moved.
   */
  pileIn(unitId: string): number {
    const u = this.state.units[unitId];
    if (!u || !this.isAlive(u)) return 0;
    const moved = this.moveTowardClosestEnemy(u, 3);
    if (moved > 1e-6) this.log(`${u.name} piles in.`);
    return moved;
  }

  /**
   * Consolidate: after a unit fights, each model may move up to 3" toward the
   * closest enemy model, ending in engagement range where possible.
   */
  consolidate(unitId: string): number {
    const u = this.state.units[unitId];
    if (!u || !this.isAlive(u)) return 0;
    const moved = this.moveTowardClosestEnemy(u, 3);
    if (moved > 1e-6) this.log(`${u.name} consolidates.`);
    return moved;
  }

  // ---------------------------------------------------------------- shooting
  /** Ranged weapons of a unit that can fire at a given target (range + LoS). */
  shootableWeapons(attacker: UnitInstance, target: UnitInstance): Weapon[] {
    const gap = unitGap(attacker, target);
    const selfEngaged = this.enemiesOf(attacker.ownerId).some((e) => inEngagementRange(attacker, e));
    const los = hasLineOfSight(attacker, target, this.state.terrain);
    return attacker.weapons.filter((w) => {
      if (w.kind !== 'ranged') return false;
      if (gap > w.range) return false;
      // Line of sight is required unless the weapon can fire indirectly.
      if (!los && !w.keywords.some((k) => k.t === 'indirectFire')) return false;
      // While within engagement range, only Pistols may fire (at the engaging unit).
      if (selfEngaged && !w.keywords.some((k) => k.t === 'pistol')) return false;
      // Advancing units may only fire Assault weapons.
      if (attacker.moveState === 'advanced' && !w.keywords.some((k) => k.t === 'assault')) return false;
      // Cannot shoot a target you are not engaged with while engaged with another.
      if (selfEngaged && !inEngagementRange(attacker, target)) return false;
      return true;
    });
  }

  /** Can this unit shoot at all this phase? */
  canShoot(u: UnitInstance): boolean {
    if (u.hasShot) return false;
    if (u.moveState === 'fellBack') return false;
    if (!this.isAlive(u)) return false;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * "Why can't I?" explainers. Each returns a short human-readable     *
   * reason an action is unavailable, or null if it IS available. The   *
   * HUD surfaces these so the player always understands their options. *
   * ------------------------------------------------------------------ */

  /** Why `u` cannot shoot this phase, or null if it can. */
  shootBlockReason(u: UnitInstance): string | null {
    if (!this.isAlive(u)) return 'it is destroyed';
    if (u.hasShot) return `${u.name} already shot this turn`;
    if (u.moveState === 'fellBack') return `${u.name} fell back and cannot shoot`;
    const hasTarget = this.enemiesOf(u.ownerId).some((e) => this.shootableWeapons(u, e).length > 0);
    if (!hasTarget) return `${u.name} has no eligible target (range / line of sight)`;
    return null;
  }

  /** Why `u` cannot declare a charge this phase, or null if it can. */
  chargeBlockReason(u: UnitInstance): string | null {
    if (!this.isAlive(u)) return 'it is destroyed';
    if (u.hasChargedThisTurn) return `${u.name} already charged this turn`;
    if (u.moveState === 'advanced') return `${u.name} advanced and cannot charge`;
    if (u.moveState === 'fellBack') return `${u.name} fell back and cannot charge`;
    if (this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e)))
      return `${u.name} is already in combat`;
    if (this.chargeTargets(u).length === 0) return `no enemy within 12" of ${u.name}`;
    return null;
  }

  /** Why a rigid move of `u` by `delta` in `mode` is illegal, or null if legal. */
  moveBlockReason(u: UnitInstance, mode: 'normal' | 'advance' | 'fallBack', delta: Vec2): string | null {
    if (u.moveState === 'remainedStationary') return `${u.name} chose to stay still this phase`;
    const committed = this.committedMoveMode(u);
    if (committed && committed !== mode)
      return `${u.name} is already making a ${committed === 'fallBack' ? 'Fall Back' : committed} move`;
    const remaining = this.moveAllowance(u, mode) - (u.moveBudgetUsed ?? 0);
    const moved = Math.hypot(delta.x, delta.y);
    if (moved > remaining + 1e-6)
      return remaining < 0.1
        ? `${u.name} has used all its movement this phase`
        : `too far — only ${remaining.toFixed(1)}" of movement left`;
    const startEngaged = this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e));
    if (mode === 'normal' && startEngaged) return 'in combat — use Fall Back to disengage';
    // Simulate the end position (without mutating) to mirror moveUnit's end check.
    const enemies = this.enemiesOf(u.ownerId);
    const endEngaged = aliveModels(u).some((m) => {
      const nx = m.position.x + delta.x;
      const ny = m.position.y + delta.y;
      return enemies.some((e) =>
        aliveModels(e).some(
          (em) =>
            Math.hypot(nx - em.position.x, ny - em.position.y) - m.baseRadius - em.baseRadius <=
            ENGAGEMENT_RANGE + 1e-6,
        ),
      );
    });
    if (endEngaged && mode !== 'fallBack') return 'would end within 1" of an enemy';
    return null;
  }

  /** Resolve all shooting from an attacker into a target. */
  shoot(attacker: UnitInstance, target: UnitInstance, optsByWeapon?: Record<string, AttackOptions>): AttackResult[] {
    // A target shielded as an attached leader (living bodyguard) cannot be shot.
    if (this.isProtectedLeader(target)) {
      this.log(`${attacker.name} cannot target ${target.name}: it is an attached leader (protected).`);
      return [];
    }
    const weapons = this.shootableWeapons(attacker, target);
    // Command Re-roll: consume a one-shot single-die hit re-roll for this attack.
    const rerollFlag = attacker.pendingRerollHits;
    const results: AttackResult[] = [];
    for (const w of weapons) {
      // Precision: a weapon with Precision may snipe the attached leader out of
      // the bodyguard unit; everything else strikes the bodyguard as normal.
      const leader = w.keywords.some((k) => k.t === 'precision')
        ? this.attachedLeaderOf(target)
        : undefined;
      const tgt = leader ?? target;
      if (leader) this.log(`${attacker.name}'s ${w.name} takes a Precision shot at ${leader.name}.`);
      // Cover recomputed against the actual victim — DIRECTIONALLY (a model only
      // benefits from cover relative to THIS shooter's line, not from every
      // angle). Go to Ground / Smokescreen still grant cover from any direction.
      const cover =
        coverState(attacker, tgt, this.state.terrain) !== 'none' || !!tgt.goToGround || !!tgt.smokescreen;
      // Best (lowest) transient invuln: 6+ from Go to Ground/Smokescreen, 5+ from
      // a called Waaagh! on an Ork target — take the better of the two.
      const transientInvulns = [
        tgt.goToGround || tgt.smokescreen ? 6 : undefined,
        this.waaaghActive(tgt) ? 5 : undefined,
      ].filter((v): v is number => v !== undefined);
      const bonusInvuln = transientInvulns.length ? Math.min(...transientInvulns) : undefined;
      const halfRange = unitGap(attacker, tgt) <= w.range / 2;
      const ignoresCover = w.keywords.some((k) => k.t === 'ignoresCover');
      // Heavy: +1 to hit if the firing unit Remained Stationary this turn.
      const heavyBonus =
        w.keywords.some((k) => k.t === 'heavy') &&
        (attacker.moveState === 'none' || attacker.moveState === 'remainedStationary')
          ? 1
          : 0;
      const opts: AttackOptions = {
        halfRange,
        cover: (cover && !ignoresCover) || false,
        firingModels: aliveModels(attacker).length,
        ...(heavyBonus ? { hitModifier: heavyBonus } : {}),
        ...(bonusInvuln !== undefined ? { bonusInvuln } : {}),
        ...(tgt.armourOfContempt ? { apReduction: 1 } : {}),
        ...this.attackerAbilityMods(attacker, 'shooting', tgt),
        ...(rerollFlag ? { rerollOneHit: true } : {}),
        ...(optsByWeapon?.[w.id] ?? {}),
      };
      const res = resolveWeapon(w, attacker, tgt, this.rng, opts);
      results.push(res);
      for (const line of res.log) this.log(line);
    }
    if (rerollFlag) attacker.pendingRerollHits = false;
    attacker.hasShot = true;
    this.cleanupDestroyed();
    return results;
  }

  private attackerAbilityMods(u: UnitInstance, _phase: 'shooting' | 'fight', target?: UnitInstance): Partial<AttackOptions> {
    const mods: Partial<AttackOptions> = {};
    // A unit's own abilities plus those conferred by any attached leaders.
    const conferred = (u.attachedLeaderIds ?? [])
      .map((id) => this.state.units[id])
      .filter((l): l is UnitInstance => !!l && this.isAlive(l))
      .flatMap((l) => l.abilities);
    const abilities = [...u.abilities, ...conferred];
    const reroll = abilities.find((a) => a.effect?.t === 'reroll')?.effect;
    if (reroll && reroll.t === 'reroll') {
      if (reroll.phase === 'hit') mods.rerollHits = reroll.scope === 'all' ? 'all' : 'ones';
      if (reroll.phase === 'wound') mods.rerollWounds = reroll.scope === 'all' ? 'all' : 'ones';
    }
    // Oath of Moment: an OATH-capable unit re-rolls all hits AND wounds against
    // the enemy unit its army swore the Oath against this turn.
    if (
      target &&
      abilities.some((a) => a.effect?.t === 'oathOfMoment') &&
      this.state.players[u.ownerId].oathTarget === target.id
    ) {
      mods.rerollHits = 'all';
      mods.rerollWounds = 'all';
    }
    // Dark Pacts: a one-shot Lethal Hits granted this turn, consumed on use.
    if (u.lethalHitsNext) {
      mods.grantLethalHits = true;
      u.lethalHitsNext = false;
    }
    return mods;
  }

  // ---------------------------------------------------------------- charge
  /** Enemy units within 12" that this unit could attempt to charge. */
  chargeTargets(u: UnitInstance): UnitInstance[] {
    if (u.moveState === 'advanced' || u.moveState === 'fellBack') return [];
    if (this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e))) return [];
    return this.targetableEnemiesOf(u.ownerId).filter((e) => unitGap(u, e) <= 12);
  }

  rollCharge(): number {
    return this.rng.die() + this.rng.die();
  }

  /**
   * Attempt to charge `target` with `u`. Rolls 2D6; if the roll is enough to
   * bring the unit into engagement range, the unit is moved straight in.
   */
  charge(u: UnitInstance, target: UnitInstance): { roll: number; success: boolean } {
    // Waaagh! adds +1 to the charge distance for Ork units the turn it is called.
    const roll = this.rollCharge() + (this.waaaghActive(u) ? 1 : 0);
    const gap = unitGap(u, target);
    const needed = Math.max(0, gap - ENGAGEMENT_RANGE);
    if (roll + 1e-6 >= needed) {
      // Move straight toward the target's nearest point by `needed`.
      const from = unitCentroid(u);
      const to = unitCentroid(target);
      const d = dist(from, to) || 1;
      const step = Math.min(roll, gap - ENGAGEMENT_RANGE + 0.5);
      const delta = { x: ((to.x - from.x) / d) * step, y: ((to.y - from.y) / d) * step };
      for (const m of aliveModels(u)) m.position = { x: m.position.x + delta.x, y: m.position.y + delta.y };
      u.hasChargedThisTurn = true;
      this.clampToBoard(u);
      this.log(`${u.name} charges ${target.name}: rolled ${roll}, needed ${needed.toFixed(1)}" — success!`);
      return { roll, success: true };
    }
    this.log(`${u.name} charges ${target.name}: rolled ${roll}, needed ${needed.toFixed(1)}" — failed.`);
    return { roll, success: false };
  }

  // ---------------------------------------------------------------- fight
  /** Units eligible to fight: in engagement range and not yet fought. */
  canFight(u: UnitInstance, target: UnitInstance): boolean {
    return (
      this.isAlive(u) &&
      this.isAlive(target) &&
      !this.isProtectedLeader(target) &&
      inEngagementRange(u, target) &&
      !u.hasFought
    );
  }

  /** Resolve melee from attacker into target. */
  fight(attacker: UnitInstance, target: UnitInstance): AttackResult[] {
    // A leader shielded by a living bodyguard can't be singled out in melee,
    // exactly as in shooting — attacks must go to the bodyguard unit.
    if (this.isProtectedLeader(target)) {
      this.log(`Cannot target ${target.name} in melee — it is protected by its bodyguard.`);
      return [];
    }
    // Pile in (up to 3" toward the closest enemy) at the start of this unit's
    // activation, before its blows land — a core part of every Fight activation.
    this.pileIn(attacker.id);
    const weapons = attacker.weapons.filter((w) => w.kind === 'melee');
    const rerollFlag = attacker.pendingRerollHits;
    const results: AttackResult[] = [];
    for (const w of weapons) {
      // Precision (printed, or granted this turn by Epic Challenge) lets these
      // blows strike the attached leader directly instead of the bodyguard.
      const hasPrecision = w.keywords.some((k) => k.t === 'precision') || !!attacker.epicChallenge;
      const leader = hasPrecision ? this.attachedLeaderOf(target) : undefined;
      const tgt = leader ?? target;
      if (leader) this.log(`${attacker.name}'s ${w.name} strikes the attached ${leader.name} (Precision).`);
      // Lance: +1 to wound if this unit made a Charge move this turn.
      const lanceBonus = w.keywords.some((k) => k.t === 'lance') && attacker.hasChargedThisTurn ? 1 : 0;
      // Waaagh!: +1 melee attack per model; a Waaagh!-benefiting defender has a 5+ invuln.
      const waaaghAtk = this.waaaghActive(attacker) ? 1 : 0;
      const defInvuln = this.waaaghActive(tgt) ? 5 : undefined;
      const opts: AttackOptions = {
        firingModels: aliveModels(attacker).length,
        ...(lanceBonus ? { woundModifier: lanceBonus } : {}),
        ...(waaaghAtk ? { bonusAttacks: waaaghAtk } : {}),
        ...(defInvuln !== undefined ? { bonusInvuln: defInvuln } : {}),
        ...(tgt.armourOfContempt ? { apReduction: 1 } : {}),
        ...this.attackerAbilityMods(attacker, 'fight', tgt),
        ...(rerollFlag ? { rerollOneHit: true } : {}),
      };
      const res = resolveWeapon(w, attacker, tgt, this.rng, opts);
      results.push(res);
      for (const line of res.log) this.log(line);
    }
    if (rerollFlag) attacker.pendingRerollHits = false;
    attacker.hasFought = true;
    attacker.fightsNext = false; // consumed
    this.cleanupDestroyed();
    // Consolidate (up to 3" toward the closest enemy) at the end of the
    // activation, so a unit that fought closes the gap or grabs an objective.
    this.consolidate(attacker.id);
    return results;
  }

  /**
   * Order units for the Fight phase, faithful to 10th-edition alternating
   * activation:
   *   1. Counter-offensive (a unit flagged to fight next) jumps to the front.
   *   2. The "Fights First" step — units that charged this turn or have the
   *      Fights First ability — resolves before any other unit.
   *   3. The remaining engaged units resolve last.
   * Within each step the two players ALTERNATE selecting a unit, beginning with
   * the player whose turn is taking place, so the defender interleaves its
   * blows rather than watching the whole enemy line strike unanswered.
   */
  fightOrder(): UnitInstance[] {
    const all = Object.values(this.state.units).filter((u) => this.isAlive(u));
    const engaged = all.filter((u) => this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e)));
    const counter = engaged.filter((u) => u.fightsNext);
    const first = engaged.filter(
      (u) => !u.fightsNext && (u.hasChargedThisTurn || this.hasEffect(u, 'fightsFirst')),
    );
    const rest = engaged.filter((u) => !u.fightsNext && !first.includes(u));
    // Interleave a step's units by player, active side first.
    const interleave = (units: UnitInstance[]): UnitInstance[] => {
      const mine = units.filter((u) => u.ownerId === this.active);
      const theirs = units.filter((u) => u.ownerId !== this.active);
      const out: UnitInstance[] = [];
      for (let i = 0; i < Math.max(mine.length, theirs.length); i++) {
        if (i < mine.length) out.push(mine[i]);
        if (i < theirs.length) out.push(theirs[i]);
      }
      return out;
    };
    return [...counter, ...interleave(first), ...interleave(rest)];
  }

  // ---------------------------------------------------------------- scoring
  scoreEndOfTurn(): void {
    computeObjectiveControl(this.state.objectives, this.state.units);
    const held = this.state.objectives.filter((o) => o.controlledBy === this.active).length;
    const vp = Math.min(held, 3) * 5; // up to 15 primary VP per turn
    const p = this.state.players[this.active];
    p.victoryPoints = Math.min(MAX_PRIMARY_VP, p.victoryPoints + vp);
    if (vp > 0) this.log(`${p.name} scores ${vp}VP (holds ${held} objective(s)). Total ${p.victoryPoints}.`);
  }

  /**
   * Score two generic secondary objectives for the active player and fold the
   * result into their victory points (tracked separately in
   * secondaryVictoryPoints). Additive to scoreEndOfTurn: callers invoke this
   * explicitly (e.g. in the end phase) so primary-only scoring stays unchanged.
   *   - "Take and Hold": +5VP if the active player controls more objectives
   *     than the enemy this turn.
   *   - "Bring It Down": +5VP if the active player destroyed at least one enemy
   *     unit this turn (capped contribution, generic).
   * Returns the secondary VP awarded this call.
   */
  scoreSecondaries(): number {
    computeObjectiveControl(this.state.objectives, this.state.units);
    const p = this.state.players[this.active];
    const enemy: PlayerId = this.active === 'A' ? 'B' : 'A';
    const mine = this.state.objectives.filter((o) => o.controlledBy === this.active).length;
    const theirs = this.state.objectives.filter((o) => o.controlledBy === enemy).length;
    let secondary = 0;
    if (mine > theirs) {
      secondary += 5;
      this.log(`${p.name} scores 5VP — Take and Hold (holds ${mine} vs ${theirs}).`);
    }
    if ((p.enemyUnitsKilledThisTurn ?? 0) > 0) {
      secondary += 5;
      this.log(`${p.name} scores 5VP — Bring It Down (destroyed an enemy unit this turn).`);
    }
    if (secondary > 0) {
      p.secondaryVictoryPoints = (p.secondaryVictoryPoints ?? 0) + secondary;
      p.victoryPoints += secondary;
    }
    return secondary;
  }

  private cleanupDestroyed(): void {
    for (const u of Object.values(this.state.units)) {
      if (!this.isAlive(u) && !u.inReserves && !u.deathCredited) {
        // Credit the kill to the enemy of the destroyed unit's owner (the active
        // attacker), for "kill a unit this turn"-style secondaries.
        u.deathCredited = true;
        const killer = u.ownerId === 'A' ? 'B' : 'A';
        const ks = this.state.players[killer];
        ks.enemyUnitsKilledThisTurn = (ks.enemyUnitsKilledThisTurn ?? 0) + 1;
      }
    }
    computeObjectiveControl(this.state.objectives, this.state.units);
  }

  // ---------------------------------------------------------------- stratagems
  /**
   * Core stratagems the active player could use right now: gated by the current
   * phase, by turn ownership ('your-turn'/'opponents-turn'/'either'), and by
   * affordability against the active player's command points.
   */
  availableStratagems(): Stratagem[] {
    const phase = this.state.phase;
    const cp = this.state.players[this.active].commandPoints;
    const isYourTurn = true; // `active` is, by definition, the acting player
    return CORE_STRATAGEMS.filter((s) => {
      if (s.cost > cp) return false;
      if (s.phase !== 'any' && s.phase !== phase) return false;
      if (s.when === 'your-turn' && !isYourTurn) return false;
      // 'opponents-turn' stratagems are reactions; the engine exposes them to
      // the acting player too (single-controller model), so we don't block them.
      return true;
    });
  }

  /**
   * Reactive stratagems the DEFENDING player (`defender`, the one whose turn it
   * is NOT) may use right now: gated by the current phase and to stratagems that
   * are legal on the opponent's turn ('opponents-turn' or 'either'), and by the
   * defender's own command points. This is what powers reactions on the active
   * player's turn (Fire Overwatch, Armour of Contempt, Go to Ground, …).
   */
  reactiveStratagemsFor(defender: PlayerId): Stratagem[] {
    if (defender === this.active) return []; // reactions belong to the non-active side
    const phase = this.state.phase;
    const cp = this.state.players[defender].commandPoints;
    return CORE_STRATAGEMS.filter((s) => {
      if (s.when === 'your-turn') return false; // not a reaction
      if (s.cost > cp) return false;
      if (s.phase !== 'any' && s.phase !== phase) return false;
      return true;
    });
  }

  /**
   * Spend command points and apply a stratagem's effect. Returns ok:false with a
   * message if it cannot be used (unknown id, wrong phase, or not enough CP).
   * `ctx.unitId` is the affected friendly unit; `ctx.targetUnitId` an enemy.
   *
   * `actingPlayer` is who pays and gets the effect; it defaults to the active
   * player but a REACTION passes the defending player so the correct side's CP
   * is spent during the opponent's turn.
   */
  activateStratagem(
    id: string,
    ctx?: { unitId?: string; targetUnitId?: string },
    actingPlayer: PlayerId = this.active,
  ): { ok: boolean; message: string } {
    const strat = findStratagem(id);
    if (!strat) return { ok: false, message: `Unknown stratagem: ${id}` };
    const player = this.state.players[actingPlayer];
    if (strat.cost > player.commandPoints) {
      return { ok: false, message: `${strat.name} costs ${strat.cost}CP; only ${player.commandPoints} available.` };
    }
    if (strat.phase !== 'any' && strat.phase !== this.state.phase) {
      return { ok: false, message: `${strat.name} cannot be used in the ${this.state.phase} phase.` };
    }

    const unit = ctx?.unitId ? this.state.units[ctx.unitId] : undefined;
    const target = ctx?.targetUnitId ? this.state.units[ctx.targetUnitId] : undefined;

    const spend = (): void => {
      player.commandPoints -= strat.cost;
      this.log(`${player.name} uses ${strat.name} (-${strat.cost}CP, now ${player.commandPoints}).`);
    };

    switch (strat.id) {
      case 'command_reroll': {
        if (!unit) return { ok: false, message: 'Command Re-roll needs a unit (ctx.unitId).' };
        spend();
        unit.pendingRerollHits = true;
        return { ok: true, message: `${unit.name} will re-roll one failed hit on its next attack.` };
      }
      case 'insane_bravery': {
        if (!unit) return { ok: false, message: 'Insane Bravery needs a unit (ctx.unitId).' };
        spend();
        unit.autoPassBattleshock = true;
        return { ok: true, message: `${unit.name} will auto-pass its next battle-shock test.` };
      }
      case 'go_to_ground': {
        if (!unit) return { ok: false, message: 'Go to Ground needs a unit (ctx.unitId).' };
        if (!unit.keywords.includes('INFANTRY')) {
          return { ok: false, message: 'Go to Ground may only be used on an INFANTRY unit.' };
        }
        spend();
        unit.goToGround = true;
        unit.defensiveFlagRound = this.state.round;
        return { ok: true, message: `${unit.name} goes to ground (cover + 6+ invuln).` };
      }
      case 'smokescreen': {
        if (!unit) return { ok: false, message: 'Smokescreen needs a unit (ctx.unitId).' };
        spend();
        unit.smokescreen = true;
        unit.defensiveFlagRound = this.state.round;
        return { ok: true, message: `${unit.name} deploys a smokescreen (cover + 6+ invuln vs shooting).` };
      }
      case 'counter_offensive': {
        if (!unit) return { ok: false, message: 'Counter-offensive needs a unit (ctx.unitId).' };
        if (unit.hasFought) return { ok: false, message: `${unit.name} has already fought.` };
        spend();
        unit.fightsNext = true;
        return { ok: true, message: `${unit.name} will fight next (out of sequence).` };
      }
      case 'fire_overwatch': {
        if (!unit || !target) {
          return { ok: false, message: 'Fire Overwatch needs ctx.unitId and ctx.targetUnitId.' };
        }
        if (unit.overwatchUsedRound === this.state.round) {
          return { ok: false, message: `${unit.name} has already fired Overwatch this round.` };
        }
        spend();
        const res = this.overwatch(unit.id, target.id);
        return { ok: res.ok, message: res.message };
      }
      case 'grenade': {
        if (!unit || !target) {
          return { ok: false, message: 'Grenade needs ctx.unitId and ctx.targetUnitId.' };
        }
        if (!unit.keywords.includes('GRENADES')) {
          return { ok: false, message: `${unit.name} lacks the GRENADES keyword.` };
        }
        if (unitGap(unit, target) > 8) {
          return { ok: false, message: `${target.name} is out of grenade range (8").` };
        }
        spend();
        const hits = this.rng.die();
        let inflicted = 0;
        for (let i = 0; i < hits; i++) {
          // S6 vs target toughness, treated as direct damage past armour (D1).
          const woundRoll = this.rng.die();
          if (woundRoll !== 1 && woundRoll >= 4) {
            const m = aliveModels(target)[0];
            if (m) {
              m.wounds -= 1;
              if (m.wounds <= 0) { m.wounds = 0; m.alive = false; }
              inflicted += 1;
            }
          }
        }
        this.cleanupDestroyed();
        return { ok: true, message: `${unit.name} throws grenades at ${target.name}: ${inflicted} wound(s).` };
      }
      case 'armour_of_contempt': {
        if (!unit) return { ok: false, message: 'Armour of Contempt needs a unit (ctx.unitId).' };
        spend();
        unit.armourOfContempt = true;
        unit.defensiveFlagRound = this.state.round;
        return { ok: true, message: `${unit.name} gains Armour of Contempt (-1 AP to incoming attacks).` };
      }
      case 'rapid_ingress': {
        if (!unit) return { ok: false, message: 'Rapid Ingress needs a unit (ctx.unitId).' };
        if (!unit.inReserves) return { ok: false, message: `${unit.name} is not in Reserves.` };
        spend();
        // Place near the unit's stored target or, failing that, the board centre;
        // deepStrikeArrive enforces the >9"-from-enemies and on-board rules.
        const at = ctx?.targetUnitId
          ? unitCentroid(this.state.units[ctx.targetUnitId])
          : { x: this.state.board.width / 2, y: this.state.board.height / 2 };
        const res = this.deepStrikeArrive(unit.id, at);
        if (res.ok) unit.rapidIngressRound = this.state.round;
        return { ok: res.ok, message: res.message };
      }
      case 'epic_challenge': {
        if (!unit) return { ok: false, message: 'Epic Challenge needs a unit (ctx.unitId).' };
        if (!unit.isCharacter) return { ok: false, message: `${unit.name} is not a Character.` };
        spend();
        // Grant Precision to the Character's melee attacks for THIS turn only (a
        // transient flag honoured by fight(), cleared next Command phase) — no
        // longer permanently mutating the weapon (which leaked Precision forever).
        unit.epicChallenge = true;
        return { ok: true, message: `${unit.name} issues an Epic Challenge (melee gains Precision this turn).` };
      }
      case 'dark_pact': {
        if (!unit) return { ok: false, message: 'Dark Pact needs a unit (ctx.unitId).' };
        if (!unit.keywords.includes('CHAOS')) {
          return { ok: false, message: `${unit.name} cannot swear a Dark Pact (not CHAOS).` };
        }
        spend();
        const roll = this.rng.die() + this.rng.die();
        if (roll >= unit.statline.leadership) {
          unit.lethalHitsNext = true;
          return { ok: true, message: `${unit.name} swears a Dark Pact (rolled ${roll}): Lethal Hits on its next attack.` };
        }
        const mortals = rollDice('D3', this.rng);
        this.applyMortalWounds(unit, mortals);
        return { ok: true, message: `${unit.name}'s Dark Pact backfires (rolled ${roll}): suffers ${mortals} mortal wounds.` };
      }
      case 'heroic_intervention':
      case 'tank_shock': {
        // Listed for completeness; the engine has no faithful hook for these, so
        // they spend CP and log intent only (documented no-ops).
        spend();
        return { ok: true, message: `${strat.name} declared (no mechanical effect in this engine).` };
      }
      default:
        return { ok: false, message: `${strat.name} is not implemented.` };
    }
  }

  /**
   * Fire Overwatch: `shooter` shoots `target` reactively. Hits land only on
   * unmodified 6s, modelled by forcing every weapon's hit skill to 6 and
   * stripping hit modifiers/hit re-rolls for this volley. Resolves like normal
   * shooting (range + line of sight still required) but does not set hasShot.
   */
  overwatch(shooterId: string, targetId: string): { ok: boolean; message: string } {
    const shooter = this.state.units[shooterId];
    const target = this.state.units[targetId];
    if (!shooter || !target) return { ok: false, message: 'Overwatch: unknown shooter or target.' };
    if (!this.onBoard(shooter)) return { ok: false, message: `${shooter?.name ?? 'Unit'} cannot fire Overwatch (off-board/destroyed).` };
    if (!this.onBoard(target) || this.isProtectedLeader(target)) {
      return { ok: false, message: `${target.name} is not a legal Overwatch target.` };
    }
    if (shooter.overwatchUsedRound === this.state.round) {
      return { ok: false, message: `${shooter.name} has already fired Overwatch this round.` };
    }
    const weapons = this.shootableWeapons(shooter, target);
    if (weapons.length === 0) return { ok: false, message: `${shooter.name} has no weapon that can reach ${target.name}.` };
    const cover = coverState(shooter, target, this.state.terrain) !== 'none' || !!target.goToGround || !!target.smokescreen;
    let slain = 0;
    for (const w of weapons) {
      // Force "hit only on unmodified 6": clone the weapon with skill 6 and no
      // sustained/lethal benefit from the modifier path; re-rolls are omitted.
      const ow: typeof w = { ...w, skill: 6 };
      const opts: AttackOptions = {
        halfRange: unitGap(shooter, target) <= w.range / 2,
        cover: cover && !w.keywords.some((k) => k.t === 'ignoresCover'),
        firingModels: aliveModels(shooter).length,
        ...(target.goToGround || target.smokescreen ? { bonusInvuln: 6 } : {}),
      };
      const res = resolveWeapon(ow, shooter, target, this.rng, opts);
      slain += res.modelsSlain;
      for (const line of res.log) this.log(line);
    }
    shooter.overwatchUsedRound = this.state.round;
    this.cleanupDestroyed();
    return { ok: true, message: `${shooter.name} fires Overwatch at ${target.name}: ${slain} model(s) slain.` };
  }

  // ---------------------------------------------------------------- reserves
  /** Units of `player` currently held in Strategic Reserves / Deep Strike. */
  reservesOf(player: PlayerId): UnitInstance[] {
    return this.unitsOf(player).filter((u) => u.inReserves && this.isAlive(u));
  }

  /**
   * Bring a reserve unit onto the board around `at` via Deep Strike. Legal only
   * from battle round 2 onward and only if every model can be placed on the
   * board and more than 9" from all enemy models. On success the unit's models
   * are arranged around `at`, inReserves is cleared, and the unit counts as
   * having moved (so it cannot also make a normal move). Returns ok:false with a
   * reason otherwise without changing anything.
   */
  deepStrikeArrive(unitId: string, at: Vec2): { ok: boolean; message: string } {
    const u = this.state.units[unitId];
    if (!u) return { ok: false, message: `Unknown unit: ${unitId}` };
    if (!u.inReserves) return { ok: false, message: `${u.name} is not in reserves.` };
    if (this.state.round < 2) {
      return { ok: false, message: 'Reserves cannot arrive during battle round 1.' };
    }

    // Lay the models out in the same grid pattern factory uses, around `at`.
    const radius = u.models[0]?.baseRadius ?? 0.6;
    const spacing = radius * 2 + 0.4;
    const n = u.models.length;
    const perRow = Math.max(1, Math.ceil(Math.sqrt(n)));
    const positions: Vec2[] = u.models.map((_, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      return {
        x: at.x + (col - (perRow - 1) / 2) * spacing,
        y: at.y + row * spacing,
      };
    });

    // Every model must be on the board (inside the base radius) ...
    const { width, height } = this.state.board;
    for (const p of positions) {
      if (p.x < radius || p.x > width - radius || p.y < radius || p.y > height - radius) {
        return { ok: false, message: `${u.name} cannot deep strike there: a model would be off the board.` };
      }
    }
    // ... and more than 9" from every enemy model (edge-to-edge).
    const enemies = this.enemiesOf(u.ownerId);
    for (const p of positions) {
      for (const e of enemies) {
        for (const em of aliveModels(e)) {
          const gap = dist(p, em.position) - radius - em.baseRadius;
          if (gap <= 9 + 1e-6) {
            return { ok: false, message: `${u.name} cannot deep strike there: within 9" of ${e.name}.` };
          }
        }
      }
    }

    // Place the unit.
    u.models.forEach((m, i) => {
      m.position = positions[i];
    });
    u.inReserves = false;
    u.moveState = 'normal';
    // Keep any attached leader in step (it shares the bodyguard's presence).
    for (const leaderId of u.attachedLeaderIds) {
      const leader = this.state.units[leaderId];
      if (leader) leader.inReserves = false;
    }
    this.log(`${u.name} arrives from Deep Strike at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}).`);
    return { ok: true, message: `${u.name} arrives from Deep Strike.` };
  }

  /**
   * Declare a unit into Strategic Reserves (testing aid: normally set at
   * deployment). Allowed only during battle round 1. The unit and any attached
   * leader leave the table; they must arrive by Deep Strike from round 2.
   */
  sendToReserves(unitId: string): { ok: boolean; message: string } {
    const u = this.state.units[unitId];
    if (!u) return { ok: false, message: `Unknown unit: ${unitId}` };
    if (this.state.round > 1) {
      return { ok: false, message: 'Reserves can only be declared in battle round 1.' };
    }
    u.inReserves = true;
    u.deepStrike = true;
    for (const leaderId of u.attachedLeaderIds) {
      const leader = this.state.units[leaderId];
      if (leader) {
        leader.inReserves = true;
        leader.deepStrike = true;
      }
    }
    this.log(`${u.name} is placed into Strategic Reserves.`);
    return { ok: true, message: `${u.name} held in Reserves; deep strike from round 2.` };
  }

  /**
   * Apply `amount` mortal wounds to a unit: lost one wound at a time across
   * models (Feel No Pain still applies per wound), removing slain models.
   */
  applyMortalWounds(u: UnitInstance, amount: number): void {
    const fnp = u.statline.feelNoPain;
    let remaining = amount;
    while (remaining > 0) {
      if (fnp !== undefined && this.rng.die() >= fnp) {
        remaining -= 1;
        continue; // shrugged off
      }
      const m = u.models.find((mm) => mm.alive);
      if (!m) break;
      m.wounds -= 1;
      if (m.wounds <= 0) {
        m.wounds = 0;
        m.alive = false;
      }
      remaining -= 1;
    }
    this.cleanupDestroyed();
  }

  // ---------------------------------------------------------------- win check
  winner(): PlayerId | 'draw' | undefined {
    const aAlive = this.unitsOf('A').some((u) => this.isAlive(u));
    const bAlive = this.unitsOf('B').some((u) => this.isAlive(u));
    if (!aAlive && !bAlive) return 'draw';
    if (!aAlive) return 'B';
    if (!bAlive) return 'A';
    if (this.state.round > 5) {
      const a = this.state.players.A.victoryPoints;
      const b = this.state.players.B.victoryPoints;
      return a === b ? 'draw' : a > b ? 'A' : 'B';
    }
    return undefined;
  }
}
