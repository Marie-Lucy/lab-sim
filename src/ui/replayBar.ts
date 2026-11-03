import { applyI18n } from '../i18n';
import type { TimelineMarker } from '../replay/replay';
import { escapeHtml, h, mmss, setText } from './dom';

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

export interface ReplayControls {
  togglePlay(): void;
  setSpeed(speed: number): void;
  seek(tick: number): void;
  restart(): void;
  exit(): void;
  export(): void;
}

/** Player bar: play/pause, speed, time and a scrubbable timeline with event markers. */
export class ReplayBar {
  readonly el = h('div', 'panel replay-bar');
  private readonly range: HTMLInputElement;
  private readonly markers: HTMLElement;
  private dragging = false;

  constructor(
    private readonly controls: ReplayControls,
    private readonly dt: number,
    private readonly total: number,
    label = '',
  ) {
    this.el.innerHTML = `
      <button class="rb-btn rb-play" data-i18n-title="replay.playPause">▶</button>
      <button class="rb-btn rb-restart" data-i18n-title="replay.restart">⟲</button>
      <div class="rb-speeds">${REPLAY_SPEEDS.map((s) => `<button class="rb-speed" data-speed="${s}">${s}×</button>`).join('')}</div>
      <div class="rb-track"><div class="rb-markers"></div><input class="rb-range" type="range" min="0" max="${total}" step="1" value="0" /></div>
      <span class="rb-time mono"></span>
      <button class="rb-btn rb-export" data-i18n-title="replay.export">⬇</button>
      <button class="rb-btn rb-exit" data-i18n="replay.exit"></button>
      ${label ? `<span class="rb-label">${escapeHtml(label)}</span>` : ''}`;
    applyI18n(this.el);
    this.range = this.el.querySelector('.rb-range')!;
    this.markers = this.el.querySelector('.rb-markers')!;
    this.el.querySelector('.rb-play')!.addEventListener('click', () => controls.togglePlay());
    this.el.querySelector('.rb-restart')!.addEventListener('click', () => controls.restart());
    this.el.querySelector('.rb-exit')!.addEventListener('click', () => controls.exit());
    this.el.querySelector('.rb-export')!.addEventListener('click', () => controls.export());
    this.el.querySelector('.rb-speeds')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]');
      if (b) controls.setSpeed(Number(b.dataset.speed));
    });
    this.range.addEventListener('input', () => (this.dragging = true));
    this.range.addEventListener('change', () => {
      this.dragging = false;
      controls.seek(Number(this.range.value));
    });
  }

  setMarkers(markers: readonly TimelineMarker[]): void {
    this.markers.innerHTML = markers
      .map(
        (m) =>
          `<button class="rb-marker ${m.kind}" style="left:${((m.tick / Math.max(1, this.total)) * 100).toFixed(2)}%" title="${escapeHtml(`${mmss(m.tick * this.dt)} · ${m.text}`)}" data-tick="${m.tick}"></button>`,
      )
      .join('');
    this.markers.querySelectorAll<HTMLElement>('[data-tick]').forEach((b) => b.addEventListener('click', () => this.controls.seek(Number(b.dataset.tick))));
  }

  update(tick: number, playing: boolean, speed: number): void {
    if (!this.dragging) this.range.value = String(tick);
    setText(this.el.querySelector('.rb-play')!, playing ? '❚❚' : '▶');
    setText(this.el.querySelector('.rb-time')!, `${mmss(tick * this.dt)} / ${mmss(this.total * this.dt)}`);
    this.el.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
  }
}
