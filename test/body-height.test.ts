import { describe, expect, it } from 'vitest';
import {
  clampCharacterHeight,
  DEFAULT_CHARACTER_HEIGHT,
  EYES_BELOW_TOP,
  glide,
  GLIDE_SPEED,
  MAX_OWN_EYE,
  MAX_RAISE,
  rigOffset,
  SEATED_EYE,
  targetEyeHeight,
  UprightEye,
} from '../src/sim/body-height.js';
import { parseSettings } from '../src/settings.js';
import { SEAT_IDS, SEATS } from '../src/sim/cabin.js';
import { BREECH_MOUTH, LEVER_LENGTH, LEVER_PIVOT, RACK_SLOTS } from '../src/sim/loading.js';

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
  it('leaves a player standing at their own height alone', () => {
    const target = targetEyeHeight({ height: 0, seated: false });
    expect(target).toBeNull();
    expect(rigOffset(target, 1.72)).toBe(0);
    expect(rigOffset(target, 1.2)).toBe(0);
  });

  it('pulls down a floor set far too low', () => {
    expect(rigOffset(null, 2.2)).toBeCloseTo(MAX_OWN_EYE - 2.2, 6);
  });

  it('puts the eyes at a chosen height, whoever is wearing the headset', () => {
    const target = targetEyeHeight({ height: 1.6, seated: false })!;
    expect(target).toBeCloseTo(1.6 - EYES_BELOW_TOP, 6);
    expect(1.75 + rigOffset(target, 1.75)).toBeCloseTo(target, 6);
    expect(1.3 + rigOffset(target, 1.3)).toBeCloseTo(target, 6);
  });

  it('raises a seated player to a little under average eye height, unless they chose a height', () => {
    expect(SEATED_EYE).toBeLessThan(DEFAULT_CHARACTER_HEIGHT - EYES_BELOW_TOP);
    expect(1.15 + rigOffset(targetEyeHeight({ height: 0, seated: true }), 1.15)).toBeCloseTo(SEATED_EYE, 6);
    expect(1.15 + rigOffset(targetEyeHeight({ height: 1.9, seated: true }), 1.15)).toBeCloseTo(1.9 - EYES_BELOW_TOP, 6);
  });

  it('puts a seated player\'s eyes on either seat\'s eye point, from any chair', () => {
    // The seat system puts the play space's floor on the seat's floor (src/systems/seat-system.ts).
    // Check each control the tank adds for reach from these eyes the same way (knee to chest height).
    for (const id of SEAT_IDS) {
      const seat = SEATS[id];
      for (const chairEye of [1.1, 1.2, 1.3]) {
        const eye = seat.floorY + chairEye + rigOffset(targetEyeHeight({ height: 0, seated: true }), chairEye);
        expect(eye).toBeCloseTo(seat.eye[1], 6);
      }
    }
  });

  it('keeps the loading drill in reach from a chair when seated (spike S4)', () => {
    const raised = rigOffset(targetEyeHeight({ height: 0, seated: true }), 1.2);
    const heights = [...RACK_SLOTS.map((slot) => slot[1]), BREECH_MOUTH[1], LEVER_PIVOT[1] + LEVER_LENGTH, LEVER_PIVOT[1]];
    for (const y of heights) {
      expect(y - raised).toBeGreaterThan(0.45);
      expect(y - raised).toBeLessThan(1.4);
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
  it('reads a character height and seated play from the URL, keeping heights in range', () => {
    expect(parseSettings('?height=1.8&seated=1')).toMatchObject({ height: 1.8, seated: true });
    expect(parseSettings('').height).toBe(0);
    expect(parseSettings('?height=3').height).toBe(2);
    expect(parseSettings('?height=0.5').height).toBe(1.4);
    expect(clampCharacterHeight(0)).toBe(0);
  });
});
