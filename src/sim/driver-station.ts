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

import { type Gear, LEVER_ORDER, NEUTRAL } from './gearbox.js';
import { SEATS, VISION_SLIT } from './cabin.js';
import { TILLER } from './lever.js';
import type { ButtonSpec, LeverSpec } from './mechanism.js';

const DEG = Math.PI / 180;

/**
 * A tiller: spike S3's, which players drove a lane with (docs/spikes/s3-lever-feel.md):
 * 45 cm, the top 12 cm the handle, springing back upright with a tick at the middle. It
 * swings 20° each way (S3's went 25°), so full forwards stays within a seated arm's reach
 * (John's headset check, docs/interior.md).
 */
export const DRIVER_TILLER: LeverSpec = { ...TILLER, min: -20 * DEG, max: 20 * DEG };

/** How far apart the gear lever's notches are. */
export const GEAR_STEP = 8 * DEG;
/** The gear lever's notch for each gear (F1.16): back to front reverse, neutral, 1st to 5th, GEAR_STEP apart, 2nd upright. */
export const GEAR_ANGLES: Readonly<Record<Gear, number>> = (() => {
  const angles = {} as Record<Gear, number>;
  LEVER_ORDER.forEach((gear, i) => (angles[gear] = (i - 3) * GEAR_STEP));
  return angles;
})();
/**
 * The gear lever: 40 cm, the top 10 cm the handle, with a notch for each
 * gear that it drops into when let go: reverse furthest back, then neutral,
 * then 1st to 5th forwards (F1.16; F1.5's had low, neutral and high).
 */
export const GEAR_LEVER: LeverSpec = {
  length: 0.4,
  gripLength: 0.1,
  min: GEAR_ANGLES[LEVER_ORDER[0]] - 3 * DEG,
  max: GEAR_ANGLES[LEVER_ORDER[LEVER_ORDER.length - 1]] + 3 * DEG,
  rest: 0,
  spring: 12,
  detents: LEVER_ORDER.map((gear) => GEAR_ANGLES[gear]),
  deadband: 0,
  notches: LEVER_ORDER.map((gear) => GEAR_ANGLES[gear]),
};
/** The lever is in a gear within this of its notch; anywhere else it is between gears (neutral). */
export const IN_GEAR = 3.5 * DEG;

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
/** How far each tiller's pivot is under the driver's eyes, m (spike S3's rig had it 1 m under them): the handles 42 cm under the eyes. */
export const TILLER_DROP = 0.81;
/** How far each tiller's pivot is ahead of the driver's eyes, m: the handles 32 cm ahead upright, 45 cm pushed fully forwards and 19 cm pulled back. */
export const TILLER_AHEAD = 0.32;

/** The gearbox's hump beside the driver's legs: its sides, its top and its ends, hull space, m. */
export const GEARBOX = { x0: -0.2, x1: 0.3, top: 0.45, z0: -2.4, z1: -1.1 } as const;

export type DriverControlId = 'tillerLeft' | 'tillerRight' | 'gear' | 'throttle';
export const DRIVER_CONTROL_IDS: readonly DriverControlId[] = ['tillerLeft', 'tillerRight', 'gear', 'throttle'];

/** Each control's spec and its pivot in hull space, m. */
export const DRIVER_CONTROLS: Readonly<Record<DriverControlId, { spec: LeverSpec; pivot: readonly [number, number, number] }>> = (() => {
  const [ex, ey, ez] = SEATS.driver.eye;
  return {
    // Either side of the knees, the handles where seated hands rest with the elbows bent: 42 cm under the
    // eyes and 32 cm ahead, so full forwards needs no lean and the eyes stay at the slit (docs/interior.md).
    tillerLeft: { spec: DRIVER_TILLER, pivot: [ex - TILLER_SIDE, ey - TILLER_DROP, ez - TILLER_AHEAD] },
    tillerRight: { spec: DRIVER_TILLER, pivot: [ex + TILLER_SIDE, ey - TILLER_DROP, ez - TILLER_AHEAD] },
    // On the gearbox's hump at the driver's right knee.
    gear: { spec: GEAR_LEVER, pivot: [GEARBOX.x0 + 0.1, GEARBOX.top, ez - 0.35] },
    // On its quadrant against the left wall, by the driver's left knee, under the instrument box.
    throttle: { spec: HAND_THROTTLE, pivot: [-0.98, 0.66, ez - 0.25] },
  };
})();

/** The quadrant box the hand throttle stands on, against the left wall, m. */
export const THROTTLE_QUADRANT = { halfWidth: 0.06, height: 0.1, depth: 0.2 } as const;

/** The pedestals the tillers stand on, from the floor: their pivots are inside the top, m. */
export const TILLER_PEDESTAL = { halfWidth: 0.04, depth: 0.12, above: 0.03 } as const;

/**
 * The instrument box: in front of the driver, standing on the glacis
 * between the tillers like a dashboard, a glance down from the slit (John's
 * headset check; the M4A4's is on the left front, TM 9-754 figure 9, where
 * ours was). Tilted back so its face looks at the eyes. Its face's middle
 * (hull space) and size, m. Five dials in two rows, three over two, and a
 * plate in the bottom row's third place saying which way the gear lever goes.
 */
export const PANEL = (() => {
  const centre = [-0.5, 1.1, -2.06] as const;
  const [ex, ey, ez] = SEATS.driver.eye;
  const dx = ex - centre[0];
  const dz = ez - centre[2];
  return {
    centre,
    width: 0.28,
    height: 0.16,
    /** Its turn about +Y from facing the hull's rear, and its tilt back from upright, so the face looks at the eyes, radians. */
    yaw: Math.atan2(dx, dz),
    tilt: Math.atan2(ey - centre[1], Math.hypot(dx, dz)),
    /** Each dial's radius, how far apart their middles are across a row, and how far apart the rows are, m. */
    dialRadius: 0.036,
    dialSpacing: 0.085,
    rowSpacing: 0.08,
    /** How far up the face the rows' middle is, from its middle, m. */
    dialY: 0.0,
  };
})();

/** A dial: what it reads, its range, and the face's numbers. Needles sweep clockwise through DIAL_SWEEP from the bottom left. */
export interface Dial {
  id: 'speed' | 'rpm' | 'coolant' | 'oil' | 'fuel' | 'volts';
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
  { id: 'coolant', label: 'WATER °C', min: 0, max: 120, marks: [0, 30, 60, 90, 120], text: String },
  { id: 'oil', label: 'OIL BAR', min: 0, max: 6, marks: [0, 2, 4, 6], text: String },
  { id: 'fuel', label: 'FUEL', min: 0, max: 1, marks: [0, 0.5, 1], text: (m) => (m === 0 ? 'E' : m === 1 ? 'F' : '½') },
];
/** A needle's sweep from its dial's minimum to its maximum, clockwise, radians; it starts at the bottom left. */
export const DIAL_SWEEP = 270 * DEG;

/** How many dials the top row holds; the rest go under its first ones, left to right. */
export const TOP_ROW = 3;
/** The gear plate's place: the bottom row's third. */
export const GEAR_PLATE = TOP_ROW + 2;

/** Each dial's middle in panel space (x right, y up the face), m; index GEAR_PLATE is the gear plate's. */
export function dialCentre(index: number, out: [number, number]): [number, number] {
  const row = index < TOP_ROW ? 0 : 1;
  const column = row === 0 ? index : index - TOP_ROW;
  out[0] = (column - (TOP_ROW - 1) / 2) * PANEL.dialSpacing;
  out[1] = PANEL.dialY + (row === 0 ? 1 : -1) * (PANEL.rowSpacing / 2);
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

/**
 * The switch panel (F1.17, docs/engine.md): a strip of the instrument box
 * under the dials, the same tilt and turn, with the voltmeter, the warning
 * lamps, and the engine's switches and buttons, pressed with a fingertip
 * (or held in by a fist squeezed on them). Panel space as the dials'; the
 * strip's middle is `y` up the face from the panel's middle, m.
 */
export const SWITCH_PANEL = {
  y: -0.127,
  width: 0.3,
  height: 0.07,
  /** The caps' and the lamps' middles above the strip's middle, and the labels' under it, m. */
  capY: 0.008,
  labelY: -0.024,
} as const;

/** The instrument box's housing: round the dials' face and the switch strip, m (panel space; FACE_GAP behind them). */
export const PANEL_HOUSING = (() => {
  const top = PANEL.height / 2 + 0.015;
  const bottom = SWITCH_PANEL.y - SWITCH_PANEL.height / 2 - 0.015;
  return { width: SWITCH_PANEL.width + 0.02, top, bottom, middle: (top + bottom) / 2, height: top - bottom };
})();

export type EngineControlId = 'battery' | 'ignition' | 'choke' | 'starter' | 'siren';
export const ENGINE_CONTROL_IDS: readonly EngineControlId[] = ['battery', 'ignition', 'choke', 'starter', 'siren'];

/** A switch that stays where it is put (pressed once on, again off): small, so they are pressed on purpose. */
export const PANEL_SWITCH: ButtonSpec = { radius: 0.01, travel: 0.006, latching: true };
/** A button held in: the starter and the siren. */
export const PANEL_BUTTON: ButtonSpec = { radius: 0.012, travel: 0.007, latching: false };

/** Each engine control: its spec, where across the strip (panel x, m), its label and its cap's colour. */
export const ENGINE_CONTROLS: Readonly<Record<EngineControlId, { spec: ButtonSpec; x: number; label: string; color: number }>> = {
  battery: { spec: PANEL_SWITCH, x: -0.015, label: 'BATTERY', color: 0x3a6fa8 },
  ignition: { spec: PANEL_SWITCH, x: 0.02, label: 'IGNITION', color: 0xc9a227 },
  choke: { spec: PANEL_SWITCH, x: 0.055, label: 'CHOKE', color: 0xd8d2bf },
  starter: { spec: PANEL_BUTTON, x: 0.092, label: 'STARTER', color: 0x2f8a3a },
  siren: { spec: PANEL_BUTTON, x: 0.13, label: 'SIREN', color: 0xa83228 },
};
/** A cap's face, out, stands this far in front of the strip's face, m: pushed fully in it stays 3 mm proud (test/z-fighting.test.ts). */
export const CAP_PROUD = 0.004;
/** How far in a switch that is on sits, as a share of its travel. */
export const SWITCH_ON_DEPTH = 0.5;

/** The voltmeter: a small dial at the strip's left, 0 to 32 V (F1.17). */
export const VOLTMETER = { x: -0.112, radius: 0.024, min: 0, max: 32, marks: [0, 8, 16, 24, 32] } as const;
/** The voltmeter as a Dial, for the needle's sums. */
export const VOLT_DIAL: Dial = {
  id: 'volts',
  label: 'VOLTS',
  min: VOLTMETER.min,
  max: VOLTMETER.max,
  marks: VOLTMETER.marks,
  text: String,
};

export type LampId = 'oil' | 'generator' | 'brake';
/**
 * The warning lamps, in a column between the voltmeter and the switches
 * (F1.17): oil pressure and generator, lit with the battery on and the
 * engine stopped; the parking brake's comes with F1.18. Panel x, each
 * one's height from the strip's middle, its label and lit colour.
 */
export const LAMPS: readonly { id: LampId; x: number; y: number; label: string; color: number }[] = [
  { id: 'oil', x: -0.068, y: 0.021, label: 'OIL', color: 0xff3b2a },
  { id: 'generator', x: -0.068, y: 0, label: 'GEN', color: 0xff3b2a },
  { id: 'brake', x: -0.068, y: -0.021, label: 'BRAKE', color: 0xff3b2a },
];
/** A lamp's lens: its radius and how far it stands proud of the strip's face, m. */
export const LAMP = { radius: 0.006, proud: 0.005 } as const;

/** A point on the switch strip (x across, y up from its middle) in panel space. */
export function onSwitchPanel(x: number, y: number, out: [number, number]): [number, number] {
  out[0] = x;
  out[1] = SWITCH_PANEL.y + y;
  return out;
}

/** The vision slit's brow pad and frame in the hood's face (docs/driver-station.md#vision-slit), m. */
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
  for (const gear of LEVER_ORDER) if (Math.abs(angle - GEAR_ANGLES[gear]) <= IN_GEAR) return gear;
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

/**
 * A point in panel space (x right along the face, y up it, z out of it
 * towards the driver) in hull space, into `out`. The face tilts back about
 * its X, then turns about +Y (Three.js: rotation.set(-tilt, yaw, 0, 'YXZ')).
 */
export function panelToHull(p: readonly number[], out: [number, number, number]): [number, number, number] {
  const c = Math.cos(-PANEL.tilt);
  const s = Math.sin(-PANEL.tilt);
  const y = p[1] * c - p[2] * s;
  const z = p[1] * s + p[2] * c;
  const cy = Math.cos(PANEL.yaw);
  const sy = Math.sin(PANEL.yaw);
  out[0] = PANEL.centre[0] + p[0] * cy + z * sy;
  out[1] = PANEL.centre[1] + y;
  out[2] = PANEL.centre[2] - p[0] * sy + z * cy;
  return out;
}
