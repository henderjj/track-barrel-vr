/**
 * Recon unseen (F5.10, docs/recon-ambush.md): find the three dug-in guns
 * and the two patrolling tanks, report each by laying the gun on it for a
 * few seconds while it is in view, and come back to the start, all without
 * any of them spotting the tank. The enemy's spotting is the combat
 * scenario's (F3.10, src/sim/combat.ts): it builds up over time with the
 * range, and faster while the tank moves or fires, slower hull down. The
 * moment one of them has the tank spotted, the recon has failed.
 *
 * Engine-free and deterministic: the host runs it, the tests drive it.
 * World space as src/sim/range.ts.
 */

import type { Vec3 } from './ballistics.js';
import { clock } from './combat.js';
import { ENEMY_TANK } from './enemy-tanks.js';
import { enemyName, FIRST_COLUMN, FIRST_TANK, GUN_SHIELD, groundBlocks, gunNear, obstaclesBlock, type SightCheck, TANK_SILHOUETTE } from './enemy-guns.js';
import { groundHeight } from './terrain.js';

/** The enemies to report: the three guns and the two tanks (the battery's first five). */
export const RECON_ENEMIES = FIRST_COLUMN;

/** The recon's numbers. */
export const RECON = {
  /** The battery's seed, so every run meets the same enemy for the same play. */
  seed: 5150,
  /** An enemy can be reported from this far and nearer, m: inside the fog (FOG.far 780), past a gun's own eyes (600). */
  reportRange: 650,
  /** Laid on it this long in all, s, reports it. */
  reportFor: 3,
  /** The gun is on it within this much either side, rad (8°): the gunsight's and the gunner's periscope's view. */
  cone: (8 * Math.PI) / 180,
  /** The crew's eyes above the ground: the turret's top, where an enemy sees it over cover (as HULL_SIGHT's turret check). */
  eye: TANK_SILHOUETTE.height - 0.3,
  /** Back within this of the start, with every enemy reported, wins, m. */
  home: 60,
  /** An enemy this far to spotting the tank puts up a warning, and it is armed again under `calm`. */
  watched: 0.5,
  calm: 0.3,
} as const;

/**
 * Whether the crew at (x, z) on ground `ground`, its gun pointing `gunYaw`
 * (rad, as heading: 0 faces -z, the hull's heading plus the turret's turn)
 * has enemy `i` (`d` m along its route) in view to report: within
 * reportRange, inside the cone either side of the gun, and a clear line
 * from the turret's top to it past the ground, the houses, walls and rocks
 * and `clear` (the smoke).
 */
export function inReportView(i: number, x: number, z: number, ground: number, gunYaw: number, d: number, clear: SightCheck): boolean {
  const at = gunNear(i, x, z, near, d);
  const dx = at[0] - x;
  const dz = at[1] - z;
  if (Math.hypot(dx, dz) > RECON.reportRange) return false;
  const off = Math.atan2(-dx, -dz) - gunYaw;
  if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > RECON.cone) return false;
  eye[0] = x;
  eye[1] = ground + RECON.eye;
  eye[2] = z;
  mark[0] = at[0];
  mark[1] = groundHeight(at[0], at[1]) + (i >= FIRST_TANK ? ENEMY_TANK.height / 2 : GUN_SHIELD.middle);
  mark[2] = at[1];
  return !groundBlocks(eye, mark) && !obstaclesBlock(eye, mark) && clear(eye, mark);
}
const near: [number, number] = [0, 0];
const eye: Vec3 = [0, 0, 0];
const mark: Vec3 = [0, 0, 0];

export type ReconPhase = 'off' | 'on' | 'won' | 'lost';

/** The recon as both pages show it (the `recon` event). */
export interface ReconSnapshot {
  phase: ReconPhase;
  /** How long it has run (or ran), s. */
  time: number;
  /** Each enemy reported (or knocked out: found all the same). */
  reported: boolean[];
  /** The most any enemy has got to spotting the tank now, and the most in the run (0 to 1). */
  watch: number;
  closest: number;
  /** Times a warning went up (it was nearly seen). */
  warned: number;
  /** The enemy that spotted it, or -1. */
  spottedBy: number;
  /** Shells the crew fired. */
  shots: number;
  v: number;
}

export function noRecon(): ReconSnapshot {
  return { phase: 'off', time: 0, reported: Array.from({ length: RECON_ENEMIES }, () => false), watch: 0, closest: 0, warned: 0, spottedBy: -1, shots: 0, v: 0 };
}

/** What the recon reads from the fight each step. */
export interface ReconInput {
  /** The tank's distance from the start, m. */
  fromStart: number;
  /** Each enemy in view with the gun on it (inReportView), there and alive. */
  laid: readonly boolean[];
  /** Each enemy knocked out. */
  out: readonly boolean[];
  /** Each enemy's spotting of the tank, 0 to 1. */
  spot: readonly number[];
  /** The enemy that has the tank spotted (laying on it), or -1. */
  spottedBy: number;
}

/** The recon's run, kept by the host. */
export class ReconRun {
  readonly snap: ReconSnapshot = noRecon();
  /** How long the gun has been on each enemy, s. */
  readonly laidFor: number[] = Array.from({ length: RECON_ENEMIES }, () => 0);
  private armed = true;

  start(): void {
    const v = this.snap.v;
    Object.assign(this.snap, noRecon(), { phase: 'on', v: v + 1 });
    this.laidFor.fill(0);
    this.armed = true;
  }

  stop(): void {
    if (this.snap.phase === 'off') return;
    this.snap.phase = 'off';
    this.snap.v++;
  }

  /** The crew fired a shell. */
  fired(): void {
    if (this.snap.phase !== 'on') return;
    this.snap.shots++;
    this.snap.v++;
  }

  /**
   * `dt` s on, while it runs: reports, the watch, and whether it is won
   * (every enemy reported, back at the start) or lost (spotted). Returns
   * whether the phase changed.
   */
  step(dt: number, f: Readonly<ReconInput>): boolean {
    const s = this.snap;
    if (s.phase !== 'on') return false;
    s.time += dt;
    for (let i = 0; i < RECON_ENEMIES; i++) {
      if (s.reported[i]) continue;
      if (f.out[i]) {
        s.reported[i] = true;
        s.v++;
        continue;
      }
      if (f.laid[i]) this.laidFor[i] += dt;
      if (this.laidFor[i] >= RECON.reportFor) {
        s.reported[i] = true;
        s.v++;
      }
    }
    let watch = 0;
    for (let i = 0; i < RECON_ENEMIES; i++) if (!f.out[i]) watch = Math.max(watch, f.spot[i] ?? 0);
    // Shared to a tenth, so the guest's menu line follows without a message a frame.
    const shown = Math.round(watch * 10) / 10;
    if (shown !== s.watch) {
      s.watch = shown;
      s.v++;
    }
    if (watch > s.closest) s.closest = watch;
    if (this.armed && watch >= RECON.watched) {
      this.armed = false;
      s.warned++;
      s.v++;
    } else if (!this.armed && watch < RECON.calm) {
      this.armed = true;
    }
    if (f.spottedBy >= 0) {
      s.phase = 'lost';
      s.spottedBy = f.spottedBy;
      s.closest = 1;
    } else if (s.reported.every(Boolean) && f.fromStart <= RECON.home) {
      s.phase = 'won';
    } else {
      return false;
    }
    s.v++;
    return true;
  }
}

/** How many enemies are reported. */
export function reportedCount(s: Readonly<ReconSnapshot>): number {
  return s.reported.filter(Boolean).length;
}

/** The briefing, on the sign as the recon starts. */
export const RECON_BRIEFING = [
  'Recon: find the enemy without being seen',
  'Three guns, two tanks. Lay the gun on each for 3 s to report it, then come back to the start',
] as const;

/** The note when every enemy is reported: now home. */
export const RECON_ALL_REPORTED = ['All five reported', 'Back to the start, unseen'] as const;

/** The note when an enemy is close to spotting the tank. */
export const RECON_WARNING = ['You may have been seen', 'Keep still, or pull back out of sight'] as const;

/** The note when enemy `i` is reported, `range` m away. */
export function reportLines(i: number, range: number, left: number): [string, string] {
  return [`Reported: ${enemyName(i)}, ${Math.round(range / 10) * 10} m`, left === 0 ? 'All five found: back to the start' : `${left} still to find`];
}

/** The debrief: the result, then the counts. */
export function reconDebrief(s: Readonly<ReconSnapshot>): [string, string] {
  const head =
    s.phase === 'won'
      ? `Recon complete in ${clock(s.time)}`
      : s.phase === 'lost'
        ? `Spotted by ${s.spottedBy >= 0 ? enemyName(s.spottedBy) : 'the enemy'} at ${clock(s.time)}`
        : s.phase === 'on'
          ? `Recon, ${clock(s.time)}`
          : 'Recon off';
  const closest = s.phase === 'lost' ? '' : `, closest call ${Math.round(s.closest * 100)}%`;
  const shots = s.shots > 0 ? `, ${s.shots} fired` : '';
  return [head, `${reportedCount(s)} of ${RECON_ENEMIES} reported${closest}${shots}`];
}

/** One line for the menu. */
export function reconLine(s: Readonly<ReconSnapshot>): string {
  if (s.phase === 'off' && s.v === 0) return 'Recon unseen: off';
  const [head, counts] = reconDebrief(s);
  const watch = s.phase === 'on' && s.watch > 0 ? `. Being watched ${Math.round(s.watch * 100)}%` : '';
  return `${head}. ${counts}${watch}`;
}

/** The orders board's lines while it runs (F6.5): the objective, then a task per enemy. */
export function reconBoard(s: Readonly<ReconSnapshot>): { drill: string; tasks: { text: string; done: boolean }[] } {
  const all = s.reported.every(Boolean);
  return {
    drill: all ? 'Recon: back to the start' : 'Recon: find the enemy unseen',
    tasks: [
      { text: `Guns: ${s.reported.slice(0, FIRST_TANK).filter(Boolean).length} of ${FIRST_TANK} reported`, done: s.reported.slice(0, FIRST_TANK).every(Boolean) },
      { text: `Tanks: ${s.reported.slice(FIRST_TANK).filter(Boolean).length} of ${RECON_ENEMIES - FIRST_TANK} reported`, done: s.reported.slice(FIRST_TANK).every(Boolean) },
      { text: s.watch > 0 ? `Being watched ${Math.round(s.watch * 100)}%` : 'Unseen', done: false },
    ],
  };
}

/** Read the `recon` event, or null if it is malformed. */
export function parseRecon(raw: unknown): ReconSnapshot | null {
  const e = raw as Partial<Record<keyof ReconSnapshot, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!e || !['off', 'on', 'won', 'lost'].includes(e.phase as string) || num(e.time) === null || num(e.v) === null) return null;
  const reported = Array.isArray(e.reported) ? (e.reported as unknown[]) : [];
  return {
    phase: e.phase as ReconPhase,
    time: num(e.time) ?? 0,
    reported: Array.from({ length: RECON_ENEMIES }, (_, i) => reported[i] === true),
    watch: Math.max(0, Math.min(1, num(e.watch) ?? 0)),
    closest: Math.max(0, Math.min(1, num(e.closest) ?? 0)),
    warned: num(e.warned) ?? 0,
    spottedBy: num(e.spottedBy) ?? -1,
    shots: num(e.shots) ?? 0,
    v: num(e.v) ?? 0,
  };
}
