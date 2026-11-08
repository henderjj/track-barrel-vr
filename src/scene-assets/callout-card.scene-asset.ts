import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { CARD_BORDER, CARD_FACE_GAP, CARD_PROUD, CARD_SUNK, type CardPlace } from '../sim/callout-card.js';
import { litInside } from './cabin-light.js';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * The callout card (F2.6, docs/callout-card.md): a steel plate on the wall
 * with a printed face in front of it, its four corner bolts standing proud
 * of the plate's border. Low-poly and vertex-coloured; the face is a plane
 * whose canvas CalloutCardSystem draws. Its own mesh, not merged into the
 * cabin, so the setting can hide it.
 */

const PLATE = 0x3a3d33;
const BOLT = 0x6c6f66;

const plateMaterial = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));

/** The card's plate and bolts in the card's own space: the face's middle at the origin, looking along +Z, the wall behind it. */
function cardParts(place: CardPlace): Part[] {
  const depth = CARD_SUNK + CARD_PROUD;
  // The plate's front face is CARD_FACE_GAP behind the printed face; its back is sunk in the wall.
  const plateZ = -CARD_FACE_GAP - depth / 2;
  const w = place.width + 2 * CARD_BORDER;
  const h = place.height + 2 * CARD_BORDER;
  const parts: Part[] = [{ geometry: new BoxGeometry(w, h, depth), color: PLATE, position: [0, 0, plateZ] }];
  // A bolt in each corner of the border, its head standing 3 mm off the plate, beside the face.
  const bx = w / 2 - CARD_BORDER / 2;
  const by = h / 2 - CARD_BORDER / 2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const bolt = new CylinderGeometry(0.004, 0.004, 0.006, 6, 1);
      bolt.rotateX(Math.PI / 2);
      parts.push({ geometry: bolt, color: BOLT, position: [sx * bx, sy * by, -CARD_FACE_GAP] });
    }
  }
  return parts;
}

/**
 * A callout card at `place`, in its seat's frame: the plate (this mesh)
 * with the printed face as its child, named 'Callout Card Face'. The face's
 * material is `face` (CalloutCardSystem gives it the card's canvas).
 */
export function createCalloutCard(place: CardPlace, face: MeshBasicMaterial = new MeshBasicMaterial({ color: 0x26281f })): Mesh {
  const card = new Mesh(mergeParts(cardParts(place)), plateMaterial);
  card.name = 'Callout Card';
  card.position.set(place.x, place.y, place.z);
  card.rotation.y = place.yaw;
  const print = new Mesh(new PlaneGeometry(place.width, place.height), face);
  print.name = 'Callout Card Face';
  card.add(print);
  return card;
}
