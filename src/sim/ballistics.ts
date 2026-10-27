/**
 * Ballistics (F1.10, docs/loading-firing.md): where a shell goes once the
 * gun fires, and what it hits. Engine-free and deterministic, so the host
 * decides hits (plan §4.6) and both pages draw the same flight from the
 * shot alone.
 *
 * World space as in src/sim/terrain.ts and src/sim/range.ts: +X east, -Z
 * the tank's starting heading, heights the ground's (groundHeight). The
 * ground repeats every TILE, and so do the targets drawn on it, so every
 * test against them is made with the offset wrapped to the nearest copy.
 *
 * Phase 1 has one shell, armour piercing, at one muzzle speed, falling
 * under gravity with no drag (plan §4.6). F3.1 adds HE and smoke.
 */

import { RANGE_TARGETS, targetFace } from './range.js';
import type { TankDrive } from './tank-drive.js';
import { groundHeight, wrapTile } from './terrain.js';

export type Vec3 = [number, number, number];

/** The armour-piercing shell's speed leaving the muzzle, m/s (plan §4.6). */
export const MUZZLE_SPEED = 600;
export const GRAVITY = 9.81;
/** Longest a shell is followed, s: past this it has gone beyond anything there is to hit (2.4 km). */
export const MAX_FLIGHT = 4;
/** The step the flight is marched in, s: 2.5 m of flight, well under the targets' 10 cm thickness's worth of plane crossings. */
export const FLIGHT_STEP = 1 / 240;

/** Where the shell is `t` seconds after leaving `origin` along unit `dir`, into `out`. */
export function shellAt(origin: Readonly<Vec3>, dir: Readonly<Vec3>, t: number, out: Vec3): Vec3 {
  const v = MUZZLE_SPEED * t;
  out[0] = origin[0] + dir[0] * v;
  out[1] = origin[1] + dir[1] * v - 0.5 * GRAVITY * t * t;
  out[2] = origin[2] + dir[2] * v;
  return out;
}

/** The shell's velocity `t` seconds after leaving the muzzle, into `out`, m/s. */
export function shellVelocity(dir: Readonly<Vec3>, t: number, out: Vec3): Vec3 {
  out[0] = dir[0] * MUZZLE_SPEED;
  out[1] = dir[1] * MUZZLE_SPEED - GRAVITY * t;
  out[2] = dir[2] * MUZZLE_SPEED;
  return out;
}

/**
 * How far below the bore's line a shell is at `range` m (horizontal), m:
 * what the sight's range marks allow for (F1.9). For a flat shot.
 */
export function dropAt(range: number): number {
  const t = range / MUZZLE_SPEED;
  return 0.5 * GRAVITY * t * t;
}

/** A target face to hit: the middle of the face in world space (y the world height), its half sizes, and which way it faces (rad about +Y). */
export interface HitFace {
  x: number;
  y: number;
  z: number;
  halfWidth: number;
  halfHeight: number;
  yaw: number;
}

/** What a shot hit: a target face (its index), the ground, or nothing within MAX_FLIGHT. */
export type HitKind = 'target' | 'ground' | 'none';

export interface ShotResult {
  kind: HitKind;
  /** The face's index when it hit a target, else -1. */
  target: number;
  /** Where it struck, world space (the last point followed, for 'none'). */
  point: Vec3;
  /** When, s after leaving the muzzle. */
  time: number;
}

export function createShotResult(): ShotResult {
  return { kind: 'none', target: -1, point: [0, 0, 0], time: 0 };
}

const a: Vec3 = [0, 0, 0];
const b: Vec3 = [0, 0, 0];

/**
 * Fly a shell from `origin` along unit `dir` and say what it hits first:
 * one of `faces` (crossing the face's plane within its rectangle), or the
 * ground (`ground(x, z)`, groundHeight by default). Marched in FLIGHT_STEP
 * steps, each a straight segment. Allocation free.
 */
export function flyShell(
  origin: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  faces: readonly HitFace[],
  out: ShotResult,
  ground: (x: number, z: number) => number = groundHeight,
): ShotResult {
  shellAt(origin, dir, 0, a);
  const steps = Math.ceil(MAX_FLIGHT / FLIGHT_STEP);
  for (let k = 1; k <= steps; k++) {
    const t1 = k * FLIGHT_STEP;
    shellAt(origin, dir, t1, b);
    let best = Infinity;
    let hit = -1;
    for (let i = 0; i < faces.length; i++) {
      const f = segmentThroughFace(a, b, faces[i]);
      if (f < best) {
        best = f;
        hit = i;
      }
    }
    // The ground: where the segment's end is below it, interpolated on the heights above it at each end.
    const ha = a[1] - ground(a[0], a[2]);
    const hb = b[1] - ground(b[0], b[2]);
    let groundAt = Infinity;
    if (hb <= 0) groundAt = ha <= 0 ? 0 : ha / (ha - hb);
    if (hit >= 0 && best <= groundAt) {
      return finish(out, 'target', hit, t1 - FLIGHT_STEP + best * FLIGHT_STEP, origin, dir);
    }
    if (groundAt <= 1) {
      return finish(out, 'ground', -1, t1 - FLIGHT_STEP + groundAt * FLIGHT_STEP, origin, dir);
    }
    a[0] = b[0];
    a[1] = b[1];
    a[2] = b[2];
  }
  return finish(out, 'none', -1, MAX_FLIGHT, origin, dir);
}

function finish(out: ShotResult, kind: HitKind, target: number, time: number, origin: Readonly<Vec3>, dir: Readonly<Vec3>): ShotResult {
  out.kind = kind;
  out.target = target;
  out.time = time;
  shellAt(origin, dir, time, out.point);
  if (kind === 'ground') out.point[1] = groundHeight(out.point[0], out.point[2]);
  return out;
}

/**
 * Where along segment p→q (0 to 1) it passes through face `f`'s rectangle,
 * or Infinity. The face is a plane through its middle, square to
 * (sin yaw, 0, cos yaw); the nearest tile's copy of it counts.
 */
export function segmentThroughFace(p: Readonly<Vec3>, q: Readonly<Vec3>, f: HitFace): number {
  const nx = Math.sin(f.yaw);
  const nz = Math.cos(f.yaw);
  // Relative to the copy of the face nearest p.
  const px = wrapTile(p[0] - f.x);
  const pz = wrapTile(p[2] - f.z);
  const py = p[1] - f.y;
  const qx = px + (q[0] - p[0]);
  const qz = pz + (q[2] - p[2]);
  const qy = py + (q[1] - p[1]);
  const dp = px * nx + pz * nz;
  const dq = qx * nx + qz * nz;
  if ((dp > 0 && dq > 0) || (dp < 0 && dq < 0) || dp === dq) return Infinity;
  const s = dp / (dp - dq);
  const x = px + (qx - px) * s;
  const y = py + (qy - py) * s;
  const z = pz + (qz - pz) * s;
  // Across the face: its right is (cos yaw, 0, -sin yaw).
  const across = x * nz - z * nx;
  return Math.abs(across) <= f.halfWidth && Math.abs(y) <= f.halfHeight ? s : Infinity;
}

/**
 * A hull-space point in world space, for the tank at `tank`'s pose (the
 * hull at (x, y, z) turned by heading, pitch and roll, as DriveSystem draws
 * the ground round it: Euler order YXZ), into `out`.
 */
export function hullToWorld(tank: Readonly<Pick<TankDrive, 'x' | 'y' | 'z' | 'heading' | 'pitch' | 'roll'>>, p: Readonly<Vec3>, out: Vec3): Vec3 {
  hullDirToWorld(tank, p, out);
  out[0] += tank.x;
  out[1] += tank.y;
  out[2] += tank.z;
  return out;
}

/** A hull-space direction in world space (hullToWorld without the move), into `out` (which may be `d`). */
export function hullDirToWorld(tank: Readonly<Pick<TankDrive, 'heading' | 'pitch' | 'roll'>>, d: Readonly<Vec3>, out: Vec3): Vec3 {
  // R = Ry(heading) · Rx(pitch) · Rz(roll), applied right to left.
  let [x, y, z] = d;
  const cr = Math.cos(tank.roll);
  const sr = Math.sin(tank.roll);
  [x, y] = [x * cr - y * sr, x * sr + y * cr];
  const cp = Math.cos(tank.pitch);
  const sp = Math.sin(tank.pitch);
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  const ch = Math.cos(tank.heading);
  const sh = Math.sin(tank.heading);
  [x, z] = [x * ch + z * sh, -x * sh + z * ch];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * One line on where a shot went, for the gunner's board and the menu: a
 * hit names the target; a miss says how far short or over and left or
 * right of the target nearest its line (`faces[i]`, named by `names[i]`),
 * taking each target's copy in the tile the gun fired from (the targets
 * stand within the range, 600 m, of the start).
 * `origin` and `dir` are the shot's; `point` where it landed.
 */
export function describeShot(
  result: ShotResult,
  origin: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  faces: readonly HitFace[],
  names: readonly string[],
): string {
  if (result.kind === 'target') return `Hit: ${names[result.target]}`;
  if (result.kind === 'none' || faces.length === 0) return 'Miss: lost in the distance';
  // The target nearest the shot's line, seen from above.
  const hx = dir[0];
  const hz = dir[2];
  const flat = Math.hypot(hx, hz) || 1;
  const ux = hx / flat;
  const uz = hz / flat;
  let nearest = 0;
  let nearestAngle = Infinity;
  for (let i = 0; i < faces.length; i++) {
    const dx = faces[i].x - wrapTile(origin[0]);
    const dz = faces[i].z - wrapTile(origin[2]);
    const along = dx * ux + dz * uz;
    if (along <= 0) continue;
    const angle = Math.abs(Math.atan2(dx * uz - dz * ux, along));
    if (angle < nearestAngle) {
      nearestAngle = angle;
      nearest = i;
    }
  }
  const f = faces[nearest];
  const tx = f.x - wrapTile(origin[0]);
  const tz = f.z - wrapTile(origin[2]);
  const px = result.point[0] - origin[0];
  const pz = result.point[2] - origin[2];
  const range = tx * ux + tz * uz;
  const landed = px * ux + pz * uz;
  // Left of the line to the target is positive across (+X is right when looking along -Z).
  const toTarget = Math.hypot(tx, tz) || 1;
  const across = (px * tz - pz * tx) / toTarget;
  const long = landed - range;
  const parts: string[] = [];
  if (Math.abs(long) >= 1) parts.push(`${Math.round(Math.abs(long))} m ${long < 0 ? 'short' : 'over'}`);
  if (Math.abs(across) >= 0.5) parts.push(`${Math.round(Math.abs(across))} m ${across > 0 ? 'left' : 'right'}`);
  return `Miss ${names[nearest]}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/** The test range's targets as faces to hit (src/sim/range.ts), their heights put on the ground under them. */
export function rangeFaces(): HitFace[] {
  return RANGE_TARGETS.map((_, i) => {
    const f = targetFace(i);
    return { x: f.x, y: groundHeight(f.x, f.z) + f.y, z: f.z, halfWidth: f.halfWidth, halfHeight: f.halfHeight, yaw: f.yaw };
  });
}

/** The range's targets by name, as the board and the menu say them: "the 250 m gun". */
export const RANGE_TARGET_NAMES: readonly string[] = RANGE_TARGETS.map((t) => `the ${t.range} m ${t.kind}`);

/** A world-space direction in hull space (the inverse of hullDirToWorld), into `out` (which may be `d`). */
export function worldDirToHull(tank: Readonly<Pick<TankDrive, 'heading' | 'pitch' | 'roll'>>, d: Readonly<Vec3>, out: Vec3): Vec3 {
  let [x, y, z] = d;
  const ch = Math.cos(tank.heading);
  const sh = Math.sin(tank.heading);
  [x, z] = [x * ch - z * sh, x * sh + z * ch];
  const cp = Math.cos(tank.pitch);
  const sp = Math.sin(tank.pitch);
  [y, z] = [y * cp + z * sp, -y * sp + z * cp];
  const cr = Math.cos(tank.roll);
  const sr = Math.sin(tank.roll);
  [x, y] = [x * cr + y * sr, -x * sr + y * cr];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * The angle above the horizontal to fire at to land `rise` m higher at
 * `distance` m away (horizontal), the flat solution; NaN out of reach.
 */
export function launchAngle(distance: number, rise: number): number {
  const v2 = MUZZLE_SPEED * MUZZLE_SPEED;
  const g = GRAVITY;
  const root = v2 * v2 - g * (g * distance * distance + 2 * rise * v2);
  if (root < 0) return Number.NaN;
  return Math.atan2(v2 - Math.sqrt(root), g * distance);
}

/** Scratch for aimAt, so it allocates nothing. */
const aimMuzzle: Vec3 = [0, 0, 0];
const aimWorld: Vec3 = [0, 0, 0];
const aimDir: Vec3 = [0, 0, 0];

/**
 * How to lay the gun to hit `face`'s middle from the tank at `tank`: the
 * turret's turn and the gun's elevation (rad, as src/sim/turret.ts's), for
 * the tests and the practice crewmate (F1.13), into `out`. The face's
 * world position is compared with the tank's put back into the middle
 * tile, as the ground is drawn. `muzzle(yaw, elevation, out)` gives the
 * muzzle in hull space (turret.ts's muzzlePoint); it is refined a few
 * times, since the muzzle moves as the gun is laid.
 */
export function aimAt(
  tank: Readonly<Pick<TankDrive, 'x' | 'y' | 'z' | 'heading' | 'pitch' | 'roll'>>,
  face: Readonly<HitFace>,
  muzzle: (yaw: number, elevation: number, out: Vec3) => Vec3,
  out: { yaw: number; elevation: number } = { yaw: 0, elevation: 0 },
): { yaw: number; elevation: number } {
  let yaw = 0;
  let elevation = 0;
  const w = aimWorld;
  const dir = aimDir;
  for (let k = 0; k < 4; k++) {
    hullToWorld(tank, muzzle(yaw, elevation, aimMuzzle), w);
    const dx = face.x - wrapTile(w[0]);
    const dz = face.z - wrapTile(w[2]);
    const distance = Math.hypot(dx, dz);
    const angle = launchAngle(distance, face.y - w[1]);
    const c = Math.cos(angle);
    dir[0] = (dx / distance) * c;
    dir[1] = Math.sin(angle);
    dir[2] = (dz / distance) * c;
    worldDirToHull(tank, dir, dir);
    // barrelDirection(yaw, e) = (-cos e sin yaw, sin e, -cos e cos yaw).
    elevation = Math.asin(Math.max(-1, Math.min(1, dir[1])));
    yaw = Math.atan2(-dir[0], -dir[2]);
  }
  out.yaw = yaw;
  out.elevation = elevation;
  return out;
}
