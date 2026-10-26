/**
 * Spike S2, riding the tank (docs/spikes/s2-riding.md). Engine-free, so it
 * can be unit tested.
 *
 * The tank stays at the origin and the world moves round it by the inverse
 * of the tank's pose (plan decision 4). The driver's play space is fixed to
 * the hull; the gunner's is fixed to the turret basket and turns with it.
 * This file holds the spike's numbers, a scripted route standing in for a
 * driver, a scripted traverse standing in for a gunner, the comfort caps
 * every motion passes through, and where each seat puts the player's rig.
 *
 * Hull space: hull floor at y = 0, the front towards -Z, +X to the right
 * (as in src/sim/cabin.ts). Angles in radians; a positive heading or
 * turret angle turns left (counter-clockwise seen from above), a positive
 * pitch lifts the nose and a positive roll lifts the right side.
 *
 * F1.1 (cabin and seats) and F1.4 (tank drive) replace the blockout sizes
 * and the scripted route; the caps and the vignette level carry over.
 */

import { rng } from './random.js';

const DEG = Math.PI / 180;

/** The hull blockout, m. Roughly a Tiger I's footprint. */
export const HULL = {
  length: 6.2,
  width: 3.3,
  /** Top of the hull sides; below a seated player's eyes, so the open-top cabin shows the world. */
  wallTop: 1.0,
  /** The roof of the closed cabin. */
  roof: 1.75,
  /** Height of the hull floor above the ground under the tracks. */
  clearance: 0.55,
} as const;

/** The turret ring and basket: centre in hull space (x, z) and radius, m. */
export const TURRET = { x: 0, z: 0.1, radius: 0.95, gunHeight: 1.62 } as const;

/** Where each seat puts the player's eyes (x, z), m: the driver's in hull space, front left; the gunner's in turret space, left of the gun. */
export const DRIVER_EYE = [-0.75, -1.95] as const;
export const GUNNER_EYE = [-0.42, -0.4] as const;

/** The vision slits of the closed cabin: height of their middle above the floor and their height, width, m. */
export const SLIT = { y: 1.45, height: 0.2, width: 0.7 } as const;

// Comfort caps (plan 4.10). Every motion of the tank and turret passes through these.
/** Top forward and reverse speed, m/s (35 km/h, high range; 11 km/h back). */
export const MAX_SPEED = 35 / 3.6;
export const MAX_REVERSE = 3;
/** Most the speed changes per second, m/s² (the concept's gentle acceleration). */
export const MAX_ACCEL = 1.0;
/** Fastest the hull turns, and the most its turn rate changes per second. */
export const MAX_YAW_RATE = 15 * DEG;
export const MAX_YAW_ACCEL = 20 * DEG;
/** Most the hull pitches or rolls following the ground, and how quickly it eases there and to the ground's height, s. */
export const MAX_TILT = 4 * DEG;
export const TILT_SECONDS = 0.5;
export const HEIGHT_SECONDS = 0.1;
/** Power traverse: 6°/s at idle to 24°/s at full RPM (Tiger-style); how fast it starts and stops. */
export const TRAVERSE_IDLE = 6 * DEG;
export const TRAVERSE_MAX = 24 * DEG;
export const TRAVERSE_ACCEL = 40 * DEG;

// The comfort vignette's level (0 none, 1 full) from what the eyes see move.
/** Turning of the view (hull, plus the turret for the gunner) that gives a full vignette. */
export const VIGNETTE_FULL_TURN = 20 * DEG;
/** Change of speed that gives a full vignette, m/s². */
export const VIGNETTE_FULL_ACCEL = 1.0;
/** Pitching and rolling together that gives a full vignette. */
export const VIGNETTE_FULL_TILT = 8 * DEG;
/** Steady speed gives a light vignette only: this much at top speed. */
export const VIGNETTE_AT_TOP_SPEED = 0.4;

// The ground. It repeats every TILE metres in x and z, so a route of any
// length stays on it: the world model is drawn three tiles across and moved
// by the tank's position less whole tiles (wrapTile).
export const TILE = 240;
/** Ground waves: amplitude (m) and how many waves fit across a tile in x and z. */
const WAVES: readonly (readonly [amplitude: number, kx: number, kz: number])[] = [
  [0.45, 3, 2],
  [0.3, 2, -5],
  [0.18, -7, 4],
];

/** Ground height at (x, z) in world space, m. Periodic over TILE. */
export function groundHeight(x: number, z: number): number {
  let h = 0;
  const w = (2 * Math.PI) / TILE;
  for (const [a, kx, kz] of WAVES) {
    h += a * Math.sin(w * (kx * x + kz * z));
  }
  return h;
}

/** A world coordinate less whole tiles, in [-TILE/2, TILE/2]. */
export function wrapTile(v: number): number {
  return v - TILE * Math.round(v / TILE);
}

/** What the tank is asked to do: a target speed (m/s, negative backwards) and turn rate (rad/s, positive left). */
export interface TankCommand {
  speed: number;
  yawRate: number;
}

/** The tank's pose in world space and how it is moving. */
export interface TankState {
  x: number;
  /** Height of the hull floor, m. */
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  /** Along the heading, m/s. */
  speed: number;
  /** The speed's change this step, m/s². */
  accel: number;
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  /** How far it has driven, m. */
  odometer: number;
}

export function createTankState(): TankState {
  const y = groundHeight(0, 0) + HULL.clearance;
  return { x: 0, y, z: 0, heading: 0, pitch: 0, roll: 0, speed: 0, accel: 0, yawRate: 0, pitchRate: 0, rollRate: 0, odometer: 0 };
}

/** `value` moved towards `target` by at most `step`. */
export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Half the distance between the track ends sampled for pitch, and between the tracks for roll, m. */
const PITCH_HALF = 2.4;
const ROLL_HALF = 1.4;

/**
 * Advance the tank by `dt` seconds towards `command`, within the comfort
 * caps: speed and turn rate change gently, the hull follows the ground
 * under its track ends, its pitch and roll eased and capped.
 */
export function stepTank(s: TankState, command: TankCommand, dt: number): TankState {
  if (dt <= 0) return s;
  const speedTarget = clamp(command.speed, -MAX_REVERSE, MAX_SPEED);
  const yawTarget = clamp(command.yawRate, -MAX_YAW_RATE, MAX_YAW_RATE);
  const speed = approach(s.speed, speedTarget, MAX_ACCEL * dt);
  s.accel = (speed - s.speed) / dt;
  s.speed = speed;
  s.yawRate = approach(s.yawRate, yawTarget, MAX_YAW_ACCEL * dt);
  s.heading += s.yawRate * dt;
  // Forward is -Z turned by the heading.
  const fx = -Math.sin(s.heading);
  const fz = -Math.cos(s.heading);
  s.x += fx * s.speed * dt;
  s.z += fz * s.speed * dt;
  s.odometer += Math.abs(s.speed) * dt;

  // Right is forward turned a quarter clockwise seen from above.
  const rx = -fz;
  const rz = fx;
  const front = groundHeight(s.x + fx * PITCH_HALF, s.z + fz * PITCH_HALF);
  const back = groundHeight(s.x - fx * PITCH_HALF, s.z - fz * PITCH_HALF);
  const right = groundHeight(s.x + rx * ROLL_HALF, s.z + rz * ROLL_HALF);
  const left = groundHeight(s.x - rx * ROLL_HALF, s.z - rz * ROLL_HALF);
  const ease = 1 - Math.exp(-dt / TILT_SECONDS);
  const pitch = s.pitch + (clamp(Math.atan2(front - back, 2 * PITCH_HALF), -MAX_TILT, MAX_TILT) - s.pitch) * ease;
  const roll = s.roll + (clamp(Math.atan2(right - left, 2 * ROLL_HALF), -MAX_TILT, MAX_TILT) - s.roll) * ease;
  s.pitchRate = (pitch - s.pitch) / dt;
  s.rollRate = (roll - s.roll) / dt;
  s.pitch = pitch;
  s.roll = roll;
  // Height eases faster than the tilt: slow enough to round off a bump, quick enough that the tracks stay on the ground.
  s.y += ((front + back + left + right) / 4 + HULL.clearance - s.y) * (1 - Math.exp(-dt / HEIGHT_SECONDS));
  return s;
}

/**
 * The scripted route, standing in for a driver until F1.4: seconds, target
 * speed (m/s) and turn rate (°/s, positive left). It loops. Every kind of
 * motion a crew will feel is in it: idling, low and high range, gentle and
 * firm turns both ways, a stop and a pivot on the spot, and reversing.
 */
export const ROUTE: readonly (readonly [seconds: number, speed: number, yawDeg: number])[] = [
  [6, 0, 0],
  [20, 12 / 3.6, 0],
  [12, 12 / 3.6, 7.5],
  [20, 25 / 3.6, 0],
  [9, 18 / 3.6, -10],
  [25, MAX_SPEED, 0],
  [10, 15 / 3.6, 0],
  [6, 0, 0],
  [12, 0, 15],
  [8, -2, 0],
  [5, 0, 0],
  [24, 25 / 3.6, -5],
  [15, 18 / 3.6, 0],
];
export const ROUTE_SECONDS = ROUTE.reduce((sum, [seconds]) => sum + seconds, 0);

/** The route's command `t` seconds into the ride. */
export function routeCommand(t: number, out: TankCommand): TankCommand {
  let left = ((t % ROUTE_SECONDS) + ROUTE_SECONDS) % ROUTE_SECONDS;
  for (const [seconds, speed, yawDeg] of ROUTE) {
    if (left < seconds) {
      out.speed = speed;
      out.yawRate = yawDeg * DEG;
      return out;
    }
    left -= seconds;
  }
  out.speed = 0;
  out.yawRate = 0;
  return out;
}

/** The driver's thumbstick as a command: up drives forward, down backs up, sideways turns (pivoting when still). */
export function stickCommand(stickX: number, stickY: number, out: TankCommand): TankCommand {
  const forward = -stickY;
  out.speed = forward >= 0 ? forward * MAX_SPEED : forward * MAX_REVERSE;
  out.yawRate = -stickX * MAX_YAW_RATE;
  return out;
}

/**
 * The scripted traverse, standing in for a gunner until F1.8: seconds and
 * target traverse rate (°/s, positive left). It sums to about zero, so the
 * turret comes back near the front each loop: a slow search left, a quick swing
 * right as if laying on a target, a fine adjustment, and back.
 */
export const SCAN: readonly (readonly [seconds: number, rateDeg: number])[] = [
  [8, 0],
  [10, 9],
  [4, 0],
  [7.5, -24],
  [3, 0],
  [10, 3],
  [6, 0],
  [3.5, 24],
  [5, 0],
  [8, -3],
];
export const SCAN_SECONDS = SCAN.reduce((sum, [seconds]) => sum + seconds, 0);

/** The scan's target traverse rate `t` seconds into the ride, rad/s. */
export function scanRate(t: number): number {
  let left = ((t % SCAN_SECONDS) + SCAN_SECONDS) % SCAN_SECONDS;
  for (const [seconds, rateDeg] of SCAN) {
    if (left < seconds) return rateDeg * DEG;
    left -= seconds;
  }
  return 0;
}

/** The gunner's thumbstick as a traverse rate: right turns right. */
export function stickTraverse(stickX: number): number {
  return -clamp(stickX, -1, 1) * TRAVERSE_MAX;
}

/** The turret's angle on the hull and how fast it is turning. */
export interface TurretState {
  angle: number;
  rate: number;
}

/** Advance the turret by `dt` towards traverse rate `target`, within the power traverse's limits. */
export function stepTurret(s: TurretState, target: number, dt: number): TurretState {
  s.rate = approach(s.rate, clamp(target, -TRAVERSE_MAX, TRAVERSE_MAX), TRAVERSE_ACCEL * dt);
  s.angle += s.rate * dt;
  // Keep it within a turn either way, without a jump in what is drawn.
  if (s.angle > Math.PI) s.angle -= 2 * Math.PI;
  else if (s.angle < -Math.PI) s.angle += 2 * Math.PI;
  return s;
}

/**
 * How strong the comfort vignette should be, 0 to 1, for a view turning at
 * `turnRate` (rad/s), changing speed at `accel` (m/s²), pitching and rolling
 * at `tiltRate` (rad/s) and moving at `speed` (m/s).
 */
export function vignetteLevel(turnRate: number, accel: number, tiltRate: number, speed: number): number {
  return clamp(
    Math.max(
      Math.abs(turnRate) / VIGNETTE_FULL_TURN,
      Math.abs(accel) / VIGNETTE_FULL_ACCEL,
      Math.abs(tiltRate) / VIGNETTE_FULL_TILT,
      (Math.abs(speed) / MAX_SPEED) * VIGNETTE_AT_TOP_SPEED,
    ),
    0,
    1,
  );
}

export type Seat = 'driver' | 'gunner';

/** Where a seat puts the eyes in hull space for turret angle `turret`: `out` gets [x, z]. */
export function seatEye(seat: Seat, turret: number, out: [number, number]): [number, number] {
  if (seat === 'driver') {
    out[0] = DRIVER_EYE[0];
    out[1] = DRIVER_EYE[1];
    return out;
  }
  const c = Math.cos(turret);
  const s = Math.sin(turret);
  out[0] = TURRET.x + GUNNER_EYE[0] * c + GUNNER_EYE[1] * s;
  out[1] = TURRET.z - GUNNER_EYE[0] * s + GUNNER_EYE[1] * c;
  return out;
}

/**
 * Where the player's rig goes so that a head at (`headX`, `headZ`) in the
 * player's own room space, looking `headYaw` round from the room's forward,
 * sits at the seat's eyes facing the seat's way: the hull's front for the
 * driver, the turret's for the gunner. `out` gets [x, z, yaw]. The head's
 * place and heading are taken once, as the player sits down, so the rig
 * then moves only with the seat and the player's own movements still count.
 */
export function rigForSeat(
  seat: Seat,
  turret: number,
  headX: number,
  headZ: number,
  headYaw: number,
  out: [number, number, number],
): [number, number, number] {
  const eye = seatEye(seat, turret, eyeScratch);
  const yaw = (seat === 'gunner' ? turret : 0) - headYaw;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = eye[0] - (headX * c + headZ * s);
  out[1] = eye[1] - (-headX * s + headZ * c);
  out[2] = yaw;
  return out;
}
const eyeScratch: [number, number] = [0, 0];

/** How many trees stand in each tile of ground, and the seed that places them. */
export const TREES_PER_TILE = 70;
const TREE_SEED = 2041;

/**
 * The trees in one tile, tile-local (x, z, height in m), the same on every
 * page and in every realm. The route goes wherever it goes, so a tree in its
 * way sinks into the ground as the tank comes close (treeScale) rather than
 * pass through the hull; F1.4 brings real obstacles.
 */
export const TREE_SPOTS: readonly (readonly [x: number, z: number, height: number])[] = (() => {
  const random = rng(TREE_SEED);
  const spots: [number, number, number][] = [];
  for (let i = 0; i < TREES_PER_TILE; i++) {
    spots.push([(random() - 0.5) * TILE, (random() - 0.5) * TILE, 5 + random() * 6]);
  }
  return spots;
})();

/** Trees closer than this to the tank are gone, and they grow back to full by TREE_FULL, m. */
export const TREE_GONE = 5;
export const TREE_FULL = 14;

/** How big a tree `distance` m from the tank is drawn, 0 to 1. */
export function treeScale(distance: number): number {
  const t = clamp((distance - TREE_GONE) / (TREE_FULL - TREE_GONE), 0, 1);
  return t * t * (3 - 2 * t);
}
