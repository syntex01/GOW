import type { UnitInstance, Weapon, WeaponKeyword, ModelInstance } from './types';
import { Rng, parseDice } from './dice';
import { aliveModels } from './geometry';

/**
 * The attack sequence, faithful to the tabletop:
 *   attacks -> hit roll -> wound roll -> allocate -> save -> damage -> feel no pain
 *
 * Implemented as a single deterministic function so it can be unit-tested
 * against known probabilities. All of the relevant weapon abilities are handled
 * (Rapid Fire, Sustained Hits, Lethal Hits, Devastating Wounds, Twin-linked,
 * Anti, Melta, Blast, Torrent), plus cover, hit/wound modifiers, re-rolls,
 * invulnerable saves and Feel No Pain.
 */

export interface AttackOptions {
  /** Target is within half the weapon's range (Rapid Fire, Melta). */
  halfRange?: boolean;
  /** Target benefits from cover. */
  cover?: boolean;
  /** Net hit-roll modifier (engine caps the applied modifier at +/-1). */
  hitModifier?: number;
  /** Net wound-roll modifier (engine caps the applied modifier at +/-1). */
  woundModifier?: number;
  /** Re-roll hits: 'ones' or 'all' failed. */
  rerollHits?: 'ones' | 'all';
  /** Re-roll wounds: 'ones' or 'all' failed. */
  rerollWounds?: 'ones' | 'all';
  /** Number of models firing this weapon profile. */
  firingModels?: number;
  /**
   * Extra invulnerable save granted to the target for this attack only (N means
   * N+), e.g. a 6+ from Go to Ground / Smokescreen. Combined with any printed
   * invuln by taking the better (lower) of the two. Does not mutate the unit.
   */
  bonusInvuln?: number;
}

export interface AttackResult {
  weaponName: string;
  attacks: number;
  hits: number;
  wounds: number; // wounds that reached the save step (excludes Dev-Wounds bypass)
  unsaved: number;
  devastating: number; // wounds that bypassed saves
  damageInflicted: number; // total wounds lost by the target after FNP
  modelsSlain: number;
  log: string[];
}

const clampMod = (m: number): number => Math.max(-1, Math.min(1, m));

function findKeyword<T extends WeaponKeyword['t']>(
  w: Weapon,
  t: T,
): Extract<WeaponKeyword, { t: T }> | undefined {
  return w.keywords.find((k) => k.t === t) as Extract<WeaponKeyword, { t: T }> | undefined;
}

/** Wound-roll target number from attacker Strength vs defender Toughness. */
export function woundThreshold(strength: number, toughness: number): number {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5; // strength < toughness (but more than half)
}

/** Total number of attacks for one weapon profile fired by N models. */
export function computeAttacks(
  weapon: Weapon,
  rng: Rng,
  firingModels: number,
  targetModelCount: number,
  opts: AttackOptions,
): number {
  const rapid = findKeyword(weapon, 'rapidFire');
  const blast = findKeyword(weapon, 'blast');
  const blastBonus = blast ? Math.floor(targetModelCount / 5) : 0;
  let total = 0;
  for (let i = 0; i < firingModels; i++) {
    let a = rollAttackValue(weapon.attacks, rng);
    if (rapid && opts.halfRange) a += rapid.x;
    a += blastBonus;
    total += a;
  }
  return total;
}

function rollAttackValue(expr: Weapon['attacks'], rng: Rng): number {
  const { count, sides, flat } = parseDice(expr);
  let v = flat;
  for (let i = 0; i < count; i++) v += rng.die(sides);
  return v;
}

/** Roll a single d6 check with re-roll support. Returns the kept roll. */
function rollWithReroll(rng: Rng, target: number, reroll: 'ones' | 'all' | undefined): number {
  let roll = rng.die();
  const failed = roll === 1 || (roll !== 6 && roll < target);
  const shouldReroll = reroll === 'all' ? failed : reroll === 'ones' ? roll === 1 : false;
  if (shouldReroll) roll = rng.die();
  return roll;
}

/**
 * Resolve a full weapon attack from `attacker` against `target`, mutating the
 * target's models (applying damage and removing casualties). Returns a detailed
 * breakdown for the dice log.
 */
export function resolveWeapon(
  weapon: Weapon,
  attacker: UnitInstance,
  target: UnitInstance,
  rng: Rng,
  opts: AttackOptions = {},
): AttackResult {
  const log: string[] = [];
  const firingModels = opts.firingModels ?? aliveModels(attacker).length;
  const targetModels = aliveModels(target);
  const targetCount = targetModels.length;

  const attacks = computeAttacks(weapon, rng, firingModels, targetCount, opts);

  const torrent = !!findKeyword(weapon, 'torrent') || weapon.skill === 0;
  const sustained = findKeyword(weapon, 'sustainedHits');
  const lethal = !!findKeyword(weapon, 'lethalHits');
  const dev = !!findKeyword(weapon, 'devastatingWounds');
  const twin = !!findKeyword(weapon, 'twinLinked');
  const anti = weapon.keywords.find((k) => k.t === 'anti') as
    | Extract<WeaponKeyword, { t: 'anti' }>
    | undefined;
  const melta = findKeyword(weapon, 'melta');

  const hitMod = clampMod(opts.hitModifier ?? 0);
  const woundMod = clampMod(opts.woundModifier ?? 0);

  // --- Hit step ---
  let normalHits = 0; // need a wound roll
  let lethalAutoWounds = 0; // skip wound roll, count as (non-critical) wounds
  if (torrent) {
    normalHits = attacks;
  } else {
    for (let i = 0; i < attacks; i++) {
      const roll = rollWithReroll(rng, weapon.skill, opts.rerollHits);
      const isCrit = roll === 6;
      const success = roll !== 1 && (roll === 6 || roll + hitMod >= weapon.skill);
      if (!success) continue;
      if (isCrit && sustained) {
        // Sustained Hits X: the critical hit scores X *additional* hits.
        normalHits += sustained.x;
      }
      if (isCrit && lethal) lethalAutoWounds += 1;
      else normalHits += 1;
    }
  }
  const hits = normalHits + lethalAutoWounds;

  // --- Wound step ---
  const wt = woundThreshold(weapon.strength, target.statline.toughness);
  const antiApplies = anti && target.keywords.includes(anti.keyword);
  let saveableWounds = 0;
  let devWounds = 0;
  for (let i = 0; i < normalHits; i++) {
    const roll = rollWithReroll(rng, wt, twin ? 'all' : opts.rerollWounds);
    const critByRoll = roll === 6;
    const critByAnti = !!antiApplies && roll >= anti!.x;
    const success = roll !== 1 && (critByRoll || critByAnti || roll + woundMod >= wt);
    if (!success) continue;
    const isCrit = critByRoll || critByAnti;
    if (isCrit && dev) devWounds += 1;
    else saveableWounds += 1;
  }
  // Lethal-hit auto-wounds are normal (non-critical) wounds -> still saveable.
  saveableWounds += lethalAutoWounds;

  // --- Save step ---
  const armour = target.statline.save;
  const printedInvuln = target.statline.invuln;
  const invuln =
    opts.bonusInvuln !== undefined
      ? Math.min(opts.bonusInvuln, printedInvuln ?? opts.bonusInvuln)
      : printedInvuln;
  let effectiveArmour = armour + weapon.ap;
  if (opts.cover && !(weapon.ap === 0 && armour <= 3)) {
    // Cover improves the armour save by 1, but not for AP0 vs Sv 3+ or better.
    effectiveArmour -= 1;
  }
  const saveTarget = invuln !== undefined ? Math.min(effectiveArmour, invuln) : effectiveArmour;

  let unsaved = 0;
  for (let i = 0; i < saveableWounds; i++) {
    const roll = rng.die();
    const saved = roll !== 1 && roll >= saveTarget;
    if (!saved) unsaved += 1;
  }

  // --- Damage + Feel No Pain + allocation ---
  const fnp = target.statline.feelNoPain;
  let damageInflicted = 0;
  let modelsSlain = 0;

  const applyOne = (): boolean => {
    // Roll damage for this unsaved/dev wound.
    let dmg = rollAttackValue(weapon.damage, rng);
    if (melta && opts.halfRange) dmg += melta.x;
    // Feel No Pain reduces damage point-by-point.
    if (fnp !== undefined) {
      let prevented = 0;
      for (let d = 0; d < dmg; d++) if (rng.die() >= fnp) prevented++;
      dmg -= prevented;
    }
    if (dmg <= 0) return false;
    const m = nextTargetModel(target);
    if (!m) return false;
    const before = m.wounds;
    m.wounds -= dmg;
    if (m.wounds <= 0) {
      m.wounds = 0;
      m.alive = false;
      modelsSlain += 1;
      damageInflicted += before; // excess damage past 0 is lost (no spill)
    } else {
      damageInflicted += dmg;
    }
    return true;
  };

  for (let i = 0; i < unsaved; i++) applyOne();
  for (let i = 0; i < devWounds; i++) applyOne();

  log.push(
    `${attacker.name} fires ${weapon.name} at ${target.name}: ` +
      `${attacks} attacks -> ${hits} hits -> ${saveableWounds + devWounds} wounds ` +
      `(${devWounds} dev) -> ${unsaved + devWounds} unsaved -> ` +
      `${damageInflicted} damage, ${modelsSlain} slain.`,
  );

  return {
    weaponName: weapon.name,
    attacks,
    hits,
    wounds: saveableWounds,
    unsaved,
    devastating: devWounds,
    damageInflicted,
    modelsSlain,
    log,
  };
}

/** Pick the model to allocate the next wound to: a wounded model first. */
function nextTargetModel(unit: UnitInstance): ModelInstance | undefined {
  const alive = unit.models.filter((m) => m.alive);
  const wounded = alive.find((m) => m.wounds < m.maxWounds);
  return wounded ?? alive[0];
}
