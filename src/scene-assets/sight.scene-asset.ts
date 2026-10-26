import { BoxGeometry, CircleGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, TorusGeometry } from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import { LENS_RADIUS, SIGHT_STAND } from '../sim/sight.js';

/**
 * Spike S1's sight (docs/spikes/s1-sight-render.md): a sight hanging from
 * the turret roof at the gunner's eyepiece, looking out at the test range's
 * targets (F1.7, src/sim/range.ts). A stand-in until the turret (F1.8) and
 * the gunsight (F1.9) replace it; numbers from src/sim/sight.ts.
 */

const STEEL = 0x4a5148;
const STEEL_DARK = 0x2f3430;
const RUBBER = 0x1c1c1c;
const GLASS = 0x1a2630;

/** The sight tube's radius and length in front of the eyepiece, m. */
const TUBE_RADIUS = 0.04;
const TUBE_LENGTH = 0.33;
/** The tube's back end is this far in front of the lens, m, so the lens sits inside the eyecup. */
const TUBE_BACK = 0.015;

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

/**
 * The bracket the sight hangs from, in hull space relative to the point
 * under its lens on the hull floor (y = 0): a plate 2 cm under the turret
 * roof and a post down into the top of the tube, behind its band.
 */
export function createSightStand(): Mesh {
  const bottom = SIGHT_STAND.lensHeight + TUBE_RADIUS - 0.01;
  const plate = SIGHT_STAND.roof - 0.02;
  const z = -0.17;
  const mesh = new Mesh(
    mergeParts([
      { geometry: new BoxGeometry(0.16, 0.02, 0.16), color: STEEL_DARK, position: [0, plate + 0.01, z] },
      beam([0, bottom, z], [0, plate + 0.005, z], 0.02, STEEL, 8),
    ]),
    material,
  );
  mesh.name = 'Sight Stand';
  return mesh;
}

/**
 * The sight itself, in sight space (lens at the origin, looking along -Z):
 * the tube with a band round the objective, the mount under it and the
 * rubber eyecup round the lens. It turns about the lens when aimed.
 */
export function createSightBody(): Mesh {
  const tube = new CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, TUBE_LENGTH, 12, 1);
  const band = new CylinderGeometry(TUBE_RADIUS + 0.006, TUBE_RADIUS + 0.006, 0.03, 12, 1);
  const objective = new CircleGeometry(TUBE_RADIUS - 0.004, 12);
  const front = -TUBE_BACK - TUBE_LENGTH;
  const parts: Part[] = [
    { geometry: tube, color: STEEL, position: [0, 0, -TUBE_BACK - TUBE_LENGTH / 2], rotation: [Math.PI / 2, 0, 0] },
    // The band's front face stands 1 cm proud of the tube's end, so the two never share a plane.
    { geometry: band, color: STEEL_DARK, position: [0, 0, front + 0.005], rotation: [Math.PI / 2, 0, 0] },
    // Objective glass, 4 mm in front of the band, facing forward.
    { geometry: objective, color: GLASS, position: [0, 0, front - 0.014], rotation: [0, Math.PI, 0] },
    // The mount under the tube, its top inside the tube.
    { geometry: new BoxGeometry(0.05, 0.04, 0.14), color: STEEL_DARK, position: [0, -TUBE_RADIUS - 0.012, -0.17] },
    // Eyecup: the lens's edge is hidden inside its ring.
    { geometry: new TorusGeometry(LENS_RADIUS + 0.008, 0.009, 6, 16), color: RUBBER, position: [0, 0, 0.004] },
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Sight';
  return mesh;
}

/** The lens's disc, in sight space, facing the eye; the render system gives it the shader that shows the view. */
export function createSightLensGeometry(): CircleGeometry {
  return new CircleGeometry(LENS_RADIUS, 24);
}
