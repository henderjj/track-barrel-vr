/**
 * The gearbox and the engine's revs (F1.16, docs/gearbox.md): the
 * Sherman's five forward speeds, a clutch, and the three ways of working
 * them a player picks in the menu (Automatic, Stick shift, Clutch).
 * Engine-free: the drive (src/sim/tank-drive.ts) steps it, the host runs
 * the drive, and the driver's station and the practice crewmate read its
 * numbers.
 *
 * Gears are numbered 0 neutral, 1 to 5 forwards and 6 reverse. With the
 * automatic box the tillers drive as before (each one's push its track's
 * speed, both back to reverse). With Stick shift and Clutch the controls
 * work as a Sherman's (John's ask): the right trigger is the accelerator,
 * the engine drives both tracks through the gear, the tillers are only
 * brakes (src/sim/tank-drive.ts steers by them through the controlled
 * differential), and reverse is a gear that goes in only with the tank
 * stopped.
 */

import { MAX_ACCEL, MAX_SPEED } from './comfort.js';

/** A gear: 0 neutral, 1 to 5 the forward speeds, 6 reverse. */
export type Gear = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const NEUTRAL: Gear = 0;
/** The highest forward gear. */
export const TOP_GEAR: Gear = 5;
export const REVERSE: Gear = 6;
/** The gears in the lever's order, back to front: reverse, neutral, 1st to 5th. */
export const LEVER_ORDER: readonly Gear[] = [REVERSE, NEUTRAL, 1, 2, 3, 4, 5];
/** The gear the automatic box pulls away in, and the bot's for the range road: 2nd, as on the flat. */
export const PULL_AWAY: Gear = 2;

/**
 * How the driver works the gearbox (the menu's Gearbox row):
 * - 'auto': it changes gear by itself, the lever moving on its own.
 * - 'stick': the driver picks the gear (the right stick, or the lever by hand); the clutch is worked for them.
 * - 'clutch': the driver squeezes the clutch (the left trigger) to change gear; without it the gears grind,
 *   and letting it out in too high a gear for the speed bogs the engine.
 * Both 'stick' and 'clutch' drive by the accelerator (the right trigger) with the tillers as brakes (realControls).
 */
export type GearboxMode = 'auto' | 'stick' | 'clutch';
export const GEARBOX_MODES: readonly GearboxMode[] = ['auto', 'stick', 'clutch'];
/** Each mode's name for the menu and the signs. */
export const GEARBOX_NAMES: Readonly<Record<GearboxMode, string>> = { auto: 'Automatic', stick: 'Stick shift', clutch: 'Clutch' };

/** Whether the driver drives by the accelerator with the tillers as brakes, as in a Sherman: every mode but the automatic. */
export function realControls(mode: GearboxMode): boolean {
  return mode !== 'auto';
}

export function parseGearbox(raw: string | null | undefined, fallback: GearboxMode): GearboxMode {
  return raw === 'auto' || raw === 'stick' || raw === 'clutch' ? raw : fallback;
}

/** Engine RPM: idle, top, and the most the hand throttle raises idle to. */
export const IDLE_RPM = 800;
export const MAX_RPM = 2600;
export const HAND_THROTTLE_RPM = 1600;
/** How quickly the RPM follows the driver's demand out of gear, s (the engine's lag); in gear it follows the tracks this quickly. */
export const RPM_SECONDS = 0.6;
export const RPM_COUPLED_SECONDS = 0.15;

/**
 * The Sherman's gearbox ratios (1st to 5th) and its reverse ratio
 * (theshermantank.com; docs/gearbox.md). 5th tops out at MAX_SPEED at top
 * RPM, as high range did; the others follow from the ratios.
 */
export const RATIOS: readonly number[] = [0, 7.56, 3.11, 1.78, 1.11, 0.73];
export const REVERSE_RATIO = 5.65;

/** Fastest the tank backs, m/s: what the reverse gear gives at top RPM (about 4.5 km/h). */
export const REVERSE_TOP = (MAX_SPEED * RATIOS[TOP_GEAR]) / REVERSE_RATIO;

/** Each gear's name, short name (the lever's plate) and top track speed at MAX_RPM, m/s (neutral's is 0). */
export const GEARS: readonly { name: string; short: string; top: number }[] = [
  ...RATIOS.map((ratio, gear) => ({
    name: gear === 0 ? 'Neutral' : ['1st', '2nd', '3rd', '4th', '5th'][gear - 1],
    short: gear === 0 ? 'N' : String(gear),
    top: gear === 0 ? 0 : (MAX_SPEED * RATIOS[TOP_GEAR]) / ratio,
  })),
  { name: 'Reverse', short: 'R', top: REVERSE_TOP },
];

/** The next gear along the lever from `gear`, `step` notches forwards (+1) or back (-1), stopping at its ends. */
export function nextGear(gear: Gear, step: number): Gear {
  const i = LEVER_ORDER.indexOf(gear) + Math.sign(step);
  return LEVER_ORDER[Math.max(0, Math.min(LEVER_ORDER.length - 1, i))];
}

/**
 * How hard each gear can pull, as a share of the comfort cap's
 * acceleration (MAX_ACCEL): 1st and 2nd all of it, each gear above less.
 * Softer than the ratios alone so 5th still gets somewhere.
 */
export const GEAR_PULL: readonly number[] = [0, 1, 1, 0.7, 0.5, 0.35, 1];
/** At no throttle the gearbox pulls this share of its gear's pull, rising to all of it at full throttle. */
export const IDLE_PULL = 0.35;

/** Out of gear (the clutch in, neutral, or between gears) the tank slows by itself at this rate, m/s²: tracks drag. */
export const COAST_DECEL = 0.3;

/** How long a gear takes to go in once the lever is in it (and, with the Clutch, the clutch is in), s. */
export const SHIFT_SECONDS = 0.35;
/** A synchromesh gear (2nd to 5th) goes in this quickly with the clutch in, s. */
export const SYNC_SECONDS = 0.2;
/** 1st and reverse have no synchromesh: going into 1st faster than this grinds, m/s. */
export const FIRST_GEAR_SPEED = 0.8;
/** A gear whose top is more than this short of the speed would over-rev the engine: it grinds (Clutch) or waits (Stick shift). */
export const OVER_REV = 1.05;

/** The automatic box changes up above this RPM while the tillers ask for more speed, and down below DOWN_RPM. */
export const UP_RPM = 2250;
export const DOWN_RPM = 1100;

/** The clutch pedal (0 up, 1 fully down): fully engaged at or below CLUTCH_BITE, free at or above CLUTCH_FREE, slipping between. */
export const CLUTCH_BITE = 0.2;
export const CLUTCH_FREE = 0.8;
/** With the clutch fully out, the tracks turning the engine slower than this bogs it: it labours and barely pulls. */
export const BOG_RPM = 500;
/** What the engine turns at while bogged, and how much of its pull it keeps. */
export const BOGGED_RPM = 450;
export const BOG_PULL = 0.15;
/** Stick shift's clutch opens with the accelerator released below this share of the idle's track speed, so the tank stops rather than creeps. */
export const STICK_CREEP = 1.1;
/** With a Sherman's controls, the engine holds the tank back with the accelerator released at this share of the braking cap (the tillers brake harder). */
export const ENGINE_HOLD = 0.4;
/** While the automatic or stick-shift clutch slips pulling away, the engine runs at the demand's RPM up to this. */
export const LAUNCH_RPM = 1400;

/** The driver's controls as the gearbox and the engine see them (src/sim/tank-drive.ts drives by the same). */
export interface GearboxControls {
  /** Each tiller, -1 (pulled fully back) to 1 (pushed fully forwards). */
  left: number;
  right: number;
  /** The accelerator, 0 (released) to 1 (floored): the right trigger. Only Stick shift and Clutch read it. */
  accel: number;
  /** Where the gear lever is (ignored by the automatic box). */
  gear: Gear;
  /** The hand throttle, 0 to 1. */
  throttle: number;
  /** The clutch pedal, 0 (up, engaged) to 1 (fully down): only the Clutch mode reads it. */
  clutch: number;
  /** How the driver works the gearbox. */
  mode: GearboxMode;
}

/** The gearbox's part of the tank's state. */
export interface GearboxState {
  /** Along the heading, m/s. */
  speed: number;
  rpm: number;
  /** The gear engaged (neutral while between gears or grinding). */
  gear: Gear;
  /** The gear going in (0 when none). Steering keeps that gear's feel while it does. */
  toGear: Gear;
  /** The lever is in a gear the box won't take: the gears grind (Clutch only). */
  grinding: boolean;
  /** The clutch is fully out and the tracks turn the engine too slowly: it labours (Clutch only). */
  bogging: boolean;
  /** Time spent going into `toGear`, s. */
  shiftTimer: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The engine's RPM at `speed` (m/s) in `gear`, with the clutch fully out. */
export function wheelRpm(speed: number, gear: Gear): number {
  return gear === NEUTRAL ? 0 : (Math.abs(speed) / GEARS[gear].top) * MAX_RPM;
}

/** How far the driver asks for power, 0 to 1: the accelerator, or with the automatic box the tiller pushed furthest either way. */
export function demandOf(c: GearboxControls): number {
  if (realControls(c.mode)) return clamp(c.accel, 0, 1);
  return clamp(Math.max(Math.abs(c.left), Math.abs(c.right)), 0, 1);
}

/** The RPM the engine heads for out of gear: the hand throttle's idle, plus the driver's demand. */
export function targetRpm(c: GearboxControls): number {
  const idle = IDLE_RPM + clamp(c.throttle, 0, 1) * (HAND_THROTTLE_RPM - IDLE_RPM);
  return idle + (MAX_RPM - idle) * demandOf(c);
}

/** How fully the clutch connects the engine to the tracks, 0 (free) to 1 (engaged), from the pedal. */
export function clutchEngagement(pedal: number): number {
  return clamp((CLUTCH_FREE - pedal) / (CLUTCH_FREE - CLUTCH_BITE), 0, 1);
}

/**
 * How much of the engine reaches the tracks now, 0 to 1: nothing in
 * neutral or between gears, the pedal's share with the Clutch, and with
 * Stick shift all of it unless the tank crawls slower than the engine
 * idles with the accelerator released (its clutch is worked for the
 * driver, so the tank doesn't creep); all of it with the automatic box.
 */
export function engagement(s: GearboxState, c: GearboxControls): number {
  if (s.gear === NEUTRAL) return 0;
  if (c.mode === 'clutch') return clutchEngagement(c.clutch);
  if (c.mode === 'stick' && demandOf(c) < 0.02 && wheelRpm(s.speed, s.gear) < IDLE_RPM * STICK_CREEP) return 0;
  return 1;
}

/** Reverse goes in only with the tank stopped: slower than this, m/s. */
export const REVERSE_GEAR_SPEED = 0.15;

/** Whether `gear` can go in at `speed` without over-revving the engine (1st also needs the tank all but stopped, reverse stopped). */
export function gearFits(gear: Gear, speed: number): boolean {
  if (gear === NEUTRAL) return true;
  if (gear === REVERSE) return Math.abs(speed) <= REVERSE_GEAR_SPEED;
  if (gear === 1 && Math.abs(speed) > FIRST_GEAR_SPEED) return false;
  return Math.abs(speed) <= GEARS[gear].top * OVER_REV;
}

/** Start going into `gear` (out of the old one at once). */
function beginShift(s: GearboxState, gear: Gear): void {
  s.gear = NEUTRAL;
  s.toGear = gear;
  s.shiftTimer = 0;
}

/** Carry on going into `toGear`; true once it is in. */
function finishShift(s: GearboxState, dt: number, seconds: number): boolean {
  s.shiftTimer += dt;
  if (s.shiftTimer < seconds) return false;
  s.gear = s.toGear;
  s.toGear = NEUTRAL;
  s.shiftTimer = 0;
  return true;
}

/**
 * The gearbox, each step, by the driver's mode:
 * - Automatic: pulls away in 2nd; changes up above UP_RPM while the tillers
 *   ask for more speed, down below DOWN_RPM; each change takes SHIFT_SECONDS
 *   out of gear, coasting. It never grinds.
 * - Stick shift: the lever's gear goes in after SHIFT_SECONDS out of gear;
 *   one that would over-rev the engine (or reverse on the move) waits until
 *   the tank has slowed.
 * - Clutch: neutral goes in at any time; a gear goes in after SYNC_SECONDS
 *   with the clutch in, if it fits the speed. Without the clutch, or into
 *   1st on the move or reverse before stopping, or too low a gear for the
 *   speed, it grinds: out of gear until the clutch goes in and the tank
 *   has slowed enough (or the lever comes back).
 */
export function stepGearbox(s: GearboxState, c: GearboxControls, dt: number): void {
  s.grinding = false;
  if (c.mode === 'auto') {
    stepAutomatic(s, c, dt);
    return;
  }
  const asked = c.gear;
  if (asked === s.gear) {
    s.toGear = NEUTRAL;
    s.shiftTimer = 0;
    return;
  }
  if (asked === NEUTRAL) {
    s.gear = NEUTRAL;
    s.toGear = NEUTRAL;
    s.shiftTimer = 0;
    return;
  }
  if (s.toGear !== asked) beginShift(s, asked);
  else s.gear = NEUTRAL;
  if (c.mode === 'stick') {
    // The clutch is worked for the driver; a gear too low for the speed waits for the tank to slow.
    if (!gearFits(asked, s.speed)) {
      s.shiftTimer = 0;
      return;
    }
    finishShift(s, dt, SHIFT_SECONDS);
    return;
  }
  if (clutchEngagement(c.clutch) > 0 || !gearFits(asked, s.speed)) {
    s.grinding = true;
    s.shiftTimer = 0;
    return;
  }
  finishShift(s, dt, SYNC_SECONDS);
}

function stepAutomatic(s: GearboxState, c: GearboxControls, dt: number): void {
  if (s.toGear !== NEUTRAL) {
    finishShift(s, dt, SHIFT_SECONDS);
    return;
  }
  if (s.gear === NEUTRAL) {
    beginShift(s, PULL_AWAY);
    return;
  }
  const rpm = wheelRpm(s.speed, s.gear);
  const wantsMore = demandOf(c) > 0.05 && Math.abs(speedAsked(c)) > Math.abs(s.speed) + 0.05;
  if (s.gear < TOP_GEAR && rpm > UP_RPM && wantsMore && s.speed > 0) {
    beginShift(s, (s.gear + 1) as Gear);
  } else if (s.gear > PULL_AWAY && rpm < DOWN_RPM) {
    beginShift(s, (s.gear - 1) as Gear);
  }
}

/** The hull speed the automatic box's tillers ask for, m/s: a share of the tank's top speed. */
function speedAsked(c: GearboxControls): number {
  return ((clamp(c.left, -1, 1) + clamp(c.right, -1, 1)) / 2) * MAX_SPEED;
}

/**
 * With the automatic box, the fastest the engine can drive the hull in the
 * gear engaged, forwards and back, m/s (0 in neutral): a forward gear backs
 * too, at up to REVERSE_TOP, as the tillers ask.
 */
export function gearCap(s: GearboxState): { forward: number; back: number } {
  cap.forward = GEARS[s.gear].top;
  cap.back = Math.min(cap.forward, REVERSE_TOP);
  return cap;
}
const cap = { forward: 0, back: 0 };

/**
 * With the accelerator (Stick shift, Clutch): the hull speed the engine
 * drives at, m/s, if nothing slows it: its RPM for the accelerator and the
 * hand throttle, through the gear engaged (negative in reverse; 0 in
 * neutral). Released, the engine idles, so in gear the tank creeps.
 */
export function engineSpeed(s: GearboxState, c: GearboxControls): number {
  const v = (targetRpm(c) / MAX_RPM) * GEARS[s.gear].top;
  return s.gear === REVERSE ? -v : v;
}

/**
 * The engine's RPM `dt` seconds on: heading for the demand out of gear, and
 * for the tracks' speed through the gear as the clutch engages, with the
 * automatic and stick-shift clutches slipping at LAUNCH_RPM when pulling
 * away. With the Clutch fully out and the tracks too slow for the gear it
 * bogs. Sets `s.bogging`; returns how much of its pull the engine keeps.
 */
export function stepRpm(s: GearboxState, c: GearboxControls, dt: number): number {
  const free = targetRpm(c);
  const e = engagement(s, c);
  let coupled = free;
  let pull = 1;
  s.bogging = false;
  if (s.gear !== NEUTRAL) {
    const wheels = wheelRpm(s.speed, s.gear);
    if (c.mode === 'clutch') {
      coupled = Math.max(wheels, BOGGED_RPM);
      s.bogging = e >= 1 && wheels < BOG_RPM;
      if (s.bogging) pull = BOG_PULL;
    } else {
      // Its clutch slips below the engine's own revs: pulling away at up to LAUNCH_RPM, idling free at rest.
      coupled = Math.max(wheels, demandOf(c) > 0.02 ? Math.min(free, LAUNCH_RPM) : free);
    }
  }
  const target = free + (coupled - free) * e;
  const seconds = RPM_SECONDS + (RPM_COUPLED_SECONDS - RPM_SECONDS) * e;
  s.rpm += (target - s.rpm) * (1 - Math.exp(-dt / seconds));
  return pull;
}

/**
 * The most the speed may rise per second towards its target, m/s²: the
 * comfort cap, times the gear's pull, the throttle (demandOf), how far the
 * clutch is engaged and what a bogged engine keeps.
 */
export function pullRate(s: GearboxState, c: GearboxControls, enginePull: number): number {
  const throttle = IDLE_PULL + (1 - IDLE_PULL) * demandOf(c);
  return MAX_ACCEL * GEAR_PULL[s.gear] * throttle * engagement(s, c) * enginePull;
}

/**
 * The most the speed may fall per second towards a lower target, m/s²:
 * coasting at COAST_DECEL out of gear, more with the engine engaged (it
 * holds the tank back: with the automatic box at the full comfort cap, as
 * the tillers ask; with a Sherman's controls at ENGINE_HOLD of it), and up
 * to the cap with a tiller braking: pulled back (with the automatic box,
 * against the motion).
 */
export function slowRate(s: GearboxState, c: GearboxControls): number {
  const hold = engagement(s, c) * (realControls(c.mode) ? ENGINE_HOLD : 1);
  const brake = clamp(s.speed >= 0 || realControls(c.mode) ? -Math.min(c.left, c.right) : Math.max(c.left, c.right), 0, 1);
  return COAST_DECEL + (MAX_ACCEL - COAST_DECEL) * Math.max(hold, brake);
}
