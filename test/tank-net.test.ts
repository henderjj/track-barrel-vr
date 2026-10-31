import { describe, expect, it } from 'vitest';
import { PacketType } from '../src/net/pose-codec.js';
import { TankBuffer } from '../src/net/tank-buffer.js';
import {
  decodeDriverControls,
  decodeTankState,
  DRIVER_CONTROLS_BYTES,
  DRIVER_CONTROLS_V1_BYTES,
  DRIVER_CONTROLS_V2_BYTES,
  encodeDriverControls,
  encodeTankState,
  TANK_STATE_BYTES,
  TANK_STATE_V1_BYTES,
  TANK_STATE_V2_BYTES,
  TANK_STATE_V3_BYTES,
  type TankHeader,
} from '../src/net/tank-codec.js';
import { createControls, createTankDrive, type DriverControls, NEUTRAL, REVERSE, TOP_GEAR } from '../src/sim/tank-drive.js';

const controlsOf = (over: Partial<DriverControls>): DriverControls => ({ ...createControls(), ...over });

describe('tank packets (F1.4)', () => {
  it('uses the packet types set aside for it', () => {
    expect(PacketType.TankState).toBe(5);
    expect(PacketType.DriverControls).toBe(6);
  });

  it('round-trips the tank state', () => {
    const s = createTankDrive(1234.567, -987.654, 7.5);
    Object.assign(s, {
      y: 0.83, pitch: 0.051, roll: -0.033, speed: 8.765, accel: -0.987, yawRate: 0.2345, pitchRate: -0.0123, rollRate: 0.0456,
      leftTrack: 8.1, rightTrack: 9.4, rpm: 2143.6, gear: TOP_GEAR, grinding: true, touching: false, bogging: true, bumps: 3, odometer: 4321.5,
      coolant: 81.4, fuel: 0.62,
    });
    const controls = controlsOf({ left: 0.75, right: -0.25, gear: REVERSE, throttle: 0.3, accel: 0.8, clutch: 0.5, mode: 'clutch' });
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
    expect(outControls.gear).toBe(REVERSE);
    expect(outControls.throttle).toBeCloseTo(0.3, 2);
    // The accelerator, the clutch and the gearbox mode (F1.16).
    expect(outControls.accel).toBeCloseTo(0.8, 2);
    expect(outControls.clutch).toBeCloseTo(0.5, 2);
    expect(outControls.mode).toBe('clutch');
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
    expect(out.gear).toBe(TOP_GEAR);
    expect(out.grinding).toBe(true);
    expect(out.bogging).toBe(true);
    expect(out.touching).toBe(false);
    expect(out.bumps).toBe(3);
    expect(out.odometer).toBeCloseTo(4321.5, 2);
  });

  it('still reads an F1.4 tank state, leaving the gauges and controls as they were', () => {
    const s = Object.assign(createTankDrive(), { z: -12.5, rpm: 1500, coolant: 90, fuel: 0.3 });
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    encodeTankState(buffer, 1, 10, s, controlsOf({ left: 1, right: 1, gear: 2, throttle: 1 }));
    const out = createTankDrive();
    const controls = createControls();
    expect(decodeTankState(new DataView(buffer, 0, TANK_STATE_V1_BYTES), { seq: 0, timeMs: 0 }, out, controls)).toBe(true);
    expect(out.z).toBeCloseTo(-12.5, 3);
    expect(out.rpm).toBe(1500);
    expect(out.coolant).toBe(createTankDrive().coolant);
    expect(out.fuel).toBe(1);
    expect(controls).toEqual(createControls());
  });

  it('still reads an F1.5 tank state and driver\'s controls, as the automatic box\'s', () => {
    const s = Object.assign(createTankDrive(), { rpm: 1500, coolant: 90 });
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    encodeTankState(buffer, 1, 10, s, controlsOf({ left: 1, right: 0.5, gear: 2, throttle: 1, accel: 1, clutch: 1, mode: 'stick' }));
    const controls = createControls();
    expect(decodeTankState(new DataView(buffer, 0, TANK_STATE_V2_BYTES), { seq: 0, timeMs: 0 }, createTankDrive(), controls)).toBe(true);
    expect(controls).toEqual(controlsOf({ left: 1, right: controls.right, gear: 2, throttle: 1, start: 'running' }));
    expect(controls.right).toBeCloseTo(0.5, 2);
    const short = new ArrayBuffer(DRIVER_CONTROLS_BYTES);
    encodeDriverControls(short, 1, 10, controlsOf({ left: 1, accel: 1, mode: 'clutch' }));
    const out = createControls();
    expect(decodeDriverControls(new DataView(short, 0, DRIVER_CONTROLS_V1_BYTES), { seq: 0, timeMs: 0 }, out)).toBe(true);
    expect(out.left).toBe(1);
    expect(out.mode).toBe('auto');
    expect(out.accel).toBe(0);
  });

  it('round-trips the engine and its switches (F1.17), and reads an F1.16 packet with the engine left running', () => {
    const s = Object.assign(createTankDrive(), {
      running: false, cranking: true, power: true, rough: false, starterRest: 3, stalls: 258, coughs: 7, stallCause: 'choke' as const,
    });
    const controls = controlsOf({ battery: true, ignition: false, starter: true, choke: 1, siren: true, start: 'full' });
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    expect(encodeTankState(buffer, 1, 10, s, controls)).toBe(TANK_STATE_BYTES);
    const out = createTankDrive();
    const outControls = createControls();
    expect(decodeTankState(new DataView(buffer), { seq: 0, timeMs: 0 }, out, outControls)).toBe(true);
    expect(out.running).toBe(false);
    expect(out.cranking).toBe(true);
    expect(out.power).toBe(true);
    expect(out.starterRest).toBeGreaterThan(0);
    expect(out.stalls).toBe(2);
    expect(out.coughs).toBe(7);
    expect(out.stallCause).toBe('choke');
    expect(outControls).toEqual(controls);
    // The choke knob half out (31 October 2026) has its own bit; a knob between reads as its level.
    for (const [choke, read] of [[0.5, 0.5], [0.6, 0.5], [0.9, 1], [0.1, 0]]) {
      encodeTankState(buffer, 1, 10, s, controlsOf({ choke }));
      decodeTankState(new DataView(buffer), { seq: 0, timeMs: 0 }, out, outControls);
      expect(outControls.choke).toBe(read);
    }
    // F1.16's packets: the engine runs, and the driver's page knew nothing of starting it.
    const old = createTankDrive();
    old.running = false;
    const oldControls = createControls();
    expect(decodeTankState(new DataView(buffer, 0, TANK_STATE_V3_BYTES), { seq: 0, timeMs: 0 }, old, oldControls)).toBe(true);
    expect(old.running).toBe(true);
    expect(oldControls.start).toBe('running');
    expect(oldControls.starter).toBe(false);
    const short = new ArrayBuffer(DRIVER_CONTROLS_BYTES);
    expect(encodeDriverControls(short, 1, 10, controls)).toBe(DRIVER_CONTROLS_BYTES);
    const full = createControls();
    expect(decodeDriverControls(new DataView(short), { seq: 0, timeMs: 0 }, full)).toBe(true);
    expect(full).toEqual(controls);
    const v2 = createControls();
    expect(decodeDriverControls(new DataView(short, 0, DRIVER_CONTROLS_V2_BYTES), { seq: 0, timeMs: 0 }, v2)).toBe(true);
    expect(v2.start).toBe('running');
    expect(v2.siren).toBe(false);
  });

  it('carries the parking brake (F1.18) as a switch bit, both ways, the packets the same length', () => {
    const controls = controlsOf({ parkingBrake: true, battery: true });
    const short = new ArrayBuffer(DRIVER_CONTROLS_BYTES);
    expect(encodeDriverControls(short, 1, 10, controls)).toBe(DRIVER_CONTROLS_BYTES);
    const out = createControls();
    expect(decodeDriverControls(new DataView(short), { seq: 0, timeMs: 0 }, out)).toBe(true);
    expect(out.parkingBrake).toBe(true);
    expect(out.battery).toBe(true);
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    expect(encodeTankState(buffer, 1, 10, createTankDrive(), controls)).toBe(TANK_STATE_BYTES);
    const shown = createControls();
    expect(decodeTankState(new DataView(buffer), { seq: 0, timeMs: 0 }, createTankDrive(), shown)).toBe(true);
    expect(shown.parkingBrake).toBe(true);
    // An F1.16 packet has no switches: the brake reads off.
    const v2 = createControls();
    v2.parkingBrake = true;
    expect(decodeDriverControls(new DataView(short, 0, DRIVER_CONTROLS_V2_BYTES), { seq: 0, timeMs: 0 }, v2)).toBe(true);
    expect(v2.parkingBrake).toBe(false);
  });

  it('round-trips the driver\'s controls, and turns away other packets', () => {
    const c = controlsOf({ left: -0.5, right: 1, gear: NEUTRAL, throttle: 0.4, accel: 0.25, mode: 'stick' });
    const buffer = new ArrayBuffer(DRIVER_CONTROLS_BYTES);
    const length = encodeDriverControls(buffer, 7, 1000, c);
    const header: TankHeader = { seq: 0, timeMs: 0 };
    const out = createControls();
    expect(decodeDriverControls(new DataView(buffer, 0, length), header, out)).toBe(true);
    expect(out.left).toBeCloseTo(-0.5, 2);
    expect(out.right).toBe(1);
    expect(out.gear).toBe(NEUTRAL);
    expect(out.throttle).toBeCloseTo(0.4, 2);
    expect(out.accel).toBeCloseTo(0.25, 2);
    expect(out.mode).toBe('stick');
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
