import { BoxGeometry, ConeGeometry, CylinderGeometry, Mesh, MeshLambertMaterial } from '@iwsdk/core';
import { mergeParts, type Part } from './lowpoly.js';
import {
  BREECH_MOUTH,
  LEVER_HANDLE_X,
  LEVER_LENGTH,
  LEVER_PIVOT,
  LOADER_SEAT,
  RACK_SLOTS,
  SHELL_LENGTH,
  SHELL_RADIUS,
} from '../sim/loading.js';

/**
 * Spike S4's loading station (docs/spikes/s4-loading.md): a gun's breech on a
 * pedestal with its barrel running forward, a ready rack of four shells, a
 * stool for the loader and a post for the drill's board. Low-poly and
 * vertex-coloured; the static parts are one mesh, and the shells, the
 * sliding breech block and the lever move. Sizes come from
 * src/sim/loading.ts, in deck space.
 */

const STEEL = 0x5d6468;
const STEEL_DARK = 0x3a3f42;
const BORE_DARK = 0x141414;
const BLOCK_STEEL = 0x7b8388;
const RACK_WOOD = 0x7a5534;
const SEAT = 0x4a3b2e;
const BRASS = 0xc9a03a;
const SHELL_BODY = 0x4d5a3a;
const COPPER = 0xb0643a;
const PRIMER = 0x3a3024;
const LEVER_RED = 0x8a2c22;

const [MX, MY, MZ] = BREECH_MOUTH;
/** The mouth's square opening, half its side, m. */
const HOLE = 0.06;
/** The breech ring's outside, half its side, m. */
const RING = 0.13;
/** The ring's length along the bore, m. */
const RING_DEPTH = 0.3;

/** The breech block: a plate that slides up across the mouth, behind it (+Z), m. */
export const BLOCK = { width: 0.2, height: 0.14, depth: 0.04, gap: 0.006 } as const;
/** The block's centre height, open (lowered clear of the mouth) and closed (across it), m. */
export const BLOCK_OPEN_Y = MY - 0.16;
export const BLOCK_CLOSED_Y = MY;
/** Its centre across and along the bore. */
export const BLOCK_X = MX;
export const BLOCK_Z = MZ + BLOCK.gap + BLOCK.depth / 2;

/** The drill's board: its middle and size; it faces the loader (+Z), m. */
export const BOARD = { x: -0.15, y: 1.4, z: 0.72, width: 0.36, height: 0.18 } as const;

const ALONG_Z: readonly [number, number, number] = [-Math.PI / 2, 0, 0];
const ALONG_X: readonly [number, number, number] = [0, 0, Math.PI / 2];

function box(size: [number, number, number], position: [number, number, number], color: number): Part {
  return { geometry: new BoxGeometry(...size), color, position };
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

function breechParts(): Part[] {
  const mid = MZ - RING_DEPTH / 2;
  const side = RING - HOLE;
  return [
    // The breech ring: four bars round the square mouth.
    box([2 * RING, side, RING_DEPTH], [MX, MY + (HOLE + RING) / 2, mid], STEEL),
    box([2 * RING, side, RING_DEPTH], [MX, MY - (HOLE + RING) / 2, mid], STEEL),
    box([side, 2 * HOLE, RING_DEPTH], [MX - (HOLE + RING) / 2, MY, mid], STEEL),
    box([side, 2 * HOLE, RING_DEPTH], [MX + (HOLE + RING) / 2, MY, mid], STEEL),
    // The back of the chamber, dark, so the mouth reads as a hole.
    box([2 * HOLE, 2 * HOLE, 0.01], [MX, MY, MZ - RING_DEPTH + 0.015], BORE_DARK),
    // The barrel forward: recoil cylinder, then the tube.
    tubeZ(0.075, MX, MY, MZ - RING_DEPTH + 0.005, MZ - 0.9, STEEL_DARK, 12),
    tubeZ(0.05, MX, MY, MZ - 0.88, MZ - 1.9, STEEL, 10),
    // Pedestal from the deck into the ring's underside.
    box([0.12, MY - RING + 0.01, 0.12], [MX, (MY - RING + 0.01) / 2, mid], STEEL_DARK),
    // Guides the block slides in, either side of it, from inside the ring down past it.
    box([0.02, 0.33, 0.06], [MX - BLOCK.width / 2 - 0.015, MY - 0.085, MZ + 0.02], STEEL_DARK),
    box([0.02, 0.33, 0.06], [MX + BLOCK.width / 2 + 0.015, MY - 0.085, MZ + 0.02], STEEL_DARK),
    // The lever's axle, from inside the ring into the lever's hub (stopping short of its arm).
    {
      geometry: new CylinderGeometry(0.01, 0.01, LEVER_PIVOT[0] - 0.01 - (MX + RING - 0.02), 6, 1),
      color: STEEL_DARK,
      position: [(LEVER_PIVOT[0] - 0.01 + MX + RING - 0.02) / 2, LEVER_PIVOT[1], LEVER_PIVOT[2]],
      rotation: ALONG_X,
    },
  ];
}

function rackParts(): Part[] {
  const parts: Part[] = [];
  const xs = [0.29, 0.54];
  const zs = [0.93, 1.37];
  const top = RACK_SLOTS[2][1] + 0.08;
  for (const x of xs) {
    for (const z of zs) {
      parts.push(box([0.03, top, 0.03], [x, top / 2, z], RACK_WOOD));
    }
  }
  // A cradle bar under each row of shells at each end, ending inside the uprights.
  for (const y of [RACK_SLOTS[0][1], RACK_SLOTS[2][1]]) {
    const barTop = y - SHELL_RADIUS - 0.004;
    for (const z of zs) {
      parts.push(box([xs[1] - xs[0], 0.025, 0.02], [(xs[0] + xs[1]) / 2, barTop - 0.0125, z], RACK_WOOD));
    }
  }
  return parts;
}

function stoolParts(): Part[] {
  const x = LOADER_SEAT.x;
  const z = LOADER_SEAT.z + 0.1;
  const height = 0.62;
  const parts: Part[] = [box([0.36, 0.05, 0.32], [x, height - 0.025, z], SEAT)];
  for (const dx of [-0.15, 0.15]) {
    for (const dz of [-0.13, 0.13]) {
      parts.push(box([0.03, height - 0.04, 0.03], [x + dx, (height - 0.04) / 2, z + dz], STEEL_DARK));
    }
  }
  return parts;
}

function boardPost(): Part[] {
  const bottom = BOARD.y - BOARD.height / 2;
  return [box([0.03, bottom - 0.01, 0.03], [BOARD.x, (bottom - 0.01) / 2, BOARD.z - 0.02], STEEL_DARK)];
}

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Everything that doesn't move: the breech ring, barrel and pedestal, the rack, the stool and the board's post. */
export function createLoadingStation(): Mesh {
  const mesh = new Mesh(mergeParts([...breechParts(), ...rackParts(), ...stoolParts(), ...boardPost()]), material);
  mesh.name = 'Loading Station';
  return mesh;
}

/**
 * A shell, centred on its middle with its nose to -Z: a brass case with a
 * rim and primer at the base, a copper driving band, and an olive projectile
 * with a pointed nose.
 */
export function createShell(i: number): Mesh {
  const h = SHELL_LENGTH / 2;
  const geometry = mergeParts([
    tubeZ(SHELL_RADIUS, 0, 0, h - 0.005, -0.05, BRASS, 10),
    tubeZ(SHELL_RADIUS + 0.004, 0, 0, h, h - 0.01, BRASS, 10),
    tubeZ(0.01, 0, 0, h + 0.004, h - 0.004, PRIMER, 6),
    tubeZ(0.04, 0, 0, -0.045, -0.215, SHELL_BODY, 10),
    tubeZ(0.045, 0, 0, -0.06, -0.075, COPPER, 10),
    { geometry: new ConeGeometry(0.04, h - 0.21, 10, 1), color: SHELL_BODY, position: [0, 0, -(h + 0.21) / 2], rotation: ALONG_Z },
  ]);
  const mesh = new Mesh(geometry, material);
  mesh.name = `Shell ${i + 1}`;
  return mesh;
}

/** The breech block, centred; the system slides it between BLOCK_OPEN_Y and BLOCK_CLOSED_Y. */
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
 * to the handle, and the handle sticking out towards the loader (+X). The
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
