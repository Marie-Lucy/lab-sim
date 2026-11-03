import { CALCIUM, DISSECTION, RECOIL } from '../config/anatomy';
import { stenosisShape } from '../anatomy/stenosis';
import type { LumenProfile } from '../anatomy/lumen';
import type { VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';

export interface Span {
  readonly vessel: VesselId;
  readonly from: number;
  readonly to: number;
}

export interface StentRecord extends Span {
  /** Largest diameter the stent was expanded to (before recoil). */
  readonly diameter: number;
}

export type DissectionCause = 'wire' | 'oversize' | 'rupture' | 'edge';

export interface Dissection extends Span {
  readonly cause: DissectionCause;
  readonly sealed: boolean;
}

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** 1 inside a span, easing to 0 over `taper` mm at each end (smooth device ends). */
export function taperWeight(arc: number, from: number, to: number, taper: number = RECOIL.edgeTaper): number {
  if (arc < from || arc > to) return 0;
  return smoothstep(Math.min(arc - from, to - arc) / taper);
}

/** Lumen left by a plain balloon after elastic recoil. */
export function balloonResult(maxDiameter: number): number {
  return maxDiameter * (1 - RECOIL.balloon);
}

/** Lumen held by a stent after its small recoil. */
export function stentResult(maxDiameter: number): number {
  return maxDiameter * (1 - RECOIL.stent);
}

/**
 * Lumen a device reaches over calcified plaque: only part of the way from the native lumen
 * to the device's target while the calcium is intact. `weight` is the calcium at that point
 * (0 = none: the full target; 1 = full calcium: CALCIUM.uncrackedFraction of the way).
 */
export function calciumLimited(base: number, target: number, weight: number, fraction: number = CALCIUM.uncrackedFraction): number {
  if (target <= base) return base;
  return base + (target - base) * (1 - (1 - fraction) * Math.min(1, Math.max(0, weight)));
}

/** A stent seals a dissection when it covers it end to end (0.5 mm tolerance). */
export function isSealed(d: Span, stents: readonly StentRecord[]): boolean {
  return stents.some((s) => s.vessel === d.vessel && s.from <= d.from + 0.5 && s.to >= d.to - 0.5);
}

/** Edge dissection just beyond the distal end of a stent. */
export function edgeDissectionSpan(stent: Span, vesselLength: number): Span {
  const from = Math.min(vesselLength, stent.to + DISSECTION.stentEdgeOffset);
  return { vessel: stent.vessel, from, to: Math.min(vesselLength, from + DISSECTION.length) };
}

export function meanReference(lumen: LumenProfile, from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let s = Math.max(0, from); s <= Math.min(lumen.length, to); s += 0.25) {
    sum += lumen.referenceAt(s);
    n++;
  }
  return n ? sum / n : lumen.referenceAt(from);
}

interface VesselTreatment {
  readonly native: Float64Array;
  /** Lumen left open by balloon dilations (0 = untouched). */
  readonly opened: Float64Array;
}

/**
 * Per-vessel lumen state: native stenosis, balloon-opened lumen (after 30 % recoil), stent
 * scaffolds (3 % recoil) and the live balloon stretching the wall while it is inflated.
 * `apply` writes the resulting diameter into each vessel's LumenProfile.
 */
export class LumenTreatment {
  private readonly data = new Map<VesselId, VesselTreatment>();
  stents: StentRecord[] = [];
  dissections: Dissection[] = [];
  live: (Span & { readonly diameter: number }) | null = null;
  /** The calcified plaque has been fractured by a high-pressure inflation. */
  cracked = false;

  constructor(readonly tree: VesselTree) {
    for (const v of Object.values(tree.vessels)) {
      this.data.set(v.id, { native: Float64Array.from(v.lumen.diameter), opened: new Float64Array(v.lumen.count) });
    }
  }

  /** Calcium at a point of a vessel (0 once cracked or outside the calcified lesion). */
  calciumAt(vessel: VesselId, arc: number): number {
    const l = this.tree.lesion;
    if (this.cracked || !l.calcium || vessel !== l.vessel) return 0;
    return l.calcium * stenosisShape(arc, l);
  }

  get calcified(): boolean {
    return !!this.tree.lesion.calcium;
  }

  /** Fracture the calcium: later inflations open the lesion fully. */
  crack(): void {
    this.cracked = true;
  }

  private each(span: Span, fn: (i: number, w: number, t: VesselTreatment, lumen: LumenProfile) => void): void {
    const lumen = this.tree.vessels[span.vessel].lumen;
    const t = this.data.get(span.vessel)!;
    const i0 = Math.max(0, Math.floor(span.from / lumen.spacing));
    const i1 = Math.min(lumen.count - 1, Math.ceil(span.to / lumen.spacing));
    for (let i = i0; i <= i1; i++) {
      const w = taperWeight(lumen.arcOf(i), span.from, span.to);
      if (w > 0) fn(i, w, t, lumen);
    }
  }

  /** Record a finished plain-balloon dilation (after recoil). */
  recordBalloon(span: Span, maxDiameter: number): void {
    const target = balloonResult(maxDiameter);
    this.each(span, (i, w, t, l) => {
      const base = t.native[i]!;
      const reach = calciumLimited(base, Math.max(base, target), this.calciumAt(span.vessel, l.arcOf(i)));
      t.opened[i] = Math.max(t.opened[i]!, base + (reach - base) * w);
    });
  }

  addStent(stent: StentRecord): void {
    this.stents.push(stent);
    this.updateSealing();
  }

  /** Post-dilation: a later inflation expands every stent it overlaps. */
  postDilate(span: Span, maxDiameter: number): void {
    this.stents = this.stents.map((s) =>
      s.vessel === span.vessel && s.from < span.to && s.to > span.from ? { ...s, diameter: Math.max(s.diameter, maxDiameter) } : s,
    );
  }

  addDissection(span: Span, cause: DissectionCause): Dissection {
    const d: Dissection = { ...span, cause, sealed: isSealed(span, this.stents) };
    this.dissections.push(d);
    return d;
  }

  updateSealing(): void {
    this.dissections = this.dissections.map((d) => ({ ...d, sealed: isSealed(d, this.stents) }));
  }

  /** Recompute lumen diameters of the given vessel (all coronaries if omitted). */
  apply(vessel?: VesselId): void {
    const ids = vessel ? [vessel] : [...this.data.keys()];
    for (const id of ids) {
      const t = this.data.get(id)!;
      const lumen = this.tree.vessels[id].lumen;
      for (let i = 0; i < lumen.count; i++) lumen.diameter[i] = Math.max(t.native[i]!, t.opened[i]!);
      for (const s of this.stents) {
        if (s.vessel !== id) continue;
        const target = stentResult(s.diameter);
        this.each(s, (i, w, tt, l) => {
          const base = tt.native[i]!;
          const reach = calciumLimited(base, Math.max(base, target), this.calciumAt(id, l.arcOf(i)));
          l.diameter[i] = Math.max(l.diameter[i]!, base + (reach - base) * w);
        });
      }
      if (this.live && this.live.vessel === id) {
        const d = this.live.diameter;
        this.each(this.live, (i, w, _t, l) => {
          const base = l.diameter[i]!;
          const reach = calciumLimited(base, Math.max(base, d), this.calciumAt(id, l.arcOf(i)));
          l.diameter[i] = base + (reach - base) * w;
        });
      }
    }
  }

  native(vessel: VesselId): Float64Array {
    return this.data.get(vessel)!.native;
  }
}
