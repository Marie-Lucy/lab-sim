import { FFR } from '../config/anatomy';
import type { LumenProfile } from '../anatomy/lumen';

const MMHG_PA = 133.322;

/** Coefficients of ΔP = F·Q + S·Q² (SI: Pa, m³/s) along a lumen from 0 to `toArc`. */
export interface StenosisCoefficients {
  /** Viscous (Poiseuille) term, Pa·s/m³. */
  readonly viscous: number;
  /** Separation (expansion) term, Pa·s²/m⁶. */
  readonly separation: number;
  /** Narrowest diameter on the way (mm) and the reference diameter there. */
  readonly minDiameter: number;
  readonly referenceDiameter: number;
}

/**
 * Integrate the pressure-loss coefficients along a vessel up to the sensor.
 * - Friction: Poiseuille ΔP = 8μLQ / (π r⁴) for each 0.25 mm sample, summed (r⁴ makes the
 *   narrow part dominate: half the radius costs 16× the loss per mm).
 * - Separation: ρ/2 · k · (1/A_min − 1/A_ref)² for the narrowest point, the kinetic energy of
 *   the jet that is not recovered when it slows down in the wider vessel beyond.
 */
export function stenosisCoefficients(lumen: LumenProfile, toArc: number): StenosisCoefficients {
  const last = Math.min(lumen.count - 1, Math.max(0, Math.floor(toArc / lumen.spacing)));
  const ds = lumen.spacing / 1000;
  let viscous = 0;
  let iMin = 0;
  for (let i = 0; i <= last; i++) {
    const r = lumen.diameter[i]! / 2000;
    viscous += (8 * FFR.viscosityPaS * ds) / (Math.PI * r ** 4);
    if (lumen.diameter[i]! < lumen.diameter[iMin]!) iMin = i;
  }
  const area = (dMm: number) => Math.PI * (dMm / 2000) ** 2;
  const dMin = lumen.diameter[iMin]!;
  const dRef = lumen.reference[iMin]!;
  const gap = Math.max(0, 1 / area(dMin) - 1 / area(dRef));
  const separation = (FFR.densityKgM3 / 2) * FFR.expansionLoss * gap * gap;
  return { viscous, separation, minDiameter: dMin, referenceDiameter: dRef };
}

export interface FfrResult {
  readonly ffr: number;
  /** Distal (Pd) and aortic (Pa) mean pressures in mmHg. */
  readonly pd: number;
  readonly pa: number;
  /** Hyperaemic flow actually reached (ml/s). */
  readonly flowMlS: number;
}

/**
 * FFR = Pd / Pa at maximal hyperaemia. The microcirculation is a fixed resistance
 * R = Pa / Qmax (Qmax: flow with no stenosis), in series with the stenosis, so the flow
 * solves Pa = (F + R)·Q + S·Q². The positive root, written as 2Pa / (b + √(b² + 4S·Pa))
 * to stay exact when S → 0, gives Q; then Pd = Q·R and FFR = Q / Qmax.
 */
export function fractionalFlowReserve(lumen: LumenProfile, toArc: number, qmaxMlS: number, paMmHg: number = FFR.aorticMmHg): FfrResult {
  const pa = paMmHg * MMHG_PA;
  const qmax = qmaxMlS * 1e-6;
  const R = pa / qmax;
  const { viscous, separation } = stenosisCoefficients(lumen, toArc);
  const b = viscous + R;
  const q = (2 * pa) / (b + Math.sqrt(b * b + 4 * separation * pa));
  const ffr = Math.min(1, (q * R) / pa);
  return { ffr, pd: ffr * paMmHg, pa: paMmHg, flowMlS: q * 1e6 };
}

/** Hyperaemic flow of the territory a vessel supplies. */
export function hyperaemicFlow(vessel: string): number {
  return FFR.hyperaemicFlowMlS[vessel] ?? FFR.defaultFlowMlS;
}

export function isSignificant(ffr: number): boolean {
  return ffr <= FFR.cutoff;
}
