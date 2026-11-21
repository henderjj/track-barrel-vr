import { BoxGeometry, BufferGeometry, CircleGeometry, CylinderGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { type CompassPlace, faceOut } from '../sim/compass.js';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * The compasses at both seats (F2.9, docs/compass.md): each one's case,
 * merged into the hull's or the turret's mesh (cabin.scene-asset.ts), and
 * the card, lubber, course mark and hull mark, which CompassSystem places
 * in the case, paints and turns. Sizes from src/sim/compass.ts. Low-poly
 * and vertex-coloured; the card and marks are unlit, as the turret dial's
 * face and pointer are, so they read in the dark cabin.
 */

const CASE = 0x2b2e2a;
/** The lubber: red, fixed at the top. */
const LUBBER = 0xd8322a;
/** The course mark: the gauges' needles' orange (driver-station.scene-asset.ts). */
const BUG = 0xf08a24;
/** The gunner's hull mark: the turret dial's hull's olive, darker, so it reads on the cream card. */
const HULL_MARK = 0x3d4a2a;
/** Marks are this thick, m. */
const T = 0.002;

/** A compass's case, in its frame's space, for the hull's or the turret's mesh: a shallow drum sunk into the wall round the face. */
export function compassCaseParts(p: CompassPlace): Part[] {
  const caseRadius = p.radius + p.rim;
  const length = p.proud + p.sunk;
  const drum = new CylinderGeometry(caseRadius, caseRadius, length, 28, 1);
  drum.rotateX(Math.PI / 2);
  const wall = p.z - faceOut(p);
  return [{ geometry: drum, color: CASE, position: [p.x, p.y, wall - p.sunk + length / 2] }];
}

/** The card: a disc at the origin facing +Z, the face's radius. CompassSystem paints it and turns it with `rotation.z`. */
export function createCompassCard(p: CompassPlace): Mesh {
  const mesh = new Mesh(new CircleGeometry(p.radius, 48), new MeshBasicMaterial({ color: 0xefe6c8, toneMapped: false }));
  mesh.name = `Compass Card ${p.id}`;
  return mesh;
}

const markMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/** A flat triangle, thickness T, its tip at `tip` (face x, y) and its base `width` wide `length` back towards `toward` ±y. */
function wedge(tipY: number, length: number, width: number): BufferGeometry {
  // A prism: the triangle at z 0 and z T, with its three sides.
  const b = tipY + length;
  const tri = [
    [0, tipY],
    [-width / 2, b],
    [width / 2, b],
  ];
  const pos: number[] = [];
  const v = (i: number, z: number) => pos.push(tri[i][0], tri[i][1], z);
  const front = length > 0 ? [0, 2, 1] : [0, 1, 2];
  for (const i of front) v(i, T);
  for (const i of [front[0], front[2], front[1]]) v(i, 0);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    v(i, 0); v(j, 0); v(j, T);
    v(i, 0); v(j, T); v(i, T);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The lubber: a red wedge pointing down into the card from its top edge,
 * fixed to the case, in front of the card and the course mark (2 × markGap).
 */
export function createLubber(p: CompassPlace): Mesh {
  const r = p.radius;
  const z = 2 * p.markGap;
  const mesh = new Mesh(mergeParts([{ geometry: wedge(r * 0.72, r * 0.28, r * 0.2), color: LUBBER, position: [0, 0, z] }]), markMaterial);
  mesh.name = `Compass Lubber ${p.id}`;
  return mesh;
}

/**
 * The driver's course mark: an orange notch on the card's edge, two prongs
 * either side of the ordered course, pointing in, markGap in front of the
 * card. At angle 0 it sits at the top, round the lubber's tip; turn it with
 * `rotation.z` (bugAngle).
 */
export function createCourseBug(p: CompassPlace): Mesh {
  const r = p.radius;
  const prong = r * 0.07;
  const depth = r * 0.16;
  const gap = r * 0.12;
  const z = p.markGap;
  const mesh = new Mesh(mergeParts([
    { geometry: new BoxGeometry(prong, depth, T), color: BUG, position: [-gap - prong / 2, r - depth / 2, z + T / 2] },
    { geometry: new BoxGeometry(prong, depth, T), color: BUG, position: [gap + prong / 2, r - depth / 2, z + T / 2] },
    { geometry: new BoxGeometry(2 * (gap + prong), prong * 0.8, T), color: BUG, position: [0, r - prong * 0.4, z + T / 2] },
  ]), markMaterial);
  mesh.name = 'Compass Course Mark';
  return mesh;
}

/**
 * The gunner's hull mark: the hull from above, nose up, a small dark
 * outline with an arrowhead at its nose, in the card's middle markGap in
 * front of it. At angle 0 it points up the face as the gun does; turn it
 * with `rotation.z` (hullMarkAngle).
 */
export function createHullMark(p: CompassPlace): Mesh {
  const r = p.radius;
  const half = r * 0.09;
  const length = r * 0.34;
  const bar = r * 0.04;
  const z = p.markGap + T / 2;
  const nose = length / 2;
  const mesh = new Mesh(mergeParts([
    // The two sides, the tail and the nose's bar.
    { geometry: new BoxGeometry(bar, length, T), color: HULL_MARK, position: [-half, 0, z] },
    { geometry: new BoxGeometry(bar, length, T), color: HULL_MARK, position: [half, 0, z] },
    { geometry: new BoxGeometry(2 * half + bar, bar, T), color: HULL_MARK, position: [0, -length / 2, z] },
    { geometry: new BoxGeometry(2 * half + bar, bar, T), color: HULL_MARK, position: [0, nose, z] },
    // The arrowhead on the nose.
    { geometry: wedge(nose + r * 0.14, -r * 0.14 + bar / 2, 2 * half + 3 * bar), color: HULL_MARK, position: [0, 0, p.markGap] },
  ]), markMaterial);
  mesh.name = 'Compass Hull Mark';
  return mesh;
}
