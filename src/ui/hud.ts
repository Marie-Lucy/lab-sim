import { applyI18n, t } from '../i18n';
import { isActive } from '../procedure/xray';
import { createLangSelect } from './langSwitch';
import { remainingS, timeLevel } from '../exam/exam';
import type { UiContext } from './context';
import { h, mmss, setText } from './dom';

/** Top bar: brand, view, X-ray state, fluoro time, contrast, help, pause, end case. */
export class Hud {
  readonly el = h('div', 'panel topbar');
  private readonly view: HTMLButtonElement;
  private readonly xray: HTMLElement;
  private readonly fluoro: HTMLElement;
  private readonly contrast: HTMLElement;
  private readonly demo: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    this.el.innerHTML = `
      <span class="brand">Lab Theme</span>
      <span class="demo-badge" hidden data-i18n="demo.badge"></span>
      <span class="sep"></span>
      <button class="chip" data-a="view" data-i18n-title="hud.viewTitle"></button>
      <span class="xr chip-static"></span>
      <span class="exam-chip chip-static mono" hidden></span>
      <span class="sep hide-narrow"></span>
      <span class="muted hide-narrow" data-i18n="hud.fl"></span><span class="val mono fl"></span>
      <span class="muted hide-narrow" data-i18n="hud.contrast"></span><span class="val mono ml"></span>
      <span class="spacer"></span>
      <span class="lang-slot"></span>
      <button class="chip" data-a="help" data-i18n="hud.help" data-i18n-title="hud.helpTitle"></button>
      <button class="chip" data-a="pause" data-i18n-title="hud.pauseTitle">❚❚</button>
      <button class="chip end" data-a="end" data-i18n="hud.end" data-i18n-title="hud.endTitle"></button>`;
    this.el.querySelector('.lang-slot')!.appendChild(createLangSelect());
    applyI18n(this.el);
    this.view = this.el.querySelector('[data-a=view]')!;
    this.xray = this.el.querySelector('.xr')!;
    this.fluoro = this.el.querySelector('.fl')!;
    this.contrast = this.el.querySelector('.ml')!;
    this.demo = this.el.querySelector('.demo-badge')!;
    const a = ctx.actions;
    this.el.querySelector('[data-a=view]')!.addEventListener('click', () => a.toggleView());
    this.el.querySelector('[data-a=help]')!.addEventListener('click', () => a.toggleHelp());
    this.el.querySelector('[data-a=pause]')!.addEventListener('click', () => a.togglePause());
    this.el.querySelector('[data-a=end]')!.addEventListener('click', () => a.endCase());
  }

  update(): void {
    const s = this.ctx.session;
    const ui = this.ctx.store.get();
    setText(this.view, t(ui.view === '3d' ? 'hud.view3d' : 'hud.viewXray'));
    const mode = s.xray.mode;
    setText(this.xray, t(mode === 'off' ? 'hud.xrayOff' : mode === 'lih' ? 'hud.lih' : mode === 'cine' ? 'hud.cine' : 'hud.fluoro'));
    this.xray.classList.toggle('live', isActive(mode));
    setText(this.fluoro, mmss(s.xray.fluoroS));
    setText(this.contrast, `${s.contrastMl} ml`);
    this.demo.hidden = !ui.demo && !ui.replay;
    setText(this.demo, t(ui.replay ? 'replay.badge' : 'demo.badge'));
    const chip = this.el.querySelector<HTMLElement>('.exam-chip')!;
    chip.hidden = !ui.exam;
    if (ui.exam) {
      setText(chip, `${t('exam.badge')} ${mmss(remainingS(s.time))}`);
      chip.className = `exam-chip chip-static mono ${timeLevel(s.time)}`;
    }
  }
}
