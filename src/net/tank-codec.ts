/**
 * The tank's packets on the unreliable channel (F1.4, docs/tank-drive.md),
 * packed by hand with DataView like src/net/pose-codec.ts, and allocation
 * free when given reusable buffers:
 *
 * - TankState, host → guest at 45 Hz: the tank's pose in world space (the
 *   guest moves its world by its inverse), how it moves, its RPM and
 *   gearbox, and (since F1.5) its gauges and the driver's controls it ran
 *   on, so a guest gunner sees the host driver's levers move.
 * - DriverControls, guest driver → host at 45 Hz: the tillers, the gear
 *   lever and the hand throttle, which the host simulates.
 *
 * When a packet grows, decode the old length too (see decodePose).
 */

import { type DriverControls, type Gear, type TankDrive } from '../sim/tank-drive.js';
import { PacketType } from './pose-codec.js';

/** Header: type(1) seq(2) time(4). */
const HEADER = 7;
/**
 * TankState: header, x, y, z (float32, m), then int16s: heading (2π over
 * 65534), pitch and roll (1e-4 rad), speed and accel (mm/s, mm/s²), yaw,
 * pitch and roll rates (1e-4 rad/s), left and right track (mm/s); RPM
 * (uint16), gear (uint8), flags (uint8: bit 0 grinding, bit 1 touching),
 * bumps (uint16) and odometer (float32, m). F1.5 added: coolant (uint8,
 * °C), fuel (uint8, 0-255), then the driver's controls as in
 * DriverControls (tillers int8, gear lever uint8, throttle uint8).
 */
export const TANK_STATE_BYTES = HEADER + 12 + 20 + 2 + 1 + 1 + 2 + 4 + 2 + 4;
/** F1.4's TankState, without the gauges and controls: still decoded, for a page on the previous build. */
export const TANK_STATE_V1_BYTES = TANK_STATE_BYTES - 6;
/** DriverControls: header, left and right tiller (int8, ±127), gear (uint8), throttle (uint8, 0-255). */
export const DRIVER_CONTROLS_BYTES = HEADER + 4;

const HEADING_SCALE = 32767 / Math.PI;
const ANGLE_SCALE = 1e4;
const MM = 1000;

const FLAG_GRINDING = 1;
const FLAG_TOUCHING = 2;

function int16(v: number): number {
  return v < -32767 ? -32767 : v > 32767 ? 32767 : Math.round(v);
}

/** An angle within (-π, π]. */
function wrapAngle(a: number): number {
  const w = a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  return w <= -Math.PI ? w + 2 * Math.PI : w;
}

export interface TankHeader {
  seq: number;
  timeMs: number;
}

function writeHeader(view: DataView, type: number, seq: number, timeMs: number): void {
  view.setUint8(0, type);
  view.setUint16(1, seq & 0xffff);
  view.setUint32(3, Math.floor(timeMs) >>> 0);
}

function readHeader(view: DataView, header: TankHeader): void {
  header.seq = view.getUint16(1);
  header.timeMs = view.getUint32(3);
}

/**
 * Write a TankState packet into `buffer` (at least TANK_STATE_BYTES long),
 * with the driver's `controls` the host drove it by; returns its length.
 */
export function encodeTankState(buffer: ArrayBuffer, seq: number, timeMs: number, s: TankDrive, controls: DriverControls): number {
  const view = new DataView(buffer);
  writeHeader(view, PacketType.TankState, seq, timeMs);
  let o = HEADER;
  view.setFloat32(o, s.x);
  view.setFloat32(o + 4, s.y);
  view.setFloat32(o + 8, s.z);
  o += 12;
  view.setInt16(o, int16(wrapAngle(s.heading) * HEADING_SCALE));
  view.setInt16(o + 2, int16(s.pitch * ANGLE_SCALE));
  view.setInt16(o + 4, int16(s.roll * ANGLE_SCALE));
  view.setInt16(o + 6, int16(s.speed * MM));
  view.setInt16(o + 8, int16(s.accel * MM));
  view.setInt16(o + 10, int16(s.yawRate * ANGLE_SCALE));
  view.setInt16(o + 12, int16(s.pitchRate * ANGLE_SCALE));
  view.setInt16(o + 14, int16(s.rollRate * ANGLE_SCALE));
  view.setInt16(o + 16, int16(s.leftTrack * MM));
  view.setInt16(o + 18, int16(s.rightTrack * MM));
  o += 20;
  view.setUint16(o, Math.max(0, Math.min(65535, Math.round(s.rpm))));
  view.setUint8(o + 2, s.gear);
  view.setUint8(o + 3, (s.grinding ? FLAG_GRINDING : 0) | (s.touching ? FLAG_TOUCHING : 0));
  view.setUint16(o + 4, s.bumps & 0xffff);
  view.setFloat32(o + 6, s.odometer);
  o += 10;
  view.setUint8(o, Math.max(0, Math.min(255, Math.round(s.coolant))));
  view.setUint8(o + 1, Math.round(Math.max(0, Math.min(1, s.fuel)) * 255));
  writeControls(view, o + 2, controls);
  return o + 6;
}

/**
 * Decode a TankState packet into `out`, and the driver's controls into
 * `controls`; returns false if it isn't one. The heading comes back within
 * (-π, π]: the guest unwraps it against the last one it drew (lerpTankDrive
 * takes the short way round). An F1.4 packet leaves the gauges in `out`
 * and `controls` as they were.
 */
export function decodeTankState(view: DataView, header: TankHeader, out: TankDrive, controls: DriverControls | null = null): boolean {
  if (view.byteLength < TANK_STATE_V1_BYTES || view.getUint8(0) !== PacketType.TankState) {
    return false;
  }
  readHeader(view, header);
  let o = HEADER;
  out.x = view.getFloat32(o);
  out.y = view.getFloat32(o + 4);
  out.z = view.getFloat32(o + 8);
  o += 12;
  out.heading = view.getInt16(o) / HEADING_SCALE;
  out.pitch = view.getInt16(o + 2) / ANGLE_SCALE;
  out.roll = view.getInt16(o + 4) / ANGLE_SCALE;
  out.speed = view.getInt16(o + 6) / MM;
  out.accel = view.getInt16(o + 8) / MM;
  out.yawRate = view.getInt16(o + 10) / ANGLE_SCALE;
  out.pitchRate = view.getInt16(o + 12) / ANGLE_SCALE;
  out.rollRate = view.getInt16(o + 14) / ANGLE_SCALE;
  out.leftTrack = view.getInt16(o + 16) / MM;
  out.rightTrack = view.getInt16(o + 18) / MM;
  o += 20;
  out.rpm = view.getUint16(o);
  out.gear = Math.min(2, view.getUint8(o + 2)) as Gear;
  const flags = view.getUint8(o + 3);
  out.grinding = (flags & FLAG_GRINDING) !== 0;
  out.touching = (flags & FLAG_TOUCHING) !== 0;
  out.bumps = view.getUint16(o + 4);
  out.odometer = view.getFloat32(o + 6);
  out.shiftTimer = 0;
  o += 10;
  if (view.byteLength >= TANK_STATE_BYTES) {
    out.coolant = view.getUint8(o);
    out.fuel = view.getUint8(o + 1) / 255;
    if (controls) readControls(view, o + 2, controls);
  }
  return true;
}

function tiller(v: number): number {
  return Math.round((v < -1 ? -1 : v > 1 ? 1 : v) * 127);
}

function writeControls(view: DataView, o: number, c: DriverControls): void {
  view.setInt8(o, tiller(c.left));
  view.setInt8(o + 1, tiller(c.right));
  view.setUint8(o + 2, c.gear);
  view.setUint8(o + 3, Math.round((c.throttle < 0 ? 0 : c.throttle > 1 ? 1 : c.throttle) * 255));
}

function readControls(view: DataView, o: number, out: DriverControls): void {
  out.left = view.getInt8(o) / 127;
  out.right = view.getInt8(o + 1) / 127;
  out.gear = Math.min(2, view.getUint8(o + 2)) as Gear;
  out.throttle = view.getUint8(o + 3) / 255;
}

/** Write a DriverControls packet into `buffer` (at least DRIVER_CONTROLS_BYTES long); returns its length. */
export function encodeDriverControls(buffer: ArrayBuffer, seq: number, timeMs: number, c: DriverControls): number {
  const view = new DataView(buffer);
  writeHeader(view, PacketType.DriverControls, seq, timeMs);
  writeControls(view, HEADER, c);
  return DRIVER_CONTROLS_BYTES;
}

/** Decode a DriverControls packet into `out`; returns false if it isn't one. */
export function decodeDriverControls(view: DataView, header: TankHeader, out: DriverControls): boolean {
  if (view.byteLength < DRIVER_CONTROLS_BYTES || view.getUint8(0) !== PacketType.DriverControls) {
    return false;
  }
  readHeader(view, header);
  readControls(view, HEADER, out);
  return true;
}
