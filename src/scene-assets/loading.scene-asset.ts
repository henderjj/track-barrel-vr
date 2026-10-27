import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial } from '@iwsdk/core';
import { mergeParts, type Part } from './lowpoly.js';
import { TURRET } from '../sim/cabin.js';
import {
  BREECH_MOUTH,
  CASE_LENGTH,
  CASING_BIN,
  LEVER_HANDLE_X,
  LEVER_LENGTH,
  LEVER_PIVOT,
  RACK_SLOTS,
  SHELL_LENGTH,
  SHELL_RADIUS,
} from '../sim/loading.js';

/**
 * Loading and firing's models (F1.10, docs/loading-firing.md): the ready
 * rack on the turret's right wall, the casing bin under the breech and the
 * loading board's backing (all merged into the turret's mesh by
 * src/scene-assets/cabin.scene-asset.ts), and the parts that move: the
 * shells, the breech block and lever (on the gun's recoiling part), the
 * casings, the muzzle flash, the shell's tracer and the bursts where it
 * lands. Low-poly and vertex-coloured; sizes come from src/sim/loading.ts.
 */

const STEEL_DARK = 0x3a3f42;
const BLOCK_STEEL = 0x7b8388;
const RACK_WOOD = 0x7a5534;
const BIN = 0x4b4a3c;
const BIN_DARK = 0x2c2b25;
const BRASS = 0xc9a03a;
const SHELL_BODY = 0x4d5a3a;
const COPPER = 0xb0643a;
const PRIMER = 0x3a3024;
const LEVER_RED = 0x8a2c22;
const BOARD_BACK = 0x2b2622;

const [, MY, MZ] = BREECH_MOUTH;

/** The breech's square opening at the back, half its side, m (the gun's model cuts it: src/scene-assets/cabin.scene-asset.ts). */
export const BREECH_HOLE = 0.06;

/** The breech block, gun space: a plate that slides up across the mouth, just behind it (+Z), m. */
export const BLOCK = { width: 0.2, height: 0.14, depth: 0.04, gap: 0.006 } as const;
/** The block's centre height, open (lowered clear of the mouth) and closed (across it), gun space. */
export const BLOCK_OPEN_Y = MY - 0.16;
export const BLOCK_CLOSED_Y = MY;
/** Its centre along the bore. */
export const BLOCK_Z = MZ + BLOCK.gap + BLOCK.depth / 2;

/**
 * The loading board, turret space: its middle, size and turn about +Y. It
 * hangs on the turret's right wall above the rack, turned to face the
 * gunner's seat, m.
 */
export const BOARD = { x: 0.93, y: 2.4, z: -0.62, width: 0.34, height: 0.17, yaw: -1.0 } as const;

const ALONG_Z: readonly [number, number, number] = [-Math.PI / 2, 0, 0];
const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];

function box(size: [number, number, number], position: [number, number, number], color: number, rotation?: [number, number, number]): Part {
  return { geometry: new BoxGeometry(...size), color, position, rotation };
}

/** A cylinder along Z from z0 to z1 (z1 < z0 points it to -Z, as the bore runs). */
function tubeZ(radius: number, x: number, y: number, z0: number, z1: number, color: number, sides = 10): Part {
  return {
    geometry: new CylinderGeometry(radius, radius, Math.abs(z1 - z0), sides, 1),
    color,
    position: [x, y, (z0 + z1) / 2],
    rotation: ALONG_Z,
  };
}

/** The inner face of the turret's right wall, turret space. */
const WALL_X = TURRET.halfWidth - 0.08;

/**
 * The ready rack, turret space: a cradle bar under each row of shells at
 * each end, running from the turret wall, with a stop plate ahead of the
 * noses so the shells read as racked.
 */
export function rackParts(): Part[] {
  const parts: Part[] = [];
  const xs = RACK_SLOTS.map((s) => s[0]);
  const inner = Math.min(...xs) - SHELL_RADIUS - 0.02;
  const rowZ = RACK_SLOTS[0][2];
  const ends = [rowZ - SHELL_LENGTH / 2 + 0.08, rowZ + SHELL_LENGTH / 2 - 0.08];
  for (const y of [RACK_SLOTS[0][1], RACK_SLOTS[2][1]]) {
    const barTop = y - SHELL_RADIUS - 0.004;
    for (const z of ends) {
      // Ends inside the wall.
      parts.push(box([WALL_X + 0.02 - inner, 0.025, 0.03], [(inner + WALL_X + 0.02) / 2, barTop - 0.0125, z], RACK_WOOD));
    }
  }
  // Uprights at the cradles' inner ends, from the lower bars to above the top row.
  const lowBar = RACK_SLOTS[0][1] - SHELL_RADIUS - 0.03;
  const top = RACK_SLOTS[2][1] + SHELL_RADIUS + 0.02;
  for (const z of ends) {
    parts.push(box([0.025, top - lowBar, 0.025], [inner - 0.012, (top + lowBar) / 2, z], RACK_WOOD));
  }
  return parts;
}

/** The casing bin on the basket floor under the breech: a low open box, dark inside, turret space. */
export function binParts(): Part[] {
  const { x, z, halfX, halfZ, height } = CASING_BIN;
  const floor = TURRET.basketFloor;
  const t = 0.015;
  // The walls stand 1 cm down into the basket floor; the end walls sit between the side walls, 5 mm in from their ends.
  const sunk = 0.01;
  const wallY = floor + (height - sunk) / 2;
  const end = halfZ - t / 2 - 0.005;
  return [
    box([2 * (halfX - t), 0.01, 2 * (end - t / 2)], [x, floor + 0.005, z], BIN_DARK),
    box([t, height + sunk, 2 * halfZ], [x - halfX + t / 2, wallY, z], BIN),
    box([t, height + sunk, 2 * halfZ], [x + halfX - t / 2, wallY, z], BIN),
    box([2 * (halfX - t), height + sunk, t], [x, wallY, z - end], BIN),
    box([2 * (halfX - t), height + sunk, t], [x, wallY, z + end], BIN),
  ];
}

/** The loading board's backing and its bracket to the wall, turret space (the board's face is a canvas, LoadingSystem's). */
export function boardParts(): Part[] {
  const { x, y, z, width, height, yaw } = BOARD;
  const depth = 0.02;
  // The backing stands behind the face (its -Z side), 8 mm back so the face never meets it.
  const back = 0.008 + depth / 2;
  const bx = x - Math.sin(yaw) * back;
  const bz = z - Math.cos(yaw) * back;
  return [
    box([width + 0.02, height + 0.02, depth], [bx, y, bz], BOARD_BACK, [0, yaw, 0]),
    box([WALL_X + 0.02 - bx, 0.04, 0.04], [(bx + WALL_X + 0.02) / 2, y, bz], STEEL_DARK),
  ];
}

/**
 * The breech's fittings on the gun's recoiling part, gun space: the guides
 * the block slides in either side of it, and the lever's axle from inside
 * the breech into the lever's hub.
 */
export function breechFittings(halfWidth: number): Part[] {
  return [
    box([0.02, 0.33, 0.06], [-BLOCK.width / 2 - 0.015, MY - 0.085, MZ + 0.02], STEEL_DARK),
    box([0.02, 0.33, 0.06], [BLOCK.width / 2 + 0.015, MY - 0.085, MZ + 0.02], STEEL_DARK),
    {
      geometry: new CylinderGeometry(0.01, 0.01, LEVER_PIVOT[0] - 0.01 - (halfWidth - 0.02), 6, 1),
      color: STEEL_DARK,
      position: [(LEVER_PIVOT[0] - 0.01 + halfWidth - 0.02) / 2, LEVER_PIVOT[1], LEVER_PIVOT[2]],
      rotation: ALONG_X,
    },
  ];
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

/**
 * A shell, centred on its middle with its nose to -Z: a brass case with a
 * rim and primer at the base, a copper driving band, and an olive projectile
 * with a pointed nose.
 */
export function createShell(i: number): Mesh {
  const h = SHELL_LENGTH / 2;
  const caseFront = h - CASE_LENGTH;
  const geometry = mergeParts([
    tubeZ(SHELL_RADIUS, 0, 0, h - 0.005, caseFront, BRASS, 10),
    tubeZ(SHELL_RADIUS + 0.004, 0, 0, h, h - 0.01, BRASS, 10),
    tubeZ(0.01, 0, 0, h + 0.004, h - 0.004, PRIMER, 6),
    tubeZ(0.04, 0, 0, caseFront + 0.005, -0.215, SHELL_BODY, 10),
    tubeZ(0.045, 0, 0, caseFront - 0.01, caseFront - 0.025, COPPER, 10),
    { geometry: new ConeGeometry(0.04, h - 0.21, 10, 1), color: SHELL_BODY, position: [0, 0, -(h + 0.21) / 2], rotation: ALONG_Z },
  ]);
  const mesh = new Mesh(geometry, material);
  mesh.name = `Shell ${i + 1}`;
  return mesh;
}

/** A spent casing, centred on its middle with its open mouth to -Z: the shell's brass case with its rim and primer, and a dark mouth. */
export function createCasing(i: number): Mesh {
  const h = CASE_LENGTH / 2;
  const geometry = mergeParts([
    tubeZ(SHELL_RADIUS, 0, 0, h - 0.005, -h, BRASS, 10),
    tubeZ(SHELL_RADIUS + 0.004, 0, 0, h, h - 0.01, BRASS, 10),
    tubeZ(0.01, 0, 0, h + 0.004, h - 0.004, PRIMER, 6),
    // The open mouth, dark, standing 4 mm proud of the brass so the two never share a plane.
    tubeZ(SHELL_RADIUS - 0.006, 0, 0, -h + 0.01, -h - 0.004, BIN_DARK, 10),
  ]);
  const mesh = new Mesh(geometry, material);
  mesh.name = `Casing ${i + 1}`;
  return mesh;
}

/** The breech block, centred; the system slides it between BLOCK_OPEN_Y and BLOCK_CLOSED_Y in gun space. */
export function createBreechBlock(): Mesh {
  const mesh = new Mesh(
    mergeParts([
      box([BLOCK.width, BLOCK.height, BLOCK.depth], [0, 0, 0], BLOCK_STEEL),
      // A grip ridge across its back, standing proud.
      box([BLOCK.width - 0.04, 0.02, 0.01], [0, -0.03, BLOCK.depth / 2 + 0.004], STEEL_DARK),
    ]),
    material,
  );
  mesh.name = 'Breech Block';
  return mesh;
}

/**
 * The breech lever, in its pivot's frame: a hub on the axle, an arm up +Y
 * to the handle, and the handle sticking out towards the gunner (+X). The
 * system turns it about X by the lever's angle.
 */
export function createBreechLever(): Mesh {
  const mesh = new Mesh(
    mergeParts([
      { geometry: new CylinderGeometry(0.022, 0.022, 0.03, 8, 1), color: STEEL_DARK, rotation: ALONG_X },
      box([0.016, LEVER_LENGTH, 0.022], [0, LEVER_LENGTH / 2, 0], LEVER_RED),
      {
        geometry: new CylinderGeometry(0.017, 0.017, 2 * LEVER_HANDLE_X + 0.01, 8, 1),
        color: LEVER_RED,
        position: [LEVER_HANDLE_X, LEVER_LENGTH, 0],
        rotation: ALONG_X,
      },
    ]),
    material,
  );
  mesh.name = 'Breech Lever';
  return mesh;
}

/** Glowing parts: unlit, so they read bright in any light, and not fogged, so a tracer shows through the haze as a real one does. */
function glow(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, fog: false });
}

/** The muzzle flash, gun space at the muzzle: a short cone opening forward (-Z) inside a ball. */
export function createMuzzleFlash(): Mesh {
  const mesh = new Mesh(
    mergeParts([
      { geometry: new ConeGeometry(0.35, 1.1, 8, 1), color: 0xfff2b0, position: [0, 0, -0.55], rotation: [Math.PI / 2, 0, 0] },
      { geometry: new IcosahedronGeometry(0.3, 0), color: 0xffb040 },
    ]),
    new MeshBasicMaterial({ vertexColors: true, fog: false }),
  );
  mesh.name = 'Muzzle Flash';
  return mesh;
}

/** A shell's tracer: a bright rod one metre long along -Z from its origin (the system stretches it along the flight). */
export function createTracer(): Mesh {
  const geometry = new CylinderGeometry(0.09, 0.09, 1, 6, 1);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, -0.5);
  const mesh = new Mesh(geometry, glow(0xffa53a));
  mesh.name = 'Tracer';
  return mesh;
}

/** Where a shell lands: a ball of dirt (the system grows and shrinks it), or a bright one on a target. */
export function createBurst(hit: boolean): Mesh {
  const mesh = new Mesh(
    new IcosahedronGeometry(1, 0),
    hit ? glow(0xffd060) : new MeshStandardMaterial({ color: 0x6b5a40, flatShading: true, roughness: 1, metalness: 0 }),
  );
  mesh.name = hit ? 'Hit Burst' : 'Dirt Burst';
  return mesh;
}
