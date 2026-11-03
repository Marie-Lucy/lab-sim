import { describe, expect, it } from 'vitest';
import { buildDebrief, type CaseSummary } from '../src/procedure/debrief';

const ideal: CaseSummary = {
  stagesCompleted: 6,
  stagesTotal: 6,
  physiology: null,
  optimisation: null,
  residualStenosis: 0.02,
  finalTimi: 3,
  referenceDiameter: 2.95,
  stentDiameter: 3.07,
  coverage: { proximal: 2, distal: 2 },
  stentsDeployed: 1,
  stentsNeeded: 1,
  heparinBeforeWire: true,
  preDilated: true,
  qcaUsed: true,
  dissection: 'none',
  wireForcingS: 0,
  balloonRuptures: 0,
  longestInflationS: 14,
  contrastMl: 64,
  fluoroS: 240,
  finalViews: 2,
};

describe('buildDebrief', () => {
  it('an ideal case scores 100 and is Excellent with all items ok', () => {
    const d = buildDebrief(ideal);
    expect(d.score).toBe(100);
    expect(d.grade).toBe('Excellent');
    expect(d.items.every((i) => i.status === 'ok')).toBe(true);
    expect(d.items.length).toBe(15);
    expect(d.items.every((i) => i.teaching.length > 20)).toBe(true);
  });

  it('an oversized short stent with edge dissection is "Needs work"', () => {
    const d = buildDebrief({
      ...ideal,
      residualStenosis: 0.35,
      finalTimi: 1,
      stentDiameter: 4.29,
      coverage: { proximal: -1, distal: -1 },
      dissection: 'unsealed',
      longestInflationS: 25,
    });
    expect(d.grade).toBe('Needs work');
    expect(d.score).toBeLessThan(60);
    const byId = Object.fromEntries(d.items.map((i) => [i.id, i]));
    expect(byId.coverage!.status).toBe('bad');
    expect(byId.coverage!.value).toMatch(/geographic miss/);
    expect(byId.stentSize!.status).toBe('bad');
    expect(byId.dissection!.status).toBe('bad');
  });

  it('minor issues give warns and a Good grade', () => {
    const d = buildDebrief({
      ...ideal,
      coverage: { proximal: 1, distal: 2 },
      dissection: 'sealed',
      stentsDeployed: 2,
      contrastMl: 150,
      longestInflationS: 40,
    });
    expect(d.items.filter((i) => i.status === 'warn').length).toBe(5);
    // 5 + 5 + 2 + 1.5 + 2 = 15.5 lost → 85 (rounded from 84.5)
    expect(d.score).toBe(85);
    expect(d.grade).toBe('Good');
  });

  it('an unfinished case is Incomplete regardless of score', () => {
    const d = buildDebrief({ ...ideal, stagesCompleted: 3 });
    expect(d.grade).toBe('Incomplete');
  });

  it('a case with no stent and no heparin scores very low', () => {
    const d = buildDebrief({
      ...ideal,
      residualStenosis: null,
      finalTimi: 2,
      stentDiameter: null,
      coverage: null,
      stentsDeployed: 0,
      heparinBeforeWire: false,
      finalViews: 0,
    });
    expect(d.score).toBeLessThan(50);
  });
});
