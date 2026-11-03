import { lesionBounds } from '../src/anatomy/stenosis';
import type { CaseLesion, CaseSetup } from '../src/cases/cases';
import type { Recorder } from '../src/replay/recording';
import { targetDeg } from '../src/cases/target';
import { angleDistDeg } from '../src/physics/speed';
import { cuspAngle } from '../src/physics/guide';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { createRng } from '../src/physics/ecg';
import { Session } from '../src/procedure/session';
import { NO_INPUT, type DeviceInput } from '../src/tools/deviceController';
import type { ToolId } from '../src/tools/tools';

/** Drives a Session through the same inputs a learner would use. */
export class CaseRunner {
  readonly s: Session;
  readonly log: string[] = [];
  constructor(seed = 5, lesion?: CaseLesion, setup?: CaseSetup, recorder: Recorder | null = null) {
    this.s = new Session(buildVesselTree(lesion, setup), createRng(seed), recorder);
  }
  step(input: Partial<DeviceInput> = {}, pedal = false, dt = 0.05) {
    const r = this.s.step(dt, { ...NO_INPUT, ...input }, pedal);
    for (const m of r.messages) this.log.push(m.text);
    return r;
  }
  until(input: Partial<DeviceInput>, done: () => boolean, maxS = 200) {
    for (let t = 0; t < maxS && !done(); t += 0.05) this.step(input);
    if (!done()) throw new Error(`not reached; last: ${this.log.slice(-3).join(' | ')}`);
  }
  run(input: Partial<DeviceInput>, seconds: number) {
    for (let t = 0; t < seconds; t += 0.05) this.step(input);
  }
  wait(seconds: number) {
    for (let t = 0; t < seconds; t += 0.05) this.step();
  }
  tool(t: ToolId) {
    const a = this.s.selectTool(t);
    if (!a.ok) throw new Error(a.reason);
  }
  angiogram() {
    this.tool('contrast');
    this.step();
    this.until({}, () => this.s.xray.mode === 'lih');
  }

  engageAndAngiogram() {
    const c = this.s.ctrl;
    this.tool('guide');
    this.until({ advance: 1 }, () => c.guide.arc > c.guideRoute.aortaEntryArc + 5);
    this.step({}, true);
    this.until({ advance: 1 }, () => c.guide.arc >= c.guideRoute.rootArc - 0.5);
    const cusp = cuspAngle(this.s.tree.setup.cusp);
    this.until({ rotate: c.guide.rotationDeg > cusp ? -1 : 1, fine: true }, () => Math.abs(c.guide.rotationDeg - cusp) < 3);
    this.until({ advance: 1, fine: true }, () => c.guide.engaged);
    this.angiogram();
  }

  crossGently() {
    const c = this.s.ctrl;
    this.s.heparin();
    this.tool('wire');
    const l = this.s.tree.lesion;
    const deg = targetDeg(l.vessel);
    // Turn the shaped tip toward the target branch (the shorter way round).
    const dir = ((((c.wire.rotationDeg - deg) % 360) + 540) % 360) - 180 > 0 ? -1 : 1;
    this.until({ rotate: dir }, () => angleDistDeg(c.wire.rotationDeg, deg) < 4);
    const park = lesionBounds(l).end + 22;
    this.until({ advance: 1, fine: true }, () => c.wire.chain.includes(l.vessel) && c.wire.tipArc > park);
  }

  /** Advance the loaded catheter until its distal marker is `distalBeyond` mm past the lesion end. */
  position(distalBeyond: number) {
    const c = this.s.ctrl;
    const l = this.s.tree.lesion;
    const target = (c.route.routeArcOf(l.vessel, lesionBounds(l).end + distalBeyond) ?? 0) + 4;
    this.until({ advance: 1, fine: true }, () => c.catheter!.advanced >= target - 0.1);
  }

  inflate(to: number, holdS: number) {
    const c = this.s.ctrl;
    this.until({ inflate: true }, () => c.catheter!.pressure >= to);
    this.wait(holdS);
    this.until({ deflate: true }, () => c.catheter!.pressure === 0);
  }

  withdraw() {
    const c = this.s.ctrl;
    this.until({ advance: -1 }, () => c.catheter!.advanced <= 0);
  }

  finalViews() {
    this.angiogram();
    this.s.nextPreset();
    this.s.nextPreset();
    this.angiogram();
  }
}
