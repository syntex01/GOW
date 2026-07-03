import { describe, it, expect } from 'vitest';
import type {
  UnitInstance,
  Weapon,
  Characteristics,
  WeaponKeyword,
  ModelInstance,
} from '../src/engine/types';
import { Rng } from '../src/engine/dice';
import { resolveWeapon, AttackOptions } from '../src/engine/combat';

/* ------------------------------------------------------------------ fixtures */

const ATTACKER_STAT: Characteristics = {
  move: 6,
  toughness: 4,
  save: 3,
  wounds: 2,
  leadership: 6,
  objectiveControl: 1,
};

function weapon(over: Partial<Weapon> & { keywords?: WeaponKeyword[] }): Weapon {
  return {
    id: 'w',
    name: 'TestGun',
    kind: 'ranged',
    range: 24,
    attacks: 1,
    skill: 3,
    strength: 4,
    ap: 0,
    damage: 1,
    keywords: [],
    ...over,
  };
}

/** Attacker with a single firing model (we pass firingModels explicitly anyway). */
function attacker(): UnitInstance {
  return {
    id: 'atk',
    datasheetId: 'ds',
    name: 'Attacker',
    ownerId: 'A',
    models: [
      {
        id: 'am',
        modelName: 'a',
        wounds: 2,
        maxWounds: 2,
        position: { x: 0, y: 0 },
        alive: true,
        baseRadius: 0.5,
      },
    ],
    statline: { ...ATTACKER_STAT },
    weapons: [],
    abilities: [],
    keywords: [],
    isCharacter: false,
    moveState: 'none',
    advanceRoll: 0,
    hasShot: false,
    hasChargedThisTurn: false,
    hasFought: false,
    isBattleShocked: false,
    inReserves: false,
    deepStrike: false,
    attachedLeaderIds: [],
    startingModelCount: 1,
  };
}

interface TargetOpts {
  toughness?: number;
  save?: number;
  invuln?: number;
  feelNoPain?: number;
  wounds?: number; // per-model wounds (and maxWounds)
  modelCount?: number;
  keywords?: string[];
}

/**
 * Build a fresh target. For damage-OUTPUT measurement, use one model with a huge
 * wound pool (so `damageInflicted` is never capped by overkill / no-spill).
 * For casualty-COUNT measurement use many 1W models.
 */
function target(o: TargetOpts = {}): UnitInstance {
  const stat: Characteristics = {
    move: 6,
    toughness: o.toughness ?? 4,
    save: o.save ?? 4,
    wounds: o.wounds ?? 100000,
    leadership: 6,
    objectiveControl: 1,
    ...(o.invuln !== undefined ? { invuln: o.invuln } : {}),
    ...(o.feelNoPain !== undefined ? { feelNoPain: o.feelNoPain } : {}),
  };
  const count = o.modelCount ?? 1;
  const models: ModelInstance[] = [];
  for (let i = 0; i < count; i++) {
    models.push({
      id: `tm${i}`,
      modelName: 't',
      wounds: stat.wounds,
      maxWounds: stat.wounds,
      position: { x: 100 + i * 0.01, y: 100 },
      alive: true,
      baseRadius: 0.5,
    });
  }
  return {
    id: 'tgt',
    datasheetId: 'ds',
    name: 'Target',
    ownerId: 'B',
    models,
    statline: stat,
    weapons: [],
    abilities: [],
    keywords: o.keywords ?? [],
    isCharacter: false,
    moveState: 'none',
    advanceRoll: 0,
    hasShot: false,
    hasChargedThisTurn: false,
    hasFought: false,
    isBattleShocked: false,
    inReserves: false,
    deepStrike: false,
    attachedLeaderIds: [],
    startingModelCount: count,
  };
}

/** Run resolveWeapon N times, re-instantiating the target each iteration. */
function runMany(
  w: Weapon,
  buildTarget: () => UnitInstance,
  opts: AttackOptions,
  N: number,
  seed = 1234,
): {
  meanDamage: number;
  meanHits: number;
  meanWounds: number;
  meanUnsaved: number;
  meanDev: number;
  meanSlain: number;
  meanAttacks: number;
} {
  const rng = new Rng(seed);
  const atk = attacker();
  let dmg = 0,
    hits = 0,
    wounds = 0,
    unsaved = 0,
    dev = 0,
    slain = 0,
    attacks = 0;
  for (let i = 0; i < N; i++) {
    const t = buildTarget();
    const r = resolveWeapon(w, atk, t, rng, opts);
    dmg += r.damageInflicted;
    hits += r.hits;
    wounds += r.wounds;
    unsaved += r.unsaved;
    dev += r.devastating;
    slain += r.modelsSlain;
    attacks += r.attacks;
  }
  return {
    meanDamage: dmg / N,
    meanHits: hits / N,
    meanWounds: wounds / N,
    meanUnsaved: unsaved / N,
    meanDev: dev / N,
    meanSlain: slain / N,
    meanAttacks: attacks / N,
  };
}

/** Relative-tolerance assertion. */
function expectClose(actual: number, expected: number, relTol: number): void {
  const diff = Math.abs(actual - expected);
  const allow = Math.abs(expected) * relTol;
  expect(
    diff <= allow,
    `expected ${actual.toFixed(4)} within ${(relTol * 100).toFixed(1)}% of ${expected.toFixed(4)} (diff ${diff.toFixed(4)}, allow ${allow.toFixed(4)})`,
  ).toBe(true);
}

const N = 40000;
const REL = 0.04; // 4% relative tolerance

/* --------------------------------------------------------------- scenarios */

describe('resolveWeapon empirical vs analytic', () => {
  // (a) Plain: 10 attacks, BS3+, S4 vs T4 (wound 4+), Sv4+ no AP, D1, no FNP.
  // E = 10 * (4/6) * (1/2) * (1/2) * 1 = 1.6667
  it('(a) plain S4 vs T4, BS3+, Sv4+, D1', () => {
    const w = weapon({ attacks: 10, skill: 3, strength: 4, ap: 0, damage: 1 });
    const res = runMany(w, () => target({ toughness: 4, save: 4 }), { firingModels: 1 }, N, 11);
    const expected = 10 * (4 / 6) * (1 / 2) * (1 / 2) * 1;
    expectClose(res.meanDamage, expected, REL);
    expect(expected).toBeCloseTo(1.6667, 3);
  });

  // (b) AP-1 -> save becomes 5+, P(fail) = 4/6.
  // E = 10 * (4/6) * (1/2) * (4/6) * 1 = 2.2222
  it('(b) AP-1 worsens save to 5+', () => {
    const w = weapon({ attacks: 10, skill: 3, strength: 4, ap: 1, damage: 1 });
    const res = runMany(w, () => target({ toughness: 4, save: 4 }), { firingModels: 1 }, N, 12);
    const expected = 10 * (4 / 6) * (1 / 2) * (4 / 6) * 1;
    expectClose(res.meanDamage, expected, REL);
  });

  // (c) Invuln: Sv6+, invuln4+, AP-3 -> armour 6+3=9 capped, invuln 4+ used. P(fail)=1/2.
  // E = 10 * (4/6) * (1/2) * (1/2) * 1 = 1.6667
  it('(c) invuln 4+ used when armour blown through by AP-3', () => {
    const w = weapon({ attacks: 10, skill: 3, strength: 4, ap: 3, damage: 1 });
    const res = runMany(
      w,
      () => target({ toughness: 4, save: 6, invuln: 4 }),
      { firingModels: 1 },
      N,
      13,
    );
    const expected = 10 * (4 / 6) * (1 / 2) * (1 / 2) * 1;
    expectClose(res.meanDamage, expected, REL);
  });

  // (d) Feel No Pain 5+: multiply expected damage by P(not ignored)=4/6 (D1).
  // base unsaved E = 10*(4/6)*(1/2)*(1/2) = 1.6667 ; *4/6 = 1.1111
  it('(d) Feel No Pain 5+ reduces D1 damage by 4/6', () => {
    const w = weapon({ attacks: 10, skill: 3, strength: 4, ap: 0, damage: 1 });
    const res = runMany(
      w,
      () => target({ toughness: 4, save: 4, feelNoPain: 5 }),
      { firingModels: 1 },
      N,
      14,
    );
    const expected = 10 * (4 / 6) * (1 / 2) * (1 / 2) * (4 / 6);
    expectClose(res.meanDamage, expected, REL);
  });

  // (e) Twin-linked: re-roll failed wounds. P(wound) at 4+ = 1/2; with reroll = 1/2 + 1/2*1/2 = 3/4.
  // Compare mean wounds twin vs non-twin.
  it('(e) Twin-linked raises wound rate to P + (1-P)*P', () => {
    const base = weapon({ attacks: 20, skill: 3, strength: 4, ap: 0, damage: 1 });
    const twin = weapon({
      attacks: 20,
      skill: 3,
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'twinLinked' }],
    });
    const noTwin = runMany(base, () => target({ toughness: 4, save: 7 }), { firingModels: 1 }, N, 15);
    const withTwin = runMany(twin, () => target({ toughness: 4, save: 7 }), { firingModels: 1 }, N, 16);
    // save 7+ is unsaveable -> unsaved == wounds. Measure wounds directly.
    const pWound = 1 / 2;
    const pWoundTwin = pWound + (1 - pWound) * pWound; // 0.75
    const expBase = 20 * (4 / 6) * pWound;
    const expTwin = 20 * (4 / 6) * pWoundTwin;
    expectClose(noTwin.meanWounds, expBase, REL);
    expectClose(withTwin.meanWounds, expTwin, REL);
    expect(withTwin.meanWounds).toBeGreaterThan(noTwin.meanWounds);
  });

  // (f) Sustained Hits 1: each crit (unmod 6) adds 1 extra hit (the crit hit itself still counts).
  // With BS3+: P(success)=4/6, P(crit)=1/6. mean hits = attacks*(P(success) + P(crit)*1).
  it('(f) Sustained Hits 1 adds a hit per critical hit', () => {
    const plain = weapon({ attacks: 36, skill: 3, strength: 4 });
    const sus = weapon({
      attacks: 36,
      skill: 3,
      strength: 4,
      keywords: [{ t: 'sustainedHits', x: 1 }],
    });
    const plainRes = runMany(plain, () => target({ save: 7 }), { firingModels: 1 }, N, 17);
    const susRes = runMany(sus, () => target({ save: 7 }), { firingModels: 1 }, N, 18);
    const pHit = 4 / 6;
    const pCrit = 1 / 6;
    const expPlain = 36 * pHit;
    const expSus = 36 * (pHit + pCrit); // each crit yields its own hit + 1 sustained
    expectClose(plainRes.meanHits, expPlain, REL);
    expectClose(susRes.meanHits, expSus, REL);
    expect(susRes.meanHits).toBeGreaterThan(plainRes.meanHits);
  });

  // (g) Lethal Hits: crit hit (unmod 6) auto-wounds (skips wound roll). Increases wounds.
  // With BS3+ vs a poor wound roll, lethal converts the 1/6 crits straight to wounds.
  // Wounds = (normal hits that pass wound roll) + (lethal auto-wounds).
  // normalHits = attacks*(P(success)-P(crit)); each wounds with P(wound).
  // lethal auto-wounds = attacks*P(crit).
  // Use S4 vs T6 -> wound on 5+ (P=2/6) to make the auto-wound effect large.
  // (Note: S3 vs T6 would be 6+ because 3*2 == 6 hits the S*2<=T branch.)
  it('(g) Lethal Hits convert critical hits straight to wounds', () => {
    const pHit = 4 / 6;
    const pCrit = 1 / 6;
    const pWound = 2 / 6; // S4 vs T6 -> 5+
    const plain = weapon({ attacks: 36, skill: 3, strength: 4 });
    const leth = weapon({
      attacks: 36,
      skill: 3,
      strength: 4,
      keywords: [{ t: 'lethalHits' }],
    });
    const plainRes = runMany(plain, () => target({ toughness: 6, save: 7 }), { firingModels: 1 }, N, 19);
    const lethRes = runMany(leth, () => target({ toughness: 6, save: 7 }), { firingModels: 1 }, N, 20);
    const expPlain = 36 * pHit * pWound;
    const expLeth = 36 * ((pHit - pCrit) * pWound + pCrit * 1);
    expectClose(plainRes.meanWounds, expPlain, REL);
    expectClose(lethRes.meanWounds, expLeth, REL);
    expect(lethRes.meanWounds).toBeGreaterThan(plainRes.meanWounds);
  });

  // (h) Devastating Wounds: crit wound (unmod 6) bypasses saves entirely.
  // Use an excellent save (2+) so normal wounds almost always saved, but dev wounds get through.
  // dev unsaved expected = attacks * P(hit) * P(critWound=1/6).
  it('(h) Devastating Wounds bypass armour saves', () => {
    const pHit = 4 / 6;
    const pCritWound = 1 / 6;
    const dev = weapon({
      attacks: 36,
      skill: 3,
      strength: 4,
      ap: 0,
      damage: 1,
      keywords: [{ t: 'devastatingWounds' }],
    });
    // Sv2+ no AP -> normal saveable wounds saved on 2-6 (P(fail)=1/6), dev wounds always through.
    const res = runMany(dev, () => target({ toughness: 4, save: 2 }), { firingModels: 1 }, N, 21);
    const expDev = 36 * pHit * pCritWound;
    // devastating wounds reported separately and always inflict damage (D1).
    expectClose(res.meanDev, expDev, REL);
    // Total damage = dev (always through) + saveable that fail save.
    const pWound = 1 / 2;
    const pSaveFail = 1 / 6;
    const expDamage = 36 * pHit * ((pWound - pCritWound) * pSaveFail + pCritWound * 1);
    expectClose(res.meanDamage, expDamage, REL);
  });

  // (i) Melta X at half range adds X to each damage roll.
  // Base damage D6 (avg 3.5). Melta 2 at half range -> avg 5.5 per unsaved.
  it('(i) Melta adds to damage at half range', () => {
    const melta = weapon({
      attacks: 10,
      skill: 3,
      strength: 8,
      ap: 4,
      damage: 'D6',
      keywords: [{ t: 'melta', x: 2 }],
    });
    // T4, save 7+ (so all wounds unsaved); S8 vs T4 -> wound on 2+ (P=5/6).
    const pHit = 4 / 6;
    const pWound = 5 / 6; // S8 >= 2*T4? 8>=8 yes -> 2+
    const half = runMany(melta, () => target({ toughness: 4, save: 7 }), { firingModels: 1, halfRange: true }, N, 22);
    const far = runMany(melta, () => target({ toughness: 4, save: 7 }), { firingModels: 1, halfRange: false }, N, 23);
    const expUnsaved = 10 * pHit * pWound;
    const expDamageHalf = expUnsaved * (3.5 + 2); // melta +2
    const expDamageFar = expUnsaved * 3.5;
    expectClose(half.meanDamage, expDamageHalf, REL);
    expectClose(far.meanDamage, expDamageFar, REL);
    expect(half.meanDamage).toBeGreaterThan(far.meanDamage);
  });

  // (j) Torrent / skill 0 auto-hits: hits == attacks every time.
  it('(j) Torrent auto-hits (hits == attacks)', () => {
    const torrent = weapon({ attacks: 7, skill: 3, keywords: [{ t: 'torrent' }] });
    const res = runMany(torrent, () => target({ save: 7 }), { firingModels: 1 }, 5000, 24);
    expect(res.meanHits).toBeCloseTo(7, 5);
    expect(res.meanAttacks).toBeCloseTo(7, 5);

    const skillZero = weapon({ attacks: 7, skill: 0 });
    const res2 = runMany(skillZero, () => target({ save: 7 }), { firingModels: 1 }, 5000, 25);
    expect(res2.meanHits).toBeCloseTo(7, 5);
  });
});

/* ----------------------------------------------- casualty-count scenario */

describe('casualty counting on many 1W models', () => {
  // Many 1W models: each unsaved D1 wound slays one model. modelsSlain ~ unsaved.
  it('models slain ~ unsaved wounds for 1W targets', () => {
    const w = weapon({ attacks: 10, skill: 3, strength: 4, ap: 0, damage: 1 });
    const res = runMany(
      w,
      () => target({ toughness: 4, save: 4, wounds: 1, modelCount: 200 }),
      { firingModels: 1 },
      20000,
      26,
    );
    const expected = 10 * (4 / 6) * (1 / 2) * (1 / 2); // ~1.6667 unsaved == slain
    expectClose(res.meanSlain, expected, REL);
    expectClose(res.meanUnsaved, expected, REL);
  });
});
