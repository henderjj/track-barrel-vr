import { describe, expect, it } from 'vitest';
import { rigOffset, SEATED_EYE, targetEyeHeight } from '../src/sim/body-height.js';
import { LEVER_RIG, TILLER } from '../src/sim/lever.js';
import { Lever } from '../src/sim/mechanism.js';
import { LANE, LANE_HALF_WIDTH, LANE_LENGTH, LaneRun, placeOnLane } from '../src/sim/lever-lane.js';

describe('the lever test rig (spike S3)', () => {
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
