import { describe, expect, it } from 'vitest';
import { BOT_GRAVITY, interceptPoint, stepTowards, throwVelocity } from '../src/sim/crew-bot.js';

describe('practice crewmate', () => {
  it('meets a block on its falling path, and lets one go past out of reach', () => {
    const out: [number, number, number] = [0, 0, 0];
    // Thrown level at 4 m/s from 2 m away: after 0.5 s it is at the hand, 1.23 m lower.
    const rest: [number, number, number] = [0, 1.2 - 0.5 * BOT_GRAVITY * 0.25, -2];
    expect(interceptPoint([0, 1.2, 0], [0, 0, -4], rest, out)).toBe(true);
    expect(Math.hypot(out[0] - rest[0], out[1] - rest[1], out[2] - rest[2])).toBeLessThan(0.05);
    expect(interceptPoint([3, 1.2, 0], [0, 0, -4], rest, out)).toBe(false);
  });

  it('throws so the block arrives where it aims', () => {
    const v: [number, number, number] = [0, 0, 0];
    const from: [number, number, number] = [0, 1.2, 0];
    const to: [number, number, number] = [1, 1.1, -2];
    throwVelocity(from, to, 0.5, v);
    const t = 0.5;
    expect(from[0] + v[0] * t).toBeCloseTo(to[0]);
    expect(from[1] + v[1] * t - 0.5 * BOT_GRAVITY * t * t).toBeCloseTo(to[1]);
    expect(from[2] + v[2] * t).toBeCloseTo(to[2]);
  });

  it('walks at a limited speed', () => {
    const p: [number, number, number] = [0, 0, 0];
    expect(stepTowards(p, [1, 0, 0], 0.25)).toBeCloseTo(0.75);
    expect(p[0]).toBeCloseTo(0.25);
    expect(stepTowards(p, [1, 0, 0], 1)).toBe(0);
    expect(p[0]).toBe(1);
  });
});
