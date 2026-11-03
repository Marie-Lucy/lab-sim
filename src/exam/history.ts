import { EXAM } from '../config/anatomy';
import type { Grade } from '../procedure/debrief';
import type { PlayMode } from './exam';

/** One finished (or ended) case, as stored in the browser. */
export interface Attempt {
  readonly caseId: string;
  readonly seed: number;
  readonly mode: PlayMode;
  readonly score: number;
  readonly grade: Grade;
  /** Simulated seconds from the start to the debrief. */
  readonly durationS: number;
  /** Epoch milliseconds. */
  readonly at: number;
  /** Id of the replay stored with this attempt (kept for the newest attempts only). */
  readonly replayId?: string;
}

/** The part of Web Storage the history needs (injected so tests need no browser). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HISTORY_KEY = 'labtheme.attempts';

const GRADES: readonly Grade[] = ['Excellent', 'Good', 'Acceptable', 'Needs work', 'Incomplete'];

function isAttempt(x: unknown): x is Attempt {
  const a = x as Attempt;
  return (
    !!a &&
    typeof a.caseId === 'string' &&
    typeof a.seed === 'number' &&
    (a.mode === 'practice' || a.mode === 'exam') &&
    typeof a.score === 'number' &&
    GRADES.includes(a.grade) &&
    typeof a.durationS === 'number' &&
    typeof a.at === 'number' &&
    (a.replayId === undefined || typeof a.replayId === 'string')
  );
}

/** Stored attempts, newest first; anything unreadable is ignored rather than thrown. */
export function loadHistory(store: KeyValueStore | null): Attempt[] {
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(isAttempt) : [];
  } catch {
    return [];
  }
}

/** Prepend an attempt and keep the newest `historySize`. Returns the new history. */
export function saveAttempt(store: KeyValueStore | null, attempt: Attempt): Attempt[] {
  const next = [attempt, ...loadHistory(store)].slice(0, EXAM.historySize);
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the history simply is not kept */
  }
  return next;
}

/** Best score on a case (optionally one mode), or null if never played. */
export function bestScore(history: readonly Attempt[], caseId: string, mode?: PlayMode): number | null {
  const scores = history.filter((a) => a.caseId === caseId && (!mode || a.mode === mode)).map((a) => a.score);
  return scores.length ? Math.max(...scores) : null;
}

/** The browser's localStorage, or null when it is unavailable (private mode, blocked). */
export function browserStore(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__labtheme_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
