/**
 * The mud on the biathlon course's south side and the walled bypass round
 * it (F5.3d, docs/biathlon-driving.md). John's notes: the mud should be the
 * quicker way when it is driven well (2026-11-14), and the bypass's
 * S-bends could be straight-lined, so they didn't slow the tank
 * (2026-11-17).
 *
 * So the bypass is a walled lane: it leaves the course, turns hard left
 * into the infield, runs DEPTH m out, turns right twice along and back, and
 * turns left onto the course again. Each turn is a right angle between dry
 * stone walls 1.5 m high, so its line can't be cut and its corners hold the
 * tank to about 20 km/h. Two long walls across the field at the mud's
 * middle, one each side of the course, close the grass round the mud: a
 * tank goes through the mud, round the walled lane, or a long way round
 * the walls' ends.
 *
 * Engine-free numbers and pure geometry, shared by src/sim/course.ts (the
 * bypass's middle line), src/sim/terrain.ts (the walls among the world's
 * obstacles) and the course model. It imports nothing at run time, so
 * either can import it.
 */

import type { Obstacle } from './terrain.js';

/** The middle line of the course's south side, z: COURSE.south in src/sim/course.ts (test/going.test.ts checks they agree). */
export const SOUTH_Z = -110;
/** The course's half width there, m: COURSE.halfWidth. */
const ROAD_HALF = 5;

/** The mud: 24 m of the south side (x), `half` m either side of the middle line. */
export const MUD = { from: 168, to: 192, half: 9 } as const;

/**
 * The bypass: it leaves the course at x `from` and joins it again at `to`,
 * `depth` m out into the infield (north) at its furthest, its four corners
 * turned at `radius` m along its middle line, `halfWidth` m of gravel each
 * side, `lift` m above the ground.
 */
export const BYPASS = { from: 130, to: 230, radius: 8, depth: 56, halfWidth: 4, lift: 0.02 } as const;

/** The bypass's middle line as moves for src/sim/course.ts's Path, driven east from (BYPASS.from, SOUTH_Z). */
export type BypassMove = { kind: 'straight'; length: number } | { kind: 'turn'; radius: number; angle: number };
const RIGHT_ANGLE = Math.PI / 2;
export const BYPASS_MOVES: readonly BypassMove[] = [
  { kind: 'turn', radius: BYPASS.radius, angle: RIGHT_ANGLE },
  { kind: 'straight', length: BYPASS.depth - 2 * BYPASS.radius },
  { kind: 'turn', radius: BYPASS.radius, angle: -RIGHT_ANGLE },
  { kind: 'straight', length: BYPASS.to - BYPASS.from - 4 * BYPASS.radius },
  { kind: 'turn', radius: BYPASS.radius, angle: -RIGHT_ANGLE },
  { kind: 'straight', length: BYPASS.depth - 2 * BYPASS.radius },
  { kind: 'turn', radius: BYPASS.radius, angle: RIGHT_ANGLE },
];

/**
 * The walls: dry stone like the range's cover walls, `half` m half thick,
 * `height` m high, their faces `clear` m off the bypass's gravel. They stop
 * `road` m from the course's middle line, clear of its gravel.
 */
export const BYPASS_WALL = { half: 0.35, height: 1.5, clear: 0.5, road: ROAD_HALF + 2.2 } as const;
/**
 * The walls across the field stand at the mud's middle (x), from its edges
 * out to these z: north well past the bypass, and south nearly to the
 * range's cross road, where a wall along the field (`fromX` to `toX`) caps
 * it, so going round the south end is a long way too.
 */
export const BARRIER = { x: (MUD.from + MUD.to) / 2, north: -230, south: -22, fromX: 100, toX: 260 } as const;

/** How long each wall piece along the bypass is, m: short enough to follow its corners. */
const PIECE = 3;
/** The walls across the field are laid in pieces up to this long, m, each standing on the ground under it. */
const LONG_PIECE = 6;
/**
 * Pieces end to end touch without overlapping (where they meet at an
 * angle, their inner corners touch). Each is a little taller or shorter
 * than the one before (HEIGHT_STEP), so their tops are never in one plane
 * where they meet: they are drawn in slightly different stone colours.
 */
const HEIGHT_STEP = 0.03;
/** The middle line is walked in steps this long, m. */
const STEP = 0.05;

/** A straight wall piece from (ax, az) to (bx, bz), the `k`th of its run (for its height). */
function wallBetween(ax: number, az: number, bx: number, bz: number, k: number): Obstacle {
  const dx = bx - ax;
  const dz = bz - az;
  const hx = Math.hypot(dx, dz) / 2;
  const hz = BYPASS_WALL.half;
  // An obstacle's turn: its own +x (its length) points along (cos yaw, -sin yaw).
  return { kind: 'wall', x: (ax + bx) / 2, z: (az + bz) / 2, r: Math.hypot(hx, hz), hx, hz, yaw: Math.atan2(-dz, dx), height: BYPASS_WALL.height + (k % 3) * HEIGHT_STEP };
}

/** A long straight wall from (ax, az) to (bx, bz) in pieces up to LONG_PIECE m, end to end. */
function longWall(ax: number, az: number, bx: number, bz: number): Obstacle[] {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / LONG_PIECE));
  const out: Obstacle[] = [];
  for (let k = 0; k < n; k++) {
    out.push(wallBetween(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, ax + ((bx - ax) * (k + 1)) / n, az + ((bz - az) * (k + 1)) / n, k));
  }
  return out;
}

/** The bypass's middle line, walked from its start: points (x, z) with the heading there (0 faces -Z, positive turns left). */
function walkBypass(): { x: number; z: number; heading: number }[] {
  const out: { x: number; z: number; heading: number }[] = [];
  let x: number = BYPASS.from;
  let z = SOUTH_Z;
  let heading = -RIGHT_ANGLE;
  out.push({ x, z, heading });
  for (const move of BYPASS_MOVES) {
    const length = move.kind === 'straight' ? move.length : move.radius * Math.abs(move.angle);
    const n = Math.max(1, Math.round(length / STEP));
    const turn = move.kind === 'turn' ? move.angle / n : 0;
    for (let i = 0; i < n; i++) {
      heading += turn / 2;
      x += (-Math.sin(heading) * length) / n;
      z += (-Math.cos(heading) * length) / n;
      heading += turn / 2;
      out.push({ x, z, heading });
    }
  }
  return out;
}

/** The walls lining one side of the bypass (`side` 1 left, -1 right), in pieces about PIECE m long. */
function sideWalls(line: readonly { x: number; z: number; heading: number }[], side: number): Obstacle[] {
  const offset = BYPASS.halfWidth + BYPASS_WALL.clear + BYPASS_WALL.half;
  const edge = line.map((p) => [p.x + side * offset * -Math.cos(p.heading), p.z + side * offset * Math.sin(p.heading)] as const);
  // Cut the edge into chords about PIECE m long.
  const ends: number[] = [0];
  while (ends[ends.length - 1] < edge.length - 1) {
    const a = ends[ends.length - 1];
    let b = a + 1;
    while (b < edge.length - 1 && Math.hypot(edge[b][0] - edge[a][0], edge[b][1] - edge[a][1]) < PIECE) b++;
    ends.push(b);
  }
  const dir = (k: number) => Math.atan2(edge[ends[k + 1]][1] - edge[ends[k]][1], edge[ends[k + 1]][0] - edge[ends[k]][0]);
  // Where two chords meet at an angle, each stops short by half its thickness times the half angle's tangent: their inner corners touch, so they don't overlap.
  const trim = (k: number, next: number) => {
    if (next < 0 || next >= ends.length - 1) return 0;
    let turn = dir(next) - dir(k);
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    return BYPASS_WALL.half * Math.tan(Math.abs(turn) / 2);
  };
  const out: Obstacle[] = [];
  for (let k = 0; k < ends.length - 1; k++) {
    const [ax, az] = edge[ends[k]];
    const [bx, bz] = edge[ends[k + 1]];
    // Clear of the course's gravel where the bypass leaves and joins it.
    if (Math.abs(az - SOUTH_Z) <= BYPASS_WALL.road || Math.abs(bz - SOUTH_Z) <= BYPASS_WALL.road) continue;
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const t0 = trim(k, k - 1);
    const t1 = trim(k, k + 1);
    out.push(wallBetween(ax + ux * t0, az + uz * t0, bx - ux * t1, bz - uz * t1, out.length));
  }
  return out;
}

/**
 * Every wall of the mud's bypass, tile-local (src/sim/terrain.ts adds them
 * to OBSTACLES): both sides of the walled lane, and the walls across the
 * field at the mud's middle, north from the mud to the lane, on north from
 * the lane, and south from the mud to the wall along the field that caps
 * it. Each wall across the field ends against the face of the one it meets.
 */
export const BYPASS_WALLS: readonly Obstacle[] = (() => {
  const line = walkBypass();
  const offset = BYPASS.halfWidth + BYPASS_WALL.clear + BYPASS_WALL.half;
  const laneZ = SOUTH_Z - BYPASS.depth;
  // A wall across the field stops 5 mm short of the one it meets: touching, never overlapping.
  const face = offset + BYPASS_WALL.half + 0.005;
  const muddy = BYPASS_WALL.half + 0.15;
  const x = BARRIER.x;
  const cap = BARRIER.south - BYPASS_WALL.half;
  return [
    ...sideWalls(line, 1),
    ...sideWalls(line, -1),
    ...longWall(x, SOUTH_Z - MUD.half - muddy, x, laneZ + face),
    ...longWall(x, laneZ - face, x, BARRIER.north),
    ...longWall(x, SOUTH_Z + MUD.half + muddy, x, BARRIER.south - 2 * BYPASS_WALL.half - 0.005),
    ...longWall(BARRIER.fromX, cap, BARRIER.toX, cap),
  ];
})();
