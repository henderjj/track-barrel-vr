/**
 * The periscope's packet on the unreliable channel (F1.6, docs/periscope.md),
 * packed by hand with DataView like src/net/turret-codec.ts, and allocation
 * free when given a reusable buffer.
 *
 * PeriscopeState, from the driver's page (which owns the periscope) to the
 * other at 45 Hz: which way the periscope looks, so the other page draws its
 * yoke (and the driver's hands on it) and its head on the roof turned there.
 *
 * When the packet grows, decode the old length too (see decodePose).
 */

import { wrapAngle } from '../sim/turret.js';
import { PacketType } from './pose-codec.js';
import type { TankHeader } from './tank-codec.js';

/** Header: type(1) seq(2) time(4). */
const HEADER = 7;
/** PeriscopeState: header, then the yoke's angle (int16, 2π over 65534). */
export const PERISCOPE_STATE_BYTES = HEADER + 2;

const HEADING_SCALE = 32767 / Math.PI;

/** Write a PeriscopeState packet into `buffer` (at least PERISCOPE_STATE_BYTES long); returns its length. */
export function encodePeriscopeState(buffer: ArrayBuffer, seq: number, timeMs: number, angle: number): number {
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.PeriscopeState);
  view.setUint16(1, seq & 0xffff);
  view.setUint32(3, Math.floor(timeMs) >>> 0);
  const v = Math.round(wrapAngle(angle) * HEADING_SCALE);
  view.setInt16(HEADER, v < -32767 ? -32767 : v > 32767 ? 32767 : v);
  return PERISCOPE_STATE_BYTES;
}

/** Decode a PeriscopeState packet's angle (radians, within ±π), or NaN if it isn't one. */
export function decodePeriscopeState(view: DataView, header: TankHeader): number {
  if (view.byteLength < PERISCOPE_STATE_BYTES || view.getUint8(0) !== PacketType.PeriscopeState) {
    return Number.NaN;
  }
  header.seq = view.getUint16(1);
  header.timeMs = view.getUint32(3);
  return view.getInt16(HEADER) / HEADING_SCALE;
}
