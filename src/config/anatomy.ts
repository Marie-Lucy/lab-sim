/**
 * Every anatomy size, device size and physiology constant of the simulator.
 *
 * Units: 1 scene unit = 1 mm, time in seconds, pressure in atm (devices) or
 * mmHg (blood pressure), angles in degrees, volumes in ml.
 *
 * Values are rounded textbook numbers chosen for teaching, not for clinical use.
 */

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

export const PATIENT = {
  ageYears: 68,
  weightKg: 80,
  sex: 'male' as const,
} as const;

// ---------------------------------------------------------------------------
// Heart
// ---------------------------------------------------------------------------

export const HEART = {
  /** Semi-axes of the base ellipsoid: long (base→apex), width, depth. */
  semiAxes: { long: 60, wide: 45, deep: 36 },
  /** Apex is narrowed to this fraction of the width. */
  apexTaper: 0.45,
  /** The base (AV plane) is flattened by this fraction of the long axis. */
  baseFlatten: 0.25,
  /** Outward bulge of the right ventricle (fraction of width). */
  rvBulge: 0.12,
  /** Heart centre in world space (x = patient left, y = head, z = anterior). */
  centre: [0, 0, 0] as const,
  /** Direction of the long axis toward the apex: left, down and forward. */
  apexDirection: [0.62, -0.55, 0.56] as const,
  /** Theta (deg) of the RV bulge: 0 = anterior, +90 = patient left. */
  rvThetaDeg: -55,
  /** Polar angle (rad from the base pole) of the atrioventricular groove. */
  avGroovePhi: 0.8,
  /** Theta (deg) of the anterior interventricular groove (where the LAD runs). */
  ivGrooveThetaDeg: 18,
  /** Fraction of the cardiac cycle spent in systole. */
  systoleFraction: 0.38,
  /** Peak radial shortening in systole (fraction of radius). */
  contractionAmplitude: 0.06,
  /** Width of the epicardial-fat band in the AV / interventricular grooves (mm). */
  grooveFatWidth: 4.5,
} as const;

// ---------------------------------------------------------------------------
// Vessels (diameters in mm, lengths are arc lengths in mm)
// ---------------------------------------------------------------------------

export const AORTA = {
  rootDiameter: 34,
  ascendingDiameter: 32,
  archDiameter: 28,
  descendingDiameter: 24,
  ascendingLength: 60,
  archLength: 90,
  descendingLength: 120,
  /** Height of the coronary ostia above the aortic annulus. */
  ostiumHeight: 14,
  /** Direction of the aortic root axis (valve → ascending aorta). */
  rootAxis: [-0.22, 0.96, 0.18] as const,
  /** Right cusp is this far (deg) around the root from the left cusp. */
  rightCuspOffsetDeg: -120,
  /**
   * Centreline control points relative to the aortic valve centre:
   * root → ascending → arch → descending.
   */
  centreline: [
    [0, 0, 0],
    [-7, 24, 6],
    [-11, 52, 4],
    [-6, 76, -8],
    [10, 88, -28],
    [26, 80, -46],
    [31, 54, -56],
    [31, 0, -60],
    [29, -70, -60],
    [27, -110, -58],
  ] as const,
  /** Arc length along the aorta at which the brachiocephalic trunk arises. */
  brachiocephalicArc: 72,
} as const;

/**
 * Right radial access path, wrist → aortic arch. Each segment runs along `direction`
 * (built outward from the arch, so directions point away from the heart).
 */
export const ACCESS = {
  segments: [
    { name: 'radial', length: 220, diameter: 2.6, direction: [-0.12, -0.98, 0.16] },
    { name: 'brachial', length: 250, diameter: 4.0, direction: [-0.3, -0.95, 0.1] },
    { name: 'axillary', length: 120, diameter: 6.0, direction: [-0.86, -0.5, 0.05] },
    { name: 'subclavian', length: 90, diameter: 8.0, direction: [-0.92, 0.36, -0.12] },
    { name: 'brachiocephalic', length: 45, diameter: 12.0, direction: [-0.4, 0.9, 0.12] },
  ],
  /** Arc length (from the wrist) at which the elbow is passed. */
  elbowArc: 220,
} as const;

export interface CoronarySpec {
  readonly length: number;
  readonly proximalDiameter: number;
  readonly distalDiameter: number;
}

export interface BranchSpec extends CoronarySpec {
  /** Arc length along the parent vessel at which this branch originates. */
  readonly originArc: number;
  /** Angle (deg) of the branch around the parent axis, used for wire steering. */
  readonly takeoffAngleDeg: number;
}

/**
 * Course of a coronary over the heart surface: theta/phi (surface angles) are quadratic in
 * a walking parameter t; the walk stops when the vessel reaches its length.
 */
export interface SurfaceCourse {
  readonly thetaDeg: number;
  readonly phi: number;
  readonly dThetaDeg: number;
  readonly dPhi: number;
  readonly ddThetaDeg: number;
  readonly ddPhi: number;
}

export const LEFT_MAIN: CoronarySpec & { direction: readonly [number, number, number] } = {
  length: 10,
  proximalDiameter: 4.6,
  distalDiameter: 4.3,
  /** World direction of the LM from the left ostium toward the bifurcation. */
  direction: [0.8, -0.35, 0.48],
};

/** How far the vessel centreline sits outside the epicardium, as a fraction of its radius. */
export const CORONARY_LIFT = 0.6;

/** D1/D2 thetaDeg/phi are offsets from their origin point on the LAD. */
export const COURSES: Record<'lad' | 'lcx' | 'd1' | 'd2' | 'rca', SurfaceCourse> = {
  lad: { thetaDeg: 18, phi: 0.8, dThetaDeg: -8, dPhi: 2.0, ddThetaDeg: 0, ddPhi: 0 },
  lcx: { thetaDeg: 30, phi: 0.82, dThetaDeg: 130, dPhi: 0.1, ddThetaDeg: 0, ddPhi: 0.7 },
  d1: { thetaDeg: 0, phi: 0, dThetaDeg: 60, dPhi: 0.75, ddThetaDeg: 0, ddPhi: 0 },
  d2: { thetaDeg: 0, phi: 0, dThetaDeg: 55, dPhi: 0.7, ddThetaDeg: 0, ddPhi: 0 },
  rca: { thetaDeg: -30, phi: 0.82, dThetaDeg: -150, dPhi: 0.05, ddThetaDeg: 0, ddPhi: 1.2 },
};

/** LAD: reference diameter tapers linearly; 3.5 → 2.0 gives 2.95 mm at the lesion centre. */
export const LAD: CoronarySpec & { takeoffAngleDeg: number } = {
  length: 110,
  proximalDiameter: 3.5,
  distalDiameter: 2.0,
  takeoffAngleDeg: 0,
};

export const LCX: CoronarySpec & { takeoffAngleDeg: number } = {
  length: 80,
  proximalDiameter: 3.4,
  distalDiameter: 2.2,
  takeoffAngleDeg: 180,
};

export const D1: BranchSpec = {
  originArc: 22,
  length: 50,
  proximalDiameter: 2.4,
  distalDiameter: 1.5,
  takeoffAngleDeg: 90,
};

export const D2: BranchSpec = {
  originArc: 58,
  length: 40,
  proximalDiameter: 2.1,
  distalDiameter: 1.4,
  takeoffAngleDeg: 100,
};

export const RCA: CoronarySpec = { length: 120, proximalDiameter: 3.8, distalDiameter: 2.6 };

// ---------------------------------------------------------------------------
// Lesion (mid LAD, between D1 and D2)
// ---------------------------------------------------------------------------

export const LESION = {
  /** Arc length along the LAD (from the LM bifurcation) of the lesion centre. */
  centreArc: 40,
  length: 14,
  /** Diameter stenosis at the narrowest point (0..1). */
  severity: 0.9,
  /** Length of the flat narrowest segment in the middle. */
  plateau: 2,
} as const;

// ---------------------------------------------------------------------------
// Fluoroscopy & C-arm
// ---------------------------------------------------------------------------

export const FLUORO = {
  pulseFps: 15,
  cineFps: 15,
  noiseAmount: 0.08,
  blurPx: 0.6,
  vignette: 0.45,
  /** Side of the square collimation as a fraction of the shorter viewport side. */
  collimation: 0.92,
  /** Contrast absorption coefficient per mm of lumen (darkness = max·(1 − e^(−k·Ø))). */
  contrastAttenuationPerMm: 0.35,
  contrastMaxDarkness: 0.85,
  /** Attenuation of unopacified vessels (nearly invisible). */
  emptyVesselAttenuation: 0.02,
  tissue: { heart: 0.22, spine: 0.28, ribs: 0.12, diaphragm: 0.2 },
  device: {
    guide: 0.35,
    wireBody: 0.45,
    wireTip: 0.85,
    marker: 0.9,
    stentShell: 0.12,
    inflatedBalloon: 0.6,
  },
} as const;

/** Fluoro-only skeleton and soft tissue, relative to the aortic valve centre (mm). */
export const SKELETON = {
  /** Midline is this far to the patient's left of the valve centre. */
  midlineOffsetX: 14,
  /** Spine (vertebral body centres) depth behind the valve. */
  spineOffsetZ: -72,
  vertebraTopY: 170,
  vertebraCount: 13,
  vertebraPitch: 27,
  vertebraSize: { width: 34, height: 20, depth: 28 },
  ribCount: 10,
  ribTopY: 150,
  ribPitch: 27,
  /** Chest half-width and half-depth at the ribs. */
  chestRadius: { x: 135, z: 85 },
  ribRadius: 4.5,
  /** Ribs drop this much from back to front. */
  ribSlope: 45,
  /** Diaphragm domes: top heights (right higher, over the liver). */
  diaphragmRightTopY: -45,
  diaphragmLeftTopY: -68,
  diaphragmRadius: { x: 120, y: 150, z: 110 },
  /** Isocentre and field of view of the X-ray camera. */
  sourceDistance: 900,
  fieldHalf: 95,
} as const;

export interface CArmPreset {
  readonly name: string;
  /** Positive = LAO, negative = RAO (deg). */
  readonly lao: number;
  /** Positive = cranial, negative = caudal (deg). */
  readonly cranial: number;
}

export const C_ARM = {
  presets: [
    { name: 'RAO 30 CRA 30', lao: -30, cranial: 30 },
    { name: 'AP CRA 35', lao: 0, cranial: 35 },
    { name: 'LAO 45 CRA 30', lao: 45, cranial: 30 },
    { name: 'LAO 45 CAU 30 (spider)', lao: 45, cranial: -30 },
    { name: 'RAO 30 CAU 25', lao: -30, cranial: -25 },
    { name: 'AP', lao: 0, cranial: 0 },
  ] satisfies readonly CArmPreset[],
  fineStepDeg: 2,
  laoLimitDeg: 90,
  cranialLimitDeg: 45,
  /** Two projections count as distinct if they differ by at least this angle. */
  distinctViewDeg: 20,
} as const;

// ---------------------------------------------------------------------------
// Contrast & flow
// ---------------------------------------------------------------------------

export const CONTRAST = {
  selectiveVolumeMl: 8,
  aorticVolumeMl: 20,
  selectiveInjectionS: 1.5,
  aorticInjectionS: 2.0,
  /** Contrast front speed in a normal coronary (TIMI 3). */
  coronaryFrontSpeed: 150,
  aorticFrontSpeed: 400,
  /** How long dye lingers at a point after the front passes (washout tail). */
  washoutS: 1.6,
  /** Fraction of a selective injection refluxing into the aortic root. */
  aorticReflux: 0.15,
  /** How far up the aortic root the selective reflux reaches (mm). */
  refluxLength: 28,
  /** Flow factor below which the front is considered stopped. */
  minFlowFactor: 0.02,
  cineMinS: 3,
  cineMaxS: 9,
  cineMarginS: 0.8,
} as const;

export const FLOW = {
  /** Diameter stenosis below which flow is unaffected. */
  noEffectStenosis: 0.6,
  /** Diameter stenosis at or above which flow is zero. */
  occlusionStenosis: 0.98,
  /** Exponent of the fall-off: flow = 1 − u^k, u = normalised stenosis. */
  falloffExponent: 2,
  timi3: 0.8,
  timi2: 0.25,
  timi1: 0.02,
  /** Flow multiplier downstream of an unsealed dissection. */
  dissectionPenalty: 0.45,
} as const;

/**
 * Fractional flow reserve. The pressure drop across the vessel follows the classic
 * stenosis equation ΔP = F·Q + S·Q² (Gould; Young & Tsai): F is Poiseuille friction summed
 * along the lumen, S the energy lost when the jet re-expands after the narrowest point.
 */
export const FFR = {
  /** Whole-blood viscosity (Pa·s). */
  viscosityPaS: 0.0035,
  /** Blood density (kg/m³). */
  densityKgM3: 1050,
  /** Young & Tsai expansion-loss coefficient (dimensionless). */
  expansionLoss: 1.52,
  /** Mean aortic pressure during hyperaemia (mmHg). */
  aorticMmHg: 90,
  /** Hyperaemic flow (ml/s) the territory would take with no stenosis: larger for the LAD. */
  hyperaemicFlowMlS: { lad: 2.0, lcx: 1.5, rca: 1.5 } as Record<string, number>,
  /** Flow used for a branch that is not listed. */
  defaultFlowMlS: 1.2,
  /** FFR at or below this is haemodynamically significant (FAME). */
  cutoff: 0.8,
  /** The sensor must sit at least this far past the lesion's distal end (mm). */
  sensorBeyondMm: 5,
  /** Intracoronary adenosine bolus quoted in the message (µg). */
  adenosineUg: 200,
} as const;

/** Intravascular imaging: IVUS and OCT pullbacks over the wire. */
export const IMAGING = {
  /** Distance between frames of a pullback (mm). */
  frameMm: 0.5,
  /** External elastic membrane diameter relative to the healthy lumen (reference plaque ≈ 24 %). */
  eemOverReference: 1.15,
  /** A frame with plaque burden ≥ this is part of the lesion (IVUS definition). */
  lesionPlaqueBurden: 0.5,
  /** Landing zones for the stent: the nearest near-normal frames (healthy wall ≈ 24 %). */
  landingPlaqueBurden: 0.3,
  /** References: the largest lumen within this distance beyond the segment. */
  referenceSearchMm: 10,
  /** Contrast flushed through the guide to clear blood for OCT (ml). */
  octFlushMl: 14,
  /** OCT light penetrates this much plaque; beyond it the EEM is not seen (mm). */
  octPenetrationMm: 1.0,
  /** Strut-to-wall distance that counts as malapposition (mm). */
  malappositionMm: 0.4,
  /** Optimal expansion: MSA ≥ this fraction of the mean reference lumen area. */
  expansionGoal: 0.9,
  /** Suggested stent: about this × the mean reference lumen diameter. */
  sizingFactor: 1.05,
  /** Below this expansion the stent is clearly under-expanded (debrief "bad"). */
  expansionBad: 0.8,
} as const;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const GUIDE = {
  french: 6,
  outerDiameter: 2.0,
  innerDiameter: 1.8,
  advanceSpeed: 60,
  fineAdvanceSpeed: 12,
  wheelStep: 5,
  fineWheelStep: 1,
  rotateSpeedDeg: 90,
  fineRotateSpeedDeg: 25,
  /** Tip rotation that faces the left coronary cusp. */
  leftCuspAngleDeg: 0,
  /** Tip rotation that faces the right coronary cusp. */
  rightCuspAngleDeg: 120,
  engageToleranceDeg: 25,
  /** Rotating further than this from the left cusp while engaged pops the guide out. */
  popOutTorqueDeg: 40,
  /** Advance speed considered gentle enough to seat the guide. */
  gentleEngageSpeed: 20,
  /** Length of the pre-shaped curved tip. */
  curveLength: 35,
  /** Arc length along the aorta (from the valve) where the guide stops at the root. */
  rootStopAortaArc: 16,
  /** Rotation of the tip when it is introduced at the wrist. */
  initialRotationDeg: 70,
} as const;

/** Time constant (s) of the speed estimate used for "gentle" and "forcing" checks. */
export const SPEED_TAU = 0.3;

export const WIRE = {
  diameterInch: 0.014,
  diameter: 0.356,
  radiopaqueTipLength: 30,
  advanceSpeed: 20,
  fineAdvanceSpeed: 5,
  wheelStep: 2,
  fineWheelStep: 0.5,
  rotateSpeedDeg: 120,
  fineRotateSpeedDeg: 30,
  /** Branch is captured if the tip rotation is within this of the takeoff angle. */
  branchCaptureDeg: 50,
  /** Show the upcoming-branch hint this far before a bifurcation. */
  branchHintDistance: 12,
  /** Advancing faster than this inside the lesion buckles the wire. */
  safeLesionSpeed: 8,
  /** Rotating while advancing raises the safe speed by this factor. */
  torqueSpeedBonus: 1.5,
  /** Dissection risk gained per second per unit of relative overspeed. */
  riskGainPerS: 0.25,
  maxDissectionRisk: 0.9,
  /** Warn when the tip is this close to the end of a vessel. */
  vesselEndWarning: 5,
  /** Wire tip must be at least this far beyond the lesion to count as "distal". */
  distalParkMargin: 20,
  /** Shaped-tip rotation when the wire leaves the guide (points toward the LCx). */
  initialRotationDeg: 150,
  /** The tip stops this far short of a vessel's end. */
  endStop: 1,
} as const;

export interface InflationSpec {
  readonly nominalDiameter: number;
  readonly length: number;
  readonly nominalPressure: number;
  readonly ratedBurstPressure: number;
  /** Fractional diameter change per atm away from nominal. */
  readonly compliancePerAtm: number;
  /** Rupture happens at RBP + this margin. */
  readonly ruptureMargin: number;
  /** Below this pressure the balloon is still unfolding. */
  readonly unfoldPressure: number;
  /** Crossing profile when fully deflated. */
  readonly deflatedDiameter: number;
}

export const BALLOON = {
  diameters: [2.0, 2.5, 3.0, 3.5],
  lengths: [12, 15, 20],
  nominalPressure: 8,
  ratedBurstPressure: 14,
  compliancePerAtm: 0.015,
  ruptureMargin: 4,
  unfoldPressure: 2,
  deflatedDiameter: 0.9,
  /** Inflation / deflation rates (atm/s). */
  inflateRate: 3,
  fineInflateRate: 0.75,
  deflateRate: 6,
  /** Distal tip beyond the working length. */
  tipLength: 4,
  /** Balloon tip must stay at least this far behind the wire tip. */
  minWireLead: 10,
  advanceSpeed: 20,
  fineAdvanceSpeed: 4,
  wheelStep: 2,
  fineWheelStep: 0.5,
  maxPressure: 22,
  defaultSize: { diameter: 2.0, length: 12 },
  /** How far back inside the guide a withdrawn catheter can be pulled. */
  minAdvance: -20,
} as const;

/**
 * Non-compliant balloon for high-pressure dilation: it barely grows with pressure
 * (0.4 %/atm vs 1.5 % for the semi-compliant one) and tolerates 20 atm, so it can crack
 * calcium or expand a stent without stretching the vessel beyond its size.
 */
export const NC_BALLOON = {
  diameters: [2.5, 2.75, 3.0, 3.25, 3.5, 4.0],
  lengths: [8, 12, 15],
  nominalPressure: 12,
  ratedBurstPressure: 20,
  compliancePerAtm: 0.004,
  ruptureMargin: 2,
  unfoldPressure: 2,
  deflatedDiameter: 1.0,
  defaultSize: { diameter: 3.0, length: 12 },
} as const;

/**
 * Calcified plaque: until it fractures, any device opens the lesion only part of the way
 * from the native lumen to its own diameter. It fractures at crackPressure, which a
 * semi-compliant balloon cannot reach (it ruptures at 14 + 4 = 18 atm).
 */
export const CALCIUM = {
  crackPressure: 18,
  /** Fraction of the way to the device diameter reached while the calcium is intact. */
  uncrackedFraction: 0.55,
} as const;

export const STENT = {
  diameters: [2.5, 2.75, 3.0, 3.5, 4.0],
  lengths: [12, 15, 18, 23, 28],
  nominalPressure: 10,
  ratedBurstPressure: 16,
  compliancePerAtm: 0.012,
  ruptureMargin: 4,
  unfoldPressure: 2,
  deflatedDiameter: 1.1,
  /** Pressure at which the stent becomes permanently deployed. */
  deployPressure: 6,
  maxPressure: 22,
  defaultSize: { diameter: 2.5, length: 15 },
} as const;

/** QCA: a segment counts as lesion where the diameter stenosis exceeds this. */
export const QCA = {
  lesionThreshold: 0.01,
  /** Reference diameter is averaged this far outside the lesion shoulders. */
  referenceOffset: 3,
} as const;

/** Elastic recoil after deflation (fraction of the stretched diameter lost). */
export const RECOIL = {
  balloon: 0.3,
  stent: 0.03,
  /** Length of the smooth taper at each end of a treated segment. */
  edgeTaper: 2,
} as const;

export const DISSECTION = {
  /** Device diameter above this × reference diameter dissects the vessel. */
  oversizeRatio: 1.2,
  /** Edge dissection starts this far beyond the stent end. */
  stentEdgeOffset: 1,
  length: 8,
  /** Probability that a balloon rupture dissects the vessel. */
  ruptureDissectionChance: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Physiology
// ---------------------------------------------------------------------------

export const PHYSIOLOGY = {
  /** Time to reach full ischaemia with a totally occluded LAD. */
  ischaemiaRiseS: 20,
  /** Flow factor below which ischaemia also builds (scaled by how poor flow is). */
  poorFlowThreshold: 0.25,
  /** Recovery time constant after reperfusion. */
  recoveryTauS: 8,
  /** Maximum ST elevation in V2 (mm, 1 mm = 0.1 mV). */
  maxStElevationMm: 4,
  /** Ischaemia level at which the patient reports chest pain. */
  chestPainLevel: 0.35,
  baselineHr: 72,
  maxHrIncrease: 28,
  baselineSystolic: 128,
  baselineDiastolic: 76,
  /** Occlusion time after which BP drops and PVCs appear. */
  pvcOcclusionS: 40,
  /** Systolic drop at full instability (mmHg). */
  maxSystolicDrop: 35,
  /** Probability of a PVC per beat once beyond pvcOcclusionS. */
  pvcChancePerBeat: 0.2,
  /** Occlusion time after which the patient becomes unstable. */
  unstableOcclusionS: 60,
  baselineSpo2: 98,
  baselineAct: 128,
  heparinAct: 285,
  heparinUnitsPerKg: 100,
  /** Time constant of the ACT rise after heparin (compressed for teaching). */
  actRiseTauS: 15,
} as const;

/** Synthetic V2 ECG morphology (mV, seconds). */
export const ECG = {
  sweepMmPerS: 25,
  sampleRateHz: 250,
  pDuration: 0.09,
  prInterval: 0.16,
  qrsDuration: 0.09,
  qtInterval: 0.38,
  amplitude: { p: 0.12, q: -0.08, r: 0.9, s: -0.7, t: 0.35 },
  mvPerMm: 0.1,
  pvc: { qrsDuration: 0.16, amplitude: 1.5, tAmplitude: -0.5 },
  /** A PVC arrives after this fraction of the RR interval; the next beat after 2 − this. */
  pvcPrematurity: 0.6,
  /** RR interval at which the base QT applies (Bazett scaling around it). */
  referenceRr: 60 / 72,
} as const;

// ---------------------------------------------------------------------------
// Debrief thresholds
// ---------------------------------------------------------------------------

export const DEBRIEF = {
  maxResidualStenosis: 0.1,
  stentRatioMin: 0.95,
  stentRatioMax: 1.15,
  minCoverageMargin: 1.5,
  maxInflationS: 30,
  maxContrastMl: 120,
  maxFluoroS: 600,
  minFinalViews: 2,
  /** Warn (rather than bad) bands just outside the ok limits. */
  warnResidualStenosis: 0.3,
  warnStentRatioMin: 0.9,
  warnStentRatioMax: 1.2,
  warnInflationS: 60,
  warnContrastMl: 200,
  warnFluoroS: 900,
  warnWireForcingS: 3,
  /** Points lost for a "bad" item; a "warn" loses half. Sums to 100. */
  weights: {
    residual: 15,
    timi: 12,
    stentSize: 10,
    coverage: 10,
    extraStents: 4,
    heparin: 8,
    predilation: 5,
    qca: 4,
    dissection: 10,
    wireForcing: 4,
    rupture: 5,
    inflation: 4,
    contrast: 3,
    fluoro: 3,
    views: 3,
    /** Only in physiology cases: treating or deferring against the FFR outweighs technique. */
    physiology: 45,
    /** Only when imaging is expected (calcified case) or was used after the stent. */
    optimisation: 10,
  },
  grades: { excellent: 90, good: 75, acceptable: 60 },
} as const;

/** Exam mode: no mentor or hints, a time limit, and a local attempt history. */
export const EXAM = {
  /** Simulated seconds allowed (the clock stops while paused). */
  timeLimitS: 15 * 60,
  /** The remaining time turns into a warning below this. */
  warnRemainingS: 120,
  /** Attempts kept in the browser's history. */
  historySize: 50,
} as const;

/** Feedback messages with the same text are suppressed for this long. */
export const MESSAGES = {
  repeatSuppressS: 4,
  maxShown: 4,
} as const;
