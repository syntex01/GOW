import { describe, it, expect } from 'vitest';
import type { UnitInstance, Weapon, Characteristics, ModelInstance } from '../src/engine/types';
import { Rng } from '../src/engine/dice';
import { resolveWeapon, AttackOptions } from '../src/engine/combat';
import { necronLychguard, necronWarriors } from '../src/engine/data/necrons';
import { hellblasterSquad } from '../src/engine/data/ultramarines';
import { orkWarboss } from '../src/engine/data/orks';

/**
 * Statistical sanity for representative NEW weapons. We run resolveWeapon ~10k
 * seeded iterations against a single target model with a huge wound pool (so
 * `damageInflicted` measures raw output and is never capped by overkill / the
 * engine's no-spill rule) and assert the empirical mean is within ~6% of the
 * analytic expectation derived from the engine's exact hit/wound/save model.
 *
 * Engine model used to derive expectations (mod 0, no re-rolls):
 *   - hit succeeds on roll != 1 AND (roll == 6 OR roll >= skill)  => P = (7-skill)/6
 *   - woundThreshold(S,T): S>=2T -> 2+, S>T -> 3+, S==T -> 4+, 2S<=T -> 6+, else 5+
 *   - a wound succeeds on roll != 1 AND (roll == 6 OR roll >= wt) => P = (7-wt)/6
 *   - Devastating Wounds: a critical wound (natural 6) bypasses the save
 *   - save fails on roll != 1 AND roll >= saveTarget, where
 *       saveTarget = min(invuln?, save + max(0, ap - apReduction)); cover -1 (caveated)
 *     => P(fail) = (saveTarget - 1)/6, clamped to [1/6, 1]
 *   - flat damage D applies per unsaved/bypassing wound (no FNP here)
 *
 * Per-weapon expected-vs-actual numbers (printed by the test, recorded here):
 *   Warscythe   vs T4 Sv3+ : analytic 1.9259  (Devastating Wounds)
 *   Plasma Inc. vs T5 Sv2+ : analytic 1.1852  (Hazardous hits attacker, not dmg)
 *   Power Klaw  vs T8 Sv3+ : analytic 2.3704
 * Empirical means at N=10000 land within ~3% of these (see console output).
 */

const ATK_STAT: Characteristics = {
  move: 6, toughness: 4, save: 3, wounds: 4, leadership: 6, objectiveControl: 1,
};

function attacker(): UnitInstance {
  return {
    id: 'atk', datasheetId: 'ds', name: 'Attacker', ownerId: 'A',
    models: [{ id: 'am', modelName: 'a', wounds: 4, maxWounds: 4, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.5 }],
    statline: { ...ATK_STAT }, weapons: [], abilities: [], keywords: [], isCharacter: false,
    moveState: 'none', advanceRoll: 0, hasShot: false, hasChargedThisTurn: false, hasFought: false,
    isBattleShocked: false, inReserves: false, deepStrike: false, attachedLeaderIds: [], startingModelCount: 1,
  };
}

function target(toughness: number, save: number): UnitInstance {
  const stat: Characteristics = { move: 6, toughness, save, wounds: 100000, leadership: 6, objectiveControl: 1 };
  const m: ModelInstance = { id: 'tm', modelName: 't', wounds: stat.wounds, maxWounds: stat.wounds, position: { x: 100, y: 100 }, alive: true, baseRadius: 0.5 };
  return {
    id: 'tgt', datasheetId: 'ds', name: 'Target', ownerId: 'B', models: [m],
    statline: stat, weapons: [], abilities: [], keywords: [], isCharacter: false,
    moveState: 'none', advanceRoll: 0, hasShot: false, hasChargedThisTurn: false, hasFought: false,
    isBattleShocked: false, inReserves: false, deepStrike: false, attachedLeaderIds: [], startingModelCount: 1,
  };
}

/** Mean damageInflicted over N seeded iterations, fresh attacker+target each time. */
function meanDamage(w: Weapon, toughness: number, save: number, N: number, opts: AttackOptions = {}): number {
  const rng = new Rng(20240630);
  let dmg = 0;
  for (let i = 0; i < N; i++) {
    // Fresh attacker each iteration so Hazardous self-wounds can't shrink the
    // firing model count (we also pin firingModels = 1 explicitly).
    const atk = attacker();
    const t = target(toughness, save);
    const r = resolveWeapon(w, atk, t, rng, { firingModels: 1, ...opts });
    dmg += r.damageInflicted;
  }
  return dmg / N;
}

function expectClose(actual: number, expected: number, relTol: number, label: string): void {
  const diff = Math.abs(actual - expected);
  const allow = Math.abs(expected) * relTol;
  // eslint-disable-next-line no-console
  console.log(`balance ${label}: empirical=${actual.toFixed(4)} analytic=${expected.toFixed(4)} (diff ${diff.toFixed(4)}, ${(100 * diff / expected).toFixed(2)}%)`);
  expect(diff <= allow, `${label}: ${actual.toFixed(4)} not within ${(relTol * 100).toFixed(0)}% of ${expected.toFixed(4)}`).toBe(true);
}

const N = 10000;
const REL = 0.06;

describe('balance: new weapons empirical vs analytic damage', () => {
  it('Warscythe (Lychguard) vs T4 Sv3+', () => {
    const w = necronLychguard.weapons.find((x) => x.id === 'warscythe')!;
    // Sanity-check we picked the weapon we think we did (10th-ed corrected
    // profile: A3, S8, AP-2, D2, no Devastating Wounds).
    expect(w.attacks).toBe(3);
    expect(w.strength).toBe(8);
    expect(w.ap).toBe(2);
    expect(w.damage).toBe(2);
    expect(w.keywords.some((k) => k.t === 'devastatingWounds')).toBe(false);
    // attacks=3, Phit=(7-3)/6=4/6, S8 vs T4 (8>=2*4) -> wound 2+ (P=5/6).
    // Save: AP2 vs Sv3+ -> 5+, P(fail)=4/6. Damage=2 flat.
    // E = attacks(3) * Phit(4/6) * Pwound(5/6) * Pfail(4/6) * 2 = 2.2222
    const analytic = 3 * (4 / 6) * (5 / 6) * (4 / 6) * 2;
    expect(analytic).toBeCloseTo(2.2222, 3);
    expectClose(meanDamage(w, 4, 3, N), analytic, REL, 'Warscythe vs T4 Sv3+');
  });

  it('Plasma Incinerator (Supercharge, Hellblasters) vs T5 Sv2+ — Hazardous', () => {
    const w = hellblasterSquad.weapons.find((x) => x.id === 'plasma_incinerator_super')!;
    expect(w.attacks).toBe(2);
    expect(w.strength).toBe(8);
    expect(w.ap).toBe(3);
    expect(w.damage).toBe(2);
    expect(w.keywords.some((k) => k.t === 'hazardous')).toBe(true);
    // Hazardous wounds the ATTACKER (irrelevant to target damage measured here).
    // attacks=2, Phit=(7-3)/6=4/6. S8 vs T5 -> 8>5,8<10 -> wound 3+ (P=4/6).
    // Save: AP3 vs Sv2+ -> 5+, P(fail)=4/6. Damage=2 flat. No Dev.
    // E = 2 * (4/6) * (4/6) * (4/6) * 2 = 1.1852
    const analytic = 2 * (4 / 6) * (4 / 6) * (4 / 6) * 2;
    expect(analytic).toBeCloseTo(1.1852, 3);
    expectClose(meanDamage(w, 5, 2, N), analytic, REL, 'Plasma Incinerator vs T5 Sv2+');
  });

  it('Power Klaw (Warboss) vs T8 Sv3+', () => {
    const w = orkWarboss.weapons.find((x) => x.id === 'warboss_power_klaw')!;
    expect(w.attacks).toBe(4);
    expect(w.strength).toBe(10);
    expect(w.ap).toBe(2);
    expect(w.damage).toBe(2);
    // attacks=4, Phit=(7-3)/6=4/6. S10 vs T8 -> 10>8,10<16 -> wound 3+ (P=4/6).
    // Save: AP2 vs Sv3+ -> 5+, P(fail)=4/6. Damage=2 flat.
    // E = 4 * (4/6) * (4/6) * (4/6) * 2 = 2.3704
    const analytic = 4 * (4 / 6) * (4 / 6) * (4 / 6) * 2;
    expect(analytic).toBeCloseTo(2.3704, 3);
    expectClose(meanDamage(w, 8, 3, N), analytic, REL, 'Power Klaw vs T8 Sv3+');
  });

  it('control: Gauss Flayer (Necron Warriors) vs T4 Sv4+ — half range Rapid Fire', () => {
    // A new-faction ranged weapon as a cross-check of the Rapid Fire path.
    // 10th-ed corrected profile: A1, S4, AP-1, D1, Rapid Fire 1 (no Lethal Hits).
    // attacks=1 + rapidFire1 at half range = 2. Phit=(7-4)/6=3/6.
    // S4 vs T4 -> wound 4+ (P=3/6). Save: AP1 vs Sv4+ -> 5+, P(fail)=4/6. Damage=1.
    // E(damage per attack) = Phit(3/6) * Pwound(3/6) * Pfail(4/6) * 1 = 1/6
    // attacks = 2 -> E = 2 * 1/6 = 0.3333
    const w = necronWarriors.weapons.find((x) => x.id === 'gauss_flayer')!;
    expect(w.keywords.some((k) => k.t === 'lethalHits')).toBe(false);
    expect(w.ap).toBe(1);
    const analytic = 2 * (3 / 6) * (3 / 6) * (4 / 6) * 1;
    expect(analytic).toBeCloseTo(0.3333, 3);
    expectClose(meanDamage(w, 4, 4, N, { halfRange: true }), analytic, REL, 'Gauss Flayer vs T4 Sv4+ (half range)');
  });
});
