/** How many states are kept: about a third of a second at 45 Hz. */
const SIZE = 16;
/** Longest a state is carried on past the newest when the next is late, ms. */
export const MAX_EXTRAPOLATE_MS = 150;

/** How a buffer makes, copies, blends and carries on its states. */
export interface StateKind<T> {
  create(): T;
  copy(from: T, to: T): T;
  lerp(a: T, b: T, t: number, out: T): T;
  /** `state` carried on `seconds` past its time, into `out`. */
  extrapolate(state: T, seconds: number, out: T): T;
}

/**
 * A jitter buffer for another page's states of something that moves every
 * frame (the host's tank, F1.4; the gunner's turret, F1.8), like
 * PoseBuffer for the crewmate: states are kept by the local time they
 * describe, and the page draws the thing a little in the past, between two
 * of them, so it moves smoothly even though packets arrive unevenly. Past
 * the newest it carries the state on for a short while. It also measures
 * the packets' one-way delay, spacing and arrival jitter, for choosing how
 * far in the past to draw. Pure TypeScript and allocation free after
 * construction.
 */
export class StateBuffer<T> {
  private times = new Float64Array(SIZE);
  private states: T[];
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

  constructor(private kind: StateKind<T>) {
    this.states = Array.from({ length: SIZE }, () => kind.create());
  }

  /**
   * Add the state sent at local time `sentMs` (the sender's clock
   * converted to ours), arriving at `nowMs`. States older than the newest
   * are dropped (a reordered packet).
   */
  push(sentMs: number, nowMs: number, state: T): void {
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
    this.kind.copy(state, this.states[i]);
    this.count++;
  }

  /** The state as it was at local time `atMs`, into `out`; false while empty. */
  sample(atMs: number, out: T): boolean {
    if (this.count === 0) return false;
    const first = this.index(0);
    if (atMs <= this.times[first]) {
      this.kind.copy(this.states[first], out);
      return true;
    }
    for (let k = 1; k < this.count; k++) {
      const b = this.index(k);
      if (atMs <= this.times[b]) {
        const a = this.index(k - 1);
        const t = (atMs - this.times[a]) / (this.times[b] - this.times[a]);
        this.kind.lerp(this.states[a], this.states[b], t, out);
        return true;
      }
    }
    const newest = this.index(this.count - 1);
    this.late++;
    this.kind.extrapolate(this.states[newest], Math.min(atMs - this.times[newest], MAX_EXTRAPOLATE_MS) / 1000, out);
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
