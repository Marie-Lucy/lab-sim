import { describe, expect, it } from 'vitest';
import { buildDebrief } from '../src/procedure/debrief';
import { mentorHint } from '../src/procedure/mentorHints';
import { buildSummary } from '../src/procedure/summary';
import { CaseRunner } from './caseRunner';

describe('full case through the session', () => {
  it('a careful case completes all 6 stages with an Excellent debrief', () => {
    const r = new CaseRunner();
    const s = r.s;
    expect(mentorHint(s).text).toMatch(/advance/i);
    r.engageAndAngiogram();
    expect(s.progress.stage).toBe(2);
    expect(mentorHint(s).text).toMatch(/heparin/i);
    r.crossGently();
    expect(s.progress.stage).toBe(3);
    r.tool('balloon');
    s.ctrl.setCatheterSize(2.5, 15);
    r.position(0.5);
    r.inflate(10, 12);
    expect(s.progress.stage).toBe(4);
    r.withdraw();
    r.tool('measure');
    r.tool('stent');
    s.ctrl.setCatheterSize(3.0, 18);
    r.position(2);
    r.inflate(12, 3);
    r.withdraw();
    expect(s.progress.stage).toBe(5);
    r.finalViews();
    expect(s.progress.stage).toBe(6);

    const sum = buildSummary(s);
    const d = buildDebrief(sum);
    expect(sum.residualStenosis).toBeLessThan(0.1);
    expect(sum.finalTimi).toBe(3);
    expect(sum.coverage!.proximal).toBeGreaterThan(1.5);
    expect(sum.coverage!.distal).toBeGreaterThan(1.5);
    expect(sum.dissection).toBe('none');
    expect(sum.finalViews).toBe(2);
    expect(d.items.filter((i) => i.status !== 'ok')).toEqual([]);
    expect(d.grade).toBe('Excellent');
    expect(mentorHint(s).level).toBe('ok');
  });

  it('an oversized short stent at high pressure: dissection, reduced flow, "Needs work"', () => {
    const r = new CaseRunner();
    const s = r.s;
    r.engageAndAngiogram();
    r.crossGently();
    r.tool('balloon');
    s.ctrl.setCatheterSize(2.5, 15);
    r.position(0.5);
    r.inflate(10, 12);
    r.withdraw();
    r.tool('measure');
    r.tool('stent');
    s.ctrl.setCatheterSize(4.0, 12);
    r.position(-1);
    r.inflate(16, 3);
    r.withdraw();
    r.finalViews();
    expect(s.progress.stage).toBe(6);
    expect(s.ctrl.treatment.dissections.some((x) => x.cause === 'edge' && !x.sealed)).toBe(true);
    expect(s.ctrl.flow.distalTarget).toBeLessThan(0.5);
    expect(mentorHint(s).text).toMatch(/dissection/i);
    const d = buildDebrief(buildSummary(s));
    expect(d.grade).toBe('Needs work');
    const bad = d.items.filter((i) => i.status === 'bad').map((i) => i.id);
    expect(bad).toEqual(expect.arrayContaining(['stentSize', 'coverage', 'dissection']));
  });

  it('locked tools explain why through the session', () => {
    const r = new CaseRunner();
    const a = r.s.selectTool('wire');
    expect(a.ok).toBe(false);
    expect(r.s.tool).toBe('guide');
    r.step();
    expect(r.log.some((m) => /Engage/.test(m))).toBe(true);
  });

  it('mentor tells the learner to deflate when the patient becomes unstable', () => {
    const r = new CaseRunner();
    const s = r.s;
    r.engageAndAngiogram();
    r.crossGently();
    r.tool('balloon');
    s.ctrl.setCatheterSize(2.5, 15);
    r.position(0.5);
    r.until({ inflate: true }, () => s.ctrl.catheter!.pressure >= 8);
    r.wait(62);
    expect(s.physiology.unstable).toBe(true);
    expect(mentorHint(s)).toEqual({ text: expect.stringMatching(/Deflate now/), level: 'danger' });
    expect(buildSummary(s).longestInflationS).toBeGreaterThan(60);
  });
});
