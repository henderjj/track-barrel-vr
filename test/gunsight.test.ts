import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { GUN, SEATS, seatToHull, TURRET } from '../src/sim/cabin.js';
import {
  createLay,
  createSightError,
  EYEPIECE,
  KNUCKLE,
  layOn,
  onRangeAhead,
  RANGE_BACK,
  OBJECTIVE,
  objectivePoint,
  sightError,
  type TankPose,
  worldToHull,
} from '../src/sim/gunsight.js';
import type { Vec3 } from '../src/sim/mechanism.js';
import { PRACTICE_VIEW, RANGE_TARGETS, targetFace, viewFrom } from '../src/sim/range.js';
import { SIGHT_STAND, superelevation, TRUE_HALF_FIELD } from '../src/sim/sight.js';
import { createTankDrive, settle } from '../src/sim/tank-drive.js';
import { TILE, wrapTile } from '../src/sim/terrain.js';
import { ELEVATION_WHEEL, MAX_ELEVATION, MIN_ELEVATION, STATION, TRUNNION } from '../src/sim/turret.js';

const DEG = Math.PI / 180;
const out: Vec3 = [0, 0, 0];

const aim = (i: number) => {
  const face = targetFace(i);
  return { x: face.x, above: face.y, z: face.z };
};

/** A tank settled on the ground at (x, z) facing `heading`, as Practice places it. */
const parked = (x: number, z: number, heading: number): TankPose => settle(createTankDrive(x, z, heading));

describe('the gunsight (F1.9)', () => {
  it('turns world points into hull space as the drive places the ground (its inverse pose)', () => {
    const pose: TankPose = { x: 812.4, y: 1.3, z: -1530.2, heading: 0.7, pitch: 0.04, roll: -0.03 };
    // DriveSystem.placeGround: the ground goes by the inverse of the pose, less whole tiles.
    const matrix = new Matrix4()
      .compose(new Vector3(wrapTile(pose.x), pose.y, wrapTile(pose.z)), new Quaternion().setFromEuler(new Euler(pose.pitch, pose.heading, pose.roll, 'YXZ')), new Vector3(1, 1, 1))
      .invert();
    for (const p of [[820, 2.5, -1600], [700, -0.4, -1500], [812.4, 3, -1530.2]]) {
      worldToHull(pose, p[0], p[1], p[2], out);
      // The ground's own space is world space less whole tiles round the tank.
      const local = new Vector3(wrapTile(pose.x) + p[0] - pose.x, p[1], wrapTile(pose.z) + p[2] - pose.z);
      const drawn = local.applyMatrix4(matrix);
      expect(out[0]).toBeCloseTo(drawn.x, 6);
      expect(out[1]).toBeCloseTo(drawn.y, 6);
      expect(out[2]).toBeCloseTo(drawn.z, 6);
    }
  });

  it("picks the copy of a target on the range the tank is driving up, not the far target's copy behind the start", () => {
    const far = aim(2);
    const copy = { x: 0, above: 0, z: 0 };
    // At the start the 500 m target is 500 m ahead, though its copy a tile on is only 300 m behind.
    onRangeAhead(parked(0, 0, 0), far, copy);
    expect(copy.z).toBe(far.z);
    // Just behind the start line it is still this range.
    expect(onRangeAhead(parked(0, RANGE_BACK - 1, 0), far, copy).z).toBe(far.z);
    // Past the far end, the next range's.
    expect(onRangeAhead(parked(0, -TILE + RANGE_BACK - 1, 0), far, copy).z).toBe(far.z - TILE);
    // Tiles away, across and up: the copy there.
    onRangeAhead(parked(3 * TILE + 5, -5 * TILE - 40, 0), far, copy);
    expect(copy.x).toBe(far.x + 3 * TILE);
    expect(copy.z).toBe(far.z - 5 * TILE);
  });

  it('puts the objective on the gun beside the bore, as the turret and gun draw it', () => {
    for (const [yaw, elevation] of [[0, 0], [0.8, 15 * DEG], [-2.4, MIN_ELEVATION]]) {
      const turret = new Object3D();
      turret.position.set(0, 0, TURRET.z);
      turret.rotation.y = yaw;
      const gun = new Object3D();
      gun.position.set(0, TRUNNION.y, TRUNNION.z);
      gun.rotation.x = elevation;
      turret.add(gun);
      turret.updateMatrixWorld(true);
      const drawn = gun.localToWorld(new Vector3(...OBJECTIVE));
      objectivePoint(yaw, elevation, out);
      expect(out[0]).toBeCloseTo(drawn.x, 9);
      expect(out[1]).toBeCloseTo(drawn.y, 9);
      expect(out[2]).toBeCloseTo(drawn.z, 9);
    }
    // Ahead of the turret's front plate and the mantlet, right of the barrel by the eyepiece's offset, at the bore's height.
    objectivePoint(0, 0, out);
    expect(out[2]).toBeLessThan(TURRET.z + TURRET.front - 0.12);
    expect(out[0]).toBeCloseTo(SIGHT_STAND.x, 9);
    expect(out[1]).toBeCloseTo(GUN.y, 9);
    expect(Math.abs(out[0])).toBeGreaterThan(GUN.barrelRadius + 0.2);
  });

  it('keeps the eyepiece still while the gun elevates: the halves meet on the trunnions\' line', () => {
    // The knuckle is on the trunnions' axis, so the objective half turns about the same line as the gun.
    expect(KNUCKLE[1]).toBe(TRUNNION.y);
    // Inside the front plate's thickness at its front.
    expect(KNUCKLE[2] - 0.05).toBeLessThan(TURRET.front + 0.08);
    expect(KNUCKLE[2] - 0.05).toBeGreaterThan(TURRET.front);
    // The eyepiece is spike S1's, where a seated gunner leans in to it (test/sight.test.ts).
    expect(EYEPIECE[0]).toBe(SIGHT_STAND.x);
    expect(EYEPIECE[2] + TURRET.z).toBeCloseTo(SIGHT_STAND.z, 9);
    expect(EYEPIECE[1]).toBe(SIGHT_STAND.lensHeight);
  });

  it("keeps its arm clear of the breech, the elevation wheel and the gunner's head", () => {
    // The arm (4 cm round) runs at the eyepiece's height and x.
    const armBottom = EYEPIECE[1] - 0.04;
    const armInner = EYEPIECE[0] - 0.04;
    expect(armInner - GUN.breechHalfWidth).toBeGreaterThan(0.1);
    // The elevation handwheel's handle at the top, its trigger bar 2.5 cm out and the handle standing out of the tilted face.
    const tilt = STATION.elevation.tilt;
    const wheelTop = STATION.elevation.at[1] + (ELEVATION_WHEEL.radius + 0.025) * Math.cos(tilt) - ELEVATION_WHEEL.knobLength * Math.sin(tilt);
    expect(armBottom - wheelTop).toBeGreaterThan(0.05);
    // The gunner's head stops before the lens (the seat's head box), so the eye can come to it but not through it.
    const gunner = SEATS.gunner;
    const eye = seatToHull(gunner, 0, gunner.eye, [0, 0, 0]);
    expect(eye[2] - gunner.headBox[2]).toBeGreaterThan(EYEPIECE[2] + TURRET.z);
  });

  it("lays each of the range's targets on its mark from the start: all three within the gun's reach", () => {
    const start = parked(0, 0, 0);
    const lay = createLay();
    const error = createSightError();
    RANGE_TARGETS.forEach((target, i) => {
      layOn(start, aim(i), lay);
      expect(lay.limited).toBe(false);
      // The objective is ahead of the eyepiece the targets are measured from.
      expect(Math.abs(lay.range - target.range)).toBeLessThan(2);
      sightError(start, lay.yaw, lay.elevation, aim(i), error);
      expect(Math.abs(error.across)).toBeLessThan(0.01);
      expect(Math.abs(error.up)).toBeLessThan(0.01);
      // The gun points above the line to the target by the superelevation.
      expect(lay.elevation).toBeGreaterThan(-1 * DEG);
      expect(lay.elevation).toBeLessThan(1 * DEG);
      // Small turns: all three are in the sight's field looking ahead.
      expect(Math.abs(lay.yaw)).toBeLessThan(TRUE_HALF_FIELD);
    });
  });

  it('lays from wherever the tank stands: up the range, turned away, and on a slope', () => {
    const lay = createLay();
    const error = createSightError();
    const [px, pz, ph] = viewFrom(PRACTICE_VIEW.target, PRACTICE_VIEW.distance);
    const places: TankPose[] = [
      parked(px, pz, ph),
      // Past the near target, still facing up the range: the turret turns right round to it.
      parked(6, -300, 0.3),
      // Tilted, as on rough ground.
      { ...parked(-20, -60, 0.4), pitch: 3 * DEG, roll: -2 * DEG, y: 1.1 },
    ];
    for (const pose of places) {
      RANGE_TARGETS.forEach((_, i) => {
        layOn(pose, aim(i), lay);
        if (lay.limited) return;
        sightError(pose, lay.yaw, lay.elevation, aim(i), error);
        expect(Math.abs(error.across)).toBeLessThan(0.01);
        expect(Math.abs(error.up)).toBeLessThan(0.01);
      });
    }
    // Up the range, the far target is 300 m off: laid for 300 m, not its 500 m from the start.
    layOn(places[0], aim(PRACTICE_VIEW.target), lay);
    expect(lay.range).toBeGreaterThan(295);
    expect(lay.range).toBeLessThan(305);
    // Past the near target, the turret turns more than a quarter turn back to it.
    layOn(places[1], aim(0), lay);
    expect(Math.abs(lay.yaw)).toBeGreaterThan(Math.PI / 2);
  });

  it('says when the gun cannot reach: it stops at its limits', () => {
    // Nose hard down on a slope, far target: more than 20° up would be needed.
    const pose: TankPose = { ...parked(0, -380, 0), pitch: -25 * DEG };
    const lay = layOn(pose, aim(2), createLay());
    expect(lay.limited).toBe(true);
    expect(lay.elevation).toBe(MAX_ELEVATION);
  });

  it('measures where a target sits from its mark: right and up in mils', () => {
    const start = parked(0, 0, 0);
    const lay = layOn(start, aim(2), createLay());
    const error = createSightError();
    // The turret 1 mil left: the target moves 1 mil right in the sight.
    sightError(start, lay.yaw + 0.001, lay.elevation, aim(2), error);
    expect(error.across).toBeCloseTo(1, 2);
    expect(error.up).toBeCloseTo(0, 2);
    // The gun 1 mil down: the target moves 1 mil up.
    sightError(start, lay.yaw, lay.elevation - 0.001, aim(2), error);
    expect(error.up).toBeCloseTo(1, 2);
    // Laid straight at it (no superelevation), it sits above its mark by the superelevation.
    sightError(start, lay.yaw, lay.elevation - superelevation(lay.range), aim(2), error);
    expect(error.up).toBeCloseTo(superelevation(lay.range) * 1000, 2);
  });
});
