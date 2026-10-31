import { describe, expect, it } from 'vitest';
import { MAX_ACCEL } from '../src/sim/comfort.js';
import { PARKING_BRAKE, PARKING_BRAKE_ON, parkingBrakeAngle, parkingBrakeOf } from '../src/sim/driver-station.js';
import { stopEngine } from '../src/sim/engine.js';
import { COAST_DECEL, NEUTRAL } from '../src/sim/gearbox.js';
import { type HandInput, Lever, MechEvent } from '../src/sim/mechanism.js';
import {
  createControls,
  createTankDrive,
  type DriverControls,
  groundUnder,
  ROLL_PULL,
  ROLL_TOP,
  rollPull,
  stepDrive,
  type TankDrive,
} from '../src/sim/tank-drive.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;

function c(over: Partial<DriverControls> = {}): DriverControls {
  return { ...createControls(), ...over };
}

function run(s: TankDrive, controls: DriverControls, seconds: number, each?: (s: TankDrive) => void): TankDrive {
  for (let t = 0; t < seconds; t += DT) {
    stepDrive(s, controls, DT, []);
    each?.(s);
  }
  return s;
}

/** The steepest place on the range facing north, scanned on a 5 m grid: where a tank left in neutral rolls. */
const SLOPE = (() => {
  const g = { height: 0, pitch: 0, roll: 0 };
  let best = { x: 0, z: 0, pitch: 0 };
  for (let x = -150; x <= 150; x += 5) {
    for (let z = -700; z <= 100; z += 5) {
      groundUnder(x, z, 0, g);
      if (Math.abs(g.pitch) > Math.abs(best.pitch)) best = { x, z, pitch: g.pitch };
    }
  }
  return best;
})();

/** A tank on the slope with its engine stopped, at rest. */
function onSlope(): TankDrive {
  const s = createTankDrive(SLOPE.x, SLOPE.z, 0);
  stopEngine(s);
  s.rpm = 0;
  return s;
}

/** A controller hand round the lever's handle at `deg`, its trigger pulled `trigger`. */
function hand(deg: number, trigger = 0): HandInput {
  const r = PARKING_BRAKE.length - PARKING_BRAKE.gripLength / 2;
  return { fist: [0, r * Math.cos(deg * DEG), -r * Math.sin(deg * DEG)], across: [1, 0, 0], tip: null, trigger, tracked: false };
}

/** Move a held lever's hand from `from` to `to` degrees over half a second; the events seen. */
function sweep(lever: Lever, from: number, to: number, trigger = 0): number {
  let events = 0;
  for (let i = 0; i <= 30; i++) {
    const h = hand(from + ((to - from) * i) / 30, trigger);
    events |= lever.update(DT, [h, null]);
  }
  for (let i = 0; i < 30; i++) events |= lever.update(DT, [hand(to, trigger), null]);
  return events;
}

describe('the parking brake (F1.18)', () => {
  it('the range has slopes steep enough to roll on, and the pull on them stays within the comfort cap', () => {
    expect(Math.abs(SLOPE.pitch)).toBeGreaterThan(3 * DEG);
    expect(rollPull(0, 0)).toBeCloseTo(0, 9);
    // Nose up pulls it backwards; on a 1° slope the tracks' drag holds it.
    expect(rollPull(5 * DEG, 0)).toBe(-ROLL_PULL);
    expect(Math.abs(rollPull(1 * DEG, 0))).toBeLessThan(COAST_DECEL);
    expect(ROLL_PULL - COAST_DECEL).toBeLessThanOrEqual(0.4 + 1e-9);
    // Rolling at ROLL_TOP downhill, it gains no more.
    expect(rollPull(5 * DEG, -ROLL_TOP)).toBe(0);
    expect(rollPull(5 * DEG, ROLL_TOP)).toBe(-ROLL_PULL);
  });

  it('with nothing holding it, the tank rolls slowly downhill; on the flat it stays put', () => {
    const s = onSlope();
    let most = 0;
    run(s, c(), 4, (t) => (most = Math.max(most, Math.abs(t.accel))));
    expect(Math.sign(s.speed)).toBe(-Math.sign(SLOPE.pitch));
    expect(Math.abs(s.speed)).toBeGreaterThan(0.3);
    expect(most).toBeLessThanOrEqual(ROLL_PULL - COAST_DECEL + 0.01);

    const flat = createTankDrive();
    stopEngine(flat);
    run(flat, c(), 4);
    expect(flat.speed).toBe(0);
    expect(Math.hypot(flat.x, flat.z)).toBe(0);
  });

  it('holds the tank on the slope: the parking brake, a tiller pulled back, or the engine in gear', () => {
    const braked = run(onSlope(), c({ parkingBrake: true }), 4);
    expect(braked.speed).toBe(0);
    const tiller = run(onSlope(), c({ mode: 'stick', left: -1, right: -1 }), 4);
    expect(tiller.speed).toBe(0);
    // Engine running in gear with the automatic box: it holds still, as before F1.18.
    const s = createTankDrive(SLOPE.x, SLOPE.z, 0);
    run(s, c(), 4);
    expect(Math.abs(s.speed)).toBeLessThan(0.01);
  });

  it('stops a rolling tank within the comfort cap when it goes on', () => {
    const s = run(onSlope(), c(), 4);
    expect(Math.abs(s.speed)).toBeGreaterThan(0.3);
    // Downhill the slope works against it, so it takes a few seconds.
    let most = 0;
    run(s, c({ parkingBrake: true }), 5, (t) => (most = Math.max(most, Math.abs(t.accel))));
    expect(s.speed).toBe(0);
    expect(most).toBeLessThanOrEqual(MAX_ACCEL + 1e-9);
  });

  it('with the automatic box or Stick shift, the tank won\'t move against it, and the engine runs on', () => {
    const auto = run(createTankDrive(), c({ parkingBrake: true, left: 1, right: 1 }), 3);
    expect(auto.speed).toBe(0);
    expect(auto.yawRate).toBe(0);
    expect(auto.running).toBe(true);
    const stick = run(createTankDrive(), c({ parkingBrake: true, mode: 'stick', gear: 2, accel: 1 }), 3);
    expect(stick.speed).toBe(0);
    expect(stick.running).toBe(true);
    // Let off, it pulls away.
    run(auto, c({ left: 1, right: 1 }), 2);
    expect(auto.speed).toBeGreaterThan(1);
  });

  it('with the Clutch, letting the clutch out against it stalls the engine, and says why', () => {
    const s = run(createTankDrive(), c({ parkingBrake: true, mode: 'clutch', gear: 2, clutch: 1 }), 0.5);
    run(s, c({ parkingBrake: true, mode: 'clutch', gear: 2, accel: 0.5 }), 4);
    expect(s.speed).toBe(0);
    expect(s.running).toBe(false);
    expect(s.stallCause).toBe('brake');
    // In neutral the clutch can come out against it.
    const n = run(createTankDrive(), c({ parkingBrake: true, mode: 'clutch', gear: NEUTRAL }), 3);
    expect(n.running).toBe(true);
  });

  it('its lever: pulled up it clicks into the ratchet and stays; pushed down only with the trigger held', () => {
    const lever = new Lever(PARKING_BRAKE);
    expect(parkingBrakeOf(lever.angle)).toBe(false);
    expect(lever.grab(0, hand(35))).toBe(true);
    // Pulled up and back: the ratchet clicks on the way, and the brake is on.
    const up = sweep(lever, 35, 0);
    expect(up & MechEvent.Detent).toBeTruthy();
    expect(lever.angle).toBeLessThan(PARKING_BRAKE_ON);
    expect(parkingBrakeOf(lever.angle)).toBe(true);
    // Pushed down without the trigger: the pawl holds it, and the hand strains.
    const held = lever.angle;
    sweep(lever, 0, 30);
    expect(lever.angle).toBeCloseTo(held, 5);
    expect(lever.overshoot).toBeGreaterThan(20 * DEG);
    // Let go, it stays on.
    lever.release(0);
    lever.update(0.5, [null, null]);
    expect(parkingBrakeOf(lever.angle)).toBe(true);
    // Taken again with the trigger held, it goes down and the brake comes off.
    lever.grab(0, hand(lever.angle / DEG, 1));
    sweep(lever, lever.angle / DEG, 35, 1);
    expect(lever.freed).toBe(true);
    expect(lever.angle).toBeCloseTo(PARKING_BRAKE.max, 2);
    expect(parkingBrakeOf(lever.angle)).toBe(false);
    lever.release(0);
    expect(lever.freed).toBe(false);
    expect(parkingBrakeOf(parkingBrakeAngle(true))).toBe(true);
    expect(parkingBrakeOf(parkingBrakeAngle(false))).toBe(false);
  });
});
