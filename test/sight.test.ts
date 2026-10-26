import { describe, expect, it } from 'vitest';
import {
  apparentHalfField,
  CLOSE_DISTANCE,
  eyeMask,
  fieldPoint,
  layOnMark,
  MAGNIFICATION,
  OPEN_DISTANCE,
  rangeMarks,
  SIGHT_STAND,
  sightOpen,
  superelevation,
  TRUE_HALF_FIELD,
} from '../src/sim/sight.js';
import { RANGE_TARGETS, targetFoot, targetMiddle } from '../src/sim/range.js';
import { SEATS, seatToHull } from '../src/sim/cabin.js';

const DEG = Math.PI / 180;
const out: [number, number] = [0, 0];

describe('the gunsight (spike S1)', () => {
  it('magnifies: a ray 3° off the axis lands where the camera sees 1°', () => {
    fieldPoint(Math.sin(3 * DEG), 0, -Math.cos(3 * DEG), out);
    expect(out[0]).toBeCloseTo(Math.tan(1 * DEG) / Math.tan(TRUE_HALF_FIELD), 6);
    expect(out[1]).toBeCloseTo(0, 9);
    fieldPoint(0, -Math.sin(9 * DEG), -Math.cos(9 * DEG), out);
    expect(out[1]).toBeCloseTo(-Math.tan(3 * DEG) / Math.tan(TRUE_HALF_FIELD), 6);
  });

  it('puts the edge of the field at about 18° to the eye, whatever the ray length', () => {
    const edge = apparentHalfField();
    expect(edge / DEG).toBeCloseTo(18, 6);
    fieldPoint(Math.sin(edge) * 5, 0, -Math.cos(edge) * 5, out);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(1, 6);
    fieldPoint(0, 0, -1, out);
    expect(out).toEqual([0, 0]);
  });

  it('shows a distant point in the same place to both eyes (the picture is at infinity)', () => {
    // A point straight down the sight, 200 m away, seen through the lens by
    // eyes 3.2 cm either side of the axis, 6 cm behind the lens: the rays
    // are nearly parallel, so both land at the middle of the field.
    for (const eyeX of [-0.032, 0.032]) {
      fieldPoint(0 - eyeX, 0, -200 - 0.06, out);
      expect(Math.abs(out[0])).toBeLessThan(0.002);
    }
  });

  it('opens within 9 cm of the lens and stays open out to 12 cm', () => {
    expect(OPEN_DISTANCE).toBeLessThan(CLOSE_DISTANCE);
    expect(sightOpen(false, 0.08, 0.08)).toBe(true);
    expect(sightOpen(false, 0.1, 0.1)).toBe(false);
    expect(sightOpen(true, 0.1, 0.1)).toBe(true);
    expect(sightOpen(true, 0.13, 0.13)).toBe(false);
    // In front of the sight, however close, it stays shut.
    expect(sightOpen(false, 0.05, -0.02)).toBe(false);
  });

  it('marks ranges from 100 to 1000 m below the middle, further down for further, inside the field', () => {
    const marks = rangeMarks();
    expect(marks.map((m) => m.range)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(marks.filter((m) => m.major).map((m) => m.range)).toEqual([200, 400, 600, 800, 1000]);
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].drop).toBeGreaterThan(marks[i - 1].drop);
    }
    expect(marks[marks.length - 1].drop).toBeLessThan(0.5);
    // At 600 m/s a shell aimed at 500 m must leave about 6.8 mils high.
    expect(superelevation(500) * 1000).toBeCloseTo(6.81, 1);
  });

  it("lays each of the range's targets on its range mark", () => {
    const from = [SIGHT_STAND.x, SIGHT_STAND.lensHeight, SIGHT_STAND.z] as const;
    // The targets are the test range's (F1.7, src/sim/range.ts); where they
    // stand, and that all three show at once, is tested there.
    RANGE_TARGETS.forEach((target, i) => {
      const [x, z] = targetFoot(i);
      const middle = targetMiddle(i);
      const [yaw, pitch] = layOnMark(from, [x, middle, z], target.range, [0, 0]);
      // Straight at it, then up by the superelevation.
      const [, straight] = layOnMark(from, [x, middle, z], 0, [0, 0]);
      expect(pitch - straight).toBeCloseTo(superelevation(target.range), 9);
      expect(Math.abs(yaw)).toBeLessThan(TRUE_HALF_FIELD);
    });
  });

  it('hangs where a seated gunner can lean into it, and their head stops short of the lens', () => {
    const gunner = SEATS.gunner;
    const eye = seatToHull(gunner, 0, gunner.eye, [0, 0, 0]);
    const lean = Math.hypot(SIGHT_STAND.x - eye[0], SIGHT_STAND.lensHeight - eye[1], SIGHT_STAND.z - eye[2]);
    expect(lean).toBeGreaterThan(0.2);
    expect(lean).toBeLessThan(0.35);
    const nearest = seatToHull(gunner, 0, [gunner.eye[0], gunner.eye[1], gunner.eye[2] - gunner.headBox[2]], [0, 0, 0]);
    expect(nearest[2] - SIGHT_STAND.z).toBeGreaterThan(0);
    expect(nearest[2] - SIGHT_STAND.z).toBeLessThan(OPEN_DISTANCE);
    expect(MAGNIFICATION).toBe(3);
  });

  it('picks the eyes to show the picture to', () => {
    expect([eyeMask('left'), eyeMask('right'), eyeMask('both')]).toEqual([1, 2, 3]);
  });
});
