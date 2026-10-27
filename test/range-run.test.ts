import { describe, expect, it } from 'vitest';
import {
  clockLines,
  countdownNumber,
  createRunSnapshot,
  flagUp,
  formatRunTime,
  hitFlagFoot,
  hitFlagYaw,
  HIT_FLAG,
  RangeRun,
  readRunEvent,
  RUN_COUNTDOWN,
  runEvent,
  runLine,
  runSign,
  targetsHit,
} from '../src/sim/range-run.js';
import { RANGE_TARGETS, ROAD, targetBoard, targetFoot } from '../src/sim/range.js';
import { groundHeight, LANE_HALF } from '../src/sim/terrain.js';

const DT = 1 / 90;

function run(r: RangeRun, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) r.step(DT);
}

describe('range run (F1.11)', () => {
  it('counts down, then times the crew until all three targets have been hit', () => {
    const r = new RangeRun();
    expect(r.s.phase).toBe('idle');
    r.start();
    expect(r.s.phase).toBe('running');
    expect(r.s.clock).toBe(-RUN_COUNTDOWN);
    expect(countdownNumber(r.s)).toBe(3);
    run(r, 1.2);
    expect(countdownNumber(r.s)).toBe(2);
    // A shot in the countdown doesn't count.
    expect(r.shot(0, 0.2)).toBe(false);
    run(r, 2);
    expect(r.counting).toBe(true);
    expect(r.shot(-1, 0.9)).toBe(true);
    expect(r.shot(0, 0.17)).toBe(true);
    // The hit counts when the shell lands.
    expect(targetsHit(r.s)).toBe(0);
    run(r, 0.3);
    expect(targetsHit(r.s)).toBe(1);
    // A second hit on the same target adds a shot, not a target.
    r.shot(0, 0.17);
    run(r, 0.3);
    expect(targetsHit(r.s)).toBe(1);
    r.shot(1, 0.42);
    run(r, 2);
    r.shot(2, 0.85);
    const fired = r.s.clock;
    run(r, 0.5);
    expect(r.s.phase).toBe('running');
    run(r, 0.5);
    expect(r.s.phase).toBe('done');
    expect(r.s.time).toBeCloseTo(fired + 0.85, 1);
    expect(r.s.shots).toBe(5);
    expect(r.s.best).toBe(r.s.time);
    // The clock stops on the time.
    run(r, 3);
    expect(r.s.clock).toBe(r.s.time);
    expect(r.shot(0, 0.1)).toBe(false);
    expect(runLine(r.s)).toMatch(/^Three targets in 0:0\d\.\d, 5 shots\. Best/);
    expect(clockLines(r.s)[0]).toBe('Three hits!');
  });

  it('keeps the best time, but not from an assisted run, and restarts clean', () => {
    const r = new RangeRun();
    const quick = (gap: number, assisted = false) => {
      r.start();
      run(r, RUN_COUNTDOWN + 0.01);
      if (assisted) r.assist();
      for (let i = 0; i < 3; i++) {
        r.shot(i, 0.1);
        run(r, gap);
      }
    };
    quick(2);
    const first = r.s.time;
    expect(r.s.phase).toBe('done');
    quick(1, true);
    expect(r.s.assisted).toBe(true);
    expect(r.s.time).toBeLessThan(first);
    expect(r.s.best).toBe(first);
    expect(clockLines(r.s)[0]).toContain('assisted');
    quick(1);
    expect(r.s.best).toBeLessThan(first);
    // Restart part-way: the targets and shots count again from nothing.
    r.start();
    expect(r.s.shots).toBe(0);
    expect(targetsHit(r.s)).toBe(0);
    expect(r.s.assisted).toBe(false);
    expect(r.s.id).toBe(4);
  });

  it('stops: the flags come down, and a hit still flying lands on nothing', () => {
    const r = new RangeRun();
    r.start();
    run(r, RUN_COUNTDOWN + 0.1);
    r.shot(0, 0.1);
    run(r, 0.2);
    r.shot(1, 0.5);
    expect(flagUp(r.s, 0)).toBe(true);
    r.stop();
    expect(r.s.phase).toBe('idle');
    expect(flagUp(r.s, 0)).toBe(false);
    run(r, 1);
    expect(targetsHit(r.s)).toBe(0);
    expect(runLine(r.s)).toBe('No run on.');
  });

  it('holds the clock while paused and counts no shots', () => {
    const r = new RangeRun();
    r.start();
    run(r, RUN_COUNTDOWN + 1);
    const at = r.s.clock;
    r.setPaused(true);
    run(r, 5);
    expect(r.s.clock).toBe(at);
    expect(r.shot(0, 0.1)).toBe(false);
    expect(runLine(r.s)).toContain('(paused)');
    r.setPaused(false);
    run(r, 1);
    expect(r.s.clock).toBeCloseTo(at + 1, 5);
  });

  it("sends the run as an event the guest copies, its clock moved on by the event's age", () => {
    const host = new RangeRun();
    host.start();
    run(host, RUN_COUNTDOWN + 2);
    host.shot(1, 0.4);
    run(host, 0.5);
    const event = JSON.parse(JSON.stringify(runEvent(host.s, 1234)));
    expect(event.t).toBe('run');
    const guest = new RangeRun();
    const read = readRunEvent(event, createRunSnapshot());
    expect(read).toEqual({ at: 1234 });
    const copy = createRunSnapshot();
    readRunEvent(event, copy);
    guest.apply(copy, 0.1);
    expect(guest.s.id).toBe(1);
    expect(guest.s.hitAt).toEqual(host.s.hitAt);
    expect(guest.s.clock).toBeCloseTo(host.s.clock + 0.1, 5);
    guest.follow(0.5);
    expect(guest.s.clock).toBeCloseTo(host.s.clock + 0.6, 5);
    // The guest's clock never finishes a run by itself.
    guest.follow(100);
    expect(guest.s.phase).toBe('running');
    // Bad events are refused.
    expect(readRunEvent({ ...event, phase: 'flying' }, createRunSnapshot())).toBeNull();
    expect(readRunEvent({ ...event, hitAt: [1, 2] }, createRunSnapshot())).toBeNull();
    expect(readRunEvent({ ...event, clock: 'soon' }, createRunSnapshot())).toBeNull();
  });

  it('writes times as minutes, seconds and tenths, and says what the sign should', () => {
    expect(formatRunTime(0)).toBe('0:00.0');
    expect(formatRunTime(42.14)).toBe('0:42.1');
    expect(formatRunTime(83.45)).toMatch(/^1:23\.[45]$/);
    const r = new RangeRun();
    expect(runSign(r.s, 0)).toBe('');
    r.start();
    expect(runSign(r.s, 0)).toBe('Range run: 3');
    run(r, RUN_COUNTDOWN + 0.5);
    expect(runSign(r.s, 0)).toMatch(/^Go!/);
    run(r, 2);
    expect(runSign(r.s, 0)).toBe('');
    for (let i = 0; i < 3; i++) r.shot(i, 0.1);
    run(r, 0.2);
    expect(runSign(r.s, 1)).toMatch(/^Three targets in/);
    expect(runSign(r.s, 30)).toBe('');
  });

  it("stands each target's hit flag beside it, away from the road, on the ground's flat corridor", () => {
    RANGE_TARGETS.forEach((t, i) => {
      const [fx, fz] = hitFlagFoot(i);
      const [tx, tz] = targetFoot(i);
      expect(fz).toBe(tz);
      // Clear of the board's edge, on its far side from the road.
      expect(Math.abs(fx - tx)).toBeGreaterThanOrEqual(targetBoard(i).width / 2 + 1);
      expect(Math.abs(fx)).toBeGreaterThan(Math.abs(tx));
      expect(Math.abs(fx) - HIT_FLAG.radius).toBeGreaterThan(ROAD.halfWidth);
      // The flag flies away from the road, never over the board.
      const tip = fx + Math.cos(hitFlagYaw(i)) * HIT_FLAG.width;
      expect(Math.min(Math.abs(fx), Math.abs(tip))).toBeGreaterThan(Math.abs(tx) + targetBoard(i).width / 2 + 1);
      expect(Math.max(Math.abs(fx), Math.abs(tip))).toBeLessThan(LANE_HALF);
      expect(Math.sign(tip - fx)).toBe(Math.sign(t.across));
      expect(groundHeight(fx, fz)).toBeCloseTo(groundHeight(tx, tz), 2);
    });
  });
});
