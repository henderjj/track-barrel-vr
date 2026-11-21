/**
 * Compasses at both seats (F2.9, docs/compass.md): a round compass on the
 * hood's face right of the driver's firing lamp, and one on the turret's
 * front wall over the gunner's crew board. Each is a card that turns
 * behind a fixed lubber mark at its top, so the number under the mark is
 * the way that seat faces: the hull's heading for the driver, the gun's
 * bearing for the gunner (the gunner's turns with the turret). The
 * driver's has a course mark ("bug") they set with a small crank to the
 * heading the commander orders, then steer until it comes to the top, as
 * a German tank driver did with his gyro compass's course-setting dial.
 * The gunner's has a little hull under its lubber that shows which way the
 * hull points against the card. Engine-free, shared by the model,
 * CompassSystem and the tests.
 *
 * Bearings are degrees clockwise from north, 0 to 360, as a map's. World
 * space as src/sim/terrain.ts (+X east, −Z north); a tank heading of 0
 * faces north and a positive heading turns left (src/sim/tank-drive.ts),
 * as does the turret's yaw (src/sim/turret.ts).
 *
 * Face space: the face's middle at the origin, x across it to the right, y
 * up it, z out of it towards the eyes. A turn about +Z is anticlockwise as
 * the eyes see it.
 */

import { HULL, SEATS, TURRET } from './cabin.js';
import { FIRING_LAMP } from './firing-lamp.js';
import type { Vec3, WheelSpec } from './mechanism.js';
import { TURRET_DIAL } from './turret-dial.js';

const DEG = Math.PI / 180;

export type CompassId = 'driver' | 'gunner';

/** Where a compass hangs and how big it is. */
export interface CompassPlace {
  id: CompassId;
  /** What it is fixed to: the hull's hood, or the turret's front wall (it turns with the turret). */
  frame: 'hull' | 'turret';
  /** The face's middle, frame space, m. */
  x: number;
  y: number;
  z: number;
  /** The face's radius, m. */
  radius: number;
  /** The case: its radius past the face's, how far it stands out of the wall, and how far it sinks into it, m. */
  rim: number;
  proud: number;
  sunk: number;
  /** The face stands this far in front of the case's front; the marks this far in front of the face, m (3 mm or more, test/z-fighting.test.ts). */
  faceGap: number;
  markGap: number;
}

/** The face's distance out from the wall the case is set in, m. */
export function faceOut(p: CompassPlace): number {
  return p.proud + p.faceGap;
}

/**
 * The driver's: on the hood's face a little under the eyes' height, right of the firing
 * lamp, so the turret dial, the lamp and the compass are one glance to the
 * right from the slit (about 57° right, 56 cm from the eyes). Flat on the
 * face, as the dial is (docs/turret-dial.md), and as big to the eye as the
 * dial though further: its figures are read, not just a pointer.
 */
export const DRIVER_COMPASS: CompassPlace = (() => {
  const radius = 0.07;
  const rim = 0.006;
  const lampRight = FIRING_LAMP.x + FIRING_LAMP.bezel;
  // Shallower than the dial's case, as the marks stand two deep in front of the card.
  const proud = 0.007;
  const faceGap = 0.004;
  return {
    id: 'driver',
    frame: 'hull',
    x: lampRight + 0.02 + rim + radius,
    // 4 cm under the dial's middle: the periscope's crank's knob, swung down, hides the lubber at its top from eyes a little high otherwise.
    y: TURRET_DIAL.y - 0.04,
    z: TURRET_DIAL.z - TURRET_DIAL.proud - TURRET_DIAL.faceGap + proud + faceGap,
    radius,
    rim,
    proud,
    sunk: 0.01,
    faceGap,
    markGap: 0.004,
  };
})();

/**
 * The gunner's: on the turret's front wall over the crew board, right of
 * the firing lamp's repeater, about 95 cm from the eyes: a glance up and
 * right from the sight. Bigger than the driver's, as big as the wall
 * there allows: under the roof's rounded edge and clear of the board's clip.
 */
export const GUNNER_COMPASS: CompassPlace = (() => {
  const radius = 0.072;
  const rim = 0.006;
  const proud = 0.012;
  const faceGap = 0.004;
  return {
    id: 'gunner',
    frame: 'turret',
    x: 0.75,
    y: SEATS.gunner.eye[1] + 0.115,
    z: TURRET.front + HULL.wall + proud + faceGap,
    radius,
    rim,
    proud,
    sunk: 0.005,
    faceGap,
    markGap: 0.004,
  };
})();

export const COMPASSES: Readonly<Record<CompassId, CompassPlace>> = { driver: DRIVER_COMPASS, gunner: GUNNER_COMPASS };

/** A bearing in degrees, 0 (inclusive) to 360 (exclusive). */
export function wrapBearing(deg: number): number {
  const w = deg % 360;
  // + 0 turns −0 into 0.
  return (w < 0 ? w + 360 : w === 360 ? 0 : w) + 0;
}

/** The hull's heading as a compass bearing, degrees, from the tank's heading (rad, + left, 0 north). */
export function hullBearing(heading: number): number {
  return wrapBearing(-heading / DEG);
}

/** The gun's bearing, degrees, from the tank's heading and the turret's yaw (both rad, + left). */
export function gunBearing(heading: number, turretYaw: number): number {
  return wrapBearing(-(heading + turretYaw) / DEG);
}

/**
 * The card's turn about the face's +Z, radians, for bearing `deg` under the
 * lubber: the card is painted north up, bearings clockwise, so it turns
 * anticlockwise by the bearing to bring it to the top.
 */
export function cardAngle(deg: number): number {
  return deg * DEG;
}

/** The course mark's turn about the face's +Z, radians: where `course` is on the card when the card shows `deg`. */
export function bugAngle(deg: number, course: number): number {
  return (deg - course) * DEG;
}

/** The gunner's hull mark's turn about the face's +Z, radians: the hull drawn under the gun's lubber, turned by the turret's yaw the other way. */
export function hullMarkAngle(turretYaw: number): number {
  return -turretYaw;
}

/** The shortest turn from bearing `from` to `to`, degrees, −180 to 180 (positive clockwise, to the right). */
export function bearingDelta(from: number, to: number): number {
  const d = wrapBearing(to - from);
  return d > 180 ? d - 360 : d;
}

/** A bearing as the crew says and the card shows it: three figures, "060". */
export function bearingText(deg: number): string {
  const r = Math.round(wrapBearing(deg)) % 360;
  return String(r).padStart(3, '0');
}

/** The 16-point name of a bearing ("NE", "SSW"), for the board's words. */
export function pointName(deg: number): string {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(wrapBearing(deg) / 22.5) % 16];
}

/**
 * The course crank: a small crank on a plate below the driver's compass's
 * right, turned by its knob as the periscope's is. A turn moves the
 * course mark 90°, with a tick in the hand every 5°.
 */
export const COURSE_CRANK: WheelSpec = {
  radius: 0.035,
  grip: 'crank',
  knobLength: 0.035,
  min: -Infinity,
  max: Infinity,
  tickEvery: (5 / 90) * 2 * Math.PI,
  perTurn: 90,
};

/** How far the crank's hub's middle stands off the hood's face, m: its 4 cm hub (mechanism.scene-asset.ts) sunk 4 mm into the armour. */
const CRANK_STANDOFF = 0.016;

/**
 * The course crank's hub, hull space: right of the compass's case and a
 * little lower, far enough that its knob's circle never passes over the
 * face (1 cm clear). Turned clockwise, the mark goes clockwise.
 */
export const COURSE_CRANK_HUB: Vec3 = (() => {
  const c = DRIVER_COMPASS;
  const knobOut = COURSE_CRANK.radius + 0.015;
  const across = c.radius + c.rim + knobOut + 0.01;
  const down = 0.02;
  return [c.x + Math.sqrt(across * across - down * down), c.y - down, c.z - faceOut(c) + CRANK_STANDOFF];
})();

/** The course for a crank turned to `angle` radians (unwrapped; + anticlockwise as the driver sees it) from course `start` at angle 0. Clockwise turns raise it. */
export function courseFromCrank(start: number, angle: number): number {
  return wrapBearing(start - (angle / (2 * Math.PI)) * COURSE_CRANK.perTurn);
}

/** Within this of the course counts as on it, degrees. */
export const ON_COURSE = 5;
/** Held on course this long, moving, finishes the Practice drill, s. */
export const HOLD_COURSE = 3;
/** Moving means faster than this, m/s. */
export const MOVING = 0.5;

/**
 * Practice → Drive the tank → Steer a course: the commander's order the
 * drill gives, a multiple of 10° at least `least` degrees round from
 * `heading` (deg), picked by `random` (0 to 1).
 */
export function pickCourse(heading: number, random: number, least = 60): number {
  const span = 360 - 2 * least;
  const off = least + Math.floor(random * (span / 10 + 1)) * 10;
  return Math.round(wrapBearing(heading + off) / 10) * 10 % 360;
}

/** The drill's state: the ordered course, how long the hull has been held on it while moving, and whether it is done. */
export interface CourseDrill {
  course: number;
  held: number;
  done: boolean;
}

export function createCourseDrill(course: number): CourseDrill {
  return { course, held: 0, done: false };
}

/** One step of the drill; true the step it finishes (held within ON_COURSE for HOLD_COURSE s while moving). */
export function stepCourseDrill(d: CourseDrill, bearing: number, speed: number, dt: number): boolean {
  if (d.done) return false;
  const on = Math.abs(bearingDelta(bearing, d.course)) <= ON_COURSE && Math.abs(speed) > MOVING;
  d.held = on ? d.held + dt : 0;
  if (d.held >= HOLD_COURSE) {
    d.done = true;
    return true;
  }
  return false;
}

/** A point in face space in its frame's space, into `out`: the face looks straight back (+Z) from the wall. */
export function faceToFrame(p: CompassPlace, q: readonly number[], out: Vec3): Vec3 {
  out[0] = p.x + q[0];
  out[1] = p.y + q[1];
  out[2] = p.z + q[2];
  return out;
}
