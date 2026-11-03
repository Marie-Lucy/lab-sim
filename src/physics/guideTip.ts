import { GUIDE } from '../config/anatomy';
import type { VesselTree } from '../anatomy/vesselTree';
import { add, dot, normalize, rotateAbout, scale, sub, type Vec3 } from '../anatomy/vec';
import type { Cusp, GuideState } from './guide';
import type { GuideRoute } from './route';

const DEG = Math.PI / 180;

function bezier(a: Vec3, b: Vec3, c: Vec3, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(add(add(scale(a, u * u), scale(b, 2 * u * t)), scale(c, t * t)));
  }
  return out;
}

/** Direction the pre-shaped tip points to: the left cusp direction rotated about the rail. */
export function tipFacing(tree: VesselTree, tangent: Vec3, rotationDeg: number): Vec3 {
  const ref = tree.leftCuspDir;
  const perp = normalize(sub(ref, scale(tangent, dot(ref, tangent))));
  // The rail runs down the root (tangent ≈ −root axis), so +rotation about it turns the
  // tip toward the right cusp, which lies at −120° about the root axis.
  return rotateAbout(perp, tangent, rotationDeg * DEG);
}

/**
 * Centreline of the guide's curved tip beyond the body: a quadratic hook whose size is
 * limited by the local vessel radius; when engaged it ends in the left main ostium.
 */
export function guideTipPoints(tree: VesselTree, route: GuideRoute, g: GuideState, cusp: Cusp = 'left'): Vec3[] {
  const p = route.path.pointAt(g.arc);
  const t = route.path.tangentAt(g.arc, 3);
  if (g.engaged) return bezier(p, add(p, scale(t, 8)), cusp === 'left' ? tree.leftOstium : tree.rightOstium, 12);
  const inAorta = g.arc > route.aortaEntryArc;
  const radius = inAorta ? 14 : 1.2;
  const amp = Math.min(GUIDE.curveLength * 0.4, Math.max(0.3, radius - 1));
  const f = tipFacing(tree, t, g.rotationDeg);
  const reach = inAorta ? 14 : 8;
  return bezier(p, add(p, scale(t, reach)), add(add(p, scale(t, reach * 0.8)), scale(f, amp)), 12);
}
