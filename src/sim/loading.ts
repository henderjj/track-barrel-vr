/**
 * Spike S4: loading a shell (docs/spikes/s4-loading.md). Engine-free, so it
 * can be unit tested: the loading drill's rules, layout and stats, driven by
 * the two hands' grip poses each frame (src/systems/loading-drill-system.ts
 * draws it and feeds it the hands).
 *
 * A seated loader takes a shell from the ready rack on their right, swings it
 * across to the breech on their left, puts its nose to the breech mouth
 * (where it snaps onto the bore's line once near enough and pointing the
 * right way), rams it home by pushing (holding it, shoving it and letting go
 * so it slides in, or pushing its base with an open hand), and closes the
 * breech by pulling the lever back. The drill then fires the gun by itself:
 * the breech opens, the shell goes back in the rack, and the next load is
 * timed from that moment.
 *
 * Station space: the station's floor at y = 0, the loader faces -Z, +X to
 * their right. It is hull space (src/sim/cabin.ts) moved sideways to
 * STATION_SPOT, so the numbers below are the spike's own. Heights assume
 * seated play, which raises a seated player's eyes to 1.45 m
 * (src/sim/body-height.ts).
 */

export type Vec3 = [number, number, number];
/** A rotation as a unit quaternion, x, y, z, w. */
export type Quat = [number, number, number, number];
export type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];

/**
 * Where station space's origin is in hull space: beside the tank's left
 * track, facing the tank's way, on a platform level with the hull floor.
 * The station stands there until F1.10 moves loading into the turret.
 */
export const STATION_SPOT = { x: -3.1, z: 0 } as const;

/** Where the seated loader's eyes go (x, z): the Practice button puts the player's head here, facing -Z. */
export const LOADER_SEAT = { x: 0, z: 1.45 } as const;

/** A shell, m. Shorter than a real 88 mm round (0.93 m) so a seated arm can ram it; the headset check judges this. */
export const SHELL_LENGTH = 0.6;
export const SHELL_RADIUS = 0.044;
/** Shells in the ready rack. */
export const SHELL_COUNT = 4;
/** Each rack slot's shell centre; the shells lie nose to -Z. Two rows of two, to the loader's right, above knee height. */
export const RACK_SLOTS: readonly Readonly<Vec3>[] = [
  [0.36, 0.84, 1.15],
  [0.47, 0.84, 1.15],
  [0.36, 0.98, 1.15],
  [0.47, 0.98, 1.15],
];

/** The middle of the breech mouth, where a shell's nose goes in. The bore runs from here to -Z, to the loader's front left. */
export const BREECH_MOUTH: Readonly<Vec3> = [-0.38, 1.1, 0.95];
/** The bore's direction, into the gun. */
export const BORE: Readonly<Vec3> = [0, 0, -1];

/**
 * The breech lever turns about an axis along X at its pivot, on the side of
 * the breech facing the loader. Open, its handle points up; pulled back
 * towards the loader a quarter turn, the breech is closed.
 */
export const LEVER_PIVOT: Readonly<Vec3> = [-0.23, 1.1, 0.89];
/** From the pivot to the middle of the handle, m... */
export const LEVER_LENGTH = 0.16;
/** ...which sticks out this far towards the loader (+X) from the arm, m. */
export const LEVER_HANDLE_X = 0.045;
/** The lever's angle when closed, rad (0 open). */
export const LEVER_CLOSED = Math.PI / 2;
/** Beyond this the breech block covers the mouth, so a shell can't go in; and with a shell part-way in, the lever stops here (the block meets the case), rad. */
export const LEVER_BLOCKED = 0.3;
/** Within this of closed the lever latches closed, rad. */
const LEVER_LATCH = 0.03;

/** A squeezing hand takes a shell within this of its surface, m. */
export const GRAB_REACH = 0.07;
/** A squeezing hand takes the lever within this of the middle of its handle, m. */
export const LEVER_REACH = 0.09;
/** A held shell snaps onto the bore once its nose is within this of the bore's line... m */
export const CAPTURE_RADIUS = 0.05;
/** ...from this far outside the mouth to this far in, m... */
export const CAPTURE_OUTSIDE = 0.08;
export const CAPTURE_INSIDE = 0.04;
/** ...and it points within this of the bore's direction, rad. */
export const CAPTURE_ANGLE = (20 * Math.PI) / 180;
/** A shell in the breech pulled this far back out of the mouth comes free in the hand (beyond the capture zone, so it doesn't snap straight back), m. */
export const UNSEAT = 0.1;
/** A hand further than this from what it holds lets go (as grip locking, src/systems/hand-lock.ts), m. */
export const SLIP = 0.25;
/** An open hand this close to the bore's line pushes on the base of a shell in the breech, m. */
export const PALM_RADIUS = 0.07;
/** A shell let go in the breech slides on at the speed it was pushed, slowing at this, m/s². */
export const SLIDE_DECEL = 2;
/** After the breech closes on a rammed shell, the gun fires after this long, s. */
export const FIRE_DELAY = 1.5;
/** A dropped shell goes back in the rack this long after it lands, s. */
export const RETURN_DELAY = 1;
/** Ten loads in a row without a fumble passes the spike (docs/plan.md, section 5). */
export const STREAK_GOAL = 10;
/** Load times kept for the stats, newest last. */
const TIMES_KEPT = 50;
const GRAVITY = 9.81;
/** Time constant of the smoothing on a pushed shell's speed, s. */
const PUSH_SMOOTH = 0.05;

/** Where a shell is. */
export type ShellPlace = 'rack' | 'hand' | 'breech' | 'falling' | 'floor';

export interface Shell {
  place: ShellPlace;
  /** Middle of the shell (scene space). */
  centre: Vec3;
  /** Unit vector from its base to its nose. */
  axis: Vec3;
  /** The hand holding it. */
  heldBy: Side | null;
  /** Its centre and axis in the holding hand's grip space. */
  localCentre: Vec3;
  localAxis: Vec3;
  /** Falling speed, m/s (up is +). */
  fallSpeed: number;
  /** Drill time it goes back in the rack (on the floor), s. */
  returnAt: number;
}

/** What a hand holds: a shell's index, the lever, or nothing. */
export const HOLD_NONE = -1;
export const HOLD_LEVER = -2;

/** One hand this frame, from its grip pose. */
export interface DrillHand {
  /** Tracked (a controller or a hand). */
  present: boolean;
  /** Grip squeezed (src/systems/grip-system.ts). */
  pressed: boolean;
  /** Holding something of another system's (a block), so it can't take anything here. */
  busy: boolean;
  pos: Vec3;
  quat: Quat;
}

export function createDrillHand(): DrillHand {
  return { present: false, pressed: false, busy: false, pos: [0, 0, 0], quat: [0, 0, 0, 1] };
}

/** Things that happened in an update, for haptics, sounds and the log. */
export type DrillEventKind =
  | 'grab-shell'
  | 'grab-lever'
  | 'capture'
  | 'unseat'
  | 'rammed'
  | 'closed'
  | 'opened'
  | 'blocked'
  | 'dropped'
  | 'loaded'
  | 'fired'
  | 'returned';

export interface DrillEvent {
  kind: DrillEventKind;
  side: Side | null;
}

const MAX_EVENTS = 16;

export interface LoadStats {
  /** Loads completed (the breech closed on a rammed shell). */
  loads: number;
  /** From the breech opening to it closing on a rammed shell, s, newest last. */
  times: number[];
  /** The last load's time and its handling time (from first touching a shell to closing), s. */
  last: number;
  lastHandling: number;
  best: number;
  /** Fumbles: a shell dropped outside the breech, or the lever forced against a shell not rammed home. */
  fumbles: number;
  dropped: number;
  blocked: number;
  /** Fumbles since the breech last opened. */
  fumblesThisLoad: number;
  /** Loads in a row without a fumble, and the most. */
  streak: number;
  bestStreak: number;
}

export function createLoadStats(): LoadStats {
  return {
    loads: 0,
    times: [],
    last: Number.NaN,
    lastHandling: Number.NaN,
    best: Number.NaN,
    fumbles: 0,
    dropped: 0,
    blocked: 0,
    fumblesThisLoad: 0,
    streak: 0,
    bestStreak: 0,
  };
}

/** Distance along the bore from the mouth (+ inside the gun). */
export function boreDepth(p: Readonly<Vec3>): number {
  return (p[0] - BREECH_MOUTH[0]) * BORE[0] + (p[1] - BREECH_MOUTH[1]) * BORE[1] + (p[2] - BREECH_MOUTH[2]) * BORE[2];
}

/** Distance from the bore's line. */
export function boreOffset(p: Readonly<Vec3>): number {
  const d = boreDepth(p);
  return Math.hypot(
    p[0] - BREECH_MOUTH[0] - BORE[0] * d,
    p[1] - BREECH_MOUTH[1] - BORE[1] * d,
    p[2] - BREECH_MOUTH[2] - BORE[2] * d,
  );
}

/** Where the middle of the lever's handle is at `angle`. */
export function leverHandle(angle: number, out: Vec3): Vec3 {
  out[0] = LEVER_PIVOT[0] + LEVER_HANDLE_X;
  out[1] = LEVER_PIVOT[1] + LEVER_LENGTH * Math.cos(angle);
  out[2] = LEVER_PIVOT[2] + LEVER_LENGTH * Math.sin(angle);
  return out;
}

/** The lever angle a hand at `p` pulls it to, before limits: its angle about the pivot from straight up towards the loader. */
export function leverAngleFor(p: Readonly<Vec3>): number {
  return Math.atan2(p[2] - LEVER_PIVOT[2], p[1] - LEVER_PIVOT[1]);
}

/** Rotate `v` by `q` into `out` (which may be `v`). */
export function rotate(q: Readonly<Quat>, v: Readonly<Vec3>, out: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 q×v; v' = v + w t + q×t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** Rotate `v` by the inverse of `q` into `out` (which may be `v`). */
export function unrotate(q: Readonly<Quat>, v: Readonly<Vec3>, out: Vec3): Vec3 {
  const inverse = scratchQuat;
  inverse[0] = -q[0];
  inverse[1] = -q[1];
  inverse[2] = -q[2];
  inverse[3] = q[3];
  return rotate(inverse, v, out);
}
const scratchQuat: Quat = [0, 0, 0, 1];

/** Distance from `p` to the axis segment of a shell with centre `c` and unit axis `a`. */
export function distanceToShellAxis(p: Readonly<Vec3>, c: Readonly<Vec3>, a: Readonly<Vec3>): number {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const dz = p[2] - c[2];
  const half = SHELL_LENGTH / 2;
  const t = Math.max(-half, Math.min(half, dx * a[0] + dy * a[1] + dz * a[2]));
  return Math.hypot(dx - a[0] * t, dy - a[1] * t, dz - a[2] * t);
}

/**
 * The loading drill. Call `update` once a frame with both hands; read the
 * shells, the lever and the stats to draw them, and `events` for what
 * happened. Allocates nothing per frame (only when a load is recorded).
 */
export class LoadingDrill {
  readonly shells: Shell[] = [];
  /** The lever's angle, rad: 0 open, LEVER_CLOSED closed. */
  lever = 0;
  /** The shell in the breech (index), or -1. */
  breechShell = -1;
  /** How far the shell in the breech is in: its nose's depth past the mouth, m (SHELL_LENGTH when home). */
  depth = 0;
  /** The shell in the breech is rammed home. */
  rammed = false;
  /** The breech closed on a rammed shell; the gun fires at `fireAt`. */
  loaded = false;
  fireAt = Number.POSITIVE_INFINITY;
  /** What each hand holds: a shell index, HOLD_LEVER or HOLD_NONE. */
  readonly holds: Record<Side, number> = { left: HOLD_NONE, right: HOLD_NONE };
  readonly stats = createLoadStats();
  /** This update's events (the first `eventCount`). */
  readonly events: DrillEvent[] = [];
  eventCount = 0;
  /** Bumped whenever something the board shows changes. */
  version = 0;
  /** Drill time, s. */
  time = 0;
  /** When the breech last opened for a load, and when a hand first took a shell since, s. */
  readyAt = 0;
  firstTouchAt = Number.NaN;

  private wasPressed: Record<Side, boolean> = { left: false, right: false };
  /** Each hand's depth along the bore last frame, for an open hand pushing on a base. */
  private lastHandDepth: Record<Side, number> = { left: Number.NaN, right: Number.NaN };
  /** A held shell in the breech: its depth less the holding hand's. */
  private gripDepth = 0;
  /** The shell in the breech's speed along the bore, m/s (smoothed while pushed; sliding once let go). */
  private slideSpeed = 0;
  /** The lever is being forced against a shell part-way in (counted once per push). */
  private forcing = false;
  /** The holding hand's angle about the pivot less the lever's, from taking hold, so the lever doesn't jump to the hand. */
  private leverGrip = 0;
  private v: Vec3 = [0, 0, 0];
  private w: Vec3 = [0, 0, 0];

  constructor() {
    for (let i = 0; i < SHELL_COUNT; i++) {
      this.shells.push({
        place: 'rack',
        centre: [...RACK_SLOTS[i]] as Vec3,
        axis: [0, 0, -1],
        heldBy: null,
        localCentre: [0, 0, 0],
        localAxis: [0, 0, -1],
        fallSpeed: 0,
        returnAt: 0,
      });
    }
    for (let i = 0; i < MAX_EVENTS; i++) {
      this.events.push({ kind: 'grab-shell', side: null });
    }
  }

  /** Start again: every shell in the rack, the breech open and empty, the stats cleared. */
  reset(): void {
    for (let i = 0; i < this.shells.length; i++) {
      this.toRack(i);
    }
    this.holds.left = HOLD_NONE;
    this.holds.right = HOLD_NONE;
    this.lever = 0;
    this.breechShell = -1;
    this.depth = 0;
    this.rammed = false;
    this.loaded = false;
    this.fireAt = Number.POSITIVE_INFINITY;
    this.slideSpeed = 0;
    this.forcing = false;
    Object.assign(this.stats, createLoadStats());
    this.readyAt = this.time;
    this.firstTouchAt = Number.NaN;
    this.version++;
  }

  /** Advance by `dt` seconds with the hands as they are now. */
  update(dt: number, left: DrillHand, right: DrillHand): void {
    this.eventCount = 0;
    this.time += dt;
    for (const side of SIDES) {
      const hand = side === 'left' ? left : right;
      const pressed = hand.present && hand.pressed;
      const down = pressed && !this.wasPressed[side];
      this.wasPressed[side] = pressed;
      if (!pressed && this.holds[side] !== HOLD_NONE) {
        this.letGo(side);
      }
      if (down && !hand.busy && this.holds[side] === HOLD_NONE) {
        this.grab(side, hand);
      }
    }
    for (const side of SIDES) {
      const hand = side === 'left' ? left : right;
      const hold = this.holds[side];
      if (hold === HOLD_LEVER) {
        this.moveLever(side, hand);
      } else if (hold >= 0) {
        this.moveHeldShell(side, hand, hold, dt);
      }
    }
    this.slide(dt);
    for (const side of SIDES) {
      const hand = side === 'left' ? left : right;
      this.palmPush(side, hand);
    }
    this.fall(dt);
    if (this.loaded && this.time >= this.fireAt) {
      this.fire();
    }
  }

  /** The nose of shell `i`. */
  nose(i: number, out: Vec3): Vec3 {
    const s = this.shells[i];
    const h = SHELL_LENGTH / 2;
    out[0] = s.centre[0] + s.axis[0] * h;
    out[1] = s.centre[1] + s.axis[1] * h;
    out[2] = s.centre[2] + s.axis[2] * h;
    return out;
  }

  private emit(kind: DrillEventKind, side: Side | null): void {
    if (this.eventCount < MAX_EVENTS) {
      const e = this.events[this.eventCount++];
      e.kind = kind;
      e.side = side;
    }
  }

  private grab(side: Side, hand: DrillHand): void {
    let best = HOLD_NONE;
    let bestDistance = Number.POSITIVE_INFINITY;
    const handle = leverHandle(this.lever, this.v);
    const toLever = Math.hypot(hand.pos[0] - handle[0], hand.pos[1] - handle[1], hand.pos[2] - handle[2]);
    const otherHolds = this.holds[side === 'left' ? 'right' : 'left'];
    if (toLever < LEVER_REACH && otherHolds !== HOLD_LEVER && !this.loaded) {
      best = HOLD_LEVER;
      bestDistance = toLever;
    }
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      // A rammed shell stays put while the breech is closed, and while it is about to fire.
      if (s.heldBy !== null || (i === this.breechShell && (this.loaded || this.lever > LEVER_BLOCKED))) {
        continue;
      }
      const d = distanceToShellAxis(hand.pos, s.centre, s.axis) - SHELL_RADIUS;
      if (d < GRAB_REACH && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    if (best === HOLD_LEVER) {
      this.holds[side] = HOLD_LEVER;
      this.leverGrip = leverAngleFor(hand.pos) - this.lever;
      this.emit('grab-lever', side);
      return;
    }
    if (best < 0) {
      return;
    }
    const s = this.shells[best];
    this.holds[side] = best;
    s.heldBy = side;
    if (best === this.breechShell) {
      // Taking hold of a shell in the breech: it stays on the bore's line, following the hand along it.
      this.rammed = false;
      this.gripDepth = this.depth - boreDepth(hand.pos);
      this.slideSpeed = 0;
    } else {
      s.place = 'hand';
      this.attach(s, hand);
    }
    if (Number.isNaN(this.firstTouchAt)) {
      this.firstTouchAt = this.time;
    }
    this.emit('grab-shell', side);
  }

  /** Hold `s` where it is now, relative to `hand`. */
  private attach(s: Shell, hand: DrillHand): void {
    const d = this.w;
    d[0] = s.centre[0] - hand.pos[0];
    d[1] = s.centre[1] - hand.pos[1];
    d[2] = s.centre[2] - hand.pos[2];
    unrotate(hand.quat, d, s.localCentre);
    unrotate(hand.quat, s.axis, s.localAxis);
  }

  private letGo(side: Side): void {
    const hold = this.holds[side];
    this.holds[side] = HOLD_NONE;
    if (hold === HOLD_LEVER) {
      this.forcing = false;
      return;
    }
    const s = this.shells[hold];
    s.heldBy = null;
    if (s.place === 'hand') {
      s.place = 'falling';
      s.fallSpeed = 0;
      this.fumble('dropped', side);
    }
    // A shell in the breech stays there, sliding on at the speed it was pushed (slideSpeed).
  }

  private fumble(kind: 'dropped' | 'blocked', side: Side | null): void {
    this.stats.fumbles++;
    this.stats[kind]++;
    this.stats.fumblesThisLoad++;
    this.stats.streak = 0;
    this.version++;
    this.emit(kind, side);
  }

  private moveHeldShell(side: Side, hand: DrillHand, i: number, dt: number): void {
    const s = this.shells[i];
    if (s.place === 'hand') {
      rotate(hand.quat, s.localCentre, s.centre);
      s.centre[0] += hand.pos[0];
      s.centre[1] += hand.pos[1];
      s.centre[2] += hand.pos[2];
      rotate(hand.quat, s.localAxis, s.axis);
      this.tryCapture(i, side, hand);
      return;
    }
    // In the breech: the hand slides it along the bore.
    const wanted = boreDepth(hand.pos) + this.gripDepth;
    if (wanted < -UNSEAT) {
      // Out where the hand has it, clear of the mouth.
      this.setDepth(wanted);
      this.breechShell = -1;
      this.depth = 0;
      s.place = 'hand';
      this.attach(s, hand);
      this.version++;
      this.emit('unseat', side);
      return;
    }
    const depth = Math.max(0, Math.min(SHELL_LENGTH, wanted));
    if (dt > 0) {
      const speed = (depth - this.depth) / dt;
      this.slideSpeed += (speed - this.slideSpeed) * Math.min(1, dt / PUSH_SMOOTH);
    }
    this.setDepth(depth);
    if (this.depth >= SHELL_LENGTH) {
      // Home: the hand lets go of it.
      this.holds[side] = HOLD_NONE;
      s.heldBy = null;
      this.ram(side);
    } else if (distanceToShellAxis(hand.pos, s.centre, s.axis) > SLIP) {
      this.holds[side] = HOLD_NONE;
      s.heldBy = null;
    }
  }

  /** A held shell's nose near the mouth, pointing along the bore, snaps onto it. */
  private tryCapture(i: number, side: Side, hand: DrillHand): void {
    if (this.breechShell >= 0 || this.lever > LEVER_BLOCKED) {
      return;
    }
    const s = this.shells[i];
    const nose = this.nose(i, this.v);
    const depth = boreDepth(nose);
    if (depth < -CAPTURE_OUTSIDE || depth > CAPTURE_INSIDE || boreOffset(nose) > CAPTURE_RADIUS) {
      return;
    }
    const along = s.axis[0] * BORE[0] + s.axis[1] * BORE[1] + s.axis[2] * BORE[2];
    if (along < Math.cos(CAPTURE_ANGLE)) {
      return;
    }
    s.place = 'breech';
    this.breechShell = i;
    this.rammed = false;
    this.slideSpeed = 0;
    this.setDepth(Math.max(0, depth));
    this.gripDepth = this.depth - boreDepth(hand.pos);
    this.version++;
    this.emit('capture', side);
  }

  /** Put the shell in the breech `depth` in, on the bore's line. */
  private setDepth(depth: number): void {
    this.depth = depth;
    const s = this.shells[this.breechShell];
    const c = depth - SHELL_LENGTH / 2;
    s.axis[0] = BORE[0];
    s.axis[1] = BORE[1];
    s.axis[2] = BORE[2];
    s.centre[0] = BREECH_MOUTH[0] + BORE[0] * c;
    s.centre[1] = BREECH_MOUTH[1] + BORE[1] * c;
    s.centre[2] = BREECH_MOUTH[2] + BORE[2] * c;
  }

  private ram(side: Side | null): void {
    this.setDepth(SHELL_LENGTH);
    this.rammed = true;
    this.slideSpeed = 0;
    this.version++;
    this.emit('rammed', side);
  }

  /** A shell let go in the breech slides on at the speed it was pushed. */
  private slide(dt: number): void {
    const i = this.breechShell;
    if (i < 0 || this.rammed || this.shells[i].heldBy !== null) {
      return;
    }
    if (this.slideSpeed <= 0) {
      this.slideSpeed = 0;
      return;
    }
    const depth = this.depth + this.slideSpeed * dt;
    this.slideSpeed -= SLIDE_DECEL * dt;
    if (depth >= SHELL_LENGTH) {
      this.ram(null);
    } else {
      this.setDepth(depth);
    }
  }

  /** A hand not holding anything that moves forward onto the base of a shell in the breech pushes it in. */
  private palmPush(side: Side, hand: DrillHand): void {
    const depth = boreDepth(hand.pos);
    const before = this.lastHandDepth[side];
    this.lastHandDepth[side] = hand.present ? depth : Number.NaN;
    const i = this.breechShell;
    if (i < 0 || this.rammed || !hand.present || this.holds[side] !== HOLD_NONE || this.shells[i].heldBy !== null) {
      return;
    }
    const base = this.depth - SHELL_LENGTH;
    if (!(before <= base + 0.02) || depth <= base || boreOffset(hand.pos) > PALM_RADIUS) {
      return;
    }
    if (depth + SHELL_LENGTH >= SHELL_LENGTH) {
      this.ram(side);
    } else {
      this.setDepth(depth + SHELL_LENGTH);
    }
  }

  private moveLever(side: Side, hand: DrillHand): void {
    const handle = leverHandle(this.lever, this.v);
    if (Math.hypot(hand.pos[0] - handle[0], hand.pos[1] - handle[1], hand.pos[2] - handle[2]) > SLIP) {
      this.holds[side] = HOLD_NONE;
      this.forcing = false;
      return;
    }
    const pulled = leverAngleFor(hand.pos) - this.leverGrip;
    const partWay = this.breechShell >= 0 && !this.rammed;
    const limit = partWay ? LEVER_BLOCKED : LEVER_CLOSED;
    if (partWay && pulled > LEVER_BLOCKED + 0.15) {
      if (!this.forcing) {
        this.forcing = true;
        this.fumble('blocked', side);
      }
    } else if (pulled < LEVER_BLOCKED - 0.05) {
      this.forcing = false;
    }
    const wasClosed = this.lever >= LEVER_CLOSED;
    let angle = Math.max(0, Math.min(limit, pulled));
    if (angle >= LEVER_CLOSED - LEVER_LATCH) {
      angle = LEVER_CLOSED;
    }
    this.lever = angle;
    const closed = angle >= LEVER_CLOSED;
    if (closed && !wasClosed) {
      this.emit('closed', side);
      if (this.breechShell >= 0 && this.rammed) {
        this.holds[side] = HOLD_NONE;
        this.recordLoad(side);
      }
    } else if (!closed && wasClosed) {
      this.emit('opened', side);
    }
  }

  private recordLoad(side: Side): void {
    const st = this.stats;
    const time = this.time - this.readyAt;
    st.loads++;
    st.last = time;
    st.lastHandling = Number.isNaN(this.firstTouchAt) ? time : this.time - this.firstTouchAt;
    st.best = Number.isNaN(st.best) ? time : Math.min(st.best, time);
    st.times.push(time);
    if (st.times.length > TIMES_KEPT) {
      st.times.shift();
    }
    if (st.fumblesThisLoad === 0) {
      st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
    }
    this.loaded = true;
    this.fireAt = this.time + FIRE_DELAY;
    this.version++;
    this.emit('loaded', side);
  }

  /** The drill's gun fires: the breech opens and the shell goes back in the rack for the next load. */
  private fire(): void {
    const i = this.breechShell;
    this.loaded = false;
    this.fireAt = Number.POSITIVE_INFINITY;
    this.breechShell = -1;
    this.depth = 0;
    this.rammed = false;
    this.lever = 0;
    for (const side of SIDES) {
      if (this.holds[side] === HOLD_LEVER) this.holds[side] = HOLD_NONE;
    }
    if (i >= 0) this.toRack(i);
    this.readyAt = this.time;
    this.firstTouchAt = Number.NaN;
    this.stats.fumblesThisLoad = 0;
    this.version++;
    this.emit('fired', null);
  }

  private fall(dt: number): void {
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.place === 'falling') {
        s.fallSpeed -= GRAVITY * dt;
        s.centre[1] += s.fallSpeed * dt;
        if (s.centre[1] <= SHELL_RADIUS) {
          // Down on the deck, lying flat.
          s.centre[1] = SHELL_RADIUS;
          s.axis[1] = 0;
          const flat = Math.hypot(s.axis[0], s.axis[2]);
          if (flat > 1e-6) {
            s.axis[0] /= flat;
            s.axis[2] /= flat;
          } else {
            s.axis[0] = 0;
            s.axis[2] = -1;
          }
          s.place = 'floor';
          s.returnAt = this.time + RETURN_DELAY;
        }
      } else if (s.place === 'floor' && this.time >= s.returnAt) {
        this.toRack(i);
        this.emit('returned', null);
      }
    }
  }

  private toRack(i: number): void {
    const s = this.shells[i];
    s.place = 'rack';
    s.heldBy = null;
    s.centre[0] = RACK_SLOTS[i][0];
    s.centre[1] = RACK_SLOTS[i][1];
    s.centre[2] = RACK_SLOTS[i][2];
    s.axis[0] = 0;
    s.axis[1] = 0;
    s.axis[2] = -1;
    s.fallSpeed = 0;
  }
}

/** What the drill's board says: the last and best load times, the fumbles and the streak, and what to do next. */
export function boardLines(drill: LoadingDrill): [string, string, string] {
  const st = drill.stats;
  const secs = (t: number) => (Number.isNaN(t) ? '-' : `${t.toFixed(1)} s`);
  const first = `Loads ${st.loads}   last ${secs(st.last)}   best ${secs(st.best)}`;
  const streak = st.bestStreak >= STREAK_GOAL ? `${STREAK_GOAL} in a row: passed` : `in a row ${st.streak}/${STREAK_GOAL}`;
  const second = `Fumbles ${st.fumbles}   ${streak}`;
  let third: string;
  if (drill.loaded) {
    third = 'Loaded. Firing...';
  } else if (drill.breechShell >= 0 && drill.rammed) {
    third = 'Rammed: close the breech';
  } else if (drill.breechShell >= 0) {
    third = 'Ram it home';
  } else if (drill.lever > LEVER_BLOCKED) {
    third = 'Breech closed: open it';
  } else {
    third = 'Load!';
  }
  return [first, second, third];
}
