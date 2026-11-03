import {
  ACCESS,
  AORTA,
  COURSES,
  CORONARY_LIFT,
  D1,
  D2,
  LAD,
  LCX,
  LEFT_MAIN,
  RCA,
  type SurfaceCourse,
} from '../config/anatomy';
import { CLASSIC_LESION, LAD_SETUP, type CaseLesion, type CaseSetup } from '../cases/cases';
import { ladReferenceDiameter, stenosisShape, taperedDiameter } from './stenosis';
import { heartFrame, heartWorldNormal, heartWorldPoint, type HeartFrame } from './heartShape';
import { LumenProfile } from './lumen';
import { Path, smoothPath } from './path';
import type { VesselId } from './types';
import { add, distance, normalize, rotateAbout, scale, sub, type Vec3 } from './vec';

const DEG = Math.PI / 180;

export interface Vessel {
  readonly id: VesselId;
  readonly name: string;
  readonly parent: VesselId | null;
  /** Arc length on the parent where this vessel starts. */
  readonly originArc: number;
  readonly path: Path;
  readonly lumen: LumenProfile;
  /** Rides on the heart and moves with each beat. */
  readonly beats: boolean;
}

export interface AccessSegment {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly diameter: number;
}

export interface VesselTree {
  readonly vessels: Readonly<Record<VesselId, Vessel>>;
  readonly frame: HeartFrame;
  /** Point the heart scales about while beating (between the coronary ostia). */
  readonly pivot: Vec3;
  readonly valveCentre: Vec3;
  readonly rootAxis: Vec3;
  readonly leftOstium: Vec3;
  readonly rightOstium: Vec3;
  /** Unit direction from the root axis toward the left cusp (perpendicular to the axis). */
  readonly leftCuspDir: Vec3;
  readonly rightCuspDir: Vec3;
  /** Access path (arc 0 = wrist) split into named segments. */
  readonly accessSegments: readonly AccessSegment[];
  /** This patient's target lesion (from the case). */
  readonly lesion: CaseLesion;
  readonly setup: CaseSetup;
}

interface Walked {
  readonly path: Path;
  /** Surface angles at each path point. */
  readonly angles: readonly { theta: number; phi: number }[];
}

/**
 * Walk a quadratic (theta, phi) course over the heart surface until the centreline reaches
 * `targetLength`, sampling a point roughly every millimetre. The centreline is lifted off
 * the epicardium by `lift(arc)`.
 */
export function walkSurface(
  frame: HeartFrame,
  course: SurfaceCourse,
  targetLength: number,
  lift: (arc: number) => number,
  start: Vec3 | null = null,
): Walked {
  const pointAt = (t: number, arc: number) => {
    const theta = (course.thetaDeg + course.dThetaDeg * t + course.ddThetaDeg * t * t) * DEG;
    const phi = Math.min(Math.PI - 0.08, course.phi + course.dPhi * t + course.ddPhi * t * t);
    const p = add(heartWorldPoint(frame, theta, phi), scale(heartWorldNormal(frame, theta, phi), lift(arc)));
    return { p, theta, phi };
  };
  const first = pointAt(0, 0);
  const pts: Vec3[] = [start ?? first.p];
  const angles = [{ theta: first.theta, phi: first.phi }];
  let arc = 0;
  let prev = pts[0]!;
  let sinceSample = 0;
  const dt = 0.0005;
  for (let t = dt; arc < targetLength; t += dt) {
    if (t > 40) throw new Error('surface course cannot reach its length');
    const q = pointAt(t, arc);
    const d = distance(q.p, prev);
    if (arc + d >= targetLength) {
      // Land exactly on the target length.
      const k = (targetLength - arc) / d;
      pts.push(add(prev, scale(sub(q.p, prev), k)));
      angles.push({ theta: q.theta, phi: q.phi });
      arc = targetLength;
      break;
    }
    arc += d;
    sinceSample += d;
    prev = q.p;
    if (sinceSample >= 1) {
      pts.push(q.p);
      angles.push({ theta: q.theta, phi: q.phi });
      sinceSample = 0;
    }
  }
  return { path: new Path(pts), angles };
}

function anglesAtArc(w: Walked, arc: number): { theta: number; phi: number } {
  let i = 0;
  while (i < w.path.arcs.length - 1 && w.path.arcs[i + 1]! <= arc) i++;
  return w.angles[i]!;
}

/** Piecewise-linear interpolation over [arc, value] knots. */
function knots(points: readonly (readonly [number, number])[]): (s: number) => number {
  return (s) => {
    if (s <= points[0]![0]) return points[0]![1];
    for (let i = 1; i < points.length; i++) {
      const [a, va] = points[i - 1]!;
      const [b, vb] = points[i]!;
      if (s <= b) return va + ((vb - va) * (s - a)) / (b - a);
    }
    return points[points.length - 1]![1];
  };
}

function coronaryLift(spec: { length: number; proximalDiameter: number; distalDiameter: number }) {
  return (arc: number) =>
    (CORONARY_LIFT * taperedDiameter(arc, spec.length, spec.proximalDiameter, spec.distalDiameter)) / 2;
}

export function buildVesselTree(lesion: CaseLesion = CLASSIC_LESION, setup: CaseSetup = LAD_SETUP): VesselTree {
  const frame = heartFrame();

  // --- Left coronary system ------------------------------------------------
  const lad = walkSurface(frame, COURSES.lad, LAD.length, coronaryLift(LAD));
  const bifurcation = lad.path.points[0]!;
  const lcx = walkSurface(frame, COURSES.lcx, LCX.length, coronaryLift(LCX), bifurcation);

  const branch = (spec: typeof D1, course: SurfaceCourse) => {
    const o = anglesAtArc(lad, spec.originArc);
    const c: SurfaceCourse = { ...course, thetaDeg: o.theta / DEG + course.thetaDeg, phi: o.phi + course.phi };
    return walkSurface(frame, c, spec.length, coronaryLift(spec), lad.path.pointAt(spec.originArc));
  };
  const d1 = branch(D1, COURSES.d1);
  const d2 = branch(D2, COURSES.d2);

  const lmDir = normalize(LEFT_MAIN.direction);
  const leftOstium = sub(bifurcation, scale(lmDir, LEFT_MAIN.length));
  const lmPath = new Path([leftOstium, bifurcation]).resampled(0.5);

  // --- Aortic root, placed so the left ostium sits on its wall ------------
  const rootAxis = normalize(AORTA.rootAxis);
  const radial = sub(lmDir, scale(rootAxis, lmDir[0] * rootAxis[0] + lmDir[1] * rootAxis[1] + lmDir[2] * rootAxis[2]));
  const leftCuspDir = normalize(radial);
  const rootR = AORTA.rootDiameter / 2;
  const ostiumAxisPoint = sub(leftOstium, scale(leftCuspDir, rootR));
  const valveCentre = sub(ostiumAxisPoint, scale(rootAxis, AORTA.ostiumHeight));
  const rightCuspDir = rotateAbout(leftCuspDir, rootAxis, AORTA.rightCuspOffsetDeg * DEG);
  const rightOstium = add(ostiumAxisPoint, scale(rightCuspDir, rootR));
  const pivot = ostiumAxisPoint;

  // --- RCA: ostium → right AV groove → posterior ---------------------------
  const rcaLift = coronaryLift(RCA);
  const rcaEntry = add(
    heartWorldPoint(frame, COURSES.rca.thetaDeg * DEG, COURSES.rca.phi),
    scale(heartWorldNormal(frame, COURSES.rca.thetaDeg * DEG, COURSES.rca.phi), rcaLift(0)),
  );
  const rcaFirst = distance(rightOstium, rcaEntry);
  const rcaRest = walkSurface(frame, COURSES.rca, RCA.length - rcaFirst, (a) => rcaLift(a + rcaFirst));
  const rcaPath = new Path([rightOstium, ...rcaRest.path.points]).resampled(0.5);

  // --- Aorta -------------------------------------------------------------
  const aortaPath = smoothPath(AORTA.centreline.map((p) => add(valveCentre, p as Vec3)), 2);
  const aLen = AORTA.ascendingLength;
  const archEnd = aLen + AORTA.archLength;
  const aortaDiameter = knots([
    [0, AORTA.rootDiameter],
    [20, AORTA.ascendingDiameter],
    [aLen, AORTA.ascendingDiameter],
    [aLen + AORTA.archLength / 2, AORTA.archDiameter],
    [archEnd + 20, AORTA.descendingDiameter],
  ]);

  // --- Right radial access (built outward from the arch, then reversed) ---
  const bcOrigin = aortaPath.pointAt(AORTA.brachiocephalicArc);
  const outward = [...ACCESS.segments].reverse();
  const corners: Vec3[] = [bcOrigin];
  for (const seg of outward) {
    corners.push(add(corners[corners.length - 1]!, scale(normalize(seg.direction as unknown as Vec3), seg.length)));
  }
  const accessOut = smoothPath(corners, 2);
  const accessPath = accessOut.reversed();
  // Segment boundaries: closest arcs to the corner points (wrist first).
  const cornerArcs = [...corners].reverse().map((c) => accessPath.closestArc(c));
  cornerArcs[0] = 0;
  cornerArcs[cornerArcs.length - 1] = accessPath.length;
  const accessSegments: AccessSegment[] = ACCESS.segments.map((seg, i) => ({
    name: seg.name,
    start: cornerArcs[i]!,
    end: cornerArcs[i + 1]!,
    diameter: seg.diameter,
  }));
  const accessDiameter = (s: number) => {
    const seg = accessSegments.find((g) => s <= g.end) ?? accessSegments[accessSegments.length - 1]!;
    const next = accessSegments[accessSegments.indexOf(seg) + 1];
    // Blend over the last 15 mm of a segment into the next one.
    if (next && s > seg.end - 15) return seg.diameter + (next.diameter - seg.diameter) * ((s - (seg.end - 15)) / 15);
    return seg.diameter;
  };

  const make = (
    id: VesselId,
    name: string,
    parent: VesselId | null,
    originArc: number,
    path: Path,
    ref: (s: number) => number,
    beats: boolean,
    native?: (s: number) => number,
  ): Vessel => ({ id, name, parent, originArc, path, lumen: new LumenProfile(path.length, ref, native), beats });

  const taper = (spec: { length: number; proximalDiameter: number; distalDiameter: number }) => (s: number) =>
    taperedDiameter(s, spec.length, spec.proximalDiameter, spec.distalDiameter);

  const vessels: Record<VesselId, Vessel> = {
    access: make('access', 'Right radial access', null, 0, accessPath, accessDiameter, false),
    aorta: make('aorta', 'Aorta', null, 0, aortaPath, aortaDiameter, false),
    lm: make('lm', 'Left main', 'aorta', 0, lmPath, taper(LEFT_MAIN), true),
    lad: make('lad', 'LAD', 'lm', LEFT_MAIN.length, lad.path, ladReferenceDiameter, true),
    lcx: make('lcx', 'LCx', 'lm', LEFT_MAIN.length, lcx.path, taper(LCX), true),
    d1: make('d1', 'D1', 'lad', D1.originArc, d1.path, taper(D1), true),
    d2: make('d2', 'D2', 'lad', D2.originArc, d2.path, taper(D2), true),
    rca: make('rca', 'RCA', 'aorta', 0, rcaPath, taper(RCA), true),
  };

  // The case's stenosis narrows its vessel's native lumen.
  const target = vessels[lesion.vessel].lumen;
  for (let i = 0; i < target.count; i++) target.diameter[i] = target.reference[i]! * (1 - lesion.severity * stenosisShape(target.arcOf(i), lesion));

  return {
    vessels,
    frame,
    pivot,
    valveCentre,
    rootAxis,
    leftOstium,
    rightOstium,
    leftCuspDir,
    rightCuspDir,
    accessSegments,
    lesion,
    setup,
  };
}
