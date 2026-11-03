import { CONTRAST, PATIENT, PHYSIOLOGY } from '../config/anatomy';

export interface PhysiologyState {
  /** Myocardial ischaemia of the LAD territory, 0..1. */
  readonly ischaemia: number;
  /** Continuous time the LAD has been occluded (resets on reperfusion). */
  readonly occlusionS: number;
  /** Haemodynamic stress from a long occlusion, 0..1 (decays after reperfusion). */
  readonly stress: number;
  readonly act: number;
  readonly heparinGiven: boolean;
  readonly hr: number;
  readonly systolic: number;
  readonly diastolic: number;
  readonly spo2: number;
  readonly stMm: number;
  /** Probability that the next beat is a PVC. */
  readonly pvcChance: number;
  readonly chestPain: boolean;
  readonly unstable: boolean;
}

export interface PhysiologyInput {
  readonly dt: number;
  /** Flow factor reaching the distal target vessel (0 when a balloon occludes it). */
  readonly targetFlow: number;
}

export function initialPhysiology(): PhysiologyState {
  return derive({
    ischaemia: 0,
    occlusionS: 0,
    stress: 0,
    act: PHYSIOLOGY.baselineAct,
    heparinGiven: false,
  });
}

export function heparinDoseUnits(weightKg: number = PATIENT.weightKg): number {
  return PHYSIOLOGY.heparinUnitsPerKg * weightKg;
}

export function giveHeparin(state: PhysiologyState): PhysiologyState {
  return { ...state, heparinGiven: true };
}

/** Move `value` toward `target` with time constant `tau` (exact exponential step). */
function relax(value: number, target: number, dt: number, tau: number): number {
  return target + (value - target) * Math.exp(-dt / tau);
}

/**
 * Ischaemia target: 1 when occluded, a fraction when flow is below the poor-flow threshold,
 * else 0. It rises linearly (full in ischaemiaRiseS) and recovers exponentially (tau).
 */
export function ischaemiaTarget(targetFlow: number): number {
  if (targetFlow <= CONTRAST.minFlowFactor) return 1;
  if (targetFlow < PHYSIOLOGY.poorFlowThreshold) return 1 - targetFlow / PHYSIOLOGY.poorFlowThreshold;
  return 0;
}

/** Stress from occlusion time: 0 until pvcOcclusionS, 1 at unstableOcclusionS. */
export function occlusionStress(occlusionS: number): number {
  const { pvcOcclusionS: a, unstableOcclusionS: b } = PHYSIOLOGY;
  return Math.min(1, Math.max(0, (occlusionS - a) / (b - a)));
}

export function stepPhysiology(state: PhysiologyState, input: PhysiologyInput): PhysiologyState {
  const { dt, targetFlow } = input;
  const occluded = targetFlow <= CONTRAST.minFlowFactor;

  const target = ischaemiaTarget(targetFlow);
  const ischaemia =
    state.ischaemia < target
      ? Math.min(target, state.ischaemia + dt / PHYSIOLOGY.ischaemiaRiseS)
      : relax(state.ischaemia, target, dt, PHYSIOLOGY.recoveryTauS);

  const occlusionS = occluded ? state.occlusionS + dt : 0;
  const stress = occluded
    ? Math.max(state.stress, occlusionStress(occlusionS))
    : relax(state.stress, 0, dt, PHYSIOLOGY.recoveryTauS);

  const act = state.heparinGiven
    ? relax(state.act, PHYSIOLOGY.heparinAct, dt, PHYSIOLOGY.actRiseTauS)
    : state.act;

  return derive({ ischaemia, occlusionS, stress, act, heparinGiven: state.heparinGiven });
}

type Core = Pick<PhysiologyState, 'ischaemia' | 'occlusionS' | 'stress' | 'act' | 'heparinGiven'>;

/** Vital signs derived from the core state. */
function derive(core: Core): PhysiologyState {
  const P = PHYSIOLOGY;
  return {
    ...core,
    hr: P.baselineHr + P.maxHrIncrease * core.ischaemia,
    systolic: P.baselineSystolic - P.maxSystolicDrop * core.stress,
    diastolic: P.baselineDiastolic - 0.5 * P.maxSystolicDrop * core.stress,
    spo2: P.baselineSpo2 - 2 * core.stress,
    stMm: P.maxStElevationMm * core.ischaemia,
    pvcChance: core.occlusionS > P.pvcOcclusionS ? P.pvcChancePerBeat : 0,
    chestPain: core.ischaemia >= P.chestPainLevel,
    unstable: core.occlusionS > P.unstableOcclusionS,
  };
}

export function meanArterialPressure(s: Pick<PhysiologyState, 'systolic' | 'diastolic'>): number {
  return (s.systolic + 2 * s.diastolic) / 3;
}
