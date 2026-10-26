import { BoxGeometry, CylinderGeometry, Mesh, MeshLambertMaterial } from '@iwsdk/core';
import { beam, mergeParts } from './lowpoly.js';
import { LEVER_RIG, TILLER } from '../sim/lever.js';

/**
 * Spike S3's lever test rig: a pair of tank tillers in a housing on a post,
 * and a stalk holding up the lane board (its screen is a canvas the
 * LeverSystem draws). Rig space as in src/sim/lever.ts: origin midway between
 * the pivots, -Z ahead. Two meshes besides the screen: the static rig, and
 * one lever drawn twice, each in its own pivot group so it turns about X.
 */

const OLIVE = 0x4b5320;
const OLIVE_DARK = 0x363c18;
const STEEL = 0x55595e;
const RUBBER = 0x1c1c1c;
const FRAME = 0x2b2e2a;

/** The housing the tillers come up out of, m: it hides their pivots. */
const HOUSING = { width: 0.5, height: 0.1, depth: 0.18 } as const;
/** The post under the housing, m. */
const POST_HEIGHT = 0.5;
/** The screen sits this far in front of its frame's face, m. */
export const SCREEN_GAP = 0.006;
/** The handle's radius and the rod's, m. */
export const GRIP_RADIUS = 0.019;
const ROD_RADIUS = 0.011;

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** The static part: post, housing with a slot for each tiller, and the board's stalk and frame. */
export function createLeverRig(): Mesh {
  const top = HOUSING.height / 2;
  const { board } = LEVER_RIG;
  const frameH = board.width + 0.03;
  // Where the stalk meets the frame: inside it, below the screen's middle.
  const down = frameH * 0.3;
  const stalkTop = [
    0,
    board.y - Math.cos(board.tilt) * down - Math.sin(board.tilt) * 0.01,
    board.z + Math.sin(board.tilt) * down - Math.cos(board.tilt) * 0.01,
  ] as const;
  const geometry = mergeParts([
    { geometry: new BoxGeometry(HOUSING.width, HOUSING.height, HOUSING.depth), color: OLIVE },
    // A slot plate for each tiller, standing 4 mm proud of the housing's top.
    ...[-1, 1].map((s) => ({
      geometry: new BoxGeometry(0.04, 0.008, 0.08),
      color: OLIVE_DARK,
      position: [s * LEVER_RIG.side, top, 0] as const,
    })),
    beam([0, -POST_HEIGHT, 0], [0, -top + 0.01, 0], 0.03, OLIVE_DARK, 6),
    { geometry: new BoxGeometry(0.3, 0.02, 0.3), color: OLIVE_DARK, position: [0, -POST_HEIGHT, 0] },
    beam([0, top - 0.01, -HOUSING.depth / 2 + 0.03], stalkTop, 0.012, STEEL, 5),
    // The board's frame, tilted back with the screen; the screen floats SCREEN_GAP in front of it.
    {
      geometry: new BoxGeometry(board.width + 0.03, frameH, 0.02),
      color: FRAME,
      position: [0, board.y - Math.sin(board.tilt) * 0.01, board.z - Math.cos(board.tilt) * 0.01],
      rotation: [-board.tilt, 0, 0],
    },
  ]);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'Lever Rig';
  return mesh;
}

/** One tiller standing upright with its pivot at the origin: a steel rod and a rubber handle, the rod ending inside the handle. */
export function createTiller(): Mesh {
  const handleStart = TILLER.length - TILLER.gripLength;
  const geometry = mergeParts([
    beam([0, -0.03, 0], [0, handleStart + 0.02, 0], ROD_RADIUS, STEEL, 6),
    { geometry: new CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, TILLER.gripLength, 8, 1), color: RUBBER, position: [0, handleStart + TILLER.gripLength / 2, 0] },
    // A knob on top, wider than the handle so their faces don't meet.
    { geometry: new CylinderGeometry(GRIP_RADIUS + 0.004, GRIP_RADIUS + 0.006, 0.014, 8, 1), color: STEEL, position: [0, TILLER.length + 0.004, 0] },
  ]);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'Tiller';
  return mesh;
}
