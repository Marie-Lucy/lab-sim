import { describe, expect, it } from 'vitest';
import { lesionBounds, ladReferenceDiameter } from '../src/anatomy/stenosis';
import { LESION } from '../src/config/anatomy';
import { inflatedDiameter, stentSpec } from '../src/physics/inflation';
import {
  causesOversizeDissection,
  coverageMargins,
  coveredFraction,
  deviceSpan,
  oversizeRatio,
  stentSizeVerdict,
} from '../src/physics/sizing';

const lesion = lesionBounds();
const ref = ladReferenceDiameter(LESION.centreArc);

describe('coverage margins', () => {
  it('a centred 18 mm stent covers a 14 mm lesion with 2 mm margins', () => {
    const span = deviceSpan(lesion.end + 2, 18);
    const m = coverageMargins(span, lesion);
    expect(m.proximal).toBeCloseTo(2);
    expect(m.distal).toBeCloseTo(2);
    expect(m.geographicMiss).toBe(false);
    expect(m.adequate).toBe(true);
    expect(coveredFraction(span, lesion)).toBe(1);
  });

  it('a 12 mm stent cannot cover a 14 mm lesion (geographic miss)', () => {
    const span = deviceSpan(LESION.centreArc + 6, 12);
    const m = coverageMargins(span, lesion);
    expect(m.geographicMiss).toBe(true);
    expect(m.adequate).toBe(false);
    expect(coveredFraction(span, lesion)).toBeCloseTo(12 / 14);
  });

  it('full coverage with a thin margin is not adequate', () => {
    const m = coverageMargins(deviceSpan(lesion.end + 0.5, 15), lesion);
    expect(m.geographicMiss).toBe(false);
    expect(m.proximal).toBeCloseTo(0.5);
    expect(m.adequate).toBe(false);
  });

  it('a stent placed entirely beyond the lesion covers nothing', () => {
    expect(coveredFraction(deviceSpan(lesion.end + 30, 15), lesion)).toBe(0);
  });
});

describe('oversizing', () => {
  it('3.0 stent at 12 atm is well sized; 4.0 at 16 atm dissects', () => {
    const good = inflatedDiameter(stentSpec(3.0, 18), 12);
    expect(stentSizeVerdict(oversizeRatio(good, ref))).toBe('ok');
    expect(causesOversizeDissection(good, ref)).toBe(false);

    const bad = inflatedDiameter(stentSpec(4.0, 12), 16);
    expect(stentSizeVerdict(oversizeRatio(bad, ref))).toBe('oversized');
    expect(causesOversizeDissection(bad, ref)).toBe(true);
  });

  it('flags undersized stents and the 1.2 dissection threshold exactly', () => {
    expect(stentSizeVerdict(0.9)).toBe('undersized');
    expect(causesOversizeDissection(1.2 * ref, ref)).toBe(false);
    expect(causesOversizeDissection(1.21 * ref, ref)).toBe(true);
  });
});
