/**
 * The commander's voice (docs/commander-voice.md): the tank commander calls
 * the news over the intercom, in the heat of battle, through a worn
 * interphone. The same notes that go on the crew board (src/sim/crew-board.ts)
 * say a line, so the voice and the board never disagree.
 *
 * Engine-free: the lines and their words, which line each note says, how a
 * fire order is put together from an enemy's bearing, the order calls are
 * spoken in, and the intercom filter's numbers. The lines were generated
 * once (a British voice, made urgent) and John approved every one of them on
 * 15 November 2026; they ship dry in public/audio/commander, and
 * src/systems/commander-voice-system.ts plays them through the filter.
 */

import type { DamageHit } from './damage.js';
import { ON_THE_GUN_DEGREES, type EnemyBearing } from './enemy-guns.js';

const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Every line, by the name its clip is stored under, and what it says. */
export const LINES: Readonly<Record<string, string>> = (() => {
  const lines: Record<string, string> = {
    // The fight: brief and debrief.
    brief: 'Right, lads! Guns dug in on the left, tanks behind them. Use the walls and the smoke. Driver, advance!',
    'won-objective': 'Objective reached! Well done, lads!',
    'won-all': "That's all of them! Well done, lads!",
    lost: "We're knocked out! Bail out! Bail out!",
    repaired: "Repairs done. We're fit to fight.",
    // The enemy.
    'guns-ahead': 'Enemy guns ahead! Watch for their flashes!',
    'tanks-about': 'Enemy tanks! Watch for them moving!',
    'gun-out': "Target! Gun's knocked out!",
    'tank-out': "Target! Tank's knocked out!",
    'all-guns-out': "That's all the guns!",
    'all-tanks-out': "That's the tanks done!",
    // A shot at us: the start of a fire order, then its clock and range.
    'anti-tank-gun': 'Anti-tank gun!',
    'enemy-tank': 'Enemy tank!',
    'traverse-left': 'Gunner, traverse left!',
    'traverse-right': 'Gunner, traverse right!',
    'on-the-gun': 'Gunner, dead ahead!',
    // Hits on us.
    bounced: 'It bounced off us! Keep going!',
    'hit-engine': "We're hit! Engine's hit!",
    'hit-left-track': "We're hit! Left track's gone!",
    'hit-right-track': "We're hit! Right track's gone!",
    'hit-transmission': "We're hit! Transmission's hit!",
    'hit-traverse': "We're hit! Power traverse is out! Crank it by hand!",
    'hit-driver': "Driver's hit! Hang on, driver!",
    'hit-gunner': "Gunner's hit! Stay on the gun!",
    'hit-no-harm': "We're hit! No harm done!",
    // Driving.
    'track-thrown-left': "Left track's off! Hold on while it's refitted!",
    'track-thrown-right': "Right track's off! Hold on while it's refitted!",
    'track-on': "Track's back on. Driver, advance!",
    straining: "Easy on the turn, driver! You'll throw a track!",
    'digging-in': "Easy on the throttle! We're digging in!",
    bogged: "We're bogged! Driver, reverse out!",
    'engine-hot': "Engine's running hot! Ease off!",
    overheating: "Engine's overheating! Stop and let her idle!",
    stalled: "We've stalled! Driver, start her up!",
    'no-power-traverse': 'No power traverse! Crank it by hand!',
  };
  for (let h = 1; h <= 12; h++) lines[`clock-${h}`] = `${cap(NUMBERS[h - 1])} o'clock!`;
  for (let r = 1; r <= 10; r++) lines[`range-${r * 100}`] = r === 10 ? 'One thousand!' : `${cap(NUMBERS[r - 1])} hundred!`;
  return lines;
})();

export const LINE_IDS: readonly string[] = Object.keys(LINES);

/**
 * What the commander says for a note: the lines said as one call (one press
 * of the intercom's switch), or a function that picks them when the call is
 * spoken, so a fire order gives the enemy's bearing from the tank as it is
 * then, not as it was when the note came (a call can wait for the one before).
 */
export type VoiceCue = readonly string[] | (() => readonly string[]);

/** The board's notes that the commander calls, by the sign's title (the driver's and the turret's). */
export const SIGN_LINES: Readonly<Record<string, string>> = {
  'Left track thrown': 'track-thrown-left',
  'Right track thrown': 'track-thrown-right',
  'Track back on': 'track-on',
  'Tracks straining': 'straining',
  'Digging in': 'digging-in',
  'Bogged in the mud': 'bogged',
  'Engine hot': 'engine-hot',
  'Engine overheating': 'overheating',
  'Engine stalled': 'stalled',
  'No power traverse': 'no-power-traverse',
};

/** The line for a driver's or turret sign's title, or none (gears grinding, labouring: the driver hears and feels those). */
export function signCue(title: string): VoiceCue | undefined {
  const id = SIGN_LINES[title];
  return id ? [id] : undefined;
}

/** What a hit did, said first by the worst of it; through with no harm inside, or on the running gear unbroken, is no harm done. */
const HIT_ORDER = ['engine', 'left-track', 'right-track', 'transmission', 'traverse', 'driver', 'gunner'] as const;

export function hitCue(hit: Readonly<DamageHit>): VoiceCue {
  if (hit.zone === 'running-gear') return [hit.through ? (hit.right ? 'hit-right-track' : 'hit-left-track') : 'hit-no-harm'];
  if (!hit.through) return ['bounced'];
  for (const e of HIT_ORDER) if (hit.effects.includes(e)) return [`hit-${e}`];
  return ['hit-no-harm'];
}

/** The spoken range: to the nearest hundred metres, one hundred to one thousand. */
export function rangeLine(metres: number): string {
  return `range-${Math.min(10, Math.max(1, Math.round(metres / 100))) * 100}`;
}

/**
 * A fire order, as a British tank commander gives one: who, which way, what,
 * where on the clock, how far. "Gunner, traverse left! Anti-tank gun! Ten
 * o'clock! Three hundred!" The traverse is the gun's turn to the enemy from
 * where it points (+ left), the clock off the hull's front, as the board's
 * enemy call has them (F3.10's enemyBearing).
 */
export function fireOrder(b: Readonly<EnemyBearing>, tank: boolean): string[] {
  const turn = Math.abs(b.traverse) <= ON_THE_GUN_DEGREES ? 'on-the-gun' : b.traverse > 0 ? 'traverse-left' : 'traverse-right';
  return [turn, tank ? 'enemy-tank' : 'anti-tank-gun', `clock-${b.clock}`, rangeLine(b.range)];
}

/** The fight's brief and debrief. */
export function phaseCue(phase: string, reached: boolean): VoiceCue | undefined {
  if (phase === 'on') return ['brief'];
  if (phase === 'won') return [reached ? 'won-objective' : 'won-all'];
  if (phase === 'lost') return ['lost'];
  return undefined;
}

/**
 * How calls wait their turn. The commander says one call at a time; a call
 * that has waited `STALE_SECONDS` is old news and dropped; no more than
 * `QUEUE_SIZE` wait (the oldest goes); and a call that starts with the
 * line just said or waiting, within `REPEAT_SECONDS`, isn't said again (a
 * knock-out says "Bail out!" for the damage and the debrief both).
 */
export const STALE_SECONDS = 6;
export const QUEUE_SIZE = 3;
export const REPEAT_SECONDS = 8;

/** One call waiting: when it was asked for (s, the page's clock) and what it says. */
export interface QueuedCall {
  at: number;
  cue: VoiceCue;
  /** What the repeat check compares: its first line, or its enemy's for a fire order. */
  first: string;
}

/** The calls waiting to be said, and which were said lately. */
export class CommanderQueue {
  readonly waiting: QueuedCall[] = [];
  /** What was said, newest last: the time each started (s) and its lines, for the tests and the board's hooks. */
  readonly said: { at: number; lines: readonly string[] }[] = [];
  private readonly lately = new Map<string, number>();
  /** Calls asked for since the page loaded (counted even when the voice is off). */
  asked = 0;
  /** The page's clock, s: the queue's own, as the board's clock stops and restarts with a fight or a drill. */
  now: () => number = () => performance.now() / 1000;

  /**
   * Ask for a call; false if it repeats one just said or waiting. `key` is
   * what the repeat check compares, the call's first line by default (a fire
   * order's is its enemy's, as its first line depends on the bearing).
   */
  ask(cue: VoiceCue, key?: string): boolean {
    const now = this.now();
    const first = key ?? (typeof cue === 'function' ? 'call' : cue[0]);
    if (!first) return false;
    const last = this.lately.get(first);
    if (last !== undefined && now - last < REPEAT_SECONDS) return false;
    this.lately.set(first, now);
    this.asked++;
    this.waiting.push({ at: now, cue, first });
    while (this.waiting.length > QUEUE_SIZE) this.waiting.shift();
    return true;
  }

  /** The next call to say, its lines picked now, or null: stale calls are dropped on the way. */
  next(): readonly string[] | null {
    const now = this.now();
    while (this.waiting.length > 0) {
      const call = this.waiting.shift()!;
      if (now - call.at > STALE_SECONDS) continue;
      const lines = typeof call.cue === 'function' ? call.cue() : call.cue;
      if (lines.length === 0) continue;
      this.said.push({ at: now, lines });
      if (this.said.length > 20) this.said.shift();
      return lines;
    }
    return null;
  }

  clear(): void {
    this.waiting.length = 0;
    this.lately.clear();
  }
}

/** The one queue on this page: notes ask, CommanderVoiceSystem says. */
export const commander = new CommanderQueue();

/** True while the commander is speaking (the system sets it): the tank's sounds duck under him as under the crew's voices. */
export const commanderSpeaking = { now: false };

/**
 * The intercom (docs/commander-voice.md): a Sherman's interphone had a throat
 * microphone and headphones in the crew's helmets. No low end, no
 * sibilants, a nasal hump in the middle, the amplifier driven into soft
 * clipping, and hiss and crackle while the switch is pressed; a click as it
 * is pressed and a burst of hash as it is let go. John chose this heavy
 * setting over a lighter one on 14 November 2026.
 */
export const INTERCOM = {
  /** The band the voice gets through, Hz (4th-order each side). */
  low: 450,
  high: 2500,
  /** The nasal hump: centre, Hz, gain, dB, and Q. */
  hump: { hz: 1300, db: 8, q: 1.2 },
  /** How hard the amplifier is driven into its soft clip (tanh). */
  drive: 7,
  /** After the clip, a low pass this far over the band's top. */
  afterClip: 1.15,
  /** The hiss under the voice while keyed, dB under the voice's peak, its band, Hz, and its flutter (a loose connection). */
  hissDb: -30,
  hissBand: [500, 4000] as const,
  flutterHz: 7.3,
  flutter: 0.25,
  /** Crackles a second while keyed. */
  crackle: 9,
  /** The switch: the hiss starts this long before the first word and runs this long after the last, s. */
  pre: 0.12,
  post: 0.18,
  /** The click's pitch, Hz, and the hash burst's length, s, as the switch is let go. */
  clickHz: 1700,
  hash: 0.16,
  /** The gap between the parts of one call (a fire order's), s. */
  join: 0.06,
} as const;

/** A call's length on the air, s: the switch's lead-in, the parts and their joins, the tail and the hash. */
export function callSeconds(parts: readonly number[]): number {
  const words = parts.reduce((sum, d) => sum + d, 0) + Math.max(0, parts.length - 1) * INTERCOM.join;
  return INTERCOM.pre + words + INTERCOM.post + INTERCOM.hash;
}
