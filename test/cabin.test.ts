import { Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import {
  EYE_CLEARANCE,
  headDrop,
  HEAD_FADE_DEPTH,
  headFade,
  headFix,
  HULL,
  hullToSeat,
  otherSeat,
  parseSeat,
  placeInSeat,
  type RigPlace,
  RESEAT_DISTANCE,
  SEAT_IDS,
  SEATS,
  seatingWith,
  seatToHull,
  SIGHT_EYEPIECE,
  swapAgreed,
  SWAP_WAIT_SECONDS,
  TURRET,
} from '../src/sim/cabin.js';
import { EYES_BELOW_TOP, MAX_EYE_RAISE } from '../src/sim/body-height.js';
import { parseSettings } from '../src/settings.js';

const v3 = (): [number, number, number] => [0, 0, 0];

/** The head box's corners in hull space, for a seat and turret angle. */
function boxCorners(id: 'driver' | 'gunner', turretYaw: number): [number, number, number][] {
  const seat = SEATS[id];
  const [left, right, forward, back] = seat.headBox;
  const [x, y, z] = seat.eye;
  return [
    [x - left, y, z - forward],
    [x + right, y, z - forward],
    [x - left, y, z + back],
    [x + right, y, z + back],
  ].map((p) => seatToHull(seat, turretYaw, p, v3()));
}

describe('the cabin', () => {
  it('lets the eyes come up to the walls, the fade starting EYE_CLEARANCE from them (John\'s headset check, 2026-10-31)', () => {
    const e = 1e-9;
    for (const p of boxCorners('driver', 0)) {
      expect(Math.abs(p[0])).toBeLessThanOrEqual(HULL.halfWidth - EYE_CLEARANCE + e);
      expect(p[2]).toBeGreaterThan(HULL.front + EYE_CLEARANCE);
    }
    // The driver's left edge is the wall.
    expect(SEATS.driver.eye[0] - SEATS.driver.headBox[0]).toBeCloseTo(-HULL.halfWidth + EYE_CLEARANCE, 6);
    // The gunner's box, in turret space: its right edge is the turret's wall, and the rest stays inside the turret.
    const gunner = SEATS.gunner;
    const [left, right, forward, back] = gunner.headBox;
    expect(gunner.eye[0] + right).toBeCloseTo(TURRET.halfWidth - HULL.wall - EYE_CLEARANCE, 6);
    expect(gunner.eye[0] - left).toBeGreaterThan(-TURRET.halfWidth + HULL.wall + EYE_CLEARANCE);
    expect(gunner.eye[2] - forward).toBeGreaterThan(TURRET.front + HULL.wall + EYE_CLEARANCE);
    expect(gunner.eye[2] + back).toBeLessThan(TURRET.rear - HULL.wall - EYE_CLEARANCE);
    // Black before the eyes are as near a wall as the near clipping plane (5 cm, iwsdk.config.json).
    expect(EYE_CLEARANCE - HEAD_FADE_DEPTH).toBeGreaterThanOrEqual(0.05 - e);
  });

  it('gives a seated head room under the roof, and lets the gunner lean into the sight', () => {
    // Eyes are 0.13 m below the top of the head (src/sim/body-height.ts).
    expect(HULL.roof - (SEATS.driver.eye[1] + 0.13)).toBeGreaterThan(0.15);
    expect(TURRET.roof - (SEATS.gunner.eye[1] + 0.13)).toBeGreaterThan(0.25);
    const g = SEATS.gunner;
    expect(g.eye[2] - g.headBox[2]).toBeLessThan(SIGHT_EYEPIECE[2] + 0.1);
    expect(Math.abs(SIGHT_EYEPIECE[0] - g.eye[0])).toBeLessThan(g.headBox[0]);
  });

  it('puts the gunner\'s seat in the turret basket, turning with it', () => {
    const gunner = SEATS.gunner;
    expect(Math.hypot(gunner.eye[0], gunner.eye[2])).toBeLessThan(TURRET.basketRadius);
    expect(gunner.floorY).toBe(TURRET.basketFloor);
    const p = seatToHull(gunner, Math.PI / 2, [1, 2, 0], v3());
    // A quarter turn left takes turret +X to hull -Z.
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBe(2);
    expect(p[2]).toBeCloseTo(TURRET.z - 1, 9);
    const back = hullToSeat(gunner, Math.PI / 2, p, v3());
    expect(back[0]).toBeCloseTo(1, 9);
    expect(back[2]).toBeCloseTo(0, 9);
    expect(seatToHull(SEATS.driver, 1, [1, 2, 3], v3())).toEqual([1, 2, 3]);
  });

  it('matches Three.js turning about +Y', () => {
    const turret = new Object3D();
    turret.position.set(0, 0, TURRET.z);
    turret.rotation.y = 0.7;
    const child = new Object3D();
    child.position.set(...SEATS.gunner.eye);
    turret.add(child);
    turret.updateMatrixWorld(true);
    const three = child.getWorldPosition(new Vector3());
    const ours = seatToHull(SEATS.gunner, 0.7, SEATS.gunner.eye, v3());
    expect(ours[0]).toBeCloseTo(three.x, 9);
    expect(ours[2]).toBeCloseTo(three.z, 9);
  });
});

describe('keeping the head in the seat', () => {
  it('fades the view over a few centimetres past the edge, and never pushes the seat', () => {
    expect(headFade(0)).toBe(0);
    expect(headFade(-0.1)).toBe(0);
    expect(headFade(HEAD_FADE_DEPTH / 2)).toBeCloseTo(0.5, 9);
    expect(headFade(HEAD_FADE_DEPTH)).toBe(1);
    expect(headFade(1)).toBe(1);
    // Black well before a head is far enough out to count as a recentre.
    expect(HEAD_FADE_DEPTH).toBeLessThan(RESEAT_DISTANCE / 2);
  });

  const out: [number, number] = [0, 0];

  it('leaves a head inside the box alone', () => {
    for (const id of SEAT_IDS) {
      const eye = seatToHull(SEATS[id], 0, SEATS[id].eye, v3());
      expect(headFix(SEATS[id], 0, eye, out)).toBe('inside');
      expect(out).toEqual([0, 0]);
    }
  });

  it('says how far a head leaning past the edge is out, back to the edge', () => {
    const seat = SEATS.driver;
    const forward = seat.eye[2] - seat.headBox[2];
    const head = [seat.eye[0], seat.eye[1], forward - 0.1];
    expect(headFix(seat, 0, head, out)).toBe('fade');
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBeCloseTo(0.1, 9);
    // Diagonally past a corner: back to the corner.
    const left = seat.eye[0] - seat.headBox[0];
    expect(headFix(seat, 0, [left - 0.05, 1.4, forward - 0.05], out)).toBe('fade');
    expect(out[0]).toBeCloseTo(0.05, 9);
    expect(out[1]).toBeCloseTo(0.05, 9);
  });

  it('measures the gunner\'s head back the right way with the turret turned', () => {
    const seat = SEATS.gunner;
    const yaw = Math.PI / 2;
    // 0.1 m past the box's front edge, in turret space.
    const local = [seat.eye[0], seat.eye[1], seat.eye[2] - seat.headBox[2] - 0.1];
    const head = seatToHull(seat, yaw, local, v3());
    expect(headFix(seat, yaw, head, out)).toBe('fade');
    const fixed = seatToHull(seat, yaw, [local[0], local[1], local[2] + 0.1], v3());
    expect(head[0] + out[0]).toBeCloseTo(fixed[0], 9);
    expect(head[2] + out[1]).toBeCloseTo(fixed[2], 9);
  });

  it('tells a head far outside the box (a recentre) from one leant past the edge', () => {
    const seat = SEATS.driver;
    expect(headFix(seat, 0, [0, 1.6, 0], out)).toBe('reseat');
    const edge = seat.eye[0] + seat.headBox[1];
    expect(headFix(seat, 0, [edge + RESEAT_DISTANCE - 0.01, 1.4, seat.eye[2]], out)).toBe('fade');
    expect(headFix(seat, 0, [edge + RESEAT_DISTANCE + 0.01, 1.4, seat.eye[2]], out)).toBe('reseat');
  });
});

describe('placing a player in a seat', () => {
  it('puts the eyes on the eye point, facing the seat\'s way, wherever they stand in their room', () => {
    const place: RigPlace = { x: 0, z: 0, yaw: 0 };
    for (const id of SEAT_IDS) {
      for (const turretYaw of [0, 0.9]) {
        for (const [hx, hz, headYaw] of [[0, 0, 0], [0.6, -0.8, 1.2], [-1.1, 0.4, -2.5]]) {
          placeInSeat(SEATS[id], turretYaw, hx, hz, headYaw, place);
          const rig = new Object3D();
          rig.position.set(place.x, 0, place.z);
          rig.rotation.y = place.yaw;
          const head = new Object3D();
          head.position.set(hx, 1.45, hz);
          head.rotation.set(0, headYaw, 0, 'YXZ');
          rig.add(head);
          rig.updateMatrixWorld(true);
          const at = head.getWorldPosition(new Vector3());
          const eye = seatToHull(SEATS[id], turretYaw, SEATS[id].eye, v3());
          expect(at.x).toBeCloseTo(eye[0], 9);
          expect(at.z).toBeCloseTo(eye[2], 9);
          const facing = new Vector3(0, 0, -1).applyQuaternion(head.getWorldQuaternion(new Object3D().quaternion));
          const want = SEATS[id].frame === 'turret' ? turretYaw : 0;
          expect(facing.x).toBeCloseTo(-Math.sin(want), 9);
          expect(facing.z).toBeCloseTo(-Math.cos(want), 9);
        }
      }
    }
  });
});

describe('sharing the seats', () => {
  it('gives whoever asks their seat and the other player the other one', () => {
    expect(seatingWith('host', 'driver')).toEqual({ host: 'driver', guest: 'gunner' });
    expect(seatingWith('host', 'gunner')).toEqual({ host: 'gunner', guest: 'driver' });
    expect(seatingWith('guest', 'driver')).toEqual({ host: 'gunner', guest: 'driver' });
    expect(otherSeat('gunner')).toBe('driver');
  });

  it('reads a seat from a URL or an event, and nothing else', () => {
    expect(parseSeat('gunner', 'driver')).toBe('gunner');
    expect(parseSeat('loader', 'driver')).toBe('driver');
    expect(parseSeat(undefined, 'gunner')).toBe('gunner');
    expect(parseSettings('').seat).toBe('driver');
    expect(parseSettings('?seat=gunner').seat).toBe('gunner');
  });
});

describe('the head under the roof (F1.2)', () => {
  const roofOf = (id: 'driver' | 'gunner') => (id === 'driver' ? HULL.roof : TURRET.roof);

  it('lets the eyes rise to EYE_CLEARANCE under each seat\'s roof before the view fades', () => {
    for (const id of SEAT_IDS) {
      const seat = SEATS[id];
      expect(seat.eye[1] + seat.headUp).toBeCloseTo(roofOf(id) - EYE_CLEARANCE, 6);
    }
  });

  it('leaves room to raise the eyes as far as the menu allows, and to sit up a little more', () => {
    for (const id of SEAT_IDS) {
      expect(SEATS[id].headUp).toBeGreaterThan(MAX_EYE_RAISE + 0.04);
    }
  });

  it('lowers the play space only when the head rises past the limit', () => {
    const driver = SEATS.driver;
    expect(headDrop(driver, driver.eye[1])).toBe(0);
    expect(headDrop(driver, driver.eye[1] + driver.headUp)).toBe(0);
    // Standing up out of the chair: 45 cm higher.
    expect(headDrop(driver, driver.eye[1] + 0.45)).toBeCloseTo(driver.headUp - 0.45, 6);
  });
});

describe('swapping seats in a crew (F1.2)', () => {
  it('swaps only when both players asked within the wait', () => {
    expect(swapAgreed({ host: 10, guest: -Infinity }, 11)).toBe(false);
    expect(swapAgreed({ host: 10, guest: 12 }, 12)).toBe(true);
    expect(swapAgreed({ host: 10, guest: 12 + SWAP_WAIT_SECONDS }, 12 + SWAP_WAIT_SECONDS)).toBe(false);
  });
});
