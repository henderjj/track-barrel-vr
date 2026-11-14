/**
 * The crew board (docs/crew-board.md): an orders board clipped up in each
 * seat that says what the crew is doing and what has happened to the tank,
 * in place of the signs that floated in front of the players' eyes. It
 * shows the objective and the tasks, the round in the gun and what the rack
 * holds, a drawing of the tank hatched where it is damaged, and the last few
 * calls (the notes the signs used to show), newest first.
 *
 * Engine-free: where each board hangs, the log of calls, and what the board
 * says, shared by the model (src/scene-assets/crew-board.scene-asset.ts),
 * the system that draws its face (src/systems/crew-board-system.ts) and the
 * tests. Nothing goes over the network: each page builds the board from the
 * state it already shows (the host's damage, scenario, run and course
 * events), and logs the notes its own systems raise.
 */

import { AMMO, AMMO_KINDS, type AmmoKind } from './ammo.js';
import { HULL, type SeatId, SEATS, TURRET } from './cabin.js';
import { LAMP_REPEATER } from './firing-lamp.js';
import { debriefLines, SCENARIO, type ScenarioSnapshot } from './combat.js';
import type { DamageState } from './damage.js';

/** How a call reads on the board: news, bad news (red), or good news. */
export type CallTone = 'info' | 'bad' | 'good';

/** One call in the log: when (the board's clock, s), what it said, and how it reads. */
export interface BoardCall {
  id: number;
  at: number;
  text: string;
  /** A second line for this seat only, kept up to date while the call is new (the gunner's traverse to an enemy), or ''. */
  detail: string;
  tone: CallTone;
}

/** Calls kept, and calls the board shows. */
export const LOG_SIZE = 12;
export const BOARD_CALLS = 3;
/** The same words again within this long are the same call (a sign redrawn), s. */
export const SAME_CALL_SECONDS = 3;

/**
 * The calls this page has heard, newest last. Systems post the notes their
 * signs used to show; the board's clock stamps them. `v` bumps on every
 * change, so the board redraws only when it must.
 */
export class CrewLog {
  readonly entries: BoardCall[] = [];
  v = 0;
  private nextId = 1;
  /** The board's clock, s (the scenario's or run's time while one is on). The crew board system sets it. */
  now: () => number = () => 0;

  /** Log `text` as a call; the same words again straight away only move the old one's time. */
  post(text: string, tone: CallTone = 'info'): BoardCall | null {
    if (text === '') return null;
    const at = this.now();
    const last = this.entries[this.entries.length - 1];
    if (last && last.text === text && Math.abs(at - last.at) < SAME_CALL_SECONDS) {
      last.tone = tone;
      return last;
    }
    const call = { id: this.nextId++, at, text, detail: '', tone };
    this.entries.push(call);
    if (this.entries.length > LOG_SIZE) this.entries.shift();
    this.v++;
    return call;
  }

  /** Rewrite a call still on the board (an enemy's bearing as the tank turns). */
  update(call: BoardCall, text: string, detail: string): void {
    if (call.text === text && call.detail === detail) return;
    call.text = text;
    call.detail = detail;
    this.v++;
  }

  /** The newest `n` calls, newest first. */
  latest(n: number): BoardCall[] {
    return this.entries.slice(-n).reverse();
  }

  clear(): void {
    this.entries.length = 0;
    this.v++;
  }
}

/** The one log on this page. */
export const crewLog = new CrewLog();

/**
 * Where a board hangs, in its seat's frame (hull space for the driver,
 * turret space for the gunner): its face's middle, its size, and its turn
 * about +Y then its tilt back about its own X (the face looks along its own
 * +Z), m and rad.
 */
export interface BoardPlace {
  frame: 'hull' | 'turret';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  yaw: number;
  /** Leaned back from upright, rad: the board leans against what it's clipped to. */
  tilt: number;
}

/** The clipboard: its board's border round the paper, its thickness, and how far the paper stands off it, m. */
export const BOARD_BORDER = 0.02;
export const BOARD_THICK = 0.012;
export const PAPER_GAP = 0.004;
/** The clip's size across and up, and how far it stands proud of the paper, m. */
export const CLIP = { width: 0.11, height: 0.03, proud: 0.006 } as const;

/** A board's turn and tilt so its face looks straight at `eye` from (x, y, z): yaw about +Y, then leaned back. */
export function facing(x: number, y: number, z: number, eye: readonly number[]): { yaw: number; tilt: number } {
  const dx = eye[0] - x;
  const dz = eye[2] - z;
  return { yaw: Math.atan2(dx, dz), tilt: Math.atan2(eye[1] - y, Math.hypot(dx, dz)) };
}

const DRIVER_BOARD = { x: 0.12, y: SEATS.driver.eye[1] - 0.24, z: SEATS.driver.eye[2] - 0.34 };
const GUNNER_BOARD = { x: LAMP_REPEATER.x + 0.23, y: SEATS.gunner.eye[1] - 0.2, z: TURRET.front + HULL.wall + BOARD_THICK + PAPER_GAP + 0.03 };

/**
 * The two boards, 4:3 as the face's canvas (docs/crew-board.md). The
 * driver's stands at their front right, over the final drive's housing in
 * front of the empty assistant driver's seat, below and right of the turret
 * dial, turned and leaned to face their eyes: a glance down and right from
 * the slit. The gunner's is on the turret's front wall right of the
 * gunsight, under the firing lamp's repeater, flat on the wall (the eyes
 * look at it 25° off square): a glance right from the sight. Both well
 * clear of the slit, the periscopes' windows and every control's reach.
 */
export const BOARDS: Readonly<Record<SeatId, BoardPlace>> = {
  driver: { frame: 'hull', ...DRIVER_BOARD, width: 0.36, height: 0.27, ...facing(DRIVER_BOARD.x, DRIVER_BOARD.y, DRIVER_BOARD.z, SEATS.driver.eye) },
  gunner: { frame: 'turret', ...GUNNER_BOARD, width: 0.44, height: 0.33, yaw: 0, tilt: 0 },
};

/** A task on the board, crossed off once done. */
export interface BoardTask {
  text: string;
  done: boolean;
}

/** A line under DAMAGE or CREW, red when bad. */
export interface BoardLine {
  text: string;
  bad: boolean;
}

/** Where the tank's drawing is hatched. */
export interface DamageZones {
  engine: boolean;
  leftTrack: boolean;
  rightTrack: boolean;
  transmission: boolean;
  turret: boolean;
  driver: boolean;
  gunner: boolean;
}

/** Everything the board says. */
export interface BoardText {
  /** The clock in the corner: the scenario's or run's time, or '' when nothing is timed. */
  clock: string;
  objective: string;
  tasks: BoardTask[];
  round: string;
  rack: string;
  damage: BoardLine[];
  crew: BoardLine[];
  hits: string;
  zones: DamageZones;
  /** The latest calls, newest first, each with its time as the board shows it. */
  calls: { time: string; text: string; detail: string; tone: CallTone }[];
}

/** How many enemies of a group are there, how many are out, and whether they have come up yet. */
export interface EnemyCount {
  out: number;
  total: number;
  /** They have come up (started). */
  in: boolean;
}

/** What the board is built from: each page's own copy of the shared state. */
export interface BoardInput {
  /** The board's clock, s, and whether something is timed. */
  clock: number;
  timed: boolean;
  scenario: Readonly<ScenarioSnapshot>;
  /** The tank's z (world; the objective is at SCENARIO.objectiveZ). */
  tankZ: number;
  guns: Readonly<EnemyCount>;
  tanks: Readonly<EnemyCount>;
  damage: Readonly<DamageState>;
  loaded: AmmoKind | null;
  /** Rounds of each kind in the rack (not in the gun, not fired). */
  rack: Readonly<Record<AmmoKind, number>>;
  /** A drill's own lines when no scenario is on (a range run, a race, a driving course): its name, then its tasks. '' for none. */
  drill: string;
  drillTasks: readonly string[];
  calls: readonly BoardCall[];
}

/** The board's clock as written: 0:42, 12:05. */
export function boardClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** The distance left to the objective, to 10 m. */
export function toGo(tankZ: number): number {
  return Math.max(0, Math.round((tankZ - SCENARIO.objectiveZ) / 10) * 10);
}

const TRACK_WORDS: Readonly<Record<DamageState['immobile'], string>> = {
  '': '',
  'left-track': 'Left track broken',
  'right-track': 'Right track broken',
  transmission: 'Transmission hit',
};

/** The DAMAGE lines: what is broken, in the words a crew would write. */
export function damageLines(d: Readonly<DamageState>): BoardLine[] {
  const lines: BoardLine[] = [];
  if (d.out) lines.push({ text: 'KNOCKED OUT', bad: true });
  if (d.engine === 1) lines.push({ text: 'Engine hit: weak, runs hot', bad: true });
  else if (d.engine === 2 && !d.out) lines.push({ text: 'Engine knocked out', bad: true });
  if (d.immobile) lines.push({ text: TRACK_WORDS[d.immobile], bad: true });
  if (d.traverse) lines.push({ text: 'Power traverse out: crank', bad: true });
  if (lines.length === 0) lines.push({ text: 'None', bad: false });
  return lines;
}

const WOUNDS = ['', 'wounded', 'badly wounded'];

/** The CREW lines. */
export function crewLines(d: Readonly<DamageState>): BoardLine[] {
  if (d.driver === 0 && d.gunner === 0) return [{ text: 'Both fit', bad: false }];
  const lines: BoardLine[] = [];
  if (d.driver > 0) lines.push({ text: `Driver ${WOUNDS[Math.min(2, d.driver)]}`, bad: true });
  if (d.gunner > 0) lines.push({ text: `Gunner ${WOUNDS[Math.min(2, d.gunner)]}`, bad: true });
  return lines;
}

/** Where to hatch the drawing. */
export function damageZones(d: Readonly<DamageState>): DamageZones {
  return {
    engine: d.engine > 0,
    leftTrack: d.immobile === 'left-track',
    rightTrack: d.immobile === 'right-track',
    transmission: d.immobile === 'transmission',
    turret: d.traverse,
    driver: d.driver > 0,
    gunner: d.gunner > 0,
  };
}

function enemyTask(word: string, c: Readonly<EnemyCount>): BoardTask {
  if (!c.in) return { text: `${word}: not seen yet`, done: false };
  return { text: `${word}: ${c.out} of ${c.total} out`, done: c.total > 0 && c.out >= c.total };
}

/** What the board says, from `input`. */
export function boardText(input: Readonly<BoardInput>): BoardText {
  const s = input.scenario;
  let objective: string;
  let tasks: BoardTask[];
  if (s.phase === 'on') {
    objective = `${capitalise(SCENARIO.objective)}, ${toGo(input.tankZ)} m`;
    tasks = [{ text: 'Advance to contact', done: s.spottedAt >= 0 }, enemyTask('Guns', input.guns), enemyTask('Tanks', input.tanks)];
  } else if (s.phase === 'won' || s.phase === 'lost') {
    const [head, counts] = debriefLines(s);
    objective = head;
    tasks = [
      { text: `${s.killed} of ${s.enemies} enemies out`, done: s.killed >= s.enemies && s.enemies > 0 },
      { text: `Hit ${s.hits} times, ${s.through} through`, done: false },
    ];
    void counts;
  } else if (input.drill !== '') {
    objective = input.drill;
    tasks = input.drillTasks.map((text) => ({ text, done: false }));
  } else {
    objective = 'None: free driving';
    tasks = [{ text: 'Menu: Practice or Battle', done: false }];
  }
  const d = input.damage;
  const rack = AMMO_KINDS.filter((k) => input.rack[k] > 0).map((k) => `${AMMO[k].short} ${input.rack[k]}`);
  return {
    clock: input.timed ? boardClock(input.clock) : '',
    objective,
    tasks,
    round: input.loaded ? AMMO[input.loaded].short : 'Empty',
    rack: rack.length > 0 ? `Rack: ${rack.join(', ')}` : 'Rack: empty',
    damage: damageLines(d),
    crew: crewLines(d),
    hits: d.hits === 0 ? 'None' : `${d.hits} (${d.through} through)`,
    zones: damageZones(d),
    calls: input.calls.map((c) => ({ time: boardClock(c.at), text: c.text, detail: c.detail, tone: c.tone })),
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A one-line digest of the board, for tests and the console: changes whenever the drawn face would. */
export function boardKey(t: Readonly<BoardText>): string {
  const z = t.zones;
  return [
    t.clock,
    t.objective,
    t.tasks.map((k) => `${k.done ? '-' : ''}${k.text}`).join('|'),
    t.round,
    t.rack,
    t.damage.map((l) => l.text).join('|'),
    t.crew.map((l) => l.text).join('|'),
    t.hits,
    Object.values(z).map((b) => (b ? 1 : 0)).join(''),
    t.calls.map((c) => `${c.time} ${c.text}${c.detail ? ` (${c.detail})` : ''}`).join('|'),
  ].join(' / ');
}
