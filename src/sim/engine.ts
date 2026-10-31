/**
 * The engine's start-up and stalls (F1.17, docs/engine.md): the battery
 * and ignition switches, the starter, the choke, warming up from cold and
 * the ways the engine dies. Engine-free: the drive (src/sim/tank-drive.ts)
 * steps it before the gearbox, the host runs the drive, and the driver's
 * station, the sounds and the practice crewmate read its state.
 *
 * How much of this the driver does is the Engine start setting (the
 * menu's Driving section): 'running' starts with the engine running,
 * 'starter' (the default) needs only the starter held, and 'full' is the
 * Fort Knox driving sheet's start-up, shortened: battery switch on,
 * ignition on, the choke out if cold, the hand throttle a little open,
 * the starter held, the choke in once it runs, then a warm-up at about
 * 1300 rpm. With the Clutch any setting can stall: letting the clutch out
 * in too high a gear for the speed bogs the engine and then kills it.
 */

import { clutchEngagement, demandOf, type Gear, type GearboxControls, NEUTRAL } from './gearbox.js';

export { CRANK_RPM } from './gearbox.js';

/** How much of the start-up the driver does (the menu's Engine start row). */
export type EngineStart = 'running' | 'starter' | 'full';
export const ENGINE_STARTS: readonly EngineStart[] = ['running', 'starter', 'full'];
/** Each setting's name for the menu and the signs. */
export const ENGINE_START_NAMES: Readonly<Record<EngineStart, string>> = {
  running: 'Running',
  starter: 'Starter button',
  full: 'Full procedure',
};

export function parseEngineStart(raw: string | null | undefined, fallback: EngineStart): EngineStart {
  return raw === 'running' || raw === 'starter' || raw === 'full' ? raw : fallback;
}

/** The driver's engine controls on the instrument box: switches that stay where they are put, and two buttons held in. */
export interface EngineControls {
  /** The battery (master) switch and the ignition switch: only the Full procedure reads them. */
  battery: boolean;
  ignition: boolean;
  /** The starter button, held in. */
  starter: boolean;
  /**
   * How far the choke knob is pulled out, 0 (in) to 1 (out); the engine
   * reads it as in, half out or out (chokeLevel). Only the Full procedure
   * reads it.
   */
  choke: number;
  /** The siren button, held in: heard on both pages, nothing else. */
  siren: boolean;
  /** How much of the start-up the driver does. */
  start: EngineStart;
}

/**
 * Why the engine last stalled: nothing yet, bogged by the clutch, idling too
 * slowly cold, the choke in too soon, flooded, or the clutch let out against
 * the parking brake (F1.18).
 */
export const STALL_CAUSES = ['none', 'bog', 'cold', 'choke', 'flood', 'brake'] as const;
export type StallCause = (typeof STALL_CAUSES)[number];

/** The engine's part of the tank's state (all of it in TankDrive). */
export interface EngineState {
  /** The engine runs; while it doesn't the tank coasts and the turret has only its hand crank. */
  running: boolean;
  /** The starter is turning the engine over. */
  cranking: boolean;
  /** The battery switch is on (always, but in the Full procedure): the voltmeter and the lamps have power. */
  power: boolean;
  /** It runs unevenly, coughing: choked, or too cold for its idle. */
  rough: boolean;
  /** How long the starter has turned in this press, s; and how long it must rest after overheating, s. */
  crankTime: number;
  starterRest: number;
  /** How long it has run since it caught, s; whether it caught cold (it needs the choke out a while). */
  runTime: number;
  coldStart: boolean;
  /** How long the choke has been out while running, s. */
  chokeTime: number;
  /** How long it has laboured bogged, and idled cold too slowly, s: long enough and it stalls. */
  bogTime: number;
  coldTime: number;
  /** Time since the last cough while rough, s. */
  coughTimer: number;
  /** How many stalls, and coughs, so far (each wraps at 256 in the packet): the signs, stats and sounds count them. */
  stalls: number;
  coughs: number;
  /** Why it last stalled. */
  stallCause: StallCause;
  /** The ignition and battery were both on last step (or didn't need to be): turning one off stops the engine. */
  switchedOn: boolean;
  /** The Engine start setting last step: changed to Running, the engine starts by itself. */
  lastStart: EngineStart;
  /** The gearbox as the starter sees it, and what the engine needs from the drive. */
  gear: Gear;
  rpm: number;
  coolant: number;
  bogging: boolean;
}

/** Air temperature: where a cold engine's coolant starts, °C. */
export const AIR_COOLANT = 15;
/** The coolant is warm from here: the manual's 160 °F. Below it the Full procedure's engine pulls COLD_PULL and needs a fast idle. */
export const WARM_COOLANT = 71;
/** Colder than this, starting needs the choke: without it the engine is slow to fire, and pushing it in too soon kills it. */
export const CHOKE_COOLANT = 40;
/** How long the starter cranks before it catches with the Starter button (and after a stall with Running), s. */
export const CATCH_SECONDS = 1.5;
/** The starter overheats after this long held in, and then won't turn for STARTER_REST, s. */
export const STARTER_LIMIT = 30;
export const STARTER_REST = 15;
/** Started cold, the choke must stay out this long, s; left out this much longer, it floods and stalls. */
export const CHOKE_HOLD = 4;
export const FLOOD_SECONDS = 12;
/** Cold (Full procedure), the engine idles rough below this rpm and stalls after COLD_STALL_SECONDS of it; the hand throttle at a third (1400 rpm) keeps it above. */
export const COLD_IDLE_RPM = 1250;
export const COLD_STALL_SECONDS = 10;
/** Grace after it catches before a slow cold idle counts, s: the revs are still rising. */
const COLD_GRACE = 2.5;
/** How much of its pull a cold engine has (Full procedure). */
export const COLD_PULL = 0.7;
/** Bogged with the clutch out, the engine stalls after this long, plus BOG_STALL_ACCEL per unit of accelerator (more fuel keeps it going longer), s. */
export const BOG_STALL_SECONDS = 1;
export const BOG_STALL_ACCEL = 2;
/** Running rough it coughs this often, s, and each cough knocks this share off the revs. */
export const COUGH_EVERY = 0.9;
const COUGH_DIP = 0.12;
/** The voltmeter: the battery alone, while cranking, and with the generator charging, V. */
export const BATTERY_VOLTS = 24;
export const CRANK_VOLTS = 20;
export const RUNNING_VOLTS = 28;

/** The Full procedure's engine controls all off, as a tank found cold. */
export function createEngineControls(): EngineControls {
  return { battery: false, ignition: false, starter: false, choke: 0, siren: false, start: 'starter' };
}

/**
 * Whether the starter may turn the engine: out of gear, or the clutch held
 * fully down. The automatic box's and Stick shift's clutches are worked for
 * the driver, so they start in gear (the automatic box's lever can't be
 * moved to neutral by hand).
 */
export function startable(s: Pick<EngineState, 'gear'>, c: GearboxControls): boolean {
  return s.gear === NEUTRAL || c.mode !== 'clutch' || clutchEngagement(c.clutch) === 0;
}

/**
 * The choke as the engine reads it: in, half out or out, from how far the
 * knob is pulled (John, 31 October 2026: a WWII choke was a pull knob,
 * pulled out to start and eased in as the engine warmed).
 */
export function chokeLevel(choke: number): 0 | 0.5 | 1 {
  return choke < 0.25 ? 0 : choke < 0.75 ? 0.5 : 1;
}

/** Half out, the choke helps a cold start this much less than fully out, s. */
export const HALF_CHOKE_CATCH = 0.4;

/**
 * How long the starter cranks before the engine fires, s: CATCH_SECONDS,
 * but in the Full procedure 1 to 3 s: slower cold without the choke, and
 * with the hand throttle shut or wide open rather than a little open.
 */
export function catchSeconds(s: Pick<EngineState, 'coolant'>, c: EngineControls & { throttle: number }): number {
  if (c.start !== 'full') return CATCH_SECONDS;
  let t = 1;
  const choke = chokeLevel(c.choke);
  if (s.coolant < CHOKE_COOLANT) t += choke === 0 ? 1.2 : choke === 0.5 ? HALF_CHOKE_CATCH : 0;
  if (c.throttle < 0.05 || c.throttle > 0.7) t += 0.8;
  return t;
}

/** What the voltmeter reads, V: nothing with the battery off, the battery dipping as the starter turns, the generator once it runs. */
export function volts(s: Pick<EngineState, 'power' | 'running' | 'cranking'>): number {
  if (!s.power) return 0;
  return s.running ? RUNNING_VOLTS : s.cranking ? CRANK_VOLTS : BATTERY_VOLTS;
}

/** How much of its pull the engine has: none stopped, COLD_PULL cold in the Full procedure. */
export function enginePullShare(s: Pick<EngineState, 'running' | 'coolant'>, c: Pick<EngineControls, 'start'>): number {
  if (!s.running) return 0;
  return c.start === 'full' && s.coolant < WARM_COOLANT ? COLD_PULL : 1;
}

/** Start the engine at once (Practice shortcuts, the Running setting). */
export function startEngine(s: EngineState): void {
  s.running = true;
  s.cranking = false;
  s.crankTime = 0;
  s.runTime = 0;
  s.coldStart = false;
  s.chokeTime = 0;
  s.bogTime = 0;
  s.coldTime = 0;
  s.coughTimer = 0;
  s.rough = false;
}

/** Stop the engine: switched off (`cause` 'none'), or stalled, counted. */
export function stopEngine(s: EngineState, cause: StallCause = 'none'): void {
  s.running = false;
  s.cranking = false;
  s.rough = false;
  s.runTime = 0;
  s.chokeTime = 0;
  s.bogTime = 0;
  s.coldTime = 0;
  s.coughTimer = 0;
  if (cause !== 'none') {
    s.stalls++;
    s.stallCause = cause;
  }
}

/**
 * The engine `dt` seconds on under the driver's controls: switched off,
 * cranking and catching, running (choked, cold, bogged) or stalling. The
 * revs themselves are the gearbox's (stepRpm), which reads `running` and
 * `cranking`; `bogging` is from the step before.
 */
export function stepEngine(s: EngineState, c: GearboxControls & EngineControls, dt: number): void {
  const full = c.start === 'full';
  s.power = !full || c.battery;
  const keyed = !full || (c.battery && c.ignition);
  // Changed to the Full procedure with the switches off, the engine runs on until one is switched on and off.
  if (full && s.lastStart !== 'full') s.switchedOn = keyed;
  if (c.start === 'running' && s.lastStart !== 'running' && !s.running) startEngine(s);
  s.lastStart = c.start;
  s.starterRest = Math.max(0, s.starterRest - dt);

  if (s.running) {
    if (s.switchedOn && !keyed) stopEngine(s);
    else run(s, c, dt, full);
  }
  s.switchedOn = keyed;

  const turning = c.starter && s.power && !s.running && s.starterRest <= 0 && startable(s, c);
  s.cranking = turning;
  if (!turning) {
    s.crankTime = 0;
    return;
  }
  s.crankTime += dt;
  if (s.crankTime >= STARTER_LIMIT) {
    s.starterRest = STARTER_REST;
    s.crankTime = 0;
    s.cranking = false;
  } else if (keyed && s.crankTime >= catchSeconds(s, c)) {
    const cold = full && s.coolant < CHOKE_COOLANT;
    startEngine(s);
    s.coldStart = cold;
  }
}

/** A step of the engine running: what can kill it, and whether it runs rough. */
function run(s: EngineState, c: GearboxControls & EngineControls, dt: number, full: boolean): void {
  s.runTime += dt;
  s.rough = false;
  if (s.bogging) {
    s.bogTime += dt;
    if (s.bogTime >= BOG_STALL_SECONDS + BOG_STALL_ACCEL * demandOf(c)) {
      stopEngine(s, c.parkingBrake ? 'brake' : 'bog');
      return;
    }
  } else {
    s.bogTime = 0;
  }
  if (full) {
    const needed = s.coldStart ? CHOKE_HOLD : 0;
    const choke = chokeLevel(c.choke);
    if (choke === 1) {
      s.chokeTime += dt;
      if (s.chokeTime > needed) s.rough = true;
      if (s.chokeTime > needed + FLOOD_SECONDS) {
        stopEngine(s, 'flood');
        return;
      }
    } else if (choke === 0.5) {
      // Half out it never floods: it runs smoothly while the engine is cold, and rich (rough) once it is warm enough not to need it.
      s.chokeTime += dt;
      if (s.coolant >= CHOKE_COOLANT) s.rough = true;
    } else {
      // Pushed in too soon on a cold engine, it coughs and dies.
      if (s.coldStart && s.chokeTime > 0 && s.chokeTime < CHOKE_HOLD) {
        s.coughs++;
        stopEngine(s, 'choke');
        return;
      }
      s.chokeTime = 0;
      // Caught cold without the choke: it runs rough a while.
      if (s.coldStart && s.runTime < CHOKE_HOLD) s.rough = true;
    }
    if (s.coolant < WARM_COOLANT && s.rpm < COLD_IDLE_RPM && s.runTime > COLD_GRACE) {
      s.coldTime += dt;
      s.rough = true;
      if (s.coldTime >= COLD_STALL_SECONDS) {
        stopEngine(s, 'cold');
        return;
      }
    } else {
      s.coldTime = 0;
    }
  }
  if (!s.rough) {
    s.coughTimer = 0;
    return;
  }
  s.coughTimer += dt;
  if (s.coughTimer >= COUGH_EVERY) {
    s.coughTimer = 0;
    s.coughs++;
    s.rpm *= 1 - COUGH_DIP;
  }
}
