import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { TURRET, VISION_SLIT } from '../sim/cabin.js';
import { COURSE_BOARD, COURSE_TARGETS, courseBoardMiddle } from '../sim/course.js';
import { groundHeight } from '../sim/terrain.js';
import { HIT_FLAG } from '../sim/range-run.js';
import { BOARD } from './loading.scene-asset.js';
import { boardLocalParts } from './course.scene-asset.js';
import { mergeParts, type Part } from './lowpoly.js';
import { litInside } from './cabin-light.js';

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
/** The course boards' white (course.scene-asset.ts). */
const COVER_WHITE = 0xf4f2ea;

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

const material = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));

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

/**
 * A biathlon board's cover (F5.3b, docs/biathlon-race.md): a white disc
 * that swings over a course board's black disc when the board falls, as a
 * biathlon target's flap does, so the line's standing boards still read as
 * black discs in the sight. Its face looks along +Z, its back
 * BOARD_COVER.gap in front of the board's disc (the 8 mm rule out in the
 * world); RangeRunSystem stands it on the board's middle, turned as the
 * board.
 */
export const BOARD_COVER = {
  /** Wider than the board's disc all round, m. */
  radius: COURSE_BOARD.disc + 0.03,
  thickness: 0.02,
  /** From the board's middle plane to the disc's front, and on to the cover's back, m (boardParts: the disc's middle 7 cm out, 6 cm thick). */
  discFront: 0.1,
  gap: 0.01,
} as const;

/** How far in front of the board's middle plane the cover's middle stands, m. */
export function boardCoverOut(): number {
  return BOARD_COVER.discFront + BOARD_COVER.gap + BOARD_COVER.thickness / 2;
}

/** Where board `j`'s cover stands: its middle's x and z (world space, the tile's own copy), its height above the ground there, and its turn about +Y. */
export function boardCoverSpot(j: number, out: [number, number, number, number]): [number, number, number, number] {
  const t = COURSE_TARGETS[j];
  const ahead = boardCoverOut();
  // In front of the board, towards its box: the board's face looks along its yaw.
  out[0] = t.x + Math.sin(t.yaw) * ahead;
  out[1] = groundHeight(t.x, t.z) + courseBoardMiddle();
  out[2] = t.z + Math.cos(t.yaw) * ahead;
  out[3] = t.yaw;
  return out;
}

/**
 * A course board of line `line` (course.scene-asset.ts's boardLocalParts)
 * as a mesh of its own, its foot at the origin and its face along +Z:
 * RangeRunSystem stands it where the board stands now, on the ground, at
 * the copy nearest the tank, turned to face its box. One mesh a board, six
 * draw calls.
 */
export function createCourseBoard(line: number): Mesh {
  const mesh = new Mesh(mergeParts(boardLocalParts(line)), material);
  mesh.name = `Course Board ${line + 1}`;
  return mesh;
}

export function createBoardCover(): Mesh {
  const c = BOARD_COVER;
  const disk = new CylinderGeometry(c.radius, c.radius, c.thickness, 20, 1);
  disk.rotateX(Math.PI / 2);
  const mesh = new Mesh(mergeParts([{ geometry: disk, color: COVER_WHITE }]), material);
  mesh.name = 'Board Cover';
  return mesh;
}
