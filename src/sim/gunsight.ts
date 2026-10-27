/**
 * The gunsight (F1.9, docs/gunsight.md): where its parts sit on the gun and
 * in the turret, which way it looks, and laying the gun so a target sits on
 * the reticle's mark for its range, from wherever the tank stands. Engine-
 * free, shared by the model, the sight system and the tests. The lens and
 * reticle maths stay in src/sim/sight.ts (spike S1).
 *
 * It is an articulated sight, as on the Tiger: the objective rides on the
 * gun beside the bore, so the sight looks wherever the gun points, while
 * the eyepiece is fixed in the turret, so the gunner's eye stays at it as
 * the gun elevates. The two halves meet at a knuckle on the trunnions' line.
 *
 * Spaces: hull and turret space as in src/sim/cabin.ts; gun space has its
 * origin on the trunnions (TRUNNION, src/sim/turret.ts) and elevates with
 * the gun; world space as in src/sim/terrain.ts and src/sim/range.ts.
 */

import { HULL, SIGHT_EYEPIECE, TURRET } from './cabin.js';
import type { Vec3 } from './mechanism.js';
import { superelevation } from './sight.js';
import { groundHeight, TILE } from './terrain.js';
import { MANTLET_DEPTH, MAX_ELEVATION, MIN_ELEVATION, TRUNNION } from './turret.js';

/** The eyepiece's lens, turret space: fixed, facing back at the gunner (the spike's eyepiece). */
export const EYEPIECE: Vec3 = [SIGHT_EYEPIECE[0], SIGHT_EYEPIECE[1], SIGHT_EYEPIECE[2]];

/** The knuckle the two halves turn about, turret space: on the trunnions' line, its front inside the turret's front plate. */
export const KNUCKLE: Vec3 = [SIGHT_EYEPIECE[0], TRUNNION.y, TURRET.front + HULL.wall + 0.03];

/** The objective's hood on the mantlet's face: its depth (`inset` of it inside the mantlet), width and height, m. */
export const HOOD = { depth: 0.05, inset: 0.015, width: 0.11, height: 0.1 } as const;

/** The mantlet's face, gun space z (src/scene-assets/cabin.scene-asset.ts's gun). */
export const MANTLET_FACE = TURRET.front - MANTLET_DEPTH + 0.01 - TRUNNION.z;

/** The objective (where the sight camera sits), gun space: beside the bore at its height, 1 cm proud of the hood on the mantlet's face. */
export const OBJECTIVE: Vec3 = [
  SIGHT_EYEPIECE[0],
  0,
  MANTLET_FACE - (HOOD.depth - HOOD.inset) - 0.01,
];

/** The objective in hull space for turret `yaw` and gun `elevation`, into `out`. */
export function objectivePoint(yaw: number, elevation: number, out: Vec3): Vec3 {
  // Elevated about the trunnions, in turret space.
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  const [ox, oy, oz] = OBJECTIVE;
  const x = ox;
  const y = TRUNNION.y + oy * ce - oz * se;
  const z = TRUNNION.z + oy * se + oz * ce;
  // Turned with the turret about the ring's centre.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = x * c + z * s;
  out[1] = y;
  out[2] = -x * s + z * c + TURRET.z;
  return out;
}

/** The tank's pose as src/sim/tank-drive.ts has it: world position of the hull floor and its heading, pitch and roll. */
export interface TankPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
}

/**
 * A world-space point in hull space, for a tank at `pose`, into `out`: the
 * inverse of the pose the drive system places the ground by (three.js
 * 'YXZ': heading, then pitch, then roll). The ground repeats every tile
 * (src/sim/terrain.ts); the point is taken as given, so pick its copy
 * first (`onRangeAhead`).
 */
export function worldToHull(pose: TankPose, wx: number, wy: number, wz: number, out: Vec3): Vec3 {
  let x = wx - pose.x;
  let y = wy - pose.y;
  let z = wz - pose.z;
  // Undo the heading (about Y), then the pitch (about X), then the roll (about Z).
  let c = Math.cos(pose.heading);
  let s = Math.sin(pose.heading);
  [x, z] = [x * c - z * s, x * s + z * c];
  c = Math.cos(pose.pitch);
  s = Math.sin(pose.pitch);
  [y, z] = [y * c + z * s, -y * s + z * c];
  c = Math.cos(pose.roll);
  s = Math.sin(pose.roll);
  [x, y] = [x * c + y * s, -x * s + y * c];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** A point to lay on: world x and z, and its height above the ground there, m (as src/sim/range.ts gives a target's face). */
export interface AimPoint {
  x: number;
  above: number;
  z: number;
}

/** A tank up to this far behind a range's start line is on that range, m: past it, it is on the one behind (the tile before). */
export const RANGE_BACK = 100;

/**
 * Which copy of a point on the range a tank at `pose` means, into `out`.
 * The range repeats every tile up the lane, so a target 500 m from the
 * start has a copy only 300 m behind it: the one meant is on the range the
 * tank is driving up, the one whose start line it has passed (or nearly),
 * and the nearest copy across the lane.
 */
export function onRangeAhead(pose: TankPose, p: AimPoint, out: AimPoint): AimPoint {
  const ranges = Math.floor((RANGE_BACK - pose.z) / TILE);
  out.x = p.x + TILE * Math.round((pose.x - p.x) / TILE);
  out.above = p.above;
  out.z = p.z - TILE * ranges;
  return out;
}

/** The point (taken as given, see `onRangeAhead`) in hull space for a tank at `pose`, into `out`. */
export function aimPointInHull(pose: TankPose, p: AimPoint, out: Vec3): Vec3 {
  return worldToHull(pose, p.x, groundHeight(p.x, p.z) + p.above, p.z, out);
}

/** A lay of the gun: the turret's turn and the gun's elevation, the range it is laid for, and whether the gun's limits stopped it short. */
export interface Lay {
  yaw: number;
  elevation: number;
  range: number;
  limited: boolean;
}

export function createLay(): Lay {
  return { yaw: 0, elevation: 0, range: 0, limited: false };
}

const objective: Vec3 = [0, 0, 0];
const target: Vec3 = [0, 0, 0];
const copy: AimPoint = { x: 0, above: 0, z: 0 };

/**
 * Lay the gun so the point `p` (its copy on the range ahead) sits on the
 * reticle's mark for its range, for a tank at `pose`: the sight's axis passes over it by the
 * superelevation, and the bore, parallel to the sight, points just as
 * high. The objective moves a little as the turret and gun turn, so the
 * lay is refined a few times (each pass gains a factor of about the
 * objective's offset over the range).
 */
export function layOn(pose: TankPose, p: AimPoint, out: Lay): Lay {
  aimPointInHull(pose, onRangeAhead(pose, p, copy), target);
  let yaw = 0;
  let elevation = 0;
  let range = 0;
  for (let pass = 0; pass < 4; pass++) {
    objectivePoint(yaw, elevation, objective);
    const dx = target[0] - objective[0];
    const dy = target[1] - objective[1];
    const dz = target[2] - objective[2];
    const flat = Math.hypot(dx, dz);
    range = Math.hypot(flat, dy);
    yaw = Math.atan2(-dx, -dz);
    elevation = Math.atan2(dy, flat) + superelevation(range);
  }
  out.yaw = yaw;
  out.range = range;
  out.elevation = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, elevation));
  out.limited = out.elevation !== elevation;
  return out;
}

/** Where a point sits in the sight relative to the mark for its range, milliradians: right of it and above it, and its range, m. */
export interface SightError {
  across: number;
  up: number;
  range: number;
}

export function createSightError(): SightError {
  return { across: 0, up: 0, range: 0 };
}

/**
 * Where the point `p` (its copy on the range ahead) sits in the sight, for a tank at `pose` with the
 * turret at `yaw` and the gun at `elevation`: how far right of and above
 * the range mark for its own range it is, in milliradians (0, 0 is laid
 * on). What the tests and the Practice lay check against.
 */
export function sightError(pose: TankPose, yaw: number, elevation: number, p: AimPoint, out: SightError): SightError {
  aimPointInHull(pose, onRangeAhead(pose, p, copy), target);
  objectivePoint(yaw, elevation, objective);
  let x = target[0] - objective[0];
  let y = target[1] - objective[1];
  let z = target[2] - objective[2];
  out.range = Math.hypot(x, y, z);
  // Into the sight's frame: undo the turret's turn, then the gun's elevation.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  [x, z] = [x * c - z * s, x * s + z * c];
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  [y, z] = [y * ce + z * se, -y * se + z * ce];
  out.across = Math.atan2(x, -z) * 1000;
  out.up = (Math.atan2(y, Math.hypot(x, z)) + superelevation(out.range)) * 1000;
  return out;
}
