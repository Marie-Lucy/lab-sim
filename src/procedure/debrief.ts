import { fmt, t, tk } from '../i18n';
import { DEBRIEF, FFR, IMAGING } from '../config/anatomy';
import type { TimiGrade } from '../physics/flow';

/** The physiology decision of an FFR case. */
export interface PhysiologySummary {
  /** FFR the decision was based on (null if never measured validly). */
  readonly measured: number | null;
  /** FFR of the untreated lesion: what the right decision depends on. */
  readonly native: number;
  readonly deferred: boolean;
  /** A balloon or stent was used on the lesion. */
  readonly treated: boolean;
}

/** Stent optimisation by intravascular imaging after the last inflation. */
export interface OptimisationSummary {
  /** The case expects imaging (calcified lesion). */
  readonly expected: boolean;
  /** The last pullback after the final inflation, if any. */
  readonly result: {
    readonly modality: 'ivus' | 'oct';
    readonly msa: number;
    readonly expansion: number;
    readonly malapposition: number;
    readonly edges: boolean;
  } | null;
}

export interface CaseSummary {
  readonly stagesCompleted: number;
  /** Stages this case had (shorter when the lesion was deferred). */
  readonly stagesTotal: number;
  /** Only for cases decided by physiology. */
  readonly physiology: PhysiologySummary | null;
  /** Null when imaging was neither expected nor used after the stent. */
  readonly optimisation: OptimisationSummary | null;
  /** Final diameter stenosis at the lesion (0..1); null if never measured/treated. */
  readonly residualStenosis: number | null;
  readonly finalTimi: TimiGrade;
  readonly referenceDiameter: number;
  /** Expanded diameter of the main stent; null if no stent was deployed. */
  readonly stentDiameter: number | null;
  /** Margins of combined stent coverage beyond the lesion (mm); null if no stent. */
  readonly coverage: { readonly proximal: number; readonly distal: number } | null;
  readonly stentsDeployed: number;
  /** Stents this lesion needs (2 when it is longer than the longest stent plus margins). */
  readonly stentsNeeded: number;
  readonly heparinBeforeWire: boolean;
  readonly preDilated: boolean;
  readonly qcaUsed: boolean;
  readonly dissection: 'none' | 'sealed' | 'unsealed';
  /** Total time the wire was forced through the lesion. */
  readonly wireForcingS: number;
  readonly balloonRuptures: number;
  readonly longestInflationS: number;
  readonly contrastMl: number;
  readonly fluoroS: number;
  readonly finalViews: number;
}

export type ItemStatus = 'ok' | 'warn' | 'bad';
export type Grade = 'Excellent' | 'Good' | 'Acceptable' | 'Needs work' | 'Incomplete';

export interface DebriefItem {
  readonly id: keyof typeof DEBRIEF.weights;
  readonly label: string;
  readonly value: string;
  readonly status: ItemStatus;
  readonly teaching: string;
}

export interface Debrief {
  readonly score: number;
  readonly grade: Grade;
  readonly headline: string;
  readonly items: readonly DebriefItem[];
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const band = (x: number, ok: number, warn: number): ItemStatus => (x <= ok ? 'ok' : x <= warn ? 'warn' : 'bad');

function items(s: CaseSummary): DebriefItem[] {
  const D = DEBRIEF;
  const out: DebriefItem[] = [];
  const add = (id: DebriefItem['id'], value: string, status: ItemStatus) =>
    out.push({ id, label: tk(`item.${id}.label`), value, status, teaching: tk(`item.${id}.teaching`) });
  const ph = s.physiology;
  // A deferred lesion has no stent to judge: those items do not apply.
  const deferred = !!ph?.deferred;
  const na = (id: DebriefItem['id']) => add(id, t('val.na'), 'ok');

  if (ph) {
    const significant = ph.native <= FFR.cutoff;
    const right = ph.measured !== null && (significant ? ph.treated && !ph.deferred : ph.deferred && !ph.treated);
    const value =
      ph.measured === null
        ? t('val.ffrNone')
        : t(ph.deferred ? 'val.ffrDeferred' : ph.treated ? 'val.ffrTreated' : 'val.ffrUndecided', { ffr: fmt(ph.measured, 2) });
    add('physiology', value, right ? 'ok' : 'bad');
  }

  if (deferred) na('residual');
  else add(
    'residual',
    s.residualStenosis === null ? t('val.notTreated') : pct(s.residualStenosis),
    s.residualStenosis === null ? 'bad' : band(s.residualStenosis, D.maxResidualStenosis, D.warnResidualStenosis),
  );

  add(
    'timi',
    `TIMI ${s.finalTimi}`,
    s.finalTimi === 3 ? 'ok' : s.finalTimi === 2 ? 'warn' : 'bad',
  );

  const ratio = s.stentDiameter === null ? null : s.stentDiameter / s.referenceDiameter;
  if (deferred) na('stentSize');
  else add(
    'stentSize',
    ratio === null ? t('val.noStent') : t('val.ratio', { stent: fmt(s.stentDiameter!, 2), ref: fmt(s.referenceDiameter, 2), ratio: fmt(ratio, 2) }),
    ratio === null
      ? 'bad'
      : ratio >= D.stentRatioMin && ratio <= D.stentRatioMax
        ? 'ok'
        : ratio >= D.warnStentRatioMin && ratio <= D.warnStentRatioMax
          ? 'warn'
          : 'bad',
  );

  const c = s.coverage;
  const miss = c !== null && (c.proximal < 0 || c.distal < 0);
  if (deferred) na('coverage');
  else add(
    'coverage',
    c === null ? t('val.noStent') : t(miss ? 'val.miss' : 'val.margins', { p: fmt(c.proximal, 1), d: fmt(c.distal, 1) }),
    c === null || miss ? 'bad' : Math.min(c.proximal, c.distal) >= D.minCoverageMargin ? 'ok' : 'warn',
  );

  if (deferred) na('extraStents');
  else add(
    'extraStents',
    t('val.stents', { n: s.stentsDeployed, needed: s.stentsNeeded }),
    s.stentsDeployed === 0 ? 'bad' : s.stentsDeployed <= s.stentsNeeded ? 'ok' : s.stentsDeployed === s.stentsNeeded + 1 ? 'warn' : 'bad',
  );

  add(
    'heparin',
    t(s.heparinBeforeWire ? 'val.yes' : 'val.no'),
    s.heparinBeforeWire ? 'ok' : 'bad',
  );

  if (deferred) na('predilation');
  else add(
    'predilation',
    t(s.preDilated ? 'val.done' : 'val.skipped'),
    s.preDilated ? 'ok' : 'warn',
  );

  if (deferred) na('qca');
  else add(
    'qca',
    t(s.qcaUsed ? 'val.yes' : 'val.no'),
    s.qcaUsed ? 'ok' : 'warn',
  );

  add(
    'dissection',
    t(s.dissection === 'none' ? 'val.none' : s.dissection === 'sealed' ? 'val.sealed' : 'val.unsealed'),
    s.dissection === 'none' ? 'ok' : s.dissection === 'sealed' ? 'warn' : 'bad',
  );

  add(
    'wireForcing',
    `${fmt(s.wireForcingS, 1)} s`,
    s.wireForcingS <= 0 ? 'ok' : s.wireForcingS <= D.warnWireForcingS ? 'warn' : 'bad',
  );

  add(
    'rupture',
    String(s.balloonRuptures),
    s.balloonRuptures === 0 ? 'ok' : 'bad',
  );

  if (deferred) na('inflation');
  else add(
    'inflation',
    `${s.longestInflationS.toFixed(0)} s`,
    band(s.longestInflationS, D.maxInflationS, D.warnInflationS),
  );

  add(
    'contrast',
    `${s.contrastMl.toFixed(0)} ml`,
    band(s.contrastMl, D.maxContrastMl, D.warnContrastMl),
  );

  const o = s.optimisation;
  if (o && !deferred) {
    const r = o.result;
    if (!r) add('optimisation', t('val.notImaged'), 'warn');
    else {
      const fails = [r.expansion < IMAGING.expansionGoal, r.malapposition >= IMAGING.malappositionMm, !r.edges].filter(Boolean).length;
      add(
        'optimisation',
        t('val.optimisation', { name: r.modality === 'ivus' ? 'IVUS' : 'OCT', msa: fmt(r.msa, 1), exp: fmt(r.expansion * 100, 0), mal: fmt(r.malapposition, 2) }),
        r.expansion < IMAGING.expansionBad ? 'bad' : fails === 0 ? 'ok' : 'warn',
      );
    }
  }

  const min = Math.floor(s.fluoroS / 60);
  const sec = Math.round(s.fluoroS % 60);
  add(
    'fluoro',
    `${min}:${String(sec).padStart(2, '0')}`,
    band(s.fluoroS, D.maxFluoroS, D.warnFluoroS),
  );

  if (deferred) na('views');
  else add(
    'views',
    String(s.finalViews),
    s.finalViews >= D.minFinalViews ? 'ok' : s.finalViews === 1 ? 'warn' : 'bad',
  );

  return out;
}

/** Display name of a grade in the current language (the Grade value itself stays stable). */
export function gradeLabel(g: Grade): string {
  return tk(`grade.${g}`);
}

export function gradeFor(score: number, complete: boolean): Grade {
  if (!complete) return 'Incomplete';
  const g = DEBRIEF.grades;
  if (score >= g.excellent) return 'Excellent';
  if (score >= g.good) return 'Good';
  if (score >= g.acceptable) return 'Acceptable';
  return 'Needs work';
}

export function buildDebrief(summary: CaseSummary): Debrief {
  const list = items(summary);
  const lost = list.reduce((sum, it) => {
    const w = DEBRIEF.weights[it.id];
    return sum + (it.status === 'bad' ? w : it.status === 'warn' ? w / 2 : 0);
  }, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - lost)));
  const grade = gradeFor(score, summary.stagesCompleted >= summary.stagesTotal);
  // In physiology cases the decision frames the result, not the stent.
  const phys = list.find((i) => i.id === 'physiology');
  const headline =
    phys?.status === 'bad' && grade !== 'Incomplete'
      ? t('headline.physWrong')
      : summary.physiology?.deferred && grade !== 'Incomplete'
        ? t('headline.deferRight')
        : tk(`headline.${grade}`);
  return { score, grade, headline, items: list };
}
