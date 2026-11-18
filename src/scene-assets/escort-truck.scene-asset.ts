import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { TRUCK } from '../sim/escort.js';
import { beam, mergeParts, type Part, shade } from './lowpoly.js';

/**
 * A convoy truck (F5.8, docs/escort.md): a generic wartime 2½-ton six-wheel
 * cargo truck in olive drab, a bonnet and an open-backed cab in front of a
 * cargo bed under a canvas tilt. Low poly, vertex coloured, one mesh. Its
 * own space: the ground at y = 0 under its middle, the front along +Z.
 * Knocked out it is scorched dark, the tilt burnt off its bows.
 */

const PAINT = 0x4f5a36;
const CANVAS = 0x6f6c4c;
const TYRE = 0x1e1e1c;
const GLASS = 0x2a3238;
const GRILLE = 0x262a20;
const LAMP = 0xd8d2b0;
/** How much darker a wrecked truck is. */
const SCORCH = 0.38;

/** The wheels: radius and width, and where each axle is along the truck, m. */
const WHEEL = { radius: 0.5, width: 0.32, x: 0.95, axles: [2.2, -1.05, -2.35] } as const;
/** The cargo bed: half its width, its floor and the top of its sides, its front and back, m. */
const BED = { half: 1.1, floor: 1.0, sides: 1.5, front: 0.5, back: -3.3 } as const;

/** The truck's parts: whole, or knocked out (scorched, the tilt burnt off). */
export function truckParts(wrecked = false): Part[] {
  const paint = wrecked ? shade(PAINT, SCORCH) : PAINT;
  const tyre = wrecked ? shade(TYRE, 0.7) : TYRE;
  const parts: Part[] = [];
  // The chassis rails, and the wheels on three axles.
  parts.push({ geometry: new BoxGeometry(0.9, 0.24, 6.2), color: shade(paint, 0.7), position: [0, 0.78, -0.1] });
  for (const z of WHEEL.axles) {
    for (const side of [-1, 1]) {
      const w = new CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.width, 10, 1);
      w.rotateZ(Math.PI / 2);
      parts.push({ geometry: w, color: tyre, position: [side * WHEEL.x, WHEEL.radius, z] });
    }
  }
  // The bonnet, its grille and bumper, and the front wings over the front wheels with their lamps.
  parts.push({ geometry: new BoxGeometry(1.0, 0.62, 1.3), color: paint, position: [0, 1.24, 2.4] });
  parts.push({ geometry: new BoxGeometry(0.86, 0.5, 0.04), color: GRILLE, position: [0, 1.2, 3.07] });
  parts.push({ geometry: new BoxGeometry(2.1, 0.14, 0.12), color: shade(paint, 0.8), position: [0, 0.8, 3.16] });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new BoxGeometry(0.4, 0.06, 1.15), color: shade(paint, 0.9), position: [side * WHEEL.x, 1.08, 2.3] });
    const lamp = new CylinderGeometry(0.1, 0.1, 0.08, 8, 1);
    lamp.rotateX(Math.PI / 2);
    parts.push({ geometry: lamp, color: wrecked ? shade(LAMP, SCORCH) : LAMP, position: [side * 0.7, 1.3, 3.08] });
  }
  // The cab: its body, the windscreen standing a little proud of its front, and the roof.
  parts.push({ geometry: new BoxGeometry(2.0, 1.1, 1.3), color: paint, position: [0, 1.55, 1.15] });
  parts.push({ geometry: new BoxGeometry(1.7, 0.42, 0.04), color: wrecked ? shade(GLASS, 0.6) : GLASS, position: [0, 1.82, 1.815] });
  parts.push({ geometry: new BoxGeometry(2.04, 0.06, 1.38), color: shade(paint, 0.85), position: [0, 2.13, 1.15] });
  // The cargo bed: its floor and its sides.
  const bedLength = BED.front - BED.back;
  const bedMid = (BED.front + BED.back) / 2;
  parts.push({ geometry: new BoxGeometry(2 * BED.half, BED.sides - BED.floor, bedLength), color: shade(paint, 0.92), position: [0, (BED.floor + BED.sides) / 2, bedMid] });
  if (!wrecked) {
    // The canvas tilt over the bed, up to the truck's height, its roof a little darker.
    const tiltTop = TRUCK.height - 0.06;
    parts.push({ geometry: new BoxGeometry(2 * BED.half + 0.04, tiltTop - BED.sides, bedLength - 0.1), color: CANVAS, position: [0, (BED.sides + tiltTop) / 2, bedMid] });
    parts.push({ geometry: new BoxGeometry(2 * BED.half - 0.3, 0.06, bedLength - 0.2), color: shade(CANVAS, 0.85), position: [0, TRUCK.height - 0.03, bedMid] });
  } else {
    // The tilt burnt off: its bows bare over the bed.
    const bows = shade(PAINT, 0.25);
    for (let k = 0; k < 4; k++) {
      const z = BED.back + 0.3 + (k * (bedLength - 0.6)) / 3;
      parts.push(beam([-BED.half + 0.05, BED.sides, z], [-BED.half + 0.05, TRUCK.height - 0.1, z], 0.03, bows, 4));
      parts.push(beam([BED.half - 0.05, BED.sides, z], [BED.half - 0.05, TRUCK.height - 0.1, z], 0.03, bows, 4));
      parts.push(beam([-BED.half + 0.05, TRUCK.height - 0.1, z], [BED.half - 0.05, TRUCK.height - 0.1, z], 0.03, bows, 4));
    }
  }
  return parts;
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });

/** Convoy truck `k`, whole. */
export function createTruck(k: number): Mesh {
  const mesh = new Mesh(mergeParts(truckParts()), material);
  mesh.name = `Convoy Truck ${k + 1}`;
  return mesh;
}

/** Convoy truck `k` knocked out. */
export function createTruckWreck(k: number): Mesh {
  const mesh = new Mesh(mergeParts(truckParts(true)), material);
  mesh.name = `Convoy Truck ${k + 1} Wreck`;
  return mesh;
}
