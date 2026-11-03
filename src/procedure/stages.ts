import { C_ARM } from '../config/anatomy';
import { hasKey, textContext, tk } from '../i18n';
import type { Projection, VesselId } from '../anatomy/types';

export type InjectionKind = 'none' | 'selective' | 'aortic';

export interface CatheterFacts {
  readonly kind: 'balloon' | 'stent';
  /** Beyond the guide tip, inside the coronary tree. */
  readonly inCoronary: boolean;
  /** Working length overlaps the narrowest part of the lesion. */
  readonly overLesion: boolean;
  /** Working length spans the whole lesion. */
  readonly coversLesion: boolean;
  readonly pressure: number;
}

/** Per-frame snapshot of what is true right now, built from the device/scene state. */
export interface ProcedureFacts {
  readonly guidePastElbow: boolean;
  readonly guideInAorta: boolean;
  readonly guideAtRoot: boolean;
  /** The tip faces the cusp of the ostium this case needs. */
  readonly guideFacingTargetCusp: boolean;
  readonly guideEngaged: boolean;
  /** Fluoro or cine is live (not last-image-hold). */
  readonly xrayActive: boolean;
  readonly injecting: InjectionKind;
  readonly projection: Projection;
  readonly heparinGiven: boolean;
  readonly wireOut: boolean;
  readonly wireVessel: VesselId | null;
  /** The wire tip is in the case's target vessel. */
  readonly wireInTarget: boolean;
  readonly wireCrossed: boolean;
  readonly wireForcing: boolean;
  readonly wireDistal: boolean;
  readonly catheter: CatheterFacts | null;
  readonly qcaMeasured: boolean;
  readonly stentDeployed: boolean;
  /** A valid FFR was taken before treatment (sensor beyond the lesion, hyperaemia). */
  readonly ffrMeasured: boolean;
  /** The operator decided not to treat the lesion after physiology. */
  readonly deferred: boolean;
}

export const DEFLATED_PRESSURE = 0.2;
export const PREDILATION_PRESSURE = 6;

export interface SubTask {
  readonly id: string;
  readonly label: string;
  /** `done` holds the ids already latched (any stage). */
  readonly check: (f: ProcedureFacts, done: ReadonlySet<string>, p: ProcedureProgress) => boolean;
}

export interface StageDef {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly why: string;
  readonly tasks: readonly SubTask[];
}

const angiogram = (f: ProcedureFacts) => f.guideEngaged && f.injecting === 'selective' && f.xrayActive;
const balloon = (f: ProcedureFacts) => (f.catheter?.kind === 'balloon' ? f.catheter : null);
const stentCath = (f: ProcedureFacts) => (f.catheter?.kind === 'stent' ? f.catheter : null);

/** Sub-task whose label is translated on read (it follows the current language). */
/** A side-specific variant of a text (`<key>.right`) wins when the case is on the right. */
function variant(key: string): string {
  const v = `${key}.${textContext().side}`;
  return hasKey(v) ? v : key;
}

function task(id: string, check: SubTask['check']): SubTask {
  return {
    id,
    get label() {
      return tk(variant(`task.${id}`));
    },
    check,
  };
}

/** Stage whose title, goal and teaching note are translated on read. */
function stage(id: string, tasks: readonly SubTask[]): StageDef {
  return {
    id,
    get title() {
      return tk(`stage.${id}.title`);
    },
    get goal() {
      return tk(variant(`stage.${id}.goal`));
    },
    get why() {
      return tk(`stage.${id}.why`);
    },
    tasks,
  };
}

export const STAGES: readonly StageDef[] = [
  stage('guide', [
    task('pastElbow', (f) => f.guidePastElbow),
    task('inAorta', (f) => f.guideInAorta),
    task('lookFluoro', (f) => f.guideInAorta && f.xrayActive),
    task('atRoot', (f) => f.guideAtRoot),
  ]),
  stage('engage', [
    task('faceCusp', (f) => f.guideAtRoot && f.guideFacingTargetCusp),
    task('seat', (f) => f.guideEngaged),
    task('angiogram', angiogram),
  ]),
  stage('cross', [
    task('heparin', (f) => f.heparinGiven),
    task('wireOut', (f) => f.wireOut),
    task('intoTarget', (f) => f.wireInTarget),
    task('crossGently', (f) => f.wireCrossed && !f.wireForcing),
    task('parkDistal', (f) => f.wireDistal),
  ]),
  // Only in cases that ask for physiology (see planFor).
  stage('physiology', [
    task('ffr', (f) => f.ffrMeasured),
    // Deciding means either deferring or loading a balloon to treat.
    task('decide', (f, done) => done.has('ffr') && (f.deferred || !!f.catheter)),
  ]),
  stage('predilate', [
    task('markers', (f) => !!balloon(f)?.overLesion),
    task('inflate', (f) => {
      const b = balloon(f);
      return !!b && b.overLesion && b.pressure >= PREDILATION_PRESSURE;
    }),
    task('deflate', (f, done) => done.has('inflate') && (balloon(f)?.pressure ?? 0) <= DEFLATED_PRESSURE),
  ]),
  stage('stent', [
    task('qcaLoaded', (f) => f.qcaMeasured && !!stentCath(f)),
    // A geographic miss is scored in the debrief; it must not block the case.
    task('cover', (f) => !!stentCath(f)?.coversLesion || (f.stentDeployed && !!stentCath(f)?.overLesion)),
    task('deploy', (f) => f.stentDeployed && (stentCath(f)?.pressure ?? 0) <= DEFLATED_PRESSURE),
  ]),
  stage('final', [
    task('injectAfter', (f) => f.stentDeployed && angiogram(f)),
    task('secondView', (_f, _d, p) => p.finalViews.length >= 2),
  ]),
];

/** The stages of a case: physiology after crossing only when the case asks for it. */
export function planFor(setup: { readonly ffr: boolean }): readonly StageDef[] {
  return STAGES.filter((s) => s.id !== 'physiology' || setup.ffr);
}

/** Stages a deferred case still needs: everything up to and including the decision. */
export function deferredPlan(plan: readonly StageDef[]): readonly StageDef[] {
  const i = plan.findIndex((s) => s.id === 'physiology');
  return i < 0 ? plan : plan.slice(0, i + 1);
}

export interface ProcedureProgress {
  /** The stages of this case, in order (shorter once a lesion is deferred). */
  readonly plan: readonly StageDef[];
  /** Index of the current stage; plan.length when the case is complete. */
  readonly stage: number;
  readonly done: ReadonlySet<string>;
  /** Completion time per stage (null while pending). */
  readonly completedAt: readonly (number | null)[];
  /** Distinct projections in which an angiogram was taken after stent deployment. */
  readonly finalViews: readonly Projection[];
}

export type ProgressEvent =
  | { readonly type: 'task'; readonly id: string; readonly stage: number }
  | { readonly type: 'stage'; readonly stage: number; readonly time: number }
  | { readonly type: 'complete'; readonly time: number };

export function initialProgress(plan: readonly StageDef[] = planFor({ ffr: false })): ProcedureProgress {
  return { plan, stage: 0, done: new Set(), completedAt: plan.map(() => null), finalViews: [] };
}

export function isComplete(p: ProcedureProgress): boolean {
  return p.stage >= p.plan.length;
}

export function projectionDistance(a: Projection, b: Projection): number {
  return Math.hypot(a.lao - b.lao, a.cranial - b.cranial);
}

/** Add the projection if it differs from all recorded ones by ≥ distinctViewDeg. */
export function addDistinctView(views: readonly Projection[], p: Projection): readonly Projection[] {
  return views.some((v) => projectionDistance(v, p) < C_ARM.distinctViewDeg) ? views : [...views, p];
}

/**
 * Latch the current stage's sub-tasks that are true now; when all are latched, record the
 * time and move on (repeatedly, since persistent facts may already satisfy the next stage).
 */
export function stepProgress(
  progress: ProcedureProgress,
  facts: ProcedureFacts,
  time: number,
): { progress: ProcedureProgress; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  const done = new Set(progress.done);
  let completedAt = [...progress.completedAt];
  let stage = progress.stage;
  let finalViews = progress.finalViews;
  let plan = progress.plan;

  if (facts.stentDeployed && angiogram(facts)) finalViews = addDistinctView(finalViews, facts.projection);

  while (stage < plan.length) {
    const def = plan[stage]!;
    const current: ProcedureProgress = { plan, stage, done, completedAt, finalViews };
    // Tasks are checked in order so a later task can depend on one latched this frame.
    for (const task of def.tasks) {
      if (!done.has(task.id) && task.check(facts, done, current)) {
        done.add(task.id);
        events.push({ type: 'task', id: task.id, stage });
      }
    }
    if (!def.tasks.every((t) => done.has(t.id))) break;
    completedAt[stage] = time;
    events.push({ type: 'stage', stage, time });
    // A deferred lesion is not treated: the case ends with the decision.
    if (def.id === 'physiology' && facts.deferred) {
      plan = deferredPlan(plan);
      completedAt = completedAt.slice(0, plan.length);
    }
    stage++;
    if (stage === plan.length) events.push({ type: 'complete', time });
  }

  return { progress: { plan, stage, done, completedAt, finalViews }, events };
}

/** Fraction of the current stage's sub-tasks latched (1 when the case is complete). */
export function stageProgressFraction(p: ProcedureProgress): number {
  const def = p.plan[p.stage];
  if (!def) return 1;
  return def.tasks.filter((t) => p.done.has(t.id)).length / def.tasks.length;
}

export function stageCompleted(p: ProcedureProgress, stageId: string): boolean {
  const i = p.plan.findIndex((s) => s.id === stageId);
  return i >= 0 && p.completedAt[i] !== null;
}

/** The stage being worked on now (undefined when the case is complete). */
export function currentStage(p: ProcedureProgress): StageDef | undefined {
  return p.plan[p.stage];
}

export function hasStage(p: ProcedureProgress, stageId: string): boolean {
  return p.plan.some((s) => s.id === stageId);
}
