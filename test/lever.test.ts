import { describe, expect, it } from 'vitest';
import { rigOffset, SEATED_EYE, targetEyeHeight } from '../src/sim/body-height.js';
import { angleOf, Lever, LEVER_RIG, LeverEvent, OneEuro, TILLER } from '../src/sim/lever.js';
import { LANE, LANE_HALF_WIDTH, LANE_LENGTH, LaneRun, placeOnLane } from '../src/sim/lever-lane.js';

const DEG = Math.PI / 180;
/** A hand at lever angle `deg`, `r` from the pivot, as (y, z) in lever space. */
const handAt = (deg: number, r = 0.39): [number, number] => [r * Math.cos(deg * DEG), -r * Math.sin(deg * DEG)];

describe('the hand-following lever', () => {
  it('reads the hand angle round the pivot, forwards positive', () => {
    expect(angleOf(...handAt(0))).toBeCloseTo(0);
    expect(angleOf(...handAt(20))).toBeCloseTo(20 * DEG);
    expect(angleOf(...handAt(-15))).toBeCloseTo(-15 * DEG);
    expect(angleOf(0.01, 0.01)).toBeNaN();
  });

  it('does not jump when taken hold of off the handle, then follows the hand', () => {
    const lever = new Lever(TILLER);
    expect(lever.grab(angleOf(...handAt(5)))).toBe(true);
    lever.update(1 / 90, angleOf(...handAt(5)));
    expect(lever.angle).toBeCloseTo(0, 5);
    // Move the hand 15° forwards over a third of a second.
    for (let i = 1; i <= 30; i++) lever.update(1 / 90, angleOf(...handAt(5 + i / 2)));
    for (let i = 0; i < 30; i++) lever.update(1 / 90, angleOf(...handAt(20)));
    expect(lever.angle / DEG).toBeCloseTo(15, 1);
    expect(lever.overshoot).toBe(0);
  });

  it('stops at its limits, says how far past the hand is, and ticks once on reaching one', () => {
    const lever = new Lever(TILLER);
    lever.grab(angleOf(...handAt(0)));
    let limits = 0;
    for (let i = 0; i <= 90; i++) {
      if (lever.update(1 / 90, angleOf(...handAt(i * 0.5))) & LeverEvent.Limit) limits++;
    }
    for (let i = 0; i < 60; i++) {
      if (lever.update(1 / 90, angleOf(...handAt(45))) & LeverEvent.Limit) limits++;
    }
    expect(lever.angle).toBeCloseTo(TILLER.max);
    expect(lever.overshoot / DEG).toBeCloseTo(20, 0);
    expect(limits).toBe(1);
    // Back off and push again: felt again.
    for (let i = 0; i < 60; i++) lever.update(1 / 90, angleOf(...handAt(10)));
    for (let i = 0; i < 60; i++) {
      if (lever.update(1 / 90, angleOf(...handAt(40))) & LeverEvent.Limit) limits++;
    }
    expect(limits).toBe(2);
    // And the back limit.
    for (let i = 0; i < 90; i++) lever.update(1 / 90, angleOf(...handAt(-40)));
    expect(lever.angle).toBeCloseTo(TILLER.min);
    expect(lever.overshoot).toBeLessThan(0);
  });

  it('ignores the hand’s sideways position and distance from the pivot', () => {
    const lever = new Lever(TILLER);
    lever.grab(angleOf(...handAt(0)));
    for (let i = 0; i < 90; i++) lever.update(1 / 90, angleOf(...handAt(12, 0.3)));
    expect(lever.angle / DEG).toBeCloseTo(12, 1);
  });

  it('ticks passing the middle detent while held', () => {
    const lever = new Lever(TILLER);
    lever.grab(angleOf(...handAt(0)));
    for (let i = 0; i < 45; i++) lever.update(1 / 90, angleOf(...handAt(-10)));
    let detents = 0;
    for (let i = 0; i < 90; i++) {
      if (lever.update(1 / 90, angleOf(...handAt(10))) & LeverEvent.Detent) detents++;
    }
    expect(detents).toBe(1);
  });

  it('holds still for a step where the hand is lost, and springs back when let go', () => {
    const lever = new Lever(TILLER);
    lever.grab(angleOf(...handAt(0)));
    for (let i = 0; i < 90; i++) lever.update(1 / 90, angleOf(...handAt(20)));
    const held = lever.angle;
    lever.update(1 / 90, Number.NaN);
    expect(lever.angle).toBe(held);
    lever.release();
    // Most of the way back in a third of a second.
    for (let i = 0; i < 30; i++) lever.update(1 / 90, Number.NaN);
    expect(Math.abs(lever.angle)).toBeLessThan(1 * DEG);
  });

  it('reads as a drive demand with a deadband round rest', () => {
    const lever = new Lever(TILLER);
    lever.angle = 1.5 * DEG;
    expect(lever.demand()).toBe(0);
    lever.angle = TILLER.max;
    expect(lever.demand()).toBeCloseTo(1);
    lever.angle = TILLER.min;
    expect(lever.demand()).toBeCloseTo(-1);
    lever.angle = (TILLER.max + TILLER.deadband) / 2;
    expect(lever.demand()).toBeCloseTo(0.5);
  });

  it('steadies a tracked hand’s jitter while still but keeps up when it moves', () => {
    // ±4 mm of jitter on a hand 39 cm from the pivot is about ±0.6°.
    const jittery = (i: number) => angleOf(...handAt(10 + ((i * 7919) % 13 - 6) * 0.1));
    const lever = new Lever(TILLER);
    lever.grab(angleOf(...handAt(10)), true);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 180; i++) {
      lever.update(1 / 90, jittery(i));
      if (i > 90) {
        lo = Math.min(lo, lever.angle);
        hi = Math.max(hi, lever.angle);
      }
    }
    expect((hi - lo) / DEG).toBeLessThan(0.3);
    // A deliberate 15° push in 0.2 s is followed to within 2° 0.1 s after it
    // ends (the lever was taken hold of 10° behind the hand, so it ends at 15°).
    for (let i = 1; i <= 18; i++) lever.update(1 / 90, angleOf(...handAt(10 + (15 * i) / 18)));
    for (let i = 0; i < 9; i++) lever.update(1 / 90, angleOf(...handAt(25)));
    expect(lever.angle / DEG).toBeGreaterThan(13);
  });

  it('puts the handles in reach from a chair, seated or standing', () => {
    // As test/body-height.test.ts: a seated player's hands reach from about
    // 0.45 m to 1.4 m above their real floor. The rig is placed from the eyes.
    const raised = rigOffset(targetEyeHeight({ height: 0, seated: true }), 1.2);
    for (const angle of [TILLER.min, 0, TILLER.max]) {
      const lever = new Lever(TILLER);
      lever.angle = angle;
      const [, y, z] = lever.gripCentre([0, 0, 0]);
      const handle = SEATED_EYE - LEVER_RIG.below + y - raised;
      expect(handle).toBeGreaterThan(0.45);
      expect(handle).toBeLessThan(1.4);
      // Ahead of the chest and within a forearm and a bit of the eyes.
      expect(LEVER_RIG.ahead - z).toBeGreaterThan(0.2);
      expect(LEVER_RIG.ahead - z).toBeLessThan(0.65);
    }
  });

  it('one-euro filter passes a still value straight through', () => {
    const f = new OneEuro(1, 0);
    for (let i = 0; i < 10; i++) expect(f.filter(0.3, 0.01)).toBeCloseTo(0.3);
  });
});

describe('the test lane', () => {
  it('measures where a point is along the lane and how far off it', () => {
    const p = placeOnLane(1, 10, { along: 0, off: 0 });
    expect(p.along).toBeCloseTo(10);
    expect(p.off).toBeCloseTo(1);
    const end = placeOnLane(...(LANE[LANE.length - 1] as [number, number]), { along: 0, off: 0 });
    expect(end.along).toBeCloseTo(LANE_LENGTH);
  });

  it('drives straight with both tillers forwards and turns right with the left one ahead', () => {
    const run = new LaneRun();
    run.reset();
    for (let i = 0; i < 180; i++) run.update(1 / 90, 1, 1);
    expect(run.heading).toBeCloseTo(0);
    expect(run.y).toBeGreaterThan(5);
    expect(run.started).toBe(true);
    for (let i = 0; i < 90; i++) run.update(1 / 90, 1, 0);
    expect(run.heading).toBeGreaterThan(0.3);
    expect(run.x).toBeGreaterThan(0);
  });

  it('turns on the spot with the tillers opposed', () => {
    const run = new LaneRun();
    run.reset();
    for (let i = 0; i < 270; i++) run.update(1 / 90, -1, 1);
    expect(Math.hypot(run.x, run.y)).toBeLessThan(0.01);
    expect(run.heading).toBeLessThan(-1);
  });

  it('finishes a lane driven by a simple steering rule, and counts time off it', () => {
    const run = new LaneRun();
    run.reset();
    // Steer at a point 8 m further along the lane.
    const place = { along: 0, off: 0 };
    let t = 0;
    while (!run.finished && t < 120) {
      placeOnLane(run.x, run.y, place);
      const target = pointAlong(Math.min(place.along + 8, LANE_LENGTH));
      const want = Math.atan2(target[0] - run.x, target[1] - run.y);
      let err = want - run.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      const steer = Math.max(-1, Math.min(1, err * 2));
      run.update(1 / 90, Math.min(1, 0.8 + steer), Math.min(1, 0.8 - steer));
      t += 1 / 90;
    }
    expect(run.finished).toBe(true);
    expect(run.time).toBeGreaterThan(15);
    expect(run.offTime).toBeLessThan(1);
    expect(run.best).toBeGreaterThan(LANE_LENGTH - 5);
    // Off the lane counts.
    run.reset();
    run.x = LANE_HALF_WIDTH + 2;
    for (let i = 0; i < 90; i++) run.update(1 / 90, 0.3, 0.3);
    expect(run.off).toBe(true);
    expect(run.offTime).toBeGreaterThan(0.5);
  });
});

function pointAlong(d: number): [number, number] {
  for (let i = 1; i < LANE.length; i++) {
    const [ax, ay] = LANE[i - 1];
    const [bx, by] = LANE[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (d <= len) return [ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len];
    d -= len;
  }
  return [LANE[LANE.length - 1][0], LANE[LANE.length - 1][1]];
}
