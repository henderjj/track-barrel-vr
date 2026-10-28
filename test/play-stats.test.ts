import { describe, expect, it } from 'vitest';
import {
  createTally,
  crewStatsEvent,
  csvLine,
  FUMBLE_GROUPS,
  fumbleGroup,
  lastRunLine,
  MAX_ROWS,
  mostFumbled,
  queasyRow,
  readCrewStats,
  type RowContext,
  RunRecorder,
  runRow,
  STATS_CSV_HEADER,
  StatsLog,
  stepTally,
  TALK_HOLD,
  visitRow,
  wallClock,
} from '../src/sim/play-stats.js';
import { RangeRun } from '../src/sim/range-run.js';
import { SPEAKING_LEVEL } from '../src/sim/tank-audio.js';

const DT = 1 / 90;
const CONTEXT: RowContext = { at: '2026-10-28 12:00:00', seat: 'gunner', crewmate: 'player', vignette: 0.5, bumps: 'full', label: 'pair A' };
const group = (name: string) => FUMBLE_GROUPS.indexOf(name as never);

/** The run stepped `seconds` on, with the recorder watching it each frame and counting the seat; returns any end it saw. */
function play(run: RangeRun, recorder: RunRecorder, seconds: number, seat = 'gunner') {
  let end = null;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    run.step(DT);
    const e = recorder.watch(run.s);
    if (e) end = { ...e, tally: { ...e.tally, fumbles: [...e.tally.fumbles] } };
    if (recorder.counting) stepTally(recorder.tally, DT, seat, 0, 0);
  }
  return end;
}

describe('play-test stats (F1.14)', () => {
  it('counts each control in its own group, both tillers as one', () => {
    expect(FUMBLE_GROUPS[fumbleGroup('driver-tiller-left')]).toBe('tillers');
    expect(FUMBLE_GROUPS[fumbleGroup('driver-tiller-right')]).toBe('tillers');
    expect(FUMBLE_GROUPS[fumbleGroup('gear-lever')]).toBe('gear');
    expect(FUMBLE_GROUPS[fumbleGroup('hand-throttle')]).toBe('throttle');
    expect(FUMBLE_GROUPS[fumbleGroup('turret-twist')]).toBe('power_traverse');
    expect(FUMBLE_GROUPS[fumbleGroup('turret-crank')]).toBe('crank');
    expect(FUMBLE_GROUPS[fumbleGroup('turret-elevation')]).toBe('elevation');
    expect(FUMBLE_GROUPS[fumbleGroup('driver-periscope')]).toBe('periscope');
    expect(FUMBLE_GROUPS[fumbleGroup('breech-lever')]).toBe('breech');
    expect(FUMBLE_GROUPS[fumbleGroup('shell')]).toBe('shell');
    expect(FUMBLE_GROUPS[fumbleGroup('bench-yoke')]).toBe('other');
    const f = FUMBLE_GROUPS.map(() => 0);
    expect(mostFumbled(f)).toBe('');
    f[group('shell')] = 2;
    f[group('gear')] = 2;
    expect(mostFumbled(f)).toBe('gear');
  });

  it('counts seat time and talking, with short gaps between words as talking', () => {
    const t = createTally();
    for (let i = 0; i < 90; i++) stepTally(t, DT, 'driver', i < 45 ? SPEAKING_LEVEL : 0, 0);
    for (let i = 0; i < 45; i++) stepTally(t, DT, 'gunner', 0, SPEAKING_LEVEL * 2);
    expect(t.driver).toBeCloseTo(1, 5);
    expect(t.gunner).toBeCloseTo(0.5, 5);
    expect(t.talk).toBeCloseTo(0.5 + TALK_HOLD, 1);
    expect(t.crewTalk).toBeCloseTo(0.5, 1);
  });

  it('writes a row when a run is done, with the time, shots and what the player did while the clock ran', () => {
    const run = new RangeRun();
    const rec = new RunRecorder();
    run.start();
    // The countdown doesn't count.
    expect(play(run, rec, 2.9)).toBeNull();
    expect(rec.counting).toBe(false);
    expect(rec.tally.gunner).toBe(0);
    play(run, rec, 2.1);
    expect(rec.counting).toBe(true);
    rec.tally.fumbles[group('shell')]++;
    rec.tally.grinds++;
    for (let i = 0; i < 3; i++) run.shot(i, 0.2);
    const end = play(run, rec, 1);
    expect(end).not.toBeNull();
    expect(end!.result).toBe('done');
    expect(end!.run).toBe(1);
    expect(end!.targets).toBe(3);
    expect(end!.shots).toBe(3);
    expect(end!.time).toBeCloseTo(run.s.time, 6);
    expect(end!.tally.gunner).toBeCloseTo(end!.time, 1);
    expect(end!.tally.grinds).toBe(1);
    expect(end!.tally.fumbles[group('shell')]).toBe(1);
    // Once done, nothing more counts and no second row comes.
    expect(play(run, rec, 1)).toBeNull();
    expect(rec.counting).toBe(false);
  });

  it('writes a stopped or restarted run with its numbers as they stood, then starts afresh', () => {
    const run = new RangeRun();
    const rec = new RunRecorder();
    run.start();
    play(run, rec, 5);
    run.shot(0, 0.1);
    play(run, rec, 0.5);
    run.stop();
    const stopped = play(run, rec, DT);
    expect(stopped!.result).toBe('stopped');
    expect(stopped!.targets).toBe(1);
    expect(stopped!.shots).toBe(1);
    expect(stopped!.time).toBeGreaterThan(2);
    run.start();
    play(run, rec, 4);
    expect(rec.tally.gunner).toBeLessThan(1.1);
    run.start();
    const restarted = play(run, rec, DT);
    expect(restarted!.result).toBe('restarted');
    expect(restarted!.run).toBe(2);
    expect(rec.tally.gunner).toBe(0);
  });

  it("doesn't count while the crewmate is away", () => {
    const run = new RangeRun();
    const rec = new RunRecorder();
    run.start();
    play(run, rec, 4);
    run.setPaused(true);
    const before = rec.tally.gunner;
    play(run, rec, 2);
    expect(rec.tally.gunner).toBe(before);
  });

  it("matches the crewmate's numbers to the run, whichever comes first, and marks a practice crewmate", () => {
    const log = new StatsLog();
    const run = new RangeRun();
    const rec = new RunRecorder();
    run.start();
    play(run, rec, 5);
    run.stop();
    const end = play(run, rec, DT)!;
    const theirs = createTally();
    theirs.driver = 2;
    theirs.fumbles[group('gear')] = 3;
    const sent = readCrewStats(crewStatsEvent(1, theirs, true));
    expect(sent).not.toBeNull();
    // The crewmate's event before this page's row.
    log.addCrew(sent!.run, sent!.crew);
    log.add(runRow(end, CONTEXT));
    const row = log.rows[0];
    expect(row.crew?.driver).toBe(2);
    expect(row.crewmate).toBe('bot');
    // And after it.
    log.add(runRow({ ...end, run: 2 }, CONTEXT));
    log.addCrew(2, { ...sent!.crew, bot: false });
    expect(log.rows[1].crew?.fumbles[group('gear')]).toBe(3);
    expect(log.rows[1].crewmate).toBe('player');
    expect(readCrewStats({ t: 'run-stats', run: 'x' })).toBeNull();
  });

  it('makes a CSV with a column per control, marks, the visit, and keeps the log as JSON', () => {
    const log = new StatsLog();
    const t = createTally();
    t.fumbles[group('shell')] = 2;
    t.fumbles[group('breech')] = 1;
    t.driver = 0;
    t.gunner = 41.25;
    log.add(runRow({ run: 3, result: 'done', time: 41.25, shots: 4, targets: 3, assisted: false, tally: t }, CONTEXT));
    log.add(queasyRow(3, 12.5, 5, (10 * Math.PI) / 180, CONTEXT));
    const csv = log.csv(visitRow(t, 300, CONTEXT)).trim().split('\n');
    const header = STATS_CSV_HEADER.split(',');
    expect(csv[0]).toBe(STATS_CSV_HEADER);
    expect(csv).toHaveLength(4);
    for (const line of csv) expect(line.split(',')).toHaveLength(header.length);
    const cell = (line: string, name: string) => line.split(',')[header.indexOf(name)];
    expect(cell(csv[1], 'kind')).toBe('run');
    expect(cell(csv[1], 'time_s')).toBe('41.3');
    expect(cell(csv[1], 'fumbles')).toBe('3');
    expect(cell(csv[1], 'fumbles_shell')).toBe('2');
    expect(cell(csv[1], 'most_fumbled')).toBe('shell');
    expect(cell(csv[1], 'gunner_s')).toBe('41.3');
    expect(cell(csv[1], 'crew_driver_s')).toBe('');
    expect(cell(csv[1], 'label')).toBe('pair A');
    expect(cell(csv[2], 'kind')).toBe('queasy');
    expect(cell(csv[2], 'time_s')).toBe('12.5');
    expect(cell(csv[2], 'speed_kmh')).toBe('18.0');
    expect(cell(csv[2], 'turn_dps')).toBe('10.0');
    expect(cell(csv[2], 'fumbles')).toBe('');
    expect(cell(csv[3], 'kind')).toBe('visit');
    expect(cell(csv[3], 'time_s')).toBe('300.0');
    expect(csvLine({ ...log.rows[0], label: 'a,b\nc' }).split(',')).toHaveLength(header.length);

    const kept = new StatsLog();
    kept.load(log.toJSON());
    expect(kept.csv()).toBe(log.csv());
    kept.load('not json');
    kept.load('[{"kind":"nonsense"}]');
    expect(kept.rows).toHaveLength(2);
    expect(lastRunLine(kept)).toBe('Last: run 3 0:41.3, 4 shots, 0 grinds, 3 fumbles (most: shell). 1 run, 1 queasy mark recorded.');
    expect(lastRunLine(new StatsLog())).toBe('No runs recorded yet: start a range run.');
  });

  it('keeps at most MAX_ROWS rows', () => {
    const log = new StatsLog();
    for (let i = 0; i < MAX_ROWS + 10; i++) log.add(queasyRow(0, -1, 0, 0, CONTEXT));
    expect(log.rows).toHaveLength(MAX_ROWS);
  });

  it('writes local wall-clock time', () => {
    expect(wallClock(new Date(2026, 9, 28, 7, 5, 9))).toBe('2026-10-28 07:05:09');
  });
});
