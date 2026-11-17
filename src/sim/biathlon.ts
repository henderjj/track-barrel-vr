/**
 * The biathlon race (F5.3b, docs/biathlon-race.md): the range run's second
 * mode, on F5.3a's course. Three laps against the clock; after laps 1 and 2
 * the crew halts in that lap's firing box and has three rounds for its three
 * boards; each board left standing is a penalty loop owed, driven before the
 * finish line or added to the time. Gold, silver and bronze times.
 *
 * The race's state lives in the range run's snapshot (src/sim/range-run.ts,
 * mode 'biathlon'), so the clocks, the sign, the countdown and the play-test
 * stats serve both; this module holds the race's numbers and the words for
 * it. Engine-free.
 */

import { COURSE_TARGETS, FALL_SECONDS, FAULT_SECONDS, LINE_ACROSS } from './course.js';
import { RANGE_TARGETS } from './range.js';
import type { RunSnapshot } from './range-run.js';

/** The race's rules: laps, firing lines (one after each of the first laps), rounds per line, and the time a penalty loop not driven costs, s. */
export const RACE = {
  laps: 3,
  lines: 2,
  rounds: 3,
  /** About half again a loop's own time (153 m at 12 km/h is 46 s), so driving it is always quicker. */
  penaltySeconds: 60,
} as const;

/** How many boards the course has: three per line. */
export const BOARD_COUNT = COURSE_TARGETS.length;
/** The first board's index among the shells' targets (ballistics' targetFaces(): the range's three first). */
export const BOARD_FIRST = RANGE_TARGETS.length;
/** Boards on each line. */
export const BOARDS_PER_LINE = LINE_ACROSS.length;

export type Medal = 'gold' | 'silver' | 'bronze' | '';

/**
 * The medal times, s, the race's time with any penalty seconds added. Set
 * from the practice crewmate's runs (test/biathlon.test.ts drives them: at
 * its 20 km/h with a round every 8 s, 9:03 clean and 11:22 with three
 * penalty loops, each loop about 47 s), to be tuned from John's first
 * runs: gold needs a crew quicker than the crewmate and clean, the
 * crewmate's clean run is silver, and bronze allows about three loops.
 * Retuned for the driving challenge (F5.3d), whose slalom, hill, bridge
 * and ford the crewmate takes carefully: 13:00 clean, 15:20 with three
 * loops.
 */
export const MEDAL_TIMES = { gold: 12 * 60 + 30, silver: 13 * 60 + 30, bronze: 15 * 60 + 45 } as const;

/** The medal a race time earns, or '' for none. */
export function medalFor(time: number): Medal {
  if (!(time >= 0)) return '';
  if (time <= MEDAL_TIMES.gold) return 'gold';
  if (time <= MEDAL_TIMES.silver) return 'silver';
  if (time <= MEDAL_TIMES.bronze) return 'bronze';
  return '';
}

/** The firing line the crew shoots at on the lap it is on (`laps` done): line 1 on lap 1, line 2 on lap 2, none on the last lap (-1). */
export function lineFor(laps: number): number {
  return laps >= 0 && laps < RACE.lines ? laps : -1;
}

/** The board (0 to 5) a shell's target index stands for, or -1 for one of the range's targets or a miss. */
export function boardOf(target: number): number {
  const j = target - BOARD_FIRST;
  return j >= 0 && j < BOARD_COUNT ? j : -1;
}

/** Whether board `j` has fallen (its disc covered) in the race or line practice shown. */
export function boardDown(s: Readonly<RunSnapshot>, j: number): boolean {
  return s.mode !== 'range' && s.phase !== 'idle' && s.boardAt[j] >= 0;
}

/** How many of line `k`'s boards have fallen (all lines' with k = -1). */
export function boardsDown(s: Readonly<RunSnapshot>, k = -1): number {
  let n = 0;
  for (let j = 0; j < s.boardAt.length; j++) {
    if (s.boardAt[j] >= 0 && (k < 0 || COURSE_TARGETS[j].line === k)) n++;
  }
  return n;
}

/** Rounds fired in the race that brought no board down. */
export function raceMisses(s: Readonly<RunSnapshot>): number {
  return Math.max(0, s.shots - boardsDown(s));
}

/**
 * The board flags (docs/biathlon-race.md, "Board flags"): a flag over a
 * board of the line the crew shoots at on this lap. 'aim' (yellow) over the
 * board to shoot next, 'hit' (green) over each board brought down, 'miss'
 * (red) over the board aimed at for MISS_FLASH s after a round misses, and
 * over every board left standing once the line is shot. 'none' elsewhere:
 * the other line's boards, the last lap, outside a race. Line practice
 * (Practice → Biathlon → Line 1 or 2) shows its line's flags the same way.
 */
export type BoardFlag = 'none' | 'aim' | 'hit' | 'miss';
export const BOARD_FLAGS: readonly BoardFlag[] = ['none', 'aim', 'hit', 'miss'];
/** How long a miss shows red over the board aimed at, s. */
export const MISS_FLASH = 2.5;

/** The board (0 to 5) to shoot next: this lap's line's first still standing, left to right; -1 when none (no race, the last lap, the line shot). */
export function aimBoard(s: Readonly<RunSnapshot>): number {
  if (s.mode === 'range' || s.phase !== 'running') return -1;
  const line = lineFor(s.laps);
  if (line < 0 || lineClosed(s, line)) return -1;
  for (let j = line * BOARDS_PER_LINE; j < (line + 1) * BOARDS_PER_LINE; j++) if (s.boardAt[j] < 0) return j;
  return -1;
}

/** Board `j`'s flag in the race shown. */
export function boardFlag(s: Readonly<RunSnapshot>, j: number): BoardFlag {
  if (s.mode === 'range' || s.phase !== 'running') return 'none';
  const line = lineFor(s.laps);
  if (line < 0 || COURSE_TARGETS[j]?.line !== line) return 'none';
  if (s.boardAt[j] >= 0) return 'hit';
  if (lineClosed(s, line)) return 'miss';
  if (j !== aimBoard(s)) return 'none';
  if (!(s.missAt >= 0 && s.clock >= s.missAt && s.clock - s.missAt < MISS_FLASH)) return 'aim';
  // A board brought down since the miss moved the aim on: the new board hasn't been missed.
  for (let k = line * BOARDS_PER_LINE; k < (line + 1) * BOARDS_PER_LINE; k++) if (s.boardAt[k] > s.missAt) return 'aim';
  return 'miss';
}

/** Whether line `k` is shot (closed): its rounds are fired, or the crew went on past it. */
export function lineClosed(s: Readonly<RunSnapshot>, k: number): boolean {
  return (s.closed & (1 << k)) !== 0;
}

/** The time penalties so far, s: each penalty loop not driven, each slalom fault (F5.3d) and each fall off the bridge. */
export function penaltySeconds(s: Readonly<RunSnapshot>): number {
  return s.skipped * RACE.penaltySeconds + s.faults * FAULT_SECONDS + s.falls * FALL_SECONDS;
}

/** A medal's word with a capital, for the signs. */
function medalWord(m: Medal): string {
  return m === '' ? '' : m[0].toUpperCase() + m.slice(1);
}

/** A whole number of minutes and seconds, as "+1:00". */
function plusTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const r = Math.round(seconds - m * 60);
  return `+${m}:${r < 10 ? '0' : ''}${r}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** What the race is about now, in a few words: the line, the penalty loops owed, or the lap. */
export function raceNow(s: Readonly<RunSnapshot>): string {
  if (s.owed > 0) return `drive ${plural(s.owed, 'penalty loop')}`;
  const line = lineFor(s.laps);
  if (line >= 0 && !lineClosed(s, line)) return `line ${line + 1}: ${plural(s.rounds, 'round')}`;
  if (line < 0) return 'last lap';
  return line + 1 < RACE.lines ? `on to line ${line + 2}` : 'on to the last lap';
}

/** The game menu's line on a race (`fmt` writes a time). */
export function raceLine(s: Readonly<RunSnapshot>, fmt: (t: number) => string): string {
  const best = s.best >= 0 ? ` Best ${fmt(s.best)}.` : '';
  switch (s.phase) {
    case 'idle':
      return `No race on.${best}`;
    case 'running': {
      if (s.clock < 0) return `Get ready: ${Math.ceil(-s.clock - 1e-9)}`;
      const paused = s.paused ? ' (paused)' : '';
      const extra = penaltySeconds(s) > 0 ? ` ${plusTime(penaltySeconds(s))} in penalties.` : '';
      return `Race ${fmt(s.clock)}${paused}: lap ${Math.min(s.laps + 1, RACE.laps)} of ${RACE.laps}, ${raceNow(s)}. Boards down ${boardsDown(s)} of ${BOARD_COUNT}.${extra}${best}`;
    }
    case 'done': {
      const medal = medalFor(s.time);
      const faults = (s.faults > 0 ? `, ${plural(s.faults, 'slalom fault')}` : '') + (s.falls > 0 ? `, ${plural(s.falls, 'bridge fall')}` : '');
      return `Finished in ${fmt(s.time)}${medal ? ` (${medal})` : ''}${s.assisted ? ', assisted' : ''}: ${boardsDown(s)} of ${BOARD_COUNT} boards, ${plural(s.loops, 'penalty loop')}${faults}.${best}`;
    }
  }
}

/** What the run clocks show in a race: a heading, the time, and the line or what is owed. */
export function raceClockLines(s: Readonly<RunSnapshot>, fmt: (t: number) => string): [string, string, string] {
  switch (s.phase) {
    case 'idle':
      return ['Biathlon', s.best >= 0 ? `Best ${fmt(s.best)}` : '-:--.-', 'Menu: Practice, Biathlon'];
    case 'running': {
      if (s.clock < 0) return ['Get ready', `${Math.ceil(-s.clock - 1e-9)}`, `${RACE.laps} laps, ${RACE.lines} lines`];
      const lap = `Lap ${Math.min(s.laps + 1, RACE.laps)}/${RACE.laps}`;
      const owed = s.owed > 0 ? `   Owe ${s.owed}` : '';
      const line = lineFor(s.laps);
      const bottom = line >= 0 && !lineClosed(s, line) ? `Line ${line + 1}: rounds ${s.rounds}` : `Down ${boardsDown(s)}/${BOARD_COUNT}`;
      // The penalties already earned (slalom faults, bridge falls), so the crew sees what each costs.
      const penalty = penaltySeconds(s) > 0 ? `   ${plusTime(penaltySeconds(s))}` : '';
      return [s.paused ? `${lap} (paused)` : `${lap}${penalty}`, fmt(s.clock), `${bottom}${owed}`];
    }
    case 'done': {
      const medal = medalWord(medalFor(s.time));
      const faults = (s.faults > 0 ? `   Faults ${s.faults}` : '') + (s.falls > 0 ? `   Falls ${s.falls}` : '');
      return [s.assisted ? 'Finished (assisted)' : medal ? `${medal}!` : 'Finished', fmt(s.time), `Down ${boardsDown(s)}/${BOARD_COUNT}   Loops ${s.loops}${faults}`];
    }
  }
}

/** The game menu's line on line practice (mode 'line'; `laps` holds the line). */
export function practiceLine(s: Readonly<RunSnapshot>): string {
  const line = lineFor(s.laps);
  if (s.phase !== 'running' || line < 0) return 'No line practice on.';
  const go = lineClosed(s, line) ? 'the boards stand again in a moment' : `${plural(s.rounds, 'round')} left of this go`;
  return `Practising at line ${line + 1}: ${boardsDown(s, line)} of ${BOARDS_PER_LINE} down, ${go}.`;
}

/** What the run clocks show in line practice: the line, the time since it started, and the go. */
export function practiceClockLines(s: Readonly<RunSnapshot>, fmt: (t: number) => string): [string, string, string] {
  const line = lineFor(s.laps);
  if (s.phase !== 'running' || line < 0) return ['Line practice', '-:--.-', 'Menu: Practice, Biathlon'];
  const down = `Down ${boardsDown(s, line)}/${BOARDS_PER_LINE}`;
  const bottom = lineClosed(s, line) ? `${down}   Standing again` : `Rounds ${s.rounds}   ${down}`;
  return [s.paused ? `Line ${line + 1} practice (paused)` : `Line ${line + 1} practice`, fmt(s.clock), bottom];
}

/** The countdown and Go! in a race (the notes and the finish come as notes). */
export function raceStartSign(s: Readonly<RunSnapshot>, goSeconds: number): string {
  if (s.phase !== 'running') return '';
  if (s.clock < 0) return `Biathlon: ${Math.ceil(-s.clock - 1e-9)}`;
  if (s.clock < goSeconds) return 'Go! Three laps, shoot at each line';
  return '';
}

/** The note when line `k` closes with `down` of its boards fallen. */
export function lineNote(k: number, down: number): string {
  const standing = BOARDS_PER_LINE - down;
  if (standing === 0) return `Line ${k + 1}: clean!`;
  return `Line ${k + 1}: ${down} down, ${plural(standing, 'penalty loop')}`;
}

/** The note for a penalty loop driven, with `owed` still to go. */
export function loopNote(owed: number): string {
  return owed > 0 ? `Penalty loop done: ${owed} to go` : 'Penalty loops done';
}

/** The note when the crew crossed the finish owing `n` loops. */
export function skippedNote(n: number): string {
  return `${plusTime(n * RACE.penaltySeconds)}: ${plural(n, 'penalty loop')} not driven`;
}

/** The note at the finish. */
export function finishNote(s: Readonly<RunSnapshot>, fmt: (t: number) => string): string {
  const medal = medalWord(medalFor(s.time));
  return `Finished in ${fmt(s.time)}${medal ? `: ${medal}` : ''}`;
}
