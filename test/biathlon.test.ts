import { describe, expect, it } from 'vitest';
import { ENEMY_COUNT } from '../src/sim/enemy-guns.js';
import {
  aimBoard,
  BOARD_COUNT,
  BOARD_FIRST,
  boardDown,
  boardFlag,
  MISS_FLASH,
  boardsDown,
  lineClosed,
  lineFor,
  MEDAL_TIMES,
  medalFor,
  RACE,
  raceClockLines,
  raceLine,
  raceMisses,
} from '../src/sim/biathlon.js';
import { COURSE_TARGET_FIRST, targetFaces } from '../src/sim/ballistics.js';
import { BotDriver, createDriveWish, RACE_LOOP_FIRST, RACE_ROUTE } from '../src/sim/crew-bot.js';
import { COURSE, COURSE_START, COURSE_TARGETS, CourseProgress, distanceToTrack, LINE_RANGE_SPAN, LINE_RANGES } from '../src/sim/course.js';
import { clockLines, type CourseFeed, createRunSnapshot, formatRunTime, LINE_RESET, MISS_LANDS, RangeRun, readRunEvent, RUN_COUNTDOWN, runEvent, runLine, runSign } from '../src/sim/range-run.js';
import { createControls, createTankDrive, stepDrive } from '../src/sim/tank-drive.js';
import { OBSTACLES } from '../src/sim/terrain.js';

const DT = 1 / 60;

/** The course's progress as a race reads it, moved on by hand. */
function feed(): CourseFeed {
  return { laps: 0, missed: 0, penalties: 0, box: -1, halted: false, faults: 0, falls: 0 };
}

function step(r: RangeRun, c: CourseFeed, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.course(c);
    r.step(DT);
  }
}

/** Board `j` (0 to 5) as a shell's target. */
const board = (j: number) => BOARD_FIRST + j;

describe('biathlon race rules (F5.3b)', () => {
  it('numbers the boards after the range targets, as the shells do', () => {
    expect(BOARD_FIRST).toBe(COURSE_TARGET_FIRST);
    expect(BOARD_COUNT).toBe(6);
    // The enemy guns (F3.2) come after the boards.
    expect(targetFaces()).toHaveLength(BOARD_FIRST + BOARD_COUNT + ENEMY_COUNT);
    expect(lineFor(0)).toBe(0);
    expect(lineFor(1)).toBe(1);
    expect(lineFor(2)).toBe(-1);
  });

  it('runs a whole race: three rounds a line, a loop for each board standing, laps from the course, a medal at the finish', () => {
    const r = new RangeRun();
    const c = feed();
    r.start('biathlon');
    expect(r.s.mode).toBe('biathlon');
    expect(r.s.rounds).toBe(RACE.rounds);
    expect(r.s.clock).toBe(-RUN_COUNTDOWN);
    step(r, c, RUN_COUNTDOWN + 1);
    expect(r.counting).toBe(true);

    // Lap 1: a round fired on the move spends a round and hits nothing, even on the right board.
    expect(r.shot(board(0), 0.5)).toBe(true);
    step(r, c, 1);
    expect(r.s.rounds).toBe(2);
    expect(boardsDown(r.s)).toBe(0);
    // Halted in box 1: line 1's boards fall; line 2's and the range's don't.
    c.box = 0;
    c.halted = true;
    step(r, c, 0.1);
    r.shot(board(1), 0.5);
    step(r, c, 0.2);
    expect(boardDown(r.s, 1)).toBe(false);
    step(r, c, 0.5);
    expect(boardDown(r.s, 1)).toBe(true);
    expect(r.s.boardAt[1]).toBeGreaterThan(0);
    r.shot(board(3), 0.5);
    step(r, c, 1);
    expect(r.s.rounds).toBe(0);
    expect(boardsDown(r.s)).toBe(1);
    // The line is shot: two left standing, two loops owed.
    expect(lineClosed(r.s, 0)).toBe(true);
    expect(r.s.owed).toBe(2);
    expect(r.s.note).toBe('Line 1: 1 down, 2 penalty loops');
    // No more rounds: a shot now (none can be fired; if one were) hits nothing.
    r.shot(board(2), 0.5);
    step(r, c, 1);
    expect(boardsDown(r.s)).toBe(1);
    // One loop driven; the second skipped: the finish adds a minute.
    c.halted = false;
    c.box = -1;
    c.penalties = 1;
    step(r, c, 0.1);
    expect(r.s.owed).toBe(1);
    expect(r.s.loops).toBe(1);
    expect(r.s.note).toBe('Penalty loop done: 1 to go');
    c.laps = 1;
    step(r, c, 0.1);
    expect(r.s.laps).toBe(1);
    expect(r.s.owed).toBe(0);
    expect(r.s.skipped).toBe(1);
    expect(r.s.note).toBe('+1:00: 1 penalty loop not driven');
    // Lap 2: three fresh rounds for line 2; a missed lap spends nothing.
    expect(r.s.rounds).toBe(RACE.rounds);
    c.box = 1;
    c.halted = true;
    step(r, c, 0.1);
    for (const j of [3, 4, 5]) r.shot(board(j), 0.6);
    step(r, c, 1);
    expect(boardsDown(r.s, 1)).toBe(3);
    expect(r.s.owed).toBe(0);
    expect(r.s.note).toBe('Line 2: clean!');
    c.box = -1;
    c.halted = false;
    // A loop driven owing none counts for nothing.
    c.penalties = 2;
    step(r, c, 0.1);
    expect(r.s.loops).toBe(1);
    c.laps = 2;
    step(r, c, 0.1);
    expect(r.s.laps).toBe(2);
    expect(r.s.rounds).toBe(0);
    expect(raceLine(r.s, formatRunTime)).toMatch(/lap 3 of 3, last lap/);
    // A lap that missed a gate doesn't finish the race.
    c.missed = 1;
    step(r, c, 0.1);
    expect(r.s.phase).toBe('running');
    const clock = r.s.clock;
    c.laps = 3;
    step(r, c, 0.1);
    expect(r.s.phase).toBe('done');
    expect(r.s.time).toBeCloseTo(clock + RACE.penaltySeconds, 1);
    expect(r.s.best).toBe(r.s.time);
    expect(r.s.shots).toBe(7);
    expect(raceMisses(r.s)).toBe(3);
    expect(r.s.note).toMatch(/^Finished in 1:/);
    // The run's words: the clocks, the menu, the finish shown, no range flags.
    expect(clockLines(r.s)[2]).toBe('Down 4/6   Loops 1');
    expect(runLine(r.s)).toMatch(/^Finished in .*4 of 6 boards, 1 penalty loop/);
    expect(runSign(r.s, 0)).toBe('');
  });

  it('starts counting the course again when it was started again (the tank placed), and pauses with the crewmate', () => {
    const r = new RangeRun();
    const c = feed();
    c.laps = 2;
    c.penalties = 3;
    r.start('biathlon');
    step(r, c, 1);
    // The course went back to nothing as the tank was placed at its start: no laps lost or gained.
    c.laps = 0;
    c.penalties = 0;
    step(r, c, 0.1);
    expect(r.s.laps).toBe(0);
    c.laps = 1;
    step(r, c, 0.1);
    expect(r.s.laps).toBe(1);
    // Paused: the clock stands, and a shot can't bring a board down.
    step(r, c, RUN_COUNTDOWN);
    r.setPaused(true);
    const clock = r.s.clock;
    c.box = 1;
    c.halted = true;
    step(r, c, 0.1);
    r.shot(board(3), 0.2);
    step(r, c, 1);
    expect(r.s.clock).toBe(clock);
    r.setPaused(false);
    step(r, c, 1);
    expect(boardsDown(r.s)).toBe(0);
    expect(r.s.rounds).toBe(RACE.rounds - 1);
  });

  it('keeps a best for each mode, and a range run after a race is a range run', () => {
    const r = new RangeRun();
    const c = feed();
    r.start('biathlon');
    step(r, c, RUN_COUNTDOWN + 2);
    for (const laps of [1, 2, 3]) {
      c.laps = laps;
      step(r, c, 0.1);
    }
    expect(r.s.phase).toBe('done');
    const raceBest = r.s.best;
    expect(raceBest).toBeGreaterThan(0);
    r.start();
    expect(r.s.mode).toBe('range');
    expect(r.s.best).toBe(-1);
    expect(r.s.rounds).toBe(0);
    r.start('biathlon');
    expect(r.s.best).toBe(raceBest);
    expect(boardsDown(r.s)).toBe(0);
    r.stop();
    expect(r.s.phase).toBe('idle');
  });

  it("sends the race's fields in the run event, and reads a page from before them as a range run", () => {
    const r = new RangeRun();
    const c = feed();
    r.start('biathlon');
    step(r, c, RUN_COUNTDOWN + 1);
    c.box = 0;
    c.halted = true;
    step(r, c, 0.1);
    r.shot(board(2), 0.3);
    step(r, c, 0.5);
    const event = JSON.parse(JSON.stringify(runEvent(r.s, 99)));
    const copy = createRunSnapshot();
    expect(readRunEvent(event, copy)).toEqual({ at: 99 });
    expect(copy.mode).toBe('biathlon');
    expect(copy.rounds).toBe(2);
    expect(copy.boardAt).toEqual(r.s.boardAt);
    expect(boardDown(copy, 2)).toBe(true);
    const old = { ...event };
    for (const key of ['mode', 'laps', 'rounds', 'boardAt', 'owed', 'loops', 'skipped', 'closed', 'note', 'noteId']) delete old[key];
    const read = createRunSnapshot();
    expect(readRunEvent(old, read)).not.toBeNull();
    expect(read.mode).toBe('range');
    expect(read.boardAt.every((t) => t === -1)).toBe(true);
  });

  it("carries the race's board ranges: picked at its start, in the run event, kept by a page from before them", () => {
    const r = new RangeRun();
    expect(r.s.ranges).toEqual(LINE_RANGES);
    r.start('biathlon', [380, 510]);
    expect(r.s.ranges).toEqual([380, 510]);
    // Out of a line's span, made good.
    r.start('biathlon', [100, 990]);
    expect(r.s.ranges).toEqual([LINE_RANGE_SPAN[0][0], LINE_RANGE_SPAN[1][1]]);
    // A range run leaves them where they were.
    r.start('range', [400, 470]);
    expect(r.s.ranges).toEqual([LINE_RANGE_SPAN[0][0], LINE_RANGE_SPAN[1][1]]);
    r.start('biathlon', [420, 460]);
    const event = JSON.parse(JSON.stringify(runEvent(r.s, 5)));
    const copy = createRunSnapshot();
    readRunEvent(event, copy);
    expect(copy.ranges).toEqual([420, 460]);
    const old = { ...event };
    delete old.ranges;
    const kept = createRunSnapshot();
    kept.ranges[0] = 370;
    readRunEvent(old, kept);
    expect(kept.ranges).toEqual([370, LINE_RANGES[1]]);
  });

  it('flags the board to shoot next yellow, a hit green, a miss red for a moment, and what was left standing red once the line is shot', () => {
    const r = new RangeRun();
    const c = feed();
    const flags = () => COURSE_TARGETS.map((_, j) => boardFlag(r.s, j));
    expect(flags().every((f) => f === 'none')).toBe(true);
    r.start('biathlon');
    // From the start, line 1's first board is flagged, so the gunner can lay on it on the way; line 2's boards have none.
    expect(aimBoard(r.s)).toBe(0);
    expect(flags()).toEqual(['aim', 'none', 'none', 'none', 'none', 'none']);
    step(r, c, RUN_COUNTDOWN + 1);
    c.box = 0;
    c.halted = true;
    step(r, c, 0.1);
    // A miss: red over the board aimed at once the round lands, for MISS_FLASH s, then yellow again.
    r.shot(-1, 0.5);
    step(r, c, 0.3);
    expect(boardFlag(r.s, 0)).toBe('aim');
    step(r, c, 0.3);
    expect(r.s.misses).toBe(1);
    expect(boardFlag(r.s, 0)).toBe('miss');
    step(r, c, MISS_FLASH - 0.2);
    expect(boardFlag(r.s, 0)).toBe('miss');
    step(r, c, 0.3);
    expect(boardFlag(r.s, 0)).toBe('aim');
    // A hit on another standing board than the flagged one: green there, the flag stays on board 0.
    r.shot(board(2), 0.5);
    step(r, c, 0.6);
    expect(flags()).toEqual(['aim', 'none', 'hit', 'none', 'none', 'none']);
    // The last round brings board 0 down: the line is shot, board 1 left standing goes red.
    r.shot(board(0), 0.5);
    step(r, c, 0.6);
    expect(lineClosed(r.s, 0)).toBe(true);
    expect(aimBoard(r.s)).toBe(-1);
    expect(flags()).toEqual(['hit', 'miss', 'hit', 'none', 'none', 'none']);
    // Lap 2: line 2's flags, line 1's gone.
    c.box = -1;
    c.halted = false;
    c.laps = 1;
    step(r, c, 0.1);
    expect(flags()).toEqual(['none', 'none', 'none', 'aim', 'none', 'none']);
    // A hit within the flash of a miss moves the aim on: the next board starts yellow.
    c.box = 1;
    c.halted = true;
    step(r, c, 0.1);
    // A shell flying on over the boards counts as landed within MISS_LANDS.
    r.shot(-1, 5);
    step(r, c, MISS_LANDS + 0.05);
    expect(boardFlag(r.s, 3)).toBe('miss');
    r.shot(board(3), 0.2);
    step(r, c, 0.3);
    expect(flags()).toEqual(['none', 'none', 'none', 'hit', 'aim', 'none']);
    // A second round at a board already down is a miss (and the line's last).
    r.shot(board(3), 0.2);
    step(r, c, 0.3);
    expect(r.s.misses).toBe(3);
    expect(flags()).toEqual(['none', 'none', 'none', 'hit', 'miss', 'miss']);
    // The last lap and the finish: no flags.
    c.laps = 2;
    step(r, c, 0.1);
    expect(flags().every((f) => f === 'none')).toBe(true);
  });

  it('sends the misses in the run event, and reads a page from before them as none', () => {
    const r = new RangeRun();
    const c = feed();
    r.start('biathlon');
    step(r, c, RUN_COUNTDOWN + 1);
    c.box = 0;
    c.halted = true;
    step(r, c, 0.1);
    r.shot(-1, 0.3);
    step(r, c, 0.5);
    const event = JSON.parse(JSON.stringify(runEvent(r.s, 7)));
    const copy = createRunSnapshot();
    readRunEvent(event, copy);
    expect(copy.misses).toBe(1);
    expect(copy.missAt).toBeCloseTo(r.s.missAt, 6);
    expect(boardFlag(copy, 0)).toBe('miss');
    const old = { ...event };
    delete old.misses;
    delete old.missAt;
    const read = createRunSnapshot();
    readRunEvent(old, read);
    expect(read.misses).toBe(0);
    expect(read.missAt).toBe(-1);
    expect(boardFlag(read, 0)).toBe('aim');
  });

  it('flags line practice (Practice → Biathlon → Line 1 or 2) as a race: three rounds a go, the boards standing again after, ending when the tank leaves the box', () => {
    const r = new RangeRun();
    const c = feed();
    const flags = () => COURSE_TARGETS.map((_, j) => boardFlag(r.s, j));
    r.start('line', undefined, 1);
    // No countdown: line 2's first board is flagged at once, line 1's have none.
    expect(r.s.clock).toBe(0);
    expect(lineFor(r.s.laps)).toBe(1);
    expect(flags()).toEqual(['none', 'none', 'none', 'aim', 'none', 'none']);
    expect(clockLines(r.s)[0]).toBe('Line 2 practice');
    expect(runSign(r.s, 0)).toBe('');
    // On the way to the box: not ended yet.
    step(r, c, 1);
    expect(r.s.phase).toBe('running');
    c.box = 1;
    c.halted = true;
    step(r, c, 0.1);
    // A miss red for a moment, a hit green, the aim moving on.
    r.shot(-1, 0.3);
    step(r, c, 0.5);
    expect(boardFlag(r.s, 3)).toBe('miss');
    r.shot(board(3), 0.3);
    step(r, c, 0.5);
    expect(flags()).toEqual(['none', 'none', 'none', 'hit', 'aim', 'none']);
    expect(boardDown(r.s, 3)).toBe(true);
    expect(runLine(r.s)).toBe('Practising at line 2: 1 of 3 down, 1 round left of this go.');
    // The third round: the go is shot, what's left standing red, nothing owed.
    r.shot(board(4), 0.3);
    step(r, c, 0.5);
    expect(lineClosed(r.s, 1)).toBe(true);
    expect(r.s.owed).toBe(0);
    expect(flags()).toEqual(['none', 'none', 'none', 'hit', 'hit', 'miss']);
    // A round while it shows doesn't count.
    r.shot(board(5), 0.3);
    step(r, c, 0.5);
    expect(boardDown(r.s, 5)).toBe(false);
    // LINE_RESET s after the go the boards stand again, three more rounds, the first yellow.
    step(r, c, LINE_RESET);
    expect(lineClosed(r.s, 1)).toBe(false);
    expect(r.s.rounds).toBe(RACE.rounds);
    expect(flags()).toEqual(['none', 'none', 'none', 'aim', 'none', 'none']);
    // It carries in the run event.
    const copy = createRunSnapshot();
    readRunEvent(JSON.parse(JSON.stringify(runEvent(r.s, 7))), copy);
    expect(copy.mode).toBe('line');
    expect(COURSE_TARGETS.map((_, j) => boardFlag(copy, j))).toEqual(flags());
    // Driven out of the box: it ends, the flags go.
    c.box = -1;
    c.halted = false;
    step(r, c, 0.1);
    expect(r.s.phase).toBe('idle');
    expect(flags().every((f) => f === 'none')).toBe(true);
  });

  it('ends line practice if the tank never reaches its box, and keeps it out of the stats', async () => {
    const { RunRecorder } = await import('../src/sim/play-stats.js');
    const r = new RangeRun();
    const c = feed();
    const recorder = new RunRecorder();
    r.start('range');
    recorder.watch(r.s);
    step(r, c, RUN_COUNTDOWN + 1);
    recorder.watch(r.s);
    // Line practice ends a range run on as restarted, and is no run itself.
    r.start('line', undefined, 0);
    expect(recorder.watch(r.s)?.result).toBe('restarted');
    expect(recorder.counting).toBe(false);
    step(r, c, 9);
    expect(r.s.phase).toBe('idle');
    expect(recorder.watch(r.s)).toBeNull();
  });

  it('gives gold, silver and bronze by time', () => {
    expect(medalFor(MEDAL_TIMES.gold - 1)).toBe('gold');
    expect(medalFor(MEDAL_TIMES.gold + 1)).toBe('silver');
    expect(medalFor(MEDAL_TIMES.silver + 1)).toBe('bronze');
    expect(medalFor(MEDAL_TIMES.bronze + 1)).toBe('');
    expect(medalFor(-1)).toBe('');
    const s = createRunSnapshot();
    s.mode = 'biathlon';
    s.phase = 'done';
    s.time = MEDAL_TIMES.gold - 10;
    expect(raceClockLines(s, formatRunTime)[0]).toBe('Gold!');
  });
});

describe('practice crewmate: the biathlon race (F5.3b)', () => {
  /**
   * The whole race as the crewmate drives it, with a pretend gunner that
   * fires a round every `perRound` s once the tank stands in the line's box
   * and hits the boards in `hits` (by board, 0 to 5). Returns the race and
   * the crewmate.
   */
  function race(hits: readonly number[], perRound: number) {
    const bot = new BotDriver();
    const tank = createTankDrive(COURSE_START.x, COURSE_START.z, COURSE_START.heading);
    const progress = new CourseProgress();
    const run = new RangeRun();
    const wish = createDriveWish();
    const controls = createControls();
    run.start('biathlon');
    bot.startRace();
    let waited = 0;
    let widest = 0;
    let fired = 0;
    let thrown = false;
    for (let t = 0; t < 1200 && run.s.phase === 'running'; t += DT) {
      const s = run.s;
      const o = bot.orders;
      o.on = true;
      o.go = s.clock >= 0;
      o.laps = s.laps;
      o.owed = s.owed;
      const line = lineFor(s.laps);
      o.hold = line >= 0 && !lineClosed(s, line);
      bot.update(DT, tank, wish);
      controls.left = wish.left;
      controls.right = wish.right;
      stepDrive(tank, controls, DT, OBSTACLES);
      progress.step(DT, tank.x, tank.z, tank.speed, tank.heading, tank.falls);
      run.course(progress.s);
      thrown ||= tank.thrown !== 0;
      run.step(DT);
      widest = Math.max(widest, distanceToTrack(tank.x, tank.z));
      // The gunner: a round every perRound s while halted in the line's box with rounds left.
      const atLine = line >= 0 && progress.s.box === line && progress.s.halted && s.rounds > 0;
      waited = atLine ? waited + DT : 0;
      if (atLine && waited >= perRound) {
        waited = 0;
        const j = line * 3 + (RACE.rounds - s.rounds);
        run.shot(hits.includes(j) ? board(j) : -1, 0.6);
        fired++;
      }
    }
    return { run, bot, progress, widest, fired, tank, thrown };
  }

  it('drives a clean race: three laps, halting in box 1 then box 2 while the gunner shoots, no loops, missing no gate', () => {
    const { run, bot, progress, widest, fired, tank, thrown } = race([0, 1, 2, 3, 4, 5], 8);
    expect(run.s.phase).toBe('done');
    expect(fired).toBe(6);
    expect(boardsDown(run.s)).toBe(6);
    expect(run.s.loops).toBe(0);
    expect(run.s.skipped).toBe(0);
    expect(bot.loopsTaken).toBe(0);
    expect(progress.s.missed).toBe(0);
    expect(widest).toBeLessThan(COURSE.halfWidth);
    // Through the driving challenge (F5.3d) cleanly: no slalom faults, no falls off the bridge, no thrown track, no drowned engine.
    expect(progress.s.faults).toBe(0);
    expect(run.s.faults).toBe(0);
    expect(progress.s.falls).toBe(0);
    expect(thrown).toBe(false);
    expect(tank.stalls).toBe(0);
    // The plan's "about 8 to 10 minutes", longer for the driving challenge, and the medal times set from it: gold is a little under the crewmate's clean run.
    console.info(`[biathlon] the crewmate's clean race: ${formatRunTime(run.s.time)}`);
    expect(run.s.time).toBeGreaterThan(MEDAL_TIMES.gold);
    expect(run.s.time).toBeLessThan(MEDAL_TIMES.silver);
    expect(run.s.time).toBeGreaterThan(10 * 60);
    expect(run.s.time).toBeLessThan(14 * 60);
  });

  it('goes round the penalty loop once for each board left standing, before the finish', () => {
    // Line 1: one hit (two loops); line 2: two hits (one loop).
    const { run, bot, progress, widest } = race([1, 3, 5], 8);
    expect(run.s.phase).toBe('done');
    expect(boardsDown(run.s)).toBe(3);
    expect(run.s.loops).toBe(3);
    expect(run.s.skipped).toBe(0);
    expect(bot.loopsTaken).toBe(3);
    expect(progress.s.missed).toBe(0);
    expect(widest).toBeLessThan(COURSE.halfWidth);
    console.info(`[biathlon] with three loops: ${formatRunTime(run.s.time)}`);
    expect(run.s.time).toBeLessThan(MEDAL_TIMES.bronze);
    expect(bot.describe()).toMatch(/^racing/);
  });

  it('lays its route out lap by lap with the penalty loop last, and joins the race on the lap it is on', () => {
    expect(RACE_LOOP_FIRST).toBeGreaterThan(0);
    expect(RACE_ROUTE.slice(RACE_LOOP_FIRST).every((leg) => leg.lap === -1)).toBe(true);
    expect(RACE_ROUTE.filter((leg) => leg.wait === 'line').map((leg) => leg.lap)).toEqual([0, 1]);
    expect(RACE_ROUTE.filter((leg) => leg.fork)).toHaveLength(3);
    const bot = new BotDriver();
    bot.orders.on = true;
    bot.orders.go = true;
    bot.orders.laps = 1;
    const at = RACE_ROUTE.find((leg) => leg.lap === 0 && leg.wait === 'line')!;
    const tank = createTankDrive(at.x, at.z + 2, 0);
    bot.call('course', tank.heading);
    expect(bot.mode).toBe('race');
    bot.update(DT, tank, createDriveWish());
    expect(RACE_ROUTE[bot.leg].lap).toBe(1);
    // Every board is a course board of its own line.
    COURSE_TARGETS.forEach((t, j) => expect(t.line).toBe(Math.floor(j / 3)));
  });
});

describe('biathlon race stats (F5.3b)', () => {
  it("writes a race's laps, misses, penalty loops and medal on its CSV row", async () => {
    const { RunRecorder, runRow, StatsLog, STATS_CSV_HEADER, readRow } = await import('../src/sim/play-stats.js');
    const r = new RangeRun();
    const c = feed();
    const recorder = new RunRecorder();
    r.start('biathlon');
    recorder.watch(r.s);
    step(r, c, RUN_COUNTDOWN + 1);
    c.box = 0;
    c.halted = true;
    step(r, c, 0.1);
    for (const target of [board(0), -1, -1]) r.shot(target, 0.4);
    step(r, c, 1);
    expect(r.s.owed).toBe(2);
    c.penalties = 2;
    step(r, c, 0.1);
    let end = null;
    for (const laps of [1, 2, 3]) {
      c.laps = laps;
      step(r, c, 0.1);
      end = recorder.watch(r.s) ?? end;
    }
    expect(end).not.toBeNull();
    // Line 2 never shot: its three boards were three loops not driven, three minutes on a time still quick enough for gold.
    expect(end!.race).toEqual({ laps: 3, misses: 2, loops: 2, skipped: 3, medal: 'gold' });
    expect(end!.targets).toBe(1);
    const log = new StatsLog();
    log.add(runRow(end!, { at: '2026-11-08 10:00:00', seat: 'gunner', crewmate: 'bot', vignette: 0, bumps: 'full', label: '' }));
    const header = STATS_CSV_HEADER.split(',');
    const line = log.csv().trim().split('\n')[1].split(',');
    expect(line).toHaveLength(header.length);
    const cell = (name: string) => line[header.indexOf(name)];
    expect(cell('mode')).toBe('biathlon');
    expect(cell('laps')).toBe('3');
    expect(cell('misses')).toBe('2');
    expect(cell('penalty_loops')).toBe('2');
    expect(cell('loops_skipped')).toBe('3');
    expect(cell('medal')).toBe('gold');
    // Kept between visits.
    expect(readRow(JSON.parse(log.toJSON())[0])?.race?.medal).toBe('gold');
    // A range run's row leaves them empty but its mode.
    r.start();
    recorder.watch(r.s);
    r.stop();
    const stopped = recorder.watch(r.s)!;
    expect(stopped.race).toBeNull();
  });
});
