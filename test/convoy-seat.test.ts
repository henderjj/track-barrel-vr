import { describe, expect, it } from 'vitest';
import { DRIVER_HATCH, EYE_CLEARANCE, frontAt, HULL, SEATS } from '../src/sim/cabin.js';
import {
  CONVOY_BACK,
  CONVOY_FADE_SECONDS,
  CONVOY_GRIP,
  CONVOY_GRIP_DROP,
  CONVOY_GRIP_OFFSET,
  CONVOY_RAISE,
  CONVOY_SEAT,
  type ConvoyMove,
  eyesFromLid,
  LID_ASIDE,
  SEAT_LEVER_PULL,
  SEAT_LEVER_RESET,
  seatAs,
  seatLeverPivot,
  seatLeverPulled,
  stepConvoyMove,
} from '../src/sim/convoy-seat.js';
import { DRIVER_CONTROLS, DRIVER_TILLER, GEAR_LEVER, PANEL } from '../src/sim/driver-station.js';
import { type HandInput, Lever, type Vec3 } from '../src/sim/mechanism.js';
import { DRIVER_PERISCOPE } from '../src/sim/periscope.js';
import { TURRET_DIAL } from '../src/sim/turret-dial.js';

const DEG = Math.PI / 180;
const hand = (x: number, y: number, z: number): HandInput => ({ fist: [x, y, z], across: [1, 0, 0], tip: null, trigger: 0, tracked: false });

describe('the convoy position (docs/convoy-seat.md)', () => {
  it('puts the eyes 10 cm over the roof, in the middle of the hatch', () => {
    const eye = CONVOY_SEAT.eye;
    expect(eye[1] - (HULL.roof + HULL.wall)).toBeCloseTo(0.1, 6);
    // About a Sherman seat's travel and a half: our roof is higher over the eyes than a Sherman's.
    expect(CONVOY_RAISE).toBeGreaterThan(0.35);
    expect(CONVOY_RAISE).toBeLessThan(0.45);
    const [hx0, hz0, hx1, hz1] = DRIVER_HATCH;
    expect(eye[0]).toBeCloseTo((hx0 + hx1) / 2, 6);
    expect(eye[2]).toBeGreaterThan(hz0 + 0.2);
    expect(eye[2]).toBeLessThan(hz1 - 0.15);
    expect(seatAs('driver', true)).toBe(CONVOY_SEAT);
    expect(seatAs('driver', false)).toBe(SEATS.driver);
    expect(seatAs('gunner', true)).toBe(SEATS.gunner);
  });

  it('keeps the neck inside the hatch: every edge of the head box clear of the rim', () => {
    const [left, right, forward, back] = CONVOY_SEAT.headBox;
    const eye = CONVOY_SEAT.eye;
    const [hx0, hz0, hx1, hz1] = DRIVER_HATCH;
    for (const room of [left, right, forward, back]) expect(room).toBeGreaterThan(0.1);
    expect(eye[0] - left).toBeGreaterThan(hx0 + 0.06);
    expect(eye[0] + right).toBeLessThan(hx1 - 0.06);
    expect(eye[2] - forward).toBeGreaterThan(hz0 + 0.06);
    expect(eye[2] + back).toBeLessThan(hz1 - 0.06);
  });

  it('moves the seat, the floor and the cushion together', () => {
    for (const i of [0, 1, 2]) {
      const move = [0, CONVOY_RAISE, CONVOY_BACK][i];
      expect(CONVOY_SEAT.eye[i] - SEATS.driver.eye[i]).toBeCloseTo(move, 6);
      expect(CONVOY_SEAT.cushion[i] - SEATS.driver.cushion[i]).toBeCloseTo(move, 6);
    }
    expect(CONVOY_SEAT.floorY - SEATS.driver.floorY).toBeCloseTo(CONVOY_RAISE, 6);
    // The seat's back stays under the roof.
    expect(CONVOY_SEAT.cushion[1] + 0.5).toBeLessThan(HULL.roof - 0.05);
  });

  it('swings the lid aside, flat and clear of the eyes, and lowers the periscope ahead out of the way', () => {
    expect(eyesFromLid()).toBeGreaterThanOrEqual(EYE_CLEARANCE);
    // Lying flat beside the hole, its top under the eyes, nothing standing ahead of them.
    expect(LID_ASIDE.y1).toBeLessThan(CONVOY_SEAT.eye[1]);
    expect(LID_ASIDE.x1).toBeLessThan(DRIVER_HATCH[0]);
    expect(DRIVER_PERISCOPE.head.top).toBeLessThan(CONVOY_SEAT.eye[1] + 0.01);
  });

  it('fades out, moves the seat while black, and fades back in', () => {
    const move: ConvoyMove = { shown: false, t: -1 };
    expect(stepConvoyMove(move, false, 0.1)).toBe(0);
    const dark: number[] = [];
    let flippedAt = -1;
    for (let i = 0; i < 40; i++) {
      dark.push(stepConvoyMove(move, true, 0.02));
      if (flippedAt < 0 && move.shown) flippedAt = i;
    }
    expect(Math.max(...dark)).toBeCloseTo(1, 1);
    expect(dark[flippedAt]).toBeGreaterThan(0.9);
    expect(move.shown).toBe(true);
    expect(move.t).toBe(-1);
    expect(dark[dark.length - 1]).toBe(0);
    // About half a second all told.
    expect(dark.filter((d) => d > 0).length * 0.02).toBeCloseTo(2 * CONVOY_FADE_SECONDS, 1);
  });

  it('moves the seat once per pull of its lever', () => {
    const latch = { pulled: false };
    expect(seatLeverPulled(latch, -5 * DEG)).toBe(false);
    expect(seatLeverPulled(latch, SEAT_LEVER_PULL - 0.01)).toBe(true);
    expect(seatLeverPulled(latch, SEAT_LEVER_PULL - 0.05)).toBe(false);
    expect(seatLeverPulled(latch, SEAT_LEVER_PULL + 0.05)).toBe(false);
    expect(seatLeverPulled(latch, SEAT_LEVER_RESET + 0.01)).toBe(false);
    expect(seatLeverPulled(latch, SEAT_LEVER_PULL - 0.01)).toBe(true);
    // The lever rides with the seat, beside the right thigh.
    const down = seatLeverPivot(false, [0, 0, 0]);
    const up = seatLeverPivot(true, [0, 0, 0]);
    expect(up[1] - down[1]).toBeCloseTo(CONVOY_RAISE, 6);
    expect(down[0]).toBeGreaterThan(SEATS.driver.eye[0] + 0.2);
  });
});

describe('the convoy grips', () => {
  /** The grip's top for a lever at `angle`, hull space. */
  function gripTop(id: 'tillerLeft' | 'tillerRight' | 'gear', angle: number): Vec3 {
    const { spec, pivot } = DRIVER_CONTROLS[id];
    return [
      pivot[0] + CONVOY_GRIP_OFFSET[0],
      pivot[1] + spec.length * Math.cos(angle) + CONVOY_GRIP_OFFSET[1],
      pivot[2] - spec.length * Math.sin(angle) + CONVOY_GRIP_OFFSET[2],
    ];
  }

  it('stand where the hands are with the seat down, a little lower, from the raised eyes', () => {
    for (const id of ['tillerLeft', 'tillerRight'] as const) {
      const down = DRIVER_CONTROLS[id];
      const top = gripTop(id, 0);
      const handleTop = [down.pivot[0], down.pivot[1] + down.spec.length, down.pivot[2]];
      // Seat down: handle under the eyes; convoy: grip under the raised eyes, a little lower.
      const below = SEATS.driver.eye[1] - handleTop[1];
      expect(CONVOY_SEAT.eye[1] - top[1]).toBeCloseTo(below + CONVOY_GRIP_DROP, 6);
      expect(CONVOY_SEAT.eye[2] - top[2]).toBeCloseTo(SEATS.driver.eye[2] - handleTop[2], 6);
      // Between knee and chest height: 35 to 55 cm under the eyes.
      expect(CONVOY_SEAT.eye[1] - top[1]).toBeGreaterThan(0.35);
      expect(CONVOY_SEAT.eye[1] - top[1]).toBeLessThan(0.55);
    }
  });

  it('keep clear of the hood, the instrument box and the turret dial through all their travel', () => {
    const dial = TURRET_DIAL;
    for (const id of ['tillerLeft', 'tillerRight', 'gear'] as const) {
      const spec = id === 'gear' ? GEAR_LEVER : DRIVER_TILLER;
      for (let a = spec.min; a <= spec.max + 1e-9; a += DEG) {
        const top = gripTop(id, a);
        for (const y of [top[1], top[1] - CONVOY_GRIP.gripLength]) {
          // The armour ahead of it.
          expect(top[2] - CONVOY_GRIP.radius - frontAt(y), `${id} at ${(a / DEG).toFixed(0)}°`).toBeGreaterThan(0.01);
        }
        expect(top[1]).toBeLessThan(HULL.roof - 0.1);
        // The dial's case and face, on the hood right of the slit.
        const dx = Math.abs(top[0] - dial.x) - CONVOY_GRIP.radius - dial.radius - dial.rim;
        const dz = top[2] - CONVOY_GRIP.radius - (dial.z + dial.faceGap);
        const over = top[1] - CONVOY_GRIP.gripLength - (dial.y + dial.radius + dial.rim);
        const under = dial.y - dial.radius - dial.rim - top[1];
        expect(dx > 0 || dz > 0 || over > 0 || under > 0, `${id} at ${(a / DEG).toFixed(0)}° meets the dial`).toBe(true);
        // The instrument box sits lower and further forward.
        expect(top[2] > PANEL.centre[2] + 0.1 || Math.abs(top[0] - PANEL.centre[0]) > PANEL.width / 2).toBe(true);
      }
    }
  });

  it('move the lever as the handle would: a hand on the grip pulls it back the same distance', () => {
    const plain = new Lever(DRIVER_TILLER);
    const convoy = new Lever(DRIVER_TILLER);
    convoy.gripOffset = CONVOY_GRIP_OFFSET;
    convoy.offsetGripLength = CONVOY_GRIP.gripLength;
    const plainAt = plain.handle(0, [0, 0, 0]);
    const convoyAt = convoy.handle(0, [0, 0, 0]);
    expect(convoyAt[1] - plainAt[1]).toBeCloseTo(CONVOY_GRIP_OFFSET[1] - CONVOY_GRIP.gripLength / 2 + DRIVER_TILLER.gripLength / 2, 6);
    // In reach on its grip, out of reach on the bare handle.
    const onGrip = hand(convoyAt[0], convoyAt[1], convoyAt[2]);
    expect(convoy.reach(1, onGrip)).toBeLessThan(0.01);
    expect(convoy.reach(1, hand(plainAt[0], plainAt[1], plainAt[2]))).toBeGreaterThan(0.2);
    for (const [lever, at] of [[plain, plainAt], [convoy, convoyAt]] as const) {
      expect(lever.grab(1, hand(at[0], at[1], at[2]))).toBe(true);
      for (let i = 1; i <= 30; i++) lever.update(1 / 60, [null, hand(at[0], at[1], at[2] + 0.1 * (i / 30))]);
    }
    expect(convoy.angle).toBeLessThan(-10 * DEG);
    expect(convoy.angle).toBeCloseTo(plain.angle, 1);
    // The hand is drawn on the grip, upright.
    const point: Vec3 = [0, 0, 0];
    const axis: Vec3 = [0, 0, 0];
    convoy.lock(1, onGrip.fist, point, axis);
    expect(axis).toEqual([0, 1, 0]);
    expect(point[1]).toBeGreaterThan(plainAt[1] + 0.3);
  });
});
