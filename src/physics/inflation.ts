import { BALLOON, NC_BALLOON, STENT, type InflationSpec } from '../config/anatomy';

export type PressureStatus = 'deflated' | 'unfolding' | 'ok' | 'aboveRbp' | 'ruptured';

export function balloonSpec(diameter: number, length: number): InflationSpec {
  return {
    nominalDiameter: diameter,
    length,
    nominalPressure: BALLOON.nominalPressure,
    ratedBurstPressure: BALLOON.ratedBurstPressure,
    compliancePerAtm: BALLOON.compliancePerAtm,
    ruptureMargin: BALLOON.ruptureMargin,
    unfoldPressure: BALLOON.unfoldPressure,
    deflatedDiameter: BALLOON.deflatedDiameter,
  };
}

export function ncBalloonSpec(diameter: number, length: number): InflationSpec {
  return {
    nominalDiameter: diameter,
    length,
    nominalPressure: NC_BALLOON.nominalPressure,
    ratedBurstPressure: NC_BALLOON.ratedBurstPressure,
    compliancePerAtm: NC_BALLOON.compliancePerAtm,
    ruptureMargin: NC_BALLOON.ruptureMargin,
    unfoldPressure: NC_BALLOON.unfoldPressure,
    deflatedDiameter: NC_BALLOON.deflatedDiameter,
  };
}

export function stentSpec(diameter: number, length: number): InflationSpec {
  return {
    nominalDiameter: diameter,
    length,
    nominalPressure: STENT.nominalPressure,
    ratedBurstPressure: STENT.ratedBurstPressure,
    compliancePerAtm: STENT.compliancePerAtm,
    ruptureMargin: STENT.ruptureMargin,
    unfoldPressure: STENT.unfoldPressure,
    deflatedDiameter: STENT.deflatedDiameter,
  };
}

/** Semi-compliant line: nominal × (1 + compliance × (P − P_nominal)). */
function compliantDiameter(spec: InflationSpec, pressure: number): number {
  return spec.nominalDiameter * (1 + spec.compliancePerAtm * (pressure - spec.nominalPressure));
}

/**
 * Achieved diameter at a pressure. Above the unfolding pressure it follows the compliance
 * line; below it, it grows linearly from the deflated profile to the value at the unfolding
 * pressure, so the curve is continuous.
 */
export function inflatedDiameter(spec: InflationSpec, pressure: number): number {
  const p = Math.max(0, pressure);
  if (p >= spec.unfoldPressure) return compliantDiameter(spec, p);
  const atUnfold = compliantDiameter(spec, spec.unfoldPressure);
  return spec.deflatedDiameter + (atUnfold - spec.deflatedDiameter) * (p / spec.unfoldPressure);
}

export function rupturePressure(spec: InflationSpec): number {
  return spec.ratedBurstPressure + spec.ruptureMargin;
}

export function isRupture(spec: InflationSpec, pressure: number): boolean {
  return pressure >= rupturePressure(spec);
}

export function pressureStatus(spec: InflationSpec, pressure: number): PressureStatus {
  if (isRupture(spec, pressure)) return 'ruptured';
  if (pressure > spec.ratedBurstPressure) return 'aboveRbp';
  if (pressure >= spec.unfoldPressure) return 'ok';
  if (pressure > 0) return 'unfolding';
  return 'deflated';
}
