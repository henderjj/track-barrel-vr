import { describe, expect, it } from 'vitest';
import { CrankDrill, DRILL_HOLD, DRILL_LIMIT, DRILL_STARTS, drillSummary } from '../src/sim/crank-drill.js';

const DT = 1 / 72;

describe('the crank drill', () => {
  it('times laying the board on the mark, not counting the second held there', () => {
    const drill = new CrankDrill();
    drill.start(10, -20);
    let result = null;
    // Ten seconds closing in evenly, then held on.
    for (let t = DT; !result && t < 20; t += DT) {
      const left = Math.max(0, 1 - t / 10);
      result = drill.step(DT, 10 * left, -20 * left);
    }
    expect(result?.laid).toBe(true);
    // On the mark (within half a mil) a little before ten seconds.
    expect(result!.seconds).toBeGreaterThan(9.5);
    expect(result!.seconds).toBeLessThan(10.01);
    expect(result!.overshootsAcross).toBe(0);
    expect(result!.overshootsUp).toBe(0);
    expect(drill.running).toBe(false);
    expect(drillSummary(result!)).toMatch(/^Laid in \d+\.\d s\. Overshoots: 0 up\/down, 0 across$/);
  });

  it('counts each time the board goes surely past the mark, and not a wobble on it', () => {
    const drill = new CrankDrill();
    drill.start(5, 30);
    // Up: past to -2, back to +1, then onto it. Across: wobbling within 0.3 mil of the mark.
    for (const [across, up] of [[3, 10], [0.2, -2], [-0.2, -1], [0.25, 1], [0.1, 0.2]]) drill.step(DT, across, up);
    let result = null;
    for (let t = 0; !result && t < 3; t += DT) result = drill.step(DT, 0.1, 0.2);
    expect(result).toMatchObject({ laid: true, overshootsUp: 2, overshootsAcross: 0 });
  });

  it('runs out if the board is never laid, and needs the board held on the mark', () => {
    const drill = new CrankDrill();
    drill.start(-8, 8);
    let result = null;
    // On for less than the hold, then off again: not laid.
    for (let t = 0; t < DRILL_HOLD * 0.8; t += DT) expect(drill.step(DT, 0, 0)).toBeNull();
    for (let t = 0; !result && t < DRILL_LIMIT + 1; t += DT) result = drill.step(DT, 3, 3);
    expect(result?.laid).toBe(false);
    expect(drillSummary(result!)).toMatch(/^Not laid in 90 s/);
  });

  it('starts the board a few turns of each crank off, every way round', () => {
    expect(DRILL_STARTS.some(([a]) => a > 0) && DRILL_STARTS.some(([a]) => a < 0)).toBe(true);
    expect(DRILL_STARTS.some(([, u]) => u > 0) && DRILL_STARTS.some(([, u]) => u < 0)).toBe(true);
    for (const [a, u] of DRILL_STARTS) {
      expect(Math.abs(a)).toBeGreaterThanOrEqual(5);
      expect(Math.abs(u)).toBeGreaterThanOrEqual(13);
    }
  });
});
