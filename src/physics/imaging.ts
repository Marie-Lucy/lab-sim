import { DEBRIEF, IMAGING, RECOIL, STENT } from '../config/anatomy';
import type { LumenProfile } from '../anatomy/lumen';
import type { VesselId } from '../anatomy/types';
import { stentResult, type Dissection, type StentRecord } from './treatment';

export type Modality = 'ivus' | 'oct';

/** One frame of a pullback. Diameters in mm, areas in mm². */
export interface Frame {
  readonly arc: number;
  readonly lumenD: number;
  readonly eemD: number;
  /** (EEM − lumen) / EEM area. */
  readonly plaqueBurden: number;
  /** Diameter of the stent strut circle here (null outside stents). */
  readonly stentD: number | null;
  /** Strut-to-wall gap when the wall is wider than the stent (0 = apposed). */
  readonly malapposition: number;
  readonly dissection: boolean;
  /** Calcium here (0..1: the arc of the circumference it covers, relative to the maximum). */
  readonly calcium: number;
  /** The calcium arc is fractured. */
  readonly cracked: boolean;
  /** OCT cannot see the EEM behind thick plaque. */
  readonly eemVisible: boolean;
}

export const area = (d: number) => Math.PI * (d / 2) ** 2;

/** What the lumen state looks like at one arc. */
export interface VesselState {
  readonly lumen: LumenProfile;
  /** Untreated lumen diameter per sample (the wall where nothing was dilated). */
  readonly native: ArrayLike<number>;
  readonly stents: readonly StentRecord[];
  readonly dissections: readonly Dissection[];
  /** Calcium (0..1) along the vessel, intact or not. */
  readonly calcium?: (arc: number) => number;
  readonly cracked?: boolean;
}

/**
 * A cross-section from the model: the EEM is the healthy reference × 1.15 (no remodelling),
 * plaque fills EEM to lumen, and a stent is a circle of struts at its recoiled diameter.
 * Struts are apposed where they press on plaque; where the native wall is wider than the
 * stent (often a healthy edge) they float, and the gap is the malapposition.
 */
export function frameAt(v: VesselState, arc: number, modality: Modality): Frame {
  const l = v.lumen;
  const i = Math.min(l.count - 1, Math.max(0, Math.round(arc / l.spacing)));
  const lumenD = l.diameter[i]!;
  const eemD = l.reference[i]! * IMAGING.eemOverReference;
  const covering = v.stents.filter((s) => arc >= s.from && arc <= s.to);
  // Struts sit on the wall: where calcium held the lumen back, the stent is as small as the lumen.
  const stentD = covering.length ? Math.min(lumenD, Math.max(...covering.map((s) => stentResult(s.diameter)))) : null;
  const native = v.native[i]!;
  return {
    arc,
    lumenD,
    eemD,
    plaqueBurden: Math.max(0, 1 - area(lumenD) / area(eemD)),
    stentD,
    malapposition: stentD === null ? 0 : Math.max(0, (native - stentD) / 2),
    dissection: v.dissections.some((d) => arc >= d.from && arc <= d.to),
    calcium: v.calcium?.(arc) ?? 0,
    cracked: !!v.cracked,
    eemVisible: modality === 'ivus' || (eemD - lumenD) / 2 <= IMAGING.octPenetrationMm,
  };
}

export interface Reference {
  readonly arc: number;
  readonly lumenD: number;
  readonly eemD: number;
}

export interface PullbackSummary {
  /** Segment analysed: the stented length, or the lesion (plaque burden ≥ 50 %). */
  readonly segment: { readonly from: number; readonly to: number } | null;
  /** Unstented: nearest near-normal frames on each side of the lesion (where a stent should land). */
  readonly landing: { readonly from: number; readonly to: number } | null;
  /** Plaque burden is null when OCT cannot see the EEM there. */
  readonly mla: { readonly arc: number; readonly area: number; readonly plaqueBurden: number | null };
  readonly proximalRef: Reference | null;
  readonly distalRef: Reference | null;
  /** Minimal stent area, only once stented. */
  readonly msa: { readonly arc: number; readonly area: number } | null;
  /** MSA / mean reference lumen area. */
  readonly expansion: number | null;
  readonly maxMalapposition: number;
  /** A dissection within 5 mm outside a stent edge, or anywhere when unstented. */
  readonly edgeDissection: boolean;
  /** Plaque burden 5 mm outside each stent edge (null when unstented). */
  readonly edgePlaqueBurden: { readonly proximal: number; readonly distal: number } | null;
  /** Sizing from the references, before stenting. */
  readonly suggestion: { readonly diameter: number; readonly length: number; readonly stents: number } | null;
}

export interface Pullback {
  readonly modality: Modality;
  readonly vessel: VesselId;
  readonly time: number;
  /** Frames from proximal (arc 0) to the start of the pullback. */
  readonly frames: readonly Frame[];
  readonly summary: PullbackSummary;
}

/** Sample the vessel from the ostium to `toArc` every frameMm. */
export function pullback(v: VesselState, vessel: VesselId, toArc: number, modality: Modality, time = 0): Pullback {
  const frames: Frame[] = [];
  const end = Math.min(v.lumen.length, toArc);
  for (let s = 0; s <= end + 1e-9; s += IMAGING.frameMm) frames.push(frameAt(v, s, modality));
  return { modality, vessel, time, frames, summary: summarize(frames, v.stents.filter((s) => s.vessel === vessel)) };
}

/** Merge overlapping stents into one scaffold (the segment being optimised). */
function stentedSegment(stents: readonly StentRecord[]): { from: number; to: number } | null {
  if (!stents.length) return null;
  const sorted = [...stents].sort((a, b) => a.from - b.from);
  let best = { from: sorted[0]!.from, to: sorted[0]!.to };
  let cur = { ...best };
  for (const s of sorted.slice(1)) {
    if (s.from <= cur.to + 0.5) cur.to = Math.max(cur.to, s.to);
    else cur = { from: s.from, to: s.to };
    if (cur.to - cur.from > best.to - best.from) best = { ...cur };
  }
  return best;
}

function largestLumen(frames: readonly Frame[], from: number, to: number): Reference | null {
  let best: Frame | null = null;
  for (const f of frames) if (f.arc >= from && f.arc <= to && (!best || f.lumenD > best.lumenD)) best = f;
  return best ? { arc: best.arc, lumenD: best.lumenD, eemD: best.eemD } : null;
}

/**
 * The numbers an operator reads off a pullback:
 * - MLA: the smallest lumen area, with its plaque burden.
 * - Segment: the stent if there is one, else the frames around the MLA with plaque ≥ 50 %;
 *   the landing zones are the nearest near-normal frames (plaque < 30 %) beyond it.
 * - References: the largest lumen within 10 mm beyond the landing zones (or the stent).
 * - Stented: MSA, expansion = MSA / mean reference area (goal ≥ 90 %), the widest strut gap,
 *   edge plaque burden 5 mm out and dissections near the edges.
 * - Not stented: a suggested stent, Ø ≈ 1.05 × mean reference lumen (nearest available) and
 *   the shortest length that spans landing zone to landing zone plus the debrief's margins.
 */
export function summarize(frames: readonly Frame[], stents: readonly StentRecord[]): PullbackSummary {
  const mlaF = frames.reduce((a, b) => (b.lumenD < a.lumenD ? b : a));
  const stented = stentedSegment(stents);
  let segment = stented;
  if (!segment && mlaF.plaqueBurden >= IMAGING.lesionPlaqueBurden) {
    const k = frames.indexOf(mlaF);
    let a = k;
    let b = k;
    while (a > 0 && frames[a - 1]!.plaqueBurden >= IMAGING.lesionPlaqueBurden) a--;
    while (b < frames.length - 1 && frames[b + 1]!.plaqueBurden >= IMAGING.lesionPlaqueBurden) b++;
    segment = { from: frames[a]!.arc, to: frames[b]!.arc };
  }
  let landing: PullbackSummary['landing'] = null;
  if (!stented && segment) {
    let a = frames.findIndex((f) => f.arc === segment!.from);
    let b = frames.findIndex((f) => f.arc === segment!.to);
    while (a > 0 && frames[a]!.plaqueBurden >= IMAGING.landingPlaqueBurden) a--;
    while (b < frames.length - 1 && frames[b]!.plaqueBurden >= IMAGING.landingPlaqueBurden) b++;
    landing = { from: frames[a]!.arc, to: frames[b]!.arc };
  }
  const R = IMAGING.referenceSearchMm;
  const outer = landing ?? segment;
  const proximalRef = outer ? largestLumen(frames, outer.from - R, outer.from - 1) : null;
  const distalRef = outer ? largestLumen(frames, outer.to + 1, outer.to + R) : null;
  const refs = [proximalRef, distalRef].filter((r): r is Reference => r !== null);
  const refArea = refs.length ? refs.reduce((s, r) => s + area(r.lumenD), 0) / refs.length : null;

  let msa: PullbackSummary['msa'] = null;
  let maxMalapposition = 0;
  let edgePlaqueBurden: PullbackSummary['edgePlaqueBurden'] = null;
  let edgeDissection = false;
  if (stented) {
    // The stent's ends ease into the native vessel over RECOIL.edgeTaper: the MSA is read
    // where the scaffold is fully formed.
    const inside = (f: Frame) => f.arc >= stented.from + RECOIL.edgeTaper && f.arc <= stented.to - RECOIL.edgeTaper;
    for (const f of frames) {
      if (f.stentD === null) continue;
      if (inside(f)) {
        const a = area(f.lumenD);
        if (!msa || a < msa.area) msa = { arc: f.arc, area: a };
      }
      maxMalapposition = Math.max(maxMalapposition, f.malapposition);
    }
    const at = (arc: number) => frames.reduce((a, b) => (Math.abs(b.arc - arc) < Math.abs(a.arc - arc) ? b : a));
    edgePlaqueBurden = { proximal: at(stented.from - 5).plaqueBurden, distal: at(stented.to + 5).plaqueBurden };
    edgeDissection = frames.some(
      (f) => f.dissection && ((f.arc < stented.from && f.arc >= stented.from - 5) || (f.arc > stented.to && f.arc <= stented.to + 5)),
    );
  } else {
    edgeDissection = frames.some((f) => f.dissection);
  }

  let suggestion: PullbackSummary['suggestion'] = null;
  if (landing && refs.length) {
    const meanD = refs.reduce((s, r) => s + r.lumenD, 0) / refs.length;
    const want = meanD * IMAGING.sizingFactor;
    const diameter = STENT.diameters.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
    const need = landing.to - landing.from + 2 * DEBRIEF.minCoverageMargin;
    const longest = STENT.lengths[STENT.lengths.length - 1]!;
    const length = STENT.lengths.find((x) => x >= need) ?? longest;
    suggestion = { diameter, length, stents: need <= longest ? 1 : 2 };
  }

  return {
    segment,
    landing,
    mla: { arc: mlaF.arc, area: area(mlaF.lumenD), plaqueBurden: mlaF.eemVisible ? mlaF.plaqueBurden : null },
    proximalRef,
    distalRef,
    msa,
    expansion: msa && refArea ? msa.area / refArea : null,
    maxMalapposition,
    edgeDissection,
    edgePlaqueBurden,
    suggestion,
  };
}

/** The checklist of an optimised stent (IVUS/OCT criteria). */
export function optimisation(s: PullbackSummary): { expanded: boolean; apposed: boolean; edges: boolean } | null {
  if (!s.msa || s.expansion === null) return null;
  return {
    expanded: s.expansion >= IMAGING.expansionGoal,
    apposed: s.maxMalapposition < IMAGING.malappositionMm,
    edges: !s.edgeDissection && (s.edgePlaqueBurden?.proximal ?? 0) < IMAGING.lesionPlaqueBurden && (s.edgePlaqueBurden?.distal ?? 0) < IMAGING.lesionPlaqueBurden,
  };
}
