import { fmt, t, tk } from '../i18n';
import { entryVessel, isWrongVessel } from '../cases/target';
export { vesselName } from '../cases/target';
import { BALLOON, CALCIUM, DISSECTION, GUIDE, WIRE } from '../config/anatomy';
import { lesionBounds } from '../anatomy/stenosis';
import type { Projection, VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import {
  currentDiameter,
  inGuide,
  newCatheter,
  setBalloonType,
  setSize,
  stepCatheter,
  workingSpan,
  type CatheterKind,
  type CatheterState,
  type InflationRecord,
} from '../physics/catheter';
import { computeFlow, type FlowState } from '../physics/flowModel';
import { atRoot, facingCusp, initialGuide, stepGuide, type GuideState } from '../physics/guide';
import { buildGuideRoute, guideLocationName, type ChainRoute, type GuideRoute } from '../physics/route';
import { causesOversizeDissection } from '../physics/sizing';
import { LumenTreatment, edgeDissectionSpan, meanReference, type Span } from '../physics/treatment';
import { branchHint, initialWire, stepWire, wireDistal, wireRoute, wireTip, type BranchHint, type WireState } from '../physics/wire';
import type { CatheterFacts, InjectionKind, ProcedureFacts } from '../procedure/stages';
import { DEFLATED_PRESSURE } from '../procedure/stages';
import type { MessageLevel } from '../state/messages';
import type { ToolId } from './tools';

export interface DeviceInput {
  /** Held advance/retract, −1..1 (W/S). */
  readonly advance: number;
  /** Held rotation, −1..1 (A/D). */
  readonly rotate: number;
  readonly fine: boolean;
  /** Wheel notches since the last frame (+ = advance). */
  readonly wheel: number;
  readonly inflate: boolean;
  readonly deflate: boolean;
}

export const NO_INPUT: DeviceInput = { advance: 0, rotate: 0, fine: false, wheel: 0, inflate: false, deflate: false };

export interface DeviceMessage {
  readonly text: string;
  readonly level: MessageLevel;
}

export interface StepResult {
  readonly messages: DeviceMessage[];
  /** Vessels whose lumen changed this frame (meshes must be rebuilt). */
  readonly lumenChanged: ReadonlySet<VesselId>;
}

export interface DeviceLog {
  inflations: InflationRecord[];
  ruptures: number;
  stentsDeployed: number;
  heparinBeforeWire: boolean | null;
  /** Time the calcium was cracked (null = intact or no calcium). */
  crackedAt: number | null;
  /** Inflations with a non-compliant balloon. */
  ncInflations: number;
}

const SPEEDS = {
  guide: [GUIDE.advanceSpeed, GUIDE.fineAdvanceSpeed, GUIDE.wheelStep, GUIDE.fineWheelStep, GUIDE.rotateSpeedDeg, GUIDE.fineRotateSpeedDeg],
  wire: [WIRE.advanceSpeed, WIRE.fineAdvanceSpeed, WIRE.wheelStep, WIRE.fineWheelStep, WIRE.rotateSpeedDeg, WIRE.fineRotateSpeedDeg],
  catheter: [BALLOON.advanceSpeed, BALLOON.fineAdvanceSpeed, BALLOON.wheelStep, BALLOON.fineWheelStep, 0, 0],
} as const;

/**
 * Owns the guide, wire and balloon/stent catheter on their 1D rails, applies lumen
 * treatment, dissections and flow. Pure TypeScript: no DOM, no Three.js.
 */
export class DeviceController {
  readonly guideRoute: GuideRoute;
  readonly treatment: LumenTreatment;
  guide: GuideState = initialGuide();
  wire: WireState;
  catheter: CatheterState | null = null;
  heparinGiven = false;
  qcaMeasured = false;
  flow: FlowState;
  readonly log: DeviceLog = { inflations: [], ruptures: 0, stentsDeployed: 0, heparinBeforeWire: null, crackedAt: null, ncInflations: 0 };
  /** Stent index being expanded by the current inflation (to follow its max diameter). */
  private deployingStent: number | null = null;
  private oversizeThisInflation = false;

  constructor(
    readonly tree: VesselTree,
    readonly rng: () => number = Math.random,
  ) {
    this.guideRoute = buildGuideRoute(tree);
    this.wire = initialWire(tree.setup.wireStartDeg);
    this.treatment = new LumenTreatment(tree);
    this.flow = computeFlow(tree, [], []);
  }

  get route(): ChainRoute {
    return wireRoute(this.tree, this.wire);
  }

  get wireTipRouteArc(): number {
    return this.wire.out ? this.route.length : 0;
  }

  /** Catheter working span in vessel arcs (vessel of the distal marker). */
  catheterSpan(c: CatheterState | null = this.catheter): Span | null {
    if (!c || inGuide(c) || !this.wire.out) return null;
    const route = this.route;
    const w = workingSpan(c);
    const end = route.locate(w.end);
    const startArc = Math.max(0, end.arc - c.length);
    return { vessel: end.vessel, from: startArc, to: end.arc };
  }

  giveHeparin(): boolean {
    if (this.heparinGiven) return false;
    this.heparinGiven = true;
    return true;
  }

  /** Load a catheter when a balloon/stent tool is chosen (swapping one that is in the guide). */
  selectTool(tool: ToolId): void {
    if (tool !== 'balloon' && tool !== 'stent') return;
    const kind: CatheterKind = tool;
    if (!this.catheter) this.catheter = newCatheter(kind);
    else if (this.catheter.kind !== kind && inGuide(this.catheter)) this.catheter = newCatheter(kind);
  }

  setCatheterSize(diameter: number, length: number): DeviceMessage | null {
    if (!this.catheter) return null;
    const r = setSize(this.catheter, diameter, length);
    if (!r.ok) return { text: t('msg.cat.sizeLocked'), level: 'warn' };
    this.catheter = r.state;
    return null;
  }

  /** Choose a semi-compliant or non-compliant balloon (only while it is in the guide). */
  setBalloonType(nc: boolean): DeviceMessage | null {
    if (!this.catheter || this.catheter.kind !== 'balloon') return null;
    const r = setBalloonType(this.catheter, nc);
    if (!r.ok) return { text: t('msg.cat.sizeLocked'), level: 'warn' };
    this.catheter = r.state;
    return null;
  }

  step(dt: number, input: DeviceInput, tool: ToolId, time: number): StepResult {
    const messages: DeviceMessage[] = [];
    const say = (text: string, level: MessageLevel = 'info') => messages.push({ text, level });
    const changed = new Set<VesselId>();
    let flowDirty = false;

    const key = tool === 'guide' ? 'guide' : tool === 'wire' ? 'wire' : tool === 'balloon' || tool === 'stent' ? 'catheter' : null;
    let ds = 0;
    let rot = 0;
    if (key) {
      const [sp, fsp, ws, fws, rs, frs] = SPEEDS[key];
      ds = input.advance * (input.fine ? fsp : sp) * dt + input.wheel * (input.fine ? fws : ws);
      rot = input.rotate * (input.fine ? frs : rs) * dt;
    }

    // --- Guide ------------------------------------------------------------
    if (key === 'guide') {
      const r = stepGuide(this.guide, { ds, rotateDeg: rot, dt, wireOut: this.wire.out, cusp: this.tree.setup.cusp }, this.guideRoute);
      this.guide = r.state;
      for (const e of r.events) {
        if (e === 'blockedByWire') say(t('msg.guide.blocked'), 'warn');
        if (e === 'pastElbow') say(t('msg.guide.pastElbow'), 'info');
        if (e === 'inAorta') say(t('msg.guide.inAorta'), 'info');
        if (e === 'atRoot') say(t('msg.guide.atRoot'), 'ok');
        if (e === 'engaged') say(t('msg.guide.engaged'), 'ok');
        if (e === 'tooFast') say(t('msg.guide.tooFast'), 'warn');
        if (e === 'facingOther') say(t('msg.guide.facingOther'), 'warn');
        if (e === 'notFacingTarget') say(t('msg.guide.notFacing'), 'info');
        if (e === 'popOut') say(t('msg.guide.popOut'), 'danger');
        if (e === 'disengaged') say(t('msg.guide.disengaged'), 'info');
      }
    }

    // --- Wire ---------------------------------------------------------------
    if (key === 'wire') {
      if (!this.guide.engaged && !this.wire.out && ds > 0) {
        say(t('msg.wire.needEngage'), 'warn');
      } else {
        const catheterOut = !!this.catheter && !inGuide(this.catheter);
        const before = this.wire.out;
        const r = stepWire(this.wire, { ds, rotateDeg: rot, dt, catheterOut, rng: this.rng, entry: entryVessel(this.tree) }, this.tree);
        this.wire = r.state;
        if (!before && this.wire.out && this.log.heparinBeforeWire === null) this.log.heparinBeforeWire = this.heparinGiven;
        for (const e of r.events) {
          if (e.type === 'out') say(t('msg.wire.out'), 'info');
          if (e.type === 'inGuide') say(t('msg.wire.inGuide'), 'info');
          if (e.type === 'entered') {
            if (e.vessel === this.tree.lesion.vessel) say(t('msg.wire.target'), 'ok');
            else if (e.vessel === 'd1' || e.vessel === 'd2') say(t('msg.wire.diag', { branch: t(e.vessel === 'd1' ? 'vessel.d1' : 'vessel.d2') }), 'warn');
            else if (isWrongVessel(this.tree, e.vessel)) say(t('msg.wire.wrong'), 'warn');
          }
          if (e.type === 'forcing') say(t('msg.wire.forcing'), 'warn');
          if (e.type === 'crossed') {
            say(t('msg.wire.crossed'), 'ok');
            if (e.dissection) {
              const { start, end } = lesionBounds(this.tree.lesion);
              this.treatment.addDissection({ vessel: this.tree.lesion.vessel, from: start, to: end }, 'wire');
              say(t('msg.wire.dissection'), 'danger');
              flowDirty = true;
            }
          }
          if (e.type === 'nearEnd') say(t('msg.wire.nearEnd'), 'warn');
          if (e.type === 'vesselEnd') say(t('msg.wire.end'), 'danger');
          if (e.type === 'retractBlocked') say(t('msg.wire.retractBlocked'), 'warn');
        }
      }
    }

    // --- Catheter -----------------------------------------------------------
    const c = this.catheter;
    if (c) {
      const moveDs = key === 'catheter' && tool === c.kind ? ds : 0;
      const wantsInflate = input.inflate || input.deflate;
      if (moveDs !== 0 || wantsInflate || c.pressure > 0 || c.inflation) {
        const prevSpan = this.catheterSpan(c);
        const r = stepCatheter(c, { ds: moveDs, dt, inflate: input.inflate, deflate: input.deflate, fine: input.fine, wireTip: this.wireTipRouteArc, time });
        this.catheter = r.state;
        const span = this.catheterSpan(this.catheter) ?? prevSpan;
        for (const e of r.events) {
          if (e.type === 'moveBlockedInflated') say(t('msg.cat.deflateFirst'), 'warn');
          if (e.type === 'wireLead') say(t('msg.cat.wireLead'), 'warn');
          if (e.type === 'inflateInGuide') say(t('msg.cat.inflateInGuide'), 'warn');
          if (e.type === 'ruptureUnusable') say(t('msg.cat.ruptureUnusable'), 'warn');
          if (e.type === 'aboveRbp') say(t('msg.cat.aboveRbp'), 'warn');
          if (e.type === 'outOfGuide') say(t(c.kind === 'balloon' ? 'msg.cat.outBalloon' : 'msg.cat.outStent'), 'info');
          if (e.type === 'reloaded') say(c.kind === 'stent' ? t('msg.cat.reloadStent') : t('msg.cat.reloadBalloon'), 'info');
          if (e.type === 'deployed' && span) {
            this.treatment.addStent({ ...span, diameter: currentDiameter(this.catheter) });
            this.deployingStent = this.treatment.stents.length - 1;
            this.log.stentsDeployed++;
            say(t('msg.cat.deployed'), 'ok');
          }
          if (e.type === 'ruptured') {
            this.log.ruptures++;
            say(t('msg.cat.rupture'), 'danger');
            if (span && this.rng() < DISSECTION.ruptureDissectionChance) {
              this.treatment.addDissection(span, 'rupture');
              say(t('msg.cat.ruptureDissection'), 'danger');
            }
          }
          if (e.type === 'inflationEnd') {
            this.log.inflations.push(e.record);
            if (c.nc) this.log.ncInflations++;
            if (span) {
              this.treatment.recordBalloon(span, e.record.maxDiameter);
              this.treatment.postDilate(span, e.record.maxDiameter);
            }
            this.deployingStent = null;
            this.oversizeThisInflation = false;
            say(t('msg.cat.deflated', { s: fmt(e.record.duration, 0), atm: fmt(e.record.maxPressure, 1) }), 'info');
          }
        }
        const cur = this.catheter;
        const spanNow = this.catheterSpan(cur);
        if (spanNow && cur.pressure > DEFLATED_PRESSURE) {
          const d = currentDiameter(cur);
          // High pressure over the calcified plateau fractures the calcium.
          const l = this.tree.lesion;
          if (
            this.treatment.calcified &&
            !this.treatment.cracked &&
            cur.pressure >= CALCIUM.crackPressure &&
            spanNow.vessel === l.vessel &&
            spanNow.from <= l.centreArc &&
            spanNow.to >= l.centreArc
          ) {
            this.treatment.crack();
            this.log.crackedAt = time;
            say(t('msg.cat.cracked', { atm: fmt(cur.pressure, 0) }), 'ok');
            // Stents already in place expand to their full size now.
            changed.add(l.vessel);
          }
          this.treatment.live = { ...spanNow, diameter: d };
          if (this.deployingStent !== null) {
            const s = this.treatment.stents[this.deployingStent]!;
            this.treatment.stents[this.deployingStent] = { ...s, diameter: Math.max(s.diameter, d) };
          }
          const ref = meanReference(this.tree.vessels[spanNow.vessel].lumen, spanNow.from, spanNow.to);
          if (!this.oversizeThisInflation && causesOversizeDissection(d, ref)) {
            this.oversizeThisInflation = true;
            const isStent = cur.kind === 'stent';
            const dspan = isStent ? edgeDissectionSpan(spanNow, this.tree.vessels[spanNow.vessel].path.length) : spanNow;
            this.treatment.addDissection(dspan, isStent ? 'edge' : 'oversize');
            say(isStent ? t('msg.cat.oversizeStent') : t('msg.cat.oversizeBalloon'), 'danger');
          }
        } else {
          this.treatment.live = null;
        }
        if (prevSpan) changed.add(prevSpan.vessel);
        if (spanNow) changed.add(spanNow.vessel);
      }
    }

    if (changed.size > 0) {
      this.treatment.updateSealing();
      for (const v of changed) this.treatment.apply(v);
      flowDirty = true;
    }
    if (flowDirty) this.recomputeFlow();
    return { messages, lumenChanged: changed };
  }

  recomputeFlow(): void {
    const occlusions: Span[] = [];
    const span = this.catheterSpan();
    if (span && this.catheter && this.catheter.pressure >= BALLOON.unfoldPressure) occlusions.push(span);
    this.flow = computeFlow(this.tree, occlusions, this.treatment.dissections);
  }

  /** Inflated balloon/stent occluding a vessel right now. */
  get occluding(): boolean {
    return !!this.catheter && !inGuide(this.catheter) && this.catheter.pressure >= BALLOON.unfoldPressure;
  }

  hint(): BranchHint | null {
    return this.wire.out || this.guide.engaged ? branchHint(this.tree, this.wire) : null;
  }

  guideLocation(): string {
    if (this.guide.engaged) return tk(`ostium.${this.tree.setup.cusp}`);
    return guideLocationName(this.guideRoute, this.tree, this.guide.arc);
  }

  wireLocation(): string {
    const tip = wireTip(this.wire);
    if (!tip) return t('loc.inGuide');
    return `${this.tree.vessels[tip.vessel].name}, ${tip.arc.toFixed(0)} mm`;
  }

  catheterFacts(): CatheterFacts | null {
    const c = this.catheter;
    if (!c) return null;
    const span = this.catheterSpan(c);
    const { start, end } = lesionBounds(this.tree.lesion);
    const centre = this.tree.lesion.centreArc;
    const onLad = !!span && span.vessel === this.tree.lesion.vessel;
    return {
      kind: c.kind,
      inCoronary: !inGuide(c),
      overLesion: onLad && span!.from <= centre + 1 && span!.to >= centre - 1,
      coversLesion: onLad && span!.from <= start && span!.to >= end,
      pressure: c.pressure,
    };
  }

  /** Margins of the catheter (or a stent) relative to the lesion, in mm. */
  lesionMargins(span: Span | null = this.catheterSpan()): { proximal: number; distal: number } | null {
    if (!span || span.vessel !== this.tree.lesion.vessel) return null;
    const { start, end } = lesionBounds(this.tree.lesion);
    return { proximal: start - span.from, distal: span.to - end };
  }

  facts(extra: { xrayActive: boolean; injecting: InjectionKind; projection: Projection }): Omit<ProcedureFacts, 'ffrMeasured' | 'deferred'> {
    const tip = wireTip(this.wire);
    return {
      guidePastElbow: this.guide.arc > this.guideRoute.elbowArc,
      guideInAorta: this.guide.arc > this.guideRoute.aortaEntryArc,
      guideAtRoot: atRoot(this.guide, this.guideRoute),
      guideFacingTargetCusp: facingCusp(this.guide.rotationDeg, this.tree.setup.cusp),
      guideEngaged: this.guide.engaged,
      xrayActive: extra.xrayActive,
      injecting: extra.injecting,
      projection: extra.projection,
      heparinGiven: this.heparinGiven,
      wireOut: this.wire.out,
      wireVessel: tip?.vessel ?? null,
      wireInTarget: tip?.vessel === this.tree.lesion.vessel,
      wireCrossed: this.wire.crossed && tip?.vessel === this.tree.lesion.vessel && tip.arc > lesionBounds(this.tree.lesion).end,
      wireForcing: this.wire.forcing,
      wireDistal: wireDistal(this.wire, this.tree),
      catheter: this.catheterFacts(),
      qcaMeasured: this.qcaMeasured,
      stentDeployed: this.treatment.stents.length > 0,
    };
  }
}

