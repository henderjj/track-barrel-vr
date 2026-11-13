/**
 * The combat scenario and the fight's tuning (F3.10, docs/combat-scenario.md).
 *
 * Tuning: every number that decides how hard the enemy is to survive, in
 * one place, as a few levels the crew picks in the game menu's Battle tab
 * (each a multiplier on the base numbers below and in src/sim/enemy-guns.ts,
 * src/sim/enemy-tanks.ts and src/sim/damage.ts): how quickly the enemy
 * spots the tank, how well it aims, how quickly it lays and reloads, how
 * big a target the tank is, how much its armour stops and how many hits
 * through it knock it out. The host's tuning rules; the guest is told.
 *
 * Spotting: an enemy with a clear line to the tank doesn't see it at once.
 * It builds up to spotting it over a time that grows with the range, and is
 * shorter while the tank moves or just after it fires, longer while only
 * its turret shows over cover (hull down). Only once it has spotted the
 * tank does it lay and fire.
 *
 * The scenario, "Advance to contact": from the range's start, drive up the
 * lane to the 500 m board past the hidden guns, using the walls along the
 * lane for cover; the two tanks come up once the crew is halfway or has
 * knocked out two guns. Won on reaching it, or on knocking every enemy
 * out; lost when the tank is knocked out.
 *
 * Engine-free and deterministic: the host runs it, the tests drive it.
 */

/** The tuning: each a multiplier on the base numbers, except knockOut (hits through the armour). */
export interface CombatTuning {
  /** How quickly the enemy spots the tank: a multiplier on the spotting rate; 0 spots it the moment it has a clear line (as before F3.10). */
  spot: number;
  /** How far off its shots go: a multiplier on the laying error and dispersion (smaller aims better). */
  aim: number;
  /** How long it takes to lay its first shot and to reload: a multiplier on both. */
  react: number;
  /** How big a target the crew's tank is to the enemy: a multiplier on its hull and turret's width and height. */
  box: number;
  /** How hard the enemy's shells hit the armour: a multiplier on their penetration (smaller makes the armour tougher). */
  armour: number;
  /** This many hits through the armour knock the tank out. */
  knockOut: number;
}

export type TuneKey = keyof CombatTuning;
export const TUNE_KEYS: readonly TuneKey[] = ['spot', 'aim', 'react', 'box', 'armour', 'knockOut'];

/** The recommended tuning: the base numbers as they stand. */
export const DEFAULT_TUNING: Readonly<CombatTuning> = { spot: 1, aim: 1, react: 1, box: 1, armour: 1, knockOut: 3 };

/** The enemy as before the scenario (F3.2 to F3.4): spots at once; the tests of laying and firing use it. */
export const INSTANT_SPOTTING: Readonly<CombatTuning> = { ...DEFAULT_TUNING, spot: 0 };

/**
 * The Battle tab's rows: each a tuning value and its choices, the
 * recommended one marked. Up to four choices a row (the menu's limit).
 */
export const TUNE_ROWS: readonly { key: TuneKey; label: string; options: readonly (readonly [value: number, label: string])[] }[] = [
  { key: 'spot', label: 'Enemy spotting', options: [[0.6, 'Slow'], [1, 'Normal'], [1.6, 'Quick'], [0, 'Instant']] },
  { key: 'aim', label: 'Enemy accuracy', options: [[1.4, 'Low'], [1, 'Normal'], [0.7, 'High'], [0.5, 'Sharp']] },
  { key: 'react', label: 'Enemy reactions', options: [[1.5, 'Slow'], [1, 'Normal'], [0.7, 'Quick']] },
  { key: 'box', label: 'Our hit box', options: [[0.85, 'Small'], [1, 'True size'], [1.15, 'Large']] },
  { key: 'armour', label: 'Our armour', options: [[1.15, 'Weaker'], [1, 'True'], [0.8, 'Tougher'], [0.6, 'Toughest']] },
  { key: 'knockOut', label: 'Knocked out after', options: [[2, '2 through'], [3, '3 through'], [4, '4 through'], [5, '5 through']] },
];

/** A fresh copy of the recommended tuning. */
export function defaultTuning(): CombatTuning {
  return { ...DEFAULT_TUNING };
}

/** Read a tuning sent or saved, each value one of its row's choices (else the recommended), or null if it isn't one at all. */
export function parseTuning(raw: unknown): CombatTuning | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Partial<Record<TuneKey, unknown>>;
  const out = defaultTuning();
  for (const row of TUNE_ROWS) {
    const v = e[row.key];
    if (typeof v === 'number' && row.options.some(([value]) => value === v)) out[row.key] = v;
  }
  return out;
}

/** Set one tuning value to one of its row's choices; returns whether it was one. */
export function setTune(t: CombatTuning, key: TuneKey, value: number): boolean {
  const row = TUNE_ROWS.find((r) => r.key === key);
  if (!row?.options.some(([v]) => v === value)) return false;
  t[key] = value;
  return true;
}

/** One line for the menu: what differs from the recommended tuning. */
export function tuningLine(t: Readonly<CombatTuning>): string {
  const changed = TUNE_ROWS.filter((r) => t[r.key] !== DEFAULT_TUNING[r.key]).map((r) => {
    const label = r.options.find(([v]) => v === t[r.key])?.[1] ?? String(t[r.key]);
    return `${r.label.toLowerCase()} ${label.toLowerCase()}`;
  });
  return changed.length === 0 ? 'Recommended tuning' : `Tuned: ${changed.join(', ')}`;
}

/** How the enemy spots the tank (the base numbers the `spot` level multiplies). */
export const SPOTTING = {
  /** The time an enemy takes to spot a still tank in the open at `at` m, s. */
  seconds: 10,
  at: 300,
  /** It grows with the range squared (a tank's size in the eye falls with the square), but is never quicker than this, s. */
  fastest: 2.5,
  /** The tank moving faster than `movingSpeed` m/s is spotted this many times quicker: movement, dust and noise. */
  moving: 2.5,
  movingSpeed: 1,
  /** For `firedFor` s after the crew fires, this many times quicker: the flash, the smoke and the dust thrown up. */
  fired: 8,
  firedFor: 8,
  /** Only the turret showing over cover (hull down): this many times slower. */
  hullDown: 0.35,
  /** Once any enemy has fired, the others are alert: this many times quicker. */
  alert: 1.5,
  /** An enemy tank driving its route, buttoned up and bouncing, spots this many times slower than halted. */
  onTheMove: 0.5,
  /** Out of sight, what it has spotted fades this fast (a share of the whole a second). */
  forget: 0.1,
} as const;

/** What the tank shows an enemy: nothing, only its turret over cover (hull down), or all of it. */
export type TankView = 'none' | 'turret' | 'full';

/** What a spotting enemy knows of the tank right now. */
export interface SpotSituation {
  range: number;
  view: TankView;
  moving: boolean;
  /** The crew fired within SPOTTING.firedFor s. */
  fired: boolean;
  /** Some enemy has fired already. */
  alert: boolean;
  /** The spotter is a tank on the move. */
  driving: boolean;
}

/** How much of a spot an enemy gains a second in `s` (1 is spotted), with the `spot` level; Infinity spots it at once. */
export function spotRate(s: Readonly<SpotSituation>, spot: number): number {
  if (s.view === 'none') return 0;
  if (spot <= 0) return Infinity;
  const seconds = Math.max(SPOTTING.fastest, SPOTTING.seconds * (s.range / SPOTTING.at) ** 2);
  let rate = spot / seconds;
  if (s.moving) rate *= SPOTTING.moving;
  if (s.fired) rate *= SPOTTING.fired;
  if (s.view === 'turret') rate *= SPOTTING.hullDown;
  if (s.alert) rate *= SPOTTING.alert;
  if (s.driving) rate *= SPOTTING.onTheMove;
  return rate;
}

/** The time to spot the tank in `s`, from nothing, s. */
export function spotTime(s: Readonly<SpotSituation>, spot = 1): number {
  const rate = spotRate(s, spot);
  return rate === Infinity ? 0 : rate > 0 ? 1 / rate : Infinity;
}

/** The scenario's numbers. */
export const SCENARIO = {
  /** The objective: the lane level with the 500 m board, z (world; the range's start is 0). */
  objectiveZ: -480,
  /** Its name as the signs say it. */
  objective: 'the 500 m board',
  /** The battery's seed, so every run meets the same fall of shot for the same play. */
  seed: 4410,
  /** The guns fight first; the two tanks come up once the crew is past this z, or has knocked out this many guns. */
  tanksAtZ: -250,
  tanksAfterGuns: 2,
} as const;

export type ScenarioPhase = 'off' | 'on' | 'won' | 'lost';

/** The scenario as both pages show it (the `combat` event). */
export interface ScenarioSnapshot {
  phase: ScenarioPhase;
  /** How long it has run (or ran), s. */
  time: number;
  /** When the enemy first spotted the tank, s into the run, or -1. */
  spottedAt: number;
  /** Enemies knocked out, of how many. */
  killed: number;
  enemies: number;
  /** The enemy's shots at the tank, its hits, and hits through the armour. */
  shots: number;
  hits: number;
  through: number;
  /** Won by reaching the objective (else by knocking every enemy out). */
  reached: boolean;
  /** The enemy tanks have come up. */
  tanksIn: boolean;
  /** The tuning in effect. */
  tune: CombatTuning;
  v: number;
}

export function noScenario(): ScenarioSnapshot {
  return { phase: 'off', time: 0, spottedAt: -1, killed: 0, enemies: 0, shots: 0, hits: 0, through: 0, reached: false, tanksIn: false, tune: defaultTuning(), v: 0 };
}

/** What the scenario reads from the fight each step. */
export interface ScenarioInput {
  /** The tank's world z (the lane runs to -z). */
  z: number;
  /** The tank is knocked out. */
  out: boolean;
  /** Some enemy has the tank spotted. */
  spotted: boolean;
  /** Guns knocked out (the tanks come up after SCENARIO.tanksAfterGuns). */
  gunsKilled: number;
  killed: number;
  enemies: number;
  shots: number;
  hits: number;
  through: number;
}

/** The scenario's run, kept by the host. */
export class ScenarioRun {
  readonly snap: ScenarioSnapshot = noScenario();

  start(tune: Readonly<CombatTuning>): void {
    const v = this.snap.v;
    Object.assign(this.snap, noScenario(), { phase: 'on', tune: { ...tune }, v: v + 1 });
  }

  stop(): void {
    if (this.snap.phase === 'off') return;
    this.snap.phase = 'off';
    this.snap.v++;
  }

  /**
   * `dt` s on, while it runs: the clock, the counts, whether the tanks come
   * up now (the host then starts them), and whether it is won or lost.
   * Returns whether the phase changed. Every enemy knocked out wins only
   * once the tanks are in.
   */
  step(dt: number, f: Readonly<ScenarioInput>): boolean {
    const s = this.snap;
    if (s.phase !== 'on') return false;
    s.time += dt;
    if (!s.tanksIn && (f.z <= SCENARIO.tanksAtZ || f.gunsKilled >= SCENARIO.tanksAfterGuns)) {
      s.tanksIn = true;
      s.v++;
    }
    if (s.spottedAt < 0 && f.spotted) {
      s.spottedAt = s.time;
      s.v++;
    }
    if (f.killed !== s.killed || f.hits !== s.hits || f.through !== s.through || f.enemies !== s.enemies) s.v++;
    s.killed = f.killed;
    s.enemies = f.enemies;
    s.shots = f.shots;
    s.hits = f.hits;
    s.through = f.through;
    if (f.out) {
      s.phase = 'lost';
    } else if (f.z <= SCENARIO.objectiveZ) {
      s.phase = 'won';
      s.reached = true;
    } else if (s.tanksIn && f.enemies > 0 && f.killed >= f.enemies) {
      s.phase = 'won';
    } else {
      return false;
    }
    s.v++;
    return true;
  }
}

/** m:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The briefing, on the sign as the scenario starts. */
export const BRIEFING = [
  'Advance to contact: reach the 500 m board',
  'Guns dug in on the left, tanks behind them. Use the walls and smoke',
] as const;

/** The debrief: the result, then the counts. */
export function debriefLines(s: Readonly<ScenarioSnapshot>): [string, string] {
  const head =
    s.phase === 'won'
      ? s.reached
        ? `Objective reached in ${clock(s.time)}`
        : `Every enemy knocked out in ${clock(s.time)}`
      : s.phase === 'lost'
        ? `Knocked out after ${clock(s.time)}`
        : s.phase === 'on'
          ? `Advancing, ${clock(s.time)}`
          : 'Scenario off';
  const spotted = s.spottedAt < 0 ? 'never spotted' : `spotted at ${clock(s.spottedAt)}`;
  return [head, `${s.killed} of ${s.enemies} enemies out, ${spotted}, ${s.hits} hits taken of ${s.shots} shots, ${s.through} through`];
}

/** One line for the menu. */
export function scenarioLine(s: Readonly<ScenarioSnapshot>): string {
  if (s.phase === 'off' && s.v === 0) return 'Advance to contact: off';
  const [head, counts] = debriefLines(s);
  return `${head}. ${counts}`;
}

/** Read the `combat` event, or null if it is malformed. */
export function parseScenario(raw: unknown): ScenarioSnapshot | null {
  const e = raw as Partial<Record<keyof ScenarioSnapshot, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!e || !['off', 'on', 'won', 'lost'].includes(e.phase as string) || num(e.time) === null || num(e.v) === null) return null;
  return {
    phase: e.phase as ScenarioPhase,
    time: num(e.time) ?? 0,
    spottedAt: num(e.spottedAt) ?? -1,
    killed: num(e.killed) ?? 0,
    enemies: num(e.enemies) ?? 0,
    shots: num(e.shots) ?? 0,
    hits: num(e.hits) ?? 0,
    through: num(e.through) ?? 0,
    reached: e.reached === true,
    tanksIn: e.tanksIn === true,
    tune: parseTuning(e.tune) ?? defaultTuning(),
    v: num(e.v) ?? 0,
  };
}
