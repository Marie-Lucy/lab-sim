import type { VesselTree } from '../anatomy/vesselTree';
import { createRng } from '../physics/ecg';
import { Session, type SessionStep } from '../procedure/session';
import { tickCount, ticksOf, type Recording, type ReplayAction } from './recording';

/** Apply a recorded action through the same Session method the learner used. */
export function applyAction(s: Session, a: ReplayAction): void {
  switch (a.k) {
    case 'tool':
      s.selectTool(a.tool);
      break;
    case 'size':
      s.setSize(a.d, a.l);
      break;
    case 'heparin':
      s.heparin();
      break;
    case 'defer':
      s.defer();
      break;
    case 'balloonType':
      s.setBalloonType(a.nc);
      break;
    case 'pullback':
      s.pullback(a.m);
      break;
    case 'preset':
      s.nextPreset();
      break;
    case 'nudge':
      s.nudgeCarm(a.lao, a.cra);
      break;
  }
}

/**
 * Re-runs a recording tick by tick on a fresh session built for the same case and RNG seed.
 * Because the simulation is deterministic, it reaches exactly the same states as the attempt.
 */
export class ReplayPlayer {
  readonly session: Session;
  readonly total: number;
  tick = 0;
  private readonly it: Generator<ReturnType<typeof ticksOf> extends Generator<infer T> ? T : never>;

  constructor(
    tree: VesselTree,
    readonly recording: Recording,
  ) {
    this.session = new Session(tree, createRng(recording.rngSeed));
    this.total = tickCount(recording);
    this.it = ticksOf(recording);
  }

  get done(): boolean {
    return this.tick >= this.total;
  }

  /** Advance one tick; null when the recording has ended. */
  step(): SessionStep | null {
    const n = this.it.next();
    if (n.done) return null;
    for (const a of n.value.actions) applyAction(this.session, a);
    this.tick++;
    return this.session.step(this.recording.dt, n.value.input, n.value.pedal);
  }
}

export type MarkerKind = 'stage' | 'warn' | 'danger';

export interface TimelineMarker {
  readonly tick: number;
  readonly kind: MarkerKind;
  readonly text: string;
}

/**
 * Key moments of an attempt, found by playing it headlessly: stage completions, and the
 * first occurrence of each warning or danger message (dissection, rupture, forcing…).
 * `run(n)` advances up to n ticks so a browser can spread the work over several frames.
 */
export class TimelineCollector {
  readonly markers: TimelineMarker[] = [];
  private readonly player: ReplayPlayer;
  private readonly seen = new Set<string>();
  done = false;

  constructor(makeTree: () => VesselTree, rec: Recording) {
    this.player = new ReplayPlayer(makeTree(), rec);
  }

  run(maxTicks: number): boolean {
    for (let i = 0; i < maxTicks && !this.done; i++) {
      const plan = this.player.session.progress.plan;
      const r = this.player.step();
      if (!r) {
        this.done = true;
        break;
      }
      const tick = this.player.tick;
      // Stage events index the plan before this tick (a deferral shortens it afterwards).
      for (const e of r.progress) if (e.type === 'stage') this.markers.push({ tick, kind: 'stage', text: plan[e.stage]!.title });
      for (const m of r.messages) {
        if ((m.level === 'warn' || m.level === 'danger') && !this.seen.has(m.text)) {
          this.seen.add(m.text);
          this.markers.push({ tick, kind: m.level, text: m.text });
        }
      }
    }
    return this.done;
  }
}

export function buildTimeline(makeTree: () => VesselTree, rec: Recording): TimelineMarker[] {
  const c = new TimelineCollector(makeTree, rec);
  c.run(Infinity);
  return c.markers;
}
