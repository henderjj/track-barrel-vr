import { CylinderGeometry, Mesh, type MeshBasicMaterial } from '@iwsdk/core';
import { FIRING_LAMP, LAMP_REPEATER, type LampPlace } from '../sim/firing-lamp.js';
import type { Part } from './lowpoly.js';

/**
 * The firing lamp and its repeater (F2.5, docs/firing-lamp.md): each a dark
 * bezel ring set into a face, merged into the hull's or the turret's mesh
 * (cabin.scene-asset.ts), and a lens in it that FiringLampSystem lights.
 * Sizes from src/sim/firing-lamp.ts. Low-poly and vertex-coloured.
 */

const BEZEL = 0x1e201c;

/** A lamp's bezel, in the frame of the face it is set in: a short drum facing +Z, sunk into the face. */
function bezelParts(p: LampPlace): Part[] {
  const length = p.proud + p.sunk;
  const drum = new CylinderGeometry(p.bezel, p.bezel, length, 16, 1);
  drum.rotateX(Math.PI / 2);
  return [{ geometry: drum, color: BEZEL, position: [p.x, p.y, p.z + p.proud - length / 2] }];
}

/** The driver's firing lamp's bezel on the hood's face beside the turret dial, hull space, for the hull's mesh. */
export function firingLampParts(): Part[] {
  return bezelParts(FIRING_LAMP);
}

/** The gunner's repeater's bezel on the turret's front wall, turret space, for the turret's mesh. */
export function lampRepeaterParts(): Part[] {
  return bezelParts(LAMP_REPEATER);
}

/**
 * A lamp's lens, in its face's frame (place it at the origin of that
 * frame): a drum from inside the bezel out to `lensProud` in front of it.
 * Lit by its material, which FiringLampSystem shares between both lenses.
 */
export function createLampLens(p: LampPlace, material: MeshBasicMaterial, name: string): Mesh {
  const back = p.z + p.proud - 0.002;
  const front = p.z + p.proud + p.lensProud;
  const geometry = new CylinderGeometry(p.lens, p.lens, front - back, 16, 1);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(p.x, p.y, (front + back) / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}
