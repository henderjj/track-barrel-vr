/**
 * Loading the gun (F1.10, docs/loading-firing.md; first built as spike S4,
 * docs/spikes/s4-loading.md). Engine-free, so it can be unit tested: the
 * ready rack, the shells, the breech and its lever, and the casings the gun
 * throws out, driven by the gunner's two hands each frame
 * (src/systems/loading-system.ts draws it and feeds it the hands).
 *
 * The gunner takes a shell from the ready rack on the turret wall to their
 * right, swings it across to the breech on their left, puts its nose to the
 * breech mouth (where it snaps onto the bore's line once near enough and
 * pointing the right way), rams it home by pushing (holding it, shoving it
 * and letting go so it slides in, or pushing its base with an open hand),
 * and closes the breech by pulling the lever back. The power grip's trigger
 * then fires the gun (`fire`): the breech opens by itself, the casing flies
 * out into the bin under the breech, and the rack refills.
 *
 * Two spaces:
 *
 * - **Turret space** (src/sim/cabin.ts): the rack, the bin, the hands and
 *   every shell outside the breech. It turns with the turret, so the
 *   gunner's seat, the rack and the gun stay put relative to each other.
 * - **Gun space**: turret space elevated with the gun about its trunnions
 *   (origin on the trunnions, the bore running to -Z), where the breech,
 *   its block and lever are. A shell in the breech is placed in gun space,
 *   so it rises and dips with the gun.
 */

import { GUN, SEATS, TURRET } from './cabin.js';

export type Vec3 = [number, number, number];
/** A rotation as a unit quaternion, x, y, z, w. */
export type Quat = [number, number, number, number];
export type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];

/** The gun's trunnions in turret space (as src/sim/turret.ts's TRUNNION, repeated here so this file needn't import the turret's). */
export const TRUNNION_Y = GUN.y;
export const TRUNNION_Z = TURRET.front;

/** A shell, m. Shorter than a real 88 mm round (0.93 m) so a seated arm can ram it (spike S4). */
export const SHELL_LENGTH = 0.6;
export const SHELL_RADIUS = 0.044;
/** The brass case: from the base this far towards the nose, m (the rest is the projectile). */
export const CASE_LENGTH = 0.35;
/** Shells in the ready rack. */
export const SHELL_COUNT = 4;

/**
 * Each rack slot's shell centre, turret space; the shells lie nose forward
 * (-Z). Two rows of two on the turret's right wall beside the gunner,
 * above the turret ring, where a seated right hand reaches out sideways.
 */
export const RACK_SLOTS: readonly Readonly<Vec3>[] = [
  [0.82, 1.98, -0.2],
  [0.94, 1.98, -0.2],
  [0.82, 2.12, -0.2],
  [0.94, 2.12, -0.2],
];

/**
 * The middle of the breech mouth, gun space: the back of the breech, 50 cm
 * ahead of a seated gunner's eyes and 40 cm to their left, where a shell's
 * nose goes in. The bore runs from here to -Z.
 */
export const BREECH_MOUTH: Readonly<Vec3> = [0, 0, GUN.breechBack - TRUNNION_Z];
/** The bore's direction, into the gun, gun space. */
export const BORE: Readonly<Vec3> = [0, 0, -1];

/**
 * The breech lever turns about an axis along X at its pivot, on the
 * breech's right side (towards the gunner), gun space. Open, its handle
 * points up; pulled back towards the gunner a quarter turn, the breech is
 * closed.
 */
export const LEVER_PIVOT: Readonly<Vec3> = [GUN.breechHalfWidth + 0.025, 0, BREECH_MOUTH[2] - 0.06];
/** From the pivot to the middle of the handle, m... */
export const LEVER_LENGTH = 0.16;
/** ...which sticks out this far towards the gunner (+X) from the arm, m. */
export const LEVER_HANDLE_X = 0.04;
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
/** A dropped shell lies on the basket floor this long, then is back in the rack, s. */
export const RETURN_DELAY = 1;
/** Ten loads in a row without a fumble: spike S4's pass mark (docs/plan.md, section 5). */
export const STREAK_GOAL = 10;
/** Load times kept for the stats, newest last. */
const TIMES_KEPT = 50;
const GRAVITY = 9.81;
/** Time constant of the smoothing on a pushed shell's speed, s. */
const PUSH_SMOOTH = 0.05;
/** The basket floor a dropped shell lands on, turret space. */
const FLOOR_Y = TURRET.basketFloor;

/** The gun's recoil: how far the barrel and breech slide back, how long they take to get there and to run out again, m and s. */
export const RECOIL = { length: 0.3, back: 0.06, out: 0.55 } as const;
/** How long the muzzle flash shows, s. */
export const FLASH_SECONDS = 0.08;

/**
 * The casing bin on the basket floor under the breech, left of the
 * gunner's legs, turret space: the middle of its floor, half its size
 * across and along, and how tall its walls stand, m.
 */
export const CASING_BIN = { x: -0.24, z: -0.38, halfX: 0.16, halfZ: 0.24, height: 0.38 } as const;
/** Casings drawn in the bin; older ones are cleared away (F3 may make them pile up and roll). */
export const CASINGS_KEPT = 6;
/** A casing's flight from the breech into the bin, s. */
export const CASING_FLIGHT = 0.5;
/** The case's radius, m (the shell's). */
export const CASING_RADIUS = SHELL_RADIUS;

/** Where a shell is. */
export type ShellPlace = 'rack' | 'hand' | 'breech' | 'falling' | 'floor';
export const SHELL_PLACES: readonly ShellPlace[] = ['rack', 'hand', 'breech', 'falling', 'floor'];

export interface Shell {
  place: ShellPlace;
  /** Middle of the shell, turret space. */
  centre: Vec3;
  /** Unit vector from its base to its nose, turret space. */
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

/** One hand this frame, from its grip pose, in turret space. */
export interface DrillHand {
  /** Tracked (a controller or a hand). */
  present: boolean;
  /** Grip squeezed (src/systems/grip-system.ts). */
  pressed: boolean;
  /** Holding something of another system's (a turret control, a block), so it can't take anything here. */
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
  /** Shots fired. */
  shots: number;
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
    shots: 0,
  };
}

/** A gun-space point in turret space, with the gun elevated by `elevation` (rad, muzzle up) and slid back `recoil` m, into `out` (which may be `p`). */
export function gunToTurret(p: Readonly<Vec3>, elevation: number, recoil: number, out: Vec3): Vec3 {
  const c = Math.cos(elevation);
  const s = Math.sin(elevation);
  const y = p[1];
  const z = p[2] + recoil;
  out[0] = p[0];
  out[1] = TRUNNION_Y + y * c - z * s;
  out[2] = TRUNNION_Z + y * s + z * c;
  return out;
}

/** A turret-space point in gun space (the inverse of gunToTurret), into `out` (which may be `p`). */
export function turretToGun(p: Readonly<Vec3>, elevation: number, recoil: number, out: Vec3): Vec3 {
  const c = Math.cos(elevation);
  const s = Math.sin(elevation);
  const y = p[1] - TRUNNION_Y;
  const z = p[2] - TRUNNION_Z;
  out[0] = p[0];
  out[1] = y * c + z * s;
  out[2] = -y * s + z * c - recoil;
  return out;
}

/** A gun-space direction in turret space, into `out` (which may be `d`). */
export function gunDirToTurret(d: Readonly<Vec3>, elevation: number, out: Vec3): Vec3 {
  const c = Math.cos(elevation);
  const s = Math.sin(elevation);
  const y = d[1];
  const z = d[2];
  out[0] = d[0];
  out[1] = y * c - z * s;
  out[2] = y * s + z * c;
  return out;
}

/** A turret-space direction in gun space, into `out` (which may be `d`). */
export function turretDirToGun(d: Readonly<Vec3>, elevation: number, out: Vec3): Vec3 {
  return gunDirToTurret(d, -elevation, out);
}

/** Distance along the bore from the mouth (+ inside the gun), for a gun-space point. */
export function boreDepth(p: Readonly<Vec3>): number {
  return (p[0] - BREECH_MOUTH[0]) * BORE[0] + (p[1] - BREECH_MOUTH[1]) * BORE[1] + (p[2] - BREECH_MOUTH[2]) * BORE[2];
}

/** Distance from the bore's line, for a gun-space point. */
export function boreOffset(p: Readonly<Vec3>): number {
  const d = boreDepth(p);
  return Math.hypot(
    p[0] - BREECH_MOUTH[0] - BORE[0] * d,
    p[1] - BREECH_MOUTH[1] - BORE[1] * d,
    p[2] - BREECH_MOUTH[2] - BORE[2] * d,
  );
}

/** Where the middle of the lever's handle is at `angle`, gun space. */
export function leverHandle(angle: number, out: Vec3): Vec3 {
  out[0] = LEVER_PIVOT[0] + LEVER_HANDLE_X;
  out[1] = LEVER_PIVOT[1] + LEVER_LENGTH * Math.cos(angle);
  out[2] = LEVER_PIVOT[2] + LEVER_LENGTH * Math.sin(angle);
  return out;
}

/** The lever angle a hand at gun-space `p` pulls it to, before limits: its angle about the pivot from straight up towards the gunner. */
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

/** How far the barrel and breech are slid back `t` seconds after a shot, m (0 before and once run out). */
export function recoilAt(t: number): number {
  if (!(t >= 0)) return 0;
  if (t < RECOIL.back) return RECOIL.length * (t / RECOIL.back);
  const u = (t - RECOIL.back) / RECOIL.out;
  if (u >= 1) return 0;
  // Runs out quickly at first, easing into battery.
  return RECOIL.length * (1 - u) * (1 - u);
}

/** Where casing `n` (counting every one thrown out) lies in the bin, turret space: the middle of the case, lying along Z. */
export function casingRest(n: number, out: Vec3): Vec3 {
  const k = n % CASINGS_KEPT;
  const across = (k % 3) - 1;
  const layer = Math.floor(k / 3);
  out[0] = CASING_BIN.x + across * (2 * CASING_RADIUS + 0.01) + (layer ? CASING_RADIUS : 0);
  out[1] = FLOOR_Y + CASING_RADIUS + 0.005 + layer * (2 * CASING_RADIUS - 0.01);
  out[2] = CASING_BIN.z + (layer ? -0.03 : 0.03);
  return out;
}

/** A casing on its way from the breech to the bin, or lying there. */
export interface Casing {
  /** Which one it is, counting every casing thrown out (it picks its place in the bin), or -1 for none. */
  n: number;
  /** Time it was thrown out, s, on the clock the owner steps it with. */
  thrownAt: number;
  /** Where it came out: the case's middle and its axis (base to mouth) as it left the breech, turret space. */
  from: Vec3;
  fromAxis: Vec3;
  /** Drawn now: the case's middle and axis, turret space. */
  centre: Vec3;
  axis: Vec3;
}

/**
 * The gun's moving parts after a shot: its recoil, the muzzle flash and the
 * casings it throws into the bin. Both pages run one, from the gunner's own
 * shot or the crewmate's shot event, so it needs nothing sent but the shot.
 * Allocation free after construction.
 */
export class GunAction {
  /** Time of the last shot, s. */
  firedAt = Number.NEGATIVE_INFINITY;
  /** The barrel and breech slid back, m, and whether the muzzle flash shows, as of the last `update`. */
  recoil = 0;
  flash = false;
  /** The furthest the gun has recoiled since it last fired, m (the tests read it after the gun has run out again). */
  kick = 0;
  readonly casings: Casing[] = [];
  /** Casings thrown out so far. */
  thrown = 0;
  private v: Vec3 = [0, 0, 0];

  constructor() {
    for (let i = 0; i < CASINGS_KEPT; i++) {
      this.casings.push({ n: -1, thrownAt: 0, from: [0, 0, 0], fromAxis: [0, 0, 1], centre: [0, 0, 0], axis: [0, 0, 1] });
    }
  }

  /** The gun fires at `time` with the gun at `elevation`: it recoils and throws out the casing. */
  fire(time: number, elevation: number): void {
    this.firedAt = time;
    this.kick = 0;
    const c = this.casings[this.thrown % CASINGS_KEPT];
    c.n = this.thrown++;
    c.thrownAt = time + RECOIL.back;
    // The case's middle, just out of the mouth, with the breech at full recoil.
    const p = this.v;
    p[0] = BREECH_MOUTH[0];
    p[1] = BREECH_MOUTH[1];
    p[2] = BREECH_MOUTH[2] + CASE_LENGTH / 2;
    gunToTurret(p, elevation, RECOIL.length, c.from);
    // Base first: its axis, base to mouth, still points into the gun.
    gunDirToTurret(BORE, elevation, c.fromAxis);
    c.centre[0] = c.from[0];
    c.centre[1] = c.from[1];
    c.centre[2] = c.from[2];
    c.axis[0] = c.fromAxis[0];
    c.axis[1] = c.fromAxis[1];
    c.axis[2] = c.fromAxis[2];
  }

  update(time: number): void {
    const since = time - this.firedAt;
    this.recoil = recoilAt(since);
    if (this.recoil > this.kick) this.kick = this.recoil;
    this.flash = since >= 0 && since < FLASH_SECONDS;
    for (const c of this.casings) {
      if (c.n >= 0) this.placeCasing(c, time);
    }
  }

  /** A casing's flight: back out of the breech and down in an arc into its place in the bin, turning over as it goes. */
  private placeCasing(c: Casing, time: number): void {
    const end = casingRest(c.n, this.v);
    const s = Math.min(1, Math.max(0, (time - c.thrownAt) / CASING_FLIGHT));
    const lift = 0.12 * 4 * s * (1 - s);
    c.centre[0] = c.from[0] + (end[0] - c.from[0]) * s;
    c.centre[1] = c.from[1] + (end[1] - c.from[1]) * s * s + lift;
    c.centre[2] = c.from[2] + (end[2] - c.from[2]) * s;
    // It tumbles about X, from pointing into the gun as it left (base first) to lying flat along +Z in the bin.
    const a = Math.atan2(c.fromAxis[1], c.fromAxis[2]) * (1 - s);
    c.axis[0] = 0;
    c.axis[1] = Math.sin(a);
    c.axis[2] = Math.cos(a);
  }
}

/**
 * Where the loading stands, as drawn: what the gunner's page sends the
 * other 45 times a second (src/net/loading-codec.ts) and what both pages
 * draw from. Positions in turret space.
 */
export interface LoadingSnapshot {
  lever: number;
  /** The shell in the breech, or -1, and how far in its nose is, m. */
  breechShell: number;
  depth: number;
  rammed: boolean;
  loaded: boolean;
  shells: { place: ShellPlace; centre: Vec3; axis: Vec3 }[];
  /** The stats the board shows. */
  loads: number;
  last: number;
  best: number;
  fumbles: number;
  streak: number;
  bestStreak: number;
}

export function createLoadingSnapshot(): LoadingSnapshot {
  return {
    lever: 0,
    breechShell: -1,
    depth: 0,
    rammed: false,
    loaded: false,
    shells: RACK_SLOTS.map((slot) => ({ place: 'rack' as ShellPlace, centre: [...slot] as Vec3, axis: [0, 0, -1] as Vec3 })),
    loads: 0,
    last: Number.NaN,
    best: Number.NaN,
    fumbles: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function copyLoadingSnapshot(from: LoadingSnapshot, to: LoadingSnapshot): LoadingSnapshot {
  to.lever = from.lever;
  to.breechShell = from.breechShell;
  to.depth = from.depth;
  to.rammed = from.rammed;
  to.loaded = from.loaded;
  for (let i = 0; i < to.shells.length; i++) {
    const a = from.shells[i];
    const b = to.shells[i];
    b.place = a.place;
    b.centre[0] = a.centre[0];
    b.centre[1] = a.centre[1];
    b.centre[2] = a.centre[2];
    b.axis[0] = a.axis[0];
    b.axis[1] = a.axis[1];
    b.axis[2] = a.axis[2];
  }
  to.loads = from.loads;
  to.last = from.last;
  to.best = from.best;
  to.fumbles = from.fumbles;
  to.streak = from.streak;
  to.bestStreak = from.bestStreak;
  return to;
}

/**
 * Between two snapshots: the lever and the shells' poses blend; what is
 * counted or in a place (rammed, loaded, the stats, each shell's place)
 * is the nearer one's. A shell that changed place is drawn where it went,
 * so it never slides across the turret between the rack and the breech.
 */
export function lerpLoadingSnapshot(a: LoadingSnapshot, b: LoadingSnapshot, t: number, out: LoadingSnapshot): LoadingSnapshot {
  copyLoadingSnapshot(t < 0.5 ? a : b, out);
  out.lever = a.lever + (b.lever - a.lever) * t;
  if (a.breechShell === b.breechShell) out.depth = a.depth + (b.depth - a.depth) * t;
  for (let i = 0; i < out.shells.length; i++) {
    const sa = a.shells[i];
    const sb = b.shells[i];
    const o = out.shells[i];
    if (sa.place !== sb.place) {
      copyShellPose(sb, o);
      continue;
    }
    for (let k = 0; k < 3; k++) {
      o.centre[k] = sa.centre[k] + (sb.centre[k] - sa.centre[k]) * t;
      o.axis[k] = sa.axis[k] + (sb.axis[k] - sa.axis[k]) * t;
    }
    const len = Math.hypot(o.axis[0], o.axis[1], o.axis[2]) || 1;
    o.axis[0] /= len;
    o.axis[1] /= len;
    o.axis[2] /= len;
  }
  return out;
}

function copyShellPose(from: { place: ShellPlace; centre: Vec3; axis: Vec3 }, to: { place: ShellPlace; centre: Vec3; axis: Vec3 }): void {
  to.place = from.place;
  to.centre[0] = from.centre[0];
  to.centre[1] = from.centre[1];
  to.centre[2] = from.centre[2];
  to.axis[0] = from.axis[0];
  to.axis[1] = from.axis[1];
  to.axis[2] = from.axis[2];
}

/** Loading carried on past the newest snapshot: it holds still. */
export function extrapolateLoadingSnapshot(s: LoadingSnapshot, _seconds: number, out: LoadingSnapshot): LoadingSnapshot {
  return copyLoadingSnapshot(s, out);
}

/**
 * The gunner's loading: the rack, the shells, the breech and its lever,
 * stepped once a frame with both hands. Call `update` once a frame with the
 * gun's elevation set; `fire` when the trigger is pulled; read the shells,
 * the lever and the stats to draw them, and `events` for what happened.
 * Allocates nothing per frame (only when a load is recorded).
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
  /** The breech closed on a rammed shell: the gun fires when the trigger is pulled. */
  loaded = false;
  /** The gun's elevation, rad: set it before each update (the breech moves with it). */
  elevation = 0;
  /** What each hand holds: a shell index, HOLD_LEVER or HOLD_NONE. */
  readonly holds: Record<Side, number> = { left: HOLD_NONE, right: HOLD_NONE };
  readonly stats = createLoadStats();
  /** This update's events (the first `eventCount`), and `fire`'s since. */
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
  /** Each hand's position in gun space this frame. */
  private gunHand: Record<Side, Vec3> = { left: [0, 0, 0], right: [0, 0, 0] };

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
    this.slideSpeed = 0;
    this.forcing = false;
    Object.assign(this.stats, createLoadStats());
    this.readyAt = this.time;
    this.firstTouchAt = Number.NaN;
    this.version++;
  }

  /** Let go with both hands (the gunner left the seat, or another page took over the loading). */
  releaseAll(): void {
    for (const side of SIDES) {
      if (this.holds[side] !== HOLD_NONE) this.letGo(side);
    }
  }

  /** Advance by `dt` seconds with the hands as they are now (turret space). */
  update(dt: number, left: DrillHand, right: DrillHand): void {
    this.eventCount = 0;
    this.time += dt;
    for (const side of SIDES) {
      const hand = side === 'left' ? left : right;
      turretToGun(hand.pos, this.elevation, 0, this.gunHand[side]);
    }
    if (this.breechShell >= 0) {
      // The gun may have elevated since: the shell in it moves with it.
      this.setDepth(this.depth);
    }
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
        this.moveLever(side);
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
  }

  /**
   * The trigger: with a shell rammed and the breech closed, the gun fires.
   * The breech opens by itself (a semi-automatic breech, as the 88's), the
   * casing goes (GunAction throws it), and the rack refills: the fired
   * shell's slot has a new one at once. Returns whether it fired. Its event
   * joins this update's.
   */
  fire(): boolean {
    if (!this.loaded) return false;
    const i = this.breechShell;
    this.loaded = false;
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
    this.stats.shots++;
    this.version++;
    this.emit('fired', null);
    return true;
  }

  /** The nose of shell `i`, turret space. */
  nose(i: number, out: Vec3): Vec3 {
    const s = this.shells[i];
    const h = SHELL_LENGTH / 2;
    out[0] = s.centre[0] + s.axis[0] * h;
    out[1] = s.centre[1] + s.axis[1] * h;
    out[2] = s.centre[2] + s.axis[2] * h;
    return out;
  }

  /** The lever's handle, turret space. */
  handle(out: Vec3): Vec3 {
    return gunToTurret(leverHandle(this.lever, out), this.elevation, 0, out);
  }

  /** What the board and the other page need, into `out`. */
  snapshot(out: LoadingSnapshot): LoadingSnapshot {
    out.lever = this.lever;
    out.breechShell = this.breechShell;
    out.depth = this.depth;
    out.rammed = this.rammed;
    out.loaded = this.loaded;
    for (let i = 0; i < this.shells.length; i++) copyShellPose(this.shells[i], out.shells[i]);
    const st = this.stats;
    out.loads = st.loads;
    out.last = st.last;
    out.best = st.best;
    out.fumbles = st.fumbles;
    out.streak = st.streak;
    out.bestStreak = st.bestStreak;
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
    const g = this.gunHand[side];
    const toLever = Math.hypot(g[0] - handle[0], g[1] - handle[1], g[2] - handle[2]);
    const otherHolds = this.holds[side === 'left' ? 'right' : 'left'];
    if (toLever < LEVER_REACH && otherHolds !== HOLD_LEVER && !this.loaded) {
      best = HOLD_LEVER;
      bestDistance = toLever;
    }
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      // A rammed shell stays put while the breech is closed.
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
      this.leverGrip = leverAngleFor(g) - this.lever;
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
      this.gripDepth = this.depth - boreDepth(g);
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
      this.tryCapture(i, side);
      return;
    }
    // In the breech: the hand slides it along the bore.
    const wanted = boreDepth(this.gunHand[side]) + this.gripDepth;
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
  private tryCapture(i: number, side: Side): void {
    if (this.breechShell >= 0 || this.lever > LEVER_BLOCKED || this.loaded) {
      return;
    }
    const s = this.shells[i];
    const nose = turretToGun(this.nose(i, this.v), this.elevation, 0, this.v);
    const depth = boreDepth(nose);
    if (depth < -CAPTURE_OUTSIDE || depth > CAPTURE_INSIDE || boreOffset(nose) > CAPTURE_RADIUS) {
      return;
    }
    const axis = turretDirToGun(s.axis, this.elevation, this.w);
    const along = axis[0] * BORE[0] + axis[1] * BORE[1] + axis[2] * BORE[2];
    if (along < Math.cos(CAPTURE_ANGLE)) {
      return;
    }
    s.place = 'breech';
    this.breechShell = i;
    this.rammed = false;
    this.slideSpeed = 0;
    this.setDepth(Math.max(0, depth));
    this.gripDepth = this.depth - boreDepth(this.gunHand[side]);
    this.version++;
    this.emit('capture', side);
  }

  /** Put the shell in the breech `depth` in, on the bore's line. */
  private setDepth(depth: number): void {
    this.depth = depth;
    const s = this.shells[this.breechShell];
    const c = depth - SHELL_LENGTH / 2;
    s.centre[0] = BREECH_MOUTH[0] + BORE[0] * c;
    s.centre[1] = BREECH_MOUTH[1] + BORE[1] * c;
    s.centre[2] = BREECH_MOUTH[2] + BORE[2] * c;
    gunToTurret(s.centre, this.elevation, 0, s.centre);
    gunDirToTurret(BORE, this.elevation, s.axis);
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
    const g = this.gunHand[side];
    const depth = boreDepth(g);
    const before = this.lastHandDepth[side];
    this.lastHandDepth[side] = hand.present ? depth : Number.NaN;
    const i = this.breechShell;
    if (i < 0 || this.rammed || !hand.present || this.holds[side] !== HOLD_NONE || this.shells[i].heldBy !== null) {
      return;
    }
    const base = this.depth - SHELL_LENGTH;
    // Only a hand moving in from behind the base pushes: one drawn back out past it doesn't.
    if (!(before <= base + 0.02) || depth <= base || depth <= before || boreOffset(g) > PALM_RADIUS) {
      return;
    }
    if (depth + SHELL_LENGTH >= SHELL_LENGTH) {
      this.ram(side);
    } else {
      this.setDepth(depth + SHELL_LENGTH);
    }
  }

  private moveLever(side: Side): void {
    const g = this.gunHand[side];
    const handle = leverHandle(this.lever, this.v);
    if (Math.hypot(g[0] - handle[0], g[1] - handle[1], g[2] - handle[2]) > SLIP) {
      this.holds[side] = HOLD_NONE;
      this.forcing = false;
      return;
    }
    const pulled = leverAngleFor(g) - this.leverGrip;
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
    this.version++;
    this.emit('loaded', side);
  }

  private fall(dt: number): void {
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.place === 'falling') {
        s.fallSpeed -= GRAVITY * dt;
        s.centre[1] += s.fallSpeed * dt;
        if (s.centre[1] <= FLOOR_Y + SHELL_RADIUS) {
          // Down on the basket floor, lying flat.
          s.centre[1] = FLOOR_Y + SHELL_RADIUS;
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

/** The gunner's seated eye point, turret space: where the reach checks measure from. */
export const GUNNER_EYE = SEATS.gunner.eye;

/**
 * What the loading board says: the loads, the last and best load times,
 * the fumbles and the streak, and what to do next; `shot` is the last
 * shot's result line (src/sim/ballistics.ts), shown once the breech is
 * open again.
 */
export function boardLines(s: LoadingSnapshot, shot = ''): [string, string, string] {
  const secs = (t: number) => (Number.isNaN(t) ? '-' : `${t.toFixed(1)} s`);
  const first = `Loads ${s.loads}   last ${secs(s.last)}   best ${secs(s.best)}`;
  const streak = s.bestStreak >= STREAK_GOAL ? `${STREAK_GOAL} in a row: passed` : `in a row ${s.streak}/${STREAK_GOAL}`;
  const second = `Fumbles ${s.fumbles}   ${streak}`;
  let third: string;
  if (s.loaded) {
    third = 'Loaded: fire!';
  } else if (s.breechShell >= 0 && s.rammed) {
    third = 'Rammed: close the breech';
  } else if (s.breechShell >= 0) {
    third = 'Ram it home';
  } else if (s.lever > LEVER_BLOCKED) {
    third = 'Breech closed: open it';
  } else {
    third = shot ? `${shot}. Load!` : 'Load!';
  }
  return [first, second, third];
}
