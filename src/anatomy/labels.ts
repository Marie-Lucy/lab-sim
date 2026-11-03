import { AORTA } from '../config/anatomy';
import type { VesselId } from './types';

export interface LabelDef {
  readonly id: string;
  readonly vessel: VesselId;
  /** Arc length on the vessel; negative = from the vessel's distal end. */
  readonly arc: number;
  /** For access segments: label the middle of this named segment. */
  readonly segment?: string;
}

export const LABELS: readonly LabelDef[] = [
  { id: 'radial', vessel: 'access', arc: 0, segment: 'radial' },
  { id: 'brachial', vessel: 'access', arc: 0, segment: 'brachial' },
  { id: 'axillary', vessel: 'access', arc: 0, segment: 'axillary' },
  { id: 'subclavian', vessel: 'access', arc: 0, segment: 'subclavian' },
  { id: 'brachiocephalic', vessel: 'access', arc: 0, segment: 'brachiocephalic' },
  { id: 'arch', vessel: 'aorta', arc: AORTA.ascendingLength + 40 },
  { id: 'ascending', vessel: 'aorta', arc: 40 },
  { id: 'descending', vessel: 'aorta', arc: 250 },
  { id: 'root', vessel: 'aorta', arc: 6 },
  { id: 'lm', vessel: 'lm', arc: 4 },
  { id: 'lad', vessel: 'lad', arc: 92 },
  { id: 'd1', vessel: 'd1', arc: 32 },
  { id: 'd2', vessel: 'd2', arc: 26 },
  { id: 'lcx', vessel: 'lcx', arc: 55 },
  { id: 'rca', vessel: 'rca', arc: 75 },
  /** Placed at the case's lesion by the 3D view. */
  { id: 'lesion', vessel: 'lad', arc: 0 },
];
