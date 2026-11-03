import { EXAM } from '../config/anatomy';

export type PlayMode = 'practice' | 'exam';

/** Seconds left of the exam (never negative). */
export function remainingS(elapsedS: number, limitS: number = EXAM.timeLimitS): number {
  return Math.max(0, limitS - elapsedS);
}

export function isTimeUp(elapsedS: number, limitS: number = EXAM.timeLimitS): boolean {
  return elapsedS >= limitS;
}

/** 'ok' → 'warn' in the last two minutes → 'over'. */
export function timeLevel(elapsedS: number, limitS: number = EXAM.timeLimitS): 'ok' | 'warn' | 'over' {
  const left = remainingS(elapsedS, limitS);
  if (left <= 0) return 'over';
  return left <= EXAM.warnRemainingS ? 'warn' : 'ok';
}

/** Mode from a URL query (`&mode=exam`). */
export function modeFromQuery(search: string): PlayMode {
  return new URLSearchParams(search).get('mode') === 'exam' ? 'exam' : 'practice';
}
