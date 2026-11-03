export type VesselId = 'access' | 'aorta' | 'lm' | 'lad' | 'lcx' | 'd1' | 'd2' | 'rca';

export interface Projection {
  /** Positive = LAO, negative = RAO (deg). */
  readonly lao: number;
  /** Positive = cranial, negative = caudal (deg). */
  readonly cranial: number;
}
