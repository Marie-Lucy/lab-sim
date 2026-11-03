import { describe, expect, it } from 'vitest';
import { CONTRAST } from '../src/config/anatomy';
import { lesionBounds } from '../src/anatomy/stenosis';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { computeFlow } from '../src/physics/flowModel';
import { LumenTreatment } from '../src/physics/treatment';
import { arrivalAt, cineLength, contrastDensity, NEVER, planInjection, stainDensity } from '../src/physics/contrast';

const { start, end } = lesionBounds();

function setup() {
  const tree = buildVesselTree();
  const t = new LumenTreatment(tree);
  return { tree, t };
}

/** Seconds per mm of LAD between two arcs. */
function pace(plan: ReturnType<typeof planInjection>, tree: ReturnType<typeof buildVesselTree>, a: number, b: number) {
  return (arrivalAt(plan, tree, 'lad', b) - arrivalAt(plan, tree, 'lad', a)) / (b - a);
}

describe('contrast transit', () => {
  it('fills the LAD at the coronary front speed before the lesion and slower beyond it', () => {
    const { tree } = setup();
    const plan = planInjection(tree, computeFlow(tree, [], []), 'selective');
    const before = pace(plan, tree, 5, 25);
    const after = pace(plan, tree, end + 5, end + 30);
    expect(before).toBeCloseTo(1 / CONTRAST.coronaryFrontSpeed, 5);
    expect(after).toBeCloseTo(1 / (CONTRAST.coronaryFrontSpeed * 0.377), 3);
    expect(after).toBeGreaterThan(before * 2.5);
  });

  it('stops behind an inflated balloon — D2 too, D1 not', () => {
    const { tree } = setup();
    const flow = computeFlow(tree, [{ vessel: 'lad', from: start - 1, to: end + 1 }], []);
    const plan = planInjection(tree, flow, 'selective');
    expect(arrivalAt(plan, tree, 'lad', start - 3)).toBeLessThan(1);
    expect(arrivalAt(plan, tree, 'lad', end + 10)).toBe(NEVER);
    expect(arrivalAt(plan, tree, 'd2', 10)).toBe(NEVER);
    expect(arrivalAt(plan, tree, 'd1', 10)).toBeLessThan(1);
    expect(arrivalAt(plan, tree, 'lcx', 40)).toBeLessThan(1);
  });

  it('recovers normal speed after stenting', () => {
    const { tree, t } = setup();
    t.addStent({ vessel: 'lad', from: start - 2, to: end + 2, diameter: 3.07 });
    t.apply('lad');
    const plan = planInjection(tree, computeFlow(tree, [], t.dissections), 'selective');
    expect(pace(plan, tree, end + 5, end + 30)).toBeCloseTo(1 / CONTRAST.coronaryFrontSpeed, 5);
  });

  it('an unsealed dissection slows downstream filling ×1/0.45; sealing restores it', () => {
    const { tree, t } = setup();
    t.addStent({ vessel: 'lad', from: start - 2, to: end + 2, diameter: 3.07 });
    t.apply('lad');
    t.addDissection({ vessel: 'lad', from: end + 3, to: end + 11 }, 'edge');
    let plan = planInjection(tree, computeFlow(tree, [], t.dissections), 'selective');
    expect(pace(plan, tree, end + 15, end + 40)).toBeCloseTo(1 / (CONTRAST.coronaryFrontSpeed * 0.45), 4);
    t.addStent({ vessel: 'lad', from: end, to: end + 14, diameter: 3 });
    plan = planInjection(tree, computeFlow(tree, [], t.dissections), 'selective');
    expect(pace(plan, tree, end + 15, end + 40)).toBeCloseTo(1 / CONTRAST.coronaryFrontSpeed, 5);
  });

  it('selective fills the left system with slight aortic reflux; aortic flush fills everything', () => {
    const { tree } = setup();
    const flow = computeFlow(tree, [], []);
    const sel = planInjection(tree, flow, 'selective');
    expect(sel.intensity.lad).toBe(1);
    expect(sel.intensity.rca).toBe(0);
    expect(sel.intensity.aorta).toBe(CONTRAST.aorticReflux);
    expect(arrivalAt(sel, tree, 'rca', 10)).toBe(NEVER);
    expect(arrivalAt(sel, tree, 'aorta', 100)).toBe(NEVER);
    expect(sel.volumeMl).toBe(8);
    const ao = planInjection(tree, flow, 'aortic');
    expect(ao.intensity.aorta).toBe(1);
    expect(ao.intensity.rca).toBeGreaterThan(0);
    expect(arrivalAt(ao, tree, 'rca', 10)).toBeLessThan(1);
    expect(arrivalAt(ao, tree, 'aorta', 200)).toBeCloseTo(200 / CONTRAST.aorticFrontSpeed, 2);
    expect(ao.volumeMl).toBe(20);
  });

  it('cine length adapts to the slowest filling within 3–9 s', () => {
    const { tree, t } = setup();
    const slow = planInjection(tree, computeFlow(tree, [], []), 'selective');
    t.addStent({ vessel: 'lad', from: start - 2, to: end + 2, diameter: 3.07 });
    t.apply('lad');
    const fast = planInjection(tree, computeFlow(tree, [], t.dissections), 'selective');
    expect(slow.cineLength).toBeGreaterThan(fast.cineLength);
    for (const p of [slow, fast]) {
      expect(p.cineLength).toBeGreaterThanOrEqual(CONTRAST.cineMinS);
      expect(p.cineLength).toBeLessThanOrEqual(CONTRAST.cineMaxS);
    }
    const arr = { lad: new Float32Array([0, 30]) } as never;
    expect(cineLength(arr, { lad: 1 } as never, 1.5)).toBe(CONTRAST.cineMaxS);
  });

  it('dye is present between the front and the washout tail; stains linger', () => {
    expect(contrastDensity(1, 0.9, 1.5)).toBe(0);
    expect(contrastDensity(1, 1.5, 1.5)).toBe(1);
    expect(contrastDensity(1, 1 + 1.5 + CONTRAST.washoutS + 0.01, 1.5)).toBe(0);
    expect(contrastDensity(NEVER, 5, 1.5)).toBe(0);
    const t = 1 + 1.5 + CONTRAST.washoutS + 0.5;
    expect(contrastDensity(1, t, 1.5)).toBe(0);
    expect(stainDensity(1, t, 1.5)).toBeGreaterThan(0.5);
  });
});
