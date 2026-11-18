/**
 * Scenario: escort a convoy (F5.8, docs/escort.md). Four trucks follow the
 * crew's tank up the range road to the 600 m marker, past the guns dug in
 * on the left and, once the convoy is well up the road, the enemy tanks.
 * The trucks keep a set gap behind the tank, so where the crew halts, the
 * convoy halts: the crew decides how far into the guns' sight the trucks
 * come. The guns are laid for the convoy and fire on a truck they can see
 * before the tank; the tanks hunt the escort. One hit knocks a truck out.
 * Won when the trucks still running (at least two) reach the marker; lost
 * when fewer than two are left, or the tank is knocked out.
 *
 * Engine-free and deterministic: the host runs it, the guest steps the same
 * trucks from the tank it sees and is corrected by the host's `escort`
 * event, and the tests drive it. Distances are along the range road (x 0),
 * d = -z (world; the range's start is 0).
 */

import { clock } from './combat.js';

/** A truck as the enemy aims at it: its length, width and height to the top of its canvas tilt, m. */
export const TRUCK = { length: 6.4, width: 2.25, height: 2.85 } as const;

/** The convoy's numbers. */
export const ESCORT = {
  /** Trucks in the convoy. */
  trucks: 4,
  /** They drive on the road's right half, x (world), m; a knocked-out truck slews off onto the verge. */
  x: 1.6,
  wreckX: 5.6,
  /** Where the lead truck waits at the start, d (its gap behind the tank at the range's start), and the gap between trucks, m. */
  start: -50,
  spacing: 20,
  /** The lead truck keeps this far behind the tank (along the road), m. */
  gap: 50,
  /** Top speed, reversing speed, m/s (about 22 and 7 km/h), and how hard they speed up or brake, m/s². */
  speed: 6,
  reverse: 2,
  accel: 1.5,
  /** How eagerly a truck closes on where it wants to be: m/s per m off. */
  follow: 0.4,
  /** The destination: the 600 m marker, d; once the tank is there, the trucks drive in past it. */
  end: 600,
  destination: 'the 600 m marker',
  /** The trucks that must get through. */
  need: 2,
  /** The battery's seed. */
  seed: 5180,
  /** The enemy tanks come up once the lead truck is this far up the road, or the crew has knocked out this many guns. */
  tanksAtD: 250,
  tanksAfterGuns: 2,
  /** Missions → Escort a convoy → Ambush: the tank this far up the road, the convoy closed up behind it, gun A laid on the trucks. */
  ambushD: 210,
} as const;

/** The trucks' names, as the signs say them. */
export const TRUCK_NAMES = ['Truck 1', 'Truck 2', 'Truck 3', 'Truck 4'] as const;

export type EscortPhase = 'off' | 'on' | 'won' | 'lost';

/** The scenario as both pages show it (the `escort` event). */
export interface EscortSnapshot {
  phase: EscortPhase;
  /** How long it has run (or ran), s. */
  time: number;
  /** Each truck's place along the road, d, its speed, m/s, and whether it still runs. */
  d: number[];
  speed: number[];
  alive: boolean[];
  /** Which enemy knocked each truck out (an enemy index), or -1. */
  by: number[];
  /** The tank has reached the destination: the trucks drive in past it. */
  released: boolean;
  /** Lost because the tank was knocked out (else because too many trucks were). */
  tankOut: boolean;
  /** Enemies knocked out, of how many. */
  killed: number;
  enemies: number;
  /** The enemy's shots at the trucks, and at the tank: its hits, and hits through the armour. */
  truckShots: number;
  shots: number;
  hits: number;
  through: number;
  /** The enemy tanks have come up. */
  tanksIn: boolean;
  v: number;
}

/** The trucks waiting at the start. */
function startPlaces(): number[] {
  return Array.from({ length: ESCORT.trucks }, (_, k) => ESCORT.start - k * ESCORT.spacing);
}

export function noEscort(): EscortSnapshot {
  return {
    phase: 'off',
    time: 0,
    d: startPlaces(),
    speed: Array.from({ length: ESCORT.trucks }, () => 0),
    alive: Array.from({ length: ESCORT.trucks }, () => true),
    by: Array.from({ length: ESCORT.trucks }, () => -1),
    released: false,
    tankOut: false,
    killed: 0,
    enemies: 0,
    truckShots: 0,
    shots: 0,
    hits: 0,
    through: 0,
    tanksIn: false,
    v: 0,
  };
}

/**
 * Whether a truck `d` along the road is in sight of the enemy at all. Waiting
 * behind the start (d < 0) it is in the start field's cover, forming up: the
 * ground repeats every 800 m, and without this the copy of gun B in the tile
 * behind the start would see the last two trucks from 330 m.
 */
export function truckExposed(d: number): boolean {
  return d >= 0;
}

/** Trucks still running. */
export function trucksLeft(s: Readonly<EscortSnapshot>): number {
  let n = 0;
  for (const a of s.alive) if (a) n++;
  return n;
}

/** Trucks still running that are past the destination. */
export function trucksIn(s: Readonly<EscortSnapshot>): number {
  let n = 0;
  for (let k = 0; k < s.d.length; k++) if (s.alive[k] && s.d[k] >= ESCORT.end) n++;
  return n;
}

/**
 * The trucks `dt` s on, following the tank `tankD` along the road (d), into
 * `s` (d and speed). Each running truck wants to be `gap` behind the tank
 * (the lead) or `spacing` behind the running truck ahead; once released, the
 * lead drives in past the destination, far enough for every truck behind to
 * pass it. It closes on that place at up to its top speed (or backs at its
 * reversing speed), speeding up and braking no harder than `accel`, and never
 * closer than most of a spacing to the truck ahead. A knocked-out truck
 * stays where it stopped.
 */
export function driveTrucks(s: EscortSnapshot, dt: number, tankD: number): void {
  let ahead = Infinity;
  for (let k = 0; k < s.d.length; k++) {
    if (!s.alive[k]) {
      s.speed[k] = 0;
      continue;
    }
    const want =
      ahead < Infinity ? ahead - ESCORT.spacing : s.released ? ESCORT.end + ESCORT.spacing * ESCORT.trucks : tankD - ESCORT.gap;
    const wish = Math.max(-ESCORT.reverse, Math.min(ESCORT.speed, (want - s.d[k]) * ESCORT.follow));
    const change = ESCORT.accel * dt;
    s.speed[k] += Math.max(-change, Math.min(change, wish - s.speed[k]));
    s.d[k] += s.speed[k] * dt;
    const closest = ahead - 0.7 * ESCORT.spacing;
    if (s.d[k] > closest) {
      s.d[k] = closest;
      s.speed[k] = Math.min(s.speed[k], 0);
    }
    ahead = s.d[k];
  }
}

/** What the scenario reads from the fight each step. */
export interface EscortInput {
  /** The tank's place along the road, d (-z). */
  tankD: number;
  /** The tank is knocked out. */
  out: boolean;
  gunsKilled: number;
  killed: number;
  enemies: number;
  truckShots: number;
  shots: number;
  hits: number;
  through: number;
}

/** The scenario's run, kept by the host. */
export class EscortRun {
  readonly snap: EscortSnapshot = noEscort();

  start(): void {
    const v = this.snap.v;
    Object.assign(this.snap, noEscort(), { phase: 'on', v: v + 1 });
  }

  stop(): void {
    if (this.snap.phase === 'off') return;
    this.snap.phase = 'off';
    this.snap.v++;
  }

  /** Missions → Escort a convoy → Ambush: the convoy closed up behind the tank at `tankD`. */
  closeUp(tankD: number): void {
    const s = this.snap;
    for (let k = 0; k < s.d.length; k++) {
      s.d[k] = tankD - ESCORT.gap - k * ESCORT.spacing;
      s.speed[k] = 0;
    }
    s.v++;
  }

  /** Truck `k` was hit by enemy `by`: it is knocked out where it stands. Returns whether it was running. */
  knockOut(k: number, by = -1): boolean {
    const s = this.snap;
    if (s.phase !== 'on' || !s.alive[k]) return false;
    s.alive[k] = false;
    s.by[k] = by;
    s.speed[k] = 0;
    s.v++;
    return true;
  }

  /**
   * `dt` s on, while it runs: the trucks follow the tank, the counts, whether
   * the tanks come up now (the host then starts them), and whether it is won
   * or lost. Returns whether the phase changed.
   */
  step(dt: number, f: Readonly<EscortInput>): boolean {
    const s = this.snap;
    if (s.phase !== 'on') return false;
    s.time += dt;
    if (!s.released && f.tankD >= ESCORT.end) {
      s.released = true;
      s.v++;
    }
    driveTrucks(s, dt, f.tankD);
    const lead = s.d.find((_, k) => s.alive[k]) ?? -Infinity;
    if (!s.tanksIn && (lead >= ESCORT.tanksAtD || f.gunsKilled >= ESCORT.tanksAfterGuns)) {
      s.tanksIn = true;
      s.v++;
    }
    if (f.killed !== s.killed || f.hits !== s.hits || f.through !== s.through || f.enemies !== s.enemies) s.v++;
    s.killed = f.killed;
    s.enemies = f.enemies;
    s.truckShots = f.truckShots;
    s.shots = f.shots;
    s.hits = f.hits;
    s.through = f.through;
    const left = trucksLeft(s);
    if (f.out) {
      s.phase = 'lost';
      s.tankOut = true;
    } else if (left < ESCORT.need) {
      s.phase = 'lost';
    } else if (s.released && trucksIn(s) === left) {
      s.phase = 'won';
    } else {
      return false;
    }
    s.v++;
    return true;
  }
}

/** The briefing, on the sign as the scenario starts. */
export const ESCORT_BRIEFING = [
  'Escort a convoy: four trucks to the 600 m marker',
  'They follow 50 m behind you. Guns dug in on the left, tanks beyond',
] as const;

/** The debrief: the result, then the counts. */
export function escortDebrief(s: Readonly<EscortSnapshot>): [string, string] {
  const lost = ESCORT.trucks - trucksLeft(s);
  const head =
    s.phase === 'won'
      ? `Convoy through in ${clock(s.time)}: ${trucksLeft(s)} of ${ESCORT.trucks} trucks`
      : s.phase === 'lost'
        ? s.tankOut
          ? `Escort knocked out after ${clock(s.time)}`
          : `Convoy lost after ${clock(s.time)}: ${lost} of ${ESCORT.trucks} trucks knocked out`
        : s.phase === 'on'
          ? `Escorting, ${clock(s.time)}, ${trucksLeft(s)} of ${ESCORT.trucks} trucks`
          : 'Convoy off';
  const trucks = lost === 0 ? 'no truck lost' : lost === 1 ? '1 truck lost' : `${lost} trucks lost`;
  return [head, `${s.killed} of ${s.enemies} enemies out, ${s.truckShots} shots at the trucks, ${trucks}; hit ${s.hits} times, ${s.through} through`];
}

/** One line for the menu. */
export function escortLine(s: Readonly<EscortSnapshot>): string {
  if (s.phase === 'off' && s.v === 0) return 'Escort a convoy: off';
  const [head, counts] = escortDebrief(s);
  return `${head}. ${counts}`;
}

/** The distance the lead running truck has left to the destination, to 10 m. */
export function convoyToGo(s: Readonly<EscortSnapshot>): number {
  const lead = s.d.find((_, k) => s.alive[k]);
  return lead === undefined ? 0 : Math.max(0, Math.round((ESCORT.end - lead) / 10) * 10);
}

/** The crew board's lines while it runs or after: the objective, then the tasks. */
export function escortBoard(s: Readonly<EscortSnapshot>): { objective: string; tasks: { text: string; done: boolean }[] } {
  if (s.phase === 'on') {
    return {
      objective: `Convoy to the 600 m marker, ${convoyToGo(s)} m`,
      tasks: [
        { text: `Trucks: ${trucksLeft(s)} of ${ESCORT.trucks} running`, done: false },
        { text: `Enemies: ${s.killed} of ${s.enemies} out`, done: s.enemies > 0 && s.killed >= s.enemies },
        { text: s.released ? 'Convoy driving in' : 'Lead them in: they follow you', done: s.released },
      ],
    };
  }
  const [head] = escortDebrief(s);
  return {
    objective: head,
    tasks: [
      { text: `${s.killed} of ${s.enemies} enemies out`, done: s.enemies > 0 && s.killed >= s.enemies },
      { text: `Hit ${s.hits} times, ${s.through} through`, done: false },
    ],
  };
}

/** Read the `escort` event, or null if it is malformed. */
export function parseEscort(raw: unknown): EscortSnapshot | null {
  const e = raw as Partial<Record<keyof EscortSnapshot, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!e || !['off', 'on', 'won', 'lost'].includes(e.phase as string) || num(e.time) === null || num(e.v) === null) return null;
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
  const d = list(e.d);
  const speed = list(e.speed);
  const alive = list(e.alive);
  const by = list(e.by);
  const base = noEscort();
  return {
    phase: e.phase as EscortPhase,
    time: num(e.time) ?? 0,
    d: base.d.map((v, k) => num(d[k]) ?? v),
    speed: base.speed.map((v, k) => num(speed[k]) ?? v),
    alive: base.alive.map((_, k) => alive[k] !== false),
    by: base.by.map((v, k) => (typeof by[k] === 'number' && Number.isInteger(by[k]) ? (by[k] as number) : v)),
    released: e.released === true,
    tankOut: e.tankOut === true,
    killed: num(e.killed) ?? 0,
    enemies: num(e.enemies) ?? 0,
    truckShots: num(e.truckShots) ?? 0,
    shots: num(e.shots) ?? 0,
    hits: num(e.hits) ?? 0,
    through: num(e.through) ?? 0,
    tanksIn: e.tanksIn === true,
    v: num(e.v) ?? 0,
  };
}

/** Copy `from` into `to`, reusing its lists. */
export function copyEscort(from: Readonly<EscortSnapshot>, to: EscortSnapshot): EscortSnapshot {
  const { d, speed, alive, by } = to;
  Object.assign(to, from);
  to.d = d;
  to.speed = speed;
  to.alive = alive;
  to.by = by;
  for (let k = 0; k < ESCORT.trucks; k++) {
    d[k] = from.d[k];
    speed[k] = from.speed[k];
    alive[k] = from.alive[k];
    by[k] = from.by[k];
  }
  return to;
}
