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
 * The driver's pedals, as figure 9: the clutch under the left steering
 * lever and the accelerator under the right, each a pad on an arm hinged
 * at the floor. They don't move: the game's clutch and accelerator are on
 * the levers and the trigger (docs/gearbox.md). The perforated foot plate
 * they stand on, in front of the seat.
 */
export const PEDALS = {
  clutch: { x: DRIVER_CONTROLS.tillerLeft.pivot[0] + 0.11, width: 0.09, length: 0.11 },
  accelerator: { x: DRIVER_CONTROLS.tillerRight.pivot[0] - 0.1, width: 0.065, length: 0.16 },
  hingeZ: -2.12,
  padZ: -2.24,
  padY: 0.17,
} as const;
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
