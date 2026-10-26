/**
 * Spike S3's test lane: a tank seen from above on a board, driven by the two
 * tillers, along a winding lane. It stands in for the tank drive (F1.4) so
 * the levers can be judged by the plan's pass mark, "players drive a lane
 * with the tillers within a few minutes", before there is a tank to ride.
 * Engine-free (test/lever-lane.test.ts).
 *
 * Lane space: metres on the ground, x to the right and y up the board (the
 * way the tank starts facing). Heading is radians from +y, positive turning
 * right (clockwise seen from above).
 */

/** The lane's centre line, start to finish (x, y), m. */
export const LANE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 18],
  [12, 32],
  [12, 46],
  [-8, 62],
  [-8, 78],
  [0, 88],
];
/** Half the lane's width, m: the tank is 3.4 m wide, so it has about 1.3 m each side. */
export const LANE_HALF_WIDTH = 3;
/** The tank's track centres are this far apart, m (a Tiger's are about 2.8 m). */
export const TRACK_SPACING = 2.8;
/** Each track's speed with its tiller fully forwards, m/s (about 18 km/h; back is the same). */
export const TRACK_SPEED = 5;
/** How fast a track gets to its tiller's speed: the rate of its exponential approach, 1/s. */
export const TRACK_RESPONSE = 2.5;
/** The finish counts within this distance of the lane's end, m. */
export const FINISH_RADIUS = 4;

/** Where along the lane (from its start, m) and how far off its centre line (m) a point is. */
export interface LanePlace {
  along: number;
  off: number;
}

/** Length of the lane, m. */
export const LANE_LENGTH = (() => {
  let total = 0;
  for (let i = 1; i < LANE.length; i++) {
    total += Math.hypot(LANE[i][0] - LANE[i - 1][0], LANE[i][1] - LANE[i - 1][1]);
  }
  return total;
})();

/** Where the point (x, y) is along the lane, into `out`. */
export function placeOnLane(x: number, y: number, out: LanePlace): LanePlace {
  let best = Number.POSITIVE_INFINITY;
  let start = 0;
  out.along = 0;
  out.off = best;
  for (let i = 1; i < LANE.length; i++) {
    const [ax, ay] = LANE[i - 1];
    const [bx, by] = LANE[i];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let t = ((x - ax) * dx + (y - ay) * dy) / (len * len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) {
      best = d;
      out.off = d;
      out.along = start + t * len;
    }
    start += len;
  }
  return out;
}

export class LaneRun {
  x = 0;
  y = 0;
  heading = 0;
  /** Each track's speed now, m/s. */
  left = 0;
  right = 0;
  /** Time since the tank first moved, s (0 before). */
  time = 0;
  /** Time spent with the tank's middle off the lane, s. */
  offTime = 0;
  /** The furthest along the lane the tank has been, m. */
  best = 0;
  started = false;
  finished = false;
  private place: LanePlace = { along: 0, off: 0 };

  reset(): void {
    this.x = LANE[0][0];
    this.y = LANE[0][1];
    this.heading = 0;
    this.left = 0;
    this.right = 0;
    this.time = 0;
    this.offTime = 0;
    this.best = 0;
    this.started = false;
    this.finished = false;
  }

  /** The tank is off the lane now. */
  get off(): boolean {
    return this.place.off > LANE_HALF_WIDTH;
  }

  /**
   * Step `dt` seconds with each tiller's demand, −1 (back) to 1 (forwards).
   * Skid steering: each track runs at its own speed, the tank moves at their
   * mean and turns by their difference over the track spacing.
   */
  update(dt: number, leftDemand: number, rightDemand: number): void {
    if (this.finished) {
      leftDemand = 0;
      rightDemand = 0;
    }
    const k = 1 - Math.exp(-TRACK_RESPONSE * dt);
    this.left += (leftDemand * TRACK_SPEED - this.left) * k;
    this.right += (rightDemand * TRACK_SPEED - this.right) * k;
    const speed = (this.left + this.right) / 2;
    const turn = (this.left - this.right) / TRACK_SPACING;
    this.heading += turn * dt;
    this.x += Math.sin(this.heading) * speed * dt;
    this.y += Math.cos(this.heading) * speed * dt;
    if (!this.started && (Math.abs(this.left) > 0.05 || Math.abs(this.right) > 0.05)) {
      this.started = true;
    }
    placeOnLane(this.x, this.y, this.place);
    if (this.started && !this.finished) {
      this.time += dt;
      if (this.off) {
        this.offTime += dt;
      }
      this.best = Math.max(this.best, this.place.along);
      const [ex, ey] = LANE[LANE.length - 1];
      if (Math.hypot(this.x - ex, this.y - ey) < FINISH_RADIUS) {
        this.finished = true;
      }
    }
  }
}
