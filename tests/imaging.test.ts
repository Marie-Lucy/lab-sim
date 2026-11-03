import { describe, expect, it } from 'vitest';
import { IMAGING } from '../src/config/anatomy';
import { lesionBounds } from '../src/anatomy/stenosis';
import { LumenProfile } from '../src/anatomy/lumen';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { caseDef, CLASSIC_LESION, instantiateCase } from '../src/cases/cases';
import { area, frameAt, optimisation, pullback, type VesselState } from '../src/physics/imaging';
import { buildDebrief } from '../src/procedure/debrief';
import { buildSummary } from '../src/procedure/summary';
import { packReplay, parseReplayFile } from '../src/replay/files';
import { Recorder } from '../src/replay/recording';
import { ReplayPlayer } from '../src/replay/replay';
import { toolAvailability } from '../src/tools/tools';
import { CaseRunner } from './caseRunner';

function crossedClassic(recorder: Recorder | null = null) {
  const r = new CaseRunner(3, CLASSIC_LESION, undefined, recorder);
  r.engageAndAngiogram();
  r.crossGently();
  return r;
}

function predilate(r: CaseRunner) {
  r.tool('balloon');
  r.s.ctrl.setCatheterSize(2.5, 15);
  r.position(0.5);
  r.inflate(10, 12);
  r.withdraw();
}

function stent(r: CaseRunner, d: number, len: number, atm: number) {
  r.tool('stent');
  r.s.ctrl.setCatheterSize(d, len);
  r.position((len - CLASSIC_LESION.length) / 2);
  r.inflate(atm, 3);
  r.withdraw();
}

describe('cross-sections', () => {
  const tree = buildVesselTree();
  const lumen = tree.vessels.lad.lumen;
  const v: VesselState = { lumen, native: lumen.diameter, stents: [], dissections: [] };

  it('healthy wall: EEM = 1.15 × reference, plaque burden 1 − 1/1.15² ≈ 24 %', () => {
    const f = frameAt(v, 5, 'ivus');
    expect(f.eemD).toBeCloseTo(lumen.referenceAt(5) * 1.15, 4);
    expect(f.plaqueBurden).toBeCloseTo(1 - 1 / 1.15 ** 2, 2);
    expect(f.stentD).toBeNull();
  });

  it('at the 90 % lesion the plaque fills the vessel; OCT cannot see the EEM behind it', () => {
    const f = frameAt(v, CLASSIC_LESION.centreArc, 'ivus');
    expect(f.plaqueBurden).toBeGreaterThan(0.98);
    expect(f.eemVisible).toBe(true);
    expect(frameAt(v, CLASSIC_LESION.centreArc, 'oct').eemVisible).toBe(false);
    expect(frameAt(v, 5, 'oct').eemVisible).toBe(true);
  });

  it('struts float where the native wall is wider than the stent: gap = (wall − stent) / 2', () => {
    const l = new LumenProfile(40, () => 3.5);
    const s: VesselState = { lumen: l, native: l.diameter, stents: [{ vessel: 'lad', from: 10, to: 30, diameter: 2.5 }], dissections: [] };
    const f = frameAt(s, 20, 'oct');
    expect(f.stentD).toBeCloseTo(2.5 * 0.97, 6);
    expect(f.malapposition).toBeCloseTo((3.5 - 2.425) / 2, 6);
    expect(f.malapposition).toBeGreaterThan(IMAGING.malappositionMm);
  });

  it('an untreated pullback finds the MLA in the lesion and suggests a stent that fits the debrief', () => {
    const run = pullback(v, 'lad', 70, 'ivus');
    const m = run.summary;
    const { start, end } = lesionBounds(CLASSIC_LESION);
    expect(m.mla.arc).toBeGreaterThanOrEqual(start);
    expect(m.mla.arc).toBeLessThanOrEqual(end);
    expect(m.mla.area).toBeCloseTo(area(lumen.minimum(start, end).diameter), 1);
    expect(m.segment!.from).toBeGreaterThan(start - 1);
    expect(m.segment!.to).toBeLessThan(end + 1);
    expect(m.landing!.from).toBeLessThanOrEqual(start + 0.5);
    expect(m.landing!.to).toBeGreaterThanOrEqual(end - 0.5);
    expect(m.proximalRef!.arc).toBeLessThan(m.segment!.from);
    expect(m.distalRef!.arc).toBeGreaterThan(m.segment!.to);
    expect(m.msa).toBeNull();
    expect(m.suggestion).toEqual({ diameter: 3.0, length: 18, stents: 1 });
    expect(run.frames[0]!.arc).toBe(0);
  });
});

describe('IVUS/OCT in a case', () => {
  it('needs the wire distal and no balloon in the artery', () => {
    const r = new CaseRunner(3);
    expect(toolAvailability('imaging', r.s.facts(), r.s.progress).ok).toBe(false);
    expect(r.s.pullback('ivus').ok).toBe(false);
    const c = crossedClassic();
    expect(c.s.pullback('ivus').ok).toBe(true);
    c.tool('balloon');
    c.s.ctrl.setCatheterSize(2.5, 15);
    c.position(0.5);
    expect(c.s.pullback('ivus').ok).toBe(false);
  });

  it('a well-sized stent at 12 atm is optimised: expansion ≥ 90 %, apposed, clean edges', () => {
    const r = crossedClassic();
    predilate(r);
    stent(r, 3.0, 18, 12);
    expect(r.s.pullback('ivus').ok).toBe(true);
    const m = r.s.imaging.at(-1)!.summary;
    expect(m.msa).not.toBeNull();
    expect(m.expansion!).toBeGreaterThanOrEqual(0.9);
    expect(optimisation(m)).toEqual({ expanded: true, apposed: true, edges: true });
    r.step();
    expect(r.log.some((l) => l.startsWith('IVUS: MSA'))).toBe(true);
  });

  it('an undersized stent at low pressure shows under-expansion', () => {
    const r = crossedClassic();
    predilate(r);
    stent(r, 2.5, 18, 8);
    r.s.pullback('ivus');
    const m = r.s.imaging.at(-1)!.summary;
    expect(m.expansion!).toBeLessThan(0.9);
    expect(optimisation(m)!.expanded).toBe(false);
  });

  it('OCT flushes contrast; IVUS does not', () => {
    const r = crossedClassic();
    const before = r.s.contrastMl;
    r.s.pullback('ivus');
    expect(r.s.contrastMl).toBe(before);
    r.s.pullback('oct');
    expect(r.s.contrastMl).toBe(before + IMAGING.octFlushMl);
    expect(r.s.imaging.map((p) => p.modality)).toEqual(['ivus', 'oct']);
    // OCT cannot see the EEM behind the 90 % plaque, so it reports no plaque burden there.
    expect(r.s.imaging[0]!.summary.mla.plaqueBurden).toBeGreaterThan(0.95);
    expect(r.s.imaging[1]!.summary.mla.plaqueBurden).toBeNull();
  });

  it('following the suggested stent gives an Excellent case', () => {
    const r = crossedClassic();
    r.s.pullback('ivus');
    const g = r.s.imaging[0]!.summary.suggestion!;
    predilate(r);
    r.tool('measure');
    stent(r, g.diameter, g.length, 12);
    r.finalViews();
    const d = buildDebrief(buildSummary(r.s));
    expect(d.items.filter((i) => i.status !== 'ok').map((i) => i.id)).toEqual([]);
  });

  it('pullbacks are recorded, survive the replay file and replay to the same result', () => {
    const recorder = new Recorder(0.05);
    const r = crossedClassic(recorder);
    r.s.pullback('oct');
    r.wait(0.5);
    const inst = instantiateCase(caseDef('classic'), 0);
    const rec = recorder.finish({ caseId: inst.caseId, seed: 0, rngSeed: 3, exam: false });
    const parsed = parseReplayFile(packReplay(rec, { score: 0, grade: 'Incomplete', mode: 'practice', durationS: r.s.time, at: 0 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = new ReplayPlayer(buildVesselTree(inst.lesion, inst.setup), parsed.file.recording);
    while (p.step());
    expect(p.session.imaging).toHaveLength(1);
    expect(p.session.imaging[0]!.summary).toEqual(r.s.imaging[0]!.summary);
    expect(p.session.contrastMl).toBe(r.s.contrastMl);
    const bad = packReplay({ ...rec, runs: [[1, '0,0,0,0,0,0,0', [{ k: 'pullback', m: 'xray' } as never]]] }, { score: 0, grade: 'Incomplete', mode: 'practice', durationS: 1, at: 0 });
    expect(parseReplayFile(bad)).toEqual({ ok: false, error: 'runs' });
  });
});
