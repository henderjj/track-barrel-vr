/**
 * The range run (F1.11, docs/range-run.md): the concept's play-test
 * question "how long does a pair take to hit three targets?" as a timed
 * run. Start it and the tank goes back to the start; after a short
 * countdown the clock runs until each of the range's three targets has been
 * hit at least once, then stops on the crew's time. Shots and hits only
 * count while the clock runs.
 *
 * Engine-free: the host keeps the run (it decides hits, plan §4.6) and
 * sends it to the guest as a reliable event; the guest keeps a copy and
 * moves its clock on between events. Allocates nothing per frame.
 */

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
}

export function createRunSnapshot(): RunSnapshot {
  return { id: 0, phase: 'idle', clock: 0, paused: false, shots: 0, hitAt: RANGE_TARGETS.map(() => -1), time: -1, best: -1, assisted: false };
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

  /** Start (or restart): the countdown begins, every target counts again. */
  start(): void {
    const s = this.s;
    s.id++;
    s.phase = 'running';
    s.clock = -RUN_COUNTDOWN;
    s.shots = 0;
    s.hitAt.fill(-1);
    s.time = -1;
    s.assisted = false;
    this.pendingTarget.fill(-1);
    this.version++;
  }

  /** Stop without a time: the clock and the flags go. */
  stop(): void {
    if (this.s.phase === 'idle') return;
    this.s.phase = 'idle';
    this.s.hitAt.fill(-1);
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
   */
  shot(target: number, flight: number): boolean {
    if (!this.counting) return false;
    this.s.shots++;
    if (target >= 0 && target < this.s.hitAt.length) {
      let slot = this.pendingTarget.indexOf(-1);
      if (slot < 0) slot = 0;
      this.pendingTarget[slot] = target;
      this.pendingAt[slot] = this.s.clock + Math.max(0, flight);
    }
    this.version++;
    return true;
  }

  /** The host: the clock runs `dt` s (not while paused), hits land, and the run ends on the third target. */
  step(dt: number): void {
    const s = this.s;
    if (s.phase !== 'running' || s.paused) return;
    s.clock += dt;
    for (let k = 0; k < PENDING; k++) {
      const target = this.pendingTarget[k];
      if (target < 0 || this.pendingAt[k] > s.clock) continue;
      this.pendingTarget[k] = -1;
      if (s.hitAt[target] < 0) {
        s.hitAt[target] = this.pendingAt[k];
        this.version++;
      }
    }
    if (targetsHit(s) === s.hitAt.length) {
      s.phase = 'done';
      s.time = Math.max(...s.hitAt);
      s.clock = s.time;
      if (!s.assisted && (s.best < 0 || s.time < s.best)) s.best = s.time;
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
  return to;
}

/** How many targets have been hit. */
export function targetsHit(s: RunSnapshot): number {
  let n = 0;
  for (const at of s.hitAt) if (at >= 0) n++;
  return n;
}

/** Whether target `i`'s flag is up: hit in the run on now or just finished. */
export function flagUp(s: RunSnapshot, i: number): boolean {
  return s.phase !== 'idle' && s.hitAt[i] >= 0;
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
