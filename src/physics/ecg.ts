import { ECG } from '../config/anatomy';

/** Seeded uniform random in [0, 1) — mulberry32. Deterministic for tests and demo. */
export function createRng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(t: number, centre: number, sigma: number): number {
  const x = (t - centre) / sigma;
  return Math.exp(-0.5 * x * x);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Bazett: QT scales with √RR around the reference rate. */
export function qtInterval(rr: number): number {
  return ECG.qtInterval * Math.sqrt(rr / ECG.referenceRr);
}

/** Time from beat onset (P onset) to QRS onset; the same for PVCs so beeps line up. */
export const QRS_ONSET = ECG.prInterval;

/** J point (end of QRS) relative to beat onset. */
export function jPoint(pvc = false): number {
  return QRS_ONSET + (pvc ? ECG.pvc.qrsDuration : ECG.qrsDuration);
}

/**
 * V2 voltage (mV) at time `t` since beat onset. Sinus beats are a sum of Gaussians for
 * P, Q, R, S and T; ST elevation adds a plateau from the J point to the end of T
 * (stMm × 0.1 mV). PVCs have no P wave, a wide QRS and a discordant T.
 */
export function ecgSample(t: number, rr: number, stMm: number, pvc = false): number {
  const qt = qtInterval(rr);
  const tEnd = QRS_ONSET + qt;
  if (pvc) {
    const w = ECG.pvc.qrsDuration;
    return (
      ECG.pvc.amplitude * gauss(t, QRS_ONSET + w * 0.45, w / 4.5) +
      ECG.pvc.tAmplitude * gauss(t, tEnd - 0.08, 0.06)
    );
  }
  const a = ECG.amplitude;
  const q = ECG.qrsDuration;
  const j = jPoint();
  const tCentre = tEnd - 0.1;
  const wave =
    a.p * gauss(t, ECG.pDuration / 2, ECG.pDuration / 6) +
    a.q * gauss(t, QRS_ONSET + q * 0.15, q / 14) +
    a.r * gauss(t, QRS_ONSET + q * 0.42, q / 10) +
    a.s * gauss(t, QRS_ONSET + q * 0.72, q / 10) +
    a.t * gauss(t, tCentre, 0.045);
  const st = stMm * ECG.mvPerMm * smoothstep(j - 0.015, j + 0.01, t) * (1 - smoothstep(tCentre, tEnd, t));
  return wave + st;
}

export interface EcgParams {
  readonly hr: number;
  readonly stMm: number;
  readonly pvcChance: number;
}

export interface BeatEvent {
  /** Stream time of the QRS onset. */
  readonly time: number;
  readonly pvc: boolean;
}

/**
 * Stateful (but DOM-free) ECG sample stream. Each beat's RR and type are decided when the
 * beat starts; a PVC comes early and is followed by a compensatory pause.
 */
export class EcgGenerator {
  private time = 0;
  private beatStart = 0;
  private rr: number;
  private pvc = false;
  private compensate = false;
  private qrsEmitted = false;

  constructor(
    private readonly rng: () => number = Math.random,
    readonly sampleRate: number = ECG.sampleRateHz,
  ) {
    this.rr = 60 / 72;
  }

  advance(dt: number, params: EcgParams): { samples: number[]; beats: BeatEvent[] } {
    const samples: number[] = [];
    const beats: BeatEvent[] = [];
    const step = 1 / this.sampleRate;
    const n = Math.max(0, Math.round(dt * this.sampleRate));
    for (let i = 0; i < n; i++) {
      this.time += step;
      if (this.time - this.beatStart >= this.rr) this.startBeat(params);
      const local = this.time - this.beatStart;
      if (!this.qrsEmitted && local >= QRS_ONSET) {
        this.qrsEmitted = true;
        beats.push({ time: this.beatStart + QRS_ONSET, pvc: this.pvc });
      }
      samples.push(ecgSample(local, this.rr, this.pvc ? 0 : params.stMm, this.pvc));
    }
    return { samples, beats };
  }

  private startBeat(params: EcgParams): void {
    this.beatStart += this.rr;
    const base = 60 / Math.max(20, params.hr);
    this.qrsEmitted = false;
    if (this.compensate) {
      this.compensate = false;
      this.pvc = false;
      this.rr = base * (2 - ECG.pvcPrematurity);
    } else if (this.rng() < params.pvcChance) {
      this.pvc = true;
      this.compensate = true;
      this.rr = base * ECG.pvcPrematurity;
    } else {
      this.pvc = false;
      this.rr = base;
    }
  }
}
