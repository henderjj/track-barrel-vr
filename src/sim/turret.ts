/**
 * The turret and the gun's laying (F1.8): the turret's turn on the hull,
 * the gun's elevation, and the gunner's three controls that move them (a
 * power traverse twist grip, a manual traverse crank and an elevation
 * handwheel), shared by the model, the turret system, the tests and later
 * the practice crewmate. Engine-free, so it can be unit tested. Design
 * note: docs/turret.md.
 *
 * Turret space is hull space turned about the ring's centre (src/sim/cabin.ts).
 * The turret's angle (`yaw`) is positive to the left, as Three.js turns
 * about +Y; the gun's elevation is positive with the muzzle up. Angles in
 * radians.
 *
 * The gunner's page owns the turret (plan decision 2): it steps this from
 * its own hands at once, with the engine RPM the host sends, and sends the
 * result to the other page, which draws it a little in the past.
 */

import { MAX_TRAVERSE, MAX_TRAVERSE_ACCEL } from './comfort.js';
import { GUN, TURRET } from './cabin.js';
import type { TwistSpec, Vec3, WheelSpec } from './mechanism.js';
import { approach, IDLE_RPM, MAX_RPM } from './tank-drive.js';

const DEG = Math.PI / 180;
const TURN = 2 * Math.PI;

/** The gun's elevation limits: depression and elevation. */
export const MIN_ELEVATION = -10 * DEG;
export const MAX_ELEVATION = 20 * DEG;

/** Power traverse at full twist: this fast with the engine at idle, rising with RPM to the comfort cap at top RPM (Tiger-style). */
export const POWER_TRAVERSE_IDLE = 6 * DEG;
export const POWER_TRAVERSE_TOP = MAX_TRAVERSE;

/** Turret traverse for one turn of the manual crank: slow and precise. */
export const CRANK_TRAVERSE_PER_TURN = 2 * DEG;
/**
 * Gun elevation for one turn of the elevation handwheel: fine enough that
 * laying between the range's targets (a few tenths of a degree apart) takes
 * a turn or two, as John asked after his headset check (it was 3°).
 */
export const ELEVATION_PER_TURN = 0.75 * DEG;

/** The gun's trunnions, which it elevates about: in the front plate, at the gun's height, turret space (x 0), m. */
export const TRUNNION = { y: GUN.y, z: TURRET.front } as const;

/**
 * Where a control sits in turret space, its tilt about X (a wheel tilted
 * back to face the gunner) and its turn about Y (a wheel turned to face
 * sideways), applied turn first: Three.js's 'YXZ' order.
 */
export interface StationMount {
  at: Vec3;
  tilt: number;
  yaw?: number;
}

/** A point in a mount's space, in turret space, into `out`. */
export function mountToTurret(mount: StationMount, p: readonly number[], out: Vec3): Vec3 {
  const ct = Math.cos(mount.tilt);
  const st = Math.sin(mount.tilt);
  const cy = Math.cos(mount.yaw ?? 0);
  const sy = Math.sin(mount.yaw ?? 0);
  // Tilt about X, then turn about Y.
  const y = p[1] * ct - p[2] * st;
  const z = p[1] * st + p[2] * ct;
  out[0] = mount.at[0] + p[0] * cy + z * sy;
  out[1] = mount.at[1] + y;
  out[2] = mount.at[2] - p[0] * sy + z * cy;
  return out;
}

/** A turret-space point in a mount's space, into `out` (the inverse of mountToTurret). */
export function turretToMount(mount: StationMount, p: readonly number[], out: Vec3): Vec3 {
  const ct = Math.cos(mount.tilt);
  const st = Math.sin(mount.tilt);
  const cy = Math.cos(mount.yaw ?? 0);
  const sy = Math.sin(mount.yaw ?? 0);
  const dx = p[0] - mount.at[0];
  const dy = p[1] - mount.at[1];
  const dz = p[2] - mount.at[2];
  const x = dx * cy - dz * sy;
  const z = dx * sy + dz * cy;
  out[0] = x;
  out[1] = dy * ct + z * st;
  out[2] = -dy * st + z * ct;
  return out;
}

/**
 * The gunner's station, in turret space. The gunner sits right of the
 * breech facing the gun (eyes at SEATS.gunner.eye); the elevation
 * handwheel is under the breech's right edge for the left hand, the
 * traverse crank right of it for the right hand, and the power traverse
 * grip lower down at the right, beside the seat's front edge. As on the
 * Sherman (TM 9-754, figure 13) both wheels sit close under the sight: with
 * the eye at the eyepiece the hands are on them 32 to 35 cm below it and a
 * forearm ahead (docs/interior.md).
 */
export const STATION = {
  // The elevation handwheel at the traverse crank's height: turned by a handle, its handle's highest point is no nearer the eyes than the crank's.
  // Both 5 cm higher than at first for an easy reach seated, and the crank 9 cm further in so it and the hand on it
  // turn clear of the turret ring (John's headset check, docs/interior.md).
  // The elevation handwheel faces sideways, its handle towards the gunner, as on the Sherman (John's headset check).
  elevation: { at: [0.29, 1.86, -0.6], tilt: 0, yaw: 90 * DEG },
  crank: { at: [0.52, 1.86, -0.52], tilt: -20 * DEG },
  twist: { at: [0.71, 1.63, -0.45], tilt: 0 },
} as const satisfies Record<string, StationMount>;
export type StationControl = keyof typeof STATION;

/** The elevating pinion's middle, turret space: at the top of the elevation handwheel's gearbox column, under the breech's right edge. */
const PINION: Vec3 = [0.245, 1.9, -0.8];
const PINION_RADIUS = 0.02;
/** The toothed arc's half-width out from its middle line, m: the pinion sits 3 mm off its outer edge, its teeth reaching in to mesh. */
const ARC_HALF = 0.012;
const ARC_RADIUS = Math.hypot(PINION[1] - GUN.y, PINION[2] - TURRET.front) - ARC_HALF - 0.003 - PINION_RADIUS;
/** The pinion's direction from the trunnions, as `atan2(z, y)` (turning the gun by `e` about X adds `e` to it). */
const PINION_ANGLE = Math.atan2(PINION[2] - TURRET.front, PINION[1] - GUN.y);

/**
 * The elevating gear the elevation handwheel drives, as on the Sherman
 * (figure 13): a toothed arc on the gun's cradle, centred on the trunnions
 * in the plane x = `x`, and the pinion meshing with it at the top of the
 * handwheel's gearbox column. The arc (gun space, angles as `atan2(z, y)`)
 * runs far enough each way to stay on the pinion at every elevation.
 */
export const ELEVATING_GEAR = {
  x: PINION[0],
  pinion: PINION,
  pinionRadius: PINION_RADIUS,
  radius: ARC_RADIUS,
  half: ARC_HALF,
  from: PINION_ANGLE - MAX_ELEVATION - 5 * DEG,
  to: PINION_ANGLE - MIN_ELEVATION + 5 * DEG,
} as const;
export const STATION_CONTROLS = Object.keys(STATION) as StationControl[];

/**
 * The elevation handwheel, turned by its handle like a crank: clockwise (as
 * the gunner sees it) raises the gun, and it stops at the gun's limits. As
 * on the Sherman (TM 9-754, figure 13) it faces sideways, towards the
 * gunner, on a gearbox whose column carries the elevating pinion up to the
 * toothed elevating arc on the gun (ELEVATING_GEAR). A trigger bar along the
 * handle fires the gun, so the gunner can fire while laying it, as on the
 * Tiger I.
 */
export const ELEVATION_WHEEL: WheelSpec = {
  radius: 0.08,
  grip: 'crank',
  knobLength: 0.06,
  trigger: true,
  // Clockwise is negative wheel turn (src/sim/mechanism.ts): the gun's top limit is the wheel's bottom one.
  min: wheelForElevation(MAX_ELEVATION),
  max: wheelForElevation(MIN_ELEVATION),
  tickEvery: Math.PI / 4,
  perTurn: ELEVATION_PER_TURN / DEG,
};

/** The manual traverse crank: turns for ever, a tick each quarter turn; anticlockwise turns the turret left. */
export const TRAVERSE_CRANK: WheelSpec = {
  radius: 0.08,
  grip: 'crank',
  knobLength: 0.06,
  min: -Infinity,
  max: Infinity,
  tickEvery: Math.PI / 2,
  perTurn: CRANK_TRAVERSE_PER_TURN / DEG,
};

/** The power traverse grip: twist left to traverse left, right to go right, springing back to stop. The trigger fires (F1.10). */
export const POWER_GRIP: TwistSpec = {
  base: 0.035,
  length: 0.11,
  max: 40 * DEG,
  spring: 12,
  deadband: 4 * DEG,
};

/** The elevation handwheel's turn (radians, many turns) that sets the gun at `elevation`. */
export function wheelForElevation(elevation: number): number {
  return (-elevation / ELEVATION_PER_TURN) * TURN;
}

/** The gun's elevation set by the elevation handwheel turned `wheel` radians, within the gun's limits. */
export function elevationForWheel(wheel: number): number {
  return clamp((-wheel / TURN) * ELEVATION_PER_TURN, MIN_ELEVATION, MAX_ELEVATION);
}

/** How fast full power traverse turns the turret with the engine at `rpm`, rad/s. */
export function powerTraverseRate(rpm: number): number {
  const engine = clamp((rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
  return POWER_TRAVERSE_IDLE + (POWER_TRAVERSE_TOP - POWER_TRAVERSE_IDLE) * engine;
}

/** The turret and gun as drawn and sent, and the gunner's controls as they stand (so the other page draws them). */
export interface TurretState {
  /** The turret's turn on the hull, within (-π, π], positive left. */
  yaw: number;
  /** How fast the power traverse is turning it, rad/s. */
  rate: number;
  /** The gun's elevation. */
  elevation: number;
  /** The manual crank's angle, within (-π, π] (only for drawing it). */
  crank: number;
  /** The power traverse grip's twist. */
  twist: number;
}

export function createTurretState(): TurretState {
  return { yaw: 0, rate: 0, elevation: 0, crank: 0, twist: 0 };
}

export function copyTurretState(from: TurretState, to: TurretState): TurretState {
  to.yaw = from.yaw;
  to.rate = from.rate;
  to.elevation = from.elevation;
  to.crank = from.crank;
  to.twist = from.twist;
  return to;
}

/** What the gunner's hands ask of the turret this step. */
export interface GunnerInput {
  /** The power grip's twist as a demand, −1 (full right) to 1 (full left). */
  traverse: number;
  /** How far the crank was turned this step, radians of crank (positive anticlockwise: left). */
  crank: number;
  /** Where the elevation handwheel puts the gun. */
  elevation: number;
}

export function createGunnerInput(): GunnerInput {
  return { traverse: 0, crank: 0, elevation: 0 };
}

/**
 * Step the turret `dt` seconds with the engine at `rpm`. The power
 * traverse's rate heads for the twist's demand at no more than the comfort
 * cap's acceleration, so it starts and stops smoothly; the crank and the
 * elevation wheel are geared straight to the turret and gun, as on a real
 * tank, so they move at once.
 */
export function stepTurret(s: TurretState, input: GunnerInput, rpm: number, dt: number): TurretState {
  const target = clamp(input.traverse, -1, 1) * powerTraverseRate(rpm);
  s.rate = approach(s.rate, target, MAX_TRAVERSE_ACCEL * dt);
  s.yaw = wrapAngle(s.yaw + s.rate * dt + (input.crank / TURN) * CRANK_TRAVERSE_PER_TURN);
  s.elevation = clamp(input.elevation, MIN_ELEVATION, MAX_ELEVATION);
  return s;
}

/** Between two states (the other page draws the turret between the packets it gets), the short way round. */
export function lerpTurretState(a: TurretState, b: TurretState, t: number, out: TurretState): TurretState {
  out.yaw = wrapAngle(a.yaw + angleDelta(a.yaw, b.yaw) * t);
  out.rate = a.rate + (b.rate - a.rate) * t;
  out.elevation = a.elevation + (b.elevation - a.elevation) * t;
  out.crank = wrapAngle(a.crank + angleDelta(a.crank, b.crank) * t);
  out.twist = a.twist + (b.twist - a.twist) * t;
  return out;
}

/** The turret carried on `seconds` past `s` at its traverse rate (a late packet). */
export function extrapolateTurretState(s: TurretState, seconds: number, out: TurretState): TurretState {
  copyTurretState(s, out);
  out.yaw = wrapAngle(s.yaw + s.rate * seconds);
  return out;
}

/** Which way the barrel points in hull space for turret `yaw` and gun `elevation`, a unit vector into `out`. */
export function barrelDirection(yaw: number, elevation: number, out: Vec3): Vec3 {
  const ce = Math.cos(elevation);
  out[0] = -ce * Math.sin(yaw);
  out[1] = Math.sin(elevation);
  out[2] = -ce * Math.cos(yaw);
  return out;
}

/** The mantlet's depth in front of the turret's front plate, m (the model's). */
export const MANTLET_DEPTH = 0.12;
/** From the trunnions to the muzzle, m. */
export const MUZZLE_REACH = MANTLET_DEPTH + GUN.barrelLength;

/** The muzzle in hull space for turret `yaw` and gun `elevation`, into `out`. */
export function muzzlePoint(yaw: number, elevation: number, out: Vec3): Vec3 {
  // In turret space: out from the trunnions along the elevated barrel.
  const y = TRUNNION.y + MUZZLE_REACH * Math.sin(elevation);
  const z = TRUNNION.z - MUZZLE_REACH * Math.cos(elevation);
  // Turned with the turret about the ring's centre (x is 0 on the centre line).
  out[0] = z * Math.sin(yaw);
  out[1] = y;
  out[2] = z * Math.cos(yaw) + TURRET.z;
  return out;
}

/** The angle from `a` to `b` the short way round, within (-π, π]. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** An angle within (-π, π]. */
export function wrapAngle(a: number): number {
  const w = a - TURN * Math.round(a / TURN);
  return w <= -Math.PI ? w + TURN : w;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
