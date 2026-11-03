import { buildVesselTree } from '../src/anatomy/vesselTree';
import { createRng } from '../src/physics/ecg';
import { DeviceController, NO_INPUT, type DeviceInput, type DeviceMessage } from '../src/tools/deviceController';
import type { ToolId } from '../src/tools/tools';

export function makeController(seed = 3, rng?: () => number) {
  return new DeviceController(buildVesselTree(), rng ?? createRng(seed));
}

export interface Driver {
  readonly c: DeviceController;
  time: number;
  messages: DeviceMessage[];
  run(tool: ToolId, input: Partial<DeviceInput>, seconds: number, dt?: number): void;
  until(tool: ToolId, input: Partial<DeviceInput>, done: () => boolean, maxS?: number): void;
}

export function driver(c = makeController()): Driver {
  const d: Driver = {
    c,
    time: 0,
    messages: [],
    run(tool, input, seconds, dt = 0.05) {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        d.time += dt;
        d.messages.push(...c.step(dt, { ...NO_INPUT, ...input }, tool, d.time).messages);
      }
    },
    until(tool, input, done, maxS = 120) {
      const dt = 0.05;
      for (let t = 0; t < maxS && !done(); t += dt) d.run(tool, input, dt, dt);
      if (!done()) throw new Error('condition not reached');
    },
  };
  return d;
}

/** Guide to the root, facing the left cusp, engaged; heparin given. */
export function engaged(d = driver()): Driver {
  d.until('guide', { advance: 1 }, () => d.c.guide.arc >= d.c.guideRoute.rootArc - 0.5);
  d.until('guide', { rotate: d.c.guide.rotationDeg > 0 ? -1 : 1, fine: true }, () => Math.abs(d.c.guide.rotationDeg) < 3);
  d.run('guide', { advance: 1, fine: true }, 0.5);
  d.c.giveHeparin();
  return d;
}

/** Wire steered into the LAD and crossed gently, parked distally. */
export function wired(d = engaged()): Driver {
  d.until('wire', { rotate: -1 }, () => Math.abs(d.c.wire.rotationDeg) < 4);
  d.until('wire', { advance: 1, fine: true }, () => d.c.wire.chain.includes('lad') && d.c.wire.tipArc > 70);
  return d;
}
