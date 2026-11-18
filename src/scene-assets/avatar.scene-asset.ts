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
 * Crew avatar dressed as a British Royal Armoured Corps tank crewman in
 * north-west Europe, 1944, the crew of a Sherman V (the M4A4 in British
 * service), to go with the British commander on the intercom (F6.3, see
 * docs/crew-avatars.md): a black beret pulled down to the right with a badge
 * over the left eye, a wireless headset over it, dust goggles pushed up on
 * the brow, a leather jerkin over khaki denim overalls, a webbing belt with a
 * pistol holster, a hand microphone hung on the chest, a neckerchief in the
 * crew colour, leather gauntlets, webbing anklets and black boots. Real-world
 * proportions for a 1.75 m adult, kept low-poly and flat-shaded: about 1,370
 * triangles in all.
 *
 * The crew colour (the menu's swatches) is the neckerchief, the slip-on
 * shoulder titles and the gauntlets' cuff bands, so the two crew still tell
 * each other apart in matching uniforms.
 *
 * The networked avatar (spike S4) is split into parts that move separately,
 * each one draw call: the head follows the remote headset; the legs sit in
 * the crewmate's seat (src/sim/cabin.ts), hips on the cushion, thighs along
 * it and shins down to the floor; the torso, in a hip-length jerkin, pivots
 * at the hips and leans towards the head, and a neck joins the two (F1.1b:
 * `poseCrewBody`, with the sums in src/sim/seated-body.ts); each glove
 * follows a controller's grip pose.
 */

export const CREW_COLORS = [0x2f6db3, 0xc0563a, 0x3f8f5a, 0x8a4fb0, 0xd19a2a, 0x2a9a9a, 0x9a3a5a, 0x5a5a5a];
/** Names for the crew colours (the neckerchief), for the crew panel. */
export const CREW_COLOR_NAMES = ['Blue', 'Brick', 'Green', 'Plum', 'Mustard', 'Teal', 'Wine', 'Slate'];
const SKIN = 0xe0b48f;
/** The black beret of the Royal Armoured Corps. */
const BERET = 0x1d1d20;
const BADGE = 0xb9b6a8;
/** Bakelite earphones and microphone. */
const BAKELITE = 0x232120;
const GOGGLE_RIM = 0x4a4a3c;
const GLASS = 0x9fd3e8;
/** Khaki denim overalls, worn over battledress in the tank. */
const KHAKI = 0x7a7150;
/** The leather jerkin, a darker brown than the gauntlets. */
const JERKIN = 0x5a3d28;
/** 1937 pattern webbing, blancoed pale khaki. */
const WEBBING = 0x9c9672;
const BRASS = 0xc9a03a;
const BOOTS = 0x1e1a17;

/** Head parts, with the origin at the eye centre and the face towards -Z (the wearer's right is +X). */
function headParts(): Part[] {
  return [
    // Skull, a little narrower than it is deep, and a smaller jaw below it.
    { geometry: new IcosahedronGeometry(0.1, 1), color: SKIN, position: [0, 0.03, 0.065], scale: [0.85, 1, 0.95] },
    { geometry: new IcosahedronGeometry(0.07, 1), color: SKIN, position: [0, -0.055, 0.035], scale: [0.95, 0.8, 1] },
    { geometry: new ConeGeometry(0.014, 0.03, 4), color: shade(SKIN, 0.92), position: [0, -0.028, -0.034], rotation: [-Math.PI / 2 - 0.35, 0, 0] },
    // Ears, under the earphones.
    { geometry: new IcosahedronGeometry(0.022, 0), color: shade(SKIN, 0.9), position: [-0.084, 0.002, 0.07], scale: [0.5, 1, 0.8] },
    { geometry: new IcosahedronGeometry(0.022, 0), color: shade(SKIN, 0.9), position: [0.084, 0.002, 0.07], scale: [0.5, 1, 0.8] },
    // Black beret: a close band round the brow and a full crown pulled down
    // over the right ear, as the British wore it.
    { geometry: new IcosahedronGeometry(0.106, 1), color: BERET, position: [0, 0.058, 0.07], scale: [0.89, 0.7, 0.99] },
    { geometry: new IcosahedronGeometry(0.125, 1), color: shade(BERET, 1.25), position: [0.022, 0.108, 0.072], rotation: [0.06, 0, -0.32], scale: [1, 0.3, 1] },
    // Cap badge on the band over the left eye.
    { geometry: new CylinderGeometry(0.013, 0.013, 0.008, 6), color: BADGE, position: [-0.05, 0.066, -0.021], rotation: [Math.PI / 2 + 0.25, 0.5, 0] },
    // Dust goggles pushed up onto the front of the beret's crown, right of
    // the badge, lying back on it.
    ...[-0.002, 0.058].flatMap((x): Part[] => [
      { geometry: new TorusGeometry(0.023, 0.008, 4, 8), color: GOGGLE_RIM, position: [x, 0.138 - x * 0.25, -0.01], rotation: [1.15, 0, -0.25] },
      { geometry: new CylinderGeometry(0.02, 0.02, 0.006, 8), color: GLASS, position: [x, 0.138 - x * 0.25, -0.01], rotation: [Math.PI / 2 + 1.15, 0, -0.25] },
    ]),
    { geometry: new BoxGeometry(0.02, 0.008, 0.01), color: GOGGLE_RIM, position: [0.028, 0.132, -0.008], rotation: [1.15, 0, -0.25] },
    // Wireless headset: an earphone on each ear and a band over the beret.
    { geometry: new CylinderGeometry(0.034, 0.036, 0.026, 8), color: BAKELITE, position: [-0.097, 0, 0.07], rotation: [0, 0, Math.PI / 2] },
    { geometry: new CylinderGeometry(0.034, 0.036, 0.026, 8), color: BAKELITE, position: [0.097, 0, 0.07], rotation: [0, 0, -Math.PI / 2] },
    { geometry: new TorusGeometry(0.103, 0.006, 3, 10, Math.PI), color: shade(BAKELITE, 1.4), position: [0, 0.01, 0.072], scale: [1, 1.42, 1] },
  ];
}

/**
 * Overalls, leather jerkin and webbing, with the origin at the hip point and
 * the spine up +Y to the neck's base `TORSO_LENGTH` above it; the front
 * faces -Z. Drawn stretched a little along Y as the crewmate leans
 * (`poseCrewBody`).
 */
function torsoParts(crew: number): Part[] {
  const top = TORSO_LENGTH;
  const parts: Part[] = [
    // Khaki overalls at the waist, under the jerkin's hem.
    { geometry: new CylinderGeometry(0.155, 0.16, 0.2, 8), color: KHAKI, position: [0, 0.1, 0], scale: [1, 1, 0.68] },
    // A hip-length, sleeveless leather jerkin from the hips to the shoulders.
    { geometry: new CylinderGeometry(0.192, 0.168, 0.44, 8), color: JERKIN, position: [0, top - 0.24, 0], scale: [1, 1, 0.66] },
    // Overall sleeves at the shoulders, out past the jerkin, with the
    // slip-on shoulder titles in the crew colour.
    { geometry: new IcosahedronGeometry(0.075, 0), color: KHAKI, position: [-0.17, top - 0.045, 0], scale: [1, 0.78, 1] },
    { geometry: new IcosahedronGeometry(0.075, 0), color: KHAKI, position: [0.17, top - 0.045, 0], scale: [1, 0.78, 1] },
    { geometry: new BoxGeometry(0.06, 0.016, 0.07), color: crew, position: [-0.175, top + 0.01, 0], rotation: [0, 0, 0.35] },
    { geometry: new BoxGeometry(0.06, 0.016, 0.07), color: crew, position: [0.175, top + 0.01, 0], rotation: [0, 0, -0.35] },
    // Overall collar, and the neckerchief knotted at the throat over it.
    { geometry: new CylinderGeometry(0.075, 0.12, 0.06, 8), color: KHAKI, position: [0, top - 0.025, 0], scale: [1, 1, 0.82] },
    { geometry: new CylinderGeometry(0.066, 0.08, 0.05, 8), color: crew, position: [0, top + 0.005, -0.004], scale: [1, 1, 0.9] },
    { geometry: new IcosahedronGeometry(0.024, 0), color: shade(crew, 0.85), position: [0, top - 0.01, -0.078] },
    { geometry: new ConeGeometry(0.06, 0.13, 3), color: crew, position: [0, top - 0.09, -0.112], rotation: [Math.PI - 0.12, 0, 0], scale: [1, 1, 0.25] },
    // 1937 pattern webbing belt over the jerkin, its buckle, and a pistol
    // holster on the right hip.
    { geometry: new CylinderGeometry(0.176, 0.176, 0.05, 8), color: WEBBING, position: [0, 0.14, 0], scale: [1, 1, 0.7] },
    { geometry: new BoxGeometry(0.06, 0.04, 0.014), color: BRASS, position: [0, 0.14, -0.126] },
    { geometry: new BoxGeometry(0.055, 0.15, 0.1), color: WEBBING, position: [0.178, 0.085, 0.01], rotation: [0, 0, 0.08] },
    { geometry: new BoxGeometry(0.066, 0.03, 0.114), color: shade(WEBBING, 0.88), position: [0.182, 0.16, 0.01], rotation: [0, 0, 0.08] },
    // The wireless set's hand microphone, hung on its cord on the left of the chest.
    beam([-0.05, top - 0.02, -0.105], [-0.085, top - 0.2, -0.135], 0.005, BAKELITE, 4),
    { geometry: new CylinderGeometry(0.022, 0.026, 0.07, 7), color: BAKELITE, position: [-0.085, top - 0.24, -0.138], rotation: [0.15, 0, 0] },
  ];
  // Jerkin buttons down the front.
  for (let i = 0; i < 3; i++) {
    parts.push({ geometry: new BoxGeometry(0.018, 0.018, 0.012), color: BOOTS, position: [0.012, top - 0.22 - i * 0.09, -0.12 + i * 0.004] });
  }
  return parts;
}

/** The neck: one metre long up +Y from its middle, drawn scaled to the gap between the torso and the skull. */
function neckParts(): Part[] {
  return [{ geometry: new CylinderGeometry(0.045, 0.05, 1, 6), color: SKIN }];
}

/**
 * Overalls, anklets and boots, seated: the origin at the middle of the hips
 * on the cushion, facing -Z, thighs along the cushion and shins down to a
 * floor `hipHeight` below.
 */
function seatedLegParts(hipHeight: number): Part[] {
  const parts: Part[] = [];
  const knee = -0.44;
  const ankle = -hipHeight + 0.1;
  // The seat of the overalls, on the cushion, which the jerkin's hem stands in.
  parts.push({ geometry: new CylinderGeometry(0.155, 0.165, 0.14, 8), color: KHAKI, position: [0, 0, 0.01], scale: [1, 1, 0.8] });
  for (const x of [-0.1, 0.1]) {
    parts.push(
      beam([x, 0, 0.06], [x, -0.01, knee], 0.075, KHAKI, 6),
      beam([x, -0.01, knee], [x, ankle + 0.04, knee + 0.018], 0.058, KHAKI, 6),
      { geometry: new IcosahedronGeometry(0.066, 0), color: KHAKI, position: [x, -0.01, knee] },
      // Webbing anklets over the overall legs, down onto the boots.
      { geometry: new CylinderGeometry(0.068, 0.066, 0.09, 8), color: WEBBING, position: [x, ankle + 0.005, knee + 0.02] },
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

/** The torso's geometry in crew colour `index` (neckerchief and shoulder titles), to recolour a crewmate. */
export function avatarTorsoGeometry(index: number): BufferGeometry {
  return mergeParts(torsoParts(CREW_COLORS[index % CREW_COLORS.length]));
}

/** Crew colour `index` as hex (neckerchief, shoulder titles and the gauntlets' cuff bands). */
export function crewCoat(index: number): number {
  return CREW_COLORS[index % CREW_COLORS.length];
}

/** A posable leather gauntlet (no arm) with a cuff band in crew colour `index`, for drawing at a grip pose. */
export function createAvatarHand(index: number, side: 'left' | 'right'): PosedHand {
  const hand = new PosedHand(CREW_COLORS[index % CREW_COLORS.length], side);
  hand.mesh.name = `Crew ${index + 1} ${side === 'left' ? 'Left' : 'Right'} Hand`;
  return hand;
}
