import { BoxGeometry, CylinderGeometry } from '@iwsdk/core';
import {
  MARKER_ACROSS,
  MARKER_POST,
  MARKER_RANGES,
  markerFoot,
  RANGE_TARGETS,
  ROAD,
  targetBoard,
  targetFoot,
  targetMiddleAbove,
  targetYaw,
} from '../sim/range.js';
import { groundHeight, TILE } from '../sim/terrain.js';
import { beam, type Part } from './lowpoly.js';

/**
 * The test range's parts (F1.7, docs/range.md): the two dirt roads, the
 * three static target boards and the range markers beside the road. The
 * ground's model (terrain.scene-asset.ts) merges them into its chunks, so
 * they are drawn in the same few meshes as the ground and move with the
 * world as the tank drives.
 *
 * Built in the ground's own space: x and z as src/sim/range.ts gives them,
 * y measured from the ground's surface at the start (the scene drops the
 * whole ground GROUND_Y under the hull floor). Nothing here is lit by a
 * light of its own; the sky's image-based light does it all.
 */

const ROAD_DIRT = 0xa89878;
const ROAD_DIRT_CROSS = 0x9f8f70;
const CANVAS = 0xd8d0b8;
const WOOD_DARK = 0x6e4a2b;
const SILHOUETTE = 0x2a2a2a;
const MARKER = 0xe07020;
const MARKER_POLE = 0xe8e4d8;

/** Road segments are this long, m, so each one sits in a single chunk of ground and is culled with it. */
const ROAD_SEGMENT = 50;

/**
 * The roads: a strip up the lane every tile in x, and one across the start
 * every tile in z, both within the ground's flat corridors, so they lie
 * flat on it. Cut into segments, each returned with the (x, z) it should be
 * filed under.
 *
 * `extent` is how far the ground is drawn each way from its middle, m.
 */
export function roadParts(extent: number): { part: Part; x: number; z: number }[] {
  const out: { part: Part; x: number; z: number }[] = [];
  const tiles = [-1, 0, 1];
  const thickness = 0.06;
  const add = (part: Part, x: number, z: number) => out.push({ part, x, z });
  for (const tile of tiles) {
    const middle = tile * TILE;
    // Up the range: a strip at x ≡ 0, along the whole drawn span of z.
    for (let z = -extent; z < extent; z += ROAD_SEGMENT) {
      const length = Math.min(ROAD_SEGMENT, extent - z);
      const cz = z + length / 2;
      add(
        {
          geometry: new BoxGeometry(2 * ROAD.halfWidth, thickness, length),
          color: ROAD_DIRT,
          position: [middle, ROAD.lift - thickness / 2, cz],
        },
        middle,
        cz,
      );
    }
    // Across the start: a slightly narrower strip at z ≡ 0, a centimetre
    // lower, so the two roads' surfaces never share a plane where they cross.
    for (let x = -extent; x < extent; x += ROAD_SEGMENT) {
      const length = Math.min(ROAD_SEGMENT, extent - x);
      const cx = x + length / 2;
      add(
        {
          geometry: new BoxGeometry(length, thickness, 2 * ROAD.crossHalfWidth),
          color: ROAD_DIRT_CROSS,
          position: [cx, ROAD.crossLift - thickness / 2, middle],
        },
        cx,
        middle,
      );
    }
  }
  return out;
}

/**
 * Target `i`: a canvas face on two posts with a dark silhouette standing
 * proud of it (a tank's hull, turret and gun, or an anti-tank gun's shield,
 * barrel and wheels), and an orange marker on top per hundred metres of its
 * range, so the gunner can tell them apart through the sight. Returned in
 * the ground's space, standing where the ground is flat.
 */
export function targetParts(i: number, dx = 0, dz = 0): Part[] {
  const [fx, fz] = targetFoot(i);
  const x = fx + dx;
  const z = fz + dz;
  const yaw = targetYaw(i);
  const { width, height, lift } = targetBoard(i);
  const kind = RANGE_TARGETS[i].kind;
  const bottom = lift;
  const middle = targetMiddleAbove(i);
  const local: Part[] = [{ geometry: new BoxGeometry(width, height, 0.1), color: CANVAS, position: [0, middle, 0] }];
  for (const side of [-1, 1]) {
    local.push(beam([side * width * 0.35, -0.05, -0.1], [side * width * 0.35, bottom + height * 0.8, -0.1], 0.06, WOOD_DARK, 6));
  }
  // The silhouette: each plate stands at least 2 cm proud of the face and
  // of the plates it overlaps, so no two faces of different colours meet.
  if (kind === 'tank') {
    local.push({ geometry: new BoxGeometry(width * 0.8, height * 0.36, 0.14), color: SILHOUETTE, position: [0, bottom + height * 0.3, 0] });
    local.push({ geometry: new BoxGeometry(width * 0.36, height * 0.24, 0.14), color: SILHOUETTE, position: [-width * 0.05, bottom + height * 0.58, 0] });
    local.push({ geometry: new BoxGeometry(width * 0.38, 0.12, 0.16), color: SILHOUETTE, position: [width * 0.28, bottom + height * 0.6, 0] });
  } else {
    // A gun: a low shield, the barrel out to one side and a wheel either end of it.
    local.push({ geometry: new BoxGeometry(width * 0.62, height * 0.34, 0.14), color: SILHOUETTE, position: [-width * 0.08, bottom + height * 0.34, 0] });
    local.push({ geometry: new BoxGeometry(width * 0.5, 0.1, 0.18), color: SILHOUETTE, position: [width * 0.3, bottom + height * 0.42, 0] });
    for (const side of [-1, 1]) {
      const wheel = new CylinderGeometry(height * 0.14, height * 0.14, 0.18, 8, 1);
      wheel.rotateX(Math.PI / 2);
      local.push({ geometry: wheel, color: SILHOUETTE, position: [side * width * 0.26, bottom + height * 0.14, 0] });
    }
  }
  const markers = Math.round(RANGE_TARGETS[i].range / 100);
  for (let m = 0; m < markers; m++) {
    const mx = (m - (markers - 1) / 2) * 0.5;
    local.push({ geometry: new BoxGeometry(0.3, 0.3, 0.12), color: MARKER, position: [mx, bottom + height + 0.15, 0] });
  }
  return place(local, x, z, yaw);
}

/**
 * A range marker: a pale post beside the road with an orange band per
 * hundred metres, so a driver can see how far up the range they are.
 */
export function markerParts(range: number, dx = 0, dz = 0): Part[] {
  const [fx, fz] = markerFoot(range);
  const x = fx + dx;
  const z = fz + dz;
  const { half, height, firstBand, bandHeight, bandGap } = MARKER_POST;
  const local: Part[] = [{ geometry: new BoxGeometry(2 * half, height, 2 * half), color: MARKER_POLE, position: [0, height / 2, 0] }];
  const bands = Math.round(range / 100);
  for (let b = 0; b < bands; b++) {
    // Each band stands 1 cm proud of the post all round, so its faces never share a plane with it.
    local.push({
      geometry: new BoxGeometry(2 * half + 0.02, bandHeight, 2 * half + 0.02),
      color: MARKER,
      position: [0, firstBand + b * bandGap + bandHeight / 2, 0],
    });
  }
  return place(local, x, z, 0);
}

/** Turn parts standing at the origin about +Y and move them to (x, z) on the ground. */
function place(local: Part[], x: number, z: number, yaw: number): Part[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const ground = groundHeight(x, z);
  return local.map((part) => {
    const [px, py, pz] = part.position ?? [0, 0, 0];
    if (yaw !== 0) part.geometry.rotateY(yaw);
    return {
      geometry: part.geometry,
      color: part.color,
      position: [x + px * c + pz * s, ground + py, z - px * s + pz * c] as const,
    };
  });
}

/** Every range marker's parts, each copy offset by (dx, dz). */
export function allMarkerParts(dx = 0, dz = 0): { parts: Part[]; x: number; z: number }[] {
  return MARKER_RANGES.map((range) => {
    const [x, z] = markerFoot(range);
    return { parts: markerParts(range, dx, dz), x: x + dx, z: z + dz };
  });
}

/** Every target's parts, each copy offset by (dx, dz). */
export function allTargetParts(dx = 0, dz = 0): { parts: Part[]; x: number; z: number }[] {
  return RANGE_TARGETS.map((_, i) => {
    const [x, z] = targetFoot(i);
    return { parts: targetParts(i, dx, dz), x: x + dx, z: z + dz };
  });
}

/** Markers stand this far right of the road's middle, m: the range's number, for the model's own use. */
export { MARKER_ACROSS };
