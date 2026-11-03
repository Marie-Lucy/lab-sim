import { describe, expect, it } from 'vitest';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { createRng } from '../src/physics/ecg';
import { buildDebrief } from '../src/procedure/debrief';
import { Demo, DEMO_STEPS, type DemoHost } from '../src/procedure/demo';
import { Session } from '../src/procedure/session';
import { buildSummary } from '../src/procedure/summary';
import { NO_INPUT } from '../src/tools/deviceController';

function runDemo(seed: number, dt: number) {
  const session = new Session(buildVesselTree(), createRng(seed));
  const views: string[] = [];
  const host: DemoHost = {
    session,
    selectTool: (t) => {
      const a = session.selectTool(t);
      if (!a.ok) throw new Error(`demo tried a locked tool: ${a.reason}`);
    },
    setSize: (d, l) => {
      if (session.ctrl.setCatheterSize(d, l)) throw new Error('size refused');
    },
    inject: () => void session.selectTool('contrast'),
    heparin: () => void session.heparin(),
    nextPreset: () => session.nextPreset(),
    setView: (v) => views.push(v),
  };
  const demo = new Demo(host);
  const narrations = new Set<string>();
  for (let i = 0; i < 400 / dt && !demo.finished; i++) {
    const auto = demo.update(dt) ?? {};
    narrations.add(demo.narration);
    session.step(dt, { ...NO_INPUT, ...auto }, auto.pedal ?? false);
  }
  return { session, demo, narrations, views };
}

describe('demo autopilot', () => {
  for (const [seed, dt] of [[1, 1 / 60], [7, 0.05]] as const) {
    it(`completes all 6 stages with an Excellent debrief (seed ${seed}, dt ${dt.toFixed(3)})`, () => {
      const { session, demo, narrations, views } = runDemo(seed, dt);
      expect(demo.finished).toBe(true);
      expect(session.progress.completedAt.every((t) => t !== null)).toBe(true);
      const d = buildDebrief(buildSummary(session));
      expect(d.items.filter((i) => i.status !== 'ok').map((i) => `${i.id}: ${i.value}`)).toEqual([]);
      expect(d.grade).toBe('Excellent');
      expect(session.ctrl.wire.forcingS).toBe(0);
      expect(session.time).toBeLessThan(200);
      expect(narrations.size).toBe(DEMO_STEPS.length);
      expect(views).toContain('fluoro');
    });
  }

  it('uses a 2.5 × 15 balloon at 10 atm for ~12 s and a 3.0 × 18 stent at 12 atm', () => {
    const { session } = runDemo(3, 1 / 30);
    const [b, s] = session.ctrl.log.inflations;
    expect(b!.kind).toBe('balloon');
    expect(b!.maxPressure).toBeGreaterThanOrEqual(10);
    expect(b!.duration).toBeGreaterThan(12);
    expect(b!.duration).toBeLessThan(18);
    expect(s!.kind).toBe('stent');
    expect(s!.maxPressure).toBeGreaterThanOrEqual(12);
    expect(session.ctrl.treatment.stents[0]!.diameter).toBeCloseTo(3.0 * 1.024, 1);
  });
});
