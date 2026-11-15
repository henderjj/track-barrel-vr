/**
 * The biathlon course's road signs (docs/biathlon-signs.md), from John's
 * play test of 2026-11-15: what each obstacle wants of the driver, told
 * before the driver gets there.
 *
 * - The ford: a speed limit roundel with the ford's limit (FORD_SPEED, 8
 *   km/h) and a FORD plate, before the water.
 * - The mud: a red caution triangle with a MUD plate, before the bypass
 *   leaves, so the driver can still choose.
 * - The penalty loop: a yellow PENALTY LOOP board with an arrow to the
 *   right at the loop's mouth, where it turns off the course (John,
 *   2026-11-15: 15 m short of it, it didn't say where to go), and yellow
 *   chevron boards round the outside of its two curves, pointing the way it
 *   is driven (clockwise).
 * - The slalom: a SLALOM board with a weaving arrow before it. Its gates
 *   alternate red and blue, as a ski slalom's do (the posts' own colours,
 *   course.scene-asset.ts's slalomPostParts), in place of the blue arrow
 *   roundels John found confusing.
 *
 * Where each stands, and which way it faces, is here (engine-free, so the
 * tests can check every sign stands clear of the tracks); how each looks is
 * src/scene-assets/course.scene-asset.ts's.
 */

import {
  BYPASS,
  COURSE,
  COURSE_PATH,
  eastSideAt,
  JOIN,
  leftOf,
  northSideAt,
  PENALTY,
  PENALTY_PATH,
  type Path,
  SLALOM,
  southSideAt,
  type Vec2,
} from './course.js';
import { FORD_SPEED } from './going.js';
import { STREAM } from './terrain.js';

export type CourseSignKind = 'ford' | 'mud' | 'penalty' | 'chevron' | 'slalom';

/**
 * A sign: what it says, where its middle stands on the ground (x, z) and
 * which way it is turned (`yaw`, rad about +Y). Its face looks along its
 * own +Z, so turned to the heading of the track beside it (whose forward
 * is -Z, as the gates are) it faces a driver coming along the track.
 */
export interface CourseSign {
  kind: CourseSignKind;
  x: number;
  z: number;
  yaw: number;
}

/** The ford's speed limit as the sign gives it, km/h: the drive model's. */
export const FORD_LIMIT_KMH = Math.round(FORD_SPEED * 3.6);

/** How far from a track's middle line its signs stand, m: 3 m clear of the course's 5 m half-width, outside the gates' posts and flags. */
export const SIGN_OFFSET = COURSE.halfWidth + 3;
/** How far short of each thing its sign stands, m. */
const BEFORE = {
  /** The ford's water starts about STREAM.half m short of its middle; the sign stands this much before that, room to slow to the limit. */
  ford: 12,
  /** The bypass leaves for the mud at BYPASS.from: the caution stands this far before it, so the driver can still choose. */
  mud: 12,
  /** Where the penalty loop leaves the course (JOIN.leave): the sign stands at its mouth, this far before it, inside the loop's first curve. */
  penalty: 1,
  /** The slalom's first gate: its board stands this far short. */
  slalom: 26,
} as const;

const tmp: Vec2 = [0, 0];

/** A sign `side` m to the right of (negative: left of) `path` at `s` m along it, facing a driver coming along it. */
function beside(kind: CourseSignKind, path: Path, s: number, side: number): CourseSign {
  const p = path.at(s);
  leftOf(p.heading, tmp);
  return { kind, x: p.x - tmp[0] * side, z: p.z - tmp[1] * side, yaw: p.heading };
}

/** The penalty loop's chevrons: how far round each of its curves (fraction of the half turn), on the curve's outside. */
const CHEVRONS: readonly { curve: 0 | 1; at: number }[] = [
  // The first curve's start runs off the course by the finish line: its chevrons start halfway round.
  { curve: 0, at: 0.5 },
  { curve: 0, at: 0.78 },
  // The second's end runs back onto the course by the boxes: its chevrons stop halfway.
  { curve: 1, at: 0.22 },
  { curve: 1, at: 0.5 },
];

/** Every sign on the course. */
export const COURSE_SIGNS: readonly CourseSign[] = (() => {
  const list: CourseSign[] = [];
  // The slalom (driven west along the north side): its board on the right.
  list.push(beside('slalom', COURSE_PATH, northSideAt(SLALOM.xs[0] + BEFORE.slalom), SIGN_OFFSET));
  // The south side is driven east: the mud's caution before the bypass leaves, the ford's limit before its water. Both on the right, outside the loop.
  list.push(beside('mud', COURSE_PATH, southSideAt(BYPASS.from - BEFORE.mud), SIGN_OFFSET));
  list.push(beside('ford', COURSE_PATH, southSideAt(STREAM.x - STREAM.half - BEFORE.ford), SIGN_OFFSET));
  // Up the east side to the finish: the penalty loop turns off to the right, and its sign stands in the mouth of the turn.
  list.push(beside('penalty', COURSE_PATH, eastSideAt(JOIN.leave + BEFORE.penalty), SIGN_OFFSET));
  // Round the penalty loop's curves (each a half turn of PENALTY.radius), on the left: the outside of its right-hand turns.
  const half = PENALTY.radius * Math.PI;
  const curveStart = [0, half + (JOIN.back - JOIN.leave)];
  for (const c of CHEVRONS) list.push(beside('chevron', PENALTY_PATH, curveStart[c.curve] + half * c.at, -(PENALTY.halfWidth + 2.5)));
  return list;
})();
