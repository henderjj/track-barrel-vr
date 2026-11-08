import { Euler, Quaternion, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { hipPoint, SEATS, seatToHull, type SeatId } from '../src/sim/cabin.js';
import {
  createSeatedBody,
  headAngles,
  MAX_NECK,
  MAX_STRETCH,
  MAX_TWIST,
  MIN_STRETCH,
  NECK_BASE,
  NOD_SHARE,
  solveSeatedBody,
  TORSO_LENGTH,
  TWIST_RATE,
  TWIST_SHARE,
  type SeatedBody,
} from '../src/sim/seated-body.js';

type V3 = [number, number, number];

/**
 * A crewmate's head in `seat` (turret turned `turretYaw`), its neck's base
 * moved `lean` (seat frame) from where it is when they sit up straight, and
 * the head turned on the neck by yaw, pitch and roll from the seat's facing:
 * the eyes go where a real head's would. Returns [eyes, quaternion].
 */
function headIn(seat: SeatId, lean: V3, yaw = 0, pitch = 0, roll = 0, turretYaw = 0): [V3, [number, number, number, number]] {
  const s = SEATS[seat];
  const seatYaw = s.frame === 'turret' ? turretYaw : 0;
  const eye = seatToHull(s, turretYaw, s.eye, [0, 0, 0]);
  const up = new Vector3(0, 1, 0);
  const neckAtRest = new Vector3(...NECK_BASE).applyAxisAngle(up, seatYaw).add(new Vector3(...eye));
  const neck = neckAtRest.add(new Vector3(...lean).applyAxisAngle(up, seatYaw));
  const q = new Quaternion().setFromEuler(new Euler(pitch, seatYaw + yaw, roll, 'YXZ'));
  const nod = new Quaternion().setFromEuler(new Euler(pitch * NOD_SHARE, seatYaw + yaw, roll, 'YXZ'));
  const eyes = neck.sub(new Vector3(...NECK_BASE).applyQuaternion(nod));
  return [eyes.toArray() as V3, [q.x, q.y, q.z, q.w]];
}

function solve(seat: SeatId, lean: V3, yaw = 0, pitch = 0, roll = 0, turretYaw = 0): { body: SeatedBody; hip: V3 } {
  const s = SEATS[seat];
  const hip = seatToHull(s, turretYaw, hipPoint(s, [0, 0, 0]), [0, 0, 0]);
  const [eyes, q] = headIn(seat, lean, yaw, pitch, roll, turretYaw);
  return { body: solveSeatedBody(eyes, q, hip, s.frame === 'turret' ? turretYaw : 0, 0, createSeatedBody()), hip };
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const neckLength = (b: SeatedBody) => dist(b.neckFrom, b.neckTo);
/** The angle between the spine and straight up, rad. */
const tilt = (b: SeatedBody) => Math.acos(b.spine[1]);

describe('the head\'s angles', () => {
  it('match three.js\'s YXZ Euler angles', () => {
    for (const [x, y, z] of [[0.3, 1.2, -0.2], [-0.5, -2.8, 0.4], [0.1, 3.0, 0], [-1.2, 0.5, 0.9]]) {
      const q = new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'));
      const [yaw, pitch, roll] = headAngles(q.x, q.y, q.z, q.w, [0, 0, 0]);
      expect(pitch).toBeCloseTo(x, 6);
      expect(yaw).toBeCloseTo(y, 6);
      expect(roll).toBeCloseTo(z, 6);
    }
  });
});

describe('a seated crewmate\'s body', () => {
  for (const seat of ['driver', 'gunner'] as const) {
    it(`in the ${seat}'s seat, sitting up, keeps its proportions on the hips`, () => {
      const { body, hip } = solve(seat, [0, 0, 0], 0, 0, 0, 0.7);
      expect(dist(body.pivot, hip)).toBeLessThan(1e-9);
      expect(body.stretch).toBeGreaterThan(0.97);
      expect(body.stretch).toBeLessThan(1.05);
      // Nearly upright: the neck's base is a little ahead of the hips.
      expect(tilt(body)).toBeLessThan(0.2);
      expect(body.twist).toBeCloseTo(0, 9);
      expect(neckLength(body)).toBeGreaterThan(0.12);
      expect(neckLength(body)).toBeLessThan(0.2);
    });
  }

  it('bends at the hips to lean in, and stays on them', () => {
    const { body, hip } = solve('driver', [0, -0.06, -0.2], 0, -0.25);
    expect(dist(body.pivot, hip)).toBeLessThan(1e-9);
    // Forwards (-Z) by about 20°.
    expect(body.spine[2]).toBeLessThan(-0.3);
    expect(tilt(body)).toBeGreaterThan(0.25);
    expect(body.stretch).toBeGreaterThan(MIN_STRETCH);
    expect(body.stretch).toBeLessThan(MAX_STRETCH);
  });

  it('leans to the side with the neck carrying on the body\'s line (John\'s note)', () => {
    // 20 cm to the right (+X), the head tilted the same way.
    const { body } = solve('driver', [0.2, -0.04, 0], 0, 0, -0.2);
    expect(body.spine[0]).toBeGreaterThan(0.25);
    const n = [body.neckTo[0] - body.neckFrom[0], body.neckTo[1] - body.neckFrom[1], body.neckTo[2] - body.neckFrom[2]];
    const len = Math.hypot(n[0], n[1], n[2]);
    // The neck leans right too, not back the other way.
    expect(n[0] / len).toBeGreaterThan(0.1);
    // And no sharp kink between the spine and the neck.
    const cos = (n[0] * body.spine[0] + n[1] * body.spine[1] + n[2] * body.spine[2]) / len;
    expect(Math.acos(cos)).toBeLessThan(0.35);
  });

  it('keeps the body still when the head turns on the neck, the shoulders taking a share of the turn', () => {
    const still = solve('gunner', [0, 0, 0], 0, 0, 0, -0.4).body;
    const turned = solve('gunner', [0, 0, 0], 1.22, 0, 0, -0.4).body;
    expect(dist(turned.neckFrom, still.neckFrom)).toBeLessThan(1e-6);
    expect(turned.twist).toBeCloseTo(TWIST_SHARE * 1.22, 6);
    // Looking right over the shoulder, as far as the shoulders go.
    expect(solve('gunner', [0, 0, 0], -2.5, 0, 0, -0.4).body.twist).toBeCloseTo(-MAX_TWIST, 6);
  });

  it('nods without tipping the body much', () => {
    const still = solve('driver', [0, 0, 0]).body;
    const nod = solve('driver', [0, 0, 0], 0, -0.6).body;
    expect(dist(nod.neckFrom, still.neckFrom)).toBeLessThan(1e-6);
    expect(neckLength(nod)).toBeLessThan(MAX_NECK);
  });

  it('stretches only a little for a raised or dropped eye height, the neck taking the rest', () => {
    for (const raise of [-0.15, 0.15]) {
      const { body, hip } = solve('driver', [0, raise, 0]);
      expect(dist(body.pivot, hip)).toBeLessThan(1e-9);
      expect(body.stretch).toBeGreaterThanOrEqual(MIN_STRETCH);
      expect(body.stretch).toBeLessThanOrEqual(MAX_STRETCH);
      expect(neckLength(body)).toBeLessThanOrEqual(MAX_NECK + 1e-9);
    }
  });

  it('rises off the seat after a head that stands up', () => {
    const { body, hip } = solve('driver', [0, 0.5, 0]);
    expect(body.stretch).toBe(MAX_STRETCH);
    expect(neckLength(body)).toBeCloseTo(MAX_NECK, 6);
    expect(body.pivot[1] - hip[1]).toBeGreaterThan(0.2);
  });

  it('swings the shoulders round quickly, not in a jump, when the head turns past straight back', () => {
    const s = SEATS.driver;
    const hip = hipPoint(s, [0, 0, 0]);
    const body = createSeatedBody();
    const [eyesL, qL] = headIn('driver', [0, 0, 0], Math.PI - 0.05);
    solveSeatedBody(eyesL, qL, hip, 0, 0, body);
    expect(body.twist).toBeCloseTo(MAX_TWIST, 6);
    const [eyesR, qR] = headIn('driver', [0, 0, 0], -Math.PI + 0.05);
    const dt = 1 / 72;
    solveSeatedBody(eyesR, qR, hip, 0, dt, body);
    expect(MAX_TWIST - body.twist).toBeCloseTo(TWIST_RATE * dt, 6);
    for (let i = 0; i < 72; i++) solveSeatedBody(eyesR, qR, hip, 0, dt, body);
    expect(body.twist).toBeCloseTo(-MAX_TWIST, 6);
  });

  it('is sized so the torso reaches from the hips to the neck\'s base at rest', () => {
    const s = SEATS.driver;
    const hip = hipPoint(s, [0, 0, 0]);
    const base = [s.eye[0] + NECK_BASE[0], s.eye[1] + NECK_BASE[1], s.eye[2] + NECK_BASE[2]];
    expect(Math.abs(dist(hip, base) - TORSO_LENGTH)).toBeLessThan(0.02);
  });
});
