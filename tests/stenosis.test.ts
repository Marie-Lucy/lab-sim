import { describe, expect, it } from 'vitest';
import { D1, D2, LAD, LESION } from '../src/config/anatomy';
import {
  diameterStenosis,
  ladNativeDiameter,
  ladReferenceDiameter,
  lesionBounds,
  stenosisShape,
} from '../src/anatomy/stenosis';

describe('stenosis profile', () => {
  const { start, end } = lesionBounds();

  it('is a 14 mm mid-LAD lesion between D1 and D2', () => {
    expect(end - start).toBe(14);
    expect(start).toBeGreaterThan(D1.originArc);
    expect(end).toBeLessThan(D2.originArc);
    expect(LESION.centreArc).toBeLessThan(LAD.length);
  });

  it('has a reference diameter of 2.9–3.0 mm at the lesion', () => {
    const ref = ladReferenceDiameter(LESION.centreArc);
    expect(ref).toBeGreaterThanOrEqual(2.9);
    expect(ref).toBeLessThanOrEqual(3.0);
  });

  it('is 90 % narrowed on the plateau and normal outside the lesion', () => {
    const c = LESION.centreArc;
    expect(stenosisShape(c)).toBe(1);
    expect(stenosisShape(c + LESION.plateau / 2 - 0.01)).toBe(1);
    expect(stenosisShape(start)).toBe(0);
    expect(stenosisShape(end + 5)).toBe(0);
    const mld = ladNativeDiameter(c);
    expect(diameterStenosis(mld, ladReferenceDiameter(c))).toBeCloseTo(0.9, 6);
  });

  it('tapers smoothly, monotonically and symmetrically', () => {
    let prev = 0;
    for (let x = start; x <= LESION.centreArc; x += 0.25) {
      const s = stenosisShape(x);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(s - stenosisShape(2 * LESION.centreArc - x))).toBeLessThan(1e-9);
      prev = s;
    }
    // Halfway down the taper the cosine gives exactly 0.5.
    const halfTaper = LESION.plateau / 2 + (LESION.length - LESION.plateau) / 4;
    expect(stenosisShape(LESION.centreArc + halfTaper)).toBeCloseTo(0.5, 9);
  });

  it('clamps diameter stenosis to [0, 1]', () => {
    expect(diameterStenosis(3.2, 3)).toBe(0);
    expect(diameterStenosis(0, 3)).toBe(1);
    expect(diameterStenosis(1.5, 3)).toBeCloseTo(0.5);
  });
});
