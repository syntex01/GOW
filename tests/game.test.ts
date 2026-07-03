import { describe, it, expect } from 'vitest';
import type { Datasheet } from '../src/engine/types';
import { createGame, ArmyList } from '../src/engine/factory';
import { GameEngine } from '../src/engine/game';
import { computeObjectiveControl } from '../src/engine/geometry';

/* A tiny inline datasheet registry. */
const TROOPER: Datasheet = {
  id: 'trooper',
  name: 'Trooper',
  faction: 'TestFaction',
  keywords: ['Infantry'],
  statline: {
    move: 6,
    toughness: 4,
    save: 4,
    wounds: 1,
    leadership: 6,
    objectiveControl: 2,
  },
  weapons: [
    {
      id: 'rifle',
      name: 'Rifle',
      kind: 'ranged',
      range: 100, // long range so position doesn't matter
      attacks: 4,
      skill: 2, // hits on 2+ for reliable casualties
      strength: 8, // wounds the T4 target on 2+
      ap: 5, // blow through the save
      damage: 1,
      keywords: [],
    },
  ],
  abilities: [],
  composition: [{ modelName: 'Trooper', min: 5, max: 10 }],
  baseSizeMm: 32,
  isCharacter: false,
  points: 100,
};

const registry: Record<string, Datasheet> = { trooper: TROOPER };

function newGame(): GameEngine {
  const listA: ArmyList = {
    name: 'A',
    faction: 'TestFaction',
    entries: [{ datasheetId: 'trooper', modelCount: 5 }],
  };
  const listB: ArmyList = {
    name: 'B',
    faction: 'TestFaction',
    entries: [{ datasheetId: 'trooper', modelCount: 5 }],
  };
  const state = createGame(
    {
      seed: 777,
      players: {
        A: { name: 'Alice', faction: 'TestFaction' },
        B: { name: 'Bob', faction: 'TestFaction' },
      },
    },
    registry,
    listA,
    listB,
  );
  return new GameEngine(state);
}

describe('phase flow', () => {
  it('cycles command -> movement -> shooting -> charge -> fight -> end, then passes turn', () => {
    const g = newGame();
    g.startGame();
    expect(g.state.phase).toBe('command');
    expect(g.state.activePlayer).toBe('A');
    expect(g.state.round).toBe(1);

    const order = ['movement', 'shooting', 'charge', 'fight', 'end'];
    for (const ph of order) {
      g.advancePhase();
      expect(g.state.phase).toBe(ph);
    }
    // Leaving 'end' scores and passes the turn to B; still round 1 (A was first).
    g.advancePhase();
    expect(g.state.phase).toBe('command');
    expect(g.state.activePlayer).toBe('B');
    expect(g.state.round).toBe(1);
  });

  it('round increments only after both players have taken a turn', () => {
    const g = newGame();
    g.startGame();
    // Run A's full turn.
    for (let i = 0; i < 5; i++) g.advancePhase(); // -> end
    g.advancePhase(); // -> B command, round still 1
    expect(g.state.activePlayer).toBe('B');
    expect(g.state.round).toBe(1);
    // Run B's full turn.
    for (let i = 0; i < 5; i++) g.advancePhase(); // -> end
    g.advancePhase(); // -> A command, round now 2
    expect(g.state.activePlayer).toBe('A');
    expect(g.state.round).toBe(2);
  });
});

describe('command points', () => {
  it('CP increments each command phase, per active player', () => {
    const g = newGame();
    g.startGame();
    expect(g.state.players.A.commandPoints).toBe(1); // A's first command phase
    expect(g.state.players.B.commandPoints).toBe(0);

    // Finish A's turn -> B command.
    for (let i = 0; i < 6; i++) g.advancePhase();
    expect(g.state.activePlayer).toBe('B');
    expect(g.state.players.B.commandPoints).toBe(1);
    expect(g.state.players.A.commandPoints).toBe(1);

    // Finish B's turn -> A command (round 2).
    for (let i = 0; i < 6; i++) g.advancePhase();
    expect(g.state.activePlayer).toBe('A');
    expect(g.state.players.A.commandPoints).toBe(2);
  });
});

describe('shooting reduces target models', () => {
  it('A shooting B kills models (deterministic seed)', () => {
    const g = newGame();
    g.startGame();
    // Isolate the shooting mechanic: clear terrain so line of sight is open.
    g.state.terrain = [];
    const aUnit = g.unitsOf('A')[0];
    const bUnit = g.unitsOf('B')[0];
    const before = bUnit.models.filter((m) => m.alive).length;
    expect(before).toBe(5);

    const results = g.shoot(aUnit, bUnit);
    expect(results.length).toBeGreaterThan(0);
    const after = bUnit.models.filter((m) => m.alive).length;
    // 4 attacks, hit 2+, wound 2+, no save -> very likely several casualties.
    expect(after).toBeLessThan(before);
    expect(aUnit.hasShot).toBe(true);
    // Total damage should equal models lost (1W models, D1).
    const totalDmg = results.reduce((s, r) => s + r.damageInflicted, 0);
    expect(totalDmg).toBe(before - after);
  });
});

describe('scoring', () => {
  it('scoreEndOfTurn awards VP for held objectives', () => {
    const g = newGame();
    g.startGame();
    // Place A's unit squarely on the central objective; remove B from contention.
    const aUnit = g.unitsOf('A')[0];
    const bUnit = g.unitsOf('B')[0];
    const obj = g.state.objectives[0];
    aUnit.models.forEach((m, i) => {
      m.position = { x: obj.position.x + i * 0.05, y: obj.position.y };
      m.alive = true;
    });
    // Park B far away so it controls nothing.
    bUnit.models.forEach((m) => {
      m.position = { x: 0.5, y: 0.5 };
    });

    computeObjectiveControl(g.state.objectives, g.state.units);
    const held = g.state.objectives.filter((o) => o.controlledBy === 'A').length;
    expect(held).toBeGreaterThanOrEqual(1);

    const vpBefore = g.state.players.A.victoryPoints;
    g.scoreEndOfTurn();
    const vpAfter = g.state.players.A.victoryPoints;
    expect(vpAfter).toBeGreaterThan(vpBefore);
    // up to 3 objectives * 5 VP.
    expect(vpAfter - vpBefore).toBe(Math.min(held, 3) * 5);
  });

  it('no VP when holding no objectives', () => {
    const g = newGame();
    g.startGame();
    // Move everyone off objectives.
    for (const u of Object.values(g.state.units)) {
      u.models.forEach((m) => (m.position = { x: 0.5, y: 0.5 }));
    }
    g.scoreEndOfTurn();
    expect(g.state.players.A.victoryPoints).toBe(0);
  });
});

describe('determinism', () => {
  it('same seed -> identical shooting outcome', () => {
    const run = () => {
      const g = newGame();
      g.startGame();
      const a = g.unitsOf('A')[0];
      const b = g.unitsOf('B')[0];
      const res = g.shoot(a, b);
      return res.reduce((s, r) => s + r.damageInflicted, 0);
    };
    expect(run()).toBe(run());
  });
});
