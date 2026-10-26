/**
 * The loading packet on the unreliable channel (F1.10,
 * docs/loading-firing.md), packed by hand with DataView like
 * src/net/turret-codec.ts, and allocation free when given a reusable buffer.
 *
 * LoadingState, from the gunner's page (which does the loading, as it owns
 * the turret) to the other at 45 Hz: the breech lever's angle, the shell in
 * the breech and how far in, whether it is rammed and the breech loaded,
 * each shell's place and pose in turret space (so the other page draws the
 * shell in the gunner's hand), and the stats the loading board shows.
 * Shots go as reliable events instead (src/systems/firing-system.ts).
 *
 * When the packet grows, decode the old length too (see decodePose).
 */

import { type LoadingSnapshot, SHELL_COUNT, SHELL_PLACES } from '../sim/loading.js';
import { PacketType } from './pose-codec.js';
import type { TankHeader } from './tank-codec.js';

/** Header: type(1) seq(2) time(4). */
const HEADER = 7;
/** The breech and the stats: lever(2) depth(2) breech shell(1) flags(1) loads(2) last(2) best(2) fumbles(2) streak(1) best streak(1). */
const BREECH = 16;
/** Each shell: place(1), centre (3 int16, mm), axis (3 int16). */
const SHELL = 13;
export const LOADING_STATE_BYTES = HEADER + BREECH + SHELL_COUNT * SHELL;

const ANGLE_SCALE = 1e4;
const AXIS_SCALE = 30000;
/** A time the board shows: centiseconds, with this for none yet. */
const NO_TIME = 0xffff;
const RAMMED = 1;
const LOADED = 2;

function int16(v: number): number {
  return v < -32767 ? -32767 : v > 32767 ? 32767 : Math.round(v);
}

function time16(t: number): number {
  return Number.isNaN(t) ? NO_TIME : Math.min(NO_TIME - 1, Math.max(0, Math.round(t * 100)));
}

function untime16(v: number): number {
  return v === NO_TIME ? Number.NaN : v / 100;
}

/** Write a LoadingState packet into `buffer` (at least LOADING_STATE_BYTES long); returns its length. */
export function encodeLoadingState(buffer: ArrayBuffer, seq: number, timeMs: number, s: LoadingSnapshot): number {
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.LoadingState);
  view.setUint16(1, seq & 0xffff);
  view.setUint32(3, Math.floor(timeMs) >>> 0);
  let o = HEADER;
  view.setInt16(o, int16(s.lever * ANGLE_SCALE));
  view.setInt16(o + 2, int16(s.depth * ANGLE_SCALE));
  view.setInt8(o + 4, s.breechShell);
  view.setUint8(o + 5, (s.rammed ? RAMMED : 0) | (s.loaded ? LOADED : 0));
  view.setUint16(o + 6, Math.min(0xffff, s.loads));
  view.setUint16(o + 8, time16(s.last));
  view.setUint16(o + 10, time16(s.best));
  view.setUint16(o + 12, Math.min(0xffff, s.fumbles));
  view.setUint8(o + 14, Math.min(0xff, s.streak));
  view.setUint8(o + 15, Math.min(0xff, s.bestStreak));
  o += BREECH;
  for (let i = 0; i < SHELL_COUNT; i++) {
    const shell = s.shells[i];
    view.setUint8(o, Math.max(0, SHELL_PLACES.indexOf(shell.place)));
    for (let k = 0; k < 3; k++) {
      view.setInt16(o + 1 + 2 * k, int16(shell.centre[k] * 1000));
      view.setInt16(o + 7 + 2 * k, int16(shell.axis[k] * AXIS_SCALE));
    }
    o += SHELL;
  }
  return LOADING_STATE_BYTES;
}

/** Decode a LoadingState packet into `out`; returns false if it isn't one. */
export function decodeLoadingState(view: DataView, header: TankHeader, out: LoadingSnapshot): boolean {
  if (view.byteLength < LOADING_STATE_BYTES || view.getUint8(0) !== PacketType.LoadingState) {
    return false;
  }
  header.seq = view.getUint16(1);
  header.timeMs = view.getUint32(3);
  let o = HEADER;
  out.lever = view.getInt16(o) / ANGLE_SCALE;
  out.depth = view.getInt16(o + 2) / ANGLE_SCALE;
  out.breechShell = view.getInt8(o + 4);
  const flags = view.getUint8(o + 5);
  out.rammed = (flags & RAMMED) !== 0;
  out.loaded = (flags & LOADED) !== 0;
  out.loads = view.getUint16(o + 6);
  out.last = untime16(view.getUint16(o + 8));
  out.best = untime16(view.getUint16(o + 10));
  out.fumbles = view.getUint16(o + 12);
  out.streak = view.getUint8(o + 14);
  out.bestStreak = view.getUint8(o + 15);
  o += BREECH;
  for (let i = 0; i < SHELL_COUNT; i++) {
    const shell = out.shells[i];
    shell.place = SHELL_PLACES[view.getUint8(o)] ?? 'rack';
    for (let k = 0; k < 3; k++) {
      shell.centre[k] = view.getInt16(o + 1 + 2 * k) / 1000;
      shell.axis[k] = view.getInt16(o + 7 + 2 * k) / AXIS_SCALE;
    }
    o += SHELL;
  }
  return true;
}
