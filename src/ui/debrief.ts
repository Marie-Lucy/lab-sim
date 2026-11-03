import { caseLine } from '../cases/caseText';
import { t, tk } from '../i18n';
import type { PlayMode } from '../exam/exam';
import { mmss } from './dom';
import { gradeLabel, type Debrief } from '../procedure/debrief';
import type { UiContext } from './context';
import { escapeHtml, h } from './dom';

const GRADE_CLASS: Record<Debrief['grade'], string> = {
  Excellent: 'good',
  Good: 'good',
  Acceptable: 'warn',
  'Needs work': 'bad',
  Incomplete: 'warn',
};

/** How the attempt went: mode, time used and the previous best on this case. */
export interface DebriefMeta {
  readonly mode: PlayMode;
  readonly durationS: number;
  readonly previousBest: number | null;
  readonly score: number;
}

/** Debrief modal: score, grade, headline and one teaching point per item. */
function bestLine(m: DebriefMeta): string {
  if (m.previousBest === null) return t('db.firstAttempt');
  if (m.score > m.previousBest) return `${t('db.newBest')} (${m.previousBest} → ${m.score})`;
  return t('db.best', { score: m.previousBest });
}

export class DebriefView {
  readonly el = h('div', 'debrief');

  constructor(private readonly ctx: UiContext) {
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(d: Debrief, meta: DebriefMeta | null = null): void {
    const items = d.items
      .map(
        (i) => `<li class="db-item ${i.status}"><div class="db-item-head"><span class="db-dot"></span><span class="db-lbl">${escapeHtml(i.label)}</span><span class="db-v mono">${escapeHtml(i.value)}</span></div><p>${escapeHtml(i.teaching)}</p></li>`,
      )
      .join('');
    this.el.innerHTML = `<div class="debrief-card">
      <p class="eyebrow">${t('db.eyebrow')}</p>
      <p class="db-case">${escapeHtml(caseLine(this.ctx.caseInstance))}${meta ? ` · ${escapeHtml(t('db.mode', { mode: tk(`mode.${meta.mode}`), time: mmss(meta.durationS) }))}` : ''}</p>
      ${meta ? `<p class="db-best ${meta.previousBest !== null && meta.score > meta.previousBest ? 'new' : ''}">${escapeHtml(bestLine(meta))}</p>` : ''}
      <div class="db-top">
        <div class="db-score"><span class="db-num mono">${d.score}</span><span class="db-of">/100</span></div>
        <div><span class="db-verdict ${GRADE_CLASS[d.grade]}">${escapeHtml(gradeLabel(d.grade))}</span><h2>${escapeHtml(d.headline)}</h2></div>
      </div>
      <ul class="db-items">${items}</ul>
      <div class="db-actions"><button class="btn keep">${t('db.keep')}</button><button class="btn watch">▶ ${t('db.replay')}</button><button class="btn export">⬇ ${t('replay.export')}</button><button class="btn retry">${t('db.retry')}</button><button class="btn-primary new">${t('db.new')}</button></div>
    </div>`;
    this.el.querySelector('.keep')!.addEventListener('click', () => this.ctx.actions.keepExploring());
    this.el.querySelector('.new')!.addEventListener('click', () => this.ctx.actions.newCase());
    this.el.querySelector('.retry')!.addEventListener('click', () => this.ctx.actions.retryCase());
    this.el.querySelector('.watch')!.addEventListener('click', () => this.ctx.actions.watchReplay());
    this.el.querySelector('.export')!.addEventListener('click', () => this.ctx.actions.exportReplay());
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
