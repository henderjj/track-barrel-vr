/**
 * The quickest line a perfect driver could take between walls, for the
 * driving challenge's tests (F5.3d): a line of points, shaken at random
 * and kept wherever it gets quicker and stays clear. Its time comes from
 * the line's own curvature: never faster than the tank's top speed, nor
 * than the sideways push that throws a track allows, and speeding up or
 * slowing no faster than the comfort cap. That ignores the hull's length,
 * the engine and the gears, so it is quicker than any real driver: if this
 * line is slower than something, every real line is.
 */

import { MAX_ACCEL, MAX_SPEED } from '../../src/sim/comfort.js';
import { THROW_LIMIT } from '../../src/sim/going.js';
import { type Obstacle, obstacleDistance } from '../../src/sim/terrain.js';

export interface LineOptions {
  /** The walls, and anything else the hull's middle must keep `clear` m off. */
  walls: readonly Obstacle[];
  clear: number;
  /** Any more ground the line may not cross (the mud, say). */
  banned?: (x: number, z: number) => boolean;
  /** How many shakes, and the seed for them. */
  tries: number;
  seed?: number;
}

const GRID = 8;
const normal: [number, number] = [0, 0];

/** The time along a line (x, z points) from its start at full speed, counted from where it first passes x `from` to where it last passes x `to`, s. */
export function lineTime(xs: readonly number[], zs: readonly number[], from: number, to: number): number {
  const n = xs.length;
  const v = new Array<number>(n).fill(MAX_SPEED);
  const ds = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    const b = Math.hypot(xs[i + 1] - xs[i], zs[i + 1] - zs[i]);
    const c = Math.hypot(xs[i + 1] - xs[i - 1], zs[i + 1] - zs[i - 1]);
    const cross = Math.abs((xs[i] - xs[i - 1]) * (zs[i + 1] - zs[i - 1]) - (zs[i] - zs[i - 1]) * (xs[i + 1] - xs[i - 1]));
    // The circle through three points: its radius sets how fast the tank may turn there.
    const radius = cross < 1e-9 ? Infinity : (a * b * c) / (2 * cross);
    v[i] = Math.min(MAX_SPEED, Math.sqrt(THROW_LIMIT * radius));
  }
  for (let i = 1; i < n; i++) ds[i] = Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * MAX_ACCEL * ds[i]));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * MAX_ACCEL * ds[i + 1]));
  let first = 0;
  while (first < n - 1 && xs[first] < from) first++;
  let last = n - 1;
  while (last > first && xs[last] > to) last--;
  let t = 0;
  for (let i = first + 1; i <= last; i++) t += (2 * ds[i]) / (v[i] + v[i - 1]);
  return t;
}

/** Shakes the line (`start`, its two ends held) towards the quickest clear line between x `from` and `to`, and returns that line's time, s. */
export function fastestLine(start: readonly { x: number; z: number }[], from: number, to: number, o: LineOptions): { time: number; xs: number[]; zs: number[] } {
  const grid = new Map<string, Obstacle[]>();
  const key = (gx: number, gz: number) => `${gx},${gz}`;
  for (const w of o.walls) {
    for (let gx = Math.floor((w.x - w.r - o.clear) / GRID); gx <= Math.floor((w.x + w.r + o.clear) / GRID); gx++) {
      for (let gz = Math.floor((w.z - w.r - o.clear) / GRID); gz <= Math.floor((w.z + w.r + o.clear) / GRID); gz++) {
        const list = grid.get(key(gx, gz)) ?? [];
        list.push(w);
        grid.set(key(gx, gz), list);
      }
    }
  }
  const free = (x: number, z: number): boolean => {
    if (o.banned?.(x, z)) return false;
    for (const w of grid.get(key(Math.floor(x / GRID), Math.floor(z / GRID))) ?? []) if (obstacleDistance(w, x, z, normal) < o.clear) return false;
    return true;
  };
  const clearBetween = (ax: number, az: number, bx: number, bz: number): boolean => {
    for (let k = 0; k <= 4; k++) if (!free(ax + ((bx - ax) * k) / 4, az + ((bz - az) * k) / 4)) return false;
    return true;
  };
  const xs = start.map((p) => p.x);
  const zs = start.map((p) => p.z);
  const n = xs.length;
  for (let i = 1; i < n; i++) if (!clearBetween(xs[i - 1], zs[i - 1], xs[i], zs[i])) throw new Error(`the starting line is not clear at (${xs[i].toFixed(1)}, ${zs[i].toFixed(1)})`);
  let seed = o.seed ?? 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let best = lineTime(xs, zs, from, to);
  const oldX: number[] = [];
  const oldZ: number[] = [];
  for (let t = 0; t < o.tries; t++) {
    // A bump of up to 3 m, shrinking to 6 cm, spread over a few points either side.
    const size = 3 * Math.pow(0.02, t / o.tries);
    const at = 1 + Math.floor(random() * (n - 2));
    const spread = 1 + Math.floor(random() * 6);
    const dx = (random() - 0.5) * 2 * size;
    const dz = (random() - 0.5) * 2 * size;
    const lo = Math.max(1, at - spread);
    const hi = Math.min(n - 2, at + spread);
    for (let j = lo; j <= hi; j++) {
      oldX[j - lo] = xs[j];
      oldZ[j - lo] = zs[j];
      const f = Math.cos((((j - at) / (spread + 1)) * Math.PI) / 2);
      xs[j] += dx * f;
      zs[j] += dz * f;
    }
    let ok = true;
    for (let j = lo - 1; j <= hi && ok; j++) ok = clearBetween(xs[j], zs[j], xs[j + 1], zs[j + 1]);
    const time = ok ? lineTime(xs, zs, from, to) : Infinity;
    if (time < best) best = time;
    else {
      for (let j = lo; j <= hi; j++) {
        xs[j] = oldX[j - lo];
        zs[j] = oldZ[j - lo];
      }
    }
  }
  return { time: best, xs, zs };
}
