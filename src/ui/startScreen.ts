import { CASES, caseDef, DEMO_CASE_ID, instantiateCase, randomSeed, seedCode, type CaseInstance } from '../cases/cases';
import { caseTitle, caseVignette, variantLabel } from '../cases/caseText';
import { EXAM } from '../config/anatomy';
import { bestScore, type Attempt } from '../exam/history';
import { loadStoredReplay, REPLAY_LIMITS, replayFileName, type KeyValue } from '../replay/files';
import { downloadText } from './download';
import { gradeLabel, type Grade } from '../procedure/debrief';
import { applyI18n, langInfo, onLanguageChange, t, tk } from '../i18n';

const GRADE_CLASS: Record<Grade, string> = { Excellent: 'good', Good: 'good', Acceptable: 'warn', 'Needs work': 'bad', Incomplete: 'warn' };
import { escapeHtml } from './dom';
import { createLangToggle } from './langSwitch';

const ARROW = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11 11 5M6 5h5v5"/></svg>`;

/** Glowing illustration: the heart silhouette with the LAD and its mid-vessel narrowing. */
const HEART_ART = `
<svg class="ss-glow" viewBox="0 0 240 300" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="ssArt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#0369a1"/>
    </linearGradient>
    <radialGradient id="ssHeart" cx="45%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#e0f2fe" stop-opacity="0.95"/><stop offset="100%" stop-color="#7dd3fc" stop-opacity="0.25"/>
    </radialGradient>
    <filter id="ssBlur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/>
    </filter>
  </defs>
  <path d="M70 40 C70 20 100 14 112 34 C122 50 118 70 114 80" stroke="#7dd3fc" stroke-width="16" stroke-linecap="round" opacity="0.55"/>
  <path d="M60 92 C30 120 34 190 92 240 C120 262 150 272 176 262 C214 246 222 180 196 130 C176 92 120 70 60 92 Z" fill="url(#ssHeart)" stroke="#bae6fd" stroke-width="2"/>
  <path d="M104 88 C122 120 136 160 150 200 C158 222 164 242 170 256" stroke="url(#ssArt)" stroke-width="7" stroke-linecap="round" filter="url(#ssBlur)"/>
  <path d="M104 88 C80 100 62 124 52 160" stroke="#38bdf8" stroke-width="6" stroke-linecap="round" filter="url(#ssBlur)" opacity="0.85"/>
  <path d="M122 124 C146 128 168 140 186 160 M144 184 C160 186 176 196 188 212" stroke="#7dd3fc" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>
  <circle cx="134" cy="155" r="14" fill="none" stroke="#34d399" stroke-width="2.4" filter="url(#ssBlur)"/>
  <path d="M129 148 C133 152 135 157 139 162" stroke="#ecfdf5" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const CONTROLS: readonly [string, string][] = [
  ['start.c.tools', '1–9'],
  ['start.c.move', 'start.v.move'],
  ['start.c.rotate', 'A / D · Shift'],
  ['start.c.inflate', 'E / Q'],
  ['start.c.contrast', 'start.v.contrast'],
  ['start.c.view', 'start.v.view'],
  ['start.c.help', 'H · Esc'],
];

export interface StartChoice {
  readonly mode: 'play' | 'demo';
  readonly caseId: string;
  readonly seed: number;
  /** Exam mode (never for the demo). */
  readonly exam: boolean;
}

export interface StartInitial {
  readonly caseId: string;
  readonly seed: number;
  readonly exam: boolean;
  /** Attempts saved in this browser, newest first. */
  readonly history: readonly Attempt[];
  /** A message shown at the top (e.g. a replay link that no longer works). */
  readonly notice?: string | null;
  readonly replays?: {
    readonly store: KeyValue | null;
    watch(id: string): void;
    /** Validate and open an imported file; returns an error message or null. */
    importFile(text: string): string | null;
  };
}

/**
 * Start screen in the shared light, glassy style: language switch, disclaimer, case picker
 * (with reproducible random variants), what the learner will do, controls and the two entry
 * buttons. Resolves with the chosen mode and case. The demo always plays the reference case.
 */
export function showStartScreen(parent: HTMLElement, initial: StartInitial): Promise<StartChoice> {
  const value = (v: string) => (v.startsWith('start.') ? `<span data-i18n="${v}"></span>` : `<span>${v}</span>`);
  // One seed per randomized case; the initial (shared-link) seed is kept for its case.
  const seeds = new Map<string, number>(CASES.map((c) => [c.id, c.randomized ? (c.id === initial.caseId && initial.seed ? initial.seed : randomSeed()) : 0]));
  let selected = caseDef(initial.caseId).id;
  let exam = initial.exam;
  const instance = (id: string): CaseInstance => instantiateCase(caseDef(id), seeds.get(id) ?? 0);

  const el = document.createElement('div');
  el.className = 'start-screen ss';
  el.innerHTML = `
    <div class="ss-watermark" aria-hidden="true" data-i18n="start.watermark"></div>
    <div class="ss-shell">
      <header class="ss-nav">
        <div class="ss-logo">
          <span class="ss-logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h4l2-5 4 10 2-5h6"/></svg></span>
          <span class="ss-logo-text">Lab Theme</span>
        </div>
        <div class="ss-nav-right">
          <span class="ss-lang-lbl" data-i18n="lang.label"></span>
          <span class="ss-lang"></span>
        </div>
      </header>

      <section class="ss-hero">
        <div class="ss-col ss-copy">
          <span class="ss-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linejoin="round"/></svg><span data-i18n="start.tag"></span></span>
          <h1 class="ss-title">Lab Theme</h1>
          <p class="ss-lead" data-i18n="start.lead"></p>
          <p class="ss-chosen"><b class="ss-chosen-title"></b> <button class="ss-change" type="button"><span data-i18n="start.change"></span> ↓</button></p>
          <p class="ss-case"></p>
          <div class="ss-mode">
            <span class="ss-mode-lbl" data-i18n="start.mode"></span>
            <div class="ss-mode-toggle" role="radiogroup">
              <button type="button" role="radio" data-mode="practice" data-i18n="mode.practice"></button>
              <button type="button" role="radio" data-mode="exam" data-i18n="mode.exam"></button>
            </div>
          </div>
          <p class="ss-mode-note"></p>
          <div class="ss-cta">
            <button class="ss-pill ss-pill-dark ss-enter"><span data-i18n="start.enter"></span><span class="ss-arrow">${ARROW}</span></button>
            <button class="ss-pill ss-pill-light ss-demo"><span data-i18n="start.demo"></span><span class="ss-arrow green">${ARROW}</span></button>
          </div>
          <p class="ss-ack" data-i18n="start.ack"></p>
          <p class="ss-version" data-i18n="start.navTag"></p>
        </div>

        <div class="ss-col ss-center">
          <div class="ss-arch">
            <div class="ss-arch-bg"></div>
            <div class="ss-arch-art">${HEART_ART}</div>
            <div class="ss-float ss-float-top">
              <span class="ss-float-num">${CASES.length}</span>
              <span class="ss-float-lbl" data-i18n="start.floatLbl"></span>
            </div>
            <div class="ss-float ss-float-bottom">
              <span class="ss-float-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></span>
              <span><b data-i18n="start.steps"></b><small data-i18n="start.stepsSub"></small></span>
            </div>
          </div>
        </div>

        <div class="ss-col ss-right">
          <div class="ss-glass">
            <span class="ss-badge"><span class="ss-warn-dot"></span><span data-i18n="start.badge"></span></span>
            <p class="ss-disclaimer" data-i18n-html="start.disclaimer"></p>
            <p class="ss-glass-title" data-i18n="start.youWill"></p>
            <ul class="ss-list">${[1, 2, 3, 4, 5].map((i) => `<li data-i18n="start.will${i}"></li>`).join('')}</ul>
            <p class="ss-glass-title" data-i18n="start.controls"></p>
            <ul class="ss-facts small">${CONTROLS.map(([k, v]) => `<li><span data-i18n="${k}"></span>${value(v)}</li>`).join('')}</ul>
          </div>
        </div>
      </section>

      <section class="ss-cases">
        <h2 class="ss-cases-title" data-i18n="start.cases"></h2>
        <div class="ss-case-grid" role="radiogroup"></div>
      </section>

      <section class="ss-history">
        <div class="ss-history-head">
          <h2 class="ss-cases-title" data-i18n="start.history"></h2>
          <label class="ss-import"><input type="file" accept=".json,application/json" hidden /><span data-i18n="replay.import"></span></label>
        </div>
        <p class="ss-import-error" hidden></p>
        <ul class="ss-history-list"></ul>
      </section>
    </div>`;
  el.querySelector('.ss-lang')!.appendChild(createLangToggle());
  const grid = el.querySelector<HTMLElement>('.ss-case-grid')!;
  const vignette = el.querySelector<HTMLElement>('.ss-case')!;

  const render = () => {
    grid.innerHTML = CASES.map((c) => {
      const inst = instance(c.id);
      const on = c.id === selected;
      return `<div class="ss-case-card${on ? ' on' : ''}" role="radio" tabindex="0" aria-checked="${on}" data-case="${c.id}">
        <div class="ss-case-head"><span class="ss-diff ${c.difficulty}">${escapeHtml(tk(`diff.${c.difficulty}`))}</span><span class="ss-case-pct mono">${Math.round(inst.lesion.severity * 100)} %</span></div>
        <b>${escapeHtml(caseTitle(c.id))}</b>
        ${best(c.id) !== null ? `<span class="ss-case-best">${escapeHtml(t('start.best', { score: best(c.id)! }))}</span>` : ''}
        <span class="ss-case-variant mono">${c.randomized ? escapeHtml(t('start.variant', { code: seedCode(inst.seed) })) : escapeHtml(t('start.refCase'))}</span>
        ${c.randomized ? `<button class="ss-reroll" data-reroll="${c.id}">↻ ${escapeHtml(t('start.reroll'))}</button>` : ''}
      </div>`;
    }).join('');
    vignette.textContent = caseVignette(instance(selected));
    el.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => {
      const on = (b.dataset.mode === 'exam') === exam;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    el.querySelector('.ss-mode-note')!.textContent = exam ? t('mode.examNote', { min: Math.round(EXAM.timeLimitS / 60) }) : t('mode.practiceNote');
    renderHistory();
    el.querySelector('.ss-chosen-title')!.textContent = caseTitle(selected);
  };
  const best = (id: string) => bestScore(initial.history, id);
  const historyList = el.querySelector<HTMLElement>('.ss-history-list')!;
  const renderHistory = () => {
    const date = new Intl.DateTimeFormat(langInfo().locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    historyList.innerHTML = initial.history.length
      ? initial.history
          .slice(0, 8)
          .map(
            (a) => `<li class="ss-attempt ${GRADE_CLASS[a.grade]}">
              <span class="ss-attempt-score mono">${a.score}</span>
              <span class="ss-attempt-main"><b>${escapeHtml(caseTitle(a.caseId))}</b>
                <small>${escapeHtml(variantLabel(a))} · ${escapeHtml(tk(`mode.${a.mode}`))} · ${escapeHtml(gradeLabel(a.grade))}</small></span>
              <span class="ss-attempt-date">${escapeHtml(date.format(a.at))}${
                a.replayId && initial.replays && loadStoredReplay(initial.replays.store, a.replayId)
                  ? `<span class="ss-attempt-actions"><button class="ss-mini" data-watch="${escapeHtml(a.replayId)}" title="${escapeHtml(t('replay.watch'))}">▶</button><button class="ss-mini" data-export="${escapeHtml(a.replayId)}" title="${escapeHtml(t('replay.export'))}">⬇</button></span>`
                  : ''
              }</span>
            </li>`,
          )
          .join('')
      : `<li class="ss-attempt-empty">${escapeHtml(t('start.historyEmpty'))}</li>`;
  };
  historyList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const w = target.closest<HTMLElement>('[data-watch]');
    const x = target.closest<HTMLElement>('[data-export]');
    if (w) initial.replays?.watch(w.dataset.watch!);
    if (x && initial.replays) {
      const f = loadStoredReplay(initial.replays.store, x.dataset.export!);
      if (f) downloadText(replayFileName(f.recording, f.info.at), JSON.stringify(f));
    }
  });
  const importError = el.querySelector<HTMLElement>('.ss-import-error')!;
  const showError = (msg: string | null) => {
    importError.hidden = !msg;
    importError.textContent = msg ?? '';
  };
  showError(initial.notice ?? null);
  el.querySelector<HTMLInputElement>('.ss-import input')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !initial.replays) return;
    // Size first: never read a huge file into memory.
    if (file.size > REPLAY_LIMITS.maxBytes) return showError(t('replay.bad'));
    showError(initial.replays.importFile(await file.text()));
  });
  el.querySelector('.ss-mode-toggle')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
    if (!b) return;
    exam = b.dataset.mode === 'exam';
    render();
  });
  grid.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const reroll = target.closest<HTMLElement>('[data-reroll]');
    if (reroll) {
      seeds.set(reroll.dataset.reroll!, randomSeed());
      selected = reroll.dataset.reroll!;
    } else {
      const card = target.closest<HTMLElement>('[data-case]');
      if (!card) return;
      selected = card.dataset.case!;
    }
    render();
  });
  grid.addEventListener('keydown', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-case]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selected = card.dataset.case!;
      render();
    }
  });

  el.querySelector('.ss-change')!.addEventListener('click', () => el.querySelector('.ss-cases')!.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  parent.appendChild(el);
  applyI18n(el);
  render();
  const off = onLanguageChange(render);

  return new Promise((resolve) => {
    const go = (mode: 'play' | 'demo') => {
      off();
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 450);
      const id = mode === 'demo' ? DEMO_CASE_ID : selected;
      resolve({ mode, caseId: id, seed: seeds.get(id) ?? 0, exam: mode === 'play' && exam });
    };
    el.querySelector('.ss-enter')!.addEventListener('click', () => go('play'));
    el.querySelector('.ss-demo')!.addEventListener('click', () => go('demo'));
  });
}
