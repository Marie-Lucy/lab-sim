import { BALLOON, GUIDE } from '../config/anatomy';
import { applyI18n, fmt, t } from '../i18n';
import { vesselName } from '../tools/deviceController';
import { FFR } from '../config/anatomy';
import { isSignificant } from '../physics/ffr';
import { deferAvailability } from '../tools/tools';
import { ImagingPanel } from './imagingView';
import { catheterSizes, catheterSpec, currentDiameter, inGuide } from '../physics/catheter';
import { pressureStatus, rupturePressure } from '../physics/inflation';
import type { UiContext } from './context';
import { h, holdButton } from './dom-hold';
import { escapeHtml, setHtml, setText } from './dom';

/** SVG rotation dial with labelled targets (deg) and a needle at the current rotation. */
function dial(rotation: number, marks: readonly [number, string][]): string {
  const pt = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [32 + r * Math.cos(a), 32 + r * Math.sin(a)] as const;
  };
  const [nx, ny] = pt(rotation, 22);
  const ticks = marks
    .map(([d, l]) => {
      const [x, y] = pt(d, 27);
      const [tx, ty] = pt(d, 18);
      return `<line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}" class="dial-tick"/><text x="${pt(d, 13)[0]}" y="${pt(d, 13)[1] + 2.5}" class="dial-lbl">${l}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 64 64" class="dial"><circle cx="32" cy="32" r="28" class="dial-ring"/>${ticks}<line x1="32" y1="32" x2="${nx}" y2="${ny}" class="dial-needle"/><circle cx="32" cy="32" r="3" class="dial-hub"/></svg>`;
}

/** Context panel for the active device, with on-screen hold buttons for mouse and touch. */
export class DevicePanel {
  readonly el = h('div', 'panel device');
  private readonly body = h('div', 'dev-body');
  private readonly controls = h('div', 'dev-controls');
  private readonly imaging: ImagingPanel;

  constructor(private readonly ctx: UiContext) {
    this.el.innerHTML = '<div class="panel-title"><span class="dev-title"></span></div>';
    this.imaging = new ImagingPanel(ctx);
    this.el.append(this.body, this.imaging.el, this.controls);
    this.controls.innerHTML = `
      <button class="hold" data-h="retract" data-i18n-title="dev.retract">◀ S</button>
      <button class="hold" data-h="advance" data-i18n-title="dev.advance">W ▶</button>
      <button class="hold" data-h="rotL" data-i18n-title="dev.rotateL">⟲ A</button>
      <button class="hold" data-h="rotR" data-i18n-title="dev.rotateR">D ⟳</button>
      <button class="hold infl" data-h="inflate" data-i18n-title="dev.inflate">E ＋atm</button>
      <button class="hold infl" data-h="deflate" data-i18n-title="dev.deflate">Q −atm</button>
      <label class="fine"><input type="checkbox"/> <span data-i18n="dev.fine"></span></label>`;
    applyI18n(this.controls);
    this.controls.querySelectorAll<HTMLElement>('[data-h]').forEach((b) => holdButton(b, ctx.input, b.dataset.h!));
    this.controls.querySelector('input')!.addEventListener('change', (e) => (ctx.input.fineToggle = (e.target as HTMLInputElement).checked));
    this.body.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-ffr]')) return ctx.actions.selectTool('ffr');
      if (target.closest('[data-defer]')) return ctx.actions.defer();
      const type = target.closest<HTMLElement>('[data-nc]');
      if (type) return ctx.actions.setBalloonType(type.dataset.nc === '1');
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
      if (!chip) return;
      const c = ctx.session.ctrl.catheter;
      if (!c) return;
      const d = chip.dataset.d ? Number(chip.dataset.d) : c.diameter;
      const l = chip.dataset.l ? Number(chip.dataset.l) : c.length;
      ctx.actions.setSize(d, l);
    });
  }

  update(): void {
    const s = this.ctx.session;
    const c = s.ctrl;
    const tool = s.tool;
    const title = this.el.querySelector('.dev-title')!;
    const showInflate = tool === 'balloon' || tool === 'stent';
    this.controls.querySelectorAll<HTMLElement>('.infl').forEach((b) => (b.hidden = !showInflate));
    this.controls.hidden = tool === 'measure' || tool === 'ffr' || tool === 'imaging';
    this.imaging.el.hidden = tool !== 'imaging';
    this.body.hidden = tool === 'imaging';
    this.el.classList.toggle('wide', tool === 'imaging');

    if (tool === 'guide') {
      setText(title, t('dev.guide'));
      const g = c.guide;
      setHtml(
        this.body,
        `<div class="dev-row">${dial(g.rotationDeg, [[GUIDE.leftCuspAngleDeg, t('dial.left')], [GUIDE.rightCuspAngleDeg, t('dial.right')]])}
        <div class="dev-info"><div><span class="muted">${t('dev.tip')}</span> ${escapeHtml(c.guideLocation())}</div>
        <div><span class="muted">${t('dev.rotation')}</span> <span class="mono">${g.rotationDeg.toFixed(0)}°</span></div>
        <div class="${g.engaged ? 'ok' : 'muted'}">${t(g.engaged ? 'dev.engaged' : 'dev.cuspLegend')}</div></div></div>`,
      );
    } else if (tool === 'wire') {
      setText(title, t('dev.wire'));
      const w = c.wire;
      const hb = c.hint();
      const res = Math.round(w.resistance * 100);
      setHtml(
        this.body,
        `<div class="dev-row">${dial(w.rotationDeg, [[0, t('dial.lad')], [90, t('dial.diag')], [180, t('dial.lcx')]])}
        <div class="dev-info"><div><span class="muted">${t('dev.tip')}</span> ${escapeHtml(c.wireLocation())}</div>
        <div><span class="muted">${t('dev.rotation')}</span> <span class="mono">${w.rotationDeg.toFixed(0)}°</span></div>
        <div>${hb ? `<span class="muted">${t('dev.next')}</span> ${escapeHtml(t('dev.nextIn', { branch: vesselName(hb.branch), mm: fmt(hb.distance, 0) }))} <b>${escapeHtml(hb.takes ? vesselName(hb.takes) : t('dev.stays'))}</b>` : `<span class="muted">${t('dev.noBranch')}</span>`}</div></div></div>
        <div class="meter ${w.forcing ? 'danger' : ''}"><span class="muted">${t('dev.resistance')}</span><div class="meter-bar"><div style="width:${res}%"></div></div><span class="mono">${res}%</span></div>`,
      );
    } else if (tool === 'balloon' || tool === 'stent') {
      const cat = c.catheter;
      setText(title, t(tool === 'balloon' ? (c.catheter?.nc ? 'dev.ncBalloon' : 'dev.balloon') : 'dev.stent'));
      if (!cat) {
        setHtml(this.body, `<div class="muted">${t('dev.noCatheter')}</div>`);
        return;
      }
      const spec = catheterSizes(cat.kind, cat.nc);
      const locked = !inGuide(cat);
      const typeRow =
        cat.kind === 'balloon'
          ? `<div class="chips"><span class="muted">${t('dev.type')}</span><button class="size-chip${cat.nc ? '' : ' on'}" ${locked ? 'disabled' : ''} data-nc="0" title="${t('dev.scTitle')}">SC</button><button class="size-chip${cat.nc ? ' on' : ''}" ${locked ? 'disabled' : ''} data-nc="1" title="${t('dev.ncTitle')}">NC</button></div>`
          : '';
      const chips = (vals: readonly number[], key: 'd' | 'l', cur: number, unit: string) =>
        vals.map((v) => `<button class="size-chip${v === cur ? ' on' : ''}" ${locked ? 'disabled' : ''} data-${key}="${v}">${key === 'd' ? fmt(v, v * 100 % 10 === 0 ? 1 : 2) : v}${unit}</button>`).join('');
      const cs = catheterSpec(cat);
      const max = BALLOON.maxPressure;
      const pct = (p: number) => `${(p / max) * 100}%`;
      const status = pressureStatus(cs, cat.pressure);
      const m = c.lesionMargins();
      const marg = (v: number) => `<span class="mono ${v < 0 ? 'bad' : v < 1.5 ? 'warn' : 'ok'}">${v >= 0 ? '+' : ''}${fmt(v, 1)}</span>`;
      const timer = cat.inflation ? `${fmt(s.time - cat.inflation.start, 0)} s` : '—';
      setHtml(
        this.body,
        `${typeRow}<div class="chips"><span class="muted">Ø</span>${chips(spec.diameters, 'd', cat.diameter, '')}</div>
        <div class="chips"><span class="muted">L</span>${chips(spec.lengths, 'l', cat.length, '')}</div>
        ${locked ? `<div class="muted small">${t('dev.sizeLocked')}</div>` : ''}
        <div class="gauge ${status}"><div class="gauge-bar"><div class="gauge-fill" style="width:${pct(cat.pressure)}"></div>
          <i style="left:${pct(cs.nominalPressure)}" title="nominal"></i><i class="rbp" style="left:${pct(cs.ratedBurstPressure)}" title="RBP"></i><i class="rup" style="left:${pct(rupturePressure(cs))}"></i></div>
          <div class="gauge-lbl"><span class="mono big">${fmt(cat.pressure, 1)} atm</span><span class="muted">${t('dev.np')} ${cs.nominalPressure} · ${t('dev.rbp')} ${cs.ratedBurstPressure}</span></div></div>
        <div class="dev-grid"><span class="muted">${t('dev.diameter')}</span><span class="mono">${fmt(currentDiameter(cat), 2)} mm</span>
          <span class="muted">${t('dev.inflation')}</span><span class="mono">${timer}</span>
          <span class="muted">${t('dev.position')}</span><span>${m ? `${t('dev.prox')} ${marg(m.proximal)} · ${t('dev.dist')} ${marg(m.distal)} mm` : locked ? '—' : t('dev.inGuide')}</span>
          ${cat.kind === 'stent' && cat.deployed ? `<span class="muted">${t('dev.stentLbl')}</span><span class="ok">${t('dev.deployed')}</span>` : ''}
          ${cat.ruptured ? `<span class="muted">${t('dev.balloonLbl')}</span><span class="bad">${t('dev.ruptured')}</span>` : ''}</div>`,
      );
    } else if (tool === 'imaging') {
      setText(title, t('dev.imaging'));
      this.imaging.update();
    } else if (tool === 'ffr') {
      setText(title, t('dev.ffr'));
      const r = s.ffrReadings[s.ffrReadings.length - 1];
      const canDefer = deferAvailability(s.facts(), s.progress).ok;
      const cls = !r ? '' : r.beyondLesion < FFR.sensorBeyondMm ? 'warn' : isSignificant(r.ffr) ? 'bad' : 'ok';
      setHtml(
        this.body,
        (r
          ? `<div class="ffr-read ${cls}"><span class="mono ffr-val">${fmt(r.ffr, 2)}</span><span class="muted">FFR · Pd/Pa ${fmt(r.pd, 0)}/${fmt(r.pa, 0)} mmHg</span></div>
            <div class="dev-grid"><span class="muted">${t('ffr.sensor')}</span><span class="mono">${r.beyondLesion >= 0 ? '+' : ''}${fmt(r.beyondLesion, 0)} mm</span>
            <span class="muted">${t('ffr.cutoff')}</span><span class="mono">≤ ${fmt(FFR.cutoff, 2)}</span></div>
            <div class="small ${cls}">${t(r.beyondLesion < FFR.sensorBeyondMm ? 'ffr.proximal' : isSignificant(r.ffr) ? 'ffr.significant' : 'ffr.notSignificant')}</div>`
          : `<div class="muted">${t('ffr.none')}</div>`) +
          `<div class="ffr-actions"><button class="btn small" data-ffr>${t('ffr.again')}</button>${canDefer ? `<button class="btn small" data-defer>${t('ffr.defer')}</button>` : ''}</div>`,
      );
    } else if (tool === 'measure') {
      setText(title, t('dev.qca'));
      const q = s.qca;
      setHtml(
        this.body,
        q
          ? `<div class="dev-grid"><span class="muted">${t('qca.ref')}</span><span class="mono">${fmt(q.referenceDiameter, 2)} mm</span>
            <span class="muted">${t('qca.mld')}</span><span class="mono">${fmt(q.mld, 2)} mm</span>
            <span class="muted">${t('qca.ds')}</span><span class="mono">${t('qca.dsValue', { pct: fmt(q.ds * 100, 0) })}</span>
            <span class="muted">${t('qca.length')}</span><span class="mono">${fmt(q.lesionLength, 1)} mm</span></div>
            <div class="muted small">${t('qca.hover')}</div>`
          : `<div class="muted">${t('qca.none')}</div>`,
      );
    }
  }
}
