import { describe, expect, it } from 'vitest';
import {
  debriefLines,
  DEFAULT_TUNING,
  defaultTuning,
  INSTANT_SPOTTING,
  noScenario,
  parseScenario,
  parseTuning,
  SCENARIO,
  ScenarioRun,
  type ScenarioInput,
  scenarioLine,
  setTune,
  SPOTTING,
  type SpotSituation,
  spotRate,
  spotTime,
  TUNE_ROWS,
  tuningLine,
} from '../src/sim/combat.js';
import { DAMAGE, freshDamage, applyHit, resolveDamage } from '../src/sim/damage.js';
import {
  ENEMY_GUN,
  ENEMY_GUNS,
  EnemyBattery,
  type EnemyShot,
  FIRST_TANK,
  groundBlocks,
  HULL_SIGHT,
  obstaclesBlock,
  resolveShot,
  TANK_SILHOUETTE,
  type TankTarget,
} from '../src/sim/enemy-guns.js';
import { ENEMY_TANKS } from '../src/sim/enemy-tanks.js';
import { rng } from '../src/sim/random.js';
import { markerFoot, MARKER_RANGES, RANGE_TARGETS, targetFoot } from '../src/sim/range.js';
import { groundHeight, LANE_HALF, LANE_WALLS, obstacleDistance, OBSTACLES, outsideCourseField } from '../src/sim/terrain.js';

/** The tank on the lane at z, facing up it, moving at `speed`. */
function onLane(z: number, speed = 0): TankTarget {
  return { x: 0, ground: groundHeight(0, z), z, heading: 0, speed };
}

const seeAll = () => true;

/** Step a battery `seconds` with the tank where it is; every shot fired. */
function run(b: EnemyBattery, tank: TankTarget, seconds: number, clear = seeAll, dt = 1 / 30): EnemyShot[] {
  const all: EnemyShot[] = [];
  const out: EnemyShot[] = [];
  for (let t = 0; t < seconds; t += dt) {
    b.step(dt, tank, clear, out);
    all.push(...out);
  }
  return all;
}

/** Only gun A in the fight. */
function gunA(tuning = DEFAULT_TUNING): EnemyBattery {
  const b = new EnemyBattery(3, tuning);
  b.start(3);
  b.kill(1);
  b.kill(2);
  return b;
}

/** Up the lane past the first wall, where gun A sees the whole tank. */
const OPEN_Z = -150;

const open: SpotSituation = { range: 300, view: 'full', moving: false, fired: false, alert: false, driving: false };

describe('the fight\'s tuning (F3.10)', () => {
  it('starts at the recommended values, each one of its row\'s choices', () => {
    for (const row of TUNE_ROWS) {
      expect(row.options.some(([v]) => v === DEFAULT_TUNING[row.key]), row.key).toBe(true);
      expect(row.options.length).toBeLessThanOrEqual(4);
    }
    expect(DEFAULT_TUNING.knockOut).toBe(DAMAGE.knockOut);
    expect(tuningLine(DEFAULT_TUNING)).toBe('Recommended tuning');
  });

  it('takes only a row\'s choices, and reads back what it sent or kept', () => {
    const t = defaultTuning();
    expect(setTune(t, 'aim', 1.4)).toBe(true);
    expect(setTune(t, 'aim', 1.3)).toBe(false);
    expect(setTune(t, 'knockOut', 5)).toBe(true);
    expect(t.aim).toBe(1.4);
    expect(tuningLine(t)).toBe('Tuned: enemy accuracy low, knocked out after 5 through');
    expect(parseTuning(JSON.parse(JSON.stringify(t)))).toEqual(t);
    // A value that isn't a choice falls back to the recommended; a broken one is refused.
    expect(parseTuning({ aim: 3, spot: 0 })).toEqual({ ...DEFAULT_TUNING, spot: 0 });
    expect(parseTuning(null)).toBeNull();
  });
});

describe('spotting (F3.10)', () => {
  it('takes about 10 s for a still tank in the open at 300 m, longer the further, never under the fastest', () => {
    expect(spotTime(open)).toBeCloseTo(SPOTTING.seconds, 5);
    expect(spotTime({ ...open, range: 600 })).toBeCloseTo(4 * SPOTTING.seconds, 5);
    expect(spotTime({ ...open, range: 30 })).toBeCloseTo(SPOTTING.fastest, 5);
  });

  it('is quicker on a moving tank, much quicker just after it fires, slower hull down, and nothing out of sight', () => {
    expect(spotTime({ ...open, moving: true })).toBeCloseTo(SPOTTING.seconds / SPOTTING.moving, 5);
    expect(spotTime({ ...open, fired: true })).toBeLessThan(2);
    expect(spotTime({ ...open, view: 'turret' })).toBeGreaterThan(25);
    expect(spotTime({ ...open, alert: true })).toBeLessThan(spotTime(open));
    expect(spotTime({ ...open, driving: true })).toBeGreaterThan(spotTime(open));
    expect(spotRate({ ...open, view: 'none' }, 1)).toBe(0);
    // The spotting level scales it; Instant spots at once.
    expect(spotTime(open, 0.6)).toBeGreaterThan(spotTime(open, 1));
    expect(spotTime(open, 0)).toBe(0);
  });

  it('holds a gun\'s fire until it has spotted the tank, then lays and fires', () => {
    const b = gunA();
    const tank = onLane(OPEN_Z);
    expect(b.viewOf(0, tank, seeAll)).toBe('full');
    const range = Math.hypot(ENEMY_GUNS[0].x, ENEMY_GUNS[0].z - tank.z);
    const spot = spotTime({ ...open, range });
    expect(run(b, tank, spot + ENEMY_GUN.layFirst - 0.5)).toHaveLength(0);
    expect(b.guns[0].sees).toBe(true);
    expect(run(b, tank, 1)).toHaveLength(1);
    // Instant spotting (as before F3.10) fires after the lay alone.
    const instant = gunA(INSTANT_SPOTTING);
    expect(run(instant, tank, ENEMY_GUN.layFirst + 0.5)).toHaveLength(1);
  });

  it('gives the tank away when the crew fires, and Meet has it spotted already', () => {
    const tank = onLane(ENEMY_GUNS[0].meetZ);
    const quiet = gunA();
    run(quiet, tank, 3);
    const firing = gunA();
    firing.crewFired();
    run(firing, tank, 3);
    expect(firing.guns[0].spot).toBe(1);
    expect(quiet.guns[0].spot).toBeLessThan(1);
    const met = gunA();
    met.spotNow(0);
    expect(run(met, tank, ENEMY_GUN.layFirst + 0.5)).toHaveLength(1);
  });

  it('forgets the tank out of sight, slowly', () => {
    const b = gunA();
    b.spotNow(0);
    run(b, onLane(ENEMY_GUNS[0].meetZ), 5, () => false);
    expect(b.guns[0].spot).toBeCloseTo(1 - 5 * SPOTTING.forget, 1);
    expect(b.guns[0].tracking).toBe(false);
  });

  it('lets a tank driving its route spot later than halted', () => {
    const r = ENEMY_TANKS[0];
    const b = new EnemyBattery(5);
    b.start(undefined, 'tanks');
    b.placeTank(FIRST_TANK, r.meetD);
    run(b, onLane(r.meetZ), 0.5);
    expect(b.guns[FIRST_TANK].sees).toBe(true);
    expect(b.guns[FIRST_TANK].moving).toBe(true);
    expect(b.guns[FIRST_TANK].tracking).toBe(false);
  });
});

describe('cover along the lane (F3.10)', () => {
  it('stands just off the lane\'s flat strip, clear of the road\'s boards and markers, the course and the other obstacles', () => {
    expect(LANE_WALLS.length).toBe(7);
    for (const w of LANE_WALLS) {
      expect(OBSTACLES).toContain(w);
      expect(Math.abs(w.x) - w.hz).toBeGreaterThan(LANE_HALF + 3);
      expect(outsideCourseField(w.x, w.z) - w.hz).toBeGreaterThan(4);
      for (const o of OBSTACLES) {
        if (o === w) continue;
        expect(obstacleDistance(w, o.x, o.z, [0, 0]) - o.r, `a wall at z ${w.z} by an obstacle`).toBeGreaterThan(1);
      }
      for (let i = 0; i < RANGE_TARGETS.length; i++) {
        const [x, z] = targetFoot(i);
        expect(obstacleDistance(w, x, z, [0, 0]), 'a wall by a target').toBeGreaterThan(3);
      }
      for (const range of MARKER_RANGES) {
        const [x, z] = markerFoot(range);
        expect(obstacleDistance(w, x, z, [0, 0]), 'a wall by a marker').toBeGreaterThan(1);
      }
    }
  });

  it('a wall hides a tank\'s hull but not its turret; a house hides all of it; open ground nothing', () => {
    const w = LANE_WALLS[0];
    const g = groundHeight(w.x, w.z);
    expect(obstaclesBlock([w.x - 30, g + 1, w.z], [w.x + 30, g + 1, w.z])).toBe(true);
    expect(obstaclesBlock([w.x - 30, g + 2.4, w.z], [w.x + 30, g + 2.4, w.z])).toBe(false);
    expect(obstaclesBlock([w.x - 30, g + 1, w.z - 40], [w.x + 30, g + 1, w.z - 40])).toBe(false);
    const house = OBSTACLES.find((o) => o.kind === 'house')!;
    const h = groundHeight(house.x, house.z);
    expect(obstaclesBlock([house.x - 40, h + 2.4, house.z], [house.x + 40, h + 2.4, house.z])).toBe(true);
    // The line between two copies of the tile finds the copy nearest it.
    expect(obstaclesBlock([house.x - 40 + 800, h + 2.4, house.z], [house.x + 40 + 800, h + 2.4, house.z])).toBe(true);
  });

  it('puts a tank halted behind a wall hull down to the guns, and leaves each Meet spot in the enemy\'s sight', () => {
    const b = new EnemyBattery();
    // Behind the first wall, gun A sees only the turret: the wall, not the ground, hides the hull.
    const w = LANE_WALLS[0];
    const tank = onLane(w.z);
    expect(b.viewOf(0, tank, seeAll)).toBe('turret');
    const muzzle: [number, number, number] = [ENEMY_GUNS[0].x, groundHeight(ENEMY_GUNS[0].x, ENEMY_GUNS[0].z) + ENEMY_GUN.muzzleHeight, ENEMY_GUNS[0].z];
    const hull: [number, number, number] = [0, tank.ground + HULL_SIGHT, w.z];
    expect(groundBlocks(muzzle, hull)).toBe(false);
    expect(obstaclesBlock(muzzle, hull)).toBe(true);
    // Each Meet still has the tank in its enemy's sight (over a crest, only the turret: where a gun first sees the lane).
    ENEMY_GUNS.forEach((g, i) => expect(b.viewOf(i, onLane(g.meetZ), seeAll), g.name).not.toBe('none'));
    ENEMY_TANKS.forEach((r, j) => {
      b.placeTank(FIRST_TANK + j, r.meetD);
      expect(b.viewOf(FIRST_TANK + j, onLane(r.meetZ), seeAll), r.name).not.toBe('none');
    });
  });
});

describe('hit boxes, aim and armour (F3.10)', () => {
  const tank = onLane(ENEMY_GUNS[0].meetZ);
  const hits = (opts: Parameters<typeof resolveShot>[5], shots = 3, n = 2000) => {
    const random = rng(17);
    const list: EnemyShot[] = [];
    for (let k = 0; k < n; k++) {
      const s = resolveShot(0, tank, shots, random, 0, opts);
      if (s.hit) list.push(s);
    }
    return list;
  };

  it('aims at the turret of a tank hull down, hitting it less and never on the hull', () => {
    const full = hits({});
    const turret = hits({ view: 'turret' });
    expect(turret.length).toBeLessThan(full.length / 2);
    expect(turret.length).toBeGreaterThan(0);
    for (const s of turret) expect(s.to[1] - tank.ground).toBeGreaterThan(DAMAGE.hullTop);
    // On a tank in full view, shells above the hull's top strike only within the turret's width.
    expect(full.some((s) => s.to[1] - tank.ground < DAMAGE.hullTop)).toBe(true);
    expect(full.every((s) => s.to[1] - tank.ground <= TANK_SILHOUETTE.height + 1e-9)).toBe(true);
  });

  it('hits a bigger box more and a better aim more', () => {
    const base = hits({}, 1).length;
    expect(hits({ box: 1.15 }, 1).length).toBeGreaterThan(base);
    expect(hits({ box: 0.85 }, 1).length).toBeLessThan(base);
    expect(hits({ aim: 0.7 }, 1).length).toBeGreaterThan(base);
    expect(hits({ aim: 1.4 }, 1).length).toBeLessThan(base);
  });

  it('lets fewer shells through tougher armour, and knocks out after the tuned number of hits through', () => {
    const through = (armour: number) => {
      const random = rng(8);
      let n = 0;
      // Square on the front plate at 400 m: about 91 mm against about 112.
      for (let k = 0; k < 500; k++) if (resolveDamage([0, 1, -400], [0, 1.2, -1], 400, { x: 0, z: 0, ground: 0, heading: 0, turretYaw: 0 }, random, armour).through) n++;
      return n;
    };
    expect(through(0.8)).toBeLessThan(through(1));
    expect(through(1.15)).toBeGreaterThanOrEqual(through(1));
    const s = freshDamage();
    const side = { zone: 'hull-side', through: true, armour: 38, pen: 110, effects: [], right: true } as const;
    for (let k = 0; k < 4; k++) expect(applyHit(s, side, 5)).toBe(false);
    expect(applyHit(s, side, 5)).toBe(true);
  });
});

describe('the scenario, Advance to contact (F3.10)', () => {
  const at = (z: number, more: Partial<ScenarioInput> = {}): ScenarioInput => ({
    z,
    out: false,
    spotted: false,
    gunsKilled: 0,
    killed: 0,
    enemies: 3,
    shots: 0,
    hits: 0,
    through: 0,
    ...more,
  });

  it('runs its clock, notes when the tank is first spotted, and brings the tanks up halfway', () => {
    const r = new ScenarioRun();
    r.start(DEFAULT_TUNING);
    expect(r.snap.phase).toBe('on');
    expect(r.step(10, at(-50))).toBe(false);
    r.step(5, at(-120, { spotted: true }));
    expect(r.snap.spottedAt).toBe(15);
    expect(r.snap.tanksIn).toBe(false);
    r.step(1, at(SCENARIO.tanksAtZ - 1));
    expect(r.snap.tanksIn).toBe(true);
    // Or after two guns knocked out, wherever the tank is.
    const s = new ScenarioRun();
    s.start(DEFAULT_TUNING);
    s.step(1, at(-50, { gunsKilled: SCENARIO.tanksAfterGuns, killed: 2 }));
    expect(s.snap.tanksIn).toBe(true);
  });

  it('is won at the objective, or with every enemy out once the tanks are in, and lost when knocked out', () => {
    const r = new ScenarioRun();
    r.start(DEFAULT_TUNING);
    // Every gun out before the tanks come: not yet won.
    expect(r.step(1, at(-50, { gunsKilled: 1, killed: 1 }))).toBe(false);
    expect(r.step(1, at(SCENARIO.objectiveZ, { hits: 2, through: 1, shots: 9 }))).toBe(true);
    expect(r.snap.phase).toBe('won');
    expect(r.snap.reached).toBe(true);
    expect(debriefLines(r.snap)[0]).toBe('Objective reached in 0:02');
    const k = new ScenarioRun();
    k.start(DEFAULT_TUNING);
    k.step(1, at(-300));
    expect(k.step(1, at(-300, { enemies: 5, killed: 5, gunsKilled: 3 }))).toBe(true);
    expect(debriefLines(k.snap)[0]).toBe('Every enemy knocked out in 0:02');
    const l = new ScenarioRun();
    l.start(DEFAULT_TUNING);
    expect(l.step(65, at(-200, { out: true, hits: 4, through: 3, shots: 12, spotted: true }))).toBe(true);
    expect(l.snap.phase).toBe('lost');
    expect(debriefLines(l.snap)).toEqual(['Knocked out after 1:05', '0 of 3 enemies out, spotted at 1:05, 4 hits taken of 12 shots, 3 through']);
    // Over, it stays as it ended.
    expect(l.step(10, at(-600))).toBe(false);
    expect(l.snap.time).toBe(65);
  });

  it('shares its state with the tuning, reading back a broken message as nothing', () => {
    const r = new ScenarioRun();
    r.start({ ...DEFAULT_TUNING, aim: 1.4 });
    r.step(3, at(-260, { spotted: true }));
    const back = parseScenario(JSON.parse(JSON.stringify(r.snap)));
    expect(back).toEqual(r.snap);
    expect(parseScenario({ phase: 'maybe', time: 1, v: 1 })).toBeNull();
    expect(parseScenario({ phase: 'on', time: 1, v: 1 })?.tune).toEqual(DEFAULT_TUNING);
    expect(scenarioLine(noScenario())).toBe('Advance to contact: off');
    expect(scenarioLine(r.snap)).toMatch(/^Advancing, 0:03\. 0 of 3 enemies out, spotted at 0:03/);
  });

  it('is not hopeless: a still tank in the open lasts most of a minute against gun A, hull down behind a wall much longer', () => {
    // Gun A alone on a still tank: how long until three hits through the armour knock it out (median of many seeds).
    const outAfter = (z: number) => {
      const times: number[] = [];
      for (let seed = 1; seed <= 40; seed++) {
        const b = new EnemyBattery(seed);
        b.start(seed);
        b.kill(1);
        b.kill(2);
        const tank = onLane(z);
        const s = freshDamage();
        const random = rng(seed);
        const out: EnemyShot[] = [];
        let t = 0;
        for (; t < 600 && !s.out; t += 0.1) {
          b.step(0.1, tank, seeAll, out);
          for (const shot of out) if (shot.hit) applyHit(s, resolveDamage(shot.from, shot.to, shot.range, { x: 0, z, ground: tank.ground, heading: 0, turretYaw: 0 }, random));
        }
        times.push(t);
      }
      times.sort((a, b) => a - b);
      return times[times.length >> 1];
    };
    const inOpen = outAfter(OPEN_Z);
    expect(inOpen).toBeGreaterThan(45);
    expect(outAfter(LANE_WALLS[0].z)).toBeGreaterThan(1.7 * inOpen);
  });
});
