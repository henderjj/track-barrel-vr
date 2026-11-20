/**
 * The crank drill (docs/turret.md "Laying blind"): Practice → Sights →
 * Crank drill puts the gun off one of the range's boards and the gunner's
 * eye at the sight, and times the gunner laying it back on with the
 * cranks alone, counting the overshoots: so a headset check of the gun's
 * cranks has numbers to compare, before and after a change (John,
 * 2026-11-20). Engine-free, so it is unit tested (test/crank-drill.test.ts).
 *
 * Errors are where the board sits from the mark for its range, in mils
 * (src/sim/gunsight.ts `sightError`): across positive to the right, up
 * positive above.
 */

/** Laid: the board within this of the mark both ways, mils... */
export const DRILL_LAID = 0.5;
/** ...for this long, s. */
export const DRILL_HOLD = 1;
/** A drill not laid by now has run out, s. */
export const DRILL_LIMIT = 90;
/** Going this far past the mark the other way counts as an overshoot, mils. */
export const DRILL_OVERSHOOT = 0.3;
/**
 * Where each drill starts the board from the mark, mils across and up, in
 * turn: a few turns of the elevation handwheel (13 mils a turn) and most of
 * a turn of the traverse crank (35 a turn), each way.
 */
export const DRILL_STARTS: readonly (readonly [number, number])[] = [
  [12, -30],
  [-20, 45],
  [8, 25],
  [-30, -20],
];

/** How a drill ended: laid (or ran out) after `seconds`, with how many overshoots each way. */
export interface DrillResult {
  laid: boolean;
  seconds: number;
  overshootsAcross: number;
  overshootsUp: number;
}

/** One way's overshoots: the side of the mark the board was last surely on, and how many times it went surely past. */
class Overshoots {
  count = 0;
  private side = 0;

  start(error: number): void {
    this.count = 0;
    this.side = Math.sign(error);
  }

  step(error: number): void {
    if (Math.abs(error) < DRILL_OVERSHOOT) return;
    const side = Math.sign(error);
    if (this.side !== 0 && side !== this.side) this.count++;
    this.side = side;
  }
}

export class CrankDrill {
  /** Running: the board is off and the clock going. */
  running = false;
  /** How long it has run, s. */
  time = 0;
  /** How long the board has stayed on the mark, s. */
  private on = 0;
  private across = new Overshoots();
  private up = new Overshoots();
  /** How the last drill ended, or null before one has. */
  result: DrillResult | null = null;

  /** Start the clock with the board `across`, `up` mils from the mark. */
  start(across: number, up: number): void {
    this.running = true;
    this.time = 0;
    this.on = 0;
    this.across.start(across);
    this.up.start(up);
  }

  stop(): void {
    this.running = false;
  }

  /** `dt` later, the board `across`, `up` mils from the mark: the result once it is laid or has run out, else null. */
  step(dt: number, across: number, up: number): DrillResult | null {
    if (!this.running) return null;
    this.time += dt;
    this.across.step(across);
    this.up.step(up);
    this.on = Math.abs(across) <= DRILL_LAID && Math.abs(up) <= DRILL_LAID ? this.on + dt : 0;
    const laid = this.on >= DRILL_HOLD;
    if (!laid && this.time < DRILL_LIMIT) return null;
    this.running = false;
    // The time it took to get on the mark, not the second held there.
    this.result = { laid, seconds: laid ? this.time - this.on : this.time, overshootsAcross: this.across.count, overshootsUp: this.up.count };
    return this.result;
  }
}

/** What the drill says of `r`: "Laid in 14.2 s. Overshoots: 1 up/down, 0 across". */
export function drillSummary(r: DrillResult): string {
  const head = r.laid ? `Laid in ${r.seconds.toFixed(1)} s` : `Not laid in ${DRILL_LIMIT} s`;
  return `${head}. Overshoots: ${r.overshootsUp} up/down, ${r.overshootsAcross} across`;
}
