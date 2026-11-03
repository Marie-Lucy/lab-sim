import type { VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import { setTextContext, tk } from '../i18n';
import { cuspAngle, otherCusp } from '../physics/guide';
import { TAKEOFF } from '../physics/wire';

/** Translated vessel name (LAD → DA in Spanish and Portuguese). */
export function vesselName(id: VesselId): string {
  return tk(`vessel.${id}`);
}

/** Main left branch the wire must enter to reach the target (LAD for D1/D2). */
export function targetBranch(target: VesselId): VesselId {
  return target === 'd1' || target === 'd2' ? 'lad' : target;
}

/** The other main left branch: where a wrongly steered wire ends up. */
export function otherBranch(target: VesselId): VesselId {
  return targetBranch(target) === 'lcx' ? 'lad' : 'lcx';
}

/** Tip rotation that selects the target at the left-main bifurcation. */
export function targetDeg(target: VesselId): number {
  return TAKEOFF[targetBranch(target)] ?? 0;
}

/** Whether the wire is somewhere it should not be for this target. */
export function isWrongVessel(tree: VesselTree, vessel: VesselId): boolean {
  if (vessel === 'lm' || vessel === tree.lesion.vessel) return false;
  // Ancestors of the target are on the way (e.g. the LAD for a diagonal target).
  for (let v: VesselId | null = tree.vessels[tree.lesion.vessel].parent; v; v = tree.vessels[v].parent) if (v === vessel) return false;
  return true;
}

/** First vessel beyond an engaged guide: the left main or the RCA. */
export function entryVessel(tree: VesselTree): VesselId {
  return tree.setup.cusp === 'left' ? 'lm' : 'rca';
}

/** Make every text name this patient's vessels, approach angle and ECG lead. */
export function applyCaseText(tree: VesselTree): void {
  const target = tree.lesion.vessel;
  setTextContext(() => ({
    vessel: vesselName(target),
    other: vesselName(otherBranch(target)),
    deg: targetDeg(target),
    lead: tree.setup.ecgLead,
    where: tk(`where.${tree.setup.where}`),
    cusp: tk(`cusp.${tree.setup.cusp}`),
    otherCusp: tk(`cusp.${otherCusp(tree.setup.cusp)}`),
    cuspDeg: cuspAngle(tree.setup.cusp),
    ostium: tk(`ostium.${tree.setup.cusp}`),
    artery: tk(`artery.${tree.setup.cusp}`),
    entry: vesselName(entryVessel(tree)),
    side: tree.setup.cusp,
  }));
}
