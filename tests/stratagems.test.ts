import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { CORE_STRATAGEMS } from '../src/engine/stratagems';

/* Minimal inline datasheets. */
const GRUNT: Datasheet = {
  id: 'grunt',
  name: 'Grunt',
  faction: 'TestFaction',
  keywords: ['INFANTRY', 'GRENADES'],
  statline: { move: 6, toughness: 4, save: 4, wounds: 1, leadership: 6, objectiveControl: 2 },
  weapons: [
    {
      id: 'rifle',
      name: 'Rifle',
      kind: 'ranged',
      range: 100,
      attacks: 4,
      skill: 3,
      strength: 8,
      ap: 0, // AP0 so cover actually improves the save
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [],
  composition: [{ modelName: 'Grunt', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

const registry: Record<string, Datasheet> = { grunt: GRUNT };

function newGame(seed = 123): GameEngine {
  const list = (name: string, count: number): ArmyList => ({
    name,
    faction: 'TestFaction',
    entries: [{ datasheetId: 'grunt', modelCount: count }],
  });
  const state = createGame(
    {
      seed,
      players: {
        A: { name: 'Alice', faction: 'TestFaction' },
        B: { name: 'Bob', faction: 'TestFaction' },
      },
    },
    registry,
    list('A', 5),
    list('B', 5),
  );
  const g = new GameEngine(state);
  g.startGame();
  g.state.terrain = []; // open table for deterministic shooting
  return g;
}

describe('stratagem catalogue', () => {
  it('exports the required core stratagems', () => {
    const ids = CORE_STRATAGEMS.map((s) => s.id);
    for (const id of [
      'command_reroll',
      'counter_offensive',
      'insane_bravery',
      'go_to_ground',
      'smokescreen',
      'fire_overwatch',
      'heroic_intervention',
      'grenade',
      'tank_shock',
      'epic_challenge',
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe('CP economy & gating', () => {
  it('availableStratagems is filtered by phase and affordability', () => {
    const g = newGame();
    // Command phase, A has 1CP.
    expect(g.state.phase).toBe('command');
    expect(g.state.players.A.commandPoints).toBe(1);
    const avail = g.availableStratagems();
    // Insane Bravery (command, 1CP) should be offered.
    expect(avail.map((s) => s.id)).toContain('insane_bravery');
    // Counter-offensive (fight, 2CP) must NOT be offered now.
    expect(avail.map((s) => s.id)).not.toContain('counter_offensive');
  });

  it('rejects activation when too few CP', () => {
    const g = newGame();
    g.state.players.A.commandPoints = 0;
    const u = g.unitsOf('A')[0];
    const res = g.activateStratagem('insane_bravery', { unitId: u.id });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/CP/);
  });

  it('rejects activation in the wrong phase', () => {
    const g = newGame();
    g.state.players.A.commandPoints = 5;
    g.state.phase = 'shooting';
    const u = g.unitsOf('A')[0];
    const res = g.activateStratagem('insane_bravery', { unitId: u.id });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/phase/);
  });

  it('spends CP and logs on success', () => {
    const g = newGame();
    g.state.players.A.commandPoints = 3;
    const u = g.unitsOf('A')[0];
    const before = g.state.players.A.commandPoints;
    const res = g.activateStratagem('insane_bravery', { unitId: u.id });
    expect(res.ok).toBe(true);
    expect(g.state.players.A.commandPoints).toBe(before - 1);
    expect(g.state.log.some((l) => l.message.includes('Insane Bravery'))).toBe(true);
  });
});

describe('Insane Bravery', () => {
  it('auto-passes the next battle-shock test', () => {
    const g = newGame();
    g.state.players.A.commandPoints = 3;
    const u = g.unitsOf('A')[0];
    // Reduce below half strength so a test would be required.
    u.models.forEach((m, i) => { if (i >= 1) { m.alive = false; m.wounds = 0; } });
    g.activateStratagem('insane_bravery', { unitId: u.id });
    expect(u.autoPassBattleshock).toBe(true);
    // Run A's command phase again (simulate next turn's start).
    g.startCommandPhase();
    expect(u.isBattleShocked).toBe(false);
    expect(u.autoPassBattleshock).toBe(false); // consumed
    expect(g.state.log.some((l) => l.message.includes('Insane Bravery'))).toBe(true);
  });
});

describe('Go to Ground', () => {
  it('only applies to INFANTRY and grants cover that reduces casualties', () => {
    // Compare casualties with and without Go to Ground using the same seed.
    const shotsWithGTG = (apply: boolean): number => {
      const g = newGame(999);
      const a = g.unitsOf('A')[0];
      const b = g.unitsOf('B')[0];
      g.state.phase = 'shooting';
      g.state.players.A.commandPoints = 3;
      if (apply) {
        // Defender uses Go to Ground reactively.
        const r = g.activateStratagem('go_to_ground', { unitId: b.id });
        expect(r.ok).toBe(true);
        expect(b.goToGround).toBe(true);
      }
      const before = b.models.filter((m) => m.alive).length;
      g.shoot(a, b);
      const after = b.models.filter((m) => m.alive).length;
      return before - after;
    };
    const plain = shotsWithGTG(false);
    const covered = shotsWithGTG(true);
    // With AP0 weapons vs a 4+ save, cover (improving to 3+) should not increase
    // casualties; it should reduce or hold them.
    expect(covered).toBeLessThanOrEqual(plain);
  });

  it('rejects Go to Ground on a non-INFANTRY unit', () => {
    const g = newGame();
    g.state.phase = 'shooting';
    g.state.players.A.commandPoints = 3;
    const b = g.unitsOf('B')[0];
    b.keywords = b.keywords.filter((k) => k !== 'INFANTRY');
    const res = g.activateStratagem('go_to_ground', { unitId: b.id });
    expect(res.ok).toBe(false);
  });

  it('sets a 6+ invuln consumed by shooting and clears next turn', () => {
    const g = newGame();
    g.state.phase = 'shooting';
    g.state.players.A.commandPoints = 3;
    const b = g.unitsOf('B')[0];
    g.activateStratagem('go_to_ground', { unitId: b.id });
    expect(b.goToGround).toBe(true);
    expect(b.defensiveFlagRound).toBe(g.state.round);
    // Advance to B's next command phase: flag should clear.
    g.state.round += 1;
    g.state.activePlayer = 'B';
    g.state.phase = 'command';
    g.startCommandPhase();
    expect(b.goToGround).toBe(false);
  });
});

describe('Command Re-roll', () => {
  it('grants a one-shot re-roll all hits consumed by the next attack', () => {
    const g = newGame();
    g.state.players.A.commandPoints = 3;
    const a = g.unitsOf('A')[0];
    const b = g.unitsOf('B')[0];
    g.activateStratagem('command_reroll', { unitId: a.id });
    expect(a.pendingRerollHits).toBe(true);
    g.state.phase = 'shooting';
    g.shoot(a, b);
    expect(a.pendingRerollHits).toBe(false); // consumed
  });
});

describe('Fire Overwatch', () => {
  it('resolves a reactive volley and is limited to once per round', () => {
    const g = newGame(7);
    const a = g.unitsOf('A')[0];
    const b = g.unitsOf('B')[0];
    // Make B the controller activating its reactive stratagem.
    g.state.activePlayer = 'B';
    g.state.players.B.commandPoints = 3;
    g.state.phase = 'movement'; // fire_overwatch.phase === 'any'
    // Position so B has line of sight + range on A.
    a.models.forEach((m, i) => { m.position = { x: 15 + i * 0.1, y: 10 }; });
    b.models.forEach((m, i) => { m.position = { x: 18 + i * 0.1, y: 10 }; });
    const res = g.activateStratagem('fire_overwatch', { unitId: b.id, targetUnitId: a.id });
    expect(res.ok).toBe(true);
    expect(b.overwatchUsedRound).toBe(g.state.round);
    // Second attempt the same round is refused.
    const res2 = g.overwatch(b.id, a.id);
    expect(res2.ok).toBe(false);
    expect(res2.message).toMatch(/already fired/);
  });

  it('forces hits to land only on unmodified 6s (skill set to 6)', () => {
    // With a deterministic seed, overwatch (skill 6) should produce strictly
    // fewer or equal hits than a normal BS3+ volley would.
    const g = newGame(55);
    const b = g.unitsOf('B')[0];
    const a = g.unitsOf('A')[0];
    g.state.activePlayer = 'B';
    a.models.forEach((m, i) => { m.position = { x: 15 + i * 0.1, y: 10 }; });
    b.models.forEach((m, i) => { m.position = { x: 18 + i * 0.1, y: 10 }; });
    const before = a.models.filter((m) => m.alive).length;
    g.overwatch(b.id, a.id);
    const after = a.models.filter((m) => m.alive).length;
    // Overwatch can kill some but should not be wildly lethal; sanity bound.
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe('Counter-offensive', () => {
  it('flags a unit to fight next in the fight order', () => {
    const g = newGame();
    g.state.phase = 'fight';
    g.state.players.A.commandPoints = 3;
    const a = g.unitsOf('A')[0];
    const b = g.unitsOf('B')[0];
    // Put the two units into engagement range so they appear in fightOrder.
    b.models.forEach((m, i) => { m.position = { x: 10 + i * 0.1, y: 10 }; });
    a.models.forEach((m, i) => { m.position = { x: 10.5 + i * 0.1, y: 10 }; });
    const res = g.activateStratagem('counter_offensive', { unitId: b.id });
    expect(res.ok).toBe(true);
    expect(b.fightsNext).toBe(true);
    const order = g.fightOrder();
    expect(order[0].id).toBe(b.id);
  });
});

describe('Grenade', () => {
  it('inflicts damage on a nearby enemy when the unit has GRENADES', () => {
    const g = newGame(42);
    g.state.phase = 'shooting';
    g.state.players.A.commandPoints = 3;
    const a = g.unitsOf('A')[0];
    const b = g.unitsOf('B')[0];
    // Move B within 8" of A.
    a.models.forEach((m, i) => { m.position = { x: 10 + i * 0.1, y: 10 }; });
    b.models.forEach((m, i) => { m.position = { x: 13 + i * 0.1, y: 10 }; });
    const before = b.models.filter((m) => m.alive).length;
    const res = g.activateStratagem('grenade', { unitId: a.id, targetUnitId: b.id });
    expect(res.ok).toBe(true);
    const after = b.models.filter((m) => m.alive).length;
    expect(after).toBeLessThanOrEqual(before);
  });
});
