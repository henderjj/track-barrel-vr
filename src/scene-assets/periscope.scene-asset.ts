import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import { GRIP_RADIUS } from './mechanism.scene-asset.js';
import { HULL } from '../sim/cabin.js';
import { EYEPIECE_BOX, HEAD, PERISCOPE_YOKE, SHAFT_RADIUS, WINDOW, YOKE_Y } from '../sim/periscope.js';

/**
 * The driver's periscope (F1.6, docs/periscope.md), in periscope space (the
 * yoke's middle at the origin; place it at AXIS, YOKE_Y in the hull): the
 * fixed eyepiece the driver looks into, and the turning part, the yoke,
 * the shaft and the head on the roof, which turns with `rotation.y`.
 * Numbers from src/sim/periscope.ts; the window's shader is the scope
 * lens's (src/systems/scope-lens.ts).
 */

const STEEL = 0x4a5148;
const STEEL_DARK = 0x2f3430;
const RUBBER = 0x1c1c1c;
/** The hull's paint outside (cabin.scene-asset.ts), for the head on the roof. */
const PAINT = 0x8f8a5c;
const GLASS = 0x1a2630;
/** The hub's pointer, showing which way the head looks. */
const MARK = 0xd8b030;

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

/** The rubber surround round the window: how wide its bars are and how far they stand out from the box's back face, m. */
const SURROUND = { bar: 0.015, depth: 0.012 } as const;
/** The bearing collar under the roof the shaft turns in: its radius, and how far below the roof it reaches, m. */
const COLLAR = { radius: 0.045, below: 0.06 } as const;
/** The yoke's hub: its radius and height, m. */
const HUB = { radius: 0.03, height: 0.05 } as const;

/**
 * The fixed part: the eyepiece box round the shaft with the rubber
 * surround of its window on the back face (towards the driver), and the
 * bearing collar under the roof.
 */
export function createPeriscopeBody(): Mesh {
  const { width, height, depth } = EYEPIECE_BOX;
  const y = EYEPIECE_BOX.y - YOKE_Y;
  const back = depth / 2;
  const sz = back + SURROUND.depth / 2;
  const bar = SURROUND.bar;
  const w = WINDOW.width / 2 + bar / 2;
  const h = WINDOW.height / 2 + bar / 2;
  const roof = HULL.roof - YOKE_Y;
  const parts: Part[] = [
    { geometry: new BoxGeometry(width, height, depth), color: STEEL, position: [0, y, 0] },
    // The surround: top and bottom bars full width, the sides between them.
    { geometry: new BoxGeometry(WINDOW.width + 2 * bar, bar, SURROUND.depth), color: RUBBER, position: [0, y + h, sz] },
    { geometry: new BoxGeometry(WINDOW.width + 2 * bar, bar, SURROUND.depth), color: RUBBER, position: [0, y - h, sz] },
    { geometry: new BoxGeometry(bar, WINDOW.height, SURROUND.depth), color: RUBBER, position: [-w, y, sz] },
    { geometry: new BoxGeometry(bar, WINDOW.height, SURROUND.depth), color: RUBBER, position: [w, y, sz] },
    // The collar, its top inside the roof plate.
    {
      geometry: new CylinderGeometry(COLLAR.radius, COLLAR.radius, COLLAR.below + 0.005, 12, 1),
      color: STEEL_DARK,
      position: [0, roof - COLLAR.below / 2 + 0.0025, 0],
    },
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Periscope Body';
  return mesh;
}

/**
 * The turning part: the yoke (a hub with a pointer the way the head looks,
 * a bar out each side and a rubber handle on each end), the shaft up
 * through the eyepiece and the roof, and the head on the roof with its
 * window looking along -Z.
 */
export function createPeriscopeTurning(): Mesh {
  const { inner, outer } = PERISCOPE_YOKE;
  const length = outer - inner;
  const headBottom = HEAD.bottom - YOKE_Y;
  const headTop = HEAD.top - YOKE_Y;
  const headMid = (headBottom + headTop) / 2;
  const alongX: [number, number, number] = [0, 0, Math.PI / 2];
  const parts: Part[] = [
    { geometry: new CylinderGeometry(HUB.radius, HUB.radius, HUB.height, 12, 1), color: STEEL_DARK },
    // The pointer: its foot sunk into the hub's top.
    { geometry: new BoxGeometry(0.012, 0.01, 0.04), color: MARK, position: [0, HUB.height / 2 + 0.003, -0.04] },
    beam([-inner - 0.01, 0, 0], [inner + 0.01, 0, 0], 0.012, STEEL, 6),
    ...[-1, 1].map((s): Part => ({
      geometry: new CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, length, 8, 1),
      color: RUBBER,
      position: [s * (inner + length / 2), 0, 0],
      rotation: alongX,
    })),
    ...[-1, 1].map((s): Part => ({
      geometry: new CylinderGeometry(GRIP_RADIUS + 0.005, GRIP_RADIUS + 0.005, 0.012, 8, 1),
      color: STEEL,
      position: [s * (outer + 0.004), 0, 0],
      rotation: alongX,
    })),
    // The shaft, from inside the hub to inside the head.
    { geometry: new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, headBottom + 0.02, 10, 1), color: STEEL, position: [0, (headBottom + 0.02) / 2, 0] },
    // The head, its foot inside the roof plate, a lid over it and its window on the front.
    { geometry: new BoxGeometry(HEAD.width, headTop - headBottom, HEAD.depth), color: PAINT, position: [0, headMid, 0] },
    { geometry: new BoxGeometry(HEAD.width + 0.01, 0.015, HEAD.depth + 0.01), color: STEEL_DARK, position: [0, headTop + 0.0025, 0] },
    { geometry: new BoxGeometry(0.07, 0.035, 0.006), color: GLASS, position: [0, headMid + 0.005, -HEAD.depth / 2 - 0.002] },
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Periscope Turning';
  return mesh;
}

/** The window's glass, facing the driver (+Z); place it at the lens. The periscope system gives it the scope lens's shader. */
export function createPeriscopeWindowGeometry(): PlaneGeometry {
  return new PlaneGeometry(WINDOW.width, WINDOW.height);
}
