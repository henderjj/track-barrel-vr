/**
 * The driver's turret position dial (F2.3, docs/turret-dial.md): a round
 * dial on the hood's face right of the vision slit, with the hull drawn
 * from above, nose up, and a pointer shaped like the turret and its gun
 * that turns as the turret does, so the driver knows where the gun points
 * before turning near a wall or a house, and reads the crew's clock
 * directions ("traverse to 3 o'clock") straight off it. Engine-free, shared
 * by the model, TurretDialSystem and the tests.
 *
 * Hull space as in src/sim/cabin.ts. Dial space: the face's middle at the
 * origin, x across it to the right, y up it, z out of it towards the
 * driver's eyes. The turret's angle (src/sim/turret.ts) is positive to the
 * left, as Three.js turns about +Y; seen from the eyes, a turn about the
 * face's +Z by that angle is anticlockwise, so the pointer turns by it.
 */

import { HULL, TURRET, VISION_SLIT } from './cabin.js';
import { HULL_REAR, SPONSON } from './exterior.js';
import { MAX_TRAVERSE, MAX_TRAVERSE_ACCEL } from './comfort.js';
import type { Vec3 } from './mechanism.js';
import { approach } from './tank-drive.js';
import { angleDelta, type TurretState, wrapAngle } from './turret.js';

const DEG = Math.PI / 180;
const HOUR = 30 * DEG;

/**
 * The dial: its face's middle (hull space), how far right of the slit's
 * middle that is, the face's radius, and its case. It lies flat on the
 * hood's face, as the run clock does on the slit's other side: anything at
 * eye height there must stand under 2 cm proud, or a head leaning into the
 * slit meets it before the hood's fade starts (`EYE_CLEARANCE`,
 * test/interior.test.ts). The case is a shallow drum sunk into the
 * armour, the face just in front of it, the pointer in front of that.
 */
export const TURRET_DIAL = (() => {
  const right = 0.28;
  const radius = 0.05;
  /** The case: its radius past the face's, how far it stands out of the hood's inner face, and how far it sinks into it, m. */
  const rim = 0.006;
  const proud = 0.012;
  const sunk = 0.005;
  /** The face stands this far in front of the case's front, and the pointer this far in front of the face, m (3 mm or more, test/z-fighting.test.ts). */
  const faceGap = 0.004;
  return {
    x: VISION_SLIT.x + right,
    y: VISION_SLIT.y,
    z: VISION_SLIT.z + proud + faceGap,
    right,
    radius,
    rim,
    proud,
    sunk,
    faceGap,
    pointerGap: 0.004,
    /** Its turn about +Y, radians: none, it faces straight back down the hull as the hood's face does. */
    yaw: 0,
  } as const;
})();

/**
 * The hull as drawn on the face, from above with its nose up: hull space
 * shrunk by `scale` about the turret ring's middle, which is the face's
 * middle, so the pointer turns where the turret does. The hull with its
 * tracks fills a little over half the face; the clock's numbers go round it.
 */
export const DIAL_HULL = (() => {
  /** The hull's outside, with the tracks under its sponsons, nose to tail, hull space, m (src/sim/exterior.ts). */
  const halfWidth = HULL.halfWidth + HULL.wall;
  const trackHalfWidth = SPONSON.halfWidth;
  const front = HULL.front - HULL.wall;
  const rear = HULL_REAR.plate;
  const reach = Math.max(TURRET.z - front, rear - TURRET.z);
  return {
    halfWidth,
    trackHalfWidth,
    front,
    rear,
    /** Face metres per hull metre: the furthest end reaches 55% of the face's radius. */
    scale: (0.55 * TURRET_DIAL.radius) / reach,
  };
})();

/** A hull-space point (x, z) on the face (dial x, y), into `out`: nose up, the hull's right to the face's right. */
export function hullOnDial(x: number, z: number, out: [number, number]): [number, number] {
  out[0] = x * DIAL_HULL.scale;
  out[1] = -(z - TURRET.z) * DIAL_HULL.scale;
  return out;
}

/**
 * The pointer, pointing up the face with the turret at yaw 0: the turret
 * drawn as a disc the turret's size (to scale with the hull), and its gun a
 * bar out to `reach` of the face's radius, with a wider muzzle, m.
 */
export const DIAL_POINTER = {
  turretRadius: TURRET.halfWidth * DIAL_HULL.scale,
  gunWidth: 0.0045,
  reach: 0.6,
  muzzleWidth: 0.008,
  muzzleLength: 0.006,
} as const;

/** The pointer's turn about the face's +Z for the turret's angle, radians: anticlockwise seen from the eyes for a turret turned left. */
export function pointerAngle(turretYaw: number): number {
  return wrapAngle(turretYaw);
}

/**
 * The clock direction the gun points, as the crew calls it: 12 straight
 * ahead, 3 to the right, 6 behind, 9 to the left, to the nearest hour.
 */
export function clockHour(turretYaw: number): number {
  const hour = Math.round(-wrapAngle(turretYaw) / HOUR);
  const h = ((hour % 12) + 12) % 12;
  return h === 0 ? 12 : h;
}

/** The turret's angle that points the gun at `hour` o'clock, radians (3 o'clock: 90° right, so −π/2). */
export function yawForHour(hour: number): number {
  return wrapAngle(-hour * HOUR);
}

/** Where the number for `hour` is written on the face (dial x, y): round the rim at `at` of the radius. */
export function hourOnDial(hour: number, at: number, out: [number, number]): [number, number] {
  const a = hour * HOUR;
  out[0] = Math.sin(a) * at * TURRET_DIAL.radius;
  out[1] = Math.cos(a) * at * TURRET_DIAL.radius;
  return out;
}

/** A point in dial space in hull space, into `out`: the face turned by its yaw about +Y, at its middle. */
export function dialToHull(p: readonly number[], out: Vec3): Vec3 {
  const c = Math.cos(TURRET_DIAL.yaw);
  const s = Math.sin(TURRET_DIAL.yaw);
  out[0] = TURRET_DIAL.x + p[0] * c + p[2] * s;
  out[1] = TURRET_DIAL.y + p[1];
  out[2] = TURRET_DIAL.z - p[0] * s + p[2] * c;
  return out;
}

/** How fast the Practice shortcut turns the turret: the power traverse's top rate, and its comfort-capped acceleration. */
export const PRACTICE_TRAVERSE = MAX_TRAVERSE;

/**
 * Practice → Turret to 3 o'clock: one step of the turret turning itself
 * towards `target` (radians) the short way round, as the gunner's power
 * traverse would at full revs, slowing so it stops on it. Returns true once
 * it is there, at rest. The owner's page steps its turret with this instead
 * of the gunner's controls while the shortcut runs.
 */
export function slewTurret(s: TurretState, target: number, dt: number): boolean {
  const left = angleDelta(s.yaw, target);
  if (Math.abs(left) < 0.05 * DEG && Math.abs(s.rate) < 2 * DEG) {
    s.yaw = wrapAngle(target);
    s.rate = 0;
    return true;
  }
  // As fast as it can go and still stop in the turn left, braking as hard as it may, a step at a time.
  const accel = MAX_TRAVERSE_ACCEL;
  const brake = accel * (Math.sqrt((dt * dt) / 4 + (2 * Math.abs(left)) / accel) - dt / 2);
  s.rate = approach(s.rate, Math.sign(left) * Math.min(PRACTICE_TRAVERSE, brake), accel * dt);
  const step = s.rate * dt;
  if (Math.sign(step) === Math.sign(left) && Math.abs(step) >= Math.abs(left)) {
    // There this step (it is going no faster than braking allows by now): stop on it.
    s.yaw = wrapAngle(target);
    s.rate = 0;
    return true;
  }
  s.yaw = wrapAngle(s.yaw + step);
  return false;
}
