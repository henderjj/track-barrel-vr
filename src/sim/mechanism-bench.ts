/**
 * The mechanism kit's test bench (Practice > Mechanism kit): one of each
 * mechanism on a bench in front of the player, with a board reading them
 * out, so each can be tried in a headset before the stations that use them
 * are built (F1.5 driver, F1.6 periscope, F1.8 turret). Shared by the model
 * (src/scene-assets/mechanism.scene-asset.ts), the bench system and the
 * tests. Engine-free. Design note: docs/mechanisms.md.
 *
 * Bench space: origin in the middle of the bench's top, +X right, +Y up,
 * -Z ahead, placed in front of the player facing the way they face. Sizes,
 * m; angles, radians.
 */

import type { ButtonSpec, LeverSpec, TwistSpec, Vec3, WheelSpec, YokeSpec } from './mechanism.js';

const DEG = Math.PI / 180;

export const BENCH = {
  /** The bench's top is this far ahead of the eyes (its middle) and this far below them: lap height, a forearm's length ahead. */
  ahead: 0.36,
  below: 0.75,
  /** The top: its size and the z of its middle. */
  top: { width: 0.92, depth: 0.38, z: -0.13, thickness: 0.03 },
  /** The read-out board: its middle, size and tilt back from upright. */
  board: { y: 0.68, z: -0.34, width: 0.44, height: 0.2, tilt: 15 * DEG },
} as const;

/** Where a control sits on the bench, and its turn about X (a wheel tilted back to face the player, a button facing up). */
export interface BenchMount {
  at: Vec3;
  tilt: number;
}

/** A gear-lever-like lever with three notches that it settles into when let go, ticking at each. */
export const NOTCHED_LEVER: LeverSpec = {
  length: 0.28,
  gripLength: 0.1,
  min: -30 * DEG,
  max: 30 * DEG,
  rest: 0,
  spring: 8,
  detents: [-25 * DEG, 0, 25 * DEG],
  notches: [-25 * DEG, 0, 25 * DEG],
  deadband: 2 * DEG,
};

/** A crank, like a manual traverse: turns for ever, a tick each quarter turn. */
export const CRANK: WheelSpec = {
  radius: 0.09,
  grip: 'crank',
  knobLength: 0.07,
  min: -Infinity,
  max: Infinity,
  tickEvery: Math.PI / 2,
  perTurn: 1,
};

/** A handwheel gripped on its rim by one hand or both, like an elevation wheel: two turns each way, a tick each eighth. */
export const HANDWHEEL: WheelSpec = {
  radius: 0.12,
  grip: 'rim',
  knobLength: 0,
  min: -4 * Math.PI,
  max: 4 * Math.PI,
  tickEvery: Math.PI / 4,
  perTurn: 1,
};

/** A power-traverse twist grip with a trigger: 40° each way, springing back. */
export const TWIST: TwistSpec = {
  base: 0.035,
  length: 0.11,
  max: 40 * DEG,
  spring: 12,
  deadband: 4 * DEG,
};

/** A periscope-like yoke: turns all the way round, quickly in both hands, at 30°/s in one. */
export const YOKE: YokeSpec = {
  inner: 0.07,
  outer: 0.17,
  min: -Infinity,
  max: Infinity,
  oneHandSpeed: 30 * DEG,
  tickEvery: 15 * DEG,
};

/** A push button, and a push-on, push-off switch. */
export const BUTTON: ButtonSpec = { radius: 0.018, travel: 0.008, latching: false };
export const SWITCH: ButtonSpec = { radius: 0.018, travel: 0.008, latching: true };

/** A button's square bezel, behind the cap: its half width, and its depth behind the cap's face pushed fully in (3 mm, so the faces never meet). */
export const BEZEL = { half: 0.026, gap: 0.003, depth: 0.02 } as const;

/** The buttons' frames sit this high over the bench top, so their bezels sink 5 mm into it. */
const BUTTON_Y = BUTTON.travel + BEZEL.gap + BEZEL.depth - 0.005;

/** Where each control sits, left to right, with the yoke on a column at the back. */
export const MOUNTS = {
  lever: { at: [-0.38, 0.02, -0.04], tilt: 0 },
  crank: { at: [-0.19, 0.15, -0.06], tilt: -30 * DEG },
  wheel: { at: [0.05, 0.17, -0.04], tilt: -30 * DEG },
  twist: { at: [0.25, 0, -0.04], tilt: 0 },
  button: { at: [0.38, BUTTON_Y, -0.08], tilt: -90 * DEG },
  switch: { at: [0.38, BUTTON_Y, 0.03], tilt: -90 * DEG },
  yoke: { at: [0, 0.42, -0.15], tilt: 0 },
} as const satisfies Record<string, BenchMount>;

export type BenchControl = keyof typeof MOUNTS;
export const BENCH_CONTROLS = Object.keys(MOUNTS) as BenchControl[];

/** A point in a control's space, in bench space, into `out` (its mount's position and turn about X). */
export function mountToBench(mount: BenchMount, p: readonly number[], out: Vec3): Vec3 {
  const c = Math.cos(mount.tilt);
  const s = Math.sin(mount.tilt);
  out[0] = mount.at[0] + p[0];
  out[1] = mount.at[1] + p[1] * c - p[2] * s;
  out[2] = mount.at[2] + p[1] * s + p[2] * c;
  return out;
}
