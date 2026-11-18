/**
 * Where a crewmate's elbow goes when their hand is at a control (F6.3b,
 * docs/crew-avatars.md): two-bone reach, the sums for the textured
 * crewman's arms. Engine-free, so it can be unit tested.
 *
 * The shoulder, the wrist and a pole (a point the elbow bends towards) fix
 * a plane; the elbow sits in it where the upper arm and the forearm, at
 * their own lengths, meet. A wrist out of reach is brought back along the
 * line from the shoulder, so the arm is drawn straight rather than torn.
 *
 * Points are [x, y, z] in any one frame, m.
 */

export type Vec3 = [number, number, number];

/** Least the arm bends at full reach, as a share of its length: keeps the elbow's side known. */
export const STRAIGHTEST = 0.995;

/**
 * Write the elbow into `elbow` and the wrist, brought within reach, into
 * `wrist`, for an arm from `shoulder` with an upper arm `upper` and a
 * forearm `lower` long (m), reaching for `target` and bending towards
 * `pole`. Returns how far the wrist was brought back, m (0 when in reach).
 */
export function reachArm(
  shoulder: readonly number[],
  target: readonly number[],
  pole: readonly number[],
  upper: number,
  lower: number,
  elbow: Vec3,
  wrist: Vec3,
): number {
  let dx = target[0] - shoulder[0];
  let dy = target[1] - shoulder[1];
  let dz = target[2] - shoulder[2];
  const want = Math.hypot(dx, dy, dz);
  if (want < 1e-6) {
    dx = 0;
    dy = -1;
    dz = 0;
  } else {
    dx /= want;
    dy /= want;
    dz /= want;
  }
  const most = (upper + lower) * STRAIGHTEST;
  const least = Math.abs(upper - lower) + 1e-4;
  const d = Math.min(most, Math.max(least, want));
  wrist[0] = shoulder[0] + dx * d;
  wrist[1] = shoulder[1] + dy * d;
  wrist[2] = shoulder[2] + dz * d;
  // Along the shoulder-to-wrist line to the foot of the elbow, and out from it towards the pole.
  const along = (upper * upper + d * d - lower * lower) / (2 * d);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  let px = pole[0] - shoulder[0];
  let py = pole[1] - shoulder[1];
  let pz = pole[2] - shoulder[2];
  const k = px * dx + py * dy + pz * dz;
  px -= dx * k;
  py -= dy * k;
  pz -= dz * k;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // The pole on the line: bend downwards, or sideways for an arm pointing straight down.
    px = 0;
    py = -1;
    pz = 0;
    const k2 = py * dy;
    px -= dx * k2;
    py -= dy * k2;
    pz -= dz * k2;
    pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) {
      px = 1;
      py = 0;
      pz = 0;
      pl = 1;
    }
  }
  elbow[0] = shoulder[0] + dx * along + (px / pl) * out;
  elbow[1] = shoulder[1] + dy * along + (py / pl) * out;
  elbow[2] = shoulder[2] + dz * along + (pz / pl) * out;
  return want - d;
}
