import type { DiceExpr } from './types';

/**
 * Deterministic, seedable RNG (mulberry32). Determinism matters: the same seed
 * replays the same battle, which makes the engine testable and lets us verify
 * dice outcomes against known tabletop probabilities.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [1, sides]. */
  die(sides = 6): number {
    return 1 + Math.floor(this.next() * sides);
  }

  /** Roll `count` d`sides`, returning each result. */
  dice(count: number, sides = 6): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(this.die(sides));
    return out;
  }

  /** Current seed state, for snapshotting. */
  get seed(): number {
    return this.state >>> 0;
  }
}

/** Parse a dice expression into { count, sides, flat }. "2D6+3" -> {2,6,3}. */
export function parseDice(expr: DiceExpr): { count: number; sides: number; flat: number } {
  if (typeof expr === 'number') return { count: 0, sides: 0, flat: expr };
  const m = /^(\d*)[dD](\d+)([+-]\d+)?$/.exec(expr.trim());
  if (!m) {
    const n = Number(expr);
    if (!Number.isNaN(n)) return { count: 0, sides: 0, flat: n };
    throw new Error(`Unparseable dice expression: ${expr}`);
  }
  return {
    count: m[1] ? parseInt(m[1], 10) : 1,
    sides: parseInt(m[2], 10),
    flat: m[3] ? parseInt(m[3], 10) : 0,
  };
}

/** Roll a dice expression with the given RNG. */
export function rollDice(expr: DiceExpr, rng: Rng): number {
  const { count, sides, flat } = parseDice(expr);
  let total = flat;
  for (let i = 0; i < count; i++) total += rng.die(sides);
  return total;
}

/** Average (expected) value of a dice expression — used for previews and AI. */
export function averageDice(expr: DiceExpr): number {
  const { count, sides, flat } = parseDice(expr);
  return flat + count * ((sides + 1) / 2);
}

/** Maximum possible value of a dice expression. */
export function maxDice(expr: DiceExpr): number {
  const { count, sides, flat } = parseDice(expr);
  return flat + count * sides;
}
