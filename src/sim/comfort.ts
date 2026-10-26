/**
 * Comfort caps (plan §4.10): every motion of the tank passes through these,
 * so a crew riding it never feels a lurch the eyes see but the body doesn't.
 * First set in spike S2 (docs/spikes/s2-riding.md) and shared by the drive
 * (src/sim/tank-drive.ts) and the spike's ride (src/sim/ride.ts). The
 * comfort vignette's level is here too. Engine-free, so it can be unit tested.
 * Angles in radians.
 */

const DEG = Math.PI / 180;

/** Top forward and reverse speed, m/s (35 km/h, high range; 11 km/h back). */
export const MAX_SPEED = 35 / 3.6;
export const MAX_REVERSE = 3;
/** Most the speed changes per second, m/s² (the concept's gentle acceleration). */
export const MAX_ACCEL = 1.0;
/** Fastest the hull turns, and the most its turn rate changes per second. */
export const MAX_YAW_RATE = 15 * DEG;
export const MAX_YAW_ACCEL = 20 * DEG;
/** Most the hull pitches or rolls following the ground, and how quickly it eases there and to the ground's height, s. */
export const MAX_TILT = 4 * DEG;
export const TILT_SECONDS = 0.5;
export const HEIGHT_SECONDS = 0.1;
/** Fastest the turret traverses (it turns the gunner's view with it), and the most its rate changes per second (spike S2's, F1.8). */
export const MAX_TRAVERSE = 24 * DEG;
export const MAX_TRAVERSE_ACCEL = 40 * DEG;

// The comfort vignette's level (0 none, 1 full) from what the eyes see move.
/** Turning of the view (hull, plus the turret for the gunner) that gives a full vignette. */
export const VIGNETTE_FULL_TURN = 20 * DEG;
/** Change of speed that gives a full vignette, m/s². */
export const VIGNETTE_FULL_ACCEL = 1.0;
/** Pitching and rolling together that gives a full vignette. */
export const VIGNETTE_FULL_TILT = 8 * DEG;
/** Steady speed gives a light vignette only: this much at top speed. */
export const VIGNETTE_AT_TOP_SPEED = 0.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * How strong the comfort vignette should be, 0 to 1, for a view turning at
 * `turnRate` (rad/s), changing speed at `accel` (m/s²), pitching and rolling
 * at `tiltRate` (rad/s) and moving at `speed` (m/s).
 */
export function vignetteLevel(turnRate: number, accel: number, tiltRate: number, speed: number): number {
  return clamp(
    Math.max(
      Math.abs(turnRate) / VIGNETTE_FULL_TURN,
      Math.abs(accel) / VIGNETTE_FULL_ACCEL,
      Math.abs(tiltRate) / VIGNETTE_FULL_TILT,
      (Math.abs(speed) / MAX_SPEED) * VIGNETTE_AT_TOP_SPEED,
    ),
    0,
    1,
  );
}
