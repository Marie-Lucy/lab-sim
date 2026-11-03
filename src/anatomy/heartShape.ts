import { HEART } from '../config/anatomy';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from './vec';

const DEG = Math.PI / 180;

/** Orthonormal heart frame: y toward the base, z anterior, x toward the patient's left. */
export interface HeartFrame {
  readonly centre: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
  readonly z: Vec3;
}

export function heartFrame(): HeartFrame {
  const y = normalize(scale(HEART.apexDirection, -1));
  const front: Vec3 = [0, 0, 1];
  const z = normalize(sub(front, scale(y, dot(front, y))));
  const x = cross(y, z);
  return { centre: HEART.centre, x, y, z };
}

/**
 * Point on the epicardium in heart-local coordinates for surface angles theta (rad, around
 * the long axis, 0 = anterior, +π/2 = patient left) and phi (rad from the base pole).
 * Ellipsoid, narrowed toward the apex, flattened at the base, with an RV bulge.
 */
export function heartLocalPoint(theta: number, phi: number): Vec3 {
  const { long, wide, deep } = HEART.semiAxes;
  let y = long * Math.cos(phi);
  const s = Math.sin(phi);
  const apexT = y < 0 ? Math.pow(-y / long, 1.6) : 0;
  const taper = 1 - (1 - HEART.apexTaper) * apexT;
  const rv = Math.max(0, Math.cos(theta - HEART.rvThetaDeg * DEG));
  const bulge = 1 + HEART.rvBulge * rv * rv * s;
  const yMax = long * (1 - HEART.baseFlatten);
  if (y > yMax) y = yMax;
  return [wide * s * taper * bulge * Math.sin(theta), y, deep * s * taper * bulge * Math.cos(theta)];
}

export function localToWorld(f: HeartFrame, p: Vec3): Vec3 {
  return add(f.centre, add(add(scale(f.x, p[0]), scale(f.y, p[1])), scale(f.z, p[2])));
}

export function heartWorldPoint(f: HeartFrame, theta: number, phi: number): Vec3 {
  return localToWorld(f, heartLocalPoint(theta, phi));
}

/** Outward unit normal of the surface (world) by finite differences. */
export function heartWorldNormal(f: HeartFrame, theta: number, phi: number): Vec3 {
  const e = 1e-3;
  const dT = sub(heartWorldPoint(f, theta + e, phi), heartWorldPoint(f, theta - e, phi));
  const dP = sub(heartWorldPoint(f, theta, phi + e), heartWorldPoint(f, theta, phi - e));
  let n = normalize(cross(dT, dP));
  const p = heartWorldPoint(f, theta, phi);
  const axisPoint = add(f.centre, scale(f.y, dot(sub(p, f.centre), f.y)));
  if (dot(n, sub(p, axisPoint)) < 0) n = scale(n, -1);
  return n;
}

/** Signed angle difference wrapped to (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Epicardial fat weight 0..1 at a surface point: a band along the AV groove and along the
 * anterior / posterior interventricular grooves (below the AV groove).
 */
export function grooveFat(theta: number, phi: number): number {
  const { long } = HEART.semiAxes;
  const w = HEART.grooveFatWidth;
  const r = Math.max(8, long * Math.sin(phi));
  const av = Math.exp(-0.5 * Math.pow(((phi - HEART.avGroovePhi) * long) / w, 2));
  const iv = HEART.ivGrooveThetaDeg * DEG;
  const dAnt = angleDiff(theta, iv) * r;
  const dPost = angleDiff(theta, iv + Math.PI) * r;
  const below = phi > HEART.avGroovePhi ? 1 : 0;
  const ivFat = below * Math.max(Math.exp(-0.5 * (dAnt / w) ** 2), Math.exp(-0.5 * (dPost / w) ** 2));
  const base = phi < HEART.avGroovePhi ? 0.55 : 0;
  return Math.min(1, Math.max(av, ivFat * 0.9, base));
}

/**
 * Contraction 0..1 over the cardiac cycle (phase 0..1): a smooth raised cosine during
 * systole (first systoleFraction of the cycle), relaxed through diastole.
 */
export function beatContraction(phase: number): number {
  const p = phase - Math.floor(phase);
  if (p >= HEART.systoleFraction) return 0;
  return 0.5 * (1 - Math.cos((2 * Math.PI * p) / HEART.systoleFraction));
}

/** Uniform scale applied about the heart's pivot (base) at a given contraction. */
export function beatScale(contraction: number): number {
  return 1 - HEART.contractionAmplitude * contraction;
}
