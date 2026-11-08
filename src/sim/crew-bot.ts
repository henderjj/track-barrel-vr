/**
 * The practice crewmate's sums: a bot that plays the second player so one
 * person can test the two-player parts of the game (src/systems/crew-bot-system.ts).
 * Engine-free, so it can be unit tested. Design note: docs/crewmate.md.
 *
 * In the driver's seat it drives a route up and down the range or follows
 * the player's calls (BotDriver); in the gunner's it loads, lays the gun on
 * the nearest range target it hasn't hit yet and fires (loadPlan,
 * traverseDemand, chooseTarget). The system works the real controls with
 * these numbers through scripted hands, so the player sees its hands on
 * the levers, the wheels, the shells and the breech.
 */

import { type Seat, type SeatId, seatToHull } from './cabin.js';
import { type LeverSpec, type TwistSpec, type WheelSpec } from './mechanism.js';
import {
  BREECH_MOUTH,
  gunToTurret,
  LEVER_BLOCKED,
  leverHandle,
  SHELL_LENGTH,
  type Vec3,
} from './loading.js';
import { MAX_SPEED, MAX_YAW_RATE } from './comfort.js';
import type { EngineControlId } from './driver-station.js';
import { CHOKE_COOLANT, CHOKE_HOLD, chokeLevel, type EngineStart, WARM_COOLANT } from './engine.js';
import { TRACK_GAUGE } from './tank-drive.js';
import { BOX_Z, COURSE_PATH, COURSE_START, eastSideAt, FINISH_Z, JOIN, type Path, PENALTY_OWN, PENALTY_PATH } from './course.js';
import { wrapTile } from './terrain.js';

const DEG = Math.PI / 180;

/** Where a seated crewmate rests its hands, from its eyes in its seat's frame: in front, below the chest, m. */
export const REST_HAND = { across: 0.18, below: 0.55, ahead: 0.35 } as const;

/** Where the bot rests its `side` hand in its seat's own frame (turret space for the gunner), written to `out`. */
export function restingHandInSeat(seat: Seat, side: 'left' | 'right', out: Vec3): Vec3 {
  out[0] = seat.eye[0] + (side === 'left' ? -REST_HAND.across : REST_HAND.across);
  out[1] = seat.eye[1] - REST_HAND.below;
  out[2] = seat.eye[2] - REST_HAND.ahead;
  return out;
}

/**
 * Where the bot rests its `side` hand in `seat`, hull space, written to
 * `out`: in front of it at the height of the controls.
 */
export function restingHand(seat: Seat, turretYaw: number, side: 'left' | 'right', out: Vec3): Vec3 {
  return seatToHull(seat, turretYaw, restingHandInSeat(seat, side, out), out);
}

/**
 * How the bot looks about while it sits, at `seconds`: a slow, uneven
 * glance left and right and a little up and down, so the player can see
 * it is there and awake. Writes [yaw, pitch] (rad, from facing the seat's
 * way) to `out`.
 */
export function idleLook(seconds: number, out: [number, number]): [number, number] {
  const tau = Math.PI * 2;
  out[0] = 0.35 * Math.sin((tau * seconds) / 9) + 0.12 * Math.sin((tau * seconds) / 3.7);
  out[1] = -0.1 + 0.08 * Math.sin((tau * seconds) / 6.3);
  return out;
}

/** Move `from` towards `to` by at most `maxStep`, in place; returns the distance left. */
export function stepTowards(from: Vec3, to: readonly number[], maxStep: number): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dy, dz);
  if (d <= maxStep || d === 0) {
    from[0] = to[0];
    from[1] = to[1];
    from[2] = to[2];
    return 0;
  }
  const k = maxStep / d;
  from[0] += dx * k;
  from[1] += dy * k;
  from[2] += dz * k;
  return d - maxStep;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** An angle within (-π, π]. */
function wrap(a: number): number {
  const w = a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  return w <= -Math.PI ? w + 2 * Math.PI : w;
}

// ---------------------------------------------------------------- Calls

/**
 * The calls one crewmate makes to the other (the concept's callout
 * vocabulary, cut down for Phase 1): the gunner's to the driver, the
 * driver's to the gunner, and the gunner's reports. Sent as the reliable
 * event `crew-call`; the other page shows them on a sign, and the
 * practice crewmate does what they say.
 */
export const CREW_CALLS = ['advance', 'halt', 'reverse', 'left', 'right', 'route', 'course', 'fire', 'hold', 'on-the-way', 'target'] as const;
export type CrewCall = (typeof CREW_CALLS)[number];

/** What each call says on the sign. */
export const CALL_WORDS: Readonly<Record<CrewCall, string>> = {
  advance: 'Driver, advance',
  halt: 'Driver, halt',
  reverse: 'Driver, reverse',
  left: 'Driver, left',
  right: 'Driver, right',
  route: 'Driver, drive the route',
  course: 'Driver, drive the course',
  fire: 'Gunner, fire at will',
  hold: 'Gunner, hold fire',
  'on-the-way': 'On the way!',
  target: 'Target!',
};

/** The seat a call is made from: the gunner calls the driver, the driver the gunner. */
export const CALL_FROM: Readonly<Record<CrewCall, SeatId>> = {
  advance: 'gunner',
  halt: 'gunner',
  reverse: 'gunner',
  left: 'gunner',
  right: 'gunner',
  route: 'gunner',
  course: 'gunner',
  fire: 'driver',
  hold: 'driver',
  'on-the-way': 'gunner',
  target: 'gunner',
};

/** A call from the network, or null if it isn't one. */
export function parseCall(raw: unknown): CrewCall | null {
  return typeof raw === 'string' && (CREW_CALLS as readonly string[]).includes(raw) ? (raw as CrewCall) : null;
}

// ---------------------------------------------------------------- Driving

/** How far Left or Right turns the tank, rad. */
export const TURN_STEP = 45 * DEG;
/** Heading errors under this don't steer at a halt, rad. */
const HEADING_DONE = 1 * DEG;
/**
 * How fast it turns for each radian off its heading, 1/s. Gentle, as a
 * driver eases off near the mark: the tank turns a second or so after the
 * hands move (the levers, the network, the turn's own acceleration), and a
 * keener driver would swing past and back.
 */
const TURN_GAIN = 1;
/** Further off than this, the tank stops going forwards and pivots on the spot first, rad. */
const PIVOT_ANGLE = 60 * DEG;
/**
 * The tillers' demand advancing and reversing. The crewmate drives with
 * the automatic box (F1.16), where a tiller's push is a share of the
 * tank's top speed: about 11 km/h forwards, as it drove in low range, and
 * back as fast as reverse goes.
 */
const ADVANCE = 3 / MAX_SPEED;
const REVERSE = -0.6;
/** Within this of a waypoint the tank has arrived, m. */
export const ARRIVED = 3;

/**
 * One leg of a route: where it goes (world x and z), how fast, km/h, and
 * how long it halts there, s. A `through` leg is a point on a curving
 * track (the biathlon course) driven past without slowing: it counts as
 * reached once the tank is level with it, along the track's `heading` there.
 * `label` names a halt for the menu.
 */
export interface RouteLeg {
  x: number;
  z: number;
  kmh: number;
  halt: number;
  through?: boolean;
  heading?: number;
  label?: string;
  /** The race's (F5.3b): which lap this leg is on (-1: the penalty loop's), and what it does there. */
  lap?: number;
  /** A firing line's halt: it waits there while the line is open. The finish: it stays. */
  wait?: 'line' | 'finish';
  /** Where the penalty loop leaves the course: round it if a loop is owed, on otherwise. */
  fork?: boolean;
}

/**
 * The practice route: up the range road at 11 km/h with three firing
 * halts (each with all three targets in front of the gunner, the nearest
 * 50 m off), then back to the start at 30 km/h, round and round. It
 * stays on the road's corridor, where the ground keeps no obstacles.
 */
export const ROUTE: readonly RouteLeg[] = [
  { x: 0, z: -50, kmh: 11, halt: 15 },
  { x: 0, z: -180, kmh: 11, halt: 15 },
  { x: 0, z: -300, kmh: 11, halt: 10 },
  { x: 0, z: -20, kmh: 30, halt: 5 },
];

/** Course legs are this far apart, m, and a through leg is passed this far short of being level with it (so the tank always aims a few metres ahead). */
const COURSE_STEP = 10;
const THROUGH_AHEAD = 4;
/** The crewmate's speeds on the course, km/h: round the loop, coming up to a firing box, and round the penalty loop's tight curves. */
export const COURSE_KMH = { loop: 20, box: 10, penalty: 12 } as const;
/** How long it halts in a firing box, s: time for a gunner to shoot (F5.3b gives the race its own rules). */
export const COURSE_HALT = 15;
/** It slows to COURSE_KMH.box this far before a firing box, m. */
const BOX_SLOW = 40;

/**
 * The crewmate's way round the biathlon course (F5.3a): two laps from the
 * finish line, the first halting in firing box 1 and then driving the
 * penalty loop once, the second halting in firing box 2, and round again.
 * Through legs every COURSE_STEP m along the course's middle line, slowing
 * before each box.
 */
export const COURSE_ROUTE: readonly RouteLeg[] = (() => {
  const legs: RouteLeg[] = [];
  const add = (path: Path, from: number, to: number, kmh: number, slowFrom = Infinity) => {
    const n = Math.max(1, Math.round((to - from) / COURSE_STEP));
    for (let i = 1; i <= n; i++) {
      const s = from + ((to - from) * i) / n;
      const p = path.at(s);
      legs.push({ x: p.x, z: p.z, kmh: s >= slowFrom ? COURSE_KMH.box : kmh, halt: 0, through: true, heading: p.heading });
    }
  };
  const halt = (box: number) => {
    const p = COURSE_PATH.at(eastSideAt(BOX_Z[box]));
    legs.push({ x: p.x, z: p.z, kmh: COURSE_KMH.box, halt: COURSE_HALT, label: `firing box ${box + 1}` });
  };
  const box1 = eastSideAt(BOX_Z[0]);
  const box2 = eastSideAt(BOX_Z[1]);
  const leave = eastSideAt(JOIN.leave);
  const back = eastSideAt(JOIN.back);
  const end = eastSideAt(FINISH_Z);
  // Lap A: round to box 1, halt, on to the penalty loop, once round it, then up to the finish.
  add(COURSE_PATH, 0, box1 - COURSE_STEP, COURSE_KMH.loop, box1 - BOX_SLOW);
  halt(0);
  add(COURSE_PATH, box1, leave, COURSE_KMH.box);
  add(PENALTY_PATH, 0, PENALTY_OWN, COURSE_KMH.penalty);
  add(COURSE_PATH, back, end, COURSE_KMH.loop);
  // Lap B: round to box 2, halt, then straight up past the penalty loop to the finish (the same last legs as lap A's).
  add(COURSE_PATH, 0, box2 - COURSE_STEP, COURSE_KMH.loop, box2 - BOX_SLOW);
  halt(1);
  add(COURSE_PATH, box2, back, COURSE_KMH.box);
  add(COURSE_PATH, back, end, COURSE_KMH.loop);
  return legs;
})();

/** In the race, it halts at least this long in a firing box, s, then waits while the line is open (the gunner's three rounds). */
export const LINE_HALT = 3;

/**
 * The crewmate's way round the biathlon race (F5.3b): from the course's
 * start, three laps; on the first two it halts in that lap's firing box
 * (lap 1 box 1, lap 2 box 2) and waits there while the line is open, then
 * at the penalty loop's fork goes round the loop once for each loop owed;
 * after the third lap it halts past the finish. Through legs every
 * COURSE_STEP m as COURSE_ROUTE's. The penalty loop's legs come last
 * (RACE_LOOP_FIRST on), ending at the fork again.
 */
export const RACE_ROUTE: readonly RouteLeg[] = (() => {
  const legs: RouteLeg[] = [];
  const L = COURSE_PATH.length;
  const add = (path: Path, from: number, to: number, kmh: number, lap: number, slowFrom = Infinity) => {
    const n = Math.max(1, Math.round((to - from) / COURSE_STEP));
    for (let i = 1; i <= n; i++) {
      const s = from + ((to - from) * i) / n;
      const p = path.at(s);
      legs.push({ x: p.x, z: p.z, kmh: s >= slowFrom ? COURSE_KMH.box : kmh, halt: 0, through: true, heading: p.heading, lap });
    }
  };
  const leave = eastSideAt(JOIN.leave);
  const back = eastSideAt(JOIN.back);
  const end = eastSideAt(FINISH_Z);
  for (let lap = 0; lap < BOX_Z.length; lap++) {
    const box = eastSideAt(BOX_Z[lap]);
    // Lap 1 from the start, 10 m short of the line; lap 2 from the line.
    const from = lap === 0 ? eastSideAt(COURSE_START.z) - L : 0;
    add(COURSE_PATH, from, box - COURSE_STEP, COURSE_KMH.loop, lap, box - BOX_SLOW);
    const p = COURSE_PATH.at(box);
    legs.push({ x: p.x, z: p.z, kmh: COURSE_KMH.box, halt: LINE_HALT, label: `firing box ${lap + 1}`, lap, wait: 'line' });
    add(COURSE_PATH, box, leave, COURSE_KMH.box, lap);
    legs[legs.length - 1].fork = true;
    add(COURSE_PATH, leave, end, COURSE_KMH.loop, lap);
  }
  // The last lap, then on past the finish to halt.
  add(COURSE_PATH, 0, L, COURSE_KMH.loop, BOX_Z.length);
  add(COURSE_PATH, 0, 30, COURSE_KMH.box, BOX_Z.length + 1);
  const stop = COURSE_PATH.at(40);
  legs.push({ x: stop.x, z: stop.z, kmh: COURSE_KMH.box, halt: Infinity, label: 'the finish', lap: BOX_Z.length + 1, wait: 'finish' });
  // The penalty loop: round its own track, back onto the course and up to the fork.
  add(PENALTY_PATH, 0, PENALTY_OWN, COURSE_KMH.penalty, -1);
  add(COURSE_PATH, back, leave, COURSE_KMH.box, -1);
  legs[legs.length - 1].fork = true;
  return legs;
})();

/** Where the race route's penalty loop legs start. */
export const RACE_LOOP_FIRST = RACE_ROUTE.findIndex((leg) => leg.lap === -1);

/** What the race tells the crewmate driver (F5.3b), set each frame by its system. */
export interface RaceOrders {
  /** A race is running: the gunner's Course call joins it. */
  on: boolean;
  /** Past the countdown: drive. */
  go: boolean;
  /** Laps counted so far. */
  laps: number;
  /** This lap's firing line is open: wait in its box. */
  hold: boolean;
  /** Penalty loops owed. */
  owed: number;
}

/** The heading that faces from a point towards (dx, dz) further on, rad (0 faces -Z, positive turns left). */
export function headingTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * The tillers for driving at `base` (-1 to 1) while turning by `error`
 * (rad, positive: turn left) where a tiller's full push asks its track for
 * `top` (m/s): the tracks apart so the tank turns at TURN_GAIN times the error,
 * pivoting on the spot when the error is large or the tank should stand.
 */
export function steer(base: number, error: number, top: number, out: { left: number; right: number }): { left: number; right: number } {
  const stand = base === 0 || Math.abs(error) > PIVOT_ANGLE;
  const go = stand ? 0 : base;
  if (stand && Math.abs(error) < HEADING_DONE) {
    out.left = 0;
    out.right = 0;
    return out;
  }
  // The yaw rate is the tracks' difference over the gauge: half of it on each tiller.
  const yawRate = clamp(TURN_GAIN * error, -MAX_YAW_RATE, MAX_YAW_RATE);
  const half = clamp((yawRate * TRACK_GAUGE) / (2 * top), -1, 1);
  // Positive error turns left: the left track slows, the right speeds up.
  out.left = clamp(go - half, -1, 1);
  out.right = clamp(go + half, -1, 1);
  return out;
}

/** What the bot driver wants of its tillers this frame (the automatic box works the gears). */
export interface DriveWish {
  left: number;
  right: number;
}

export function createDriveWish(): DriveWish {
  return { left: 0, right: 0 };
}

/** The tank as the bot driver sees it: where it is, which way it faces, how fast it goes. */
export interface TankView {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/**
 * The bot driver. Following calls (the default): it stands until told to
 * advance or reverse, holding its heading; Left and Right turn it a
 * further 45° (on the spot at a halt); Halt stops it. Drive the route
 * sends it round ROUTE; any other driving call takes it off the route.
 * It drives with the automatic box (F1.16), so it never changes gear itself.
 */
export class BotDriver {
  mode: 'calls' | 'route' | 'course' | 'race' = 'calls';
  motion: 'halt' | 'advance' | 'reverse' = 'halt';
  /** The heading it holds, rad (NaN until it has seen the tank). */
  heading = Number.NaN;
  /** The route leg it drives to, and how long it has left to halt there, s (0: on its way). */
  leg = 0;
  halting = 0;
  /** Waypoints reached so far (on the course, its halts), for the tests. */
  arrivals = 0;
  /** Holding the tank steady for the gun: the firing lamp is lit (F2.5). */
  steady = false;
  /** The race's word (F5.3b), set each frame by its system. */
  readonly orders: RaceOrders = { on: false, go: false, laps: 0, hold: false, owed: 0 };
  /** Penalty loops it has gone round in this race (the tests count them). */
  loopsTaken = 0;
  /** Racing round the penalty loop: the leg to go on from once no loop is owed. */
  private resume = -1;
  private steerOut = { left: 0, right: 0 };
  /** The legs it drives: ROUTE, or COURSE_ROUTE. */
  private legs: readonly RouteLeg[] = ROUTE;
  /** On the course, it starts from the leg nearest the tank once it sees where the tank is. */
  private pickLeg = false;

  /** A call from the gunner. The tank's heading now sets where Left and Right turn from. */
  call(call: CrewCall, tankHeading: number): boolean {
    if (Number.isNaN(this.heading)) this.heading = tankHeading;
    switch (call) {
      case 'advance':
      case 'reverse':
        this.mode = 'calls';
        this.motion = call;
        return true;
      case 'halt':
        this.mode = 'calls';
        this.motion = 'halt';
        return true;
      case 'left':
      case 'right':
        if (this.mode !== 'calls') this.motion = 'halt';
        this.mode = 'calls';
        this.heading = wrap(this.heading + (call === 'left' ? TURN_STEP : -TURN_STEP));
        return true;
      case 'route':
        this.mode = 'route';
        this.legs = ROUTE;
        this.leg = 0;
        this.halting = 0;
        return true;
      case 'course':
        // In a race (F5.3b) it drives the race from where the tank stands.
        if (this.orders.on) {
          this.mode = 'race';
          this.legs = RACE_ROUTE;
          this.resume = -1;
        } else {
          this.mode = 'course';
          this.legs = COURSE_ROUTE;
        }
        this.pickLeg = true;
        this.halting = 0;
        return true;
      default:
        return false;
    }
  }

  /** A race started (F5.3b): from the course's start, round RACE_ROUTE once the countdown is over. */
  startRace(): void {
    this.mode = 'race';
    this.legs = RACE_ROUTE;
    this.leg = 0;
    this.halting = 0;
    this.resume = -1;
    this.loopsTaken = 0;
    this.pickLeg = false;
  }

  /**
   * Step `dt` seconds with the tank as it is; what the tillers should do,
   * into `out`. While `steady` (the firing lamp is lit, F2.5) it holds the
   * tank still for the shot: tillers centred, no turning, and a route's
   * halt doesn't run out; calls heard meanwhile wait until the lamp goes out.
   */
  update(dt: number, tank: TankView, out: DriveWish, steady = false): DriveWish {
    if (Number.isNaN(this.heading)) this.heading = tank.heading;
    this.steady = steady;
    if (steady) {
      out.left = 0;
      out.right = 0;
      return out;
    }
    let base = 0;
    if (this.mode === 'race' && !this.orders.go) {
      // The countdown: it stands on the start line.
      base = 0;
    } else if (this.mode !== 'calls') {
      if (this.pickLeg) this.nearestLeg(tank);
      base = this.followRoute(dt, tank);
    } else {
      base = this.motion === 'advance' ? ADVANCE : this.motion === 'reverse' ? REVERSE : 0;
    }
    steer(base, wrap(this.heading - tank.heading), MAX_SPEED, this.steerOut);
    out.left = this.steerOut.left;
    out.right = this.steerOut.right;
    return out;
  }

  /**
   * The course leg nearest the tank, so it joins the course where it
   * stands. Of two at the same spot it takes the later: parked at the
   * course's start, that is lap B's last legs, so it goes round to box 1
   * first.
   */
  private nearestLeg(tank: TankView): void {
    this.pickLeg = false;
    let best = Infinity;
    this.legs.forEach((leg, i) => {
      // In a race, only this lap's legs.
      if (this.mode === 'race' && leg.lap !== this.orders.laps) return;
      const d = Math.hypot(wrapTile(leg.x - tank.x), wrapTile(leg.z - tank.z));
      if (d <= best + 1e-6) {
        best = d;
        this.leg = i;
      }
    });
  }

  /** On the route: head for the leg's waypoint, slowing as it nears, then halt there a while; a through leg it drives past. Returns the tillers' base demand. */
  private followRoute(dt: number, tank: TankView): number {
    const legs = this.legs;
    if (this.halting > 0) {
      // In a race it waits at a line while the line is open (the gunner's rounds), and at the finish for good.
      const wait = this.mode === 'race' ? legs[this.leg].wait : undefined;
      if (wait === 'finish' || (wait === 'line' && this.orders.hold && this.halting <= dt)) return 0;
      this.halting -= dt;
      if (this.halting <= 0) {
        this.halting = 0;
        this.leg = this.nextLeg(this.leg);
      }
      return 0;
    }
    let leg = legs[this.leg];
    let dx = wrapTile(leg.x - tank.x);
    let dz = wrapTile(leg.z - tank.z);
    // Through legs: on to the next once level with this one (a few legs at most in one frame).
    for (let k = 0; k < 4 && leg.through; k++) {
      const h = leg.heading ?? 0;
      if (dx * -Math.sin(h) + dz * -Math.cos(h) > THROUGH_AHEAD) break;
      this.leg = this.nextLeg(this.leg);
      leg = legs[this.leg];
      dx = wrapTile(leg.x - tank.x);
      dz = wrapTile(leg.z - tank.z);
    }
    if (leg.through) {
      this.heading = headingTo(dx, dz);
      return leg.kmh / 3.6 / MAX_SPEED;
    }
    const distance = Math.hypot(dx, dz);
    if (distance < ARRIVED) {
      this.arrivals++;
      this.halting = Math.max(leg.halt, 1e-3);
      return 0;
    }
    this.heading = headingTo(dx, dz);
    // Slow down in time to stop on the spot: faster legs slow from further out.
    const slowFrom = leg.kmh > 15 ? 50 : 12;
    return (leg.kmh / 3.6 / MAX_SPEED) * clamp(distance / slowFrom, 0.3, 1);
  }

  /** The leg after leg `i`: in a race, at the penalty loop's fork, round the loop while one is owed. */
  private nextLeg(i: number): number {
    const legs = this.legs;
    if (this.mode === 'race' && legs[i].fork) {
      const inLoop = legs[i].lap === -1;
      if (this.orders.owed > 0 && RACE_LOOP_FIRST >= 0) {
        if (!inLoop) this.resume = i + 1;
        else this.loopsTaken++;
        return RACE_LOOP_FIRST;
      }
      if (inLoop) {
        this.loopsTaken++;
        if (this.resume >= 0) return this.resume;
      }
    }
    return (i + 1) % legs.length;
  }

  /** One line for the menu and the tests. */
  describe(): string {
    if (this.steady) return 'holding steady: the gun is ready';
    if (this.mode === 'route') {
      const leg = ROUTE[this.leg];
      const where = `${Math.round(-leg.z)} m up the road`;
      return this.halting > 0 ? `driving the route, halted (${Math.ceil(this.halting)} s)` : `driving the route to ${where}`;
    }
    if (this.mode === 'race') {
      const leg = this.legs[this.leg];
      if (!this.orders.go) return 'racing: waiting for Go';
      if (leg.wait === 'finish' && this.halting > 0) return 'racing: finished';
      if (leg.wait === 'line' && this.halting > 0) return `racing: halted in ${leg.label} for the gunner`;
      if (leg.lap === -1) return `racing: round the penalty loop (${this.orders.owed} owed)`;
      return `racing: lap ${Math.min(this.orders.laps + 1, BOX_Z.length + 1)}`;
    }
    if (this.mode === 'course') {
      const leg = this.legs[this.leg];
      if (this.halting > 0) return `driving the course, halted in ${leg.label ?? 'a box'} (${Math.ceil(this.halting)} s)`;
      return leg.label ? `driving the course to ${leg.label}` : 'driving the course';
    }
    return this.motion === 'halt' ? 'halted' : this.motion === 'advance' ? 'advancing' : 'reversing';
  }
}

// ---------------------------------------------------------------- Starting the engine

/**
 * What the bot driver's left hand does next to start the engine (F1.17),
 * in whichever Engine start setting its page has: press (and let go of) a
 * switch on the instrument box, hold the starter until it fires, or set
 * the hand throttle; null once there is nothing to do and it can drive.
 */
export type StartTask =
  | { kind: 'press'; id: EngineControlId; hold: boolean }
  | { kind: 'throttle'; to: number }
  | { kind: 'choke'; to: 0 | 0.5 | 1 }
  | null;

/** The hand throttle a little open to start on, and at a third (1400 rpm) to warm up. */
export const START_THROTTLE = 0.15;
export const WARM_UP_THROTTLE = 1 / 3;
/** Once it runs, the choke goes half in after CHOKE_HOLD and this much more, s; then right in once the engine is past CHOKE_COOLANT. */
const CHOKE_SPARE = 1.5;

/**
 * The next step of the start-up, from the engine as drawn (`running`,
 * `starterHot`, `coolant`), the bot's own switches and hand throttle, and
 * how long since the engine caught (s). The Full procedure follows the
 * Fort Knox order: battery, ignition, choke out if cold, hand throttle a
 * little open, starter; then the choke eased in (half, then in as the
 * engine warms) and a fast idle until warm.
 */
export function startTask(
  engine: { running: boolean; starterHot: boolean; coolant: number },
  c: { battery: boolean; ignition: boolean; choke: number; throttle: number; start: EngineStart },
  sinceCaught: number,
): StartTask {
  const full = c.start === 'full';
  if (engine.running) {
    if (!full) return null;
    const choke = chokeLevel(c.choke);
    if (choke === 1 && sinceCaught > CHOKE_HOLD + CHOKE_SPARE) return { kind: 'choke', to: 0.5 };
    if (choke === 0.5 && engine.coolant >= CHOKE_COOLANT) return { kind: 'choke', to: 0 };
    if (choke < 1 && engine.coolant < WARM_COOLANT && c.throttle < WARM_UP_THROTTLE - 0.05) return { kind: 'throttle', to: WARM_UP_THROTTLE };
    return null;
  }
  if (full) {
    if (!c.battery) return { kind: 'press', id: 'battery', hold: false };
    if (!c.ignition) return { kind: 'press', id: 'ignition', hold: false };
    const choke = chokeLevel(c.choke);
    if (engine.coolant < CHOKE_COOLANT && choke < 1) return { kind: 'choke', to: 1 };
    if (engine.coolant >= CHOKE_COOLANT && choke > 0) return { kind: 'choke', to: 0 };
    if (c.throttle < START_THROTTLE - 0.1 || c.throttle > START_THROTTLE + 0.25) return { kind: 'throttle', to: START_THROTTLE };
  }
  // A hot starter must rest: wait with the hand off it.
  if (engine.starterHot) return null;
  return { kind: 'press', id: 'starter', hold: true };
}

// ---------------------------------------------------------------- Gunning

/** How the bot lays the gun: how close is laid, and how long it must stay there before firing. */
export const LAY = {
  /** The turret within this of the aim, rad. */
  yawDone: 0.05 * DEG,
  /** The gun within this, rad. */
  elevationDone: 0.03 * DEG,
  /** And barely turning, rad/s. */
  still: 0.05 * DEG,
  /** How quickly the traverse closes the last of the error, 1/s. */
  gain: 1.5,
} as const;

/** The tank must be slower than this for the bot to fire, m/s: it fires from a halt. */
export const FIRE_SPEED = 0.3;

/**
 * The power traverse's demand (-1 right to 1 left) that brings the turret
 * onto `error` (rad, positive: the aim is to the left) turning at `rate`
 * (rad/s) without overshooting: no faster than it can stop in the error at
 * `accel`, nor than `gain` times the error, out of `fullRate` at full twist.
 */
export function traverseDemand(error: number, rate: number, fullRate: number, accel: number): number {
  if (Math.abs(error) < LAY.yawDone && Math.abs(rate) < LAY.still) return 0;
  const stopping = Math.sqrt(2 * accel * Math.abs(error)) * 0.8;
  const wanted = Math.sign(error) * Math.min(fullRate, stopping, Math.abs(error) * LAY.gain);
  return clamp(wanted / fullRate, -1, 1);
}

/** The twist that reads as `demand` on a grip (the inverse of TwistGrip.demand outside its deadband), rad. */
export function twistForDemand(spec: TwistSpec, demand: number): number {
  const d = clamp(demand, -1, 1);
  if (d === 0) return 0;
  return Math.sign(d) * (spec.deadband + Math.abs(d) * (spec.max - spec.deadband));
}

/**
 * The range target the bot lays on: the nearest within `reach` m of the
 * tank (world x and z) that it hasn't
 * hit yet (`done`), or -1. Once it has hit them all it starts again.
 */
export function chooseTarget(x: number, z: number, faces: readonly { x: number; z: number }[], done: readonly boolean[], reach: number): number {
  let best = -1;
  let bestDistance = reach;
  // As aimAt does: the faces stand in the middle tile, so the tank is put there too.
  const tx = wrapTile(x);
  const tz = wrapTile(z);
  for (let i = 0; i < faces.length; i++) {
    if (done[i]) continue;
    const d = Math.hypot(faces[i].x - tx, faces[i].z - tz);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- Hands on the controls

/** Where a hand holds a lever at `angle`: the middle of its handle, lever space. */
export function leverGrip(spec: LeverSpec, angle: number, out: Vec3): Vec3 {
  const r = spec.length - spec.gripLength / 2;
  out[0] = 0;
  out[1] = r * Math.cos(angle);
  out[2] = -r * Math.sin(angle);
  return out;
}

/** A point on a wheel's rim (or its crank's knob, halfway out) at `angle` round the axle, wheel space. */
export function wheelGrip(spec: WheelSpec, angle: number, out: Vec3): Vec3 {
  out[0] = -spec.radius * Math.sin(angle);
  out[1] = spec.radius * Math.cos(angle);
  out[2] = spec.grip === 'crank' ? spec.knobLength / 2 : 0;
  return out;
}

/** A hand's across direction rolled `roll` about a twist grip's handle, twist space (rollOf of it is `roll`). */
export function twistAcross(roll: number, out: Vec3): Vec3 {
  out[0] = Math.cos(roll);
  out[1] = 0;
  out[2] = -Math.sin(roll);
  return out;
}

// ---------------------------------------------------------------- Loading

/** One point on a scripted hand's path: when (s from its start), where (turret space) and whether it squeezes. */
export interface PathKey {
  t: number;
  p: Vec3;
  squeeze: boolean;
}

/** The most keys a loading plan has. */
export const PATH_KEYS = 12;

export function createPath(): PathKey[] {
  const keys: PathKey[] = [];
  for (let i = 0; i < PATH_KEYS; i++) keys.push({ t: 0, p: [0, 0, 0], squeeze: false });
  return keys;
}

/** The loading as the bot reads it before planning its next move. */
export interface BreechView {
  lever: number;
  breechShell: number;
  depth: number;
  rammed: boolean;
  loaded: boolean;
}

/** Where a gripping hand holds a rack shell, from its centre, turret space: near the base (the shells lie nose forwards, -Z). */
const SHELL_GRIP = 0.2;
/** How far past closed the hand pulls the breech lever, so it latches, rad. */
const LEVER_PULL = 1.8;

/**
 * The bot's right hand's next move at the breech, as a path in turret
 * space into `keys`, with the gun at `elevation`: take the rack shell
 * centred at `shell`, swing its nose to the breech mouth, ram it, and pull
 * the lever closed (as spike S4's players did); or, with the breech part
 * done, only the rest of it (push a shell home, close the lever, or open a
 * lever closed on nothing). Ends at `rest`. Returns how many keys it used,
 * 0 when there is nothing to do (loaded, or no shell in the rack).
 */
export function loadPlan(b: BreechView, shell: Readonly<Vec3> | null, elevation: number, rest: Readonly<Vec3>, keys: PathKey[]): number {
  let n = 0;
  const key = (t: number, x: number, y: number, z: number, squeeze: boolean) => {
    const k = keys[n++];
    k.t = t;
    k.p[0] = x;
    k.p[1] = y;
    k.p[2] = z;
    k.squeeze = squeeze;
  };
  const at = (t: number, p: Readonly<Vec3>, squeeze: boolean) => key(t, p[0], p[1], p[2], squeeze);
  const handle = (angle: number, out: Vec3) => gunToTurret(leverHandle(angle, out), elevation, 0, out);
  const a: Vec3 = [0, 0, 0];
  const c: Vec3 = [0, 0, 0];
  if (b.loaded) return 0;
  let t = 0;
  if (b.breechShell < 0 && b.lever > 0.05) {
    // Closed on nothing: open it first.
    at(t, handle(b.lever, a), false);
    at((t += 0.5), a, true);
    at((t += 1.2), handle(0, a), true);
    at((t += 0.4), a, false);
  } else if (b.breechShell >= 0 && !b.rammed && b.lever < LEVER_BLOCKED) {
    // Part-way in: an open hand pushes its base home along the bore.
    gunToTurret([BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] + SHELL_LENGTH - b.depth + 0.04], elevation, 0, a);
    gunToTurret([BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] - 0.06], elevation, 0, c);
    at(t, a, false);
    at((t += 1.2), c, false);
  } else if (b.rammed) {
    at(t, handle(b.lever, a), false);
    at((t += 0.5), a, true);
    at((t += 1.5), handle(LEVER_PULL, a), true);
    at((t += 0.5), a, false);
  } else if (shell !== null) {
    // Held near its base with the hand level: the nose is SHELL_LENGTH / 2 + SHELL_GRIP ahead of the grip.
    const toNose = SHELL_LENGTH / 2 + SHELL_GRIP;
    const grip: Vec3 = [shell[0], shell[1], shell[2] + SHELL_GRIP];
    gunToTurret(BREECH_MOUTH, elevation, 0, c);
    const noseAt = (t: number, dx: number, dy: number, dz: number) => key(t, c[0] + dx, c[1] + dy, c[2] + dz + toNose, true);
    at(t, grip, false);
    at((t += 0.5), grip, true);
    at((t += 0.5), grip, true);
    // Swing the nose to just outside the mouth, onto the bore, then ram it home.
    noseAt((t += 1), 0.25, 0.05, 0.05);
    noseAt((t += 0.8), 0, 0, 0.03);
    noseAt((t += 1.2), 0, 0, -SHELL_LENGTH - 0.03);
    at((t += 0.5), keys[n - 1].p, false);
    // Then the lever, as for a rammed shell.
    at((t += 0.7), handle(0, a), false);
    at((t += 0.5), a, true);
    at((t += 1.5), handle(LEVER_PULL, a), true);
    at((t += 0.5), a, false);
  } else {
    return 0;
  }
  at((t += 0.7), rest, false);
  return n;
}

/**
 * Where a path puts the hand `t` s after its start (moving straight from
 * key to key), into `out`; returns whether it squeezes then: each key's
 * squeeze holds from its time until the next key's.
 */
export function pathAt(keys: readonly PathKey[], count: number, t: number, out: Vec3): boolean {
  if (count === 0) return false;
  let i = 0;
  while (i < count - 1 && keys[i + 1].t <= t) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, count - 1)];
  const span = k1.t - k0.t;
  const f = span > 0 ? clamp((t - k0.t) / span, 0, 1) : 1;
  for (let j = 0; j < 3; j++) out[j] = k0.p[j] + (k1.p[j] - k0.p[j]) * f;
  return k0.squeeze;
}

/** How long a path takes, s. */
export function pathLength(keys: readonly PathKey[], count: number): number {
  return count > 0 ? keys[count - 1].t : 0;
}
