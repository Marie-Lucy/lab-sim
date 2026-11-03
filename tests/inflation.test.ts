import { describe, expect, it } from 'vitest';
import { BALLOON, STENT } from '../src/config/anatomy';
import {
  balloonSpec,
  inflatedDiameter,
  isRupture,
  pressureStatus,
  rupturePressure,
  stentSpec,
} from '../src/physics/inflation';

describe('balloon pressure–diameter', () => {
  const b = balloonSpec(3.0, 15);

  it('reaches nominal diameter at 8 atm and grows 1.5 %/atm', () => {
    expect(inflatedDiameter(b, 8)).toBeCloseTo(3.0, 9);
    expect(inflatedDiameter(b, 10)).toBeCloseTo(3.0 * 1.03, 9);
    expect(inflatedDiameter(b, 14)).toBeCloseTo(3.0 * 1.09, 9);
    expect(inflatedDiameter(b, 6)).toBeCloseTo(3.0 * 0.97, 9);
  });

  it('is smaller while unfolding below 2 atm, continuous at 2 atm, and deflated at 0', () => {
    expect(inflatedDiameter(b, 0)).toBeCloseTo(BALLOON.deflatedDiameter, 9);
    expect(inflatedDiameter(b, 1)).toBeLessThan(inflatedDiameter(b, 2));
    expect(inflatedDiameter(b, 1.9999)).toBeCloseTo(inflatedDiameter(b, 2), 3);
    expect(inflatedDiameter(b, -3)).toBeCloseTo(BALLOON.deflatedDiameter, 9);
  });

  it('is monotonic in pressure', () => {
    let prev = 0;
    for (let p = 0; p <= 20; p += 0.1) {
      const d = inflatedDiameter(b, p);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it('warns above RBP 14 atm and ruptures at RBP + 4', () => {
    expect(pressureStatus(b, 0)).toBe('deflated');
    expect(pressureStatus(b, 1)).toBe('unfolding');
    expect(pressureStatus(b, 8)).toBe('ok');
    expect(pressureStatus(b, 14)).toBe('ok');
    expect(pressureStatus(b, 14.5)).toBe('aboveRbp');
    expect(rupturePressure(b)).toBe(18);
    expect(isRupture(b, 17.9)).toBe(false);
    expect(isRupture(b, 18)).toBe(true);
    expect(pressureStatus(b, 18)).toBe('ruptured');
  });
});

describe('stent pressure–diameter', () => {
  const s = stentSpec(3.0, 18);

  it('reaches nominal at 10 atm and grows 1.2 %/atm; RBP 16, rupture 20', () => {
    expect(inflatedDiameter(s, 10)).toBeCloseTo(3.0, 9);
    expect(inflatedDiameter(s, 12)).toBeCloseTo(3.0 * 1.024, 9);
    expect(inflatedDiameter(s, 16)).toBeCloseTo(3.0 * 1.072, 9);
    expect(inflatedDiameter(s, 0)).toBeCloseTo(STENT.deflatedDiameter, 9);
    expect(rupturePressure(s)).toBe(20);
    expect(pressureStatus(s, 16.5)).toBe('aboveRbp');
  });

  it('offers the specified size matrices', () => {
    expect(BALLOON.diameters).toEqual([2.0, 2.5, 3.0, 3.5]);
    expect(BALLOON.lengths).toEqual([12, 15, 20]);
    expect(STENT.diameters).toEqual([2.5, 2.75, 3.0, 3.5, 4.0]);
    expect(STENT.lengths).toEqual([12, 15, 18, 23, 28]);
  });
});
