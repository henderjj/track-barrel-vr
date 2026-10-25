/**
 * The demo game's rule, engine-free so it can be unit tested: a block scores
 * when its centre crosses the hoop's plane, going away from the players
 * (towards -Z), inside the ring by at least the block's half size.
 */

export interface Hoop {
  x: number;
  y: number;
  z: number;
  radius: number;
}

type Vec3 = readonly [number, number, number] | readonly number[];

/** Did a block moving from `a` to `b` this frame pass through `hoop`, clearing the ring by `clearance`? */
export function throughHoop(a: Vec3, b: Vec3, hoop: Hoop, clearance: number): boolean {
  if (!(a[2] > hoop.z && b[2] <= hoop.z)) {
    return false;
  }
  const t = (a[2] - hoop.z) / (a[2] - b[2]);
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  return Math.hypot(x - hoop.x, y - hoop.y) <= hoop.radius - clearance;
}
