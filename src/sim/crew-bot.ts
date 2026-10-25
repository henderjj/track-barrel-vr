/**
 * The practice crewmate's sums: a bot that plays the second player so one
 * person can test the two-player parts of the game (src/systems/crew-bot-system.ts).
 * Engine-free, so it can be unit tested.
 */

/** Gravity, m/s². On a moving vehicle use the vehicle's frame: its own accelerations are small next to this. */
export const BOT_GRAVITY = 9.81;
/** How far the bot reaches from its resting hand to meet a block, m. */
export const CATCH_REACH = 0.7;
/** How far ahead a flying block's path is followed, s. */
const LOOKAHEAD_S = 1.2;
const LOOKAHEAD_STEP_S = 0.02;

type Vec3 = [number, number, number];

/**
 * Where to put a hand to meet a flying block at `pos` moving at `vel`: the
 * point of its falling path closest to `rest`, if that is within `reach`.
 * Writes the point to `out` and returns true, or returns false when the
 * block won't pass close enough.
 */
export function interceptPoint(pos: Vec3, vel: Vec3, rest: Vec3, out: Vec3, reach = CATCH_REACH): boolean {
  let best = Number.POSITIVE_INFINITY;
  for (let t = 0; t <= LOOKAHEAD_S; t += LOOKAHEAD_STEP_S) {
    const x = pos[0] + vel[0] * t;
    const y = pos[1] + vel[1] * t - 0.5 * BOT_GRAVITY * t * t;
    const z = pos[2] + vel[2] * t;
    const d = Math.hypot(x - rest[0], y - rest[1], z - rest[2]);
    if (d < best) {
      best = d;
      out[0] = x;
      out[1] = y;
      out[2] = z;
    }
  }
  return best <= reach;
}

/** Launch velocity that carries a block from `from` to `to` in `flightS` seconds under gravity. */
export function throwVelocity(from: Vec3, to: Vec3, flightS: number, out: Vec3): Vec3 {
  out[0] = (to[0] - from[0]) / flightS;
  out[1] = (to[1] - from[1]) / flightS + 0.5 * BOT_GRAVITY * flightS;
  out[2] = (to[2] - from[2]) / flightS;
  return out;
}

/** A gentle flight time for a throw over `distance` metres, s. */
export function throwFlightTime(distance: number): number {
  return Math.min(0.8, Math.max(0.4, distance / 4));
}

/** Move `from` towards `to` by at most `maxStep`, in place; returns the distance left. */
export function stepTowards(from: Vec3, to: Vec3, maxStep: number): number {
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
