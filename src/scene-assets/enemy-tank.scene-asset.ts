import { BoxGeometry, CylinderGeometry, Matrix4, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { ENEMY_TANK } from '../sim/enemy-tanks.js';
import { beam, mergeParts, type Part, shade } from './lowpoly.js';

/**
 * An enemy tank (F3.3, docs/enemy-tanks.md): a generic late-war medium
 * tank, a boxy hull over its tracks with a sloped glacis, a box turret with
 * a cupola and a long gun, in dark yellow. Low poly, vertex coloured. Its
 * own space: the ground at y = 0 under its middle, the front along +Z. The
 * hull and the turret are two meshes so the turret can traverse: the
 * turret's own space has its ring's middle at the origin, set on the hull
 * at TURRET_RING. Knocked out it is one mesh: scorched dark, the turret
 * knocked round on its ring and its gun drooping.
 */

const PAINT = 0x8a7f55;
const TRACK = 0x2a2826;
const WHEEL = 0x4a4535;
/** How much darker a wrecked tank is. */
const SCORCH = 0.4;

/** The turret ring's middle on the hull, hull space, m. */
export const TURRET_RING = [0, 1.65, -0.3] as const;
/** The muzzle in the turret's own space, m: ENEMY_TANK.muzzleAhead ahead of the ring's middle, at ENEMY_TANK.muzzleHeight above the ground. */
export const TANK_MUZZLE = [0, ENEMY_TANK.muzzleHeight - TURRET_RING[1], ENEMY_TANK.muzzleAhead] as const;

/** The hull's parts. */
export function enemyTankHullParts(wrecked = false): Part[] {
  const paint = wrecked ? shade(PAINT, SCORCH) : PAINT;
  const track = wrecked ? shade(TRACK, 0.8) : TRACK;
  const wheel = wrecked ? shade(WHEEL, SCORCH) : WHEEL;
  const parts: Part[] = [];
  // The tracks either side, and the road wheels on their outsides.
  for (const side of [-1, 1]) {
    parts.push({ geometry: new BoxGeometry(0.5, 0.95, 5.9), color: track, position: [side * 1.2, 0.48, 0] });
    for (let k = 0; k < 4; k++) {
      const w = new CylinderGeometry(0.34, 0.34, 0.1, 8, 1);
      w.rotateZ(Math.PI / 2);
      parts.push({ geometry: w, color: wheel, position: [side * 1.48, 0.38, -1.95 + k * 1.3] });
    }
  }
  // The lower hull between the tracks, the superstructure over them, and the sloped glacis.
  parts.push({ geometry: new BoxGeometry(1.86, 0.7, 5.5), color: shade(paint, 0.9), position: [0, 0.8, 0] });
  parts.push({ geometry: new BoxGeometry(2.9, 0.6, 4.6), color: paint, position: [0, 1.35, -0.4] });
  parts.push({ geometry: new BoxGeometry(2.86, 0.06, 1.15), color: paint, position: [0, 1.25, 2.2], rotation: [0.45, 0, 0] });
  // The driver's visor and the hull gun's ball on the superstructure's front.
  parts.push({ geometry: new BoxGeometry(0.5, 0.14, 0.06), color: shade(paint, 0.55), position: [0.6, 1.47, 1.88] });
  parts.push({ geometry: new BoxGeometry(0.2, 0.2, 0.08), color: shade(paint, 0.7), position: [-0.6, 1.4, 1.89] });
  // The engine deck's grilles at the back.
  parts.push({ geometry: new BoxGeometry(1.6, 0.04, 1.0), color: shade(paint, 0.6), position: [0, 1.67, -2.1] });
  return parts;
}

/** The turret's parts, in its own space (the ring's middle at the origin), its gun drooping by `droop` rad. */
export function enemyTankTurretParts(wrecked = false, droop = 0): Part[] {
  const paint = wrecked ? shade(PAINT, SCORCH) : PAINT;
  const parts: Part[] = [];
  // The turret and its cupola, a little to the left at the back.
  parts.push({ geometry: new BoxGeometry(1.8, 0.74, 2.4), color: paint, position: [0, 0.33, 0] });
  const cupola = new CylinderGeometry(0.3, 0.32, 0.25, 8, 1);
  parts.push({ geometry: cupola, color: shade(paint, 0.85), position: [-0.4, 0.82, -0.6] });
  // The mantlet and the long gun with its muzzle brake.
  const y = TANK_MUZZLE[1];
  parts.push({ geometry: new BoxGeometry(0.7, 0.5, 0.3), color: shade(paint, 0.85), position: [0, y, 1.33] });
  const end = TANK_MUZZLE[2];
  const from = 1.45;
  parts.push(beam([0, y, from], [0, y - Math.sin(droop) * (end - from), from + Math.cos(droop) * (end - from)], 0.07, shade(paint, 0.8), 8));
  parts.push({
    geometry: new BoxGeometry(0.2, 0.2, 0.3),
    color: shade(paint, 0.6),
    position: [0, y - Math.sin(droop) * (end - from - 0.12), from + Math.cos(droop) * (end - from - 0.12)],
    rotation: [droop, 0, 0],
  });
  return parts;
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });

/** Enemy tank `j`'s hull, its turret a child set on TURRET_RING (the system turns it). */
export function createEnemyTank(j: number): { hull: Mesh; turret: Mesh } {
  const hull = new Mesh(mergeParts(enemyTankHullParts()), material);
  hull.name = `Enemy Tank ${j + 1}`;
  const turret = new Mesh(mergeParts(enemyTankTurretParts()), material);
  turret.name = `Enemy Tank ${j + 1} Turret`;
  turret.position.set(TURRET_RING[0], TURRET_RING[1], TURRET_RING[2]);
  return { hull, turret };
}

/** Enemy tank `j` knocked out: one mesh, scorched, its turret knocked round and askew on its ring, its gun drooping. */
export function createEnemyTankWreck(j: number): Mesh {
  const turret = mergeParts(enemyTankTurretParts(true, 0.2));
  const m = new Matrix4().makeRotationY(0.7);
  m.premultiply(new Matrix4().makeRotationZ(0.08));
  m.premultiply(new Matrix4().makeTranslation(TURRET_RING[0] + 0.15, TURRET_RING[1] + 0.08, TURRET_RING[2]));
  turret.applyMatrix4(m);
  const mesh = new Mesh(mergeParts([...enemyTankHullParts(true), { geometry: turret, color: 'own' }]), material);
  mesh.name = `Enemy Tank ${j + 1} Wreck`;
  return mesh;
}
