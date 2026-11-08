import {
  type BufferGeometry,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { PosedHand } from './hand.scene-asset.js';
import { beam, mergeParts, type Part, shade } from './lowpoly.js';
import { litInside } from './cabin-light.js';
import { type SeatedBody, TORSO_LENGTH } from '../sim/seated-body.js';

/**
 * Stylised crew avatar: an aviator in a leather flying cap and goggles, a
 * long coat in the crew colour, a scarf, gloves and boots. Real-world
 * proportions for a 1.75 m adult, kept low-poly and flat-shaded: about 900
 * triangles in all.
 *
 * The networked avatar (spike S4) is split into parts that move separately,
 * each one draw call: the head follows the remote headset; the legs sit in
 * the crewmate's seat (src/sim/cabin.ts), hips on the cushion, thighs along
 * it and shins down to the floor; the torso, in a waist-length jacket,
 * pivots at the hips and leans towards the head, and a neck joins the two
 * (F1.1b: `poseCrewBody`, with the sums in src/sim/seated-body.ts); each
 * glove follows a controller's grip pose.
 */

export const CREW_COLORS = [0x2f6db3, 0xc0563a, 0x3f8f5a, 0x8a4fb0, 0xd19a2a, 0x2a9a9a, 0x9a3a5a, 0x5a5a5a];
/** Names for the coat colours, for the crew panel. */
export const CREW_COLOR_NAMES = ['Blue', 'Brick', 'Green', 'Plum', 'Mustard', 'Teal', 'Wine', 'Slate'];
const SKIN = 0xe0b48f;
const LEATHER = 0x6a4a30;
const GLASS = 0x9fd3e8;
const BRASS = 0xc9a03a;
const SCARF = 0xe8dcc0;
const TROUSERS = 0x4a3f36;
const BOOTS = 0x2e2119;

/** Head parts, with the origin at the eye centre and the face towards -Z. */
function headParts(): Part[] {
  return [
    // Skull, a little narrower than it is deep, and a smaller jaw below it.
    { geometry: new IcosahedronGeometry(0.1, 1), color: SKIN, position: [0, 0.03, 0.065], scale: [0.85, 1, 0.95] },
    { geometry: new IcosahedronGeometry(0.07, 1), color: SKIN, position: [0, -0.055, 0.035], scale: [0.95, 0.8, 1] },
    { geometry: new ConeGeometry(0.014, 0.03, 4), color: shade(SKIN, 0.92), position: [0, -0.028, -0.034], rotation: [-Math.PI / 2 - 0.35, 0, 0] },
    // Leather flying cap with ear flaps.
    { geometry: new IcosahedronGeometry(0.108, 1), color: LEATHER, position: [0, 0.06, 0.07], scale: [0.88, 0.72, 0.98] },
    { geometry: new BoxGeometry(0.025, 0.08, 0.06), color: LEATHER, position: [-0.083, -0.015, 0.07] },
    { geometry: new BoxGeometry(0.025, 0.08, 0.06), color: LEATHER, position: [0.083, -0.015, 0.07] },
    // Goggles over the eyes.
    { geometry: new TorusGeometry(0.03, 0.01, 4, 8), color: BRASS, position: [-0.038, 0.005, -0.035] },
    { geometry: new TorusGeometry(0.03, 0.01, 4, 8), color: BRASS, position: [0.038, 0.005, -0.035] },
    { geometry: new CylinderGeometry(0.026, 0.026, 0.01, 8), color: GLASS, position: [-0.038, 0.005, -0.035], rotation: [Math.PI / 2, 0, 0] },
    { geometry: new CylinderGeometry(0.026, 0.026, 0.01, 8), color: GLASS, position: [0.038, 0.005, -0.035], rotation: [Math.PI / 2, 0, 0] },
  ];
}

/**
 * Jacket and scarf, with the origin at the hip point and the spine up +Y to
 * the neck's base `TORSO_LENGTH` above it; the front faces -Z. Drawn
 * stretched a little along Y as the crewmate leans (`poseCrewBody`).
 */
function torsoParts(coat: number): Part[] {
  const top = TORSO_LENGTH;
  return [
    // A waist-length jacket: the waist from just above the hips, the belt, the chest out to the shoulders.
    { geometry: new CylinderGeometry(0.155, 0.16, 0.26, 8), color: shade(coat, 0.85), position: [0, 0.15, 0], scale: [1, 1, 0.68] },
    { geometry: new CylinderGeometry(0.163, 0.163, 0.04, 8), color: LEATHER, position: [0, 0.12, 0], scale: [1, 1, 0.7] },
    { geometry: new BoxGeometry(0.05, 0.03, 0.012), color: BRASS, position: [0, 0.12, -0.115] },
    { geometry: new CylinderGeometry(0.19, 0.155, 0.34, 8), color: coat, position: [0, top - 0.21, 0], scale: [1, 1, 0.62] },
    { geometry: new IcosahedronGeometry(0.075, 0), color: coat, position: [-0.165, top - 0.07, 0], scale: [1, 0.75, 1] },
    { geometry: new IcosahedronGeometry(0.075, 0), color: coat, position: [0.165, top - 0.07, 0], scale: [1, 0.75, 1] },
    // Scarf round the neck with one end hanging down the chest.
    { geometry: new CylinderGeometry(0.07, 0.115, 0.08, 8), color: SCARF, position: [0, top - 0.01, -0.005], scale: [1, 1, 0.8] },
    { geometry: new BoxGeometry(0.055, 0.17, 0.015), color: SCARF, position: [0.05, top - 0.13, -0.115], rotation: [0.12, 0, 0.1] },
  ];
}

/** The neck: one metre long up +Y from its middle, drawn scaled to the gap between the torso and the skull. */
function neckParts(): Part[] {
  return [{ geometry: new CylinderGeometry(0.045, 0.05, 1, 6), color: SKIN }];
}

/**
 * Trousers and boots, seated: the origin at the middle of the hips on the
 * cushion, facing -Z, thighs along the cushion and shins down to a floor
 * `hipHeight` below.
 */
function seatedLegParts(hipHeight: number): Part[] {
  const parts: Part[] = [];
  const knee = -0.44;
  const ankle = -hipHeight + 0.1;
  // The seat of the trousers, on the cushion, which the jacket's waist stands in.
  parts.push({ geometry: new CylinderGeometry(0.155, 0.165, 0.14, 8), color: TROUSERS, position: [0, 0, 0.01], scale: [1, 1, 0.8] });
  for (const x of [-0.1, 0.1]) {
    parts.push(
      beam([x, 0, 0.06], [x, -0.01, knee], 0.075, TROUSERS, 6),
      beam([x, -0.01, knee], [x, ankle, knee + 0.02], 0.058, TROUSERS, 6),
      { geometry: new IcosahedronGeometry(0.066, 0), color: TROUSERS, position: [x, -0.01, knee] },
      { geometry: new BoxGeometry(0.09, 0.1, 0.22), color: BOOTS, position: [x, -hipHeight + 0.05, knee - 0.03] },
    );
  }
  return parts;
}

function partsMesh(parts: Part[], name: string): Mesh {
  const mesh = new Mesh(mergeParts(parts), litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })));
  mesh.name = name;
  return mesh;
}

export function createAvatarHead(index: number): Mesh {
  return partsMesh(headParts(), `Crew ${index + 1} Head`);
}

export function createAvatarTorso(index: number): Mesh {
  return partsMesh(torsoParts(CREW_COLORS[index % CREW_COLORS.length]), `Crew ${index + 1} Torso`);
}

export function createAvatarNeck(index: number): Mesh {
  return partsMesh(neckParts(), `Crew ${index + 1} Neck`);
}

const UP = new Vector3(0, 1, 0);
const spineQuat = new Quaternion();
const twistQuat = new Quaternion();
const neckDir = new Vector3();

/**
 * Place a crewmate's torso and neck for a seated pose (src/sim/seated-body.ts),
 * in a seat facing `seatYaw` (rad about +Y).
 */
export function poseCrewBody(torso: Object3D, neck: Object3D, body: SeatedBody, seatYaw: number): void {
  torso.position.set(body.pivot[0], body.pivot[1], body.pivot[2]);
  spineQuat.setFromUnitVectors(UP, neckDir.set(body.spine[0], body.spine[1], body.spine[2]));
  torso.quaternion.copy(spineQuat).multiply(twistQuat.setFromAxisAngle(UP, seatYaw + body.twist));
  torso.scale.set(1, body.stretch, 1);
  const [ax, ay, az] = body.neckFrom;
  const [bx, by, bz] = body.neckTo;
  neckDir.set(bx - ax, by - ay, bz - az);
  const length = neckDir.length();
  neck.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  if (length > 1e-6) {
    neck.quaternion.setFromUnitVectors(UP, neckDir.divideScalar(length));
  }
  neck.scale.set(1, Math.max(length, 1e-3), 1);
}

/** Seated legs for a crewmate whose hips are `hipHeight` above the floor (the seat's hip point, src/sim/cabin.ts). */
export function createAvatarLegs(index: number, hipHeight: number): Mesh {
  return partsMesh(seatedLegParts(hipHeight), `Crew ${index + 1} Legs`);
}

/** The coat-coloured parts' geometry in crew colour `index`, to recolour a crewmate. */
export function avatarTorsoGeometry(index: number): BufferGeometry {
  return mergeParts(torsoParts(CREW_COLORS[index % CREW_COLORS.length]));
}

/** The coat colour (hex) of crew colour `index`. */
export function crewCoat(index: number): number {
  return CREW_COLORS[index % CREW_COLORS.length];
}

/** A posable glove (no arm) in crew colour `index`, for drawing at a grip pose. */
export function createAvatarHand(index: number, side: 'left' | 'right'): PosedHand {
  const hand = new PosedHand(CREW_COLORS[index % CREW_COLORS.length], side);
  hand.mesh.name = `Crew ${index + 1} ${side === 'left' ? 'Left' : 'Right'} Hand`;
  return hand;
}
