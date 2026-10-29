/**
 * The driver's periscope (F1.6, docs/periscope.md): where it stands in the
 * hull, its two-handled yoke, its view, and the sums shared by the model,
 * PeriscopeSystem and the tests. Engine-free.
 *
 * Hull space as in src/sim/cabin.ts. The periscope turns about an upright
 * through AXIS: its head on the roof (the window it looks out of) and the
 * yoke under the eyepiece turn together; the eyepiece, with the lens the
 * driver looks into, is fixed to the hull and faces them, as on a
 * panoramic sight. So the view swings as the yoke turns, while the eye
 * stays where it is.
 *
 * Periscope space (the yoke's, src/sim/mechanism.ts): the yoke's middle
 * at the origin, turning about +Y (positive anticlockwise seen from above,
 * so it looks left), its handles out along ±X, and the head looking along
 * -Z at 0, straight ahead.
 */

import { GUN, HULL, SEATS } from './cabin.js';
import type { YokeSpec } from './mechanism.js';

const DEG = Math.PI / 180;

/**
 * The upright it turns about, hull x and z, m: 26 cm right of the driver's
 * eyes and 20 cm ahead, right of the vision slit and just behind the hood's
 * face, so the driver leans right a little to look in, hands still on the
 * tillers (docs/interior.md). The instrument box has the left.
 */
export const AXIS = [SEATS.driver.eye[0] + 0.26, SEATS.driver.eye[2] - 0.2] as const;

/** The yoke's middle, hull y, m: 27 cm under the driver's eyes, under the shoulders and low enough to read the gauges over. */
export const YOKE_Y = SEATS.driver.eye[1] - 0.27;

/**
 * The yoke: a handle out each side, 7 to 17 cm from the middle, turning all
 * the way round; quick in both hands, at 30°/s in one, with a tick every 15°.
 */
export const PERISCOPE_YOKE: YokeSpec = {
  inner: 0.07,
  outer: 0.17,
  min: -Infinity,
  max: Infinity,
  oneHandSpeed: 30 * DEG,
  tickEvery: 15 * DEG,
};

/**
 * The fixed eyepiece: a box round the upright at eye height (its middle's
 * hull y; width, height and depth), with the window the driver looks into
 * on its back face and a rubber brow pad over it, m.
 */
export const EYEPIECE_BOX = { y: SEATS.driver.eye[1] + 0.02, width: 0.2, height: 0.09, depth: 0.1 } as const;
/** The window's size, m: wide enough for both eyes. */
export const WINDOW = { width: 0.14, height: 0.05 } as const;
/** The window's glass stands this far proud of the box's back face, m. */
export const WINDOW_PROUD = 0.004;

/** The window's middle in hull space, m: 15 cm ahead of the driver's eyes and 26 cm to their right. */
export const LENS: readonly [number, number, number] = [AXIS[0], EYEPIECE_BOX.y, AXIS[1] + EYEPIECE_BOX.depth / 2 + WINDOW_PROUD];

/** The head on the roof: its bottom (inside the roof plate) and top, hull y, and its width and depth, m. */
export const HEAD = { bottom: HULL.roof + HULL.wall - 0.01, top: HULL.roof + HULL.wall + 0.08, width: 0.1, depth: 0.12 } as const;
/** The head's camera, hull y, m: where its window looks out. */
export const CAMERA_Y = (HEAD.bottom + HEAD.top) / 2 + 0.005;
/** The head looks this far down from level, radians: the hull's nose at the bottom of the view, the ground from about 15 m out. */
export const PITCH = -2 * DEG;
/** The shaft between the yoke and the head, its radius, m. */
export const SHAFT_RADIUS = 0.022;

/** How much bigger things look, by default, and the Practice menu's choices. */
export const PERISCOPE_POWER = 2;
export const PERISCOPE_POWERS = [1, 2, 3] as const;
export type PeriscopePower = (typeof PERISCOPE_POWERS)[number];

/** Half the true field across and up, radians: the eye sees ±40° by ±16° at 2×. */
export const HALF_FIELD_X = 20 * DEG;
export const HALF_FIELD_Y = 8 * DEG;
/** The picture's texels across; it is as many up as keep them square. */
export const PICTURE_WIDTH = 768;
export const PICTURE_HEIGHT = Math.round((PICTURE_WIDTH * Math.tan(HALF_FIELD_Y)) / Math.tan(HALF_FIELD_X));

/** The way the head looks at yoke angle `angle`, hull space, a unit vector, into `out`. */
export function lookDirection(angle: number, out: [number, number, number]): [number, number, number] {
  const c = Math.cos(PITCH);
  out[0] = -Math.sin(angle) * c;
  out[1] = Math.sin(PITCH);
  out[2] = -Math.cos(angle) * c;
  return out;
}

/** A point in periscope space, turned to yoke angle `angle`, in hull space, into `out`. */
export function periscopeToHull(p: readonly number[], angle: number, out: [number, number, number]): [number, number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // As Three.js turns about +Y.
  const x = p[0] * c + p[2] * s;
  const z = -p[0] * s + p[2] * c;
  out[0] = AXIS[0] + x;
  out[1] = YOKE_Y + p[1];
  out[2] = AXIS[1] + z;
  return out;
}

/** The middle of handle `dir` (-1 left, 1 right) at yoke angle `angle`, hull space, into `out`. */
export function handleMiddle(dir: -1 | 1, angle: number, out: [number, number, number]): [number, number, number] {
  return periscopeToHull([(dir * (PERISCOPE_YOKE.inner + PERISCOPE_YOKE.outer)) / 2, 0, 0], angle, out);
}

/** The angle `angle` as a bearing from straight ahead, degrees, -180 to 180 (positive left). */
export function bearing(angle: number): number {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle)) / DEG;
  return Math.round(a) === -180 ? 180 : a;
}

/** Where the periscope looks, for the menu: "ahead", "40° left", "behind". */
export function bearingText(angle: number): string {
  const b = Math.round(bearing(angle));
  if (Math.abs(b) <= 2) return 'ahead';
  if (Math.abs(b) >= 178) return 'behind';
  return `${Math.abs(b)}° ${b > 0 ? 'left' : 'right'}`;
}

/** The lowest the gun's barrel comes over the hull's roof with the gun level, hull y, m: the head stays under it. */
export const BARREL_UNDERSIDE = GUN.y - GUN.barrelRadius;
