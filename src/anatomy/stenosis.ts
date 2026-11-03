import { LAD, LESION } from '../config/anatomy';

export interface LesionSpec {
  /** Arc length of the lesion centre along its vessel (mm). */
  readonly centreArc: number;
  readonly length: number;
  /** Diameter stenosis at the narrowest point (0..1). */
  readonly severity: number;
  /** Length of the flat narrowest segment. */
  readonly plateau: number;
}

export function lesionBounds(lesion: LesionSpec = LESION): { start: number; end: number } {
  return { start: lesion.centreArc - lesion.length / 2, end: lesion.centreArc + lesion.length / 2 };
}

/**
 * Narrowing shape in [0, 1]: 1 on the central plateau, cosine taper to 0 at the lesion ends.
 */
export function stenosisShape(arc: number, lesion: LesionSpec = LESION): number {
  const d = Math.abs(arc - lesion.centreArc);
  const half = lesion.length / 2;
  const halfPlateau = lesion.plateau / 2;
  if (d >= half) return 0;
  if (d <= halfPlateau) return 1;
  const u = (d - halfPlateau) / (half - halfPlateau);
  return 0.5 * (1 + Math.cos(Math.PI * u));
}

/** Linear taper of a vessel's reference diameter along its length. */
export function taperedDiameter(arc: number, length: number, proximal: number, distal: number): number {
  const t = Math.min(1, Math.max(0, arc / length));
  return proximal + (distal - proximal) * t;
}

export function ladReferenceDiameter(arc: number): number {
  return taperedDiameter(arc, LAD.length, LAD.proximalDiameter, LAD.distalDiameter);
}

/** Native (untreated) LAD lumen diameter at an arc length (classic lesion by default). */
export function ladNativeDiameter(arc: number, lesion: LesionSpec = LESION): number {
  return ladReferenceDiameter(arc) * (1 - lesion.severity * stenosisShape(arc, lesion));
}

/** Percent diameter stenosis as a fraction: 1 − MLD / reference, clamped to [0, 1]. */
export function diameterStenosis(minLumenDiameter: number, referenceDiameter: number): number {
  if (referenceDiameter <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - minLumenDiameter / referenceDiameter));
}
