/**
 * The tank's drive (F1.4, docs/tank-drive.md): skid steering, the engine's
 * RPM, the gearbox's ranges and grinds, following the ground and soft bumps
 * against obstacles. A kinematic simulation rather than a physics body
 * (plan decision 3), so it is deterministic, cheap and unit-tested, and
 * every motion passes through the comfort caps (src/sim/comfort.ts).
 * Engine-free: the host runs it (src/systems/drive-system.ts), the guest
 * only draws what the host sends.
 *
 * The tank stays at the origin and the world moves round it by the inverse
 * of the pose here (plan decision 4). World space as in src/sim/terrain.ts;
 * hull space as in src/sim/cabin.ts. Angles in radians: a positive heading
 * or yaw rate turns left (counter-clockwise seen from above), a positive
 * pitch lifts the nose, a positive roll lifts the right side.
 */

import {
  HEIGHT_SECONDS,
  MAX_ACCEL,
  MAX_REVERSE,
  MAX_SPEED,
  MAX_TILT,
  MAX_YAW_ACCEL,
  MAX_YAW_RATE,
  TILT_SECONDS,
} from './comfort.js';
import { GROUND_Y } from './cabin.js';
import { groundHeight, type Obstacle, obstacleDistance, OBSTACLES, wrapTile } from './terrain.js';

/** Height of the hull floor above the ground under the tracks, m. */
export const CLEARANCE = -GROUND_Y;

/**
 * The tank's outline seen from above, hull space, m: the tracks' outer
 * faces and ends (src/scene-assets/cabin.scene-asset.ts draws them there).
 * It is what meets obstacles; the gun overhangs it (F1.8 decides about that).
 */
export const FOOTPRINT = { halfWidth: 1.8, front: -3.0, rear: 2.6 } as const;
/** Distance between the tracks' middles, m: it turns their speed difference into a turn rate. */
export const TRACK_GAUGE = 3.0;
/** Half the tracks' length on the ground, and half the gauge: where the ground is sampled for pitch and roll, m. */
const PITCH_HALF = 2.6;
const ROLL_HALF = TRACK_GAUGE / 2;

/** Gear lever positions: neutral, low range and high range. */
export type Gear = 0 | 1 | 2;
export const NEUTRAL: Gear = 0;
export const LOW: Gear = 1;
export const HIGH: Gear = 2;
/** Each gear's name and top track speed, m/s (plan §4.3: low 0-12 km/h, high 0-35 km/h). */
export const GEARS: readonly { name: string; top: number }[] = [
  { name: 'Neutral', top: 0 },
  { name: 'Low', top: 12 / 3.6 },
  { name: 'High', top: MAX_SPEED },
];

/** Engine RPM: idle, top, and the most the hand throttle raises idle to. */
export const IDLE_RPM = 800;
export const MAX_RPM = 2600;
export const HAND_THROTTLE_RPM = 1600;
/** How quickly the RPM follows the driver's demand, s (the engine's lag). */
export const RPM_SECONDS = 0.6;
/** At idle the tracks speed up at this share of the acceleration cap, rising to all of it at top RPM. */
const IDLE_PULL = 0.35;

/** A tiller further than this from centre while the lever moves grinds the gears: no shift (plan §4.3). */
export const SHIFT_DEADBAND = 0.2;
/** How long the lever must sit in a gear, tillers centred, before the gear engages, s. */
export const SHIFT_SECONDS = 0.35;

/** Most the tank slows for an obstacle ahead, m/s²: a firm but soft stop, never a jolt. */
export const BUMP_DECEL = 3;
/** Closer than this to an obstacle counts as touching it, m. */
const TOUCH = 0.05;
/** A touch faster than this counts as a bump (for the sound and the stats), m/s. */
const BUMP_SPEED = 0.3;

/** The driver's controls: what the guest's page sends the host 45 times a second. */
export interface DriverControls {
  /** Each tiller, -1 (pulled fully back) to 1 (pushed fully forwards): that track's speed as a share of the gear's top. */
  left: number;
  right: number;
  /** Where the gear lever is. */
  gear: Gear;
  /** The hand throttle, 0 (idle) to 1. */
  throttle: number;
}

export function createControls(): DriverControls {
  return { left: 0, right: 0, gear: LOW, throttle: 0 };
}

/** The tank's state: its pose in world space, how it moves, its engine and gearbox. The host sends it 45 times a second. */
export interface TankDrive {
  x: number;
  /** Height of the hull floor, m. */
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  /** Along the heading, m/s. */
  speed: number;
  /** The speed's change, m/s². */
  accel: number;
  yawRate: number;
  pitchRate: number;
  rollRate: number;
  /** Each track's speed along the heading, m/s. */
  leftTrack: number;
  rightTrack: number;
  rpm: number;
  /** The gear engaged (neutral while the lever is between gears or grinding). */
  gear: Gear;
  /** The lever is in a gear but the gears grind: a tiller was off centre. */
  grinding: boolean;
  /** Touching an obstacle. */
  touching: boolean;
  /** How many bumps so far. */
  bumps: number;
  /** How far it has driven, m. */
  odometer: number;
  /** Time the lever has sat in a new gear with the tillers centred, s. */
  shiftTimer: number;
}

/** A tank at rest at (x, z), facing `heading`, on the ground, in low gear. */
export function createTankDrive(x = 0, z = 0, heading = 0): TankDrive {
  const s: TankDrive = {
    x, y: 0, z, heading, pitch: 0, roll: 0,
    speed: 0, accel: 0, yawRate: 0, pitchRate: 0, rollRate: 0,
    leftTrack: 0, rightTrack: 0, rpm: IDLE_RPM, gear: LOW, grinding: false,
    touching: false, bumps: 0, odometer: 0, shiftTimer: 0,
  };
  settle(s);
  return s;
}

/** Put the tank straight onto the ground under it, at rest (a reset, or a test placing it). */
export function settle(s: TankDrive): TankDrive {
  const g = groundUnder(s.x, s.z, s.heading, sample);
  s.pitch = clamp(g.pitch, -MAX_TILT, MAX_TILT);
  s.roll = clamp(g.roll, -MAX_TILT, MAX_TILT);
  s.y = g.height + CLEARANCE;
  s.speed = s.accel = s.yawRate = s.pitchRate = s.rollRate = s.leftTrack = s.rightTrack = 0;
  return s;
}

export function copyTankDrive(from: TankDrive, to: TankDrive): TankDrive {
  Object.assign(to, from);
  return to;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `value` moved towards `target` by at most `step`. */
export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

/**
 * The gearbox, each step: pulling the lever to neutral always works;
 * moving it into a gear with either tiller more than SHIFT_DEADBAND from
 * centre grinds (out of gear, nothing engages) until the tillers come
 * back; with them centred the gear engages after SHIFT_SECONDS.
 */
export function stepGearbox(s: TankDrive, c: DriverControls, dt: number): void {
  if (c.gear === s.gear) {
    s.grinding = false;
    s.shiftTimer = 0;
    return;
  }
  if (c.gear === NEUTRAL) {
    s.gear = NEUTRAL;
    s.grinding = false;
    s.shiftTimer = 0;
    return;
  }
  // The lever has left the old gear: the box is in neutral until the new one engages.
  s.gear = NEUTRAL;
  if (Math.max(Math.abs(c.left), Math.abs(c.right)) > SHIFT_DEADBAND) {
    s.grinding = true;
    s.shiftTimer = 0;
    return;
  }
  s.grinding = false;
  s.shiftTimer += dt;
  if (s.shiftTimer >= SHIFT_SECONDS) {
    s.gear = c.gear;
    s.shiftTimer = 0;
  }
}

/** The RPM the engine heads for: the hand throttle's idle, plus the tillers' demand. */
export function targetRpm(c: DriverControls): number {
  const idle = IDLE_RPM + clamp(c.throttle, 0, 1) * (HAND_THROTTLE_RPM - IDLE_RPM);
  const demand = clamp(Math.max(Math.abs(c.left), Math.abs(c.right)), 0, 1);
  return idle + (MAX_RPM - idle) * demand;
}

/**
 * Advance the tank by `dt` seconds under controls `c`: the gearbox, the
 * RPM, the tracks' speeds within the comfort caps, soft stops at
 * obstacles, and the hull following the ground under its tracks.
 */
export function stepDrive(s: TankDrive, c: DriverControls, dt: number, obstacles: readonly Obstacle[] = OBSTACLES): TankDrive {
  if (dt <= 0) return s;
  stepGearbox(s, c, dt);
  s.rpm += (targetRpm(c) - s.rpm) * (1 - Math.exp(-dt / RPM_SECONDS));

  // What the tillers ask of each track, then of the hull: its speed and turn rate, capped.
  const top = GEARS[s.gear].top;
  const left = clamp(c.left, -1, 1) * top;
  const right = clamp(c.right, -1, 1) * top;
  const speedTarget = clamp((left + right) / 2, -MAX_REVERSE, MAX_SPEED);
  const yawTarget = clamp((right - left) / TRACK_GAUGE, -MAX_YAW_RATE, MAX_YAW_RATE);
  // The engine pulls harder as it revs up; slowing down is always at the full rate.
  const engine = clamp((s.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
  const speeding = Math.abs(speedTarget) > Math.abs(s.speed) && speedTarget * s.speed >= 0;
  const pull = speeding ? IDLE_PULL + (1 - IDLE_PULL) * engine : 1;
  const before = s.speed;
  let speed = approach(s.speed, speedTarget, MAX_ACCEL * pull * dt);
  let yawRate = approach(s.yawRate, yawTarget, MAX_YAW_ACCEL * dt);

  // Obstacles: no part of the outline may close on one faster than it could stop in the gap at BUMP_DECEL.
  const slow = obstacleFactor(s, speed, yawRate, obstacles);
  const wasTouching = s.touching;
  s.touching = slow.touching;
  if (s.touching && !wasTouching && slow.closing > BUMP_SPEED) s.bumps++;
  speed *= slow.factor;
  yawRate *= slow.factor;

  s.accel = (speed - before) / dt;
  s.speed = speed;
  s.yawRate = yawRate;
  s.leftTrack = speed - (yawRate * TRACK_GAUGE) / 2;
  s.rightTrack = speed + (yawRate * TRACK_GAUGE) / 2;
  s.heading += yawRate * dt;
  // Forward is -Z turned by the heading.
  s.x += -Math.sin(s.heading) * speed * dt;
  s.z += -Math.cos(s.heading) * speed * dt;
  s.odometer += Math.abs(speed) * dt;
  pushOut(s, obstacles);

  // Follow the ground: pitch and roll eased and capped, height eased faster.
  const g = groundUnder(s.x, s.z, s.heading, sample);
  const ease = 1 - Math.exp(-dt / TILT_SECONDS);
  const pitch = s.pitch + (clamp(g.pitch, -MAX_TILT, MAX_TILT) - s.pitch) * ease;
  const roll = s.roll + (clamp(g.roll, -MAX_TILT, MAX_TILT) - s.roll) * ease;
  s.pitchRate = (pitch - s.pitch) / dt;
  s.rollRate = (roll - s.roll) / dt;
  s.pitch = pitch;
  s.roll = roll;
  s.y += (g.height + CLEARANCE - s.y) * (1 - Math.exp(-dt / HEIGHT_SECONDS));
  return s;
}

interface GroundSample {
  height: number;
  pitch: number;
  roll: number;
}
const sample: GroundSample = { height: 0, pitch: 0, roll: 0 };

/** The ground under a tank at (x, z) facing `heading`: its mean height under the track ends, and the slope along and across. */
export function groundUnder(x: number, z: number, heading: number, out: GroundSample): GroundSample {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  // Right is forward turned a quarter clockwise seen from above.
  const rx = -fz;
  const rz = fx;
  const front = groundHeight(x + fx * PITCH_HALF, z + fz * PITCH_HALF);
  const back = groundHeight(x - fx * PITCH_HALF, z - fz * PITCH_HALF);
  const right = groundHeight(x + rx * ROLL_HALF, z + rz * ROLL_HALF);
  const left = groundHeight(x - rx * ROLL_HALF, z - rz * ROLL_HALF);
  out.height = (front + back + left + right) / 4;
  out.pitch = Math.atan2(front - back, 2 * PITCH_HALF);
  out.roll = Math.atan2(right - left, 2 * ROLL_HALF);
  return out;
}

/** Points round the footprint's edge, hull space [x, z], about 0.6 m apart: what is tested against obstacles. */
export const OUTLINE: readonly (readonly [number, number])[] = (() => {
  const { halfWidth: w, front, rear } = FOOTPRINT;
  const points: [number, number][] = [];
  const edge = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.6);
    for (let i = 0; i < n; i++) points.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
  };
  edge(-w, front, w, front);
  edge(w, front, w, rear);
  edge(w, rear, -w, rear);
  edge(-w, rear, -w, front);
  return points;
})();
/** Furthest an outline point is from the hull's middle, m. */
const OUTLINE_REACH = Math.max(...OUTLINE.map(([x, z]) => Math.hypot(x, z)));

const normal: [number, number] = [0, 0];
const slowed = { factor: 1, touching: false, closing: 0 };

/**
 * How much to scale the tank's speed and turn rate this step so that no
 * point of its outline closes on an obstacle faster than sqrt(2 · BUMP_DECEL
 * · gap): the tank slows into a soft stop as it reaches one, and can always
 * back or turn away. Also whether it touches one, and the fastest closing speed.
 */
function obstacleFactor(s: TankDrive, speed: number, yawRate: number, obstacles: readonly Obstacle[]): typeof slowed {
  slowed.factor = 1;
  slowed.touching = false;
  slowed.closing = 0;
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  // The hull's velocity, world space.
  const vx = -sn * speed;
  const vz = -c * speed;
  // Only obstacles the tank could reach within a couple of seconds.
  const reach = OUTLINE_REACH + Math.abs(speed) * 2 + Math.abs(yawRate) * OUTLINE_REACH * 2 + 0.5;
  for (const o of obstacles) {
    const dx = wrapTile(o.x - s.x);
    const dz = wrapTile(o.z - s.z);
    if (Math.hypot(dx, dz) > reach + o.r) continue;
    for (const [hx, hz] of OUTLINE) {
      // The point in world space (hull space turned by the heading about +Y), relative to the hull's middle.
      const rx = hx * c + hz * sn;
      const rz = -hx * sn + hz * c;
      const d = obstacleDistance(o, s.x + rx, s.z + rz, normal);
      if (d > reach) continue;
      // The point's velocity: the hull's, plus the turn's (yawRate about +Y moves (rx, rz) along (rz, -rx)).
      const px = vx + yawRate * rz;
      const pz = vz - yawRate * rx;
      const closing = -(px * normal[0] + pz * normal[1]);
      if (d < TOUCH && closing > 0) {
        slowed.touching = true;
        slowed.closing = Math.max(slowed.closing, closing);
      }
      if (closing <= 0) continue;
      const allowed = Math.sqrt(2 * BUMP_DECEL * Math.max(d, 0));
      if (closing > allowed) slowed.factor = Math.min(slowed.factor, allowed / closing);
    }
  }
  return slowed;
}

/** Move the tank out of any obstacle its outline went into (a step's rounding, or a test placing it). */
function pushOut(s: TankDrive, obstacles: readonly Obstacle[]): void {
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  for (const o of obstacles) {
    const dx = wrapTile(o.x - s.x);
    const dz = wrapTile(o.z - s.z);
    if (Math.hypot(dx, dz) > OUTLINE_REACH + o.r + 0.5) continue;
    let deepest = 0;
    let nx = 0;
    let nz = 0;
    for (const [hx, hz] of OUTLINE) {
      const d = obstacleDistance(o, s.x + hx * c + hz * sn, s.z - hx * sn + hz * c, normal);
      if (d < deepest) {
        deepest = d;
        nx = normal[0];
        nz = normal[1];
      }
    }
    if (deepest < 0) {
      s.x -= nx * deepest;
      s.z -= nz * deepest;
    }
  }
}

/** The shortest turn from angle `a` to angle `b`, rad. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * The tank part way, `t` (0 to 1), from state `a` to state `b`: for drawing
 * the host's tank smoothly between its packets. Discrete things (the gear,
 * grinding, touching, bumps) come from `b`.
 */
export function lerpTankDrive(a: TankDrive, b: TankDrive, t: number, out: TankDrive): TankDrive {
  const l = (p: number, q: number) => p + (q - p) * t;
  out.x = l(a.x, b.x);
  out.y = l(a.y, b.y);
  out.z = l(a.z, b.z);
  out.heading = a.heading + angleDelta(a.heading, b.heading) * t;
  out.pitch = l(a.pitch, b.pitch);
  out.roll = l(a.roll, b.roll);
  out.speed = l(a.speed, b.speed);
  out.accel = l(a.accel, b.accel);
  out.yawRate = l(a.yawRate, b.yawRate);
  out.pitchRate = l(a.pitchRate, b.pitchRate);
  out.rollRate = l(a.rollRate, b.rollRate);
  out.leftTrack = l(a.leftTrack, b.leftTrack);
  out.rightTrack = l(a.rightTrack, b.rightTrack);
  out.rpm = l(a.rpm, b.rpm);
  out.odometer = l(a.odometer, b.odometer);
  out.gear = b.gear;
  out.grinding = b.grinding;
  out.touching = b.touching;
  out.bumps = b.bumps;
  out.shiftTimer = b.shiftTimer;
  return out;
}

/**
 * State `s` carried on `seconds` at its speed and turn rate, into `out`:
 * for drawing past the newest packet when the next is late. Only the pose moves.
 */
export function extrapolateTankDrive(s: TankDrive, seconds: number, out: TankDrive): TankDrive {
  copyTankDrive(s, out);
  out.heading = s.heading + s.yawRate * seconds;
  const mid = s.heading + (s.yawRate * seconds) / 2;
  out.x = s.x - Math.sin(mid) * s.speed * seconds;
  out.z = s.z - Math.cos(mid) * s.speed * seconds;
  out.odometer = s.odometer + Math.abs(s.speed) * seconds;
  return out;
}

/** The driver's tillers from a twin-stick pad: each stick's forward push drives its own track, as the real tillers do. */
export function twinStickControls(leftStickY: number, rightStickY: number, out: DriverControls): DriverControls {
  out.left = clamp(-leftStickY, -1, 1);
  out.right = clamp(-rightStickY, -1, 1);
  return out;
}

/** The driver's tillers from keys: `forward` and `turn` each -1, 0 or 1 (turn positive left), mixed as a driver would. */
export function keyControls(forward: number, turn: number, out: DriverControls): DriverControls {
  // Turning on the spot drives the tracks against each other; turning while moving slows the inside track.
  out.left = clamp(forward - turn, -1, 1);
  out.right = clamp(forward + turn, -1, 1);
  return out;
}

/** The tank's speed for the menu and signs: km/h, rounded. */
export function kmh(s: TankDrive): number {
  return Math.round(Math.abs(s.speed) * 3.6);
}
