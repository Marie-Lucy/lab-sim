import { describe, expect, it } from 'vitest';
import { PHYSIOLOGY } from '../src/config/anatomy';
import {
  giveHeparin,
  heparinDoseUnits,
  initialPhysiology,
  stepPhysiology,
  type PhysiologyState,
} from '../src/physics/physiology';

function run(s: PhysiologyState, seconds: number, targetFlow: number, dt = 0.1): PhysiologyState {
  for (let t = 0; t < seconds - 1e-9; t += dt) s = stepPhysiology(s, { dt, targetFlow });
  return s;
}

describe('physiology', () => {
  it('is stable at rest with the untreated lesion (flow 0.38)', () => {
    const s = run(initialPhysiology(), 60, 0.377);
    expect(s.ischaemia).toBe(0);
    expect(s.stMm).toBe(0);
    expect(s.hr).toBe(PHYSIOLOGY.baselineHr);
  });

  it('ST rises with occlusion to full (4 mm) in ~20 s, with chest pain and tachycardia', () => {
    let s = run(initialPhysiology(), 10, 0);
    expect(s.stMm).toBeCloseTo(2, 1);
    expect(s.chestPain).toBe(true);
    s = run(s, 10, 0);
    expect(s.ischaemia).toBeCloseTo(1, 6);
    expect(s.stMm).toBeCloseTo(PHYSIOLOGY.maxStElevationMm, 6);
    expect(s.hr).toBeGreaterThan(PHYSIOLOGY.baselineHr + 20);
  });

  it('recovers after reperfusion with τ ≈ 8 s', () => {
    let s = run(initialPhysiology(), 20, 0);
    s = run(s, 8, 1);
    expect(s.ischaemia).toBeCloseTo(Math.exp(-1), 2);
    s = run(s, 40, 1);
    expect(s.stMm).toBeLessThan(0.05);
    expect(s.chestPain).toBe(false);
  });

  it('very poor flow (dissection) produces partial ischaemia', () => {
    const s = run(initialPhysiology(), 60, 0.1);
    expect(s.ischaemia).toBeCloseTo(0.6, 2);
  });

  it('occlusion > 40 s gives PVCs and BP drop; > 60 s is unstable', () => {
    let s = run(initialPhysiology(), 39, 0);
    expect(s.pvcChance).toBe(0);
    expect(s.systolic).toBe(PHYSIOLOGY.baselineSystolic);
    s = run(s, 11, 0);
    expect(s.pvcChance).toBeGreaterThan(0);
    expect(s.systolic).toBeLessThan(PHYSIOLOGY.baselineSystolic);
    expect(s.unstable).toBe(false);
    s = run(s, 11, 0);
    expect(s.unstable).toBe(true);
    expect(s.systolic).toBeCloseTo(PHYSIOLOGY.baselineSystolic - PHYSIOLOGY.maxSystolicDrop, 6);
    // Reperfusion clears instability and BP recovers.
    s = run(s, 30, 1);
    expect(s.unstable).toBe(false);
    expect(s.pvcChance).toBe(0);
    expect(s.systolic).toBeGreaterThan(PHYSIOLOGY.baselineSystolic - 1);
  });

  it('ACT goes from 128 s to ~285 s after heparin', () => {
    let s = initialPhysiology();
    expect(s.act).toBe(128);
    s = run(s, 30, 1);
    expect(s.act).toBe(128);
    s = run(giveHeparin(s), 90, 1);
    expect(s.act).toBeGreaterThan(280);
    expect(s.act).toBeLessThanOrEqual(285);
    expect(heparinDoseUnits()).toBe(8000);
  });
});
