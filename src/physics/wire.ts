import { D1, D2, LAD, LCX, WIRE } from '../config/anatomy';
import { lesionBounds, stenosisShape } from '../anatomy/stenosis';
import type { VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import { ChainRoute, type RouteSegment } from './route';
import { angleDistDeg, updateSpeed, wrapDeg } from './speed';

export interface WireState {
  readonly out: boolean;
  /** Vessels from the LM to the tip, e.g. ['lm', 'lad']. */
  readonly chain: readonly VesselId[];
  /** Tip arc within the last vessel of the chain. */
  readonly tipArc: number;
  readonly rotationDeg: number;
  readonly speed: number;
  readonly forcing: boolean;
  /** Visual buckling of the tip, 0..1. */
  readonly buckle: number;
  /** Resistance felt at the tip, 0..1. */
  readonly resistance: number;
  /** Hidden dissection risk built up by forcing through the lesion. */
  readonly risk: number;
  readonly crossed: boolean;
  readonly forcingS: number;
}

export type WireEvent =
  | { readonly type: 'out' }
  | { readonly type: 'inGuide' }
  | { readonly type: 'entered'; readonly vessel: VesselId }
  | { readonly type: 'forcing' }
  | { readonly type: 'crossed'; readonly dissection: boolean }
  | { readonly type: 'nearEnd' }
  | { readonly type: 'vesselEnd' }
  | { readonly type: 'retractBlocked' };

export function initialWire(rotationDeg: number = WIRE.initialRotationDeg): WireState {
  return {
    out: false,
    chain: [],
    tipArc: 0,
    rotationDeg,
    speed: 0,
    forcing: false,
    buckle: 0,
    resistance: 0,
    risk: 0,
    crossed: false,
    forcingS: 0,
  };
}

/** Takeoff angle of each branch the wire can choose. */
export const TAKEOFF: Partial<Record<VesselId, number>> = {
  lad: LAD.takeoffAngleDeg,
  lcx: LCX.takeoffAngleDeg,
  d1: D1.takeoffAngleDeg,
  d2: D2.takeoffAngleDeg,
};

interface BranchPoint {
  readonly child: VesselId;
  readonly arc: number;
  /** All children at a terminal bifurcation: the wire must take one of them. */
  readonly terminal: boolean;
}

function branchPoints(tree: VesselTree, vessel: VesselId): BranchPoint[] {
  const len = tree.vessels[vessel].path.length;
  return Object.values(tree.vessels)
    .filter((v) => v.parent === vessel && TAKEOFF[v.id] !== undefined)
    .map((v) => ({ child: v.id, arc: v.originArc, terminal: v.originArc >= len - 0.01 }));
}

/** Which branch the tip takes at `arc` on `vessel`, given its rotation (null = stay). */
export function chooseBranch(tree: VesselTree, vessel: VesselId, arc: number, rotationDeg: number): VesselId | null {
  const here = branchPoints(tree, vessel).filter((b) => Math.abs(b.arc - arc) < 0.01);
  if (here.length === 0) return null;
  if (here.every((b) => b.terminal)) {
    // Terminal bifurcation (LM → LAD / LCx): the closer takeoff wins.
    return here.reduce((best, b) =>
      angleDistDeg(rotationDeg, TAKEOFF[b.child]!) < angleDistDeg(rotationDeg, TAKEOFF[best.child]!) ? b : best,
    ).child;
  }
  const captured = here.filter((b) => angleDistDeg(rotationDeg, TAKEOFF[b.child]!) <= WIRE.branchCaptureDeg);
  if (captured.length === 0) return null;
  return captured.reduce((best, b) =>
    angleDistDeg(rotationDeg, TAKEOFF[b.child]!) < angleDistDeg(rotationDeg, TAKEOFF[best.child]!) ? b : best,
  ).child;
}

export function wireTip(w: WireState): { vessel: VesselId; arc: number } | null {
  if (!w.out) return null;
  return { vessel: w.chain[w.chain.length - 1]!, arc: w.tipArc };
}

/** The wire's course as a chain route (LM ostium → tip). */
export function wireRoute(tree: VesselTree, w: WireState): ChainRoute {
  const segs: RouteSegment[] = [];
  w.chain.forEach((id, i) => {
    const next = w.chain[i + 1];
    const to = next ? tree.vessels[next].originArc : w.tipArc;
    segs.push({ vessel: id, from: 0, to });
  });
  if (segs.length === 0) segs.push({ vessel: 'lm', from: 0, to: 0 });
  return new ChainRoute(tree, segs);
}

export interface BranchHint {
  readonly branch: VesselId;
  readonly distance: number;
  /** The branch the tip would take with its current rotation (null = stays in vessel). */
  readonly takes: VesselId | null;
}

/** Nearest branch point ahead of the tip within branchHintDistance. */
export function branchHint(tree: VesselTree, w: WireState): BranchHint | null {
  const tip = wireTip(w);
  if (!tip) {
    return { branch: 'lm', distance: 0, takes: null };
  }
  const ahead = branchPoints(tree, tip.vessel)
    .filter((b) => b.arc >= tip.arc && b.arc - tip.arc <= WIRE.branchHintDistance)
    .sort((a, b) => a.arc - b.arc);
  const b = ahead[0];
  if (!b) return null;
  return { branch: b.child, distance: b.arc - tip.arc, takes: chooseBranch(tree, tip.vessel, b.arc, w.rotationDeg) };
}

export function wireDistal(w: WireState, tree: VesselTree): boolean {
  const tip = wireTip(w);
  const l = tree.lesion;
  return !!tip && tip.vessel === l.vessel && tip.arc >= lesionBounds(l).end + WIRE.distalParkMargin;
}

export interface WireInput {
  readonly ds: number;
  readonly rotateDeg: number;
  readonly dt: number;
  /** A balloon/stent catheter is out over the wire. */
  readonly catheterOut: boolean;
  readonly rng: () => number;
  /** First vessel beyond the guide tip: the left main or the RCA. */
  readonly entry?: VesselId;
}

/**
 * Advance/retract the wire by vessel arc length. At branch points the shaped tip picks the
 * branch; in the LAD lesion, pushing faster than the safe speed (×1.5 with torque) buckles
 * the tip, limits progress and builds a hidden dissection risk that is rolled once on crossing.
 */
export function stepWire(w: WireState, input: WireInput, tree: VesselTree): { state: WireState; events: WireEvent[] } {
  const events: WireEvent[] = [];
  const speed = updateSpeed(w.speed, input.ds, input.dt);
  const rotationDeg = wrapDeg(w.rotationDeg + input.rotateDeg);
  let { out, tipArc, risk, crossed, forcingS, buckle } = w;
  let chain = [...w.chain];
  let forcing = false;
  let resistance = 0;
  let ds = input.ds;

  if (ds < 0 && input.catheterOut) {
    return { state: { ...w, rotationDeg, speed }, events: [{ type: 'retractBlocked' }] };
  }

  if (!out && ds > 0) {
    out = true;
    chain = [input.entry ?? 'lm'];
    tipArc = 0;
    events.push({ type: 'out' });
  }

  if (out && ds > 0) {
    const lesion = lesionBounds(tree.lesion);
    const target = tree.lesion.vessel;
    let remaining = ds;
    while (remaining > 1e-9) {
      const vessel = chain[chain.length - 1]!;
      const len = tree.vessels[vessel].path.length;
      // Lesion: limit progress when forcing.
      if (vessel === target && !crossed && tipArc + remaining > lesion.start && tipArc < lesion.end) {
        const safe = WIRE.safeLesionSpeed * (input.rotateDeg !== 0 ? WIRE.torqueSpeedBonus : 1);
        resistance = Math.max(resistance, 0.4 * stenosisShape(Math.max(tipArc, lesion.start), tree.lesion));
        if (speed > safe) {
          forcing = true;
          const over = speed / safe - 1;
          risk = Math.min(WIRE.maxDissectionRisk, risk + WIRE.riskGainPerS * over * input.dt);
          forcingS += input.dt;
          buckle = Math.min(1, buckle + input.dt * 3);
          resistance = Math.min(1, resistance + 0.6 * Math.min(1, over));
          remaining = Math.min(remaining, safe * input.dt);
        }
      }
      const next = Object.values(tree.vessels)
        .filter((v) => v.parent === vessel && TAKEOFF[v.id] !== undefined && v.originArc > tipArc && v.originArc <= tipArc + remaining)
        .sort((a, b) => a.originArc - b.originArc)[0];
      const branchArc = next ? next.originArc : null;
      // A vessel that ends in a bifurcation (the LM) has no dead end to stop at.
      const terminal = branchPoints(tree, vessel).some((b) => b.terminal);
      const stopAt = terminal ? Infinity : len - WIRE.endStop;
      if (branchArc !== null) {
        const choice = chooseBranch(tree, vessel, branchArc, rotationDeg);
        if (choice) {
          remaining -= branchArc - tipArc;
          chain.push(choice);
          tipArc = 0;
          events.push({ type: 'entered', vessel: choice });
          continue;
        }
      }
      const targetArc = tipArc + remaining;
      if (vessel === target && !crossed && tipArc <= lesion.end && targetArc > lesion.end) {
        crossed = true;
        events.push({ type: 'crossed', dissection: input.rng() < risk });
      }
      if (targetArc >= stopAt) {
        tipArc = stopAt;
        events.push({ type: 'vesselEnd' });
      } else {
        tipArc = targetArc;
        if (tipArc > len - WIRE.vesselEndWarning) events.push({ type: 'nearEnd' });
      }
      remaining = 0;
    }
  } else if (out && ds < 0) {
    let remaining = -ds;
    while (remaining > 1e-9 && out) {
      if (tipArc - remaining >= 0) {
        tipArc -= remaining;
        remaining = 0;
      } else {
        remaining -= tipArc;
        const child = chain.pop()!;
        if (chain.length === 0) {
          out = false;
          tipArc = 0;
          events.push({ type: 'inGuide' });
        } else {
          tipArc = tree.vessels[child].originArc - 1e-6;
        }
      }
    }
  }

  if (!forcing) buckle = Math.max(0, buckle - input.dt * 2);
  if (forcing) events.push({ type: 'forcing' });
  return {
    state: { out, chain, tipArc, rotationDeg, speed, forcing, buckle, resistance, risk, crossed, forcingS },
    events,
  };
}
