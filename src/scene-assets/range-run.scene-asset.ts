import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { TURRET, VISION_SLIT } from '../sim/cabin.js';
import { HIT_FLAG } from '../sim/range-run.js';
import { BOARD } from './loading.scene-asset.js';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * The range run's models (F1.11, docs/range-run.md): the run clock's
 * backing in each seat (the clock's face is a canvas, RangeRunSystem's;
 * the backings are merged into the hull's and the turret's meshes by
 * src/scene-assets/cabin.scene-asset.ts) and the hit flag that goes up
 * beside a target once it has been hit. Low-poly and vertex-coloured.
 */

const BACKING = 0x2b2622;
const BRACKET = 0x3a3f42;
const POLE = 0xe8e4d8;
const FLAG_RED = 0xc8281e;

/**
 * A run clock: its face's middle, size and turn about +Y (its face looks
 * along its own +Z), m. The driver's is on the hood's face left of the
 * vision slit, in hull space; the gunner's hangs over the loading board on
 * the turret's right wall, turned the same way, in turret space.
 */
export interface RunClockPlace {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  yaw: number;
}

/** The face stands this far in front of its backing (the 8 mm rule), and the backing is this deep, m. */
const FACE_GAP = 0.008;
const BACKING_DEPTH = 0.02;
/** The backing sinks this far into the wall it hangs on, m. */
const SUNK = 0.005;

export const RUN_CLOCKS: Readonly<Record<'driver' | 'gunner', RunClockPlace>> = {
  driver: {
    x: VISION_SLIT.x - 0.37,
    y: VISION_SLIT.y,
    z: VISION_SLIT.z + BACKING_DEPTH - SUNK + FACE_GAP,
    width: 0.22,
    height: 0.11,
    yaw: 0,
  },
  gunner: {
    x: BOARD.x,
    y: BOARD.y + BOARD.height / 2 + 0.1,
    z: BOARD.z,
    width: 0.24,
    height: 0.11,
    yaw: BOARD.yaw,
  },
};

function box(size: [number, number, number], position: [number, number, number], color: number, rotation?: [number, number, number]): Part {
  return { geometry: new BoxGeometry(...size), color, position, rotation };
}

/** A clock's backing, behind its face (its -Z side). */
function backing(c: RunClockPlace): [Part, number, number] {
  const back = FACE_GAP + BACKING_DEPTH / 2;
  const bx = c.x - Math.sin(c.yaw) * back;
  const bz = c.z - Math.cos(c.yaw) * back;
  return [box([c.width + 0.02, c.height + 0.02, BACKING_DEPTH], [bx, c.y, bz], BACKING, [0, c.yaw, 0]), bx, bz];
}

/** The driver's run clock's backing on the hood's face, hull space. */
export function driverClockParts(): Part[] {
  return [backing(RUN_CLOCKS.driver)[0]];
}

/** The gunner's run clock's backing, and its bracket to the turret's right wall, turret space. */
export function gunnerClockParts(): Part[] {
  const c = RUN_CLOCKS.gunner;
  const [part, bx, bz] = backing(c);
  const wallX = TURRET.halfWidth - 0.08 + 0.02;
  return [part, box([wallX - bx, 0.03, 0.03], [(bx + wallX) / 2, c.y, bz], BRACKET)];
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

/**
 * A hit flag: a pale pole from the ground (its foot at the origin) with a
 * red flag at its top flying along +X, broadside to a crew looking up the
 * range (along -Z).
 */
export function createHitFlag(): Mesh {
  const f = HIT_FLAG;
  const mesh = new Mesh(mergeParts([
    { geometry: new CylinderGeometry(f.radius, f.radius * 1.3, f.pole, 6, 1), color: POLE, position: [0, f.pole / 2, 0] },
    // The flag's near edge ends inside the pole, its top a little under the pole's.
    box([f.width, f.height, f.thickness], [f.width / 2, f.pole - 0.1 - f.height / 2, 0], FLAG_RED),
  ]), material);
  mesh.name = 'Hit Flag';
  return mesh;
}
