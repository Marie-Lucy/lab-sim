import { FLOW } from '../config/anatomy';
import { diameterStenosis } from '../anatomy/stenosis';
import type { VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import { flowFactor, timiGrade, type TimiGrade } from './flow';
import type { Dissection, Span } from './treatment';

export interface FlowState {
  /** Flow factor at each lumen sample of each vessel. */
  readonly factor: Readonly<Record<VesselId, Float32Array>>;
  /** Flow factor at the distal end of the case's target vessel (drives ischaemia and TIMI). */
  readonly distalTarget: number;
  readonly timi: TimiGrade;
}

/** Vessels ordered so each parent comes before its children. */
export function topoOrder(tree: VesselTree): VesselId[] {
  const out: VesselId[] = [];
  const visit = (id: VesselId) => {
    if (out.includes(id)) return;
    const p = tree.vessels[id].parent;
    if (p) visit(p);
    out.push(id);
  };
  (Object.keys(tree.vessels) as VesselId[]).forEach(visit);
  return out;
}

/**
 * Flow factor along every vessel. Inflow comes from the parent at the branch origin; along
 * the vessel the factor is limited by the tightest narrowing so far (min of flowFactor of
 * the local %DS), each unsealed dissection multiplies everything downstream by 0.45, and an
 * inflated balloon (occlusion) stops flow from its proximal end onward.
 */
export function computeFlow(tree: VesselTree, occlusions: readonly Span[], dissections: readonly Dissection[]): FlowState {
  const factor = {} as Record<VesselId, Float32Array>;
  for (const id of topoOrder(tree)) {
    const v = tree.vessels[id];
    const lumen = v.lumen;
    const out = new Float32Array(lumen.count);
    let inflow = 1;
    if (v.parent) {
      const pf = factor[v.parent];
      const pl = tree.vessels[v.parent].lumen;
      inflow = pf[Math.min(pl.count - 1, Math.round(v.originArc / pl.spacing))]!;
    }
    let tightest = 1;
    let penalty = 1;
    const ds = dissections.filter((d) => d.vessel === id && !d.sealed).map((d) => d.from);
    const occ = occlusions.filter((o) => o.vessel === id).map((o) => o.from);
    const occFrom = occ.length ? Math.min(...occ) : Infinity;
    for (let i = 0; i < lumen.count; i++) {
      const s = lumen.arcOf(i);
      tightest = Math.min(tightest, flowFactor(diameterStenosis(lumen.diameter[i]!, lumen.reference[i]!)));
      penalty = Math.pow(FLOW.dissectionPenalty, ds.filter((f) => f <= s).length);
      out[i] = s >= occFrom ? 0 : Math.min(inflow, tightest) * penalty;
    }
    factor[id] = out;
  }
  const target = factor[tree.lesion.vessel];
  const distalTarget = target[target.length - 1]!;
  return { factor, distalTarget, timi: timiGrade(distalTarget) };
}

export function flowAt(flow: FlowState, tree: VesselTree, vessel: VesselId, arc: number): number {
  const l = tree.vessels[vessel].lumen;
  return flow.factor[vessel][Math.min(l.count - 1, Math.max(0, Math.round(arc / l.spacing)))]!;
}
