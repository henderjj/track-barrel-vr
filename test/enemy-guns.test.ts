import { describe, expect, it } from 'vitest';
import { AMMO } from '../src/sim/ammo.js';
import {
  aimAt,
  createShotResult,
  decideShot,
  ENEMY_TARGET_FIRST,
  flyShell,
  hullDirToWorld,
  hullToWorld,
  softTargets,
  TARGET_NAMES,
  targetFaces,
} from '../src/sim/ballistics.js';
import {
  batteryLine,
  clockTo,
  ENEMY_GUN,
  ENEMY_GUNS,
  EnemyBattery,
  type EnemyShared,
  type EnemyShot,
  groundBlocks,
  GUN_SHIELD,
  parseShared,
  parseShot,
  resolveShot,
  sharedOf,
  shotSpread,
  type TankTarget,
} from '../src/sim/enemy-guns.js';
import { rng } from '../src/sim/random.js';
import { FOG } from '../src/sim/range.js';
import { createTankDrive } from '../src/sim/tank-drive.js';
import { COURSE_FIELD, groundHeight, LANE_HALF, OBSTACLES, outsideCourseField, wrapTile } from '../src/sim/terrain.js';
import { barrelDirection, muzzlePoint } from '../src/sim/turret.js';

/** The tank on the lane at z, facing up it, moving at `speed`. */
function onLane(z: number, speed = 0, x = 0): TankTarget {
  return { x, ground: groundHeight(x, z), z, heading: 0, speed };
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

describe('enemy anti-tank guns (F3.2)', () => {
  it('stand on open ground off the lane, clear of the obstacles and the biathlon field', () => {
    for (const g of ENEMY_GUNS) {
      expect(Math.abs(g.x), g.name).toBeGreaterThan(LANE_HALF + 20);
      expect(outsideCourseField(g.x, g.z), g.name).toBeGreaterThan(COURSE_FIELD.blend);
      for (const o of OBSTACLES) {
        expect(Math.hypot(wrapTile(o.x - g.x), wrapTile(o.z - g.z)) - o.r, `${g.name} by an obstacle`).toBeGreaterThan(10);
      }
    }
  });

  it('none sees the tank at its start; each sees it on the lane where Meet parks it, inside the fog', () => {
    const b = new EnemyBattery();
    ENEMY_GUNS.forEach((g, i) => {
      expect(b.canSee(i, onLane(0), seeAll), `${g.name} at the start`).toBe(false);
      expect(b.canSee(i, onLane(g.meetZ), seeAll), `${g.name} at its meeting place`).toBe(true);
      // And the crew sees its shield from there: no rise between the gunsight and the shield's middle.
      const shield: [number, number, number] = [g.x, groundHeight(g.x, g.z) + GUN_SHIELD.middle, g.z];
      expect(groundBlocks([0, groundHeight(0, g.meetZ) + 2.2, g.meetZ], shield), `${g.name}'s shield`).toBe(false);
    });
    expect(ENEMY_GUN.spotRange).toBeLessThan(FOG.far);
  });

  it('can\'t see through the ground or the smoke', () => {
    // A line high over the ground is clear; one under it is not.
    expect(groundBlocks([0, 100, 0], [0, 100, -100])).toBe(false);
    expect(groundBlocks([0, -100, 0], [0, -100, -100])).toBe(true);
    // Gun C, dug in low, can't see the tank at the start for the ground between.
    const c = ENEMY_GUNS[2];
    expect(groundBlocks([c.x, groundHeight(c.x, c.z) + ENEMY_GUN.muzzleHeight, c.z], [0, groundHeight(0, 0) + 2.4, 0])).toBe(true);
    const b = new EnemyBattery();
    const g = ENEMY_GUNS[0];
    expect(b.canSee(0, onLane(g.meetZ), () => false)).toBe(false);
  });

  it('lays for layFirst once it sees the tank, then fires every reload while it still does', () => {
    const b = new EnemyBattery();
    b.start(1);
    const tank = onLane(ENEMY_GUNS[0].meetZ);
    // Only gun A here: the others are knocked out for the test.
    b.kill(1);
    b.kill(2);
    const first = run(b, tank, ENEMY_GUN.layFirst - 0.1);
    expect(first).toHaveLength(0);
    const shots = run(b, tank, 0.2 + ENEMY_GUN.reload * 2);
    expect(shots).toHaveLength(3);
    expect(shots.every((s) => s.gun === 0)).toBe(true);
    expect(b.guns[0].revealed).toBe(true);
    expect(b.shotsFired).toBe(3);
  });

  it('loses the tank behind smoke and must lay afresh when it sees it again', () => {
    const b = new EnemyBattery();
    b.start(2);
    b.kill(1);
    b.kill(2);
    const tank = onLane(ENEMY_GUNS[0].meetZ);
    run(b, tank, ENEMY_GUN.layFirst + 0.5);
    expect(b.shotsFired).toBe(1);
    // Smoke for a while: no shots, and it loses the tank.
    expect(run(b, tank, ENEMY_GUN.loseAfter + 1, () => false)).toHaveLength(0);
    expect(b.guns[0].tracking).toBe(false);
    // Clear again: a full lay before the next.
    expect(run(b, tank, ENEMY_GUN.layFirst - 0.5)).toHaveLength(0);
    expect(run(b, tank, 1)).toHaveLength(1);
  });

  it('hits more as it corrects, and less on a tank on the move', () => {
    const odds = (shots: number, speed: number) => {
      const random = rng(99);
      let hits = 0;
      for (let n = 0; n < 1000; n++) if (resolveShot(0, onLane(ENEMY_GUNS[0].meetZ, speed), shots, random).hit) hits++;
      return hits / 1000;
    };
    const still = [odds(0, 0), odds(1, 0), odds(2, 0)];
    expect(still[0]).toBeLessThan(still[1]);
    expect(still[1]).toBeLessThanOrEqual(still[2]);
    expect(still[0]).toBeGreaterThan(0.3);
    expect(still[2]).toBeGreaterThan(0.9);
    // At 20 km/h it hits a good deal less.
    expect(odds(2, 5.5)).toBeLessThan(still[2] - 0.2);
    expect(shotSpread(0, 500, 0)).toBeGreaterThan(shotSpread(2, 500, 0));
    expect(shotSpread(2, 500, 5)).toBeGreaterThan(shotSpread(2, 500, 0));
  });

  it('puts a hit on the tank\'s near side, a low miss in the ground short of it and a high one well past', () => {
    const tank = onLane(ENEMY_GUNS[0].meetZ);
    const random = rng(5);
    const seen = { hit: false, short: false, past: false };
    for (let n = 0; n < 300; n++) {
      const s = resolveShot(0, tank, 0, random);
      const fromTank = Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]);
      const toTank = Math.hypot(tank.x - s.from[0], tank.z - s.from[2]);
      if (s.hit) {
        seen.hit = true;
        expect(Math.hypot(s.to[0] - tank.x, s.to[2] - tank.z)).toBeLessThan(4);
        expect(s.to[1]).toBeGreaterThan(tank.ground);
      } else if (fromTank < toTank) {
        seen.short = true;
        expect(s.to[1]).toBeCloseTo(groundHeight(s.to[0], s.to[2]), 6);
      } else {
        seen.past = true;
        expect(fromTank).toBeGreaterThan(toTank + 50);
      }
      expect(s.flight).toBeCloseTo(fromTank / ENEMY_GUN.muzzleSpeed, 6);
    }
    expect(seen).toEqual({ hit: true, short: true, past: true });
  });

  it('says where the gun is as a clock direction', () => {
    expect(clockTo(0, -100, 0)).toBe(9);
    expect(clockTo(0, 100, 0)).toBe(3);
    expect(clockTo(0, 0, -100)).toBe(12);
    expect(clockTo(0, -100, -100)).toBe(11);
    const shot = resolveShot(0, onLane(ENEMY_GUNS[0].meetZ), 0, rng(1));
    // Gun A is out on the left, ahead.
    expect([9, 10, 11]).toContain(shot.clock);
  });

  it('stops firing once knocked out, and counts what it did', () => {
    const b = new EnemyBattery();
    b.start(3);
    const v = b.version;
    expect(b.kill(0)).toBe(true);
    expect(b.kill(0)).toBe(false);
    expect(b.version).toBe(v + 1);
    expect(b.alive()).toBe(2);
    b.kill(1);
    b.kill(2);
    expect(run(b, onLane(ENEMY_GUNS[0].meetZ), 30)).toHaveLength(0);
    // Off, nothing fires and nothing is knocked out.
    b.start(3);
    b.stop();
    expect(run(b, onLane(ENEMY_GUNS[0].meetZ), 30)).toHaveLength(0);
    expect(b.kill(0)).toBe(false);
  });

  it('puts the guns\' shields among the shells\' targets, off until the battery is on, and soft for HE', () => {
    const faces = targetFaces();
    expect(TARGET_NAMES[ENEMY_TARGET_FIRST]).toBe('gun A');
    for (let j = 0; j < ENEMY_GUNS.length; j++) {
      expect(faces[ENEMY_TARGET_FIRST + j].off).toBe(true);
      expect(softTargets()[ENEMY_TARGET_FIRST + j]).toBe(true);
    }
    // Laid on gun A from where it first sees the tank: AP passes it by while it is off, and hits it once on.
    const g = ENEMY_GUNS[0];
    const tank = createTankDrive(0, g.meetZ, 0);
    const i = ENEMY_TARGET_FIRST;
    const { yaw, elevation } = aimAt(tank, faces[i], muzzlePoint);
    const origin = hullToWorld(tank, muzzlePoint(yaw, elevation, [0, 0, 0]), [0, 0, 0]);
    const dir = hullDirToWorld(tank, barrelDirection(yaw, elevation, [0, 0, 0]), [0, 0, 0]);
    expect(flyShell(origin, dir, faces, createShotResult()).target).not.toBe(i);
    faces[i].off = false;
    const result = flyShell(origin, dir, faces, createShotResult());
    expect(result.kind).toBe('target');
    expect(result.target).toBe(i);
    expect(decideShot('ap', result, faces, softTargets()).target).toBe(i);
    // HE laid on the ground 3 m to its right bursts beside it and counts by its blast.
    const f = faces[i];
    const beside = { ...f, x: f.x + Math.cos(f.yaw) * 3, y: f.y - GUN_SHIELD.middle + 0.05, z: f.z - Math.sin(f.yaw) * 3 };
    const he = aimAt(tank, beside, muzzlePoint, undefined, AMMO.he.speed);
    const heOrigin = hullToWorld(tank, muzzlePoint(he.yaw, he.elevation, [0, 0, 0]), [0, 0, 0]);
    const heDir = hullDirToWorld(tank, barrelDirection(he.yaw, he.elevation, [0, 0, 0]), [0, 0, 0]);
    const burst = flyShell(heOrigin, heDir, faces, createShotResult(), undefined, AMMO.he.speed);
    expect(decideShot('he', burst, faces, softTargets()).target).toBe(i);
  });

  it('shares the battery\'s state and its shots, reading what an older or broken message leaves out', () => {
    const b = new EnemyBattery();
    b.start(4);
    b.kill(1);
    const s = sharedOf(b, { on: false, alive: [], hits: 0, shots: 0, v: 0 });
    const back = parseShared(JSON.parse(JSON.stringify({ t: 'enemy', ...s })));
    expect(back).toEqual(s);
    expect(parseShared({ on: 'yes' })).toBeNull();
    const shot = resolveShot(2, onLane(ENEMY_GUNS[2].meetZ), 0, rng(3));
    expect(parseShot(JSON.parse(JSON.stringify({ t: 'enemy-shot', ...shot })))).toEqual(shot);
    expect(parseShot({ gun: 7, from: [0, 0, 0], to: [0, 0, 0], hit: true, flight: 1 })).toBeNull();
    expect(parseShot({ gun: 0, from: [0, 0], to: [0, 0, 0], hit: true, flight: 1 })).toBeNull();
  });

  it('says how the fight stands', () => {
    const s: EnemyShared = { on: false, alive: [true, true, true], hits: 0, shots: 0, v: 0 };
    expect(batteryLine(s)).toBe('Enemy guns off');
    s.on = true;
    s.alive[0] = false;
    s.hits = 1;
    s.shots = 4;
    expect(batteryLine(s)).toBe('2 of 3 guns in action, 1 knocked out. Hits taken 1 of 4 shots');
    s.alive.fill(false);
    expect(batteryLine(s)).toBe('All 3 guns knocked out. Hits taken 1');
  });
});
