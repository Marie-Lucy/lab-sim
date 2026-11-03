import { describe, expect, it } from 'vitest';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { lesionBounds } from '../src/anatomy/stenosis';
import { computeFlow, flowAt, topoOrder } from '../src/physics/flowModel';
import { measureQca } from '../src/procedure/qca';
import { LumenTreatment, taperWeight } from '../src/physics/treatment';

describe('flow model', () => {
  const tree = buildVesselTree();

  it('orders parents before children', () => {
    const o = topoOrder(tree);
    expect(o.indexOf('lm')).toBeLessThan(o.indexOf('lad'));
    expect(o.indexOf('lad')).toBeLessThan(o.indexOf('d2'));
  });

  it('untreated: flow 1 before the lesion, 0.38 (TIMI 2) beyond it, inherited by D2', () => {
    const f = computeFlow(tree, [], []);
    expect(flowAt(f, tree, 'lad', 20)).toBe(1);
    expect(flowAt(f, tree, 'lad', 80)).toBeCloseTo(0.377, 2);
    expect(f.timi).toBe(2);
    expect(f.factor.d1[10]).toBe(1);
    expect(f.factor.d2[10]).toBeCloseTo(0.377, 2);
    expect(f.factor.lcx[100]).toBe(1);
  });

  it('a dissection penalises downstream flow until it is sealed', () => {
    const t = new LumenTreatment(tree);
    const d = t.addDissection({ vessel: 'lad', from: 60, to: 68 }, 'edge');
    expect(d.sealed).toBe(false);
    let f = computeFlow(tree, [], t.dissections);
    expect(flowAt(f, tree, 'lad', 59)).toBeCloseTo(0.377, 2);
    expect(flowAt(f, tree, 'lad', 80)).toBeCloseTo(0.377 * 0.45, 2);
    t.addStent({ vessel: 'lad', from: 58, to: 70, diameter: 3 });
    expect(t.dissections[0]!.sealed).toBe(true);
    f = computeFlow(tree, [], t.dissections);
    expect(flowAt(f, tree, 'lad', 80)).toBeCloseTo(0.377, 2);
  });

  it('taper weight eases in over 2 mm at each end', () => {
    expect(taperWeight(10, 10, 20)).toBe(0);
    expect(taperWeight(11, 10, 20)).toBeCloseTo(0.5);
    expect(taperWeight(15, 10, 20)).toBe(1);
    expect(taperWeight(21, 10, 20)).toBe(0);
  });
});

describe('QCA', () => {
  it('measures the native lesion', () => {
    const tree = buildVesselTree();
    const q = measureQca(tree.vessels.lad.lumen);
    expect(q.referenceDiameter).toBeCloseTo(2.95, 1);
    expect(q.mld).toBeCloseTo(0.295, 2);
    expect(q.ds).toBeCloseTo(0.9, 2);
    const { start, end } = lesionBounds();
    expect(q.lesionLength).toBeGreaterThan(12.5);
    expect(q.lesionLength).toBeLessThanOrEqual(end - start);
  });
});
