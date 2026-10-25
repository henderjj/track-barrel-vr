import { describe, expect, it } from 'vitest';
import { throughHoop } from '../src/sim/score.js';

const hoop = { x: 0, y: 2, z: -2.6, radius: 0.35 };

describe('hoop scoring', () => {
  it('counts a block that crosses the hoop inside the ring, going away', () => {
    expect(throughHoop([0, 2.1, -2.5], [0.05, 2.05, -2.7], hoop, 0.05)).toBe(true);
  });

  it('ignores a block that misses the ring, clips its edge or comes back through', () => {
    expect(throughHoop([0.5, 2, -2.5], [0.5, 2, -2.7], hoop, 0.05)).toBe(false);
    expect(throughHoop([0, 2.32, -2.5], [0, 2.32, -2.7], hoop, 0.05)).toBe(false);
    expect(throughHoop([0, 2, -2.7], [0, 2, -2.5], hoop, 0.05)).toBe(false);
  });

  it('counts the crossing once, not on the frames either side', () => {
    expect(throughHoop([0, 2, -2.4], [0, 2, -2.5], hoop, 0.05)).toBe(false);
    expect(throughHoop([0, 2, -2.6], [0, 2, -2.7], hoop, 0.05)).toBe(false);
  });
});
