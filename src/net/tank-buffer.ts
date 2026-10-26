import { copyTankDrive, createTankDrive, extrapolateTankDrive, lerpTankDrive, type TankDrive } from '../sim/tank-drive.js';

/** How many of the host's tank states are kept: about a third of a second at 45 Hz. */
const SIZE = 16;
/** Longest the tank is carried on past the newest state when the next is late, ms. */
export const MAX_EXTRAPOLATE_MS = 150;

/**
 * A jitter buffer for the host's tank states (F1.4), like PoseBuffer for
 * the crewmate: states are kept by the local time they describe, and the
 * guest draws the tank a little in the past, between two of them, so its
 * world moves smoothly even though packets arrive unevenly. Past the
 * newest it carries the tank on at its speed and turn rate for a short
 * while. It also measures the packets' one-way delay, spacing and arrival
 * jitter, for choosing how far in the past to draw. Pure TypeScript and
 * allocation free after construction.
 */
export class TankBuffer {
  private times = new Float64Array(SIZE);
  private states: TankDrive[] = Array.from({ length: SIZE }, () => createTankDrive());
  private start = 0;
  count = 0;
  /** Samples drawn past the newest state because the next was late. */
  late = 0;
  /** Smoothed one-way delay (send to arrival), time between packets, and arrival jitter, ms. */
  transit = Number.NaN;
  interval = 1000 / 45;
  jitter = 0;
  private lastArrival = Number.NaN;
  private lastTransit = Number.NaN;

  /**
   * Add the state the host sent at local time `sentMs` (its clock
   * converted to ours), arriving at `nowMs`. States older than the newest
   * are dropped (a reordered packet).
   */
  push(sentMs: number, nowMs: number, state: TankDrive): void {
    if (this.count > 0 && sentMs <= this.times[this.index(this.count - 1)]) {
      return;
    }
    const transit = nowMs - sentMs;
    this.transit = Number.isNaN(this.transit) ? transit : this.transit + (transit - this.transit) / 16;
    if (!Number.isNaN(this.lastArrival)) {
      this.interval += (Math.min(nowMs - this.lastArrival, 500) - this.interval) / 16;
      this.jitter += (Math.abs(transit - this.lastTransit) - this.jitter) / 16;
    }
    this.lastArrival = nowMs;
    this.lastTransit = transit;
    if (this.count === SIZE) {
      this.start = (this.start + 1) % SIZE;
      this.count--;
    }
    const i = this.index(this.count);
    this.times[i] = sentMs;
    copyTankDrive(state, this.states[i]);
    this.count++;
  }

  /** The tank as it was at local time `atMs`, into `out`; false while empty. */
  sample(atMs: number, out: TankDrive): boolean {
    if (this.count === 0) return false;
    const first = this.index(0);
    if (atMs <= this.times[first]) {
      copyTankDrive(this.states[first], out);
      return true;
    }
    for (let k = 1; k < this.count; k++) {
      const b = this.index(k);
      if (atMs <= this.times[b]) {
        const a = this.index(k - 1);
        const t = (atMs - this.times[a]) / (this.times[b] - this.times[a]);
        lerpTankDrive(this.states[a], this.states[b], t, out);
        return true;
      }
    }
    const newest = this.index(this.count - 1);
    this.late++;
    extrapolateTankDrive(this.states[newest], Math.min(atMs - this.times[newest], MAX_EXTRAPOLATE_MS) / 1000, out);
    return true;
  }

  /** Local time of the newest state, ms (NaN while empty). */
  newestMs(): number {
    return this.count === 0 ? Number.NaN : this.times[this.index(this.count - 1)];
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
    this.transit = Number.NaN;
    this.lastArrival = Number.NaN;
    this.lastTransit = Number.NaN;
    this.jitter = 0;
  }

  private index(k: number): number {
    return (this.start + k) % SIZE;
  }
}
