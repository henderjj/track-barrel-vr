import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { BOARD_BORDER, BOARD_THICK, type BoardPlace, CLIP, PAPER_GAP } from '../sim/crew-board.js';
import { litInside } from './cabin-light.js';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * The crew board (F6.5, docs/crew-board.md): an olive-drab clipboard with
 * the orders paper on it and a steel clip over the paper's top, standing on
 * two brackets off what it is fixed to. Low-poly and vertex-coloured; the
 * paper is a plane whose canvas CrewBoardSystem draws. Its own mesh, not
 * merged into the cabin.
 */

const BOARD = 0x4d5434;
const CLIP_STEEL = 0x8a8c84;
const BRACKET = 0x3a3d33;

const boardMaterial = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));

/**
 * The board's parts in its own space: the paper's middle at the origin,
 * looking along +Z; the board behind the paper, the clip in front of its
 * top edge, two brackets from the board's back to what it hangs on.
 */
export function crewBoardParts(place: BoardPlace): Part[] {
  const w = place.width + 2 * BOARD_BORDER;
  const h = place.height + 2 * BOARD_BORDER;
  // The board's front face is PAPER_GAP behind the paper; the clip at the top stands out over both.
  const parts: Part[] = [{ geometry: new BoxGeometry(w, h, BOARD_THICK), color: BOARD, position: [0, 0, -PAPER_GAP - BOARD_THICK / 2] }];
  // The clip: a steel bar across the top border, standing proud of the paper, its lower edge just over the paper's top.
  const clipY = place.height / 2 + BOARD_BORDER / 2;
  parts.push({ geometry: new BoxGeometry(CLIP.width, CLIP.height, CLIP.proud + PAPER_GAP), color: CLIP_STEEL, position: [0, clipY, (CLIP.proud - PAPER_GAP) / 2] });
  // Its hinge roll, a little proud of the bar.
  const roll = new CylinderGeometry(0.006, 0.006, CLIP.width * 0.7, 8, 1);
  roll.rotateZ(Math.PI / 2);
  parts.push({ geometry: roll, color: CLIP_STEEL, position: [0, clipY + CLIP.height / 2 - 0.002, CLIP.proud + 0.003] });
  // Two brackets behind the board, so it stands off what it is fixed to.
  for (const sx of [-1, 1]) {
    parts.push({ geometry: new BoxGeometry(0.02, 0.04, 0.03), color: BRACKET, position: [sx * w * 0.3, 0, -PAPER_GAP - BOARD_THICK - 0.015] });
  }
  return parts;
}

/**
 * A crew board at `place`, in its seat's frame: the board (this mesh) with
 * the paper as its child, named 'Crew Board Paper'. The paper's material is
 * `paper` (CrewBoardSystem gives it the board's canvas).
 */
export function createCrewBoard(place: BoardPlace, paper: MeshBasicMaterial = new MeshBasicMaterial({ color: 0xefe6cc })): Mesh {
  const board = new Mesh(mergeParts(crewBoardParts(place)), boardMaterial);
  board.name = 'Crew Board';
  board.position.set(place.x, place.y, place.z);
  board.rotation.set(-place.tilt, place.yaw, 0, 'YXZ');
  const sheet = new Mesh(new PlaneGeometry(place.width, place.height), paper);
  sheet.name = 'Crew Board Paper';
  board.add(sheet);
  return board;
}
