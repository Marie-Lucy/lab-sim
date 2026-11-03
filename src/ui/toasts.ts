import type { FeedbackMessage } from '../state/messages';
import { escapeHtml, h } from './dom';

const LIFETIME_S = 5;

/** Feedback messages above the toolbar (repeats are suppressed upstream by pushMessage). */
export class Toasts {
  readonly el = h('div', 'toasts');
  private shown = new Set<FeedbackMessage>();

  update(messages: readonly FeedbackMessage[], now: number): void {
    const live = messages.filter((m) => now - m.time < LIFETIME_S).slice(-3);
    const key = live.map((m) => `${m.time}|${m.text}`).join('\n');
    if (this.el.dataset.key === key) return;
    this.el.dataset.key = key;
    this.el.innerHTML = live.map((m) => `<div class="toast ${m.level}${this.shown.has(m) ? ' in' : ''}">${escapeHtml(m.text)}</div>`).join('');
    requestAnimationFrame(() => this.el.querySelectorAll('.toast').forEach((t) => t.classList.add('in')));
    this.shown = new Set(live);
  }
}
