import { describe, expect, it } from 'vitest';
import { ECG } from '../src/config/anatomy';
import { createRng, EcgGenerator, ecgSample, jPoint, QRS_ONSET } from '../src/physics/ecg';

const rr = 60 / 72;

function qrsWidth(pvc: boolean): number {
  let first = -1;
  let last = -1;
  for (let t = QRS_ONSET - 0.02; t < QRS_ONSET + 0.25; t += 0.001) {
    if (Math.abs(ecgSample(t, rr, 0, pvc)) > 0.15) {
      if (first < 0) first = t;
      last = t;
    }
    // stop before the T wave region
    if (t > jPoint(pvc) + 0.02) break;
  }
  return last - first;
}

describe('synthetic V2 ECG', () => {
  it('ST segment is elevated by stMm × 0.1 mV at J + 60 ms', () => {
    const t = jPoint() + 0.06;
    for (const st of [1, 2, 4]) {
      const diff = ecgSample(t, rr, st) - ecgSample(t, rr, 0);
      expect(diff).toBeCloseTo(st * ECG.mvPerMm, 2);
    }
  });

  it('baseline (TP segment) is unaffected by ST elevation', () => {
    const t = rr - 0.02;
    expect(ecgSample(t, rr, 4)).toBeCloseTo(ecgSample(t, rr, 0), 6);
  });

  it('has an R peak and a P wave; PVCs are wide and have no P wave', () => {
    expect(ecgSample(QRS_ONSET + ECG.qrsDuration * 0.42, rr, 0)).toBeGreaterThan(0.8);
    expect(ecgSample(ECG.pDuration / 2, rr, 0)).toBeGreaterThan(0.1);
    expect(Math.abs(ecgSample(ECG.pDuration / 2, rr, 0, true))).toBeLessThan(0.01);
    expect(qrsWidth(true)).toBeGreaterThan(qrsWidth(false) * 1.5);
  });

  it('generator emits one beat per RR and PVCs only when likely', () => {
    const gen = new EcgGenerator(createRng(7));
    const { samples, beats } = gen.advance(60, { hr: 60, stMm: 0, pvcChance: 0 });
    expect(samples.length).toBe(60 * ECG.sampleRateHz);
    expect(beats.length).toBeGreaterThanOrEqual(59);
    expect(beats.length).toBeLessThanOrEqual(61);
    expect(beats.every((b) => !b.pvc)).toBe(true);

    const gen2 = new EcgGenerator(createRng(7));
    const out = gen2.advance(60, { hr: 72, stMm: 3, pvcChance: 0.3 });
    expect(out.beats.some((b) => b.pvc)).toBe(true);
  });
});
