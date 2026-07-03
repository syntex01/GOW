import { describe, it, expect } from 'vitest';
import { woundThreshold } from '../src/engine/combat';

/**
 * Tabletop wound chart:
 *   S >= 2T            -> 2+
 *   S  > T  (but <2T)  -> 3+
 *   S == T             -> 4+
 *   S  < T (but >T/2)  -> 5+
 *   S*2 <= T           -> 6+
 */
describe('woundThreshold full chart', () => {
  it('S >= 2T -> 2+', () => {
    expect(woundThreshold(8, 4)).toBe(2); // exactly double
    expect(woundThreshold(10, 4)).toBe(2); // more than double
    expect(woundThreshold(6, 3)).toBe(2);
  });

  it('S > T (less than double) -> 3+', () => {
    expect(woundThreshold(5, 4)).toBe(3);
    expect(woundThreshold(7, 4)).toBe(3); // 7 < 8 so not double
    expect(woundThreshold(4, 3)).toBe(3);
  });

  it('S == T -> 4+', () => {
    expect(woundThreshold(4, 4)).toBe(4);
    expect(woundThreshold(1, 1)).toBe(4);
    expect(woundThreshold(10, 10)).toBe(4);
  });

  it('S < T but more than half -> 5+', () => {
    expect(woundThreshold(3, 4)).toBe(5); // 3 > 2 (half of 4)
    expect(woundThreshold(3, 5)).toBe(5); // 3 > 2.5
    expect(woundThreshold(5, 8)).toBe(5); // 5 > 4
  });

  it('S*2 <= T -> 6+', () => {
    expect(woundThreshold(2, 4)).toBe(6); // exactly half
    expect(woundThreshold(2, 5)).toBe(6); // less than half
    expect(woundThreshold(4, 8)).toBe(6); // exactly half
    expect(woundThreshold(1, 10)).toBe(6);
  });

  it('boundary: S just above half vs exactly half', () => {
    // T=4: S=2 -> 6+ (exactly half), S=3 -> 5+ (above half)
    expect(woundThreshold(2, 4)).toBe(6);
    expect(woundThreshold(3, 4)).toBe(5);
    // T=6: S=3 -> 6+ (half), S=4 -> 5+, S=6 -> 4+, S=7 -> 3+, S=12 -> 2+
    expect(woundThreshold(3, 6)).toBe(6);
    expect(woundThreshold(4, 6)).toBe(5);
    expect(woundThreshold(6, 6)).toBe(4);
    expect(woundThreshold(7, 6)).toBe(3);
    expect(woundThreshold(12, 6)).toBe(2);
  });
});
