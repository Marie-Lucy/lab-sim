import { AORTA, CONTRAST } from '../config/anatomy';
import type { VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import type { FlowState } from './flowModel';
import { topoOrder } from './flowModel';

export type InjectionKind = 'selective' | 'aortic';

/** Arrival time used for "never" (kept finite for GPU attributes). */
export const NEVER = 1e6;

const LEFT: readonly VesselId[] = ['lm', 'lad', 'lcx', 'd1', 'd2'];

/** Which coronary system a selective injection fills. */
export type InjectionSide = 'left' | 'right';

export interface ContrastPlan {
  readonly kind: InjectionKind;
  /** Contrast front arrival time (s after injection start) at each lumen sample. */
  readonly arrivals: Readonly<Record<VesselId, Float32Array>>;
  /** Peak opacification of each vessel (selective: left system 1, aortic reflux 0.15). */
  readonly intensity: Readonly<Record<VesselId, number>>;
  readonly duration: number;
  readonly cineLength: number;
  readonly volumeMl: number;
}

export function injectionVolume(kind: InjectionKind): number {
  return kind === 'selective' ? CONTRAST.selectiveVolumeMl : CONTRAST.aorticVolumeMl;
}

export function injectionDuration(kind: InjectionKind): number {
  return kind === 'selective' ? CONTRAST.selectiveInjectionS : CONTRAST.aorticInjectionS;
}

/**
 * Arrival times: each sample is reached after the previous one by spacing / (v₀ · flow),
 * where flow already carries the tightest upstream narrowing, dissection penalties and
 * balloon occlusion (flow ≤ 0.02 → never). Branches start from their parent's arrival.
 */
export function arrivalTimes(tree: VesselTree, flow: FlowState, kind: InjectionKind, side: InjectionSide = 'left'): Record<VesselId, Float32Array> {
  const out = {} as Record<VesselId, Float32Array>;
  const aortaArc = (a: number) => (kind === 'aortic' ? a / CONTRAST.aorticFrontSpeed : a <= CONTRAST.refluxLength ? a / CONTRAST.aorticFrontSpeed : NEVER);
  const ostium = AORTA.ostiumHeight / CONTRAST.aorticFrontSpeed;
  for (const id of topoOrder(tree)) {
    const v = tree.vessels[id];
    const l = v.lumen;
    const a = new Float32Array(l.count);
    if (id === 'access') a.fill(NEVER);
    else if (id === 'aorta') for (let i = 0; i < l.count; i++) a[i] = aortaArc(l.arcOf(i));
    else {
      let t: number;
      if (id === 'lm') t = kind === 'aortic' ? ostium : side === 'left' ? 0 : NEVER;
      else if (id === 'rca') t = kind === 'aortic' ? ostium : side === 'right' ? 0 : NEVER;
      else {
        const pa = out[v.parent!];
        const pl = tree.vessels[v.parent!].lumen;
        t = pa[Math.min(pl.count - 1, Math.round(v.originArc / pl.spacing))]!;
      }
      const f = flow.factor[id];
      for (let i = 0; i < l.count; i++) {
        if (i > 0 && t < NEVER) {
          const fi = f[i]!;
          t = fi <= CONTRAST.minFlowFactor ? NEVER : t + l.spacing / (CONTRAST.coronaryFrontSpeed * fi);
        }
        a[i] = Math.min(NEVER, t);
      }
    }
    out[id] = a;
  }
  return out;
}

export function planInjection(tree: VesselTree, flow: FlowState, kind: InjectionKind, side: InjectionSide = 'left'): ContrastPlan {
  const arrivals = arrivalTimes(tree, flow, kind, side);
  const intensity = {} as Record<VesselId, number>;
  for (const id of Object.keys(tree.vessels) as VesselId[]) {
    if (id === 'access') intensity[id] = 0;
    else if (id === 'aorta') intensity[id] = kind === 'aortic' ? 1 : CONTRAST.aorticReflux;
    else if (kind === 'selective') intensity[id] = (side === 'left' ? LEFT.includes(id) : id === 'rca') ? 1 : 0;
    else intensity[id] = 0.55;
  }
  const duration = injectionDuration(kind);
  return { kind, arrivals, intensity, duration, cineLength: cineLength(arrivals, intensity, duration), volumeMl: injectionVolume(kind) };
}

/** Cine run long enough to see the slowest opacified vessel fill and wash out (3–9 s). */
export function cineLength(arrivals: Record<VesselId, Float32Array>, intensity: Record<VesselId, number>, duration: number): number {
  let slowest = 0;
  for (const id of Object.keys(arrivals) as VesselId[]) {
    if ((intensity[id] ?? 0) < 0.5) continue;
    for (const a of arrivals[id]) if (a < NEVER && a > slowest) slowest = a;
  }
  const len = slowest + duration + CONTRAST.washoutS + CONTRAST.cineMarginS;
  return Math.min(CONTRAST.cineMaxS, Math.max(CONTRAST.cineMinS, len));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Dye density 0..1 at a point: present between the front and the washout tail. */
export function contrastDensity(arrival: number, t: number, duration: number, washout: number = CONTRAST.washoutS): number {
  if (arrival >= NEVER) return 0;
  return smoothstep(arrival, arrival + 0.15, t) * (1 - smoothstep(arrival + duration, arrival + duration + washout, t));
}

/** Dissection staining: fills with the front and lingers ~4× longer than lumen dye. */
export function stainDensity(arrival: number, t: number, duration: number): number {
  if (arrival >= NEVER) return 0;
  const w = CONTRAST.washoutS;
  return 0.6 * smoothstep(arrival, arrival + 0.5, t) * (1 - smoothstep(arrival + duration + 3 * w, arrival + duration + 6 * w, t));
}

export function arrivalAt(plan: ContrastPlan, tree: VesselTree, vessel: VesselId, arc: number): number {
  const l = tree.vessels[vessel].lumen;
  return plan.arrivals[vessel][Math.min(l.count - 1, Math.max(0, Math.round(arc / l.spacing)))]!;
}
