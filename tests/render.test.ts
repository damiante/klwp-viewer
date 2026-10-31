import { describe, expect, it } from 'vitest';
import { loopProgress } from '../src/klwp/render';

describe('loopProgress', () => {
  it('runs linearly over duration (tenths of a second), aligned to the epoch', () => {
    const a = { type: 'LOOP_FW', duration: 600, ease: 'STRAIGHT' }; // one minute
    expect(loopProgress(a, Date.UTC(2026, 9, 24, 22, 45, 0))).toBe(0);
    expect(loopProgress(a, Date.UTC(2026, 9, 24, 22, 45, 30))).toBe(50);
  });

  it('waits out the delay, then reverses every other cycle for LOOP_2W', () => {
    const a = { type: 'LOOP_2W', duration: 10, delay: 10, ease: 'STRAIGHT' }; // 2 s cycle
    expect(loopProgress(a, 500)).toBe(0);
    expect(loopProgress(a, 1500)).toBe(50);
    expect(loopProgress(a, 2000 + 1750)).toBe(25);
  });

  it('eases NORMAL in and out', () => {
    const a = { type: 'LOOP_FW', duration: 10 };
    expect(loopProgress(a, 500)).toBeCloseTo(50);
    expect(loopProgress(a, 250)).toBeCloseTo(14.64, 1);
  });
});
