import { applyI18n } from '../i18n';
import { stageProgressFraction } from '../procedure/stages';
import type { UiContext } from './context';
import { escapeHtml, h, mmss, setHtml, setText } from './dom';

/** Left checklist: the case's stages with completion times; the active one shows its sub-tasks. */
export class Checklist {
  readonly el = h('div', 'panel checklist');
  private readonly rows: HTMLElement[] = [];
  private readonly count: HTMLElement;
  private seen = 0;

  constructor(private readonly ctx: UiContext) {
    this.el.innerHTML = `<div class="panel-title"><span data-i18n="checklist.title"></span><span class="mono count"></span></div>`;
    applyI18n(this.el);
    this.count = this.el.querySelector('.count')!;
  }

  /** One row per stage of the plan (rebuilt when a deferral shortens it). */
  private syncRows(n: number): void {
    while (this.rows.length > n) this.rows.pop()!.remove();
    while (this.rows.length < n) {
      const i = this.rows.length;
      const row = h('div', 'stage');
      row.innerHTML = `<div class="st-head"><span class="st-icon"></span><span class="st-num mono">${i + 1}</span><span class="st-title"></span><span class="st-time mono"></span></div><ul class="st-tasks"></ul>`;
      row.addEventListener('click', () => this.el.classList.toggle('expanded'));
      this.el.appendChild(row);
      this.rows.push(row);
    }
  }

  update(): void {
    const p = this.ctx.session.progress;
    const STAGES = p.plan;
    this.syncRows(STAGES.length);
    const exam = this.ctx.store.get().exam;
    const done = p.completedAt.filter((x) => x !== null).length;
    setText(this.count, `${done}/${STAGES.length}`);
    this.rows.forEach((row, i) => {
      const t = p.completedAt[i] ?? null;
      const state = t !== null ? 'done' : i === p.stage ? 'active' : 'locked';
      row.className = `stage ${state}${row.classList.contains('flash') ? ' flash' : ''}`;
      setText(row.querySelector('.st-title')!, STAGES[i]!.title);
      setText(row.querySelector('.st-icon')!, t !== null ? '✓' : i === p.stage ? '●' : '○');
      setText(row.querySelector('.st-time')!, t !== null ? mmss(t) : i === p.stage && !exam ? `${Math.round(stageProgressFraction(p) * 100)}%` : '');
      const tasks = row.querySelector('.st-tasks')!;
      setHtml(
        tasks,
        i === p.stage && !exam ? STAGES[i]!.tasks.map((k) => `<li class="${p.done.has(k.id) ? 'ok' : ''}">${p.done.has(k.id) ? '✓' : '·'} ${escapeHtml(k.label)}</li>`).join('') : '',
      );
    });
    if (done > this.seen) {
      for (let i = this.seen; i < done; i++) {
        const row = this.rows[i]!;
        row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1600);
      }
      this.seen = done;
    }
  }
}
