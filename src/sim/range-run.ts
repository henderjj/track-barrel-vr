/**
 * The range run (F1.11, docs/range-run.md): the concept's play-test
 * question "how long does a pair take to hit three targets?" as a timed
 * run. Start it and the tank goes back to the start; after a short
 * countdown the clock runs until each of the range's three targets has been
 * hit at least once, then stops on the crew's time. Shots and hits only
 * count while the clock runs.
 *
 * Its second mode is the biathlon race (F5.3b, docs/biathlon-race.md):
 * three laps of F5.3a's course, three rounds at each of two firing lines,
 * a penalty loop owed for each board left standing. The host feeds it the
 * course's progress (`course`) as well as the shots; its numbers and words
 * are src/sim/biathlon.ts's.
 *
 * Engine-free: the host keeps the run (it decides hits, plan §4.6) and
 * sends it to the guest as a reliable event; the guest keeps a copy and
 * moves its clock on between events. Allocates nothing per frame.
 */

import {
  boardOf,
  boardsDown,
  BOARDS_PER_LINE,
  finishNote,
  lineClosed,
  lineFor,
  lineNote,
  loopNote,
  penaltySeconds,
  RACE,
  raceClockLines,
  raceLine,
  raceStartSign,
  skippedNote,
} from './biathlon.js';
import { clampLineRange, COURSE_TARGETS, LINE_RANGES } from './course.js';
import { RANGE_TARGETS, targetBoard, targetFoot } from './range.js';

/** The countdown before the clock starts, s. */
export const RUN_COUNTDOWN = 3;
/** How long "Go!" and the finish stay on the sign, s. */
export const GO_SECONDS = 1.5;
export const FINISH_SECONDS = 8;
/** Hits on their way (a shell takes up to a second to reach the 500 m target): more than ever fly at once. */
const PENDING = 8;

export type RunPhase = 'idle' | 'running' | 'done';
export const RUN_PHASES: readonly RunPhase[] = ['idle', 'running', 'done'];
/** The range run's two modes: the three range targets against the clock (F1.11), or the biathlon race (F5.3b). */
export type RunMode = 'range' | 'biathlon';
export const RUN_MODES: readonly RunMode[] = ['range', 'biathlon'];

/** What the host feeds a race of the course's progress (F5.3a's CourseSnapshot has these; `faults` since F5.3d). */
export interface CourseFeed {
  laps: number;
  missed: number;
  penalties: number;
  box: number;
  halted: boolean;
  faults: number;
}

/** What the host sends and the guest copies. Times are on the run's clock, s; -1 for a target not hit yet, or no time. */
export interface RunSnapshot {
  /** Runs started so far: a new id is a fresh start. */
  id: number;
  phase: RunPhase;
  /** Seconds since Go (negative during the countdown). */
  clock: number;
  /** The crewmate stepped away or is reconnecting: the clock stands still. */
  paused: boolean;
  /** Shots fired while the clock ran. */
  shots: number;
  /** When each target was first hit (its shell landed), or -1. */
  hitAt: number[];
  /** The crew's time once all three were hit, or -1. */
  time: number;
  /** The best unassisted time this session, or -1. */
  best: number;
  /** A Practice shortcut (Ready to fire) was used during this run: its time doesn't count as a best. */
  assisted: boolean;
  /** Which run: the range's targets or the biathlon race. `best` is this mode's. */
  mode: RunMode;
  // The biathlon race's (F5.3b); zero in a range run.
  /** Laps counted since the start (each passing every gate). */
  laps: number;
  /** Rounds left at the line on this lap (none on the last lap, or once the line is closed). */
  rounds: number;
  /** When each course board fell (its shell landed), or -1: line 1's three, then line 2's. */
  boardAt: number[];
  /** Penalty loops owed now, and those driven to pay one. */
  owed: number;
  loops: number;
  /** Penalty loops not driven before the finish line: each adds RACE.penaltySeconds to the time. */
  skipped: number;
  /** Slalom faults in the race (F5.3d: a post knocked down, a gate missed): each adds FAULT_SECONDS to the time. */
  faults: number;
  /** The lines shot (bit k: line k), so no more rounds there. */
  closed: number;
  /** The last thing worth a sign (a line shot, a loop driven, the finish), and a count that changes with each. */
  note: string;
  noteId: number;
  /** The range each firing line's boards stand at in this race, m (src/sim/course.ts: picked at its start; LINE_RANGES before any race). */
  ranges: number[];
}

export function createRunSnapshot(): RunSnapshot {
  return {
    id: 0, phase: 'idle', clock: 0, paused: false, shots: 0, hitAt: RANGE_TARGETS.map(() => -1), time: -1, best: -1, assisted: false,
    mode: 'range', laps: 0, rounds: 0, boardAt: COURSE_TARGETS.map(() => -1), owed: 0, loops: 0, skipped: 0, faults: 0, closed: 0, note: '', noteId: 0,
    ranges: [...LINE_RANGES],
  };
}

/**
 * The run: `start`, then `step` once a frame on the host (the clock runs
 * and hits land), `shot` for every shot the host decides, and `snapshot`
 * for the guest. The guest `apply`s each snapshot and `follow`s between
 * them.
 */
export class RangeRun {
  readonly s = createRunSnapshot();
  /** Bumped whenever something the guest should hear of changes (not the clock ticking). */
  version = 0;
  private pendingTarget: number[] = new Array<number>(PENDING).fill(-1);
  private pendingAt: number[] = new Array<number>(PENDING).fill(0);
  /** Each mode's best unassisted time this session, s; -1 for none. */
  private bests: Record<RunMode, number> = { range: -1, biathlon: -1 };
  /** The course's counters as last fed (a race counts what changed since), and the tank in a firing box, halted, now. */
  private seen = { laps: 0, missed: 0, penalties: 0, faults: 0, fed: false };
  private box = -1;
  private halted = false;

  /**
   * Start (or restart) a run of `mode`: the countdown begins, every target
   * counts again. A race stands its lines' boards at `ranges` (one a line,
   * within LINE_RANGE_SPAN; the boards stay where they are without).
   */
  start(mode: RunMode = 'range', ranges?: readonly number[]): void {
    const s = this.s;
    if (mode === 'biathlon' && ranges) for (let k = 0; k < s.ranges.length; k++) s.ranges[k] = clampLineRange(k, ranges[k]);
    s.id++;
    s.phase = 'running';
    s.mode = mode;
    s.clock = -RUN_COUNTDOWN;
    s.shots = 0;
    s.hitAt.fill(-1);
    s.time = -1;
    s.best = this.bests[mode];
    s.assisted = false;
    s.laps = 0;
    s.rounds = mode === 'biathlon' ? RACE.rounds : 0;
    s.boardAt.fill(-1);
    s.owed = 0;
    s.loops = 0;
    s.skipped = 0;
    s.faults = 0;
    s.closed = 0;
    this.seen.fed = false;
    this.pendingTarget.fill(-1);
    this.version++;
  }

  /** Stop without a time: the clock and the flags go. */
  stop(): void {
    if (this.s.phase === 'idle') return;
    this.s.phase = 'idle';
    this.s.hitAt.fill(-1);
    this.s.boardAt.fill(-1);
    this.s.rounds = 0;
    this.s.owed = 0;
    this.pendingTarget.fill(-1);
    this.version++;
  }

  /** A Practice shortcut was used: the run carries on but its time won't be a best. */
  assist(): void {
    if (this.s.phase !== 'running' || this.s.assisted) return;
    this.s.assisted = true;
    this.version++;
  }

  setPaused(paused: boolean): void {
    if (this.s.paused === paused) return;
    this.s.paused = paused;
    this.version++;
  }

  /** Whether shots count now: the clock is running, past the countdown. */
  get counting(): boolean {
    return this.s.phase === 'running' && this.s.clock >= 0 && !this.s.paused;
  }

  /**
   * The host decided a shot: `target` it hit (or -1), and its flight time,
   * s. Counts it if the clock is running; a hit counts when the shell lands.
   * Returns whether it counted.
   *
   * In a race every round fired spends one of the line's, even in the
   * countdown or away from the box (the gunner's rack holds only what is
   * left); it can only bring a board down fired from a halt in this lap's
   * firing box, at one of its own line's boards still standing.
   */
  shot(target: number, flight: number): boolean {
    const s = this.s;
    if (s.mode === 'biathlon') {
      if (s.phase !== 'running') return false;
      const had = s.rounds;
      s.rounds = Math.max(0, s.rounds - 1);
      s.shots++;
      this.version++;
      const line = lineFor(s.laps);
      const j = boardOf(target);
      if (had > 0 && this.counting && line >= 0 && !lineClosed(s, line) && this.box === line && this.halted && j >= 0 && COURSE_TARGETS[j].line === line && s.boardAt[j] < 0) {
        this.pend(target, flight);
      }
      return true;
    }
    if (!this.counting) return false;
    s.shots++;
    if (target >= 0 && target < s.hitAt.length) this.pend(target, flight);
    this.version++;
    return true;
  }

  /** A hit on its way: it lands after the shell's `flight` s. */
  private pend(target: number, flight: number): void {
    let slot = this.pendingTarget.indexOf(-1);
    if (slot < 0) slot = 0;
    this.pendingTarget[slot] = target;
    this.pendingAt[slot] = this.s.clock + Math.max(0, flight);
  }

  /**
   * The host, once a frame before `step` in a race: the course's progress
   * (src/sim/course.ts) as it stands. Laps, missed laps and penalty loops
   * count by what changed since the last feed; a drop (the course started
   * again after the tank was placed) just starts the counting again.
   */
  course(c: Readonly<CourseFeed>): void {
    this.box = c.box;
    this.halted = c.halted;
    const seen = this.seen;
    const s = this.s;
    const counting = s.mode === 'biathlon' && s.phase === 'running' && seen.fed;
    if (!counting || c.laps < seen.laps || c.missed < seen.missed || c.penalties < seen.penalties || c.faults < seen.faults) {
      seen.laps = c.laps;
      seen.missed = c.missed;
      seen.penalties = c.penalties;
      seen.faults = c.faults;
      seen.fed = true;
      return;
    }
    if (c.faults > seen.faults) {
      s.faults += c.faults - seen.faults;
      seen.faults = c.faults;
      this.version++;
    }
    for (; seen.penalties < c.penalties; seen.penalties++) {
      if (s.owed <= 0) continue;
      s.owed--;
      s.loops++;
      this.say(loopNote(s.owed));
    }
    for (; seen.missed < c.missed; seen.missed++) this.finishLine(false);
    for (; seen.laps < c.laps; seen.laps++) this.finishLine(true);
  }

  /** A race crossed the finish line: a lap counted (`counted`) or not, a gate missed. */
  private finishLine(counted: boolean): void {
    const s = this.s;
    if (s.phase !== 'running') return;
    // The line on this lap is shot now, whatever is left of it; loops still owed can't be driven any more.
    const line = lineFor(s.laps);
    if (line >= 0 && !lineClosed(s, line)) this.closeLine(line);
    if (s.owed > 0) {
      s.skipped += s.owed;
      this.say(skippedNote(s.owed));
      s.owed = 0;
    }
    if (!counted) return;
    s.laps++;
    if (s.laps >= RACE.laps) {
      s.phase = 'done';
      s.time = s.clock + penaltySeconds(s);
      s.clock = s.time;
      if (!s.assisted && (this.bests.biathlon < 0 || s.time < this.bests.biathlon)) this.bests.biathlon = s.time;
      s.best = this.bests.biathlon;
      this.say(finishNote(s, formatRunTime));
    } else {
      s.rounds = lineFor(s.laps) >= 0 ? RACE.rounds : 0;
    }
    this.version++;
  }

  /** Line `k` is shot: its boards still standing are penalty loops owed. */
  private closeLine(k: number): void {
    const s = this.s;
    s.closed |= 1 << k;
    s.rounds = 0;
    const down = boardsDown(s, k);
    s.owed += BOARDS_PER_LINE - down;
    this.say(lineNote(k, down));
  }

  private say(note: string): void {
    this.s.note = note;
    this.s.noteId++;
    this.version++;
  }

  /** The host: the clock runs `dt` s (not while paused), hits land, and the run ends on the third target (a race, on its last lap: `course`). */
  step(dt: number): void {
    const s = this.s;
    if (s.phase !== 'running' || s.paused) return;
    s.clock += dt;
    const race = s.mode === 'biathlon';
    let pending = false;
    for (let k = 0; k < PENDING; k++) {
      const target = this.pendingTarget[k];
      if (target < 0) continue;
      if (this.pendingAt[k] > s.clock) {
        pending = true;
        continue;
      }
      this.pendingTarget[k] = -1;
      const j = boardOf(target);
      if (race && j >= 0 && s.boardAt[j] < 0) {
        s.boardAt[j] = this.pendingAt[k];
        this.version++;
      } else if (!race && s.hitAt[target] < 0) {
        s.hitAt[target] = this.pendingAt[k];
        this.version++;
      }
    }
    if (race) {
      // The line's last round fired and landed: it is shot.
      const line = lineFor(s.laps);
      if (line >= 0 && s.rounds === 0 && !pending && !lineClosed(s, line)) this.closeLine(line);
      return;
    }
    if (targetsHit(s) === s.hitAt.length) {
      s.phase = 'done';
      s.time = Math.max(...s.hitAt);
      s.clock = s.time;
      if (!s.assisted && (this.bests.range < 0 || s.time < this.bests.range)) this.bests.range = s.time;
      s.best = this.bests.range;
      this.version++;
    }
  }

  /** The guest: the clock runs on between the host's snapshots (the host says when it stops). */
  follow(dt: number): void {
    const s = this.s;
    if (s.phase === 'running' && !s.paused) s.clock += dt;
  }

  /** The guest: take the host's word, `age` s old (the clock has run on since, unless paused). */
  apply(from: RunSnapshot, age: number): void {
    const s = this.s;
    copyRunSnapshot(from, s);
    if (s.phase === 'running' && !s.paused) s.clock += Math.max(0, Math.min(1, age));
    this.version++;
  }
}

export function copyRunSnapshot(from: RunSnapshot, to: RunSnapshot): RunSnapshot {
  to.id = from.id;
  to.phase = from.phase;
  to.clock = from.clock;
  to.paused = from.paused;
  to.shots = from.shots;
  for (let i = 0; i < to.hitAt.length; i++) to.hitAt[i] = from.hitAt[i] ?? -1;
  to.time = from.time;
  to.best = from.best;
  to.assisted = from.assisted;
  to.mode = from.mode;
  to.laps = from.laps;
  to.rounds = from.rounds;
  for (let j = 0; j < to.boardAt.length; j++) to.boardAt[j] = from.boardAt[j] ?? -1;
  to.owed = from.owed;
  to.loops = from.loops;
  to.skipped = from.skipped;
  to.faults = from.faults;
  to.closed = from.closed;
  to.note = from.note;
  to.noteId = from.noteId;
  for (let k = 0; k < to.ranges.length; k++) to.ranges[k] = from.ranges[k] ?? LINE_RANGES[k];
  return to;
}

/** How many targets have been hit. */
export function targetsHit(s: RunSnapshot): number {
  let n = 0;
  for (const at of s.hitAt) if (at >= 0) n++;
  return n;
}

/** Whether target `i`'s flag is up: hit in the range run on now or just finished. */
export function flagUp(s: RunSnapshot, i: number): boolean {
  return s.mode === 'range' && s.phase !== 'idle' && s.hitAt[i] >= 0;
}

/** The `run` event the host sends: the snapshot as plain JSON, and the host's clock when sent (ms). */
export function runEvent(s: RunSnapshot, atMs: number): { t: 'run' } & Record<string, unknown> {
  return {
    t: 'run',
    id: s.id,
    phase: s.phase,
    clock: s.clock,
    paused: s.paused,
    shots: s.shots,
    hitAt: [...s.hitAt],
    time: s.time,
    best: s.best,
    assisted: s.assisted,
    mode: s.mode,
    laps: s.laps,
    rounds: s.rounds,
    boardAt: [...s.boardAt],
    owed: s.owed,
    loops: s.loops,
    skipped: s.skipped,
    faults: s.faults,
    closed: s.closed,
    note: s.note,
    noteId: s.noteId,
    ranges: [...s.ranges],
    at: atMs,
  };
}

/** A `run` event read back, or null if it isn't one (a page on another build, a bad message). */
export function readRunEvent(e: Record<string, unknown>, out: RunSnapshot): { at: number } | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const id = num(e.id);
  const clock = num(e.clock);
  const shots = num(e.shots);
  const time = num(e.time);
  const best = num(e.best);
  const at = num(e.at);
  const phase = RUN_PHASES.find((p) => p === e.phase);
  const hitAt = Array.isArray(e.hitAt) ? e.hitAt.map(num) : [];
  if (id === null || clock === null || shots === null || time === null || best === null || at === null || phase === undefined) return null;
  if (hitAt.length !== out.hitAt.length || hitAt.some((v) => v === null)) return null;
  out.id = id;
  out.phase = phase;
  out.clock = clock;
  out.paused = e.paused === true;
  out.shots = shots;
  hitAt.forEach((v, i) => (out.hitAt[i] = v as number));
  out.time = time;
  out.best = best;
  out.assisted = e.assisted === true;
  // The race's fields (F5.3b); a page from before them sends a range run.
  const count = (v: unknown) => Math.max(0, Math.floor(num(v) ?? 0));
  out.mode = RUN_MODES.find((m) => m === e.mode) ?? 'range';
  out.laps = count(e.laps);
  out.rounds = count(e.rounds);
  const boardAt = Array.isArray(e.boardAt) ? e.boardAt : [];
  for (let j = 0; j < out.boardAt.length; j++) out.boardAt[j] = num(boardAt[j]) ?? -1;
  out.owed = count(e.owed);
  out.loops = count(e.loops);
  out.skipped = count(e.skipped);
  // The slalom's faults (F5.3d); a page from before them sends none.
  out.faults = count(e.faults);
  out.closed = count(e.closed);
  out.note = typeof e.note === 'string' ? e.note.slice(0, 80) : '';
  out.noteId = count(e.noteId);
  // The lines' ranges (since the harder shooting); a page from before them keeps its boards where they stood.
  const ranges = Array.isArray(e.ranges) ? e.ranges : null;
  if (ranges) for (let k = 0; k < out.ranges.length; k++) out.ranges[k] = clampLineRange(k, ranges[k]);
  return { at };
}

/** A run time as the boards show it: 0:42.1. */
export function formatRunTime(seconds: number): string {
  const t = Math.max(0, seconds);
  const minutes = Math.floor(t / 60);
  const rest = t - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** The countdown's number (3, 2, 1) while it runs, or 0. */
export function countdownNumber(s: RunSnapshot): number {
  return s.phase === 'running' && s.clock < 0 ? Math.ceil(-s.clock - 1e-9) : 0;
}

/** One line for the game menu. */
export function runLine(s: RunSnapshot): string {
  if (s.mode === 'biathlon') return raceLine(s, formatRunTime);
  const best = s.best >= 0 ? ` Best ${formatRunTime(s.best)}.` : '';
  switch (s.phase) {
    case 'idle':
      return `No run on.${best}`;
    case 'running': {
      if (s.clock < 0) return `Get ready: ${countdownNumber(s)}`;
      const paused = s.paused ? ' (paused)' : '';
      return `Run ${formatRunTime(s.clock)}${paused}: ${targetsHit(s)} of ${s.hitAt.length} targets, ${s.shots} shots.${best}`;
    }
    case 'done':
      return `Three targets in ${formatRunTime(s.time)}, ${s.shots} shots${s.assisted ? ' (assisted)' : ''}.${best}`;
  }
}

/** What the run clocks in the cabin show: a heading, the time in big figures, and the targets and shots. */
export function clockLines(s: RunSnapshot): [string, string, string] {
  if (s.mode === 'biathlon') return raceClockLines(s, formatRunTime);
  const count = `Targets ${targetsHit(s)}/${s.hitAt.length}   Shots ${s.shots}`;
  switch (s.phase) {
    case 'idle':
      return ['Range run', s.best >= 0 ? `Best ${formatRunTime(s.best)}` : '-:--.-', 'Menu: Practice, Range run'];
    case 'running':
      if (s.clock < 0) return ['Get ready', `${countdownNumber(s)}`, count];
      return [s.paused ? 'Range run (paused)' : 'Range run', formatRunTime(s.clock), count];
    case 'done':
      return [s.assisted ? 'Three hits (assisted)' : 'Three hits!', formatRunTime(s.time), `Shots ${s.shots}`];
  }
}

/** What the floating sign says (the countdown, Go!, the finish `doneFor` s ago), or '' for no sign. */
export function runSign(s: RunSnapshot, doneFor: number): string {
  // A race's finish is one of its notes.
  if (s.mode === 'biathlon') return raceStartSign(s, GO_SECONDS);
  if (s.phase === 'running') {
    if (s.clock < 0) return `Range run: ${countdownNumber(s)}`;
    if (s.clock < GO_SECONDS) return 'Go! Hit all three targets';
    return '';
  }
  if (s.phase === 'done' && doneFor < FINISH_SECONDS) {
    return `Three targets in ${formatRunTime(s.time)}, ${s.shots} shots`;
  }
  return '';
}

/**
 * The hit flag beside each target (F1.11): a pole with a red flag that
 * goes up when the target is first hit in a run, so both seats can see
 * which targets are done. It stands on the target's side away from the
 * road, clear of the board, m.
 */
export const HIT_FLAG = { gap: 1.2, pole: 4.2, radius: 0.06, width: 1.8, height: 1.1, thickness: 0.04 } as const;

/** Which way target `i`'s flag flies, rad about +Y: away from the road (the model flies along +X), so it never hangs over the board. */
export function hitFlagYaw(i: number): number {
  return RANGE_TARGETS[i].across < 0 ? Math.PI : 0;
}

/** Where target `i`'s flag stands: x and z of the pole's foot (world space). */
export function hitFlagFoot(i: number): [number, number] {
  const [x, z] = targetFoot(i);
  const out = RANGE_TARGETS[i].across < 0 ? -1 : 1;
  return [x + out * (targetBoard(i).width / 2 + HIT_FLAG.gap), z];
}
