import { COLUMN_VEHICLES } from '../src/sim/column.js';
import { describe, expect, it } from 'vitest';
import { armouredTargets, ENEMY_TARGET_FIRST, TARGET_NAMES, targetFaces } from '../src/sim/ballistics.js';
import { INSTANT_SPOTTING } from '../src/sim/combat.js';
import { resolveDamage } from '../src/sim/damage.js';
import { ENEMY_COUNT, ENEMY_GUNS, EnemyBattery, type EnemyShot, enemyName, FIRST_HILL, groupOf, routeOf, type TankTarget } from '../src/sim/enemy-guns.js';
import { ENEMY_TANKS, HILL_TANKS, routeLength, routePose, wrapRoute } from '../src/sim/enemy-tanks.js';
import {
  HILL,
  hillDebrief,
  hillEnemy,
  type HillInput,
  hillLine,
  HillRun,
  hillTasks,
  holdView,
  hullDownShare,
  noHill,
  parseHill,
  wavesDue,
} from '../src/sim/hill.js';
import { rng } from '../src/sim/random.js';
import { FIRING_LANES, firingLaneOffset, groundHeight, HOLD_HILL, LANE_HALF, obstacleDistance, OBSTACLES, outsideCourseField, outsideHoldHill, wrapTile } from '../src/sim/terrain.js';

const pose = { x: 0, z: 0, heading: 0 };
const normal: [number, number] = [0, 0];

/** The tank halted at (x, z) facing north. */
function tankAt(x: number, z: number): TankTarget {
  return { x, ground: groundHeight(x, z), z, heading: 0, speed: 0 };
}

/** Every point along attacker `k`'s route, `step` m apart. */
function routePoints(k: number, step = 10): [number, number][] {
  const r = HILL_TANKS[k];
  const out: [number, number][] = [];
  for (let d = 0; d <= routeLength(r); d += step) {
    routePose(r, d, pose);
    out.push([pose.x, pose.z]);
  }
  return out;
}

function input(patch: Partial<HillInput> = {}): HillInput {
  return { out: false, spotted: false, killed: 0, arrived: false, seen: 'none', shots: 0, hits: 0, through: 0, view: 'off', halted: false, ...patch };
}

describe('hold the hill (F5.9): the hill', () => {
  it('rises 6 m to a crest running east and west, gentle behind and steeper in front', () => {
    const h = HOLD_HILL;
    for (const x of [h.west, 192, h.east]) expect(groundHeight(x, h.crest)).toBeCloseTo(h.height, 6);
    // Its feet are back on the level, and a fading end is lower.
    expect(Math.abs(groundHeight(192, h.crest + h.behind + 8))).toBeLessThan(0.8);
    expect(Math.abs(groundHeight(192, h.crest - h.ahead - 8))).toBeLessThan(0.8);
    expect(groundHeight(h.west - h.fade / 2, h.crest)).toBeLessThan(h.height * 0.6);
    // The reverse slope where a tank halts hull down is gentle: under 6°.
    const slope = (groundHeight(192, HILL.hullDownZ - 3) - groundHeight(192, HILL.hullDownZ + 3)) / 6;
    expect(Math.atan(slope)).toBeGreaterThan(0);
    expect(Math.atan(slope)).toBeLessThan((6 * Math.PI) / 180);
    // It repeats with the ground, like everything on it.
    expect(groundHeight(192 + 800, h.crest + 800)).toBeCloseTo(groundHeight(192, h.crest), 6);
  });

  it("stays clear of the lane, the course, the firing lanes and tank A's route, and nothing stands on it", () => {
    for (let z = -400; z <= 400; z += 8) expect(outsideHoldHill(LANE_HALF + 28, z)).toBeGreaterThan(0);
    for (let x = -400; x <= 400; x += 8) {
      for (let z = -400; z <= 400; z += 8) {
        if (outsideHoldHill(x, z) > 0) continue;
        expect(outsideCourseField(x, z)).toBeGreaterThan(0);
        expect(firingLaneOffset(x, z)).toBeGreaterThan(FIRING_LANES[0].half + FIRING_LANES[0].blend);
      }
    }
    // Tank A drives 30 m or more from the reverse slope's foot (the waves' smoothing round it stops short of its route).
    for (const [x, z] of ENEMY_TANKS[0].points) expect(outsideHoldHill(x, z)).toBeGreaterThan(HOLD_HILL.blend);
    for (const o of OBSTACLES) expect(outsideHoldHill(o.x, o.z)).toBeGreaterThan(o.r);
  });
});

describe('hold the hill (F5.9): hull down', () => {
  it('a band 22 to 30 m behind the crest shows only the turret to the road north, the gun clearing the crest, all along it', () => {
    const [fx, fz] = HILL.lookFrom;
    for (let x = HOLD_HILL.west; x <= HOLD_HILL.east; x += 8) {
      for (const b of [22, 24, 26, 28]) expect(holdView({ x, z: HOLD_HILL.crest + b, heading: 0 }, fx, fz)).toBe('hull-down');
      // Nearer the crest the hull shows; further back the tank is below it.
      expect(holdView({ x, z: HOLD_HILL.crest + 12, heading: 0 }, fx, fz)).toBe('exposed');
      expect(holdView({ x, z: HOLD_HILL.crest + 40, heading: 0 }, fx, fz)).toBe('masked');
    }
    expect(holdView({ x: 0, z: -300, heading: 0 }, fx, fz)).toBe('off');
    expect(holdView({ x: HILL.startX, z: HILL.startZ, heading: 0 }, fx, fz)).toBe('masked');
  });

  it('at the hull-down spot, never shows the hull to an attacker anywhere on its route, and is hull down to most of them', () => {
    const t = { x: HILL.startX, z: HILL.hullDownZ, heading: 0 };
    let points = 0;
    let hullDown = 0;
    HILL_TANKS.forEach((_, k) => {
      for (const [x, z] of routePoints(k)) {
        const v = holdView(t, x, z);
        expect(v, `${HILL_TANKS[k].name} at (${x.toFixed(0)}, ${z.toFixed(0)})`).not.toBe('exposed');
        points++;
        if (v === 'hull-down') hullDown++;
      }
    });
    expect(hullDown / points).toBeGreaterThan(0.85);
  });

  it('the battery sees only the turret there: slower to spot, and its shots aimed at the turret', () => {
    const b = new EnemyBattery(3, INSTANT_SPOTTING);
    b.begin(3);
    b.enter(hillEnemy(0));
    b.placeTank(hillEnemy(0), 100);
    const there = tankAt(HILL.startX, HILL.hullDownZ);
    expect(b.viewOf(hillEnemy(0), there, () => true)).toBe('turret');
    expect(b.viewOf(hillEnemy(0), tankAt(HILL.startX, HOLD_HILL.crest + 12), () => true)).toBe('full');
    expect(b.viewOf(hillEnemy(0), tankAt(HILL.startX, HOLD_HILL.crest + 45), () => true)).toBe('none');
  });
});

describe('hold the hill (F5.9): the attackers', () => {
  it('are four tanks after the guns, the two patrolling tanks and the ambush\'s column, armoured targets for the shells', () => {
    expect(FIRST_HILL).toBe(ENEMY_GUNS.length + ENEMY_TANKS.length + COLUMN_VEHICLES.length);
    expect(ENEMY_COUNT).toBe(FIRST_HILL + HILL_TANKS.length);
    expect(HILL_TANKS).toHaveLength(4);
    const armoured = armouredTargets();
    for (let k = 0; k < HILL_TANKS.length; k++) {
      const i = hillEnemy(k);
      expect(groupOf(i)).toBe('hill');
      expect(routeOf(i)).toBe(HILL_TANKS[k]);
      expect(enemyName(i)).toBe(HILL_TANKS[k].name);
      expect(armoured[ENEMY_TARGET_FIRST + i]).toBe(true);
      expect(TARGET_NAMES[ENEMY_TARGET_FIRST + i]).toBe(HILL_TANKS[k].name.replace(/^T/, 't'));
    }
    expect(targetFaces()).toHaveLength(ENEMY_TARGET_FIRST + ENEMY_COUNT);
    expect(new Set(HILL_TANKS.map((t) => t.name)).size).toBe(4);
  });

  it('drive once from the road north of the hill to the foot of its forward slope, clear of every obstacle', () => {
    for (let k = 0; k < HILL_TANKS.length; k++) {
      const r = HILL_TANKS[k];
      expect(r.oneWay).toBe(true);
      const start = r.points[0];
      const end = r.points[r.points.length - 1];
      // They start on the cross road's copy, 280 m or more from the hull-down spot, out of a tank's spot range of the reverse slope.
      expect(start[1]).toBe(-800);
      expect(Math.hypot(start[0] - HILL.startX, start[1] - HILL.hullDownZ)).toBeGreaterThan(280);
      // They end at the forward slope's foot, 70 m or more in front of the crest, on the hill's length.
      expect(HOLD_HILL.crest - end[1]).toBeGreaterThan(70);
      expect(HOLD_HILL.crest - end[1]).toBeLessThan(HOLD_HILL.ahead + 30);
      expect(end[0]).toBeGreaterThan(HOLD_HILL.west - HOLD_HILL.fade);
      expect(end[0]).toBeLessThan(HOLD_HILL.east + HOLD_HILL.fade);
      for (const [x, z] of routePoints(k, 2)) {
        for (const o of OBSTACLES) expect(obstacleDistance(o, x, z, normal), `${r.name} by the ${o.kind} at (${o.x.toFixed(0)}, ${o.z.toFixed(0)})`).toBeGreaterThan(5);
        expect(Math.abs(wrapTile(x))).toBeGreaterThan(LANE_HALF);
      }
      // Driven once: held at the end, not turned back.
      const length = routeLength(r);
      expect(wrapRoute(r, length + 50)).toBe(length);
      routePose(r, length + 50, pose);
      expect(pose.x).toBeCloseTo(end[0], 6);
      expect(pose.z).toBeCloseTo(end[1], 6);
    }
  });

  it('come in one by one, drive on, halt for good at the end, and have then reached the hill', () => {
    const b = new EnemyBattery(9);
    b.start();
    b.hits = 2;
    b.begin(9);
    expect(b.on).toBe(false);
    expect(b.hits).toBe(0);
    const i = hillEnemy(0);
    b.enter(i);
    expect(b.groupOn('hill')).toBe(true);
    expect(b.alive('hill')).toBe(1);
    // The tank far away behind the hill, out of their sight: they drive the whole way.
    const hidden = tankAt(HILL.startX, HOLD_HILL.crest + 70);
    const out: EnemyShot[] = [];
    const length = routeLength(HILL_TANKS[0]);
    for (let t = 0; t < length / 4 - 1; t += 0.1) b.step(0.1, hidden, () => true, out);
    expect(b.arrived(i)).toBe(false);
    expect(b.guns[i].moving).toBe(true);
    for (let t = 0; t < 5; t += 0.1) b.step(0.1, hidden, () => true, out);
    expect(b.arrived(i)).toBe(true);
    expect(b.guns[i].moving).toBe(false);
    expect(b.guns[i].d).toBeCloseTo(length, 6);
    b.kill(i);
    expect(b.arrived(i)).toBe(false);
  });

  it('halt to fire once they spot the tank on the crest, and drive on when it drops out of sight', () => {
    const b = new EnemyBattery(4, INSTANT_SPOTTING);
    b.begin(4);
    const i = hillEnemy(1);
    b.enter(i);
    const exposed = tankAt(HILL.startX, HOLD_HILL.crest + 12);
    const out: EnemyShot[] = [];
    const shots: EnemyShot[] = [];
    for (let t = 0; t < 20; t += 0.1) {
      b.step(0.1, exposed, () => true, out);
      shots.push(...out);
    }
    expect(b.guns[i].tracking).toBe(true);
    expect(b.guns[i].moving).toBe(false);
    expect(shots.length).toBeGreaterThan(0);
    const d = b.guns[i].d;
    const below = tankAt(HILL.startX, HOLD_HILL.crest + 70);
    for (let t = 0; t < 10; t += 0.1) b.step(0.1, below, () => true, out);
    expect(b.guns[i].tracking).toBe(false);
    expect(b.guns[i].d).toBeGreaterThan(d);
  });
});

describe('hold the hill (F5.9): the run', () => {
  it('brings the first wave after a quiet start and the second at its time, or once the first is out', () => {
    expect(wavesDue(0, 0, 0, 0)).toBe(0);
    expect(wavesDue(HILL.firstWave, 0, 0, 0)).toBe(1);
    expect(wavesDue(HILL.firstWave + 10, 1, 2, 1)).toBe(1);
    expect(wavesDue(HILL.firstWave + 10, 2, 2, 1)).toBe(2);
    expect(wavesDue(HILL.secondWave, 0, 2, 1)).toBe(2);
    expect(wavesDue(HILL.secondWave + 100, 4, 4, 2)).toBe(2);
    const run = new HillRun();
    run.start();
    let came = 0;
    for (let t = 0; t < HILL.firstWave + 1; t += 0.5) came += run.step(0.5, input()).wave;
    expect(came).toBe(1);
    expect(run.snap.came).toBe(2);
    expect(run.step(0.5, input({ killed: 2 })).wave).toBe(2);
    expect(run.snap.came).toBe(4);
  });

  it('is won when all four are knocked out, and lost when the tank is or an attacker reaches the hill', () => {
    const won = new HillRun();
    won.start();
    won.step(HILL.secondWave, input());
    won.step(1, input());
    expect(won.snap.wave).toBe(2);
    expect(won.step(1, input({ killed: 3 })).ended).toBe(false);
    expect(won.step(1, input({ killed: 4 })).ended).toBe(true);
    expect(won.snap.phase).toBe('won');
    expect(hillDebrief(won.snap)[0]).toBe('Hill held: all 4 tanks knocked out in 1:43');
    // All four out of the first two waves... only once both waves have come.
    const early = new HillRun();
    early.start();
    early.step(HILL.firstWave, input());
    expect(early.step(1, input({ killed: 2 })).ended).toBe(false);

    const out = new HillRun();
    out.start();
    out.step(40, input());
    expect(out.step(1, input({ out: true, hits: 4, through: 3, shots: 9 })).ended).toBe(true);
    expect(out.snap.phase).toBe('lost');
    expect(out.snap.loss).toBe('out');
    expect(hillDebrief(out.snap)[0]).toBe('Knocked out after 0:41');

    const overrun = new HillRun();
    overrun.start();
    overrun.step(70, input());
    overrun.step(1, input({ arrived: true }));
    expect(overrun.snap.loss).toBe('overrun');
    expect(hillDebrief(overrun.snap)[0]).toBe('The enemy took the hill after 1:11');
    // Over, it no longer steps.
    expect(overrun.step(10, input()).ended).toBe(false);
    expect(overrun.snap.time).toBe(71);
  });

  it("counts the time the enemy saw the hull and only the turret, and tells the driver where the tank stands once it halts", () => {
    const run = new HillRun();
    run.start();
    run.step(10, input({ seen: 'full' }));
    run.step(30, input({ seen: 'turret', spotted: true }));
    run.step(5, input());
    expect(run.snap.seenFull).toBe(10);
    expect(run.snap.seenTurret).toBe(30);
    expect(hullDownShare(run.snap)).toBe(75);
    expect(run.snap.spottedAt).toBe(40);
    expect(hillDebrief(run.snap)[1]).toBe('0 of 4 tanks out, spotted at 0:40, 0 hits taken of 0 shots, 0 through, hull down 75% of the time in their sight');
    // On the move the last call stands; halted, the new one is made; off the hill at once.
    run.step(1, input({ view: 'exposed', halted: false }));
    expect(run.snap.view).toBe('off');
    run.step(1, input({ view: 'exposed', halted: true }));
    expect(run.snap.view).toBe('exposed');
    run.step(1, input({ view: 'hull-down', halted: false }));
    expect(run.snap.view).toBe('exposed');
    run.step(1, input({ view: 'hull-down', halted: true }));
    expect(run.snap.view).toBe('hull-down');
    expect(hillTasks(run.snap)).toEqual(['Hull down: only the turret shows', '0 of 4 tanks knocked out']);
    run.step(1, input({ view: 'off', halted: false }));
    expect(run.snap.view).toBe('off');
    expect(hillDebrief(noHill())[1]).toContain('never spotted');
    expect(hillDebrief(noHill())[1]).not.toContain('hull down');
  });

  it('is shared as the hill event, reading what an older message leaves out', () => {
    const run = new HillRun();
    expect(hillLine(run.snap)).toBe('Hold the hill: off');
    run.start();
    run.step(HILL.firstWave + 2, input({ seen: 'turret', view: 'hull-down', halted: true, shots: 3, hits: 1 }));
    const sent = JSON.parse(JSON.stringify({ t: 'hill', ...run.snap }));
    expect(parseHill(sent)).toEqual(run.snap);
    expect(parseHill({ phase: 'on', time: 3, v: 2 })).toEqual({ ...noHill(), phase: 'on', time: 3, v: 2 });
    expect(parseHill({ phase: 'maybe', time: 3, v: 2 })).toBeNull();
    expect(parseHill({ ...sent, view: 'sideways', loss: 'never' })?.view).toBe('off');
    expect(hillLine(run.snap)).toMatch(/^Holding the hill, 0:17\. 0 of 4 tanks out/);
    run.stop();
    expect(run.snap.phase).toBe('off');
    expect(hillLine(run.snap)).toMatch(/^Hold the hill: off\. /);
  });
});

describe('hold the hill (F5.9): how it plays', () => {
  /**
   * The battery and the damage model run headless against a crude crew
   * halted at `b` m behind the crest, firing every `every` s at the nearest
   * attacker it can see over the crest and knocking it out one shot in
   * `odds` (docs/hold-the-hill.md, "How it plays").
   */
  function play(seed: number, b: number, every: number, odds: number): ReturnType<HillRun['step']> & { run: HillRun } {
    const battery = new EnemyBattery(seed);
    battery.begin(seed);
    const run = new HillRun();
    run.start();
    const tank = tankAt(HILL.startX, HOLD_HILL.crest + b);
    const dice = rng(seed * 7 + 1);
    const damageDice = rng(seed + 99);
    const out: EnemyShot[] = [];
    let hits = 0;
    let through = 0;
    let next = 20;
    const dt = 0.25;
    for (let t = 0; t < 600; t += dt) {
      battery.step(dt, tank, () => true, out);
      for (const s of out) {
        if (!s.hit) continue;
        hits++;
        if (resolveDamage(s.from, s.to, s.range, { x: tank.x, z: tank.z, ground: tank.ground, heading: 0, turretYaw: 0 }, damageDice, 1).through) through++;
      }
      if (t >= next) {
        let target = -1;
        let nearest = Infinity;
        for (let k = 0; k < HILL_TANKS.length; k++) {
          const i = hillEnemy(k);
          const g = battery.guns[i];
          if (!g.present || !g.alive) continue;
          routePose(HILL_TANKS[k], g.d, pose);
          const v = holdView(tank, pose.x, pose.z);
          const d = Math.hypot(pose.x - tank.x, pose.z - tank.z);
          if ((v === 'hull-down' || v === 'exposed') && d < nearest) {
            nearest = d;
            target = i;
          }
        }
        if (target >= 0) {
          next = t + every;
          battery.crewFired();
          if (dice() < odds) battery.kill(target);
        }
      }
      const f = input({ out: through >= 3, spotted: battery.spotted(), shots: battery.shotsFired, hits, through });
      for (let k = 0; k < HILL_TANKS.length; k++) {
        const i = hillEnemy(k);
        const g = battery.guns[i];
        if (!g.present) continue;
        if (!g.alive) f.killed++;
        else if (battery.arrived(i)) f.arrived = true;
        if (g.view === 'full') f.seen = 'full';
        else if (g.view === 'turret' && f.seen === 'none') f.seen = 'turret';
      }
      const step = run.step(dt, f);
      if (step.wave > 0) for (const k of HILL.waves[step.wave - 1]) battery.enter(hillEnemy(k));
      if (step.ended) return { ...step, run };
    }
    return { wave: 0, ended: false, run };
  }

  const SEEDS = 25;

  function tally(b: number, every: number, odds: number): { won: number; overrun: number; out: number } {
    const n = { won: 0, overrun: 0, out: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { run } = play(seed, b, every, odds);
      if (run.snap.phase === 'won') n.won++;
      else if (run.snap.loss === 'overrun') n.overrun++;
      else n.out++;
    }
    return n;
  }

  it('hull down a crew that fights back mostly holds; showing the hull it loses more; hiding below the crest it is overrun', () => {
    const hullDown = tally(24, 9, 0.5);
    const exposed = tally(12, 9, 0.5);
    const hiding = tally(45, 1e9, 0);
    expect(hullDown.won).toBeGreaterThan(SEEDS * 0.75);
    expect(exposed.won).toBeLessThan(hullDown.won);
    expect(hiding.overrun).toBe(SEEDS);
  }, 30000);
});
