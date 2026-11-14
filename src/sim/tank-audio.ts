/**
 * The tank's sounds (F1.12, rebuilt in F6.1; docs/audio.md), engine-free:
 * what the continuous sounds do with the engine's RPM and load, the tracks'
 * speeds, the turret's turn and the gunner's handwheels; when a change in
 * the tank's state makes a short sound; how far the mix ducks while
 * someone speaks on the intercom; and where in the tank each sound comes
 * from. The samples themselves are rendered in src/sim/sound-render.ts and
 * played by TankSoundGraph (src/systems/tank-sound-graph.ts).
 *
 * The tank is an M4A4 Sherman, so the numbers are a Sherman's: Chrysler's
 * A57 multibank petrol engine (five six-cylinder banks, thirty cylinders),
 * a five-speed gearbox and final drives beside the driver, steel tracks of
 * six-inch links, and an electric power traverse.
 */
import { GUN } from './cabin.js';
import { MAX_SPEED, MAX_TRAVERSE, MAX_YAW_RATE } from './comfort.js';
import { THROW_LIMIT } from './going.js';
import { createFooting, footingBetween, SURFACE_SOUND, type Footing, type Surface, type SurfaceSound } from './ground-surface.js';
import { CASING_BIN, LEVER_CLOSED } from './loading.js';
import { rng } from './random.js';
import { IDLE_RPM, MAX_RPM, TRACK_GAUGE } from './tank-drive.js';

/**
 * The short sounds: a gear going in, the gears grinding (a loop), the gun,
 * the breech closing and opening by hand, the casing in the bin, a shell
 * rammed home, the hull bumping into something; and the engine's (F1.17):
 * the starter cranking (a loop), the engine catching, a cough and a stall.
 */
export const SOUND_IDS = ['clunk', 'grind', 'shot', 'breech', 'latch', 'casing', 'ram', 'bump', 'crank', 'catch', 'cough', 'stall'] as const;
/** The short sounds that loop while something lasts, rather than dying away. */
export const LOOPED: readonly SoundId[] = ['grind', 'crank'];
export type SoundId = (typeof SOUND_IDS)[number];

/**
 * The mix, linear gains into the tank's bus (before the duck and the
 * player's Tank sounds setting). The gun is the loudest thing in the tank
 * and the engine sits under everything; the short sounds are rendered at
 * these peaks.
 */
export const MIX = {
  engine: 0.4,
  roar: 0.095,
  gearbox: 0.011,
  finalDrive: 0.035,
  rumble: 0.21,
  clatter: 0.4,
  grit: 0.3,
  strain: 0.8,
  squeak: 0.3,
  whine: 0.03,
  traverseGear: 0.3,
  traverseRumble: 0.09,
  handGear: 0.3,
  grind: 0.3,
  clunk: 0.55,
  shot: 0.95,
  breech: 0.5,
  latch: 0.25,
  casing: 0.28,
  ram: 0.35,
  bump: 0.5,
  crank: 0.32,
  catch: 0.5,
  cough: 0.42,
  stall: 0.45,
  siren: 0.16,
} as const;

/** How long each short sound lasts, s (the grind and the crank are loops this long, a whole number of their beats). */
export const SOUND_SECONDS: Record<SoundId, number> = {
  clunk: 0.5,
  grind: 0.5,
  shot: 3.2,
  breech: 0.7,
  latch: 0.45,
  casing: 1.4,
  ram: 0.4,
  bump: 0.9,
  crank: 0.5,
  catch: 1.2,
  cough: 0.4,
  stall: 1.3,
};

/**
 * The starter turns the engine at 160 rpm: each six-cylinder bank comes up
 * on compression three times a turn, eight times a second. A whole number
 * of them fits the crank's loop, so it loops without a click.
 */
export const CRANK_BEAT_HZ = 8;
/** The grind's tooth beat, Hz: a whole number of beats in its loop. */
export const GRIND_TEETH_HZ = 60;

/**
 * The engine: Chrysler's A57 multibank, a petrol engine of five
 * six-cylinder banks geared to one shaft. Each bank fires three times a
 * turn, so a bank's beat is 40 Hz at idle and 130 Hz flat out, and all
 * thirty cylinders together fire five times as often: a smooth, deep
 * burble, nothing like a diesel's knock. Its exhaust is one rendered loop
 * (`renderEngineLoop`) played as fast as the engine turns, through filters
 * that don't move with the revs.
 */
export const IDLE_REV_HZ = IDLE_RPM / 60;
/** One bank's firings a second at idle and at top RPM. */
export const ENGINE_IDLE_HZ = bankHz(IDLE_RPM);
export const ENGINE_TOP_HZ = bankHz(MAX_RPM);
/** The gearbox's gears mesh this many times for each turn of the engine: its whine's pitch. */
export const GEARBOX_TEETH = 19;
/** The final drives' whine, Hz for each m/s of track speed: about 250 Hz flat out. */
export const FINAL_DRIVE_HZ_PER_MS = 26;
/** The track links are this far apart, m (six inches): the clatter's rate is the track speed over this. */
export const LINK_PITCH = 0.15;
/** A handwheel's gears tick this many times a turn. */
export const HAND_TICKS_PER_TURN = 14;

/** While either player speaks the tank's sounds drop this far, dB (concept §6: the intercom stays clear). It was −6 dB until John's play test (2026-11-07): the output really did drop 6 dB, but under a voice nobody could hear it. */
export const DUCK_DB = -12;
/** A voice's RMS level (0 to 1) at or above this counts as speaking; Chromium's noise suppression leaves the room below it. */
export const SPEAKING_LEVEL = 0.01;
/** Speech keeps the duck this long after the last loud moment, s, so it doesn't pump between words. */
export const DUCK_HOLD = 0.35;
/** How fast the duck comes in and lets go, s (time constants). */
export const DUCK_ATTACK = 0.05;
export const DUCK_RELEASE = 0.4;

/**
 * The gun's blast: for a moment after a shot the crew hear little else.
 * The engine, tracks and turret drop to BLAST_DIP of their level within
 * BLAST_ATTACK s and come back over BLAST_RECOVER (a time constant, s).
 */
export const BLAST_DIP = 0.3;
export const BLAST_ATTACK = 0.012;
export const BLAST_HOLD = 0.12;
export const BLAST_RECOVER = 0.5;

/**
 * How much of each kind of sound goes through the cabin's echo
 * (src/sim/sound-render.ts's renderCabinImpulse). For the placed sounds
 * (the engine, each track's links, the turret's gear and the knocks from a
 * place) the echo is also how they reach the crew from all round, as most
 * of a sound does in a steel box; the sounds from nowhere in particular
 * (the rumble through the floor, a bump, the gun) are played straight as
 * well, and need less of it.
 */
export const CABIN_SEND = { engine: 0.34, tracks: 0.34, turret: 0.38, knocks: 0.45, hull: 0.08, blows: 0.4, shot: 0.55 } as const;

/** The lever counts as closed (or opened) crossing this angle, rad: a little short of latched, so the crewmate's smoothed copy crosses it too. */
export const BREECH_CLOSED_AT = LEVER_CLOSED - 0.05;
/** The breech opens by itself after a shot: no hand-opening sound for this long after one, s (the crewmate's copy of the lever comes late). */
export const AUTO_OPEN_WINDOW = 1.2;

export const dbToGain = (db: number): number => 10 ** (db / 20);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One bank's firings a second at `rpm`: three a turn. */
export function bankHz(rpm: number): number {
  return (rpm / 60) * 3;
}

// ---------------------------------------------------------------------------
// Where the sounds come from.

/**
 * Where in the tank each group of sounds is heard from, m: hull space, but
 * for `breech`, `bin` and `traverse`, which turn with the turret (turret
 * space). The engine is behind the bulkhead; the gearbox and final drives
 * are in the nose, right of the driver; each track's sprocket is at the
 * front corner; the siren is on the left front mudguard.
 */
export const SOUND_PLACES = {
  engine: [0, 0.9, 2.6],
  gearbox: [0.15, 0.55, -1.9],
  leftTrack: [-1.45, 0.35, -1.6],
  rightTrack: [1.45, 0.35, -1.6],
  siren: [-1.1, 1.3, -2.6],
  breech: [0, GUN.y, GUN.breechBack],
  bin: [CASING_BIN.x, 0.75, CASING_BIN.z],
  traverse: [0.55, 1.1, -0.75],
} as const;
export type SoundPlace = keyof typeof SOUND_PLACES;
/** The places that turn with the turret. */
export const TURRET_PLACES: readonly SoundPlace[] = ['breech', 'bin', 'traverse'];
/**
 * How much of a placed sound comes from its place; the rest reaches the
 * crew through the cabin's echo (CABIN_SEND), from all round.
 */
export const PLACED_SHARE = 0.7;
/** Which place each short sound is heard from (the gun's blast and a bump come through the whole hull, so from nowhere). */
export const SOUND_FROM: Record<SoundId, SoundPlace | null> = {
  clunk: 'gearbox',
  grind: 'gearbox',
  shot: null,
  breech: 'breech',
  latch: 'breech',
  casing: 'bin',
  ram: 'breech',
  bump: null,
  crank: 'engine',
  catch: 'engine',
  cough: 'engine',
  stall: 'engine',
};

// ---------------------------------------------------------------------------
// The continuous sounds.

/** The engine's sound at an RPM and a load: how fast its exhaust loop plays, how open its filter is, how loud, and how much it roars. */
export interface EngineVoice {
  /** One bank's firing beat, Hz. */
  freq: number;
  /** The rendered loop's playback rate (1 at idle). */
  rate: number;
  /** The exhaust's low-pass cutoff, Hz: muffled by the silencers and the hull, opening up under load. */
  cutoff: number;
  /** The exhaust's level, 0 to 1, before MIX.engine. */
  gain: number;
  /** The roar of the fan, the intakes and the burning itself, 0 to 1, before MIX.roar. */
  roar: number;
}

export function createEngineVoice(): EngineVoice {
  return { freq: 0, rate: 1, cutoff: 0, gain: 0, roar: 0 };
}

/** How far the revs are from idle to top, 0 to 1. */
export function revs(rpm: number): number {
  return clamp01((rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM));
}

/**
 * `load` is how far the throttle is open, 0 to 1: an engine pulling is
 * louder and harder-edged than one spinning at the same revs with the
 * throttle shut. Below idle (a stopped engine running down, F1.17) the
 * beat slows and fades with the revs, to silence stopped; the starter's
 * own sound is the 'crank'.
 */
export function engineVoice(rpm: number, load: number, out: EngineVoice): EngineVoice {
  const r = revs(rpm);
  const alive = clamp01(rpm / IDLE_RPM);
  const pull = clamp01(load);
  out.freq = bankHz(rpm);
  out.rate = Math.max(0.15, rpm / IDLE_RPM);
  out.cutoff = 300 + 240 * r + 260 * pull;
  out.gain = (0.42 + 0.23 * r + 0.35 * pull) * alive * alive;
  out.roar = (0.1 + 0.5 * r * r + 0.4 * pull * (0.3 + 0.7 * r)) * alive * alive;
  return out;
}

/** The gears' whine: the gearbox's with the engine, the final drives' with the tracks. */
export interface DriveVoice {
  /** The gearbox's whine, Hz, and its level, 0 to 1, before MIX.gearbox. */
  gearboxHz: number;
  gearbox: number;
  /** The final drives' whine, Hz, and its level, 0 to 1, before MIX.finalDrive. */
  finalHz: number;
  final: number;
}

export function createDriveVoice(): DriveVoice {
  return { gearboxHz: 0, gearbox: 0, finalHz: 0, final: 0 };
}

/**
 * Straight-cut gears whine, and a Sherman's are at the driver's elbow. The
 * gearbox turns with the engine: quiet out of gear, louder in one and
 * louder still pulling. The final drives turn with the tracks, so their
 * note follows the speed (`speed` is the tracks' mean, m/s).
 */
export function driveVoice(rpm: number, speed: number, inGear: boolean, load: number, out: DriveVoice): DriveVoice {
  const alive = clamp01(rpm / IDLE_RPM);
  const pull = clamp01(load);
  out.gearboxHz = Math.max(20, (rpm / 60) * GEARBOX_TEETH);
  out.gearbox = (inGear ? 0.4 + 0.6 * pull : 0.15) * (0.4 + 0.6 * revs(rpm)) * alive;
  const v = Math.abs(speed);
  out.finalHz = Math.max(20, v * FINAL_DRIVE_HZ_PER_MS);
  out.final = v < 0.2 ? 0 : clamp01(v / MAX_SPEED) ** 0.8 * (0.6 + 0.4 * pull);
  return out;
}

/**
 * The siren (F1.17): a motor siren's wail, rising to SIREN_HZ over a
 * second or so while the button is held and running down, fading, when
 * let go. The target pitch and level for `on`, and how fast each glides (s).
 */
export const SIREN_HZ = 620;
export const SIREN_REST_HZ = 120;
export function sirenVoice(on: boolean, out: { freq: number; gain: number; glide: number }): { freq: number; gain: number; glide: number } {
  out.freq = on ? SIREN_HZ : SIREN_REST_HZ;
  out.gain = on ? 1 : 0;
  out.glide = on ? 0.45 : 0.7;
  return out;
}

/**
 * One track's links: how many meet the sprocket a second, and how loud, 0
 * to 1, before MIX.clatter. What the track is on (src/sim/ground-surface.ts)
 * sets how much of the links' lower and upper ring and of their thud is
 * heard (1 on a dirt road), and the ground's own noise under them: its
 * level, 0 to 1, before MIX.grit, and where it lies, Hz. In a hard turn the
 * track strains: how hard, 0 to 1, before MIX.strain.
 */
export interface LinkVoice {
  hz: number;
  gain: number;
  ring: number;
  top: number;
  thud: number;
  grit: number;
  gritHz: number;
  strain: number;
}

function createLinkVoice(): LinkVoice {
  return { hz: 0, gain: 0, ring: 1, top: 1, thud: 1, grit: 0, gritHz: SURFACE_SOUND.dirt.gritHz, strain: 0 };
}

/**
 * The tracks' sound at their speeds: a low rumble through the floor, each
 * track's links clattering round its sprocket, the tracks straining in a
 * hard turn at speed, and now and then a dry pin squeaking.
 */
export interface TrackVoice {
  /** 0 to 1, before MIX.rumble. */
  rumble: number;
  /** The rumble's low-pass cutoff, Hz. */
  rumbleCutoff: number;
  left: LinkVoice;
  right: LinkVoice;
  /** The two tracks' mean, for the menu and the tests. */
  clatter: number;
  clatterHz: number;
  /** The sideways push on the tracks, m/s² (src/sim/going.ts), and how hard it strains them, 0 to 1 (each track's share is its `strain`). */
  side: number;
  strain: number;
  /** How fast the strained tracks judder against the wheels and the ground: the rendered judder's playback rate. */
  judder: number;
  /** How many pins squeak a second, on average, and how loud, 0 to 1, before MIX.squeak. */
  squeaks: number;
  squeak: number;
}

export function createTrackVoice(): TrackVoice {
  return {
    rumble: 0,
    rumbleCutoff: 0,
    left: createLinkVoice(),
    right: createLinkVoice(),
    clatter: 0,
    clatterHz: 0,
    side: 0,
    strain: 0,
    judder: 1,
    squeaks: 0,
    squeak: 0,
  };
}

/**
 * The tracks are heard straining from this sideways push, m/s², and at
 * their hardest at THROW_LIMIT, where a track starts to come off
 * (src/sim/going.ts; the sign that the tracks are straining comes at
 * THROW_WARN, about two thirds of the way). Flat out, any real turn gets
 * there; at 14 km/h a turn on one tiller is about a third of the way.
 */
export const STRAIN_FROM = 0.3;
/** The tracks strain fully only moving at least this fast, m/s: a tank leaning on a slope at rest scrubs nothing. */
export const STRAIN_MOVING = 1;
/** The inner track in a turn carries this share of the outer (faster) one's strain: the hull's weight leans out onto the outer track. */
export const STRAIN_INNER = 0.6;
/**
 * The pins squeak, on average, SQUEAK_BASE times a second driving straight
 * at a walk, a little more at speed (SQUEAK_SPEED flat out), more in a turn
 * (SQUEAK_STEER with the tracks 3 m/s apart) and far more straining
 * (SQUEAK_STRAIN at full strain); never below SQUEAK_MOVING m/s. Each
 * surface's `squeak` scales it: a track slips quietly on turf and bites on
 * a road.
 */
export const SQUEAK_BASE = 0.35;
export const SQUEAK_SPEED = 0.3;
export const SQUEAK_STEER = 0.8;
export const SQUEAK_STRAIN = 2.4;
export const SQUEAK_MOVING = 0.3;
/** How many squeaks are rendered (src/sim/sound-render.ts's renderSqueak): each a different pin, none twice running. */
export const SQUEAK_VARIANTS = 8;

/** The sideways push of a turn on tracks running at these speeds, m/s²: the hull's speed times its turn rate (sidePush in src/sim/going.ts, without a slope or mud). */
export function turnPush(leftTrack: number, rightTrack: number): number {
  const speed = (leftTrack + rightTrack) / 2;
  const yaw = Math.max(-MAX_YAW_RATE, Math.min(MAX_YAW_RATE, (rightTrack - leftTrack) / TRACK_GAUGE));
  return Math.abs(speed * yaw);
}

function linkVoice(track: number, ground: SurfaceSound, out: LinkVoice): void {
  const v = Math.abs(track);
  const f = clamp01(v / MAX_SPEED);
  out.hz = v / LINK_PITCH;
  out.gain = clamp01(f * 4) * (0.6 + 0.4 * f);
  out.ring = ground.ring;
  out.top = ground.top;
  out.thud = ground.thud;
  // The ground is crushed as often as the links land on it, and as hard.
  out.grit = ground.grit * out.gain;
  out.gritHz = ground.gritHz;
}

/**
 * From each track's speed, m/s (a pivot turn, tracks running opposite
 * ways, rumbles too), what each is on (a dirt road if not said: what the
 * tracks were tuned on), and the sideways push on them, m/s² (a turn's,
 * from the tracks' speeds, if not said; the drive's own `side` also has a
 * slope's lean and mud in it). A hard turn at speed drags the tracks
 * sideways: they groan against the wheels and scrub the ground, the outer
 * one most. Pins squeak now and then whenever the tank moves, more in a
 * turn and far more straining. The rumble and the squeaks come from both
 * tracks together, so they take the two grounds' mean.
 */
export function trackVoice(
  leftTrack: number,
  rightTrack: number,
  out: TrackVoice,
  leftGround: SurfaceSound = SURFACE_SOUND.dirt,
  rightGround: SurfaceSound = SURFACE_SOUND.dirt,
  side: number = turnPush(leftTrack, rightTrack),
): TrackVoice {
  const v = (Math.abs(leftTrack) + Math.abs(rightTrack)) / 2;
  const f = clamp01(v / MAX_SPEED);
  out.rumble = f ** 0.7 * ((leftGround.rumble + rightGround.rumble) / 2);
  out.rumbleCutoff = (140 + 500 * f) * ((leftGround.rumbleOpen + rightGround.rumbleOpen) / 2);
  linkVoice(leftTrack, leftGround, out.left);
  linkVoice(rightTrack, rightGround, out.right);
  out.clatter = (out.left.gain + out.right.gain) / 2;
  out.clatterHz = (out.left.hz + out.right.hz) / 2;
  out.side = side;
  out.strain = clamp01((side - STRAIN_FROM) / (THROW_LIMIT - STRAIN_FROM)) * clamp01(v / STRAIN_MOVING);
  // The outer track is the faster one (the turn's way); running straight (a slope's lean, mud) both strain alike.
  const turn = Math.abs(rightTrack) - Math.abs(leftTrack);
  out.left.strain = out.strain * (turn > 0.01 ? STRAIN_INNER : 1);
  out.right.strain = out.strain * (turn < -0.01 ? STRAIN_INNER : 1);
  out.judder = 0.8 + 0.5 * out.strain + 0.4 * f;
  const steer = clamp01(Math.abs(leftTrack - rightTrack) / 3);
  const squeaky = (leftGround.squeak + rightGround.squeak) / 2;
  out.squeaks = v < SQUEAK_MOVING ? 0 : (SQUEAK_BASE + SQUEAK_SPEED * f + SQUEAK_STEER * steer + SQUEAK_STRAIN * out.strain) * squeaky;
  out.squeak = v < SQUEAK_MOVING ? 0 : (0.6 + 0.4 * Math.max(steer, out.strain)) * Math.min(1, squeaky);
  return out;
}

/** One squeak: from which track (0 left, 1 right), which of the rendered squeaks, and how loud, 0 to 1, before MIX.squeak. */
export interface Squeak {
  side: 0 | 1;
  variant: number;
  level: number;
}

export function createSqueak(): Squeak {
  return { side: 0, variant: 0, level: 0 };
}

/**
 * When the pins squeak: at random, `squeaks` a second on average (a
 * Poisson process), each from one track (the faster or more strained one
 * more often), a different pin from the last, no two as loud. Each page
 * hears its own (nothing is sent: squeaks are no event either crew acts
 * on). Seeded, so the tests and the preview are the same each run.
 * Allocation free.
 */
export class SqueakTimer {
  private readonly random: () => number;
  private last = -1;

  constructor(seed = 311) {
    this.random = rng(seed);
  }

  /** Whether a squeak comes in the `dt` s just gone at the tracks' voice `k`, and if so which, into `out`. */
  step(dt: number, k: TrackVoice, out: Squeak): boolean {
    if (k.squeaks <= 0 || dt <= 0) return false;
    if (this.random() >= 1 - Math.exp(-k.squeaks * dt)) return false;
    const left = k.left.gain + 2 * k.left.strain;
    const right = k.right.gain + 2 * k.right.strain;
    out.side = this.random() * (left + right) < left ? 0 : 1;
    let variant = Math.floor(this.random() * (SQUEAK_VARIANTS - 1));
    if (this.last >= 0 && variant >= this.last) variant++;
    out.variant = variant;
    this.last = variant;
    out.level = k.squeak * (0.45 + 0.55 * this.random());
    return true;
  }
}

/** The power traverse's sound from the turret's rate: its electric motor's whine, the gear train's growl and the ring rumbling round. */
export interface TraverseVoice {
  /** The motor's whine, Hz, and its level, 0 to 1, before MIX.whine. */
  freq: number;
  gain: number;
  /** The gear train's growl, 0 to 1, before MIX.traverseGear, and its teeth's beat, Hz. */
  gear: number;
  meshHz: number;
  /** The turret ring's rumble, 0 to 1, before MIX.traverseRumble. */
  rumble: number;
}

export function createTraverseVoice(): TraverseVoice {
  return { freq: 0, gain: 0, gear: 0, meshHz: 0, rumble: 0 };
}

/** From the turret's power traverse rate, rad/s: silent at rest, everything rising with the speed either way. */
export function traverseVoice(rate: number, out: TraverseVoice): TraverseVoice {
  const r = clamp01(Math.abs(rate) / MAX_TRAVERSE);
  const on = r > 0.01;
  out.freq = 110 + 430 * r;
  out.gain = on ? 0.35 + 0.65 * r : 0;
  out.meshHz = 8 + 125 * r;
  out.gear = on ? 0.3 + 0.7 * r : 0;
  out.rumble = on ? r : 0;
  return out;
}

/**
 * The gunner's handwheels (the traverse crank and the elevation wheel):
 * their gears tick as they turn, HAND_TICKS_PER_TURN a turn. From how fast
 * each is turning, turns a second.
 */
export function handGearVoice(crankTurns: number, wheelTurns: number, out: { hz: number; gain: number }): { hz: number; gain: number } {
  const ticks = (Math.abs(crankTurns) + Math.abs(wheelTurns)) * HAND_TICKS_PER_TURN;
  out.hz = Math.min(60, ticks);
  out.gain = ticks < 0.5 ? 0 : clamp01(ticks / 10) ** 0.5;
  return out;
}

/** What the tank is doing at one moment of the sound tour. */
export interface TourState {
  rpm: number;
  /** How far the throttle is open, 0 to 1. */
  load: number;
  /** Each track's speed, m/s. */
  left: number;
  right: number;
  inGear: boolean;
  /** The power traverse's rate, rad/s. */
  traverse: number;
  /** The traverse crank and the elevation wheel, turns a second. */
  crank: number;
  wheel: number;
  /** What each track is on. */
  leftGround: Footing;
  rightGround: Footing;
}

export function createTourState(): TourState {
  return { rpm: IDLE_RPM, load: 0, left: 0, right: 0, inGear: false, traverse: 0, crank: 0, wheel: 0, leftGround: createFooting(), rightGround: createFooting() };
}

/** How long the sound tour lasts, s. */
export const TOUR_SECONDS = 37;

/**
 * The ground the tour's tank crosses once it is up to speed, each with the
 * time, s, its left track starts onto it: from the dirt road it pulled
 * away on, over the verge onto grass, onto the course's gravel and back
 * to the road. A track takes TOUR_CROSSING s to cross over, and the right
 * track follows the left TOUR_BEHIND s later, so for that long the two
 * are on different ground.
 */
export const TOUR_GROUND: readonly (readonly [number, Surface])[] = [
  [17, 'grass'],
  [20.5, 'gravel'],
  [24, 'dirt'],
];
export const TOUR_CROSSING = 0.5;
export const TOUR_BEHIND = 1.2;

/** What a track of the tour's tank is on, `t` s in. */
function tourGround(t: number, out: Footing): Footing {
  let from: Surface = 'dirt';
  for (let i = 0; i < TOUR_GROUND.length; i++) {
    const [at, to] = TOUR_GROUND[i];
    const next = i + 1 < TOUR_GROUND.length ? TOUR_GROUND[i + 1][0] : Infinity;
    if (t < next) return footingBetween(from, to, (t - at) / TOUR_CROSSING, out);
    from = to;
  }
  return footingBetween(from, from, 0, out);
}

/** 0 before `a`, 1 after `b`, easing between. */
function ease(t: number, a: number, b: number): number {
  const u = clamp01((t - a) / (b - a));
  return u * u * (3 - 2 * u);
}

/**
 * Practice → Tank sounds → Run through: the continuous sounds without
 * driving or laying the gun, `t` s in. The engine idles, is revved out of
 * gear and let fall; the tank pulls away up a dirt road through the gears
 * to top speed, runs off onto grass, onto gravel and back to the road
 * (TOUR_GROUND; the left track first each time), turns left, and slows to
 * a halt; the turret traverses under power one way and slowly back; then
 * the traverse crank and the elevation wheel are turned by hand. The
 * preview clips are rendered from it too.
 */
export function soundTour(t: number, out: TourState): TourState {
  out.rpm = IDLE_RPM;
  out.load = 0;
  out.left = out.right = 0;
  out.inGear = false;
  out.traverse = out.crank = out.wheel = 0;
  tourGround(t, out.leftGround);
  tourGround(t - TOUR_BEHIND, out.rightGround);
  if (t < 9) {
    // Idle, then a rev out of gear.
    const up = ease(t, 3, 5.5) - ease(t, 6, 8.5);
    out.rpm = IDLE_RPM + (2400 - IDLE_RPM) * up;
    out.load = t >= 3 && t < 6 ? 0.9 : 0;
  } else if (t < 29) {
    // Pulling away: four changes up on the way to top speed, each letting the revs fall back; then over the grass and the gravel at a steady speed.
    const speed = MAX_SPEED * 0.9 * (ease(t, 9, 16.5) - ease(t, 26.5, 29));
    const climbing = t < 16.5;
    const gear = Math.min(4.999, ((t - 9) / 7.5) * 5);
    const inThis = gear - Math.floor(gear);
    out.rpm = climbing ? 1300 + 1200 * inThis : t < 26.5 ? 2300 : IDLE_RPM + 1500 * (1 - ease(t, 26.5, 29));
    out.load = climbing ? (inThis < 0.08 ? 0.1 : 0.9) : t < 26.5 ? 0.55 : 0;
    out.inGear = true;
    // A hard turn to the left at speed, back on the road: the left track held back (turning at the 15°/s the drive
    // allows), the tracks straining as hard as they can without one coming off.
    const turn = ease(t, 24.5, 25.1) - ease(t, 26.1, 26.7);
    out.left = speed * (1 - 0.1 * turn);
    out.right = speed * (1 + 0.1 * turn);
  } else if (t < 34) {
    // The power traverse: up to full speed, a stop, and slowly back.
    out.rpm = 1400;
    out.load = 0.2;
    out.traverse = MAX_TRAVERSE * (ease(t, 29.3, 30.3) - ease(t, 31.3, 31.9)) - 0.3 * MAX_TRAVERSE * (ease(t, 32.2, 32.6) - ease(t, 33.4, 33.8));
  } else {
    // By hand: the traverse crank, then the elevation wheel.
    out.crank = 1.5 * (ease(t, 34, 34.3) - ease(t, 35.2, 35.5));
    out.wheel = 2 * (ease(t, 35.5, 35.8) - ease(t, 36.6, 36.9));
  }
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
  /** The engine runs, and its stall and cough counts (TankDrive, F1.17). */
  running: boolean;
  stalls: number;
  coughs: number;
}

/** Which short sounds this frame's changes make. */
export interface Cues {
  clunk: boolean;
  bump: boolean;
  breech: boolean;
  latch: boolean;
  ram: boolean;
  catch: boolean;
  cough: boolean;
  stall: boolean;
}

export function createCues(): Cues {
  return { clunk: false, bump: false, breech: false, latch: false, ram: false, catch: false, cough: false, stall: false };
}

/**
 * Turns changes in the tank's state into short sounds, the same on both
 * pages since each reads the tank and the loading as it draws them: a gear
 * going in clunks, a bump thuds, the lever closing slams the breech and
 * opening it by hand unlatches it, a shell going home thunks; the engine
 * catching fires up, and each cough and stall is heard (F1.17). The first
 * frame only takes note. Allocation free.
 */
export class SoundCues {
  private primed = false;
  private gear = 0;
  private bumps = 0;
  private closed = false;
  private rammed = false;
  private running = false;
  private stalls = 0;
  private coughs = 0;

  /** `sinceShot` is how long ago the gun fired, s: the breech opening by itself then makes no sound of its own (the shot has it). */
  step(s: CueState, sinceShot: number, out: Cues): Cues {
    const closed = s.lever >= BREECH_CLOSED_AT;
    out.clunk = this.primed && s.gear !== 0 && s.gear !== this.gear && !s.grinding;
    out.bump = this.primed && s.bumps > this.bumps;
    out.breech = this.primed && closed && !this.closed;
    out.latch = this.primed && !closed && this.closed && !(sinceShot < AUTO_OPEN_WINDOW);
    out.ram = this.primed && s.rammed && !this.rammed;
    out.catch = this.primed && s.running && !this.running;
    out.stall = this.primed && s.stalls !== this.stalls && !s.running;
    out.cough = this.primed && s.coughs !== this.coughs && !out.stall;
    // Neutral while grinding isn't a shift: the clunk comes when the gear goes in.
    if (!s.grinding) this.gear = s.gear;
    this.bumps = s.bumps;
    this.closed = closed;
    this.rammed = s.rammed;
    this.running = s.running;
    this.stalls = s.stalls;
    this.coughs = s.coughs;
    this.primed = true;
    return out;
  }
}
