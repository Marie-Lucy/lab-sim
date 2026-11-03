import { t, tk } from '../i18n';
import type { ProcedureFacts, ProcedureProgress } from '../procedure/stages';
import { currentStage, hasStage, stageCompleted } from '../procedure/stages';

export type ToolId = 'guide' | 'wire' | 'balloon' | 'stent' | 'contrast' | 'fluoro' | 'measure' | 'ffr' | 'imaging';

export interface ToolDef {
  readonly id: ToolId;
  /** Keyboard shortcut 1–9. */
  readonly key: string;
  readonly label: string;
  readonly rules: string;
}

function tool(id: ToolId, key: string): ToolDef {
  return {
    id,
    key,
    get label() {
      return tk(`tool.${id}.label`);
    },
    get rules() {
      return tk(`tool.${id}.rules`);
    },
  };
}

export const TOOLS: readonly ToolDef[] = [
  tool('guide', '1'),
  tool('wire', '2'),
  tool('balloon', '3'),
  tool('stent', '4'),
  tool('contrast', '5'),
  tool('fluoro', '6'),
  tool('measure', '7'),
  tool('ffr', '8'),
  tool('imaging', '9'),
];

export type Availability = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: Availability = { ok: true };
const no = (reason: string): Availability => ({ ok: false, reason });

/** Whether a tool can be selected now, with the reason when it cannot. */
export function toolAvailability(tool: ToolId, f: ProcedureFacts, p: ProcedureProgress): Availability {
  switch (tool) {
    case 'guide':
    case 'fluoro':
      return OK;
    case 'contrast':
      return f.guideInAorta ? OK : no(t('lock.contrast'));
    case 'measure':
      return p.done.has('angiogram') ? OK : no(t('lock.measure'));
    case 'wire':
      if (!f.guideEngaged && !f.wireOut) return no(t('lock.wireEngage'));
      if (!p.done.has('angiogram')) return no(t('lock.wireAngio'));
      if (!f.heparinGiven) return no(t('lock.wireHeparin'));
      return OK;
    case 'ffr':
      if (!f.wireInTarget) return no(t('lock.ffrWire'));
      if (f.catheter?.inCoronary && f.catheter.pressure > 0.2) return no(t('lock.ffrDeflate'));
      return OK;
    case 'imaging':
      if (!f.wireDistal) return no(t('lock.imagingWire'));
      if (f.catheter?.inCoronary) return no(t('lock.imagingCatheter'));
      return OK;
    case 'balloon':
      if (!f.wireDistal) return no(t('lock.balloonWire'));
      if (hasStage(p, 'physiology') && !p.done.has('ffr')) return no(t('lock.balloonFfr'));
      if (f.deferred) return no(t('lock.deferred'));
      if (f.catheter?.kind === 'stent' && f.catheter.inCoronary) return no(t('lock.balloonStentOut'));
      return OK;
    case 'stent':
      if (f.deferred) return no(t('lock.deferred'));
      if (!stageCompleted(p, 'predilate')) return no(t('lock.stentPredil'));
      if (!f.wireDistal) return no(t('lock.stentWire'));
      if (f.catheter?.kind === 'balloon' && f.catheter.inCoronary) return no(t('lock.stentBalloonOut'));
      return OK;
  }
}

/** Deferring is offered once the FFR is known, while no balloon or stent has been used. */
export function deferAvailability(f: ProcedureFacts, p: ProcedureProgress): Availability {
  if (currentStage(p)?.id !== 'physiology') return no(t('lock.deferStage'));
  if (!p.done.has('ffr')) return no(t('lock.balloonFfr'));
  if (f.catheter?.inCoronary) return no(t('lock.deferCatheter'));
  return OK;
}

export function toolByKey(key: string): ToolDef | undefined {
  return TOOLS.find((t) => t.key === key);
}
