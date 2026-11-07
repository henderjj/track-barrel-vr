import { describe, expect, it } from 'vitest';
import { EYE_CLEARANCE, GLACIS, HULL, SEATS, VISION_SLIT } from '../src/sim/cabin.js';
import { MAX_TRAVERSE, MAX_TRAVERSE_ACCEL } from '../src/sim/comfort.js';
import { SLIT_FRAME } from '../src/sim/driver-station.js';
import type { Vec3 } from '../src/sim/mechanism.js';
import { barrelDirection, createTurretState, wrapAngle } from '../src/sim/turret.js';
import {
  clockHour,
  DIAL_HULL,
  DIAL_POINTER,
  dialToHull,
  hourOnDial,
  hullOnDial,
  pointerAngle,
  slewTurret,
  TURRET_DIAL,
  yawForHour,
} from '../src/sim/turret-dial.js';
import { RUN_CLOCKS } from '../src/scene-assets/range-run.scene-asset.js';

const DEG = Math.PI / 180;
const d = TURRET_DIAL;

/** The case's back rim (hull space), round its edge. */
function caseRim(depth: number): Vec3[] {
  const out: Vec3[] = [];
  const r = d.radius + d.rim;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    out.push(dialToHull([Math.cos(a) * r, Math.sin(a) * r, depth], [0, 0, 0]));
  }
  return out;
}

describe("the driver's turret position dial (F2.3)", () => {
  it('reads the gun\'s direction as the crew\'s clock: 12 ahead, 3 right, 6 behind, 9 left', () => {
    expect(clockHour(0)).toBe(12);
    expect(clockHour(-90 * DEG)).toBe(3);
    expect(clockHour(Math.PI)).toBe(6);
    expect(clockHour(-Math.PI)).toBe(6);
    expect(clockHour(90 * DEG)).toBe(9);
    expect(clockHour(-44 * DEG)).toBe(1);
    expect(clockHour(-46 * DEG)).toBe(2);
    expect(clockHour(14 * DEG)).toBe(12);
    expect(clockHour(16 * DEG)).toBe(11);
    expect(clockHour(4 * Math.PI - 60 * DEG)).toBe(2);
    for (let hour = 1; hour <= 12; hour++) expect(clockHour(yawForHour(hour))).toBe(hour);
    expect(yawForHour(3)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('turns the pointer the way the gun points over the hull drawn nose up', () => {
    // The pointer's tip at rotation.z = a is (−sin a, cos a) on the face; the barrel's direction drawn on the face must match.
    for (const yaw of [0, 30 * DEG, -90 * DEG, 135 * DEG, Math.PI, -170 * DEG]) {
      const a = pointerAngle(yaw);
      const tip = [-Math.sin(a), Math.cos(a)];
      const b: Vec3 = [0, 0, 0];
      barrelDirection(yaw, 0, b);
      const onFace = hullOnDial(b[0], b[2] + 0.2, [0, 0]);
      const len = Math.hypot(onFace[0], onFace[1]);
      expect(tip[0]).toBeCloseTo(onFace[0] / len, 6);
      expect(tip[1]).toBeCloseTo(onFace[1] / len, 6);
    }
    // Turned right (3 o'clock), the tip is on the face's right, by the 3.
    const a = pointerAngle(yawForHour(3));
    const three = hourOnDial(3, 1, [0, 0]);
    expect(-Math.sin(a)).toBeCloseTo(three[0] / d.radius, 6);
    // The hull's nose is up the face.
    expect(hullOnDial(0, DIAL_HULL.front, [0, 0])[1]).toBeGreaterThan(0);
  });

  it('fits the hull, the pointer and the numbers on the face without crowding', () => {
    const r = d.radius;
    const corner = (x: number, z: number) => Math.hypot(...hullOnDial(x, z, [0, 0]));
    const hullReach = Math.max(
      corner(DIAL_HULL.trackHalfWidth, DIAL_HULL.front),
      corner(DIAL_HULL.trackHalfWidth, DIAL_HULL.rear),
    );
    // The hull's corners (between the hours) inside the hour ticks, from 0.8 of the radius out; its nose, tail and
    // sides inside the 12, 6, 3 and 9 (written at 0.71 of the radius, about 0.12 of it tall); the muzzle points at the
    // number it reads without covering it.
    expect(hullReach).toBeLessThan(0.75 * r);
    expect(Math.abs(hullOnDial(0, DIAL_HULL.front, [0, 0])[1])).toBeLessThan(0.62 * r);
    expect(Math.abs(hullOnDial(0, DIAL_HULL.rear, [0, 0])[1])).toBeLessThan(0.62 * r);
    expect(hullOnDial(DIAL_HULL.trackHalfWidth, 0.2, [0, 0])[0]).toBeLessThan(0.62 * r);
    expect(DIAL_POINTER.reach).toBeLessThan(0.71 - 0.1);
    expect(DIAL_POINTER.reach).toBeGreaterThan(0.5);
    // The turret disc is the turret's size on the drawn hull.
    expect(DIAL_POINTER.turretRadius).toBeGreaterThan(0.005);
    expect(DIAL_POINTER.turretRadius).toBeLessThan(0.3 * r);
  });

  it('lies on the hood\'s face right of the slit, the run clock on the left, readable from the seat', () => {
    const eye = SEATS.driver.eye;
    // Right of the slit's frame, clear of it, and under the brow pad.
    const frameRight = VISION_SLIT.x + VISION_SLIT.width / 2 + SLIT_FRAME.inset + SLIT_FRAME.bar;
    const rim = caseRim(0);
    expect(Math.min(...rim.map((p) => p[0]))).toBeGreaterThan(frameRight + 0.01);
    const padBottom = VISION_SLIT.y + VISION_SLIT.height / 2 + SLIT_FRAME.padAbove;
    expect(Math.max(...rim.map((p) => p[1]))).toBeLessThan(padBottom);
    expect(Math.min(...rim.map((p) => p[1]))).toBeGreaterThan(GLACIS.hoodBottom);
    // Inside the hull, clear of its right wall.
    expect(Math.max(...rim.map((p) => p[0]))).toBeLessThan(HULL.halfWidth - 0.2);
    // The run clock (F1.11) on the slit's other side.
    const clock = RUN_CLOCKS.driver;
    expect(clock.x + clock.width / 2).toBeLessThan(VISION_SLIT.x - VISION_SLIT.width / 2);
    expect(d.x).toBeGreaterThan(VISION_SLIT.x);
    // At the eyes' height, 30 to 50 cm from them, and less than 50° off square, as the run clock is.
    const dist = Math.hypot(d.x - eye[0], d.y - eye[1], d.z - eye[2]);
    expect(Math.abs(d.y - eye[1])).toBeLessThan(0.05);
    expect(dist).toBeGreaterThan(0.3);
    expect(dist).toBeLessThan(0.5);
    const n = [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
    const off = Math.acos((n[0] * (eye[0] - d.x) + n[1] * (eye[1] - d.y) + n[2] * (eye[2] - d.z)) / dist);
    const clockOff = Math.atan2(Math.abs(clock.x - eye[0]), eye[2] - clock.z);
    expect(off).toBeLessThan(50 * DEG);
    expect(off).toBeLessThan(clockOff);
    // Readable: 10 cm across at that distance is over 10° of view (a gauge, 7.2 cm at 75 cm, is about 5.5°), even foreshortened.
    expect(((2 * Math.atan(d.radius / dist)) / DEG) * Math.cos(off)).toBeGreaterThan(8);
  });

  it('stands under 2 cm proud of the armour, out of the way of a head leaning into the slit', () => {
    const front = [...caseRim(-d.faceGap), ...caseRim(TURRET_DIAL.pointerGap + 0.001)];
    const back = caseRim(-d.faceGap - d.proud - d.sunk);
    // The case sinks into the hood's face; its front and the pointer stand out of it.
    for (const p of back) expect(p[2]).toBeLessThan(VISION_SLIT.z);
    for (const p of front) expect(p[2]).toBeGreaterThan(VISION_SLIT.z + 0.005);
    // The eyes come no further forward than headBox[2] ahead of the eye point; nothing of the dial within the fade's EYE_CLEARANCE of there.
    const reach = SEATS.driver.eye[2] - SEATS.driver.headBox[2];
    for (const p of front) expect(reach - p[2]).toBeGreaterThan(EYE_CLEARANCE - 0.012);
    expect(d.faceGap).toBeGreaterThanOrEqual(0.003);
    expect(d.pointerGap).toBeGreaterThanOrEqual(0.003);
  });

  it('turns the turret to 3 o\'clock for Practice no faster than the power traverse, and stops on it', () => {
    const s = createTurretState();
    const target = yawForHour(3);
    let t = 0;
    let prevRate = 0;
    let passed = false;
    while (!slewTurret(s, target, 1 / 60) && t < 20) {
      t += 1 / 60;
      expect(Math.abs(s.rate)).toBeLessThanOrEqual(MAX_TRAVERSE + 1e-9);
      expect(Math.abs(s.rate - prevRate)).toBeLessThanOrEqual(MAX_TRAVERSE_ACCEL / 60 + 1e-9);
      prevRate = s.rate;
      if (s.yaw < target - 1e-6) passed = true;
    }
    expect(passed).toBe(false);
    expect(s.yaw).toBe(target);
    expect(s.rate).toBe(0);
    expect(clockHour(s.yaw)).toBe(3);
    // 90° at 24°/s, with the time to speed up and slow down: about 4.4 s.
    expect(t).toBeGreaterThan(3.8);
    expect(t).toBeLessThan(5.5);
  });

  it('goes the short way round, across 180°', () => {
    const s = createTurretState();
    s.yaw = 170 * DEG;
    const target = -170 * DEG;
    let moved = 0;
    for (let i = 0; i < 600 && !slewTurret(s, target, 1 / 60); i++) moved = Math.max(moved, Math.abs(wrapAngle(s.yaw - 170 * DEG)));
    expect(s.yaw).toBeCloseTo(target, 9);
    expect(moved).toBeLessThan(21 * DEG);
  });
});
