/**
 * The practice crewmate's sums: a bot that plays the second player so one
 * person can test the two-player parts of the game (src/systems/crew-bot-system.ts).
 * Engine-free, so it can be unit tested.
 */

import { type Seat, seatToHull } from './cabin.js';

type Vec3 = [number, number, number];

/** Where a seated crewmate rests its hands, from its eyes in its seat's frame: in front, below the chest, m. */
export const REST_HAND = { across: 0.18, below: 0.55, ahead: 0.35 } as const;

/**
 * Where the bot rests its `side` hand in `seat`, hull space, written to
 * `out`: in front of it at the height of the controls, where the driver's
 * tillers and the gunner's wheels will be (F1.5, F1.8).
 */
export function restingHand(seat: Seat, turretYaw: number, side: 'left' | 'right', out: Vec3): Vec3 {
  out[0] = seat.eye[0] + (side === 'left' ? -REST_HAND.across : REST_HAND.across);
  out[1] = seat.eye[1] - REST_HAND.below;
  out[2] = seat.eye[2] - REST_HAND.ahead;
  return seatToHull(seat, turretYaw, out, out);
}

/**
 * How the bot looks about while it sits, at `seconds`: a slow, uneven
 * glance left and right and a little up and down, so the player can see
 * it is there and awake. Writes [yaw, pitch] (rad, from facing the seat's
 * way) to `out`.
 */
export function idleLook(seconds: number, out: [number, number]): [number, number] {
  const tau = Math.PI * 2;
  out[0] = 0.35 * Math.sin((tau * seconds) / 9) + 0.12 * Math.sin((tau * seconds) / 3.7);
  out[1] = -0.1 + 0.08 * Math.sin((tau * seconds) / 6.3);
  return out;
}

/** Move `from` towards `to` by at most `maxStep`, in place; returns the distance left. */
export function stepTowards(from: Vec3, to: readonly number[], maxStep: number): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dy, dz);
  if (d <= maxStep || d === 0) {
    from[0] = to[0];
    from[1] = to[1];
    from[2] = to[2];
    return 0;
  }
  const k = maxStep / d;
  from[0] += dx * k;
  from[1] += dy * k;
  from[2] += dz * k;
  return d - maxStep;
}
