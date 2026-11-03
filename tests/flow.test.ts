import { describe, expect, it } from 'vitest';
import { flowFactor, timiGrade } from '../src/physics/flow';

describe('flowFactor / TIMI', () => {
  it('is 1 below 60 % and 0 at ≥ 98 %', () => {
    expect(flowFactor(0)).toBe(1);
    expect(flowFactor(0.5)).toBe(1);
    expect(flowFactor(0.6)).toBe(1);
    expect(flowFactor(0.98)).toBe(0);
    expect(flowFactor(1)).toBe(0);
  });

  it('is monotonically non-increasing and falls faster near occlusion', () => {
    let prev = 1;
    for (let ds = 0; ds <= 1; ds += 0.005) {
      const f = flowFactor(ds);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
    const early = flowFactor(0.65) - flowFactor(0.7);
    const late = flowFactor(0.9) - flowFactor(0.95);
    expect(late).toBeGreaterThan(early);
  });

  it('TIMI grade is monotonic in flow', () => {
    let prev = 0;
    for (let f = 0; f <= 1; f += 0.01) {
      const g = timiGrade(f);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(timiGrade(1)).toBe(3);
    expect(timiGrade(0.8)).toBe(3);
    expect(timiGrade(0.25)).toBe(2);
    expect(timiGrade(0.03)).toBe(1);
    expect(timiGrade(0.02)).toBe(0);
  });

  it('the untreated 90 % lesion gives TIMI 2', () => {
    expect(timiGrade(flowFactor(0.9))).toBe(2);
  });

  it('a normal or well-stented vessel gives TIMI 3, an occlusion TIMI 0', () => {
    expect(timiGrade(flowFactor(0.05))).toBe(3);
    expect(timiGrade(flowFactor(1))).toBe(0);
  });
});
