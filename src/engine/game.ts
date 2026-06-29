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
  unitInCover,
  ENGAGEMENT_RANGE,
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

    // Strategic Reserves: any of the active player's units still in reserve at
    // the start of their command phase from battle round 4 onward are destroyed.
    this.destroyOverdueReserves();

    // Reset per-turn unit status for the active player.
    for (const u of this.unitsOf(this.active)) {
      u.moveState = 'none';
      u.advanceRoll = 0;
      u.hasShot = false;
      u.hasChargedThisTurn = false;
      u.hasFought = false;
      u.fightsNext = false;
      // Clear transient defensive flags set during the opponent's turn that
      // were meant to last "until your next turn".
      if (u.defensiveFlagRound !== undefined && u.defensiveFlagRound < this.state.round) {
        u.goToGround = false;
        u.smokescreen = false;
        u.defensiveFlagRound = undefined;
      }
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
        this.log(`${u.name} never arrived from Reserves and is destroyed.`);
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

  /** Resolve all shooting from an attacker into a target. */
  shoot(attacker: UnitInstance, target: UnitInstance, optsByWeapon?: Record<string, AttackOptions>): AttackResult[] {
    // A target shielded as an attached leader (living bodyguard) cannot be shot.
    if (this.isProtectedLeader(target)) {
      this.log(`${attacker.name} cannot target ${target.name}: it is an attached leader (protected).`);
      return [];
    }
    const weapons = this.shootableWeapons(attacker, target);
    // Cover from terrain, or granted transiently by Go to Ground / Smokescreen.
    const cover = unitInCover(target, this.state.terrain) || !!target.goToGround || !!target.smokescreen;
    // Go to Ground / Smokescreen also grant a 6+ invuln vs shooting this turn.
    const bonusInvuln = target.goToGround || target.smokescreen ? 6 : undefined;
    // Command Re-roll: consume a one-shot "re-roll all hits" for this attack.
    const rerollFlag = attacker.pendingRerollHits;
    const results: AttackResult[] = [];
    for (const w of weapons) {
      const halfRange = unitGap(attacker, target) <= w.range / 2;
      const ignoresCover = w.keywords.some((k) => k.t === 'ignoresCover');
      const opts: AttackOptions = {
        halfRange,
        cover: (cover && !ignoresCover) || false,
        firingModels: aliveModels(attacker).length,
        ...(bonusInvuln !== undefined ? { bonusInvuln } : {}),
        ...this.attackerAbilityMods(attacker, 'shooting'),
        ...(rerollFlag ? { rerollHits: 'all' as const } : {}),
        ...(optsByWeapon?.[w.id] ?? {}),
      };
      const res = resolveWeapon(w, attacker, target, this.rng, opts);
      results.push(res);
      for (const line of res.log) this.log(line);
    }
    if (rerollFlag) attacker.pendingRerollHits = false;
    attacker.hasShot = true;
    this.cleanupDestroyed();
    return results;
  }

  private attackerAbilityMods(u: UnitInstance, _phase: 'shooting' | 'fight'): Partial<AttackOptions> {
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
    const rerollFlag = attacker.pendingRerollHits;
    const results: AttackResult[] = [];
    for (const w of weapons) {
      const opts: AttackOptions = {
        firingModels: aliveModels(attacker).length,
        ...this.attackerAbilityMods(attacker, 'fight'),
        ...(rerollFlag ? { rerollHits: 'all' as const } : {}),
      };
      const res = resolveWeapon(w, attacker, target, this.rng, opts);
      results.push(res);
      for (const line of res.log) this.log(line);
    }
    if (rerollFlag) attacker.pendingRerollHits = false;
    attacker.hasFought = true;
    attacker.fightsNext = false; // consumed
    this.cleanupDestroyed();
    return results;
  }

  /** Order units for the fight phase: chargers (Fights First) first. */
  fightOrder(): UnitInstance[] {
    const all = Object.values(this.state.units).filter((u) => this.isAlive(u));
    const engaged = all.filter((u) => this.enemiesOf(u.ownerId).some((e) => inEngagementRange(u, e)));
    // Counter-offensive: a flagged unit fights at the very front of the order.
    const counter = engaged.filter((u) => u.fightsNext);
    const first = engaged.filter(
      (u) => !u.fightsNext && (u.hasChargedThisTurn || this.hasEffect(u, 'fightsFirst')),
    );
    const rest = engaged.filter((u) => !u.fightsNext && !first.includes(u));
    return [...counter, ...first, ...rest];
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
   * Spend command points and apply a stratagem's effect. Returns ok:false with a
   * message if it cannot be used (unknown id, wrong phase, or not enough CP).
   * `ctx.unitId` is the affected friendly unit; `ctx.targetUnitId` an enemy.
   */
  activateStratagem(
    id: string,
    ctx?: { unitId?: string; targetUnitId?: string },
  ): { ok: boolean; message: string } {
    const strat = findStratagem(id);
    if (!strat) return { ok: false, message: `Unknown stratagem: ${id}` };
    const player = this.state.players[this.active];
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
        return { ok: true, message: `${unit.name} will re-roll all hits on its next attack.` };
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
      case 'heroic_intervention':
      case 'tank_shock':
      case 'epic_challenge': {
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
    const cover = unitInCover(target, this.state.terrain) || !!target.goToGround || !!target.smokescreen;
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
