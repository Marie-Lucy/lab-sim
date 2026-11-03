import { fmt, t } from '../i18n';
import { C_ARM } from '../config/anatomy';
import type { Projection, VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import { nudge, presetAt, projectionName } from '../physics/carm';
import { injectionDuration, planInjection, type ContrastPlan, type InjectionKind } from '../physics/contrast';
import { FFR, IMAGING } from '../config/anatomy';
import { pullback, type Modality, type Pullback } from '../physics/imaging';
import { lesionBounds, stenosisShape } from '../anatomy/stenosis';
import { fractionalFlowReserve, hyperaemicFlow, isSignificant } from '../physics/ffr';
import { wireTip } from '../physics/wire';
import { giveHeparin, heparinDoseUnits, initialPhysiology, stepPhysiology, type PhysiologyState } from '../physics/physiology';
import { DeviceController, type DeviceInput, type DeviceMessage } from '../tools/deviceController';
import { applyCaseText } from '../cases/target';
import type { Recorder } from '../replay/recording';
import { deferAvailability, toolAvailability, type Availability, type ToolId } from '../tools/tools';
import { measureQca, type QcaResult } from './qca';
import { initialProgress, planFor, stepProgress, type ProcedureFacts, type ProcedureProgress, type ProgressEvent } from './stages';
import { initialXray, isActive, startCine, stepXray, type XrayState } from './xray';

export interface Injection {
  readonly plan: ContrastPlan;
  readonly start: number;
}

/** One pressure-wire reading. */
export interface FfrReading {
  readonly time: number;
  readonly ffr: number;
  readonly pd: number;
  readonly pa: number;
  /** Sensor position: mm past the lesion's distal end (negative = proximal or inside it). */
  readonly beyondLesion: number;
  /** No balloon or stent had touched the lesion yet. */
  readonly beforeTreatment: boolean;
}

export interface SessionStep {
  readonly messages: DeviceMessage[];
  readonly lumenChanged: ReadonlySet<VesselId>;
  /** A new X-ray frame should be acquired this tick. */
  readonly pulse: boolean;
  /** The contrast plan changed (new injection or flow change during one). */
  readonly planChanged: boolean;
  readonly progress: ProgressEvent[];
}

/**
 * One case in progress: devices, X-ray beam, contrast, C-arm, patient and stage progress.
 * Pure (no DOM / Three.js) so the UI, the demo and tests drive the same object.
 */
export class Session {
  readonly ctrl: DeviceController;
  time = 0;
  tool: ToolId = 'guide';
  xray: XrayState = initialXray();
  projection: Projection;
  presetIndex: number;
  contrastMl = 0;
  injection: Injection | null = null;
  physiology: PhysiologyState = initialPhysiology();
  progress: ProcedureProgress;
  readonly ffrReadings: FfrReading[] = [];
  /** IVUS/OCT pullbacks, oldest first. */
  readonly imaging: Pullback[] = [];
  /** The lesion was left untreated after physiology. */
  deferred = false;
  /** FFR of the untreated lesion with the sensor well beyond it (what the decision is judged on). */
  readonly nativeFfr: number;
  private pendingMessages: DeviceMessage[] = [];
  private planDirty = false;

  constructor(
    readonly tree: VesselTree,
    rng: () => number = Math.random,
    /** When set, every action and tick is recorded for replay. */
    readonly recorder: Recorder | null = null,
  ) {
    this.ctrl = new DeviceController(tree, rng);
    this.progress = initialProgress(planFor(tree.setup));
    this.nativeFfr = this.ffrAt(this.distalSensorArc()).ffr;
    applyCaseText(tree);
    const p = presetAt(C_ARM.presets.length - 1);
    this.presetIndex = p.index;
    this.projection = p.projection;
  }

  get injecting(): InjectionKind | 'none' {
    if (!this.injection) return 'none';
    return this.time - this.injection.start <= injectionDuration(this.injection.plan.kind) ? this.injection.plan.kind : 'none';
  }

  get projectionName(): string {
    return projectionName(this.projection);
  }

  private say(text: string, level: DeviceMessage['level'] = 'info'): void {
    this.pendingMessages.push({ text, level });
  }

  /** Inject contrast: selective through an engaged guide, otherwise an aortic root flush. */
  inject(): boolean {
    if (this.ctrl.guide.arc <= this.ctrl.guideRoute.aortaEntryArc) {
      this.say(t('msg.inject.needAorta'), 'warn');
      return false;
    }
    if (this.injecting !== 'none') return false;
    const kind: InjectionKind = this.ctrl.guide.engaged ? 'selective' : 'aortic';
    const plan = planInjection(this.tree, this.ctrl.flow, kind, this.tree.setup.cusp);
    this.injection = { plan, start: this.time };
    this.planDirty = true;
    this.contrastMl += plan.volumeMl;
    this.xray = startCine(this.xray, this.time, plan.cineLength);
    this.say(
      kind === 'selective'
        ? t('msg.inject.selective', { ml: plan.volumeMl, cine: fmt(plan.cineLength, 1), proj: this.projectionName })
        : t('msg.inject.aortic', { ml: plan.volumeMl, cine: fmt(plan.cineLength, 1) }),
      'info',
    );
    return true;
  }

  qca: QcaResult | null = null;

  /**
   * Select a tool if the rules allow it (otherwise explain why). Contrast and fluoro are
   * actions, not held tools: selecting contrast injects.
   */
  selectTool(tool: ToolId): Availability {
    this.recorder?.action({ k: 'tool', tool });
    const a = toolAvailability(tool, this.facts(), this.progress);
    if (!a.ok) {
      this.say(a.reason, 'warn');
      return a;
    }
    if (tool === 'contrast') {
      this.inject();
      return a;
    }
    if (tool === 'fluoro') return a;
    this.tool = tool;
    this.ctrl.selectTool(tool);
    if (tool === 'measure') this.measure();
    if (tool === 'ffr') this.measureFfr();
    return a;
  }

  private distalSensorArc(): number {
    const l = this.tree.lesion;
    const len = this.tree.vessels[l.vessel].lumen.length;
    return Math.min(len - 2, lesionBounds(l).end + 20);
  }

  private ffrAt(arc: number) {
    const l = this.tree.lesion;
    return fractionalFlowReserve(this.tree.vessels[l.vessel].lumen, arc, hyperaemicFlow(l.vessel));
  }

  /**
   * Pressure-wire FFR with the sensor at the wire tip (the case's wire is a pressure wire),
   * after an intracoronary adenosine bolus. Only meaningful with the sensor past the lesion.
   */
  measureFfr(): FfrReading | null {
    const tip = wireTip(this.ctrl.wire);
    if (!tip || tip.vessel !== this.tree.lesion.vessel) return null;
    const r = this.ffrAt(tip.arc);
    const beyond = tip.arc - lesionBounds(this.tree.lesion).end;
    const reading: FfrReading = {
      time: this.time,
      ffr: r.ffr,
      pd: r.pd,
      pa: r.pa,
      beyondLesion: beyond,
      beforeTreatment: this.ctrl.log.inflations.length === 0 && !this.ctrl.catheter?.inflation,
    };
    this.ffrReadings.push(reading);
    const v = fmt(r.ffr, 2);
    const params = { ffr: v, pd: fmt(r.pd, 0), pa: fmt(r.pa, 0), ug: FFR.adenosineUg };
    if (beyond < FFR.sensorBeyondMm) this.say(t('msg.ffr.proximal', params), 'warn');
    else this.say(t(isSignificant(r.ffr) ? 'msg.ffr.significant' : 'msg.ffr.notSignificant', params), isSignificant(r.ffr) ? 'warn' : 'ok');
    return reading;
  }

  /** The FFR that counts for the decision: the last valid reading before any treatment. */
  get decisionFfr(): FfrReading | null {
    const valid = this.ffrReadings.filter((r) => r.beforeTreatment && r.beyondLesion >= FFR.sensorBeyondMm);
    return valid[valid.length - 1] ?? null;
  }

  /**
   * IVUS or OCT pullback over the wire, from 2 mm short of the tip back to the ostium of the
   * target vessel. OCT needs a contrast flush through the guide to clear the blood.
   */
  pullback(modality: Modality): Availability {
    this.recorder?.action({ k: 'pullback', m: modality });
    const a = toolAvailability('imaging', this.facts(), this.progress);
    if (!a.ok) {
      this.say(a.reason, 'warn');
      return a;
    }
    const v = this.tree.lesion.vessel;
    const tr = this.ctrl.treatment;
    const tip = wireTip(this.ctrl.wire)!;
    const run = pullback(
      {
        lumen: this.tree.vessels[v].lumen,
        native: tr.native(v),
        stents: tr.stents.filter((s) => s.vessel === v),
        dissections: tr.dissections.filter((d) => d.vessel === v),
        calcium: (arc) => (tr.calcified ? (this.tree.lesion.calcium ?? 0) * stenosisShape(arc, this.tree.lesion) : 0),
        cracked: tr.cracked,
      },
      v,
      tip.arc - 2,
      modality,
      this.time,
    );
    this.imaging.push(run);
    if (modality === 'oct') this.contrastMl += IMAGING.octFlushMl;
    const m = run.summary;
    const name = modality === 'ivus' ? 'IVUS' : 'OCT';
    if (m.msa && m.expansion !== null) {
      this.say(t('msg.img.post', { name, msa: fmt(m.msa.area, 1), exp: fmt(m.expansion * 100, 0), mal: fmt(m.maxMalapposition, 2) }), m.expansion >= IMAGING.expansionGoal && m.maxMalapposition < IMAGING.malappositionMm ? 'ok' : 'warn');
    } else {
      const pb = m.mla.plaqueBurden;
      this.say(pb === null ? t('msg.img.preOct', { mla: fmt(m.mla.area, 1) }) : t('msg.img.pre', { name, mla: fmt(m.mla.area, 1), pb: fmt(pb * 100, 0) }), 'info');
    }
    if (modality === 'oct') this.say(t('msg.img.flush', { ml: IMAGING.octFlushMl }), 'info');
    return a;
  }

  /** Leave the lesion untreated (physiology says it does not limit flow). */
  defer(): Availability {
    this.recorder?.action({ k: 'defer' });
    const a = deferAvailability(this.facts(), this.progress);
    if (!a.ok) {
      this.say(a.reason, 'warn');
      return a;
    }
    this.deferred = true;
    this.say(t('msg.ffr.deferred'), 'ok');
    return a;
  }

  /** QCA of the LAD lesion segment. */
  measure(): QcaResult {
    this.qca = measureQca(this.tree.vessels[this.tree.lesion.vessel].lumen, this.tree.lesion);
    this.ctrl.qcaMeasured = true;
    return this.qca;
  }

  /** Choose the balloon/stent size (only while the catheter is in the guide). */
  setSize(diameter: number, length: number): DeviceMessage | null {
    this.recorder?.action({ k: 'size', d: diameter, l: length });
    return this.ctrl.setCatheterSize(diameter, length);
  }

  /** Semi-compliant or non-compliant balloon (only while it is in the guide). */
  setBalloonType(nc: boolean): DeviceMessage | null {
    this.recorder?.action({ k: 'balloonType', nc });
    return this.ctrl.setBalloonType(nc);
  }

  heparin(): boolean {
    this.recorder?.action({ k: 'heparin' });
    if (!this.ctrl.giveHeparin()) return false;
    this.physiology = giveHeparin(this.physiology);
    this.say(t('msg.heparin', { units: heparinDoseUnits() }), 'ok');
    return true;
  }

  nextPreset(): void {
    this.recorder?.action({ k: 'preset' });
    const p = presetAt(this.presetIndex + 1);
    this.presetIndex = p.index;
    this.projection = p.projection;
  }

  nudgeCarm(dLao: number, dCranial: number): void {
    this.recorder?.action({ k: 'nudge', lao: dLao, cra: dCranial });
    this.projection = nudge(this.projection, dLao, dCranial);
  }

  facts(): ProcedureFacts {
    return {
      ...this.ctrl.facts({ xrayActive: isActive(this.xray.mode), injecting: this.injecting, projection: this.projection }),
      ffrMeasured: this.decisionFfr !== null,
      deferred: this.deferred,
    };
  }

  step(dt: number, input: DeviceInput, pedal: boolean): SessionStep {
    this.recorder?.tick(input, pedal, dt);
    this.time += dt;
    const res = this.ctrl.step(dt, input, this.tool, this.time);
    let planChanged = this.planDirty;
    this.planDirty = false;
    if (this.injection && res.lumenChanged.size > 0) {
      // Flow changed mid-run (balloon up/down): recompute the fronts from the same start.
      this.injection = { plan: planInjection(this.tree, this.ctrl.flow, this.injection.plan.kind, this.tree.setup.cusp), start: this.injection.start };
      planChanged = true;
    }
    const x = stepXray(this.xray, { dt, time: this.time, pedal });
    this.xray = x.state;
    this.physiology = stepPhysiology(this.physiology, { dt, targetFlow: this.ctrl.flow.distalTarget });
    const pr = stepProgress(this.progress, this.facts(), this.time);
    this.progress = pr.progress;
    const messages = [...this.pendingMessages, ...res.messages];
    this.pendingMessages = [];
    return { messages, lumenChanged: res.lumenChanged, pulse: x.pulse, planChanged, progress: pr.events };
  }
}
