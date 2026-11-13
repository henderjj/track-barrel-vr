/**
 * The ground the test range stands on (F1.4 and F1.7, docs/range.md): a
 * rolling height field with a flat start field and flat corridors for the
 * two roads, and the obstacles standing on it, shared by the drawn model
 * (src/scene-assets/terrain.scene-asset.ts), the drive simulation
 * (src/sim/tank-drive.ts) and the tests. Engine-free and deterministic, so
 * every page and both realms build the same ground.
 *
 * What stands on it — the roads, the targets, the markers and the fog —
 * is in src/sim/range.ts.
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
 * clear run to drive on; the range's road is laid up its middle and its
 * targets stand on it (src/sim/range.ts).
 */
export const LANE_HALF = 17;
const LANE_BLEND = 28;
/**
 * The same, across the start (z ≡ 0 each tile): the corridor the range's
 * second road is laid in, so a crew can drive across the range as well as
 * up it. m.
 */
export const CROSS_HALF = 17;
const CROSS_BLEND = 28;

/**
 * The biathlon course's ground (F5.3a, docs/biathlon-course.md): a flat
 * field east of the range holding the course's loop, its infield where the
 * firing lines' boards stand, and the penalty loop, so the boxes and the
 * boards stand level and no crest hides a board from its firing box. A
 * rectangle (tile-local, m) flat inside, rolling fully `blend` m outside.
 * src/sim/course.ts lays the course inside it; obstacles keep off it.
 */
export const COURSE_FIELD = { west: 45, east: 370, north: -295, south: -95, blend: 25 } as const;

/** How far (x, z) is outside the course's field, m (0 inside). */
export function outsideCourseField(x: number, z: number): number {
  const f = COURSE_FIELD;
  const midX = (f.west + f.east) / 2;
  const midZ = (f.north + f.south) / 2;
  const dx = Math.max(0, Math.abs(wrapTile(x - midX)) - (f.east - f.west) / 2);
  const dz = Math.max(0, Math.abs(wrapTile(z - midZ)) - (f.south - f.north) / 2);
  return Math.hypot(dx, dz);
}

/**
 * The biathlon's firing lanes (docs/biathlon-race.md, "Judging the
 * range"): from each firing box on the course's east side (x, z) south,
 * behind the tank as it stands in the box, out over the open ground south
 * of the course, line 1's swung `swing` rad east of due south and line 2's
 * as far west so the two fan apart, `length` m long (to short of the tile's
 * edge and the enemy tank route beyond it). The ground along each is flat
 * to `half` m either side of its line, rolling fully `blend` m further
 * out, and no obstacle stands within LANE_CLEAR of its line, so no crest or
 * wall hides a board from its box at any range a race picks
 * (src/sim/course.ts).
 */
export const FIRING_LANES: readonly { x: number; z: number; swing: number; length: number; half: number; blend: number }[] = [
  { x: 320, z: -152, swing: (5 * Math.PI) / 180, length: 580, half: 16, blend: 45 },
  { x: 320, z: -170, swing: (-5 * Math.PI) / 180, length: 580, half: 16, blend: 45 },
];

/** Lane `l`'s direction from its box, (x, z): south, swung east by `swing`. */
export function laneDirection(l: { swing: number }, out: [number, number]): [number, number] {
  out[0] = Math.sin(l.swing);
  out[1] = Math.cos(l.swing);
  return out;
}

const laneDir: [number, number] = [0, 0];

/** How far (x, z) is outside the nearest firing lane's flat strip, m (0 inside). */
export function outsideFiringLanes(x: number, z: number): number {
  return Math.max(0, firingLaneOffset(x, z) - FIRING_LANES[0].half);
}

/** How far (x, z) is from the nearest firing lane's middle line (between its box and its far end), m. */
export function firingLaneOffset(x: number, z: number): number {
  let best = Infinity;
  for (const l of FIRING_LANES) {
    const [fx, fz] = laneDirection(l, laneDir);
    // From the box, taking the copy nearest the lane's middle (a lane is longer than half a tile).
    const half = l.length / 2;
    const dx = wrapTile(x - l.x - fx * half) + fx * half;
    const dz = wrapTile(z - l.z - fz * half) + fz * half;
    const along = Math.min(l.length, Math.max(0, dx * fx + dz * fz));
    const off = Math.hypot(dx - fx * along, dz - fz * along);
    best = Math.min(best, off);
  }
  return best;
}

const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** How much of the waves show at (x, z): 0 on the start field and in the roads' corridors, 1 out in the rolling ground. */
export function roughness(x: number, z: number): number {
  const wx = wrapTile(x);
  const wz = wrapTile(z);
  const field = smooth((Math.hypot(wx, wz) - FLAT_RADIUS) / FLAT_BLEND);
  const lane = smooth((Math.abs(wx) - LANE_HALF) / LANE_BLEND);
  const cross = smooth((Math.abs(wz) - CROSS_HALF) / CROSS_BLEND);
  const course = smooth(outsideCourseField(x, z) / COURSE_FIELD.blend);
  const lanes = smooth(outsideFiringLanes(x, z) / FIRING_LANES[0].blend);
  return field * lane * cross * course * lanes;
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
  return h * roughness(x, z) + courseRelief(x, z);
}

/**
 * The biathlon course's own ground (the driving challenge, F5.3d,
 * docs/biathlon-driving.md), shaped into the flat field at the height
 * field's corners, so the drawn ground and the drive share it exactly:
 *
 * - HILL: a ridge across the course's north side, `height` m at x =
 *   `crest`, falling to nothing `half` m either side (a raised cosine, so
 *   its middle third is steepest, about 12°: too steep for 3rd gear), full
 *   height for z within `full` of `z` and gone `fade` m further out.
 * - DITCH: a dry ditch across the west side that the treadway bridge spans
 *   (src/sim/course.ts), `depth` m deep at z, its banks `half` m wide, full
 *   depth for x within `from`..`to` and gone `fade` m beyond.
 * - STREAM: the ford's stream across the south side, `depth` m deep at x,
 *   the same way round, its water at WATER_Y (src/sim/course.ts).
 *
 * Every number is a multiple of CELL where the ground folds, so the folds
 * lie on the grid's lines and the course's ribbons can follow them.
 */
export const HILL = { crest: 144, half: 48, height: 7, z: -280, full: 8, fade: 16 } as const;
export const DITCH = { z: -192, half: 16, depth: 2.5, from: 32, to: 112, fade: 16 } as const;
export const STREAM = { x: 272, half: 16, depth: 0.9, from: -144, to: -80, fade: 16 } as const;

/** 1 within [from, to], falling straight to 0 `fade` beyond each end. */
function plateau(v: number, from: number, to: number, fade: number): number {
  const out = v < from ? from - v : v > to ? v - to : 0;
  return Math.max(0, 1 - out / fade);
}

/** The course's hill, ditch and stream at (x, z) (any copy), m: added to the ground's height at its corners. */
export function courseRelief(x: number, z: number): number {
  const wx = wrapTile(x);
  const wz = wrapTile(z);
  let h = 0;
  const hd = Math.abs(wx - HILL.crest);
  if (hd < HILL.half) {
    h += HILL.height * 0.5 * (1 + Math.cos((Math.PI * hd) / HILL.half)) * plateau(wz, HILL.z - HILL.full, HILL.z + HILL.full, HILL.fade);
  }
  const dd = Math.abs(wz - DITCH.z);
  if (dd < DITCH.half) h -= DITCH.depth * (1 - dd / DITCH.half) * plateau(wx, DITCH.from, DITCH.to, DITCH.fade);
  const sd = Math.abs(wx - STREAM.x);
  if (sd < STREAM.half) h -= STREAM.depth * (1 - sd / STREAM.half) * plateau(wz, STREAM.from, STREAM.to, STREAM.fade);
  return h;
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

/** Obstacles keep this far clear of the course's field, m, beyond their own size. */
const COURSE_CLEAR = 4;
/** Nothing stands within this of a firing lane's middle line, m: the outer boards stand 6 m off it, so 8 m clear of them. */
const LANE_CLEAR = 14;

/**
 * Cover along the lane (F3.10, docs/combat-scenario.md): stretches of dry
 * stone wall just off the lane's flat strip, 30 m long and 1.5 m high, so a
 * tank halted behind one shows the enemy only its turret (hull down). Five
 * on the left, facing the guns, and two on the right, facing tank A's
 * route, with gaps where each Meet parks the tank (an enemy's line to it
 * crosses the walls' line there), so a Meet still shows the whole tank.
 * Added after the random obstacles, so those stay where they stood.
 */
export const LANE_WALLS: readonly Obstacle[] = [
  ...[-135, -190, -275, -350, -425].map((z) => block('wall', -21, z, 15, 0.35, Math.PI / 2, 1.5)),
  ...[-300, -420].map((z) => block('wall', 21, z, 15, 0.35, Math.PI / 2, 1.5)),
];

/**
 * The obstacles in one tile, tile-local, the same on every page and in
 * every realm. Random ones keep off the start field and both roads'
 * corridors. Those that would stand on the biathlon course's field (F5.3a)
 * are taken out afterwards, rather than kept out while placing, so every
 * other obstacle stays exactly where it stood before the course.
 */
export const OBSTACLES: readonly Obstacle[] = (() => {
  const random = rng(OBSTACLE_SEED);
  const list: Obstacle[] = [...NEAR_START];
  const clear = (o: Obstacle) =>
    Math.hypot(o.x, o.z) > FLAT_RADIUS + FLAT_BLEND + o.r &&
    Math.abs(o.x) > LANE_HALF + 4 + o.r &&
    Math.abs(o.z) > CROSS_HALF + 4 + o.r &&
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
  return [...list.filter((o) => outsideCourseField(o.x, o.z) > o.r + COURSE_CLEAR && firingLaneOffset(o.x, o.z) > o.r + LANE_CLEAR), ...LANE_WALLS];
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
