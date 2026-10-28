/**
 * Play-test stats (F1.14, docs/comfort-stats.md): one record per range run
 * (F1.11) answering the concept's Phase 1 play-test questions (§14): how
 * long the crew took to hit three targets, which control each player
 * fumbled most, how often the gears ground, how long each player spent in
 * each seat, how much they talked, and when anyone said they felt queasy.
 * Each page keeps its own log of its own player (the crewmate's page sends
 * its seat times and fumbles at the end of each run, so either page's CSV
 * has the whole crew) and saves it as a CSV.
 *
 * Engine-free, so it is unit tested; nothing here allocates per frame.
 */

import { formatRunTime, type RunPhase, type RunSnapshot, targetsHit } from './range-run.js';
import { SPEAKING_LEVEL } from './tank-audio.js';

/** What a fumble is counted against: each control (both tillers as one), the shell and anything else. */
export const FUMBLE_GROUPS = [
  'tillers',
  'gear',
  'throttle',
  'power_traverse',
  'crank',
  'elevation',
  'periscope',
  'breech',
  'shell',
  'other',
] as const;
export type FumbleGroup = (typeof FUMBLE_GROUPS)[number];

/**
 * A squeeze that took hold of nothing counts as a miss on the nearest
 * control within this many times its reach (the kit's reach is 10 cm).
 */
export const MISS_REACH = 2;
/** Speech within this long of the last loud moment counts as one stretch of talking, s (gaps between words). */
export const TALK_HOLD = 0.3;
/** Most rows a page keeps (each run and each queasy mark is a row). */
export const MAX_ROWS = 500;

/** Which fumble group a control's name (`handUse`, the kit's control names) counts in, as an index into FUMBLE_GROUPS. */
export function fumbleGroup(control: string): number {
  let group: FumbleGroup = 'other';
  if (control.startsWith('driver-tiller')) group = 'tillers';
  else if (control === 'gear-lever') group = 'gear';
  else if (control === 'hand-throttle') group = 'throttle';
  else if (control === 'turret-twist') group = 'power_traverse';
  else if (control === 'turret-crank') group = 'crank';
  else if (control === 'turret-elevation') group = 'elevation';
  else if (control.includes('periscope')) group = 'periscope';
  else if (control.startsWith('breech')) group = 'breech';
  else if (control === 'shell') group = 'shell';
  return FUMBLE_GROUPS.indexOf(group);
}

/** The group fumbled most (the first of a tie), or '' with none. */
export function mostFumbled(fumbles: readonly number[]): string {
  let best = -1;
  let most = 0;
  for (let i = 0; i < fumbles.length; i++) {
    if (fumbles[i] > most) {
      most = fumbles[i];
      best = i;
    }
  }
  return best < 0 ? '' : FUMBLE_GROUPS[best];
}

export function sum(values: readonly number[]): number {
  let n = 0;
  for (const v of values) n += v;
  return n;
}

/** What one player did during the counted part of a run (the clock running, not paused). */
export interface RunTally {
  fumbles: number[];
  grinds: number;
  /** Seconds in each seat. */
  driver: number;
  gunner: number;
  /** Seconds this player, and the crewmate, were talking. */
  talk: number;
  crewTalk: number;
  queasy: number;
  /** Time left in each stretch of talking, s. */
  talkHold: number;
  crewHold: number;
}

export function createTally(): RunTally {
  return { fumbles: FUMBLE_GROUPS.map(() => 0), grinds: 0, driver: 0, gunner: 0, talk: 0, crewTalk: 0, queasy: 0, talkHold: 0, crewHold: 0 };
}

export function resetTally(t: RunTally): RunTally {
  t.fumbles.fill(0);
  t.grinds = t.driver = t.gunner = t.talk = t.crewTalk = t.queasy = t.talkHold = t.crewHold = 0;
  return t;
}

export function copyTally(from: RunTally, to: RunTally): RunTally {
  for (let i = 0; i < to.fumbles.length; i++) to.fumbles[i] = from.fumbles[i] ?? 0;
  to.grinds = from.grinds;
  to.driver = from.driver;
  to.gunner = from.gunner;
  to.talk = from.talk;
  to.crewTalk = from.crewTalk;
  to.queasy = from.queasy;
  to.talkHold = from.talkHold;
  to.crewHold = from.crewHold;
  return to;
}

/**
 * `dt` seconds of a counted run: the seat this player sits in, and the
 * voice levels (RMS, as the intercom's duck reads them) of this player's
 * microphone and of the crewmate's voice.
 */
export function stepTally(t: RunTally, dt: number, seat: string, micLevel: number, crewLevel: number): void {
  if (seat === 'driver') t.driver += dt;
  else if (seat === 'gunner') t.gunner += dt;
  if (micLevel >= SPEAKING_LEVEL) t.talkHold = TALK_HOLD;
  if (crewLevel >= SPEAKING_LEVEL) t.crewHold = TALK_HOLD;
  if (t.talkHold > 0) {
    t.talk += dt;
    t.talkHold -= dt;
  }
  if (t.crewHold > 0) {
    t.crewTalk += dt;
    t.crewHold -= dt;
  }
}

export type RunResult = 'done' | 'stopped' | 'restarted';

/** How a run ended, with its numbers as they stood. */
export interface RunEnd {
  run: number;
  result: RunResult;
  /** The crew's time (done), or the clock when it was stopped or restarted, s. */
  time: number;
  shots: number;
  targets: number;
  assisted: boolean;
  /** What this player did in it. */
  tally: RunTally;
}

/**
 * Watches the run as this page shows it (`shownRun()`), counts this
 * player's tally while its clock runs, and says when a run ends: done (all
 * three hit), stopped, or restarted. Call `watch` once a frame, then count
 * into `tally` while `counting`.
 */
export class RunRecorder {
  readonly tally = createTally();
  readonly ended: RunEnd = { run: 0, result: 'done', time: 0, shots: 0, targets: 0, assisted: false, tally: createTally() };
  /** Whether the run's clock runs now: what happens counts. */
  counting = false;
  private id = 0;
  private phase: RunPhase = 'idle';
  private lastClock = 0;
  private lastShots = 0;
  private lastTargets = 0;
  private lastAssisted = false;

  /** The run as shown this frame; returns `ended` if a run just ended, otherwise null. */
  watch(s: Readonly<RunSnapshot>): RunEnd | null {
    let end: RunEnd | null = null;
    if (this.id !== 0 && this.phase === 'running') {
      const e = this.ended;
      if (s.id !== this.id) {
        end = this.end('restarted', this.lastClock, this.lastShots, this.lastTargets, this.lastAssisted);
      } else if (s.phase === 'done') {
        end = this.end('done', s.time, s.shots, targetsHit(s), s.assisted);
      } else if (s.phase === 'idle') {
        end = this.end('stopped', this.lastClock, this.lastShots, this.lastTargets, this.lastAssisted);
      }
      if (end) e.run = this.id;
    }
    if (s.id !== this.id) resetTally(this.tally);
    if (s.phase === 'running') {
      this.lastClock = Math.max(0, s.clock);
      this.lastShots = s.shots;
      this.lastTargets = targetsHit(s);
      this.lastAssisted = s.assisted;
    }
    this.id = s.id;
    this.phase = s.phase;
    this.counting = s.phase === 'running' && s.clock >= 0 && !s.paused;
    return end;
  }

  private end(result: RunResult, time: number, shots: number, targets: number, assisted: boolean): RunEnd {
    const e = this.ended;
    e.result = result;
    e.time = time;
    e.shots = shots;
    e.targets = targets;
    e.assisted = assisted;
    copyTally(this.tally, e.tally);
    return e;
  }
}

/** What the crewmate's page says it did in a run (the `run-stats` event). */
export interface CrewStats {
  driver: number;
  gunner: number;
  grinds: number;
  fumbles: number[];
  /** The crewmate is the practice crewmate. */
  bot: boolean;
}

/** The `run-stats` event each page sends its crewmate when a run ends. */
export function crewStatsEvent(run: number, t: RunTally, bot: boolean): { t: 'run-stats' } & Record<string, unknown> {
  return { t: 'run-stats', run, driver: t.driver, gunner: t.gunner, grinds: t.grinds, fumbles: [...t.fumbles], bot };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Read a `run-stats` event: the run's id and the crewmate's stats, or null if it isn't one. */
export function readCrewStats(e: Record<string, unknown>): { run: number; crew: CrewStats } | null {
  const { run, driver, gunner, grinds, fumbles, bot } = e;
  if (!finite(run) || !finite(driver) || !finite(gunner) || !finite(grinds) || !Array.isArray(fumbles)) return null;
  const counts = FUMBLE_GROUPS.map((_, i) => {
    const n = fumbles[i];
    return finite(n) && n >= 0 ? Math.floor(n) : 0;
  });
  return { run, crew: { driver: Math.max(0, driver), gunner: Math.max(0, gunner), grinds: Math.max(0, Math.floor(grinds)), fumbles: counts, bot: bot === true } };
}

/** A run, a "feeling queasy" mark, or (added to the CSV when it is saved) the whole visit so far. */
export type RowKind = 'run' | 'queasy' | 'visit';
export type Crewmate = 'none' | 'player' | 'bot';

/** One row of the CSV: a run, a "feeling queasy" mark, or the visit so far. */
export interface StatsRow {
  kind: RowKind;
  /** The run's id (0 for a mark outside a run). */
  run: number;
  /** Local wall-clock time it was written, "YYYY-MM-DD HH:MM:SS". */
  at: string;
  /** This player's seat at the end (a run) or at the moment (a mark). */
  seat: string;
  crewmate: Crewmate;
  /** done, stopped or restarted ('' otherwise). */
  result: string;
  /** A run's time or clock when it ended; a mark's time on the run clock; the visit's length; -1 for none, s. */
  time: number;
  shots: number;
  targets: number;
  assisted: boolean;
  grinds: number;
  fumbles: number[];
  driver: number;
  gunner: number;
  talk: number;
  crewTalk: number;
  /** The crewmate's own numbers, once its page sends them. */
  crew: CrewStats | null;
  queasy: number;
  /** The vignette's strength and the bumps the tank rode on. */
  vignette: number;
  bumps: string;
  /** For a mark: the tank's speed, km/h, and how fast this player's view turned, °/s. */
  speed: number;
  turn: number;
  label: string;
}

/** A row for a run that ended. */
export function runRow(end: RunEnd, context: RowContext): StatsRow {
  const t = end.tally;
  return {
    kind: 'run', run: end.run, at: context.at, seat: context.seat, crewmate: context.crewmate, result: end.result,
    time: end.time, shots: end.shots, targets: end.targets, assisted: end.assisted, grinds: t.grinds, fumbles: [...t.fumbles],
    driver: t.driver, gunner: t.gunner, talk: t.talk, crewTalk: t.crewTalk, crew: null, queasy: t.queasy,
    vignette: context.vignette, bumps: context.bumps, speed: Number.NaN, turn: Number.NaN, label: context.label,
  };
}

/** A "feeling queasy" mark: `run` and `clock` the run on now (0 and -1 for none), the tank's speed (m/s) and the view's turn rate (rad/s). */
export function queasyRow(run: number, clock: number, speed: number, turnRate: number, context: RowContext): StatsRow {
  return {
    kind: 'queasy', run, at: context.at, seat: context.seat, crewmate: context.crewmate, result: '', time: clock,
    shots: 0, targets: 0, assisted: false, grinds: 0, fumbles: FUMBLE_GROUPS.map(() => 0), driver: 0, gunner: 0, talk: 0,
    crewTalk: 0, crew: null, queasy: 1, vignette: context.vignette, bumps: context.bumps, speed: speed * 3.6,
    turn: (turnRate * 180) / Math.PI, label: context.label,
  };
}

/** The whole visit so far: `t` counted since the page loaded, over `seconds`. */
export function visitRow(t: RunTally, seconds: number, context: RowContext): StatsRow {
  return {
    kind: 'visit', run: 0, at: context.at, seat: context.seat, crewmate: context.crewmate, result: '', time: seconds,
    shots: 0, targets: 0, assisted: false, grinds: t.grinds, fumbles: [...t.fumbles], driver: t.driver, gunner: t.gunner,
    talk: t.talk, crewTalk: t.crewTalk, crew: null, queasy: t.queasy, vignette: context.vignette, bumps: context.bumps,
    speed: Number.NaN, turn: Number.NaN, label: context.label,
  };
}

/** What a row says about the page when it is written. */
export interface RowContext {
  at: string;
  seat: string;
  crewmate: Crewmate;
  vignette: number;
  bumps: string;
  label: string;
}

/** A Date as "YYYY-MM-DD HH:MM:SS" in local time. */
export function wallClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const STATS_CSV_HEADER = [
  'kind', 'run', 'at', 'seat', 'crewmate', 'result', 'time_s', 'shots', 'targets', 'assisted', 'grinds', 'fumbles',
  ...FUMBLE_GROUPS.map((g) => `fumbles_${g}`),
  'most_fumbled', 'driver_s', 'gunner_s', 'talk_s', 'crew_talk_s', 'crew_driver_s', 'crew_gunner_s', 'crew_fumbles',
  'crew_most_fumbled', 'queasy', 'vignette', 'bumps', 'speed_kmh', 'turn_dps', 'label',
].join(',');

const secs = (v: number) => (Number.isFinite(v) && v >= 0 ? v.toFixed(1) : '');
const plain = (text: string) => text.replace(/[,\n\r"]/g, ' ');

/** One row as a CSV line, in STATS_CSV_HEADER's columns. */
export function csvLine(r: StatsRow): string {
  const run = r.kind === 'run';
  // A run and the visit count what the player did; a mark only says when.
  const tally = r.kind !== 'queasy';
  const crew = r.crew;
  return [
    r.kind, r.run, r.at, r.seat, r.crewmate, r.result, secs(r.time),
    run ? r.shots : '', run ? r.targets : '', run ? (r.assisted ? 1 : 0) : '', tally ? r.grinds : '', tally ? sum(r.fumbles) : '',
    ...r.fumbles.map((n) => (tally ? n : '')),
    tally ? mostFumbled(r.fumbles) : '', tally ? secs(r.driver) : '', tally ? secs(r.gunner) : '', tally ? secs(r.talk) : '',
    tally && r.crewmate !== 'none' ? secs(r.crewTalk) : '',
    crew ? secs(crew.driver) : '', crew ? secs(crew.gunner) : '', crew ? sum(crew.fumbles) : '', crew ? mostFumbled(crew.fumbles) : '',
    r.queasy, r.vignette, r.bumps,
    Number.isFinite(r.speed) ? r.speed.toFixed(1) : '', Number.isFinite(r.turn) ? r.turn.toFixed(1) : '', plain(r.label),
  ].join(',');
}

/**
 * A page's play-test log: its rows, the crewmate's numbers matched to them
 * by run, the CSV, and plain JSON to keep it in the browser between visits.
 */
export class StatsLog {
  readonly rows: StatsRow[] = [];
  /** Crewmates' stats that came before the row they belong to, by run id. */
  private early = new Map<number, CrewStats>();

  add(row: StatsRow): void {
    if (row.kind === 'run') {
      const crew = this.early.get(row.run);
      if (crew) {
        withCrew(row, crew);
        this.early.delete(row.run);
      }
    }
    this.rows.push(row);
    if (this.rows.length > MAX_ROWS) this.rows.splice(0, this.rows.length - MAX_ROWS);
  }

  /** The crewmate's numbers for run `run`: onto its latest row, or kept until that row is written. */
  addCrew(run: number, crew: CrewStats): void {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (row.kind !== 'run' || row.run !== run) continue;
      if (row.crew === null) withCrew(row, crew);
      return;
    }
    this.early.set(run, crew);
    // Only the last few runs can still be waiting.
    if (this.early.size > 4) this.early.delete(this.early.keys().next().value as number);
  }

  /** The latest run row, or null. */
  lastRun(): StatsRow | null {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].kind === 'run') return this.rows[i];
    return null;
  }

  count(kind: RowKind): number {
    let n = 0;
    for (const row of this.rows) if (row.kind === kind) n++;
    return n;
  }

  clear(): void {
    this.rows.length = 0;
    this.early.clear();
  }

  /** The CSV: every row, then any `extra` (the visit so far). */
  csv(...extra: StatsRow[]): string {
    return [STATS_CSV_HEADER, ...this.rows.map(csvLine), ...extra.map(csvLine)].join('\n') + '\n';
  }

  toJSON(): string {
    return JSON.stringify(this.rows);
  }

  /** Rows kept from an earlier visit (bad or foreign rows are skipped). */
  load(text: string | null): void {
    if (!text) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(data)) return;
    for (const item of data) {
      const row = readRow(item);
      if (row) this.rows.push(row);
    }
    if (this.rows.length > MAX_ROWS) this.rows.splice(0, this.rows.length - MAX_ROWS);
  }
}

/** The crewmate's numbers onto a run's row; a practice crewmate's page says it is one. */
function withCrew(row: StatsRow, crew: CrewStats): void {
  row.crew = crew;
  if (crew.bot) row.crewmate = 'bot';
}

/** A stored row (a run or a mark), checked field by field, or null. */
export function readRow(item: unknown): StatsRow | null {
  if (typeof item !== 'object' || item === null) return null;
  const r = item as Record<string, unknown>;
  if (r.kind !== 'run' && r.kind !== 'queasy') return null;
  const num = (v: unknown, fallback = 0) => (finite(v) ? v : fallback);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const fumbles = FUMBLE_GROUPS.map((_, i) => (Array.isArray(r.fumbles) ? num(r.fumbles[i]) : 0));
  const crewEvent = typeof r.crew === 'object' && r.crew !== null ? readCrewStats({ ...(r.crew as Record<string, unknown>), run: 0 }) : null;
  const crewmate = r.crewmate === 'player' || r.crewmate === 'bot' ? r.crewmate : 'none';
  return {
    kind: r.kind, run: num(r.run), at: str(r.at), seat: str(r.seat), crewmate, result: str(r.result), time: num(r.time, -1),
    shots: num(r.shots), targets: num(r.targets), assisted: r.assisted === true, grinds: num(r.grinds), fumbles,
    driver: num(r.driver), gunner: num(r.gunner), talk: num(r.talk), crewTalk: num(r.crewTalk), crew: crewEvent?.crew ?? null,
    queasy: num(r.queasy), vignette: num(r.vignette), bumps: str(r.bumps), speed: num(r.speed, Number.NaN),
    turn: num(r.turn, Number.NaN), label: str(r.label),
  };
}

/** One line for the game menu on the latest run. */
export function lastRunLine(log: StatsLog): string {
  const row = log.lastRun();
  const runs = log.count('run');
  const marks = log.count('queasy');
  const kept = `${runs} run${runs === 1 ? '' : 's'}${marks > 0 ? `, ${marks} queasy mark${marks === 1 ? '' : 's'}` : ''} recorded`;
  if (row === null) return marks > 0 ? `No runs yet; ${kept}.` : 'No runs recorded yet: start a range run.';
  const fumbles = sum(row.fumbles);
  const most = mostFumbled(row.fumbles);
  const how = row.result === 'done' ? formatRunTime(row.time) : `${row.result} at ${formatRunTime(row.time)}`;
  return (
    `Last: run ${row.run} ${how}, ${row.shots} shot${row.shots === 1 ? '' : 's'}, ${row.grinds} grind${row.grinds === 1 ? '' : 's'}, ` +
    `${fumbles} fumble${fumbles === 1 ? '' : 's'}${most ? ` (most: ${most.replace('_', ' ')})` : ''}. ${kept}.`
  );
}
