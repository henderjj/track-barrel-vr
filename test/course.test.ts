import { describe, expect, it } from 'vitest';
import { ENEMY_COUNT, ENEMY_GUNS } from '../src/sim/enemy-guns.js';
import { ENEMY_TANKS } from '../src/sim/enemy-tanks.js';
import {
  aimAt,
  COURSE_TARGET_FIRST,
  createShotResult,
  describeShot,
  flyShell,
  type HitFace,
  hullDirToWorld,
  SCATTER,
  scatterDir,
  syncCourseFaces,
  hullToWorld,
  TARGET_NAMES,
  targetFaces,
} from '../src/sim/ballistics.js';
import {
  ALL_GATES,
  BOX_Z,
  BRIDGE,
  BRIDGE_GATE,
  BRIDGE_SPAN,
  BYPASS,
  SLALOM_GATES,
  southSideAt,
  boxAt,
  boxSpot,
  COURSE,
  COURSE_BOARD,
  COURSE_PATH,
  COURSE_START,
  COURSE_TARGETS,
  courseEvent,
  courseLine,
  CourseProgress,
  createCourseSnapshot,
  eastSideAt,
  FINISH_Z,
  FIRING_BOX,
  firstMissing,
  GATES,
  JOIN,
  boardsVersion,
  clampLineRange,
  courseBoardMiddle,
  LINE_RANGE_SPAN,
  LINE_RANGE_STEP,
  LINE_RANGES,
  lineRanges,
  onCourse,
  pickLineRanges,
  setLineRanges,
  PENALTY,
  PENALTY_GATE,
  PENALTY_OWN,
  PENALTY_PATH,
  type PathPoint,
  readCourseEvent,
  samplePath,
  throughGate,
} from '../src/sim/course.js';
import { RANGE_TARGETS, sightLimit, targetFoot } from '../src/sim/range.js';
import { SIGHT_STAND, TRUE_HALF_FIELD } from '../src/sim/sight.js';
import { MAX_YAW_RATE } from '../src/sim/comfort.js';
import { createTankDrive, FOOTPRINT } from '../src/sim/tank-drive.js';
import { CELL, COURSE_FIELD, courseRelief, groundHeight, HILL, LANE_HALF, obstacleDistance, OBSTACLES, outsideCourseField, outsideFiringLanes, roughness, TILE, wrapTile } from '../src/sim/terrain.js';
import { barrelDirection, muzzlePoint } from '../src/sim/turret.js';

const DEG = Math.PI / 180;

/** Drive a tank's middle along `points`, a metre at a time, into `progress`, standing still `stand` s at the end. */
function driveAlong(progress: CourseProgress, points: readonly PathPoint[], speed = 5): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let k = 1; k <= steps; k++) progress.step(1 / speed, a.x + ((b.x - a.x) * k) / steps, a.z + ((b.z - a.z) * k) / steps, speed);
  }
}

/** The course's middle line from `from` to `to` m along it (past the finish wraps round). */
const along = (from: number, to: number) => samplePath(COURSE_PATH, from, to, 2);

describe('biathlon course (F5.3a)', () => {
  it('is a loop of about 800 m that closes on itself, with a penalty loop of about 150 m', () => {
    expect(COURSE_PATH.length).toBeGreaterThan(780);
    expect(COURSE_PATH.length).toBeLessThan(830);
    const start = COURSE_PATH.at(0);
    const end = COURSE_PATH.at(COURSE_PATH.length - 1e-9);
    expect(end.x).toBeCloseTo(start.x, 6);
    expect(end.z).toBeCloseTo(start.z, 6);
    expect(start.z).toBe(FINISH_Z);
    expect(PENALTY_PATH.length).toBeGreaterThan(140);
    expect(PENALTY_PATH.length).toBeLessThan(170);
    // The penalty loop leaves the course and comes back onto it on the east side, north of the boxes.
    const leave = PENALTY_PATH.at(0);
    const back = PENALTY_PATH.at(PENALTY_OWN);
    expect([leave.x, leave.z]).toEqual([COURSE.east, JOIN.leave]);
    expect(back.x).toBeCloseTo(COURSE.east, 6);
    expect(back.z).toBeCloseTo(JOIN.back, 6);
    expect(JOIN.back).toBeLessThan(Math.min(...BOX_Z) - FIRING_BOX.length / 2);
    expect(FINISH_Z).toBeLessThan(JOIN.leave);
    // A tank can take its curves at the crewmate's speeds inside the comfort cap on turning.
    expect((20 / 3.6) / COURSE.radius).toBeLessThan(MAX_YAW_RATE);
    expect((16 / 3.6) / COURSE.tight).toBeLessThan(MAX_YAW_RATE);
    expect((12 / 3.6) / PENALTY.radius).toBeLessThan(MAX_YAW_RATE);
  });

  it('lies on flat, clear ground of its own east of the range, off the roads and out of the range\'s line of fire', () => {
    for (const p of [...along(0, COURSE_PATH.length), ...samplePath(PENALTY_PATH, 0, PENALTY_OWN, 2)]) {
      // Flat but for the driving challenge's hill, ditch and stream (F5.3d), where they are shaped into the ground's corners.
      const cx = Math.floor(p.x / CELL) * CELL;
      const cz = Math.floor(p.z / CELL) * CELL;
      const shaped = [[0, 0], [CELL, 0], [0, CELL], [CELL, CELL]].some(([dx, dz]) => courseRelief(cx + dx, cz + dz) !== 0);
      if (!shaped) expect(groundHeight(p.x, p.z)).toBe(0);
      expect(outsideCourseField(p.x, p.z)).toBe(0);
      // Off the range's lane and its cross road, and clear of every obstacle.
      expect(p.x).toBeGreaterThan(LANE_HALF + 30);
      expect(p.z).toBeLessThan(-60);
      const n: [number, number] = [0, 0];
      for (const o of OBSTACLES) expect(obstacleDistance(o, p.x, p.z, n)).toBeGreaterThan(COURSE.halfWidth + FOOTPRINT.halfWidth);
      expect(onCourse(p.x, p.z)).toBe(true);
      // From the range's start the gunsight, looking up the range, never sees it.
      expect(Math.abs(Math.atan2(p.x - SIGHT_STAND.x, SIGHT_STAND.z - p.z))).toBeGreaterThan(TRUE_HALF_FIELD * 1.5);
    }
    expect(onCourse(0, -100)).toBe(false);
    expect(onCourse(200, -190)).toBe(false);
    // The field is flat inside and rolls again outside it.
    expect(roughness(200, -200)).toBe(0);
    expect(roughness(COURSE_FIELD.east + COURSE_FIELD.blend + 5, -200)).toBeGreaterThan(0.9);
  });

  it('has a gate about every 80 m round to the south side, the finish line first, one on the hill and one past the bridge, and one on the penalty loop', () => {
    expect(GATES.length).toBe(7);
    expect(GATES[0].s).toBe(0);
    expect(GATES[0].z).toBe(FINISH_Z);
    for (let i = 1; i < GATES.length; i++) {
      expect(GATES[i].s - GATES[i - 1].s).toBeGreaterThan(60);
      expect(GATES[i].s - GATES[i - 1].s).toBeLessThan(170);
    }
    // None among the firing boxes, so a halt there never stands in a gate.
    for (const g of GATES.slice(1)) expect(g.s).toBeLessThan(eastSideAt(COURSE.south - COURSE.radius));
    // None in the slalom, on the bridge or where the bypass leaves the course, so a lap can take the mud or the bypass.
    for (const g of GATES) {
      expect(g.s < SLALOM_GATES[0].s - 10 || g.s > SLALOM_GATES[SLALOM_GATES.length - 1].s + 10).toBe(true);
      expect(g.s < BRIDGE_SPAN[0] || g.s > BRIDGE_SPAN[1]).toBe(true);
      expect(g.s < southSideAt(BYPASS.from) || g.s > southSideAt(BYPASS.to)).toBe(true);
    }
    // One on the hill's crest, and one just past the bridge, as narrow as the bridge.
    expect(GATES.some((g) => Math.abs(g.x - HILL.crest) < 1e-6 && Math.abs(g.z - COURSE.north) < 1e-6)).toBe(true);
    const bridge = GATES[BRIDGE_GATE];
    expect(bridge.s - BRIDGE_SPAN[1]).toBeGreaterThan(0);
    expect(bridge.s - BRIDGE_SPAN[1]).toBeLessThan(5);
    expect(bridge.half).toBeGreaterThan(BRIDGE.gauge + BRIDGE.tread / 2);
    expect(bridge.half).toBeLessThan(3);
    expect(ALL_GATES).toBe(0b1111110);
    expect(PENALTY_GATE.x).toBeCloseTo(COURSE.east + 2 * PENALTY.radius, 6);
    expect(Math.abs(Math.cos(PENALTY_GATE.heading) + 1)).toBeLessThan(1e-9);
  });

  it('tells a pass through a gate forwards from one backwards or round it', () => {
    const g = GATES[0];
    expect(throughGate(g, g.x, g.z + 1, g.x, g.z - 1)).toBe(1);
    expect(throughGate(g, g.x + 3, g.z - 1, g.x + 3, g.z + 1)).toBe(-1);
    expect(throughGate(g, g.x + g.half + 1, g.z + 1, g.x + g.half + 1, g.z - 1)).toBe(0);
    expect(throughGate(g, g.x, g.z + 3, g.x, g.z + 1)).toBe(0);
    // The same gate a tile away.
    expect(throughGate(g, g.x + 800, g.z - 799, g.x + 800, g.z - 801)).toBe(1);
  });

  it('marks out two firing boxes on the east side, the tank\'s middle inside one counting as in it', () => {
    expect(BOX_Z.length).toBe(2);
    BOX_Z.forEach((z, k) => {
      const [x, bz, heading] = boxSpot(k);
      expect([x, bz, heading]).toEqual([COURSE.east, z, 0]);
      expect(boxAt(x, z)).toBe(k);
      expect(boxAt(x + FIRING_BOX.width / 2 + 0.1, z)).toBe(-1);
      expect(boxAt(x, z + FIRING_BOX.length / 2 + 0.1)).toBe(-1);
      // On the straight, clear of the corner and the penalty loop.
      expect(z).toBeLessThan(COURSE.south - COURSE.radius - FIRING_BOX.length / 2);
      // The tank fits in it.
      expect(FIRING_BOX.length).toBeGreaterThan(FOOTPRINT.rear - FOOTPRINT.front);
    });
    expect(Math.abs(BOX_Z[0] - BOX_Z[1])).toBeGreaterThanOrEqual(FIRING_BOX.length + 4);
  });

  /** Every pair of ranges a race can pick: each line's span in its steps. */
  const RANGE_PAIRS: number[][] = [];
  for (let a = LINE_RANGE_SPAN[0][0]; a <= LINE_RANGE_SPAN[0][1]; a += 50) {
    for (let b = LINE_RANGE_SPAN[1][0]; b <= LINE_RANGE_SPAN[1][1]; b += 50) RANGE_PAIRS.push([a, b]);
  }

  it('stands three boards per firing line down its lane south of the box, square to it, all three in the sight at once, at every range a race picks', () => {
    expect(COURSE_TARGETS.length).toBe(6);
    expect(lineRanges()).toEqual(LINE_RANGES);
    for (const ranges of [...RANGE_PAIRS, LINE_RANGES]) {
      setLineRanges(ranges);
      COURSE_TARGETS.forEach((t) => {
        const [bx, bz] = boxSpot(t.line);
        expect(t.range).toBe(ranges[t.line]);
        expect(Math.hypot(t.x - bx, t.z - bz)).toBeGreaterThanOrEqual(t.range - 0.01);
        expect(Math.hypot(t.x - bx, t.z - bz)).toBeLessThan(t.range + 1);
        // South of the course, on the flat lane, inside the tile, clear of obstacles.
        expect(t.z).toBeGreaterThan(COURSE_FIELD.south + 100);
        expect(t.z).toBeLessThan(TILE / 2 - 10);
        expect(outsideFiringLanes(t.x, t.z)).toBe(0);
        expect(Math.abs(groundHeight(t.x, t.z))).toBeLessThan(0.02);
        const n: [number, number] = [0, 0];
        for (const o of OBSTACLES) expect(obstacleDistance(o, t.x, t.z, n)).toBeGreaterThan(5);
        // Facing its box: the face's normal points back at it.
        expect(Math.sin(t.yaw) * (bx - t.x) + Math.cos(t.yaw) * (bz - t.z)).toBeCloseTo(Math.hypot(bx - t.x, bz - t.z), 6);
        // Seen from its box, within the sight's field round the middle board.
        const middle = COURSE_TARGETS[t.line * 3 + 1];
        const off = Math.atan2(t.x - bx, t.z - bz) - Math.atan2(middle.x - bx, middle.z - bz);
        expect(Math.abs(off)).toBeLessThan(TRUE_HALF_FIELD * 0.9);
        // Short of the fog's far edge, and nothing on the ground hides its disc from the turret.
        expect(t.range).toBeLessThan(sightLimit());
        const eye = 2.4;
        const disc = courseBoardMiddle() - COURSE_BOARD.disc / 2;
        for (let d = 5; d < t.range; d += 4) {
          const x = bx + ((t.x - bx) * d) / t.range;
          const z = bz + ((t.z - bz) * d) / t.range;
          expect(eye + ((disc - eye) * d) / t.range - groundHeight(x, z)).toBeGreaterThan(0.3);
        }
      });
    }
    setLineRanges(LINE_RANGES);
    expect(COURSE_TARGETS.map((t) => t.name)).toContain('the line 2 right board');
    // The disc is what counts, and it fits on the board.
    expect(COURSE_BOARD.hitRadius).toBe(COURSE_BOARD.disc / 2);
    expect(COURSE_BOARD.disc).toBeLessThan(COURSE_BOARD.width / 2);
  });

  it('picks each race\'s ranges within its line\'s span in whole tens, and moves the boards only when they change', () => {
    setLineRanges(LINE_RANGES);
    expect(pickLineRanges(() => 0)).toEqual([LINE_RANGE_SPAN[0][0], LINE_RANGE_SPAN[1][0]]);
    expect(pickLineRanges(() => 0.999999)).toEqual([LINE_RANGE_SPAN[0][1], LINE_RANGE_SPAN[1][1]]);
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const r = pickLineRanges(random);
      r.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(LINE_RANGE_SPAN[k][0]);
        expect(v).toBeLessThanOrEqual(LINE_RANGE_SPAN[k][1]);
        expect(v % LINE_RANGE_STEP).toBe(0);
      });
      seen.add(r[0]);
    }
    expect(seen.size).toBe((LINE_RANGE_SPAN[0][1] - LINE_RANGE_SPAN[0][0]) / LINE_RANGE_STEP + 1);
    expect(clampLineRange(0, 1000)).toBe(LINE_RANGE_SPAN[0][1]);
    expect(clampLineRange(1, 'x')).toBe(LINE_RANGES[1]);
    expect(clampLineRange(0, 377)).toBe(380);
    const v = boardsVersion();
    expect(setLineRanges(LINE_RANGES)).toBe(false);
    expect(boardsVersion()).toBe(v);
    expect(setLineRanges([360, 530])).toBe(true);
    expect(boardsVersion()).toBe(v + 1);
    expect(lineRanges()).toEqual([360, 530]);
    // The shells' faces follow.
    const faces = targetFaces();
    setLineRanges(LINE_RANGES);
    expect(syncCourseFaces(faces, v + 1)).toBe(v + 2);
    expect(faces[COURSE_TARGET_FIRST].x).toBeCloseTo(COURSE_TARGETS[0].x, 9);
    expect(faces[COURSE_TARGET_FIRST].z).toBeCloseTo(COURSE_TARGETS[0].z, 9);
  });

  it('keeps each line\'s shots clear of the other line\'s boards, the range\'s targets and the enemies, at every range a race picks', () => {
    const guns = ENEMY_GUNS.map((g) => [g.x, g.z]);
    const routes = ENEMY_TANKS.flatMap((t) => t.points);
    for (const ranges of RANGE_PAIRS) {
      setLineRanges(ranges);
      COURSE_TARGETS.forEach((t) => {
        const [bx, bz] = boxSpot(t.line);
        const ux = (t.x - bx) / t.range;
        const uz = (t.z - bz) / t.range;
        // How far a point (its nearest copy) stands from this shot's line, out to 700 m.
        const offLine = (px: number, pz: number) => {
          const x = bx + wrapTile(px - bx);
          const z = bz + wrapTile(pz - bz);
          const a = (x - bx) * ux + (z - bz) * uz;
          return a < 0 || a > 700 ? Infinity : Math.abs((x - bx) * uz - (z - bz) * ux);
        };
        for (const other of COURSE_TARGETS) if (other.line !== t.line) expect(offLine(other.x, other.z)).toBeGreaterThan(8);
        RANGE_TARGETS.forEach((_, i) => {
          const [x, z] = targetFoot(i);
          expect(offLine(x, z)).toBeGreaterThan(20);
        });
        for (const [x, z] of guns) expect(offLine(x, z)).toBeGreaterThan(20);
        // The enemy tanks' routes, sampled every 10 m.
        for (let k = 0; k + 1 < routes.length; k += 2) {
          const [ax, az] = routes[k];
          const [cx, cz] = routes[k + 1];
          for (let f = 0; f <= 1; f += 10 / Math.hypot(cx - ax, cz - az)) expect(offLine(ax + (cx - ax) * f, az + (cz - az) * f)).toBeGreaterThan(20);
        }
      });
    }
    setLineRanges(LINE_RANGES);
  });

  it('lets the gun, laid from each box, hit each of its line\'s boards on its black disc; a shell through the white misses', () => {
    for (const ranges of [LINE_RANGES, [LINE_RANGE_SPAN[0][1], LINE_RANGE_SPAN[1][1]]]) {
      setLineRanges(ranges);
      const faces = targetFaces();
      // Then the enemy guns (F3.2), off until their battery starts.
      expect(faces.length).toBe(RANGE_TARGETS.length + COURSE_TARGETS.length + ENEMY_COUNT);
      expect(TARGET_NAMES.length).toBe(faces.length);
      COURSE_TARGETS.forEach((t, j) => {
        const [x, z, heading] = boxSpot(t.line);
        const tank = createTankDrive(x, z, heading);
        const i = COURSE_TARGET_FIRST + j;
        expect(faces[i].round).toBe(true);
        const fire = (face: HitFace, up = 0) => {
          const { yaw, elevation } = aimAt(tank, face, muzzlePoint);
          const origin = hullToWorld(tank, muzzlePoint(yaw, elevation + up, [0, 0, 0]), [0, 0, 0]);
          const d = hullDirToWorld(tank, barrelDirection(yaw, elevation + up, [0, 0, 0]), [0, 0, 0]);
          return { yaw, origin, d, result: flyShell(origin, d, faces, createShotResult()) };
        };
        const { yaw, origin, d, result } = fire(faces[i]);
        // The lane is behind the box: the turret turns to 6 o'clock.
        expect(Math.abs(yaw)).toBeGreaterThan(170 * DEG);
        expect(result.kind, t.name).toBe('target');
        expect(result.target).toBe(i);
        expect(describeShot(result, origin, d, faces, TARGET_NAMES)).toBe(`Hit: ${t.name}`);
        // Laid on the white, at the disc's corner square (inside the old square hit box, outside the disc): a miss.
        const corner = 0.36;
        const white = fire({ ...faces[i], x: faces[i].x + Math.cos(faces[i].yaw) * corner, y: faces[i].y + corner, z: faces[i].z - Math.sin(faces[i].yaw) * corner });
        expect(white.result.kind).not.toBe('target');
        // Laid a little high, it goes over the board and the miss names it.
        const high = fire(faces[i], 0.3 * DEG);
        expect(high.result.kind).not.toBe('target');
        expect(describeShot(high.result, high.origin, high.d, faces, TARGET_NAMES)).toMatch(new RegExp(`^Miss ${t.name}: \\d+ m over`));
      });
    }
    setLineRanges(LINE_RANGES);
  });

  it('scatters the gun\'s shots about the bore, 0.3 mil each way, and none the same', () => {
    const dir: [number, number, number] = [0.3, 0.05, -0.95];
    const l = Math.hypot(...dir);
    for (let k = 0; k < 3; k++) dir[k] /= l;
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 4000;
    let across = 0;
    let up = 0;
    let across2 = 0;
    let up2 = 0;
    const out: [number, number, number] = [0, 0, 0];
    const h = Math.hypot(dir[0], dir[2]);
    for (let i = 0; i < n; i++) {
      scatterDir(dir, 1 - random(), random(), SCATTER, out);
      expect(Math.hypot(...out)).toBeCloseTo(1, 12);
      // Off the bore: across (horizontal) and up.
      const a = (out[0] * -dir[2] + out[2] * dir[0]) / h;
      const u = out[1] * h - (out[0] * dir[0] + out[2] * dir[2]) * (dir[1] / h);
      across += a;
      up += u;
      across2 += a * a;
      up2 += u * u;
    }
    expect(Math.abs(across / n)).toBeLessThan(SCATTER / 10);
    expect(Math.abs(up / n)).toBeLessThan(SCATTER / 10);
    expect(Math.sqrt(across2 / n)).toBeCloseTo(SCATTER, 4);
    expect(Math.sqrt(up2 / n)).toBeCloseTo(SCATTER, 4);
    // No scatter: the bore's line.
    scatterDir(dir, 0.5, 0.25, 0, out);
    for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(dir[k], 12);
  });

  it('counts a lap from the start line round every gate and back, with its time', () => {
    const progress = new CourseProgress();
    const start = COURSE_PATH.at(-10);
    progress.step(0, start.x, start.z, 0);
    expect(progress.s.started).toBe(false);
    expect(courseLine(progress.s)).toMatch(/^Cross the start line/);
    driveAlong(progress, along(-10, 5));
    expect(progress.s.started).toBe(true);
    expect(progress.s.note).toBe('Lap 1: go!');
    driveAlong(progress, along(5, 390));
    expect(progress.s.passed).toBe(0b1110);
    expect(courseLine(progress.s)).toMatch(/^Lap 1 \d:\d\d\.\d: gates 3 of 6\. Laps done 0\./);
    driveAlong(progress, along(390, COURSE_PATH.length + 5));
    expect(progress.s.laps).toBe(1);
    expect(progress.s.missed).toBe(0);
    expect(progress.s.lastLap).toBeGreaterThan(150);
    expect(progress.s.bestLap).toBe(progress.s.lastLap);
    expect(progress.s.note).toMatch(/^Lap 1 in \d:\d\d\.\d$/);
    expect(progress.s.passed).toBe(0);
  });

  it('does not count a lap that misses a gate, and says so at the next one', () => {
    const progress = new CourseProgress();
    const points = along(-10, COURSE_PATH.length + 5);
    // Round gate 3 on the outside: 10 m wide of it for a stretch either side.
    const g3 = GATES[3].s;
    for (const p of points) {
      const s = p.s - 0;
      if (s > g3 - 6 && s < g3 + 6) {
        p.x += -Math.cos(p.heading) * -12;
        p.z += Math.sin(p.heading) * -12;
      }
    }
    driveAlong(progress, points);
    expect(progress.s.laps).toBe(0);
    expect(progress.s.missed).toBe(1);
    expect(progress.s.note).toBe('Lap not counted: missed gate 3');
    expect(firstMissing(0b11110110)).toBe(3);
  });

  it('counts each penalty loop, and the box the tank halts in', () => {
    const progress = new CourseProgress();
    const box = COURSE_PATH.at(eastSideAt(BOX_Z[1]));
    progress.step(0, box.x, box.z + 8, 3);
    driveAlong(progress, [COURSE_PATH.at(eastSideAt(BOX_Z[1] + 8)), box], 3);
    expect(progress.s.box).toBe(1);
    expect(progress.s.halted).toBe(false);
    progress.step(0.1, box.x, box.z, 0);
    expect(progress.s.halted).toBe(true);
    expect(progress.s.note).toBe("Halted in firing box 2: boards at 6 o'clock");
    expect(courseLine(progress.s)).toContain('In firing box 2, halted.');
    // Up to the penalty loop, twice round it, and on to the finish.
    driveAlong(progress, along(eastSideAt(BOX_Z[1]), eastSideAt(JOIN.leave)));
    for (let k = 0; k < 2; k++) driveAlong(progress, samplePath(PENALTY_PATH, 0, PENALTY_PATH.length, 2));
    expect(progress.s.penalties).toBe(2);
    expect(progress.s.box).toBe(-1);
    expect(progress.s.note).toBe('Penalty loop 2');
  });

  it('starts again after a jump (a Practice shortcut), keeping the best lap', () => {
    const progress = new CourseProgress();
    driveAlong(progress, along(-10, COURSE_PATH.length + 5));
    expect(progress.s.laps).toBe(1);
    const best = progress.s.bestLap;
    progress.step(0, COURSE_START.x, COURSE_START.z + 100, 0);
    expect(progress.s.laps).toBe(0);
    expect(progress.s.started).toBe(false);
    expect(progress.s.bestLap).toBe(best);
    // Practice parks the tank short of the start line, facing it.
    expect(COURSE_START.z).toBeGreaterThan(FINISH_Z);
    expect(COURSE_START.z).toBeLessThan(JOIN.leave);
  });

  it('sends the host\'s progress as a `course` event the guest reads back, and ignores a bad one', () => {
    const progress = new CourseProgress();
    driveAlong(progress, along(-10, 300));
    const e = JSON.parse(JSON.stringify(courseEvent(progress.s, 1234))) as Record<string, unknown>;
    expect(e.t).toBe('course');
    const out = createCourseSnapshot();
    expect(readCourseEvent(e, out)).toEqual({ at: 1234 });
    expect(out).toEqual(progress.s);
    expect(readCourseEvent({ ...e, laps: 'two' }, createCourseSnapshot())).toBeNull();
    const guest = new CourseProgress();
    guest.apply(out, 0.5);
    expect(guest.s.lapClock).toBeCloseTo(progress.s.lapClock + 0.5, 9);
  });
});
