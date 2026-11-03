import { describe, expect, it } from 'vitest';
import { CALCIUM, IMAGING } from '../src/config/anatomy';
import { caseDef, CLASSIC_LESION, instantiateCase, type CaseInstance } from '../src/cases/cases';
import { currentDiameter, newCatheter, setBalloonType } from '../src/physics/catheter';
import { inflatedDiameter, ncBalloonSpec, balloonSpec, rupturePressure } from '../src/physics/inflation';
import { calciumLimited } from '../src/physics/treatment';
import { buildDebrief } from '../src/procedure/debrief';
import { mentorHint } from '../src/procedure/mentorHints';
import { buildSummary } from '../src/procedure/summary';
import { parseReplayFile, packReplay } from '../src/replay/files';
import { Recorder } from '../src/replay/recording';
import { CaseRunner } from './caseRunner';

const INST: CaseInstance = instantiateCase(caseDef('calcifiedLad'), 4242);

function crossed(inst: CaseInstance = INST, recorder: Recorder | null = null) {
  const r = new CaseRunner(inst.seed, inst.lesion, inst.setup, recorder);
  r.engageAndAngiogram();
  r.crossGently();
  return r;
}

function balloon(r: CaseRunner, nc: boolean, d: number, len: number, atm: number) {
  r.tool('balloon');
  r.s.setBalloonType(nc);
  r.s.ctrl.setCatheterSize(d, len);
  r.position(0.5);
  r.inflate(atm, 5);
  r.withdraw();
}

function stent(r: CaseRunner, d = 3.0, len = 23, atm = 12) {
  r.tool('measure');
  r.tool('stent');
  r.s.ctrl.setCatheterSize(d, len);
  r.position((len - r.s.tree.lesion.length) / 2);
  r.inflate(atm, 3);
  r.withdraw();
}

const item = (r: CaseRunner, id: string) => buildDebrief(buildSummary(r.s)).items.find((i) => i.id === id);

describe('non-compliant balloon', () => {
  it('barely grows with pressure and tolerates 20 atm', () => {
    const nc = ncBalloonSpec(3.0, 12);
    const sc = balloonSpec(3.0, 12);
    expect(inflatedDiameter(nc, 20)).toBeCloseTo(3.0 * (1 + 0.004 * 8), 6);
    expect(inflatedDiameter(sc, 14)).toBeCloseTo(3.0 * (1 + 0.015 * 6), 6);
    expect(rupturePressure(sc)).toBe(CALCIUM.crackPressure);
    expect(rupturePressure(nc)).toBe(22);
  });

  it('switching type keeps the nearest size on the shelf, only inside the guide', () => {
    const r = setBalloonType({ ...newCatheter('balloon'), diameter: 2.0, length: 20 }, true);
    expect(r.ok).toBe(true);
    expect(r.state).toMatchObject({ nc: true, diameter: 2.5, length: 15 });
    expect(currentDiameter(r.state)).toBeLessThan(1.1);
    expect(setBalloonType({ ...r.state, advanced: 30 }, false).ok).toBe(false);
    expect(setBalloonType(newCatheter('stent'), true).ok).toBe(false);
  });
});

describe('calcified lesion', () => {
  it('intact calcium lets a device reach only 55 % of the way', () => {
    expect(calciumLimited(1, 3, 0)).toBe(3);
    expect(calciumLimited(1, 3, 1)).toBeCloseTo(1 + 2 * CALCIUM.uncrackedFraction, 10);
    expect(calciumLimited(1, 3, 0.5)).toBeCloseTo(1 + 2 * (1 - 0.45 * 0.5), 10);
    expect(calciumLimited(2, 1, 1)).toBe(2);
  });

  it('a semi-compliant balloon ruptures before it can crack the calcium', () => {
    const r = crossed();
    r.tool('balloon');
    r.s.ctrl.setCatheterSize(2.5, 15);
    r.position(0.5);
    r.until({ inflate: true }, () => r.s.ctrl.log.ruptures > 0, 30);
    expect(r.s.ctrl.treatment.cracked).toBe(false);
    expect(r.s.ctrl.log.crackedAt).toBeNull();
  });

  it('without cracking, the stent stays under-expanded: IVUS shows it and the debrief scores it', () => {
    const r = crossed();
    balloon(r, false, 2.5, 15, 12);
    stent(r);
    r.s.pullback('ivus');
    const m = r.s.imaging.at(-1)!.summary;
    expect(m.expansion!).toBeLessThan(IMAGING.expansionBad);
    const calc = r.s.imaging.at(-1)!.frames.find((f) => Math.abs(f.arc - INST.lesion.centreArc) < 0.3)!;
    expect(calc.calcium).toBeGreaterThan(0.9);
    expect(calc.cracked).toBe(false);
    expect(item(r, 'optimisation')!.status).toBe('bad');
    expect(item(r, 'residual')!.status).toBe('bad');
    r.step();
    expect(mentorHint(r.s).text).toMatch(/under-expanded/);
  });

  it('NC post-dilation at ≥ 18 atm cracks the calcium and expands the stent already in place', () => {
    const r = crossed();
    balloon(r, false, 2.5, 15, 12);
    stent(r);
    r.s.pullback('ivus');
    const before = r.s.imaging.at(-1)!.summary.expansion!;
    balloon(r, true, 3.0, 15, 18);
    expect(r.s.ctrl.treatment.cracked).toBe(true);
    expect(r.log.some((l) => l.startsWith('Calcium fractured at 18 atm'))).toBe(true);
    // Imaging before the post-dilation no longer counts.
    expect(item(r, 'optimisation')).toMatchObject({ status: 'warn', value: 'not checked after the stent' });
    r.s.pullback('oct');
    const after = r.s.imaging.at(-1)!.summary;
    expect(after.expansion!).toBeGreaterThan(before);
    expect(after.expansion!).toBeGreaterThanOrEqual(IMAGING.expansionGoal);
    expect(item(r, 'optimisation')!.status).toBe('ok');
    expect(item(r, 'residual')!.status).toBe('ok');
  });

  it('the mentor points to the NC balloon until the calcium is cracked', () => {
    const r = crossed();
    r.tool('wire');
    r.step();
    expect(mentorHint(r.s).text).toMatch(/calcified/);
    r.tool('balloon');
    r.s.setBalloonType(true);
    expect(mentorHint(r.s).text).not.toMatch(/calcified/);
  });

  it('balloon type is a recorded, validated replay action', () => {
    const recorder = new Recorder(0.05);
    const r = crossed(INST, recorder);
    r.tool('balloon');
    r.s.setBalloonType(true);
    r.wait(0.1);
    const rec = recorder.finish({ caseId: INST.caseId, seed: INST.seed, rngSeed: INST.seed, exam: false });
    const info = { score: 0, grade: 'Incomplete' as const, mode: 'practice' as const, durationS: 1, at: 0 };
    expect(parseReplayFile(packReplay(rec, info)).ok).toBe(true);
    const bad = packReplay({ ...rec, runs: [[1, '0,0,0,0,0,0,0', [{ k: 'balloonType', nc: 'yes' } as never]]] }, info);
    expect(parseReplayFile(bad)).toEqual({ ok: false, error: 'runs' });
  });
});

describe('stent optimisation item', () => {
  it('appears only when imaging is expected or was used after the stent', () => {
    const r = new CaseRunner(3, CLASSIC_LESION);
    expect(item(r, 'optimisation')).toBeUndefined();
    const c = crossed(INST);
    expect(item(c, 'optimisation')).toMatchObject({ status: 'warn' });
  });
});
