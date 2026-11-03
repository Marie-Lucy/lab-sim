import { t, tk } from '../i18n';
import { GUIDE } from '../config/anatomy';
import { Path } from '../anatomy/path';
import type { VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import type { Vec3 } from '../anatomy/vec';
import { AORTA } from '../config/anatomy';

/** The guide's rail: wrist → arm → brachiocephalic → arch → ascending aorta → root. */
export interface GuideRoute {
  readonly path: Path;
  readonly elbowArc: number;
  readonly aortaEntryArc: number;
  readonly rootArc: number;
}

export function buildGuideRoute(tree: VesselTree): GuideRoute {
  const access = tree.vessels.access.path;
  const aorta = tree.vessels.aorta.path;
  const pts: Vec3[] = [...access.points];
  for (let s = AORTA.brachiocephalicArc - 1; s > GUIDE.rootStopAortaArc; s -= 1) pts.push(aorta.pointAt(s));
  pts.push(aorta.pointAt(GUIDE.rootStopAortaArc));
  const path = new Path(pts);
  return {
    path,
    elbowArc: tree.accessSegments[0]!.end,
    aortaEntryArc: access.length,
    rootArc: path.length,
  };
}

/** Human-readable position of the guide tip. */
export function guideLocationName(route: GuideRoute, tree: VesselTree, arc: number): string {
  if (arc <= route.aortaEntryArc) {
    const seg = tree.accessSegments.find((s) => arc <= s.end) ?? tree.accessSegments[tree.accessSegments.length - 1]!;
    return tk(`loc.${seg.name}`);
  }
  const aortaArc = AORTA.brachiocephalicArc - (arc - route.aortaEntryArc);
  if (arc >= route.rootArc - 1) return t('loc.root');
  if (aortaArc > AORTA.ascendingLength) return t('loc.arch');
  return t('loc.ascending');
}

/** A piece of a vessel traversed from `from` to `to` (increasing arc). */
export interface RouteSegment {
  readonly vessel: VesselId;
  readonly from: number;
  readonly to: number;
}

/** A chain of vessel segments (the wire's course) addressed by a single route arc. */
export class ChainRoute {
  readonly length: number;
  private readonly starts: number[] = [];

  constructor(
    readonly tree: VesselTree,
    readonly segments: readonly RouteSegment[],
  ) {
    let acc = 0;
    for (const s of segments) {
      this.starts.push(acc);
      acc += s.to - s.from;
    }
    this.length = acc;
  }

  /** Vessel and vessel-arc at a route arc (clamped to the route). */
  locate(routeArc: number): { vessel: VesselId; arc: number } {
    const r = Math.min(this.length, Math.max(0, routeArc));
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (r >= this.starts[i]! || i === 0) {
        const s = this.segments[i]!;
        return { vessel: s.vessel, arc: s.from + (r - this.starts[i]!) };
      }
    }
    throw new Error('empty route');
  }

  pointAt(routeArc: number): Vec3 {
    const { vessel, arc } = this.locate(routeArc);
    return this.tree.vessels[vessel].path.pointAt(arc);
  }

  /** Route arc of a vessel arc, if the vessel is on the route. */
  routeArcOf(vessel: VesselId, arc: number): number | null {
    const i = this.segments.findIndex((s) => s.vessel === vessel);
    if (i < 0) return null;
    return this.starts[i]! + (arc - this.segments[i]!.from);
  }
}
