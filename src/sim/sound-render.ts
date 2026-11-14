/**
 * The tank's sounds as samples (F6.1, docs/audio.md), engine-free: every
 * short sound, the engine's firing loop, the noise and control loops the
 * continuous sounds are built from, and the steel cabin's echo. All of it is
 * synthesised from what the real things are (how many cylinders fire and
 * when, which bits of steel and brass ring and for how long), with no
 * sample files, and deterministic: both pages hear the same tank and the
 * tests can check it. TankSoundGraph plays them through Web Audio.
 *
 * The sounds are modelled the way they are made: something strikes
 * (a thump, a burst of noise) and something rings (a body's modes, each a
 * decaying sine). The bodies are below: armour plate, the breech's steel,
 * a brass case, the casing bin's sheet metal and the gearbox's cast case.
 */
import { RECOIL } from './loading.js';
import { rng } from './random.js';
import { CRANK_BEAT_HZ, GRIND_TEETH_HZ, IDLE_REV_HZ, LOOPED, MIX, SOUND_IDS, SOUND_SECONDS, SQUEAK_CHIRPS, SQUEAK_VARIANTS, type SoundId } from './tank-audio.js';

const TAU = 2 * Math.PI;
type Samples = Float32Array<ArrayBuffer>;
type Random = () => number;

// ---------------------------------------------------------------------------
// Building blocks.

/** A decaying sine from `start`, s: one mode of something struck. A two-pole resonator's ring, so it costs two multiplies a sample. */
function ring(out: Float32Array, rate: number, start: number, freq: number, amp: number, tau: number): void {
  if (freq >= rate * 0.45 || amp === 0) return;
  const s = Math.max(0, Math.floor(start * rate));
  const n = Math.min(out.length - s, Math.ceil(tau * 8 * rate));
  const w = (TAU * freq) / rate;
  const r = Math.exp(-1 / (tau * rate));
  const k = 2 * r * Math.cos(w);
  const r2 = r * r;
  // y[0] = 0 and y[1] = amp·r·sin(w): a sine starting from rest, as a struck thing does.
  let y1 = 0;
  let y2 = -amp * Math.sin(w) / r;
  for (let i = 0; i < n; i++) {
    const y = k * y1 - r2 * y2;
    out[s + i] += y1;
    y2 = y1;
    y1 = y;
  }
}

/** A low thump: a sine gliding from f0 down to f1 as it decays. */
function thump(out: Float32Array, rate: number, start: number, f0: number, f1: number, amp: number, tau: number): void {
  const s = Math.max(0, Math.floor(start * rate));
  const n = Math.min(out.length - s, Math.ceil(tau * 8 * rate));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = f1 + (f0 - f1) * Math.exp((-2 * t) / tau);
    phase += (TAU * f) / rate;
    out[s + i] += amp * Math.sin(phase) * Math.exp(-t / tau);
  }
}

interface BurstShape {
  /** Nothing above this, Hz (two one-pole low-passes, 12 dB an octave). */
  low: number;
  /** Nothing below this, Hz (a one-pole high-pass). */
  high?: number;
  /** It swells in over this long, s, before dying away. */
  attack?: number;
}

/** A burst of noise between `high` and `low` Hz, swelling in over `attack` and decaying with `tau`, peaking at `amp`. */
function burst(out: Float32Array, rate: number, start: number, amp: number, tau: number, shape: BurstShape, random: Random): void {
  const s = Math.max(0, Math.floor(start * rate));
  const attack = shape.attack ?? 0;
  const n = Math.min(out.length - s, Math.ceil((attack + tau * 8) * rate));
  if (n <= 0) return;
  const a = 1 - Math.exp((-TAU * shape.low) / rate);
  const b = shape.high != null ? 1 - Math.exp((-TAU * shape.high) / rate) : 0;
  const rise = Math.max(1, attack * rate);
  const work = new Float32Array(n);
  let y1 = 0;
  let y2 = 0;
  let dc = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    y1 += a * (random() * 2 - 1 - y1);
    y2 += a * (y1 - y2);
    dc += b * (y2 - dc);
    const env = i < rise ? i / rise : Math.exp(-(i - rise) / rate / tau);
    work[i] = (y2 - dc) * env;
    max = Math.max(max, Math.abs(work[i]));
  }
  if (max > 0) for (let i = 0; i < n; i++) out[s + i] += (amp / max) * work[i];
}

/**
 * Steel sliding on steel: noise through a band-pass that glides from f0 to
 * f1 over `seconds`, rising and falling smoothly, peaking at `amp`.
 */
function slide(out: Float32Array, rate: number, start: number, seconds: number, f0: number, f1: number, amp: number, random: Random): void {
  const s = Math.max(0, Math.floor(start * rate));
  const n = Math.min(out.length - s, Math.ceil(seconds * rate));
  if (n <= 0) return;
  // A state-variable band-pass (stable while the centre stays under a sixth of the rate).
  const work = new Float32Array(n);
  let lowState = 0;
  let band = 0;
  let max = 0;
  const q = 0.5;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = 2 * Math.sin((Math.PI * Math.min(f0 + (f1 - f0) * u, rate / 7)) / rate);
    lowState += f * band;
    const high = random() * 2 - 1 - lowState - q * band;
    band += f * high;
    work[i] = band * Math.sin(Math.PI * u) ** 2;
    max = Math.max(max, Math.abs(work[i]));
  }
  if (max > 0) for (let i = 0; i < n; i++) out[s + i] += (amp / max) * work[i];
}

/** One mode of a body: its frequency, Hz, its share of the ring and how long it rings, s. */
interface Mode {
  f: number;
  a: number;
  tau: number;
}

/**
 * The modes of something that rings: `count` of them spread between `low`
 * and `high` Hz, the low ones the loudest and longest (`tauLow` down to
 * `tauHigh`, s). Plate and cast steel ring at frequencies that are no
 * harmonics of each other, which is why a struck plate clangs and doesn't
 * sing a note.
 */
function body(seed: number, count: number, low: number, high: number, tauLow: number, tauHigh: number): Mode[] {
  const random = rng(seed);
  const modes: Mode[] = [];
  for (let k = 0; k < count; k++) {
    // Evenly spread on a log scale, each nudged off its place.
    const u = (k + 0.15 + 0.7 * random()) / count;
    const f = low * (high / low) ** u;
    modes.push({ f, a: (0.45 + 0.55 * random()) * (low / f) ** 0.4, tau: tauLow * (tauHigh / tauLow) ** u * (0.75 + 0.5 * random()) });
  }
  return modes;
}

/** The hull's armour: thick plate, so a dull, low clang that dies in half a second. */
const HULL = body(11, 26, 105, 2600, 0.5, 0.07);
/** The breech ring and block: a heavy lump of steel, ringing a little longer and brighter. */
const BREECH: Mode[] = [
  { f: 183, a: 0.5, tau: 0.16 },
  { f: 413, a: 0.48, tau: 0.14 },
  { f: 737, a: 0.4, tau: 0.11 },
  { f: 1190, a: 0.34, tau: 0.085 },
  { f: 1553, a: 0.2, tau: 0.07 },
  { f: 1830, a: 0.24, tau: 0.06 },
  { f: 2650, a: 0.15, tau: 0.045 },
  { f: 3480, a: 0.09, tau: 0.03 },
  { f: 4410, a: 0.05, tau: 0.022 },
];
/** A 75 mm brass case: a tube, bright and long ringing when it flies free. */
const BRASS: Mode[] = [
  { f: 1120, a: 0.55, tau: 0.15 },
  { f: 1164, a: 0.3, tau: 0.13 },
  { f: 2470, a: 0.42, tau: 0.1 },
  { f: 3890, a: 0.3, tau: 0.075 },
  { f: 5650, a: 0.2, tau: 0.06 },
  { f: 7400, a: 0.1, tau: 0.04 },
];
/** The casing bin: thin sheet steel, a short rattly bonk. */
const BIN = body(13, 10, 240, 1900, 0.11, 0.035);
/** The gearbox's cast case: thick and dead, more thud than ring. */
const GEARBOX = body(14, 12, 230, 1600, 0.065, 0.022);
/** Gear teeth: small hard steel, very short and bright. */
const TEETH = body(15, 8, 900, 4200, 0.012, 0.004);
/** Loose kit on the walls: small things that tick and rattle. */
const KIT = body(16, 9, 1400, 5200, 0.03, 0.01);

/**
 * Strike a body at `start`: every mode rings. `hard` (0 to 1) is how hard
 * and sharp the blow is: a soft blow leaves the high modes out. `damp`
 * shortens the ring (a hand or a floor on it); `spread` varies each mode's
 * share, so no two blows on the same thing sound quite alike.
 */
function strike(
  out: Float32Array,
  rate: number,
  start: number,
  modes: readonly Mode[],
  amp: number,
  random: Random,
  { hard = 1, damp = 1, spread = 0.3, tune = 1 }: { hard?: number; damp?: number; spread?: number; tune?: number } = {},
): void {
  const top = modes[modes.length - 1].f;
  for (const m of modes) {
    const soft = hard >= 1 ? 1 : Math.exp((-3 * (1 - hard) * (m.f - modes[0].f)) / (top - modes[0].f));
    ring(out, rate, start, m.f * tune, amp * m.a * soft * (1 - spread + 2 * spread * random()), m.tau * damp);
  }
}

/** Scale to a peak of `peak`. */
function normalise(out: Samples, peak: number): Samples {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / max;
  return out;
}

/** Fade the last `seconds` out, so a sound cut at its length ends at silence. */
function fadeOut(out: Samples, rate: number, seconds: number): Samples {
  const n = Math.min(out.length, Math.floor(seconds * rate));
  for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n;
  return out;
}

/** Take the average out. */
function centre(out: Samples): Samples {
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return out;
}

/** The first `n` samples of `work` with the rest wrapped round onto the start: what rings past the end of a loop rings into its beginning. */
function fold(work: Float32Array, n: number): Samples {
  const out = new Float32Array(n);
  for (let i = 0; i < work.length; i++) out[i % n] += work[i];
  return out;
}

/** `n` samples of noise between `high` and `low` Hz, peaking at 1, that loop without a click (the end cross-fades into the start). */
function loopNoise(rate: number, n: number, low: number, high: number, random: Random): Samples {
  const lap = Math.min(n >> 1, Math.round(0.03 * rate));
  const work = new Float32Array(n + lap);
  const a = 1 - Math.exp((-TAU * low) / rate);
  const b = 1 - Math.exp((-TAU * high) / rate);
  let y1 = 0;
  let y2 = 0;
  let dc = 0;
  // Run the filters in before the first sample is kept.
  for (let i = -2000; i < work.length; i++) {
    y1 += a * (random() * 2 - 1 - y1);
    y2 += a * (y1 - y2);
    dc += b * (y2 - dc);
    if (i >= 0) work[i] = y2 - dc;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = work[i];
  for (let i = 0; i < lap; i++) {
    const u = i / lap;
    out[i] = work[i] * Math.sin((Math.PI / 2) * u) + work[n + i] * Math.cos((Math.PI / 2) * u);
  }
  return normalise(out, 1);
}

// ---------------------------------------------------------------------------
// The short sounds.

/** When the casing lands in the bin and each time it bounces after, s from its sound's start: lower and sooner each time. */
export const CASING_BOUNCES = [0, 0.17, 0.3, 0.39, 0.45, 0.49] as const;

/** The gun's report coming back off the range, s after the shot: the far bank, then further ground. */
export const SHOT_ECHOES = [0.42, 0.95, 1.6] as const;

/** One short sound's samples (mono, at `rate` Hz), peaking at its MIX level. Deterministic. */
export function renderSound(id: SoundId, rate: number): Samples {
  const n = Math.round(SOUND_SECONDS[id] * rate);
  const random = rng(SOUND_IDS.indexOf(id) + 1);
  let out: Samples = new Float32Array(n);
  switch (id) {
    case 'clunk':
      // The lever through its gate (a light click), then the gear's dogs going home: a thud in the cast gearbox and the lever rattling.
      burst(out, rate, 0, 0.25, 0.003, { low: 3500, high: 700 }, random);
      strike(out, rate, 0, GEARBOX, 0.12, random, { hard: 0.5 });
      thump(out, rate, 0.07, 105, 58, 1, 0.06);
      burst(out, rate, 0.07, 0.55, 0.01, { low: 2200, high: 150 }, random);
      strike(out, rate, 0.07, GEARBOX, 0.45, random);
      burst(out, rate, 0.085, 0.1, 0.02, { low: 900, high: 200 }, random);
      strike(out, rate, 0.11, KIT, 0.05, random, { hard: 0.6 });
      break;
    case 'grind': {
      // Teeth clashing: GRIND_TEETH_HZ blows a second, each a little early or late and no two as hard, the box growling under them.
      const work = new Float32Array(n + Math.round(0.08 * rate));
      const beats = Math.round(SOUND_SECONDS.grind * GRIND_TEETH_HZ);
      for (let k = 0; k < beats; k++) {
        const at = (k + 0.5 + (random() - 0.5) * 0.3) / GRIND_TEETH_HZ;
        const a = 0.4 + 0.6 * random();
        strike(work, rate, at, TEETH, 0.5 * a, random, { spread: 0.5 });
        burst(work, rate, at, 0.9 * a, 0.004, { low: 5200, high: 900 }, random);
        thump(work, rate, at, 190, 120, 0.35 * a, 0.006);
        if (k % 3 === 0) strike(work, rate, at, GEARBOX, 0.22 * a, random, { hard: 0.7 });
      }
      out = fold(work, n);
      // The rasp between the blows, beating with the teeth.
      const rasp = loopNoise(rate, n, 3200, 500, random);
      for (let i = 0; i < n; i++) out[i] += 0.5 * rasp[i] * (0.65 + 0.35 * Math.sin((TAU * GRIND_TEETH_HZ * i) / rate));
      break;
    }
    case 'shot':
      // From inside: the blast slams through the armour as a crack with no top to it and a boom you feel,
      burst(out, rate, 0, 1.1, 0.007, { low: 8000, high: 300 }, random);
      burst(out, rate, 0.0005, 1.3, 0.05, { low: 2400, high: 220 }, random);
      thump(out, rate, 0, 240, 55, 1, 0.09);
      thump(out, rate, 0, 105, 34, 1.3, 0.2);
      thump(out, rate, 0.004, 58, 27, 0.9, 0.3);
      burst(out, rate, 0.003, 1.3, 0.3, { low: 170 }, random);
      // the whole hull rings like a struck tank,
      strike(out, rate, 0.002, HULL, 0.4, random);
      // the gun slams back on its buffer, the breech flies open and throws the case out,
      thump(out, rate, RECOIL.back, 150, 85, 0.4, 0.03);
      burst(out, rate, RECOIL.back + 0.006, 0.4, 0.005, { low: 5000, high: 500 }, random);
      strike(out, rate, RECOIL.back + 0.006, BREECH, 0.32, random);
      strike(out, rate, RECOIL.back + 0.02, BRASS, 0.06, random, { damp: 0.5 });
      // it runs out again on its recuperator and thuds into battery,
      slide(out, rate, RECOIL.back + 0.02, RECOIL.out - 0.04, 900, 380, 0.16, random);
      thump(out, rate, RECOIL.back + RECOIL.out, 125, 75, 0.28, 0.04);
      strike(out, rate, RECOIL.back + RECOIL.out, BREECH, 0.1, random, { hard: 0.5 });
      // everything loose in the turret jumps,
      for (let k = 0; k < 9; k++) {
        strike(out, rate, 0.03 + 0.5 * random() ** 1.6, KIT, 0.03 + 0.05 * random(), random, { hard: 0.7, spread: 0.6, tune: 0.8 + 0.5 * random() });
      }
      // and the report rolls back off the range.
      burst(out, rate, SHOT_ECHOES[0], 0.34, 0.24, { low: 260, attack: 0.05 }, random);
      burst(out, rate, SHOT_ECHOES[1], 0.26, 0.32, { low: 200, attack: 0.1 }, random);
      burst(out, rate, SHOT_ECHOES[2], 0.16, 0.4, { low: 150, attack: 0.15 }, random);
      break;
    case 'breech':
      // The block sliding across and slamming shut: a hard strike on a heavy lump of steel, and the lever's spring after it.
      slide(out, rate, 0, 0.05, 1400, 700, 0.18, random);
      burst(out, rate, 0.045, 0.8, 0.005, { low: 5200, high: 300 }, random);
      thump(out, rate, 0.045, 120, 72, 0.75, 0.05);
      strike(out, rate, 0.045, BREECH, 0.9, random);
      strike(out, rate, 0.047, HULL, 0.12, random, { hard: 0.5 });
      burst(out, rate, 0.1, 0.12, 0.004, { low: 4500, high: 900 }, random);
      strike(out, rate, 0.1, KIT, 0.06, random, { hard: 0.7 });
      break;
    case 'latch':
      // Opened by hand: the catch lets go with a click, the block slides back and stops against its buffer.
      burst(out, rate, 0, 0.5, 0.003, { low: 5000, high: 900 }, random);
      strike(out, rate, 0, BREECH, 0.18, random, { hard: 0.9, damp: 0.5 });
      slide(out, rate, 0.01, 0.08, 800, 1300, 0.12, random);
      burst(out, rate, 0.09, 0.5, 0.004, { low: 4000, high: 300 }, random);
      thump(out, rate, 0.09, 130, 85, 0.3, 0.03);
      strike(out, rate, 0.09, BREECH, 0.4, random, { hard: 0.6, damp: 0.7 });
      break;
    case 'casing':
      // A hot brass case dropping into the bin: it clangs, bounces lower and sooner each time, each blow on a different part of it, then rolls to rest.
      CASING_BOUNCES.forEach((at, k) => {
        const a = 1 / (1 + 0.9 * k);
        burst(out, rate, at, 0.45 * a, 0.003, { low: 8000, high: 600 }, random);
        thump(out, rate, at, 175, 110, 0.4 * a, 0.03);
        strike(out, rate, at, BIN, 0.4 * a, random, { spread: 0.5 });
        // In the air between bounces it rings free; lying in the bin at the end it is damped.
        strike(out, rate, at, BRASS, 0.7 * a, random, { spread: 0.6, damp: k < 3 ? 1 : 0.45, tune: 1 + (random() - 0.5) * 0.03 });
      });
      for (let k = 0; k < 7; k++) {
        const at = 0.53 + 0.05 * k + 0.02 * random();
        strike(out, rate, at, BRASS, 0.06 * (1 - k / 8), random, { hard: 0.5, damp: 0.25, spread: 0.6 });
        burst(out, rate, at, 0.05 * (1 - k / 8), 0.004, { low: 5000, high: 800 }, random);
      }
      break;
    case 'ram':
      // The shell sliding up the chamber and its rim stopping against the breech face: steel takes the blow, the brass ticks.
      slide(out, rate, 0, 0.09, 500, 1100, 0.14, random);
      thump(out, rate, 0.085, 150, 92, 0.85, 0.04);
      burst(out, rate, 0.085, 0.5, 0.008, { low: 2400, high: 200 }, random);
      strike(out, rate, 0.085, BREECH, 0.3, random, { hard: 0.45, damp: 0.6 });
      strike(out, rate, 0.085, BRASS, 0.09, random, { hard: 0.6, damp: 0.2 });
      break;
    case 'bump':
      // The hull meeting something: a deep thud through the floor, the armour groaning and the stowage rattling.
      thump(out, rate, 0, 68, 36, 1, 0.15);
      burst(out, rate, 0, 0.8, 0.07, { low: 420 }, random);
      strike(out, rate, 0.002, HULL, 0.3, random, { hard: 0.35 });
      for (let k = 0; k < 7; k++) {
        strike(out, rate, 0.02 + 0.3 * random() ** 1.5, KIT, 0.03 + 0.04 * random(), random, { hard: 0.6, spread: 0.6, tune: 0.7 + 0.6 * random() });
      }
      break;
    case 'crank': {
      // The starter turning thirty cylinders over: its motor's whine sagging against each bank's compression, CRANK_BEAT_HZ times a second, and the chuff of each.
      const work = new Float32Array(n + Math.round(0.1 * rate));
      const beats = Math.round(SOUND_SECONDS.crank * CRANK_BEAT_HZ);
      for (let k = 0; k < beats; k++) {
        const at = (k + 0.5) / CRANK_BEAT_HZ;
        const a = 0.75 + 0.25 * random();
        thump(work, rate, at, 85, 50, 0.6 * a, 0.022);
        burst(work, rate, at, 0.9 * a, 0.02, { low: 420, attack: 0.008 }, random);
      }
      out = fold(work, n);
      const rattle = loopNoise(rate, n, 2600, 700, random);
      let phase = 0;
      for (let i = 0; i < n; i++) {
        // 0 between compressions, 1 at the top of each.
        const load = 0.5 - 0.5 * Math.cos((TAU * CRANK_BEAT_HZ * i) / rate);
        // 300 Hz on average, so the loop holds a whole number of the whine's cycles.
        phase += (TAU * 300 * (1.035 - 0.07 * load)) / rate;
        const whine = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase) + 0.12 * Math.sin(5 * phase);
        out[i] += 0.16 * whine * (1 - 0.3 * load) + 0.3 * rattle[i] * (0.5 + 0.5 * load);
      }
      break;
    }
    case 'catch':
      // Firing up: a few banks catch raggedly, then all of them, quickening into a bark of exhaust as the revs flare.
      for (let k = 0; k < 14; k++) {
        const at = 0.02 + k * (0.085 - k * 0.0034) + (random() - 0.5) * 0.012;
        const a = 0.5 + 0.5 * random();
        thump(out, rate, at, 150, 75, a, 0.022);
        burst(out, rate, at, 0.8 * a, 0.028, { low: 380, high: 60 }, random);
      }
      burst(out, rate, 0.25, 0.55, 0.3, { low: 300, high: 70, attack: 0.25 }, random);
      break;
    case 'cough':
      // A misfire: a hollow pop back through the carburettors and a splutter.
      thump(out, rate, 0, 125, 62, 1, 0.03);
      burst(out, rate, 0, 0.9, 0.035, { low: 700, high: 120 }, random);
      burst(out, rate, 0.07, 0.45, 0.045, { low: 400, high: 80 }, random);
      thump(out, rate, 0.13, 95, 55, 0.5, 0.03);
      break;
    case 'stall':
      // Dying: a few slowing, weakening firings, then the engine shuddering to rest on its mounts.
      for (let k = 0; k < 6; k++) {
        const at = 0.02 + k * 0.06 + k * k * 0.018;
        const a = 1 - k * 0.14;
        thump(out, rate, at, 125, 62, a, 0.03);
        burst(out, rate, at, 0.7 * a, 0.035, { low: 320, high: 60 }, random);
      }
      thump(out, rate, 0.7, 58, 33, 0.8, 0.12);
      strike(out, rate, 0.7, HULL, 0.12, random, { hard: 0.25 });
      break;
  }
  normalise(out, MIX[id]);
  return LOOPED.includes(id) ? out : fadeOut(out, rate, 0.03);
}

// ---------------------------------------------------------------------------
// The engine.

/** The Chrysler A57 multibank: five six-cylinder car engines round one gear, thirty cylinders in all. */
export const ENGINE_BANKS = 5;
export const BANK_CYLINDERS = 6;
/** Four-stroke cycles (two turns each) in the rendered loop: long enough that its repeat isn't heard, 2.4 s at idle. */
export const ENGINE_LOOP_CYCLES = 16;
/** How loud each bank's exhaust is at the crew's ears: their pipes aren't the same length or as near. */
const BANK_LEVEL = [1, 0.8, 0.62, 0.9, 0.55] as const;
/** A six's firing order (1-5-3-6-2-4), as each cylinder's place in the cycle. */
const FIRING_PLACE = [0, 4, 2, 5, 1, 3] as const;

/**
 * How far a cylinder's pulse comes early or late at the crew's ears, as a
 * share of the cycle either way: its own length of manifold and pipe.
 */
const CYLINDER_LAG = 0.045;

/**
 * The engine's exhaust at idle as one loop, peaking at 1: every cylinder's
 * pulse over ENGINE_LOOP_CYCLES four-stroke cycles. Each bank is an evenly
 * firing six, but the five aren't timed against each other, no bank is as
 * loud at the crew's ears as the next, and no two cylinders are alike: each
 * has its own strength, its own sharpness and its own length of pipe, which
 * brings its pulse early or late. A recording of a real Sherman shows what
 * that does (docs/audio.md, "Measured against a real Sherman"): the sound
 * is not a note at the rate the cylinders fire but a dense stack of tones
 * one cycle apart, the same uneven pattern coming round every two turns.
 * So the pattern here is fixed and what changes from one cycle to the next
 * is small. Played faster as the engine revs, through filters that stay
 * put (the exhaust and the hull), so the burble quickens without the whole
 * sound turning thin. Deterministic.
 */
export function renderEngineLoop(rate: number): Samples {
  const cycle = 2 / IDLE_REV_HZ;
  const n = Math.round(ENGINE_LOOP_CYCLES * cycle * rate);
  const work = new Float32Array(n + Math.round(0.05 * rate));
  // A pulse of exhaust: a sharp rise as the valve opens, a slower suck back after it (no net push).
  const back = 0.004;
  const len = Math.round(0.03 * rate);
  for (const f of firings()) {
    const rise = 0.0005 * f.sharp;
    const s = Math.floor((f.at * cycle + 0.001) * rate);
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      work[s + i] += f.a * ((t / rise) * Math.exp(1 - t / rise) - (rise / back) * (t / back) * Math.exp(1 - t / back));
    }
  }
  return normalise(centre(fold(work, n)), 1);
}

/**
 * How hard the engine is blowing at each moment of the same loop, between
 * 0 and 1 (for opening and shutting its roar, not for listening to): a
 * short breath for every firing, the strong cylinders' far bigger than the
 * weak ones'. In the recording of a real Sherman the engine's hiss and
 * rattle, well above its tones, rise and fall once and twice a cycle; this
 * is what gives the roar that flutter. Deterministic, and in step with
 * renderEngineLoop.
 */
export function renderEngineBreath(rate: number): Samples {
  const cycle = 2 / IDLE_REV_HZ;
  const n = Math.round(ENGINE_LOOP_CYCLES * cycle * rate);
  const out = new Float32Array(n);
  const attack = Math.round(0.0006 * rate);
  const tau = 0.008;
  const len = Math.round(tau * 7 * rate);
  for (const f of firings()) {
    const s = Math.floor((f.at * cycle + 0.001) * rate);
    const a = f.a ** 3;
    for (let i = 0; i < len; i++) out[(s + i) % n] += a * (i < attack ? i / attack : Math.exp(-(i - attack) / rate / tau));
  }
  return normalise(out, 1);
}

interface Firing {
  /** When, in cycles from the loop's start. */
  at: number;
  /** How strong. */
  a: number;
  /** How sharp its rise is (1 is usual, less is sharper). */
  sharp: number;
}

/** Every firing in the engine's loop, in the order they are worked out (not in order of time). The same every call. */
function firings(): Firing[] {
  const random = rng(201);
  // Each cylinder's strength, lag and sharpness, and each bank's place in the cycle, stay the same every cycle.
  const cylinders = ENGINE_BANKS * BANK_CYLINDERS;
  const strength: number[] = [];
  const lag: number[] = [];
  const sharp: number[] = [];
  for (let j = 0; j < cylinders; j++) {
    strength.push(0.4 + 1.2 * random());
    lag.push((random() * 2 - 1) * CYLINDER_LAG);
    sharp.push(0.7 + 0.9 * random());
  }
  const phase: number[] = [];
  for (let b = 0; b < ENGINE_BANKS; b++) phase.push(random());
  const out: Firing[] = [];
  for (let c = 0; c < ENGINE_LOOP_CYCLES; c++) {
    for (let b = 0; b < ENGINE_BANKS; b++) {
      for (let k = 0; k < BANK_CYLINDERS; k++) {
        const j = b * BANK_CYLINDERS + k;
        const place = (FIRING_PLACE[k] + phase[b]) / BANK_CYLINDERS + lag[j] + CYLINDER_LAG;
        // No firing is quite like the last, and once in a long while one is weak.
        const at = c + place + (random() - 0.5) * 0.002;
        const a = BANK_LEVEL[b] * strength[j] * (random() < 0.02 ? 0.5 : 0.9 + 0.2 * random());
        out.push({ at, a, sharp: sharp[j] });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loops for the continuous sounds.

/**
 * A loop of noise, peaking at 1: white (the clatter's and the roar's raw
 * material) or brown (the rumble), its ends meeting so it loops without a
 * click. Deterministic.
 */
export function renderNoiseLoop(kind: 'white' | 'brown', rate: number, seconds: number): Samples {
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
    for (let i = 0; i < n; i++) out[i] -= step * i;
    centre(out);
  }
  return normalise(out, 1);
}

/** What a gate loop is made of. */
export interface GateShape {
  seed: number;
  /** Pulses a second at normal speed, and how many in the loop. */
  hz: number;
  count: number;
  /** How long each pulse takes to die away, s. */
  tau: number;
  /** How far a pulse may come early or late, as a share of the gap between them. */
  jitter: number;
  /** The weakest pulse (the strongest is 1). */
  weakest: number;
  /**
   * Lesser strikes in each gap, each at its own place in the gap every
   * time round (none if left out, and then the gate shuts between pulses).
   */
  lesser?: number;
}

/**
 * A track link meeting the sprocket, once a link: GATE_HZ a second at
 * normal speed. In that time the link before it has also met the idler,
 * the return rollers and each of the six road wheels, each at its own
 * moment, so a track is less a row of clicks than a clatter with the
 * links' beat in it: a recording of a real Sherman (docs/audio.md) has the
 * tracks' hiss rising and falling by a sixth or so at the links' rate,
 * not opening and shutting.
 */
export const GATE_HZ = 8;
export const LINK_GATE: GateShape = { seed: 301, hz: GATE_HZ, count: 32, tau: 0.009, jitter: 0.16, weakest: 0.5, lesser: 8 };
/** A tooth of a hand-turned gear train passing: lighter and more even. */
export const TICK_GATE: GateShape = { seed: 302, hz: GATE_HZ, count: 32, tau: 0.004, jitter: 0.06, weakest: 0.7 };

/**
 * A loop of pulses between 0 and 1 for opening and shutting a sound's
 * level (not for listening to): one pulse per link or tooth, no two quite
 * as strong or as evenly spaced, and for a track the lesser strikes
 * between them. Played faster or slower, it sets how often the thing it
 * gates is struck without changing what it rings like. Deterministic.
 */
export function renderGate(shape: GateShape, rate: number): Samples {
  const n = Math.round((shape.count / shape.hz) * rate);
  const len = Math.round(shape.tau * 8 * rate);
  const work = new Float32Array(n + len);
  const random = rng(shape.seed);
  const attack = Math.max(1, Math.round(0.0004 * rate));
  for (let k = 0; k < shape.count; k++) {
    const s = Math.floor(((k + 0.5 + (random() - 0.5) * shape.jitter) / shape.hz) * rate);
    const a = shape.weakest + (1 - shape.weakest) * random();
    for (let i = 0; i < len; i++) {
      const env = i < attack ? i / attack : Math.exp(-(i - attack) / rate / shape.tau);
      work[s + i] = Math.max(work[s + i], a * env);
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < work.length; i++) out[i % n] = Math.max(out[i % n], work[i]);
  const lesser = shape.lesser ?? 0;
  if (lesser === 0) return out;
  // The lesser strikes add to the main ones, spread through the gap: just where each falls and how hard is the track's own, the same every link.
  const places: number[] = [];
  const hard: number[] = [];
  for (let e = 0; e < lesser; e++) {
    places.push((e + 0.35 + 0.3 * random()) / lesser);
    hard.push(0.3 * (0.7 + 0.6 * random()));
  }
  const more = new Float32Array(n);
  for (let k = 0; k < shape.count; k++) {
    for (let e = 0; e < lesser; e++) {
      const s = Math.floor(((k + places[e] + (random() - 0.5) * shape.jitter * 0.5) / shape.hz) * rate);
      const a = hard[e] * (0.6 + 0.8 * random());
      for (let i = 0; i < len; i++) {
        more[(s + i + n) % n] += a * (i < attack ? i / attack : Math.exp(-(i - attack) / rate / shape.tau));
      }
    }
  }
  let top = 0;
  for (let i = 0; i < n; i++) {
    out[i] += more[i];
    top = Math.max(top, out[i]);
  }
  for (let i = 0; i < n; i++) out[i] /= top;
  return out;
}

/** The strain loop's length at normal pace, s, and how many times a second the strained tracks judder in it. */
export const STRAIN_SECONDS = 4;
export const STRAIN_JUDDER_HZ = 22;

/**
 * A loop between 0 and 1 for the tracks straining in a hard turn: the
 * guide horns dragged against the road wheels and the links scrubbed
 * sideways over the ground catch and let go (stick and slip) about
 * STRAIN_JUDDER_HZ times a second, never evenly, and the whole of it heaves
 * as the load comes and goes over the bumps. It never quite shuts: a
 * strained track groans all the while, juddering in it. What it lets
 * through is noise into the steel's resonances (TankSoundGraph).
 * Deterministic and seamless.
 */
export function renderStrainGate(rate: number): Samples {
  const n = Math.round(STRAIN_SECONDS * rate);
  const random = rng(305);
  // The heave: slow swells that come round a whole number of times in the loop, between about 0.45 and 1.
  const swells = [
    [2, 0.22, random() * TAU],
    [3, 0.14, random() * TAU],
    [5, 0.1, random() * TAU],
    [9, 0.06, random() * TAU],
  ] as const;
  const heave = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let h = 0.72;
    for (const [k, depth, phase] of swells) h += depth * Math.sin((TAU * k * i) / n + phase);
    heave[i] = h;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.3 * heave[i];
  const count = Math.round(STRAIN_SECONDS * STRAIN_JUDDER_HZ);
  const attack = Math.max(1, Math.round(0.001 * rate));
  for (let k = 0; k < count; k++) {
    const s = Math.floor(((k + 0.5 + (random() - 0.5) * 0.7) / count) * n);
    const tau = 0.006 + 0.012 * random();
    const len = Math.round(tau * 6 * rate);
    const a = 0.45 + 0.55 * random();
    for (let i = 0; i < len; i++) {
      const at = (s + i + n) % n;
      const env = i < attack ? i / attack : Math.exp(-(i - attack) / rate / tau);
      // Where two slips land together the harder one is heard, not their sum.
      out[at] = Math.max(out[at], a * heave[at] * env);
    }
  }
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, out[i]);
  for (let i = 0; i < n; i++) out[i] /= top;
  return out;
}

/**
 * One squeak of the tracks, the `k`th of SQUEAK_VARIANTS: steel sticking and
 * slipping on steel (a road wheel's or the idler's rim on the guide horns, a
 * dry pin) so fast that it sings. Measured on a squeaking-tracks sound
 * effect (docs/audio.md, "Straining and squeaking"): a clean, whistling
 * note between about 1.9 and 4.5 kHz with a weaker overtone an octave up,
 * most of them chirps of 40 to 110 ms with a sharp start, and now and then
 * a screech held for half a second or more. The first SQUEAK_CHIRPS are
 * chirps, the rest screeches. Each bends a little as the wheel turns and
 * wavers slightly; nothing chatters (that read as a creaky hinge). Each is
 * its own, the same every time. Peaks at 1. Deterministic.
 */
export function renderSqueak(rate: number, k: number): Samples {
  const random = rng(340 + k);
  const screech = k >= SQUEAK_CHIRPS;
  const seconds = screech ? 0.35 + 0.4 * random() : 0.04 + 0.07 * random();
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  // Chirps spread from 1.9 to 4.5 kHz on a log scale, each nudged; screeches in their own spread.
  const kind = screech ? k - SQUEAK_CHIRPS : k;
  const kinds = screech ? SQUEAK_VARIANTS - SQUEAK_CHIRPS : SQUEAK_CHIRPS;
  const f0 = 1900 * (4500 / 1900) ** ((kind + 0.2 + 0.6 * random()) / kinds);
  // Its bend: up or down by 2 to 7% over a chirp, and a screech sags and recovers.
  const bend = (0.02 + 0.05 * random()) * (random() < 0.5 ? -1 : 1);
  // A screech wavers: a slow vibrato of 0.6 to 1.5% at 5 to 11 Hz.
  const vibratoHz = 5 + 6 * random();
  const vibrato = screech ? 0.006 + 0.009 * random() : 0;
  const attack = screech ? 0.01 + 0.015 * random() : 0.002 + 0.003 * random();
  const release = screech ? 0.04 + 0.04 * random() : 0.008 + 0.012 * random();
  const overtone = 0.25 + 0.2 * random();
  const swellHz = 1 + 1.5 * random();
  let phase = 0;
  let wobble = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const u = i / n;
    const shape = screech ? Math.sin(Math.PI * u) : u;
    // A little roughness from cycle to cycle, far less than a creak's.
    wobble += 0.01 * (random() * 2 - 1 - wobble);
    const f = f0 * (1 + bend * shape) * (1 + vibrato * Math.sin(TAU * vibratoHz * t)) * (1 + 0.15 * wobble);
    phase += (TAU * f) / rate;
    let y = Math.sin(phase);
    if (2 * f < rate * 0.4) y += overtone * Math.sin(2 * phase + 0.7);
    if (3 * f < rate * 0.4) y += 0.08 * Math.sin(3 * phase + 1.9);
    const rise = Math.min(1, t / attack);
    const fall = Math.min(1, (seconds - t) / release);
    // A chirp dies away from its start; a screech swells and holds.
    const body = screech ? 0.75 + 0.25 * Math.sin(TAU * swellHz * t) : Math.exp(-t / (seconds * 0.6));
    out[i] = y * rise * rise * (3 - 2 * rise) * fall * fall * (3 - 2 * fall) * body;
  }
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= top;
  return out;
}

/** The grit loop's length at normal speed (GATE_HZ links a second), s, and how many grains are in it: about four to a link. */
export const GRIT_SECONDS = 4;
export const GRIT_GRAINS = 128;

/**
 * A loop between 0 and 1 for the ground's noise under a track: a grain for
 * every stone crushed or flung, or every tuft torn, at no fixed moment and
 * most of them slight, a few hard. Played as fast as the links come, so at
 * a crawl each crunch is heard and at speed they run into a roar; what it
 * lets through is noise in a band set by the ground. Deterministic.
 */
export function renderGritGate(rate: number): Samples {
  const n = Math.round(GRIT_SECONDS * rate);
  const out = new Float32Array(n);
  const random = rng(304);
  const attack = Math.max(1, Math.round(0.0005 * rate));
  for (let k = 0; k < GRIT_GRAINS; k++) {
    const s = Math.floor(random() * n);
    // Most grains are slight, a few hard.
    const a = 0.3 + 0.7 * random() ** 2;
    const tau = 0.0015 + 0.0055 * random();
    const len = Math.round(tau * 6 * rate);
    // Where two grains land together the harder one is heard, not their sum: no grain is harder than the hardest.
    for (let i = 0; i < len; i++) {
      const at = (s + i) % n;
      out[at] = Math.max(out[at], a * (i < attack ? i / attack : Math.exp(-(i - attack) / rate / tau)));
    }
  }
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, out[i]);
  for (let i = 0; i < n; i++) out[i] /= top;
  return out;
}

// ---------------------------------------------------------------------------
// The cabin.

/** How long the cabin's echo lasts, s. */
export const CABIN_SECONDS = 0.45;

/**
 * What a click sounds like inside the tank, for one ear (`channel` 0 or 1;
 * the two differ, so the echo has width): the first reflections off steel
 * walls a metre or two away, then a short, dense tail that loses its top
 * quickly (a small steel box full of kit and crew), with a few of the
 * hull's own low modes ringing in it. Its energy is 1, so the echo's level
 * is the send's. Everything played into it sounds as if it happened in
 * the tank. Deterministic.
 */
export function renderCabinImpulse(rate: number, channel: 0 | 1): Samples {
  const n = Math.round(CABIN_SECONDS * rate);
  const out = new Float32Array(n);
  const random = rng(401 + channel);
  // The first reflections: walls, roof and floor between 1 and 3 m of path away.
  for (let k = 0; k < 12; k++) {
    const at = 0.003 + 0.016 * ((k + random()) / 12) ** 1.3;
    out[Math.floor(at * rate)] += (random() < 0.5 ? -1 : 1) * (0.55 - 0.03 * k) * (0.7 + 0.6 * random());
  }
  // The tail: noise dying away, its top dying fastest.
  let y = 0;
  const from = Math.floor(0.012 * rate);
  for (let i = from; i < n; i++) {
    const t = i / rate;
    const cutoff = 1200 + 5500 * Math.exp(-t / 0.06);
    y += (1 - Math.exp((-TAU * cutoff) / rate)) * (random() * 2 - 1 - y);
    out[i] += 0.5 * y * Math.exp(-(t - 0.012) / 0.065) * Math.min(1, (i - from) / (0.006 * rate));
  }
  // The box's own ring.
  for (const m of HULL.slice(0, 8)) ring(out, rate, 0.004, m.f * (channel === 0 ? 1 : 1.013), 0.007 * m.a, m.tau * 0.5);
  fadeOut(out, rate, 0.05);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += out[i] * out[i];
  const scale = 1 / Math.sqrt(energy);
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}
