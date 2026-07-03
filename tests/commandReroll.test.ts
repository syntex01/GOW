import { describe, it, expect } from 'vitest';
import { resolveWeapon, type AttackOptions } from '../src/engine/combat';
import type { Rng } from '../src/engine/dice';
import type { UnitInstance, Weapon } from '../src/engine/types';

/** A scripted d6 source: pops the next queued roll, defaulting to 1 when empty. */
function scriptedRng(rolls: number[]): Rng {
  const q = [...rolls];
  return { die: () => q.shift() ?? 1, next: () => 0 } as unknown as Rng;
}

function unit(over: Partial<UnitInstance>): UnitInstance {
  return {
    id: 'u', datasheetId: 'd', name: 'U', ownerId: 'A', models: [],
    statline: { move: 6, toughness: 10, save: 2, wounds: 1, leadership: 6, objectiveControl: 1 },
    weapons: [], abilities: [], keywords: [], isCharacter: false,
    moveState: 'none', advanceRoll: 0, hasShot: false, hasChargedThisTurn: false,
    hasFought: false, isBattleShocked: false, inReserves: false, deepStrike: false,
    attachedLeaderIds: [], startingModelCount: 1,
    ...over,
  } as UnitInstance;
}

const WEAPON: Weapon = {
  id: 'gun', name: 'Gun', kind: 'ranged', range: 24, attacks: 2, skill: 4,
  strength: 4, ap: 0, damage: 1, keywords: [],
};

describe('Command Re-roll single-die semantics', () => {
  it('re-rolls exactly one failed hit die, not the whole volley', () => {
    const attacker = unit({});
    const target = unit({
      id: 't', models: [{ id: 'm', modelName: 'M', wounds: 1, maxWounds: 1, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    // Two attacks both roll 2 (fail vs 4+). With rerollOneHit, only the first is
    // re-rolled (to a 5 → hit); the second stays failed. Expect exactly 1 hit.
    const opts: AttackOptions = { rerollOneHit: true, firingModels: 1 };
    const res = resolveWeapon(WEAPON, attacker, target, scriptedRng([2, 5, 2]), opts);
    expect(res.hits).toBe(1);
  });

  it('without the re-roll, both failed dice stay failed', () => {
    const attacker = unit({});
    const target = unit({
      id: 't', models: [{ id: 'm', modelName: 'M', wounds: 1, maxWounds: 1, position: { x: 0, y: 0 }, alive: true, baseRadius: 0.6 }],
    });
    const res = resolveWeapon(WEAPON, attacker, target, scriptedRng([2, 2]), { firingModels: 1 });
    expect(res.hits).toBe(0);
  });
});
