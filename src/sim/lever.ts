/**
 * Spike S3's lever test (Practice > Lever test): the two tillers' size and
 * travel and where the rig goes. The lever itself is the mechanism kit's
 * (src/sim/mechanism.ts, F1.3), which grew from the spike's.
 */

import type { LeverSpec } from './mechanism.js';

const DEG = Math.PI / 180;

/**
 * The tillers of the spike's lever test, about the size of a tank's: a lever
 * of 45 cm whose top 12 cm is the handle, 25° each way, springing back to
 * upright with a tick at the middle.
 */
export const TILLER: LeverSpec = {
  length: 0.45,
  gripLength: 0.12,
  min: -25 * DEG,
  max: 25 * DEG,
  rest: 0,
  spring: 10,
  detents: [0],
  deadband: 2 * DEG,
};

/**
 * The lever test rig (Practice > Lever test), placed in front of the player
 * when it is shown, facing the way they face. Rig space: origin midway
 * between the two tillers' pivots, -Z ahead, as lever space. Sizes, m.
 */
export const LEVER_RIG = {
  /** The pivots are this far ahead of the eyes and this far below them, so the handles sit at lap height, a forearm's length ahead. */
  ahead: 0.42,
  below: 1.0,
  /** Each tiller's pivot is this far to the side of the middle (left negative). */
  side: 0.17,
  /** The lane board: its middle in rig space, its width and its tilt back from upright, radians. */
  board: { y: 0.7, z: -0.53, width: 0.42, tilt: 25 * DEG },
} as const;
