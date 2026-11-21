import { describe, expect, it } from 'vitest';
import {
  CONTOUR,
  contours,
  eastingOf,
  FIELD_MAP,
  GRID,
  gridLines,
  gridRef,
  type GroundField,
  INDEX_EVERY,
  MAP_HEIGHT,
  MAP_WIDTH,
  mapFeatures,
  mapToWorld,
  mapUV,
  northingOf,
  sampleGround,
} from '../src/sim/field-map.js';
import { AMBUSH } from '../src/sim/ambush.js';
import { BRIDGE } from '../src/sim/course.js';
import { HOLD_HILL, groundHeight } from '../src/sim/terrain.js';
import { SCENARIO } from '../src/sim/combat.js';

describe('field map (F2.10)', () => {
  it('puts the map north up: west edge at u 0, north edge at v 0, and back again', () => {
    expect(mapUV(FIELD_MAP.west, FIELD_MAP.north)).toEqual([0, 0]);
    expect(mapUV(FIELD_MAP.east, FIELD_MAP.south)).toEqual([1, 1]);
    for (const [x, z] of [[0, 0], [123, -456], [-300, 80]]) {
      const [u, v] = mapUV(x, z);
      const back = mapToWorld(u, v);
      expect(back[0]).toBeCloseTo(x, 9);
      expect(back[1]).toBeCloseTo(z, 9);
    }
    // Further north (−Z) is further up the map.
    expect(mapUV(0, -500)[1]).toBeLessThan(mapUV(0, 0)[1]);
    expect(MAP_WIDTH).toBeGreaterThan(0);
    expect(MAP_HEIGHT).toBeGreaterThan(0);
  });

  it('covers every place the missions send the tank', () => {
    const inside = (x: number, z: number) => x >= FIELD_MAP.west && x <= FIELD_MAP.east && z >= FIELD_MAP.north && z <= FIELD_MAP.south;
    expect(inside(0, 0)).toBe(true);
    expect(inside(0, SCENARIO.objectiveZ)).toBe(true);
    expect(inside(HOLD_HILL.west, HOLD_HILL.crest) && inside(HOLD_HILL.east, HOLD_HILL.crest)).toBe(true);
    expect(inside(AMBUSH.x, AMBUSH.z)).toBe(true);
    expect(inside(BRIDGE.x, BRIDGE.z)).toBe(true);
  });

  it('reads grid references as a crew would: eastings then northings, four figures for the square, six for 10 m', () => {
    // The start point: 400 m east and 200 m north of the false origin.
    expect(eastingOf(0)).toBe(400);
    expect(northingOf(0)).toBe(200);
    expect(gridRef(0, 0)).toBe('0402');
    expect(gridRef(0, 0, 6)).toBe('040020');
    // A square is named by its south-west corner: just inside it east and north is the same square.
    expect(gridRef(99.9, -0.1)).toBe('0402');
    expect(gridRef(100, 0)).toBe('0502');
    // North is −Z: 100 m north is the next northing.
    expect(gridRef(0, -100)).toBe('0403');
    expect(gridRef(0, 0.1)).toBe('0401');
    expect(gridRef(37, -64, 6)).toBe('043026');
  });

  it('draws grid lines every 100 m across the whole map, numbered east and north', () => {
    const { eastings, northings } = gridLines();
    expect(eastings.length).toBeGreaterThanOrEqual(Math.floor(MAP_WIDTH / GRID));
    expect(northings.length).toBeGreaterThanOrEqual(Math.floor(MAP_HEIGHT / GRID));
    for (const e of eastings) expect(e.x).toBeGreaterThanOrEqual(FIELD_MAP.west);
    for (const e of eastings) expect(e.x).toBeLessThanOrEqual(FIELD_MAP.east);
    for (const n of northings) expect(n.z).toBeGreaterThanOrEqual(FIELD_MAP.north);
    for (const n of northings) expect(n.z).toBeLessThanOrEqual(FIELD_MAP.south);
    for (let i = 1; i < eastings.length; i++) expect(eastings[i].x - eastings[i - 1].x).toBe(GRID);
    // Northings count up going north (−Z).
    for (let i = 1; i < northings.length; i++) expect(northings[i].z - northings[i - 1].z).toBe(-GRID);
    // The start point's square is bounded by lines 04 and 02.
    expect(eastings.find((e) => e.x === 0)?.label).toBe('04');
    expect(northings.find((n) => n.z === 0)?.label).toBe('02');
  });

  it('draws contours round a knoll as rings at each level, index contours every fifth', () => {
    // A 9 × 9 cone, 10 m a side, 4.5 m high in the middle.
    const cols = 9;
    const rows = 9;
    const heights = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights[r * cols + c] = Math.max(0, 4.5 - Math.hypot(c - 4, r - 4));
    const field: GroundField = { cols, rows, step: 10, heights, water: new Uint8Array(cols * rows) };
    const segs = contours(field);
    const levels = [...new Set(segs.map((s) => s.level))].sort((a, b) => a - b);
    expect(levels).toEqual([0, 1, 2, 3, 4]);
    for (const s of segs) expect(s.index).toBe(s.level % (CONTOUR * INDEX_EVERY) === 0);
    // Each ring closes: every end meets another segment's end at the same level.
    for (const level of [1, 2, 3, 4]) {
      const ring = segs.filter((s) => s.level === level);
      expect(ring.length).toBeGreaterThanOrEqual(4);
      const ends = ring.flatMap((s) => [[s.x0, s.z0], [s.x1, s.z1]]);
      for (const [x, z] of ends) {
        const meets = ends.filter(([x2, z2]) => Math.hypot(x2 - x, z2 - z) < 1e-6).length;
        expect(meets).toBe(2);
      }
      // About the right size: a cone's ring at height h has radius (4.5 − h) cells.
      const mid = FIELD_MAP.west + 40;
      const midZ = FIELD_MAP.north + 40;
      for (const [x, z] of ends) expect(Math.hypot(x - mid, z - midZ) / 10).toBeCloseTo(4.5 - level, 0);
    }
  });

  it('samples the real ground over the whole map, finds water at the ford and contours inside the map', () => {
    const field = sampleGround(20);
    expect(field.cols).toBe(Math.floor(MAP_WIDTH / 20) + 1);
    expect(field.heights[0]).toBeCloseTo(groundHeight(FIELD_MAP.west, FIELD_MAP.north), 4);
    expect(field.water.some((w) => w === 1)).toBe(true);
    const segs = contours(field);
    expect(segs.length).toBeGreaterThan(100);
    for (const s of segs) {
      for (const [x, z] of [[s.x0, s.z0], [s.x1, s.z1]]) {
        expect(x).toBeGreaterThanOrEqual(FIELD_MAP.west - 1e-6);
        expect(x).toBeLessThanOrEqual(FIELD_MAP.east + 1e-6);
        expect(z).toBeGreaterThanOrEqual(FIELD_MAP.north - 1e-6);
        expect(z).toBeLessThanOrEqual(FIELD_MAP.south + 1e-6);
      }
    }
  });

  it("shows the ground, the briefed objectives and the enemy's expected road, never our tank or the enemy's guns and tanks", () => {
    // It is drawn once, from nothing about the run: it cannot know where our tank is.
    expect(mapFeatures.length).toBe(0);
    const features = mapFeatures();
    const kinds = new Set(features.map((f) => f.kind));
    for (const k of ['road', 'track', 'building', 'wall', 'mud', 'bridge', 'marker', 'target', 'box', 'spot', 'name', 'objective-line', 'objective-point']) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    const red = features.flatMap((f) => (f.kind === 'objective-line' || f.kind === 'objective-point' ? [f.text] : []));
    expect(red.sort()).toEqual(['Ambush', 'Convoy RP', 'Enemy column expected', 'HOLD', 'OBJ', 'SP'].sort());
    const sp = features.find((f) => f.kind === 'objective-point' && f.text === 'SP');
    expect(sp && 'x' in sp ? [sp.x, sp.z] : null).toEqual([0, 0]);
    // Only the briefed road the column is expected on is red and enemy; it is a dashed line with an arrow, not a place.
    const column = features.find((f) => f.kind === 'objective-line' && f.text.startsWith('Enemy'));
    expect(column && column.kind === 'objective-line' ? [column.dashed, column.arrow] : null).toEqual([true, true]);
    for (const f of features) {
      if ('text' in f) expect(f.text).not.toMatch(/\b(you|us|our|own|tank|gun|AT)\b/i);
    }
  });

  it('keeps everything it draws on the sheet', () => {
    const on = (x: number, z: number) => x >= FIELD_MAP.west - 40 && x <= FIELD_MAP.east + 40 && z >= FIELD_MAP.north - 40 && z <= FIELD_MAP.south + 40;
    for (const f of mapFeatures()) {
      const points: number[][] =
        f.kind === 'road' ? [f.from, f.to] : f.kind === 'track' || f.kind === 'objective-line' ? f.points : f.kind === 'mud' ? [[f.west, f.north], [f.east, f.south]] : [[f.x, f.z]];
      for (const [x, z] of points) expect(on(x, z), `${f.kind} at ${x.toFixed(0)}, ${z.toFixed(0)}`).toBe(true);
    }
  });
});
