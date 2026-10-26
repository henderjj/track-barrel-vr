import { describe, expect, it } from 'vitest';
import {
  CELL,
  cornerHeight,
  FLAT_RADIUS,
  groundHeight,
  LANE_HALF,
  type Obstacle,
  obstacleDistance,
  OBSTACLES,
  roughness,
  TILE,
  wrapTile,
} from '../src/sim/terrain.js';

describe('terrain (F1.4)', () => {
  it('repeats every tile, so a drive of any length stays on it', () => {
    for (const [x, z] of [[37.3, -112.9], [301, 250.5], [-5, 7]]) {
      expect(groundHeight(x + TILE, z)).toBeCloseTo(groundHeight(x, z), 9);
      expect(groundHeight(x, z - 3 * TILE)).toBeCloseTo(groundHeight(x, z), 9);
    }
    expect(TILE % CELL).toBe(0);
    expect(wrapTile(TILE * 2 + 5)).toBeCloseTo(5);
  });

  it('is flat on the start field and the lane, and rolls elsewhere', () => {
    expect(groundHeight(0, 0)).toBe(0);
    // Cells with every corner on the flat are flat: about 18 m round the start, 16 m either side of the lane's middle.
    expect(groundHeight(12, -10)).toBe(0);
    for (const z of [-100, -250, -500, 333]) for (const x of [-15, 0, 15.5]) expect(groundHeight(x, z)).toBe(0);
    expect(LANE_HALF).toBeGreaterThan(CELL);
    let max = 0;
    for (let x = 60; x < 400; x += 7) for (let z = 0; z < 400; z += 11) max = Math.max(max, Math.abs(groundHeight(x, z)));
    expect(max).toBeGreaterThan(0.8);
    expect(max).toBeLessThan(2.5);
    expect(roughness(200, 200)).toBe(1);
  });

  it('joins its samples into the same triangles the drawn ground has', () => {
    // On a corner, the sample; on the diagonal, halfway between its ends.
    expect(groundHeight(5 * CELL, 9 * CELL)).toBeCloseTo(cornerHeight(5, 9), 9);
    const mid = groundHeight(5.5 * CELL, 9.5 * CELL);
    expect(mid).toBeCloseTo((cornerHeight(5, 9) + cornerHeight(6, 10)) / 2, 9);
  });

  it('measures the distance to a rock and to a turned box, with the way out', () => {
    const n: [number, number] = [0, 0];
    const rock: Obstacle = { kind: 'rock', x: 10, z: 10, r: 2, hx: 2, hz: 2, yaw: 0, height: 2 };
    expect(obstacleDistance(rock, 15, 10, n)).toBeCloseTo(3);
    expect(n[0]).toBeCloseTo(1);
    expect(obstacleDistance(rock, 10, 9, n)).toBeCloseTo(-1);
    // The nearest copy, a tile away.
    expect(obstacleDistance(rock, 10 + TILE - 5, 10, n)).toBeCloseTo(3);
    const box: Obstacle = { kind: 'wall', x: 0, z: 0, r: 5, hx: 4, hz: 0.5, yaw: Math.PI / 2, height: 1 };
    // Turned a quarter, its long side runs along z.
    expect(obstacleDistance(box, 0, 6, n)).toBeCloseTo(2);
    expect(n[1]).toBeCloseTo(1);
    expect(obstacleDistance(box, 2, 0, n)).toBeCloseTo(1.5);
    expect(n[0]).toBeCloseTo(1);
    expect(obstacleDistance(box, 0.2, 0, n)).toBeLessThan(0);
  });

  it('places the same obstacles on every page, with some near the start but none on it or the lane', () => {
    expect(OBSTACLES.length).toBeGreaterThan(40);
    const near = OBSTACLES.filter((o) => Math.hypot(o.x, o.z) < 150);
    expect(new Set(near.map((o) => o.kind))).toEqual(new Set(['rock', 'wall', 'house']));
    const n: [number, number] = [0, 0];
    for (const o of OBSTACLES) {
      expect(obstacleDistance(o, 0, 0, n)).toBeGreaterThan(FLAT_RADIUS);
      for (let z = -TILE / 2; z < TILE / 2; z += 2) expect(obstacleDistance(o, 0, z, n)).toBeGreaterThan(1.8 + 1);
    }
  });
});
