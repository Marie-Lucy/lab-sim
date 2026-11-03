import { NO_INPUT, type DeviceInput } from '../tools/deviceController';
import type { ToolId } from '../tools/tools';
import type { Modality } from '../physics/imaging';

/** The simulation advances in fixed ticks so a replay sees exactly the same steps. */
export const FIXED_DT = 1 / 60;

/** Discrete actions taken between ticks (toolbar, keys, monitor buttons, demo). */
export type ReplayAction =
  | { readonly k: 'tool'; readonly tool: ToolId }
  | { readonly k: 'size'; readonly d: number; readonly l: number }
  | { readonly k: 'heparin' }
  | { readonly k: 'defer' }
  | { readonly k: 'balloonType'; readonly nc: boolean }
  | { readonly k: 'pullback'; readonly m: Modality }
  | { readonly k: 'preset' }
  | { readonly k: 'nudge'; readonly lao: number; readonly cra: number };

/** One tick: the held input, the fluoro pedal and the actions applied just before it. */
export interface Tick {
  readonly input: DeviceInput;
  readonly pedal: boolean;
  readonly actions: readonly ReplayAction[];
}

/** [repeat count, encoded input, actions applied before the first of these ticks]. */
export type Run = readonly [number, string, ReplayAction[]?];

/** Everything needed to re-run an attempt: the case, the RNG seed and the inputs. */
export interface Recording {
  readonly v: 1;
  readonly caseId: string;
  readonly seed: number;
  readonly rngSeed: number;
  readonly exam: boolean;
  readonly dt: number;
  readonly runs: readonly Run[];
}

/** Compact, exact text form of a tick's input (numbers kept as written). */
export function encodeInput(i: DeviceInput, pedal: boolean): string {
  return [i.advance, i.rotate, i.fine ? 1 : 0, i.wheel, i.inflate ? 1 : 0, i.deflate ? 1 : 0, pedal ? 1 : 0].join(',');
}

export function decodeInput(s: string): { input: DeviceInput; pedal: boolean } {
  const [a, r, f, w, inf, def, p] = s.split(',').map(Number);
  return {
    input: { ...NO_INPUT, advance: a!, rotate: r!, fine: f === 1, wheel: w!, inflate: inf === 1, deflate: def === 1 },
    pedal: p === 1,
  };
}

/**
 * Records ticks run-length encoded: consecutive ticks with the same input and no actions
 * become one run, so minutes of holding a key cost a few bytes.
 */
export class Recorder {
  private readonly runs: [number, string, ReplayAction[]?][] = [];
  private pending: ReplayAction[] = [];
  ticks = 0;

  /** All ticks must use this step; a replay re-runs them with the same value. */
  constructor(readonly dt: number = FIXED_DT) {}

  action(a: ReplayAction): void {
    this.pending.push(a);
  }

  tick(input: DeviceInput, pedal: boolean, dt: number = this.dt): void {
    if (Math.abs(dt - this.dt) > 1e-12) throw new Error(`recorded ticks must use a fixed step (${this.dt}), got ${dt}`);
    const code = encodeInput(input, pedal);
    const last = this.runs[this.runs.length - 1];
    // Actions belong to the first tick of a run, so a run can always grow at its end.
    if (this.pending.length === 0 && last && last[1] === code) {
      last[0]++;
    } else {
      this.runs.push(this.pending.length ? [1, code, this.pending] : [1, code]);
      this.pending = [];
    }
    this.ticks++;
  }

  finish(meta: Omit<Recording, 'v' | 'dt' | 'runs'>): Recording {
    return { v: 1, dt: this.dt, runs: this.runs.map((r) => [...r] as unknown as Run), ...meta };
  }
}

export function tickCount(rec: Pick<Recording, 'runs'>): number {
  return rec.runs.reduce((n, r) => n + r[0], 0);
}

/** Expand runs back into ticks, in order. */
export function* ticksOf(rec: Pick<Recording, 'runs'>): Generator<Tick> {
  for (const [count, code, actions] of rec.runs) {
    const { input, pedal } = decodeInput(code);
    for (let i = 0; i < count; i++) yield { input, pedal, actions: i === 0 ? (actions ?? []) : [] };
  }
}

/** Basic shape check for a recording read from storage or a file. */
export function isRecording(x: unknown): x is Recording {
  const r = x as Recording;
  return !!r && r.v === 1 && typeof r.caseId === 'string' && typeof r.seed === 'number' && typeof r.rngSeed === 'number' && Array.isArray(r.runs);
}

