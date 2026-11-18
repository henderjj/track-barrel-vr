import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { COLUMN_TRUCK } from '../sim/column.js';
import { beam, mergeParts, type Part, shade } from './lowpoly.js';

/**
 * An enemy lorry (F5.10, docs/recon-ambush.md): a generic 3-tonne army
 * lorry for the ambush's column, a bonnet and cab over a ladder frame and a
 * load bed under a canvas tilt, on three axles, in the enemy tanks' dark
 * yellow with a grey-green canvas. Low poly, vertex coloured, one mesh. Its
 * own space: the ground at y = 0 under its middle, the front along +Z;
 * COLUMN_TRUCK.length long, .width wide and .height to the tilt's top.
 * Knocked out it is scorched dark, the canvas burnt off its hoops.
 */

const PAINT = 0x8a7f55;
const CANVAS = 0x6d6c55;
const TYRE = 0x262422;
const GLASS = 0x2c3238;
/** How much darker a wrecked lorry is. */
const SCORCH = 0.4;

/** The lorry's parts. */
export function enemyTruckParts(wrecked = false): Part[] {
  const paint = wrecked ? shade(PAINT, SCORCH) : PAINT;
  const tyre = wrecked ? shade(TYRE, 0.8) : TYRE;
  const parts: Part[] = [];
  // The wheels: one axle under the bonnet, two under the bed.
  for (const z of [2.0, -1.0, -2.1]) {
    for (const side of [-1, 1]) {
      const w = new CylinderGeometry(0.48, 0.48, 0.32, 10, 1);
      w.rotateZ(Math.PI / 2);
      parts.push({ geometry: w, color: tyre, position: [side * 0.92, 0.48, z] });
    }
  }
  // The ladder frame the rest stands on.
  parts.push({ geometry: new BoxGeometry(1.1, 0.26, 5.7), color: shade(paint, 0.6), position: [0, 0.78, -0.1] });
  // The bonnet and its radiator grille, and the mudguards over the front wheels.
  parts.push({ geometry: new BoxGeometry(1.2, 0.72, 1.3), color: paint, position: [0, 1.24, 2.35] });
  parts.push({ geometry: new BoxGeometry(0.9, 0.5, 0.06), color: shade(paint, 0.55), position: [0, 1.2, 3.02] });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new BoxGeometry(0.42, 0.08, 1.15), color: shade(paint, 0.85), position: [side * 0.92, 1.05, 2.0] });
  }
  // The cab, its windscreen standing proud of its front.
  parts.push({ geometry: new BoxGeometry(2.05, 1.25, 1.4), color: paint, position: [0, 1.48, 1.05] });
  parts.push({ geometry: new BoxGeometry(1.7, 0.46, 0.06), color: wrecked ? shade(GLASS, 0.5) : GLASS, position: [0, 1.84, 1.77] });
  // The load bed.
  parts.push({ geometry: new BoxGeometry(COLUMN_TRUCK.width, 0.5, 3.7), color: shade(paint, 0.9), position: [0, 1.15, -1.3] });
  const tiltTop = COLUMN_TRUCK.height;
  if (!wrecked) {
    // The canvas tilt over the bed.
    parts.push({ geometry: new BoxGeometry(2.2, tiltTop - 1.38, 3.5), color: CANVAS, position: [0, (tiltTop + 1.38) / 2, -1.3] });
  } else {
    // Burnt off: three charred hoops over the bed.
    const hoop = shade(PAINT, 0.25);
    for (const z of [-2.8, -1.3, 0.2]) {
      parts.push(beam([-1.05, 1.3, z], [-1.05, tiltTop - 0.05, z], 0.04, hoop, 4));
      parts.push(beam([1.05, 1.3, z], [1.05, tiltTop - 0.05, z], 0.04, hoop, 4));
      parts.push(beam([-1.08, tiltTop - 0.08, z], [1.08, tiltTop - 0.08, z], 0.04, hoop, 4));
    }
  }
  return parts;
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });

/** Column lorry `k`, whole or knocked out. */
export function createEnemyTruck(k: number, wrecked = false): Mesh {
  const mesh = new Mesh(mergeParts(enemyTruckParts(wrecked)), material);
  mesh.name = `Enemy Lorry ${k + 1}${wrecked ? ' Wreck' : ''}`;
  return mesh;
}
