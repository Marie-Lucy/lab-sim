import { describe, expect, it } from 'vitest';
import { buildVesselTree } from '../src/anatomy/vesselTree';
import { caseDef, instantiateCase } from '../src/cases/cases';
import {
  attemptId,
  loadStoredReplay,
  packReplay,
  parseReplayFile,
  pruneReplays,
  REPLAY_LIMITS,
  replayFileName,
  storeReplay,
  type KeyValue,
  type ReplayInfo,
} from '../src/replay/files';
import { Recorder, type Recording } from '../src/replay/recording';
import { ReplayPlayer } from '../src/replay/replay';
import { CaseRunner } from './caseRunner';

const info: ReplayInfo = { score: 92, grade: 'Excellent', mode: 'exam', durationS: 321.5, at: Date.UTC(2026, 9, 31, 12) };

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** A short real attempt: reach the root, engage, angiogram. */
function shortRecording(): { rec: Recording; time: number; stage: number } {
  const inst = instantiateCase(caseDef('midRca'), 4242);
  const recorder = new Recorder(0.05);
  const r = new CaseRunner(11, inst.lesion, inst.setup, recorder);
  r.engageAndAngiogram();
  return { rec: recorder.finish({ caseId: 'midRca', seed: inst.seed, rngSeed: 11, exam: true }), time: r.s.time, stage: r.s.progress.stage };
}

describe('replay files', () => {
  const { rec, time, stage } = shortRecording();

  it('round-trips and the imported replay reproduces the attempt', () => {
    const parsed = parseReplayFile(packReplay(rec, info));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.info).toEqual(info);
    const inst = instantiateCase(caseDef(parsed.file.recording.caseId), parsed.file.recording.seed);
    const p = new ReplayPlayer(buildVesselTree(inst.lesion, inst.setup), parsed.file.recording);
    while (p.step());
    expect(p.session.time).toBe(time);
    expect(p.session.progress.stage).toBe(stage);
    expect(p.session.ctrl.guide.engaged).toBe(true);
  });

  const bad = (mutate: (f: Record<string, any>) => void) => {
    const f = JSON.parse(packReplay(rec, info));
    mutate(f);
    return parseReplayFile(JSON.stringify(f));
  };

  it('rejects files that are not Lab Theme replays', () => {
    expect(parseReplayFile('not json')).toEqual({ ok: false, error: 'json' });
    expect(parseReplayFile('{"app":"other"}')).toEqual({ ok: false, error: 'format' });
    expect(bad((f) => (f.version = 2))).toEqual({ ok: false, error: 'format' });
    expect(bad((f) => (f.recording.caseId = 'madeUp'))).toEqual({ ok: false, error: 'case' });
    expect(bad((f) => (f.info.grade = 'Perfect'))).toEqual({ ok: false, error: 'format' });
    expect(bad((f) => (f.recording.dt = 5))).toEqual({ ok: false, error: 'format' });
  });

  it('rejects malformed or hostile runs and actions', () => {
    expect(bad((f) => f.recording.runs.push([1, '9,9,9,9,9,9,9']))).toEqual({ ok: false, error: 'runs' });
    expect(bad((f) => f.recording.runs.push([0, '0,0,0,0,0,0,0']))).toEqual({ ok: false, error: 'runs' });
    expect(bad((f) => f.recording.runs.push([1, '0,0,0,0,0,0,0', [{ k: 'tool', tool: 'scalpel' }]]))).toEqual({ ok: false, error: 'runs' });
    expect(bad((f) => f.recording.runs.push([1, '0,0,0,0,0,0,0', [{ k: 'eval', code: 'x' }]]))).toEqual({ ok: false, error: 'runs' });
    expect(bad((f) => f.recording.runs.push([1, '0,0,0,0,0,0,0', [{ k: 'nudge', lao: 50, cra: 0 }]]))).toEqual({ ok: false, error: 'runs' });
    expect(bad((f) => f.recording.runs.push([REPLAY_LIMITS.maxTicks, '0,0,0,0,0,0,0']))).toEqual({ ok: false, error: 'tooLong' });
    expect(parseReplayFile('x'.repeat(REPLAY_LIMITS.maxBytes + 1))).toEqual({ ok: false, error: 'tooBig' });
  });

  it('names files after the case, variant and day', () => {
    expect(replayFileName(rec, info.at)).toBe('lab-theme-midRca-39U-2026-10-31.json');
    expect(replayFileName({ caseId: 'classic', seed: 0 }, info.at)).toBe('lab-theme-classic-2026-10-31.json');
  });
});

describe('replays stored with attempts', () => {
  it('stores, loads and prunes all but the kept attempts', () => {
    const s = memory();
    const { rec } = shortRecording();
    const ids = ['a', 'b', 'c'];
    for (const id of ids) storeReplay(s, id, packReplay(rec, info));
    expect(loadStoredReplay(s, 'b')?.info.score).toBe(92);
    pruneReplays(s, ids, new Set(['c']));
    expect(loadStoredReplay(s, 'a')).toBeNull();
    expect(loadStoredReplay(s, 'c')).not.toBeNull();
    expect(storeReplay(null, 'x', '{}')).toBe(false);
  });

  it('attempt ids are short and distinct', () => {
    const a = attemptId(1_700_000_000_000, () => 0.1);
    const b = attemptId(1_700_000_000_000, () => 0.7);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThan(16);
  });
});
