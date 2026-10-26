/**
 * The driver's station (F1.5, docs/driver-station.md): where the tillers,
 * the gear lever, the hand throttle, the gauges and the vision slit's brow
 * pad are in the hull, how far each control moves, and how a control's
 * angle reads as the drive's controls (src/sim/tank-drive.ts) and back.
 * Engine-free, shared by the model, DriverStationSystem, the tests and,
 * from F1.13, the practice crewmate.
 *
 * Hull space as in src/sim/cabin.ts. Every control is a mechanism-kit
 * Lever (src/sim/mechanism.ts) on a mount that doesn't turn: lever space
 * is hull space moved to its pivot, so each swings fore and aft about X,
 * a positive angle tipping its top forwards (-Z).
 */

import { HIGH, LOW, NEUTRAL, type Gear } from './tank-drive.js';
import { SEATS, VISION_SLIT } from './cabin.js';
import { TILLER } from './lever.js';
import type { LeverSpec } from './mechanism.js';

const DEG = Math.PI / 180;

/**
 * A tiller: spike S3's, which players drove a lane with (docs/spikes/s3-lever-feel.md):
 * 45 cm, the top 12 cm the handle, 25° each way, springing back upright with a tick at the middle.
 */
export const DRIVER_TILLER: LeverSpec = TILLER;

/**
 * The gear lever: 40 cm, the top 10 cm the handle, three notches 24° apart
 * that it drops into when let go: pulled back is low range, upright
 * neutral, pushed forwards high range.
 */
export const GEAR_LEVER: LeverSpec = {
  length: 0.4,
  gripLength: 0.1,
  min: -28 * DEG,
  max: 28 * DEG,
  rest: 0,
  spring: 12,
  detents: [-24 * DEG, 0, 24 * DEG],
  deadband: 0,
  notches: [-24 * DEG, 0, 24 * DEG],
};
/** The gear lever's notch for each gear. */
// Indexed by gear: neutral, low, high.
export const GEAR_ANGLES: Readonly<Record<Gear, number>> = { 0: 0, 1: -24 * DEG, 2: 24 * DEG };
/** The lever is in a gear within this of its notch; anywhere else it is between gears (neutral). */
export const IN_GEAR = 8 * DEG;

/**
 * The hand throttle: a friction lever (it stays where it is left) on a
 * quadrant on the left wall, 24 cm with an 8 cm handle; upright is idle and
 * 40° forwards is full, with ticks at a third and two thirds.
 */
export const HAND_THROTTLE: LeverSpec = {
  length: 0.24,
  gripLength: 0.08,
  min: 0,
  max: 40 * DEG,
  rest: 0,
  spring: 0,
  detents: [(40 / 3) * DEG, (80 / 3) * DEG],
  deadband: 0,
};

/** How far each tiller's pivot is to the side of the driver's eyes, m: outside the knees. */
export const TILLER_SIDE = 0.21;

/** The gearbox's hump beside the driver's legs: its sides, its top and its ends, hull space, m. */
export const GEARBOX = { x0: -0.2, x1: 0.3, top: 0.45, z0: -2.4, z1: -1.1 } as const;

export type DriverControlId = 'tillerLeft' | 'tillerRight' | 'gear' | 'throttle';
export const DRIVER_CONTROL_IDS: readonly DriverControlId[] = ['tillerLeft', 'tillerRight', 'gear', 'throttle'];

/** Each control's spec and its pivot in hull space, m. */
export const DRIVER_CONTROLS: Readonly<Record<DriverControlId, { spec: LeverSpec; pivot: readonly [number, number, number] }>> = (() => {
  const [ex, ey, ez] = SEATS.driver.eye;
  return {
    // A forearm ahead of the eyes and a metre below them (spike S3's rig), either side of the knees.
    tillerLeft: { spec: DRIVER_TILLER, pivot: [ex - TILLER_SIDE, ey - 1.0, ez - 0.42] },
    tillerRight: { spec: DRIVER_TILLER, pivot: [ex + TILLER_SIDE, ey - 1.0, ez - 0.42] },
    // On the gearbox's hump at the driver's right knee.
    gear: { spec: GEAR_LEVER, pivot: [GEARBOX.x0 + 0.1, GEARBOX.top, ez - 0.35] },
    // On its quadrant against the left wall, by the driver's left knee.
    throttle: { spec: HAND_THROTTLE, pivot: [-0.98, 0.8, ez - 0.25] },
  };
})();

/** The quadrant box the hand throttle stands on, against the left wall, m. */
export const THROTTLE_QUADRANT = { halfWidth: 0.06, height: 0.1, depth: 0.2 } as const;

/** The pedestals the tillers stand on, from the floor: their pivots are inside the top, m. */
export const TILLER_PEDESTAL = { halfWidth: 0.04, depth: 0.12, above: 0.03 } as const;

/**
 * The instrument panel under the vision slit: its face's middle (hull
 * space), its size, and its tilt back from upright towards the driver's
 * eyes, m and radians. Five dials across it, then a line of lettering
 * under them saying which way the gear lever goes.
 */
export const PANEL = {
  centre: [VISION_SLIT.x, 1.205, -2.31] as const,
  width: 0.64,
  height: 0.18,
  tilt: 20 * DEG,
  /** Each dial's radius, and how far apart their middles are, m. */
  dialRadius: 0.048,
  dialSpacing: 0.122,
  /** How far up the face the dials' middles are, from its middle, m. */
  dialY: 0.018,
} as const;

/** A dial: what it reads, its range, and the face's numbers. Needles sweep clockwise through DIAL_SWEEP from the bottom left. */
export interface Dial {
  id: 'speed' | 'rpm' | 'coolant' | 'oil' | 'fuel';
  label: string;
  min: number;
  max: number;
  /** Numbered marks on the face, in the dial's units. */
  marks: readonly number[];
  /** How a mark's number is written on the face. */
  text: (mark: number) => string;
}

/** The gauges, left to right. */
export const DIALS: readonly Dial[] = [
  { id: 'speed', label: 'KM/H', min: 0, max: 40, marks: [0, 10, 20, 30, 40], text: String },
  { id: 'rpm', label: 'RPM ×100', min: 0, max: 3000, marks: [0, 500, 1000, 1500, 2000, 2500, 3000], text: (m) => String(m / 100) },
  { id: 'coolant', label: 'WATER °C', min: 40, max: 120, marks: [40, 60, 80, 100, 120], text: String },
  { id: 'oil', label: 'OIL BAR', min: 0, max: 6, marks: [0, 2, 4, 6], text: String },
  { id: 'fuel', label: 'FUEL', min: 0, max: 1, marks: [0, 0.5, 1], text: (m) => (m === 0 ? 'E' : m === 1 ? 'F' : '½') },
];
/** A needle's sweep from its dial's minimum to its maximum, clockwise, radians; it starts at the bottom left. */
export const DIAL_SWEEP = 270 * DEG;

/** Each dial's middle in panel space (x right, y up the face), m. */
export function dialCentre(index: number, out: [number, number]): [number, number] {
  out[0] = (index - (DIALS.length - 1) / 2) * PANEL.dialSpacing;
  out[1] = PANEL.dialY;
  return out;
}

/** A needle's angle clockwise from straight up for `value` on `dial`, radians, pinned at its ends. */
export function needleAngle(dial: Dial, value: number): number {
  const t = Math.min(1, Math.max(0, (value - dial.min) / (dial.max - dial.min)));
  return -DIAL_SWEEP / 2 + t * DIAL_SWEEP;
}

/** A dial's value from a needle angle (the inverse of needleAngle within its range), for the tests. */
export function dialValue(dial: Dial, angle: number): number {
  return dial.min + ((angle + DIAL_SWEEP / 2) / DIAL_SWEEP) * (dial.max - dial.min);
}

/** The vision slit's brow pad and frame (docs/driver-station.md#vision-slit), m. */
export const SLIT_FRAME = {
  /** The steel frame's bars round the slit: how wide, how far into the cabin, and how far back from the opening's edges. */
  bar: 0.03,
  depth: 0.03,
  inset: 0.009,
  /** The leather brow pad over the frame: its bottom above the slit's top, its height and its depth. */
  padAbove: 0.04,
  padHeight: 0.07,
  padDepth: 0.06,
} as const;

/** The gear the lever is in at `angle`: the gear whose notch it is within IN_GEAR of, or neutral between them. */
export function gearOfLever(angle: number): Gear {
  if (Math.abs(angle - GEAR_ANGLES[LOW]) <= IN_GEAR) return LOW;
  if (Math.abs(angle - GEAR_ANGLES[HIGH]) <= IN_GEAR) return HIGH;
  return NEUTRAL;
}

/** The hand throttle's setting at `angle`: 0 upright (idle) to 1 fully forwards. */
export function throttleOf(angle: number): number {
  const { min, max } = HAND_THROTTLE;
  return Math.min(1, Math.max(0, (angle - min) / (max - min)));
}

/** Where the hand throttle stands for `throttle` (0 to 1), radians. */
export function throttleAngle(throttle: number): number {
  const { min, max } = HAND_THROTTLE;
  return min + Math.min(1, Math.max(0, throttle)) * (max - min);
}

/**
 * Where a tiller stands for a drive demand (-1 to 1), radians: the inverse
 * of Lever.demand() outside its deadband, upright for none. For drawing
 * the crewmate's tillers, and this player's while the sticks drive.
 */
export function tillerAngle(demand: number): number {
  const { rest, min, max, deadband } = DRIVER_TILLER;
  const d = Math.min(1, Math.max(-1, demand));
  if (d === 0) return rest;
  return d > 0 ? rest + deadband + d * (max - rest - deadband) : rest - deadband + d * (rest - min - deadband);
}

/** A point in panel space (x right along the face, y up it, z out of it towards the driver) in hull space, into `out`. */
export function panelToHull(p: readonly number[], out: [number, number, number]): [number, number, number] {
  // The face turns back about X by the tilt (Three.js: rotation.x = -tilt).
  const c = Math.cos(-PANEL.tilt);
  const s = Math.sin(-PANEL.tilt);
  out[0] = PANEL.centre[0] + p[0];
  out[1] = PANEL.centre[1] + p[1] * c - p[2] * s;
  out[2] = PANEL.centre[2] + p[1] * s + p[2] * c;
  return out;
}
