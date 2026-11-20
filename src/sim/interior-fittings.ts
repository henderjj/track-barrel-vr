/**
 * The fittings a Sherman's crew compartment is full of that nobody works in
 * the game (docs/interior.md, "The rest of the compartment"): the
 * transmission and differential in the nose with their brakes and breather
 * pipe, the propeller shaft back to the engine, the driver's pedals and
 * foot plate, the hull's ammunition racks, and in the turret the gun's
 * recoil cylinders, guard and coaxial machine gun, the traverse gearbox and
 * motor, the turret lock and the basket's skirt. Their sizes and places, so
 * the model (src/scene-assets/interior-fittings.ts) and the tests (that they
 * stay clear of every control and of the turning turret) use one set of
 * numbers. Engine-free.
 *
 * Hull space for the hull's, turret space for the turret's and gun space
 * (origin on the trunnions, src/sim/turret.ts) for the gun's, as in
 * src/sim/cabin.ts; m.
 */

import { GUN, HULL, TURRET, TURRET_RING } from './cabin.js';
import { DRIVER_CONTROLS, GEARBOX } from './driver-station.js';

/** The transmission's middle across, between the seats. */
const MIDDLE_X = (GEARBOX.x0 + GEARBOX.x1) / 2;

/**
 * The transmission's case, the hump between the seats (GEARBOX): its
 * half-width at the floor, the top's half-width (its upper edges are
 * chamfered off from `shoulder` up) and the split flange's z, where its
 * front half bolts to its back half, behind the gear lever.
 */
export const TRANSMISSION = {
  x: MIDDLE_X,
  halfWidth: (GEARBOX.x1 - GEARBOX.x0) / 2,
  topHalfWidth: 0.21,
  shoulder: GEARBOX.top - 0.1,
  flangeZ: -1.72,
} as const;

/**
 * The differential's cover against the nose plate, as the ribbed casting
 * in TM 9-754's figure 9: an arch facing the crew, `radius` round its
 * middle at `y`, from the nose plate back to `back`, in front of the gear
 * lever's furthest reach.
 */
export const DIFFERENTIAL = { x: MIDDLE_X, y: 0.45, radius: 0.25, front: HULL.front - 0.01, back: -2.26, ribs: 7 } as const;

/** The steering brakes' drums either side of the differential, along X, and the breather pipe across over it. */
export const BRAKE_DRUMS = { y: 0.3, z: -2.3, radius: 0.13, left: [GEARBOX.x0 - 0.12, GEARBOX.x0], right: [GEARBOX.x1, GEARBOX.x1 + 0.32] } as const;
export const BREATHER = { y: 0.77, z: -2.33, radius: 0.02, x0: GEARBOX.x0 - 0.07, x1: GEARBOX.x1 + 0.2 } as const;

/** The propeller shaft's tunnel along the floor from the transmission's back to the engine's bulkhead. */
export const PROPELLER_SHAFT = { x: MIDDLE_X, y: 0.11, radius: 0.12, from: GEARBOX.z1 - 0.005, to: HULL.rear + 0.02 } as const;

/**
 * The driver's pedals. The clutch, under the left steering lever, hangs
 * from a pivot in a pedal box bolted to the nose plate, as a car's does
 * (John's notes of 20 November 2026: rising from the floor it tipped, or
 * swung down unlike any clutch): its arm drops from the pivot and bends
 * back at a knee to a pad facing the driver, and a push rod from the arm
 * just under the pivot works the clutch's master cylinder, bolted to the
 * nose plate in front of it, its fluid reservoir beside it and its line
 * going down under the foot plate towards the engine's clutch. Pressed, the
 * pad swings forwards about 14 cm and a little down. The accelerator,
 * under the right lever, is a pad hinged at its heel on the plate with its
 * toe up; pressed, its toe goes down. Both pads face the driver, up and
 * back. They move as the game's clutch and accelerator are worked (the
 * left and right triggers, docs/gearbox.md), `travel` rad when pressed
 * fully. Pivots are hull space [y, z]; the clutch's knee and pad are
 * [y, z] from its pivot, at rest. The perforated foot plate they stand
 * on, in front of the seat.
 */
export const PEDALS = {
  /** The clutch: its pad `padTilt` rad back from upright; the push rod's clevis `clevis` m down the arm from the pivot. */
  clutch: {
    x: DRIVER_CONTROLS.tillerLeft.pivot[0] + 0.11,
    width: 0.08,
    length: 0.07,
    pivot: [0.53, -2.28],
    knee: [-0.2, 0.0],
    pad: [-0.33, 0.11],
    padTilt: 1.0,
    travel: 0.44,
    clevis: 0.06,
  },
  /** The accelerator: its pad rising `rise` rad from the floor from its heel's hinge, toe forwards. */
  accelerator: { x: DRIVER_CONTROLS.tillerRight.pivot[0] - 0.1, width: 0.065, length: 0.16, pivot: [0.035, -2.11], rise: 0.78, travel: 0.58 },
  padThickness: 0.014,
} as const;
export type PedalId = 'clutch' | 'accelerator';
export const PEDAL_IDS: readonly PedalId[] = ['clutch', 'accelerator'];

/**
 * The clutch's hydraulics on the nose plate: the master cylinder along Z
 * in line with the push rod (its back end, the rod's way in, at `back`),
 * the pedal box's cheeks either side of the arm from the plate back past
 * the pivot, and the fluid reservoir on the plate beside them.
 */
export const CLUTCH_MASTER = { radius: 0.022, back: -2.34, rod: 0.006 } as const;
/** The clutch's push rod: from 1.2 cm behind the clevis's pin forwards, level, this long, so it stays in the master cylinder from let go to pressed. */
export const CLUTCH_PUSH_ROD = { from: 0.012, length: PEDALS.clutch.pivot[1] - CLUTCH_MASTER.back + 0.005 } as const;
export const PEDAL_BOX = { cheekGap: 0.026, cheek: 0.006, top: 0.6, bottom: 0.49, back: -2.25 } as const;
export const CLUTCH_RESERVOIR = { x: 0.075, y: 0.62, radius: 0.022, height: 0.06 } as const;

/** How far a pedal is turned on its pivot when pressed `press` (0 to 1) of the way, rad. */
export function pedalAngle(id: PedalId, press: number): number {
  return PEDALS[id].travel * Math.min(1, Math.max(0, press));
}

/** A pedal's `rotation.x` pressed `press` of the way: the clutch's pad swings forwards (positive), the accelerator's toe down (negative). */
export function pedalTurn(id: PedalId, press: number): number {
  return id === 'clutch' ? pedalAngle(id, press) : -pedalAngle(id, press);
}

/** How far the accelerator's pad's middle plane stands off the line from its hinge, along the pad's normal. */
export const ACCELERATOR_PAD_LIFT = 0.004;

/**
 * The accelerator's rubber stop under its toe, hull space: `z` its middle, `top` [y, z] the middle of its face, which
 * is tilted `tilt` rad to lie under the pressed pad's underside, `gap` under it (John: the stop must meet the pad).
 */
export const ACCELERATOR_STOP = (() => {
  const a = PEDALS.accelerator;
  const tilt = a.rise - a.travel;
  const along = 0.8 * a.length;
  const under = ACCELERATOR_PAD_LIFT - PEDALS.padThickness / 2;
  const gap = 0.001;
  const y = a.pivot[0] + Math.sin(tilt) * along + Math.cos(tilt) * (under - gap);
  const z = a.pivot[1] - Math.cos(tilt) * along + Math.sin(tilt) * (under - gap);
  return { z, top: [y, z] as const, tilt, gap, radius: 0.014 };
})();

/** A point [y, z] from the clutch's pivot as it stands turned `turn` rad (pedalTurn), hull space [y, z], into `out`. */
export function clutchPoint(p: readonly [number, number], turn: number, out: [number, number]): [number, number] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const [py, pz] = PEDALS.clutch.pivot;
  out[0] = py + p[0] * c - p[1] * s;
  out[1] = pz + p[0] * s + p[1] * c;
  return out;
}

export const FOOT_PLATE = { x0: -0.79, x1: GEARBOX.x0 - 0.02, z0: HULL.front + 0.02, z1: -2.0, top: 0.016 } as const;

/**
 * The hull's ammunition racks either side of the turret basket, between it
 * and the walls (the left one behind the six ready rounds already by the
 * driver): on the right an open rack showing its rounds' bases to the
 * basket, rows × columns, on the left an armoured bin with a lid. Their
 * inner faces stay outside the basket's sweep (`BASKET_SWEEP`).
 */
export const HULL_RACK = { x: 0.92, y0: 0.52, y1: 1.16, z0: -0.45, z1: 0.6, rows: 4, columns: 6 } as const;
export const HULL_BIN = { x: -0.92, y0: 0.515, y1: 1.02, z0: -0.48, z1: 0.62 } as const;
/** How far from the turret's middle anything hanging under the turret's roof line sweeps as it turns (the basket's posts and rail, the power grip's pedestal). */
export const BASKET_SWEEP = 0.885;

/**
 * The 75 mm gun's recoil cylinders on its cradle, gun space: two along the
 * bore over the breech, from inside the turret's front wall back to
 * `back`; their pistons' rods on the recoiling breech run into them from
 * `rodFront` (inside the front wall), so they stay in them at full recoil.
 */
export const RECOIL_CYLINDERS = { x: 0.075, y: GUN.breechHalfHeight + 0.055, radius: 0.04, front: 0.05, back: 0.34, rod: 0.018, rodFront: 0 } as const;

/**
 * The recoil guard on the cradle, gun space: a cage of bars behind the
 * breech on its left, the side the crewman doesn't stand, clear of the
 * breech lever and the casings' fall into the bin.
 */
export const RECOIL_GUARD = { x: -0.34, y0: -0.22, y1: 0.12, z0: 0.3, z1: 0.86, bars: 7 } as const;

/** The coaxial machine gun on the cradle's right, between the breech and the elevating arc, gun space. */
export const COAX = { x: 0.185, y: -0.03, width: 0.055, height: 0.08, front: 0.06, back: 0.5 } as const;

/**
 * The traverse's gearbox behind the traverse crank and its electric motor
 * on top, as figure 13 (turret space): above the turret ring's top, so they
 * may reach past its inner edge.
 */
export const TRAVERSE_GEARBOX = { at: [0.555, 1.64, -0.66], size: [0.13, 0.13, 0.11] } as const;
/**
 * The motor lies along X on the gearbox's right, below the gunner's line of
 * sight to their crew board and above the turret's foot plate, which it
 * reaches over.
 */
export const TRAVERSE_MOTOR = { x0: 0.622, x1: 0.8, y: 1.665, z: -0.675, radius: 0.055 } as const;

/** The turret lock's handwheel on a post by the ring, at the gunner's right knee, turret space. */
export const TURRET_LOCK = { x: 0.82, z: 0.32, y: TURRET_RING.y + TURRET_RING.halfHeight + 0.06, radius: 0.045 } as const;

/** The basket's skirt round its back half, from its floor up `height`. */
export const BASKET_SKIRT = { radius: TURRET.basketRadius + 0.005, thickness: 0.006, height: 0.3 } as const;

/** The pistol port in the turret's left wall, beside the radio, turret space. */
export const PISTOL_PORT = { x: -(TURRET.halfWidth - HULL.wall), y: GUN.y + 0.12, z: 0.3, radius: 0.075 } as const;
