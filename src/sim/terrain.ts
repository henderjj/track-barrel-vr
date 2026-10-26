/**
 * The ground the tank drives on (F1.4, docs/tank-drive.md): a rolling
 * height field with a flat start field and a flat lane, and the obstacles
 * standing on it, shared by the drawn model
 * (src/scene-assets/terrain.scene-asset.ts), the drive simulation
 * (src/sim/tank-drive.ts) and the tests. Engine-free and deterministic, so
 * every page and both realms build the same ground. A blockout: the test
 * range (F1.7) replaces the content, not the approach.
 *
 * World space: metres, +X east, -Z the tank's starting heading, y up. The
 * ground repeats every TILE metres in x and z, so a drive of any length
 * stays on it: the model is drawn three tiles across and moved by the
 * tank's position less whole tiles (wrapTile), as in spike S2. A tile is
 * wide enough that the drawn ground's edge is always at least TILE away,
 * almost on the horizon, and the S1 sight's 500 m target stands on it.
 *
 * Heights are relative to the ground at the start, which is GROUND_Y
 * below the hull floor (src/sim/cabin.ts).
 */

import { rng } from './random.js';

/** The ground repeats every TILE metres in x and z. */
export const TILE = 800;
/** Spacing of the height field's samples, m. The drawn ground and groundHeight share it, so the tracks sit on what is drawn. */
export const CELL = 16;

/** A world coordinate less whole tiles, in [-TILE/2, TILE/2]. */
export function wrapTile(v: number): number {
  return v - TILE * Math.round(v / TILE);
}

/** Ground waves: amplitude (m) and how many waves fit across a tile in x and z. Wavelengths of 100 m and more, six cells or more each. */
const WAVES: readonly (readonly [amplitude: number, kx: number, kz: number])[] = [
  [1.1, 3, 2],
  [0.6, 2, -5],
  [0.35, -6, 4],
];

/** The start field: flat within this radius of the start, rolling fully this much further out, m. */
export const FLAT_RADIUS = 40;
const FLAT_BLEND = 35;
/**
 * The lane: a flat strip along z through the start (x ≡ 0 each tile), this
 * half-width, rolling fully this much further out, m. Only cells with every
 * corner flat are flat, so the start field is flat out to about 18 m and
 * the lane 16 m either side of its middle. It gives a straight,
 * clear run to drive on, and the S1 sight's targets stand on it.
 */
export const LANE_HALF = 17;
const LANE_BLEND = 28;

const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** How much of the waves show at (x, z): 0 on the start field and the lane, 1 out in the rolling ground. */
export function roughness(x: number, z: number): number {
  const wx = wrapTile(x);
  const wz = wrapTile(z);
  const field = smooth((Math.hypot(wx, wz) - FLAT_RADIUS) / FLAT_BLEND);
  const lane = smooth((Math.abs(wx) - LANE_HALF) / LANE_BLEND);
  return field * lane;
}

/** The height field's sample at grid corner (ix, iz), m. Periodic over TILE. */
export function cornerHeight(ix: number, iz: number): number {
  const x = ix * CELL;
  const z = iz * CELL;
  const w = (2 * Math.PI) / TILE;
  let h = 0;
  for (const [a, kx, kz] of WAVES) {
    h += a * Math.sin(w * (kx * x + kz * z));
  }
  return h * roughness(x, z);
}

/**
 * Ground height at (x, z), m: the height field's samples joined into
 * triangles, each cell split along the diagonal from its (-x, -z) corner to
 * its (+x, +z) corner, exactly as the drawn ground is.
 */
export function groundHeight(x: number, z: number): number {
  const gx = x / CELL;
  const gz = z / CELL;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const u = gx - ix;
  const v = gz - iz;
  const h00 = cornerHeight(ix, iz);
  const h11 = cornerHeight(ix + 1, iz + 1);
  if (u >= v) {
    const h10 = cornerHeight(ix + 1, iz);
    return h00 + u * (h10 - h00) + v * (h11 - h10);
  }
  const h01 = cornerHeight(ix, iz + 1);
  return h00 + v * (h01 - h00) + u * (h11 - h01);
}

export type ObstacleKind = 'rock' | 'wall' | 'house';

/**
 * Something the tank can't drive through, tile-local. A rock collides as a
 * circle of radius `r`; a wall or house as a box of half sizes `hx`, `hz`
 * turned by `yaw` (rad, positive turns left as Three.js turns about +Y).
 * `height` is how tall it is drawn, m.
 */
export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  r: number;
  hx: number;
  hz: number;
  yaw: number;
  height: number;
}

function rock(x: number, z: number, r: number): Obstacle {
  return { kind: 'rock', x, z, r, hx: r, hz: r, yaw: 0, height: r * 1.3 };
}

function block(kind: 'wall' | 'house', x: number, z: number, hx: number, hz: number, yaw: number, height: number): Obstacle {
  return { kind, x, z, r: Math.hypot(hx, hz), hx, hz, yaw, height };
}

/**
 * Obstacles near the start, placed so a headset check reaches each in a
 * minute: a boulder left of the lane, a wall to its right and a house
 * further on. The lane itself stays clear.
 */
const NEAR_START: readonly Obstacle[] = [
  rock(-10, -45, 1.5),
  block('wall', 17, -70, 6, 0.35, 0.3, 1.2),
  block('house', -26, -110, 3, 4, -0.2, 3),
];

const OBSTACLE_SEED = 4417;
const ROCKS_PER_TILE = 40;
const WALLS_PER_TILE = 10;
const HOUSES_PER_TILE = 8;

/** The obstacles in one tile, tile-local, the same on every page and in every realm. Random ones keep off the start field and the lane. */
export const OBSTACLES: readonly Obstacle[] = (() => {
  const random = rng(OBSTACLE_SEED);
  const list: Obstacle[] = [...NEAR_START];
  const clear = (o: Obstacle) =>
    Math.hypot(o.x, o.z) > FLAT_RADIUS + FLAT_BLEND + o.r &&
    Math.abs(o.x) > LANE_HALF + 4 + o.r &&
    list.every((p) => Math.hypot(wrapTile(p.x - o.x), wrapTile(p.z - o.z)) > p.r + o.r + 8);
  const place = (count: number, make: () => Obstacle) => {
    for (let placed = 0, tries = 0; placed < count && tries < count * 50; tries++) {
      const o = make();
      if (clear(o)) {
        list.push(o);
        placed++;
      }
    }
  };
  const spot = () => (random() - 0.5) * TILE;
  place(ROCKS_PER_TILE, () => rock(spot(), spot(), 0.8 + random() * 1.4));
  place(WALLS_PER_TILE, () => block('wall', spot(), spot(), 4 + random() * 8, 0.35, random() * Math.PI, 1.0 + random() * 0.6));
  place(HOUSES_PER_TILE, () => block('house', spot(), spot(), 2.5 + random() * 2, 3 + random() * 2.5, random() * Math.PI, 2.6 + random() * 1));
  return list;
})();

/**
 * Signed distance from (px, pz) to obstacle `o`'s nearest copy, m (negative
 * inside), and the outward direction there, written to `normal` [x, z].
 * (px, pz) is world space; the copy nearest it is used.
 */
export function obstacleDistance(o: Obstacle, px: number, pz: number, normal: [number, number]): number {
  // The point relative to the obstacle's nearest copy.
  const dx = wrapTile(px - o.x);
  const dz = wrapTile(pz - o.z);
  if (o.kind === 'rock') {
    const d = Math.hypot(dx, dz);
    if (d < 1e-9) {
      normal[0] = 0;
      normal[1] = 1;
    } else {
      normal[0] = dx / d;
      normal[1] = dz / d;
    }
    return d - o.r;
  }
  // Into the box's own axes (the inverse of its turn about +Y).
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.abs(lx) - o.hx;
  const qz = Math.abs(lz) - o.hz;
  let nx: number;
  let nz: number;
  let d: number;
  if (qx > 0 || qz > 0) {
    // Outside: towards the nearest point on the box.
    const ox = Math.max(qx, 0);
    const oz = Math.max(qz, 0);
    d = Math.hypot(ox, oz);
    nx = (ox / d) * Math.sign(lx);
    nz = (oz / d) * Math.sign(lz);
  } else if (qx > qz) {
    // Inside, nearest the x faces.
    d = qx;
    nx = Math.sign(lx) || 1;
    nz = 0;
  } else {
    d = qz;
    nx = 0;
    nz = Math.sign(lz) || 1;
  }
  // Back into world axes.
  normal[0] = nx * c + nz * s;
  normal[1] = -nx * s + nz * c;
  return d;
}
