import { describe, expect, it } from 'vitest';
import { hullToSeat, SEAT_IDS, SEATS } from '../src/sim/cabin.js';
import { idleLook, restingHand, stepTowards } from '../src/sim/crew-bot.js';

describe('practice crewmate', () => {
  it('rests its hands in front of it, in reach and inside the cabin, in either seat and with the turret turned', () => {
    const hand: [number, number, number] = [0, 0, 0];
    const local: [number, number, number] = [0, 0, 0];
    for (const id of SEAT_IDS) {
      const seat = SEATS[id];
      for (const turretYaw of [0, 1.2]) {
        for (const side of ['left', 'right'] as const) {
          restingHand(seat, turretYaw, side, hand);
          hullToSeat(seat, turretYaw, hand, local);
          const reach = Math.hypot(local[0] - seat.eye[0], local[1] - seat.eye[1], local[2] - seat.eye[2]);
          expect(reach).toBeLessThan(0.75);
          expect(local[2]).toBeLessThan(seat.eye[2]);
          // Between knee and chest height above the seat's floor.
          expect(local[1] - seat.floorY).toBeGreaterThan(0.45);
          expect(local[1] - seat.floorY).toBeLessThan(1.4);
        }
      }
    }
  });

  it('looks about gently, never far from the seat\'s way', () => {
    const look: [number, number] = [0, 0];
    let widest = 0;
    for (let t = 0; t < 60; t += 0.1) {
      idleLook(t, look);
      widest = Math.max(widest, Math.abs(look[0]));
      expect(Math.abs(look[1])).toBeLessThan(0.3);
    }
    expect(widest).toBeGreaterThan(0.2);
    expect(widest).toBeLessThan(0.6);
  });

  it('moves at a limited speed', () => {
    const p: [number, number, number] = [0, 0, 0];
    expect(stepTowards(p, [1, 0, 0], 0.25)).toBeCloseTo(0.75);
    expect(p[0]).toBeCloseTo(0.25);
    expect(stepTowards(p, [1, 0, 0], 1)).toBe(0);
    expect(p[0]).toBe(1);
  });
});
