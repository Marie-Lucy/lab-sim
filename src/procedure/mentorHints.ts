import { fmt, t } from '../i18n';
import { GUIDE } from '../config/anatomy';
import { lesionBounds } from '../anatomy/stenosis';
import { isWrongVessel, targetDeg } from '../cases/target';
import { cuspAngle, facingCusp, otherCusp } from '../physics/guide';
import { catheterSpec, inGuide } from '../physics/catheter';
import { pressureStatus } from '../physics/inflation';
import { angleDistDeg } from '../physics/speed';
import { wireTip } from '../physics/wire';
import { isActive } from './xray';
import type { Session } from './session';
import { FFR, IMAGING } from '../config/anatomy';
import { isSignificant } from '../physics/ffr';
import { currentStage } from './stages';

export interface MentorHint {
  readonly text: string;
  readonly level: 'info' | 'ok' | 'warn' | 'danger';
}

const hint = (text: string, level: MentorHint['level'] = 'info'): MentorHint => ({ text, level });

/** A calm, situation-specific next step for the learner. Safety issues come first. */
export function mentorHint(s: Session): MentorHint {
  const c = s.ctrl;
  const p = s.physiology;
  const cat = c.catheter;
  const inflated = !!cat && cat.pressure > 0.2 && !inGuide(cat);

  if (p.unstable) return hint(t('hint.unstable'), 'danger');
  if (inflated && p.occlusionS > 40) return hint(t('hint.longInflation'), 'warn');
  if (cat && pressureStatus(catheterSpec(cat), cat.pressure) === 'aboveRbp') return hint(t('hint.aboveRbp'), 'warn');
  if (c.wire.forcing) return hint(t('hint.forcing'), 'warn');
  if (c.treatment.dissections.some((d) => !d.sealed)) return hint(t('hint.dissection'), 'warn');

  const stage = currentStage(s.progress);
  if (!stage) return hint(t('hint.allDone'), 'ok');
  const done = s.progress.done;
  const g = c.guide;
  const route = c.guideRoute;

  switch (stage.id) {
    case 'guide':
      if (g.arc < route.elbowArc) return hint(t('hint.guide.start'));
      if (g.arc <= route.aortaEntryArc) return hint(t('hint.guide.arm'));
      if (!done.has('lookFluoro')) return hint(t('hint.guide.look'));
      return hint(t('hint.guide.down'));
    case 'engage':
      const cusp = s.tree.setup.cusp;
      if (!g.engaged && facingCusp(g.rotationDeg, otherCusp(cusp))) return hint(t('hint.engage.other'), 'warn');
      if (!g.engaged && angleDistDeg(g.rotationDeg, cuspAngle(cusp)) > GUIDE.engageToleranceDeg)
        return hint(t('hint.engage.rotate'));
      if (!g.engaged) return hint(t('hint.engage.seat'));
      if (!isActive(s.xray.mode)) return hint(t('hint.engage.inject'));
      return hint(t('hint.engage.watch'));
    case 'cross': {
      if (!c.heparinGiven) return hint(t('hint.cross.heparin'));
      if (!c.wire.out) return hint(t('hint.cross.wire'));
      const tip = wireTip(c.wire)!;
      if ((tip.vessel === 'd1' || tip.vessel === 'd2') && isWrongVessel(s.tree, tip.vessel)) return hint(t('hint.cross.diag'), 'warn');
      if (isWrongVessel(s.tree, tip.vessel)) return hint(t('hint.cross.wrongBranch'), 'warn');
      if (tip.vessel === 'lm' && angleDistDeg(c.wire.rotationDeg, targetDeg(s.tree.lesion.vessel)) > 60) return hint(t('hint.cross.rotate'));
      const { start, end } = lesionBounds(s.tree.lesion);
      const onTarget = tip.vessel === s.tree.lesion.vessel;
      if (onTarget && tip.arc < start && tip.arc > start - 10) return hint(t('hint.cross.approach'));
      if (onTarget && tip.arc >= start && tip.arc <= end) return hint(t('hint.cross.inLesion'));
      return hint(t('hint.cross.park'));
    }
    case 'physiology': {
      const r = s.decisionFfr;
      if (!r) {
        const tip = wireTip(c.wire);
        const beyond = tip && tip.vessel === s.tree.lesion.vessel ? tip.arc - lesionBounds(s.tree.lesion).end : -Infinity;
        return hint(t(beyond < FFR.sensorBeyondMm ? 'hint.phys.position' : 'hint.phys.measure'));
      }
      return hint(t(isSignificant(r.ffr) ? 'hint.phys.treat' : 'hint.phys.defer', { ffr: fmt(r.ffr, 2) }), 'info');
    }
    case 'predilate':
      if (c.treatment.calcified && !c.treatment.cracked && !cat?.nc) return hint(t('hint.predil.calcium'));
      if (!cat || cat.kind !== 'balloon') return hint(t('hint.predil.select'));
      if (inGuide(cat) && !done.has('markers')) return hint(t('hint.predil.size'));
      if (!done.has('markers')) return hint(t('hint.predil.markers'));
      if (!done.has('inflate')) return hint(t('hint.predil.inflate'));
      return hint(t('hint.predil.deflate'));
    case 'stent':
      if (!c.qcaMeasured) return hint(t('hint.stent.qca'));
      if (!cat || cat.kind !== 'stent') return hint(t('hint.stent.select'));
      if (inGuide(cat)) return hint(t('hint.stent.size'));
      if (!done.has('cover')) return hint(t('hint.stent.position'));
      if (!s.facts().stentDeployed) return hint(t('hint.stent.deploy'));
      return hint(t('hint.stent.deflate'));
    case 'final': {
      // Imaging after the last inflation: optimise before the final pictures.
      const last = c.log.inflations.reduce((m, i) => Math.max(m, i.start + i.duration), -Infinity);
      const post = [...s.imaging].reverse().find((p) => p.summary.msa && p.time >= last);
      if (post && post.summary.expansion !== null && post.summary.expansion < IMAGING.expansionGoal)
        return hint(t('hint.final.postdil', { exp: fmt(post.summary.expansion * 100, 0) }), 'warn');
      if (s.tree.setup.imaging && !post) return hint(t('hint.final.image'));
      if (!done.has('injectAfter')) return hint(t('hint.final.inject'));
      return hint(t('hint.final.second'));
    }
  }
  return hint(stage.goal);
}
