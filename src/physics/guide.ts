import { GUIDE } from '../config/anatomy';
import type { GuideRoute } from './route';
import { angleDistDeg, updateSpeed, wrapDeg } from './speed';

export interface GuideState {
  /** Tip position along the guide route (0 = wrist). */
  readonly arc: number;
  readonly rotationDeg: number;
  readonly engaged: boolean;
  readonly speed: number;
}

export type GuideEvent =
  | 'blockedByWire'
  | 'pastElbow'
  | 'inAorta'
  | 'atRoot'
  | 'engaged'
  | 'tooFast'
  | 'facingOther'
  | 'notFacingTarget'
  | 'popOut'
  | 'disengaged';

export function initialGuide(): GuideState {
  return { arc: 0, rotationDeg: GUIDE.initialRotationDeg, engaged: false, speed: 0 };
}

export type Cusp = 'left' | 'right';

export function cuspAngle(cusp: Cusp): number {
  return cusp === 'left' ? GUIDE.leftCuspAngleDeg : GUIDE.rightCuspAngleDeg;
}

export function otherCusp(cusp: Cusp): Cusp {
  return cusp === 'left' ? 'right' : 'left';
}

/** The tip faces a coronary cusp (±25°). */
export function facingCusp(rotationDeg: number, cusp: Cusp): boolean {
  return angleDistDeg(rotationDeg, cuspAngle(cusp)) <= GUIDE.engageToleranceDeg;
}

export function atRoot(g: GuideState, route: GuideRoute): boolean {
  return g.arc >= route.rootArc - 0.5;
}

export interface GuideInput {
  /** Attempted advance (mm, negative = retract). */
  readonly ds: number;
  readonly rotateDeg: number;
  readonly dt: number;
  readonly wireOut: boolean;
  /** Cusp whose ostium this case needs (left main or RCA). */
  readonly cusp?: Cusp;
}

/**
 * Advance/rotate the guide. It stops at the aortic root; pushing further engages the target
 * ostium only when the tip faces its cusp (±25°) and the push is gentle. Rotating more than
 * 40° from that cusp while engaged pops it out. It cannot move while a wire is out.
 */
export function stepGuide(g: GuideState, input: GuideInput, route: GuideRoute): { state: GuideState; events: GuideEvent[] } {
  const events: GuideEvent[] = [];
  const speed = updateSpeed(g.speed, input.ds, input.dt);
  if (input.wireOut && (input.ds !== 0 || input.rotateDeg !== 0)) {
    return { state: { ...g, speed }, events: ['blockedByWire'] };
  }
  let { arc, engaged } = g;
  const rotationDeg = wrapDeg(g.rotationDeg + input.rotateDeg);
  const cusp = input.cusp ?? 'left';

  if (engaged && angleDistDeg(rotationDeg, cuspAngle(cusp)) > GUIDE.popOutTorqueDeg) {
    engaged = false;
    arc = route.rootArc - 3;
    events.push('popOut');
  }

  if (input.ds < 0) {
    if (engaged) {
      engaged = false;
      events.push('disengaged');
    }
    arc = Math.max(0, arc + input.ds);
  } else if (input.ds > 0) {
    if (!atRoot({ ...g, arc }, route)) {
      const before = arc;
      arc = Math.min(route.rootArc, arc + input.ds);
      if (before <= route.elbowArc && arc > route.elbowArc) events.push('pastElbow');
      if (before <= route.aortaEntryArc && arc > route.aortaEntryArc) events.push('inAorta');
      if (arc >= route.rootArc - 0.5) events.push('atRoot');
    } else if (!engaged) {
      if (facingCusp(rotationDeg, cusp)) {
        if (speed <= GUIDE.gentleEngageSpeed) {
          engaged = true;
          events.push('engaged');
        } else events.push('tooFast');
      } else if (facingCusp(rotationDeg, otherCusp(cusp))) events.push('facingOther');
      else events.push('notFacingTarget');
    }
  }
  return { state: { arc, rotationDeg, engaged, speed }, events };
}
