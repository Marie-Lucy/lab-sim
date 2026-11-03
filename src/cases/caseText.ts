import { fmt, t, tk } from '../i18n';
import { seedCode, type CaseInstance } from './cases';

/** Values quoted in a case's vignette and lesion label. */
export function caseParams(c: CaseInstance): Record<string, string | number> {
  const len = c.lesion.length;
  return {
    age: c.patient.age,
    weight: c.patient.weightKg,
    pct: Math.round(c.lesion.severity * 100),
    len: fmt(len, len % 1 ? 1 : 0),
  };
}

export function caseTitle(caseId: string): string {
  return tk(`case.${caseId}.title`);
}

export function caseVignette(c: CaseInstance): string {
  return tk(`case.${c.caseId}.vignette`, caseParams(c));
}

/** "Variant K3F" for random cases, "Reference case" for fixed ones. */
export function variantLabel(c: Pick<CaseInstance, 'seed'>): string {
  return c.seed ? t('start.variant', { code: seedCode(c.seed) }) : t('start.refCase');
}

/** One line for the debrief and pause screens. */
export function caseLine(c: CaseInstance): string {
  return t('db.case', { title: caseTitle(c.caseId), variant: c.seed ? seedCode(c.seed) : t('db.refVariant') });
}
