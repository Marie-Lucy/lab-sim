import { CASES, seedCode } from '../cases/cases';
import type { Grade } from '../procedure/debrief';
import type { PlayMode } from '../exam/exam';
import { TOOLS } from '../tools/tools';
import type { Recording, ReplayAction, Run } from './recording';

/** What the attempt scored, carried with an exported replay so the viewer can see it. */
export interface ReplayInfo {
  readonly score: number;
  readonly grade: Grade;
  readonly mode: PlayMode;
  readonly durationS: number;
  /** Epoch milliseconds. */
  readonly at: number;
}

/** A replay file: app tag, format version, the recording and the attempt's result. */
export interface ReplayFile {
  readonly app: 'lab-theme';
  readonly kind: 'replay';
  readonly version: 1;
  readonly recording: Recording;
  readonly info: ReplayInfo;
}

/** Limits that keep an untrusted file from freezing the browser. */
export const REPLAY_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  /** One hour of simulation at 60 ticks/s. */
  maxTicks: 60 * 60 * 60,
  maxRuns: 200_000,
  maxActionsPerRun: 50,
} as const;

export type ReplayError = 'json' | 'format' | 'case' | 'runs' | 'tooLong' | 'tooBig';

const GRADES: readonly Grade[] = ['Excellent', 'Good', 'Acceptable', 'Needs work', 'Incomplete'];
const TOOL_IDS = new Set<string>(TOOLS.map((t) => t.id));
/** advance, rotate ∈ {-1,0,1}; fine 0/1; wheel integer; inflate, deflate, pedal 0/1. */
const INPUT_CODE = /^-?[01],-?[01],[01],-?\d{1,3},[01],[01],[01]$/;

const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function validAction(a: unknown): a is ReplayAction {
  const x = a as Record<string, unknown>;
  if (!x || typeof x !== 'object') return false;
  switch (x.k) {
    case 'tool':
      return typeof x.tool === 'string' && TOOL_IDS.has(x.tool);
    case 'size':
      return isNum(x.d) && isNum(x.l) && x.d > 0 && x.d < 10 && x.l > 0 && x.l < 100;
    case 'heparin':
    case 'preset':
    case 'defer':
      return true;
    case 'balloonType':
      return typeof x.nc === 'boolean';
    case 'pullback':
      return x.m === 'ivus' || x.m === 'oct';
    case 'nudge':
      return isInt(x.lao, -1, 1) && isInt(x.cra, -1, 1);
    default:
      return false;
  }
}

function validRun(r: unknown): r is Run {
  if (!Array.isArray(r) || r.length < 2 || r.length > 3) return false;
  const [count, code, actions] = r as [unknown, unknown, unknown];
  if (!isInt(count, 1, REPLAY_LIMITS.maxTicks) || typeof code !== 'string' || !INPUT_CODE.test(code)) return false;
  if (actions === undefined) return true;
  return Array.isArray(actions) && actions.length <= REPLAY_LIMITS.maxActionsPerRun && actions.every(validAction);
}

/** Serialize a replay for download. */
export function packReplay(recording: Recording, info: ReplayInfo): string {
  const file: ReplayFile = { app: 'lab-theme', kind: 'replay', version: 1, recording, info };
  return JSON.stringify(file);
}

/**
 * Parse and strictly validate a replay file (untrusted input): structure, known case,
 * valid input codes and actions, and size / duration limits. Nothing is executed before
 * this passes.
 */
export function parseReplayFile(text: string): { ok: true; file: ReplayFile } | { ok: false; error: ReplayError } {
  if (text.length > REPLAY_LIMITS.maxBytes) return { ok: false, error: 'tooBig' };
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  const f = x as Record<string, unknown>;
  if (!f || f.app !== 'lab-theme' || f.kind !== 'replay' || f.version !== 1) return { ok: false, error: 'format' };
  const rec = f.recording as Record<string, unknown> | undefined;
  const info = f.info as Record<string, unknown> | undefined;
  if (!rec || rec.v !== 1 || !info) return { ok: false, error: 'format' };
  if (typeof rec.caseId !== 'string' || !CASES.some((c) => c.id === rec.caseId)) return { ok: false, error: 'case' };
  if (!isInt(rec.seed, 0, 36 ** 6) || !isInt(rec.rngSeed, 0, 2 ** 32) || typeof rec.exam !== 'boolean') return { ok: false, error: 'format' };
  if (!isNum(rec.dt) || rec.dt <= 0 || rec.dt > 0.1) return { ok: false, error: 'format' };
  if (!Array.isArray(rec.runs) || rec.runs.length > REPLAY_LIMITS.maxRuns || !rec.runs.every(validRun)) return { ok: false, error: 'runs' };
  const ticks = (rec.runs as Run[]).reduce((n, r) => n + r[0], 0);
  if (ticks > REPLAY_LIMITS.maxTicks) return { ok: false, error: 'tooLong' };
  if (
    !isInt(info.score, 0, 100) ||
    !GRADES.includes(info.grade as Grade) ||
    (info.mode !== 'practice' && info.mode !== 'exam') ||
    !isNum(info.durationS) ||
    !isNum(info.at)
  )
    return { ok: false, error: 'format' };
  return { ok: true, file: x as ReplayFile };
}

/** e.g. lab-theme-longLad-6Y6J-2026-10-31.json */
export function replayFileName(rec: Pick<Recording, 'caseId' | 'seed'>, at: number): string {
  const d = new Date(at);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `lab-theme-${rec.caseId}${rec.seed ? `-${seedCode(rec.seed)}` : ''}-${day}.json`;
}

// --- Replays kept with attempts in the browser ----------------------------------------

/** sessionStorage key of the last attempt's replay file (for "Watch replay" in this tab). */
export const LAST_REPLAY_KEY = 'labtheme.lastReplay';

export interface KeyValue {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const replayKey = (id: string) => `labtheme.replay.${id}`;
/** Replays are kept for this many of the newest attempts. */
export const KEEP_REPLAYS = 10;

/** A short unique id for an attempt. */
export function attemptId(now: number, rand: () => number = Math.random): string {
  return `${now.toString(36)}${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

export function storeReplay(store: KeyValue | null, id: string, file: string): boolean {
  try {
    store?.setItem(replayKey(id), file);
    return !!store;
  } catch {
    return false;
  }
}

export function loadStoredReplay(store: KeyValue | null, id: string): ReplayFile | null {
  try {
    const r = parseReplayFile(store?.getItem(replayKey(id)) ?? '');
    return r.ok ? r.file : null;
  } catch {
    return null;
  }
}

/** Delete stored replays of attempts that are not among `keepIds`. */
export function pruneReplays(store: KeyValue | null, allIds: readonly string[], keepIds: ReadonlySet<string>): void {
  for (const id of allIds) {
    if (keepIds.has(id)) continue;
    try {
      store?.removeItem(replayKey(id));
    } catch {
      /* ignore */
    }
  }
}
