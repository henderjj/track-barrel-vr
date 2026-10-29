import { Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { PacketType } from '../src/net/pose-codec.js';
import { StateBuffer } from '../src/net/state-buffer.js';
import type { TankHeader } from '../src/net/tank-codec.js';
import { decodeTurretState, encodeTurretState, TURRET_STATE_BYTES } from '../src/net/turret-codec.js';
import { GUN, SEATS, seatToHull, TURRET } from '../src/sim/cabin.js';
import { MAX_TRAVERSE, MAX_TRAVERSE_ACCEL } from '../src/sim/comfort.js';
import { type HandInput, MechEvent, TwistGrip, type Vec3, Wheel } from '../src/sim/mechanism.js';
import { IDLE_RPM, MAX_RPM } from '../src/sim/tank-drive.js';
import {
  barrelDirection,
  copyTurretState,
  CRANK_TRAVERSE_PER_TURN,
  createGunnerInput,
  createTurretState,
  ELEVATION_PER_TURN,
  ELEVATION_WHEEL,
  elevationForWheel,
  extrapolateTurretState,
  lerpTurretState,
  MAX_ELEVATION,
  MIN_ELEVATION,
  MUZZLE_REACH,
  muzzlePoint,
  POWER_GRIP,
  POWER_TRAVERSE_IDLE,
  powerTraverseRate,
  STATION,
  STATION_CONTROLS,
  type StationControl,
  stepTurret,
  TRAVERSE_CRANK,
  TRUNNION,
  type TurretState,
  wheelForElevation,
} from '../src/sim/turret.js';

const DEG = Math.PI / 180;
const DT = 1 / 90;

function run(s: TurretState, traverse: number, rpm: number, seconds: number, each?: (s: TurretState) => void): void {
  const input = createGunnerInput();
  input.traverse = traverse;
  input.elevation = s.elevation;
  for (let t = 0; t < seconds; t += DT) {
    stepTurret(s, input, rpm, DT);
    each?.(s);
  }
}

/** A point in a control's mount space, in turret space (its mount's position and tilt about X). */
function mountToTurret(key: StationControl, p: readonly number[]): Vec3 {
  const { at, tilt } = STATION[key];
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return [at[0] + p[0], at[1] + p[1] * c - p[2] * s, at[2] + p[1] * s + p[2] * c];
}

/** A turret-space point in a control's mount space (the inverse of mountToTurret). */
function turretToMount(key: StationControl, p: readonly number[]): Vec3 {
  const { at, tilt } = STATION[key];
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const y = p[1] - at[1];
  const z = p[2] - at[2];
  return [p[0] - at[0], y * c + z * s, -y * s + z * c];
}

function hand(fist: Vec3, across: Vec3 = [1, 0, 0]): HandInput {
  return { fist, across, tip: null, trigger: 0, tracked: false };
}

describe('turret traverse and gun laying (F1.8)', () => {
  it('traverses faster as the engine revs: 6°/s at idle up to the 24°/s comfort cap at top RPM', () => {
    expect(powerTraverseRate(IDLE_RPM)).toBeCloseTo(POWER_TRAVERSE_IDLE, 6);
    expect(powerTraverseRate(IDLE_RPM) / DEG).toBeCloseTo(6, 6);
    expect(powerTraverseRate(MAX_RPM)).toBeCloseTo(MAX_TRAVERSE, 6);
    expect(powerTraverseRate(500)).toBeCloseTo(POWER_TRAVERSE_IDLE, 6);
    expect(powerTraverseRate(4000)).toBeCloseTo(MAX_TRAVERSE, 6);
    let last = 0;
    for (let rpm = IDLE_RPM; rpm <= MAX_RPM; rpm += 100) {
      expect(powerTraverseRate(rpm)).toBeGreaterThan(last);
      last = powerTraverseRate(rpm);
    }
  });

  it('starts and stops within the comfort caps: never past 24°/s, its rate changing by at most 40°/s²', () => {
    const s = createTurretState();
    let rate = 0;
    let worst = 0;
    const check = (t: TurretState) => {
      worst = Math.max(worst, Math.abs(t.rate - rate) / DT);
      rate = t.rate;
      expect(Math.abs(t.rate)).toBeLessThanOrEqual(MAX_TRAVERSE + 1e-9);
    };
    run(s, 1, MAX_RPM, 2, check);
    expect(s.rate).toBeCloseTo(MAX_TRAVERSE, 6);
    run(s, -1, MAX_RPM, 2, check);
    expect(s.rate).toBeCloseTo(-MAX_TRAVERSE, 6);
    run(s, 0, MAX_RPM, 1, check);
    expect(s.rate).toBe(0);
    expect(worst).toBeLessThanOrEqual(MAX_TRAVERSE_ACCEL + 1e-6);
  });

  it('twisting left turns the turret left (positive), and it goes all the way round', () => {
    const s = createTurretState();
    run(s, 1, IDLE_RPM, 3);
    expect(s.yaw).toBeGreaterThan(0);
    // At idle, about 6°/s once up to speed.
    const before = s.yaw;
    run(s, 1, IDLE_RPM, 1);
    expect(Math.abs((s.yaw - before) / DEG - 6)).toBeLessThan(0.1);
    // A full turn wraps without a jump.
    let wrapped = false;
    let last = s.yaw;
    run(s, 1, MAX_RPM, 20, (t) => {
      if (t.yaw < last) wrapped = true;
      expect(Math.abs(t.yaw)).toBeLessThanOrEqual(Math.PI);
      last = t.yaw;
    });
    expect(wrapped).toBe(true);
  });

  it('half twisted, traverses at half the rate', () => {
    const s = createTurretState();
    run(s, 0.5, MAX_RPM, 2);
    expect(s.rate).toBeCloseTo(MAX_TRAVERSE / 2, 6);
  });

  it('a turn of the crank traverses 2°, anticlockwise to the left, at once', () => {
    const s = createTurretState();
    const input = createGunnerInput();
    input.crank = 2 * Math.PI;
    stepTurret(s, input, IDLE_RPM, DT);
    expect(s.yaw).toBeCloseTo(CRANK_TRAVERSE_PER_TURN, 9);
    expect(s.yaw / DEG).toBeCloseTo(2, 9);
    input.crank = -Math.PI;
    stepTurret(s, input, IDLE_RPM, DT);
    expect(s.yaw / DEG).toBeCloseTo(1, 9);
    expect(s.rate).toBe(0);
  });

  it('the elevation wheel raises the gun clockwise, 3° a turn, and stops at −10° and +20°', () => {
    expect(elevationForWheel(-2 * Math.PI) / DEG).toBeCloseTo(ELEVATION_PER_TURN / DEG, 9);
    expect(elevationForWheel(-2 * Math.PI) / DEG).toBeCloseTo(3, 9);
    expect(elevationForWheel(2 * Math.PI)).toBeCloseTo(-3 * DEG, 9);
    expect(elevationForWheel(-100)).toBe(MAX_ELEVATION);
    expect(elevationForWheel(100)).toBe(MIN_ELEVATION);
    for (const e of [MIN_ELEVATION, -0.05, 0, 0.1, MAX_ELEVATION]) {
      expect(elevationForWheel(wheelForElevation(e))).toBeCloseTo(e, 9);
    }
    // The wheel itself stops where the gun does, so the hand feels the limit.
    expect(elevationForWheel(ELEVATION_WHEEL.min)).toBeCloseTo(MAX_ELEVATION, 9);
    expect(elevationForWheel(ELEVATION_WHEEL.max)).toBeCloseTo(MIN_ELEVATION, 9);
    expect(MAX_ELEVATION / DEG).toBeCloseTo(20, 9);
    expect(MIN_ELEVATION / DEG).toBeCloseTo(-10, 9);
    const s = createTurretState();
    const input = createGunnerInput();
    input.elevation = 1;
    stepTurret(s, input, IDLE_RPM, DT);
    expect(s.elevation).toBe(MAX_ELEVATION);
  });

  it('the elevation handwheel, turned by its handle, lays the gun and stops at its limit', () => {
    const wheel = new Wheel(ELEVATION_WHEEL);
    const r = ELEVATION_WHEEL.radius;
    expect(ELEVATION_WHEEL.grip).toBe('crank');
    // Take the handle at the top and turn it clockwise (as the gunner sees it) a quarter turn, step by step.
    const at = (a: number): Vec3 => [-r * Math.sin(a), r * Math.cos(a), ELEVATION_WHEEL.knobLength / 2];
    expect(wheel.grab(1, hand(at(0)))).toBe(true);
    for (let i = 1; i <= 90; i++) wheel.update(DT, [null, hand(at(-(i * Math.PI) / 180))]);
    for (let i = 0; i < 30; i++) wheel.update(DT, [null, hand(at(-Math.PI / 2))]);
    expect(elevationForWheel(wheel.angle) / DEG).toBeCloseTo(0.75, 1);
    // Far past the top limit, the wheel stops there and the hand strains.
    wheel.angle = ELEVATION_WHEEL.min + 0.1;
    wheel.release(1);
    const knob = wheel.angle;
    wheel.grab(1, hand(at(knob)));
    for (let i = 1; i <= 60; i++) wheel.update(DT, [null, hand(at(knob - (i * 3 * Math.PI) / 180))]);
    expect(wheel.angle).toBe(ELEVATION_WHEEL.min);
    expect(wheel.strain[1]).toBeGreaterThan(0.5);
  });

  it("the trigger bar on the elevation handwheel's handle fires while it is held", () => {
    const wheel = new Wheel(ELEVATION_WHEEL);
    const top: Vec3 = [0, ELEVATION_WHEEL.radius, ELEVATION_WHEEL.knobLength / 2];
    // Not held, a pulled trigger does nothing.
    expect(wheel.update(DT, [null, { ...hand(top), trigger: 1 }]) & MechEvent.Press).toBe(0);
    wheel.grab(1, hand(top));
    expect(wheel.update(DT, [null, { ...hand(top), trigger: 0.5 }]) & MechEvent.Press).toBe(0);
    expect(wheel.update(DT, [null, { ...hand(top), trigger: 0.9 }]) & MechEvent.Press).toBe(MechEvent.Press);
    expect(wheel.firing).toBe(true);
    // Held on, it fires once; eased back past the release point, it lets go.
    expect(wheel.update(DT, [null, { ...hand(top), trigger: 0.5 }])).toBe(MechEvent.None);
    expect(wheel.update(DT, [null, { ...hand(top), trigger: 0.2 }]) & MechEvent.Release).toBe(MechEvent.Release);
    expect(wheel.firing).toBe(false);
    // Let go of the handle with the trigger pulled, it lets go of the trigger too.
    wheel.update(DT, [null, { ...hand(top), trigger: 1 }]);
    wheel.release(1);
    expect(wheel.update(DT, [null, null]) & MechEvent.Release).toBe(MechEvent.Release);
    // The traverse crank has no trigger.
    const crank = new Wheel(TRAVERSE_CRANK);
    crank.grab(1, hand([0, TRAVERSE_CRANK.radius, 0.03]));
    expect(crank.update(DT, [null, { ...hand([0, TRAVERSE_CRANK.radius, 0.03]), trigger: 1 }]) & MechEvent.Press).toBe(0);
  });

  it('the power grip twisted left by hand demands left traverse, and springs back to stop when let go', () => {
    const grip = new TwistGrip(POWER_GRIP);
    const roll = (a: number): Vec3 => [Math.cos(a), 0, -Math.sin(a)];
    grip.grab(1, hand([0, 0.09, 0], roll(0)));
    for (let i = 1; i <= 40; i++) grip.update(DT, [null, hand([0, 0.09, 0], roll((i * Math.PI) / 180))]);
    for (let i = 0; i < 30; i++) grip.update(DT, [null, hand([0, 0.09, 0], roll((40 * Math.PI) / 180))]);
    expect(grip.demand()).toBeCloseTo(1, 1);
    grip.release(1);
    for (let i = 0; i < 90; i++) grip.update(DT, [null, null]);
    expect(grip.demand()).toBe(0);
  });

  it('draws between packets the short way round, and carries on at the traverse rate', () => {
    const a = { ...createTurretState(), yaw: Math.PI - 0.05, crank: Math.PI - 0.1, elevation: 0.1 };
    const b = { ...createTurretState(), yaw: -Math.PI + 0.05, crank: -Math.PI + 0.1, elevation: 0.2 };
    const out = lerpTurretState(a, b, 0.5, createTurretState());
    expect(Math.abs(out.yaw)).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(out.crank)).toBeCloseTo(Math.PI, 6);
    expect(out.elevation).toBeCloseTo(0.15, 9);
    const moving = { ...createTurretState(), yaw: 0.1, rate: 0.4 };
    expect(extrapolateTurretState(moving, 0.1, createTurretState()).yaw).toBeCloseTo(0.14, 9);
  });

  it('points the barrel where Three.js draws it, turret turned and gun elevated', () => {
    for (const [yaw, elevation] of [[0, 0], [0.7, 0.2], [-2.5, -0.15], [Math.PI, 0.05]]) {
      const turret = new Object3D();
      turret.position.set(0, 0, TURRET.z);
      turret.rotation.y = yaw;
      const gun = new Object3D();
      gun.position.set(0, TRUNNION.y, TRUNNION.z);
      gun.rotation.x = elevation;
      turret.add(gun);
      turret.updateMatrixWorld(true);
      const muzzle = gun.localToWorld(new Vector3(0, 0, -MUZZLE_REACH));
      const ours = muzzlePoint(yaw, elevation, [0, 0, 0]);
      for (let i = 0; i < 3; i++) expect(ours[i]).toBeCloseTo(muzzle.toArray()[i], 9);
      const along = muzzle.clone().sub(gun.localToWorld(new Vector3())).normalize();
      const direction = barrelDirection(yaw, elevation, [0, 0, 0]);
      for (let i = 0; i < 3; i++) expect(direction[i]).toBeCloseTo(along.toArray()[i], 9);
    }
    // Straight ahead, level: the muzzle is out in front of the hull on the gun's axis.
    const ahead = muzzlePoint(0, 0, [0, 0, 0]);
    expect(ahead[1]).toBeCloseTo(GUN.y, 9);
    expect(ahead[2]).toBeLessThan(-4.5);
  });
});

describe("the gunner's station (F1.8)", () => {
  const eye = SEATS.gunner.eye;
  /** Where a hand takes hold of each control, turret space. */
  const handles = {
    elevation: [0, 1].map((which) => mountToTurret('elevation', new Wheel(ELEVATION_WHEEL).handle(which as 0 | 1, [0, 0, 0]))),
    crank: [mountToTurret('crank', new Wheel(TRAVERSE_CRANK).handle(1, [0, 0, 0]))],
    twist: [mountToTurret('twist', new TwistGrip(POWER_GRIP).handle(1, [0, 0, 0]))],
  };

  it('puts every handle in reach from the seat: between knee and chest height, 20 to 65 cm ahead of the eyes', () => {
    for (const key of STATION_CONTROLS) {
      for (const p of handles[key]) {
        const below = eye[1] - p[1];
        const ahead = eye[2] - p[2];
        expect(below, `${key} height`).toBeGreaterThan(0.35);
        expect(below, `${key} height`).toBeLessThan(0.8);
        expect(ahead, `${key} ahead`).toBeGreaterThan(0.2);
        expect(ahead, `${key} ahead`).toBeLessThan(0.65);
        expect(Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]), `${key} reach`).toBeLessThan(0.8);
      }
    }
  });

  it('keeps the left-hand wheel left of the eyes and the right-hand controls right of them', () => {
    expect(STATION.elevation.at[0]).toBeLessThan(eye[0]);
    expect(STATION.crank.at[0]).toBeGreaterThan(eye[0]);
    expect(STATION.twist.at[0]).toBeGreaterThan(eye[0]);
  });

  it('keeps the controls far enough apart that a squeeze takes the one meant', () => {
    // A fist in reach of one control's handle is out of reach of the others.
    const crank = new Wheel(TRAVERSE_CRANK);
    const wheel = new Wheel(ELEVATION_WHEEL);
    const grip = new TwistGrip(POWER_GRIP);
    const reach = (key: StationControl, p: Vec3) => {
      const local = turretToMount(key, p);
      const m = key === 'crank' ? crank : key === 'elevation' ? wheel : grip;
      return m.reach(1, hand(local));
    };
    for (const key of STATION_CONTROLS) {
      for (const p of handles[key]) {
        expect(reach(key, p), key).toBeLessThan(0.02);
        for (const other of STATION_CONTROLS) {
          if (other === key) continue;
          expect(reach(other, p), `${key} handle near ${other}`).toBeGreaterThan(0.12);
        }
      }
    }
    // Anywhere round the crank's knob circle, the elevation wheel is out of reach.
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
      crank.angle = a;
      const p = mountToTurret('crank', crank.handle(1, [0, 0, 0]));
      expect(reach('elevation', p)).toBeGreaterThan(0.1);
      expect(reach('twist', p)).toBeGreaterThan(0.1);
    }
  });

  it("keeps the gunner's head clear of the controls, and the elevating breech clear of the elevation wheel", () => {
    const [left, right, forward] = SEATS.gunner.headBox;
    for (const key of STATION_CONTROLS) {
      const [x, y, z] = STATION[key].at;
      // Well below the eyes wherever the head goes in its box.
      const inBoxX = x > eye[0] - left && x < eye[0] + right;
      const inBoxZ = z > eye[2] - forward;
      if (inBoxX && inBoxZ) expect(eye[1] - y).toBeGreaterThan(0.35);
    }
    // The breech's bottom corner at its right side, at every elevation, stays clear of the wheel's rim and its handle's sweep (the trigger bar 2.5 cm out).
    const r = ELEVATION_WHEEL.radius + 0.025;
    for (let e = MIN_ELEVATION; e <= MAX_ELEVATION + 1e-9; e += DEG) {
      for (let back = TURRET.front + 0.08; back <= GUN.breechBack; back += 0.05) {
        // A point along the breech's bottom right edge, in turret space, elevated about the trunnions.
        const dz = back - TRUNNION.z;
        const dy = -0.15;
        const y = TRUNNION.y + dy * Math.cos(e) - dz * Math.sin(e);
        const z = TRUNNION.z + dy * Math.sin(e) + dz * Math.cos(e);
        const local = turretToMount('elevation', [GUN.breechHalfWidth, y, z]);
        const clear = Math.hypot(local[0], local[1]) > r + 0.005 || local[2] < -0.03 || local[2] > ELEVATION_WHEEL.knobLength + 0.01;
        expect(clear, `breech at ${(e / DEG).toFixed(0)}°, z ${z.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('sits in the turret basket, which turns under the gunner', () => {
    for (const key of STATION_CONTROLS) {
      const [x, , z] = STATION[key].at;
      expect(Math.hypot(x, z)).toBeLessThan(TURRET.basketRadius);
      // In hull space it moves with the turret, as the gunner's eyes do.
      const a = seatToHull(SEATS.gunner, 0.8, STATION[key].at, [0, 0, 0]);
      const e = seatToHull(SEATS.gunner, 0.8, eye, [0, 0, 0]);
      expect(Math.hypot(a[0] - e[0], a[2] - e[2])).toBeCloseTo(Math.hypot(x - eye[0], z - eye[2]), 9);
    }
  });
});

describe('turret packets (F1.8)', () => {
  it('uses the packet type set aside for it', () => {
    expect(PacketType.TurretState).toBe(7);
  });

  it('round-trips the turret state, and turns away other packets', () => {
    const s: TurretState = { yaw: -2.7, rate: 0.41, elevation: 0.2345, crank: 3.1, twist: -0.5 };
    const buffer = new ArrayBuffer(TURRET_STATE_BYTES);
    const length = encodeTurretState(buffer, 4321, 98765.4, s);
    expect(length).toBe(TURRET_STATE_BYTES);
    const header: TankHeader = { seq: 0, timeMs: 0 };
    const out = createTurretState();
    expect(decodeTurretState(new DataView(buffer, 0, length), header, out)).toBe(true);
    expect(header).toEqual({ seq: 4321, timeMs: 98765 });
    expect(out.yaw).toBeCloseTo(s.yaw, 4);
    expect(out.crank).toBeCloseTo(s.crank, 4);
    for (const k of ['rate', 'elevation', 'twist'] as const) expect(out[k]).toBeCloseTo(s[k], 4);
    // An angle past half a turn comes back the same way round.
    encodeTurretState(buffer, 1, 0, { ...s, yaw: 4 });
    decodeTurretState(new DataView(buffer), header, out);
    expect(Math.cos(out.yaw - 4)).toBeCloseTo(1, 6);
    new DataView(buffer).setUint8(0, PacketType.TankState);
    expect(decodeTurretState(new DataView(buffer), header, out)).toBe(false);
    expect(decodeTurretState(new DataView(buffer, 0, 9), header, out)).toBe(false);
  });

  it('buffers the turret like the tank: between states, the short way round past half a turn', () => {
    const buffer = new StateBuffer<TurretState>({
      create: createTurretState,
      copy: copyTurretState,
      lerp: lerpTurretState,
      extrapolate: extrapolateTurretState,
    });
    const state = createTurretState();
    for (let i = 0; i < 10; i++) {
      state.yaw = Math.PI - 0.2 + i * 0.05;
      if (state.yaw > Math.PI) state.yaw -= 2 * Math.PI;
      state.rate = 0.05 * 45;
      buffer.push(i * 22, i * 22 + 30, state);
    }
    const out = createTurretState();
    for (const at of [1.5, 3.5, 4.5, 8.5]) {
      buffer.sample(at * 22, out);
      const want = Math.PI - 0.2 + at * 0.05;
      expect(Math.cos(out.yaw - want)).toBeCloseTo(1, 9);
      expect(Math.sin(out.yaw - want)).toBeCloseTo(0, 6);
      expect(Math.abs(out.yaw)).toBeLessThanOrEqual(Math.PI);
    }
    // Past the newest, carried on at the rate for a while.
    buffer.sample(9 * 22 + 100, out);
    expect(buffer.late).toBe(1);
  });
});
