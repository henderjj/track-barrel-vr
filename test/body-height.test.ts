import { describe, expect, it } from 'vitest';
import {
  clampEyeRaise,
  glide,
  GLIDE_SPEED,
  MAX_EYE_RAISE,
  MAX_RAISE,
  rigOffset,
  SEATED_EYE,
  targetEyeHeight,
  UprightEye,
} from '../src/sim/body-height.js';
import { parseSettings } from '../src/settings.js';
import { SEAT_IDS, SEATS } from '../src/sim/cabin.js';
import { BREECH_MOUTH, gunToTurret, LEVER_CLOSED, leverHandle, RACK_SLOTS } from '../src/sim/loading.js';
import { MAX_ELEVATION, MIN_ELEVATION } from '../src/sim/turret.js';

/** Feed `seconds` of a steady head height at 90 Hz. */
function hold(eye: UprightEye, headY: number, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 90) {
    eye.push(headY, 1 / 90);
  }
}

describe('upright eye height', () => {
  it('is the highest the head has been, so crouching keeps it', () => {
    const eye = new UprightEye();
    hold(eye, 1.65, 3);
    hold(eye, 1.1, 3);
    expect(eye.upright).toBeCloseTo(1.65, 2);
    expect(eye.smoothed).toBeCloseTo(1.1, 2);
  });

  it('barely moves for a quick bob or a one-frame tracking glitch', () => {
    const eye = new UprightEye();
    hold(eye, 1.6, 2);
    eye.push(2.4, 1 / 90);
    hold(eye, 1.6, 1);
    expect(eye.upright).toBeLessThan(1.62);
  });

  it('ignores a headset lying on the floor or lost', () => {
    const eye = new UprightEye();
    hold(eye, 0.05, 1);
    expect(eye.upright).toBeNaN();
    hold(eye, 1.2, 2);
    eye.push(Number.NaN, 1 / 90);
    expect(eye.upright).toBeCloseTo(1.2, 2);
  });
});

describe('rig offset', () => {
  it('puts the eyes on the seat\'s eye point, seated or standing, whoever is wearing the headset', () => {
    for (const seated of [true, false]) {
      const target = targetEyeHeight({ raise: 0, seated });
      expect(target).toBe(SEATED_EYE);
      for (const eye of [1.1, 1.25, 1.6, 1.85]) {
        expect(eye + rigOffset(target, eye)).toBeCloseTo(SEATED_EYE, 6);
      }
    }
  });

  it('raises or drops the eyes as chosen, within 15 cm of the eye point', () => {
    expect(1.2 + rigOffset(targetEyeHeight({ raise: 0.05, seated: true }), 1.2)).toBeCloseTo(SEATED_EYE + 0.05, 6);
    expect(1.2 + rigOffset(targetEyeHeight({ raise: -0.1, seated: true }), 1.2)).toBeCloseTo(SEATED_EYE - 0.1, 6);
    expect(targetEyeHeight({ raise: 0.4, seated: true })).toBeCloseTo(SEATED_EYE + MAX_EYE_RAISE, 6);
  });

  it('keeps a raise on 5 cm steps', () => {
    expect(clampEyeRaise(0.07)).toBe(0.05);
    expect(clampEyeRaise(-0.5)).toBe(-0.15);
    expect(clampEyeRaise(Number.NaN)).toBe(0);
    expect(Object.is(clampEyeRaise(-0.01), -0)).toBe(false);
  });

  it('puts the eyes on either seat\'s eye point, from any chair or standing', () => {
    // The seat system puts the play space's floor on the seat's floor (src/systems/seat-system.ts).
    // Check each control the tank adds for reach from these eyes the same way (knee to chest height).
    for (const id of SEAT_IDS) {
      const seat = SEATS[id];
      for (const eyeInRoom of [1.1, 1.2, 1.3, 1.65]) {
        const eye = seat.floorY + eyeInRoom + rigOffset(targetEyeHeight({ raise: 0, seated: true }), eyeInRoom);
        expect(eye).toBeCloseTo(seat.eye[1], 6);
      }
    }
  });

  it("keeps the gunner's rack, breech and lever in reach from a chair when seated, at every elevation (F1.10)", () => {
    const raised = rigOffset(targetEyeHeight({ raise: 0, seated: true }), 1.2);
    const seat = SEATS.gunner;
    const points: number[][] = RACK_SLOTS.map((slot) => [...slot]);
    for (const e of [MIN_ELEVATION, 0, MAX_ELEVATION]) {
      points.push(gunToTurret(BREECH_MOUTH, e, 0, [0, 0, 0]));
      points.push(gunToTurret(leverHandle(0, [0, 0, 0]), e, 0, [0, 0, 0]));
      points.push(gunToTurret(leverHandle(LEVER_CLOSED, [0, 0, 0]), e, 0, [0, 0, 0]));
    }
    for (const p of points) {
      // Between knee and chest above the real floor, which is the basket floor.
      const y = p[1] - seat.floorY;
      expect(y - raised).toBeGreaterThan(0.45);
      expect(y - raised).toBeLessThan(1.4);
      // Within a seated arm's reach of the eyes, with a little lean at full elevation (the head box allows 24 cm).
      expect(Math.hypot(p[0] - seat.eye[0], p[1] - seat.eye[1], p[2] - seat.eye[2])).toBeLessThan(0.8);
    }
  });

  it('never lifts the rig more than its limit', () => {
    expect(rigOffset(1.8, 0.7)).toBe(MAX_RAISE);
  });

  it('glides to a new offset at a gentle speed', () => {
    expect(glide(0, 0.4, 0.1)).toBeCloseTo(GLIDE_SPEED * 0.1, 6);
    expect(glide(0.39, 0.4, 0.1)).toBe(0.4);
    expect(glide(0, -0.4, 0.1)).toBeCloseTo(-GLIDE_SPEED * 0.1, 6);
  });
});

describe('height settings', () => {
  it('reads an eye raise and seated or standing play from the URL, seated by default', () => {
    expect(parseSettings('?raise=0.05&seated=0')).toMatchObject({ raise: 0.05, seated: false });
    expect(parseSettings('')).toMatchObject({ raise: 0, seated: true });
    expect(parseSettings('?raise=1').raise).toBe(0.15);
    expect(parseSettings('?raise=-0.12').raise).toBe(-0.1);
  });
});
