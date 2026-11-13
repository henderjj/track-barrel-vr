import { describe, expect, it } from 'vitest';
import { decodeTankState, encodeTankState, TANK_STATE_BYTES, TANK_STATE_V4_BYTES } from '../src/net/tank-codec.js';
import { penaltySeconds } from '../src/sim/biathlon.js';
import {
  BRIDGE,
  BRIDGE_START,
  BYPASS_PATH,
  COURSE,
  CourseProgress,
  deckHeight,
  FAULT_SECONDS,
  goingAt,
  MUD,
  OBSTACLE_SPOTS,
  OBSTACLES as OBSTACLE_NAMES,
  samplePath,
  SLALOM_POSTS,
  westSideAt,
} from '../src/sim/course.js';
import {
  DROWN_SECONDS,
  GEAR_GRADE,
  GEAR_PUSH,
  groundPull,
  loadStrain,
  REFIT_SECONDS,
  spareShare,
  stepSink,
  stepStrain,
  THROW_LIMIT,
  THROW_SECONDS,
} from '../src/sim/going.js';
import { type CourseFeed, RangeRun } from '../src/sim/range-run.js';
import { coolantTarget, createControls, createTankDrive, settle, stepDrive, type TankDrive } from '../src/sim/tank-drive.js';
import { courseRelief, groundHeight, HILL, OBSTACLES, STREAM } from '../src/sim/terrain.js';

/**
 * The biathlon's driving challenge (F5.3d, docs/biathlon-driving.md): the
 * going's rules, the course's obstacles driven through by the drive model,
 * the course and race counting slalom faults and bridge falls, and the
 * going's state in the tank's packet.
 */

const DT = 1 / 45;

/** A tank parked at Practice → Obstacles' spot for `name`, and its controls (the automatic box unless `stick`). */
function parked(name: keyof typeof OBSTACLE_SPOTS, stick = false) {
  const p = OBSTACLE_SPOTS[name];
  const t = createTankDrive(p.x, p.z, p.heading);
  const c = createControls();
  if (stick) c.mode = 'stick';
  return { t, c };
}

/** Drive for up to `seconds`, stopping early once `until` holds. */
function drive(t: TankDrive, c: ReturnType<typeof createControls>, seconds: number, until: (t: TankDrive) => boolean = () => false, each?: (t: TankDrive) => void): number {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepDrive(t, c, DT, OBSTACLES);
    each?.(t);
    if (until(t)) return (i + 1) * DT;
  }
  return seconds;
}

describe('the going (src/sim/going.ts)', () => {
  it('lets each lower gear climb a steeper slope: the hill wants 2nd, not 3rd', () => {
    for (let g = 1; g < 5; g++) expect(GEAR_GRADE[g]).toBeGreaterThan(GEAR_GRADE[g + 1]);
    // The hill's steepest along the course's middle line, cell to cell as the ground joins its corners.
    let steepest = 0;
    for (let x = HILL.crest - HILL.half; x < HILL.crest + HILL.half; x += 16) {
      steepest = Math.max(steepest, Math.atan(Math.abs(groundHeight(x + 16, COURSE.north) - groundHeight(x, COURSE.north)) / 16));
    }
    expect(steepest).toBeLessThan(GEAR_GRADE[2]);
    expect(steepest).toBeGreaterThan(GEAR_GRADE[3]);
    expect(courseRelief(HILL.crest, COURSE.north)).toBeCloseTo(HILL.height, 5);
  });

  it("answers the ground's pull with the engine and brakes, and passes on what they can't", () => {
    // Flat and firm: nothing.
    expect(groundPull({ gravity: 0, drag: 0, speed: 3, drive: 1, push: 2, driving: true, hold: 0 })).toBeCloseTo(0, 9);
    // Climbing within the gear's push: answered; beyond it, the rest slows the tank.
    expect(groundPull({ gravity: -1, drag: 0, speed: 3, drive: 1, push: 2, driving: true, hold: 0 })).toBeCloseTo(0, 9);
    expect(groundPull({ gravity: -3, drag: 0, speed: 3, drive: 1, push: 2, driving: true, hold: 0 })).toBeCloseTo(-1, 6);
    // Running on downhill: the hold takes some, the rest speeds it up.
    expect(groundPull({ gravity: 2, drag: 0, speed: 3, drive: 1, push: 2, driving: true, hold: 0.5 })).toBeCloseTo(1.5, 6);
    // Standing in mud: the drag only resists starting off.
    expect(groundPull({ gravity: 0, drag: 1.6, speed: 0, drive: 1, push: 2, driving: true, hold: 0 })).toBeCloseTo(0, 9);
    // Driving through it: the drag is against the motion.
    expect(groundPull({ gravity: 0, drag: 1.6, speed: 2, drive: 1, push: 1, driving: false, hold: 0 })).toBeCloseTo(-1.6, 6);
    expect(spareShare(0, 2)).toBe(1);
    expect(spareShare(1, 2)).toBe(0.5);
    expect(spareShare(3, 2)).toBe(0);
    expect(loadStrain(0.3 * GEAR_PUSH[2], 2)).toBe(0);
    expect(loadStrain(GEAR_PUSH[2], 2)).toBe(1);
  });

  it('sinks a tank spun hard and slow in mud, frees it backing out, and lets it go out of the mud', () => {
    let sink = 0;
    for (let i = 0; i < 45 * 6; i++) sink = stepSink(sink, 1, 1, 0.5, true, DT);
    expect(sink).toBe(1);
    // Gentle on the throttle it doesn't dig in.
    expect(stepSink(0.5, 1, 0.4, 0.5, true, 1)).toBe(0.5);
    for (let i = 0; i < 45; i++) sink = stepSink(sink, 1, 0.5, -1, false, DT);
    expect(sink).toBeLessThan(1);
    expect(stepSink(0.8, 0, 1, 0.5, true, DT)).toBe(0);
  });

  it('throws a track only past the limit for a while, and eases off below it', () => {
    expect(stepStrain(0, THROW_LIMIT - 0.01, 1)).toBe(0);
    let strain = 0;
    let t = 0;
    while (strain < 1 && t < 10) {
      strain = stepStrain(strain, THROW_LIMIT + 0.4, DT);
      t += DT;
    }
    expect(t).toBeLessThan(THROW_SECONDS);
    expect(stepStrain(0.5, 0, 1)).toBeLessThan(0.5);
  });

  it('heats the engine more labouring against the ground (option 4)', () => {
    expect(coolantTarget(2000, 2, 1)).toBeGreaterThan(coolantTarget(2000, 2, 0));
    expect(coolantTarget(2000, 2, 0)).toBe(coolantTarget(2000, 2));
    expect(coolantTarget(2000, 2, 1)).toBeGreaterThan(coolantTarget(2000, 2, 0.5));
  });
});

describe("the course's obstacles, driven (F5.3d)", () => {
  it('has a Practice spot for each obstacle, on the course and firm', () => {
    expect(Object.keys(OBSTACLE_SPOTS).sort()).toEqual([...OBSTACLE_NAMES].sort());
    for (const p of Object.values(OBSTACLE_SPOTS)) expect(goingAt(p.x, p.z)).toBe(0);
  });

  it('climbs the hill with the automatic box changing down, and runs on down the far side', () => {
    const { t, c } = parked('hill');
    c.left = c.right = 1;
    let lowest = 5;
    let fastest = 0;
    let crested = false;
    const took = drive(t, c, 90, (s) => s.x < HILL.crest - HILL.half, (s) => {
      if (s.x > HILL.crest) lowest = Math.min(lowest, s.gear);
      if (s.x < HILL.crest) crested = true;
      if (crested) fastest = Math.max(fastest, s.speed);
    });
    expect(took).toBeLessThan(90);
    expect(lowest).toBeLessThanOrEqual(2);
    expect(t.running).toBe(true);
    // Down the far side it runs on past the flat's 3rd-gear speed.
    expect(fastest).toBeGreaterThan(3.99);
  });

  it('stalls or stops in 5th on the hill: the driver must change down', () => {
    const { t, c } = parked('hill', true);
    c.gear = 5;
    t.gear = 5;
    t.speed = 9;
    c.accel = 1;
    let slowest = Infinity;
    drive(t, c, 25, undefined, (s) => {
      if (s.x < HILL.crest + HILL.half - 10) slowest = Math.min(slowest, Math.abs(s.speed));
    });
    expect(t.x).toBeGreaterThan(HILL.crest);
    expect(slowest < 1 || !t.running).toBe(true);
  });

  it('bogs in the mud at full throttle, but crosses gently', () => {
    const full = parked('mud');
    full.c.left = full.c.right = 1;
    drive(full.t, full.c, 40, (s) => s.sink >= 1);
    expect(full.t.sink).toBe(1);
    expect(full.t.x).toBeGreaterThan(MUD.from);
    expect(full.t.x).toBeLessThan(MUD.to);
    // Bogged, it can't drive on.
    const at = full.t.x;
    drive(full.t, full.c, 5);
    expect(full.t.x - at).toBeLessThan(0.5);

    const gentle = parked('mud');
    gentle.c.left = gentle.c.right = 0.55;
    const took = drive(gentle.t, gentle.c, 60, (s) => s.x > MUD.to + 5);
    expect(took).toBeLessThan(60);
    expect(gentle.t.sink).toBeLessThan(1);
  });

  it("lays the bypass on firm ground all the way round the mud", () => {
    for (const p of samplePath(BYPASS_PATH, 0, BYPASS_PATH.length, 1)) expect(goingAt(p.x, p.z)).toBe(0);
  });

  it('drowns the engine taken through the ford too fast, and not at a crawl', () => {
    const fast = parked('ford');
    fast.c.left = fast.c.right = 1;
    drive(fast.t, fast.c, 30, (s) => !s.running);
    expect(fast.t.running).toBe(false);
    expect(fast.t.stallCause).toBe('water');
    expect(fast.t.starterRest).toBeGreaterThan(DROWN_SECONDS - 1);
    expect(Math.abs(fast.t.x - STREAM.x)).toBeLessThan(STREAM.half);

    const slow = parked('ford', true);
    slow.c.gear = 1;
    slow.c.accel = 1;
    const took = drive(slow.t, slow.c, 90, (s) => s.x > STREAM.x + STREAM.half);
    expect(took).toBeLessThan(90);
    expect(slow.t.running).toBe(true);
  });

  it('throws a track turning hard at speed in a corner, and holds the tank for the refit', () => {
    const t = createTankDrive(COURSE.east, -260, 0);
    const c = createControls();
    t.speed = 9.5;
    t.gear = 5;
    c.left = 0.4;
    c.right = 1;
    const took = drive(t, c, 6, (s) => s.thrown !== 0);
    expect(took).toBeLessThan(6);
    // Turning left, the right track comes off.
    expect(t.thrown).toBe(2);
    expect(t.refit).toBeCloseTo(REFIT_SECONDS, 0);
    // It rolls to a stop at the comfort limit's braking, and stays.
    drive(t, c, 10);
    expect(Math.abs(t.speed)).toBeLessThan(0.3);
    const at = [t.x, t.z];
    drive(t, c, REFIT_SECONDS - 14);
    expect(Math.hypot(t.x - at[0], t.z - at[1])).toBeLessThan(0.5);
    drive(t, c, 5);
    expect(t.thrown).toBe(0);
  });

  it('carries a tank lined up across the bridge, and drops one off line back to its start', () => {
    const { t, c } = parked('bridge');
    c.left = c.right = 0.3;
    let lowest = Infinity;
    const took = drive(t, c, 60, (s) => s.z > BRIDGE.z + BRIDGE.length / 2 + 4, (s) => {
      if (Math.abs(s.z - BRIDGE.z) < 10) lowest = Math.min(lowest, s.y);
    });
    expect(took).toBeLessThan(60);
    expect(t.falls).toBe(0);
    // Over the ditch the tank rides on the deck, not down in it.
    expect(lowest).toBeGreaterThan(groundHeight(BRIDGE.x, BRIDGE.z) + 1);
    expect(deckHeight(BRIDGE.x + BRIDGE.gauge, BRIDGE.z)).toBeCloseTo(BRIDGE.height, 6);

    const off = parked('bridge');
    off.t.x += 0.8;
    settle(off.t);
    off.c.left = off.c.right = 0.3;
    drive(off.t, off.c, 40, (s) => s.falls > 0);
    expect(off.t.falls).toBe(1);
    expect(off.t.x).toBeCloseTo(BRIDGE_START.x, 3);
    expect(off.t.z).toBeCloseTo(BRIDGE_START.z, 3);
    expect(off.t.speed).toBe(0);
  });
});

describe('slalom faults and bridge falls on the course and in the race (F5.3d)', () => {
  /** Drive the course's progress straight along the north side's middle line, west, from x0 to x1. */
  function straightThrough(p: CourseProgress, x0: number, x1: number, z: number): void {
    for (let x = x0; x >= x1; x -= 0.25) p.step(DT, x, z, 5, Math.PI / 2, 0);
  }

  it("counts a knocked post and a gate passed outside as faults, and the course's events carry them", () => {
    const p = new CourseProgress();
    // Down the middle line the tank clips a post of each gate set towards it.
    straightThrough(p, 290, 190, COURSE.north);
    expect(p.s.faults).toBeGreaterThan(0);
    expect(p.s.knocked).not.toBe(0);
    expect(p.s.note).toMatch(/Slalom/);
    // Clean: weaving through each gate's middle.
    const clean = new CourseProgress();
    // Held on each gate's middle while any of the hull is level with its posts, and straight from one to the next between.
    const keys: [number, number][] = [[300, COURSE.north]];
    for (let k = 0; k < SLALOM_POSTS.length; k += 2) {
      const gx = SLALOM_POSTS[k][0];
      const mid = (SLALOM_POSTS[k][1] + SLALOM_POSTS[k + 1][1]) / 2;
      keys.push([gx + 5, mid], [gx - 5, mid]);
    }
    keys.push([180, COURSE.north]);
    for (let x = 290; x >= 190; x -= 0.25) {
      let k = 0;
      while (keys[k + 1][0] > x) k++;
      const [x0, z0] = keys[k];
      const [x1, z1] = keys[k + 1];
      const z = z0 + ((z1 - z0) * (x0 - x)) / (x0 - x1);
      clean.step(DT, x, z, 3, Math.PI / 2, 0);
    }
    expect(clean.s.faults).toBe(0);
    expect(clean.s.knocked).toBe(0);
  });

  it('counts a fall off the bridge when the tank comes back to its start, not as a jump', () => {
    const p = new CourseProgress();
    const z0 = BRIDGE.z - 30;
    for (let z = z0; z < BRIDGE.z; z += 0.2) p.step(DT, BRIDGE.x, z, 3, Math.PI, 0);
    p.step(DT, BRIDGE_START.x, BRIDGE_START.z, 0, Math.PI, 1);
    expect(p.s.falls).toBe(1);
    expect(p.s.note).toMatch(/bridge/);
    expect(westSideAt(BRIDGE_START.z)).toBeLessThan(westSideAt(BRIDGE.z));
  });

  it("adds FAULT_SECONDS a fault to a race's time", () => {
    const r = new RangeRun();
    const c: CourseFeed = { laps: 0, missed: 0, penalties: 0, box: -1, halted: false, faults: 0 };
    r.start('biathlon');
    for (let i = 0; i < 45 * 6; i++) {
      r.course(c);
      r.step(DT);
    }
    c.faults = 2;
    r.course(c);
    expect(r.s.faults).toBe(2);
    expect(penaltySeconds(r.s)).toBe(2 * FAULT_SECONDS);
  });
});

describe("the course's drawn going (F5.3d)", () => {
  it('lays every track on the ground at its lift, over the hill and through the ford too', async () => {
    const { trackParts } = await import('../src/scene-assets/course.scene-asset.js');
    let lowest = Infinity;
    let highest = -Infinity;
    for (const { part } of trackParts()) {
      const p = part.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) {
        // Each triangle's corners' and edges' middles and its centre, against the ground there.
        for (const w of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
          let x = 0;
          let y = 0;
          let z = 0;
          for (let k = 0; k < 3; k++) {
            x += w[k] * p.getX(i + k);
            y += w[k] * p.getY(i + k);
            z += w[k] * p.getZ(i + k);
          }
          const lift = y - groundHeight(x, z);
          lowest = Math.min(lowest, lift);
          highest = Math.max(highest, lift);
        }
      }
    }
    // The bypass's 2 cm to the gravel's 3 cm, nothing sunk into the ground or standing off it.
    expect(lowest).toBeGreaterThan(0.0195);
    expect(highest).toBeLessThan(0.0305);
  });
});

describe("the going in the tank's packet (F5.3d)", () => {
  it('round-trips the sink, the sideways push, a thrown track and its refit, and reads an older packet as none', () => {
    const s = Object.assign(createTankDrive(), { sink: 0.6, side: 1.7, thrown: 2 as const, refit: 33.2 });
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    expect(encodeTankState(buffer, 1, 10, s, createControls())).toBe(TANK_STATE_BYTES);
    const out = createTankDrive();
    expect(decodeTankState(new DataView(buffer), { seq: 0, timeMs: 0 }, out)).toBe(true);
    expect(out.sink).toBeCloseTo(0.6, 2);
    expect(out.side).toBeCloseTo(1.7, 1);
    expect(out.thrown).toBe(2);
    expect(out.refit).toBe(34);
    const old = Object.assign(createTankDrive(), { sink: 1, thrown: 1 });
    expect(decodeTankState(new DataView(buffer, 0, TANK_STATE_V4_BYTES), { seq: 0, timeMs: 0 }, old)).toBe(true);
    expect(old.sink).toBe(0);
    expect(old.thrown).toBe(0);
    expect(old.refit).toBe(0);
  });
});
