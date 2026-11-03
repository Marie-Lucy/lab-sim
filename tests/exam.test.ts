import { describe, expect, it } from 'vitest';
import { EXAM } from '../src/config/anatomy';
import { isTimeUp, modeFromQuery, remainingS, timeLevel } from '../src/exam/exam';
import { bestScore, HISTORY_KEY, loadHistory, saveAttempt, type Attempt, type KeyValueStore } from '../src/exam/history';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const attempt = (over: Partial<Attempt> = {}): Attempt => ({
  caseId: 'midLad',
  seed: 42,
  mode: 'exam',
  score: 80,
  grade: 'Good',
  durationS: 300,
  at: 1_700_000_000_000,
  ...over,
});

describe('exam clock', () => {
  it('counts down from the limit and never goes negative', () => {
    expect(remainingS(0)).toBe(EXAM.timeLimitS);
    expect(remainingS(100)).toBe(EXAM.timeLimitS - 100);
    expect(remainingS(EXAM.timeLimitS + 50)).toBe(0);
    expect(isTimeUp(EXAM.timeLimitS - 0.1)).toBe(false);
    expect(isTimeUp(EXAM.timeLimitS)).toBe(true);
  });

  it('warns in the last two minutes', () => {
    expect(timeLevel(0)).toBe('ok');
    expect(timeLevel(EXAM.timeLimitS - EXAM.warnRemainingS)).toBe('warn');
    expect(timeLevel(EXAM.timeLimitS)).toBe('over');
  });

  it('reads the mode from the URL', () => {
    expect(modeFromQuery('?case=midLad&seed=X&mode=exam')).toBe('exam');
    expect(modeFromQuery('?case=midLad')).toBe('practice');
  });
});

describe('attempt history', () => {
  it('saves newest first and reads it back', () => {
    const s = memoryStore();
    saveAttempt(s, attempt({ score: 60 }));
    const h = saveAttempt(s, attempt({ score: 90, grade: 'Excellent' }));
    expect(h.map((a) => a.score)).toEqual([90, 60]);
    expect(loadHistory(s)).toEqual(h);
  });

  it(`keeps only the newest ${EXAM.historySize}`, () => {
    const s = memoryStore();
    for (let i = 0; i < EXAM.historySize + 5; i++) saveAttempt(s, attempt({ score: i }));
    const h = loadHistory(s);
    expect(h.length).toBe(EXAM.historySize);
    expect(h[0]!.score).toBe(EXAM.historySize + 4);
  });

  it('best score per case and mode', () => {
    const h = [attempt({ score: 70 }), attempt({ score: 95, mode: 'practice' }), attempt({ caseId: 'midRca', score: 99 })];
    expect(bestScore(h, 'midLad')).toBe(95);
    expect(bestScore(h, 'midLad', 'exam')).toBe(70);
    expect(bestScore(h, 'longLad')).toBeNull();
  });

  it('survives corrupt or missing storage', () => {
    expect(loadHistory(memoryStore({ [HISTORY_KEY]: '{not json' }))).toEqual([]);
    expect(loadHistory(memoryStore({ [HISTORY_KEY]: JSON.stringify([{ caseId: 1 }, attempt()]) }))).toEqual([attempt()]);
    expect(loadHistory(null)).toEqual([]);
    expect(saveAttempt(null, attempt())).toEqual([attempt()]);
    const full: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(saveAttempt(full, attempt())).toEqual([attempt()]);
  });
});
