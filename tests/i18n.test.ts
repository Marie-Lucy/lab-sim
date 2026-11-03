import { afterEach, describe, expect, it } from 'vitest';
import en from '../src/i18n/en';
import { DICTIONARIES, detectLanguage, fmt, hasKey, LANGS, setLanguage, t, tk, type Lang } from '../src/i18n';
import { LABELS } from '../src/anatomy/labels';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { projectionName } from '../src/physics/carm';
import { buildDebrief, gradeLabel } from '../src/procedure/debrief';
import { DEMO_STEPS } from '../src/procedure/demo';
import { mentorHint } from '../src/procedure/mentorHints';
import { STAGES } from '../src/procedure/stages';
import { buildSummary } from '../src/procedure/summary';
import { TOOLS, toolAvailability } from '../src/tools/tools';
import { CaseRunner } from './caseRunner';

const KEYS = Object.keys(en) as (keyof typeof en)[];
const OTHERS: Lang[] = ['es', 'pt'];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Strings that are legitimately the same in every language (acronyms, codes, brand). */
const SAME_EVERYWHERE = new Set([
  'hud.lih', 'hud.cine', 'hud.fluoro', 'demo.badge', 'mentor.badge', 'tool.stent.label', 'dial.lcx', 'dev.rbp',
  'dev.prox', 'dev.dist', 'dev.stentLbl', 'dev.qca', 'mon.title', 'mon.spo2', 'mon.st', 'fo.lih', 'fo.cine', 'fo.fluoro',
  'fo.fl', 'proj.ap', 'proj.cra', 'proj.cau', 'help.r1.k', 'help.r3.k', 'help.r5.k', 'help.r8.k', 'help.r10.k',
  'help.r11.k', 'help.r12.k', 'help.r13.k', 'val.ratio', 'val.no', 'loc.wire', 'vessel.aorta', 'vessel.d1', 'vessel.d2',
  'label.d1', 'label.d2', 'replay.of', 'tool.ffr.label', 'tool.imaging.label', 'img.ivus', 'img.oct', 'img.stent', 'img.pbShort', 'dev.type',
]);

afterEach(() => setLanguage('en'));

describe('dictionaries', () => {
  it('offer Spanish, Portuguese and English, with the Latin American locales', () => {
    expect(LANGS.map((l) => l.locale)).toEqual(['es-419', 'pt-BR', 'en-US']);
  });

  for (const lang of OTHERS) {
    describe(lang, () => {
      const d = DICTIONARIES[lang];
      it('has exactly the English keys, none empty', () => {
        expect(Object.keys(d).sort()).toEqual([...KEYS].sort());
        for (const k of KEYS) expect(d[k].trim().length, k).toBeGreaterThan(0);
      });

      it('keeps every {placeholder} of the English text', () => {
        for (const k of KEYS) expect(placeholders(d[k]), k).toEqual(placeholders(en[k]));
      });

      it('translates everything except acronyms and codes', () => {
        const same = KEYS.filter((k) => d[k] === en[k] && !SAME_EVERYWHERE.has(k));
        expect(same).toEqual([]);
      });

      it('has no English words or English vessel/projection abbreviations left', () => {
        const leftovers = /\b(the|and|with|wire|guide|balloon|deflate|inflate|LAD|LCx|RCA|LAO|RAO|left main)\b/;
        const bad = KEYS.filter((k) => leftovers.test(d[k]));
        expect(bad).toEqual([]);
      });

      it('keeps the only HTML (the disclaimer) well formed', () => {
        for (const k of KEYS) if (k !== 'start.disclaimer') expect(d[k], k).not.toMatch(/<\w/);
        expect(d['start.disclaimer']).toMatch(/<b>[^<]+<\/b>/);
      });
    });
  }

  it('every runtime key used by stages, tools, labels, demo, debrief and locations exists', () => {
    const dynamic = [
      ...STAGES.flatMap((s) => [`stage.${s.id}.title`, `stage.${s.id}.goal`, `stage.${s.id}.why`, ...s.tasks.map((x) => `task.${x.id}`)]),
      ...TOOLS.flatMap((x) => [`tool.${x.id}.label`, `tool.${x.id}.rules`]),
      ...LABELS.flatMap((l) => [`label.${l.id}`, `label.${l.id}.desc`]),
      ...Object.keys(buildVesselTree().vessels).map((v) => `vessel.${v}`),
      ...buildVesselTree().accessSegments.map((s) => `loc.${s.name}`),
      ...['Excellent', 'Good', 'Acceptable', 'Needs work', 'Incomplete'].flatMap((g) => [`grade.${g}`, `headline.${g}`]),
      ...DEMO_STEPS.map((s) => s.say),
    ];
    expect(dynamic.filter((k) => !hasKey(k))).toEqual([]);
  });
});

describe('language switching', () => {
  it('detects the saved or browser language, falling back to English', () => {
    expect(detectLanguage(null, ['pt-BR', 'en'])).toBe('pt');
    expect(detectLanguage(null, ['es-MX'])).toBe('es');
    expect(detectLanguage('es', ['pt-BR'])).toBe('es');
    expect(detectLanguage(null, ['fr-FR', 'de'])).toBe('en');
  });

  it('formats decimals per locale (pt-BR uses a comma)', () => {
    setLanguage('pt');
    expect(fmt(2.5, 1)).toBe('2,5');
    setLanguage('es');
    expect(fmt(2.5, 1)).toBe('2.5');
    setLanguage('en');
    expect(fmt(12, 0)).toBe('12');
  });

  it('uses cath-lab projection names per language', () => {
    const p = { lao: -30, cranial: 30 };
    expect(projectionName(p)).toBe('RAO 30 CRA 30');
    setLanguage('es');
    expect(projectionName(p)).toBe('OAD 30 CRA 30');
    expect(projectionName({ lao: 45, cranial: -30 })).toBe('OAI 45 CAU 30');
    setLanguage('pt');
    expect(projectionName(p)).toBe('OAD 30 CRAN 30');
    expect(projectionName({ lao: 45, cranial: -30 })).toBe('OAE 45 CAUD 30');
  });

  it('stage, tool and label texts follow the current language without rebuilding', () => {
    setLanguage('es');
    expect(STAGES[1]!.title).toBe('Canular el tronco común izquierdo');
    expect(TOOLS[2]!.label).toBe('Balón');
    setLanguage('pt');
    expect(STAGES[1]!.title).toBe('Cateterizar o tronco da coronária esquerda');
    expect(TOOLS[2]!.label).toBe('Balão');
    expect(tk('vessel.lad')).toBe('DA');
  });

  it('interpolates parameters', () => {
    setLanguage('es');
    expect(t('msg.stepDone', { n: 3 })).toBe('Paso 3 completado.');
    setLanguage('pt');
    expect(t('msg.wire.diag', { branch: 'D1' })).toBe('O fio-guia entrou na D1. Recue e gire para afastá-lo da diagonal.');
  });
});

describe('a case played in Spanish and Portuguese', () => {
  it('Spanish: lock reasons, mentor, messages and debrief are in Spanish', () => {
    setLanguage('es');
    const r = new CaseRunner();
    const a = toolAvailability('wire', r.s.facts(), r.s.progress);
    expect(a.ok === false && a.reason).toBe('Primero canula el tronco común izquierdo con el catéter guía.');
    r.engageAndAngiogram();
    expect(r.log).toContain('Catéter guía canulado en el ostium del TCI. Haz una angiografía diagnóstica.');
    expect(mentorHint(r.s).text).toMatch(/heparina/);
    const d = buildDebrief(buildSummary(r.s));
    expect(gradeLabel(d.grade)).toBe('Incompleto');
    expect(d.headline).toMatch(/^Caso incompleto/);
    expect(d.items.find((i) => i.id === 'heparin')!.label).toBe('Heparina antes del alambre');
    expect(r.s.ctrl.guideLocation()).toBe('ostium del TCI');
  });

  it('Portuguese: debrief values use the decimal comma', () => {
    setLanguage('pt');
    const d = buildDebrief({
      stagesCompleted: 6,
  stagesTotal: 6,
  physiology: null,
  optimisation: null,
      residualStenosis: 0.02,
      finalTimi: 3,
      referenceDiameter: 2.95,
      stentDiameter: 3.07,
      coverage: { proximal: 2, distal: -1 },
      stentsDeployed: 1,
      stentsNeeded: 1,
      heparinBeforeWire: true,
      preDilated: true,
      qcaUsed: true,
      dissection: 'sealed',
      wireForcingS: 0,
      balloonRuptures: 0,
      longestInflationS: 12,
      contrastMl: 24,
      fluoroS: 120,
      finalViews: 2,
    });
    const v = Object.fromEntries(d.items.map((i) => [i.id, i.value]));
    expect(v.stentSize).toBe('3,07 / 2,95 mm (×1,04)');
    expect(v.coverage).toBe('perda geográfica (2,0 / -1,0 mm)');
    expect(v.dissection).toBe('selada');
    expect(v.heparin).toBe('sim');
  });
});
