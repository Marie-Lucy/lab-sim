import { describe, expect, it } from 'vitest';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { caseDef, instantiateCase } from '../src/cases/cases';
import { NO_INPUT } from '../src/tools/deviceController';
import { buildDebrief } from '../src/procedure/debrief';
import { buildSummary } from '../src/procedure/summary';
import { decodeInput, encodeInput, isRecording, Recorder, tickCount, ticksOf } from '../src/replay/recording';
import { buildTimeline, ReplayPlayer } from '../src/replay/replay';
import { CaseRunner } from './caseRunner';

const DT = 0.05;

/** A complete, careful attempt recorded as it is played. */
function recordedCase(caseId: string, seed: number, rngSeed: number, sloppy = false) {
  const inst = instantiateCase(caseDef(caseId), seed);
  const rec = new Recorder(DT);
  const r = new CaseRunner(rngSeed, inst.lesion, inst.setup, rec);
  const s = r.s;
  r.engageAndAngiogram();
  if (sloppy) {
    // Push the wire at full speed through the lesion: forcing, and maybe a dissection.
    s.heparin();
    r.tool('wire');
    r.until({ rotate: -1 }, () => Math.abs(s.ctrl.wire.rotationDeg) < 4);
    r.until({ advance: 1 }, () => s.ctrl.wire.chain.includes('lad') && s.ctrl.wire.tipArc > 75);
  } else r.crossGently();
  r.tool('balloon');
  s.setSize(2.5, 15);
  r.position(0.5);
  if (sloppy) {
    r.until({ inflate: true }, () => s.ctrl.log.ruptures > 0);
    r.wait(1);
  } else r.inflate(10, 6);
  r.withdraw();
  r.tool('measure');
  r.tool('stent');
  s.setSize(3.0, 18);
  r.position(2);
  r.inflate(12, 3);
  r.withdraw();
  r.finalViews();
  const recording = rec.finish({ caseId, seed: inst.seed, rngSeed, exam: false });
  return { inst, s, recording, ticks: rec.ticks };
}

function replay(caseId: string, recording: ReturnType<typeof recordedCase>['recording']) {
  const inst = instantiateCase(caseDef(caseId), recording.seed);
  const p = new ReplayPlayer(buildVesselTree(inst.lesion, inst.setup), recording);
  while (p.step());
  return p;
}

describe('recording', () => {
  it('encodes inputs exactly and run-length compresses held keys', () => {
    const i = { ...NO_INPUT, advance: 1, fine: true, rotate: -1 };
    expect(decodeInput(encodeInput(i, true))).toEqual({ input: i, pedal: true });
    const r = new Recorder(DT);
    for (let k = 0; k < 500; k++) r.tick(i, false);
    r.action({ k: 'heparin' });
    r.tick(i, false);
    r.tick(NO_INPUT, false);
    const rec = r.finish({ caseId: 'classic', seed: 0, rngSeed: 1, exam: false });
    expect(rec.runs.length).toBe(3);
    expect(tickCount(rec)).toBe(502);
    const ticks = [...ticksOf(rec)];
    expect(ticks[500]!.actions).toEqual([{ k: 'heparin' }]);
    expect(ticks.filter((t) => t.actions.length).length).toBe(1);
    expect(isRecording(JSON.parse(JSON.stringify(rec)))).toBe(true);
    expect(isRecording({ v: 2 })).toBe(false);
  });

  it('refuses a variable time step', () => {
    const r = new Recorder(DT);
    expect(() => r.tick(NO_INPUT, false, 0.016)).toThrow(/fixed step/);
  });
});

describe('deterministic replay', () => {
  it('a careful attempt replays to the identical debrief and devices', () => {
    const { s, recording, ticks } = recordedCase('midLad', 4242, 7);
    expect(recording.runs.length).toBeLessThan(ticks / 5);
    const p = replay('midLad', JSON.parse(JSON.stringify(recording)));
    expect(p.tick).toBe(ticks);
    expect(p.session.time).toBe(s.time);
    expect(buildSummary(p.session)).toEqual(buildSummary(s));
    expect(buildDebrief(buildSummary(p.session))).toEqual(buildDebrief(buildSummary(s)));
    expect(p.session.ctrl.treatment.stents).toEqual(s.ctrl.treatment.stents);
    expect(p.session.ctrl.guide).toEqual(s.ctrl.guide);
    expect(p.session.contrastMl).toBe(s.contrastMl);
  });

  it('random events (rupture, dissection rolls) replay identically from the RNG seed', () => {
    const { s, recording } = recordedCase('classic', 0, 99, true);
    expect(s.ctrl.log.ruptures).toBe(1);
    const p = replay('classic', recording);
    expect(p.session.ctrl.log.ruptures).toBe(1);
    expect(p.session.ctrl.treatment.dissections).toEqual(s.ctrl.treatment.dissections);
    expect(p.session.ctrl.wire.forcingS).toBe(s.ctrl.wire.forcingS);
    expect(buildDebrief(buildSummary(p.session)).score).toBe(buildDebrief(buildSummary(s)).score);
  });

  it('the timeline marks the six stages and the problems, in order', () => {
    const { recording } = recordedCase('classic', 0, 99, true);
    const inst = instantiateCase(caseDef('classic'), 0);
    const tl = buildTimeline(() => buildVesselTree(inst.lesion, inst.setup), recording);
    expect(tl.filter((m) => m.kind === 'stage').length).toBe(6);
    expect(tl.some((m) => m.kind === 'warn' && /buckling/.test(m.text))).toBe(true);
    expect(tl.some((m) => m.kind === 'danger' && /rupture/i.test(m.text))).toBe(true);
    const ticks = tl.map((m) => m.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });
});
