import { DEBRIEF, DISSECTION } from '../config/anatomy';

export function oversizeRatio(deviceDiameter: number, referenceDiameter: number): number {
  return referenceDiameter > 0 ? deviceDiameter / referenceDiameter : Infinity;
}

/** Balloon or stent wider than 1.2 × reference tears the vessel wall. */
export function causesOversizeDissection(deviceDiameter: number, referenceDiameter: number): boolean {
  return oversizeRatio(deviceDiameter, referenceDiameter) > DISSECTION.oversizeRatio;
}

export type SizeVerdict = 'undersized' | 'ok' | 'oversized';

export function stentSizeVerdict(ratio: number): SizeVerdict {
  if (ratio < DEBRIEF.stentRatioMin) return 'undersized';
  if (ratio > DEBRIEF.stentRatioMax) return 'oversized';
  return 'ok';
}

export interface Span {
  /** Proximal end (smaller arc length). */
  readonly start: number;
  /** Distal end (larger arc length). */
  readonly end: number;
}

export interface CoverageMargins {
  /** How far the device extends proximal to the lesion start (negative = lesion uncovered). */
  readonly proximal: number;
  /** How far the device extends distal to the lesion end (negative = lesion uncovered). */
  readonly distal: number;
  readonly geographicMiss: boolean;
  readonly adequate: boolean;
}

/** Working-length span of a device whose distal marker sits at `distalArc`. */
export function deviceSpan(distalArc: number, length: number): Span {
  return { start: distalArc - length, end: distalArc };
}

export function coverageMargins(device: Span, lesion: Span): CoverageMargins {
  const proximal = lesion.start - device.start;
  const distal = device.end - lesion.end;
  const geographicMiss = proximal < 0 || distal < 0;
  return {
    proximal,
    distal,
    geographicMiss,
    adequate: !geographicMiss && Math.min(proximal, distal) >= DEBRIEF.minCoverageMargin,
  };
}

/** Fraction of the lesion length lying inside the device span. */
export function coveredFraction(device: Span, lesion: Span): number {
  const overlap = Math.min(device.end, lesion.end) - Math.max(device.start, lesion.start);
  const len = lesion.end - lesion.start;
  return len > 0 ? Math.max(0, overlap) / len : 0;
}
