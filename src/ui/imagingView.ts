import { IMAGING } from '../config/anatomy';
import { fmt, t } from '../i18n';
import { area, optimisation, type Frame, type Pullback } from '../physics/imaging';
import type { UiContext } from './context';
import { h } from './dom-hold';
import { setHtml, setText } from './dom';

/** Deterministic pseudo-random sequence for speckle (the same picture every frame). */
function speckle(seed: number): () => number {
  let x = seed | 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

const PALETTE = {
  ivus: { bg: '#050505', wall: '#7c7c7c', plaque: '#4b4b4b', dot: '#a3a3a3', lumen: '#121212', strut: '#f5f5f5', adventitia: '#b5b5b5' },
  oct: { bg: '#000000', wall: '#b85a1a', plaque: '#8a3f12', dot: '#f0a35e', lumen: '#000000', strut: '#ffffff', adventitia: '#d8823c' },
} as const;

/**
 * One cross-section as SVG. Plaque is drawn eccentric (the lumen shifted away from the
 * thickest part, as in most real lesions); struts are bright dots on the stent circle, with
 * the black shadow OCT shows behind metal; a dissection is a flap of wall lifting into the lumen.
 */
export function crossSectionSvg(f: Frame, modality: Pullback['modality'], maxEem: number, size = 112): string {
  const P = PALETTE[modality];
  const c = size / 2;
  const k = (size - 14) / maxEem; // px per mm of diameter: the widest EEM fills the frame
  const rL = (f.lumenD / 2) * k;
  const rEem = (f.eemD / 2) * k;
  const shift = Math.max(0, rEem - rL) * 0.45;
  const lx = c + shift;
  const ly = c - shift * 0.3;
  const rnd = speckle(Math.round(f.arc * 10) + 7);
  let dots = '';
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * rEem;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (Math.hypot(x - lx, y - ly) > rL + 1) dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.5 + rnd()).toFixed(1)}" fill="${P.dot}" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`;
  }
  const eem = f.eemVisible
    ? `<circle cx="${c}" cy="${c}" r="${rEem + 2}" fill="none" stroke="${P.adventitia}" stroke-width="3" opacity="0.8"/>`
    : `<circle cx="${c}" cy="${c}" r="${rEem + 2}" fill="none" stroke="${P.adventitia}" stroke-width="2" stroke-dasharray="2 5" opacity="0.25"/>`;
  // OCT: tissue fades with depth (light is absorbed); IVUS keeps the whole wall.
  const fade =
    modality === 'oct'
      ? `<defs><radialGradient id="octfade" cx="${lx / size}" cy="${ly / size}" r="0.5"><stop offset="${Math.min(0.95, (rL + 4) / (size / 2)).toFixed(2)}" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></radialGradient></defs><rect width="${size}" height="${size}" fill="url(#octfade)"/>`
      : '';
  let struts = '';
  if (f.stentD !== null) {
    const rS = (f.stentD / 2) * k;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const x = lx + Math.cos(a) * rS;
      const y = ly + Math.sin(a) * rS;
      if (modality === 'oct') {
        const x2 = lx + Math.cos(a) * (rS + 14);
        const y2 = ly + Math.sin(a) * (rS + 14);
        struts += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="4" opacity="0.8"/>`;
      }
      struts += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="${P.strut}"/>`;
    }
  }
  // Calcium: an arc behind the lumen border, up to 200° at full calcium.
  let calc = '';
  if (f.calcium > 0.05) {
    const span = f.calcium * Math.PI * 1.1;
    const a0 = -Math.PI / 2 - span / 2 + 0.6;
    const arc = (r: number, from: number, to: number) => {
      const p = (a: number) => `${(lx + Math.cos(a) * r).toFixed(1)} ${(ly + Math.sin(a) * r).toFixed(1)}`;
      return `M${p(from)} A${r.toFixed(1)} ${r.toFixed(1)} 0 ${to - from > Math.PI ? 1 : 0} 1 ${p(to)}`;
    };
    // A fracture is a gap in the middle of the arc.
    const pieces: [number, number][] = f.cracked ? [[a0, a0 + span * 0.45], [a0 + span * 0.55, a0 + span]] : [[a0, a0 + span]];
    const rC = rL + 4;
    for (const [from, to] of pieces) {
      if (modality === 'ivus') {
        // Bright leading edge with an acoustic shadow behind it.
        calc += `<path d="${arc(rC + 9, from, to)}" stroke="#000" stroke-width="16" fill="none" opacity="0.92"/>`;
        calc += `<path d="${arc(rC, from, to)}" stroke="#f5f5f5" stroke-width="3" fill="none"/>`;
      } else {
        // Signal-poor, sharply delineated plate.
        calc += `<path d="${arc(rC + 4, from, to)}" stroke="#1c0c04" stroke-width="7" fill="none"/>`;
        calc += `<path d="${arc(rC, from, to)}" stroke="#f0a35e" stroke-width="1" fill="none"/><path d="${arc(rC + 8, from, to)}" stroke="#f0a35e" stroke-width="1" fill="none"/>`;
      }
    }
  }
  const flap = f.dissection
    ? `<path d="M${(lx + rL * 0.7).toFixed(1)} ${(ly - rL * 0.72).toFixed(1)} q ${(-rL * 0.5).toFixed(1)} ${(rL * 0.15).toFixed(1)} ${(-rL * 0.7).toFixed(1)} ${(rL * 0.55).toFixed(1)}" stroke="${P.wall}" stroke-width="2.4" fill="none"/>`
    : '';
  const cath = modality === 'ivus' ? `<circle cx="${lx}" cy="${ly}" r="3.4" fill="#000" stroke="#d4d4d4" stroke-width="1.2"/>` : `<circle cx="${lx}" cy="${ly}" r="2.4" fill="#000" stroke="#777" stroke-width="0.8"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" class="img-xs" role="img" aria-label="${t('img.xsAria')}">
    <rect width="${size}" height="${size}" fill="${P.bg}"/>
    <circle cx="${c}" cy="${c}" r="${rEem}" fill="${P.plaque}"/>
    ${dots}${eem}
    <circle cx="${lx}" cy="${ly}" r="${rL}" fill="${P.lumen}" stroke="${P.wall}" stroke-width="${modality === 'oct' ? 2 : 1}"/>
    ${calc}${fade}${flap}${struts}${cath}
  </svg>`;
}

/** Longitudinal (L-mode) view: lumen and EEM along the pullback, stent struts, a cursor. */
export function lModeSvg(run: Pullback, cursorArc: number, width = 236, height = 66): string {
  const P = PALETTE[run.modality];
  const frames = run.frames;
  const maxArc = frames[frames.length - 1]!.arc || 1;
  const maxEem = Math.max(...frames.map((f) => f.eemD));
  const x = (arc: number) => 4 + (arc / maxArc) * (width - 8);
  const ky = (height / 2 - 4) / (maxEem / 2);
  const c = height / 2;
  const band = (half: (f: Frame) => number) =>
    frames.map((f) => `${x(f.arc).toFixed(1)},${(c - half(f) * ky).toFixed(1)}`).join(' ') +
    ' ' +
    [...frames].reverse().map((f) => `${x(f.arc).toFixed(1)},${(c + half(f) * ky).toFixed(1)}`).join(' ');
  let struts = '';
  for (let i = 0; i < frames.length; i += 2) {
    const f = frames[i]!;
    if (f.stentD === null) continue;
    const y = (f.stentD / 2) * ky;
    struts += `<rect x="${(x(f.arc) - 0.8).toFixed(1)}" y="${(c - y - 1).toFixed(1)}" width="1.6" height="2" fill="${P.strut}"/><rect x="${(x(f.arc) - 0.8).toFixed(1)}" y="${(c + y - 1).toFixed(1)}" width="1.6" height="2" fill="${P.strut}"/>`;
  }
  const m = run.summary;
  const mark = m.msa ?? m.mla;
  return `<svg viewBox="0 0 ${width} ${height}" class="img-lmode" role="img" aria-label="${t('img.lAria')}">
    <rect width="${width}" height="${height}" fill="${P.bg}" rx="4"/>
    <polygon points="${band((f) => f.eemD / 2)}" fill="${P.plaque}"/>
    <polygon points="${band((f) => f.lumenD / 2)}" fill="${P.lumen}"/>
    ${struts}
    <path d="M${x(mark.arc).toFixed(1)} 1 l-3 -0 l3 5 l3 -5 z" fill="#facc15"/>
    <line x1="${x(cursorArc).toFixed(1)}" y1="0" x2="${x(cursorArc).toFixed(1)}" y2="${height}" stroke="#38bdf8" stroke-width="1.2"/>
  </svg>`;
}

/**
 * The IVUS/OCT panel: pullback buttons, the cross-section at a draggable cursor, the L-mode
 * and the summary an operator reads. Built once (so the slider keeps working while dragged);
 * only the SVGs and numbers are replaced.
 */
export class ImagingPanel {
  readonly el = h('div', 'img-panel');
  private readonly xs = h('div', 'img-xs-wrap');
  private readonly frameInfo = h('div', 'img-frame');
  private readonly lmode = h('div', 'img-lmode-wrap');
  private readonly slider = document.createElement('input');
  private readonly summary = h('div', 'img-summary');
  private readonly empty = h('div', 'muted small');
  private shownRun: Pullback | null = null;
  private cursor = 0;

  constructor(private readonly ctx: UiContext) {
    const buttons = h('div', 'ffr-actions');
    buttons.innerHTML = `<button class="btn small" data-pb="ivus"></button><button class="btn small" data-pb="oct"></button>`;
    buttons.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pb]');
      if (b) ctx.actions.pullback(b.dataset.pb as Pullback['modality']);
    });
    this.slider.type = 'range';
    this.slider.className = 'img-slider';
    this.slider.addEventListener('input', () => {
      this.cursor = Number(this.slider.value);
      this.render();
    });
    const top = h('div', 'img-top');
    top.append(this.xs, this.frameInfo);
    this.el.append(this.empty, top, this.lmode, this.slider, this.summary, buttons);
  }

  update(): void {
    const s = this.ctx.session;
    const run = s.imaging[s.imaging.length - 1] ?? null;
    this.el.querySelector<HTMLElement>('[data-pb="ivus"]')!.textContent = t('img.ivus');
    this.el.querySelector<HTMLElement>('[data-pb="oct"]')!.textContent = t('img.oct');
    if (run !== this.shownRun) {
      this.shownRun = run;
      if (run) {
        const last = run.frames[run.frames.length - 1]!.arc;
        this.slider.min = '0';
        this.slider.max = String(last);
        this.slider.step = String(IMAGING.frameMm);
        this.cursor = (run.summary.msa ?? run.summary.mla).arc;
        this.slider.value = String(this.cursor);
      }
    }
    this.render();
  }

  private render(): void {
    const run = this.shownRun;
    const has = !!run;
    this.empty.hidden = has;
    setText(this.empty, t('img.none'));
    for (const e of [this.xs.parentElement!, this.lmode, this.slider, this.summary]) e.hidden = !has;
    if (!run) return;
    const frame = run.frames.reduce((a, b) => (Math.abs(b.arc - this.cursor) < Math.abs(a.arc - this.cursor) ? b : a));
    const maxEem = Math.max(...run.frames.map((f) => f.eemD));
    setHtml(this.xs, crossSectionSvg(frame, run.modality, maxEem));
    setHtml(this.lmode, lModeSvg(run, frame.arc));
    const name = run.modality === 'ivus' ? 'IVUS' : 'OCT';
    setHtml(
      this.frameInfo,
      `<div class="img-mod">${name} · ${fmt(frame.arc, 1)} mm</div>
      <div><span class="muted">${t('img.lumen')}</span> <span class="mono">${fmt(area(frame.lumenD), 1)} mm²</span></div>
      <div><span class="muted">${t('img.eem')}</span> <span class="mono">${frame.eemVisible ? `${fmt(area(frame.eemD), 1)} mm²` : t('img.eemHidden')}</span></div>
      <div><span class="muted">${t('img.pb')}</span> <span class="mono">${frame.eemVisible ? `${fmt(frame.plaqueBurden * 100, 0)} %` : '—'}</span></div>
      ${frame.stentD !== null ? `<div><span class="muted">${t('img.stent')}</span> <span class="mono">${fmt(area(frame.stentD), 1)} mm²</span></div>` : ''}
      ${frame.malapposition >= IMAGING.malappositionMm ? `<div class="warn">${t('img.malHere', { mm: fmt(frame.malapposition, 2) })}</div>` : ''}
      ${frame.dissection ? `<div class="bad">${t('img.dissection')}</div>` : ''}
      ${frame.calcium > 0.05 ? `<div class="${frame.cracked ? 'ok' : 'warn'}">${t(frame.cracked ? 'img.calciumCracked' : 'img.calcium', { deg: fmt(frame.calcium * 200, 0) })}</div>` : ''}`,
    );
    const m = run.summary;
    const ref = (r: typeof m.proximalRef) => (r ? `${fmt(r.lumenD, 2)}` : '—');
    const rows: string[] = [];
    // Once stented, the MSA matters; the smallest lumen is then just the distal vessel.
    if (!m.msa) {
      const pb = m.mla.plaqueBurden === null ? '' : ` · ${t('img.pbShort', { pb: fmt(m.mla.plaqueBurden * 100, 0) })}`;
      rows.push(`<span class="muted">${t('img.mla')}</span><span class="mono">${fmt(m.mla.area, 1)} mm²${pb}</span>`);
    }
    rows.push(`<span class="muted">${t('img.refs')}</span><span class="mono">${ref(m.proximalRef)} / ${ref(m.distalRef)} mm</span>`);
    const o = optimisation(m);
    if (m.msa && m.expansion !== null && o) {
      const cls = (ok: boolean) => (ok ? 'ok' : 'warn');
      rows.push(
        `<span class="muted">${t('img.msa')}</span><span class="mono">${fmt(m.msa.area, 1)} mm²</span>`,
        `<span class="muted">${t('img.expansion')}</span><span class="mono ${cls(o.expanded)}">${fmt(m.expansion * 100, 0)} % (≥ ${fmt(IMAGING.expansionGoal * 100, 0)} %)</span>`,
        `<span class="muted">${t('img.malMax')}</span><span class="mono ${cls(o.apposed)}">${fmt(m.maxMalapposition, 2)} mm (< ${fmt(IMAGING.malappositionMm, 1)})</span>`,
        `<span class="muted">${t('img.edges')}</span><span class="${cls(o.edges)}">${t(o.edges ? 'img.edgesOk' : m.edgeDissection ? 'img.edgeDissection' : 'img.edgePlaque')}</span>`,
      );
    } else if (m.suggestion) {
      const g = m.suggestion;
      rows.push(`<span class="muted">${t('img.suggest')}</span><span class="mono">${fmt(g.diameter, 2)} × ${g.length} mm${g.stents > 1 ? ` (${t('img.two')})` : ''}</span>`);
    }
    setHtml(this.summary, `<div class="dev-grid">${rows.join('')}</div>`);
  }
}
