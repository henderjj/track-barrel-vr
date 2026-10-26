/**
 * The turret's packet on the unreliable channel (F1.8, docs/turret.md),
 * packed by hand with DataView like src/net/tank-codec.ts, and allocation
 * free when given a reusable buffer.
 *
 * TurretState, from the gunner's page (which owns the turret, plan
 * decision 2) to the other at 45 Hz: the turret's turn and traverse rate,
 * the gun's elevation, and the crank's and the power grip's angles so the
 * other page draws the controls (and the gunner's hands on them) where they
 * are. The elevation handwheel's turn follows from the elevation.
 *
 * When the packet grows, decode the old length too (see decodePose).
 */

import { type TurretState, wrapAngle } from '../sim/turret.js';
import { PacketType } from './pose-codec.js';
import type { TankHeader } from './tank-codec.js';

/** Header: type(1) seq(2) time(4). */
const HEADER = 7;
/** TurretState: header, then int16s: yaw and crank (2π over 65534), rate (1e-4 rad/s), elevation and twist (1e-4 rad). */
export const TURRET_STATE_BYTES = HEADER + 10;

const HEADING_SCALE = 32767 / Math.PI;
const ANGLE_SCALE = 1e4;

function int16(v: number): number {
  return v < -32767 ? -32767 : v > 32767 ? 32767 : Math.round(v);
}

/** Write a TurretState packet into `buffer` (at least TURRET_STATE_BYTES long); returns its length. */
export function encodeTurretState(buffer: ArrayBuffer, seq: number, timeMs: number, s: TurretState): number {
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.TurretState);
  view.setUint16(1, seq & 0xffff);
  view.setUint32(3, Math.floor(timeMs) >>> 0);
  view.setInt16(HEADER, int16(wrapAngle(s.yaw) * HEADING_SCALE));
  view.setInt16(HEADER + 2, int16(s.rate * ANGLE_SCALE));
  view.setInt16(HEADER + 4, int16(s.elevation * ANGLE_SCALE));
  view.setInt16(HEADER + 6, int16(wrapAngle(s.crank) * HEADING_SCALE));
  view.setInt16(HEADER + 8, int16(s.twist * ANGLE_SCALE));
  return TURRET_STATE_BYTES;
}

/** Decode a TurretState packet into `out`; returns false if it isn't one. */
export function decodeTurretState(view: DataView, header: TankHeader, out: TurretState): boolean {
  if (view.byteLength < TURRET_STATE_BYTES || view.getUint8(0) !== PacketType.TurretState) {
    return false;
  }
  header.seq = view.getUint16(1);
  header.timeMs = view.getUint32(3);
  out.yaw = view.getInt16(HEADER) / HEADING_SCALE;
  out.rate = view.getInt16(HEADER + 2) / ANGLE_SCALE;
  out.elevation = view.getInt16(HEADER + 4) / ANGLE_SCALE;
  out.crank = view.getInt16(HEADER + 6) / HEADING_SCALE;
  out.twist = view.getInt16(HEADER + 8) / ANGLE_SCALE;
  return true;
}
