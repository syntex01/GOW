import { describe, it, expect } from 'vitest';
import { Rng, parseDice, rollDice, averageDice, maxDice } from '../src/engine/dice';

describe('parseDice', () => {
  it('parses "D6"', () => {
    expect(parseDice('D6')).toEqual({ count: 1, sides: 6, flat: 0 });
  });
  it('parses "2D6"', () => {
    expect(parseDice('2D6')).toEqual({ count: 2, sides: 6, flat: 0 });
  });
  it('parses "D3"', () => {
    expect(parseDice('D3')).toEqual({ count: 1, sides: 3, flat: 0 });
  });
  it('parses "D6+1"', () => {
    expect(parseDice('D6+1')).toEqual({ count: 1, sides: 6, flat: 1 });
  });
  it('parses "D6-2" (negative flat)', () => {
    expect(parseDice('D6-2')).toEqual({ count: 1, sides: 6, flat: -2 });
  });
  it('parses a flat string number "6"', () => {
    expect(parseDice('6')).toEqual({ count: 0, sides: 0, flat: 6 });
  });
  it('parses a numeric literal', () => {
    expect(parseDice(6)).toEqual({ count: 0, sides: 0, flat: 6 });
  });
  it('throws on garbage', () => {
    expect(() => parseDice('hello')).toThrow();
  });
});

describe('averageDice', () => {
  it('D6 -> 3.5', () => expect(averageDice('D6')).toBeCloseTo(3.5));
  it('2D6 -> 7', () => expect(averageDice('2D6')).toBeCloseTo(7));
  it('D3 -> 2', () => expect(averageDice('D3')).toBeCloseTo(2));
  it('D6+1 -> 4.5', () => expect(averageDice('D6+1')).toBeCloseTo(4.5));
  it('flat 6 -> 6', () => expect(averageDice(6)).toBe(6));
});

describe('maxDice', () => {
  it('D6 -> 6', () => expect(maxDice('D6')).toBe(6));
  it('2D6 -> 12', () => expect(maxDice('2D6')).toBe(12));
  it('D3 -> 3', () => expect(maxDice('D3')).toBe(3));
  it('D6+1 -> 7', () => expect(maxDice('D6+1')).toBe(7));
  it('flat 6 -> 6', () => expect(maxDice(6)).toBe(6));
});

describe('Rng determinism', () => {
  it('same seed -> same sequence', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds -> different sequences (overwhelmingly likely)', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('die() always in [1, sides]', () => {
    const r = new Rng(99);
    for (let i = 0; i < 5000; i++) {
      const d = r.die(6);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  it('next() always in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 5000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('rollDice distribution', () => {
  it('D6 mean within bounds (~3.5) over many rolls', () => {
    const r = new Rng(2024);
    const N = 60000;
    let sum = 0;
    const counts = new Array(7).fill(0);
    for (let i = 0; i < N; i++) {
      const v = rollDice('D6', r);
      sum += v;
      counts[v]++;
    }
    const mean = sum / N;
    expect(mean).toBeGreaterThan(3.4);
    expect(mean).toBeLessThan(3.6);
    // Each face roughly 1/6 of the time.
    for (let face = 1; face <= 6; face++) {
      const freq = counts[face] / N;
      expect(freq).toBeGreaterThan(1 / 6 - 0.02);
      expect(freq).toBeLessThan(1 / 6 + 0.02);
    }
  });

  it('2D6 mean within bounds (~7) and range [2,12]', () => {
    const r = new Rng(555);
    const N = 60000;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < N; i++) {
      const v = rollDice('2D6', r);
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    const mean = sum / N;
    expect(mean).toBeGreaterThan(6.85);
    expect(mean).toBeLessThan(7.15);
    expect(min).toBe(2);
    expect(max).toBe(12);
  });

  it('D6+1 mean ~4.5', () => {
    const r = new Rng(31);
    const N = 40000;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += rollDice('D6+1', r);
    const mean = sum / N;
    expect(mean).toBeGreaterThan(4.4);
    expect(mean).toBeLessThan(4.6);
  });
});
