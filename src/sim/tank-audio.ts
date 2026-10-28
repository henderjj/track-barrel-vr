/**
 * The tank's sounds (F1.12, docs/audio.md), engine-free: what the
 * continuous sounds do with the engine's RPM, the tracks' speed and the
 * turret's turn, the short sounds rendered once into sample buffers, when a
 * change in the tank's state makes one of them, and how far the mix ducks
 * while someone speaks on the intercom.
 *
 * Everything is synthesised (no CDN or sample files): `renderSound` and
 * `renderNoiseLoop` are deterministic, so the tests can check them and both
 * pages hear the same thing. TankAudioSystem plays them through Web Audio.
 */
import { MAX_SPEED, MAX_TRAVERSE } from './comfort.js';
import { LEVER_CLOSED } from './loading.js';
import { rng } from './random.js';
import { IDLE_RPM, MAX_RPM } from './tank-drive.js';

/** The short sounds: a gear going in, the gears grinding (a loop), the gun, the breech closing and opening by hand, the casing in the bin, a shell rammed home, the hull bumping into something. */
export const SOUND_IDS = ['clunk', 'grind', 'shot', 'breech', 'latch', 'casing', 'ram', 'bump'] as const;
export type SoundId = (typeof SOUND_IDS)[number];

/**
 * The mix, linear gains into the tank's bus (before the duck and the
 * player's Tank sounds setting). The gun is the loudest thing in the tank
 * and the engine sits under everything; the short sounds are rendered at
 * these peaks.
 */
export const MIX = {
  engine: 0.32,
  rumble: 0.3,
  clatter: 0.1,
  whine: 0.03,
  grind: 0.3,
  clunk: 0.55,
  shot: 0.95,
  breech: 0.5,
  latch: 0.25,
  casing: 0.28,
  ram: 0.35,
  bump: 0.5,
} as const;

/**
 * The engine is a big V12 diesel heard through the hull: a deep, lumpy
 * firing beat rather than a note. Its beat runs from ENGINE_IDLE_HZ at idle
 * to ENGINE_TOP_HZ flat out, a narrower spread than the RPM's, as a heavy
 * diesel's sounds. The beat is one rendered cycle of firings
 * (`renderEngineCycle`) played faster as it revs.
 */
export const ENGINE_IDLE_HZ = 30;
export const ENGINE_TOP_HZ = 62;
/** Firings in the rendered cycle: two turns of the V12, each firing a little different, so it loops lumpy rather than as a pure tone. */
export const ENGINE_CYCLE_FIRINGS = 12;
/** The track links are this far apart, m: the clatter's rate is the track speed over this. */
export const LINK_PITCH = 0.15;
/** The clatter's rate tops out here, Hz (above it the links blur into the rumble). */
export const MAX_CLATTER_HZ = 45;

/** While either player speaks the tank's sounds drop this far, dB (concept §6: the intercom stays clear). */
export const DUCK_DB = -6;
/** A voice's RMS level (0 to 1) at or above this counts as speaking; Chromium's noise suppression leaves the room below it. */
export const SPEAKING_LEVEL = 0.01;
/** Speech keeps the duck this long after the last loud moment, s, so it doesn't pump between words. */
export const DUCK_HOLD = 0.35;
/** How fast the duck comes in and lets go, s (time constants). */
export const DUCK_ATTACK = 0.05;
export const DUCK_RELEASE = 0.4;

/** The lever counts as closed (or opened) crossing this angle, rad: a little short of latched, so the crewmate's smoothed copy crosses it too. */
export const BREECH_CLOSED_AT = LEVER_CLOSED - 0.05;
/** The breech opens by itself after a shot: no hand-opening sound for this long after one, s (the crewmate's copy of the lever comes late). */
export const AUTO_OPEN_WINDOW = 1.2;

export const dbToGain = (db: number): number => 10 ** (db / 20);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The engine's sound at an RPM: its firing beat, how fast the rendered cycle plays, how open its filter is and how loud. */
export interface EngineVoice {
  /** The firing beat, Hz. */
  freq: number;
  /** The rendered cycle's playback rate (1 at idle). */
  rate: number;
  /** The low-pass filter's cutoff, Hz: muffled by the hull at idle, a little harder-edged under load. */
  cutoff: number;
  /** 0 to 1, before MIX.engine. */
  gain: number;
}

export function createEngineVoice(): EngineVoice {
  return { freq: 0, rate: 1, cutoff: 0, gain: 0 };
}

/** How far the revs are from idle to top, 0 to 1. */
export function revs(rpm: number): number {
  return clamp01((rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM));
}

export function engineVoice(rpm: number, out: EngineVoice): EngineVoice {
  const r = revs(rpm);
  out.freq = ENGINE_IDLE_HZ + (ENGINE_TOP_HZ - ENGINE_IDLE_HZ) * r;
  out.rate = out.freq / ENGINE_IDLE_HZ;
  out.cutoff = 380 + 520 * r;
  out.gain = 0.65 + 0.35 * r;
  return out;
}

/** The tracks' sound at their speeds: a low rumble and the links' clatter. */
export interface TrackVoice {
  /** 0 to 1, before MIX.rumble. */
  rumble: number;
  /** The rumble's low-pass cutoff, Hz. */
  rumbleCutoff: number;
  /** 0 to 1, before MIX.clatter, and its rate, Hz. */
  clatter: number;
  clatterHz: number;
}

export function createTrackVoice(): TrackVoice {
  return { rumble: 0, rumbleCutoff: 0, clatter: 0, clatterHz: 0 };
}

/** From each track's speed, m/s (a pivot turn, tracks running opposite ways, rumbles too). */
export function trackVoice(leftTrack: number, rightTrack: number, out: TrackVoice): TrackVoice {
  const v = (Math.abs(leftTrack) + Math.abs(rightTrack)) / 2;
  const f = clamp01(v / MAX_SPEED);
  out.rumble = f ** 0.7;
  out.rumbleCutoff = 90 + 500 * f;
  out.clatter = clamp01(f * 4);
  out.clatterHz = Math.min(MAX_CLATTER_HZ, v / LINK_PITCH);
  return out;
}

/** The power traverse's whine: its pitch and loudness (0 to 1, before MIX.whine) from the turret's rate, rad/s. */
export function whineVoice(rate: number, out: { freq: number; gain: number }): { freq: number; gain: number } {
  const r = clamp01(Math.abs(rate) / MAX_TRAVERSE);
  out.freq = 180 + 700 * r;
  out.gain = r > 0.01 ? 0.3 + 0.7 * r : 0;
  return out;
}

/**
 * The intercom's duck: the tank's sounds drop by DUCK_DB while this
 * player's microphone or the crewmate's voice is above SPEAKING_LEVEL,
 * coming in fast and letting go slowly after DUCK_HOLD.
 */
export class Ducker {
  /** The gain now, linear (1 not ducked). */
  gain = 1;
  speaking = false;
  private hold = 0;

  step(micLevel: number, crewLevel: number, dt: number): number {
    if (micLevel >= SPEAKING_LEVEL || crewLevel >= SPEAKING_LEVEL) {
      this.hold = DUCK_HOLD;
    } else {
      this.hold = Math.max(0, this.hold - dt);
    }
    this.speaking = this.hold > 0;
    const target = this.speaking ? dbToGain(DUCK_DB) : 1;
    const tau = target < this.gain ? DUCK_ATTACK : DUCK_RELEASE;
    this.gain += (target - this.gain) * (1 - Math.exp(-dt / tau));
    return this.gain;
  }

  get db(): number {
    return 20 * Math.log10(this.gain);
  }
}

/** What the tank and the loading look like this frame, for SoundCues. */
export interface CueState {
  /** The gear engaged (0 neutral) and whether the gears grind (TankDrive). */
  gear: number;
  grinding: boolean;
  /** The hull's bump count (TankDrive). */
  bumps: number;
  /** The breech lever's angle, rad, and whether a shell is rammed (the loading as drawn). */
  lever: number;
  rammed: boolean;
}

/** Which short sounds this frame's changes make. */
export interface Cues {
  clunk: boolean;
  bump: boolean;
  breech: boolean;
  latch: boolean;
  ram: boolean;
}

export function createCues(): Cues {
  return { clunk: false, bump: false, breech: false, latch: false, ram: false };
}

/**
 * Turns changes in the tank's state into short sounds, the same on both
 * pages since each reads the tank and the loading as it draws them: a gear
 * going in clunks, a bump thuds, the lever closing slams the breech and
 * opening it by hand unlatches it, a shell going home thunks. The first
 * frame only takes note. Allocation free.
 */
export class SoundCues {
  private primed = false;
  private gear = 0;
  private bumps = 0;
  private closed = false;
  private rammed = false;

  /** `sinceShot` is how long ago the gun fired, s: the breech opening by itself then makes no sound of its own (the shot has it). */
  step(s: CueState, sinceShot: number, out: Cues): Cues {
    const closed = s.lever >= BREECH_CLOSED_AT;
    out.clunk = this.primed && s.gear !== 0 && s.gear !== this.gear && !s.grinding;
    out.bump = this.primed && s.bumps > this.bumps;
    out.breech = this.primed && closed && !this.closed;
    out.latch = this.primed && !closed && this.closed && !(sinceShot < AUTO_OPEN_WINDOW);
    out.ram = this.primed && s.rammed && !this.rammed;
    // Neutral while grinding isn't a shift: the clunk comes when the gear goes in.
    if (!s.grinding) this.gear = s.gear;
    this.bumps = s.bumps;
    this.closed = closed;
    this.rammed = s.rammed;
    this.primed = true;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Rendering the short sounds.

const TAU = 2 * Math.PI;

/** How long each short sound lasts, s (the grind is a loop this long, a whole number of its tooth beats). */
export const SOUND_SECONDS: Record<SoundId, number> = {
  clunk: 0.45,
  grind: 0.5,
  shot: 2.2,
  breech: 0.6,
  latch: 0.35,
  casing: 1.1,
  ram: 0.35,
  bump: 0.7,
};

/** The grind's tooth beat, Hz: a whole number of beats in its loop, so it loops without a click. */
export const GRIND_TEETH_HZ = 60;

/** A decaying sine from `start`, s. */
function partial(out: Float32Array, rate: number, start: number, freq: number, amp: number, tau: number): void {
  const s = Math.floor(start * rate);
  const n = Math.min(out.length - s, Math.ceil(tau * 9 * rate));
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[s + i] += amp * Math.sin(TAU * freq * t) * Math.exp(-t / tau);
  }
}

/** A low thump: a sine gliding from f0 down to f1 as it decays. */
function thump(out: Float32Array, rate: number, start: number, f0: number, f1: number, amp: number, tau: number): void {
  const s = Math.floor(start * rate);
  const n = Math.min(out.length - s, Math.ceil(tau * 9 * rate));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = f1 + (f0 - f1) * Math.exp((-2 * t) / tau);
    phase += (TAU * f) / rate;
    out[s + i] += amp * Math.sin(phase) * Math.exp(-t / tau);
  }
}

/** A burst of noise through a one-pole low-pass at `cutoff`, Hz, decaying. */
function noise(out: Float32Array, rate: number, start: number, amp: number, tau: number, cutoff: number, random: () => number): void {
  const s = Math.floor(start * rate);
  const n = Math.min(out.length - s, Math.ceil(tau * 9 * rate));
  const a = 1 - Math.exp((-TAU * cutoff) / rate);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y += a * (random() * 2 - 1 - y);
    out[s + i] += amp * y * Math.exp(-i / rate / tau);
  }
}

/** Scale to a peak of `peak`. */
function normalise(out: Float32Array<ArrayBuffer>, peak: number): Float32Array<ArrayBuffer> {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / max;
  return out;
}

/** Fade the last `seconds` out, so a sound cut at its length ends at silence. */
function fadeOut(out: Float32Array<ArrayBuffer>, rate: number, seconds: number): Float32Array<ArrayBuffer> {
  const n = Math.min(out.length, Math.floor(seconds * rate));
  for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n;
  return out;
}

/** One short sound's samples (mono, at `rate` Hz), peaking at its MIX level. Deterministic. */
export function renderSound(id: SoundId, rate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(SOUND_SECONDS[id] * rate));
  const random = rng(SOUND_IDS.indexOf(id) + 1);
  switch (id) {
    case 'clunk':
      // A heavy gear sliding home: a dull thud and a short ring of the box.
      thump(out, rate, 0, 95, 55, 1, 0.07);
      noise(out, rate, 0, 0.5, 0.012, 2000, random);
      partial(out, rate, 0, 520, 0.25, 0.06);
      partial(out, rate, 0, 860, 0.18, 0.045);
      partial(out, rate, 0.004, 1370, 0.12, 0.03);
      break;
    case 'grind': {
      // Teeth clashing: a rasp and gritty noise, beating GRIND_TEETH_HZ times a second, silent at the loop's ends.
      const a = 1 - Math.exp((-TAU * 900) / rate);
      let lp = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / rate;
        const beat = Math.sin(Math.PI * GRIND_TEETH_HZ * t) ** 4;
        let rasp = 0;
        for (let k = 1; k <= 8; k++) rasp += Math.sin(TAU * k * 2 * GRIND_TEETH_HZ * t) / k;
        const x = random() * 2 - 1;
        lp += a * (x - lp);
        out[i] = beat * (0.5 * rasp + 1.2 * (x - lp));
      }
      break;
    }
    case 'shot':
      // The crack, the boom and the rumble after it, and the breech flying open as the gun runs out.
      noise(out, rate, 0, 1, 0.012, 12000, random);
      thump(out, rate, 0, 120, 38, 1.2, 0.3);
      noise(out, rate, 0.005, 1.4, 0.45, 250, random);
      partial(out, rate, 0.12, 413, 0.2, 0.08);
      partial(out, rate, 0.12, 737, 0.15, 0.06);
      partial(out, rate, 0.121, 1190, 0.1, 0.05);
      break;
    case 'breech':
      // The block slamming up: a hard strike and a ring of heavy steel.
      noise(out, rate, 0, 0.8, 0.006, 5000, random);
      thump(out, rate, 0, 110, 70, 0.7, 0.05);
      partial(out, rate, 0, 180, 0.5, 0.15);
      partial(out, rate, 0, 413, 0.45, 0.12);
      partial(out, rate, 0, 737, 0.35, 0.09);
      partial(out, rate, 0, 1190, 0.3, 0.07);
      partial(out, rate, 0, 1830, 0.2, 0.05);
      partial(out, rate, 0, 2650, 0.12, 0.035);
      break;
    case 'latch':
      // The block dropping open by hand: a lighter clack.
      noise(out, rate, 0, 0.6, 0.004, 4000, random);
      partial(out, rate, 0, 413, 0.3, 0.06);
      partial(out, rate, 0, 1190, 0.25, 0.04);
      partial(out, rate, 0.002, 1830, 0.15, 0.03);
      break;
    case 'casing':
      // A brass case landing and bouncing in the bin: ringing pings, each smaller.
      [0, 0.14, 0.27, 0.36].forEach((at, k) => {
        const a = 1 / (1 + 1.2 * k);
        const detune = 1 + (random() - 0.5) * 0.06;
        noise(out, rate, at, 0.3 * a, 0.003, 8000, random);
        partial(out, rate, at, 1480 * detune, 0.5 * a, 0.09);
        partial(out, rate, at, 3620 * detune, 0.3 * a, 0.06);
        partial(out, rate, at, 6100 * detune, 0.15 * a, 0.04);
      });
      break;
    case 'ram':
      // The shell's rim seating in the chamber: a thunk.
      thump(out, rate, 0, 140, 90, 0.8, 0.04);
      noise(out, rate, 0, 0.4, 0.01, 1500, random);
      partial(out, rate, 0, 640, 0.15, 0.05);
      partial(out, rate, 0, 1010, 0.1, 0.04);
      break;
    case 'bump':
      // The hull meeting something: a deep thud through the floor.
      thump(out, rate, 0, 70, 40, 1, 0.14);
      noise(out, rate, 0, 0.7, 0.08, 400, random);
      partial(out, rate, 0, 230, 0.2, 0.08);
      break;
  }
  normalise(out, MIX[id]);
  return id === 'grind' ? out : fadeOut(out, rate, 0.03);
}

/**
 * The diesel's firing cycle at idle, peaking at 1, looping seamlessly:
 * ENGINE_CYCLE_FIRINGS firings at ENGINE_IDLE_HZ, each a dull thump of the
 * block, a chuff of exhaust and a short hard knock, with its timing and
 * strength varied a little so the beat is lumpy. Played faster as the
 * engine revs. Deterministic.
 */
export function renderEngineCycle(rate: number): Float32Array<ArrayBuffer> {
  const n = Math.round((ENGINE_CYCLE_FIRINGS / ENGINE_IDLE_HZ) * rate);
  // Render with a tail, then fold the tail onto the start so the last firing rings into the first.
  const tail = Math.round(0.12 * rate);
  const work = new Float32Array(n + tail);
  const random = rng(201);
  const period = 1 / ENGINE_IDLE_HZ;
  for (let k = 0; k < ENGINE_CYCLE_FIRINGS; k++) {
    const at = (k + (random() - 0.5) * 0.12) * period + 0.004;
    const a = 0.8 + random() * 0.4;
    thump(work, rate, at, 120, 70, a, 0.012);
    partial(work, rate, at, 190 * (0.95 + random() * 0.1), 0.35 * a, 0.007);
    noise(work, rate, at, 0.9 * a, 0.018, 260, random);
    noise(work, rate, at + 0.001, 0.28 * a * (0.6 + random() * 0.8), 0.0025, 3200, random);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < work.length; i++) out[i % n] += work[i];
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  for (let i = 0; i < n; i++) out[i] -= mean;
  return normalise(out, 1);
}

/**
 * A loop of noise for the continuous sounds, peaking at 1: white (the
 * clatter, through a band-pass) or brown (the rumble), its ends meeting so
 * it loops without a click. Deterministic.
 */
export function renderNoiseLoop(kind: 'white' | 'brown', rate: number, seconds: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(seconds * rate));
  const random = rng(kind === 'white' ? 101 : 102);
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    const x = random() * 2 - 1;
    if (kind === 'white') {
      out[i] = x;
    } else {
      // Leaky integration keeps brown noise from wandering off.
      y = 0.998 * y + 0.02 * x;
      out[i] = y;
    }
  }
  if (kind === 'brown') {
    // Tilt it so the end meets the start, then take out the average.
    const n = out.length;
    const step = (out[n - 1] - out[0]) / (n - 1);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      out[i] -= step * i;
      mean += out[i];
    }
    mean /= n;
    for (let i = 0; i < n; i++) out[i] -= mean;
  }
  return normalise(out, 1);
}
