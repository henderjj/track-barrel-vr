import { Euler, Matrix4, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import {
  aimAt,
  createShotResult,
  describeShot,
  dropAt,
  flyShell,
  GRAVITY,
  type HitFace,
  hullDirToWorld,
  hullToWorld,
  launchAngle,
  MUZZLE_SPEED,
  RANGE_TARGET_NAMES,
  rangeFaces,
  shellAt,
  type Vec3,
  worldDirToHull,
} from '../src/sim/ballistics.js';
import { RANGE_TARGETS } from '../src/sim/range.js';
import { createTankDrive } from '../src/sim/tank-drive.js';
import { TILE } from '../src/sim/terrain.js';
import { barrelDirection, muzzlePoint } from '../src/sim/turret.js';

const flat = () => 0;
/** A 3 m by 2 m board 300 m ahead (-Z) of the origin, 1.5 m up, facing back at it. */
const BOARD: HitFace = { x: 0, y: 1.5, z: -300, halfWidth: 1.5, halfHeight: 1, yaw: 0 };

/** A direction `up` radians above the horizontal, `left` radians left of -Z. */
function dir(up: number, left = 0): Vec3 {
  return [-Math.cos(up) * Math.sin(left), Math.sin(up), -Math.cos(up) * Math.cos(left)];
}

describe('ballistics (F1.10)', () => {
  it('flies a shell on a parabola: the muzzle speed along the bore, falling under gravity', () => {
    const p = shellAt([0, 2, 0], [0, 0, -1], 0.5, [0, 0, 0]);
    expect(p[2]).toBeCloseTo(-MUZZLE_SPEED * 0.5, 9);
    expect(p[1]).toBeCloseTo(2 - 0.5 * GRAVITY * 0.25, 9);
    // About 3.4 m at 500 m: 0.4° of elevation, a bit over an eighth of a handwheel turn.
    expect(dropAt(500)).toBeCloseTo(3.41, 2);
  });

  it('hits a face its path passes through, and says when and where', () => {
    const angle = launchAngle(300, 0);
    const result = flyShell([0, 1.5, 0], dir(angle), [BOARD], createShotResult(), flat);
    expect(result.kind).toBe('target');
    expect(result.target).toBe(0);
    expect(result.point[2]).toBeCloseTo(-300, 1);
    expect(result.point[1]).toBeCloseTo(1.5, 1);
    expect(result.time).toBeCloseTo(300 / (MUZZLE_SPEED * Math.cos(angle)), 4);
  });

  it('misses a face aimed past, landing on the ground beyond, or short when aimed low', () => {
    // Aimed 0.2° down: into the ground about 250 m out, short of the board.
    const low = flyShell([0, 1.5, 0], dir((-0.2 * Math.PI) / 180), [BOARD], createShotResult(), flat);
    expect(low.kind).toBe('ground');
    expect(low.point[2]).toBeLessThan(0);
    expect(low.point[2]).toBeGreaterThan(-300);
    // 2° left: past its edge.
    const wide = flyShell([0, 1.5, 0], dir(launchAngle(300, 0), (2 * Math.PI) / 180), [BOARD], createShotResult(), flat);
    expect(wide.kind).toBe('ground');
    expect(wide.point[2]).toBeLessThan(-300);
    // A face behind the gun is never hit.
    const behind = { ...BOARD, z: 300, yaw: Math.PI };
    expect(flyShell([0, 1.5, 0], dir(launchAngle(300, 0)), [behind], createShotResult(), flat).kind).toBe('ground');
  });

  it('hits the nearest copy of a face on the repeating ground', () => {
    const copy = { ...BOARD, z: BOARD.z + TILE };
    const result = flyShell([0, 1.5, 0], dir(launchAngle(300, 0)), [copy], createShotResult(), flat);
    expect(result.kind).toBe('target');
  });

  it('flies over the edge of the world into nothing when aimed up high', () => {
    const result = flyShell([0, 1.5, 0], dir(0.6), [BOARD], createShotResult(), () => -1e6);
    expect(result.kind).toBe('none');
  });

  it('turns hull space into world space as the drive draws the ground (Euler YXZ)', () => {
    const tank = { ...createTankDrive(12, -40, 0.7), y: 0.4, pitch: 0.05, roll: -0.03 };
    const rotation = new Matrix4().makeRotationFromEuler(new Euler(tank.pitch, tank.heading, tank.roll, 'YXZ'));
    const p = new Vector3(0.4, 2.1, -5.2).applyMatrix4(rotation).add(new Vector3(tank.x, tank.y, tank.z));
    const ours = hullToWorld(tank, [0.4, 2.1, -5.2], [0, 0, 0]);
    expect(ours[0]).toBeCloseTo(p.x, 9);
    expect(ours[1]).toBeCloseTo(p.y, 9);
    expect(ours[2]).toBeCloseTo(p.z, 9);
    const d = hullDirToWorld(tank, [0, 0, -1], [0, 0, 0]);
    const back = worldDirToHull(tank, d, [0, 0, 0]);
    expect(back[0]).toBeCloseTo(0, 9);
    expect(back[1]).toBeCloseTo(0, 9);
    expect(back[2]).toBeCloseTo(-1, 9);
  });

  it('lays the gun from the start onto each range target, and the shell hits it', () => {
    const tank = createTankDrive();
    const faces = rangeFaces();
    faces.forEach((face, i) => {
      const { yaw, elevation } = aimAt(tank, face, muzzlePoint);
      const origin = hullToWorld(tank, muzzlePoint(yaw, elevation, [0, 0, 0]), [0, 0, 0]);
      const d = hullDirToWorld(tank, barrelDirection(yaw, elevation, [0, 0, 0]), [0, 0, 0]);
      const result = flyShell(origin, d, faces, createShotResult());
      expect(result.kind, RANGE_TARGET_NAMES[i]).toBe('target');
      expect(result.target).toBe(i);
      expect(describeShot(result, origin, d, faces, RANGE_TARGET_NAMES)).toBe(`Hit: the ${RANGE_TARGETS[i].range} m ${RANGE_TARGETS[i].kind}`);
    });
  });

  it('says how far a miss went short or over, and left or right', () => {
    const tank = createTankDrive();
    const faces = rangeFaces();
    const far = 2;
    const { yaw, elevation } = aimAt(tank, faces[far], muzzlePoint);
    const shoot = (dYaw: number, dElevation: number) => {
      const origin = hullToWorld(tank, muzzlePoint(yaw + dYaw, elevation + dElevation, [0, 0, 0]), [0, 0, 0]);
      const d = hullDirToWorld(tank, barrelDirection(yaw + dYaw, elevation + dElevation, [0, 0, 0]), [0, 0, 0]);
      const result = flyShell(origin, d, faces, createShotResult());
      return describeShot(result, origin, d, faces, RANGE_TARGET_NAMES);
    };
    // Laid 0.3° low it lands short; to the right (negative yaw) it lands right.
    expect(shoot(0, (-0.3 * Math.PI) / 180)).toMatch(/^Miss the 500 m tank: \d+ m short/);
    expect(shoot((-0.4 * Math.PI) / 180, 0)).toMatch(/^Miss the 500 m tank: .*\d+ m right$/);
    expect(shoot((0.4 * Math.PI) / 180, 0)).toMatch(/left$/);
  });
});
