import { D1, D2, LCX, LESION, PATIENT, RCA, WIRE } from '../config/anatomy';
import type { LesionSpec } from '../anatomy/stenosis';
import type { VesselId } from '../anatomy/types';
import { createRng } from '../physics/ecg';

/** A closed range; equal ends mean a fixed value. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

export type Difficulty = 'basic' | 'intermediate' | 'advanced';

/** Things about a case besides the lesion. */
export interface CaseSetup {
  /** Rotation of the wire's shaped tip as it leaves the guide (points at the wrong branch). */
  readonly wireStartDeg: number;
  /** Monitor lead that best shows ischaemia of the target territory. */
  readonly ecgLead: 'V2' | 'V5' | 'II';
  /** Dictionary suffix describing where the lesion is (where.<id>). */
  readonly where: string;
  /** Coronary cusp whose ostium the guide must engage. */
  readonly cusp: 'left' | 'right';
  /** Physiology decides: measure FFR, then treat or defer. */
  readonly ffr: boolean;
  /** The stent result is expected to be checked with IVUS/OCT. */
  readonly imaging: boolean;
}

/** A case template: which vessel, and the ranges each random variant is drawn from. */
export interface CaseDef {
  readonly id: string;
  readonly difficulty: Difficulty;
  readonly vessel: VesselId;
  /** Fixed cases always look the same; others draw a variant from the seed. */
  readonly randomized: boolean;
  readonly lesion: {
    readonly length: Range;
    readonly severity: Range;
    readonly plateau: Range;
    /** Arc window (on the vessel) that must contain the whole lesion. */
    readonly window: Range;
    /** Calcium (0..1): 1 resists expansion until it is cracked. */
    readonly calcium?: number;
  };
  readonly patient: { readonly age: Range; readonly weightKg: Range };
  readonly setup: CaseSetup;
}

/** The lesion of one concrete patient. */
export interface CaseLesion extends LesionSpec {
  readonly vessel: VesselId;
  /** Calcified plaque (0 = none, 1 = resists expansion until cracked). */
  readonly calcium?: number;
}

/** A concrete, reproducible case: template + seed → lesion and patient. */
export interface CaseInstance {
  readonly caseId: string;
  readonly seed: number;
  readonly lesion: CaseLesion;
  readonly patient: { readonly age: number; readonly weightKg: number };
  readonly setup: CaseSetup;
}

const fixed = (v: number): Range => ({ min: v, max: v });
/** Between D1 and D2 with 2 mm of healthy vessel on each side. */
const MID_LAD: Range = { min: D1.originArc + 2, max: D2.originArc - 2 };
/** Mid circumflex: leaves ≥ 20 mm beyond the lesion to park the wire. */
const MID_LCX: Range = { min: 12, max: LCX.length - WIRE.distalParkMargin - 8 };

/** Mid RCA: past the first, straight segment from the ostium, ≥ 20 mm of vessel beyond. */
const MID_RCA: Range = { min: 28, max: RCA.length - WIRE.distalParkMargin - 8 };

export const LAD_SETUP: CaseSetup = { wireStartDeg: WIRE.initialRotationDeg, ecgLead: 'V2', where: 'midLad', cusp: 'left', ffr: false, imaging: false };
const LCX_SETUP: CaseSetup = { wireStartDeg: 20, ecgLead: 'V5', where: 'midLcx', cusp: 'left', ffr: false, imaging: false };
const RCA_SETUP: CaseSetup = { wireStartDeg: 0, ecgLead: 'II', where: 'midRca', cusp: 'right', ffr: false, imaging: false };
export const FFR_LAD_SETUP: CaseSetup = { ...LAD_SETUP, ffr: true };
const CALCIFIED_LAD_SETUP: CaseSetup = { ...LAD_SETUP, imaging: true };

export const CASES: readonly CaseDef[] = [
  {
    id: 'classic',
    difficulty: 'basic',
    vessel: 'lad',
    randomized: false,
    lesion: { length: fixed(LESION.length), severity: fixed(LESION.severity), plateau: fixed(LESION.plateau), window: MID_LAD },
    patient: { age: fixed(PATIENT.ageYears), weightKg: fixed(PATIENT.weightKg) },
    setup: LAD_SETUP,
  },
  {
    id: 'midLad',
    difficulty: 'basic',
    vessel: 'lad',
    randomized: true,
    lesion: { length: { min: 10, max: 18 }, severity: { min: 0.8, max: 0.93 }, plateau: { min: 1, max: 3 }, window: MID_LAD },
    patient: { age: { min: 48, max: 78 }, weightKg: { min: 58, max: 98 } },
    setup: LAD_SETUP,
  },
  {
    id: 'longLad',
    difficulty: 'intermediate',
    vessel: 'lad',
    randomized: true,
    lesion: { length: { min: 23, max: 28 }, severity: { min: 0.84, max: 0.9 }, plateau: { min: 6, max: 10 }, window: MID_LAD },
    patient: { age: { min: 55, max: 80 }, weightKg: { min: 60, max: 95 } },
    setup: LAD_SETUP,
  },
  {
    id: 'criticalLad',
    difficulty: 'advanced',
    vessel: 'lad',
    randomized: true,
    lesion: { length: { min: 8, max: 12 }, severity: { min: 0.95, max: 0.97 }, plateau: { min: 1, max: 2 }, window: MID_LAD },
    patient: { age: { min: 50, max: 82 }, weightKg: { min: 60, max: 100 } },
    setup: LAD_SETUP,
  },
  {
    // 52–70 % straddles FFR 0.80 (about 61 % for the LAD): the angiogram alone cannot tell.
    id: 'intermediateLad',
    difficulty: 'intermediate',
    vessel: 'lad',
    randomized: true,
    lesion: { length: { min: 8, max: 16 }, severity: { min: 0.52, max: 0.7 }, plateau: { min: 1, max: 3 }, window: MID_LAD },
    patient: { age: { min: 45, max: 78 }, weightKg: { min: 58, max: 98 } },
    setup: FFR_LAD_SETUP,
  },
  {
    // Calcium caps every expansion until it is cracked at ≥ 18 atm (needs an NC balloon).
    id: 'calcifiedLad',
    difficulty: 'advanced',
    vessel: 'lad',
    randomized: true,
    lesion: { length: { min: 12, max: 18 }, severity: { min: 0.8, max: 0.88 }, plateau: { min: 4, max: 8 }, window: MID_LAD, calcium: 1 },
    patient: { age: { min: 62, max: 84 }, weightKg: { min: 55, max: 92 } },
    setup: CALCIFIED_LAD_SETUP,
  },
  {
    id: 'midLcx',
    difficulty: 'intermediate',
    vessel: 'lcx',
    randomized: true,
    lesion: { length: { min: 10, max: 16 }, severity: { min: 0.8, max: 0.92 }, plateau: { min: 1, max: 3 }, window: MID_LCX },
    patient: { age: { min: 50, max: 80 }, weightKg: { min: 58, max: 96 } },
    setup: LCX_SETUP,
  },
  {
    id: 'midRca',
    difficulty: 'intermediate',
    vessel: 'rca',
    randomized: true,
    lesion: { length: { min: 10, max: 18 }, severity: { min: 0.8, max: 0.92 }, plateau: { min: 1, max: 3 }, window: MID_RCA },
    patient: { age: { min: 48, max: 80 }, weightKg: { min: 60, max: 100 } },
    setup: RCA_SETUP,
  },
];

export const DEFAULT_CASE_ID = 'classic';
/** The scripted demo always plays the classic case. */
export const DEMO_CASE_ID = 'classic';

export function caseDef(id: string): CaseDef {
  return CASES.find((c) => c.id === id) ?? CASES[0]!;
}

const draw = (r: Range, u: number) => r.min + (r.max - r.min) * u;
const round = (x: number, step: number) => Math.round(x / step) * step;

/**
 * Deterministic variant of a case: the same (case, seed) always gives the same patient.
 * Length, severity and plateau are drawn first; the centre is then drawn so the whole
 * lesion stays inside the case's window. Values are rounded like a report would quote them.
 */
export function instantiateCase(def: CaseDef, seed: number): CaseInstance {
  const rng = createRng(def.randomized ? seed : 1);
  const length = round(draw(def.lesion.length, rng()), 0.5);
  const severity = round(draw(def.lesion.severity, rng()), 0.01);
  const plateau = Math.min(length / 2, round(draw(def.lesion.plateau, rng()), 0.5));
  const lo = def.lesion.window.min + length / 2;
  const hi = def.lesion.window.max - length / 2;
  const centreArc = def.randomized ? round(draw({ min: lo, max: Math.max(lo, hi) }, rng()), 0.5) : LESION.centreArc;
  return {
    caseId: def.id,
    seed: def.randomized ? seed : 0,
    lesion: { vessel: def.vessel, centreArc, length, severity, plateau, ...(def.lesion.calcium ? { calcium: def.lesion.calcium } : {}) },
    patient: { age: Math.round(draw(def.patient.age, rng())), weightKg: Math.round(draw(def.patient.weightKg, rng())) },
    setup: def.setup,
  };
}

/** The classic case (used by default, by the demo and by the tests). */
export const CLASSIC_LESION: CaseLesion = instantiateCase(caseDef('classic'), 0).lesion;

export function randomSeed(rand: () => number = Math.random): number {
  return 1 + Math.floor(rand() * 999_999);
}

/** Short, shareable code for a seed (base 36, upper case). */
export function seedCode(seed: number): string {
  return seed.toString(36).toUpperCase();
}

export function parseSeedCode(code: string): number | null {
  const n = parseInt(code, 36);
  return Number.isFinite(n) && n > 0 && n < 36 ** 6 ? n : null;
}

/** Case and seed from a URL query (`?case=midLad&seed=K3F`), if valid. */
export function caseFromQuery(search: string): { caseId: string; seed: number } | null {
  const q = new URLSearchParams(search);
  const id = q.get('case');
  if (!id || !CASES.some((c) => c.id === id)) return null;
  const seed = parseSeedCode(q.get('seed') ?? '') ?? 0;
  return { caseId: id, seed };
}

export function caseQuery(c: Pick<CaseInstance, 'caseId' | 'seed'>): string {
  return `?case=${encodeURIComponent(c.caseId)}${c.seed ? `&seed=${seedCode(c.seed)}` : ''}`;
}
