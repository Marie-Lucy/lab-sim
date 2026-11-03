import { describe, expect, it } from 'vitest';
import { C_ARM } from '../src/config/anatomy';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { skeletonLayout } from '../src/anatomy/skeleton';
import { length } from '../src/anatomy/vec';
import { carmDirection, nudge, presetAt, projectionName } from '../src/physics/carm';
import { initialXray, startCine, stepXray, type XrayState } from '../src/procedure/xray';
import { Session } from '../src/procedure/session';
import { createRng } from '../src/physics/ecg';
import { NO_INPUT } from '../src/tools/deviceController';

function run(s: XrayState, seconds: number, pedal: boolean, t0 = 0, dt = 1 / 60) {
  let pulses = 0;
  let time = t0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    time += dt;
    const r = stepXray(s, { dt, time, pedal });
    s = r.state;
    if (r.pulse) pulses++;
  }
  return { s, pulses, time };
}

describe('X-ray beam', () => {
  it('pulses at 15 fps while the pedal is held and counts fluoro time', () => {
    const r = run(initialXray(), 2, true);
    expect(r.s.mode).toBe('fluoro');
    expect(r.pulses).toBeGreaterThanOrEqual(29);
    expect(r.pulses).toBeLessThanOrEqual(31);
    expect(r.s.fluoroS).toBeCloseTo(2, 5);
  });

  it('holds the last image when released, without adding fluoro time', () => {
    const on = run(initialXray(), 0.5, true);
    const off = run(on.s, 3, false, on.time);
    expect(off.s.mode).toBe('lih');
    expect(off.pulses).toBe(0);
    expect(off.s.fluoroS).toBeCloseTo(0.5, 5);
    expect(run(initialXray(), 1, false).s.mode).toBe('off');
  });

  it('acquires a frame as soon as the beam turns on', () => {
    const r = stepXray(initialXray(), { dt: 0.016, time: 0.016, pedal: true });
    expect(r.pulse).toBe(true);
  });

  it('records cine for its length, then LIH', () => {
    const s = startCine(initialXray(), 0, 4);
    const a = run(s, 3.9, false);
    expect(a.s.mode).toBe('cine');
    const b = run(a.s, 0.5, false, a.time);
    expect(b.s.mode).toBe('lih');
    expect(b.s.fluoroS).toBeCloseTo(4, 1);
  });
});

describe('C-arm', () => {
  it('AP looks from the front, LAO from the patient left, cranial from the head', () => {
    const ap = carmDirection({ lao: 0, cranial: 0 });
    expect(ap[2]).toBeCloseTo(1);
    expect(carmDirection({ lao: 90, cranial: 0 })[0]).toBeCloseTo(1);
    expect(carmDirection({ lao: -30, cranial: 0 })[0]).toBeLessThan(0);
    expect(carmDirection({ lao: 0, cranial: 30 })[1]).toBeGreaterThan(0);
    expect(length(carmDirection({ lao: 45, cranial: -30 }))).toBeCloseTo(1);
  });

  it('names projections like the cath lab', () => {
    expect(projectionName({ lao: 0, cranial: 0 })).toBe('AP');
    expect(projectionName({ lao: -30, cranial: 30 })).toBe('RAO 30 CRA 30');
    expect(projectionName({ lao: 45, cranial: -30 })).toBe('LAO 45 CAU 30');
    expect(projectionName({ lao: 0, cranial: 35 })).toBe('AP CRA 35');
  });

  it('cycles the six presets and clamps fine-tuning', () => {
    const names = C_ARM.presets.map((_, i) => presetAt(i).name);
    expect(names).toEqual(['RAO 30 CRA 30', 'AP CRA 35', 'LAO 45 CRA 30', 'LAO 45 CAU 30 (spider)', 'RAO 30 CAU 25', 'AP']);
    expect(presetAt(6).index).toBe(0);
    expect(nudge({ lao: 0, cranial: 44 }, 1, 1)).toEqual({ lao: 2, cranial: 45 });
    expect(nudge({ lao: -89, cranial: 0 }, -1, 0).lao).toBe(-90);
  });
});

describe('fluoro skeleton', () => {
  it('places the spine posterior to the heart and the diaphragm below it', () => {
    const tree = buildVesselTree();
    const s = skeletonLayout(tree.valveCentre);
    expect(s.vertebrae.length).toBeGreaterThan(10);
    expect(s.vertebrae[0]!.centre[2]).toBeLessThan(tree.frame.centre[2] - 40);
    expect(s.ribs.length).toBe(20);
    const top = Math.max(...s.diaphragm.map((d) => d.centre[1] + d.radii[1]));
    expect(top).toBeLessThan(tree.valveCentre[1]);
  });
});

describe('session: contrast and cine', () => {
  function engagedSession() {
    const s = new Session(buildVesselTree(), createRng(2));
    const step = (inp: Partial<typeof NO_INPUT>, pedal = false) => s.step(0.05, { ...NO_INPUT, ...inp }, pedal);
    while (s.ctrl.guide.arc < s.ctrl.guideRoute.rootArc - 0.5) step({ advance: 1 });
    step({}, true); // a fluoro tap to check the position
    while (Math.abs(s.ctrl.guide.rotationDeg) > 3) step({ rotate: -1, fine: true });
    while (!s.ctrl.guide.engaged) step({ advance: 1, fine: true });
    return { s, step };
  }

  it('cannot inject before the guide reaches the aorta', () => {
    const s = new Session(buildVesselTree());
    expect(s.inject()).toBe(false);
    expect(s.contrastMl).toBe(0);
  });

  it('a selective angiogram adds 8 ml, starts cine and completes stage 2', () => {
    const { s, step } = engagedSession();
    expect(s.progress.stage).toBe(1);
    expect(s.inject()).toBe(true);
    expect(s.contrastMl).toBe(8);
    expect(s.injecting).toBe('selective');
    const r = step({});
    expect(r.planChanged).toBe(true);
    expect(s.xray.mode).toBe('cine');
    expect(s.progress.stage).toBe(2);
    // No double injection during the run.
    expect(s.inject()).toBe(false);
    for (let i = 0; i < 200; i++) step({});
    expect(s.xray.mode).toBe('lih');
    expect(s.xray.fluoroS).toBeGreaterThan(3);
  });

  it('an unengaged guide gives a 20 ml aortic flush', () => {
    const s = new Session(buildVesselTree());
    while (s.ctrl.guide.arc < s.ctrl.guideRoute.aortaEntryArc + 10) s.step(0.05, { ...NO_INPUT, advance: 1 }, false);
    expect(s.inject()).toBe(true);
    expect(s.injection!.plan.kind).toBe('aortic');
    expect(s.contrastMl).toBe(20);
  });
});
