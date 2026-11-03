import { describe, expect, it } from 'vitest';
import { FFR } from '../src/config/anatomy';
import { lesionBounds } from '../src/anatomy/stenosis';
import { LumenProfile } from '../src/anatomy/lumen';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { caseDef, CLASSIC_LESION, instantiateCase, type CaseInstance } from '../src/cases/cases';
import { fractionalFlowReserve, hyperaemicFlow, isSignificant, stenosisCoefficients } from '../src/physics/ffr';
import { buildDebrief } from '../src/procedure/debrief';
import { isComplete } from '../src/procedure/stages';
import { buildSummary } from '../src/procedure/summary';
import { parseReplayFile, packReplay } from '../src/replay/files';
import { Recorder } from '../src/replay/recording';
import { ReplayPlayer } from '../src/replay/replay';
import { toolAvailability } from '../src/tools/tools';
import { wireTip } from '../src/physics/wire';
import { CaseRunner } from './caseRunner';

const DEF = caseDef('intermediateLad');
const nativeFfr = (inst: CaseInstance) => new CaseRunner(1, inst.lesion, inst.setup).s.nativeFfr;

/** First variant on each side of the cut-off (with a margin so it is clearly one or the other). */
function variant(significant: boolean): CaseInstance {
  for (let seed = 1; seed < 500; seed++) {
    const inst = instantiateCase(DEF, seed);
    const f = nativeFfr(inst);
    if (significant ? f < FFR.cutoff - 0.04 : f > FFR.cutoff + 0.04) return inst;
  }
  throw new Error('no variant');
}

function crossed(inst: CaseInstance, recorder: Recorder | null = null) {
  const r = new CaseRunner(inst.seed, inst.lesion, inst.setup, recorder);
  r.engageAndAngiogram();
  r.crossGently();
  return r;
}

describe('FFR model', () => {
  const vessel = (severity: number, length = 12) => buildVesselTree({ ...CLASSIC_LESION, severity, length, plateau: 2 }).vessels.lad.lumen;
  const ffr = (severity: number, length = 12) => {
    const l = vessel(severity, length);
    return fractionalFlowReserve(l, l.length - 5, hyperaemicFlow('lad')).ffr;
  };

  it('a healthy vessel is ≈ 1; FFR falls steeply as the stenosis tightens', () => {
    expect(ffr(0)).toBeGreaterThan(0.95);
    const series = [0.3, 0.5, 0.6, 0.65, 0.7, 0.8, 0.9].map((s) => ffr(s));
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeLessThan(series[i - 1]!);
    expect(ffr(0.5)).toBeGreaterThan(0.85);
    expect(ffr(0.7)).toBeLessThan(0.7);
    // The classic 90 % lesion is far below the cut-off.
    expect(ffr(0.9)).toBeLessThan(0.2);
  });

  it('a longer lesion of the same severity has a lower FFR (more friction)', () => {
    expect(ffr(0.65, 16)).toBeLessThan(ffr(0.65, 8));
  });

  it('a larger territory (more hyperaemic flow) lowers FFR for the same lesion', () => {
    const l = vessel(0.65);
    expect(fractionalFlowReserve(l, l.length - 5, 2.0).ffr).toBeLessThan(fractionalFlowReserve(l, l.length - 5, 1.2).ffr);
  });

  it('without separation loss, FFR = R / (F + R) (resistances in series)', () => {
    const l = new LumenProfile(60, () => 1.0);
    const { viscous, separation } = stenosisCoefficients(l, 60);
    expect(separation).toBe(0);
    const pa = 90 * 133.322;
    const R = pa / 2e-6;
    expect(fractionalFlowReserve(l, 60, 2).ffr).toBeCloseTo(R / (viscous + R), 10);
  });

  it('the sensor proximal to the lesion reads ≈ 1', () => {
    const l = vessel(0.65);
    expect(fractionalFlowReserve(l, lesionBounds(CLASSIC_LESION).start - 2, 2).ffr).toBeGreaterThan(0.97);
    expect(isSignificant(0.8)).toBe(true);
    expect(isSignificant(0.81)).toBe(false);
  });

  it('the intermediate case gives variants on both sides of 0.80', () => {
    const values = Array.from({ length: 60 }, (_, i) => nativeFfr(instantiateCase(DEF, 1 + i * 997)));
    const sig = values.filter(isSignificant).length;
    expect(sig).toBeGreaterThan(15);
    expect(sig).toBeLessThan(45);
    expect(Math.min(...values)).toBeGreaterThan(0.5);
    expect(Math.max(...values)).toBeLessThan(0.95);
  });
});

describe('the intermediate lesion case', () => {
  it('adds the physiology stage; the balloon waits for a valid FFR', () => {
    const r = crossed(variant(true));
    const s = r.s;
    expect(s.progress.plan.map((p) => p.id)).toContain('physiology');
    expect(s.progress.stage).toBe(3);
    const lock = toolAvailability('balloon', s.facts(), s.progress);
    expect(lock.ok).toBe(false);
    // Pull the sensor back into the lesion: the reading is shown but does not count.
    const c = s.ctrl;
    const { end } = lesionBounds(s.tree.lesion);
    r.tool('wire');
    r.until({ advance: -1, fine: true }, () => wireTip(c.wire)!.arc < end - 1);
    r.tool('ffr');
    r.step();
    expect(s.ffrReadings).toHaveLength(1);
    expect(s.ffrReadings[0]!.beyondLesion).toBeLessThan(FFR.sensorBeyondMm);
    expect(s.decisionFfr).toBeNull();
    expect(r.log.at(-1)).toContain('not past the lesion');
    expect(toolAvailability('balloon', s.facts(), s.progress).ok).toBe(false);
  });

  it('FFR ≤ 0.80 and deferring is the wrong decision: physiology "bad", grade Needs work', () => {
    const r = crossed(variant(true));
    r.tool('ffr');
    r.step();
    expect(isSignificant(r.s.decisionFfr!.ffr)).toBe(true);
    expect(r.log.at(-1)).toMatch(/Pd\/Pa \d+\/90 mmHg · FFR 0\.\d\d: significant/);
    expect(r.s.defer().ok).toBe(true);
    r.step();
    expect(isComplete(r.s.progress)).toBe(true);
    const d = buildDebrief(buildSummary(r.s));
    expect(d.items.find((i) => i.id === 'physiology')!.status).toBe('bad');
    expect(d.grade).toBe('Needs work');
    expect(d.headline).toContain('does not match the FFR');
  });

  it('FFR > 0.80 and deferring is right: the case ends Excellent, stent items do not apply', () => {
    const r = crossed(variant(false));
    r.tool('ffr');
    r.step();
    expect(r.s.defer().ok).toBe(true);
    expect(toolAvailability('balloon', r.s.facts(), r.s.progress).ok).toBe(false);
    r.step();
    expect(r.s.progress.plan).toHaveLength(4);
    const d = buildDebrief(buildSummary(r.s));
    expect(d.items.find((i) => i.id === 'physiology')).toMatchObject({ status: 'ok', value: expect.stringContaining('deferred') });
    expect(d.items.find((i) => i.id === 'stentSize')!.value).toBe('n/a (deferred)');
    expect(d.items.filter((i) => i.status !== 'ok')).toEqual([]);
    expect(d.grade).toBe('Excellent');
    expect(d.headline).toContain('Right call');
  });

  it('FFR > 0.80 but treating anyway: physiology "bad"', () => {
    const r = crossed(variant(false));
    r.tool('ffr');
    r.step();
    r.tool('balloon');
    r.step();
    expect(r.s.progress.stage).toBe(4);
    expect(r.s.defer().ok).toBe(false);
    r.s.ctrl.setCatheterSize(2.5, 15);
    r.position(0.5);
    r.inflate(8, 5);
    const d = buildDebrief(buildSummary(r.s));
    expect(d.items.find((i) => i.id === 'physiology')).toMatchObject({ status: 'bad', value: expect.stringContaining('treated') });
  });

  it('deferring needs the FFR first and is recorded for the replay', () => {
    const inst = variant(false);
    const recorder = new Recorder(0.05);
    const r = crossed(inst, recorder);
    expect(r.s.defer().ok).toBe(false);
    r.tool('ffr');
    r.step();
    r.s.defer();
    r.wait(1);
    const rec = recorder.finish({ caseId: inst.caseId, seed: inst.seed, rngSeed: inst.seed, exam: false });
    const parsed = parseReplayFile(packReplay(rec, { score: 100, grade: 'Excellent', mode: 'practice', durationS: r.s.time, at: 0 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = new ReplayPlayer(buildVesselTree(inst.lesion, inst.setup), parsed.file.recording);
    while (p.step());
    expect(p.session.deferred).toBe(true);
    expect(isComplete(p.session.progress)).toBe(true);
    expect(p.session.decisionFfr!.ffr).toBe(r.s.decisionFfr!.ffr);
  });

  it('after a good stent the FFR rises above the cut-off', () => {
    const inst = variant(true);
    const r = crossed(inst);
    r.tool('ffr');
    r.step();
    const before = r.s.decisionFfr!.ffr;
    r.tool('balloon');
    r.s.ctrl.setCatheterSize(2.5, 15);
    r.position(0.5);
    r.inflate(10, 12);
    r.withdraw();
    r.tool('stent');
    r.s.ctrl.setCatheterSize(3.0, 18);
    r.position(2);
    r.inflate(12, 3);
    r.withdraw();
    r.tool('ffr');
    r.step();
    const after = r.s.ffrReadings.at(-1)!;
    expect(after.beforeTreatment).toBe(false);
    expect(after.ffr).toBeGreaterThan(0.9);
    expect(after.ffr).toBeGreaterThan(before);
    // The decision still uses the pre-treatment reading.
    expect(r.s.decisionFfr!.ffr).toBe(before);
  });

  it('non-FFR cases keep 6 stages and no physiology item', () => {
    const inst = instantiateCase(caseDef('classic'), 0);
    const r = new CaseRunner(1, inst.lesion, inst.setup);
    expect(r.s.progress.plan).toHaveLength(6);
    expect(buildDebrief(buildSummary(r.s)).items.map((i) => i.id)).not.toContain('physiology');
  });
});
