/**
 * Where a seated crewmate's torso and neck go, from their head's pose
 * (F1.1b, docs/seated-avatars.md). Engine-free, so it can be unit tested.
 *
 * The legs sit still in the seat. The torso pivots at the hip point on the
 * cushion and leans towards the neck's base, which hangs below the head;
 * a neck joins the torso's top to the skull. So a lean, a turn of the head,
 * a raised or dropped eye height or a slouch bends the body at the hips
 * and the neck instead of sliding it off the legs.
 *
 * A real head turns and nods on the neck, so the neck's base is placed
 * from the head along the head's own axes: all of its turn and its tilt
 * to the side, half of its nod (the rest of a nod is the neck bending).
 * The torso keeps its proportions: it stretches or shrinks a little
 * (`MIN_STRETCH` to `MAX_STRETCH`) and the neck takes up what is left. Past
 * `MAX_NECK` (standing up out of the seat) the torso rises off the cushion
 * after the head. The shoulders turn a share of the head's turn
 * (`TWIST_SHARE`, at most `MAX_TWIST`); the rest is the neck.
 *
 * Positions are in hull space, m; the head's rotation is a quaternion.
 */

export type Vec3 = [number, number, number];

/**
 * The neck's base (between the shoulders) from the eyes, in the head's frame (face towards -Z), m: the shoulders
 * stand 20 cm under the eyes, as a seated adult's do (docs/crew-heights.md).
 */
export const NECK_BASE: readonly [number, number, number] = [0, -0.16, 0.08];
/** The neck's top, from the eyes, in the head's frame, m: inside the skull, behind the jaw, so no gap shows as the neck turns. */
export const SKULL_BASE: readonly [number, number, number] = [0, -0.04, 0.07];
/** Share of the head's nod that tips the neck's base too. */
export const NOD_SHARE = 0.5;
/**
 * The torso's length at rest, from the hip point up its spine to the neck's base, m: with the eyes 79 cm over
 * the cushion (src/sim/cabin.ts), as a seated 1.75 m adult's, it reaches without stretching.
 */
export const TORSO_LENGTH = 0.56;
/** Least and most the torso stretches along its spine. */
export const MIN_STRETCH = 0.88;
export const MAX_STRETCH = 1.15;
/** Longest the neck grows (from the torso's top to SKULL_BASE; 12 cm at rest) before the torso rises off the seat, m. */
export const MAX_NECK = 0.22;
/** Share of the head's turn (from the seat's facing) the shoulders take. */
export const TWIST_SHARE = 0.35;
/** Most the shoulders turn from the seat's facing, rad. */
export const MAX_TWIST = 0.6;
/** How fast the shoulders' turn follows the head's, rad/s (a quick swing, not a jump, when the head turns past straight back). */
export const TWIST_RATE = 4;

/** A seated body's pose, as drawn: write it with `solveSeatedBody`. */
export interface SeatedBody {
  /** The torso's foot: the hip point, unless the crewmate rose off the seat. */
  pivot: Vec3;
  /** Unit vector from the pivot up the spine. */
  spine: Vec3;
  /** How much the torso is stretched along its spine (1 at rest). */
  stretch: number;
  /** The shoulders' turn from the seat's facing, rad (positive to the left). */
  twist: number;
  /** The neck's base, where the torso's top is drawn. */
  neckFrom: Vec3;
  /** The neck's top, under the skull. */
  neckTo: Vec3;
}

export function createSeatedBody(): SeatedBody {
  return { pivot: [0, 0, 0], spine: [0, 1, 0], stretch: 1, twist: 0, neckFrom: [0, 0, 0], neckTo: [0, 0, 0] };
}

/** The head's turn (yaw), nod (pitch) and tilt (roll) for a quaternion, in three.js's 'YXZ' order, rad. */
export function headAngles(qx: number, qy: number, qz: number, qw: number, out: Vec3): Vec3 {
  const m13 = 2 * (qx * qz + qw * qy);
  const m23 = 2 * (qy * qz - qw * qx);
  const m33 = 1 - 2 * (qx * qx + qy * qy);
  const m21 = 2 * (qx * qy + qw * qz);
  const m22 = 1 - 2 * (qx * qx + qz * qz);
  const m11 = 1 - 2 * (qy * qy + qz * qz);
  const m31 = 2 * (qx * qz - qw * qy);
  const pitch = Math.asin(-Math.min(1, Math.max(-1, m23)));
  if (Math.abs(m23) < 0.9999999) {
    out[0] = Math.atan2(m13, m33);
    out[2] = Math.atan2(m21, m22);
  } else {
    out[0] = Math.atan2(-m31, m11);
    out[2] = 0;
  }
  out[1] = pitch;
  return out;
}

/** `v` turned by yaw, pitch and roll in 'YXZ' order (roll first, then pitch, then yaw), added to `at`, into `out`. */
function turnFrom(at: readonly number[], v: readonly number[], yaw: number, pitch: number, roll: number, out: Vec3): Vec3 {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const x1 = v[0] * cr - v[1] * sr;
  const y1 = v[0] * sr + v[1] * cr;
  const z1 = v[2];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  out[0] = at[0] + x1 * cy + z2 * sy;
  out[1] = at[1] + y2;
  out[2] = at[2] - x1 * sy + z2 * cy;
  return out;
}

/** An angle wrapped into -π..π. */
export function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

/** The shoulders' turn for a head turned `yaw` in a seat facing `seatYaw`, rad. */
export function twistFor(yaw: number, seatYaw: number): number {
  return Math.min(MAX_TWIST, Math.max(-MAX_TWIST, TWIST_SHARE * wrapAngle(yaw - seatYaw)));
}

const angles: Vec3 = [0, 0, 0];

/**
 * Pose a seated body for a head at `head` turned by quaternion `q` (x, y,
 * z, w), with the hip point `hip` in a seat facing `seatYaw` (rad about +Y;
 * a seat faces -Z at 0). `dt` (s) eases the shoulders' turn from the last
 * pose in `out`; pass 0 to set it at once. Writes `out` and returns it.
 */
export function solveSeatedBody(
  head: readonly number[],
  q: readonly number[],
  hip: readonly number[],
  seatYaw: number,
  dt: number,
  out: SeatedBody,
): SeatedBody {
  const [yaw, pitch, roll] = headAngles(q[0], q[1], q[2], q[3], angles);
  const top = turnFrom(head, NECK_BASE, yaw, pitch * NOD_SHARE, roll, out.neckFrom);
  const skull = turnFrom(head, SKULL_BASE, yaw, pitch, roll, out.neckTo);
  // The spine from the hip point to the neck's base.
  let dx = top[0] - hip[0];
  let dy = top[1] - hip[1];
  let dz = top[2] - hip[2];
  const reach = Math.hypot(dx, dy, dz);
  if (reach < 1e-6) {
    dx = 0;
    dy = 1;
    dz = 0;
  } else {
    dx /= reach;
    dy /= reach;
    dz /= reach;
  }
  out.spine[0] = dx;
  out.spine[1] = dy;
  out.spine[2] = dz;
  out.stretch = Math.min(MAX_STRETCH, Math.max(MIN_STRETCH, reach / TORSO_LENGTH));
  const length = TORSO_LENGTH * out.stretch;
  out.pivot[0] = hip[0];
  out.pivot[1] = hip[1];
  out.pivot[2] = hip[2];
  top[0] = hip[0] + dx * length;
  top[1] = hip[1] + dy * length;
  top[2] = hip[2] + dz * length;
  // A neck longer than it can be: the torso rises after the head.
  const nx = skull[0] - top[0];
  const ny = skull[1] - top[1];
  const nz = skull[2] - top[2];
  const neck = Math.hypot(nx, ny, nz);
  if (neck > MAX_NECK) {
    const k = (neck - MAX_NECK) / neck;
    out.pivot[0] += nx * k;
    out.pivot[1] += ny * k;
    out.pivot[2] += nz * k;
    top[0] += nx * k;
    top[1] += ny * k;
    top[2] += nz * k;
  }
  const twist = twistFor(yaw, seatYaw);
  const step = TWIST_RATE * dt;
  out.twist = dt > 0 && Math.abs(twist - out.twist) > step ? out.twist + Math.sign(twist - out.twist) * step : twist;
  return out;
}
