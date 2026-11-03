import { describe, expect, it } from 'vitest';
import { LumenProfile } from '../src/anatomy/lumen';
import { Path, smoothPath, transportFrames } from '../src/anatomy/path';
import { cross, dot, length, sub, type Vec3 } from '../src/anatomy/vec';

describe('Path', () => {
  const p = new Path([
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
  ]);

  it('is parameterised by arc length', () => {
    expect(p.length).toBe(20);
    expect(p.pointAt(5)).toEqual([5, 0, 0]);
    expect(p.pointAt(15)).toEqual([10, 5, 0]);
    expect(p.pointAt(-3)).toEqual([0, 0, 0]);
    expect(p.pointAt(99)).toEqual([10, 10, 0]);
  });

  it('finds the closest arc to a point', () => {
    expect(p.closestArc([4, 3, 0])).toBeCloseTo(4);
    expect(p.closestArc([13, 12, 0])).toBeCloseTo(20);
  });

  it('reverses and resamples without changing length', () => {
    expect(p.reversed().pointAt(0)).toEqual([10, 10, 0]);
    const r = p.resampled(1);
    expect(r.length).toBeCloseTo(20, 6);
    expect(r.points.length).toBe(21);
  });

  it('smoothPath passes through its control points', () => {
    const ctrl: Vec3[] = [
      [0, 0, 0],
      [20, 5, 0],
      [40, 0, 10],
    ];
    const s = smoothPath(ctrl, 0.5);
    for (const c of ctrl) expect(length(sub(s.pointAt(s.closestArc(c)), c))).toBeLessThan(1e-6);
  });

  it('transport frames are orthonormal and do not flip', () => {
    const helix: Vec3[] = [];
    for (let i = 0; i <= 200; i++) helix.push([10 * Math.cos(i / 20), 10 * Math.sin(i / 20), i * 0.5]);
    const h = new Path(helix);
    const arcs = Array.from({ length: 60 }, (_, i) => (i / 59) * h.length);
    const frames = transportFrames(h, arcs);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      expect(Math.abs(dot(f.tangent, f.normal))).toBeLessThan(1e-6);
      expect(length(f.normal)).toBeCloseTo(1, 6);
      expect(length(sub(cross(f.tangent, f.normal), f.binormal))).toBeLessThan(1e-9);
      if (i > 0) expect(dot(f.normal, frames[i - 1]!.normal)).toBeGreaterThan(0.8);
    }
  });
});

describe('LumenProfile', () => {
  it('interpolates and finds the minimum lumen', () => {
    const l = new LumenProfile(10, () => 3, (s) => (s === 5 ? 1 : 3 - Math.abs(s - 5) * 0.1));
    expect(l.referenceAt(7.3)).toBe(3);
    expect(l.minimum().arc).toBeCloseTo(5);
    expect(l.minimum().diameter).toBeCloseTo(1);
    expect(l.diameterAt(5.125)).toBeCloseTo((1 + (3 - 0.025)) / 2, 6);
  });
});
