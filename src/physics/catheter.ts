import { BALLOON, NC_BALLOON, STENT, type InflationSpec } from '../config/anatomy';
import { balloonSpec, inflatedDiameter, isRupture, ncBalloonSpec, stentSpec } from './inflation';
import { DEFLATED_PRESSURE } from '../procedure/stages';
import { updateSpeed } from './speed';

export type CatheterKind = 'balloon' | 'stent';

export interface CatheterState {
  readonly kind: CatheterKind;
  /** Balloon catheters: non-compliant (high pressure) instead of semi-compliant. */
  readonly nc: boolean;
  readonly diameter: number;
  readonly length: number;
  /** Tip position along the wire route (mm from the LM ostium); ≤ 0 = inside the guide. */
  readonly advanced: number;
  readonly pressure: number;
  readonly ruptured: boolean;
  /** Stent catheters: the stent has been released from this delivery balloon. */
  readonly deployed: boolean;
  readonly speed: number;
  /** Current inflation, if any. */
  readonly inflation: { readonly start: number; readonly maxPressure: number; readonly maxDiameter: number } | null;
}

export interface InflationRecord {
  readonly kind: CatheterKind;
  readonly start: number;
  readonly duration: number;
  readonly maxPressure: number;
  readonly maxDiameter: number;
  /** Working length (route arcs) at the time of the inflation. */
  readonly span: { readonly start: number; readonly end: number };
  readonly ruptured: boolean;
}

export type CatheterEvent =
  | { readonly type: 'sizeLocked' }
  | { readonly type: 'moveBlockedInflated' }
  | { readonly type: 'wireLead' }
  | { readonly type: 'inflateInGuide' }
  | { readonly type: 'ruptureUnusable' }
  | { readonly type: 'aboveRbp' }
  | { readonly type: 'ruptured' }
  | { readonly type: 'deployed' }
  | { readonly type: 'inflationEnd'; readonly record: InflationRecord }
  | { readonly type: 'reloaded' }
  | { readonly type: 'outOfGuide' };

/** Sizes on the shelf for a catheter type. */
export function catheterSizes(kind: CatheterKind, nc = false): { readonly diameters: readonly number[]; readonly lengths: readonly number[] } {
  return kind === 'stent' ? STENT : nc ? NC_BALLOON : BALLOON;
}

export function newCatheter(kind: CatheterKind, size?: { diameter: number; length: number }, nc = false): CatheterState {
  const s = size ?? (kind === 'balloon' ? (nc ? NC_BALLOON.defaultSize : BALLOON.defaultSize) : STENT.defaultSize);
  return {
    kind,
    nc: kind === 'balloon' && nc,
    diameter: s.diameter,
    length: s.length,
    advanced: BALLOON.minAdvance,
    pressure: 0,
    ruptured: false,
    deployed: false,
    speed: 0,
    inflation: null,
  };
}

export function catheterSpec(c: CatheterState): InflationSpec {
  if (c.kind === 'stent') return stentSpec(c.diameter, c.length);
  return c.nc ? ncBalloonSpec(c.diameter, c.length) : balloonSpec(c.diameter, c.length);
}

export function inGuide(c: CatheterState): boolean {
  return c.advanced <= 0;
}

export function currentDiameter(c: CatheterState): number {
  return inflatedDiameter(catheterSpec(c), c.pressure);
}

/** Working length (between the markers) in route arcs. */
export function workingSpan(c: CatheterState): { start: number; end: number } {
  const end = c.advanced - BALLOON.tipLength;
  return { start: end - c.length, end };
}

export function setSize(c: CatheterState, diameter: number, length: number): { state: CatheterState; ok: boolean } {
  const sizes = catheterSizes(c.kind, c.nc);
  const valid = (sizes.diameters as readonly number[]).includes(diameter) && (sizes.lengths as readonly number[]).includes(length);
  if (!inGuide(c) || !valid) return { state: c, ok: false };
  return { state: { ...c, diameter, length }, ok: true };
}

const nearest = (list: readonly number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/** Swap a balloon in the guide for the other type, keeping the closest size on the shelf. */
export function setBalloonType(c: CatheterState, nc: boolean): { state: CatheterState; ok: boolean } {
  if (c.kind !== 'balloon' || !inGuide(c)) return { state: c, ok: false };
  if (c.nc === nc) return { state: c, ok: true };
  const sizes = catheterSizes('balloon', nc);
  return { state: { ...newCatheter('balloon', { diameter: nearest(sizes.diameters, c.diameter), length: nearest(sizes.lengths, c.length) }, nc), advanced: c.advanced }, ok: true };
}

export interface CatheterInput {
  readonly ds: number;
  readonly dt: number;
  readonly inflate: boolean;
  readonly deflate: boolean;
  readonly fine: boolean;
  /** Wire tip position along the wire route. */
  readonly wireTip: number;
  readonly time: number;
}

/**
 * Move the catheter over the wire (behind the wire tip, not while inflated) and handle
 * inflation: ~3 atm/s (fine 0.75), deflation 6 atm/s, rupture at RBP + 4, stent release at
 * ≥ 6 atm. An inflation is recorded when the pressure returns to ≤ 0.2 atm. A ruptured
 * balloon or a used stent catheter is replaced by a fresh one once back in the guide.
 */
export function stepCatheter(c: CatheterState, input: CatheterInput): { state: CatheterState; events: CatheterEvent[] } {
  const events: CatheterEvent[] = [];
  const speed = updateSpeed(c.speed, input.ds, input.dt);
  let { advanced, pressure, ruptured, deployed, inflation } = c;
  const spec = catheterSpec(c);

  if (input.ds !== 0) {
    if (pressure > DEFLATED_PRESSURE) {
      events.push({ type: 'moveBlockedInflated' });
    } else {
      const max = input.wireTip - BALLOON.minWireLead;
      const target = Math.max(BALLOON.minAdvance, advanced + input.ds);
      if (input.ds > 0 && target > max) {
        advanced = Math.max(advanced, max);
        events.push({ type: 'wireLead' });
      } else {
        advanced = target;
      }
      if (c.advanced <= 0 && advanced > 0) events.push({ type: 'outOfGuide' });
    }
  }

  if (input.inflate) {
    if (advanced <= 0) events.push({ type: 'inflateInGuide' });
    else if (ruptured) events.push({ type: 'ruptureUnusable' });
    else {
      const rate = input.fine ? BALLOON.fineInflateRate : BALLOON.inflateRate;
      pressure = Math.min(BALLOON.maxPressure, pressure + rate * input.dt);
    }
  } else if (input.deflate) {
    pressure = Math.max(0, pressure - BALLOON.deflateRate * input.dt);
  }

  if (pressure > spec.ratedBurstPressure && !isRupture(spec, pressure)) events.push({ type: 'aboveRbp' });

  let rupturedNow = false;
  if (isRupture(spec, pressure)) {
    ruptured = true;
    rupturedNow = true;
    events.push({ type: 'ruptured' });
  }

  if (c.kind === 'stent' && !deployed && pressure >= STENT.deployPressure) {
    deployed = true;
    events.push({ type: 'deployed' });
  }

  if (pressure > DEFLATED_PRESSURE && !inflation) {
    inflation = { start: input.time, maxPressure: 0, maxDiameter: 0 };
  }
  if (inflation) {
    inflation = {
      start: inflation.start,
      maxPressure: Math.max(inflation.maxPressure, pressure),
      maxDiameter: Math.max(inflation.maxDiameter, inflatedDiameter(spec, pressure)),
    };
  }
  if (rupturedNow) pressure = 0;
  if (inflation && pressure <= DEFLATED_PRESSURE) {
    events.push({
      type: 'inflationEnd',
      record: {
        kind: c.kind,
        start: inflation.start,
        duration: input.time - inflation.start,
        maxPressure: inflation.maxPressure,
        maxDiameter: inflation.maxDiameter,
        span: workingSpan({ ...c, advanced }),
        ruptured: rupturedNow,
      },
    });
    inflation = null;
  }

  let state: CatheterState = { ...c, advanced, pressure, ruptured, deployed, speed, inflation };
  if (advanced <= 0 && (deployed || ruptured)) {
    state = { ...newCatheter(c.kind, c.kind === 'balloon' ? { diameter: c.diameter, length: c.length } : undefined, c.nc), advanced };
    events.push({ type: 'reloaded' });
  }
  return { state, events };
}
