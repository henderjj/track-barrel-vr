/**
 * The hull direction mark in the gunner's sights (F2.4,
 * docs/hull-direction.md): a small round mark in the lower left of the
 * gunsight's view and of the gunner's periscope's, with the hull drawn from
 * above turning under a turret-and-gun pointer, so the gunner sees where the
 * hull's nose is from where they look and can call "driver, left" in the
 * hull's terms. It is the driver's turret dial (F2.3, src/sim/turret-dial.ts)
 * seen from the other seat: there the hull stands still and the gun turns;
 * here the way the gunner looks stays up and the hull turns under it.
 * Engine-free, shared by the lens's shader (src/systems/scope-lens.ts), the
 * systems that set it and the tests.
 *
 * Field space as the lens's shader has it (src/systems/scope-lens.ts): the
 * picture's middle at the origin, x right, y up, 1 at the field's edge
 * across (x) and up (y), each the tangent of the true angle over the
 * tangent of the half field that way. Mark space: the mark's middle at the
 * origin, x right, y up, 1 at its edge, the same size both ways in the eye.
 *
 * Angles: the turret's and the periscope's are about +Y, positive to the
 * left (src/sim/turret.ts, src/sim/periscope.ts). Seen with the way one
 * looks up the mark, a thing at a bearing b (positive left) is up the mark
 * turned anticlockwise by b.
 */

import { HULL, TURRET } from './cabin.js';
import { DIAL_HULL, clockHour } from './turret-dial.js';
import { wrapAngle } from './turret.js';

const DEG = Math.PI / 180;

/**
 * How big the mark looks: its radius as the eye sees it, radians. 6° across
 * is about the driver's dial from the driver's seat (over 10°) shrunk to
 * fit a corner of the sight's 36°, and as big as a gauge on the instrument
 * box looks: big enough to read the hull's nose at a glance, small enough to
 * keep clear of the reticle and the target.
 */
export const MARK_RADIUS = 3 * DEG;

/** The mark's outer edge stays within this of the field's edge (field units): the field stop starts to darken at 0.94. */
export const MARK_EDGE = 0.9;

/** Where a mark sits in a lens's field and how big it is there. */
export interface MarkPlace {
  /** The mark's middle, field units. */
  readonly at: readonly [number, number];
  /** Its radius as the tangent of the true angle (the lens's shader divides by it). */
  readonly radius: number;
}

/** A lens's field: its magnification, half fields across and up (true, radians) and its field stop's shape (src/systems/scope-lens.ts). */
export interface LensField {
  magnification: number;
  halfFieldX: number;
  halfFieldY: number;
  stop: 'round' | 'rectangle';
}

/**
 * Where the mark sits in `field`: in its lower left, its outer edge
 * MARK_EDGE from the middle, so the reticle and the target (in the middle)
 * stay clear. A round field puts it down the diagonal; a rectangle in the
 * corner.
 */
export function markPlace(field: LensField): MarkPlace {
  const radius = Math.tan(MARK_RADIUS / field.magnification);
  const rx = radius / Math.tan(field.halfFieldX);
  const ry = radius / Math.tan(field.halfFieldY);
  if (field.stop === 'round') {
    const d = (MARK_EDGE - Math.max(rx, ry)) / Math.SQRT2;
    return { at: [-d, -d], radius };
  }
  return { at: [-(MARK_EDGE - rx), -(MARK_EDGE - ry)], radius };
}

/** Field point (x, y) in mark space, into `out`: what the shader does (src/systems/scope-lens.ts, `uMarkAt`, `uMarkRadius`). */
export function fieldToMark(place: MarkPlace, field: LensField, x: number, y: number, out: [number, number]): [number, number] {
  out[0] = ((x - place.at[0]) * Math.tan(field.halfFieldX)) / place.radius;
  out[1] = ((y - place.at[1]) * Math.tan(field.halfFieldY)) / place.radius;
  return out;
}

/** Mark-space point (x, y) in field units, into `out`: the inverse of `fieldToMark`. */
export function markToField(place: MarkPlace, field: LensField, x: number, y: number, out: [number, number]): [number, number] {
  out[0] = place.at[0] + (x * place.radius) / Math.tan(field.halfFieldX);
  out[1] = place.at[1] + (y * place.radius) / Math.tan(field.halfFieldY);
  return out;
}

/**
 * The hull drawing's turn on the mark, radians anticlockwise, for an eye
 * looking `look` from the hull's nose (positive left): the turret's angle
 * in the gunsight, the turret's plus the periscope's in the gunner's
 * periscope. The hull's nose is at a bearing of −look from the way one
 * looks, so the hull turns the other way: turret to the right, nose to the left.
 */
export function hullTurn(look: number): number {
  return wrapAngle(-look);
}

/**
 * The gun pointer's turn on the mark, radians anticlockwise, for an eye
 * looking `fromGun` from the gun's line (positive left): none in the
 * gunsight, which looks along the gun; minus the periscope's own angle in
 * the gunner's periscope, which turns on the turret.
 */
export function gunTurn(fromGun: number): number {
  return wrapAngle(-fromGun);
}

/** Up the mark (0, 1) turned anticlockwise by `turn`, into `out`: where a drawing's nose or muzzle points. */
export function turnedUp(turn: number, out: [number, number]): [number, number] {
  out[0] = -Math.sin(turn);
  out[1] = Math.cos(turn);
  return out;
}

/**
 * The clock hour the hull's nose is at, seen looking `look` from it, 12 up
 * the mark (where one looks), 3 to the right: the gunner says "driver,
 * left" when it is at 9 and the target is ahead.
 */
export function noseHour(look: number): number {
  return clockHour(-look);
}

/**
 * The drawings, mark space (radius 1), painted once into the mark's
 * texture (src/systems/hull-direction-system.ts): the face a cream disc
 * like the driver's dial's, a little see-through, with a dark rim and a
 * notch at the top for where one looks; the hull, its tracks and the
 * driver's hood to the dial's own shape, shrunk about the turret ring so
 * its furthest end is `hullReach` out, an arrowhead ahead of its nose; the turret a disc to the same scale
 * and the gun a bar out to `gunReach`.
 */
export const MARK_DRAWING = (() => {
  const reach = Math.max(TURRET.z - DIAL_HULL.front, DIAL_HULL.rear - TURRET.z);
  const hullReach = 0.62;
  /** Mark units per hull metre. */
  const scale = hullReach / reach;
  return {
    /** How opaque the face is: the scene shows faintly through it. */
    opacity: 0.85,
    rim: 0.9,
    notch: 0.12,
    hullReach,
    scale,
    turretRadius: TURRET.halfWidth * scale,
    gunReach: 0.74,
    gunWidth: 0.09,
    /** An arrowhead ahead of the hull's nose, mark units out from the middle and its half width: the nose reads at a glance at any turn. */
    arrow: { from: hullReach + 0.03, to: hullReach + 0.15, halfWidth: 0.12 },
    /** The driver's hood's patch, hull space x and z (as the dial draws it). */
    hood: { x0: -0.75, x1: -0.25, z0: HULL.front + 0.2, z1: -1.4 },
  } as const;
})();

/** A hull-space point (x, z) on the mark drawn nose up (mark x, y), into `out`. */
export function hullOnMark(x: number, z: number, out: [number, number]): [number, number] {
  out[0] = x * MARK_DRAWING.scale;
  out[1] = -(z - TURRET.z) * MARK_DRAWING.scale;
  return out;
}

/** The mark's texture, three square layers side by side: the face (fixed), the hull (turned by `hullTurn`), the gun (turned by `gunTurn`). */
export const MARK_LAYERS = 3;

/**
 * Where the shader samples layer `layer` for mark point (x, y) drawn turned
 * anticlockwise by `turn`, as texture u, v, into `out` (v up, as a canvas
 * texture is uploaded): the point turned back by `turn`, into its square.
 */
export function markUv(x: number, y: number, turn: number, layer: number, out: [number, number]): [number, number] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const rx = x * c + y * s;
  const ry = -x * s + y * c;
  out[0] = (rx * 0.5 + 0.5 + layer) / MARK_LAYERS;
  out[1] = ry * 0.5 + 0.5;
  return out;
}
