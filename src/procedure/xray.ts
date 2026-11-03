import { FLUORO } from '../config/anatomy';

export type XrayMode = 'off' | 'fluoro' | 'cine' | 'lih';

export interface XrayState {
  readonly mode: XrayMode;
  /** Total beam-on time (fluoro + cine). */
  readonly fluoroS: number;
  /** Simulation time at which the current cine run ends. */
  readonly cineUntil: number | null;
  readonly pulseClock: number;
  readonly frames: number;
  readonly hasImage: boolean;
}

export function initialXray(): XrayState {
  return { mode: 'off', fluoroS: 0, cineUntil: null, pulseClock: 0, frames: 0, hasImage: false };
}

export function startCine(s: XrayState, time: number, length: number): XrayState {
  return { ...s, cineUntil: Math.max(s.cineUntil ?? 0, time + length) };
}

export function isActive(mode: XrayMode): boolean {
  return mode === 'fluoro' || mode === 'cine';
}

/**
 * Beam state: cine while a run is recording, fluoro while the pedal is held, otherwise
 * last-image-hold (or off before the first image). Pulsed at 15 fps: a new frame is
 * acquired immediately when the beam turns on, then every 1/15 s.
 */
export function stepXray(s: XrayState, input: { dt: number; time: number; pedal: boolean }): { state: XrayState; pulse: boolean } {
  const cine = s.cineUntil !== null && input.time < s.cineUntil;
  const mode: XrayMode = cine ? 'cine' : input.pedal ? 'fluoro' : s.hasImage ? 'lih' : 'off';
  const period = 1 / (cine ? FLUORO.cineFps : FLUORO.pulseFps);
  if (!isActive(mode)) return { state: { ...s, mode, cineUntil: cine ? s.cineUntil : null, pulseClock: 0 }, pulse: false };
  let clock = isActive(s.mode) ? s.pulseClock + input.dt : period;
  let pulse = false;
  if (clock >= period) {
    pulse = true;
    clock = clock % period;
  }
  return {
    state: {
      mode,
      fluoroS: s.fluoroS + input.dt,
      cineUntil: cine ? s.cineUntil : null,
      pulseClock: clock,
      frames: s.frames + (pulse ? 1 : 0),
      hasImage: s.hasImage || pulse,
    },
    pulse,
  };
}
