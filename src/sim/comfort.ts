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

/**
 * How dark the vignette gets at its strongest, by the player's Vignette
 * setting (F1.14): off, light, normal (spike S2's) and strong. Each page
 * sets its own; the vignette only darkens that player's view.
 */
export const VIGNETTE_STRENGTHS = { off: 0, light: 0.3, normal: 0.5, strong: 0.8 } as const;

/** How the hull follows the ground: the share of the ground's tilt it takes, and how quickly it eases into its tilt and height, s. */
export interface GroundFeel {
  tilt: number;
  tiltSeconds: number;
  heightSeconds: number;
}

/** Every bump the ground gives, within the caps above. */
export const FULL_BUMPS: GroundFeel = { tilt: 1, tiltSeconds: TILT_SECONDS, heightSeconds: HEIGHT_SECONDS };
/**
 * Reduced bumps (F1.14): the hull takes 40% of the ground's tilt (1.6° at
 * most) and eases into it over 1.2 s, and rises and falls over 0.3 s, so a
 * mound is a slow sway instead of a pitch. Both players ride the same tank,
 * so either asking for it gives it to both.
 */
export const REDUCED_BUMPS: GroundFeel = { tilt: 0.4, tiltSeconds: 1.2, heightSeconds: 0.3 };

export type Bumps = 'full' | 'reduced';

export function parseBumps(raw: unknown, fallback: Bumps = 'full'): Bumps {
  return raw === 'full' || raw === 'reduced' ? raw : fallback;
}

/** The bumps a crew's tank rides on: reduced if either player asks for it. */
export function crewBumps(mine: Bumps, theirs: Bumps | null): Bumps {
  return mine === 'reduced' || theirs === 'reduced' ? 'reduced' : 'full';
}

export function groundFeel(bumps: Bumps): GroundFeel {
  return bumps === 'reduced' ? REDUCED_BUMPS : FULL_BUMPS;
}
