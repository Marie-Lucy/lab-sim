import { ECG } from '../config/anatomy';
import { applyI18n, fmt, t, textContext } from '../i18n';
import { EcgGenerator, type BeatEvent } from '../physics/ecg';
import { meanArterialPressure } from '../physics/physiology';
import type { UiContext } from './context';
import { h, setText } from './dom';

/** Patient monitor: sweeping synthetic V2 ECG and vitals; heparin and sound buttons. */
export class Monitor {
  readonly el = h('div', 'panel vitals');
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly gen = new EcgGenerator();
  private x = 0;
  private lastY = 0;
  private readonly pxPerS = 50;
  private readonly alarm: HTMLElement;
  private readonly hep: HTMLButtonElement;
  private readonly snd: HTMLButtonElement;

  constructor(private readonly ctx: UiContext) {
    this.el.innerHTML = `
      <div class="v-head"><span class="panel-title" data-i18n="mon.title"></span><span class="v-alarm"></span></div>
      <div class="v-row"><div class="v-wave"><span class="v-lbl lead"></span><canvas></canvas></div>
        <div class="v-num hr"><span class="v-lbl" data-i18n="mon.hr"></span><span class="big mono hr-v"></span></div></div>
      <div class="v-grid">
        <div class="v-cell art"><span class="v-lbl" data-i18n="mon.art"></span><span class="mid mono art-v"></span><span class="small mono map-v"></span></div>
        <div class="v-cell spo2"><span class="v-lbl" data-i18n="mon.spo2"></span><span class="mid mono spo-v"></span></div>
        <div class="v-cell st"><span class="v-lbl" data-i18n="mon.st"></span><span class="mid mono st-v"></span></div>
        <div class="v-cell act"><span class="v-lbl" data-i18n="mon.act"></span><span class="mid mono act-v"></span></div>
      </div>
      <div class="v-btns"><button class="chip" data-a="hep" data-i18n-title="mon.hepTitle"></button><button class="chip" data-a="snd" data-i18n-title="mon.soundTitle"></button></div>`;
    applyI18n(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.g = this.canvas.getContext('2d')!;
    this.alarm = this.el.querySelector('.v-alarm')!;
    this.hep = this.el.querySelector('[data-a=hep]')!;
    this.snd = this.el.querySelector('[data-a=snd]')!;
    this.hep.addEventListener('click', () => ctx.actions.heparin());
    this.snd.addEventListener('click', () => ctx.actions.toggleSound());
  }

  private fit(): { w: number; h: number } {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * dpr));
    const hh = Math.max(10, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== hh) {
      this.canvas.width = w;
      this.canvas.height = hh;
      this.x = 0;
      this.g.fillStyle = '#ffffff';
      this.g.fillRect(0, 0, w, hh);
    }
    return { w, h: hh };
  }

  /** Advance the trace; returns QRS events (for the beep). */
  update(dt: number, running: boolean): BeatEvent[] {
    const s = this.ctx.session;
    const p = s.physiology;
    setText(this.el.querySelector('.lead')!, String(textContext().lead));
    setText(this.el.querySelector('.hr-v')!, p.hr.toFixed(0));
    setText(this.el.querySelector('.art-v')!, `${p.systolic.toFixed(0)}/${p.diastolic.toFixed(0)}`);
    setText(this.el.querySelector('.map-v')!, `(${meanArterialPressure(p).toFixed(0)})`);
    setText(this.el.querySelector('.spo-v')!, `${p.spo2.toFixed(0)}`);
    setText(this.el.querySelector('.st-v')!, `${p.stMm >= 0.05 ? '+' : ''}${fmt(p.stMm, 1)} mm`);
    setText(this.el.querySelector('.act-v')!, `${p.act.toFixed(0)} s`);
    this.el.querySelector('.st')!.classList.toggle('alarm1', p.stMm >= 1);
    this.el.querySelector('.art')!.classList.toggle('alarm2', p.unstable);
    setText(this.hep, t(s.ctrl.heparinGiven ? 'mon.hepGiven' : 'mon.hep'));
    this.hep.classList.toggle('on', s.ctrl.heparinGiven);
    const ui = this.ctx.store.get();
    setText(this.snd, t(ui.sound ? 'mon.soundOn' : 'mon.soundOff'));
    this.snd.classList.toggle('on', ui.sound);
    const alarm = p.unstable ? t('mon.unstable') : p.pvcChance > 0 ? t('mon.pvc') : p.chestPain ? t('mon.pain') : '';
    setText(this.alarm, alarm);
    this.alarm.className = `v-alarm ${p.unstable ? 'l2' : alarm ? 'l1' : ''}`;
    if (!running) return [];

    const { w, h: hh } = this.fit();
    const { samples, beats } = this.gen.advance(dt, { hr: p.hr, stMm: p.stMm, pvcChance: p.pvcChance });
    const g = this.g;
    const dpr = w / Math.max(1, this.canvas.getBoundingClientRect().width);
    const step = (this.pxPerS * dpr) / ECG.sampleRateHz;
    const base = hh * 0.62;
    const gain = hh * 0.32;
    g.lineWidth = 1.6 * dpr;
    g.strokeStyle = '#059669';
    for (const v of samples) {
      const nx = this.x + step;
      const y = base - v * gain;
      g.fillStyle = '#ffffff';
      g.fillRect(nx, 0, 10 * dpr, hh);
      g.beginPath();
      g.moveTo(this.x, this.lastY || y);
      g.lineTo(nx, y);
      g.stroke();
      this.lastY = y;
      this.x = nx;
      if (this.x >= w) {
        this.x = 0;
        this.lastY = 0;
      }
    }
    return beats;
  }
}
