/**
 * The crew's periscopes (F1.6, reworked by F1.19, docs/periscope.md): one
 * for the driver in the hull roof ahead of their hatch, one for the gunner
 * in the turret roof over the gunsight. Where each stands, its crank, its
 * view, and the sums shared by the model, PeriscopeSystem and the tests.
 * Engine-free.
 *
 * Each turns about an upright through its `axis`: the head on the roof (the
 * window it looks out of) turns, while the eyepiece hanging under the roof,
 * with the window the eye looks into, stays fixed and faces the seat, as on
 * a panoramic sight. So the view swings while the eye stays where it is. The
 * eyepiece sits just above the station's main view (the vision slit, the
 * gunsight): sit up a little to look in, drop back to drive or shoot. A
 * small crank on the eyepiece's right side turns it, a quarter of the way
 * round for each turn of the crank.
 *
 * Frame space: hull space (src/sim/cabin.ts) for the driver's, turret space
 * for the gunner's (it turns with the turret, so the gunner's periscope
 * looks the same way relative to the gun however the turret turns). The
 * periscope's angle is about +Y, positive anticlockwise seen from above (it
 * looks left), 0 straight ahead along -Z.
 */

import { DRIVER_HATCH, GUN, HULL, type SeatId, SEATS, TURRET } from './cabin.js';
import type { Vec3, WheelSpec } from './mechanism.js';

const DEG = Math.PI / 180;

export type PeriscopeId = SeatId;
export const PERISCOPE_IDS: readonly PeriscopeId[] = ['driver', 'gunner'];

/**
 * The eyepiece: a box hanging under the roof, with the window the player
 * looks into on its back face: its width, height and depth, m. A neck rises
 * from its top into a housing under the roof that runs forwards to the
 * upright (the light comes down the upright and back along the housing, as
 * through a panoramic sight's prisms), so the head on the roof can stand
 * further forwards than the window.
 */
export const EYEPIECE_BOX = { width: 0.18, height: 0.09, depth: 0.08 } as const;
/** The housing under the roof from the upright back to the eyepiece's neck: its width and depth under the roof, m. */
export const RELAY = { width: 0.07, depth: 0.045 } as const;
/** The window's size, m: wide enough for both eyes. */
export const WINDOW = { width: 0.14, height: 0.05 } as const;
/** The window's glass stands this far proud of the box's back face, m. */
export const WINDOW_PROUD = 0.004;

/**
 * The eyepiece (box, window and all) is tipped forwards this far, radians,
 * so its window faces down towards the seat as well as back (John's headset
 * note, 2026-11-07: sitting up 12 to 14 cm to a window facing straight back
 * was too far). The eyes look up into it and see the view out of the head,
 * level: the picture is at infinity along the window's axis. So the eyes meet
 * it lower and nearer, 5 to 9 cm above the eye point instead of 12 to 14,
 * while the box stays as high, clear of the slit's view and the gunsight.
 */
export const EYEPIECE_TILT = 30 * DEG;

/** The head on the roof: its width and depth, and how far it stands over the roof, m. */
export const HEAD_SIZE = { width: 0.1, depth: 0.1, height: 0.08 } as const;
/** The shaft between the eyepiece and the head, its radius, m. */
export const SHAFT_RADIUS = 0.022;
/** The head looks this far down from level, radians: the nose (or the turret's roof) at the bottom of the view, the ground from about 15 m out. */
export const PITCH = -2 * DEG;

/**
 * How much bigger things look: none. A Sherman's M6 periscopes were plain
 * unity-power prisms (only the gunner's sight magnified: its telescope was
 * 3×, as the gunsight here is), and at 1× the view moves with the head as
 * the world outside does, which is easiest on the stomach while driving.
 */
export const PERISCOPE_POWER = 1;

/** Half the field across and up, radians: ±20° by ±8°, the same to the eye at 1×. */
export const HALF_FIELD_X = 20 * DEG;
export const HALF_FIELD_Y = 8 * DEG;
/**
 * The picture's texels across; it is as many up as keep them square. 1024
 * over the 40° the eye sees is about 25 a degree, the Quest 3's display
 * (John's note, 2026-11-07: 768 at 2× and 3× looked low-res).
 */
export const PICTURE_WIDTH = 1024;
export const PICTURE_HEIGHT = Math.round((PICTURE_WIDTH * Math.tan(HALF_FIELD_Y)) / Math.tan(HALF_FIELD_X));

/** How far the periscope turns for each turn of its crank, radians: a quarter of the way round. */
export const TURN_PER_CRANK_TURN = 90 * DEG;
/** Crank turns for each turn of the periscope. */
export const CRANK_RATIO = (2 * Math.PI) / TURN_PER_CRANK_TURN;

/**
 * The crank on the eyepiece's right side: a small handwheel facing the
 * seat with a knob standing out of it, turning for ever, a tick every 15°
 * the periscope turns. Anticlockwise, as the player sees it, looks left.
 */
export const PERISCOPE_CRANK: WheelSpec = {
  radius: 0.055,
  grip: 'crank',
  knobLength: 0.05,
  min: -Infinity,
  max: Infinity,
  tickEvery: 15 * DEG * CRANK_RATIO,
  perTurn: TURN_PER_CRANK_TURN / DEG,
};

/** The crank's hub from the window's middle (frame space), m: right of the eyepiece, a little higher, its face 2 cm ahead of the window. */
export const CRANK_FROM_WINDOW: Vec3 = [0.19, 0.02, -0.02];

export interface PeriscopeSpec {
  id: PeriscopeId;
  /** For menus and signs. */
  label: string;
  /** Its name in the mechanism kit and handUse (play-stats groups it by "periscope"). */
  control: string;
  /** What it is fixed to: the hull, or the turret (it turns with it). */
  frame: 'hull' | 'turret';
  /** The upright the head turns about, frame x and z, m (the eyepiece's x). */
  axis: readonly [number, number];
  /** The underside of the roof it stands in, and the roof's top, frame y, m. */
  roof: number;
  roofTop: number;
  /** The window's middle, frame space, m. */
  lens: Vec3;
  /** The way the window faces, towards the eyes looking in: back and down by EYEPIECE_TILT, a unit vector in the frame. */
  facing: Vec3;
  /** The head on the roof: its bottom (inside the roof plate) and top, frame y, m. */
  head: { bottom: number; top: number };
  /** The head's camera, frame y, m: where its window looks out. */
  cameraY: number;
  /** The crank's hub, frame space, m. */
  crank: Vec3;
}

function spec(
  id: PeriscopeId,
  label: string,
  control: string,
  frame: 'hull' | 'turret',
  axis: readonly [number, number],
  roof: number,
  rise: number,
  ahead: number,
): PeriscopeSpec {
  const roofTop = roof + HULL.wall;
  const eye = SEATS[id].eye;
  const lens: Vec3 = [axis[0], eye[1] + rise, eye[2] - ahead];
  const head = { bottom: roofTop - 0.01, top: roofTop + HEAD_SIZE.height };
  return {
    id,
    label,
    control,
    frame,
    axis,
    roof,
    roofTop,
    lens,
    facing: [0, -Math.sin(EYEPIECE_TILT), Math.cos(EYEPIECE_TILT)],
    head,
    cameraY: (head.bottom + head.top) / 2 + 0.005,
    crank: [lens[0] + CRANK_FROM_WINDOW[0], lens[1] + CRANK_FROM_WINDOW[1], lens[2] + CRANK_FROM_WINDOW[2]],
  };
}

/**
 * The driver's: in the hull roof ahead of their hatch, over the vision slit
 * (as a Sherman driver's periscope was in his hatch). Its window is 10 cm
 * above the eyes and 13.5 cm ahead, tipped to face down towards them: sit up
 * a little and lean in to look up into it, sit back to see through the
 * slit, which it stays clear of, behind the slit's brow pad. Its head stands on the roof just behind the hood's face, ahead
 * of the hatch's lid standing open in front of the hole.
 */
export const DRIVER_PERISCOPE = spec('driver', "driver's", 'periscope', 'hull', [SEATS.driver.eye[0], -1.86], HULL.roof, 0.1, 0.135);

/**
 * The gunner's: in the turret roof ahead of their hatch, right over the
 * gunsight's eyepiece (where a Sherman's gunner's and commander's periscopes
 * were). Its window is 12 cm over the sight's, tipped to face down towards
 * the eyes: sit up from the sight to look round, drop back to it to shoot.
 * Whichever window the eyes are nearer has them (the sight's and this one
 * never both open). It turns with the turret, so its angle is
 * from the gun's line.
 */
export const GUNNER_PERISCOPE = spec('gunner', "gunner's", 'gunner-periscope', 'turret', [0.32, -0.49], TURRET.roof, 0.12, 0.196);

export const PERISCOPES: Readonly<Record<PeriscopeId, PeriscopeSpec>> = { driver: DRIVER_PERISCOPE, gunner: GUNNER_PERISCOPE };

/** Where the eyes look in from, `back` m out from window `s`'s middle along the way it faces, into `out`. */
export function lookingIn(s: PeriscopeSpec, back: number, out: Vec3): Vec3 {
  out[0] = s.lens[0] + s.facing[0] * back;
  out[1] = s.lens[1] + s.facing[1] * back;
  out[2] = s.lens[2] + s.facing[2] * back;
  return out;
}

/** The periscope's angle for a crank turned to `crank` radians (unwrapped). */
export function periscopeAngle(crank: number): number {
  return crank / CRANK_RATIO;
}

/** The crank angle that turns the periscope to `angle`. */
export function crankFor(angle: number): number {
  return angle * CRANK_RATIO;
}

/** The way the head looks at angle `angle`, frame space, a unit vector, into `out`. */
export function lookDirection(angle: number, out: Vec3): Vec3 {
  const c = Math.cos(PITCH);
  out[0] = -Math.sin(angle) * c;
  out[1] = Math.sin(PITCH);
  out[2] = -Math.cos(angle) * c;
  return out;
}

/**
 * The middle of the crank's knob, frame space, with the crank at `crank`
 * radians (0 the knob at the top, positive anticlockwise as the player
 * sees it), into `out`.
 */
export function knobMiddle(s: PeriscopeSpec, crank: number, out: Vec3): Vec3 {
  const r = PERISCOPE_CRANK.radius;
  out[0] = s.crank[0] - r * Math.sin(crank);
  out[1] = s.crank[1] + r * Math.cos(crank);
  out[2] = s.crank[2] + 0.01 + (PERISCOPE_CRANK.knobLength - 0.01) / 2;
  return out;
}

/** The angle `angle` as a bearing from straight ahead, degrees, -180 to 180 (positive left). */
export function bearing(angle: number): number {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle)) / DEG;
  return Math.round(a) === -180 ? 180 : a;
}

/** Where a periscope looks, for the menu: "ahead", "40° left", "behind". */
export function bearingText(angle: number): string {
  const b = Math.round(bearing(angle));
  if (Math.abs(b) <= 2) return 'ahead';
  if (Math.abs(b) >= 178) return 'behind';
  return `${Math.abs(b)}° ${b > 0 ? 'left' : 'right'}`;
}

/** Which way periscope `s` looks at `angle`, for the menu: the driver's from the hull's nose, the gunner's from the gun's line. */
export function lookText(s: PeriscopeSpec, angle: number): string {
  const text = bearingText(angle);
  if (s.frame === 'hull') return text;
  return text === 'ahead' ? 'along the gun' : text === 'behind' ? 'behind the turret' : `${text} of the gun`;
}

/** The menu's line: "The driver's periscope looks ahead, the gunner's 40° left of the gun". */
export function periscopesLine(driverAngle: number, gunnerAngle: number): string {
  return `The driver's periscope looks ${lookText(DRIVER_PERISCOPE, driverAngle)}, the gunner's ${lookText(GUNNER_PERISCOPE, gunnerAngle)}`;
}

/** The lowest the gun's barrel comes over the hull's roof with the gun level, hull y, m: the driver's head stays under it. */
export const BARREL_UNDERSIDE = GUN.y - GUN.barrelRadius;

/** The driver's hatch's open lid stands this far in front of the hole, its thickness, as cabin.scene-asset.ts draws it (m). */
export const DRIVER_LID = { gap: 0.03, thickness: 0.05 } as const;

/** The front of the driver's hatch's open lid, hull z: the driver's head on the roof stays ahead of it. */
export const DRIVER_LID_FRONT = DRIVER_HATCH[1] - DRIVER_LID.gap - DRIVER_LID.thickness / 2;
