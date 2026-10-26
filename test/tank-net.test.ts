import { describe, expect, it } from 'vitest';
import { PacketType } from '../src/net/pose-codec.js';
import { TankBuffer } from '../src/net/tank-buffer.js';
import {
  decodeDriverControls,
  decodeTankState,
  DRIVER_CONTROLS_BYTES,
  encodeDriverControls,
  encodeTankState,
  TANK_STATE_BYTES,
  TANK_STATE_V1_BYTES,
  type TankHeader,
} from '../src/net/tank-codec.js';
import { createControls, createTankDrive, HIGH, LOW, NEUTRAL } from '../src/sim/tank-drive.js';

describe('tank packets (F1.4)', () => {
  it('uses the packet types set aside for it', () => {
    expect(PacketType.TankState).toBe(5);
    expect(PacketType.DriverControls).toBe(6);
  });

  it('round-trips the tank state', () => {
    const s = createTankDrive(1234.567, -987.654, 7.5);
    Object.assign(s, {
      y: 0.83, pitch: 0.051, roll: -0.033, speed: 8.765, accel: -0.987, yawRate: 0.2345, pitchRate: -0.0123, rollRate: 0.0456,
      leftTrack: 8.1, rightTrack: 9.4, rpm: 2143.6, gear: HIGH, grinding: true, touching: false, bumps: 3, odometer: 4321.5,
      coolant: 81.4, fuel: 0.62,
    });
    const controls = { left: 0.75, right: -0.25, gear: LOW, throttle: 0.3 } as const;
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    const length = encodeTankState(buffer, 65535, 123456.7, s, controls);
    expect(length).toBe(TANK_STATE_BYTES);
    const header: TankHeader = { seq: 0, timeMs: 0 };
    const out = createTankDrive();
    const outControls = createControls();
    expect(decodeTankState(new DataView(buffer, 0, length), header, out, outControls)).toBe(true);
    // The gauges and the controls the host drove by (F1.5).
    expect(out.coolant).toBe(81);
    expect(out.fuel).toBeCloseTo(0.62, 2);
    expect(outControls.left).toBeCloseTo(0.75, 2);
    expect(outControls.right).toBeCloseTo(-0.25, 2);
    expect(outControls.gear).toBe(LOW);
    expect(outControls.throttle).toBeCloseTo(0.3, 2);
    expect(header).toEqual({ seq: 65535, timeMs: 123456 });
    expect(out.x).toBeCloseTo(s.x, 2);
    expect(out.z).toBeCloseTo(s.z, 2);
    expect(out.y).toBeCloseTo(s.y, 5);
    // Within one turn, the same direction.
    expect(Math.cos(out.heading - s.heading)).toBeCloseTo(1, 6);
    expect(Math.abs(out.heading)).toBeLessThanOrEqual(Math.PI);
    for (const k of ['pitch', 'roll', 'yawRate', 'pitchRate', 'rollRate'] as const) expect(out[k]).toBeCloseTo(s[k], 3);
    for (const k of ['speed', 'accel', 'leftTrack', 'rightTrack'] as const) expect(out[k]).toBeCloseTo(s[k], 2);
    expect(out.rpm).toBe(2144);
    expect(out.gear).toBe(HIGH);
    expect(out.grinding).toBe(true);
    expect(out.touching).toBe(false);
    expect(out.bumps).toBe(3);
    expect(out.odometer).toBeCloseTo(4321.5, 2);
  });

  it('still reads an F1.4 tank state, leaving the gauges and controls as they were', () => {
    const s = Object.assign(createTankDrive(), { z: -12.5, rpm: 1500, coolant: 90, fuel: 0.3 });
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    encodeTankState(buffer, 1, 10, s, { left: 1, right: 1, gear: HIGH, throttle: 1 });
    const out = createTankDrive();
    const controls = createControls();
    expect(decodeTankState(new DataView(buffer, 0, TANK_STATE_V1_BYTES), { seq: 0, timeMs: 0 }, out, controls)).toBe(true);
    expect(out.z).toBeCloseTo(-12.5, 3);
    expect(out.rpm).toBe(1500);
    expect(out.coolant).toBe(createTankDrive().coolant);
    expect(out.fuel).toBe(1);
    expect(controls).toEqual(createControls());
  });

  it('round-trips the driver\'s controls, and turns away other packets', () => {
    const c = { left: -0.5, right: 1, gear: NEUTRAL, throttle: 0.4 } as const;
    const buffer = new ArrayBuffer(DRIVER_CONTROLS_BYTES);
    const length = encodeDriverControls(buffer, 7, 1000, c);
    const header: TankHeader = { seq: 0, timeMs: 0 };
    const out = createControls();
    expect(decodeDriverControls(new DataView(buffer, 0, length), header, out)).toBe(true);
    expect(out.left).toBeCloseTo(-0.5, 2);
    expect(out.right).toBe(1);
    expect(out.gear).toBe(NEUTRAL);
    expect(out.throttle).toBeCloseTo(0.4, 2);
    expect(decodeTankState(new DataView(buffer, 0, length), header, createTankDrive())).toBe(false);
  });
});

describe('tank buffer (F1.4)', () => {
  const at = (z: number, speed = 0) => Object.assign(createTankDrive(), { z, speed });

  it('draws between the states either side of the time asked for', () => {
    const b = new TankBuffer();
    b.push(1000, 1050, at(0));
    b.push(1022, 1072, at(-1));
    b.push(1044, 1094, at(-2));
    const out = createTankDrive();
    expect(b.sample(1011, out)).toBe(true);
    expect(out.z).toBeCloseTo(-0.5);
    b.sample(900, out);
    expect(out.z).toBe(0);
    expect(b.transit).toBeCloseTo(50);
  });

  it('drops reordered states, and carries the tank on for a short while past the newest', () => {
    const b = new TankBuffer();
    b.push(1000, 1050, at(0, 2));
    b.push(1044, 1094, at(-0.088, 2));
    b.push(1022, 1100, at(5, 2));
    expect(b.count).toBe(2);
    const out = createTankDrive();
    b.sample(1144, out);
    expect(out.z).toBeCloseTo(-0.288);
    b.sample(5000, out);
    // No further than the longest carry-on (150 ms at 2 m/s).
    expect(out.z).toBeCloseTo(-0.388);
    expect(b.late).toBe(2);
  });

  it('keeps the newest states once full', () => {
    const b = new TankBuffer();
    for (let i = 0; i < 40; i++) b.push(i * 22, i * 22 + 30, at(-i));
    expect(b.count).toBe(16);
    expect(b.newestMs()).toBe(39 * 22);
    const out = createTankDrive();
    b.sample(0, out);
    expect(out.z).toBe(-24);
  });
});
