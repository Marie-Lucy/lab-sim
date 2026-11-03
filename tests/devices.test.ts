import { describe, expect, it } from 'vitest';
import { GUIDE, LESION, WIRE } from '../src/config/anatomy';
import { lesionBounds } from '../src/anatomy/stenosis';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { distance } from '../src/anatomy/vec';
import { buildGuideRoute } from '../src/physics/route';
import { initialGuide, stepGuide } from '../src/physics/guide';
import { branchHint, chooseBranch, initialWire, stepWire } from '../src/physics/wire';
import { newCatheter, setSize, stepCatheter } from '../src/physics/catheter';
import { driver, engaged, makeController, wired } from './helpers';

const tree = buildVesselTree();
const route = buildGuideRoute(tree);

describe('guide route', () => {
  it('runs from the wrist up the arm into the aorta and down to the root', () => {
    expect(distance(route.path.pointAt(0), tree.vessels.access.path.pointAt(0))).toBeLessThan(1e-9);
    expect(route.elbowArc).toBeGreaterThan(150);
    expect(route.aortaEntryArc).toBeGreaterThan(route.elbowArc);
    const root = route.path.pointAt(route.rootArc);
    expect(distance(root, tree.vessels.aorta.path.pointAt(GUIDE.rootStopAortaArc))).toBeLessThan(1e-6);
    // Contiguous rail: no jumps.
    for (let i = 1; i < route.path.points.length; i++) {
      expect(distance(route.path.points[i]!, route.path.points[i - 1]!)).toBeLessThan(3);
    }
  });
});

describe('guide catheter', () => {
  const atRoot = { ...initialGuide(), arc: route.rootArc };
  const push = (g = atRoot, rotation = 0, ds = 0.5, dt = 0.05) =>
    stepGuide({ ...g, rotationDeg: rotation }, { ds, rotateDeg: 0, dt, wireOut: false }, route);

  it('stops at the aortic root', () => {
    const r = stepGuide({ ...initialGuide(), arc: route.rootArc - 2 }, { ds: 10, rotateDeg: 0, dt: 0.1, wireOut: false }, route);
    expect(r.state.arc).toBe(route.rootArc);
    expect(r.events).toContain('atRoot');
    expect(r.state.engaged).toBe(false);
  });

  it('engages only when facing the left cusp (±25°) on a gentle push', () => {
    expect(push(atRoot, 20).state.engaged).toBe(true);
    expect(push(atRoot, -24).state.engaged).toBe(true);
    expect(push(atRoot, 30).state.engaged).toBe(false);
    expect(push(atRoot, 30).events).toContain('notFacingTarget');
    const fast = push({ ...atRoot, speed: 60 }, 0, 3);
    expect(fast.state.engaged).toBe(false);
    expect(fast.events).toContain('tooFast');
  });

  it('gives a specific message when facing the right cusp', () => {
    expect(push(atRoot, GUIDE.rightCuspAngleDeg + 10).events).toContain('facingOther');
  });

  it('pops out with more than 40° of torque', () => {
    const eng = { ...atRoot, engaged: true, rotationDeg: 0 };
    const small = stepGuide(eng, { ds: 0, rotateDeg: 35, dt: 0.05, wireOut: false }, route);
    expect(small.state.engaged).toBe(true);
    const big = stepGuide(small.state, { ds: 0, rotateDeg: 10, dt: 0.05, wireOut: false }, route);
    expect(big.state.engaged).toBe(false);
    expect(big.events).toContain('popOut');
  });

  it('cannot move while the wire is out', () => {
    const eng = { ...atRoot, engaged: true, rotationDeg: 0 };
    const r = stepGuide(eng, { ds: -5, rotateDeg: 0, dt: 0.05, wireOut: true }, route);
    expect(r.state.arc).toBe(eng.arc);
    expect(r.state.engaged).toBe(true);
    expect(r.events).toEqual(['blockedByWire']);
  });

  it('controller: full advance, rotate and engage', () => {
    const d = engaged();
    expect(d.c.guide.engaged).toBe(true);
    expect(d.c.facts({ xrayActive: false, injecting: 'none', projection: { lao: 0, cranial: 0 } }).guideEngaged).toBe(true);
    expect(d.messages.some((m) => /engaged/.test(m.text))).toBe(true);
  });
});

describe('guidewire', () => {
  const rng = () => 0.5;
  const adv = (w = initialWire(), ds: number, rotateDeg = 0, dt = 0.05) =>
    stepWire(w, { ds, rotateDeg, dt, catheterOut: false, rng }, tree);

  it('exits the guide into the LM', () => {
    const r = adv(initialWire(), 2);
    expect(r.state.out).toBe(true);
    expect(r.state.chain).toEqual(['lm']);
    expect(r.state.tipArc).toBeCloseTo(2);
  });

  it('rotation picks LAD vs LCx at the LM bifurcation', () => {
    expect(chooseBranch(tree, 'lm', 10, 150)).toBe('lcx');
    expect(chooseBranch(tree, 'lm', 10, 10)).toBe('lad');
    expect(chooseBranch(tree, 'lm', 10, -80)).toBe('lad');
    let w = { ...initialWire(), out: true, chain: ['lm'] as const, tipArc: 8, rotationDeg: 150 };
    expect(adv({ ...w, chain: ['lm'] }, 4).state.chain).toEqual(['lm', 'lcx']);
    w = { ...w, rotationDeg: 0 };
    expect(adv({ ...w, chain: ['lm'] }, 4).state.chain).toEqual(['lm', 'lad']);
  });

  it('diagonals are captured within ±50° of their takeoff', () => {
    expect(chooseBranch(tree, 'lad', 22, 90)).toBe('d1');
    expect(chooseBranch(tree, 'lad', 22, 45)).toBe('d1');
    expect(chooseBranch(tree, 'lad', 22, 35)).toBe(null);
    expect(chooseBranch(tree, 'lad', 58, 140)).toBe('d2');
    expect(chooseBranch(tree, 'lad', 58, 0)).toBe(null);
  });

  it('shows the upcoming branch and where the tip would go', () => {
    const w = { ...initialWire(), out: true, chain: ['lm', 'lad'] as const, tipArc: 15, rotationDeg: 90 };
    const h = branchHint(tree, { ...w, chain: ['lm', 'lad'] });
    expect(h?.branch).toBe('d1');
    expect(h?.distance).toBeCloseTo(7);
    expect(h?.takes).toBe('d1');
  });

  it('retracts back through a branch point into the parent and into the guide', () => {
    let w = adv({ ...initialWire(), out: true, chain: ['lm', 'lad'], tipArc: 3, rotationDeg: 0 }, -5).state;
    expect(w.chain).toEqual(['lm']);
    expect(w.tipArc).toBeCloseTo(8);
    w = adv(w, -20).state;
    expect(w.out).toBe(false);
  });

  it('forcing through the lesion buckles, limits progress and builds risk', () => {
    const { start } = lesionBounds();
    let w = { ...initialWire(), out: true, chain: ['lm', 'lad'] as string[], tipArc: start - 0.5, rotationDeg: 0, speed: 20 } as ReturnType<typeof initialWire>;
    w = adv(w, 1).state; // 20 mm/s
    expect(w.forcing).toBe(true);
    expect(w.tipArc - (start - 0.5)).toBeLessThanOrEqual(WIRE.safeLesionSpeed * 0.05 + 1e-9);
    expect(w.risk).toBeGreaterThan(0);
    expect(w.resistance).toBeGreaterThan(0.3);
    expect(w.buckle).toBeGreaterThan(0);
  });

  it('crossing gently builds no risk and torque raises the safe speed', () => {
    const { start } = lesionBounds();
    const base = { ...initialWire(), out: true, chain: ['lm', 'lad'] as string[], tipArc: start + 2, rotationDeg: 0 } as ReturnType<typeof initialWire>;
    const gentle = adv({ ...base, speed: 5 }, 0.25);
    expect(gentle.state.forcing).toBe(false);
    expect(gentle.state.risk).toBe(0);
    const torque = adv({ ...base, speed: 10 }, 0.5, 3);
    expect(torque.state.forcing).toBe(false);
    const noTorque = adv({ ...base, speed: 10 }, 0.5, 0);
    expect(noTorque.state.forcing).toBe(true);
  });

  it('a random roll against the accumulated risk may dissect on crossing', () => {
    const { end } = lesionBounds();
    const w = { ...initialWire(), out: true, chain: ['lm', 'lad'] as string[], tipArc: end - 0.1, rotationDeg: 0, risk: 0.6, speed: 3 } as ReturnType<typeof initialWire>;
    const lucky = stepWire(w, { ds: 0.2, rotateDeg: 0, dt: 0.05, catheterOut: false, rng: () => 0.7 }, tree);
    expect(lucky.events).toContainEqual({ type: 'crossed', dissection: false });
    const unlucky = stepWire(w, { ds: 0.2, rotateDeg: 0, dt: 0.05, catheterOut: false, rng: () => 0.5 }, tree);
    expect(unlucky.events).toContainEqual({ type: 'crossed', dissection: true });
    expect(unlucky.state.crossed).toBe(true);
  });

  it('warns at the vessel end and stops short of it', () => {
    const w = { ...initialWire(), out: true, chain: ['lm', 'lad'] as string[], tipArc: 100, rotationDeg: 0, crossed: true } as ReturnType<typeof initialWire>;
    const near = adv(w, 6);
    expect(near.events.map((e) => e.type)).toContain('nearEnd');
    const far = adv(w, 50);
    expect(far.events.map((e) => e.type)).toContain('vesselEnd');
    expect(far.state.tipArc).toBeCloseTo(tree.vessels.lad.path.length - WIRE.endStop);
  });

  it('cannot be retracted while a balloon is on it', () => {
    const w = { ...initialWire(), out: true, chain: ['lm', 'lad'] as string[], tipArc: 70, rotationDeg: 0 } as ReturnType<typeof initialWire>;
    const r = stepWire(w, { ds: -5, rotateDeg: 0, dt: 0.05, catheterOut: true, rng }, tree);
    expect(r.state.tipArc).toBe(70);
    expect(r.events).toEqual([{ type: 'retractBlocked' }]);
  });

  it('controller: a gentle crossing parks the wire distally without forcing', () => {
    const d = wired();
    const f = d.c.facts({ xrayActive: false, injecting: 'none', projection: { lao: 0, cranial: 0 } });
    expect(f.wireVessel).toBe('lad');
    expect(f.wireCrossed).toBe(true);
    expect(f.wireDistal).toBe(true);
    expect(d.c.wire.forcingS).toBe(0);
    expect(d.c.log.heparinBeforeWire).toBe(true);
  });

  it('controller: full-speed crossing is recorded as forcing', () => {
    const d = engaged();
    d.until('wire', { rotate: -1 }, () => Math.abs(d.c.wire.rotationDeg) < 4);
    d.until('wire', { advance: 1 }, () => d.c.wire.chain.includes('lad') && d.c.wire.tipArc > 70);
    expect(d.c.wire.forcingS).toBeGreaterThan(0.5);
    expect(d.messages.some((m) => /buckling/.test(m.text))).toBe(true);
  });
});

describe('balloon catheter', () => {
  const input = { ds: 0, dt: 0.1, inflate: false, deflate: false, fine: false, wireTip: 90, time: 0 };

  it('size can only be chosen while inside the guide', () => {
    const c = newCatheter('balloon');
    expect(setSize(c, 2.5, 15).ok).toBe(true);
    expect(setSize(c, 2.7, 15).ok).toBe(false);
    const out = { ...c, advanced: 20 };
    expect(setSize(out, 3.0, 15).ok).toBe(false);
  });

  it('cannot move while inflated and must stay behind the wire tip', () => {
    const c = { ...newCatheter('balloon'), advanced: 40, pressure: 6 };
    const r = stepCatheter(c, { ...input, ds: 5 });
    expect(r.state.advanced).toBe(40);
    expect(r.events).toContainEqual({ type: 'moveBlockedInflated' });
    const r2 = stepCatheter({ ...c, pressure: 0 }, { ...input, ds: 100 });
    expect(r2.state.advanced).toBe(90 - 10);
    expect(r2.events).toContainEqual({ type: 'wireLead' });
  });

  it('inflates at 3 atm/s (fine 0.75), deflates and records the inflation', () => {
    let c = { ...newCatheter('balloon'), advanced: 40 };
    let t = 0;
    for (let i = 0; i < 20; i++) c = stepCatheter(c, { ...input, inflate: true, time: (t += 0.1) }).state;
    expect(c.pressure).toBeCloseTo(6, 6);
    c = stepCatheter(c, { ...input, inflate: true, fine: true, time: (t += 0.1) }).state;
    expect(c.pressure).toBeCloseTo(6.075, 6);
    let rec = null;
    for (let i = 0; i < 20 && !rec; i++) {
      const r = stepCatheter(c, { ...input, deflate: true, time: (t += 0.1) });
      c = r.state;
      const e = r.events.find((x) => x.type === 'inflationEnd');
      if (e && e.type === 'inflationEnd') rec = e.record;
    }
    expect(rec).not.toBeNull();
    expect(rec!.maxPressure).toBeCloseTo(6.075, 6);
    expect(rec!.duration).toBeGreaterThan(2.5);
    expect(rec!.ruptured).toBe(false);
  });

  it('cannot inflate inside the guide', () => {
    const r = stepCatheter(newCatheter('balloon'), { ...input, inflate: true });
    expect(r.state.pressure).toBe(0);
    expect(r.events).toContainEqual({ type: 'inflateInGuide' });
  });

  it('warns above RBP and ruptures at RBP + 4', () => {
    let c = { ...newCatheter('balloon'), advanced: 40, pressure: 14.9 };
    let r = stepCatheter(c, { ...input, inflate: true });
    expect(r.events).toContainEqual({ type: 'aboveRbp' });
    c = { ...r.state, pressure: 17.9 };
    r = stepCatheter(c, { ...input, inflate: true });
    expect(r.state.ruptured).toBe(true);
    expect(r.state.pressure).toBe(0);
    expect(r.events.map((e) => e.type)).toContain('ruptured');
    const end = r.events.find((e) => e.type === 'inflationEnd');
    expect(end && end.type === 'inflationEnd' && end.record.ruptured).toBe(true);
    // A ruptured balloon withdrawn into the guide is replaced.
    const back = stepCatheter(r.state, { ...input, ds: -60 });
    expect(back.state.ruptured).toBe(false);
    expect(back.events).toContainEqual({ type: 'reloaded' });
  });

  it('a stent deploys at ≥ 6 atm and a fresh one is loaded after withdrawal', () => {
    let c = { ...newCatheter('stent'), advanced: 40, pressure: 5.9 };
    let r = stepCatheter(c, { ...input, inflate: true });
    expect(r.state.deployed).toBe(true);
    expect(r.events).toContainEqual({ type: 'deployed' });
    c = { ...r.state, pressure: 0, inflation: null };
    r = stepCatheter(c, { ...input, ds: -60 });
    expect(r.state.deployed).toBe(false);
    expect(r.events).toContainEqual({ type: 'reloaded' });
  });
});

describe('controller: lumen treatment', () => {
  function balloonAt(d = wired(), size: [number, number] = [2.5, 15]) {
    d.c.selectTool('balloon');
    d.c.setCatheterSize(...size);
    const { end } = lesionBounds();
    const target = (d.c.route.routeArcOf('lad', end + (size[1] - 14) / 2) ?? 0) + 4;
    d.until('balloon', { advance: 1, fine: true }, () => d.c.catheter!.advanced >= target);
    return d;
  }

  it('balloon stretches the vessel while up, leaves 70 % after deflation', () => {
    const d = balloonAt();
    expect(d.c.catheterFacts()!.coversLesion).toBe(true);
    const lad = d.c.tree.vessels.lad.lumen;
    d.until('balloon', { inflate: true }, () => d.c.catheter!.pressure >= 10);
    const live = lad.diameterAt(LESION.centreArc);
    expect(live).toBeCloseTo(2.5 * 1.03, 1);
    d.until('balloon', { deflate: true }, () => d.c.catheter!.pressure === 0);
    const after = lad.diameterAt(LESION.centreArc);
    expect(after).toBeCloseTo(d.c.log.inflations[0]!.maxDiameter * 0.7, 2);
    // Tapered ends: just outside the balloon the native lumen is untouched.
    expect(lad.diameterAt(10)).toBeCloseTo(lad.referenceAt(10), 6);
  });

  it('inflated balloon stops flow beyond it (D2 too, not D1); flow recovers after deflation', () => {
    const d = balloonAt();
    expect(d.c.flow.timi).toBe(2);
    d.until('balloon', { inflate: true }, () => d.c.catheter!.pressure >= 8);
    expect(d.c.flow.distalTarget).toBe(0);
    expect(d.c.flow.timi).toBe(0);
    expect(d.c.flow.factor.d2[5]).toBe(0);
    expect(d.c.flow.factor.d1[5]).toBe(1);
    d.until('balloon', { deflate: true }, () => d.c.catheter!.pressure === 0);
    expect(d.c.flow.timi).toBe(3);
  });

  it('stent holds the lumen at its size minus 3 % recoil and restores TIMI 3', () => {
    const d = balloonAt();
    d.until('balloon', { inflate: true }, () => d.c.catheter!.pressure >= 10);
    d.until('balloon', { deflate: true }, () => d.c.catheter!.pressure === 0);
    d.until('balloon', { advance: -1 }, () => d.c.catheter!.advanced <= -5);
    d.c.selectTool('stent');
    expect(d.c.catheter!.kind).toBe('stent');
    d.c.setCatheterSize(3.0, 18);
    const { end } = lesionBounds();
    const target = (d.c.route.routeArcOf('lad', end + 2) ?? 0) + 4;
    d.until('stent', { advance: 1, fine: true }, () => d.c.catheter!.advanced >= target);
    const m = d.c.lesionMargins()!;
    expect(m.proximal).toBeGreaterThan(1.4);
    expect(m.distal).toBeGreaterThan(1.4);
    d.until('stent', { inflate: true }, () => d.c.catheter!.pressure >= 12);
    d.until('stent', { deflate: true }, () => d.c.catheter!.pressure === 0);
    const s = d.c.treatment.stents[0]!;
    expect(s.diameter).toBeCloseTo(3.0 * 1.024, 2);
    const lad = d.c.tree.vessels.lad.lumen;
    expect(lad.diameterAt(LESION.centreArc)).toBeCloseTo(s.diameter * 0.97, 2);
    expect(d.c.flow.timi).toBe(3);
    expect(d.c.treatment.dissections).toEqual([]);
  });

  it('oversized balloon (> 1.2 × reference) dissects and reduces flow ×0.45 until stented', () => {
    const d = balloonAt(wired(), [3.5, 15]);
    d.until('balloon', { inflate: true }, () => d.c.catheter!.pressure >= 8);
    // 3.5 mm at 8 atm is 1.19 × the 2.95 mm reference: not yet a tear.
    expect(d.c.treatment.dissections.length).toBe(0);
    d.until('balloon', { inflate: true }, () => d.c.catheter!.pressure >= 10);
    expect(d.c.treatment.dissections.length).toBe(1);
    expect(d.c.treatment.dissections[0]!.cause).toBe('oversize');
    d.until('balloon', { deflate: true }, () => d.c.catheter!.pressure === 0);
    expect(d.c.flow.distalTarget).toBeCloseTo(0.45, 2);
    expect(d.c.flow.timi).toBe(2);
    // Seal it with a stent covering the dissection.
    d.until('balloon', { advance: -1 }, () => d.c.catheter!.advanced <= -5);
    d.c.selectTool('stent');
    d.c.setCatheterSize(3.0, 23);
    const diss = d.c.treatment.dissections[0]!;
    const target = (d.c.route.routeArcOf('lad', diss.to + 3) ?? 0) + 4;
    d.until('stent', { advance: 1, fine: true }, () => d.c.catheter!.advanced >= target);
    d.until('stent', { inflate: true }, () => d.c.catheter!.pressure >= 10);
    d.until('stent', { deflate: true }, () => d.c.catheter!.pressure === 0);
    expect(d.c.treatment.dissections[0]!.sealed).toBe(true);
    expect(d.c.flow.timi).toBe(3);
  });

  it('an oversized short stent at high pressure causes an edge dissection beyond its end', () => {
    const d = balloonAt();
    d.until('balloon', { inflate: true }, () => d.c.catheter!.pressure >= 10);
    d.until('balloon', { deflate: true }, () => d.c.catheter!.pressure === 0);
    d.until('balloon', { advance: -1 }, () => d.c.catheter!.advanced <= -5);
    d.c.selectTool('stent');
    d.c.setCatheterSize(4.0, 12);
    const target = (d.c.route.routeArcOf('lad', LESION.centreArc + 6) ?? 0) + 4;
    d.until('stent', { advance: 1, fine: true }, () => d.c.catheter!.advanced >= target);
    d.until('stent', { inflate: true }, () => d.c.catheter!.pressure >= 16);
    d.until('stent', { deflate: true }, () => d.c.catheter!.pressure === 0);
    const diss = d.c.treatment.dissections;
    expect(diss.length).toBe(1);
    expect(diss[0]!.cause).toBe('edge');
    expect(diss[0]!.from).toBeGreaterThan(d.c.treatment.stents[0]!.to);
    expect(diss[0]!.sealed).toBe(false);
    expect(d.c.flow.timi).toBeLessThan(3);
    expect(d.c.lesionMargins(d.c.treatment.stents[0]!)!.proximal).toBeLessThan(0);
  });

  it('a later inflation inside a stent post-dilates it', () => {
    const d = makeController();
    const t = d.treatment;
    t.addStent({ vessel: 'lad', from: 31, to: 49, diameter: 2.9 });
    t.postDilate({ vessel: 'lad', from: 35, to: 47 }, 3.2);
    expect(t.stents[0]!.diameter).toBe(3.2);
    t.postDilate({ vessel: 'lad', from: 60, to: 70 }, 3.5);
    expect(t.stents[0]!.diameter).toBe(3.2);
  });

  it('balloon rupture is counted and may dissect', () => {
    const d = balloonAt(wired(engaged(driver(makeController(1, () => 0.1)))), [2.5, 15]);
    d.until('balloon', { inflate: true }, () => d.c.log.ruptures > 0, 30);
    expect(d.c.catheter!.ruptured).toBe(true);
    expect(d.c.treatment.dissections.some((x) => x.cause === 'rupture')).toBe(true);
  });
});
