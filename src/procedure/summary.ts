import { DEBRIEF, STENT } from '../config/anatomy';
import { lesionBounds } from '../anatomy/stenosis';
import type { CaseLesion } from '../cases/cases';
import { CLASSIC_LESION } from '../cases/cases';
import type { StentRecord } from '../physics/treatment';
import type { CaseSummary } from './debrief';
import { measureQca } from './qca';
import { optimisation } from '../physics/imaging';
import type { Session } from './session';
import { stageCompleted } from './stages';

/**
 * Stents a lesion needs: one if the longest stent covers it with the minimum margin on both
 * sides, otherwise two overlapping ones.
 */
export function stentsNeeded(lesionLength: number): number {
  const longest = Math.max(...STENT.lengths);
  return lesionLength + 2 * DEBRIEF.minCoverageMargin <= longest ? 1 : 2;
}

/** Merge overlapping/touching LAD stents and return the segment that overlaps the lesion most. */
export function lesionStentSegment(stents: readonly StentRecord[], lesion: CaseLesion = CLASSIC_LESION): { from: number; to: number } | null {
  const { start, end } = lesionBounds(lesion);
  const lad = stents.filter((s) => s.vessel === lesion.vessel).map((s) => ({ from: s.from, to: s.to })).sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const s of lad) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to + 0.5) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  let best: { from: number; to: number } | null = null;
  let bestOverlap = 0;
  for (const m of merged) {
    const overlap = Math.min(m.to, end) - Math.max(m.from, start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = m;
    }
  }
  return best;
}

/** Everything the debrief needs, measured from the case as it stands now. */
export function buildSummary(session: Session): CaseSummary {
  const c = session.ctrl;
  const t = c.treatment;
  const lesion = c.tree.lesion;
  const { start, end } = lesionBounds(lesion);
  const lumen = c.tree.vessels[lesion.vessel].lumen;
  const qca = measureQca(lumen, lesion);
  const reference = lumen.referenceAt(lesion.centreArc);
  const overlapping = t.stents.filter((s) => s.vessel === lesion.vessel && s.from < end && s.to > start);
  const main = overlapping.reduce<StentRecord | null>(
    (best, s) => (!best || Math.min(s.to, end) - Math.max(s.from, start) > Math.min(best.to, end) - Math.max(best.from, start) ? s : best),
    null,
  );
  const seg = lesionStentSegment(t.stents, lesion);
  const durations = c.log.inflations.map((i) => i.duration);
  const cat = c.catheter;
  if (cat?.inflation) durations.push(session.time - cat.inflation.start);
  const decision = session.decisionFfr;
  // Imaging only judges the stent if it was done after the last inflation.
  const lastInflation = c.log.inflations.reduce((m, i) => Math.max(m, i.start + i.duration), -Infinity);
  const post = [...session.imaging].reverse().find((p) => p.summary.msa && p.summary.expansion !== null && p.time >= lastInflation);
  const opt = post ? optimisation(post.summary)! : null;
  return {
    stagesCompleted: session.progress.completedAt.filter((x) => x !== null).length,
    stagesTotal: session.progress.plan.length,
    physiology: session.tree.setup.ffr
      ? {
          measured: decision?.ffr ?? null,
          native: session.nativeFfr,
          deferred: session.deferred,
          treated: c.log.inflations.length > 0 || !!cat?.inflation || t.stents.length > 0,
        }
      : null,
    optimisation:
      session.tree.setup.imaging || post
        ? {
            expected: session.tree.setup.imaging,
            result:
              post && opt
                ? {
                    modality: post.modality,
                    msa: post.summary.msa!.area,
                    expansion: post.summary.expansion!,
                    malapposition: post.summary.maxMalapposition,
                    edges: opt.edges,
                  }
                : null,
          }
        : null,
    residualStenosis: qca.ds,
    finalTimi: c.flow.timi,
    referenceDiameter: reference,
    stentDiameter: main ? main.diameter : null,
    coverage: seg ? { proximal: start - seg.from, distal: seg.to - end } : null,
    stentsDeployed: c.log.stentsDeployed,
    stentsNeeded: stentsNeeded(lesion.length),
    heparinBeforeWire: c.log.heparinBeforeWire === true,
    preDilated: stageCompleted(session.progress, 'predilate'),
    qcaUsed: c.qcaMeasured,
    dissection: t.dissections.length === 0 ? 'none' : t.dissections.some((d) => !d.sealed) ? 'unsealed' : 'sealed',
    wireForcingS: c.wire.forcingS,
    balloonRuptures: c.log.ruptures,
    longestInflationS: durations.length ? Math.max(...durations) : 0,
    contrastMl: session.contrastMl,
    fluoroS: session.xray.fluoroS,
    finalViews: session.progress.finalViews.length,
  };
}
