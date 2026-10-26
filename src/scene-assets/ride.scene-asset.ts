import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import { DRIVER_EYE, groundHeight, HULL, SLIT, TILE, TREE_SPOTS, TURRET, wrapTile } from '../sim/ride.js';
import { beam, jitter, mergeParts, type Part, rng, shade } from './lowpoly.js';

/**
 * Spike S2's blockout (docs/spikes/s2-riding.md): a hull, a turret basket
 * and a stretch of rolling ground that repeats, all low-poly, vertex
 * coloured and merged. Sizes come from src/sim/ride.ts. Built when a ride
 * first starts, not at load, and not placed in the scene: F1.1 replaces the
 * hull and turret with the real cabin, F1.7 the ground with the range.
 *
 * Hull space: hull floor at y = 0, the front towards -Z. Turret space:
 * the turret's middle on the hull floor, the gun towards -Z.
 */

const IVORY = 0xd9d0b6;
const FLOOR = 0x5c5852;
const TRACK = 0x3b3733;
const WHEEL = 0x6b6a4a;
const DARK = 0x3e3b37;
const SEAT = 0x5b4030;
const BIN = 0x55603a;
const DECK = 0xa89060;
const STEEL = 0x7b7b74;
const TURRET_IVORY = 0xcec5ab;
const GUN = 0x8f7d55;
const GRASS = 0x6f9a4a;
const ROCK = 0x8a8478;
const LEAVES = 0x3f6b35;
const BARK = 0x5a4632;

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

function box(size: [number, number, number], position: [number, number, number], color: number): Part {
  return { geometry: new BoxGeometry(...size), color, position };
}

const halfW = HULL.width / 2;
const halfL = HULL.length / 2;
/** Hull side walls' thickness, m. */
const WALL = 0.06;
/** Where the engine bay starts, towards the back. */
const ENGINE_Z = 1.8;

/** The hull up to the top of its sides: floor, tracks, walls, engine bay, the driver's seat and dash, ammunition bins. */
export function createRideHull(): Mesh {
  const parts: Part[] = [];
  const inner = halfW - WALL;
  // The floor's edges end inside the walls, so they share no plane with the walls or the engine bay.
  parts.push(box([2 * halfW - WALL, 0.05, HULL.length - WALL], [0, -0.025, 0], FLOOR));
  const wallH = HULL.wallTop + 0.04;
  for (const side of [-1, 1]) {
    // Tracks under the floor, their tops 1 cm below it, the outer face 2 cm inside the wall's.
    parts.push(box([0.48, 0.49, HULL.length - 0.3], [side * (halfW - 0.26), -HULL.clearance + 0.245, 0], TRACK));
    for (let i = 0; i < 8; i++) {
      const z = -halfL + 0.55 + (i * (HULL.length - 1.1)) / 7;
      parts.push({ geometry: new CylinderGeometry(0.36, 0.36, 0.06, 10), color: WHEEL, position: [side * (halfW + 0.01), -0.2, z], rotation: [0, 0, Math.PI / 2] });
    }
    parts.push(box([WALL, wallH, HULL.length], [side * (halfW - WALL / 2), HULL.wallTop - wallH / 2, 0], IVORY));
    // Ammunition bins along the walls, by the turret.
    for (const z of [-0.45, 0.75]) {
      parts.push(box([0.3, 0.55, 1.0], [side * (inner - 0.16), 0.275, z], BIN));
    }
  }
  parts.push(box([2 * inner, wallH, WALL], [0, HULL.wallTop - wallH / 2, -halfL + WALL / 2], IVORY));
  // The engine bay, its top a centimetre under the walls' so the two never share a plane.
  parts.push(box([2 * inner, wallH - 0.01, halfL - ENGINE_Z], [0, HULL.wallTop - 0.01 - (wallH - 0.01) / 2, (halfL + ENGINE_Z) / 2], DECK));
  // The driver's station: dash, seat and the two steering tillers.
  const [dx, dz] = DRIVER_EYE;
  parts.push(box([0.9, 0.2, 0.3], [dx, 0.85, dz - 0.9], DARK));
  parts.push(box([0.46, 0.1, 0.46], [dx, 0.6, dz + 0.15], SEAT));
  parts.push(box([0.46, 0.55, 0.08], [dx, 0.93, dz + 0.42], SEAT));
  parts.push(box([0.12, 0.55, 0.12], [dx, 0.275, dz + 0.15], DARK));
  for (const x of [dx - 0.22, dx + 0.22]) {
    parts.push(beam([x, 0.25, dz - 0.55], [x, 0.85, dz - 0.3], 0.02, DARK, 6));
  }
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Ride Hull';
  return mesh;
}

/**
 * The closed cabin's upper hull: sides up to the roof, the front plate with
 * the driver's vision slit, the bulkhead to the engine bay, and the roof
 * with a hole for the turret.
 */
export function createRideHullRoof(): Mesh {
  const parts: Part[] = [];
  const inner = halfW - WALL;
  const low = HULL.wallTop;
  const high = HULL.roof;
  const h = high - low;
  const mid = (low + high) / 2;
  for (const side of [-1, 1]) {
    // Starting 1 cm under the lower walls' tops, so their ends overlap rather than meet in a plane.
    parts.push(box([WALL, h + 0.01, HULL.length], [side * (halfW - WALL / 2), mid - 0.005, 0], IVORY));
  }
  // Front plate, with the slit in front of the driver's eyes.
  const front = -halfL + WALL / 2;
  const slitLow = SLIT.y - SLIT.height / 2;
  const slitHigh = SLIT.y + SLIT.height / 2;
  const slitLeft = DRIVER_EYE[0] - SLIT.width / 2;
  const slitRight = DRIVER_EYE[0] + SLIT.width / 2;
  parts.push(box([2 * inner, slitLow - low + 0.01, WALL], [0, (low - 0.01 + slitLow) / 2, front], IVORY));
  parts.push(box([2 * inner, high - slitHigh, WALL], [0, (slitHigh + high) / 2, front], IVORY));
  parts.push(box([slitLeft + inner, SLIT.height, WALL], [(-inner + slitLeft) / 2, SLIT.y, front], IVORY));
  parts.push(box([inner - slitRight, SLIT.height, WALL], [(slitRight + inner) / 2, SLIT.y, front], IVORY));
  // Bulkhead to the engine bay.
  parts.push(box([2 * inner, h + 0.01, WALL], [0, mid - 0.005, ENGINE_Z - WALL / 2], IVORY));
  // Roof, 4 cm thick, round a square hole for the turret.
  const roofY = high + 0.02;
  const hole = TURRET.radius + 0.05;
  const holeFront = TURRET.z - hole;
  const holeBack = TURRET.z + hole;
  // It overhangs the walls by a centimetre, so its edges never share a plane with their outer faces.
  const edge = halfW + 0.01;
  const end = halfL + 0.01;
  parts.push(box([2 * edge, 0.04, holeFront + end], [0, roofY, (-end + holeFront) / 2], DECK));
  parts.push(box([2 * edge, 0.04, end - holeBack], [0, roofY, (holeBack + end) / 2], DECK));
  for (const side of [-1, 1]) {
    parts.push(box([edge - hole, 0.04, 2 * hole], [(side * (hole + edge)) / 2, roofY, TURRET.z], DECK));
  }
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Ride Hull Roof';
  return mesh;
}

/** A ring of `count` boxes round the turret's middle, radius `r` (to the middle of the ring), from `y0` to `y1`. */
function ring(r: number, thickness: number, y0: number, y1: number, color: number, count = 16): Part[] {
  const parts: Part[] = [];
  const width = 2 * r * Math.tan(Math.PI / count) + thickness;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI;
    parts.push({
      geometry: new BoxGeometry(width, y1 - y0, thickness),
      color,
      position: [Math.sin(a) * r, (y0 + y1) / 2, Math.cos(a) * r],
      rotation: [0, a, 0],
    });
  }
  return parts;
}

/** A gun along -Z at height `y`: mantlet, barrel and muzzle brake. */
function gun(y: number, mantletZ: number): Part[] {
  return [
    box([0.8, 0.5, 0.25], [0, y, mantletZ], GUN),
    box([0.3, 0.3, 0.5], [0, y, mantletZ + 0.35], DARK),
    beam([0, y, mantletZ - 0.1], [0, y, mantletZ - 4.8], 0.07, GUN, 8),
    { geometry: new CylinderGeometry(0.13, 0.13, 0.4, 8), color: GUN, position: [0, y, mantletZ - 4.9], rotation: [Math.PI / 2, 0, 0] },
  ];
}

/** The turret basket, which turns with the turret and carries the gunner: floor, posts, seat and the turret ring. */
export function createRideTurret(): Mesh {
  const parts: Part[] = [
    { geometry: new CylinderGeometry(TURRET.radius - 0.05, TURRET.radius - 0.05, 0.03, 16), color: STEEL, position: [0, 0.025, 0] },
    // The gunner's seat, under and a little behind their eyes.
    box([0.42, 0.08, 0.42], [-0.42, 0.62, -0.22], SEAT),
    box([0.42, 0.45, 0.07], [-0.42, 0.9, 0.02], SEAT),
    box([0.1, 0.6, 0.1], [-0.42, 0.33, -0.22], DARK),
    // The breech, behind the gun, to the gunner's right.
    box([0.36, 0.34, 0.9], [0, 1.25, -0.2], DARK),
    ...ring(TURRET.radius, 0.05, HULL.wallTop + 0.02, 1.25, TURRET_IVORY),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 2 * Math.PI + Math.PI / 3;
    const r = TURRET.radius - 0.03;
    parts.push(beam([Math.sin(a) * r, 0.04, Math.cos(a) * r], [Math.sin(a) * r, HULL.wallTop + 0.03, Math.cos(a) * r], 0.025, STEEL, 6));
  }
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Ride Turret';
  return mesh;
}

/** The open turret's gun, low over the open hull. */
export function createRideTurretOpen(): Mesh {
  const mesh = new Mesh(mergeParts(gun(TURRET.gunHeight, -TURRET.radius - 0.05)), material);
  mesh.name = 'Ride Turret Open';
  return mesh;
}

/** The closed turret: its walls up from the ring, the roof, a flange over the roof's hole, and the gun out above the hull roof. */
export function createRideTurretClosed(): Mesh {
  const top = HULL.roof + 0.85;
  const parts: Part[] = [
    ...ring(TURRET.radius, 0.05, 1.24, top, TURRET_IVORY),
    { geometry: new CylinderGeometry(TURRET.radius + 0.05, TURRET.radius + 0.05, 0.05, 16), color: DECK, position: [0, top + 0.02, 0] },
    // A flange lying on the hull roof that covers the corners of its square hole.
    ...ring(TURRET.radius + 0.25, 0.5, HULL.roof + 0.05, HULL.roof + 0.09, DECK),
    // The mantlet's back ends inside the front wall rather than flush with its inner face.
    ...gun(HULL.roof + 0.45, -TURRET.radius - 0.12),
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Ride Turret Closed';
  return mesh;
}

/** The drawn ground's spacing and how far it reaches from the world's middle, m: three tiles across. */
const CELL = 6;
const GROUND_HALF = 1.5 * TILE;

/** A shade for a spot of ground that repeats with the tiles, so the copies join up. */
function patch(x: number, z: number): number {
  const ix = Math.round(wrapTile(x) / CELL);
  const iz = Math.round(wrapTile(z) / CELL);
  const h = Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453;
  return 0.82 + 0.3 * (h - Math.floor(h));
}

/**
 * The rolling ground three tiles across with small rocks and bushes, low
 * enough to pass under the hull. It repeats every tile, so moving it by
 * the tank's position less whole tiles never shows a seam.
 */
export function createRideGround(): Mesh {
  const ground = new PlaneGeometry(2 * GROUND_HALF, 2 * GROUND_HALF, (2 * GROUND_HALF) / CELL, (2 * GROUND_HALF) / CELL);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  }
  const parts: Part[] = [{ geometry: ground, color: (_, c) => shade(GRASS, patch(c.x, c.z)) }];
  const random = rng(77);
  const tile: Part[] = [];
  for (let i = 0; i < 90; i++) {
    const x = (random() - 0.5) * TILE;
    const z = (random() - 0.5) * TILE;
    const rock = i % 3 !== 0;
    const size = rock ? 0.15 + random() * 0.25 : 0.3 + random() * 0.2;
    const geometry = jitter(new DodecahedronGeometry(size, 0), size * 0.4, random);
    tile.push({ geometry, color: rock ? shade(ROCK, 0.85 + random() * 0.3) : shade(LEAVES, 0.9 + random() * 0.3), position: [x, 0, z], scale: [1, rock ? 0.6 : 0.8, 1] });
  }
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      for (const t of tile) {
        const [x, , z] = t.position!;
        const wx = x + ix * TILE;
        const wz = z + iz * TILE;
        parts.push({ ...t, geometry: t.geometry.clone(), position: [wx, groundHeight(wx, wz) + 0.02, wz] });
      }
    }
  }
  for (const t of tile) t.geometry.dispose();
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Ride Ground';
  return mesh;
}

/** The trees of all nine tiles, in TREE_SPOTS order tile by tile, as one instanced mesh: instance `i`'s spot is treeSpot(i). */
export function createRideTrees(): InstancedMesh {
  const geometry = mergeParts([
    { geometry: new CylinderGeometry(0.06, 0.1, 0.35, 5), color: BARK, position: [0, 0.175, 0] },
    { geometry: new ConeGeometry(0.28, 0.75, 7), color: LEAVES, position: [0, 0.6, 0] },
  ]);
  const count = 9 * TREE_SPOTS.length;
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.name = 'Ride Trees';
  const matrix = new Matrix4();
  const at = new Vector3();
  const size = new Vector3();
  const turn = new Quaternion();
  const spot = new Vector3();
  for (let i = 0; i < count; i++) {
    treeSpot(i, spot);
    const height = TREE_SPOTS[i % TREE_SPOTS.length][2];
    at.set(spot.x, spot.y - 0.1, spot.z);
    size.set(height, height, height);
    turn.setFromAxisAngle(up, i * 2.4);
    mesh.setMatrixAt(i, matrix.compose(at, turn, size));
  }
  mesh.computeBoundingSphere();
  return mesh;
}
const up = new Vector3(0, 1, 0);

/** Where tree instance `i` stands in the ground's space (createRideTrees). */
export function treeSpot(i: number, out: Vector3): Vector3 {
  const n = TREE_SPOTS.length;
  const copy = Math.floor(i / n);
  const [x, z] = TREE_SPOTS[i % n];
  const wx = x + ((copy % 3) - 1) * TILE;
  const wz = z + (Math.floor(copy / 3) - 1) * TILE;
  return out.set(wx, groundHeight(wx, wz), wz);
}
