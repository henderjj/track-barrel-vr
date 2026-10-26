/**
 * Seat calibration (F1.2, docs/seat-choice.md): a short step as the player
 * starts in VR that records how high their eyes are as they play and how far
 * their arms reach. Engine-free, so it can be unit tested; CalibrationSystem
 * feeds it the head and hands each frame and shows the sign.
 *
 * 1. Eyes: "sit back (or stand) as you'll play and look ahead". Once the head
 *    has held still for `STILL_SECONDS`, its average height in the play
 *    space is the player's eye height, and the body-height system puts it on
 *    the seat's eye point (src/sim/body-height.ts).
 * 2. Reach: "hold both hands out in front as far as is comfortable and
 *    squeeze both grips". The level distance from the eyes to each hand,
 *    averaged, is the reach. Phase 1 records it (for the controls' layout
 *    and the play-test stats); scaling the controls by it comes later if the
 *    play tests show short or long arms struggling (plan 4.1).
 *
 * Either step can be skipped; a skipped eye step leaves the body-height
 * system on its running measure (the highest the head has been).
 */

/** How long the head must hold still for its height to be taken, s. */
export const STILL_SECONDS = 1.5;
/** Most the head may move up or down while holding still, m. */
export const STILL_SPREAD = 0.03;
/** Eye heights outside this band aren't taken (headset off, on the floor, or a bad floor), m. */
export const MIN_EYE = 0.7;
export const MAX_EYE = 2.3;
/** Reaches outside this band aren't taken (hands at rest, or tracking lost), m. */
export const MIN_REACH = 0.3;
export const MAX_REACH = 0.95;

/** Where the calibration is: not running, waiting for still eyes, waiting for the reach, or just finished. */
export type CalibrationStep = 'off' | 'eyes' | 'reach' | 'done';

export class Calibration {
  step: CalibrationStep = 'off';
  /** The eye height taken, in the play space, m (NaN until taken). */
  eye = Number.NaN;
  /** The reach taken, m (NaN until taken). */
  reach = Number.NaN;
  /** Seconds the head has held still so far. */
  still = 0;
  private low = Number.NaN;
  private high = Number.NaN;
  private sum = 0;
  private weight = 0;

  /** Start again from the eye step; what was taken before stays until a new value is. */
  start(): void {
    this.step = 'eyes';
    this.restartStill();
  }

  /** Give up on the step in hand: the eye step moves on to the reach, the reach finishes. */
  skip(): void {
    if (this.step === 'eyes') {
      this.step = 'reach';
    } else if (this.step === 'reach') {
      this.step = 'done';
    }
  }

  /** How far through holding still, 0 to 1. */
  get progress(): number {
    return Math.min(1, this.still / STILL_SECONDS);
  }

  /**
   * Add the head's height in the play space (m), `dt` seconds after the last.
   * Returns true on the frame the eye height is taken.
   */
  pushHead(headY: number, dt: number): boolean {
    if (this.step !== 'eyes') {
      return false;
    }
    if (!(headY > MIN_EYE && headY < MAX_EYE)) {
      this.restartStill();
      return false;
    }
    const low = Number.isNaN(this.low) ? headY : Math.min(this.low, headY);
    const high = Number.isNaN(this.high) ? headY : Math.max(this.high, headY);
    if (high - low > STILL_SPREAD) {
      // Moved: start holding still again from here.
      this.restartStill();
      this.low = headY;
      this.high = headY;
    } else {
      this.low = low;
      this.high = high;
    }
    this.sum += headY * dt;
    this.weight += dt;
    this.still += dt;
    if (this.still < STILL_SECONDS) {
      return false;
    }
    this.eye = this.sum / this.weight;
    this.step = 'reach';
    return true;
  }

  /**
   * Add each hand's level distance from the eyes (m) and whether both grips
   * are squeezed. Returns true on the frame the reach is taken.
   */
  pushReach(left: number, right: number, bothGripped: boolean): boolean {
    if (this.step !== 'reach' || !bothGripped || !inReach(left) || !inReach(right)) {
      return false;
    }
    this.reach = (left + right) / 2;
    this.step = 'done';
    return true;
  }

  private restartStill(): void {
    this.still = 0;
    this.low = Number.NaN;
    this.high = Number.NaN;
    this.sum = 0;
    this.weight = 0;
  }
}

function inReach(distance: number): boolean {
  return distance >= MIN_REACH && distance <= MAX_REACH;
}

/** The level distance between two points (x and z only), m. */
export function levelDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
