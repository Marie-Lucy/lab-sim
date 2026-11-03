import { describe, expect, it } from 'vitest';
import { AORTA, D1, D2, HEART, LAD, LCX, LEFT_MAIN, LESION, RCA, ACCESS } from '../src/config/anatomy';
import {
  beatContraction,
  beatScale,
  grooveFat,
  heartFrame,
  heartLocalPoint,
  heartWorldNormal,
  heartWorldPoint,
} from '../src/anatomy/heartShape';
import { diameterStenosis, lesionBounds } from '../src/anatomy/stenosis';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { distance, dot, length, normalize, sub } from '../src/anatomy/vec';

const tree = buildVesselTree();
const V = tree.vessels;

describe('heart shape', () => {
  it('is tilted with the apex left, down and forward', () => {
    const f = heartFrame();
    const apex = heartWorldPoint(f, 0, Math.PI);
    expect(apex[0]).toBeGreaterThan(20);
    expect(apex[1]).toBeLessThan(-20);
    expect(apex[2]).toBeGreaterThan(20);
  });

  it('has a flattened base, a narrowed apex and an RV bulge', () => {
    const { long, wide } = HEART.semiAxes;
    expect(heartLocalPoint(0, 0.05)[1]).toBeCloseTo(long * (1 - HEART.baseFlatten));
    const nearApex = heartLocalPoint(Math.PI / 2, 2.6)[0];
    expect(nearApex).toBeLessThan(wide * Math.sin(2.6));
    const rv = (HEART.rvThetaDeg * Math.PI) / 180;
    const r = (t: number) => Math.hypot(heartLocalPoint(t, Math.PI / 2)[0] / wide, heartLocalPoint(t, Math.PI / 2)[2] / HEART.semiAxes.deep);
    expect(r(rv)).toBeGreaterThan(r(rv + Math.PI));
  });

  it('normals point outward', () => {
    const f = heartFrame();
    for (const [t, p] of [[0, 1.2], [2, 1.8], [-2, 2.4]] as const) {
      const n = heartWorldNormal(f, t, p);
      expect(dot(n, normalize(sub(heartWorldPoint(f, t, p), f.centre)))).toBeGreaterThan(0.2);
    }
  });

  it('has fat in the AV and interventricular grooves, not on the free wall', () => {
    const iv = (HEART.ivGrooveThetaDeg * Math.PI) / 180;
    expect(grooveFat(1.2, HEART.avGroovePhi)).toBeGreaterThan(0.9);
    expect(grooveFat(iv, 1.8)).toBeGreaterThan(0.8);
    expect(grooveFat(iv + 1.2, 1.8)).toBeLessThan(0.05);
  });

  it('contracts only during systole (38 % of the cycle), peaking mid-systole', () => {
    expect(beatContraction(0)).toBe(0);
    expect(beatContraction(HEART.systoleFraction / 2)).toBeCloseTo(1);
    expect(beatContraction(0.5)).toBe(0);
    expect(beatContraction(0.9)).toBe(0);
    expect(beatContraction(1.19)).toBeCloseTo(1);
    expect(beatScale(1)).toBeCloseTo(1 - HEART.contractionAmplitude);
  });
});

describe('vessel tree', () => {
  it('builds every vessel with its configured length', () => {
    expect(V.lm.path.length).toBeCloseTo(LEFT_MAIN.length, 1);
    expect(V.lad.path.length).toBeCloseTo(LAD.length, 0);
    expect(V.lcx.path.length).toBeCloseTo(LCX.length, 0);
    expect(Math.abs(V.d1.path.length - D1.length)).toBeLessThan(1);
    expect(Math.abs(V.d2.path.length - D2.length)).toBeLessThan(1);
    expect(Math.abs(V.rca.path.length - RCA.length)).toBeLessThan(1);
  });

  it('connects the tree: LM → LAD/LCx at the bifurcation, diagonals on the LAD', () => {
    const lmEnd = V.lm.path.pointAt(V.lm.path.length);
    expect(distance(lmEnd, V.lad.path.pointAt(0))).toBeLessThan(0.01);
    expect(distance(lmEnd, V.lcx.path.pointAt(0))).toBeLessThan(0.01);
    expect(distance(V.d1.path.pointAt(0), V.lad.path.pointAt(D1.originArc))).toBeLessThan(0.01);
    expect(distance(V.d2.path.pointAt(0), V.lad.path.pointAt(D2.originArc))).toBeLessThan(0.01);
    expect(V.d1.parent).toBe('lad');
    expect(V.lad.parent).toBe('lm');
  });

  it('puts both ostia on the aortic root wall, the left one at the LM start', () => {
    expect(distance(tree.leftOstium, V.lm.path.pointAt(0))).toBeLessThan(1e-9);
    expect(distance(tree.rightOstium, V.rca.path.pointAt(0))).toBeLessThan(1e-6);
    const onAxis = (p: readonly [number, number, number]) => {
      const d = sub(p, tree.valveCentre);
      const along = dot(d, tree.rootAxis);
      return { along, radial: length(sub(d, tree.rootAxis.map((a) => a * along) as unknown as typeof d)) };
    };
    for (const o of [tree.leftOstium, tree.rightOstium]) {
      const { along, radial } = onAxis(o);
      expect(along).toBeCloseTo(AORTA.ostiumHeight, 6);
      expect(radial).toBeCloseTo(AORTA.rootDiameter / 2, 6);
    }
  });

  it('runs the LAD from the base down to near the apex', () => {
    const apex = heartWorldPoint(tree.frame, 0, Math.PI);
    expect(distance(V.lad.path.pointAt(LAD.length), apex)).toBeLessThan(25);
  });

  it('has the 90 % lesion at mid-LAD between D1 and D2 in the lumen profile', () => {
    const min = V.lad.lumen.minimum();
    const { start, end } = lesionBounds();
    expect(min.arc).toBeGreaterThan(start);
    expect(min.arc).toBeLessThan(end);
    expect(min.arc).toBeGreaterThan(D1.originArc);
    expect(min.arc).toBeLessThan(D2.originArc);
    expect(diameterStenosis(min.diameter, V.lad.lumen.referenceAt(min.arc))).toBeCloseTo(LESION.severity, 2);
    expect(V.lad.lumen.diameterAt(10)).toBeCloseTo(V.lad.lumen.referenceAt(10), 9);
  });

  it('runs the access path from the wrist (arc 0) into the aortic arch', () => {
    const names = tree.accessSegments.map((s) => s.name);
    expect(names).toEqual(['radial', 'brachial', 'axillary', 'subclavian', 'brachiocephalic']);
    const total = ACCESS.segments.reduce((a, s) => a + s.length, 0);
    expect(Math.abs(V.access.path.length - total) / total).toBeLessThan(0.05);
    tree.accessSegments.forEach((s, i) => {
      expect(Math.abs(s.end - s.start - ACCESS.segments[i]!.length)).toBeLessThan(20);
    });
    const end = V.access.path.pointAt(V.access.path.length);
    expect(distance(end, V.aorta.path.pointAt(AORTA.brachiocephalicArc))).toBeLessThan(0.01);
    // Wrist is far below and to the patient's right of the heart.
    const wrist = V.access.path.pointAt(0);
    expect(wrist[0]).toBeLessThan(-200);
    expect(wrist[1]).toBeLessThan(-200);
    expect(V.access.lumen.diameterAt(50)).toBeCloseTo(2.6);
  });

  it('marks coronaries (not the aorta or arm) as beating with the heart', () => {
    expect(V.lad.beats && V.lm.beats && V.rca.beats).toBe(true);
    expect(V.aorta.beats || V.access.beats).toBe(false);
  });
});
