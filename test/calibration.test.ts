import { describe, expect, it } from 'vitest';
import { Calibration, levelDistance, MIN_REACH, STILL_SECONDS, STILL_SPREAD } from '../src/sim/calibration.js';

/** Feed `seconds` of head heights from `y(t)` at 90 Hz; returns whether the eyes were taken. */
function hold(cal: Calibration, y: (t: number) => number, seconds: number): boolean {
  let taken = false;
  for (let t = 0; t < seconds; t += 1 / 90) {
    taken = cal.pushHead(y(t), 1 / 90) || taken;
  }
  return taken;
}

describe('calibration: eye height', () => {
  it('takes the head\'s height once it has held still, then asks for the reach', () => {
    const cal = new Calibration();
    cal.start();
    expect(hold(cal, () => 1.18, STILL_SECONDS - 0.2)).toBe(false);
    expect(cal.step).toBe('eyes');
    expect(hold(cal, () => 1.18, 0.3)).toBe(true);
    expect(cal.eye).toBeCloseTo(1.18, 6);
    expect(cal.step).toBe('reach');
  });

  it('averages a small sway, and starts again after a real move', () => {
    const cal = new Calibration();
    cal.start();
    // Settling into the chair: 10 cm lower after half a second.
    hold(cal, (t) => (t < 0.5 ? 1.3 : 1.2), 0.6);
    expect(cal.step).toBe('eyes');
    hold(cal, (t) => 1.2 + (STILL_SPREAD / 3) * Math.sin(t * 6), STILL_SECONDS + 0.1);
    expect(cal.step).toBe('reach');
    expect(cal.eye).toBeCloseTo(1.2, 2);
  });

  it('ignores a headset lying on the floor or lost', () => {
    const cal = new Calibration();
    cal.start();
    hold(cal, () => 0.05, 3);
    hold(cal, () => Number.NaN, 3);
    expect(cal.step).toBe('eyes');
    expect(cal.eye).toBeNaN();
  });

  it('takes a standing player\'s eyes the same way', () => {
    const cal = new Calibration();
    cal.start();
    hold(cal, () => 1.68, STILL_SECONDS + 0.1);
    expect(cal.eye).toBeCloseTo(1.68, 6);
  });
});

describe('calibration: reach', () => {
  const reaching = () => {
    const cal = new Calibration();
    cal.start();
    hold(cal, () => 1.2, STILL_SECONDS + 0.1);
    return cal;
  };

  it('takes the average reach once both grips are squeezed with the hands out', () => {
    const cal = reaching();
    expect(cal.pushReach(0.56, 0.6, false)).toBe(false);
    expect(cal.pushReach(0.56, 0.6, true)).toBe(true);
    expect(cal.reach).toBeCloseTo(0.58, 6);
    expect(cal.step).toBe('done');
  });

  it('waits while a hand is still at rest by the body', () => {
    const cal = reaching();
    expect(cal.pushReach(MIN_REACH - 0.1, 0.6, true)).toBe(false);
    expect(cal.step).toBe('reach');
  });

  it('skips a step at a time, keeping what was taken before', () => {
    const cal = reaching();
    cal.skip();
    expect(cal.step).toBe('done');
    expect(cal.eye).toBeCloseTo(1.2, 6);
    cal.start();
    cal.skip();
    expect(cal.step).toBe('reach');
    expect(cal.eye).toBeCloseTo(1.2, 6);
  });

  it('measures reach level, ignoring height', () => {
    expect(levelDistance({ x: 0, z: 0 }, { x: 0.3, z: -0.4 })).toBeCloseTo(0.5, 6);
  });
});
