import { BoxGeometry, CircleGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, RingGeometry, TorusGeometry } from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import { GROUND_Y } from '../sim/cabin.js';
import { LENS_RADIUS, SIGHT_STAND, SIGHT_TARGETS, TARGET_BOARD, targetFoot } from '../sim/sight.js';

/**
 * Spike S1's sight and range (docs/spikes/s1-sight-render.md): a sight
 * hanging from the turret roof at the gunner's eyepiece, and three target
 * boards out at 100, 250 and 500 m on a grass plain beyond the tank's
 * ground. Stand-ins until
 * the turret (F1.8), the gunsight (F1.9) and the test range (F1.7) replace
 * them; numbers from src/sim/sight.ts.
 */

const STEEL = 0x4a5148;
const STEEL_DARK = 0x2f3430;
const RUBBER = 0x1c1c1c;
const GLASS = 0x1a2630;
const WOOD_DARK = 0x6e4a2b;
const GRASS = 0x6f9a4a;
const CANVAS = 0xd8d0b8;
const SILHOUETTE = 0x2a2a2a;
const MARKER = 0xe07020;

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

/**
 * The spike's range, in hull space: a grass plain from just inside the
 * tank's 300 m ground out to 800 m (the same colour, 2 cm lower, so the
 * overlap never flickers), and a target board at each range in
 * SIGHT_TARGETS facing the sight: a canvas face on two posts with a dark
 * tank silhouette standing proud of it, and an orange marker per hundred
 * metres in its range's first digit (one, two, five) on top, so each can be
 * told apart through the sight.
 */
export function createSightRange(): Mesh {
  const parts: Part[] = [
    {
      geometry: new RingGeometry(299, 800, 32, 1),
      color: GRASS,
      position: [0, GROUND_Y - 0.02, 0],
      rotation: [-Math.PI / 2, 0, 0],
    },
  ];
  SIGHT_TARGETS.forEach((target, i) => parts.push(...targetParts(i, Math.round(target.range / 100))));
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Sight Range';
  return mesh;
}

function targetParts(i: number, markers: number): Part[] {
  const [x, z] = targetFoot(i);
  // Face the sight.
  const yaw = Math.atan2(SIGHT_STAND.x - x, SIGHT_STAND.z - z);
  const { width, height, lift } = TARGET_BOARD;
  const local: Part[] = [];
  const bottom = GROUND_Y + lift;
  const middle = bottom + height / 2;
  local.push({ geometry: new BoxGeometry(width, height, 0.1), color: CANVAS, position: [0, middle, 0] });
  for (const side of [-1, 1]) {
    local.push(beam([side * width * 0.35, GROUND_Y - 0.05, -0.1], [side * width * 0.35, bottom + height * 0.8, -0.1], 0.06, WOOD_DARK, 6));
  }
  // The silhouette: hull, turret and gun, each 2 cm or more proud of the face and of each other.
  local.push({ geometry: new BoxGeometry(width * 0.8, height * 0.36, 0.14), color: SILHOUETTE, position: [0, bottom + height * 0.3, 0] });
  local.push({ geometry: new BoxGeometry(width * 0.36, height * 0.24, 0.14), color: SILHOUETTE, position: [-width * 0.05, bottom + height * 0.58, 0] });
  local.push({ geometry: new BoxGeometry(width * 0.38, 0.12, 0.16), color: SILHOUETTE, position: [width * 0.28, bottom + height * 0.6, 0] });
  for (let m = 0; m < markers; m++) {
    const mx = (m - (markers - 1) / 2) * 0.5;
    local.push({ geometry: new BoxGeometry(0.3, 0.3, 0.12), color: MARKER, position: [mx, bottom + height + 0.15, 0] });
  }
  // Into hull space: turn about the foot, then move there.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return local.map((part) => {
    const [px, py, pz] = part.position ?? [0, 0, 0];
    part.geometry.rotateY(yaw);
    return { geometry: part.geometry, color: part.color, position: [x + px * c + pz * s, py, z - px * s + pz * c] as const };
  });
}
