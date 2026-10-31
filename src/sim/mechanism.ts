/**
 * The mechanism kit (F1.3): every control in the tank is one of a few
 * mechanisms, written once here and driven by MechanismSystem
 * (src/systems/mechanism-system.ts). Engine-free, so it is unit tested
 * (test/mechanism.test.ts). Design note: docs/mechanisms.md.
 *
 * - Lever: one axis, limits, spring back or notches, detents (tillers, gear
 *   lever, hand throttle, breech lever), or a ratchet that holds it until
 *   the trigger frees it (parking brake).
 * - Wheel: a handwheel gripped on its rim or a crank by its knob; turns
 *   for ever or between limits, with a tick every so often (traverse and
 *   elevation wheels).
 * - Twist grip with a trigger (power traverse).
 * - Yoke: two handles on a bar turning about an upright; one hand turns it
 *   slower (periscope).
 * - Button: pressed by a fingertip or a squeeze; momentary or a switch.
 *
 * Each mechanism has its own space (its owner puts it in the scene) and is
 * given the hands in that space each frame. A held mechanism follows the
 * hand; at a limit it stops and the hand keeps going (the drawn hand stays
 * on the handle, grip locking, see hand-lock.ts), and `strain` says how far
 * past it the real hand is. Angles are radians. Hands are indexed 0 left,
 * 1 right.
 */

export type Vec3 = [number, number, number];
/** 0 the left hand, 1 the right. */
export type HandIndex = 0 | 1;

/** One hand as a mechanism sees it this frame, in the mechanism's space. */
export interface HandInput {
  /** The middle of the fist, where a gripped handle runs through it. */
  fist: Vec3;
  /** A unit direction across the fist, square to the hole its fingers make: it turns as the wrist rolls (twist grips read it). */
  across: Vec3;
  /** The index fingertip while the finger is out straight enough to press with, or null (buttons read it). */
  tip: Vec3 | null;
  /** The trigger, 0 to 1. */
  trigger: number;
  /** A tracked hand rather than a controller: steadied harder. */
  tracked: boolean;
}

/** What happened to a mechanism this step: bits, for the haptics and its owner. */
export const MechEvent = {
  None: 0,
  /** It came up against a limit. */
  Limit: 1,
  /** It passed a detent or a tick mark. */
  Detent: 2,
  /** A button went in, or a trigger was pulled. */
  Press: 4,
  /** A button came back out, or a trigger was let go. */
  Release: 8,
} as const;

const DEG = Math.PI / 180;

/** A fist within this of a handle takes hold of it, m. */
export const REACH = 0.1;
/** A hand closer than this to a mechanism's axis can't turn it (its angle round the axis is meaningless), m. */
export const MIN_HAND_RADIUS = 0.05;
/** A limit (or a tick) is felt again only after the mechanism has come this far back off it. */
const REARM = 1 * DEG;

/** Wrap an angle into (−π, π]. */
export function wrap(a: number): number {
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

/**
 * A hand's angle round a mechanism's axis, unwrapped (so a crank can go
 * round and round) and steadied by a one-euro filter.
 */
class HandAngle {
  private readonly filter = new OneEuro(CONTROLLER_FILTER.minCutoff, CONTROLLER_FILTER.beta);
  private last = 0;
  private unwrapped = 0;

  /** The hand takes hold at `angle` (not NaN); returns it. */
  start(angle: number, tracked: boolean): number {
    const f = tracked ? TRACKED_HAND_FILTER : CONTROLLER_FILTER;
    this.filter.minCutoff = f.minCutoff;
    this.filter.beta = f.beta;
    this.filter.reset();
    this.last = angle;
    this.unwrapped = angle;
    return this.filter.filter(angle, 0);
  }

  /** The hand is at `angle` now (NaN: lost or over the axis), `dt` after the last: its steadied, unwrapped angle, or NaN. */
  step(angle: number, dt: number): number {
    if (Number.isNaN(angle)) {
      return Number.NaN;
    }
    this.unwrapped += wrap(angle - this.last);
    this.last = angle;
    return this.filter.filter(this.unwrapped, dt);
  }

  /**
   * Round a wheel's axle: the hand is at (x, y) in wheel space now, `dt`
   * after the last; its steadied, unwrapped angle. The angle moves on by how
   * far the hand went round as seen from where it was, never more than
   * `near` from the axle, so a hand that cuts in close to the axle (a crank
   * turned in a circle a little off its axle) turns it less there, instead
   * of stopping it and then jumping on, or back.
   */
  stepAround(x: number, y: number, near: number, dt: number): number {
    const c = Math.cos(this.unwrapped);
    const s = Math.sin(this.unwrapped);
    // The hand's offset along the way round (anticlockwise) and out from the axle, at the angle it was at.
    const along = -x * c - y * s;
    const out = y * c - x * s;
    this.unwrapped += Math.atan2(along, out > near ? out : near);
    return this.filter.filter(this.unwrapped, dt);
  }
}

/** Ticks as an angle passes marks every `every` radians, each felt again only once the angle has moved off it. */
class Ticker {
  private lastMark = Number.NaN;
  private armed = true;

  /** Returns true when the angle passed a mark going from `before` to `after`. */
  step(before: number, after: number, every: number): boolean {
    if (!(every > 0)) {
      return false;
    }
    if (!this.armed && Math.abs(after - this.lastMark) > REARM) {
      this.armed = true;
    }
    const a = Math.floor(before / every);
    const b = Math.floor(after / every);
    if (a === b) {
      return false;
    }
    // The mark crossed: the upper of the two going up, the same going down.
    const mark = Math.max(a, b) * every;
    if (mark === this.lastMark && !this.armed) {
      return false;
    }
    this.lastMark = mark;
    this.armed = false;
    return true;
  }
}

/** Felt once on reaching a limit, again only once it has come back off it. */
class LimitBump {
  private at = false;

  step(angle: number, min: number, max: number): boolean {
    const at = angle >= max - 1e-6 || angle <= min + 1e-6;
    if (at && !this.at) {
      this.at = true;
      return true;
    }
    if (this.at && angle < max - REARM && angle > min + REARM) {
      this.at = false;
    }
    return false;
  }
}

/** Distance from `p` to the segment from `a` along unit `d` for `lo` to `hi`, and the parameter of the nearest point. */
function segment(p: Vec3, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, lo: number, hi: number, out: { t: number }): number {
  const along = (p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz;
  const t = along < lo ? lo : along > hi ? hi : along;
  out.t = t;
  return Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy, p[2] - az - t * dz);
}
const seg = { t: 0 };

/** What every mechanism offers its system: taking hold, following the hands, and where a hand on it is drawn. */
export abstract class Mechanism {
  /** Which hands hold it, [left, right]. */
  readonly held: [boolean, boolean] = [false, false];
  /** How far each holding hand is past where the mechanism could follow it, radians (felt as a strain buzz). */
  readonly strain: [number, number] = [0, 0];
  /** A fist within this of a handle takes hold of it, m. */
  reachRadius = REACH;

  /** Held by either hand. */
  get anyHeld(): boolean {
    return this.held[0] || this.held[1];
  }

  /** How far `hand`'s fist is from where it could take hold, m (Infinity: it can't, say because the other hand has the only handle). */
  abstract reach(side: HandIndex, hand: HandInput): number;

  /** `hand` takes hold; false when it can't from there. */
  abstract grab(side: HandIndex, hand: HandInput): boolean;

  release(side: HandIndex): void {
    this.held[side] = false;
    this.strain[side] = 0;
  }

  /** Step `dt` seconds with the hands as they are now (null: not there). Returns MechEvent bits. */
  abstract update(dt: number, hands: readonly (HandInput | null)[]): number;

  /**
   * Grip locking: where a fist at `fist` closes on the handle (into
   * `point`) and which way the handle runs (`axis`, unit). `side` is a hand
   * of this page's that holds it, or -1 for the crewmate's hand, which is
   * put on the handle nearest it.
   */
  abstract lock(side: HandIndex | -1, fist: Vec3, point: Vec3, axis: Vec3): void;

  /** A point to take hold at, for tests and the practice crewmate: `which` picks a handle (0 left, 1 right) where there are two. */
  abstract handle(which: HandIndex, out: Vec3): Vec3;
}

// ---------------------------------------------------------------- Lever

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
  /** How fast it goes back when let go: the rate of its exponential return, 1/s (0 stays where it was left). */
  spring: number;
  /** Angles that tick in the hand as the lever passes them, radians. */
  detents: readonly number[];
  /** Angles this close to rest count as rest when read as a drive demand, radians. */
  deadband: number;
  /** Notches it settles into when let go, at the spring's rate (a gate or a ratchet): the nearest one, instead of `rest`. */
  notches?: readonly number[];
  /**
   * A ratchet (F1.18's parking brake): the hand moves the lever only this way
   * (+1 forwards, -1 back) unless its trigger is pulled, which frees the
   * pawl (the release button on top of the handle) and lets it go back.
   */
  ratchet?: 1 | -1;
}

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

/**
 * A lever. Lever space: it turns about the X axis through its pivot at the
 * origin; at angle 0 it stands straight up (+Y), and a positive angle tips
 * its top forwards, towards -Z, the way the player faces.
 *
 * While held, the lever's angle follows the angle of the hand round the
 * pivot, measured in the plane the lever swings in (the hand's sideways
 * position doesn't matter), keeping the difference there was when the hand
 * took hold so the lever never jumps. It stops at its limits; `overshoot`
 * says how far past the limit the real hand is. Let go, it springs back to
 * its rest angle, settles into its nearest notch, or stays put.
 */
export class Lever extends Mechanism {
  /** Where the lever is now, radians. */
  angle: number;
  /** How far past a limit the hand would take it, radians (signed: negative past `min`); 0 within the limits. */
  overshoot = 0;
  /** A ratchet's pawl is lifted: the holding hand's trigger is pulled (`spec.ratchet`). */
  freed = false;
  private holder: HandIndex | -1 = -1;
  private offset = 0;
  private readonly hand = new HandAngle();
  private readonly bump = new LimitBump();

  constructor(readonly spec: LeverSpec) {
    super();
    this.angle = spec.rest;
  }

  reach(side: HandIndex, hand: HandInput): number {
    if (this.holder !== -1 && this.holder !== side) {
      return Infinity;
    }
    const { length, gripLength } = this.spec;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return segment(hand.fist, 0, 0, 0, 0, c, -s, length - gripLength, length, seg);
  }

  grab(side: HandIndex, hand: HandInput): boolean {
    const a = angleOf(hand.fist[1], hand.fist[2]);
    if (Number.isNaN(a) || (this.holder !== -1 && this.holder !== side)) {
      return false;
    }
    this.offset = wrap(this.angle - this.hand.start(a, hand.tracked));
    this.holder = side;
    this.held[side] = true;
    return true;
  }

  release(side: HandIndex): void {
    super.release(side);
    if (this.holder === side) {
      this.holder = -1;
      this.overshoot = 0;
      this.freed = false;
    }
  }

  update(dt: number, hands: readonly (HandInput | null)[]): number {
    const { min, max, ratchet } = this.spec;
    const before = this.angle;
    let events: number = MechEvent.None;
    if (this.holder !== -1) {
      const hand = hands[this.holder];
      const smooth = this.hand.step(hand ? angleOf(hand.fist[1], hand.fist[2]) : Number.NaN, dt);
      // NaN keeps the lever where it is for this step: the hand is over the pivot or lost.
      if (ratchet) {
        const trigger = hand ? hand.trigger : 0;
        this.freed = this.freed ? trigger > TRIGGER_OFF : trigger > TRIGGER_ON;
      }
      if (!Number.isNaN(smooth)) {
        const wanted = smooth + this.offset;
        let angle = wanted < min ? min : wanted > max ? max : wanted;
        // The pawl holds it against the hand going the other way.
        if (ratchet && !this.freed && (angle - before) * ratchet < 0) angle = before;
        this.angle = angle;
        this.overshoot = wanted - this.angle;
      }
      this.strain[this.holder] = Math.abs(this.overshoot);
    } else {
      this.angle += (this.settle() - this.angle) * (1 - Math.exp(-this.spec.spring * dt));
      this.overshoot = 0;
    }
    if (this.bump.step(this.angle, min, max)) {
      events |= MechEvent.Limit;
    }
    if (this.holder !== -1) {
      for (const d of this.spec.detents) {
        if ((before < d && this.angle >= d) || (before > d && this.angle <= d)) {
          events |= MechEvent.Detent;
        }
      }
    }
    return events;
  }

  /** Where it goes when let go: its nearest notch, or rest. */
  private settle(): number {
    const notches = this.spec.notches;
    if (!notches || notches.length === 0) {
      return this.spec.rest;
    }
    return notches[this.notch()];
  }

  /** The index of the notch nearest the lever now (0 when it has none). */
  notch(): number {
    const notches = this.spec.notches;
    let best = 0;
    if (notches) {
      for (let i = 1; i < notches.length; i++) {
        if (Math.abs(notches[i] - this.angle) < Math.abs(notches[best] - this.angle)) best = i;
      }
    }
    return best;
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

  /** The handle's middle in lever space at the current angle, into `out`. */
  gripCentre(out: Vec3): Vec3 {
    const r = this.spec.length - this.spec.gripLength / 2;
    out[0] = 0;
    out[1] = r * Math.cos(this.angle);
    out[2] = -r * Math.sin(this.angle);
    return out;
  }

  handle(_which: HandIndex, out: Vec3): Vec3 {
    return this.gripCentre(out);
  }

  lock(_side: HandIndex | -1, fist: Vec3, point: Vec3, axis: Vec3): void {
    const { length, gripLength } = this.spec;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    segment(fist, 0, 0, 0, 0, c, -s, length - gripLength, length, seg);
    point[0] = 0;
    point[1] = seg.t * c;
    point[2] = -seg.t * s;
    axis[0] = 0;
    axis[1] = c;
    axis[2] = -s;
  }
}

// ---------------------------------------------------------------- Wheel

export interface WheelSpec {
  /** The rim's radius, to the middle of its tube (crank: the knob's distance from the axle), m. */
  radius: number;
  /** 'rim': gripped anywhere on the rim, by one hand or both; 'crank': by a knob standing out of the face, one hand. */
  grip: 'rim' | 'crank';
  /** How far the crank's knob stands out of the wheel's face, m (unused for a rim). */
  knobLength: number;
  /** Limits, radians of wheel turn (−Infinity and Infinity: it turns for ever). */
  min: number;
  max: number;
  /** A tick in the hand every this many radians turned (0: none). */
  tickEvery: number;
  /** What one turn is worth to whatever it drives (degrees of traverse, say): `value()` is turns times this. */
  perTurn: number;
  /** A crank with a trigger bar along its knob, pulled by the holding hand's index finger: `firing`, with Press and Release events. */
  trigger?: boolean;
}

/** Nearer a wheel's axle than this share of its radius, a hand turns it less the nearer it is (`HandAngle.stepAround`). */
const NEAR_AXLE = 0.5;

/** The angle round a wheel's axle of a point at (x, y) in wheel space: 0 at the top, positive anticlockwise seen from the front, or NaN near the axle. */
export function wheelAngleOf(x: number, y: number): number {
  if (x * x + y * y < MIN_HAND_RADIUS * MIN_HAND_RADIUS) {
    return Number.NaN;
  }
  return Math.atan2(-x, y);
}

/**
 * A handwheel or a crank. Wheel space: the axle runs along Z through the
 * origin and the wheel's face looks along +Z, towards the player; its angle
 * is positive anticlockwise as they see it (as Three.js turns about +Z), 0
 * with the crank's knob at the top.
 *
 * A held wheel follows the hand's angle round the axle, unwrapped so it can
 * turn many times, keeping the difference there was at taking hold. Each
 * frame's turn is read from where the hand was, so a hand going round a
 * little off the axle (as hands turning a crank do) still turns it smoothly. Two
 * hands on a rim turn it by the mean of where each would take it. It stops
 * at its limits like a lever; a wheel let go stays where it is. A crank
 * with a `trigger` reads its holding hand's trigger as `firing`, like a
 * twist grip.
 */
export class Wheel extends Mechanism {
  /** How far it has turned from the start, radians (many turns). */
  angle = 0;
  /** The holding hand's trigger is pulled (a crank with a `trigger`). */
  firing = false;
  private readonly hands = [new HandAngle(), new HandAngle()];
  private readonly offset: [number, number] = [0, 0];
  /** Where on the rim each hand closed, relative to the wheel's turn. */
  private readonly spot: [number, number] = [0, 0];
  private readonly ticker = new Ticker();
  private readonly bump = new LimitBump();

  constructor(readonly spec: WheelSpec) {
    super();
  }

  /** Turns from the start. */
  get turns(): number {
    return this.angle / (2 * Math.PI);
  }

  /** Turns times `perTurn`. */
  value(): number {
    return this.turns * this.spec.perTurn;
  }

  reach(side: HandIndex, hand: HandInput): number {
    if (this.held[side] || (this.spec.grip === 'crank' && this.anyHeld)) {
      return Infinity;
    }
    const [x, y, z] = hand.fist;
    const r = this.spec.radius;
    if (this.spec.grip === 'crank') {
      const kx = -r * Math.sin(this.angle);
      const ky = r * Math.cos(this.angle);
      const kz = z < 0 ? 0 : z > this.spec.knobLength ? this.spec.knobLength : z;
      return Math.hypot(x - kx, y - ky, z - kz);
    }
    return Math.hypot(Math.hypot(x, y) - r, z);
  }

  grab(side: HandIndex, hand: HandInput): boolean {
    if (this.reach(side, hand) === Infinity) {
      return false;
    }
    this.held[side] = true;
    // A fist too near the axle to read its angle (on a small crank) is taken to be on the knob, and turns it from there.
    let a = wheelAngleOf(hand.fist[0], hand.fist[1]);
    if (Number.isNaN(a)) a = this.angle;
    this.offset[side] = this.angle - this.hands[side].start(a, hand.tracked);
    this.spot[side] = this.spec.grip === 'crank' ? 0 : wrap(a - this.angle);
    return true;
  }

  update(dt: number, hands: readonly (HandInput | null)[]): number {
    const { min, max } = this.spec;
    const before = this.angle;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 2; i++) {
      if (!this.held[i]) continue;
      const hand = hands[i];
      if (!hand) continue;
      sum += this.hands[i].stepAround(hand.fist[0], hand.fist[1], NEAR_AXLE * this.spec.radius, dt) + this.offset[i];
      count++;
    }
    let overshoot = 0;
    if (count > 0) {
      const wanted = sum / count;
      this.angle = wanted < min ? min : wanted > max ? max : wanted;
      overshoot = Math.abs(wanted - this.angle);
    }
    if (this.held[0]) this.strain[0] = overshoot;
    if (this.held[1]) this.strain[1] = overshoot;
    let events: number = MechEvent.None;
    if ((Number.isFinite(min) || Number.isFinite(max)) && this.bump.step(this.angle, min, max)) {
      events |= MechEvent.Limit;
    }
    if (this.anyHeld && this.ticker.step(before, this.angle, this.spec.tickEvery)) {
      events |= MechEvent.Detent;
    }
    if (this.spec.trigger) {
      const hand = this.held[0] ? hands[0] : this.held[1] ? hands[1] : null;
      const trigger = hand ? hand.trigger : 0;
      const pulled = this.firing ? trigger > TRIGGER_OFF : trigger > TRIGGER_ON;
      if (pulled !== this.firing) {
        this.firing = pulled;
        events |= pulled ? MechEvent.Press : MechEvent.Release;
      }
    }
    return events;
  }

  handle(which: HandIndex, out: Vec3): Vec3 {
    const r = this.spec.radius;
    // A crank's knob halfway out; a rim at its left or right side.
    const a = this.spec.grip === 'crank' ? this.angle : which === 0 ? Math.PI / 2 : -Math.PI / 2;
    out[0] = -r * Math.sin(a);
    out[1] = r * Math.cos(a);
    out[2] = this.spec.grip === 'crank' ? this.spec.knobLength / 2 : 0;
    return out;
  }

  lock(side: HandIndex | -1, fist: Vec3, point: Vec3, axis: Vec3): void {
    const r = this.spec.radius;
    if (this.spec.grip === 'crank') {
      const kz = this.spec.knobLength;
      point[0] = -r * Math.sin(this.angle);
      point[1] = r * Math.cos(this.angle);
      point[2] = fist[2] < 0 ? 0 : fist[2] > kz ? kz : fist[2];
      axis[0] = 0;
      axis[1] = 0;
      axis[2] = 1;
      return;
    }
    // On the rim where this hand closed, turning with the wheel; the crewmate's at the nearest point.
    let a = side !== -1 && this.held[side] ? this.angle + this.spot[side] : wheelAngleOf(fist[0], fist[1]);
    if (Number.isNaN(a)) a = 0;
    point[0] = -r * Math.sin(a);
    point[1] = r * Math.cos(a);
    point[2] = 0;
    // Along the rim.
    axis[0] = -Math.cos(a);
    axis[1] = -Math.sin(a);
    axis[2] = 0;
  }
}

// ---------------------------------------------------------------- Twist grip

export interface TwistSpec {
  /** The handle runs up the Y axis from `base` to `base + length`, m. */
  base: number;
  length: number;
  /** Furthest it twists each way, radians. */
  max: number;
  /** How fast it springs back to the middle when let go, 1/s. */
  spring: number;
  /** Twists this small read as none, radians. */
  deadband: number;
}

/** The trigger reads as pulled above this, and let go again below `TRIGGER_OFF`. */
export const TRIGGER_ON = 0.6;
export const TRIGGER_OFF = 0.4;

/** A hand's roll about a twist grip's handle (+Y): the angle of `across` round it (as Three.js turns about +Y), or NaN when it lies along the handle. */
export function rollOf(across: Vec3): number {
  const x = across[0];
  const z = across[2];
  if (x * x + z * z < 0.09) {
    return Number.NaN;
  }
  return Math.atan2(-z, x);
}

/**
 * A twist grip with a trigger. Twist space: the handle stands up the Y
 * axis and twists about it; positive is anticlockwise seen from above (as
 * Three.js turns about +Y), so twisting to the right is negative. The twist
 * follows the roll of the hand round the handle, keeping the difference at
 * taking hold, up to `max` either way, and springs back to the middle when
 * let go. Pulling the holding hand's trigger reads as `firing` (Press and
 * Release events).
 */
export class TwistGrip extends Mechanism {
  /** The twist now, radians. */
  angle = 0;
  /** The holding hand's trigger is pulled. */
  firing = false;
  private holder: HandIndex | -1 = -1;
  private offset = 0;
  private readonly hand = new HandAngle();
  private readonly bump = new LimitBump();

  constructor(readonly spec: TwistSpec) {
    super();
  }

  reach(side: HandIndex, hand: HandInput): number {
    if (this.holder !== -1 && this.holder !== side) {
      return Infinity;
    }
    const { base, length } = this.spec;
    return segment(hand.fist, 0, 0, 0, 0, 1, 0, base, base + length, seg);
  }

  grab(side: HandIndex, hand: HandInput): boolean {
    if (this.holder !== -1) {
      return false;
    }
    // A hand lying along the handle can still take hold; it twists once its roll means something.
    const roll = rollOf(hand.across);
    this.offset = Number.isNaN(roll) ? Number.NaN : this.angle - this.hand.start(roll, hand.tracked);
    this.holder = side;
    this.held[side] = true;
    return true;
  }

  release(side: HandIndex): void {
    super.release(side);
    if (this.holder === side) {
      this.holder = -1;
    }
  }

  update(dt: number, hands: readonly (HandInput | null)[]): number {
    const { max } = this.spec;
    let events: number = MechEvent.None;
    let pulled = false;
    if (this.holder !== -1) {
      const hand = hands[this.holder];
      const roll = hand ? rollOf(hand.across) : Number.NaN;
      if (Number.isNaN(this.offset) && !Number.isNaN(roll)) {
        this.offset = this.angle - this.hand.start(roll, hand!.tracked);
      }
      const smooth = Number.isNaN(this.offset) ? Number.NaN : this.hand.step(roll, dt);
      let overshoot = 0;
      if (!Number.isNaN(smooth)) {
        const wanted = smooth + this.offset;
        this.angle = wanted < -max ? -max : wanted > max ? max : wanted;
        overshoot = Math.abs(wanted - this.angle);
      }
      this.strain[this.holder] = overshoot;
      const trigger = hand ? hand.trigger : 0;
      pulled = this.firing ? trigger > TRIGGER_OFF : trigger > TRIGGER_ON;
    } else {
      this.angle *= Math.exp(-this.spec.spring * dt);
    }
    if (pulled !== this.firing) {
      this.firing = pulled;
      events |= pulled ? MechEvent.Press : MechEvent.Release;
    }
    if (this.bump.step(this.angle, -max, max)) {
      events |= MechEvent.Limit;
    }
    return events;
  }

  /** The twist as a demand from −1 (fully right) to 1 (fully left), 0 within the deadband. */
  demand(): number {
    const { max, deadband } = this.spec;
    const a = Math.abs(this.angle);
    if (a <= deadband) {
      return 0;
    }
    return (Math.sign(this.angle) * (a - deadband)) / (max - deadband);
  }

  handle(_which: HandIndex, out: Vec3): Vec3 {
    out[0] = 0;
    out[1] = this.spec.base + this.spec.length / 2;
    out[2] = 0;
    return out;
  }

  lock(_side: HandIndex | -1, fist: Vec3, point: Vec3, axis: Vec3): void {
    const { base, length } = this.spec;
    point[0] = 0;
    point[1] = fist[1] < base ? base : fist[1] > base + length ? base + length : fist[1];
    point[2] = 0;
    axis[0] = 0;
    axis[1] = 1;
    axis[2] = 0;
  }
}

// ---------------------------------------------------------------- Yoke

export interface YokeSpec {
  /** Each handle runs out along ±X from `inner` to `outer` from the middle, m. */
  inner: number;
  outer: number;
  /** Limits, radians (−Infinity and Infinity: it turns all the way round). */
  min: number;
  max: number;
  /** Fastest it turns held in one hand, rad/s; in both, it keeps up with them. */
  oneHandSpeed: number;
  /** A tick in the hand every this many radians turned (0: none). */
  tickEvery: number;
}

/**
 * A two-handled yoke. Yoke space: it turns about +Y through the origin
 * (positive anticlockwise seen from above, as Three.js turns about +Y),
 * with a handle out along each side, -X the left and +X the right. Both
 * hands turn it by the mean of where each would take it, as fast as they
 * go; one hand turns it too, but no faster than `oneHandSpeed`, so the
 * hand gets ahead of it and feels the strain.
 */
export class Yoke extends Mechanism {
  /** Its turn now, radians. */
  angle = 0;
  /** Which handle each hand holds: -1 the left, 1 the right, 0 none. */
  private readonly grips: [number, number] = [0, 0];
  private readonly hands = [new HandAngle(), new HandAngle()];
  private readonly offset: [number, number] = [0, 0];
  private readonly ticker = new Ticker();
  private readonly bump = new LimitBump();

  constructor(readonly spec: YokeSpec) {
    super();
  }

  /** The angle of a point round the upright, measured from handle `dir` (-1 left, 1 right), or NaN near the upright. */
  private angleFrom(dir: number, fist: Vec3): number {
    const x = fist[0] * dir;
    const z = fist[2] * dir;
    if (x * x + z * z < MIN_HAND_RADIUS * MIN_HAND_RADIUS) {
      return Number.NaN;
    }
    return Math.atan2(-z, x);
  }

  /** Distance from `fist` to handle `dir`, at the yoke's angle now. */
  private gap(dir: number, fist: Vec3): number {
    const c = Math.cos(this.angle) * dir;
    const s = -Math.sin(this.angle) * dir;
    return segment(fist, 0, 0, 0, c, 0, s, this.spec.inner, this.spec.outer, seg);
  }

  /** The free handle nearest `fist`, and its distance, into `pick`. */
  private nearest(fist: Vec3, pick: { dir: number; d: number }): void {
    pick.dir = 0;
    pick.d = Infinity;
    for (let dir = -1; dir <= 1; dir += 2) {
      if (this.grips[0] === dir || this.grips[1] === dir) continue;
      const d = this.gap(dir, fist);
      if (d < pick.d) {
        pick.d = d;
        pick.dir = dir;
      }
    }
  }
  private readonly pick = { dir: 0, d: 0 };

  reach(side: HandIndex, hand: HandInput): number {
    if (this.held[side]) {
      return Infinity;
    }
    this.nearest(hand.fist, this.pick);
    return this.pick.d;
  }

  grab(side: HandIndex, hand: HandInput): boolean {
    if (this.held[side]) {
      return false;
    }
    this.nearest(hand.fist, this.pick);
    const dir = this.pick.dir;
    const a = dir === 0 ? Number.NaN : this.angleFrom(dir, hand.fist);
    if (Number.isNaN(a)) {
      return false;
    }
    this.offset[side] = this.angle - this.hands[side].start(a, hand.tracked);
    this.grips[side] = dir;
    this.held[side] = true;
    return true;
  }

  release(side: HandIndex): void {
    super.release(side);
    this.grips[side] = 0;
  }

  update(dt: number, hands: readonly (HandInput | null)[]): number {
    const { min, max } = this.spec;
    const before = this.angle;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 2; i++) {
      if (!this.held[i]) continue;
      const hand = hands[i];
      const smooth = this.hands[i].step(hand ? this.angleFrom(this.grips[i], hand.fist) : Number.NaN, dt);
      if (!Number.isNaN(smooth)) {
        sum += smooth + this.offset[i];
        count++;
      }
    }
    let lag = 0;
    if (count > 0) {
      let wanted = sum / count;
      wanted = wanted < min ? min : wanted > max ? max : wanted;
      const holders = (this.held[0] ? 1 : 0) + (this.held[1] ? 1 : 0);
      const step = holders >= 2 ? Infinity : this.spec.oneHandSpeed * dt;
      const move = wanted - this.angle;
      this.angle += move > step ? step : move < -step ? -step : move;
      lag = Math.abs(sum / count - this.angle);
    }
    if (this.held[0]) this.strain[0] = lag;
    if (this.held[1]) this.strain[1] = lag;
    let events: number = MechEvent.None;
    if ((Number.isFinite(min) || Number.isFinite(max)) && this.bump.step(this.angle, min, max)) {
      events |= MechEvent.Limit;
    }
    if (this.anyHeld && this.ticker.step(before, this.angle, this.spec.tickEvery)) {
      events |= MechEvent.Detent;
    }
    return events;
  }

  handle(which: HandIndex, out: Vec3): Vec3 {
    const dir = which === 0 ? -1 : 1;
    const r = (this.spec.inner + this.spec.outer) / 2;
    out[0] = r * Math.cos(this.angle) * dir;
    out[1] = 0;
    out[2] = -r * Math.sin(this.angle) * dir;
    return out;
  }

  lock(side: HandIndex | -1, fist: Vec3, point: Vec3, axis: Vec3): void {
    let dir = side !== -1 ? this.grips[side] : 0;
    if (dir === 0) {
      dir = this.gap(-1, fist) < this.gap(1, fist) ? -1 : 1;
    }
    const c = Math.cos(this.angle) * dir;
    const s = -Math.sin(this.angle) * dir;
    segment(fist, 0, 0, 0, c, 0, s, this.spec.inner, this.spec.outer, seg);
    point[0] = seg.t * c;
    point[1] = 0;
    point[2] = seg.t * s;
    axis[0] = c;
    axis[1] = 0;
    axis[2] = s;
  }
}

// ---------------------------------------------------------------- Button

export interface ButtonSpec {
  /** The cap's radius, m. */
  radius: number;
  /** How far it goes in, m. */
  travel: number;
  /** A switch: each press turns it on or off. Otherwise it is on only while held in. */
  latching: boolean;
}

/** A button goes in (Press) at this share of its travel, and comes back out (Release) below `BUTTON_OUT`. */
export const BUTTON_IN = 0.7;
export const BUTTON_OUT = 0.3;

/**
 * A push button or a push-on, push-off switch. Button space: the cap's
 * face is at the origin facing +Z and it goes in along -Z. A fingertip
 * pushes it in as far as the tip goes past the face (within the cap's
 * radius); a squeeze of a fist at the cap holds it right in. It is held
 * like a handle only in that the squeezing hand can't take hold of
 * anything else; the hand isn't drawn on it.
 */
export class Button extends Mechanism {
  /** How far in it is now, m. */
  depth = 0;
  /** In past the press point. */
  down = false;
  /** A switch that is on, or a button held in. */
  on = false;
  /** How many times it has been pressed. */
  presses = 0;
  /** The hand that pressed it last, for the buzz (-1 before any). */
  pressedBy: HandIndex | -1 = -1;

  constructor(readonly spec: ButtonSpec) {
    super();
    this.reachRadius = 0.06;
  }

  reach(side: HandIndex, hand: HandInput): number {
    if (this.held[side]) {
      return Infinity;
    }
    const [x, y, z] = hand.fist;
    return Math.hypot(x, y, z);
  }

  grab(side: HandIndex, _hand: HandInput): boolean {
    this.held[side] = true;
    return true;
  }

  update(_dt: number, hands: readonly (HandInput | null)[]): number {
    const { radius, travel } = this.spec;
    let depth = 0;
    let by: HandIndex | -1 = -1;
    for (let i = 0; i < 2; i++) {
      const side = i as HandIndex;
      let d = 0;
      if (this.held[side]) {
        d = travel;
      } else {
        const tip = hands[side]?.tip;
        // A fingertip over the cap, past its face but not so far it came from behind.
        if (tip && tip[2] < 0.005 && tip[2] > -travel - 0.03 && Math.hypot(tip[0], tip[1]) < radius + 0.008) {
          d = Math.min(travel, -tip[2]);
        }
      }
      if (d > depth) {
        depth = d;
        by = side;
      }
    }
    this.depth = depth > 0 ? depth : 0;
    let events: number = MechEvent.None;
    if (!this.down && this.depth >= BUTTON_IN * travel) {
      this.down = true;
      this.presses++;
      this.pressedBy = by;
      this.on = this.spec.latching ? !this.on : true;
      events |= MechEvent.Press;
    } else if (this.down && this.depth < BUTTON_OUT * travel) {
      this.down = false;
      if (!this.spec.latching) this.on = false;
      events |= MechEvent.Release;
    }
    return events;
  }

  handle(_which: HandIndex, out: Vec3): Vec3 {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }

  lock(_side: HandIndex | -1, _fist: Vec3, point: Vec3, axis: Vec3): void {
    point[0] = 0;
    point[1] = 0;
    point[2] = 0;
    axis[0] = 1;
    axis[1] = 0;
    axis[2] = 0;
  }
}

