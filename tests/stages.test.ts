import { describe, expect, it } from 'vitest';
import {
  addDistinctView,
  initialProgress,
  planFor,
  isComplete,
  STAGES,
  stageProgressFraction,
  stepProgress,
  type ProcedureFacts,
  type ProcedureProgress,
} from '../src/procedure/stages';
import { toolAvailability } from '../src/tools/tools';

const base: ProcedureFacts = {
  guidePastElbow: false,
  guideInAorta: false,
  guideAtRoot: false,
  guideFacingTargetCusp: false,
  guideEngaged: false,
  xrayActive: false,
  injecting: 'none',
  projection: { lao: 0, cranial: 0 },
  heparinGiven: false,
  wireOut: false,
  wireVessel: null,
  wireInTarget: false,
  wireCrossed: false,
  wireForcing: false,
  wireDistal: false,
  catheter: null,
  qcaMeasured: false,
  stentDeployed: false,
  ffrMeasured: false,
  deferred: false,
};

function step(p: ProcedureProgress, patch: Partial<ProcedureFacts>, t = 0) {
  return stepProgress(p, { ...base, ...patch }, t);
}

describe('stage progression', () => {
  it('has the 6 stages in order; physiology cases add FFR after crossing', () => {
    expect(planFor({ ffr: false }).map((s) => s.id)).toEqual(['guide', 'engage', 'cross', 'predilate', 'stent', 'final']);
    expect(planFor({ ffr: true }).map((s) => s.id)).toEqual(['guide', 'engage', 'cross', 'physiology', 'predilate', 'stent', 'final']);
    expect(initialProgress().plan).toEqual(planFor({ ffr: false }));
    expect(STAGES).toHaveLength(7);
  });

  it('deferring after FFR ends the case at the decision', () => {
    const plan = planFor({ ffr: true });
    let p: ProcedureProgress = { ...initialProgress(plan), stage: 3, completedAt: [1, 2, 3, null, null, null, null] };
    p = step(p, { ffrMeasured: true }).progress;
    expect(p.done.has('ffr')).toBe(true);
    expect(p.stage).toBe(3);
    const r = step(p, { ffrMeasured: true, deferred: true }, 50);
    expect(r.progress.plan.map((s) => s.id)).toEqual(['guide', 'engage', 'cross', 'physiology']);
    expect(r.progress.completedAt).toEqual([1, 2, 3, 50]);
    expect(isComplete(r.progress)).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(['task', 'stage', 'complete']);
  });

  it('loading a balloon after FFR is the decision to treat', () => {
    const plan = planFor({ ffr: true });
    const p: ProcedureProgress = { ...initialProgress(plan), stage: 3, completedAt: [1, 2, 3, null, null, null, null] };
    const cat = { kind: 'balloon' as const, inCoronary: false, overLesion: false, coversLesion: false, pressure: 0 };
    // Without a valid FFR the balloon does not count as a decision.
    expect(step(p, { catheter: cat }).progress.stage).toBe(3);
    const r = step(p, { ffrMeasured: true, catheter: cat });
    expect(r.progress.stage).toBe(4);
    expect(r.progress.plan).toHaveLength(7);
  });

  it('latches sub-tasks even after the fact becomes false', () => {
    let p = initialProgress();
    p = step(p, { guidePastElbow: true }).progress;
    p = step(p, {}).progress;
    expect(p.done.has('pastElbow')).toBe(true);
    expect(p.stage).toBe(0);
    expect(stageProgressFraction(p)).toBeCloseTo(0.25);
  });

  it('only latches tasks of the current stage', () => {
    let p = initialProgress();
    p = step(p, { heparinGiven: true }).progress;
    expect(p.done.has('heparin')).toBe(false);
  });

  it('runs a full case and records completion times', () => {
    let p = initialProgress();
    const arm = { guidePastElbow: true, guideInAorta: true };
    p = step(p, { ...arm, xrayActive: true }, 10).progress;
    let r = step(p, { ...arm, guideAtRoot: true }, 20);
    p = r.progress;
    expect(r.events).toContainEqual({ type: 'stage', stage: 0, time: 20 });
    expect(p.completedAt[0]).toBe(20);

    const root = { ...arm, guideAtRoot: true };
    p = step(p, { ...root, guideFacingTargetCusp: true }).progress;
    p = step(p, { ...root, guideEngaged: true }).progress;
    expect(p.stage).toBe(1);
    // Fluoro on but no injection: no angiogram.
    p = step(p, { ...root, guideEngaged: true, xrayActive: true }).progress;
    expect(p.stage).toBe(1);
    const eng = { ...root, guideEngaged: true };
    p = step(p, { ...eng, xrayActive: true, injecting: 'selective' }, 40).progress;
    expect(p.stage).toBe(2);

    const hep = { ...eng, heparinGiven: true };
    p = step(p, { ...hep, wireOut: true, wireVessel: 'lcx' }).progress;
    expect(p.done.has('intoTarget')).toBe(false);
    p = step(p, { ...hep, wireOut: true, wireVessel: 'lad', wireInTarget: true, wireCrossed: true, wireForcing: true }).progress;
    expect(p.done.has('crossGently')).toBe(false);
    const wired = { ...hep, wireOut: true, wireVessel: 'lad' as const, wireInTarget: true, wireCrossed: true, wireDistal: true };
    p = step(p, wired).progress;
    expect(p.stage).toBe(3);

    const bal = (pressure: number, overLesion = true) => ({
      ...wired,
      catheter: { kind: 'balloon' as const, inCoronary: true, overLesion, coversLesion: true, pressure },
    });
    p = step(p, bal(4, false)).progress;
    expect(p.done.has('markers')).toBe(false);
    p = step(p, bal(0)).progress;
    // Deflated before inflating does not count as "deflate".
    expect(p.done.has('deflate')).toBe(false);
    p = step(p, bal(8)).progress;
    p = step(p, bal(0)).progress;
    expect(p.stage).toBe(4);

    const st = (pressure: number, deployed: boolean, covers = true) => ({
      ...wired,
      qcaMeasured: true,
      stentDeployed: deployed,
      catheter: { kind: 'stent' as const, inCoronary: true, overLesion: true, coversLesion: covers, pressure },
    });
    p = step(p, st(0, false)).progress;
    p = step(p, st(12, true)).progress;
    expect(p.stage).toBe(4);
    p = step(p, st(0, true)).progress;
    expect(p.stage).toBe(5);

    const after = { ...wired, stentDeployed: true, xrayActive: true, injecting: 'selective' as const };
    p = step(p, { ...after, projection: { lao: -30, cranial: 30 } }).progress;
    p = step(p, { ...after, projection: { lao: -25, cranial: 28 } }).progress;
    expect(p.finalViews.length).toBe(1);
    expect(p.stage).toBe(5);
    r = step(p, { ...after, projection: { lao: 45, cranial: 30 } }, 300);
    expect(isComplete(r.progress)).toBe(true);
    expect(r.events).toContainEqual({ type: 'complete', time: 300 });
  });

  it('a geographic miss does not block the stent stage once deployed', () => {
    let p: ProcedureProgress = { ...initialProgress(), stage: 4 };
    const f = {
      qcaMeasured: true,
      wireDistal: true,
      stentDeployed: true,
      catheter: { kind: 'stent' as const, inCoronary: true, overLesion: true, coversLesion: false, pressure: 0 },
    };
    p = step(p, f).progress;
    expect(p.stage).toBe(5);
  });

  it('distinct views need ≥ 20° separation', () => {
    let v = addDistinctView([], { lao: 0, cranial: 0 });
    v = addDistinctView(v, { lao: 10, cranial: 10 });
    expect(v.length).toBe(1);
    v = addDistinctView(v, { lao: 0, cranial: 35 });
    expect(v.length).toBe(2);
  });
});

describe('tool unlocking', () => {
  const p0 = initialProgress();

  it('guide and fluoro are always available; contrast needs the aorta', () => {
    expect(toolAvailability('guide', base, p0).ok).toBe(true);
    expect(toolAvailability('fluoro', base, p0).ok).toBe(true);
    expect(toolAvailability('contrast', base, p0).ok).toBe(false);
    expect(toolAvailability('contrast', { ...base, guideInAorta: true }, p0).ok).toBe(true);
  });

  it('wire needs engagement, angiogram and heparin, explaining each', () => {
    const r1 = toolAvailability('wire', base, p0);
    expect(r1.ok === false && r1.reason).toMatch(/Engage/);
    const eng = { ...base, guideEngaged: true };
    const r2 = toolAvailability('wire', eng, p0);
    expect(r2.ok === false && r2.reason).toMatch(/angiogram/);
    const p = { ...p0, done: new Set(['angiogram']) };
    const r3 = toolAvailability('wire', eng, p);
    expect(r3.ok === false && r3.reason).toMatch(/heparin/i);
    expect(toolAvailability('wire', { ...eng, heparinGiven: true }, p).ok).toBe(true);
  });

  it('balloon needs a distal wire; stent needs pre-dilation and the balloon out', () => {
    expect(toolAvailability('balloon', base, p0).ok).toBe(false);
    const w = { ...base, wireDistal: true };
    expect(toolAvailability('balloon', w, p0).ok).toBe(true);
    expect(toolAvailability('stent', w, p0).ok).toBe(false);

    const pre: ProcedureProgress = { ...p0, stage: 4, completedAt: [1, 2, 3, 4, null, null] };
    expect(toolAvailability('stent', w, pre).ok).toBe(true);
    const balloonIn = {
      ...w,
      catheter: { kind: 'balloon' as const, inCoronary: true, overLesion: true, coversLesion: true, pressure: 0 },
    };
    const r = toolAvailability('stent', balloonIn, pre);
    expect(r.ok === false && r.reason).toMatch(/balloon/i);
    const stentIn = { ...w, catheter: { ...balloonIn.catheter, kind: 'stent' as const } };
    expect(toolAvailability('balloon', stentIn, pre).ok).toBe(false);
  });

  it('measure needs the diagnostic angiogram', () => {
    expect(toolAvailability('measure', base, p0).ok).toBe(false);
    expect(toolAvailability('measure', base, { ...p0, done: new Set(['angiogram']) }).ok).toBe(true);
  });
});
