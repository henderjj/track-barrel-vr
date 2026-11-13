/**
 * The going: what the ground does to the tank beyond the flat (the
 * biathlon's driving challenge, F5.3d, docs/biathlon-driving.md). Hills
 * that need a lower gear and run the tank on downhill, mud it digs into,
 * water that drowns an engine driven in too fast, and tracks thrown off by
 * turning hard at speed. Engine-free numbers and small pure functions;
 * src/sim/tank-drive.ts applies them each step. Accelerations in m/s²
 * along the tank's heading (positive forwards).
 */

import type { Gear } from './gearbox.js';

const DEG = Math.PI / 180;
export const GRAVITY = 9.81;

/**
 * The steepest slope each gear climbs at full throttle (neutral, 1st to
 * 5th, reverse): a Sherman's 30 tons on about 400 hp. Anything steeper
 * slows the tank, and it stops and rolls back unless the driver changes
 * down (the automatic box does that itself) or brakes.
 */
export const GEAR_GRADE: readonly number[] = [0, 25 * DEG, 15 * DEG, 9 * DEG, 5.5 * DEG, 3 * DEG, 15 * DEG];
/** What each gear can push against, m/s²: gravity's share along its steepest slope. */
export const GEAR_PUSH: readonly number[] = GEAR_GRADE.map((a) => GRAVITY * Math.sin(a));
/**
 * The engine holds a tank running on downhill with this share of its
 * gear's push (more in a low gear), the tillers' brakes with up to
 * BRAKE_HOLD more (pulled fully back, or the parking brake): enough for
 * any slope on the course. What neither holds runs the tank on, up to
 * RUN_ON times its gear's top speed.
 */
export const ENGINE_BRAKE = 0.6;
export const BRAKE_HOLD = 3;
export const RUN_ON = 1.15;

/**
 * Mud (the course's south side): it drags at the tracks with MUD_DRAG
 * (too much for 3rd gear: about 8 km/h in 2nd), and a tank pushed hard
 * through it (more than SPIN_DEMAND of the throttle, slower than
 * SPIN_SPEED) spins its tracks and sinks, `sink` rising to 1 over
 * SINK_SECONDS at full throttle, each unit of sink adding SINK_DRAG. Sunk
 * to 1 it is bogged: the tracks can't drive it on, only back out, and
 * backing (or moving faster than FREE_SPEED) frees it over FREE_SECONDS.
 * Out of the mud the sink goes at once.
 */
export const MUD_DRAG = 1.6;
export const SINK_DRAG = 3;
export const SPIN_DEMAND = 0.6;
export const SPIN_SPEED = 2.5;
export const SINK_SECONDS = 5;
export const FREE_SPEED = 2.5;
export const FREE_SECONDS = 3;
/** Water (the ford) drags too. */
export const WATER_DRAG = 0.8;

/**
 * The ford: the hull in water deeper than FORD_DEPTH faster than
 * FORD_SPEED (8 km/h, the manual's) for FORD_SECONDS pushes a bow wave
 * into the engine and drowns it. It won't turn over again for
 * DROWN_SECONDS while the water drains.
 */
export const FORD_SPEED = 8 / 3.6;
export const FORD_DEPTH = 0.25;
export const FORD_SECONDS = 1;
export const DROWN_SECONDS = 12;

/**
 * Thrown tracks: turning, a track is pushed sideways by the turn's
 * sideways acceleration (speed × turn rate) and the slope's lean, more so
 * on mud. Past THROW_WARN the tracks strain (a sign says so); past
 * THROW_LIMIT the strain builds over THROW_SECONDS (faster the further
 * past) and at 1 the outside track comes off its sprocket; below, it
 * eases over RELAX_SECONDS. A thrown track holds the tank like the parking
 * brake while the crew refit it, REFIT_SECONDS.
 */
export const THROW_WARN = 1.5;
export const THROW_LIMIT = 1.9;
export const THROW_SECONDS = 1.2;
export const RELAX_SECONDS = 2.5;
export const REFIT_SECONDS = 40;
/** How much more mud throws a track: a track slides on it. */
export const MUD_SIDE = 1.35;
/** How much of the slope's lean adds to the sideways push. */
export const LEAN_SIDE = 0.5;

/** Which track is off: none, the left or the right. */
export const THROWN_SIDES = ['none', 'left', 'right'] as const;
export type ThrownSide = 0 | 1 | 2;

/**
 * Load from the ground heats the engine (F3.7's heat, from the going too):
 * working against a slope or mud at more than LOAD_EASY of what its gear
 * can push, its strain rises to 1 at all of it, and the coolant heads up
 * to LOAD_HEAT_SHARE of F3.7's STRAIN_HEAT for that.
 */
export const LOAD_EASY = 0.4;
export const LOAD_HEAT_SHARE = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Which way gear `gear` drives the tank: 1 forwards, -1 in reverse, 0 in neutral. */
export function gearDirection(gear: Gear): number {
  // Neutral is gear 0 and reverse gear 6 (src/sim/gearbox.ts, which reads this module).
  return gear === 0 ? 0 : gear === 6 ? -1 : 1;
}

/** The automatic box changes up only while the ground's load is under this share of what the next gear can push: it doesn't hunt on a hill. */
export const UPSHIFT_LOAD = 0.85;

/** What the ground can do to a tank, for `groundPull`. */
export interface GoingInput {
  /** Gravity along the heading, m/s² (positive pulls it forwards: nose down). */
  gravity: number;
  /** Drag from mud or water, m/s², against the motion (or against starting off). */
  drag: number;
  /** The tank's speed now, m/s. */
  speed: number;
  /** Which way the gear drives (gearDirection), and how hard it can push now, m/s². */
  drive: number;
  push: number;
  /** The driver asks the engine for at least this speed: it pushes, not holds. */
  driving: boolean;
  /** How hard the engine and brakes can hold the tank back, m/s². */
  hold: number;
}

/**
 * What of the ground's pull (slope and drag) the engine and brakes can't
 * answer, m/s² along the heading: it slows a climbing tank in too high a
 * gear (and rolls it back once stopped), runs a descending one on, and
 * drags one through mud. The flat-ground drive (the speed heading for the
 * tillers' target) is the rest of the tank's motion.
 */
export function groundPull(g: Readonly<GoingInput>): number {
  const moving = Math.abs(g.speed) > 0.05 ? Math.sign(g.speed) : 0;
  // Moving, the drag is against the motion; standing, it only resists starting off (below).
  const force = g.gravity - moving * g.drag;
  if (force === 0) return 0;
  const way = Math.sign(force);
  let answer = 0;
  // The engine pushes against a pull back along its own way.
  if (g.driving && g.drive === -way) answer += g.push;
  // Holding: against a pull the way it already moves (running on), or any pull at a stand.
  if (moving === way || moving === 0) answer += g.hold;
  if (moving === 0) answer += g.drag;
  return way * Math.max(0, Math.abs(force) - answer);
}

/**
 * How much of its spare pull a tank driving against `against` m/s² (the
 * slope and the drag back along its way) has left to speed up with, 0 to 1.
 */
export function spareShare(against: number, push: number): number {
  if (against <= 0) return 1;
  if (push <= 0) return 0;
  return clamp(1 - against / push, 0, 1);
}

/** The sideways push on the tracks, m/s²: the turn's, the slope's lean's share, more on mud (`mud` 0 to 1 of the tracks on it). */
export function sidePush(speed: number, yawRate: number, roll: number, mud: number): number {
  return (Math.abs(speed * yawRate) + LEAN_SIDE * GRAVITY * Math.abs(Math.sin(roll))) * (1 + (MUD_SIDE - 1) * mud);
}

/** How far past straining a sideways push is: 0 at THROW_WARN, 1 at THROW_LIMIT. */
export function strainOver(push: number): number {
  return (push - THROW_WARN) / (THROW_LIMIT - THROW_WARN);
}

/** The throw strain `dt` s on under sideways push `push`. */
export function stepStrain(strain: number, push: number, dt: number): number {
  const over = strainOver(push);
  if (over > 1) return strain + (dt * over) / THROW_SECONDS;
  return Math.max(0, strain - dt / RELAX_SECONDS);
}

/**
 * The sink `dt` s on: in mud (`mud` of the tracks on it, 0 to 1), spun by
 * `demand` of the throttle forwards at `speed` m/s; going back or quickly
 * frees it; out of the mud it goes.
 */
export function stepSink(sink: number, mud: number, demand: number, speed: number, forwards: boolean, dt: number): number {
  if (mud < 0.3) return 0;
  if (speed < -0.3 || speed > FREE_SPEED) return Math.max(0, sink - dt / FREE_SECONDS);
  if (forwards && demand > SPIN_DEMAND && speed < SPIN_SPEED) return Math.min(1, sink + (dt * demand) / SINK_SECONDS);
  return sink;
}

/** How hard the engine labours against the ground (0 to 1): its load past LOAD_EASY of what its gear can push. */
export function loadStrain(against: number, gear: Gear): number {
  const push = GEAR_PUSH[gear] ?? 0;
  if (push <= 0 || against <= 0) return 0;
  return clamp((against / push - LOAD_EASY) / (1 - LOAD_EASY), 0, 1);
}
