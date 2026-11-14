/**
 * The tank's drive (F1.4, docs/tank-drive.md): skid steering, the engine's
 * RPM and the gearbox (F1.16, src/sim/gearbox.ts), following the ground and soft bumps
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
  FULL_BUMPS,
  type GroundFeel,
  MAX_ACCEL,
  MAX_SPEED,
  MAX_TILT,
  MAX_YAW_ACCEL,
  MAX_YAW_RATE,
} from './comfort.js';
import { GROUND_Y } from './cabin.js';
import {
  type Gear,
  type GearboxControls,
  demandOf,
  engagement,
  engineSpeed,
  gearCap,
  GEARS,
  IDLE_PULL,
  IDLE_RPM,
  MAX_RPM,
  NEUTRAL,
  pullRate,
  slowRate,
  stepGearbox,
  realControls,
  stepRpm,
  UP_RPM,
} from './gearbox.js';
import {
  AIR_COOLANT,
  type EngineControls,
  enginePullShare,
  type EngineState,
  stepEngine,
  stopEngine,
} from './engine.js';
import { BRIDGE_START, driveHeight, fellOffBridge, goingUnder, waterDepth } from './course.js';
import {
  BRAKE_HOLD,
  DROWN_SECONDS,
  ENGINE_BRAKE,
  FORD_DEPTH,
  FORD_SECONDS,
  FORD_SPEED,
  GEAR_PUSH,
  gearDirection,
  groundPull,
  type GoingInput,
  LOAD_HEAT_SHARE,
  loadStrain,
  MUD_DECEL,
  MUD_DRAG,
  REFIT_SECONDS,
  RUN_ON,
  sidePush,
  SINK_DRAG,
  spareShare,
  stepSink,
  stepStrain,
  type ThrownSide,
  WATER_DRAG,
} from './going.js';
import { type Obstacle, obstacleDistance, OBSTACLES, wrapTile } from './terrain.js';
import { OUTLINE_EXTENT } from './exterior.js';

/** Height of the hull floor above the ground under the tracks, m. */
export const CLEARANCE = -GROUND_Y;

/**
 * The tank's outline seen from above, hull space, m: the sponsons' and
 * tracks' outer faces, the nose and the rear plate (src/sim/exterior.ts;
 * the outside drawn as an M4A4's, docs/exterior.md). It is what meets
 * obstacles; the gun overhangs it (F1.8 decides about that).
 */
export const FOOTPRINT = { halfWidth: OUTLINE_EXTENT.halfWidth, front: OUTLINE_EXTENT.front, rear: OUTLINE_EXTENT.rear } as const;
/** Distance between the tracks' middles, m: it turns their speed difference into a turn rate. */
export const TRACK_GAUGE = 3.0;
/**
 * With a Sherman's controls (Stick shift, Clutch), the radius the tank
 * turns on with one tiller pulled fully back, m: the controlled
 * differential's turn, wider for a tiller part way back.
 */
export const STEER_RADIUS = 7;
/** Half the tracks' length on the ground, and half the gauge: where the ground is sampled for pitch and roll, m. */
const PITCH_HALF = 2.6;
const ROLL_HALF = TRACK_GAUGE / 2;

export {
  GEARS,
  type Gear,
  type GearboxMode,
  HAND_THROTTLE_RPM,
  IDLE_RPM,
  MAX_RPM,
  NEUTRAL,
  REVERSE,
  RPM_SECONDS,
  SHIFT_SECONDS,
  targetRpm,
  TOP_GEAR,
} from './gearbox.js';

/**
 * The engine's gauges (F1.5, docs/driver-station.md). Phase 1 shows them
 * without failures (plan decision 7): the coolant starts at the air's
 * temperature (F1.17; F1.5's started warm, at 55 °C) and while the engine
 * runs warms towards COOLANT_IDLE at idle and COOLANT_FULL at full revs,
 * over WARM_SECONDS rising and COOLANT_SECONDS falling; stopped, it cools
 * to the air over COOL_SECONDS. The fuel burns from full in FUEL_HOURS at
 * full revs (a fifth of that rate at idle) and stops at FUEL_RESERVE;
 * Back to start refuels. The oil pressure follows the revs, a little
 * lower when hot, and falls to nothing as a stopped engine runs down.
 */
export const COOLANT_START = AIR_COOLANT;
export const COOLANT_IDLE = 72;
export const COOLANT_FULL = 92;
export const COOLANT_SECONDS = 150;
export const WARM_SECONDS = 60;
export const COOL_SECONDS = 900;
/**
 * Overheating (F3.7, docs/overheating.md): revved past UP_RPM in a low
 * gear, the engine labours and its coolant heads up to STRAIN_HEAT more
 * than COOLANT_FULL, by GEAR_STRAIN's share for the gear (none in
 * neutral or top), rising over OVERHEAT_SECONDS once past COOLANT_FULL.
 * Changing up or easing off brings it back down over COOLANT_SECONDS.
 */
export const STRAIN_HEAT = 35;
export const GEAR_STRAIN: readonly number[] = [0, 1, 0.7, 0.4, 0.15, 0, 0.6];
export const OVERHEAT_SECONDS = 120;
export const FUEL_HOURS = 2;
export const FUEL_RESERVE = 0.1;
const FUEL_AT_IDLE = 0.2;

/** Most the tank slows for an obstacle ahead, m/s²: a firm but soft stop, never a jolt. */
export const BUMP_DECEL = 3;
/**
 * Rolling on a slope (F1.18): with nothing holding the tank (out of gear,
 * the clutch in or the engine stopped, and no brake on) the ground's slope
 * pulls it downhill at gravity's share along it, up to ROLL_PULL m/s², and
 * the tracks' drag (COAST_DECEL) takes 0.3 of that, so it rolls on slopes
 * steeper than about 2° and at most 0.4 m/s². It rolls no faster than
 * ROLL_TOP, m/s.
 */
export const GRAVITY = 9.81;
export const ROLL_PULL = 0.7;
export const ROLL_TOP = 2.5;

/** Closer than this to an obstacle counts as touching it, m. */
const TOUCH = 0.05;
/** A touch faster than this counts as a bump (for the sound and the stats), m/s. */
const BUMP_SPEED = 0.3;

/**
 * The driver's controls: what the guest's page sends the host 45 times a
 * second. Each tiller is -1 (pulled fully back) to 1 (pushed fully
 * forwards): that track's speed as a share of the top speed under it
 * (tillerTop); the gear lever, the hand throttle, the clutch and how the
 * driver works the gearbox as in GearboxControls; the instrument box's
 * switches and buttons, and how the engine starts, as in EngineControls (F1.17);
 * the parking brake (F1.18) is the gearbox's.
 */
export type DriverControls = GearboxControls & EngineControls;

export function createControls(): DriverControls {
  return {
    left: 0, right: 0, accel: 0, gear: NEUTRAL, throttle: 0, clutch: 0, mode: 'auto',
    battery: false, ignition: false, starter: false, choke: 0, siren: false, start: 'starter', parkingBrake: false,
  };
}

/**
 * The tank's state: its pose in world space, how it moves, its engine and
 * gearbox, and the engine's start-up and stalls (EngineState, F1.17). The
 * host sends it 45 times a second.
 */
export interface TankDrive extends EngineState {
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
  /** The gear engaged (neutral while between gears or grinding), the gear going in, and whether it grinds or the engine bogs (GearboxState). */
  gear: Gear;
  toGear: Gear;
  grinding: boolean;
  bogging: boolean;
  /** Touching an obstacle. */
  touching: boolean;
  /** How many bumps so far. */
  bumps: number;
  /** How far it has driven, m. */
  odometer: number;
  /** Time spent going into `toGear`, s. */
  shiftTimer: number;
  /** The engine's coolant temperature, °C (the driver's gauge, F1.5): warms with the revs, slowly. */
  coolant: number;
  /** Fuel left, 0 (empty) to 1 (full): burnt with the revs, slowly, never below FUEL_RESERVE in Phase 1. */
  fuel: number;
  /** A broken track or the transmission hit (F3.4): the tracks don't turn, as if the parking brake held them. */
  immobile: boolean;
  // The going (F5.3d, src/sim/going.ts).
  /** How far the tracks have dug into mud, 0 to 1 (1: bogged, it only backs out). */
  sink: number;
  /** How close a hard turn has come to throwing a track, 0 to 1 (1 throws it), and the sideways push on the tracks now, m/s². */
  strain: number;
  side: number;
  /** A track thrown (1 left, 2 right; 0 none), held like the parking brake while the crew refit it for `refit` more s. */
  thrown: ThrownSide;
  refit: number;
  /** How long the hull has pushed through the ford too fast, s: FORD_SECONDS drowns the engine. */
  wet: number;
  /** How many times it fell off the bridge (it goes back to BRIDGE_START each time). */
  falls: number;
  /** The ground's load against the way the gear drives, m/s², and how hard that makes the engine labour, 0 to 1 (its heat). */
  against: number;
  load: number;
  /** How much of the tracks is on mud, and in water, now, 0 to 1. */
  mud: number;
  water: number;
}

/** A tank at rest at (x, z), facing `heading`, on the ground, in neutral, its engine running but cold. */
export function createTankDrive(x = 0, z = 0, heading = 0): TankDrive {
  const s: TankDrive = {
    x, y: 0, z, heading, pitch: 0, roll: 0,
    speed: 0, accel: 0, yawRate: 0, pitchRate: 0, rollRate: 0,
    leftTrack: 0, rightTrack: 0, rpm: IDLE_RPM, gear: NEUTRAL, toGear: NEUTRAL, grinding: false, bogging: false,
    touching: false, bumps: 0, odometer: 0, shiftTimer: 0,
    coolant: COOLANT_START, fuel: 1,
    running: true, cranking: false, power: true, rough: false, crankTime: 0, starterRest: 0, runTime: 0, coldStart: false,
    chokeTime: 0, bogTime: 0, coldTime: 0, coughTimer: 0, heatTime: 0, stalls: 0, coughs: 0, stallCause: 'none', switchedOn: true,
    lastStart: 'starter', damage: 0, immobile: false,
    sink: 0, strain: 0, side: 0, thrown: 0, refit: 0, wet: 0, falls: 0, against: 0, load: 0, mud: 0, water: 0,
  };
  settle(s);
  return s;
}

/** Put the tank straight onto the ground under it, at rest (a reset, or a test placing it), taking `feel`'s share of its tilt. */
export function settle(s: TankDrive, feel: GroundFeel = FULL_BUMPS): TankDrive {
  const g = groundUnder(s.x, s.z, s.heading, sample);
  s.pitch = clamp(g.pitch, -MAX_TILT, MAX_TILT) * feel.tilt;
  s.roll = clamp(g.roll, -MAX_TILT, MAX_TILT) * feel.tilt;
  s.y = g.height + CLEARANCE;
  s.speed = s.accel = s.yawRate = s.pitchRate = s.rollRate = s.leftTrack = s.rightTrack = 0;
  return s;
}

export function copyTankDrive(from: TankDrive, to: TankDrive): TankDrive {
  Object.assign(to, from);
  return to;
}

/** The engine's state and its coolant from `from` onto `to` (a tank parked elsewhere keeps its engine as it was). */
export function copyEngine(from: TankDrive, to: TankDrive): TankDrive {
  to.running = from.running;
  to.rpm = from.rpm;
  to.coolant = from.coolant;
  to.power = from.power;
  to.starterRest = from.starterRest;
  to.runTime = from.runTime;
  to.coldStart = from.coldStart;
  to.chokeTime = from.chokeTime;
  to.heatTime = from.heatTime;
  to.stalls = from.stalls;
  to.coughs = from.coughs;
  to.stallCause = from.stallCause;
  to.switchedOn = from.switchedOn;
  to.lastStart = from.lastStart;
  to.damage = from.damage;
  to.immobile = from.immobile;
  return to;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `value` moved towards `target` by at most `step`. */
export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

/**
 * Advance the tank by `dt` seconds under controls `c`: the engine's
 * start-up and stalls (src/sim/engine.ts), the gearbox, the RPM, the tracks' speeds within the comfort caps, soft stops at
 * obstacles, and the hull following the ground under its tracks as `feel`
 * says (all of it, or reduced bumps, src/sim/comfort.ts).
 */
export function stepDrive(
  s: TankDrive,
  c: DriverControls,
  dt: number,
  obstacles: readonly Obstacle[] = OBSTACLES,
  feel: GroundFeel = FULL_BUMPS,
): TankDrive {
  if (dt <= 0) return s;
  if (s.thrown !== 0) {
    // A thrown track (F5.3d): the crew refit it, then it drives again.
    s.refit = Math.max(0, s.refit - dt);
    if (s.refit === 0) {
      s.thrown = 0;
      s.strain = 0;
    }
  }
  if ((s.immobile || s.thrown !== 0) && !c.parkingBrake) {
    // Immobilised (F3.4), or a track off: the tracks held as the parking brake holds them.
    Object.assign(heldControls, c);
    heldControls.parkingBrake = true;
    c = heldControls;
  }
  const g0 = groundUnder(s.x, s.z, s.heading, slopeSample);
  const slope = g0.pitch;
  goingUnder(s.x, s.z, s.heading, going);
  s.mud = going[0];
  s.water = going[1];
  stepEngine(s, c, dt);
  stepGearbox(s, c, dt);
  const enginePull = stepRpm(s, c, dt) * enginePullShare(s, c);

  let speedTarget: number;
  let yawTarget: number;
  if (realControls(c.mode)) {
    // A Sherman's controls: the engine drives the hull through the gear; the tillers only brake. Braking one
    // track through the controlled differential slows that side and speeds the other, turning the tank on a
    // radius (none at a standstill); both back stop it.
    const brakeLeft = clamp(-c.left, 0, 1);
    const brakeRight = clamp(-c.right, 0, 1);
    speedTarget = engineSpeed(s, c) * (1 - Math.min(brakeLeft, brakeRight));
    yawTarget = clamp(((brakeLeft - brakeRight) * s.speed) / STEER_RADIUS, -MAX_YAW_RATE, MAX_YAW_RATE);
  } else {
    // The automatic box: each tiller's push asks its track for a share of the tank's top speed; the hull's
    // speed goes as far as the gear engaged allows (the box changing up as it gets there), its turn by the
    // tracks' difference.
    const left = clamp(c.left, -1, 1) * MAX_SPEED;
    const right = clamp(c.right, -1, 1) * MAX_SPEED;
    const cap = gearCap(s);
    speedTarget = clamp((left + right) / 2, -cap.back, cap.forward);
    yawTarget = clamp((right - left) / TRACK_GAUGE, -MAX_YAW_RATE, MAX_YAW_RATE);
  }
  if (c.parkingBrake) {
    // The parking brake locks the tracks (F1.18): the tank stops, as hard as the comfort cap allows.
    speedTarget = 0;
    yawTarget = 0;
  }
  // Speeding up takes the engine through the gear and the clutch; out of gear the tank coasts.
  // Slowing is the engine holding it back, the tillers braking, or the tracks' drag.
  const speeding = Math.abs(speedTarget) > Math.abs(s.speed) && speedTarget * s.speed >= 0;
  const before = s.speed;
  const engaged = engagement(s, c);
  const coasting = engaged === 0;
  // The going (F5.3d): the slope and the mud or water the engine works against, or that run the tank on.
  const drive = coasting ? 0 : gearDirection(s.gear);
  const demand = demandOf(c);
  const stuck = s.sink >= 1;
  const drag = MUD_DRAG * s.mud + WATER_DRAG * s.water + (s.speed >= 0 ? SINK_DRAG * s.sink : 0);
  const gravity = coasting ? 0 : -GRAVITY * Math.sin(slope);
  const driving = drive !== 0 && speedTarget * drive > 0 && Math.abs(speedTarget) >= Math.abs(s.speed) - 0.05;
  // With the automatic box the engine opens up as far as it takes to hold the tillers' speed; with a Sherman's controls, the driver's throttle.
  const throttle = realControls(c.mode) ? IDLE_PULL + (1 - IDLE_PULL) * demand : 1;
  const push = stuck && drive > 0 ? 0 : (GEAR_PUSH[s.gear] ?? 0) * throttle * engaged * enginePull;
  const against = drive === 0 ? 0 : Math.max(0, -gravity * drive + drag);
  s.against = against;
  s.load = driving && demand > 0.2 ? loadStrain(against, s.gear) : 0;
  const rise = speeding ? pullRate(s, c, enginePull) * (driving ? spareShare(against, push) : 1) : 0;
  let speed = rise > 0
    ? approach(s.speed, speedTarget, rise * dt)
    : approach(s.speed + (coasting ? rollPull(slope, s.speed) * dt : 0), speeding || coasting ? 0 : speedTarget, slowRate(s, c) * dt);
  pullIn.gravity = gravity;
  pullIn.drag = drag;
  pullIn.speed = s.speed;
  pullIn.drive = drive;
  pullIn.push = push;
  pullIn.driving = driving;
  pullIn.hold = (driving || coasting ? 0 : ENGINE_BRAKE * (GEAR_PUSH[s.gear] ?? 0) * engaged) + brakeShare(s, c) * BRAKE_HOLD;
  const pull = groundPull(pullIn);
  if (pull !== 0) {
    // Within the comfort cap on the speed's change (or the flat drive's own, if more); mud may slow it harder (MUD_DECEL).
    const lo = Math.min(speed, before - (s.mud > 0.3 ? MUD_DECEL : MAX_ACCEL) * dt);
    const hi = Math.max(speed, before + MAX_ACCEL * dt);
    speed = clamp(speed + pull * dt, lo, hi);
  }
  if (!coasting) {
    // Run on downhill: the engine over-revs, up to RUN_ON times its gear's top.
    const top = (GEARS[s.gear]?.top ?? MAX_SPEED) * RUN_ON;
    speed = clamp(speed, -top, top);
  }
  if (stuck && drive > 0 && speed > 0) speed = Math.min(speed, before);
  let yawRate = approach(s.yawRate, yawTarget, MAX_YAW_ACCEL * dt);

  // Obstacles: no part of the outline may close on one faster than it could stop in the gap at BUMP_DECEL.
  const slow = obstacleFactor(s, speed, yawRate, dt, obstacles);
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
  const ease = 1 - Math.exp(-dt / feel.tiltSeconds);
  const pitch = s.pitch + (clamp(g.pitch, -MAX_TILT, MAX_TILT) * feel.tilt - s.pitch) * ease;
  const roll = s.roll + (clamp(g.roll, -MAX_TILT, MAX_TILT) * feel.tilt - s.roll) * ease;
  s.pitchRate = (pitch - s.pitch) / dt;
  s.rollRate = (roll - s.roll) / dt;
  s.pitch = pitch;
  s.roll = roll;
  s.y += (g.height + CLEARANCE - s.y) * (1 - Math.exp(-dt / feel.heightSeconds));
  stepGoing(s, demand, drive > 0, dt);
  stepEngineGauges(s, dt);
  return s;
}

/**
 * The going's after-effects, `dt` s on (F5.3d, src/sim/going.ts): the
 * tracks sinking into mud or working free, the strain of a hard turn
 * throwing the outside track, the ford drowning an engine pushed through
 * too fast, and a fall off the bridge putting the tank back at its start.
 */
function stepGoing(s: TankDrive, demand: number, forwards: boolean, dt: number): void {
  s.sink = stepSink(s.sink, s.mud, demand, s.speed, forwards, dt);
  s.side = sidePush(s.speed, s.yawRate, s.roll, s.mud);
  if (s.thrown === 0) {
    s.strain = stepStrain(s.strain, s.side, dt);
    if (s.strain >= 1) {
      // The outside track comes off: the right one turning left.
      s.thrown = s.yawRate > 0 ? 2 : 1;
      s.refit = REFIT_SECONDS;
      s.strain = 1;
    }
  }
  if (waterDepth(s.x, s.z) > FORD_DEPTH && Math.abs(s.speed) > FORD_SPEED) s.wet += dt;
  else s.wet = Math.max(0, s.wet - dt);
  if (s.wet >= FORD_SECONDS) {
    s.wet = 0;
    if (s.running) {
      stopEngine(s, 'water');
      s.starterRest = DROWN_SECONDS;
    }
  }
  if (fellOffBridge(s.x, s.z, s.heading)) {
    s.falls++;
    s.x += wrapTile(BRIDGE_START.x - s.x);
    s.z += wrapTile(BRIDGE_START.z - s.z);
    s.heading = BRIDGE_START.heading;
    s.sink = 0;
    s.strain = 0;
    settle(s);
  }
}

/**
 * How hard the brakes hold, 0 to 1: the parking brake, or the tillers
 * pulled back (with the automatic box, against the motion), as slowRate
 * reads them. The automatic box also holds a tank standing with its
 * tillers at rest, so it doesn't roll back on a hill.
 */
function brakeShare(s: TankDrive, c: DriverControls): number {
  if (c.parkingBrake) return 1;
  if (!realControls(c.mode) && Math.abs(c.left) < 0.05 && Math.abs(c.right) < 0.05 && Math.abs(s.speed) < 0.5) return 1;
  return clamp(s.speed >= 0 || realControls(c.mode) ? -Math.min(c.left, c.right) : Math.max(c.left, c.right), 0, 1);
}

/**
 * The slope's pull along the heading on a tank nothing holds (F1.18), m/s²:
 * downhill (a nose-up `slope` pulls it backwards), capped at ROLL_PULL, and
 * none once it rolls at ROLL_TOP that way. Whatever brakes it (the tracks'
 * drag, a tiller, the parking brake) works against this.
 */
export function rollPull(slope: number, speed: number): number {
  const pull = clamp(-GRAVITY * Math.sin(slope), -ROLL_PULL, ROLL_PULL);
  return pull * speed >= 0 && Math.abs(speed) >= ROLL_TOP ? 0 : pull;
}

/** How hard the engine works, 0 at idle to 1 at top RPM. */
export function engineLoad(rpm: number): number {
  return clamp((rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
}

/** How hard the engine labours (F3.7), 0 to 1: revved past UP_RPM, by the gear's GEAR_STRAIN. */
export function engineStrain(rpm: number, gear: Gear): number {
  return clamp((rpm - UP_RPM) / (MAX_RPM - UP_RPM), 0, 1) * (GEAR_STRAIN[gear] ?? 0);
}

/** Where the coolant heads while the engine runs at `rpm` in `gear`, labouring `load` (0 to 1) against the ground (F5.3d), °C. */
export function coolantTarget(rpm: number, gear: Gear, load = 0): number {
  return COOLANT_IDLE + (COOLANT_FULL - COOLANT_IDLE) * engineLoad(rpm) + STRAIN_HEAT * Math.max(engineStrain(rpm, gear), LOAD_HEAT_SHARE * load);
}

/** The coolant and the fuel, `dt` seconds on at the tank's RPM. */
export function stepEngineGauges(s: TankDrive, dt: number): void {
  if (!s.running) {
    s.coolant += (AIR_COOLANT - s.coolant) * (1 - Math.exp(-dt / COOL_SECONDS));
    return;
  }
  const load = engineLoad(s.rpm);
  // A damaged engine (F3.4) runs hotter: a holed radiator.
  const hot = coolantTarget(s.rpm, s.gear, s.load) + (s.damage === 1 ? LEAK_HEAT : 0);
  const seconds = hot <= s.coolant ? COOLANT_SECONDS : s.coolant >= COOLANT_FULL ? OVERHEAT_SECONDS : WARM_SECONDS;
  s.coolant += (hot - s.coolant) * (1 - Math.exp(-dt / seconds));
  const burn = (FUEL_AT_IDLE + (1 - FUEL_AT_IDLE) * load) / (FUEL_HOURS * 3600);
  s.fuel = Math.max(FUEL_RESERVE, s.fuel - burn * dt);
}

/**
 * The oil pressure for the gauge, bar: about 1.5 at idle and 5 at top RPM,
 * a little lower when the engine runs hot, and lower again overheating
 * (F3.7: down to 0.8 less from 112 °C), falling to nothing below idle.
 */
export function oilPressure(rpm: number, coolant: number): number {
  const thin = clamp((coolant - COOLANT_IDLE) / (COOLANT_FULL - COOLANT_IDLE), 0, 2) * 0.4;
  return (1.5 + 3.5 * engineLoad(rpm) - thin) * clamp(rpm / IDLE_RPM, 0, 1);
}

interface GroundSample {
  height: number;
  pitch: number;
  roll: number;
}
const sample: GroundSample = { height: 0, pitch: 0, roll: 0 };
const slopeSample: GroundSample = { height: 0, pitch: 0, roll: 0 };
const going: [number, number] = [0, 0];
const pullIn: GoingInput = { gravity: 0, drag: 0, speed: 0, drive: 0, push: 0, driving: false, hold: 0 };
/** The controls an immobilised tank steps with: the driver's, its tracks held. */
const heldControls: DriverControls = createControls();

/** A damaged engine's coolant heads this much hotter (F3.4: a holed radiator), °C: at full load it boils over into the red. */
export const LEAK_HEAT = 25;

/** The ground under a tank at (x, z) facing `heading`: its mean height under the track ends, and the slope along and across. */
export function groundUnder(x: number, z: number, heading: number, out: GroundSample): GroundSample {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  // Right is forward turned a quarter clockwise seen from above.
  const rx = -fz;
  const rz = fx;
  // The bridge's deck where it stands over the ground (F5.3d).
  const front = driveHeight(x + fx * PITCH_HALF, z + fz * PITCH_HALF);
  const back = driveHeight(x - fx * PITCH_HALF, z - fz * PITCH_HALF);
  const right = driveHeight(x + rx * ROLL_HALF, z + rz * ROLL_HALF);
  const left = driveHeight(x - rx * ROLL_HALF, z - rz * ROLL_HALF);
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
 * point of its outline closes on an obstacle faster than it could stop in
 * the gap braking at BUMP_DECEL (about sqrt(2 · BUMP_DECEL · gap)): the tank slows into a soft stop as it reaches one, and can always
 * back or turn away. Also whether it touches one, and the fastest closing speed.
 */
function obstacleFactor(s: TankDrive, speed: number, yawRate: number, dt: number, obstacles: readonly Obstacle[]): typeof slowed {
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
      // The fastest it could close and still stop in the gap, braking from the next step on.
      const brake = BUMP_DECEL * dt;
      const allowed = Math.sqrt(brake * brake + 2 * BUMP_DECEL * Math.max(d, 0)) - brake;
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
 * grinding, touching, bumps, the engine's state) come from `b`.
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
  out.coolant = l(a.coolant, b.coolant);
  out.fuel = l(a.fuel, b.fuel);
  out.gear = b.gear;
  out.toGear = b.toGear;
  out.grinding = b.grinding;
  out.bogging = b.bogging;
  out.touching = b.touching;
  out.bumps = b.bumps;
  out.shiftTimer = b.shiftTimer;
  out.running = b.running;
  out.cranking = b.cranking;
  out.power = b.power;
  out.rough = b.rough;
  out.starterRest = b.starterRest;
  out.stalls = b.stalls;
  out.coughs = b.coughs;
  out.stallCause = b.stallCause;
  out.sink = b.sink;
  out.strain = b.strain;
  out.side = b.side;
  out.thrown = b.thrown;
  out.refit = b.refit;
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
