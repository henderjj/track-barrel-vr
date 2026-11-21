/**
 * The commander's map case (F2.10, docs/map-case.md): a stiff board with
 * the field map (field-map.ts) under a leather frame, clipped to the
 * turret's right wall behind the gunner. The gunner reaches for it and
 * squeezes: it comes into the hand, held by its near edge, its face turned
 * to the eyes, and the wrist's roll turns it (to set it to the ground, as a
 * commander would). Let go, it springs back to its clips. Engine-free:
 * sizes, places and the held pose's sums, shared by the model, the system
 * and the tests.
 *
 * Turret space as src/sim/cabin.ts (x right, y up, z forward is −Z). The
 * case's own space: its middle at the origin, x across its face to the
 * right, y up it, z out of its face.
 */

import { HULL, SEATS, TURRET } from './cabin.js';
import { FIELD_MAP, MAP_WIDTH } from './field-map.js';

type Vec3 = [number, number, number];

/** The case's size, m: the map shows in a window `sheet` square in a frame `border` wide, `thick` thick. */
export const MAP_CASE = {
  sheet: 0.32,
  border: 0.015,
  thick: 0.012,
  /** The map lies this far in front of the board's face, and the frame's front this far in front of the map, m (over 3 mm: test/z-fighting.test.ts). */
  sheetGap: 0.004,
  frameGap: 0.004,
} as const;

/**
 * The painted sheet (MapCaseSystem): MAP_PX square, the map's frame
 * MAP_LEFT in from the sides and MAP_TOP down from the top (the margins
 * carry the grid's numbers, the title band is on top), MAP_SCALE px a metre.
 */
export const MAP_PX = 2048;
export const MAP_LEFT = 96;
export const MAP_TOP = 170;
export const MAP_SCALE = (MAP_PX - 2 * MAP_LEFT) / MAP_WIDTH;

/** A world x's place across the sheet, px. */
export function mapPx(x: number): number {
  return MAP_LEFT + (x - FIELD_MAP.west) * MAP_SCALE;
}

/** A world z's place down the sheet, px. */
export function mapPy(z: number): number {
  return MAP_TOP + (z - FIELD_MAP.north) * MAP_SCALE;
}

/**
 * The world point under a point on the case's map window (F2.13), from its
 * middle, m (`u` right, `v` up, as the sheet's plane lies in the case),
 * into `out`; null outside the map's frame (the margins, the frame).
 */
export function sheetToWorld(u: number, v: number, out: [number, number]): [number, number] | null {
  const half = MAP_CASE.sheet / 2;
  if (Math.abs(u) > half || Math.abs(v) > half) return null;
  const px = (u / MAP_CASE.sheet + 0.5) * MAP_PX;
  const py = (0.5 - v / MAP_CASE.sheet) * MAP_PX;
  const x = FIELD_MAP.west + (px - MAP_LEFT) / MAP_SCALE;
  const z = FIELD_MAP.north + (py - MAP_TOP) / MAP_SCALE;
  if (x < FIELD_MAP.west || x > FIELD_MAP.east || z < FIELD_MAP.north || z > FIELD_MAP.south) return null;
  out[0] = x;
  out[1] = z;
  return out;
}

/** Half the case's width (and height), m. */
export const CASE_HALF = MAP_CASE.sheet / 2 + MAP_CASE.border;

/** The turret's right wall's inner face, turret x. */
export const RIGHT_WALL = TURRET.halfWidth - HULL.wall;

/**
 * Where it hangs: on the turret's right wall behind the gunner's right
 * shoulder, where a Sherman's commander sat, clear of the ready rack's
 * shells (they end 30 cm behind the eyes) and the interphone box (77 cm
 * behind). Its middle a little under the eyes' height, its face to the
 * gunner (turned to face −X), its back 5 mm off the wall on two clips. Its
 * near edge about 74 cm from the eyes: a reach to the right and back.
 */
export const CASE_CLIPPED = {
  x: RIGHT_WALL - 0.005 - MAP_CASE.thick / 2,
  y: SEATS.gunner.eye[1] - 0.05,
  z: SEATS.gunner.eye[2] + 0.5,
  /** Turned about +Y so its face looks −X, into the turret. */
  yaw: -Math.PI / 2,
} as const;

/** A hand closing this near the case (outside its outline), or anywhere over its face, takes it, m. */
export const GRAB_REACH = 0.06;
/** Taken from the wall, it comes to the hand over this long; let go, it springs back over this long, s. */
export const TO_HAND = 0.15;
export const SPRING_BACK = 0.35;
/** Passes heldPose makes to square the face to the eyes from its own middle. */
const HELD_PASSES = 4;
/** A held case's edge stands this far out from the middle of the fist, m. */
export const EDGE_IN_FIST = 0.01;

/** Whether a fist at `fist` (turret space) is near enough the clipped case to take it. */
export function canGrab(fist: readonly number[]): boolean {
  const dx = fist[0] - CASE_CLIPPED.x;
  const dy = fist[1] - CASE_CLIPPED.y;
  const dz = fist[2] - CASE_CLIPPED.z;
  // In the case's own space (turned −90° about Y): its right is turret +z (towards the rear, seen from the seat), its face looks −x.
  const across = dz;
  const out = -dx;
  const overX = Math.max(0, Math.abs(across) - CASE_HALF);
  const overY = Math.max(0, Math.abs(dy) - CASE_HALF);
  const overZ = Math.max(0, Math.abs(out) - MAP_CASE.thick / 2);
  return Math.hypot(overX, overY, overZ) <= GRAB_REACH;
}

/** A held case's pose: its middle and its axes (right, up, out of its face), any frame. Written in place, so holding it allocates nothing. */
export interface HeldPose {
  centre: Vec3;
  right: Vec3;
  up: Vec3;
  out: Vec3;
}

export function createHeldPose(): HeldPose {
  return { centre: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], out: [0, 0, 1] };
}

/**
 * Where a case held in a fist sits: its face square to the eyes, its edge
 * in the fist (the right hand holds its right edge, the left hand its left),
 * and up it along the handle's way through the fist as it lies across the
 * face, so rolling the wrist turns the map. `fist` is the middle of the
 * fist and `axis` the way a handle runs through it (thumb end, unit), all
 * in one frame with the eyes.
 */
export function heldPose(fist: readonly number[], axis: readonly number[], eyes: readonly number[], side: 'left' | 'right', out: HeldPose): HeldPose {
  const o = out.out;
  const u = out.up;
  const r = out.right;
  const c = out.centre;
  const shift = (side === 'right' ? -1 : 1) * (CASE_HALF + EDGE_IN_FIST);
  // The face looks from its own middle to the eyes, and the middle hangs off the fist along the face: start from the
  // fist and settle it (each pass shrinks the error by about the case's half-width over the eyes' distance, squared).
  c[0] = fist[0];
  c[1] = fist[1];
  c[2] = fist[2];
  for (let pass = 0; pass < HELD_PASSES; pass++) {
    o[0] = eyes[0] - c[0];
    o[1] = eyes[1] - c[1];
    o[2] = eyes[2] - c[2];
    const ol = Math.hypot(o[0], o[1], o[2]) || 1;
    o[0] /= ol;
    o[1] /= ol;
    o[2] /= ol;
    // Up: the handle's way, less its part along the view; if the handle points at the eyes, the world's up instead.
    let d = axis[0] * o[0] + axis[1] * o[1] + axis[2] * o[2];
    u[0] = axis[0] - o[0] * d;
    u[1] = axis[1] - o[1] * d;
    u[2] = axis[2] - o[2] * d;
    if (Math.hypot(u[0], u[1], u[2]) < 0.2) {
      d = o[1];
      u[0] = -o[0] * d;
      u[1] = 1 - o[1] * d;
      u[2] = -o[2] * d;
    }
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u[0] /= ul;
    u[1] /= ul;
    u[2] /= ul;
    // Right = up × out.
    r[0] = u[1] * o[2] - u[2] * o[1];
    r[1] = u[2] * o[0] - u[0] * o[2];
    r[2] = u[0] * o[1] - u[1] * o[0];
    c[0] = fist[0] + r[0] * shift;
    c[1] = fist[1] + r[1] * shift;
    c[2] = fist[2] + r[2] * shift;
  }
  return out;
}

/** The clipped case's pose in turret space. */
export function clippedPose(out: HeldPose): HeldPose {
  out.centre[0] = CASE_CLIPPED.x;
  out.centre[1] = CASE_CLIPPED.y;
  out.centre[2] = CASE_CLIPPED.z;
  // Its own x and z turned by the yaw about Y: right (0, 0, 1), out (−1, 0, 0).
  out.right[0] = Math.cos(CASE_CLIPPED.yaw);
  out.right[1] = 0;
  out.right[2] = -Math.sin(CASE_CLIPPED.yaw);
  out.up[0] = 0;
  out.up[1] = 1;
  out.up[2] = 0;
  out.out[0] = Math.sin(CASE_CLIPPED.yaw);
  out.out[1] = 0;
  out.out[2] = Math.cos(CASE_CLIPPED.yaw);
  return out;
}
