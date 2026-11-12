import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { ENEMY_GUN } from '../sim/enemy-guns.js';
import { beam, mergeParts, type Part, shade } from './lowpoly.js';

/**
 * An enemy anti-tank gun (F3.2, docs/enemy-guns.md): a low 75 mm gun on
 * two wheels behind an angled shield, its trails spread behind, with a few
 * bushes cut for camouflage either side of the shield. Low poly, vertex
 * coloured, one mesh. Its own space: the ground at y = 0 under its axle,
 * the barrel along +Z with the muzzle at MUZZLE. Knocked out (`wrecked`)
 * it is the same gun scorched dark, its shield knocked askew and its barrel
 * drooping.
 */

const GUN_PAINT = 0x56594a;
const TYRE = 0x1e1e1c;
const BUSH = 0x4d5d33;
const BUSH_DARK = 0x3f4c2a;
/** How much darker a wrecked gun is. */
const SCORCH = 0.45;

/** The muzzle, gun space, m: at ENEMY_GUN.muzzleHeight, the barrel's end. */
export const MUZZLE = [0, ENEMY_GUN.muzzleHeight, 2.9] as const;

/** The gun's parts, whole or wrecked. */
export function enemyGunParts(wrecked = false): Part[] {
  const paint = wrecked ? shade(GUN_PAINT, SCORCH) : GUN_PAINT;
  const tyre = wrecked ? shade(TYRE, 0.8) : TYRE;
  const parts: Part[] = [];
  // The shield: a main plate leaning back, and a wing either side turned in, its edge behind the main plate's.
  const tilt = wrecked ? 0.55 : 0.18;
  const lean = wrecked ? 0.2 : 0;
  parts.push({ geometry: new BoxGeometry(2.1, 1.25, 0.05), color: paint, position: [0, 0.85, 0.3], rotation: [-tilt, 0, lean] });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new BoxGeometry(0.55, 1.0, 0.05), color: paint, position: [side * 1.25, 0.8, 0.12], rotation: [-tilt, side * 0.5, lean] });
  }
  // The cradle, and the barrel through the shield with its muzzle brake.
  const droop = wrecked ? -0.18 : 0;
  parts.push({ geometry: new BoxGeometry(0.3, 0.3, 1.3), color: paint, position: [0, 0.88, -0.15], rotation: [droop / 2, 0, 0] });
  const barrel = new CylinderGeometry(0.065, 0.075, 3.4, 8, 1);
  barrel.rotateX(Math.PI / 2);
  parts.push({ geometry: barrel, color: shade(paint, 0.85), position: [0, MUZZLE[1] + Math.sin(droop) * 1.2, 1.2], rotation: [-droop, 0, 0] });
  parts.push({
    geometry: new BoxGeometry(0.22, 0.18, 0.32),
    color: shade(paint, 0.7),
    position: [0, MUZZLE[1] + Math.sin(droop) * 2.8, MUZZLE[2] - 0.12],
    rotation: [-droop, 0, 0],
  });
  // The wheels and their axle.
  for (const side of [-1, 1]) {
    const wheel = new CylinderGeometry(0.42, 0.42, 0.18, 10, 1);
    wheel.rotateZ(Math.PI / 2);
    parts.push({ geometry: wheel, color: tyre, position: [side * 0.88, 0.42, -0.1], rotation: [0.3 * side, 0, 0] });
  }
  parts.push(beam([-0.8, 0.42, -0.1], [0.8, 0.42, -0.1], 0.05, paint, 6));
  // The trails, spread behind and dug in at their spades.
  for (const side of [-1, 1]) {
    parts.push(beam([side * 0.25, 0.5, -0.4], [side * 1.15, 0.06, -3.0], 0.08, paint, 5));
    parts.push({ geometry: new BoxGeometry(0.4, 0.3, 0.06), color: paint, position: [side * 1.17, 0.12, -3.05], rotation: [0.3, side * 0.35, 0] });
  }
  // Camouflage: cut bushes at the shield's ends, clear of the barrel.
  const bushes: readonly [number, number, number, number][] = [
    [-1.55, 0.45, 0.75, 0.62],
    [1.6, 0.4, 0.7, 0.58],
    [-0.95, 0.3, 1.35, 0.42],
    [1.05, 0.28, 1.4, 0.4],
  ];
  bushes.forEach(([x, y, z, r], i) => {
    parts.push({
      geometry: new IcosahedronGeometry(r, 0),
      color: wrecked ? shade(BUSH_DARK, 0.6) : i % 2 ? BUSH_DARK : BUSH,
      position: [x, y, z],
      rotation: [0.4 * i, 0.7 * i, 0.2 * i],
    });
  });
  return parts;
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });

/** Enemy gun `i`, whole or wrecked. */
export function createEnemyGun(i: number, wrecked = false): Mesh {
  const mesh = new Mesh(mergeParts(enemyGunParts(wrecked)), material);
  mesh.name = `Enemy Gun ${i + 1}${wrecked ? ' Wreck' : ''}`;
  return mesh;
}
