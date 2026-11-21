/**
 * The map-reading course (F2.12, docs/nav-course.md): five checkpoints,
 * picked afresh each run from places a map shows (a bridge, a spot height,
 * a house, a road junction ...), given to the crew only as six-figure grid
 * references on the orders board and as numbered red circles on the
 * commander's map. Nothing marks them on the ground. The crew drives to each
 * in turn, the commander reading the map and the compasses to find the way;
 * the host times it and calls each checkpoint as the tank reaches it.
 * Engine-free: the places, the pick, the run and its event.
 *
 * World space as src/sim/terrain.ts: +X east, −Z north.
 */

import { gridRef } from './field-map.js';
import { rng } from './random.js';

/** A place a checkpoint can be: on open ground beside something the map shows, so it can be found and driven to. */
export interface NavPlace {
  /** What it is beside, for the debrief (the crew is only given its grid reference). */
  name: string;
  x: number;
  z: number;
}

/**
 * The places, from what the map draws (src/sim/field-map.ts mapFeatures):
 * each a little off its feature, clear of houses, walls and water.
 */
export const NAV_PLACES: readonly NavPlace[] = [
  { name: 'the south end of the bridge', x: 60, z: -166 },
  { name: 'the spot height on the course hill', x: 144, z: -280 },
  { name: 'the hold hill crest', x: 192, z: -496 },
  { name: 'the house by the range road', x: 50, z: -320 },
  { name: 'the house in the west', x: -300, z: -257 },
  { name: 'the cross roads in the north', x: 0, z: -800 },
  { name: 'the ambush wall', x: -160, z: -530 },
  { name: 'the house east of the range', x: 230, z: -402 },
  { name: 'the house behind the hold hill', x: 295, z: -528 },
  { name: 'the house in the north-west', x: -80, z: -680 },
  { name: 'the 600 m marker', x: 13, z: -600 },
  { name: 'the biathlon firing boxes', x: 320, z: -160 },
];

export const NAV = {
  /** Checkpoints a run. */
  points: 5,
  /** The tank's middle this near a checkpoint reaches it, m. */
  arrive: 20,
  /** Where every run starts: the start point, SP on the map. */
  start: { x: 0, z: 0 },
  /** The par time is the legs' straight-line length at this, m/s (22 km/h), with a fifth more for the way round. */
  parSpeed: 6,
  parDetour: 1.2,
  /** Medals: within these times the par. */
  gold: 1,
  silver: 1.3,
  bronze: 1.7,
} as const;

/** A run's checkpoints, as indices into NAV_PLACES in the order to reach them, for a seed: picked at random, ordered nearest first from the start. */
export function pickCourse(seed: number): number[] {
  const random = rng(seed);
  const left = NAV_PLACES.map((_, i) => i);
  // Shuffle, then keep the first few.
  for (let i = left.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [left[i], left[j]] = [left[j], left[i]];
  }
  const chosen = left.slice(0, NAV.points);
  const order: number[] = [];
  let x: number = NAV.start.x;
  let z: number = NAV.start.z;
  while (chosen.length > 0) {
    let best = 0;
    for (let k = 1; k < chosen.length; k++) {
      const a = NAV_PLACES[chosen[k]];
      const b = NAV_PLACES[chosen[best]];
      if (Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z)) best = k;
    }
    const next = chosen.splice(best, 1)[0];
    order.push(next);
    x = NAV_PLACES[next].x;
    z = NAV_PLACES[next].z;
  }
  return order;
}

/** The legs' straight-line length from the start through each checkpoint, m. */
export function courseLength(cps: readonly number[]): number {
  let x: number = NAV.start.x;
  let z: number = NAV.start.z;
  let length = 0;
  for (const i of cps) {
    const p = NAV_PLACES[i];
    length += Math.hypot(p.x - x, p.z - z);
    x = p.x;
    z = p.z;
  }
  return length;
}

/** The par time for a course, s. */
export function parTime(cps: readonly number[]): number {
  return (courseLength(cps) * NAV.parDetour) / NAV.parSpeed;
}

export type NavMedal = 'gold' | 'silver' | 'bronze' | '';

/** The medal a time earns on a course. */
export function navMedal(time: number, cps: readonly number[]): NavMedal {
  const par = parTime(cps);
  if (time <= par * NAV.gold) return 'gold';
  if (time <= par * NAV.silver) return 'silver';
  if (time <= par * NAV.bronze) return 'bronze';
  return '';
}

/** A checkpoint's six-figure grid reference, as the board gives it. */
export function cpRef(place: number): string {
  const p = NAV_PLACES[place];
  return gridRef(p.x, p.z, 6);
}

/** A run, as the host keeps it and both pages show it. */
export interface NavState {
  on: boolean;
  seed: number;
  /** The checkpoints, in order (indices into NAV_PLACES). */
  cps: number[];
  /** The next to reach (cps.length when all are). */
  next: number;
  /** Since the start, s. */
  time: number;
  /** When each was reached, s. */
  splits: number[];
  /** Bumped on every change the guest must see. */
  v: number;
}

export function createNav(): NavState {
  return { on: false, seed: 0, cps: [], next: 0, time: 0, splits: [], v: 0 };
}

/** Start a run on the course for `seed`. */
export function startNav(s: NavState, seed: number): void {
  s.on = true;
  s.seed = seed;
  s.cps = pickCourse(seed);
  s.next = 0;
  s.time = 0;
  s.splits = [];
  s.v++;
}

/** Stop the run, or clear a finished one off the board and the map. */
export function stopNav(s: NavState): void {
  if (!s.on && s.cps.length === 0) return;
  s.on = false;
  s.cps = [];
  s.next = 0;
  s.splits = [];
  s.v++;
}

/** Whether every checkpoint is reached. */
export function navDone(s: Readonly<NavState>): boolean {
  return s.cps.length > 0 && s.next >= s.cps.length;
}

/**
 * Step the host's run `dt` s with the tank at (x, z): the clock runs until
 * the last checkpoint; the index of a checkpoint reached this step, or -1.
 */
export function stepNav(s: NavState, x: number, z: number, dt: number): number {
  if (!s.on || navDone(s)) return -1;
  s.time += dt;
  const p = NAV_PLACES[s.cps[s.next]];
  if (Math.hypot(p.x - x, p.z - z) > NAV.arrive) return -1;
  s.splits.push(s.time);
  const reached = s.next;
  s.next++;
  if (navDone(s)) s.on = false;
  s.v++;
  return reached;
}

/** The board's lines: the next checkpoint and the one after, and how many reached. */
export function navTasks(s: Readonly<NavState>): string[] {
  const lines: string[] = [];
  for (let k = s.next; k < Math.min(s.cps.length, s.next + 2); k++) lines.push(`${k === s.next ? 'Next' : 'Then'}: CP${k + 1} at ${cpRef(s.cps[k])}`);
  lines.push(`Reached ${s.next} of ${s.cps.length}`);
  return lines;
}

/** The line for a finished run. */
export function navResult(s: Readonly<NavState>): string {
  const t = s.splits[s.splits.length - 1] ?? s.time;
  const medal = navMedal(t, s.cps);
  const m = Math.floor(t / 60);
  const r = Math.floor(t % 60);
  return `Map reading: all ${s.cps.length} in ${m}:${r < 10 ? '0' : ''}${r}${medal ? `, ${medal}` : ''}`;
}

/** The `nav` event the host sends: the whole run. */
export interface NavEvent {
  t: 'nav';
  on: boolean;
  seed: number;
  next: number;
  time: number;
  splits: number[];
  v: number;
}

export function navEvent(s: Readonly<NavState>): NavEvent {
  return { t: 'nav', on: s.on, seed: s.seed, next: s.next, time: s.time, splits: [...s.splits], v: s.v };
}

/** Take the host's run (a guest): its checkpoints from its seed. False if it isn't one or is older. */
export function applyNav(s: NavState, e: unknown): boolean {
  const o = e as Partial<NavEvent> | null;
  if (!o || typeof o.on !== 'boolean' || typeof o.v !== 'number' || typeof o.seed !== 'number' || typeof o.next !== 'number' || typeof o.time !== 'number') return false;
  if (!Array.isArray(o.splits) || !o.splits.every((t) => typeof t === 'number' && Number.isFinite(t))) return false;
  if (o.v <= s.v) return false;
  const shown = o.on || o.splits.length > 0;
  s.on = o.on;
  s.seed = o.seed;
  s.cps = shown ? pickCourse(o.seed) : [];
  s.next = Math.max(0, Math.min(s.cps.length, Math.floor(o.next)));
  s.time = o.time;
  s.splits = o.splits.slice(0, s.cps.length);
  s.v = o.v;
  return true;
}
