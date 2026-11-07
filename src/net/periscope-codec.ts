/**
 * The periscope's packet on the unreliable channel (F1.6, docs/periscope.md),
 * packed by hand with DataView like src/net/turret-codec.ts, and allocation
 * free when given a reusable buffer.
 *
 * PeriscopeState, from the driver's page (which owns the driver's
 * periscope) to the other at 45 Hz: which way it looks, so the other page
 * draws its crank (and the driver's hand on it) and its head on the roof
 * turned there. GunnerPeriscopeState (F1.19) is the same from the gunner's
 * page for the gunner's periscope; it has a type of its own so a page on
 * an older build, which knows only the driver's, leaves it alone.
 *
 * When the packet grows, decode the old length too (see decodePose).
 */

import { wrapAngle } from '../sim/turret.js';
import { PacketType } from './pose-codec.js';

/** The two periscopes' packet types. */
export type PeriscopePacket = typeof PacketType.PeriscopeState | typeof PacketType.GunnerPeriscopeState;
import type { TankHeader } from './tank-codec.js';

/** Header: type(1) seq(2) time(4). */
const HEADER = 7;
/** PeriscopeState: header, then the periscope's angle (int16, 2π over 65534). */
export const PERISCOPE_STATE_BYTES = HEADER + 2;

const HEADING_SCALE = 32767 / Math.PI;

/** Write a periscope's packet (`type`: the driver's by default) into `buffer` (at least PERISCOPE_STATE_BYTES long); returns its length. */
export function encodePeriscopeState(
  buffer: ArrayBuffer,
  seq: number,
  timeMs: number,
  angle: number,
  type: PeriscopePacket = PacketType.PeriscopeState,
): number {
  const view = new DataView(buffer);
  view.setUint8(0, type);
  view.setUint16(1, seq & 0xffff);
  view.setUint32(3, Math.floor(timeMs) >>> 0);
  const v = Math.round(wrapAngle(angle) * HEADING_SCALE);
  view.setInt16(HEADER, v < -32767 ? -32767 : v > 32767 ? 32767 : v);
  return PERISCOPE_STATE_BYTES;
}

/** Decode a periscope's packet's angle (radians, within ±π), or NaN if it isn't one of `type` (the driver's by default). */
export function decodePeriscopeState(view: DataView, header: TankHeader, type: PeriscopePacket = PacketType.PeriscopeState): number {
  if (view.byteLength < PERISCOPE_STATE_BYTES || view.getUint8(0) !== type) {
    return Number.NaN;
  }
  header.seq = view.getUint16(1);
  header.timeMs = view.getUint32(3);
  return view.getInt16(HEADER) / HEADING_SCALE;
}
