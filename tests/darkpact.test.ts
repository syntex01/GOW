import { describe, it, expect } from 'vitest';
import { createGame } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { DATASHEETS, SAMPLE_ARMIES } from '../src/engine/data/index';
import type { UnitInstance } from '../src/engine/types';

function chaosVsMarines(seed: number): GameEngine {
  const e = new GameEngine(
    createGame(
      { seed, players: { A: { name: 'Warband', faction: 'Chaos' }, B: { name: 'UM', faction: 'Ultramarines' } } },
      DATASHEETS,
      SAMPLE_ARMIES.chaos,
      SAMPLE_ARMIES.ultramarines,
    ),
  );
  e.startGame();
  return e;
}

const chaosUnit = (e: GameEngine): UnitInstance =>
  e.unitsOf('A').find((u) => u.keywords.includes('CHAOS') && e.isAlive(u))!;

describe('Dark Pact (Chaos faction rule)', () => {
  it('only CHAOS units may swear a pact', () => {
    const e = chaosVsMarines(1);
    const marine = e.unitsOf('B')[0];
    const res = e.activateStratagem('dark_pact', { unitId: marine.id });
    expect(res.ok).toBe(false);
  });

  it('grants Lethal Hits on success or deals mortal wounds on failure', () => {
    // Try several seeds so we observe both outcomes deterministically.
    let sawGrant = false;
    let sawBackfire = false;
    for (let s = 1; s <= 40 && !(sawGrant && sawBackfire); s++) {
      const e = chaosVsMarines(s * 13 + 1);
      const u = chaosUnit(e);
      const woundsBefore = u.models.reduce((a, m) => a + m.wounds, 0);
      const res = e.activateStratagem('dark_pact', { unitId: u.id });
      expect(res.ok).toBe(true);
      if (u.lethalHitsNext) {
        sawGrant = true;
      } else {
        // backfire: it lost wounds (unless FNP shrugged all — rare; allow >=0)
        const woundsAfter = u.models.reduce((a, m) => a + m.wounds, 0);
        if (woundsAfter < woundsBefore) sawBackfire = true;
      }
    }
    expect(sawGrant).toBe(true);
    expect(sawBackfire).toBe(true);
  });

  it('granted Lethal Hits is consumed by the next attack', () => {
    const e = chaosVsMarines(7);
    const u = chaosUnit(e);
    u.lethalHitsNext = true;
    // attackerAbilityMods (used by shoot/fight) should consume the flag.
    const mods = (e as unknown as { attackerAbilityMods(u: UnitInstance, p: 'shooting' | 'fight'): { grantLethalHits?: boolean } }).attackerAbilityMods(u, 'shooting');
    expect(mods.grantLethalHits).toBe(true);
    expect(u.lethalHitsNext).toBe(false);
  });
});
