import { applyI18n, detectLanguage, fmt, langInfo, onLanguageChange, readStoredLanguage, setLanguage, t, tk } from './i18n';
import { vesselName } from './tools/deviceController';
import * as THREE from 'three';
import './ui/styles.css';
import { FLUORO } from './config/anatomy';
import { buildVesselTree } from './anatomy/vesselTree';
import { MonitorAudio } from './audio/monitor';
import { buildDebrief } from './procedure/debrief';
import { Demo, type DemoHost } from './procedure/demo';
import { Session, type SessionStep } from './procedure/session';
import { buildSummary } from './procedure/summary';
import { Devices3D } from './scene/devices3d';
import { FluoroView } from './scene/fluoroView';
import { View3D } from './scene/view3d';
import { pushMessage, type MessageLevel } from './state/messages';
import { createSimStore } from './state/store';
import { HoverProbe } from './tools/hoverProbe';
import { toolByKey, type ToolId } from './tools/tools';
import { Checklist } from './ui/checklist';
import type { Actions, UiContext } from './ui/context';
import { DebriefView } from './ui/debrief';
import { DevicePanel } from './ui/devicePanel';
import { h, mmss, setText } from './ui/dom';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { Labels } from './ui/labels';
import { Mentor } from './ui/mentor';
import { Monitor } from './ui/monitor';
import { HelpOverlay, PauseOverlay } from './ui/overlays';
import { showStartScreen } from './ui/startScreen';
import { caseDef, caseFromQuery, caseQuery, DEFAULT_CASE_ID, instantiateCase } from './cases/cases';
import { caseParams, caseTitle } from './cases/caseText';
import { gradeLabel } from './procedure/debrief';
import { randomSeed, seedCode } from './cases/cases';
import { createRng } from './physics/ecg';
import { FIXED_DT, Recorder } from './replay/recording';
import { attemptId, KEEP_REPLAYS, LAST_REPLAY_KEY, loadStoredReplay, packReplay, parseReplayFile, pruneReplays, replayFileName, storeReplay, type ReplayFile } from './replay/files';
import { downloadText } from './ui/download';
import { ReplayPlayer, TimelineCollector } from './replay/replay';
import type { VesselId } from './anatomy/types';
import { ReplayBar, type ReplayControls } from './ui/replayBar';
import type { StartChoice } from './ui/startScreen';
import { isTimeUp, modeFromQuery, timeLevel, type PlayMode } from './exam/exam';
import { bestScore, browserStore, loadHistory, saveAttempt } from './exam/history';
import type { DebriefMeta } from './ui/debrief';
import type { ContrastPlan } from './physics/contrast';
import { Toasts } from './ui/toasts';
import { Toolbar } from './ui/toolbar';
import { isActive } from './procedure/xray';
import { isComplete } from './procedure/stages';

const app = document.getElementById('app')!;
const narrow = window.innerWidth <= 720;

// Language: saved choice, else the browser's (Spanish, Portuguese or English).
setLanguage(detectLanguage(readStoredLanguage(), navigator.languages ?? [navigator.language]));
document.documentElement.lang = langInfo().locale;

// --- Case: chosen on the start screen (a shared link preselects case and variant) ---
const attemptStore = browserStore();
let attempts = loadHistory(attemptStore);
/** sessionStorage of this tab (holds the last attempt's recording for "Watch replay"). */
function tabStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
const query = new URLSearchParams(location.search);
// Replay mode: re-run the last recorded attempt instead of starting a new case.
// ?replay=last → this tab's last attempt; ?replay=<id> → a replay kept with an attempt.
const replaySrc = query.get('replay');
function readReplay(src: string): ReplayFile | null {
  if (src === 'last') {
    const r = parseReplayFile(tabStore()?.getItem(LAST_REPLAY_KEY) ?? '');
    return r.ok ? r.file : null;
  }
  return loadStoredReplay(attemptStore, src);
}
const replayFile = replaySrc ? readReplay(replaySrc) : null;
const replayRec = replayFile?.recording ?? null;
const choice: StartChoice = replayRec
  ? { mode: 'play', caseId: replayRec.caseId, seed: replayRec.seed, exam: replayRec.exam }
  : await showStartScreen(app, {
      ...(caseFromQuery(location.search) ?? { caseId: DEFAULT_CASE_ID, seed: 0 }),
      exam: modeFromQuery(location.search) === 'exam',
      history: attempts,
      notice: replaySrc ? t('replay.missing') : null,
      replays: {
        store: attemptStore,
        watch: (id) => (window.location.href = `${location.pathname}?replay=${encodeURIComponent(id)}`),
        importFile(text) {
          const r = parseReplayFile(text);
          if (!r.ok) return t('replay.bad');
          try {
            tabStore()?.setItem(LAST_REPLAY_KEY, text);
          } catch {
            return t('replay.bad');
          }
          window.location.href = `${location.pathname}?replay=last`;
          return null;
        },
      },
    });
const mode: PlayMode = choice.exam ? 'exam' : 'practice';
const caseInstance = instantiateCase(caseDef(choice.caseId), choice.seed);
const caseUrl = `${location.pathname}${caseQuery(caseInstance)}${choice.exam ? '&mode=exam' : ''}`;
if (!replayRec) history.replaceState(null, '', caseUrl);

// --- Scene -------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.domElement.className = 'gl-canvas';
app.appendChild(renderer.domElement);

const tree = buildVesselTree(caseInstance.lesion, caseInstance.setup);
// A seeded RNG and a fixed step make every attempt reproducible from its recording.
const rngSeed = randomSeed();
const recorder = replayRec ? null : new Recorder(FIXED_DT);
const player = replayRec ? new ReplayPlayer(tree, replayRec) : null;
const session = player ? player.session : new Session(tree, createRng(rngSeed), recorder);
const ctrl = session.ctrl;
const view = new View3D(tree, renderer.domElement);
const labels = new Labels(app, view.labelAnchors(), view.camera, view.heart, () => caseParams(caseInstance));
const devices = new Devices3D(view, ctrl);
const fluoro = new FluoroView(tree, ctrl, [view.scene]);
const store = createSimStore(narrow);
const input = new Input();
const audio = new MonitorAudio();
const probe = new HoverProbe(tree, view.camera, () => [...view.vesselMeshes.values()].filter((m) => m.vessel.beats).map((m) => m.mesh));

function say(text: string, level: MessageLevel = 'info'): void {
  store.update((s) => (s.messages = pushMessage(s.messages, { text, level, time: session.time })));
}

// --- Actions -------------------------------------------------------------------
const actions: Actions = {
  selectTool(tool: ToolId) {
    if (player) return;
    const a = session.selectTool(tool);
    if (!a.ok) return;
    if (tool === 'wire' || tool === 'balloon' || tool === 'stent' || tool === 'measure' || tool === 'ffr' || tool === 'imaging') {
      const l = tree.lesion;
      view.focusOn(l.vessel, l.centreArc, 110);
    }
    if (tool === 'guide') view.orbit.focus(view.homeTarget, view.homeDistance(app.clientWidth / app.clientHeight));
    if (tool === 'measure' && session.qca) {
      const q = session.qca;
      say(t('msg.qca', { ref: fmt(q.referenceDiameter, 2), mld: fmt(q.mld, 2), ds: fmt(q.ds * 100, 0), len: fmt(q.lesionLength, 1) }), 'ok');
    }
  },
  inject: () => void (!player && session.selectTool('contrast')),
  heparin: () => void (!player && session.heparin()),
  defer: () => void (!player && session.defer()),
  pullback: (m) => void (!player && session.pullback(m)),
  setBalloonType(nc) {
    if (player) return;
    const m = session.setBalloonType(nc);
    if (m) say(m.text, m.level);
  },
  setSize(d, l) {
    if (player) return;
    const m = session.setSize(d, l);
    if (m) say(m.text, m.level);
  },
  toggleView: () => store.update((s) => (s.view = s.view === '3d' ? 'fluoro' : '3d')),
  toggleSound: () =>
    store.update((s) => {
      s.sound = !s.sound;
      audio.enabled = s.sound;
    }),
  togglePause: () =>
    store.update((s) => {
      if (s.phase === 'running') s.phase = 'paused';
      else if (s.phase === 'paused') s.phase = 'running';
    }),
  toggleHelp: () => store.update((s) => (s.help = !s.help)),
  toggleMentor: () => store.update((s) => (s.mentorOpen = !s.mentorOpen)),
  nextPreset: () => void (!player && session.nextPreset()),
  endCase() {
    store.update((s) => (s.phase = 'debrief'));
    const d = buildDebrief(buildSummary(session));
    // Keep the latest recording of this attempt for "Watch replay" and export.
    if (recorder) {
      const rec = recorder.finish({ caseId: caseInstance.caseId, seed: caseInstance.seed, rngSeed, exam: choice.exam });
      lastReplay = packReplay(rec, { score: d.score, grade: d.grade, mode, durationS: session.time, at: Date.now() });
      try {
        tabStore()?.setItem(LAST_REPLAY_KEY, lastReplay);
      } catch {
        /* too big or blocked: watching the replay is not offered */
      }
    }
    // The first debrief of a case is the attempt; "keep exploring" afterwards is not re-recorded.
    if (!debriefMeta && !player) {
      const replayId = lastReplay ? attemptId(Date.now()) : undefined;
      if (replayId && lastReplay && !storeReplay(attemptStore, replayId, lastReplay)) lastReplayStored = false;
      const previousBest = bestScore(attempts, caseInstance.caseId, mode);
      attempts = saveAttempt(attemptStore, {
        caseId: caseInstance.caseId,
        seed: caseInstance.seed,
        mode,
        score: d.score,
        grade: d.grade,
        durationS: session.time,
        at: Date.now(),
        ...(replayId && lastReplayStored ? { replayId } : {}),
      });
      // Keep replays only for the newest attempts.
      const withReplay = attempts.filter((a) => a.replayId).map((a) => a.replayId!);
      pruneReplays(attemptStore, withReplay, new Set(withReplay.slice(0, KEEP_REPLAYS)));
      debriefMeta = { mode, durationS: session.time, previousBest, score: d.score };
    }
    debrief.show(d, debriefMeta);
  },
  keepExploring() {
    debrief.hide();
    store.update((s) => (s.phase = 'running'));
  },
  // New case: back to the start screen; retry: same case and variant (kept in the URL).
  newCase: () => (window.location.href = window.location.pathname),
  retryCase: () => (window.location.href = caseUrl),
  watchReplay: () => (window.location.href = `${window.location.pathname}?replay=last`),
  exportReplay() {
    const text = player ? JSON.stringify(replayFile) : lastReplay;
    const rec = player ? replayRec : null;
    if (!text) return;
    const parsed = parseReplayFile(text);
    if (parsed.ok) downloadText(replayFileName(rec ?? parsed.file.recording, parsed.file.info.at), text);
  },
};
let debriefMeta: DebriefMeta | null = null;
/** The last attempt's replay file (JSON), once the case has been ended. */
let lastReplay: string | null = null;
let lastReplayStored = true;
const ctx: UiContext = { session, store, input, actions, caseInstance };
store.update((s) => {
  s.exam = choice.exam;
  s.replay = !!player;
});

// --- UI ------------------------------------------------------------------------
const hud = h('div', 'hud');
const left = h('div', 'col col-left');
const right = h('div', 'col col-right');
const topbar = new Hud(ctx);
const checklist = new Checklist(ctx);
const mentor = new Mentor(ctx);
const monitor = new Monitor(ctx);
const device = new DevicePanel(ctx);
const toolbar = new Toolbar(ctx);
const toasts = new Toasts();
const pause = new PauseOverlay(ctx);
const help = new HelpOverlay(ctx);
const debrief = new DebriefView(ctx);
const probeTip = h('div', 'probe-tip mono');
left.append(checklist.el, device.el);
right.append(mentor.el, monitor.el);
hud.append(topbar.el, left, right, toasts.el, toolbar.el);
// On phones in portrait, messages sit just above the device panel instead of over the heart.
const phonePortrait = window.matchMedia('(max-width: 720px) and (orientation: portrait)');
const placeToasts = () => {
  if (phonePortrait.matches) left.prepend(toasts.el);
  else if (toasts.el.parentElement !== hud) hud.insertBefore(toasts.el, toolbar.el);
};
phonePortrait.addEventListener('change', placeToasts);
placeToasts();
const overlay = h('div', 'fluoro-overlay mono', '<div class="fo-tl"></div><div class="fo-tr"></div><div class="fo-bl"></div><div class="fo-br"></div>');
app.append(overlay, hud, probeTip, pause.el, help.el, debrief.el);

// --- Replay player -----------------------------------------------------------------
let replayPlaying = true;
let replaySpeed = 1;
let replayEnded = false;

/** Run the recording forward without drawing, then bring meshes and fluoro up to date. */
function fastForward(target: number): void {
  if (!player) return;
  const changed = new Set<VesselId>();
  while (player.tick < target) {
    const r = player.step();
    if (!r) break;
    r.lumenChanged.forEach((v) => changed.add(v));
  }
  changed.forEach((v) => view.rebuildVessel(v));
  devices.update();
  fluoro.refreshAttributes();
}

const replayControls: ReplayControls = {
  togglePlay() {
    if (replayEnded) return replayControls.restart();
    replayPlaying = !replayPlaying;
  },
  setSpeed: (speed) => (replaySpeed = speed),
  seek(tick) {
    if (!player) return;
    const target = Math.max(0, Math.min(player.total, Math.round(tick)));
    // Going back means re-running from the start: reload and fast-forward to the target.
    if (target < player.tick) window.location.href = `${window.location.pathname}?replay=${encodeURIComponent(replaySrc ?? 'last')}&at=${target}`;
    else fastForward(target);
  },
  restart: () => (window.location.href = `${window.location.pathname}?replay=${encodeURIComponent(replaySrc ?? 'last')}`),
  export: () => actions.exportReplay(),
  exit: () => (window.location.href = caseUrl),
};

const replayLabel = replayFile
  ? t('replay.of', {
      title: caseTitle(caseInstance.caseId),
      variant: caseInstance.seed ? seedCode(caseInstance.seed) : t('db.refVariant'),
      mode: tk(`mode.${replayFile.info.mode}`),
      score: replayFile.info.score,
      grade: gradeLabel(replayFile.info.grade),
    })
  : '';
const replayBar = player && replayRec ? new ReplayBar(replayControls, replayRec.dt, player.total, replayLabel) : null;
if (player && replayRec && replayBar) {
  document.body.classList.add('replaying');
  hud.append(replayBar.el);
  const at = Number(query.get('at') ?? 0);
  if (at > 0) fastForward(at);
  // Find the key moments in the background, a few thousand ticks per frame.
  const collector = new TimelineCollector(() => buildVesselTree(caseInstance.lesion, caseInstance.setup), replayRec);
  const work = () => {
    if (collector.run(4000)) replayBar.setMarkers(collector.markers);
    else setTimeout(work, 0);
  };
  setTimeout(work, 50);
}

// Debug handle for automated checks during development.
if (import.meta.env.DEV) (window as unknown as { __lab: unknown }).__lab = { view, ctrl, session, fluoro, store, input, actions, THREE, demo: () => demo };

// Live language switch: static markup, 3D labels, projection text and an open debrief.
onLanguageChange(() => {
  document.documentElement.lang = langInfo().locale;
  applyI18n(document.body);
  labels.translate();
  if (debrief.visible) debrief.show(buildDebrief(buildSummary(session)), debriefMeta);
});

function resize(): void {
  const w = app.clientWidth;
  const hh = app.clientHeight;
  renderer.setSize(w, hh);
  view.camera.aspect = w / hh;
  view.camera.updateProjectionMatrix();
  view.orbit.focus(view.homeTarget, view.homeDistance(w / hh));
  fluoro.invalidate();
  const side = Math.min(w, hh) * FLUORO.collimation;
  overlay.style.width = overlay.style.height = `${side}px`;
}
window.addEventListener('resize', resize);
resize();

// --- Demo ------------------------------------------------------------------------
let demo: Demo | null = null;
/** The case completed while the demo was still narrating: open the debrief when it ends. */
let debriefAfterDemo = false;
const demoHost: DemoHost = {
  session,
  selectTool: (t) => actions.selectTool(t),
  setSize: (d, l) => actions.setSize(d, l),
  inject: () => actions.inject(),
  heparin: () => actions.heparin(),
  nextPreset: () => actions.nextPreset(),
  setView: (v) => store.update((s) => (s.view = v)),
};

function startDemo(): void {
  demo = new Demo(demoHost);
  store.update((s) => (s.demo = true));
  say(t('msg.demoRunning'), 'info');
}

/** Any key, click or wheel by the user hands control back. */
function stopDemo(message: string): void {
  if (!demo) return;
  demo = null;
  input.auto = null;
  mentor.narration = '';
  store.update((s) => (s.demo = false));
  say(message, 'ok');
  if (debriefAfterDemo) {
    debriefAfterDemo = false;
    setTimeout(() => store.get().phase === 'running' && actions.endCase(), 1500);
  }
}

// --- Input -----------------------------------------------------------------------
const running = () => store.get().phase === 'running';

window.addEventListener('keydown', (e) => {
  input.shift = e.shiftKey;
  const k = e.key.toLowerCase();
  const ui = store.get();
  if (ui.phase === 'start') return;
  if (demo) {
    e.preventDefault();
    return stopDemo(t('msg.takeover'));
  }
  if (k === 'tab' || k === ' ' || k.startsWith('arrow')) e.preventDefault();
  if (player) {
    // Replaying: only viewing keys; Space plays/pauses, ←/→ jump 5 s.
    if (k === ' ') replayControls.togglePlay();
    else if (k === 'arrowright') replayControls.seek(player.tick + Math.round(5 / FIXED_DT));
    else if (k === 'arrowleft') replayControls.seek(Math.max(0, player.tick - Math.round(5 / FIXED_DT)));
    else if (k === 'tab') actions.toggleView();
    else if (k === 'l') store.update((s) => (s.labels = !s.labels));
    else if (k === 'f') store.update((s) => (s.follow = !s.follow));
    else if (k === 'm') actions.toggleMentor();
    else if (k === 'n') actions.toggleSound();
    else if (k === 'h') actions.toggleHelp();
    else if (k === 'escape' && ui.help) actions.toggleHelp();
    return;
  }
  if (k === 'escape') {
    if (ui.help) actions.toggleHelp();
    else actions.togglePause();
    return;
  }
  if (k === 'h') return actions.toggleHelp();
  if (!running()) return;
  input.keys.add(k);
  if (e.repeat) return;
  const tool = toolByKey(k);
  if (tool && tool.id !== 'fluoro') actions.selectTool(tool.id);
  if (k === 'c') actions.inject();
  if (k === 'tab') actions.toggleView();
  if (k === 'v') session.nextPreset();
  if (k === 'arrowleft') session.nudgeCarm(-1, 0);
  if (k === 'arrowright') session.nudgeCarm(1, 0);
  if (k === 'arrowup') session.nudgeCarm(0, 1);
  if (k === 'arrowdown') session.nudgeCarm(0, -1);
  if (k === 'l') store.update((s) => (s.labels = !s.labels));
  if (k === 'f') store.update((s) => (s.follow = !s.follow));
  if (k === 'm') actions.toggleMentor();
  if (k === 'n') actions.toggleSound();
  if (k === 'g') actions.heparin();
});
window.addEventListener('keyup', (e) => {
  input.shift = e.shiftKey;
  input.keys.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => input.clear());
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    if (player) return;
    if (demo) return stopDemo(t('msg.takeover'));
    if (e.ctrlKey || !running()) return;
    e.preventDefault();
    input.wheel += e.deltaY < 0 ? 1 : -1;
  },
  { passive: false },
);
document.addEventListener(
  'pointerdown',
  (e) => {
    audio.unlock();
    // Clicks inside the debrief belong to its own buttons.
    if (demo && !(e.target as HTMLElement).closest('.start-screen, .debrief')) stopDemo(t('msg.takeover'));
  },
  { capture: true },
);

renderer.domElement.addEventListener('pointermove', (e) => {
  const ui = store.get();
  if (session.tool !== 'measure' || ui.view !== '3d') {
    probeTip.hidden = true;
    return;
  }
  const r = probe.read(e.clientX, e.clientY, renderer.domElement.getBoundingClientRect());
  probeTip.hidden = !r;
  if (!r) return;
  probeTip.textContent = t('probe', { vessel: vesselName(r.vessel), arc: fmt(r.arc, 0), d: fmt(r.diameter, 2), ref: fmt(r.reference, 2) });
  probeTip.style.left = `${Math.min(window.innerWidth - 220, e.clientX + 14)}px`;
  probeTip.style.top = `${e.clientY + 14}px`;
});
renderer.domElement.addEventListener('pointerleave', () => (probeTip.hidden = true));

// --- Start -----------------------------------------------------------------------
audio.unlock();
store.update((s) => (s.phase = 'running'));
hud.classList.add('visible');
if (choice.mode === 'demo') startDemo();
else if (choice.exam) say(t('exam.rules'), 'info');
else say(t('msg.start'), 'info');

// --- Loop --------------------------------------------------------------------------
function renderOverlay(): void {
  const mode = session.xray.mode;
  setText(overlay.querySelector('.fo-tl')!, session.projectionName);
  const tr = overlay.querySelector('.fo-tr')!;
  setText(tr, mode === 'off' ? t('fo.off') : mode === 'lih' ? t('fo.lih') : `${t(mode === 'cine' ? 'fo.cine' : 'fo.fluoro')} ${FLUORO.pulseFps} fps`);
  tr.classList.toggle('live', isActive(mode));
  setText(overlay.querySelector('.fo-bl')!, `${t('fo.fl')} ${mmss(session.xray.fluoroS)} · ${session.contrastMl} ml`);
  setText(overlay.querySelector('.fo-br')!, mode === 'off' && !session.xray.hasImage ? t('fo.hold') : '');
}

let shownPlan: ContrastPlan | null = null;
let acc = 0;
let warnedTwoMin = false;
const timer = new THREE.Timer();
const tipV = new THREE.Vector3();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta());
  const ui = store.get();
  const live = ui.phase === 'running';

  if (live) {
    // Fixed-step simulation: the same ticks a recording will replay.
    const advancing = !player || (replayPlaying && !replayEnded);
    acc = advancing ? Math.min(acc + dt * (player ? replaySpeed : 1), 0.5) : 0;
    const changed = new Set<VesselId>();
    let pulse = false;
    let planChanged = false;
    while (acc >= FIXED_DT && store.get().phase === 'running') {
      acc -= FIXED_DT;
      let res: SessionStep | null;
      if (player) {
        res = player.step();
        if (!res) {
          replayEnded = true;
          replayPlaying = false;
          say(t('replay.end'), 'info');
          actions.endCase();
          break;
        }
      } else {
        if (demo) {
          input.auto = demo.update(FIXED_DT);
          mentor.narration = demo.narration;
          if (demo.finished) stopDemo(t('msg.demoDone'));
        }
        const { device: di, pedal } = input.read();
        res = session.step(FIXED_DT, di, pedal);
      }
      for (const m of res.messages) say(m.text, m.level);
      res.lumenChanged.forEach((v) => changed.add(v));
      pulse ||= res.pulse;
      planChanged ||= res.planChanged;
      for (const e of res.progress) if (e.type === 'stage') say(t('msg.stepDone', { n: e.stage + 1 }), 'ok');
      if (player) continue;
      if (choice.exam) {
        const level = timeLevel(session.time);
        if (level === 'warn' && !warnedTwoMin) {
          warnedTwoMin = true;
          say(t('exam.twoMin'), 'warn');
        }
        if (isTimeUp(session.time)) {
          say(t('exam.timeUp'), 'danger');
          actions.endCase();
        }
      }
      // Open the debrief once, a moment after the last stage completes.
      if (isComplete(session.progress) && !store.get().autoDebriefShown) {
        store.update((s) => (s.autoDebriefShown = true));
        if (demo) debriefAfterDemo = true;
        else setTimeout(() => store.get().phase === 'running' && actions.endCase(), 2500);
      }
    }
    changed.forEach((v) => view.rebuildVessel(v));
    devices.update();
    // Show a new contrast plan whenever the session has one we have not drawn yet.
    const plan = session.injection?.plan ?? null;
    if (planChanged || plan !== shownPlan) {
      shownPlan = plan;
      fluoro.setPlan(plan, session.injection?.start ?? 0);
    } else if (changed.size > 0) fluoro.refreshAttributes();
    if (pulse) {
      fluoro.setProjection(session.projection);
      fluoro.acquire(renderer, session.time);
    }
  }
  replayBar?.update(player?.tick ?? 0, replayPlaying && !replayEnded, replaySpeed);
  if (ui.follow && live) view.orbit.focus(devices.tipWorld(tipV));
  view.update(live || ui.phase === 'start' ? dt : 0, session.physiology.hr);

  const show3d = ui.view === '3d';
  overlay.style.display = show3d ? 'none' : '';
  labels.setVisible(show3d && ui.labels);
  document.body.dataset.tool = session.tool;
  document.body.dataset.view = ui.view;
  if (show3d) {
    renderer.render(view.scene, view.camera);
    labels.update(app.clientWidth, app.clientHeight);
  } else fluoro.display(renderer);

  if (ui.phase !== 'start') {
    topbar.update();
    checklist.update();
    mentor.update();
    device.update();
    toolbar.update();
    toasts.update(ui.messages, session.time);
    renderOverlay();
    const beats = monitor.update(dt, live);
    for (const b of beats) audio.beep(session.physiology.spo2, b.pvc);
    audio.alarm(live && session.physiology.unstable, dt);
  }
  pause.update(ui.phase === 'paused');
  help.update(ui.help);
});
