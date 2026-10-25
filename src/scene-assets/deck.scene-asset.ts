import { BoxGeometry, CylinderGeometry, Mesh, MeshLambertMaterial, TorusGeometry } from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import { DECK_LENGTH, DECK_WIDTH, GROUND_Y, HOOP, RAIL_HEIGHT, TABLE } from '../sim/play-area.js';

/**
 * The demo play area: a raised wooden deck with a rail round it, a table of
 * throwable blocks at the far end and a hoop on a post beyond the rail, on a
 * wide grass ground. Replace it with your game's world; keep the pattern:
 * static parts merged into one mesh (one draw call), sizes from
 * src/sim/play-area.ts so systems and tests use the same numbers, and
 * colliders listed beside the geometry that they match.
 *
 * Deck space: deck surface at y = 0, the hoop towards -Z.
 */

const WOOD = 0x9a6b3f;
const WOOD_LIGHT = 0xb5824f;
const WOOD_DARK = 0x6e4a2b;
const GRASS = 0x6f9a4a;
const BRASS = 0xc89b3c;
const BLOCK_COLORS = [0xd9483b, 0x3b7fd9, 0xe8c23a, 0x4bb36a, 0x9b59b6, 0xe67e22] as const;

/** A block's edge, m. */
export const BLOCK_SIZE = 0.1;

export interface BoxCollider {
  name: string;
  center: [number, number, number];
  size: [number, number, number];
}

const half = (v: number) => v / 2;
/** The invisible walls stand taller than the rail, so blocks stay aboard unless thrown well over it. */
const wallHeight = 1.15;
const wallThickness = 0.1;

/** Static colliders in deck space, matching the mesh below. */
export const DECK_COLLIDERS: BoxCollider[] = [
  { name: 'deck', center: [0, -0.05, 0], size: [DECK_WIDTH, 0.1, DECK_LENGTH] },
  { name: 'wall-left', center: [-half(DECK_WIDTH) - half(wallThickness), half(wallHeight), 0], size: [wallThickness, wallHeight, DECK_LENGTH] },
  { name: 'wall-right', center: [half(DECK_WIDTH) + half(wallThickness), half(wallHeight), 0], size: [wallThickness, wallHeight, DECK_LENGTH] },
  { name: 'wall-far', center: [0, half(wallHeight), -half(DECK_LENGTH) - half(wallThickness)], size: [DECK_WIDTH + 2 * wallThickness, wallHeight, wallThickness] },
  { name: 'wall-near', center: [0, half(wallHeight), half(DECK_LENGTH) + half(wallThickness)], size: [DECK_WIDTH + 2 * wallThickness, wallHeight, wallThickness] },
  { name: 'table', center: [TABLE.x, half(TABLE.height), TABLE.z], size: [TABLE.width, TABLE.height, TABLE.depth] },
  { name: 'ground', center: [0, GROUND_Y - 0.5, 0], size: [60, 1, 60] },
];

function box(size: [number, number, number], position: [number, number, number], color: number): Part {
  return { geometry: new BoxGeometry(...size), color, position };
}

function deckParts(): Part[] {
  const parts: Part[] = [];
  const planks = 8;
  const plankWidth = DECK_WIDTH / planks;
  for (let i = 0; i < planks; i++) {
    const x = -DECK_WIDTH / 2 + plankWidth * (i + 0.5);
    parts.push(box([plankWidth - 0.01, 0.06, DECK_LENGTH], [x, -0.03, 0], i % 2 ? WOOD : WOOD_LIGHT));
  }
  // Beams under the planks, down to the ground.
  const beamTop = -0.06;
  for (const z of [-DECK_LENGTH / 2 + 0.1, 0, DECK_LENGTH / 2 - 0.1]) {
    parts.push(box([DECK_WIDTH, beamTop - GROUND_Y, 0.12], [0, (beamTop + GROUND_Y) / 2, z], WOOD_DARK));
  }
  return parts;
}

function railParts(): Part[] {
  const parts: Part[] = [];
  const hw = DECK_WIDTH / 2 - 0.03;
  const hl = DECK_LENGTH / 2 - 0.03;
  for (const x of [-hw, hw]) {
    for (const z of [-hl, -hl / 3, hl / 3, hl]) {
      parts.push(box([0.06, RAIL_HEIGHT, 0.06], [x, RAIL_HEIGHT / 2, z], WOOD_DARK));
    }
  }
  for (const z of [-hl, hl]) {
    parts.push(box([0.06, RAIL_HEIGHT, 0.06], [0, RAIL_HEIGHT / 2, z], WOOD_DARK));
  }
  // Top rails, the end ones 1 cm lower so they never share a face with the side ones.
  for (const side of [-1, 1]) {
    parts.push(box([0.08, 0.06, DECK_LENGTH + 0.04], [side * hw, RAIL_HEIGHT, 0], WOOD_LIGHT));
    parts.push(box([DECK_WIDTH - 0.1, 0.06, 0.08], [0, RAIL_HEIGHT - 0.01, side * hl], WOOD_LIGHT));
  }
  return parts;
}

function tableParts(): Part[] {
  const top = 0.04;
  const parts: Part[] = [box([TABLE.width, top, TABLE.depth], [TABLE.x, TABLE.height - top / 2, TABLE.z], WOOD_LIGHT)];
  const legX = TABLE.width / 2 - 0.05;
  const legZ = TABLE.depth / 2 - 0.05;
  for (const x of [-legX, legX]) {
    for (const z of [-legZ, legZ]) {
      parts.push(box([0.05, TABLE.height - top, 0.05], [TABLE.x + x, (TABLE.height - top) / 2, TABLE.z + z], WOOD_DARK));
    }
  }
  return parts;
}

function hoopParts(): Part[] {
  const tube = 0.025;
  const ring = new TorusGeometry(HOOP.radius + tube, tube, 6, 20);
  const postTop = HOOP.y - HOOP.radius - 2 * tube;
  return [
    { geometry: ring, color: BRASS, position: [HOOP.x, HOOP.y, HOOP.z] },
    beam([HOOP.x, GROUND_Y, HOOP.z], [HOOP.x, postTop + 0.01, HOOP.z], 0.04, WOOD_DARK, 6),
  ];
}

function groundParts(): Part[] {
  const ground = new CylinderGeometry(30, 30, 0.1, 24, 1);
  return [{ geometry: ground, color: GRASS, position: [0, GROUND_Y - 0.05, 0] }];
}

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Everything static in one mesh: deck, rails, table, hoop and ground. */
export function createPlayArea(): Mesh {
  const mesh = new Mesh(mergeParts([...groundParts(), ...deckParts(), ...railParts(), ...tableParts(), ...hoopParts()]), material);
  mesh.name = 'Play Area';
  return mesh;
}

/** Invisible box used for each static collider (sizes from DECK_COLLIDERS). */
export function createColliderBox(size: [number, number, number]): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshLambertMaterial());
  mesh.visible = false;
  return mesh;
}

/** Block `i`: a painted wooden cube with a darker band, so its spin reads when thrown. */
export function createBlock(i: number): Mesh {
  const color = BLOCK_COLORS[i % BLOCK_COLORS.length];
  const geometry = mergeParts([
    { geometry: new BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE), color },
    { geometry: new BoxGeometry(BLOCK_SIZE + 0.008, 0.02, BLOCK_SIZE + 0.008), color: 0x2b2622 },
  ]);
  const mesh = new Mesh(geometry, material);
  mesh.name = `Block ${i + 1}`;
  return mesh;
}
