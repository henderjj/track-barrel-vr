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
/** Gun elevation for one turn of the elevation handwheel. */
export const ELEVATION_PER_TURN = 3 * DEG;

/** The gun's trunnions, which it elevates about: in the front plate, at the gun's height, turret space (x 0), m. */
export const TRUNNION = { y: GUN.y, z: TURRET.front } as const;

/** Where a control sits in turret space, and its tilt about X (a wheel tilted back to face the gunner). */
export interface StationMount {
  at: Vec3;
  tilt: number;
}

/**
 * The gunner's station, in turret space. The gunner sits right of the
 * breech facing the gun (eyes at SEATS.gunner.eye); the elevation
 * handwheel is under the breech's right edge for the left hand, the
 * traverse crank right of it for the right hand, and the power traverse
 * grip lower down at the right, beside the seat's front edge.
 */
export const STATION = {
  elevation: { at: [0.29, 1.78, -0.56], tilt: -20 * DEG },
  crank: { at: [0.6, 1.74, -0.55], tilt: -20 * DEG },
  twist: { at: [0.72, 1.5, -0.42], tilt: 0 },
} as const satisfies Record<string, StationMount>;
export type StationControl = keyof typeof STATION;
export const STATION_CONTROLS = Object.keys(STATION) as StationControl[];

/** The elevation handwheel: gripped on the rim, one hand or both; clockwise (as the gunner sees it) raises the gun, and it stops at the gun's limits. */
export const ELEVATION_WHEEL: WheelSpec = {
  radius: 0.11,
  grip: 'rim',
  knobLength: 0,
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
