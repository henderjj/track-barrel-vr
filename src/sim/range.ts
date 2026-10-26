/**
 * The test range (F1.7, docs/range.md): the roads laid on the ground, the
 * static targets at 100, 250 and 500 m, the range markers beside the road
 * and the fog that limits how far the crew can see.
 *
 * Engine-free and deterministic, like the ground it stands on
 * (src/sim/terrain.ts): the drawn range (src/scene-assets/terrain.scene-asset.ts
 * draws it into the ground's chunks, so it moves with the world as the tank
 * drives), the range system, the gunsight and the tests all read these
 * numbers.
 *
 * Two spaces matter here and they differ only by the ground's offset:
 *
 * - **World space** (metres, +X east, -Z the tank's starting heading): what
 *   the ground is built in, with the ground's surface at the start at y = 0.
 * - **Hull space**: what the cabin, the sight and the seats are built in,
 *   with the hull's floor at y = 0 and the ground at GROUND_Y under it. With
 *   the tank parked at its start the two have the same x and z, and a height
 *   above the ground is GROUND_Y higher in hull space.
 *
 * Everything here is given in world x and z with heights **above the
 * ground**; `targetMiddle` is the one place that converts, for the sight's
 * aiming (which works in hull space).
 */

import { GROUND_Y } from './cabin.js';
import { SIGHT_STAND } from './sight.js';
import { CROSS_HALF, LANE_HALF, wrapTile } from './terrain.js';

/** What a target looks like: a tank silhouette on a board, or an anti-tank gun's. */
export type TargetKind = 'tank' | 'gun';

export interface RangeTarget {
  /**
   * How far the target stands from the gunner's sight with the tank at its
   * start, m: the ranges the reticle marks (plan §4.7).
   */
  range: number;
  /** How far across the sight's line it stands, m; + is to the right. */
  across: number;
  kind: TargetKind;
}

/**
 * The three static targets (plan §4.7). Each is within the sight's field
 * (±6°) with the sight looking straight ahead, so the gunner sees all three
 * at once, and each is far enough off the road's middle for the tank to
 * drive past it without clipping it.
 */
export const RANGE_TARGETS: readonly RangeTarget[] = [
  { range: 100, across: -7, kind: 'tank' },
  { range: 250, across: 11, kind: 'gun' },
  { range: 500, across: 7, kind: 'tank' },
];

/** A target board per kind: the face's width and height, and how high its bottom edge stands above the ground, m. */
export const TARGET_BOARDS: Record<TargetKind, { width: number; height: number; lift: number }> = {
  tank: { width: 3.0, height: 2.2, lift: 0.5 },
  gun: { width: 2.4, height: 1.6, lift: 0.35 },
};

/** The board of target `i`. */
export function targetBoard(i: number): { width: number; height: number; lift: number } {
  return TARGET_BOARDS[RANGE_TARGETS[i].kind];
}

/** Where target `i` stands: x and z of the middle of its foot (world space, and hull space with the tank at its start). */
export function targetFoot(i: number): [number, number] {
  const t = RANGE_TARGETS[i];
  return [SIGHT_STAND.x + t.across, SIGHT_STAND.z - t.range];
}

/** How high the middle of target `i`'s face is above the ground, m. */
export function targetMiddleAbove(i: number): number {
  const board = targetBoard(i);
  return board.lift + board.height / 2;
}

/** The height of the middle of target `i`'s face in hull space, m: what the sight is laid on. */
export function targetMiddle(i: number): number {
  return GROUND_Y + targetMiddleAbove(i);
}

/** Which way target `i` faces, rad about +Y: square to the sight, so its face is seen flat from the start. */
export function targetYaw(i: number): number {
  const [x, z] = targetFoot(i);
  return Math.atan2(SIGHT_STAND.x - x, SIGHT_STAND.z - z);
}

/**
 * Target `i`'s face as a box, for aiming and (from F1.10) for deciding
 * hits: the middle of the face in world space with heights above the
 * ground, its half sizes across and up, and which way it faces.
 */
export interface TargetFace {
  x: number;
  /** Above the ground, m. */
  y: number;
  z: number;
  halfWidth: number;
  halfHeight: number;
  yaw: number;
}

export function targetFace(i: number): TargetFace {
  const [x, z] = targetFoot(i);
  const board = targetBoard(i);
  return {
    x,
    y: targetMiddleAbove(i),
    z,
    halfWidth: board.width / 2,
    halfHeight: board.height / 2,
    yaw: targetYaw(i),
  };
}

/** The nearest target to (x, z) (world space): which one, and how far away, m. */
export function nearestTarget(x: number, z: number): { index: number; distance: number } {
  let index = 0;
  let distance = Infinity;
  RANGE_TARGETS.forEach((_, i) => {
    const [tx, tz] = targetFoot(i);
    const d = Math.hypot(wrapTile(tx - x), wrapTile(tz - z));
    if (d < distance) {
      index = i;
      distance = d;
    }
  });
  return { index, distance };
}

/**
 * The roads: a dirt road up the driving lane (x ≡ 0 each tile) and one
 * across it through the start (z ≡ 0), laid on the flat corridors the
 * ground leaves for them. The surface stands a little above the ground so
 * its edges read as a road rather than flickering against it (the 8 mm
 * rule, docs/testing.md#z-fighting); the two cross at different heights for
 * the same reason.
 */
export const ROAD = {
  /** The road up the range: half its width and how far its surface stands above the ground, m. */
  halfWidth: 4,
  lift: 0.03,
  /** The road across the start. */
  crossHalfWidth: 3.5,
  crossLift: 0.02,
} as const;

/** Whether (x, z) (world space) is on a road: scatter and props keep off. */
export function onRoad(x: number, z: number): boolean {
  return Math.abs(wrapTile(x)) <= ROAD.halfWidth || Math.abs(wrapTile(z)) <= ROAD.crossHalfWidth;
}

/** Range markers stand every MARKER_SPACING m up the range, out to MARKER_LAST, this far right of the road's middle, m. */
export const MARKER_SPACING = 100;
export const MARKER_LAST = 600;
export const MARKER_ACROSS = 13;
/** A marker post: half its width, how tall it stands and the height of its lowest band, m. */
export const MARKER_POST = { half: 0.06, height: 1.5, firstBand: 0.5, bandHeight: 0.08, bandGap: 0.14 } as const;

/** The ranges the markers stand at, m. */
export const MARKER_RANGES: readonly number[] = (() => {
  const list: number[] = [];
  for (let range = MARKER_SPACING; range <= MARKER_LAST; range += MARKER_SPACING) list.push(range);
  return list;
})();

/** Where the marker for `range` stands: x and z of its foot (world space). */
export function markerFoot(range: number): [number, number] {
  return [MARKER_ACROSS, SIGHT_STAND.z - range];
}

/**
 * The fog (plan §4.7): it hides the drawn ground's edge, keeps the far
 * distance cheap to look at and pushes the crew to talk about what they can
 * make out. Linear, as three.js's `Fog`: nothing is fogged nearer than
 * `near`, everything is sky colour beyond `far`. Its colour is the sky
 * dome's horizon (the scene's DomeGradient equator), so the fogged distance
 * and the sky meet without a seam.
 */
export const FOG = { color: 0xd9e0e6, near: 150, far: 780 } as const;

/** How much of what is `distance` m away is fog, 0 to 1. */
export function fogAmount(distance: number): number {
  const t = (distance - FOG.near) / (FOG.far - FOG.near);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** How far the crew can still make something out, m: where the fog has taken three quarters of it (the plan's "about 600 m"). */
export function sightLimit(): number {
  return FOG.near + 0.75 * (FOG.far - FOG.near);
}

/**
 * Practice (and, from F1.11, a range run's start): where the tank parks on
 * the road to look at target `i` from `distance` m away, as [x, z, heading].
 * It stops on the road's middle short of the target, facing it.
 */
export function viewFrom(i: number, distance: number): [number, number, number] {
  const [tx, tz] = targetFoot(i);
  const z = tz + distance;
  const heading = Math.atan2(-(tx - 0), -(tz - z));
  return [0, z, heading];
}

/**
 * Practice → Up the range: parked 300 m short of the far target, which puts
 * the tank 200 m up the range with the gun target 50 m ahead on its right
 * and the far one deep in the haze — a different look at the range from the
 * one the start gives, and the firing point F1.11's run will use.
 */
export const PRACTICE_VIEW = { target: 2, distance: 300 } as const;

/** The range is about this wide and long, m (plan §4.7): the targets, roads and markers all stand within it. */
export const RANGE_EXTENT = 600;

/** The flat corridors the roads are laid in, m: the ground's own numbers, repeated here for the range's tests. */
export const ROAD_CORRIDORS = { lane: LANE_HALF, cross: CROSS_HALF } as const;
