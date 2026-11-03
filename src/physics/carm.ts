import { t } from '../i18n';
import { C_ARM } from '../config/anatomy';
import type { Projection } from '../anatomy/types';
import { normalize, type Vec3 } from '../anatomy/vec';

const DEG = Math.PI / 180;

/**
 * Unit vector from the isocentre toward the image detector. AP = anterior (+z); LAO swings
 * the detector toward the patient's left (+x), cranial toward the head (+y).
 */
export function carmDirection(p: Projection): Vec3 {
  const a = p.lao * DEG;
  const c = p.cranial * DEG;
  return normalize([Math.sin(a) * Math.cos(c), Math.sin(c), Math.cos(a) * Math.cos(c)]);
}

export function projectionName(p: Projection): string {
  const lao = Math.round(p.lao);
  const cra = Math.round(p.cranial);
  // RAO/LAO are OAD/OAI in Spanish and OAD/OAE in Portuguese.
  const side = lao === 0 ? t('proj.ap') : `${t(lao > 0 ? 'proj.lao' : 'proj.rao')} ${Math.abs(lao)}`;
  return cra === 0 ? side : `${side} ${t(cra > 0 ? 'proj.cra' : 'proj.cau')} ${Math.abs(cra)}`;
}

export function presetAt(index: number): { index: number; projection: Projection; name: string } {
  const n = C_ARM.presets.length;
  const i = ((index % n) + n) % n;
  const p = C_ARM.presets[i]!;
  return { index: i, projection: { lao: p.lao, cranial: p.cranial }, name: p.name };
}

/** Fine-tune by whole steps, clamped to the C-arm limits. */
export function nudge(p: Projection, dLao: number, dCranial: number): Projection {
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v));
  return {
    lao: clamp(p.lao + dLao * C_ARM.fineStepDeg, C_ARM.laoLimitDeg),
    cranial: clamp(p.cranial + dCranial * C_ARM.fineStepDeg, C_ARM.cranialLimitDeg),
  };
}
