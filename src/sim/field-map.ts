/**
 * The commander's field map (F2.10, docs/map-case.md): a 1944-style map of
 * the training area, drawn from the simulation's own numbers so it always
 * matches the ground. Contours from the ground's heights, the roads, the
 * biathlon course's track, the ford, the bridge, the mud, houses and walls,
 * the range's markers and targets, a 100 m grid with its numbers in the
 * margin, and the objectives pencilled in red. Never the enemy (F2.11
 * pencils in what the crew has seen) and never our own tank: the crew works
 * out where it is (John, 2026-11-21).
 *
 * This module only says what is where, in world metres; MapCaseSystem
 * paints it. Engine-free, unit-tested.
 *
 * World space as src/sim/terrain.ts: +X east, −Z north. The map is north up:
 * its u runs west to east, v north to south.
 */

import { AMBUSH } from './ambush.js';
import { BOX_Z, BRIDGE, COURSE, COURSE_PATH, FIRING_BOX, MUD, PENALTY_PATH, samplePath, waterDepth } from './course.js';
import { COLUMN_ROUTE } from './column.js';
import { SCENARIO } from './combat.js';
import { ESCORT } from './escort.js';
import { MARKER_RANGES, markerFoot, RANGE_TARGETS, ROAD, targetFoot } from './range.js';
import { groundHeight, HILL, HOLD_HILL, OBSTACLES, TILE } from './terrain.js';

/** The ground the map shows, world m: the range, the course, the hill, the ambush wall and the column's road. */
export const FIELD_MAP = { west: -360, east: 660, north: -860, south: 100 } as const;
export const MAP_WIDTH = FIELD_MAP.east - FIELD_MAP.west;
export const MAP_HEIGHT = FIELD_MAP.south - FIELD_MAP.north;

/** The grid's squares, m, and its false origin: the world point whose easting and northing are 0 (south-west of the map). */
export const GRID = 100;
export const GRID_ORIGIN = { x: -400, z: 200 } as const;

/** The contours' interval, m, and every this many a thicker index contour, labelled. */
export const CONTOUR = 1;
export const INDEX_EVERY = 5;
/** The ground is sampled this far apart for the contours and the water, m. */
export const SAMPLE = 5;

/** A world point's place on the map, 0 to 1 each way (u east, v south). */
export function mapUV(x: number, z: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = (x - FIELD_MAP.west) / MAP_WIDTH;
  out[1] = (z - FIELD_MAP.north) / MAP_HEIGHT;
  return out;
}

/** The world point at a place on the map. */
export function mapToWorld(u: number, v: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = FIELD_MAP.west + u * MAP_WIDTH;
  out[1] = FIELD_MAP.north + v * MAP_HEIGHT;
  return out;
}

/** Metres east of the grid's false origin. */
export function eastingOf(x: number): number {
  return x - GRID_ORIGIN.x;
}

/** Metres north of the grid's false origin. */
export function northingOf(z: number): number {
  return GRID_ORIGIN.z - z;
}

/** A grid line's number as printed in the margin: its hundreds of metres, two figures ("07"). */
export function gridLabel(metres: number): string {
  return String(Math.round(metres / GRID) % 100).padStart(2, '0');
}

/**
 * A map reference, as the crew would read it off the map: four figures
 * for the 100 m square ("0705": easting line 07, northing line 05, the
 * square's south-west corner), six for a 10 m spot in it ("073058").
 */
export function gridRef(x: number, z: number, figures: 4 | 6 = 4): string {
  const e = eastingOf(x);
  const n = northingOf(z);
  if (figures === 4) return gridLabel(Math.floor(e / GRID) * GRID) + gridLabel(Math.floor(n / GRID) * GRID);
  const three = (m: number) => String(Math.floor(m / 10) % 1000).padStart(3, '0');
  return three(e) + three(n);
}

/** The grid lines across the map: their world x (eastings) and z (northings), with their margin labels. */
export function gridLines(): { eastings: { x: number; label: string }[]; northings: { z: number; label: string }[] } {
  const eastings: { x: number; label: string }[] = [];
  for (let e = Math.ceil(eastingOf(FIELD_MAP.west) / GRID) * GRID; e <= eastingOf(FIELD_MAP.east); e += GRID) {
    eastings.push({ x: e + GRID_ORIGIN.x, label: gridLabel(e) });
  }
  const northings: { z: number; label: string }[] = [];
  for (let n = Math.ceil(northingOf(FIELD_MAP.south) / GRID) * GRID; n <= northingOf(FIELD_MAP.north); n += GRID) {
    northings.push({ z: GRID_ORIGIN.z - n, label: gridLabel(n) });
  }
  return { eastings, northings };
}

/** A sampled field of the ground over the map: heights and whether there is water, `cols` × `rows`, row 0 the north edge. */
export interface GroundField {
  cols: number;
  rows: number;
  step: number;
  heights: Float32Array;
  water: Uint8Array;
}

export function sampleGround(step = SAMPLE): GroundField {
  const cols = Math.floor(MAP_WIDTH / step) + 1;
  const rows = Math.floor(MAP_HEIGHT / step) + 1;
  const heights = new Float32Array(cols * rows);
  const water = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = FIELD_MAP.west + c * step;
      const z = FIELD_MAP.north + r * step;
      heights[r * cols + c] = groundHeight(x, z);
      water[r * cols + c] = waterDepth(x, z) > 0.05 ? 1 : 0;
    }
  }
  return { cols, rows, step, heights, water };
}

/**
 * The contours: line segments (world x, z pairs) at every CONTOUR metres,
 * by marching squares over the sampled ground. Each segment carries its
 * height; `index` says whether it is an index contour.
 */
export interface ContourSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  level: number;
  index: boolean;
}

export function contours(field: GroundField, interval = CONTOUR): ContourSegment[] {
  const { cols, rows, step, heights } = field;
  const out: ContourSegment[] = [];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const h of heights) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const at = (c: number, r: number) => heights[r * cols + c];
  // Where along an edge from height a to b the level crosses, 0 to 1.
  const cross = (a: number, b: number, level: number) => (level - a) / (b - a);
  const points: [number, number][] = [];
  for (let level = Math.ceil(lo / interval) * interval; level <= hi; level += interval) {
    // Levels nudged off exact sample heights so no corner lies on the line.
    const l = level + 1e-4;
    const index = Math.round(level / interval) % INDEX_EVERY === 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = at(c, r);
        const b = at(c + 1, r);
        const d = at(c, r + 1);
        const e = at(c + 1, r + 1);
        points.length = 0;
        const x = FIELD_MAP.west + c * step;
        const z = FIELD_MAP.north + r * step;
        // The four edges: top (a→b), right (b→e), bottom (d→e), left (a→d).
        if ((a < l) !== (b < l)) points.push([x + cross(a, b, l) * step, z]);
        if ((b < l) !== (e < l)) points.push([x + step, z + cross(b, e, l) * step]);
        if ((d < l) !== (e < l)) points.push([x + cross(d, e, l) * step, z + step]);
        if ((a < l) !== (d < l)) points.push([x, z + cross(a, d, l) * step]);
        if (points.length === 2) {
          out.push({ x0: points[0][0], z0: points[0][1], x1: points[1][0], z1: points[1][1], level, index });
        } else if (points.length === 4) {
          // A saddle: pair the crossings by the cell's middle.
          const mid = (a + b + d + e) / 4;
          const [p0, p1, p2, p3] = points;
          const pairs: [number, number][][] = mid < l === a < l ? [[p0, p3], [p1, p2]] : [[p0, p1], [p2, p3]];
          for (const [p, q] of pairs) out.push({ x0: p[0], z0: p[1], x1: q[0], z1: q[1], level, index });
        }
      }
    }
  }
  return out;
}

/** What the map shows, each in world metres. */
export type MapFeature =
  | { kind: 'road'; from: [number, number]; to: [number, number]; width: number }
  | { kind: 'track'; points: [number, number][]; width: number }
  | { kind: 'building'; x: number; z: number; hx: number; hz: number; yaw: number }
  | { kind: 'wall'; x: number; z: number; hx: number; hz: number; yaw: number }
  | { kind: 'mud'; west: number; east: number; north: number; south: number }
  | { kind: 'bridge'; x: number; z: number; length: number }
  | { kind: 'marker'; x: number; z: number; text: string }
  | { kind: 'target'; x: number; z: number; text: string }
  | { kind: 'box'; x: number; z: number; width: number; length: number }
  | { kind: 'spot'; x: number; z: number; height: number }
  | { kind: 'name'; x: number; z: number; text: string; size: 'small' | 'large' }
  /** Pencilled in red: objectives and the briefed lines. */
  | { kind: 'objective-line'; points: [number, number][]; text: string; arrow: boolean; dashed: boolean }
  | { kind: 'objective-point'; x: number; z: number; text: string };

/** Each copy of a tile-local point that falls on the map (the ground repeats every TILE), with a margin, m. */
export function copiesOnMap(x: number, z: number, margin = 30): [number, number][] {
  const out: [number, number][] = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const cx = x + i * TILE;
      const cz = z + j * TILE;
      if (cx >= FIELD_MAP.west - margin && cx <= FIELD_MAP.east + margin && cz >= FIELD_MAP.north - margin && cz <= FIELD_MAP.south + margin) out.push([cx, cz]);
    }
  }
  return out;
}

/** Everything drawn on the map but the contours, water and grid, in painting order. */
export function mapFeatures(): MapFeature[] {
  const out: MapFeature[] = [];
  const { west, east, north, south } = FIELD_MAP;

  // The roads: the range road up the middle (x ≡ 0 every tile) and the cross road (z ≡ 0).
  for (let i = -2; i <= 2; i++) {
    const x = i * TILE;
    if (x >= west && x <= east) out.push({ kind: 'road', from: [x, south], to: [x, north], width: 2 * ROAD.halfWidth });
    const z = i * TILE;
    if (z >= north && z <= south) out.push({ kind: 'road', from: [west, z], to: [east, z], width: 2 * ROAD.crossHalfWidth });
  }

  // The biathlon course's track and its penalty loop, the mud and the bridge.
  const track = (path: typeof COURSE_PATH, step: number) => samplePath(path, 0, path.length, step).map((p) => [p.x, p.z] as [number, number]);
  out.push({ kind: 'track', points: track(COURSE_PATH, 4), width: 2 * COURSE.halfWidth });
  out.push({ kind: 'track', points: track(PENALTY_PATH, 3), width: 6 });
  out.push({ kind: 'mud', west: MUD.from, east: MUD.to, north: COURSE.south - MUD.half, south: COURSE.south + MUD.half });
  out.push({ kind: 'bridge', x: BRIDGE.x, z: BRIDGE.z, length: BRIDGE.length });
  for (const bz of BOX_Z) out.push({ kind: 'box', x: COURSE.east, z: bz, width: FIRING_BOX.width, length: FIRING_BOX.length });

  // Houses and walls, every copy on the map; rocks are left off, as a field map leaves boulders.
  for (const o of OBSTACLES) {
    if (o.kind === 'rock') continue;
    for (const [x, z] of copiesOnMap(o.x, o.z)) {
      out.push({ kind: o.kind === 'house' ? 'building' : 'wall', x, z, hx: o.hx, hz: Math.max(o.hz, 0.8), yaw: o.yaw });
    }
  }

  // The range: its markers beside the road and its targets.
  for (const r of MARKER_RANGES) {
    const [x, z] = markerFoot(r);
    out.push({ kind: 'marker', x, z, text: `${r}` });
  }
  RANGE_TARGETS.forEach((t, i) => {
    const [x, z] = targetFoot(i);
    out.push({ kind: 'target', x, z, text: `${t.range}` });
  });

  // Spot heights: the hill by the course and the hold hill's crest.
  out.push({ kind: 'spot', x: HILL.crest, z: HILL.z, height: Math.round(groundHeight(HILL.crest, HILL.z)) });
  const hx = (HOLD_HILL.west + HOLD_HILL.east) / 2;
  out.push({ kind: 'spot', x: hx, z: HOLD_HILL.crest, height: Math.round(groundHeight(hx, HOLD_HILL.crest)) });

  // Names.
  out.push({ kind: 'name', x: (COURSE.west + COURSE.east) / 2, z: (COURSE.north + COURSE.south) / 2, text: 'Biathlon course', size: 'large' });
  out.push({ kind: 'name', x: 14, z: -330, text: 'Range road', size: 'small' });
  out.push({ kind: 'name', x: -300, z: -10, text: 'Cross road', size: 'small' });
  out.push({ kind: 'name', x: -300, z: -782, text: 'Cross road', size: 'small' });
  out.push({ kind: 'name', x: BRIDGE.x + 10, z: BRIDGE.z + 16, text: 'Bridge', size: 'small' });
  out.push({ kind: 'name', x: (MUD.from + MUD.to) / 2, z: COURSE.south + 22, text: 'Mud', size: 'small' });
  out.push({ kind: 'name', x: 290, z: -60, text: 'Ford', size: 'small' });
  out.push({ kind: 'name', x: 30, z: -560, text: 'Range', size: 'large' });

  // The objectives, in red pencil.
  out.push({ kind: 'objective-point', x: 0, z: 0, text: 'SP' });
  out.push({ kind: 'objective-line', points: [[-64, SCENARIO.objectiveZ], [24, SCENARIO.objectiveZ]], text: 'OBJ', arrow: false, dashed: false });
  out.push({ kind: 'objective-line', points: [[HOLD_HILL.west, HOLD_HILL.crest], [HOLD_HILL.east, HOLD_HILL.crest]], text: 'HOLD', arrow: false, dashed: false });
  const [rx, rz] = markerFoot(ESCORT.end);
  out.push({ kind: 'objective-point', x: rx, z: rz, text: 'Convoy RP' });
  out.push({ kind: 'objective-point', x: AMBUSH.x, z: AMBUSH.z, text: 'Ambush' });
  const [a, b] = COLUMN_ROUTE.points;
  out.push({ kind: 'objective-line', points: [[Math.min(a[0], east), a[1]], [Math.max(b[0], west + 40), b[1]]], text: 'Enemy column expected', arrow: true, dashed: true });
  return out;
}
