/**
 * Eye height in the seat. Engine-free, so it can be unit tested.
 *
 * Everyone plays sitting in a seat (F1.2, docs/seat-choice.md), so the game
 * raises or lowers the player's whole tracked rig (view and hands together)
 * until their eyes are at the seat's eye point: `SEATED_EYE` above the
 * seat's floor, plus the small raise or drop the player picked in the menu.
 * How high their eyes are as they play is measured, not asked:
 *
 * - Calibrated (src/sim/calibration.ts): the head's height while the player
 *   sat (or stood) still as they will play, looking ahead.
 * - Before that, or if they skip it: the highest their head has been,
 *   smoothed so a bob or a tracking glitch doesn't count.
 *
 * Seated or standing, the eyes land on the same eye point (standing mode
 * lowers a standing player to it), so the controls are where they are for
 * everyone. Crouching still crouches, and the crewmate sees it because
 * poses are sent in hull space, offset included.
 */

/** How far the eyes are below the top of the head, m (as on the crew avatar). */
export const EYES_BELOW_TOP = 0.13;
/**
 * The seat's eye height above the floor it stands on, m: a 1.58 m
 * character's standing eyes, a chair-height head (about 1.2 m) raised about
 * 0.25 m. The seats are built round it (src/sim/cabin.ts), so the controls
 * between knee and chest height stay in reach (test/body-height.test.ts).
 */
export const SEATED_EYE = 1.45;
/** Most the player may raise (+) or drop (-) their eyes from the seat's eye point in the menu, m. */
export const MAX_EYE_RAISE = 0.15;
/** The menu's step for it, m. */
export const EYE_RAISE_STEP = 0.05;
/** Furthest the rig is lowered or raised, m. */
export const MAX_LOWER = 0.7;
export const MAX_RAISE = 0.9;
/** How fast the view glides to a new offset once playing, m/s (slow enough not to be felt as a lift). */
export const GLIDE_SPEED = 0.25;
/** Time constant of the smoothing on head height before its highest is taken, s. */
const SMOOTH_SECONDS = 0.5;
/** Head heights outside this band aren't counted (headset off, on the floor, or tracking lost), m. */
const MIN_HEAD = 0.6;
const MAX_HEAD = 2.6;

/** What the player chose: how far to raise (+) or drop (-) their eyes from the seat's eye point, m, and whether they sit. */
export interface BodyChoice {
  raise: number;
  seated: boolean;
}

/** A raise kept in range and on the menu's steps. */
export function clampEyeRaise(raise: number): number {
  if (!Number.isFinite(raise)) {
    return 0;
  }
  const clamped = Math.min(MAX_EYE_RAISE, Math.max(-MAX_EYE_RAISE, raise));
  return Number((Math.round(clamped / EYE_RAISE_STEP) * EYE_RAISE_STEP).toFixed(2)) || 0;
}

/**
 * The player's upright eye height in their play space: the highest their head
 * has been since `reset`, after smoothing.
 */
export class UprightEye {
  /** Smoothed head height, m (NaN before the first sample). */
  smoothed = Number.NaN;
  /** Highest smoothed head height, m (NaN before the first sample). */
  upright = Number.NaN;
  /** Seconds of head samples since `reset`. */
  seconds = 0;

  reset(): void {
    this.smoothed = Number.NaN;
    this.upright = Number.NaN;
    this.seconds = 0;
  }

  /** Add a head height (m, above the play-space floor) seen `dt` seconds after the last. */
  push(headY: number, dt: number): void {
    if (!(headY > MIN_HEAD && headY < MAX_HEAD)) {
      return;
    }
    this.smoothed = Number.isNaN(this.smoothed) ? headY : this.smoothed + (headY - this.smoothed) * Math.min(1, dt / SMOOTH_SECONDS);
    if (!(this.upright >= this.smoothed)) {
      this.upright = this.smoothed;
    }
    this.seconds += dt;
  }
}

/** The eye height a choice asks for, m above the seat's floor: the seat's eye point, raised or dropped as chosen. */
export function targetEyeHeight(choice: BodyChoice): number {
  return SEATED_EYE + clampEyeRaise(choice.raise);
}

/** How far to raise (+) or lower (-) the rig so eyes at `eye` (as measured in the play space) sit at `target`, m. */
export function rigOffset(target: number, eye: number): number {
  if (!Number.isFinite(eye)) {
    return 0;
  }
  return Math.min(MAX_RAISE, Math.max(-MAX_LOWER, target - eye));
}

/** Move `current` towards `target` by at most `GLIDE_SPEED * dt`. */
export function glide(current: number, target: number, dt: number): number {
  const step = GLIDE_SPEED * dt;
  return Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
}
