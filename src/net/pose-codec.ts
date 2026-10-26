/**
 * Compact binary packets for the unreliable data channel. Positions are
 * hull-space millimetres in 16-bit integers (±32 m, far more than the deck
 * needs); rotations use the "smallest three" quaternion encoding (drop the
 * largest component, send the other three as 16-bit values plus its index).
 * Pure TypeScript and allocation free when given reusable buffers.
 */

import { createFingerCurls, type FingerCurls } from '../sim/hand-pose.js';

export const PacketType = {
  /** Head and both hands of the sender's avatar. */
  Pose: 1,
  Ping: 2,
  Pong: 3,
  /** A loose object's state from its owner (spike S7). */
  Object: 4,
  // Add your game's packets from 5: typically one for each piece of
  // host-authoritative state that changes every frame (a shared control's
  // angle, a vehicle's pose), sent at 45 Hz, and one for the guest's hands
  // on the controls, so the host can simulate them. One-off happenings go
  // as reliable events instead (netLink.sendEvent).
} as const;

/** One tracked pose: position (m) and rotation quaternion. */
export interface PoseSample {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface AvatarPose {
  head: PoseSample;
  left: PoseSample;
  right: PoseSample;
  /** Bit 0: left hand tracked, bit 1: right hand tracked. */
  flags: number;
  /** How each hand's fingers are curled (Phase 3 posed hands). */
  leftFingers: FingerCurls;
  rightFingers: FingerCurls;
  /** What each hand holds (grip locking): the left's kind in the low four bits, the right's in the high (see HoldKind). */
  holds: number;
  /** Where the feet are, m above the deck: 0 on it, higher when climbing. */
  feet: number;
}

export function createPoseSample(): PoseSample {
  return { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
}

export function createAvatarPose(): AvatarPose {
  return {
    head: createPoseSample(),
    left: createPoseSample(),
    right: createPoseSample(),
    flags: 0,
    leftFingers: createFingerCurls(1, 1, 1),
    rightFingers: createFingerCurls(1, 1, 1),
    holds: 0,
    feet: 0,
  };
}

const POS_SCALE = 1000; // millimetres
const ROT_SCALE = 32767 / Math.SQRT1_2; // components after dropping the largest are within ±1/√2
/** type(1) seq(2) time(4) flags(1) + 3 × (pos 6 + rot 7), as sent before posed hands. */
export const POSE_PACKET_MIN_BYTES = 8 + 3 * 13;
/** ... + finger curls u8 × 3 per hand (index, grip, thumb; left then right). */
const FINGERS_END = POSE_PACKET_MIN_BYTES + 6;
/** ... + what each hand holds, u8. */
const HOLDS_END = FINGERS_END + 1;
/** ... + where the feet are, u8 cm above the deck. */
export const POSE_PACKET_BYTES = HOLDS_END + 1;

function clamp16(v: number): number {
  return v < -32767 ? -32767 : v > 32767 ? 32767 : Math.round(v);
}

export function writePose(view: DataView, offset: number, p: PoseSample): number {
  view.setInt16(offset, clamp16(p.px * POS_SCALE));
  view.setInt16(offset + 2, clamp16(p.py * POS_SCALE));
  view.setInt16(offset + 4, clamp16(p.pz * POS_SCALE));
  // Smallest three: find the largest component, make it positive, drop it.
  const ax = Math.abs(p.qx), ay = Math.abs(p.qy), az = Math.abs(p.qz), aw = Math.abs(p.qw);
  let largest = 3;
  let max = aw;
  if (ax > max) { largest = 0; max = ax; }
  if (ay > max) { largest = 1; max = ay; }
  if (az > max) { largest = 2; max = az; }
  const big = largest === 0 ? p.qx : largest === 1 ? p.qy : largest === 2 ? p.qz : p.qw;
  const k = (big < 0 ? -1 : 1) * ROT_SCALE;
  view.setUint8(offset + 6, largest);
  let o = offset + 7;
  if (largest !== 0) { view.setInt16(o, clamp16(p.qx * k)); o += 2; }
  if (largest !== 1) { view.setInt16(o, clamp16(p.qy * k)); o += 2; }
  if (largest !== 2) { view.setInt16(o, clamp16(p.qz * k)); o += 2; }
  if (largest !== 3) { view.setInt16(o, clamp16(p.qw * k)); }
  return offset + 13;
}

export function readPose(view: DataView, offset: number, out: PoseSample): number {
  out.px = view.getInt16(offset) / POS_SCALE;
  out.py = view.getInt16(offset + 2) / POS_SCALE;
  out.pz = view.getInt16(offset + 4) / POS_SCALE;
  const largest = view.getUint8(offset + 6) & 3;
  let o = offset + 7;
  const a = view.getInt16(o) / ROT_SCALE;
  o += 2;
  const b = view.getInt16(o) / ROT_SCALE;
  o += 2;
  const c = view.getInt16(o) / ROT_SCALE;
  const sum = a * a + b * b + c * c;
  const d = Math.sqrt(Math.max(0, 1 - sum));
  switch (largest) {
    case 0: out.qx = d; out.qy = a; out.qz = b; out.qw = c; break;
    case 1: out.qx = a; out.qy = d; out.qz = b; out.qw = c; break;
    case 2: out.qx = a; out.qy = b; out.qz = d; out.qw = c; break;
    default: out.qx = a; out.qy = b; out.qz = c; out.qw = d; break;
  }
  return offset + 13;
}

/** Write a pose packet into `buffer` (at least POSE_PACKET_BYTES long). */
export function encodePose(buffer: ArrayBuffer, seq: number, timeMs: number, pose: AvatarPose): number {
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.Pose);
  view.setUint16(1, seq & 0xffff);
  view.setUint32(3, Math.floor(timeMs) >>> 0);
  view.setUint8(7, pose.flags & 0xff);
  let o = writePose(view, 8, pose.head);
  o = writePose(view, o, pose.left);
  o = writePose(view, o, pose.right);
  o = writeFingers(view, o, pose.leftFingers);
  o = writeFingers(view, o, pose.rightFingers);
  view.setUint8(o, pose.holds & 0xff);
  view.setUint8(o + 1, Math.round(Math.min(2.55, Math.max(0, pose.feet)) * 100));
  return o + 2;
}

function curlByte(v: number): number {
  return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
}

function writeFingers(view: DataView, offset: number, f: FingerCurls): number {
  view.setUint8(offset, curlByte(f.index));
  view.setUint8(offset + 1, curlByte(f.grip));
  view.setUint8(offset + 2, curlByte(f.thumb));
  return offset + 3;
}

function readFingers(view: DataView, offset: number, out: FingerCurls): number {
  out.index = view.getUint8(offset) / 255;
  out.grip = view.getUint8(offset + 1) / 255;
  out.thumb = view.getUint8(offset + 2) / 255;
  return offset + 3;
}

export interface PoseHeader {
  seq: number;
  timeMs: number;
}

/**
 * Decode a pose packet; returns false if it isn't one. Shorter packets
 * from earlier layouts still decode (the pattern to keep when a packet
 * grows): one without finger curls draws fists, one without hold kinds
 * says nothing held, and one without a feet height has its feet on the deck.
 */
export function decodePose(view: DataView, header: PoseHeader, out: AvatarPose): boolean {
  if (view.byteLength < POSE_PACKET_MIN_BYTES || view.getUint8(0) !== PacketType.Pose) {
    return false;
  }
  header.seq = view.getUint16(1);
  header.timeMs = view.getUint32(3);
  out.flags = view.getUint8(7);
  let o = readPose(view, 8, out.head);
  o = readPose(view, o, out.left);
  o = readPose(view, o, out.right);
  if (view.byteLength >= FINGERS_END) {
    o = readFingers(view, o, out.leftFingers);
    o = readFingers(view, o, out.rightFingers);
  } else {
    setFist(out.leftFingers);
    setFist(out.rightFingers);
  }
  out.holds = view.byteLength >= HOLDS_END ? view.getUint8(o) : 0;
  out.feet = view.byteLength >= POSE_PACKET_BYTES ? view.getUint8(o + 1) / 100 : 0;
  return true;
}

function setFist(f: FingerCurls): void {
  f.index = 1;
  f.grip = 1;
  f.thumb = 1;
}

/** Ping and pong for clock sync: type(1) + t0(8) [+ t1(8)], as float64 ms. */
export function encodePing(buffer: ArrayBuffer, t0: number): number {
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.Ping);
  view.setFloat64(1, t0);
  return 9;
}

export function encodePong(buffer: ArrayBuffer, t0: number, t1: number): number {
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.Pong);
  view.setFloat64(1, t0);
  view.setFloat64(9, t1);
  return 17;
}

/** Newer-than test for 16-bit wrapping sequence numbers. */
export function seqNewer(a: number, b: number): boolean {
  const diff = (a - b) & 0xffff;
  return diff !== 0 && diff < 0x8000;
}

/** Owner's object state: type(1) id u8(1) epoch u8(1) flags u8(1) time(4) pose(13). */
export const OBJECT_PACKET_BYTES = 21;

export interface ObjectStatePacket {
  id: number;
  /** Ownership epoch the sender owns the object under (see src/net/ownership.ts). */
  epoch: number;
  /** Bit 0: held in the sender's hand. */
  flags: number;
  timeMs: number;
  pose: PoseSample;
}

export function encodeObject(buffer: ArrayBuffer, state: ObjectStatePacket): number {
  const view = new DataView(buffer);
  view.setUint8(0, PacketType.Object);
  view.setUint8(1, state.id & 0xff);
  view.setUint8(2, state.epoch & 0xff);
  view.setUint8(3, state.flags & 0xff);
  view.setUint32(4, Math.floor(state.timeMs) >>> 0);
  return writePose(view, 8, state.pose);
}

export function decodeObject(view: DataView, out: ObjectStatePacket): boolean {
  if (view.byteLength < OBJECT_PACKET_BYTES || view.getUint8(0) !== PacketType.Object) {
    return false;
  }
  out.id = view.getUint8(1);
  out.epoch = view.getUint8(2);
  out.flags = view.getUint8(3);
  out.timeMs = view.getUint32(4);
  readPose(view, 8, out.pose);
  return true;
}
