/**
 * Ambush a column (F5.10, docs/ambush.md): the crew's tank waits
 * hull down behind a wall while an enemy column (src/sim/column.ts: a tank,
 * two lorries and a tank) drives down the road across its front, 240 m off.
 * The first shot springs the ambush, as does any vehicle spotting the tank
 * first: then the column's tanks halt and fight back and the lorries run for
 * it. Knocking out three of the four wins; the column getting away with two,
 * or the tank being knocked out, loses.
 *
 * Engine-free and deterministic: the host runs it, the tests drive it.
 */

import { clock } from './combat.js';
import { COLUMN_VEHICLES } from './column.js';
import { AMBUSH_WALL } from './terrain.js';

/** The column's size. */
export const COLUMN_COUNT = COLUMN_VEHICLES.length;

/** The ambush's numbers. */
export const AMBUSH = {
  /** Where the crew's tank waits, world x and z, facing north up to the road (heading 0 faces -z): just behind the wall. */
  x: AMBUSH_WALL.x,
  z: AMBUSH_WALL.z + 9,
  heading: 0,
  /** The battery's seed, so every run meets the same fall of shot for the same play. */
  seed: 6060,
  /** Knocked out this many of the column wins. */
  toWin: 3,
} as const;

export type AmbushPhase = 'off' | 'on' | 'won' | 'lost';

/** The ambush as both pages show it (the `ambush` event). */
export interface AmbushSnapshot {
  phase: AmbushPhase;
  /** How long it has run (or ran), s. */
  time: number;
  /** When the ambush was sprung, s into the run, or -1; and whether by the column seeing the tank (else the crew's first shot). */
  sprungAt: number;
  seen: boolean;
  /** Each vehicle knocked out, and each got away. */
  out: boolean[];
  away: boolean[];
  /** The column's shots at the tank, its hits and hits through the armour. */
  shots: number;
  hits: number;
  through: number;
  /** Lost by being knocked out (else the column got away). */
  knockedOut: boolean;
  v: number;
}

export function noAmbush(): AmbushSnapshot {
  return {
    phase: 'off',
    time: 0,
    sprungAt: -1,
    seen: false,
    out: Array.from({ length: COLUMN_COUNT }, () => false),
    away: Array.from({ length: COLUMN_COUNT }, () => false),
    shots: 0,
    hits: 0,
    through: 0,
    knockedOut: false,
    v: 0,
  };
}

/** What the ambush reads from the fight each step. */
export interface AmbushInput {
  /** The crew's tank is knocked out. */
  tankOut: boolean;
  /** Each column vehicle knocked out, and each got away off the road's end. */
  out: readonly boolean[];
  away: readonly boolean[];
  /** The ambush is sprung, and some vehicle has the tank spotted. */
  sprung: boolean;
  spotted: boolean;
  shots: number;
  hits: number;
  through: number;
}

/** How many of the column are knocked out. */
export function knockedOut(s: Readonly<AmbushSnapshot>): number {
  return s.out.filter(Boolean).length;
}

/** How many of the column got away. */
export function gotAwayCount(s: Readonly<AmbushSnapshot>): number {
  return s.away.filter((a, k) => a && !s.out[k]).length;
}

/** The ambush's run, kept by the host. */
export class AmbushRun {
  readonly snap: AmbushSnapshot = noAmbush();

  start(): void {
    const v = this.snap.v;
    Object.assign(this.snap, noAmbush(), { phase: 'on', v: v + 1 });
  }

  stop(): void {
    if (this.snap.phase === 'off') return;
    this.snap.phase = 'off';
    this.snap.v++;
  }

  /**
   * `dt` s on, while it runs: when it was sprung, the counts, and whether it
   * is over (the tank knocked out, or every vehicle knocked out or away).
   * Returns whether the phase changed.
   */
  step(dt: number, f: Readonly<AmbushInput>): boolean {
    const s = this.snap;
    if (s.phase !== 'on') return false;
    s.time += dt;
    if (s.sprungAt < 0 && f.sprung) {
      s.sprungAt = s.time;
      s.seen = f.spotted;
      s.v++;
    }
    for (let k = 0; k < COLUMN_COUNT; k++) {
      const out = f.out[k] === true;
      const away = f.away[k] === true && !out;
      if (out !== s.out[k] || away !== s.away[k]) s.v++;
      s.out[k] = out;
      s.away[k] = away;
    }
    if (f.hits !== s.hits || f.through !== s.through) s.v++;
    s.shots = f.shots;
    s.hits = f.hits;
    s.through = f.through;
    let done = true;
    for (let k = 0; k < COLUMN_COUNT; k++) if (!s.out[k] && !s.away[k]) done = false;
    if (f.tankOut) {
      s.phase = 'lost';
      s.knockedOut = true;
    } else if (done) {
      s.phase = knockedOut(s) >= AMBUSH.toWin ? 'won' : 'lost';
    } else {
      return false;
    }
    s.v++;
    return true;
  }
}

/** The briefing, on the sign as the ambush starts. */
export const AMBUSH_BRIEFING = [
  'Ambush: a column is coming down the road ahead',
  'A tank, two lorries, a tank. Hold fire till they are close, then knock out three',
] as const;

/** The note when the column spots the tank before the crew has fired. */
export const AMBUSH_SEEN = ['The column has seen you', 'Its tanks are halting to fire: engage now'] as const;

/** The debrief: the result, then the counts. */
export function ambushDebrief(s: Readonly<AmbushSnapshot>): [string, string] {
  const out = knockedOut(s);
  const head =
    s.phase === 'won'
      ? out === COLUMN_COUNT
        ? `Column destroyed in ${clock(s.time)}`
        : `Ambush won: ${out} of ${COLUMN_COUNT} knocked out`
      : s.phase === 'lost'
        ? s.knockedOut
          ? `Knocked out after ${clock(s.time)}`
          : `The column got away: ${out} of ${COLUMN_COUNT} knocked out`
        : s.phase === 'on'
          ? s.sprungAt < 0
            ? `Waiting in ambush, ${clock(s.time)}`
            : `Ambush sprung, ${clock(s.time)}`
          : 'Ambush off';
  const tanks = COLUMN_VEHICLES.filter((v, k) => v.kind === 'tank' && s.out[k]).length;
  const lorries = out - tanks;
  const sprung = s.sprungAt < 0 ? 'not sprung' : s.seen ? `seen at ${clock(s.sprungAt)}` : `sprung at ${clock(s.sprungAt)}`;
  return [head, `${plural(tanks, 'tank')} and ${plural(lorries, 'lorry', 'lorries')} out, ${gotAwayCount(s)} got away, ${sprung}, ${s.hits} hits taken of ${s.shots} shots, ${s.through} through`];
}

/** "1 tank", "2 tanks". */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line for the menu. */
export function ambushLine(s: Readonly<AmbushSnapshot>): string {
  if (s.phase === 'off' && s.v === 0) return 'Ambush a column: off';
  const [head, counts] = ambushDebrief(s);
  return `${head}. ${counts}`;
}

/** The orders board's lines while it runs (F6.5). */
export function ambushBoard(s: Readonly<AmbushSnapshot>): { drill: string; tasks: { text: string; done: boolean }[] } {
  const out = knockedOut(s);
  return {
    drill: 'Ambush: knock out the column',
    tasks: [
      { text: s.sprungAt < 0 ? 'Hold fire till close' : 'Ambush sprung', done: s.sprungAt >= 0 },
      { text: `Knocked out ${out} of ${COLUMN_COUNT} (${AMBUSH.toWin} to win)`, done: out >= AMBUSH.toWin },
      { text: `Got away: ${gotAwayCount(s)}`, done: false },
    ],
  };
}

/** Read the `ambush` event, or null if it is malformed. */
export function parseAmbush(raw: unknown): AmbushSnapshot | null {
  const e = raw as Partial<Record<keyof AmbushSnapshot, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!e || !['off', 'on', 'won', 'lost'].includes(e.phase as string) || num(e.time) === null || num(e.v) === null) return null;
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
  const out = list(e.out);
  const away = list(e.away);
  return {
    phase: e.phase as AmbushPhase,
    time: num(e.time) ?? 0,
    sprungAt: num(e.sprungAt) ?? -1,
    seen: e.seen === true,
    out: Array.from({ length: COLUMN_COUNT }, (_, k) => out[k] === true),
    away: Array.from({ length: COLUMN_COUNT }, (_, k) => away[k] === true),
    shots: num(e.shots) ?? 0,
    hits: num(e.hits) ?? 0,
    through: num(e.through) ?? 0,
    knockedOut: e.knockedOut === true,
    v: num(e.v) ?? 0,
  };
}
