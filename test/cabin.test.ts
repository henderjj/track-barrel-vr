import { Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import {
  GUN,
  headDrop,
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
  it('keeps each head box inside the armour, clear of the walls by a head\'s width', () => {
    const head = 0.1;
    for (const p of boxCorners('driver', 0)) {
      expect(Math.abs(p[0])).toBeLessThan(HULL.halfWidth - head);
      expect(p[2]).toBeGreaterThan(HULL.front + head);
      expect(p[2]).toBeLessThan(TURRET.z - TURRET.ringRadius);
    }
    // The gunner's box, in turret space, stays inside the turret's walls and right of the breech.
    const gunner = SEATS.gunner;
    const [left, right, forward, back] = gunner.headBox;
    expect(gunner.eye[0] + right).toBeLessThan(TURRET.halfWidth - HULL.wall - head);
    expect(gunner.eye[0] - left).toBeGreaterThan(GUN.breechHalfWidth);
    expect(gunner.eye[2] - forward).toBeGreaterThan(TURRET.front + HULL.wall + head);
    expect(gunner.eye[2] + back).toBeLessThan(TURRET.rear - HULL.wall - head);
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
  const out: [number, number] = [0, 0];

  it('leaves a head inside the box alone', () => {
    for (const id of SEAT_IDS) {
      const eye = seatToHull(SEATS[id], 0, SEATS[id].eye, v3());
      expect(headFix(SEATS[id], 0, eye, out)).toBe('inside');
      expect(out).toEqual([0, 0]);
    }
  });

  it('stops a head leaning past the edge at the edge', () => {
    const seat = SEATS.driver;
    const forward = seat.eye[2] - seat.headBox[2];
    const head = [seat.eye[0], seat.eye[1], forward - 0.1];
    expect(headFix(seat, 0, head, out)).toBe('push');
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBeCloseTo(0.1, 9);
    // Diagonally past a corner: back to the corner.
    const left = seat.eye[0] - seat.headBox[0];
    expect(headFix(seat, 0, [left - 0.05, 1.4, forward - 0.05], out)).toBe('push');
    expect(out[0]).toBeCloseTo(0.05, 9);
    expect(out[1]).toBeCloseTo(0.05, 9);
  });

  it('pushes the gunner\'s head back the right way with the turret turned', () => {
    const seat = SEATS.gunner;
    const yaw = Math.PI / 2;
    // 0.1 m past the box's front edge, in turret space.
    const local = [seat.eye[0], seat.eye[1], seat.eye[2] - seat.headBox[2] - 0.1];
    const head = seatToHull(seat, yaw, local, v3());
    expect(headFix(seat, yaw, head, out)).toBe('push');
    const fixed = seatToHull(seat, yaw, [local[0], local[1], local[2] + 0.1], v3());
    expect(head[0] + out[0]).toBeCloseTo(fixed[0], 9);
    expect(head[2] + out[1]).toBeCloseTo(fixed[2], 9);
  });

  it('puts the player back in the seat when the head is far outside (a recentre)', () => {
    const seat = SEATS.driver;
    expect(headFix(seat, 0, [0, 1.6, 0], out)).toBe('reseat');
    const edge = seat.eye[0] + seat.headBox[1];
    expect(headFix(seat, 0, [edge + RESEAT_DISTANCE - 0.01, 1.4, seat.eye[2]], out)).toBe('push');
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

  it('stops the top of the head just under each seat\'s roof', () => {
    for (const id of SEAT_IDS) {
      const seat = SEATS[id];
      const highestEyes = seat.eye[1] + seat.headUp;
      expect(highestEyes + EYES_BELOW_TOP).toBeLessThan(roofOf(id));
      expect(highestEyes + EYES_BELOW_TOP).toBeGreaterThan(roofOf(id) - 0.05);
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
