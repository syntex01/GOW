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
  ENGAGEMENT_RANGE,
} from './geometry';

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
      (u) => u.ownerId !== player && aliveModels(u).length > 0,
    );
  }

  /** A unit is destroyed if it has no living models. */
  isAlive(u: UnitInstance): boolean {
    return aliveModels(u).length > 0;
  }

  hasEffect(u: UnitInstance, t: AbilityEffect['t']): boolean {
    return u.abilities.some((a) => a.effect?.t === t);
  }

  // ---------------------------------------------------------------- phase flow
  /** Advance to the next phase, wrapping into the next player's turn. */
  advancePhase(): void {
    const idx = PHASE_ORDER.indexOf(this.state.phase);
    if (this.state.phase === 'end') {
      this.scoreEndOfTurn();
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

    // Reset per-turn unit status for the active player.
    for (const u of this.unitsOf(this.active)) {
      u.moveState = 'none';
      u.advanceRoll = 0;
      u.hasShot = false;
      u.hasChargedThisTurn = false;
      u.hasFought = false;
    }

    // Reanimation-style abilities restore wounds at the start of the turn.
    for (const u of this.unitsOf(this.active)) {
      const eff = u.abilities.find((a) => a.effect?.t === 'reanimation')?.effect;
      if (eff && eff.t === 'reanimation') this.reanimate(u, rollDice('D3', this.rng));
    }

    // Battle-shock tests for units below half strength.
    for (const u of this.unitsOf(this.active)) {
      u.isBattleShocked = false;
      if (isBelowHalfStrength(u) && this.isAlive(u)) {
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

  private reanimate(u: UnitInstance, woundsToRestore: number): void {
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
  moveUnit(
    u: UnitInstance,
    mode: 'normal' | 'advance' | 'fallBack',
    delta: Vec2,
  ): boolean {
    const allowance = this.moveAllowance(u, mode);
    const moved = Math.hypot(delta.x, delta.y);
    if (moved > allowance + 1e-6) return false;

    const startEngaged = this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e));
    if (mode === 'normal' && startEngaged) return false; // must Fall Back to leave combat

    // Apply.
    for (const m of aliveModels(u)) {
      m.position = { x: m.position.x + delta.x, y: m.position.y + delta.y };
    }

    // Normal/Advance moves may not end within engagement range of the enemy.
    const endEngaged = this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e));
    if ((mode === 'normal' || mode === 'advance' || mode === 'fallBack') && endEngaged) {
      // revert
      for (const m of aliveModels(u)) {
        m.position = { x: m.position.x - delta.x, y: m.position.y - delta.y };
      }
      return false;
    }

    u.moveState = mode === 'advance' ? 'advanced' : mode === 'fallBack' ? 'fellBack' : 'normal';
    this.clampToBoard(u);
    this.log(
      `${u.name} ${mode === 'fallBack' ? 'falls back' : mode === 'advance' ? 'advances' : 'moves'} ` +
        `${moved.toFixed(1)}".`,
    );
    return true;
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

  // ---------------------------------------------------------------- shooting
  /** Ranged weapons of a unit that can fire at a given target (range + LoS). */
  shootableWeapons(attacker: UnitInstance, target: UnitInstance): Weapon[] {
    const gap = unitGap(attacker, target);
    const selfEngaged = this.enemiesOf(attacker.ownerId).some((e) => inEngagementRange(attacker, e));
    return attacker.weapons.filter((w) => {
      if (w.kind !== 'ranged') return false;
      if (gap > w.range) return false;
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

  /** Resolve all shooting from an attacker into a target. */
  shoot(attacker: UnitInstance, target: UnitInstance, optsByWeapon?: Record<string, AttackOptions>): AttackResult[] {
    const weapons = this.shootableWeapons(attacker, target);
    const results: AttackResult[] = [];
    for (const w of weapons) {
      const halfRange = unitGap(attacker, target) <= w.range / 2;
      const opts: AttackOptions = {
        halfRange,
        firingModels: aliveModels(attacker).length,
        ...this.attackerAbilityMods(attacker, 'shooting'),
        ...(optsByWeapon?.[w.id] ?? {}),
      };
      const res = resolveWeapon(w, attacker, target, this.rng, opts);
      results.push(res);
      for (const line of res.log) this.log(line);
    }
    attacker.hasShot = true;
    this.cleanupDestroyed();
    return results;
  }

  private attackerAbilityMods(u: UnitInstance, _phase: 'shooting' | 'fight'): Partial<AttackOptions> {
    const mods: Partial<AttackOptions> = {};
    const reroll = u.abilities.find((a) => a.effect?.t === 'reroll')?.effect;
    if (reroll && reroll.t === 'reroll') {
      if (reroll.phase === 'hit') mods.rerollHits = reroll.scope === 'all' ? 'all' : 'ones';
      if (reroll.phase === 'wound') mods.rerollWounds = reroll.scope === 'all' ? 'all' : 'ones';
    }
    return mods;
  }

  // ---------------------------------------------------------------- charge
  /** Enemy units within 12" that this unit could attempt to charge. */
  chargeTargets(u: UnitInstance): UnitInstance[] {
    if (u.moveState === 'advanced' || u.moveState === 'fellBack') return [];
    if (this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e))) return [];
    return this.enemiesOf(u.ownerId).filter((e) => unitGap(u, e) <= 12);
  }

  rollCharge(): number {
    return this.rng.die() + this.rng.die();
  }

  /**
   * Attempt to charge `target` with `u`. Rolls 2D6; if the roll is enough to
   * bring the unit into engagement range, the unit is moved straight in.
   */
  charge(u: UnitInstance, target: UnitInstance): { roll: number; success: boolean } {
    const roll = this.rollCharge();
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
    return this.isAlive(u) && this.isAlive(target) && inEngagementRange(u, target) && !u.hasFought;
  }

  /** Resolve melee from attacker into target. */
  fight(attacker: UnitInstance, target: UnitInstance): AttackResult[] {
    const weapons = attacker.weapons.filter((w) => w.kind === 'melee');
    const results: AttackResult[] = [];
    for (const w of weapons) {
      const opts: AttackOptions = {
        firingModels: aliveModels(attacker).length,
        ...this.attackerAbilityMods(attacker, 'fight'),
      };
      const res = resolveWeapon(w, attacker, target, this.rng, opts);
      results.push(res);
      for (const line of res.log) this.log(line);
    }
    attacker.hasFought = true;
    this.cleanupDestroyed();
    return results;
  }

  /** Order units for the fight phase: chargers (Fights First) first. */
  fightOrder(): UnitInstance[] {
    const all = Object.values(this.state.units).filter((u) => this.isAlive(u));
    const engaged = all.filter((u) => this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e)));
    const first = engaged.filter((u) => u.hasChargedThisTurn || this.hasEffect(u, 'fightsFirst'));
    const rest = engaged.filter((u) => !first.includes(u));
    return [...first, ...rest];
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

  private cleanupDestroyed(): void {
    for (const u of Object.values(this.state.units)) {
      if (!this.isAlive(u) && !u.inReserves) {
        // Leave the record for history; renderers should hide empty units.
      }
    }
    computeObjectiveControl(this.state.objectives, this.state.units);
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
