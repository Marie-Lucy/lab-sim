import { caseLine } from '../cases/caseText';
import { applyI18n } from '../i18n';
import type { UiContext } from './context';
import { h } from './dom';

/** Pause overlay (Esc). */
export class PauseOverlay {
  readonly el = h('div', 'overlay pause');
  constructor(private readonly ctx: UiContext) {
    this.el.innerHTML = `<div class="overlay-card panel"><p class="eyebrow" data-i18n="pause.eyebrow"></p><h2 data-i18n="pause.title"></h2>
      <p class="muted" data-i18n="pause.text"></p>
      <p class="db-case pause-case"></p>
      <div class="ov-actions"><button class="btn-primary" data-i18n="pause.resume"></button><button class="btn end" data-i18n="hud.end"></button></div></div>`;
    applyI18n(this.el);
    this.el.querySelector('.btn-primary')!.addEventListener('click', () => ctx.actions.togglePause());
    this.el.querySelector('.end')!.addEventListener('click', () => ctx.actions.endCase());
    this.el.hidden = true;
  }
  update(show: boolean): void {
    if (show && this.el.hidden) this.el.querySelector('.pause-case')!.textContent = caseLine(this.ctx.caseInstance);
    this.el.hidden = !show;
  }
}

const ROWS = 14;

/** Keys help (H). */
export class HelpOverlay {
  readonly el = h('div', 'overlay help-ov');
  constructor(ctx: UiContext) {
    const rows = Array.from({ length: ROWS }, (_, i) => `<dt class="mono" data-i18n="help.r${i + 1}.k"></dt><dd data-i18n="help.r${i + 1}.v"></dd>`).join('');
    this.el.innerHTML = `<div class="overlay-card panel"><p class="eyebrow" data-i18n="help.eyebrow"></p><h2 data-i18n="help.title"></h2>
      <dl class="keys-list">${rows}</dl>
      <div class="ov-actions"><button class="btn-primary" data-i18n="help.close"></button></div></div>`;
    applyI18n(this.el);
    this.el.querySelector('.btn-primary')!.addEventListener('click', () => ctx.actions.toggleHelp());
    this.el.addEventListener('click', (e) => e.target === this.el && ctx.actions.toggleHelp());
    this.el.hidden = true;
  }
  update(show: boolean): void {
    this.el.hidden = !show;
  }
}
