/**
 * The magnified gunsight (spike S1, docs/spikes/s1-sight-render.md):
 * engine-free numbers and maths shared by the model, the render system, the
 * reticle and the tests.
 *
 * Sight space: the middle of the eyepiece lens at the origin, the lens
 * facing +Z (towards the eye), the sight looking along -Z, +X right, +Y up.
 *
 * The view through the sight is a second camera on the sight rendered into
 * a square texture covering the true field. The lens shows it as an image at
 * infinity, like a real eyepiece: each eye's ray through the lens is turned
 * back into a true angle (its angle off the axis divided by the
 * magnification) and looks the texture up there. So the magnification is
 * right wherever the eye is, both eyes see the same distant scene without
 * having to cross at the lens, and backing away from the eyepiece narrows
 * the field rather than shrinking the picture.
 */

/** How much bigger things look through the sight. */
export const MAGNIFICATION = 3;
/** Half the true field of view, radians: the sight camera sees ±6°, so the eye sees about ±18°. */
export const TRUE_HALF_FIELD = (6 * Math.PI) / 180;
/** The lens's radius, m: the glass the picture is drawn on, inside the rubber eyecup. */
export const LENS_RADIUS = 0.024;

/** An eye this close to the lens, and behind it, opens the sight, m (the plan's "about 8 cm"). */
export const OPEN_DISTANCE = 0.09;
/** Once open, the sight stays open until the eye is this far away, so it doesn't flicker on the edge, m. */
export const CLOSE_DISTANCE = 0.12;
/** Half the distance between the eyes, m: each eye sits this far either side of the head pose. */
export const HALF_IPD = 0.032;

/** Texture sizes to compare in the spike, texels square; 512 is the plan's. */
export const SIGHT_SIZES = [256, 512, 1024] as const;
export type SightSize = (typeof SIGHT_SIZES)[number];

/** When the sight camera renders: only with an eye at the eyepiece, every frame (to measure the cost from anywhere), or never. */
export const DRAW_MODES = ['auto', 'always', 'off'] as const;
export type DrawMode = (typeof DRAW_MODES)[number];

/** Which eyes see the picture; the others see dark glass, as when one eye is shut at a real sight. */
export const SIGHT_EYES = ['both', 'left', 'right'] as const;
export type SightEye = (typeof SIGHT_EYES)[number];

/** Bit per eye, for the lens shader: 1 left, 2 right. */
export function eyeMask(eye: SightEye): number {
  return eye === 'left' ? 1 : eye === 'right' ? 2 : 3;
}

/** Muzzle speed the range marks are drawn for, m/s (armour-piercing, plan §4.6). */
export const MUZZLE_SPEED = 600;
export const GRAVITY = 9.81;
/** Range marks every 100 m out to this far, labelled every 200 m. */
export const MAX_MARKED_RANGE = 1000;

/**
 * The sight stand in the spike, in deck space (deck surface y = 0): its
 * post's foot, and the lens's height above the deck, which a seated player
 * (eyes raised to 1.45 m) reaches by leaning a little and a standing one by
 * stooping. Clear of the table, the hoop and the start screen, inside the
 * walking bounds.
 */
export const SIGHT_STAND = { x: 1.0, z: -1.45, lensHeight: 1.4 } as const;

/**
 * Targets for the spike, in deck space: the middle of each board's foot on
 * the ground (y = GROUND_Y) and its range from the sight. Spread across the
 * field so all three show at once with the sight looking straight ahead.
 */
export const SIGHT_TARGETS = [
  { range: 100, x: SIGHT_STAND.x - 5 },
  { range: 250, x: SIGHT_STAND.x + 9 },
  { range: 500, x: SIGHT_STAND.x + 3 },
] as const;

/** A target board: width and height of the face, how high its bottom edge stands off the ground, m. */
export const TARGET_BOARD = { width: 3.0, height: 2.2, lift: 0.5 } as const;

/** Where target `i` stands (deck space): x and z of its foot. */
export function targetFoot(i: number): [number, number] {
  const t = SIGHT_TARGETS[i];
  return [t.x, SIGHT_STAND.z - t.range];
}

/**
 * How far above the line to the target the gun must point to hit it at
 * `range` m, radians: the flat-fire superelevation with no drag. It is also
 * how far below the reticle's middle that range's mark is drawn: lay the
 * mark on the target and the gun points high by just this much.
 */
export function superelevation(range: number, speed = MUZZLE_SPEED): number {
  return 0.5 * Math.asin(Math.min(1, (GRAVITY * range) / (speed * speed)));
}

export interface RangeMark {
  range: number;
  /** Below the reticle's middle, in field units (1 is the edge of the field). */
  drop: number;
  /** Labelled (every 200 m) and drawn longer. */
  major: boolean;
}

/** The reticle's range marks, nearest first. */
export function rangeMarks(halfField = TRUE_HALF_FIELD, speed = MUZZLE_SPEED): RangeMark[] {
  const marks: RangeMark[] = [];
  for (let range = 100; range <= MAX_MARKED_RANGE; range += 100) {
    marks.push({ range, drop: Math.tan(superelevation(range, speed)) / Math.tan(halfField), major: range % 200 === 0 });
  }
  return marks;
}

/**
 * Where a ray from the eye through the lens lands in the sight's picture,
 * in field units (x right, y up; the field is the unit circle). `dx, dy, dz`
 * is the ray's direction in sight space (dz < 0 looks into the sight). The
 * lens shader does the same sums; `out` gets [x, y].
 */
export function fieldPoint(
  dx: number,
  dy: number,
  dz: number,
  out: [number, number],
  magnification = MAGNIFICATION,
  halfField = TRUE_HALF_FIELD,
): [number, number] {
  const length = Math.hypot(dx, dy, dz);
  const apparent = Math.acos(Math.max(-1, Math.min(1, -dz / length)));
  const across = Math.hypot(dx, dy);
  const radius = Math.tan(Math.min(apparent / magnification, Math.PI / 2 - 1e-6)) / Math.tan(halfField);
  out[0] = across > 1e-9 ? (dx / across) * radius : 0;
  out[1] = across > 1e-9 ? (dy / across) * radius : 0;
  return out;
}

/** The eye's half-angle of view through the sight at the field's edge, radians (about 18°). */
export function apparentHalfField(magnification = MAGNIFICATION, halfField = TRUE_HALF_FIELD): number {
  return halfField * magnification;
}

/**
 * Whether the sight is open for an eye `distance` m from the lens, `behind`
 * m behind its face (positive on the eye's side), given whether it was open
 * last frame: it opens within OPEN_DISTANCE and closes beyond CLOSE_DISTANCE.
 */
export function sightOpen(wasOpen: boolean, distance: number, behind: number): boolean {
  if (behind <= 0) {
    return false;
  }
  return distance < (wasOpen ? CLOSE_DISTANCE : OPEN_DISTANCE);
}

/**
 * Yaw and pitch (radians, Y then X, as three.js's 'YXZ' order) that point
 * the sight from `from` so that a target at `to` sits on the range mark for
 * `range` m: the sight looks above the target by the superelevation. With
 * `range` 0 it looks straight at it. `out` gets [yaw, pitch].
 */
export function layOnMark(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  range: number,
  out: [number, number],
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  out[0] = Math.atan2(-dx, -dz);
  out[1] = Math.atan2(dy, Math.hypot(dx, dz)) + (range > 0 ? superelevation(range) : 0);
  return out;
}
