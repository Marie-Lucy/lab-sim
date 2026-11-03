import { describe, expect, it } from 'vitest';
import { LESION, STENT } from '../src/config/anatomy';
import { diameterStenosis, lesionBounds } from '../src/anatomy/stenosis';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import {
  CASES,
  caseDef,
  caseFromQuery,
  caseQuery,
  CLASSIC_LESION,
  instantiateCase,
  parseSeedCode,
  seedCode,
} from '../src/cases/cases';
import { caseVignette, variantLabel } from '../src/cases/caseText';
import { mentorHint } from '../src/procedure/mentorHints';
import { isComplete, STAGES } from '../src/procedure/stages';
import { isSignificant } from '../src/physics/ffr';
import { stentsNeeded } from '../src/procedure/summary';
import { setLanguage, textContext } from '../src/i18n';
import { buildDebrief } from '../src/procedure/debrief';
import { buildSummary } from '../src/procedure/summary';
import { measureQca } from '../src/procedure/qca';
import { CaseRunner } from './caseRunner';

const SEEDS = [11, 4242, 90001, 777777];

describe('case library', () => {
  it('the classic case is the original fixed lesion', () => {
    expect(CLASSIC_LESION).toEqual({ vessel: 'lad', centreArc: LESION.centreArc, length: LESION.length, severity: LESION.severity, plateau: LESION.plateau });
    expect(instantiateCase(caseDef('classic'), 123)).toEqual(instantiateCase(caseDef('classic'), 9));
  });

  it('the same case and seed always give the same patient; different seeds differ', () => {
    const d = caseDef('midLad');
    expect(instantiateCase(d, 4242)).toEqual(instantiateCase(d, 4242));
    const variants = new Set(SEEDS.map((s) => JSON.stringify(instantiateCase(d, s).lesion)));
    expect(variants.size).toBe(SEEDS.length);
  });

  for (const def of CASES.filter((c) => c.randomized)) {
    it(`${def.id}: every variant stays inside its ranges and window`, () => {
      for (let seed = 1; seed < 400; seed += 7) {
        const c = instantiateCase(def, seed);
        const l = c.lesion;
        const { start, end } = lesionBounds(l);
        expect(l.length).toBeGreaterThanOrEqual(def.lesion.length.min - 0.25);
        expect(l.length).toBeLessThanOrEqual(def.lesion.length.max + 0.25);
        expect(l.severity).toBeGreaterThanOrEqual(def.lesion.severity.min - 0.005);
        expect(l.severity).toBeLessThanOrEqual(def.lesion.severity.max + 0.005);
        expect(l.plateau).toBeLessThanOrEqual(l.length / 2);
        expect(start).toBeGreaterThanOrEqual(def.lesion.window.min - 0.25);
        expect(end).toBeLessThanOrEqual(def.lesion.window.max + 0.25);
        expect(c.patient.age).toBeGreaterThanOrEqual(def.patient.age.min);
        expect(c.patient.age).toBeLessThanOrEqual(def.patient.age.max);
      }
    });
  }

  it('shares a case as a short link and reads it back', () => {
    expect(parseSeedCode(seedCode(4242))).toBe(4242);
    expect(seedCode(4242)).toBe('39U');
    const c = instantiateCase(caseDef('longLad'), 4242);
    expect(caseQuery(c)).toBe('?case=longLad&seed=39U');
    expect(caseFromQuery(caseQuery(c))).toEqual({ caseId: 'longLad', seed: 4242 });
    expect(caseFromQuery('?case=classic')).toEqual({ caseId: 'classic', seed: 0 });
    expect(caseFromQuery('?case=nope&seed=1')).toBeNull();
    expect(caseFromQuery('')).toBeNull();
  });

  it('builds the patient with the lesion where the case puts it, and QCA finds it', () => {
    const c = instantiateCase(caseDef('midLad'), 90001);
    const tree = buildVesselTree(c.lesion);
    expect(tree.lesion).toEqual(c.lesion);
    const lumen = tree.vessels.lad.lumen;
    expect(diameterStenosis(lumen.diameterAt(c.lesion.centreArc), lumen.referenceAt(c.lesion.centreArc))).toBeCloseTo(c.lesion.severity, 2);
    const q = measureQca(lumen, c.lesion);
    expect(q.ds).toBeCloseTo(c.lesion.severity, 1);
    expect(q.mldArc).toBeGreaterThan(lesionBounds(c.lesion).start);
    expect(q.mldArc).toBeLessThan(lesionBounds(c.lesion).end);
    expect(q.lesionLength).toBeLessThanOrEqual(c.lesion.length);
    expect(q.lesionLength).toBeGreaterThan(c.lesion.length * 0.75);
  });

  it('the critical case starts with slow flow and the patient becomes ischaemic at rest', () => {
    const r = new CaseRunner(1, instantiateCase(caseDef('criticalLad'), 11).lesion);
    expect(r.s.ctrl.flow.timi).toBeLessThanOrEqual(2);
    r.wait(30);
    expect(r.s.physiology.stMm).toBeGreaterThan(0.5);
  });

  it('texts: vignette quotes the variant, label names the variant', () => {
    const c = instantiateCase(caseDef('longLad'), 4242);
    expect(caseVignette(c)).toContain(`${Math.round(c.lesion.severity * 100)}%`);
    expect(variantLabel(c)).toBe('Variant 39U');
    setLanguage('es');
    expect(variantLabel(instantiateCase(caseDef('classic'), 0))).toBe('Caso de referencia');
    setLanguage('en');
  });
});

/** QCA-guided operator: size from the measurement, centre on the lesion, 12 atm; two overlapping stents when needed. */
function playWell(seed: number, caseId: string) {
  const inst = instantiateCase(caseDef(caseId), seed);
  const r = new CaseRunner(seed, inst.lesion, inst.setup);
  const s = r.s;
  r.engageAndAngiogram();
  r.crossGently();
  if (inst.setup.ffr) {
    r.tool('ffr');
    r.step();
    if (!isSignificant(s.decisionFfr!.ffr)) {
      expect(s.defer().ok).toBe(true);
      r.step();
      return { s, debrief: buildDebrief(buildSummary(s)) };
    }
  }
  r.tool('balloon');
  // Calcium: prepare with a non-compliant balloon at high pressure to fracture it.
  if (inst.lesion.calcium) s.setBalloonType(true);
  s.ctrl.setCatheterSize(2.5, 15);
  r.position(0.5);
  r.inflate(inst.lesion.calcium ? 18 : 10, 12);
  r.withdraw();
  r.tool('measure');
  const q = s.qca!;
  const diameter = [...STENT.diameters].reduce((a, b) => (Math.abs(b * 1.024 - q.referenceDiameter * 1.04) < Math.abs(a * 1.024 - q.referenceDiameter * 1.04) ? b : a));
  const len = inst.lesion.length;
  const deploy = (length: number, distalBeyond: number) => {
    r.tool('stent');
    s.ctrl.setCatheterSize(diameter, length);
    r.position(distalBeyond);
    r.inflate(12, 3);
    r.withdraw();
  };
  if (stentsNeeded(len) === 1) {
    const length = STENT.lengths.find((l) => l >= q.lesionLength + 5) ?? STENT.lengths[STENT.lengths.length - 1]!;
    deploy(length, (length - len) / 2);
  } else {
    // Distal stent first, then a proximal one overlapping it by ≥ 2 mm; 2 mm margins outside.
    const each = STENT.lengths.find((l) => 2 * l >= len + 6)!;
    deploy(each, 2);
    deploy(each, each - len - 2);
  }
  if (inst.setup.imaging) s.pullback('ivus');
  r.finalViews();
  return { s, debrief: buildDebrief(buildSummary(s)) };
}

describe('every variant can be solved', () => {
  for (const id of ['midLad', 'criticalLad', 'midLcx', 'longLad', 'midRca', 'intermediateLad', 'calcifiedLad']) {
    for (const seed of SEEDS) {
      it(`${id} #${seedCode(seed)}: careful QCA-guided case is Excellent`, () => {
        const { s, debrief } = playWell(seed, id);
        expect(isComplete(s.progress)).toBe(true);
        expect(debrief.items.filter((i) => i.status !== 'ok').map((i) => `${i.id}: ${i.value}`)).toEqual([]);
        expect(debrief.grade).toBe('Excellent');
      });
    }
  }

  it('a lesion longer than the longest stent needs two; one more is "warn"', () => {
    expect(stentsNeeded(14)).toBe(1);
    expect(stentsNeeded(25)).toBe(1);
    expect(stentsNeeded(25.5)).toBe(2);
  });
});

describe('a circumflex case', () => {
  const inst = instantiateCase(caseDef('midLcx'), 4242);

  it('targets the LCx with lead V5 and the wire tip pointing at the LAD', () => {
    expect(inst.lesion.vessel).toBe('lcx');
    expect(inst.setup.ecgLead).toBe('V5');
    const r = new CaseRunner(3, inst.lesion, inst.setup);
    expect(r.s.ctrl.wire.rotationDeg).toBe(20);
    expect(STAGES[2]!.title).toBe('Cross the LCx lesion');
    expect(STAGES[2]!.tasks.find((t) => t.id === 'intoTarget')!.label).toBe('Into the LCx, not the LAD');
    expect(textContext().lead).toBe('V5');
    setLanguage('es');
    expect(STAGES[2]!.title).toBe('Cruzar la lesión de la Cx');
    setLanguage('pt');
    expect(STAGES[2]!.title).toBe('Cruzar a lesão da Cx');
    setLanguage('en');
  });

  it('an unsteered wire goes into the LAD: wrong-branch message and hint', () => {
    const r = new CaseRunner(3, inst.lesion, inst.setup);
    r.engageAndAngiogram();
    r.s.heparin();
    r.tool('wire');
    r.until({ advance: 1, fine: true }, () => r.s.ctrl.wire.chain.includes('lad'));
    expect(r.log).toContain('Wire went into the LAD. Pull back and rotate toward the LCx.');
    expect(mentorHint(r.s).text).toBe('The wire went into the LAD. Pull back (S) into the left main, rotate toward 180° and advance again.');
    expect(r.s.progress.done.has('intoTarget')).toBe(false);
  });

  it('occluding the LCx raises ST; the LAD stays perfused', () => {
    const r = new CaseRunner(3, inst.lesion, inst.setup);
    r.engageAndAngiogram();
    r.crossGently();
    r.tool('balloon');
    r.s.ctrl.setCatheterSize(2.5, 15);
    r.position(0.5);
    r.until({ inflate: true }, () => r.s.ctrl.catheter!.pressure >= 8);
    r.wait(10);
    expect(r.s.ctrl.flow.distalTarget).toBe(0);
    expect(r.s.ctrl.flow.factor.lad[300]).toBe(1);
    expect(r.s.physiology.stMm).toBeGreaterThan(1);
  });
});

describe('a right coronary case', () => {
  const inst = instantiateCase(caseDef('midRca'), 4242);

  it('engages the right cusp only, with right-side texts and lead II', () => {
    expect(inst.lesion.vessel).toBe('rca');
    const r = new CaseRunner(3, inst.lesion, inst.setup);
    expect(STAGES[1]!.title).toBe('Engage the right coronary artery');
    expect(STAGES[1]!.tasks.map((x) => x.label)).toEqual(['Face the right coronary cusp', 'Seat the guide in the RCA ostium', 'Diagnostic angiogram']);
    expect(STAGES[2]!.goal).toBe('Anticoagulate, then advance the 0.014" wire down the RCA and cross the lesion gently.');
    expect(STAGES[2]!.tasks.find((x) => x.id === 'intoTarget')!.label).toBe('Wire in the RCA');
    expect(textContext().lead).toBe('II');
    setLanguage('es');
    expect(STAGES[1]!.title).toBe('Canular la coronaria derecha');
    expect(STAGES[2]!.tasks.find((x) => x.id === 'intoTarget')!.label).toBe('Alambre en la CD');
    setLanguage('pt');
    expect(STAGES[1]!.title).toBe('Cateterizar a coronária direita');
    setLanguage('en');

    // Facing the left cusp and pushing does not engage; it says which cusp to face.
    const c = r.s.ctrl;
    r.tool('guide');
    r.until({ advance: 1 }, () => c.guide.arc >= c.guideRoute.rootArc - 0.5);
    r.step({}, true); // fluoro look: stage 1 done
    r.until({ rotate: -1, fine: true }, () => Math.abs(c.guide.rotationDeg) < 3);
    r.run({ advance: 1, fine: true }, 0.5);
    expect(c.guide.engaged).toBe(false);
    expect(r.log).toContain('The tip faces the left coronary cusp. Rotate toward the right coronary cusp.');
    expect(mentorHint(r.s).text).toBe('The tip faces the left coronary cusp. Rotate back toward the right coronary cusp (dial at 120°).');
  });

  it('the wire goes straight into the RCA; a selective injection fills the right system', () => {
    const r = new CaseRunner(3, inst.lesion, inst.setup);
    r.engageAndAngiogram();
    expect(r.s.injection!.plan.intensity.rca).toBe(1);
    expect(r.s.injection!.plan.intensity.lad).toBe(0);
    expect(r.log).toContain('Guide engaged in the RCA ostium. Take a diagnostic angiogram.');
    r.s.heparin();
    r.tool('wire');
    r.until({ advance: 1, fine: true }, () => r.s.ctrl.wire.out && r.s.ctrl.wire.tipArc > 3);
    expect(r.s.ctrl.wire.chain).toEqual(['rca']);
    expect(r.s.facts().wireInTarget).toBe(true);
    expect(r.s.ctrl.guideLocation()).toBe('RCA ostium');
  });
});
