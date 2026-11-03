import { SPEED_TAU } from '../config/anatomy';

/** Exponential moving average of |ds|/dt, the "how fast is the operator pushing" estimate. */
export function updateSpeed(speed: number, ds: number, dt: number): number {
  if (dt <= 0) return speed;
  const k = 1 - Math.exp(-dt / SPEED_TAU);
  return speed + (Math.abs(ds) / dt - speed) * k;
}

/** Wrap an angle in degrees to (−180, 180]. */
export function wrapDeg(a: number): number {
  let d = a % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function angleDistDeg(a: number, b: number): number {
  return Math.abs(wrapDeg(a - b));
}
