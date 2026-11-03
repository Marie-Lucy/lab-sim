import { FLOW } from '../config/anatomy';

export type TimiGrade = 0 | 1 | 2 | 3;

/**
 * Relative flow through a narrowing: 1 below 60 % DS, then 1 − u², where u runs 0→1
 * from 60 % to 98 % DS, so the loss accelerates as the lumen closes; 0 at ≥ 98 %.
 */
export function flowFactor(diameterStenosis: number): number {
  const { noEffectStenosis: lo, occlusionStenosis: hi, falloffExponent: k } = FLOW;
  if (diameterStenosis <= lo) return 1;
  if (diameterStenosis >= hi) return 0;
  const u = (diameterStenosis - lo) / (hi - lo);
  return 1 - Math.pow(u, k);
}

export function timiGrade(flow: number): TimiGrade {
  if (flow >= FLOW.timi3) return 3;
  if (flow >= FLOW.timi2) return 2;
  if (flow > FLOW.timi1) return 1;
  return 0;
}
