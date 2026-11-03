import { QCA } from '../config/anatomy';
import { lesionBounds } from '../anatomy/stenosis';
import type { CaseLesion } from '../cases/cases';
import { CLASSIC_LESION } from '../cases/cases';
import type { LumenProfile } from '../anatomy/lumen';
import { diameterStenosis } from '../anatomy/stenosis';

export interface QcaResult {
  readonly referenceDiameter: number;
  readonly mld: number;
  readonly mldArc: number;
  /** Diameter stenosis 0..1. */
  readonly ds: number;
  /** Shoulder-to-shoulder length where %DS exceeds the threshold. */
  readonly lesionLength: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Quantitative coronary angiography of the target segment around the lesion: find the minimal
 * lumen diameter, grow the lesion both ways while %DS > 1 %, and take the reference as the
 * mean lumen 3 mm outside each shoulder (the healthy segments the eye would compare to).
 */
/** Segment QCA analyses: the lesion with 8 mm of vessel on each side. */
export function qcaWindow(lesion: CaseLesion, lumen: LumenProfile): { from: number; to: number } {
  const { start, end } = lesionBounds(lesion);
  return { from: Math.max(1, start - 8), to: Math.min(lumen.length - 1, end + 8) };
}

export function measureQca(lumen: LumenProfile, lesion: CaseLesion = CLASSIC_LESION, window = qcaWindow(lesion, lumen)): QcaResult {
  const { from, to } = window;
  const min = lumen.minimum(from, to);
  const dsAt = (s: number) => diameterStenosis(lumen.diameterAt(s), lumen.referenceAt(s));
  let a = min.arc;
  let b = min.arc;
  const step = lumen.spacing;
  while (a - step >= from && dsAt(a - step) > QCA.lesionThreshold) a -= step;
  while (b + step <= to && dsAt(b + step) > QCA.lesionThreshold) b += step;
  const lesionLength = dsAt(min.arc) > QCA.lesionThreshold ? b - a : 0;
  const ref =
    lesionLength > 0
      ? (lumen.diameterAt(a - QCA.referenceOffset) + lumen.diameterAt(b + QCA.referenceOffset)) / 2
      : lumen.referenceAt(min.arc);
  return {
    referenceDiameter: ref,
    mld: min.diameter,
    mldArc: min.arc,
    ds: diameterStenosis(min.diameter, ref),
    lesionLength,
    from: a,
    to: b,
  };
}
