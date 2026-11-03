import { t, type Key } from '../i18n';
import { lesionBounds } from '../anatomy/stenosis';
import type { ToolId } from '../tools/tools';
import type { Session } from './session';

/** Same shape as the UI's auto-input override: what the demo "presses" this frame. */
export interface DemoInput {
  readonly advance?: number;
  readonly rotate?: number;
  readonly fine?: boolean;
  readonly inflate?: boolean;
  readonly deflate?: boolean;
  readonly pedal?: boolean;
}

/** What the demo can do besides held inputs: the same actions as toolbar/keys. */
export interface DemoHost {
  readonly session: Session;
  selectTool(t: ToolId): void;
  setSize(diameter: number, length: number): void;
  inject(): void;
  heparin(): void;
  nextPreset(): void;
  setView(v: '3d' | 'fluoro'): void;
}

interface DemoStep {
  /** Dictionary key of the narration. */
  readonly say: Key;
  start?(h: DemoHost): void;
  drive?(h: DemoHost, t: number): DemoInput;
  done(h: DemoHost, t: number): boolean;
}

const sign = (x: number) => (x > 0 ? -1 : 1);

/** Advance the loaded catheter until its distal marker is `beyond` mm past the lesion end. */
function positionCatheter(beyond: number): Pick<DemoStep, 'drive' | 'done'> {
  const target = (h: DemoHost) => {
    const c = h.session.ctrl;
    return (c.route.routeArcOf('lad', lesionBounds(h.session.tree.lesion).end + beyond) ?? 0) + 4;
  };
  return {
    drive: (h) => ({ advance: 1, fine: target(h) - h.session.ctrl.catheter!.advanced < 6 }),
    done: (h) => h.session.ctrl.catheter!.advanced >= target(h) - 0.05,
  };
}

const angiogramDone = (h: DemoHost, t: number) => t > 0.5 && h.session.xray.mode === 'lih';

/** The scripted case: each step narrates, then drives inputs until its goal is met. */
export const DEMO_STEPS: readonly DemoStep[] = [
  {
    say: 'demo.s1',
    start: (h) => h.selectTool('guide'),
    drive: (h) => {
      const c = h.session.ctrl;
      const r = c.guideRoute;
      const tap = (c.guide.arc > r.elbowArc && c.guide.arc < r.elbowArc + 20) || (c.guide.arc > r.aortaEntryArc + 5 && c.guide.arc < r.aortaEntryArc + 30);
      return { advance: 1, pedal: tap };
    },
    done: (h) => h.session.ctrl.guide.arc > h.session.ctrl.guideRoute.aortaEntryArc + 30,
  },
  {
    say: 'demo.s2',
    drive: () => ({ advance: 1 }),
    done: (h) => h.session.ctrl.guide.arc >= h.session.ctrl.guideRoute.rootArc - 0.5,
  },
  {
    say: 'demo.s3',
    drive: (h) => ({ rotate: sign(h.session.ctrl.guide.rotationDeg), fine: true }),
    done: (h) => Math.abs(h.session.ctrl.guide.rotationDeg) <= 2,
  },
  {
    say: 'demo.s4',
    drive: () => ({ advance: 1, fine: true }),
    done: (h) => h.session.ctrl.guide.engaged,
  },
  {
    say: 'demo.s5',
    start: (h) => {
      while (h.session.presetIndex !== 0) h.nextPreset();
      h.setView('fluoro');
      h.inject();
    },
    done: angiogramDone,
  },
  {
    say: 'demo.s6',
    start: (h) => {
      h.setView('3d');
      h.heparin();
    },
    done: (_h, t) => t > 1.5,
  },
  {
    say: 'demo.s7',
    start: (h) => h.selectTool('wire'),
    drive: () => ({ advance: 1, fine: true }),
    done: (h) => h.session.ctrl.wire.out && h.session.ctrl.wire.tipArc >= 3,
  },
  {
    say: 'demo.s8',
    drive: (h) => ({ rotate: sign(h.session.ctrl.wire.rotationDeg) }),
    done: (h) => Math.abs(h.session.ctrl.wire.rotationDeg) <= 3,
  },
  {
    say: 'demo.s9',
    drive: () => ({ advance: 1 }),
    done: (h) => h.session.ctrl.wire.chain.includes('lad') && h.session.ctrl.wire.tipArc >= lesionBounds(h.session.tree.lesion).start - 8,
  },
  {
    say: 'demo.s10',
    drive: (_h, t) => ({ advance: 1, fine: true, rotate: Math.sin(t * 5) > 0 ? 1 : -1 }),
    done: (h) => h.session.ctrl.wire.crossed && h.session.ctrl.wire.tipArc > lesionBounds(h.session.tree.lesion).end + 2,
  },
  {
    say: 'demo.s11',
    drive: () => ({ advance: 1 }),
    done: (h) => h.session.ctrl.wire.tipArc >= lesionBounds(h.session.tree.lesion).end + 31,
  },
  {
    say: 'demo.s12',
    start: (h) => {
      h.selectTool('balloon');
      h.setSize(2.5, 15);
    },
    done: (_h, t) => t > 1,
  },
  { say: 'demo.s13', ...positionCatheter(0.5) },
  {
    say: 'demo.s14',
    drive: () => ({ inflate: true }),
    done: (h) => h.session.ctrl.catheter!.pressure >= 10,
  },
  { say: 'demo.s15', done: (_h, t) => t >= 12 },
  { say: 'demo.s16', drive: () => ({ deflate: true }), done: (h) => h.session.ctrl.catheter!.pressure === 0 },
  { say: 'demo.s17', drive: () => ({ advance: -1 }), done: (h) => h.session.ctrl.catheter!.advanced <= 0 },
  {
    say: 'demo.s18',
    start: (h) => h.selectTool('measure'),
    done: (_h, t) => t > 2.5,
  },
  {
    say: 'demo.s19',
    start: (h) => {
      h.selectTool('stent');
      h.setSize(3.0, 18);
    },
    done: (_h, t) => t > 1,
  },
  { say: 'demo.s20', ...positionCatheter(2) },
  {
    say: 'demo.s21',
    drive: () => ({ inflate: true }),
    done: (h) => h.session.ctrl.catheter!.pressure >= 12,
  },
  { say: 'demo.s22', done: (_h, t) => t >= 3 },
  { say: 'demo.s23', drive: () => ({ deflate: true }), done: (h) => h.session.ctrl.catheter!.pressure === 0 },
  { say: 'demo.s24', drive: () => ({ advance: -1 }), done: (h) => h.session.ctrl.catheter!.advanced <= 0 },
  {
    say: 'demo.s25',
    start: (h) => {
      h.setView('fluoro');
      h.inject();
    },
    done: angiogramDone,
  },
  {
    say: 'demo.s26',
    start: (h) => {
      h.nextPreset();
      h.nextPreset();
      h.inject();
    },
    done: angiogramDone,
  },
  {
    say: 'demo.s27',
    start: (h) => h.setView('3d'),
    done: (_h, t) => t > 0.5,
  },
];

/**
 * Scripted autopilot. Each frame `update` returns the inputs to apply through the learner's
 * own input path; steps run their `start` action once, then drive until `done`.
 */
export class Demo {
  index = 0;
  private t = 0;
  private started = false;
  finished = false;

  constructor(
    private readonly host: DemoHost,
    private readonly steps: readonly DemoStep[] = DEMO_STEPS,
  ) {}

  get narration(): string {
    return t(this.steps[Math.min(this.index, this.steps.length - 1)]!.say);
  }

  update(dt: number): DemoInput | null {
    if (this.finished) return null;
    const step = this.steps[this.index]!;
    if (!this.started) {
      this.started = true;
      this.t = 0;
      step.start?.(this.host);
    }
    if (step.done(this.host, this.t)) {
      this.index++;
      this.started = false;
      if (this.index >= this.steps.length) this.finished = true;
      return {};
    }
    this.t += dt;
    return step.drive?.(this.host, this.t) ?? {};
  }
}
