import { BoxGeometry, CircleGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, TorusGeometry } from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import { TURRET } from '../sim/cabin.js';
import { EYEPIECE, HOOD, KNUCKLE, MANTLET_FACE, OBJECTIVE } from '../sim/gunsight.js';
import { LENS_RADIUS } from '../sim/sight.js';

/**
 * The gunsight (F1.9, docs/gunsight.md), an articulated sight in two
 * halves: the eyepiece, fixed in the turret with its arm forward to a
 * knuckle on the trunnions' line, and the objective's hood on the gun's
 * mantlet, which elevates with the gun. Numbers from src/sim/gunsight.ts;
 * the lens's shader is the sight system's (spike S1).
 */

const STEEL = 0x4a5148;
const STEEL_DARK = 0x2f3430;
const RUBBER = 0x1c1c1c;
const GLASS = 0x1a2630;

/** The arm's radius, m. */
const ARM_RADIUS = 0.04;
/** The arm's back end is this far in front of the lens, m, so the lens sits inside the eyecup. */
const ARM_BACK = 0.015;
/** The knuckle: a drum across the trunnions' line, its radius and width, m. */
const KNUCKLE_RADIUS = 0.05;
const KNUCKLE_WIDTH = 0.1;
/** The riser from the knuckle up to the arm: its width and depth, m, and how far behind the knuckle's middle it stands. */
const RISER = { width: 0.07, depth: 0.06, back: 0.01 } as const;
/** The roof bracket's post, this far in front of the lens, m (ahead of the gunner's forehead and outside the hatch). */
const BRACKET_Z = -0.25;

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

/**
 * The eyepiece half, in sight space (the lens's middle at the origin,
 * facing +Z at the gunner; place it at EYEPIECE in turret space): the
 * rubber eyecup round the lens, the arm forward to a riser that drops to
 * the knuckle by the turret's front plate, and a bracket up to the roof.
 */
export function createSightEyepiece(): Mesh {
  const knuckle: [number, number, number] = [KNUCKLE[0] - EYEPIECE[0], KNUCKLE[1] - EYEPIECE[1], KNUCKLE[2] - EYEPIECE[2]];
  const riserZ = knuckle[2] + RISER.back;
  const armLength = -riserZ - ARM_BACK;
  const riserTop = ARM_RADIUS * 0.75;
  const riserBottom = knuckle[1] - KNUCKLE_RADIUS * 0.4;
  const drum = new CylinderGeometry(KNUCKLE_RADIUS, KNUCKLE_RADIUS, KNUCKLE_WIDTH, 12, 1);
  drum.rotateZ(Math.PI / 2);
  const roof = TURRET.roof - EYEPIECE[1];
  const parts: Part[] = [
    // The arm, ending in the middle of the riser.
    { geometry: new CylinderGeometry(ARM_RADIUS, ARM_RADIUS, armLength, 12, 1), color: STEEL, position: [0, 0, -ARM_BACK - armLength / 2], rotation: [Math.PI / 2, 0, 0] },
    // A band round the arm behind the eyecup, so it reads as an eyepiece.
    { geometry: new CylinderGeometry(ARM_RADIUS + 0.006, ARM_RADIUS + 0.006, 0.05, 12, 1), color: STEEL_DARK, position: [0, 0, -ARM_BACK - 0.04], rotation: [Math.PI / 2, 0, 0] },
    // The riser, from inside the drum to inside the arm.
    { geometry: new BoxGeometry(RISER.width, riserTop - riserBottom, RISER.depth), color: STEEL_DARK, position: [0, (riserTop + riserBottom) / 2, riserZ] },
    // The knuckle's drum, coaxial with the trunnions; its front is inside the front plate.
    { geometry: drum, color: STEEL, position: knuckle },
    // Bracket: a plate under the roof and a post down into the top of the arm.
    { geometry: new BoxGeometry(0.14, 0.02, 0.14), color: STEEL_DARK, position: [0, roof - 0.01, BRACKET_Z] },
    beam([0, ARM_RADIUS - 0.01, BRACKET_Z], [0, roof - 0.015, BRACKET_Z], 0.02, STEEL, 8),
    // Eyecup: the lens's edge is hidden inside its ring.
    { geometry: new TorusGeometry(LENS_RADIUS + 0.008, 0.009, 6, 16), color: RUBBER, position: [0, 0, 0.004] },
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Sight Eyepiece';
  return mesh;
}

/**
 * The objective half, in gun space (the trunnions at the origin; make it a
 * child of the gun so it elevates with it): a hood on the mantlet's face
 * beside the bore, its back inside the mantlet, and the objective's glass
 * standing proud of it, where the sight camera looks out.
 */
export function createSightHead(): Mesh {
  const back = MANTLET_FACE + HOOD.inset;
  const front = back - HOOD.depth;
  const glass = new CircleGeometry(0.035, 12);
  // Facing forward (-Z).
  glass.rotateY(Math.PI);
  const parts: Part[] = [
    { geometry: new BoxGeometry(HOOD.width, HOOD.height, HOOD.depth), color: STEEL_DARK, position: [OBJECTIVE[0], OBJECTIVE[1], (back + front) / 2] },
    { geometry: glass, color: GLASS, position: [OBJECTIVE[0], OBJECTIVE[1], OBJECTIVE[2]] },
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Sight Head';
  return mesh;
}

/** The lens's disc, in sight space, facing the eye; the render system gives it the shader that shows the view. */
export function createSightLensGeometry(): CircleGeometry {
  return new CircleGeometry(LENS_RADIUS, 24);
}
