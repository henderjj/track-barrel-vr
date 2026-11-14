/**
 * The biathlon course (F5.3a, docs/biathlon-course.md): a loop of about
 * 800 m on the flat field east of the test range, two firing boxes on its
 * east side with three boards each down a lane behind them, a penalty loop of
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

import { BOGIES, OUTLINE_EXTENT, TRACK } from './exterior.js';
import { COURSE_FIELD, DITCH, FIRING_LANES, groundHeight, HILL, laneDirection, STREAM, wrapTile } from './terrain.js';

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
 * z = north and south, with corners of `radius` m on the east side and
 * `tight` m on the west (the driving challenge, F5.3d: taken fast they
 * throw a track); the track is 2 × halfWidth wide. 817 m round.
 */
export const COURSE = {
  west: 60,
  east: 320,
  north: -280,
  south: -110,
  radius: 30,
  tight: 20,
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
    { kind: 'straight', length: COURSE.east - COURSE.west - COURSE.radius - COURSE.tight },
    { kind: 'turn', radius: COURSE.tight, angle: QUARTER },
    { kind: 'straight', length: COURSE.south - COURSE.north - 2 * COURSE.tight },
    { kind: 'turn', radius: COURSE.tight, angle: QUARTER },
    { kind: 'straight', length: COURSE.east - COURSE.west - COURSE.radius - COURSE.tight },
    { kind: 'turn', radius: COURSE.radius, angle: QUARTER },
    { kind: 'straight', length: COURSE.south - COURSE.radius - FINISH_Z },
  ],
  true,
);

/** How far along the course (from the finish line) the point on the east side at `z` is, m. */
export function eastSideAt(z: number): number {
  return COURSE_PATH.length - (z - FINISH_Z);
}

/** Where the north, west and south sides' straights start along the course, m. */
const NORTH_FROM = FINISH_Z - (COURSE.north + COURSE.radius) + COURSE.radius * QUARTER;
const WEST_FROM = NORTH_FROM + (COURSE.east - COURSE.west - COURSE.radius - COURSE.tight) + COURSE.tight * QUARTER;
const SOUTH_FROM = WEST_FROM + (COURSE.south - COURSE.north - 2 * COURSE.tight) + COURSE.tight * QUARTER;
/** How far along the course the point on the north side (driven west) at `x` is, m. */
export function northSideAt(x: number): number {
  return NORTH_FROM + (COURSE.east - COURSE.radius - x);
}
/** How far along the course the point on the west side (driven south) at `z` is, m. */
export function westSideAt(z: number): number {
  return WEST_FROM + (z - (COURSE.north + COURSE.tight));
}
/** How far along the course the point on the south side (driven east) at `x` is, m. */
export function southSideAt(x: number): number {
  return SOUTH_FROM + (x - (COURSE.west + COURSE.tight));
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

// ---------------------------------------------------------------- The driving challenge (F5.3d)

/**
 * The going round the course (docs/biathlon-driving.md): what makes it a
 * driving test as well as a shooting one. In the order a lap meets them:
 *
 * - The slalom on the north side: four narrow gates of two posts each,
 *   each set `offset` m to one side of the middle line and then the
 *   other, `spacing` m apart, `half` m from a gate's middle to each post
 *   (a Sherman is 2.6 m wide). A post knocked down, or a gate driven past
 *   outside its posts, is a fault: FAULT_SECONDS on a race's time.
 * - The hill (src/sim/terrain.ts's HILL) straight after: 2nd gear up its
 *   steep middle, and a run-on down the far side into the tight north-west
 *   corner.
 * - The treadway bridge on the west side over the ditch (DITCH): two steel
 *   treads `tread` m wide under the tracks' middles (TRACK.x either side of
 *   the course's middle line), `length` m long with `ramp` m ramps at each
 *   end up to `height` m. A track off a tread over the ditch, or a tank
 *   driven into the ditch, falls: the tank goes back to BRIDGE_START.
 *   Gate BRIDGE_GATE at its far end makes the bridge part of a lap.
 * - Mud on the south side, `from` to `to` (x), `half` m either side of the
 *   middle line, with a firm gravel bypass round it on the infield side.
 * - The ford over the stream (STREAM): its water at WATER_Y; faster than
 *   8 km/h through it drowns the engine (src/sim/going.ts).
 */
export const SLALOM = { xs: [256, 240, 224, 208], offset: 2, half: 2.2, post: 0.06, height: 1.6 } as const;
export const BRIDGE = { x: COURSE.west, z: DITCH.z, length: 38, ramp: 2.5, height: 0.25, tread: 1.0, gauge: TRACK.x } as const;
/** The mud: 24 m of the south side (x), `half` m either side of the middle line, so going round it takes the bypass (or as long a way round outside). */
export const MUD = { from: 168, to: 192, half: 9 } as const;
/**
 * The bypass leaves the course at `from`, swings out to the infield in two
 * `radius` m curves of `swing` and back in by `to` (x on the south side):
 * tight S-bends that throw a track taken faster than about 17 km/h, so it is
 * safe but slower than the mud driven well.
 */
export const BYPASS = { from: 130, to: 230, radius: 12, swing: (70 * Math.PI) / 180, halfWidth: 4, lift: 0.02 } as const;
/** The ford's water and the ditch's, m (heights as the ground's). */
export const WATER_Y = -0.35;
export const DITCH_WATER_Y = -1.5;
/** A slalom fault costs this much on a race's time, s. */
export const FAULT_SECONDS = 10;
/** Where a tank that fell off the bridge goes back to: lined up on the course's middle line, short of the ramp. */
export const BRIDGE_START = { x: BRIDGE.x, z: BRIDGE.z - BRIDGE.length / 2 - 8, heading: Math.PI } as const;

/**
 * Practice → Obstacles (F5.3d): where each of the driving challenge's
 * obstacles is tried from, lined up on the course's middle line the way a
 * lap drives it, far enough short to get going (heading 0 faces north, a
 * quarter turn left faces west).
 */
export const OBSTACLES = ['slalom', 'hill', 'bridge', 'mud', 'ford'] as const;
export type ObstacleName = (typeof OBSTACLES)[number];
export const OBSTACLE_SPOTS: Readonly<Record<ObstacleName, { x: number; z: number; heading: number }>> = {
  slalom: { x: SLALOM.xs[0] + 30, z: COURSE.north, heading: QUARTER },
  // Past the slalom's last gate, at the hill's foot.
  hill: { x: HILL.crest + HILL.half + 6, z: COURSE.north, heading: QUARTER },
  bridge: BRIDGE_START,
  mud: { x: BYPASS.from - 20, z: COURSE.south, heading: -QUARTER },
  ford: { x: STREAM.x - STREAM.half - 25, z: COURSE.south, heading: -QUARTER },
};

/** The slalom's gates (driven west), each with its posts' places. */
export interface SlalomGate extends Gate {
  posts: readonly (readonly [number, number])[];
}
export const SLALOM_GATES: readonly SlalomGate[] = SLALOM.xs.map((x, k) => {
  const side = k % 2 === 0 ? 1 : -1;
  // Driven west, the driver's left is south (+z).
  const z = COURSE.north + side * SLALOM.offset;
  return {
    x, z, heading: QUARTER, half: SLALOM.half, s: northSideAt(x),
    posts: [[x, z + SLALOM.half], [x, z - SLALOM.half]] as const,
  };
});
/** All the slalom's posts in order, two a gate. */
export const SLALOM_POSTS: readonly (readonly [number, number])[] = SLALOM_GATES.flatMap((g) => g.posts);
/** A gate driven past this far either side of its middle counts as passed outside it, m. */
const SLALOM_REACH = COURSE.halfWidth + 8;

/** The bypass round the mud: out to the infield (left, driven east) and back. */
const BYPASS_SWING = BYPASS.swing;
const BYPASS_ACROSS = 2 * BYPASS.radius * Math.sin(BYPASS_SWING);
export const BYPASS_PATH = new Path(
  BYPASS.from,
  COURSE.south,
  -QUARTER,
  [
    { kind: 'turn', radius: BYPASS.radius, angle: BYPASS_SWING },
    { kind: 'turn', radius: BYPASS.radius, angle: -BYPASS_SWING },
    { kind: 'straight', length: BYPASS.to - BYPASS.from - 2 * BYPASS_ACROSS },
    { kind: 'turn', radius: BYPASS.radius, angle: -BYPASS_SWING },
    { kind: 'turn', radius: BYPASS.radius, angle: BYPASS_SWING },
  ],
  false,
);
/** How far the bypass's straight runs from the course's middle line, m. */
export const BYPASS_OFFSET = 2 * BYPASS.radius * (1 - Math.cos(BYPASS_SWING));

/** Where the bridge's deck and the mud lie along the course, m: the course's gravel isn't drawn there. */
export const BRIDGE_SPAN: readonly [number, number] = [westSideAt(BRIDGE.z - BRIDGE.length / 2), westSideAt(BRIDGE.z + BRIDGE.length / 2)];
export const MUD_SPAN: readonly [number, number] = [southSideAt(MUD.from), southSideAt(MUD.to)];

/** Whether (x, z) (any copy) is in the mud. */
export function onMud(x: number, z: number): boolean {
  const wx = wrapTile(x);
  if (wx < MUD.from || wx > MUD.to) return false;
  return Math.abs(wrapTile(z - COURSE.south)) <= MUD.half;
}

/** Whether (x, z) is in the stream's band (where its water can be). */
function inStreamBand(wx: number, wz: number): boolean {
  return Math.abs(wx - STREAM.x) < STREAM.half && wz > STREAM.from - STREAM.fade && wz < STREAM.to + STREAM.fade;
}

/** How deep the ford's water is at (x, z), m (0 dry). */
export function waterDepth(x: number, z: number): number {
  const wx = wrapTile(x);
  const wz = wrapTile(z);
  if (!inStreamBand(wx, wz)) return 0;
  return Math.max(0, WATER_Y - groundHeight(wx, wz));
}

/** What the going is at (x, z): 0 firm, 1 mud, 2 water. */
export function goingAt(x: number, z: number): 0 | 1 | 2 {
  if (onMud(x, z)) return 1;
  return waterDepth(x, z) > 0.05 ? 2 : 0;
}

/** Whether (x, z) is down in the ditch (more than 30 cm below the field), where a tank off the bridge falls. */
export function inDitch(x: number, z: number): boolean {
  const wx = wrapTile(x);
  const wz = wrapTile(z);
  if (Math.abs(wz - DITCH.z) >= DITCH.half || wx < DITCH.from - DITCH.fade || wx > DITCH.to + DITCH.fade) return false;
  return groundHeight(wx, wz) < -0.3;
}

/** Whether (x, z) is on one of the bridge's treads. */
export function onTread(x: number, z: number): boolean {
  const wx = wrapTile(x - BRIDGE.x);
  const wz = wrapTile(z - BRIDGE.z);
  return Math.abs(wz) <= BRIDGE.length / 2 && Math.abs(Math.abs(wx) - BRIDGE.gauge) <= BRIDGE.tread / 2;
}

/** The bridge deck's height at (x, z) (its whole width, between the treads too), m, or -Infinity off it. */
export function deckHeight(x: number, z: number): number {
  const wx = wrapTile(x - BRIDGE.x);
  const wz = wrapTile(z - BRIDGE.z);
  const half = BRIDGE.length / 2;
  if (Math.abs(wz) > half || Math.abs(wx) > BRIDGE.gauge + BRIDGE.tread / 2) return -Infinity;
  return BRIDGE.height * Math.min(1, (half - Math.abs(wz)) / BRIDGE.ramp);
}

/** The height the tracks ride on at (x, z): the ground, or the bridge's deck over it. */
export function driveHeight(x: number, z: number): number {
  return Math.max(groundHeight(x, z), deckHeight(x, z));
}

/** Where a track lies on the ground (hull z of its ends, forward -z), and the points along it a fall and the going are judged at. */
const TRACK_ENDS = [BOGIES.z[0] - BOGIES.spread, BOGIES.z[BOGIES.z.length - 1] + BOGIES.spread] as const;
export const TRACK_POINTS: readonly number[] = [0, 0.25, 0.5, 0.75, 1].map((t) => TRACK_ENDS[0] + (TRACK_ENDS[1] - TRACK_ENDS[0]) * t);

/** A point on track `side` (-1 left, 1 right) of a tank at (x, z) facing `heading`, `back` m behind its middle (hull z), into `out`. */
export function trackPoint(x: number, z: number, heading: number, side: number, back: number, out: Vec2): Vec2 {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  // Right is forward turned a quarter clockwise seen from above.
  out[0] = x - fz * side * TRACK.x - fx * back;
  out[1] = z + fx * side * TRACK.x - fz * back;
  return out;
}
const tp: Vec2 = [0, 0];

/** Whether a tank at (x, z) facing `heading` has fallen off the bridge: a track's point over the ditch and not on a tread. */
export function fellOffBridge(x: number, z: number, heading: number): boolean {
  const near = Math.abs(wrapTile(z - DITCH.z)) < DITCH.half + 6 && Math.abs(wrapTile(x - BRIDGE.x)) < DITCH.to - DITCH.from + 2 * DITCH.fade;
  if (!near) return false;
  for (const side of [-1, 1]) {
    for (const back of TRACK_POINTS) {
      trackPoint(x, z, heading, side, back, tp);
      if (inDitch(tp[0], tp[1]) && !onTread(tp[0], tp[1])) return true;
    }
  }
  return false;
}

/** How much of the tracks of a tank at (x, z) facing `heading` is on mud and in water, 0 to 1 each, into `out` [mud, water]. */
export function goingUnder(x: number, z: number, heading: number, out: Vec2): Vec2 {
  out[0] = 0;
  out[1] = 0;
  if (outsideCourse(x, z)) return out;
  const share = 1 / (2 * TRACK_POINTS.length);
  for (const side of [-1, 1]) {
    for (const back of TRACK_POINTS) {
      trackPoint(x, z, heading, side, back, tp);
      const g = goingAt(tp[0], tp[1]);
      if (g === 1) out[0] += share;
      else if (g === 2) out[1] += share;
    }
  }
  return out;
}

/** The tank's outline from above, hull space (OUTLINE_EXTENT): what knocks a slalom post down. */
const HULL_HALF = OUTLINE_EXTENT.halfWidth;

/** Whether post (px, pz) stands inside the outline of a tank at (x, z) facing `heading` (its own radius counted). */
export function postUnder(px: number, pz: number, x: number, z: number, heading: number): boolean {
  const dx = wrapTile(px - x);
  const dz = wrapTile(pz - z);
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const across = dx * -fz + dz * fx;
  const back = -(dx * fx + dz * fz);
  return Math.abs(across) <= HULL_HALF + SLALOM.post && back >= OUTLINE_EXTENT.front - SLALOM.post && back <= OUTLINE_EXTENT.rear + SLALOM.post;
}

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
/** The course's gates are about this far apart, m. */
export const GATE_SPACING = 80;
/** The bridge's gate stands this far past its far end, and this far from its middle to each post, m: a lap must cross the bridge. */
const BRIDGE_GATE_PAST = 2;
const BRIDGE_GATE_HALF = 2.4;
/**
 * Where the course's gates stand along it, m, in the order a lap passes
 * them: gate 0 is the start and finish line, then about one every
 * GATE_SPACING m round to the south side, placed so none stands in the
 * slalom, on the bridge or by the mud (where it would choose between the
 * mud and the bypass), with one on the hill's crest and gate BRIDGE_GATE
 * just past the bridge, so a lap must go over both.
 */
export const GATE_AT: readonly number[] = [0, 80, northSideAt(HILL.crest), 320, westSideAt(BRIDGE.z + BRIDGE.length / 2 + BRIDGE_GATE_PAST), 470, southSideAt(BYPASS.to + 5)];
export const BRIDGE_GATE = 4;
/**
 * The course's gates in GATE_AT's order. A lap counts only when it has
 * passed every one.
 */
export const GATES: readonly Gate[] = GATE_AT.map((s, i) => {
  const p = COURSE_PATH.at(s);
  return { x: p.x, z: p.z, heading: p.heading, half: i === BRIDGE_GATE ? BRIDGE_GATE_HALF : COURSE.halfWidth + GATE_MARGIN, s };
});
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
export const BOX_Z: readonly number[] = FIRING_LANES.map((l) => l.z);

/**
 * How far each line's boards stand from its box, m. Since the harder
 * shooting (docs/biathlon-race.md, "Judging the range"), a race picks each
 * line's range afresh within LINE_RANGE_SPAN (`pickLineRanges`), so the
 * gunner judges it from the board's size in the sight; outside a race, and
 * with `boardranges=0`, the boards stand at LINE_RANGES. `setLineRanges`
 * moves COURSE_TARGETS in place.
 */
export const LINE_RANGES: readonly number[] = [400, 500];
/** Each line's span of ranges for a race (line 1 the nearer), m, and the step they are picked in. */
export const LINE_RANGE_SPAN: readonly (readonly [number, number])[] = [
  [350, 450],
  [450, 550],
];
export const LINE_RANGE_STEP = 10;
/**
 * Each line of fire runs south from its box, behind the tank as it stands
 * there (the gunner traverses to 6 o'clock), down the ground's firing lane
 * (FIRING_LANES in src/sim/terrain.ts: flat, with nothing standing in it),
 * line 1's swung this far east of due south and line 2's as far west, rad,
 * so the two fan apart and a shell over one line's boards never reaches
 * the other's. The open ground south of the course is clear of the range,
 * its roads' targets and the enemies.
 */
export const LINE_SWING: readonly number[] = FIRING_LANES.map((l) => l.swing);
export const LINE_ACROSS: readonly number[] = [-6, 0, 6];
/** The words for each board's place in its line, as the gunner sees them. */
const ACROSS_WORDS = ['left', 'middle', 'right'] as const;

/**
 * A biathlon board: a white face with a black disc, its middle `lift +
 * height / 2` m up. Only the black disc counts (`hitRadius`, the disc's
 * own): a shell through the white misses.
 */
export const COURSE_BOARD = { width: 2.2, height: 2.2, lift: 0.4, disc: 0.8, hitRadius: 0.4 } as const;

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

/** The six boards, line 1's three then line 2's, each line left to right as its gunner sees them, at LINE_RANGES until a race moves them. */
export const COURSE_TARGETS: readonly CourseTarget[] = (() => {
  const list: CourseTarget[] = [];
  BOX_Z.forEach((_, line) => {
    LINE_ACROSS.forEach((_, place) => {
      list.push({ line, place, x: 0, z: 0, yaw: 0, range: 0, name: `the line ${line + 1} ${ACROSS_WORDS[place]} board` });
    });
  });
  placeBoards(list, LINE_RANGES);
  return list;
})();

/** Stand `list`'s boards at `ranges` (one a line) from their boxes, along their lines of fire. */
function placeBoards(list: CourseTarget[], ranges: readonly number[]): void {
  const f: Vec2 = [0, 0];
  for (const t of list) {
    const [bx, bz] = boxSpot(t.line);
    // The line of fire runs down the line's lane; its right, as the gunner sees it, is a quarter turn clockwise from it.
    laneDirection(FIRING_LANES[t.line], f);
    const rx = -f[1];
    const rz = f[0];
    const range = ranges[t.line];
    const across = LINE_ACROSS[t.place];
    t.x = bx + f[0] * range + rx * across;
    t.z = bz + f[1] * range + rz * across;
    t.yaw = Math.atan2(bx - t.x, bz - t.z);
    t.range = range;
  }
}

let boardRanges: number[] = [...LINE_RANGES];
let boardsMoved = 0;

/** The range each line's boards stand at now, m. */
export function lineRanges(): readonly number[] {
  return boardRanges;
}

/** A count that changes whenever the boards move: systems keeping faces or meshes of them follow it. */
export function boardsVersion(): number {
  return boardsMoved;
}

/**
 * The middle of line `line`'s firing lane (x, z), tile-local, into `out`.
 * A lane is longer than half a tile, so a board drawn at the copy of it
 * nearest the tank could be the next tile's, behind the box: the boards
 * and their covers are drawn at the copy of their lane's middle nearest
 * the tank instead, which keeps each board down its lane from its box.
 */
export function laneMiddle(line: number, out: Vec2): Vec2 {
  const lane = FIRING_LANES[line];
  laneDirection(lane, out);
  out[0] = lane.x + (out[0] * lane.length) / 2;
  out[1] = lane.z + (out[1] * lane.length) / 2;
  return out;
}

/** A line's range made whole tens of metres within its span (LINE_RANGES's for anything not a number). */
export function clampLineRange(line: number, range: unknown): number {
  const r = Number(range);
  if (!Number.isFinite(r) || r <= 0) return LINE_RANGES[line];
  const [lo, hi] = LINE_RANGE_SPAN[line];
  return Math.min(hi, Math.max(lo, Math.round(r / LINE_RANGE_STEP) * LINE_RANGE_STEP));
}

/** Move the boards to `ranges` (one a line, each within its span). Returns whether they moved. */
export function setLineRanges(ranges: readonly number[]): boolean {
  const next = BOX_Z.map((_, line) => clampLineRange(line, ranges[line]));
  if (next.every((r, line) => r === boardRanges[line])) return false;
  boardRanges = next;
  placeBoards(COURSE_TARGETS as CourseTarget[], next);
  boardsMoved++;
  return true;
}

/** A race's ranges, picked with `random` (0 to 1) within each line's span, in whole steps. */
export function pickLineRanges(random: () => number): number[] {
  return LINE_RANGE_SPAN.map(([lo, hi]) => {
    const steps = Math.round((hi - lo) / LINE_RANGE_STEP);
    return lo + Math.min(steps, Math.floor(random() * (steps + 1))) * LINE_RANGE_STEP;
  });
}

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

/** How far (x, z) is from the course's middle line (or the penalty loop's own part, or the bypass), m: for keeping scatter off the track. */
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

const COURSE_SAMPLES: readonly PathPoint[] = samplePath(COURSE_PATH, 0, COURSE_PATH.length, 2);
const PENALTY_SAMPLES: readonly PathPoint[] = samplePath(PENALTY_PATH, 0, PENALTY_OWN, 2);
const BYPASS_SAMPLES: readonly PathPoint[] = samplePath(BYPASS_PATH, 0, BYPASS_PATH.length, 2);
const TRACK_SAMPLES: readonly PathPoint[] = [...COURSE_SAMPLES, ...PENALTY_SAMPLES, ...BYPASS_SAMPLES];

/** Whether any of a path's samples is within `reach` m of (x, z). */
function within(samples: readonly PathPoint[], x: number, z: number, reach: number): boolean {
  const most = reach * reach;
  for (const p of samples) {
    const dx = wrapTile(x - p.x);
    const dz = wrapTile(z - p.z);
    if (dx * dx + dz * dz <= most) return true;
  }
  return false;
}

/**
 * Whether (x, z) is on the gravel itself, as drawn: the course's track,
 * the penalty loop's or the bypass, each to its own width (to within the
 * 10 cm the samples' spacing leaves), but not in the mud. What a track there
 * runs on (src/sim/ground-surface.ts).
 */
export function onGravel(x: number, z: number): boolean {
  if (outsideCourse(x, z) || onMud(x, z)) return false;
  return within(COURSE_SAMPLES, x, z, COURSE.halfWidth) || within(PENALTY_SAMPLES, x, z, PENALTY.halfWidth) || within(BYPASS_SAMPLES, x, z, BYPASS.halfWidth);
}

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
  /** The driving challenge's (F5.3d): slalom faults so far (posts knocked down, gates passed outside), each FAULT_SECONDS in a race. */
  faults: number;
  /** The slalom's posts down on this lap (bit i: SLALOM_POSTS[i]), and its gates passed or missed on this lap (bit k). */
  knocked: number;
  slalom: number;
  /** Falls off the bridge so far. */
  falls: number;
}

export function createCourseSnapshot(): CourseSnapshot {
  return {
    laps: 0, missed: 0, penalties: 0, passed: 0, started: false, lapClock: 0, lastLap: -1, bestLap: -1, box: -1, halted: false, note: '', noteId: 0, paused: false,
    faults: 0, knocked: 0, slalom: 0, falls: 0,
  };
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
  to.faults = from.faults;
  to.knocked = from.knocked;
  to.slalom = from.slalom;
  to.falls = from.falls;
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
  /** The tank's count of falls off the bridge (TankDrive.falls) last step: a change is a fall, not a jump. */
  private tankFalls = Number.NaN;

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

  /**
   * The host, once a frame: the tank is at (x, z) going `speed` m/s, facing
   * `heading` (for the slalom's posts), having fallen off the bridge `falls`
   * times (TankDrive.falls: a fall puts it back at the bridge's start, which
   * is no jump); `dt` s have passed.
   */
  step(dt: number, x: number, z: number, speed: number, heading = Number.NaN, falls = 0): void {
    const s = this.s;
    if (s.started && !s.paused) s.lapClock += dt;
    const fell = !Number.isNaN(this.tankFalls) && falls !== this.tankFalls;
    this.tankFalls = falls;
    if (fell && !Number.isNaN(this.x)) {
      s.falls++;
      this.say('Fell off the bridge: back to its start');
      this.x = x;
      this.z = z;
      this.boxes(x, z, speed);
      return;
    }
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
    this.slalomStep(x, z, heading);
    this.x = x;
    this.z = z;
    this.boxes(x, z, speed);
  }

  /** The slalom: posts knocked down by the tank's outline, gates passed through or outside, each fault said and counted. */
  private slalomStep(x: number, z: number, heading: number): void {
    const s = this.s;
    if (!Number.isNaN(heading)) {
      for (let i = 0; i < SLALOM_POSTS.length; i++) {
        if (s.knocked & (1 << i)) continue;
        const [px, pz] = SLALOM_POSTS[i];
        if (!postUnder(px, pz, x, z, heading)) continue;
        s.knocked |= 1 << i;
        this.fault(`Slalom: post knocked down, +${FAULT_SECONDS} s`);
      }
    }
    for (let k = 0; k < SLALOM_GATES.length; k++) {
      if (s.slalom & (1 << k)) continue;
      const g = SLALOM_GATES[k];
      if (throughGate(g, this.x, this.z, x, z) === 1) {
        s.slalom |= 1 << k;
        this.version++;
        continue;
      }
      wide.x = g.x;
      wide.z = g.z;
      wide.heading = g.heading;
      if (throughGate(wide, this.x, this.z, x, z) !== 1) continue;
      s.slalom |= 1 << k;
      this.fault(`Slalom: missed gate ${k + 1}, +${FAULT_SECONDS} s`);
    }
  }

  private fault(note: string): void {
    this.s.faults++;
    this.say(note);
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
    // The slalom's posts stand again for the new lap.
    s.knocked = 0;
    s.slalom = 0;
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
    if (arrived) this.say(`Halted in firing box ${box + 1}: boards at 6 o'clock`);
    this.version++;
  }

  private say(note: string): void {
    this.s.note = note;
    this.s.noteId++;
    this.version++;
  }
}

/** A slalom gate as wide as the track and more: crossing its line outside the gate itself misses it. */
const wide: Gate = { x: 0, z: 0, heading: 0, half: SLALOM_REACH, s: 0 };

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
  // The driving challenge's (F5.3d): a page from before it sends none.
  const extra = (v: unknown) => num(v) ?? 0;
  out.faults = extra(e.faults);
  out.knocked = extra(e.knocked);
  out.slalom = extra(e.slalom);
  out.falls = extra(e.falls);
  return { at: values.at };
}
