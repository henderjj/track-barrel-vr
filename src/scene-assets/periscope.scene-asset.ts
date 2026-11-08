import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "@iwsdk/core";
import { mergeParts, type Part } from "./lowpoly.js";
import {
  EYEPIECE_BOX,
  EYEPIECE_TILT,
  HEAD_SIZE,
  type PeriscopeSpec,
  RELAY,
  SHAFT_RADIUS,
  WINDOW,
  WINDOW_PROUD,
} from "../sim/periscope.js";
import { litInside } from "./cabin-light.js";

/**
 * A crew periscope (F1.6, F1.19, docs/periscope.md), in periscope space:
 * the upright at the origin's x and z, y = 0 at the window's middle; place
 * it at (axis x, lens y, axis z) in its frame (the hull for the driver's,
 * the turret for the gunner's). The fixed part is the eyepiece hanging
 * under the roof and the crank's gearbox on its right; the turning part is
 * the shaft up through the roof and the head on it, turned with
 * `rotation.y`. A neck and a housing under the roof join the eyepiece to
 * the upright, which may stand ahead of it. The crank itself is the mechanism kit's wheel
 * (createWheel), which PeriscopeSystem places at the spec's `crank`.
 * Numbers from src/sim/periscope.ts; the window's shader is the scope
 * lens's (src/systems/scope-lens.ts).
 */

const STEEL = 0x4a5148;
const STEEL_DARK = 0x2f3430;
const RUBBER = 0x1c1c1c;
/** The tank's paint outside (cabin.scene-asset.ts), for the head on the roof. */
const PAINT = 0x8f8a5c;
const GLASS = 0x1a2630;

const material = litInside(
  new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  }),
);

/** The rubber surround round the window: how wide its bars are and how far they stand out from the box's back face, m. */
const SURROUND = { bar: 0.015, depth: 0.012 } as const;
/** The bearing collar under the roof the shaft turns in: its radius, and how far below the roof it reaches, m. */
const COLLAR = { radius: 0.03, below: 0.06 } as const;
/** The crank's gearbox: its height and depth, and how far behind the crank's face its front is, m. */
const GEARBOX = { height: 0.036, depth: 0.035, behind: 0.016 } as const;

/** The crank's hub in periscope space. */
export function crankInPeriscope(s: PeriscopeSpec): [number, number, number] {
  return [
    s.crank[0] - s.axis[0],
    s.crank[1] - s.lens[1],
    s.crank[2] - s.axis[1],
  ];
}

/** The window's middle in periscope space. */
export function lensInPeriscope(s: PeriscopeSpec): [number, number, number] {
  return [s.lens[0] - s.axis[0], 0, s.lens[2] - s.axis[1]];
}

/** The eyepiece box's middle's z in periscope space. */
function boxZ(s: PeriscopeSpec): number {
  return s.lens[2] - s.axis[1] - WINDOW_PROUD - EYEPIECE_BOX.depth / 2;
}

/** A part of the eyepiece placed as if it faced straight back, tipped forwards about the window's middle by EYEPIECE_TILT (so the window faces down towards the seat). */
function tipped(s: PeriscopeSpec, part: Part): Part {
  const lz = s.lens[2] - s.axis[1];
  const [x, y, z] = part.position ?? [0, 0, 0];
  const c = Math.cos(EYEPIECE_TILT);
  const n = Math.sin(EYEPIECE_TILT);
  return {
    ...part,
    position: [x, y * c - (z - lz) * n, lz + y * n + (z - lz) * c],
    rotation: [EYEPIECE_TILT, 0, 0],
  };
}

/**
 * The fixed part: the eyepiece box with the rubber surround of its window
 * on the back face (towards the seat), the crank's gearbox out of its right
 * side behind the crank, the neck up from it into the housing under the
 * roof, and the housing forwards to the bearing collar the upright turns in.
 */
export function createPeriscopeBody(s: PeriscopeSpec): Mesh {
  const { width, height, depth } = EYEPIECE_BOX;
  const bz = boxZ(s);
  const back = bz + depth / 2;
  const sz = back + SURROUND.depth / 2;
  const bar = SURROUND.bar;
  const w = WINDOW.width / 2 + bar / 2;
  const h = WINDOW.height / 2 + bar / 2;
  const roof = s.roof - s.lens[1];
  const crank = crankInPeriscope(s);
  const gearFront = crank[2] - GEARBOX.behind;
  const gearRight = crank[0] + 0.03;
  const gearLeft = width / 2 - 0.02;
  const relayBottom = roof - RELAY.depth;
  const relayFront = Math.min(-COLLAR.radius - 0.005, bz - 0.04);
  const relayBack = Math.max(bz + 0.035, COLLAR.radius + 0.005);
  const neckBottom = height / 2 - 0.01;
  const neckTop = relayBottom + 0.01;
  const parts: Part[] = [
    // The box tipped forwards with the window on its back face, and the surround round the window: top and bottom bars full width, the sides between them.
    ...(
      [
        {
          geometry: new BoxGeometry(width, height, depth),
          color: STEEL,
          position: [0, 0, bz],
        },
        {
          geometry: new BoxGeometry(
            WINDOW.width + 2 * bar,
            bar,
            SURROUND.depth,
          ),
          color: RUBBER,
          position: [0, h, sz],
        },
        {
          geometry: new BoxGeometry(
            WINDOW.width + 2 * bar,
            bar,
            SURROUND.depth,
          ),
          color: RUBBER,
          position: [0, -h, sz],
        },
        {
          geometry: new BoxGeometry(bar, WINDOW.height, SURROUND.depth),
          color: RUBBER,
          position: [-w, 0, sz],
        },
        {
          geometry: new BoxGeometry(bar, WINDOW.height, SURROUND.depth),
          color: RUBBER,
          position: [w, 0, sz],
        },
      ] as Part[]
    ).map((part) => tipped(s, part)),
    // The crank's gearbox: from inside the eyepiece out behind the crank, the crank's hub sunk in its front.
    {
      geometry: new BoxGeometry(
        gearRight - gearLeft,
        GEARBOX.height,
        GEARBOX.depth,
      ),
      color: STEEL_DARK,
      position: [
        (gearLeft + gearRight) / 2,
        crank[1],
        gearFront - GEARBOX.depth / 2,
      ],
    },
    // The neck, from inside the eyepiece up into the housing.
    {
      geometry: new BoxGeometry(0.06, neckTop - neckBottom, 0.05),
      color: STEEL,
      position: [0, (neckTop + neckBottom) / 2, bz],
    },
    // The housing under the roof, its top inside the roof plate.
    {
      geometry: new BoxGeometry(
        RELAY.width,
        RELAY.depth + 0.012,
        relayBack - relayFront,
      ),
      color: STEEL_DARK,
      position: [
        0,
        relayBottom + (RELAY.depth + 0.012) / 2,
        (relayFront + relayBack) / 2,
      ],
    },
    // The collar the upright turns in, under the housing, its top inside the roof plate.
    {
      geometry: new CylinderGeometry(
        COLLAR.radius,
        COLLAR.radius,
        COLLAR.below + 0.005,
        12,
        1,
      ),
      color: STEEL,
      position: [0, roof - COLLAR.below / 2 + 0.0025, 0],
    },
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = `Periscope Body ${s.id}`;
  return mesh;
}

/**
 * The turning part: the upright from inside the housing up through the
 * roof, and the head on the roof with its window looking along -Z.
 */
export function createPeriscopeTurning(s: PeriscopeSpec): Mesh {
  const shaftBottom = s.roof - s.lens[1] - 0.03;
  const headBottom = s.head.bottom - s.lens[1];
  const headTop = s.head.top - s.lens[1];
  const headMid = (headBottom + headTop) / 2;
  const shaftTop = headBottom + 0.02;
  const parts: Part[] = [
    {
      geometry: new CylinderGeometry(
        SHAFT_RADIUS,
        SHAFT_RADIUS,
        shaftTop - shaftBottom,
        10,
        1,
      ),
      color: STEEL,
      position: [0, (shaftTop + shaftBottom) / 2, 0],
    },
    // The head, its foot inside the roof plate, a lid over it and its window on the front.
    {
      geometry: new BoxGeometry(
        HEAD_SIZE.width,
        headTop - headBottom,
        HEAD_SIZE.depth,
      ),
      color: PAINT,
      position: [0, headMid, 0],
    },
    {
      geometry: new BoxGeometry(
        HEAD_SIZE.width + 0.01,
        0.015,
        HEAD_SIZE.depth + 0.01,
      ),
      color: STEEL_DARK,
      position: [0, headTop + 0.0025, 0],
    },
    {
      geometry: new BoxGeometry(0.07, 0.035, 0.006),
      color: GLASS,
      position: [0, headMid + 0.005, -HEAD_SIZE.depth / 2 - 0.002],
    },
  ];
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = `Periscope Turning ${s.id}`;
  return mesh;
}

/** The window's glass, facing +Z; place it at the lens (WINDOW_PROUD proud of the box's back face), tipped forwards by EYEPIECE_TILT to face the seat. The periscope system gives it the scope lens's shader. */
export function createPeriscopeWindowGeometry(): PlaneGeometry {
  return new PlaneGeometry(WINDOW.width, WINDOW.height);
}
