import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { backFront, type CompassPlace, caseSize, cardY, windowSize } from '../sim/compass.js';
import { mergeParts, type Part } from './lowpoly.js';

/**
 * The compasses at both seats (F2.9, docs/compass.md), as the gyro compass
 * of a German tank's dashboard: a small box with a window in its front,
 * through which the edges of horizontal cards show, and a red lubber line
 * down the window's middle. The case is merged into the hull's or the
 * turret's mesh (cabin.scene-asset.ts); the cards and the lubber are
 * CompassSystem's, which paints the cards' edges and slides their figures
 * past the line. Sizes from src/sim/compass.ts. Low-poly and
 * vertex-coloured; the cards and lubber are unlit, as the turret dial's face
 * is, so they read in the dark cabin.
 */

const CASE = 0x2b2e2a;
/** Inside the box, behind the cards: darker, so the window's gaps read as depth. */
const INSIDE = 0x121310;
/** The lubber line: red. */
const LUBBER = 0xd8322a;

/**
 * A compass's case, in its frame's space, for the hull's or the turret's
 * mesh: the box's four walls from the front back into the wall it stands
 * on, a dark back plate behind the cards, and the frame round the window.
 */
export function compassCaseParts(p: CompassPlace): Part[] {
  const [halfW, halfH] = caseSize(p);
  const [winW, winH] = windowSize(p);
  const back = backFront(p);
  // Back into the wall: far enough that a turned box's far side still reaches it.
  const deep = (halfW * Math.abs(Math.sin(p.yaw)) + (p.z - p.wall)) / Math.cos(p.yaw) + 0.01;
  const behind = -deep;
  const length = p.frameFront - behind;
  const mid = (p.frameFront + behind) / 2;
  const t = p.caseWall;
  const rot: [number, number, number] = [0, p.yaw, 0];
  const at = (x: number, y: number, z: number): [number, number, number] => {
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    return [p.x + x * c + z * s, p.y + y, p.z - x * s + z * c];
  };
  const frameDepth = 0.003;
  const fz = p.frameFront - frameDepth / 2;
  const sideBar = halfW - winW;
  const topBar = halfH - winH;
  return [
    // The walls: top, bottom, left, right.
    { geometry: new BoxGeometry(2 * halfW, t, length), color: CASE, position: at(0, halfH - t / 2, mid), rotation: rot },
    { geometry: new BoxGeometry(2 * halfW, t, length), color: CASE, position: at(0, -halfH + t / 2, mid), rotation: rot },
    { geometry: new BoxGeometry(t, 2 * halfH - 2 * t, length), color: CASE, position: at(-halfW + t / 2, 0, mid), rotation: rot },
    { geometry: new BoxGeometry(t, 2 * halfH - 2 * t, length), color: CASE, position: at(halfW - t / 2, 0, mid), rotation: rot },
    // The back plate, just behind the cards' edges.
    { geometry: new BoxGeometry(2 * halfW - 2 * t, 2 * halfH - 2 * t, 0.004), color: INSIDE, position: at(0, 0, back - 0.002), rotation: rot },
    // The frame round the window: over and under it, and either side.
    { geometry: new BoxGeometry(2 * halfW, topBar, frameDepth), color: CASE, position: at(0, winH + topBar / 2, fz), rotation: rot },
    { geometry: new BoxGeometry(2 * halfW, topBar, frameDepth), color: CASE, position: at(0, -winH - topBar / 2, fz), rotation: rot },
    { geometry: new BoxGeometry(sideBar, 2 * winH, frameDepth), color: CASE, position: at(-winW - sideBar / 2, 0, fz), rotation: rot },
    { geometry: new BoxGeometry(sideBar, 2 * winH, frameDepth), color: CASE, position: at(winW + sideBar / 2, 0, fz), rotation: rot },
  ];
}

/**
 * Card `i`'s edge, in box space: an arc of an upright cylinder's side, the
 * card's radius, `arc` either side of the lubber, its axis `radius` behind
 * the window. Its u runs as bearing over 360, 0 on the lubber line and
 * growing to the right, so CompassSystem slides a painted 0°–360° strip
 * with the texture's offset (`cardOffset`), repeating.
 */
export function createCardEdge(p: CompassPlace, i: number): Mesh {
  const segments = 24;
  const geometry = new CylinderGeometry(p.radius, p.radius, p.band, segments, 1, true, -p.arc, 2 * p.arc);
  // CylinderGeometry's u runs 0 to 1 over thetaLength from thetaStart (θ 0 faces +Z, growing towards +X): make it θ over a turn.
  const uv = geometry.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) uv.setX(k, (-p.arc + uv.getX(k) * 2 * p.arc) / (2 * Math.PI));
  geometry.translate(0, cardY(p, i), -p.radius);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  mesh.name = `Compass ${p.cards[i]} card ${p.id}`;
  return mesh;
}

/** The lubber line: a thin red bar down the window's middle (about a sixteenth of a card's band wide), `lubberFront` in front of the cards. */
export function createLubber(p: CompassPlace): Mesh {
  const [, winH] = windowSize(p);
  const thick = 0.0015;
  const geometry = mergeParts([{ geometry: new BoxGeometry(p.band * 0.06, 2 * winH, thick), color: LUBBER, position: [0, 0, p.lubberFront - thick / 2] }]);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  mesh.name = `Compass Lubber ${p.id}`;
  return mesh;
}
