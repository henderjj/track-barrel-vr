/**
 * Compasses at both seats (F2.9, docs/compass.md), built as the gyro
 * compass German tanks carried on the driver's dashboard (Tactical and
 * Technical Trends No. 7, 1942): cards turning in a horizontal plane,
 * read edge-on through a window in a small box. The figures on each card's
 * edge slide past a fixed red lubber line, and the one on the line is the
 * way that seat faces: the hull's heading for the driver, the gun's
 * bearing for the gunner (whose box is on the turret's wall, turning with
 * it). The driver's box has two cards, one over the other: the upper is
 * the course card, set with a small crank to the course the commander
 * orders, the lower the gyro card, and the driver steers until the figures
 * on the two line up. The cards are marked to read directly: figures grow
 * to the right, so the figure wanted is on the side to turn towards (a
 * gyro's gearing can mark them either way; a floating magnetic card can't).
 * Engine-free, shared by the model, CompassSystem and the tests.
 *
 * Bearings are degrees clockwise from north, 0 to 360, as a map's. World
 * space as src/sim/terrain.ts (+X east, −Z north); a tank heading of 0
 * faces north and a positive heading turns left (src/sim/tank-drive.ts),
 * as does the turret's yaw (src/sim/turret.ts).
 *
 * Box space: the origin on the cards' front edge in the window's middle
 * (on the lubber line), x across the window to the right, y up, z out of
 * the window towards the eyes. The cards' axis is upright at z = −radius.
 * The box is turned `yaw` about the frame's +Y to face its seat.
 */

import { HULL, SEATS, TURRET } from './cabin.js';
import type { Vec3, WheelSpec } from './mechanism.js';
import { TURRET_DIAL } from './turret-dial.js';

const DEG = Math.PI / 180;

export type CompassId = 'driver' | 'gunner';

/** Where a compass box hangs, which way it faces, and its cards and window. */
export interface CompassPlace {
  id: CompassId;
  /** What it is fixed to: the hull's hood, or the turret's front wall (it turns with the turret). */
  frame: 'hull' | 'turret';
  /** The box space's origin (the cards' front edge on the lubber line), frame space, m. */
  x: number;
  y: number;
  z: number;
  /** The box's turn about the frame's +Y, radians (negative: turned to face the left). */
  yaw: number;
  /** The wall the box is fixed to, as its z in frame space (the wall's face, looking +Z). */
  wall: number;
  /** The cards' radius, m. */
  radius: number;
  /** How tall each card's edge band is, m. */
  band: number;
  /** The cards, top first: the driver's course card over the gyro card, the gunner's gyro card alone. */
  cards: readonly ('course' | 'gyro')[];
  /** Between the cards, m. */
  cardGap: number;
  /** The window shows this much of the cards either side of the lubber, radians. */
  window: number;
  /** The cards' edges drawn this far either side (hidden past the window by the frame), radians. */
  arc: number;
  /** The window's height past the cards, top and bottom, m. */
  margin: number;
  /** The frame's width round the window, its front this far in front of the cards, and the case's walls' thickness, m. */
  frameWidth: number;
  frameFront: number;
  caseWall: number;
  /** The lubber line's front this far in front of the cards, m (3 mm or more, test/z-fighting.test.ts). */
  lubberFront: number;
}

/** The window's half width and half height, m. */
export function windowSize(p: CompassPlace): [number, number] {
  const cards = p.cards.length;
  return [p.radius * Math.sin(p.window), (cards * p.band + (cards - 1) * p.cardGap) / 2 + p.margin];
}

/** The case's half width and half height, m. */
export function caseSize(p: CompassPlace): [number, number] {
  const [, h] = windowSize(p);
  return [p.radius * Math.sin(p.arc) + 0.001 + p.caseWall, h + p.frameWidth];
}

/** The back plate's front, box z, m: just behind the cards' edges at the ends of their arcs. */
export function backFront(p: CompassPlace): number {
  return -p.radius * (1 - Math.cos(p.arc)) - 0.003;
}

/** Card `i`'s band's middle, box y, m (0 the top card). */
export function cardY(p: CompassPlace, i: number): number {
  const n = p.cards.length;
  return ((n - 1) / 2 - i) * (p.band + p.cardGap);
}

/** A point in box space in the box's frame's space, into `out`. */
export function boxToFrame(p: CompassPlace, q: readonly number[], out: Vec3): Vec3 {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  out[0] = p.x + q[0] * c + q[2] * s;
  out[1] = p.y + q[1];
  out[2] = p.z - q[0] * s + q[2] * c;
  return out;
}

/** A box-space direction in the frame's space (as boxToFrame, without the move). */
export function boxDirToFrame(p: CompassPlace, q: readonly number[]): Vec3 {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return [q[0] * c + q[2] * s, q[1], -q[0] * s + q[2] * c];
}

/**
 * How far out from the wall the box's origin must stand, m, for every
 * corner of the back plate's front to be 3 mm or more in front of the wall
 * (turned, one side of the box comes nearer the wall).
 */
function standOff(radius: number, arc: number, yaw: number, caseWall: number): number {
  const half = radius * Math.sin(arc) + 0.001 + caseWall;
  const back = -radius * (1 - Math.cos(arc)) - 0.003;
  // z out of the wall of a box point (x, ·, z): −x·sin(yaw) + z·cos(yaw); the worst corner is x = half·sign(yaw).
  return 0.003 + half * Math.abs(Math.sin(yaw)) - back * Math.cos(yaw);
}

/**
 * The driver's: on the hood's face right of the firing lamp and the turret
 * dial, a little under the eyes' height, turned 35° to face the driver so
 * the window reads from the seat (about 66° right, 63 cm from the eyes).
 * Its left side, nearest the head, is clear of where a head leaning in can
 * come; its right side stands further out. Two cards: course over gyro.
 */
export const DRIVER_COMPASS: CompassPlace = (() => {
  const radius = 0.075;
  const arc = 36 * DEG;
  const yaw = -35 * DEG;
  const caseWall = 0.004;
  const wall = TURRET_DIAL.z - TURRET_DIAL.proud - TURRET_DIAL.faceGap;
  return {
    id: 'driver',
    frame: 'hull',
    x: 0.07,
    y: TURRET_DIAL.y - 0.03,
    z: wall + standOff(radius, arc, yaw, caseWall),
    yaw,
    wall,
    radius,
    band: 0.02,
    cards: ['course', 'gyro'],
    cardGap: 0.004,
    window: 30 * DEG,
    arc,
    margin: 0.002,
    frameWidth: 0.01,
    frameFront: 0.0045,
    caseWall,
    lubberFront: 0.0035,
  };
})();

/**
 * The gunner's: on the turret's front wall over the crew board, about a
 * metre from the eyes, a glance up and right from the sight; square to the
 * wall, as the gunner looks at it nearly square on. Bigger than the
 * driver's for the distance; its one card is the gyro card, reading the
 * gun's bearing.
 */
export const GUNNER_COMPASS: CompassPlace = (() => {
  const radius = 0.12;
  const arc = 36 * DEG;
  const caseWall = 0.004;
  const wall = TURRET.front + HULL.wall;
  return {
    id: 'gunner',
    frame: 'turret',
    x: 0.75,
    y: SEATS.gunner.eye[1] + 0.12,
    z: wall + standOff(radius, arc, 0, caseWall),
    yaw: 0,
    wall,
    radius,
    band: 0.034,
    cards: ['gyro'],
    cardGap: 0,
    window: 30 * DEG,
    arc,
    margin: 0.002,
    frameWidth: 0.01,
    frameFront: 0.006,
    caseWall,
    lubberFront: 0.004,
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
 * Where a card's painted strip is read, as a share of a turn: the strip is
 * painted 0° to 360° left to right, so the figure on the lubber line is
 * `deg` with this offset, and figures grow to the right.
 */
export function cardOffset(deg: number): number {
  return wrapBearing(deg) / 360;
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
 * The course crank: a small crank right of the driver's box, turned by its
 * knob as the periscope's is. A turn moves the course card 90°, with a
 * tick in the hand every 5°.
 */
export const COURSE_CRANK: WheelSpec = {
  radius: 0.03,
  grip: 'crank',
  knobLength: 0.035,
  min: -Infinity,
  max: Infinity,
  tickEvery: (5 / 90) * 2 * Math.PI,
  perTurn: 90,
};

/** How far the crank's hub's middle stands off the hood's face, m: its 4 cm hub (mechanism.scene-asset.ts) sunk 4 mm into the armour. */
const CRANK_STANDOFF = 0.016;

/** The knob's circle's radius with the knob's own, m. */
export const COURSE_KNOB_OUT = COURSE_CRANK.radius + 0.015;

/**
 * The course crank's hub, hull space: right of the driver's box and a
 * little lower, its knob's circle 1.5 cm clear of the box's side. Turned
 * clockwise, the course grows.
 */
export const COURSE_CRANK_HUB: Vec3 = (() => {
  const c = DRIVER_COMPASS;
  const [half] = caseSize(c);
  const right = boxToFrame(c, [half, 0, 0], [0, 0, 0]);
  return [Math.max(right[0], c.x + half) + COURSE_KNOB_OUT + 0.015, c.y - 0.015, c.wall + CRANK_STANDOFF];
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
