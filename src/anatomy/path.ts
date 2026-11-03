import { add, cross, dot, length, lerp, normalize, perpendicular, rotateAbout, scale, sub, type Vec3 } from './vec';

/** Polyline centreline parameterised by arc length (mm). */
export class Path {
  readonly points: readonly Vec3[];
  /** Cumulative arc length at each point. */
  readonly arcs: Float64Array;
  readonly length: number;

  constructor(points: readonly Vec3[]) {
    if (points.length < 2) throw new Error('Path needs at least 2 points');
    this.points = points;
    this.arcs = new Float64Array(points.length);
    for (let i = 1; i < points.length; i++) {
      this.arcs[i] = this.arcs[i - 1]! + length(sub(points[i]!, points[i - 1]!));
    }
    this.length = this.arcs[points.length - 1]!;
  }

  /** Segment index i such that arcs[i] <= s <= arcs[i+1]. */
  private segment(s: number): number {
    let lo = 0;
    let hi = this.points.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.arcs[mid]! <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pointAt(s: number): Vec3 {
    const c = Math.min(this.length, Math.max(0, s));
    const i = this.segment(c);
    const a = this.arcs[i]!;
    const b = this.arcs[i + 1]!;
    return lerp(this.points[i]!, this.points[i + 1]!, b > a ? (c - a) / (b - a) : 0);
  }

  /** Unit tangent (direction of increasing arc), smoothed over ±h mm. */
  tangentAt(s: number, h = 1): Vec3 {
    const a = this.pointAt(Math.max(0, s - h));
    const b = this.pointAt(Math.min(this.length, s + h));
    return normalize(sub(b, a));
  }

  /** Arc length of the closest point on the path to `p`. */
  closestArc(p: Vec3): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]!;
      const ab = sub(this.points[i + 1]!, a);
      const l2 = dot(ab, ab);
      const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
      const d = length(sub(p, add(a, scale(ab, t))));
      if (d < bestD) {
        bestD = d;
        best = this.arcs[i]! + t * Math.sqrt(l2);
      }
    }
    return best;
  }

  reversed(): Path {
    return new Path([...this.points].reverse());
  }

  /** Resample at (approximately) uniform spacing. */
  resampled(spacing: number): Path {
    const n = Math.max(1, Math.round(this.length / spacing));
    const pts: Vec3[] = [];
    for (let i = 0; i <= n; i++) pts.push(this.pointAt((i / n) * this.length));
    return new Path(pts);
  }
}

export interface Frame {
  readonly point: Vec3;
  readonly tangent: Vec3;
  readonly normal: Vec3;
  readonly binormal: Vec3;
}

/**
 * Rotation-minimising (parallel transport) frames at the given arc lengths, so tube
 * cross-sections do not twist along the vessel.
 */
export function transportFrames(path: Path, arcs: readonly number[]): Frame[] {
  const frames: Frame[] = [];
  let normal: Vec3 | null = null;
  let prevT: Vec3 | null = null;
  for (const s of arcs) {
    const t = path.tangentAt(s);
    if (!normal || !prevT) {
      normal = perpendicular(t);
    } else {
      const axis = cross(prevT, t);
      const sin = length(axis);
      if (sin > 1e-8) {
        const angle = Math.atan2(sin, dot(prevT, t));
        normal = normalize(rotateAbout(normal, scale(axis, 1 / sin), angle));
      }
      // Re-orthogonalise against drift.
      normal = normalize(sub(normal, scale(t, dot(normal, t))));
    }
    frames.push({ point: path.pointAt(s), tangent: t, normal, binormal: cross(t, normal) });
    prevT = t;
  }
  return frames;
}

/** Centripetal-ish Catmull–Rom through control points, sampled every `spacing` mm. */
export function smoothPath(control: readonly Vec3[], spacing = 1): Path {
  const pts: Vec3[] = [];
  const n = control.length;
  const at = (i: number) => control[Math.min(n - 1, Math.max(0, i))]!;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const segLen = length(sub(p2, p1));
    const steps = Math.max(2, Math.ceil(segLen / spacing));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      pts.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])]);
    }
  }
  pts.push(control[n - 1]!);
  return new Path(pts);
}
