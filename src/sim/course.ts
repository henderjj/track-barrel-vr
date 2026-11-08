/**
 * The biathlon course (F5.3a, docs/biathlon-course.md): a loop of about
 * 800 m on the flat field east of the test range, two firing boxes on its
 * east side with three boards each across the infield, a penalty loop of
 * about 150 m beside them, and the gates a lap must pass. The race on it
 * (laps, rounds, penalties owed, medals) is F5.3b's.
 *
 * Engine-free and deterministic: the drawn course
 * (src/scene-assets/course.scene-asset.ts, built into the ground's chunks),
 * the ballistics' boards, the course system, the practice crewmate and the
 * tests all read these numbers. World space as src/sim/range.ts: +X east,
 * -Z north (up the range), headings 0 facing -Z and positive turning left;
 * everything here is tile-local and repeats with the ground every TILE.
 *
 * The host keeps a `CourseProgress` (laps, gates, penalty loops, the lap
 * clock) from the tank's track and sends it to the guest as a reliable
 * `course` event; allocates nothing per frame.
 */

import { COURSE_FIELD, wrapTile } from './terrain.js';

export type Vec2 = [number, number];

/** A point on a path: where (x, z), which way it runs (heading, rad) and how far along it is (m). */
export interface PathPoint {
  x: number;
  z: number;
  heading: number;
  s: number;
}

/** One piece of a path: straight on, or round a curve of `radius` m turning `angle` rad (positive: left). */
type Move = { kind: 'straight'; length: number } | { kind: 'turn'; radius: number; angle: number };

/** The direction a heading faces, (x, z). */
export function forwardOf(heading: number, out: Vec2): Vec2 {
  out[0] = -Math.sin(heading);
  out[1] = -Math.cos(heading);
  return out;
}

/** The direction to the left of a heading, (x, z). */
export function leftOf(heading: number, out: Vec2): Vec2 {
  out[0] = -Math.cos(heading);
  out[1] = Math.sin(heading);
  return out;
}

/**
 * A path driven from a start point and heading through straights and
 * curves: the course's centreline and the penalty loop's. `at(s)` gives the
 * point `s` m along it (a closed path wraps round).
 */
export class Path {
  readonly length: number;
  private readonly starts: PathPoint[] = [];
  private readonly f: Vec2 = [0, 0];
  private readonly l: Vec2 = [0, 0];

  constructor(
    readonly x: number,
    readonly z: number,
    readonly heading: number,
    private readonly moves: readonly Move[],
    readonly closed: boolean,
  ) {
    let p: PathPoint = { x, z, heading, s: 0 };
    for (const move of moves) {
      this.starts.push(p);
      p = this.along(p, move, move.kind === 'straight' ? move.length : move.radius * Math.abs(move.angle), { x: 0, z: 0, heading: 0, s: 0 });
    }
    this.length = p.s;
  }

  /** The point `s` m along the path, into `out`. A closed path wraps; an open one stops at its ends. */
  at(s: number, out: PathPoint = { x: 0, z: 0, heading: 0, s: 0 }): PathPoint {
    let t = s;
    if (this.closed) t = ((t % this.length) + this.length) % this.length;
    else t = Math.min(this.length, Math.max(0, t));
    let k = this.moves.length - 1;
    while (k > 0 && this.starts[k].s > t) k--;
    return this.along(this.starts[k], this.moves[k], t - this.starts[k].s, out);
  }

  private along(p: Readonly<PathPoint>, move: Move, d: number, out: PathPoint): PathPoint {
    if (move.kind === 'straight') {
      forwardOf(p.heading, this.f);
      out.x = p.x + this.f[0] * d;
      out.z = p.z + this.f[1] * d;
      out.heading = p.heading;
    } else {
      const side = Math.sign(move.angle);
      leftOf(p.heading, this.l);
      const cx = p.x + side * move.radius * this.l[0];
      const cz = p.z + side * move.radius * this.l[1];
      const heading = p.heading + (side * d) / move.radius;
      leftOf(heading, this.l);
      out.x = cx - side * move.radius * this.l[0];
      out.z = cz - side * move.radius * this.l[1];
      out.heading = heading;
    }
    out.s = p.s + d;
    return out;
  }
}

const QUARTER = Math.PI / 2;

/**
 * The loop: a rounded rectangle on the course's field, driven anticlockwise
 * seen from above (north up the range, east to the right), so its infield is
 * always on the driver's left. Its middle line runs along x = west and east,
 * z = north and south, with corners of `radius` m; the track is
 * 2 × halfWidth wide. 808 m round.
 */
export const COURSE = {
  west: 60,
  east: 320,
  north: -280,
  south: -110,
  radius: 30,
  /** Half the track's width, m: a Sherman is 2.6 m wide, so a driver has room to pick a line. */
  halfWidth: 5,
  /** How far the track's surface stands above the flat ground, m (the roads' rule: 8 mm or more apart from anything else flat). */
  lift: 0.03,
} as const;

/** The finish line (and the start of every lap): on the east side, north of the firing boxes and the penalty loop, m. */
export const FINISH_Z = -235;

/**
 * The course's middle line, from the finish line round the loop and back to
 * it: up the east side to the north-east corner, west along the north side,
 * down the west side, east along the south side and up the east side past
 * the firing boxes to the finish.
 */
export const COURSE_PATH = new Path(
  COURSE.east,
  FINISH_Z,
  0,
  [
    { kind: 'straight', length: FINISH_Z - (COURSE.north + COURSE.radius) },
    { kind: 'turn', radius: COURSE.radius, angle: QUARTER },
    { kind: 'straight', length: COURSE.east - COURSE.west - 2 * COURSE.radius },
    { kind: 'turn', radius: COURSE.radius, angle: QUARTER },
    { kind: 'straight', length: COURSE.south - COURSE.north - 2 * COURSE.radius },
    { kind: 'turn', radius: COURSE.radius, angle: QUARTER },
    { kind: 'straight', length: COURSE.east - COURSE.west - 2 * COURSE.radius },
    { kind: 'turn', radius: COURSE.radius, angle: QUARTER },
    { kind: 'straight', length: COURSE.south - COURSE.radius - FINISH_Z },
  ],
  true,
);

/** How far along the course (from the finish line) the point on the east side at `z` is, m. */
export function eastSideAt(z: number): number {
  return COURSE_PATH.length - (z - FINISH_Z);
}

/**
 * The penalty loop: leaves the course to the right at JOIN.leave, runs
 * round a tight oval east of it, and comes back onto the course at
 * JOIN.back, a little south, from where the course runs up past the leaving
 * point again. Driven clockwise. Its last straight is the course's own, so
 * one loop is about 150 m.
 */
export const PENALTY = {
  /** The curves' radius, m. */
  radius: 18,
  halfWidth: 4,
  /** Its surface is a centimetre below the course's, where the two meet. */
  lift: 0.02,
} as const;
/** Where the penalty loop leaves the course and comes back onto it (z on the east side), m. */
export const JOIN = { leave: -215, back: -195 } as const;

export const PENALTY_PATH = new Path(
  COURSE.east,
  JOIN.leave,
  0,
  [
    { kind: 'turn', radius: PENALTY.radius, angle: -Math.PI },
    { kind: 'straight', length: JOIN.back - JOIN.leave },
    { kind: 'turn', radius: PENALTY.radius, angle: -Math.PI },
    { kind: 'straight', length: JOIN.back - JOIN.leave },
  ],
  true,
);

/** How much of the penalty loop is its own track (the rest is the course's): its two curves and its far straight, m. */
export const PENALTY_OWN = PENALTY_PATH.length - (JOIN.back - JOIN.leave);

/** A gate: two posts across the track at `s` m along a path; driving through between them, forwards, passes it. */
export interface Gate {
  x: number;
  z: number;
  /** The way through it, rad. */
  heading: number;
  /** Half the gap between its posts, m. */
  half: number;
  /** How far along its path, m. */
  s: number;
}

/** The posts stand this far outside the track's edges, m. */
export const GATE_MARGIN = 1.5;
/** The course's gates are this far apart, m. */
export const GATE_SPACING = 80;

/**
 * The course's gates in the order a lap passes them: gate 0 is the
 * start and finish line, then one every GATE_SPACING m round to the south
 * side. A lap counts only when it has passed every one.
 */
export const GATES: readonly Gate[] = (() => {
  const list: Gate[] = [];
  const p: PathPoint = { x: 0, z: 0, heading: 0, s: 0 };
  for (let s = 0; s < eastSideAt(COURSE.south - COURSE.radius) - GATE_SPACING / 2; s += GATE_SPACING) {
    COURSE_PATH.at(s, p);
    list.push({ x: p.x, z: p.z, heading: p.heading, half: COURSE.halfWidth + GATE_MARGIN, s });
  }
  return list;
})();

/** The penalty loop's gate: across the far straight, passed heading south; each pass is one penalty loop. */
export const PENALTY_GATE: Gate = (() => {
  const s = PENALTY.radius * Math.PI + (JOIN.back - JOIN.leave) / 2;
  const p = PENALTY_PATH.at(s);
  return { x: p.x, z: p.z, heading: p.heading, half: PENALTY.halfWidth + GATE_MARGIN, s };
})();

/**
 * The firing boxes: marked out on the east side where the tank halts to
 * shoot, the first after lap 1 and the second after lap 2 (F5.3b), each
 * with its own three boards across the infield on the driver's left.
 * `z` is the box's middle; it is `length` m along the track and `width`
 * across it. The tank counts as in a box with its middle inside it.
 */
export const FIRING_BOX = { length: 12, width: 8 } as const;
export const BOX_Z: readonly number[] = [-152, -170];

/** The firing lines' boards: how far each line's stand from its box, and how far across the line of fire the three stand (+ right, as the gunner sees them), m. */
export const LINE_RANGES: readonly number[] = [150, 220];
/**
 * Each line of fire swings this far from square across the infield, rad
 * (positive: towards the south): line 1's straight across, line 2's a
 * little north, so the two fan apart and a shell over one line's boards
 * never reaches the other's; line 1's passes between the range's 100 m and
 * 250 m targets far beyond.
 */
export const LINE_SWING: readonly number[] = [0, (-6 * Math.PI) / 180];
export const LINE_ACROSS: readonly number[] = [-6, 0, 6];
/** The words for each board's place in its line, as the gunner sees them. */
const ACROSS_WORDS = ['left', 'middle', 'right'] as const;

/** A biathlon board: a white face with a black disc, its middle `lift + height / 2` m up. The disc is what counts: its square is the hit box. */
export const COURSE_BOARD = { width: 2.2, height: 2.2, lift: 0.4, disc: 0.8, hitHalf: 0.75 } as const;

/** Where the tank's middle stands in box `k`, and which way it faces (up the east side, north). */
export function boxSpot(k: number): [x: number, z: number, heading: number] {
  return [COURSE.east, BOX_Z[k], 0];
}

/** Which box (x, z) is in, or -1. */
export function boxAt(x: number, z: number): number {
  for (let k = 0; k < BOX_Z.length; k++) {
    if (Math.abs(wrapTile(x - COURSE.east)) <= FIRING_BOX.width / 2 && Math.abs(wrapTile(z - BOX_Z[k])) <= FIRING_BOX.length / 2) return k;
  }
  return -1;
}

/** One firing line's board: which line, its place in the line (0 left to 2 right), and where it stands. */
export interface CourseTarget {
  line: number;
  place: number;
  x: number;
  z: number;
  /** Which way its face looks, rad about +Y: square to its box. */
  yaw: number;
  range: number;
  name: string;
}

/** The six boards, line 1's three then line 2's, each line left to right as its gunner sees them. */
export const COURSE_TARGETS: readonly CourseTarget[] = (() => {
  const list: CourseTarget[] = [];
  const f: Vec2 = [0, 0];
  BOX_Z.forEach((_, line) => {
    const [bx, bz, heading] = boxSpot(line);
    // The line of fire is to the box's left (west, across the infield), swung a little; its right is a quarter turn clockwise from it.
    leftOf(heading + LINE_SWING[line], f);
    const fx = f[0];
    const fz = f[1];
    const rx = -fz;
    const rz = fx;
    LINE_ACROSS.forEach((across, place) => {
      const range = LINE_RANGES[line];
      const x = bx + fx * range + rx * across;
      const z = bz + fz * range + rz * across;
      list.push({ line, place, x, z, yaw: Math.atan2(bx - x, bz - z), range, name: `the line ${line + 1} ${ACROSS_WORDS[place]} board` });
    });
  });
  return list;
})();

/** How high the middle of a course board's face is above the ground, m. */
export function courseBoardMiddle(): number {
  return COURSE_BOARD.lift + COURSE_BOARD.height / 2;
}

/** Practice → Biathlon → Course: parked on the east side short of the finish line, facing up it, so the first lap starts as the tank drives off. */
export const COURSE_START = { x: COURSE.east, z: FINISH_Z + 10, heading: 0 } as const;

/** The course's middle line and the penalty loop's own part, sampled every `step` m (and at every piece's ends): for drawing, and for the crewmate. */
export function samplePath(path: Path, from: number, to: number, step: number): PathPoint[] {
  const n = Math.max(1, Math.ceil((to - from) / step));
  const out: PathPoint[] = [];
  for (let i = 0; i <= n; i++) out.push(path.at(from + ((to - from) * i) / n));
  return out;
}

/** How far (x, z) is from the course's middle line (or the penalty loop's own part), m: for keeping scatter off the track. */
export function distanceToTrack(x: number, z: number): number {
  let best = Infinity;
  for (const p of TRACK_SAMPLES) {
    const d = Math.hypot(wrapTile(x - p.x), wrapTile(z - p.z));
    if (d < best) best = d;
  }
  return best;
}

/** Whether (x, z) is on the course's track or the penalty loop's: scatter keeps off. */
export function onCourse(x: number, z: number): boolean {
  if (outsideCourse(x, z)) return false;
  return distanceToTrack(x, z) <= COURSE.halfWidth + 2;
}

/** Quickly: whether (x, z) is nowhere near the course (outside its field). */
function outsideCourse(x: number, z: number): boolean {
  const f = COURSE_FIELD;
  const midX = (f.west + f.east) / 2;
  const midZ = (f.north + f.south) / 2;
  return Math.abs(wrapTile(x - midX)) > (f.east - f.west) / 2 || Math.abs(wrapTile(z - midZ)) > (f.south - f.north) / 2;
}

const TRACK_SAMPLES: readonly PathPoint[] = [...samplePath(COURSE_PATH, 0, COURSE_PATH.length, 2), ...samplePath(PENALTY_PATH, 0, PENALTY_OWN, 2)];

// ---------------------------------------------------------------- Laps and gates

/** What the host keeps of the crew's progress round the course, and sends the guest. Times in s. */
export interface CourseSnapshot {
  /** Laps completed, each having passed every gate. */
  laps: number;
  /** Laps that crossed the finish having missed a gate: not counted. */
  missed: number;
  /** Penalty loops driven. */
  penalties: number;
  /** The gates passed on this lap so far, as bits (bit i: gate i). */
  passed: number;
  /** The first lap has started: the tank has crossed the start line. */
  started: boolean;
  /** Time on this lap so far, s. */
  lapClock: number;
  /** The last counted lap's time, and the best this session, s; -1 for none. */
  lastLap: number;
  bestLap: number;
  /** The firing box the tank's middle is in (-1 for none), and whether it stands still there. */
  box: number;
  halted: boolean;
  /** The last thing worth a sign (a lap, a missed gate, a penalty loop), and a count that changes with each. */
  note: string;
  noteId: number;
  /** The crewmate stepped away: the lap clock stands still. */
  paused: boolean;
}

export function createCourseSnapshot(): CourseSnapshot {
  return { laps: 0, missed: 0, penalties: 0, passed: 0, started: false, lapClock: 0, lastLap: -1, bestLap: -1, box: -1, halted: false, note: '', noteId: 0, paused: false };
}

export function copyCourseSnapshot(from: CourseSnapshot, to: CourseSnapshot): CourseSnapshot {
  to.laps = from.laps;
  to.missed = from.missed;
  to.penalties = from.penalties;
  to.passed = from.passed;
  to.started = from.started;
  to.lapClock = from.lapClock;
  to.lastLap = from.lastLap;
  to.bestLap = from.bestLap;
  to.box = from.box;
  to.halted = from.halted;
  to.note = from.note;
  to.noteId = from.noteId;
  to.paused = from.paused;
  return to;
}

/** The tank stands still (for a halt in a box) below this speed, m/s: as the crewmate fires. */
export const HALTED_SPEED = 0.3;
/** A move further than this in one step is a jump (a Practice shortcut, Back to start), not driving: the progress starts again, m. */
export const JUMP = 15;
/** A bitmask with every gate but the finish set: what a lap must have passed. */
export const ALL_GATES = ((1 << GATES.length) - 1) & ~1;

/**
 * Whether driving from (ax, az) to (bx, bz) passes through `gate` (between
 * its posts), and which way: 1 forwards, -1 backwards, 0 not through it.
 * The positions are world space; the gate's nearest copy is used.
 */
export function throughGate(gate: Readonly<Gate>, ax: number, az: number, bx: number, bz: number): number {
  const fx = -Math.sin(gate.heading);
  const fz = -Math.cos(gate.heading);
  // Both ends relative to the gate's copy nearest the end of the move.
  const bxr = wrapTile(bx - gate.x);
  const bzr = wrapTile(bz - gate.z);
  const axr = bxr + wrapTile(ax - bx);
  const azr = bzr + wrapTile(az - bz);
  const da = axr * fx + azr * fz;
  const db = bxr * fx + bzr * fz;
  if (da < 0 === db < 0) return 0;
  const t = da / (da - db);
  const cx = axr + (bxr - axr) * t;
  const cz = azr + (bzr - azr) * t;
  // How far from the gate's middle the move crossed its line.
  if (Math.abs(cx * fz - cz * fx) > gate.half) return 0;
  return db > da ? 1 : -1;
}

/** Laps and gates round the course, kept by the host from the tank's track. */
export class CourseProgress {
  readonly s = createCourseSnapshot();
  /** Bumped whenever something the guest should hear of changes (not the lap clock ticking). */
  version = 0;
  private x = Number.NaN;
  private z = Number.NaN;
  /** The first gate missed on this lap so far (said once a lap), or -1. */
  private missedGate = -1;

  /** Start again: no laps, no penalty loops, waiting for the start line. */
  reset(): void {
    const s = this.s;
    const best = s.bestLap;
    const noteId = s.noteId;
    copyCourseSnapshot(createCourseSnapshot(), s);
    s.bestLap = best;
    s.noteId = noteId;
    this.missedGate = -1;
    this.version++;
  }

  setPaused(paused: boolean): void {
    if (this.s.paused === paused) return;
    this.s.paused = paused;
    this.version++;
  }

  /** The host, once a frame: the tank is at (x, z) going `speed` m/s; `dt` s have passed. */
  step(dt: number, x: number, z: number, speed: number): void {
    const s = this.s;
    if (s.started && !s.paused) s.lapClock += dt;
    if (Number.isNaN(this.x) || Math.hypot(wrapTile(x - this.x), wrapTile(z - this.z)) > JUMP) {
      if (!Number.isNaN(this.x)) this.reset();
      this.x = x;
      this.z = z;
      this.boxes(x, z, speed);
      return;
    }
    for (let i = 0; i < GATES.length; i++) {
      if (throughGate(GATES[i], this.x, this.z, x, z) !== 1) continue;
      if (i === 0) this.finishLine();
      else this.gate(i);
    }
    if (throughGate(PENALTY_GATE, this.x, this.z, x, z) === 1) {
      s.penalties++;
      this.say(`Penalty loop ${s.penalties}`);
    }
    this.x = x;
    this.z = z;
    this.boxes(x, z, speed);
  }

  /** The guest: the lap clock runs on between the host's snapshots. */
  follow(dt: number): void {
    if (this.s.started && !this.s.paused) this.s.lapClock += dt;
  }

  /** The guest: take the host's word, `age` s old. */
  apply(from: CourseSnapshot, age: number): void {
    copyCourseSnapshot(from, this.s);
    if (this.s.started && !this.s.paused) this.s.lapClock += Math.max(0, Math.min(1, age));
    this.version++;
  }

  private finishLine(): void {
    const s = this.s;
    if (!s.started) {
      s.started = true;
      s.lapClock = 0;
      this.say('Lap 1: go!');
    } else if ((s.passed & ALL_GATES) === ALL_GATES) {
      s.laps++;
      s.lastLap = s.lapClock;
      if (s.bestLap < 0 || s.lastLap < s.bestLap) s.bestLap = s.lastLap;
      this.say(`Lap ${s.laps} in ${formatLapTime(s.lastLap)}`);
    } else {
      s.missed++;
      this.say(`Lap not counted: missed gate ${firstMissing(s.passed)}`);
    }
    s.passed = 0;
    s.lapClock = 0;
    this.missedGate = -1;
    this.version++;
  }

  private gate(i: number): void {
    const s = this.s;
    if (!s.started) return;
    s.passed |= 1 << i;
    this.version++;
    // An earlier gate not passed on this lap: say so once, so the crew can go back for it.
    const missing = firstMissing(s.passed, i);
    if (this.missedGate < 0 && missing > 0) {
      this.missedGate = missing;
      this.say(`Missed gate ${missing}: this lap won't count`);
    }
  }

  private boxes(x: number, z: number, speed: number): void {
    const s = this.s;
    const box = boxAt(x, z);
    const halted = box >= 0 && Math.abs(speed) < HALTED_SPEED;
    if (box === s.box && halted === s.halted) return;
    const arrived = halted && !s.halted;
    s.box = box;
    s.halted = halted;
    if (arrived) this.say(`Halted in firing box ${box + 1}`);
    this.version++;
  }

  private say(note: string): void {
    this.s.note = note;
    this.s.noteId++;
    this.version++;
  }
}

/** The first gate (from 1, below `below`) not passed, or 0 if none is missing. */
export function firstMissing(passed: number, below = GATES.length): number {
  for (let i = 1; i < below; i++) if ((passed & (1 << i)) === 0) return i;
  return 0;
}

/** How many of the gates past the start line have been passed on this lap. */
export function gatesPassed(passed: number): number {
  let n = 0;
  for (let i = 1; i < GATES.length; i++) if (passed & (1 << i)) n++;
  return n;
}

/** A lap time as the sign shows it: 2:31.4. */
export function formatLapTime(seconds: number): string {
  const t = Math.max(0, seconds);
  const minutes = Math.floor(t / 60);
  const rest = t - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** One line for the game menu. */
export function courseLine(s: CourseSnapshot): string {
  const box = s.box >= 0 ? ` In firing box ${s.box + 1}${s.halted ? ', halted' : ''}.` : '';
  const penalties = s.penalties > 0 ? ` Penalty loops ${s.penalties}.` : '';
  const best = s.bestLap >= 0 ? ` Best lap ${formatLapTime(s.bestLap)}.` : '';
  if (!s.started) return `Cross the start line on the east side to start a lap.${box}${penalties}${best}`;
  const missed = s.missed > 0 ? `, ${s.missed} not counted` : '';
  const paused = s.paused ? ' (paused)' : '';
  return `Lap ${s.laps + 1} ${formatLapTime(s.lapClock)}${paused}: gates ${gatesPassed(s.passed)} of ${GATES.length - 1}. Laps done ${s.laps}${missed}.${box}${penalties}${best}`;
}

/** The `course` event the host sends: the snapshot as plain JSON, and the host's clock when sent (ms). */
export function courseEvent(s: CourseSnapshot, atMs: number): { t: 'course' } & Record<string, unknown> {
  return { t: 'course', ...s, at: atMs };
}

/** A `course` event read back into `out`, or null if it isn't one (a page on another build, a bad message). */
export function readCourseEvent(e: Record<string, unknown>, out: CourseSnapshot): { at: number } | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const fields = ['laps', 'missed', 'penalties', 'passed', 'lapClock', 'lastLap', 'bestLap', 'box', 'noteId', 'at'] as const;
  const values: Record<string, number> = {};
  for (const key of fields) {
    const v = num(e[key]);
    if (v === null) return null;
    values[key] = v;
  }
  out.laps = values.laps;
  out.missed = values.missed;
  out.penalties = values.penalties;
  out.passed = values.passed;
  out.lapClock = values.lapClock;
  out.lastLap = values.lastLap;
  out.bestLap = values.bestLap;
  out.box = values.box;
  out.noteId = values.noteId;
  out.started = e.started === true;
  out.halted = e.halted === true;
  out.paused = e.paused === true;
  out.note = typeof e.note === 'string' ? e.note.slice(0, 80) : '';
  return { at: values.at };
}
