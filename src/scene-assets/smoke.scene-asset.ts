import { DoubleSide, IcosahedronGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * A smoke round's screen (F3.1, docs/ammunition.md): a bank of puffs, low
 * poly and opaque (the skill's rule: no sprites, opaque clouds), in a unit
 * ball round its own middle that SmokeSystem scales to the cloud's radius
 * and height (src/sim/ammo.ts SMOKE) and moves downwind. Its faces show
 * from inside too, so a crew in it sees grey, as in real smoke.
 */

/** The puffs: middle (unit space), radius and shade. Overlapping, never sharing a face. */
const PUFFS: readonly { at: readonly [number, number, number]; r: number; color: number }[] = [
  { at: [0, 0.05, 0], r: 0.72, color: 0xdcdcd6 },
  { at: [0.5, -0.1, 0.12], r: 0.5, color: 0xd2d2cc },
  { at: [-0.48, -0.05, -0.15], r: 0.52, color: 0xe2e2dc },
  { at: [0.12, -0.12, 0.52], r: 0.46, color: 0xcfcfc8 },
  { at: [-0.1, -0.08, -0.55], r: 0.48, color: 0xd8d8d2 },
  { at: [0.36, 0.3, -0.3], r: 0.42, color: 0xe6e6e0 },
  { at: [-0.3, 0.32, 0.3], r: 0.4, color: 0xd4d4ce },
];

/** The cloud's parts, for the mesh and the z-fighting test. */
export function smokeParts(): Part[] {
  return PUFFS.map((p, i) => ({
    geometry: new IcosahedronGeometry(p.r, 1),
    color: p.color,
    position: p.at,
    // Each puff turned its own way, so no two have faces in one plane.
    rotation: [0.37 * i, 0.61 * i, 0.23 * i],
  }));
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, side: DoubleSide });

/** One smoke cloud, its middle at the origin, a unit ball across. */
export function createSmokeCloud(i: number): Mesh {
  const mesh = new Mesh(mergeParts(smokeParts()), material);
  mesh.name = `Smoke ${i + 1}`;
  return mesh;
}
