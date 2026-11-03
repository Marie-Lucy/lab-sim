import { caseTitle, caseVignette } from '../cases/caseText';
import { applyI18n, t } from '../i18n';
import { remainingS, timeLevel } from '../exam/exam';
import { mentorHint } from '../procedure/mentorHints';
import { stageProgressFraction } from '../procedure/stages';
import type { UiContext } from './context';
import { escapeHtml, h, mmss, setHtml, setText } from './dom';

/** Mentor: step title, goal, sub-tasks, progress, a calm situational hint and "Why this step?". */
export class Mentor {
  readonly el = h('div', 'panel mentor');
  private readonly title: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly tasks: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly why: HTMLElement;
  private readonly badge: HTMLElement;
  private lastStage = -1;
  narration = '';

  constructor(private readonly ctx: UiContext) {
    this.el.innerHTML = `
      <div class="mentor-head">
        <span class="mentor-badge" data-i18n="mentor.badge"></span>
        <span class="mentor-badge demo" hidden data-i18n="demo.badge"></span>
        <span class="mentor-stage"></span>
        <span class="mentor-pct mono"></span>
        <button class="mentor-toggle" data-i18n-title="mentor.toggle">–</button>
      </div>
      <div class="mentor-bar"><div></div></div>
      <div class="exam-body">
        <div class="exam-clock"><span class="exam-left-lbl" data-i18n="exam.left"></span><span class="exam-left mono"></span></div>
        <p class="exam-rules" data-i18n="exam.rules"></p>
        <p class="exam-vignette"></p>
      </div>
      <div class="mentor-body">
        <details class="mentor-patient"><summary><span data-i18n="mentor.patient"></span> · <span class="mp-title"></span></summary><p></p></details>
        <p class="mentor-goal"></p>
        <ul class="mentor-tasks"></ul>
        <p class="mentor-hint"></p>
        <details class="mentor-why"><summary data-i18n="mentor.why"></summary><p></p></details>
      </div>`;
    applyI18n(this.el);
    this.title = this.el.querySelector('.mentor-stage')!;
    this.pct = this.el.querySelector('.mentor-pct')!;
    this.bar = this.el.querySelector('.mentor-bar > div')!;
    this.goal = this.el.querySelector('.mentor-goal')!;
    this.tasks = this.el.querySelector('.mentor-tasks')!;
    this.hint = this.el.querySelector('.mentor-hint')!;
    this.why = this.el.querySelector('.mentor-why p')!;
    this.badge = this.el.querySelector('.mentor-badge.demo')!;
    this.el.querySelector('.mentor-toggle')!.addEventListener('click', () => ctx.actions.toggleMentor());
  }

  update(): void {
    const s = this.ctx.session;
    const ui = this.ctx.store.get();
    const p = s.progress;
    const st = p.plan[p.stage];
    // Exam: the panel becomes a clock and the patient's vignette — no goal, tasks or hints.
    this.el.classList.toggle('exam', ui.exam);
    if (ui.exam) {
      setText(this.el.querySelector('.mentor-badge')!, t('exam.badge'));
      setText(this.title, caseTitle(this.ctx.caseInstance.caseId));
      setText(this.pct, '');
      const left = this.el.querySelector<HTMLElement>('.exam-left')!;
      setText(left, mmss(remainingS(s.time)));
      left.className = `exam-left mono ${timeLevel(s.time)}`;
      setText(this.el.querySelector('.exam-vignette')!, caseVignette(this.ctx.caseInstance));
      this.el.classList.toggle('collapsed', !ui.mentorOpen);
      return;
    }
    setText(this.el.querySelector('.mp-title')!, caseTitle(this.ctx.caseInstance.caseId));
    setText(this.el.querySelector('.mentor-patient p')!, caseVignette(this.ctx.caseInstance));
    this.el.classList.toggle('collapsed', !ui.mentorOpen);
    setText(this.el.querySelector('.mentor-toggle')!, ui.mentorOpen ? '–' : '+');
    this.badge.hidden = !ui.demo && !ui.replay;
    setText(this.badge, t(ui.replay ? 'replay.badge' : 'demo.badge'));
    setText(this.title, st ? `${p.stage + 1}/${p.plan.length} · ${st.title}` : t('mentor.complete'));
    const f = stageProgressFraction(p);
    setText(this.pct, `${Math.round(f * 100)}%`);
    this.bar.style.width = `${f * 100}%`;
    setText(this.goal, st ? st.goal : t('mentor.completeGoal'));
    setHtml(
      this.tasks,
      st ? st.tasks.map((t) => `<li class="${p.done.has(t.id) ? 'ok' : ''}"><span class="box">${p.done.has(t.id) ? '✓' : ''}</span>${escapeHtml(t.label)}</li>`).join('') : '',
    );
    const hint = ui.demo && this.narration ? { text: this.narration, level: 'info' as const } : mentorHint(s);
    setText(this.hint, hint.text);
    this.hint.className = `mentor-hint ${hint.level}`;
    setText(this.why, st ? st.why : t('mentor.completeWhy'));
    if (p.stage !== this.lastStage) {
      if (this.lastStage >= 0) {
        this.el.classList.remove('pulse');
        void this.el.offsetWidth;
        this.el.classList.add('pulse');
      }
      this.lastStage = p.stage;
    }
  }
}
