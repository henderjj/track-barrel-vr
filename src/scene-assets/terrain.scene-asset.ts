import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
} from '@iwsdk/core';
import { onRoad } from '../sim/range.js';
import { CELL, cornerHeight, groundHeight, type Obstacle, OBSTACLES, TILE, wrapTile } from '../sim/terrain.js';
import { jitter, mergeParts, type Part, rng, shade } from './lowpoly.js';
import { allMarkerParts, allTargetParts, roadParts } from './range.scene-asset.js';

/**
 * The test range the tank drives on (F1.4 and F1.7, docs/range.md): the
 * height field of src/sim/terrain.ts three tiles across, with its two dirt
 * roads, its three static targets and their range markers
 * (range.scene-asset.ts), its rocks, walls and houses, and a scatter of
 * small stones and bushes low enough to pass under the hull. It repeats
 * every tile, so the drive system moves it by the tank's position less
 * whole tiles and a drive of any length never shows its edge.
 *
 * Merged into one mesh per CHUNK-metre square, so the renderer skips the
 * squares out of view or past the camera's far plane: most of the ground
 * is behind the tank or beyond 1.2 km at any moment.
 *
 * World space, the ground at the start at y = 0: the scene places the mesh
 * GROUND_Y under the hull floor, and the drive system then moves it by the
 * inverse of the tank's pose.
 */

const GRASS = 0x6f9a4a;
const ROCK = 0x8a8478;
const STONE = 0x9a958a;
const LEAVES = 0x3f6b35;
const WALL = 0x8c8170;
const PLASTER = 0xd8cdb4;
const ROOF = 0x8a4b36;

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

/** How many cells the drawn ground spans each way from its middle: three tiles across. */
const HALF_CELLS = Math.round((1.5 * TILE) / CELL);
/** The side of each separately drawn square of ground, m: half a tile, so 6 × 6 squares. */
const CHUNK = TILE / 2;
const CHUNK_CELLS = CHUNK / CELL;
/**
 * Small scatter only matters near the tank, which is always in the middle
 * tile (the drive system moves the ground by whole tiles): it goes in the
 * middle tile and this far into its neighbours, m.
 */
const SCATTER_MARGIN = 150;

/** A shade for a cell of ground that repeats with the tiles, so the copies join up. */
function patch(x: number, z: number): number {
  const ix = Math.floor(wrapTile(x) / CELL);
  const iz = Math.floor(wrapTile(z) / CELL);
  const h = Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453;
  return 0.84 + 0.24 * (h - Math.floor(h));
}

/**
 * The height field as triangles, `cells` square from grid corner (ix0, iz0),
 * each cell split along the diagonal from its (-x, -z) corner to its
 * (+x, +z) corner, as groundHeight joins them.
 */
function groundGeometry(ix0: number, iz0: number, cells: number): BufferGeometry {
  const n = cells + 1;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ix = ix0 + i;
      const iz = iz0 + j;
      const k = (j * n + i) * 3;
      positions[k] = ix * CELL;
      positions[k + 1] = cornerHeight(ix, iz);
      positions[k + 2] = iz * CELL;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const d = a + n;
      const c = d + 1;
      // Facing up: (a, c, b) is the cell's +x side of the diagonal, (a, d, c) its +z side.
      index.push(a, c, b, a, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

/** The lowest ground under a turned box's corners, m. */
function lowestUnder(x: number, z: number, hx: number, hz: number, yaw: number): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let low = Infinity;
  for (const [cx, cz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
    low = Math.min(low, groundHeight(x + cx * c + cz * s, z - cx * s + cz * c));
  }
  return low;
}

/** One obstacle's parts, standing at (x, z) (a copy of it in some tile). */
function obstacleParts(o: Obstacle, x: number, z: number, random: () => number): Part[] {
  const ground = groundHeight(x, z);
  if (o.kind === 'rock') {
    const geometry = jitter(new DodecahedronGeometry(o.r, 0), o.r * 0.25, random);
    return [{ geometry, color: shade(ROCK, 0.85 + random() * 0.3), position: [x, ground + o.r * 0.35, z], scale: [1, o.height / (2 * o.r), 1], rotation: [0, random() * Math.PI, 0] }];
  }
  // Walls and houses go down into the ground below their lowest corner, so a slope never shows a gap.
  const base = lowestUnder(x, z, o.hx, o.hz, o.yaw) - 0.3;
  const top = ground + o.height;
  const body: Part = {
    geometry: new BoxGeometry(2 * o.hx, top - base, 2 * o.hz),
    color: o.kind === 'wall' ? shade(WALL, 0.9 + random() * 0.2) : PLASTER,
    position: [x, (top + base) / 2, z],
    rotation: [0, o.yaw, 0],
  };
  if (o.kind === 'wall') return [body];
  // A hipped roof: a four-sided cone turned square to the walls and stretched over them, its eaves 5 cm below their top.
  const roofHeight = 1.6;
  const roof = new ConeGeometry(Math.SQRT2, roofHeight, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(o.hx * 1.15, 1, o.hz * 1.15);
  return [body, { geometry: roof, color: ROOF, position: [x, top - 0.05 + roofHeight / 2, z], rotation: [0, o.yaw, 0] }];
}

/** Small stones and bushes per tile, low enough to pass under the hull: something near to see the ground go by. */
const SCATTER_PER_TILE = 160;

/** The ground three tiles across with its obstacles and scatter, one mesh per chunk. */
export function createTerrain(): Group {
  const chunks = 2 * HALF_CELLS / CHUNK_CELLS;
  const parts: Part[][] = [];
  for (let c = 0; c < chunks; c++) {
    for (let r = 0; r < chunks; r++) {
      const ix0 = -HALF_CELLS + r * CHUNK_CELLS;
      const iz0 = -HALF_CELLS + c * CHUNK_CELLS;
      parts.push([{ geometry: groundGeometry(ix0, iz0, CHUNK_CELLS), color: (_, p) => shade(GRASS, patch(p.x, p.z)) }]);
    }
  }
  const edge = HALF_CELLS * CELL;
  /** The parts of the chunk that (x, z) is in. */
  const chunkAt = (x: number, z: number) => {
    const r = Math.min(chunks - 1, Math.max(0, Math.floor((x + edge) / CHUNK)));
    const c = Math.min(chunks - 1, Math.max(0, Math.floor((z + edge) / CHUNK)));
    return parts[c * chunks + r];
  };
  // The range's roads, laid up the lane and across the start.
  for (const { part, x, z } of roadParts(edge)) chunkAt(x, z).push(part);
  const random = rng(91);
  const scatter: [x: number, z: number, size: number, stone: boolean][] = [];
  for (let i = 0; i < SCATTER_PER_TILE; i++) {
    const stone = i % 3 !== 0;
    scatter.push([(random() - 0.5) * TILE, (random() - 0.5) * TILE, stone ? 0.12 + random() * 0.2 : 0.25 + random() * 0.2, stone]);
  }
  const near = TILE / 2 + SCATTER_MARGIN;
  for (let tx = -1; tx <= 1; tx++) {
    for (let tz = -1; tz <= 1; tz++) {
      for (const o of OBSTACLES) {
        const x = o.x + tx * TILE;
        const z = o.z + tz * TILE;
        chunkAt(x, z).push(...obstacleParts(o, x, z, random));
      }
      // The range's targets and markers: a copy per tile, like the obstacles.
      for (const { parts, x, z } of allTargetParts(tx * TILE, tz * TILE)) chunkAt(x, z).push(...parts);
      for (const { parts, x, z } of allMarkerParts(tx * TILE, tz * TILE)) chunkAt(x, z).push(...parts);
      for (const [sx, sz, size, stone] of scatter) {
        const x = sx + tx * TILE;
        const z = sz + tz * TILE;
        // Random numbers are drawn for every copy, so the near ones look the same whatever the margin.
        const geometry = jitter(new OctahedronGeometry(size, 0), size * 0.4, random);
        const color = stone ? shade(STONE, 0.8 + random() * 0.3) : shade(LEAVES, 0.85 + random() * 0.3);
        if (Math.abs(x) > near || Math.abs(z) > near) continue;
        // A road is swept: nothing scattered on its surface.
        if (onRoad(x, z)) continue;
        chunkAt(x, z).push({
          geometry,
          color,
          position: [x, groundHeight(x, z) + size * 0.25, z],
          scale: [1, stone ? 0.55 : 0.8, 1],
        });
      }
    }
  }
  const group = new Group();
  group.name = 'Ground';
  parts.forEach((list, k) => {
    const mesh = new Mesh(mergeParts(list), material);
    mesh.name = `Ground ${k % chunks},${Math.floor(k / chunks)}`;
    group.add(mesh);
  });
  return group;
}
