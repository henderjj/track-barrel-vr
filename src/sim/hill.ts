/**
 * "Hold the hill" (F5.9, docs/hold-the-hill.md): the crew takes up a
 * hull-down position on the crest of the hold hill (src/sim/terrain.ts,
 * HOLD_HILL) and holds it against four enemy tanks coming at it from the
 * north in two waves (src/sim/enemy-tanks.ts, HILL_TANKS). Hull down, only
 * the turret shows over the crest: the enemy is slow to spot it and has a
 * third of the target, while the gun still clears the crest. Won when all
 * four are knocked out; lost when the tank is, or when an attacker reaches
 * the foot of the hill (the end of its route).
 *
 * The commander helps the driver find the spot: halted on the hill, a call
 * says whether the hull shows, only the turret (hull down), or the gun
 * can't clear the crest, judged from the nearest attacker (or, before any
 * comes, from the road 300 m north).
 *
 * Engine-free and deterministic: the host runs it, the tests drive it.
 */

import type { Vec3 } from './ballistics.js';
import { clock } from './combat.js';
import { FIRST_HILL, groundBlocks, HULL_SIGHT, obstaclesBlock, TANK_SILHOUETTE } from './enemy-guns.js';
import { ENEMY_TANK, HILL_TANKS } from './enemy-tanks.js';
import { groundHeight, HOLD_HILL, outsideHoldHill } from './terrain.js';

/** The scenario's numbers. */
export const HILL = {
  /** The battery's seed, so every run meets the same fall of shot for the same play. */
  seed: 5150,
  /** Where the tank starts: on the reverse slope's lower half, in the middle of the crest's length, facing north up the slope. World x, z. */
  startX: 192,
  startZ: HOLD_HILL.crest + 64,
  /** A hull-down spot behind the crest's middle (the Hull down button parks there), world z: 24 m behind the crest, the middle of the band (22 to 30 m) where only the turret shows to the whole approach and the gun clears the crest. */
  hullDownZ: HOLD_HILL.crest + 24,
  /** The first wave comes over the skyline this long after the start, s: time to drive up to the crest. */
  firstWave: 15,
  /** The second wave comes this long after the start, or once the first is all knocked out, s. */
  secondWave: 100,
  /** Which of HILL_TANKS come in each wave: two from the north, then one each from the east and the west. */
  waves: [
    [0, 1],
    [2, 3],
  ] as readonly (readonly number[])[],
  /** Before any attacker is in, the commander judges the crest from here, world x, z: the road 300 m north of the crest. */
  lookFrom: [192, HOLD_HILL.crest - 300] as readonly [number, number],
  /** The tank is halted below this speed, m/s, for this long, s, before the commander judges where it stands. */
  still: 0.4,
  stillFor: 1.5,
} as const;

/** The crew's gun's muzzle above the ground and ahead of the hull's middle, the gun level and laid ahead, m (turret.ts's muzzlePoint). */
export const GUN_MUZZLE = { height: 2.24, ahead: 5.47 } as const;

/**
 * Where the tank stands on the hill, as an attacker at a point sees it:
 * - `off`: not on the hill;
 * - `masked`: below the crest, out of its sight altogether;
 * - `blocked`: only the turret shows, but the gun can't clear the crest;
 * - `hull-down`: only the turret shows and the gun clears the crest;
 * - `exposed`: the hull shows over the crest.
 */
export type HoldView = 'off' | 'masked' | 'blocked' | 'hull-down' | 'exposed';

export const HOLD_VIEWS: readonly HoldView[] = ['off', 'masked', 'blocked', 'hull-down', 'exposed'];

/** What the commander tells the driver for each. */
export const HOLD_CALLS: Readonly<Record<HoldView, string>> = {
  off: '',
  masked: 'Below the crest: edge forward to see over',
  blocked: "Gun can't clear the crest: edge forward a little",
  'hull-down': 'Hull down: only the turret shows',
  exposed: 'Hull showing: back up a little',
};

/** The tank as the hold check needs it: where it stands and which way it faces. */
export interface HoldTank {
  x: number;
  z: number;
  heading: number;
}

const eye: Vec3 = [0, 0, 0];
const at: Vec3 = [0, 0, 0];
const muzzle: Vec3 = [0, 0, 0];
const aim: Vec3 = [0, 0, 0];

/** Whether the line from a to b is clear of the ground, the houses, walls and rocks, as an enemy's sight is (EnemyBattery.viewOf). */
function open(a: Readonly<Vec3>, b: Readonly<Vec3>): boolean {
  return !groundBlocks(a, b) && !obstaclesBlock(a, b);
}

/**
 * Where the tank stands as an enemy tank at (fromX, fromZ) (world, its
 * nearest copy) sees it, judged as the battery judges it: its muzzle's eye
 * on the hull (HULL_SIGHT up) and on the turret's top (0.3 m under it);
 * and whether the crew's gun, laid ahead, clears the crest to the enemy's
 * middle.
 */
export function holdView(t: Readonly<HoldTank>, fromX: number, fromZ: number): HoldView {
  if (outsideHoldHill(t.x, t.z) > 0) return 'off';
  const ground = groundHeight(t.x, t.z);
  eye[0] = fromX;
  eye[1] = groundHeight(fromX, fromZ) + ENEMY_TANK.muzzleHeight;
  eye[2] = fromZ;
  at[0] = t.x;
  at[1] = ground + HULL_SIGHT;
  at[2] = t.z;
  if (open(eye, at)) return 'exposed';
  at[1] = ground + TANK_SILHOUETTE.height - 0.3;
  if (!open(eye, at)) return 'masked';
  muzzle[0] = t.x - Math.sin(t.heading) * GUN_MUZZLE.ahead;
  muzzle[2] = t.z - Math.cos(t.heading) * GUN_MUZZLE.ahead;
  muzzle[1] = groundHeight(muzzle[0], muzzle[2]) + GUN_MUZZLE.height;
  aim[0] = fromX;
  aim[1] = eye[1] - ENEMY_TANK.muzzleHeight + ENEMY_TANK.height / 2;
  aim[2] = fromZ;
  return open(muzzle, aim) ? 'hull-down' : 'blocked';
}

export type HillPhase = 'off' | 'on' | 'won' | 'lost';

/** Why a run was lost: the tank knocked out, or an attacker reached the hill. */
export type HillLoss = '' | 'out' | 'overrun';

/** The scenario as both pages show it (the `hill` event). */
export interface HillSnapshot {
  phase: HillPhase;
  /** How long it has run (or ran), s. */
  time: number;
  /** Waves come so far: 0 before the first. */
  wave: number;
  /** Attackers knocked out, of how many have come, of all of them. */
  killed: number;
  came: number;
  total: number;
  /** When the enemy first spotted the tank, s into the run, or -1. */
  spottedAt: number;
  /** The enemy's shots at the tank, its hits, and hits through the armour. */
  shots: number;
  hits: number;
  through: number;
  /** How it was lost. */
  loss: HillLoss;
  /** Seconds some attacker saw the tank: all of it, or only its turret (hull down). */
  seenFull: number;
  seenTurret: number;
  /** Where the tank stands, as the commander last told the driver. */
  view: HoldView;
  v: number;
}

export function noHill(): HillSnapshot {
  return { phase: 'off', time: 0, wave: 0, killed: 0, came: 0, total: HILL_TANKS.length, spottedAt: -1, shots: 0, hits: 0, through: 0, loss: '', seenFull: 0, seenTurret: 0, view: 'off', v: 0 };
}

/** What the scenario reads from the fight each step. */
export interface HillInput {
  /** The tank is knocked out. */
  out: boolean;
  /** Some enemy has the tank spotted. */
  spotted: boolean;
  /** Of the attackers that have come: knocked out, and whether any has reached its route's end. */
  killed: number;
  arrived: boolean;
  /** What the attackers see of it now: the most any sees. */
  seen: 'none' | 'turret' | 'full';
  shots: number;
  hits: number;
  through: number;
  /** Where the tank stands, judged from the nearest attacker; and whether it has been halted long enough to tell the driver. */
  view: HoldView;
  halted: boolean;
}

/** The waves a run `time` s old has had, with `killed` of those come knocked out. */
export function wavesDue(time: number, killed: number, came: number, wave: number): number {
  if (wave === 0) return time >= HILL.firstWave ? 1 : 0;
  if (wave === 1 && (time >= HILL.secondWave || (came > 0 && killed >= came))) return 2;
  return wave;
}

/** The scenario's run, kept by the host. */
export class HillRun {
  readonly snap: HillSnapshot = noHill();

  start(): void {
    const v = this.snap.v;
    Object.assign(this.snap, noHill(), { phase: 'on', v: v + 1 });
  }

  stop(): void {
    if (this.snap.phase === 'off') return;
    this.snap.phase = 'off';
    this.snap.view = 'off';
    this.snap.v++;
  }

  /**
   * `dt` s on, while it runs: the clock, the waves (returns the new wave's
   * number when one is due, for the host to bring in; else 0), the counts,
   * the commander's call on where the tank stands, and whether it is won
   * or lost (`ended`).
   */
  step(dt: number, f: Readonly<HillInput>): { wave: number; ended: boolean } {
    const s = this.snap;
    const result = { wave: 0, ended: false };
    if (s.phase !== 'on') return result;
    s.time += dt;
    const due = wavesDue(s.time, f.killed, s.came, s.wave);
    if (due > s.wave) {
      s.wave = due;
      s.came += HILL.waves[due - 1].length;
      result.wave = due;
      s.v++;
    }
    if (s.spottedAt < 0 && f.spotted) {
      s.spottedAt = s.time;
      s.v++;
    }
    if (f.seen === 'full') s.seenFull += dt;
    else if (f.seen === 'turret') s.seenTurret += dt;
    if (f.killed !== s.killed || f.hits !== s.hits || f.through !== s.through) s.v++;
    s.killed = f.killed;
    s.shots = f.shots;
    s.hits = f.hits;
    s.through = f.through;
    // The commander judges where the tank stands once it has halted; on the move, or off the hill, the last call stands.
    const view = f.view === 'off' ? 'off' : f.halted ? f.view : s.view;
    if (view !== s.view) {
      s.view = view;
      s.v++;
    }
    if (f.out) s.loss = 'out';
    else if (f.arrived) s.loss = 'overrun';
    else if (!(s.wave === HILL.waves.length && s.killed >= s.total)) return result;
    s.phase = s.loss === '' ? 'won' : 'lost';
    s.v++;
    result.ended = true;
    return result;
  }
}

/** The share of the time in the enemy's sight that only the turret showed, 0 to 100, or -1 if never seen. */
export function hullDownShare(s: Readonly<HillSnapshot>): number {
  const seen = s.seenFull + s.seenTurret;
  return seen <= 0 ? -1 : Math.round((100 * s.seenTurret) / seen);
}

/** The briefing, on the sign as the scenario starts. */
export const HILL_BRIEFING = ['Hold the hill: take up a hull-down position on the crest', 'Four enemy tanks coming from the north. Knock them out before they reach the hill'] as const;

/** The debrief: the result, then the counts. */
export function hillDebrief(s: Readonly<HillSnapshot>): [string, string] {
  const head =
    s.phase === 'won'
      ? `Hill held: all ${s.total} tanks knocked out in ${clock(s.time)}`
      : s.phase === 'lost'
        ? s.loss === 'overrun'
          ? `The enemy took the hill after ${clock(s.time)}`
          : `Knocked out after ${clock(s.time)}`
        : s.phase === 'on'
          ? s.wave === 0
            ? `Take up position, ${clock(s.time)}`
            : `Holding the hill, ${clock(s.time)}`
          : 'Hold the hill: off';
  const spotted = s.spottedAt < 0 ? 'never spotted' : `spotted at ${clock(s.spottedAt)}`;
  const share = hullDownShare(s);
  const hullDown = share < 0 ? '' : `, hull down ${share}% of the time in their sight`;
  return [head, `${s.killed} of ${s.total} tanks out, ${spotted}, ${s.hits} hits taken of ${s.shots} shots, ${s.through} through${hullDown}`];
}

/** One line for the menu. */
export function hillLine(s: Readonly<HillSnapshot>): string {
  if (s.phase === 'off' && s.v === 0) return 'Hold the hill: off';
  const [head, counts] = hillDebrief(s);
  return `${head}. ${counts}`;
}

/** The board's tasks while it runs: where the tank stands, and the tanks still coming. */
export function hillTasks(s: Readonly<HillSnapshot>): string[] {
  const tasks: string[] = [];
  if (s.view !== 'off') tasks.push(HOLD_CALLS[s.view]);
  else tasks.push('Drive up behind the crest');
  if (s.wave > 0) tasks.push(`${s.killed} of ${s.total} tanks knocked out`);
  return tasks;
}

/** Read the `hill` event, or null if it is malformed. */
export function parseHill(raw: unknown): HillSnapshot | null {
  const e = raw as Partial<Record<keyof HillSnapshot, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!e || !['off', 'on', 'won', 'lost'].includes(e.phase as string) || num(e.time) === null || num(e.v) === null) return null;
  return {
    phase: e.phase as HillPhase,
    time: num(e.time) ?? 0,
    wave: num(e.wave) ?? 0,
    killed: num(e.killed) ?? 0,
    came: num(e.came) ?? 0,
    total: num(e.total) ?? HILL_TANKS.length,
    spottedAt: num(e.spottedAt) ?? -1,
    shots: num(e.shots) ?? 0,
    hits: num(e.hits) ?? 0,
    through: num(e.through) ?? 0,
    loss: e.loss === 'out' || e.loss === 'overrun' ? e.loss : '',
    seenFull: num(e.seenFull) ?? 0,
    seenTurret: num(e.seenTurret) ?? 0,
    view: HOLD_VIEWS.includes(e.view as HoldView) ? (e.view as HoldView) : 'off',
    v: num(e.v) ?? 0,
  };
}

/** Attacker `k` of HILL_TANKS as an enemy index. */
export function hillEnemy(k: number): number {
  return FIRST_HILL + k;
}
