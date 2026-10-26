/**
 * Spike S3: a lever that follows the hand that grips it. Engine-free, so it
 * is unit tested (test/lever.test.ts) and the mechanism kit (F1.3) can grow
 * from it.
 *
 * Lever space: the lever turns about the X axis through its pivot at the
 * origin. At angle 0 it stands straight up (+Y); a positive angle tips its
 * top forwards, towards -Z, the way the player faces. Angles are radians.
 *
 * While held, the lever's angle follows the angle of the hand round the
 * pivot, measured in the plane the lever swings in (the hand's sideways
 * position doesn't matter), keeping the difference there was when the hand
 * took hold so the lever never jumps. It stops at its limits; the hand keeps
 * going (the drawn hand stays on the handle, see hand-lock.ts) and `overshoot`
 * says how far past the limit the real hand is. Let go, it springs back to
 * its rest angle.
 */

export interface LeverSpec {
  /** Pivot to the top of the handle, m. */
  length: number;
  /** The handle: this much of the top of the lever is gripped, m. */
  gripLength: number;
  /** Furthest back and forwards it goes, radians. */
  min: number;
  max: number;
  /** Where it springs back to when let go, radians. */
  rest: number;
  /** How fast it springs back: the rate of its exponential return, 1/s (0 stays where it was left). */
  spring: number;
  /** Angles that tick in the hand as the lever passes them, radians. */
  detents: readonly number[];
  /** Angles this close to rest count as rest when read as a drive demand, radians. */
  deadband: number;
}

const DEG = Math.PI / 180;

/**
 * The tillers of the spike's lever test, about the size of a tank's: a lever
 * of 45 cm whose top 12 cm is the handle, 25° each way, springing back to
 * upright with a tick at the middle.
 */
export const TILLER: LeverSpec = {
  length: 0.45,
  gripLength: 0.12,
  min: -25 * DEG,
  max: 25 * DEG,
  rest: 0,
  spring: 10,
  detents: [0],
  deadband: 2 * DEG,
};

/**
 * The lever test rig (Practice > Lever test), placed in front of the player
 * when it is shown, facing the way they face. Rig space: origin midway
 * between the two tillers' pivots, -Z ahead, as lever space. Sizes, m.
 */
export const LEVER_RIG = {
  /** The pivots are this far ahead of the eyes and this far below them, so the handles sit at lap height, a forearm's length ahead. */
  ahead: 0.42,
  below: 1.0,
  /** Each tiller's pivot is this far to the side of the middle (left negative). */
  side: 0.17,
  /** A hand whose fist is within this of a handle's centre line takes hold of it. */
  reach: 0.1,
  /** The lane board: its middle in rig space, its width and its tilt back from upright, radians. */
  board: { y: 0.7, z: -0.53, width: 0.42, tilt: 25 * DEG },
} as const;

/** A hand closer to the pivot than this, measured in the lever's plane, can't steer it (its angle round the pivot is meaningless), m. */
export const MIN_HAND_RADIUS = 0.05;

/** What happened to a lever this step: bits for the haptics. */
export const LeverEvent = {
  None: 0,
  /** It came up against a limit. */
  Limit: 1,
  /** It passed a detent. */
  Detent: 2,
} as const;

/**
 * The angle round the pivot of a point at height `y` and depth `z` in lever
 * space, as a lever angle (0 straight up, positive forwards), or NaN when it
 * is too close to the pivot to say.
 */
export function angleOf(y: number, z: number): number {
  if (y * y + z * z < MIN_HAND_RADIUS * MIN_HAND_RADIUS) {
    return Number.NaN;
  }
  return Math.atan2(-z, y);
}

/** Wrap an angle into (−π, π]. */
function wrap(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/**
 * A one-euro filter (Casiez et al., CHI 2012) for a hand's angle: smooths
 * hard while the hand is nearly still, where tracking jitter shows, and
 * hardly at all while it moves, where lag shows. Tracked hands jitter by a
 * few millimetres, a degree or so on a 40 cm lever; a controller hardly does.
 */
export class OneEuro {
  private x = Number.NaN;
  private dx = 0;

  /**
   * `minCutoff` is the cut-off frequency at rest, Hz (lower is smoother);
   * `beta` how much it rises with speed (higher lags less); `dCutoff` the
   * cut-off for the speed estimate, Hz.
   */
  constructor(public minCutoff: number, public beta: number, public dCutoff = 1) {}

  reset(): void {
    this.x = Number.NaN;
    this.dx = 0;
  }

  /** Filter `value` taken `dt` seconds after the last. */
  filter(value: number, dt: number): number {
    if (Number.isNaN(this.x) || dt <= 0) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += smoothing(dt, this.dCutoff) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += smoothing(dt, cutoff) * (value - this.x);
    return this.x;
  }
}

function smoothing(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Filter settings for each kind of hand. Controllers barely jitter, so they
 * are filtered only lightly; tracked hands are steadied while still.
 */
export const CONTROLLER_FILTER = { minCutoff: 8, beta: 0.5 } as const;
export const TRACKED_HAND_FILTER = { minCutoff: 1.5, beta: 4 } as const;

/** A lever limit hit is felt again only after the lever has come this far back off it, radians. */
const LIMIT_REARM = 1 * DEG;

export class Lever {
  /** Where the lever is now, radians. */
  angle: number;
  /** A hand holds it. */
  held = false;
  /** How far past a limit the hand would take it, radians (signed: negative past `min`); 0 within the limits. */
  overshoot = 0;
  private offset = 0;
  private atLimit = false;
  private readonly filter = new OneEuro(CONTROLLER_FILTER.minCutoff, CONTROLLER_FILTER.beta);

  constructor(readonly spec: LeverSpec) {
    this.angle = spec.rest;
  }

  /**
   * A hand at `handAngle` (from `angleOf`) takes hold. `trackedHand` picks
   * the steadier filter for a tracked hand. Returns false when the hand is
   * too close to the pivot to steer it.
   */
  grab(handAngle: number, trackedHand = false): boolean {
    if (Number.isNaN(handAngle)) {
      return false;
    }
    const f = trackedHand ? TRACKED_HAND_FILTER : CONTROLLER_FILTER;
    this.filter.minCutoff = f.minCutoff;
    this.filter.beta = f.beta;
    this.filter.reset();
    this.filter.filter(handAngle, 0);
    this.offset = wrap(this.angle - handAngle);
    this.held = true;
    return true;
  }

  release(): void {
    this.held = false;
    this.overshoot = 0;
  }

  /**
   * Step `dt` seconds. While held, `handAngle` is the hand's angle now (NaN
   * keeps the lever where it is for this step: the hand is over the pivot or
   * lost); otherwise it springs back. Returns LeverEvent bits.
   */
  update(dt: number, handAngle: number): number {
    const { min, max } = this.spec;
    const before = this.angle;
    let events: number = LeverEvent.None;
    if (this.held) {
      if (!Number.isNaN(handAngle)) {
        const smooth = this.filter.filter(handAngle, dt);
        const wanted = wrap(smooth + this.offset);
        this.angle = wanted < min ? min : wanted > max ? max : wanted;
        this.overshoot = wanted - this.angle;
      }
    } else {
      this.angle += (this.spec.rest - this.angle) * (1 - Math.exp(-this.spec.spring * dt));
      this.overshoot = 0;
    }
    // A hit when it reaches a limit, felt again once it has come back off it.
    const atLimit = this.angle >= max - 1e-6 || this.angle <= min + 1e-6;
    if (atLimit && !this.atLimit) {
      events |= LeverEvent.Limit;
      this.atLimit = true;
    } else if (this.atLimit && this.angle < max - LIMIT_REARM && this.angle > min + LIMIT_REARM) {
      this.atLimit = false;
    }
    if (this.held) {
      for (const d of this.spec.detents) {
        if ((before < d && this.angle >= d) || (before > d && this.angle <= d)) {
          events |= LeverEvent.Detent;
        }
      }
    }
    return events;
  }

  /** The lever as a demand from −1 (fully back) to 1 (fully forwards), 0 within the deadband round rest. */
  demand(): number {
    const { rest, min, max, deadband } = this.spec;
    const a = this.angle - rest;
    if (Math.abs(a) <= deadband) {
      return 0;
    }
    return a > 0 ? (a - deadband) / (max - rest - deadband) : (a + deadband) / (rest - min - deadband);
  }

  /** The handle's middle in lever space at the current angle, into `out` as [x, y, z]. */
  gripCentre(out: [number, number, number]): [number, number, number] {
    const r = this.spec.length - this.spec.gripLength / 2;
    out[0] = 0;
    out[1] = r * Math.cos(this.angle);
    out[2] = -r * Math.sin(this.angle);
    return out;
  }
}
