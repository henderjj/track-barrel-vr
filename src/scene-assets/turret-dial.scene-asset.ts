import { BoxGeometry, CircleGeometry, CylinderGeometry, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { DIAL_POINTER, dialToHull, TURRET_DIAL } from '../sim/turret-dial.js';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * The driver's turret position dial (F2.3, docs/turret-dial.md): its case
 * on the hood's face, merged into the hull's mesh (cabin.scene-asset.ts),
 * and the face and pointer, which TurretDialSystem places in the case,
 * paints and turns. Sizes from src/sim/turret-dial.ts. Low-poly and
 * vertex-coloured.
 */

const CASE = 0x2b2e2a;
/** The gauges' needles' orange (driver-station.scene-asset.ts), so the pointer reads as one of the driver's instruments. */
const POINTER = 0xf08a24;

/** The case, hull space, for the hull's mesh: a shallow drum sunk into the hood's face round the face. */
export function turretDialParts(): Part[] {
  const d = TURRET_DIAL;
  const caseRadius = d.radius + d.rim;
  const length = d.proud + d.sunk;
  const drum = new CylinderGeometry(caseRadius, caseRadius, length, 24, 1);
  drum.rotateX(Math.PI / 2);
  drum.rotateY(d.yaw);
  const middle = dialToHull([0, 0, -d.faceGap - length / 2], [0, 0, 0]);
  return [{ geometry: drum, color: CASE, position: middle }];
}

/**
 * The dial's face: a disc at the origin facing +Z, the face's radius.
 * TurretDialSystem paints the hull outline and the clock's numbers into
 * its material's map.
 */
export function createTurretDialFace(): Mesh {
  const mesh = new Mesh(new CircleGeometry(TURRET_DIAL.radius, 40), new MeshBasicMaterial({ color: 0xefe6c8, toneMapped: false }));
  mesh.name = 'Turret Dial Face';
  return mesh;
}

const pointerMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/**
 * The pointer: the turret as a disc at the face's middle and its gun as a
 * bar up the face (+Y) with a wider muzzle, all one colour, pointerGap in
 * front of the face (+Z). Turn it with `rotation.z` (pointerAngle).
 */
export function createDialPointer(): Mesh {
  const p = DIAL_POINTER;
  const t = 0.002;
  const z = TURRET_DIAL.pointerGap;
  const length = p.reach * TURRET_DIAL.radius;
  const gunFrom = p.turretRadius * 0.5;
  const disc = new CylinderGeometry(p.turretRadius, p.turretRadius, t, 16, 1);
  disc.rotateX(Math.PI / 2);
  const mesh = new Mesh(mergeParts([
    { geometry: disc, color: POINTER, position: [0, 0, z] },
    { geometry: new BoxGeometry(p.gunWidth, length - gunFrom, t), color: POINTER, position: [0, (length + gunFrom) / 2, z] },
    { geometry: new BoxGeometry(p.muzzleWidth, p.muzzleLength, t), color: POINTER, position: [0, length - p.muzzleLength / 2, z] },
  ]), pointerMaterial);
  mesh.name = 'Turret Dial Pointer';
  return mesh;
}
