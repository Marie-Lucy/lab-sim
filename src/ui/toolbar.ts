import { TOOLS, toolAvailability, type ToolId } from '../tools/tools';
import type { UiContext } from './context';
import { t as tr } from '../i18n';
import { escapeHtml, setText } from './dom';
import { h, holdButton } from './dom-hold';

const ICONS: Record<ToolId, string> = {
  guide: '<path d="M4 20c6-2 8-8 9-13 0-2 2-3 4-2s2 3 0 4"/>',
  wire: '<path d="M3 21c5-3 10-9 13-15"/><path d="M16 6c1-2 3-3 5-2"/>',
  balloon: '<path d="M2 12h4"/><rect x="6" y="8.5" width="12" height="7" rx="3.5"/><path d="M18 12h4"/><path d="M8 8.5v7M16 8.5v7"/>',
  stent: '<rect x="5" y="8" width="14" height="8" rx="2"/><path d="M5 8l3.5 8M8.5 8 12 16M12 8l3.5 8M15.5 8 19 16M8.5 16 12 8M12 16l3.5-8"/>',
  contrast: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
  fluoro: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  measure: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  imaging: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  ffr: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.4"/><path d="M4 19h16"/>',
};

/** Bottom toolbar 1–9. Locked tools are dimmed; hovering or pressing explains why. */
export class Toolbar {
  readonly el = h('div', 'panel toolbar');
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  private readonly tip = h('div', 'tool-tip');

  constructor(private readonly ctx: UiContext) {
    for (const t of TOOLS) {
      const b = h('button', 'tool-btn');
      b.innerHTML = `<span class="key mono">${t.key}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[t.id]}</svg><span class="name"></span>`;
      if (t.id === 'fluoro') holdButton(b, ctx.input, 'pedal');
      else b.addEventListener('click', () => ctx.actions.selectTool(t.id));
      b.addEventListener('pointerenter', () => this.showTip(t.id, b));
      b.addEventListener('pointerleave', () => this.tip.classList.remove('show'));
      this.el.appendChild(b);
      this.buttons.set(t.id, b);
    }
    document.body.appendChild(this.tip);
  }

  private showTip(id: ToolId, b: HTMLElement): void {
    const t = TOOLS.find((x) => x.id === id)!;
    const s = this.ctx.session;
    const a = toolAvailability(id, s.facts(), s.progress);
    this.tip.innerHTML = `<b>${t.key} · ${escapeHtml(t.label)}</b><span>${escapeHtml(t.rules)}</span>${a.ok ? '' : `<em>${escapeHtml(tr('toolbar.locked', { reason: a.reason }))}</em>`}`;
    const r = b.getBoundingClientRect();
    const w = Math.min(260, window.innerWidth - 24);
    this.tip.style.width = `${w}px`;
    this.tip.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2))}px`;
    this.tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
    this.tip.classList.add('show');
  }

  update(): void {
    const s = this.ctx.session;
    const facts = s.facts();
    for (const [id, b] of this.buttons) {
      setText(b.querySelector('.name')!, TOOLS.find((x) => x.id === id)!.label);
      const ok = toolAvailability(id, facts, s.progress).ok;
      b.classList.toggle('locked', !ok);
      b.classList.toggle('active', id === s.tool || (id === 'fluoro' && (s.xray.mode === 'fluoro' || s.xray.mode === 'cine')));
    }
  }
}
