import { describe, expect, it } from 'vitest';
import { GROUND_Y } from '../src/sim/cabin.js';
import {
  FOG,
  fogAmount,
  MARKER_ACROSS,
  MARKER_RANGES,
  markerFoot,
  nearestTarget,
  PRACTICE_VIEW,
  RANGE_EXTENT,
  RANGE_TARGETS,
  ROAD,
  onRoad,
  sightLimit,
  targetBoard,
  targetFace,
  targetFoot,
  targetMiddle,
  targetYaw,
  viewFrom,
} from '../src/sim/range.js';
import { SIGHT_STAND, TRUE_HALF_FIELD } from '../src/sim/sight.js';
import { FOOTPRINT } from '../src/sim/tank-drive.js';
import { CROSS_HALF, groundHeight, LANE_HALF, obstacleDistance, OBSTACLES, TILE } from '../src/sim/terrain.js';

describe('test range (F1.7)', () => {
  it('stands three targets at 100, 250 and 500 m up the range, on flat ground', () => {
    expect(RANGE_TARGETS.map((t) => t.range)).toEqual([100, 250, 500]);
    expect(new Set(RANGE_TARGETS.map((t) => t.kind))).toEqual(new Set(['tank', 'gun']));
    RANGE_TARGETS.forEach((target, i) => {
      const [x, z] = targetFoot(i);
      // The range is measured from the gunner's sight with the tank at its start.
      expect(Math.hypot(x - SIGHT_STAND.x, z - SIGHT_STAND.z)).toBeCloseTo(
        Math.hypot(target.across, target.range),
        6,
      );
      expect(SIGHT_STAND.z - z).toBeCloseTo(target.range, 6);
      // On the flat: the board's posts stand level and the lane is clear ground.
      expect(groundHeight(x, z)).toBe(0);
      expect(Math.abs(x)).toBeLessThan(LANE_HALF);
      // The face's middle, in hull space, is the board lifted off the ground.
      const board = targetBoard(i);
      expect(targetMiddle(i)).toBeCloseTo(GROUND_Y + board.lift + board.height / 2, 9);
      // Well inside the range (plan §4.7), so the fog never swallows a target whole.
      expect(Math.abs(z)).toBeLessThan(RANGE_EXTENT);
    });
  });

  it('shows all three targets at once through the sight, looking straight ahead', () => {
    RANGE_TARGETS.forEach((_, i) => {
      const [x, z] = targetFoot(i);
      const angle = Math.atan2(
        Math.hypot(x - SIGHT_STAND.x, targetMiddle(i) - SIGHT_STAND.lensHeight),
        SIGHT_STAND.z - z,
      );
      expect(angle).toBeLessThan(TRUE_HALF_FIELD * 0.9);
    });
  });

  it('faces each target square to the sight, and gives its face as a box to aim at', () => {
    RANGE_TARGETS.forEach((_, i) => {
      const [x, z] = targetFoot(i);
      const yaw = targetYaw(i);
      // Turned so its face looks back at the sight: the way out of the face is the way to the sight.
      const faceX = Math.sin(yaw);
      const faceZ = Math.cos(yaw);
      const toSight = [SIGHT_STAND.x - x, SIGHT_STAND.z - z];
      const length = Math.hypot(...toSight);
      expect(faceX).toBeCloseTo(toSight[0] / length, 6);
      expect(faceZ).toBeCloseTo(toSight[1] / length, 6);
      const face = targetFace(i);
      const board = targetBoard(i);
      expect(face.halfWidth).toBeCloseTo(board.width / 2);
      expect(face.y - face.halfHeight).toBeCloseTo(board.lift, 9);
      expect(face.yaw).toBe(yaw);
    });
  });

  it('keeps the targets clear of the road the tank drives up, and of the ground\'s obstacles', () => {
    const normal: [number, number] = [0, 0];
    RANGE_TARGETS.forEach((_, i) => {
      const [x, z] = targetFoot(i);
      const board = targetBoard(i);
      // The tank can drive up the road past every target without clipping it.
      expect(Math.abs(x) - board.width / 2).toBeGreaterThan(FOOTPRINT.halfWidth + 1);
      expect(Math.abs(x) - board.width / 2).toBeGreaterThan(ROAD.halfWidth);
      // Nothing of the ground's stands where a target does, or close enough to hide it.
      for (const o of OBSTACLES) expect(obstacleDistance(o, x, z, normal)).toBeGreaterThan(10);
    });
    // And no two targets stand on each other.
    for (let i = 0; i < RANGE_TARGETS.length; i++) {
      for (let j = i + 1; j < RANGE_TARGETS.length; j++) {
        const [ax, az] = targetFoot(i);
        const [bx, bz] = targetFoot(j);
        expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(20);
      }
    }
  });

  it('stands a marker every 100 m out to 600 m, beside the road and off it', () => {
    expect(MARKER_RANGES).toEqual([100, 200, 300, 400, 500, 600]);
    const normal: [number, number] = [0, 0];
    for (const range of MARKER_RANGES) {
      const [x, z] = markerFoot(range);
      expect(x).toBe(MARKER_ACROSS);
      expect(SIGHT_STAND.z - z).toBeCloseTo(range, 6);
      expect(onRoad(x, z)).toBe(false);
      // On the flat lane, so a marker never leans or sinks.
      expect(groundHeight(x, z)).toBe(0);
      expect(Math.abs(x)).toBeLessThan(LANE_HALF);
      for (const o of OBSTACLES) expect(obstacleDistance(o, x, z, normal)).toBeGreaterThan(2);
    }
  });

  it('lays both roads inside the ground\'s flat corridors, the two at different heights', () => {
    expect(ROAD.halfWidth).toBeLessThan(LANE_HALF);
    expect(ROAD.crossHalfWidth).toBeLessThan(CROSS_HALF);
    // Both roads lie on ground that is flat all the way across them.
    for (let d = -ROAD.halfWidth; d <= ROAD.halfWidth; d += 0.5) {
      expect(groundHeight(d, -321)).toBe(0);
      expect(groundHeight(-321, d)).toBe(0);
    }
    // Where they cross, their surfaces are more than the 8 mm apart that faces need.
    expect(Math.abs(ROAD.lift - ROAD.crossLift)).toBeGreaterThanOrEqual(0.008);
    expect(ROAD.crossLift).toBeGreaterThanOrEqual(0.008);
    // On the road up the range, across it, and off both.
    expect(onRoad(0, -250)).toBe(true);
    expect(onRoad(-250, 0)).toBe(true);
    expect(onRoad(60, -250)).toBe(false);
    // The roads repeat with the ground, so a drive of any length stays on them.
    expect(onRoad(TILE, -250)).toBe(true);
  });

  it('fogs the distance so the ground\'s drawn edge is never seen, and the 500 m target still is', () => {
    expect(fogAmount(0)).toBe(0);
    expect(fogAmount(FOG.near)).toBe(0);
    expect(fogAmount(FOG.far)).toBe(1);
    // The plan's "about 600 m": by then three quarters of a target is fog.
    expect(sightLimit()).toBeGreaterThan(550);
    expect(sightLimit()).toBeLessThan(680);
    // The 500 m target is hazy but there to be found; the ground's edge, a tile away, is gone.
    expect(fogAmount(500)).toBeGreaterThan(0.3);
    expect(fogAmount(500)).toBeLessThan(0.7);
    expect(fogAmount(TILE)).toBe(1);
  });

  it('parks the tank on the road facing a target, short of it', () => {
    const [x, z, heading] = viewFrom(PRACTICE_VIEW.target, PRACTICE_VIEW.distance);
    const [tx, tz] = targetFoot(PRACTICE_VIEW.target);
    expect(x).toBe(0);
    expect(z - tz).toBeCloseTo(PRACTICE_VIEW.distance, 6);
    expect(onRoad(x, z)).toBe(true);
    expect(groundHeight(x, z)).toBe(0);
    // Facing it: the tank's forward (-Z turned by the heading) points at the target.
    const forward = [-Math.sin(heading), -Math.cos(heading)];
    const to = [tx - x, tz - z];
    const length = Math.hypot(...to);
    expect(forward[0]).toBeCloseTo(to[0] / length, 6);
    expect(forward[1]).toBeCloseTo(to[1] / length, 6);
    // Close enough to make the target out through the fog, and with another target nearer to hand.
    expect(PRACTICE_VIEW.distance).toBeLessThan(sightLimit());
    const near = nearestTarget(x, z);
    expect(near.index).toBe(1);
    expect(near.distance).toBeLessThan(60);
  });

  it('names the nearest target wherever the tank stands, the same each tile', () => {
    expect(nearestTarget(0, 0).index).toBe(0);
    const [x, z] = targetFoot(2);
    expect(nearestTarget(x, z + 5)).toEqual({ index: 2, distance: 5 });
    // A tile along: the range repeats with the ground, so the same target is nearest.
    expect(nearestTarget(x + TILE, z + 5).index).toBe(2);
  });
});
