import { describe, expect, it } from 'vitest';
import { AMMO } from '../src/sim/ammo.js';
import {
  aimAt,
  armouredTargets,
  createShotResult,
  decideShot,
  describeRound,
  ENEMY_TARGET_FIRST,
  flyShell,
  type HitFace,
  hullDirToWorld,
  hullToWorld,
  softTargets,
  TARGET_NAMES,
  targetFaces,
} from '../src/sim/ballistics.js';
import {
  batteryLine,
  ENEMY_COUNT,
  ENEMY_GUNS,
  EnemyBattery,
  type EnemyShot,
  enemyName,
  FIRST_TANK,
  groundBlocks,
  noEnemies,
  parseShared,
  sharedOf,
  specOf,
  tankFace,
  type TankTarget,
} from '../src/sim/enemy-guns.js';
import { ENEMY_TANK, ENEMY_TANKS, routeLength, routePose, wrapRoute } from '../src/sim/enemy-tanks.js';
import { FOG } from '../src/sim/range.js';
import { createTankDrive } from '../src/sim/tank-drive.js';
import { COURSE_FIELD, groundHeight, LANE_HALF, OBSTACLES, outsideCourseField, TILE, wrapTile } from '../src/sim/terrain.js';
import { barrelDirection, muzzlePoint } from '../src/sim/turret.js';

/** The tank on the lane at z, facing up it, moving at `speed`. */
function onLane(z: number, speed = 0): TankTarget {
  return { x: 0, ground: groundHeight(0, z), z, heading: 0, speed };
}

const seeAll = () => true;
const TANK_A = FIRST_TANK;
const TANK_B = FIRST_TANK + 1;

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

/** Every point along a route, every `step` m one way. */
function along(j: number, step = 5): { x: number; z: number; heading: number; d: number }[] {
  const r = ENEMY_TANKS[j];
  const points = [];
  for (let d = 0; d <= routeLength(r) + 1e-9; d += step) points.push({ ...routePose(r, d, { x: 0, z: 0, heading: 0 }), d });
  return points;
}

/** A battery with the tanks started and tank `i` at distance d, the others held out of the way. */
function tanksAt(i: number, d: number): EnemyBattery {
  const b = new EnemyBattery(5);
  b.start(undefined, 'tanks');
  b.placeTank(i, d);
  return b;
}

describe('enemy tanks on fixed routes (F3.3)', () => {
  it('drive on open ground well off the lane, clear of the obstacles, the biathlon field and the guns', () => {
    ENEMY_TANKS.forEach((r, j) => {
      expect(routeLength(r), r.name).toBeGreaterThan(100);
      for (const p of along(j)) {
        expect(Math.abs(p.x), r.name).toBeGreaterThan(LANE_HALF + 60);
        expect(Math.abs(p.x)).toBeLessThan(TILE / 2);
        expect(Math.abs(p.z)).toBeLessThan(TILE / 2);
        expect(outsideCourseField(p.x, p.z), `${r.name} by the course`).toBeGreaterThan(COURSE_FIELD.blend + 20);
        for (const o of OBSTACLES) {
          expect(Math.hypot(wrapTile(o.x - p.x), wrapTile(o.z - p.z)) - o.r, `${r.name} by an obstacle at ${p.d} m`).toBeGreaterThan(12);
        }
        for (const g of ENEMY_GUNS) expect(Math.hypot(g.x - p.x, g.z - p.z), `${r.name} by ${g.name}`).toBeGreaterThan(60);
      }
    });
  });

  it('go there and back along their routes, facing the way they drive', () => {
    const r = ENEMY_TANKS[0];
    const length = routeLength(r);
    const p = routePose(r, 0, { x: 0, z: 0, heading: 0 });
    expect([p.x, p.z]).toEqual([r.points[0][0], r.points[0][1]]);
    // Tank A drives west first: heading +90° (0 faces -z, +90° faces -x).
    expect(p.heading).toBeCloseTo(Math.PI / 2, 6);
    routePose(r, length / 2, p);
    expect(p.x).toBeCloseTo((r.points[0][0] + r.points[1][0]) / 2, 6);
    // On the way back it faces the other way, and a whole loop brings it back.
    routePose(r, length * 1.5, p);
    expect(p.x).toBeCloseTo((r.points[0][0] + r.points[1][0]) / 2, 6);
    expect(p.heading).toBeCloseTo(-Math.PI / 2, 6);
    expect(wrapRoute(r, 2 * length + 3)).toBeCloseTo(3, 9);
    expect(wrapRoute(r, -3)).toBeCloseTo(2 * length - 3, 9);
  });

  it("can't see the tank at its start from anywhere on their routes, and see it where Meet parks it, inside the fog", () => {
    expect(ENEMY_TANK.spotRange).toBeLessThan(FOG.far);
    ENEMY_TANKS.forEach((r, j) => {
      const i = FIRST_TANK + j;
      for (const p of along(j, 10)) {
        expect(tanksAt(i, p.d).canSee(i, onLane(0), seeAll), `${r.name} ${p.d} m along`).toBe(false);
      }
      expect(tanksAt(i, r.meetD).canSee(i, onLane(r.meetZ), seeAll), `${r.name} at its meeting place`).toBe(true);
      // And the crew sees its hull from there.
      const p = routePose(r, r.meetD, { x: 0, z: 0, heading: 0 });
      const hull: [number, number, number] = [p.x, groundHeight(p.x, p.z) + 1.2, p.z];
      expect(groundBlocks([0, groundHeight(0, r.meetZ) + 2.2, r.meetZ], hull), `${r.name}'s hull`).toBe(false);
    });
  });

  it('drive their routes until they have the tank, halt to lay and fire, and drive on once they lose it', () => {
    const r = ENEMY_TANKS[0];
    const b = tanksAt(TANK_A, 0);
    b.guns[TANK_B].present = false;
    // Out of its sight at the start: it drives on at its speed.
    expect(run(b, onLane(0), 10)).toHaveLength(0);
    expect(b.guns[TANK_A].moving).toBe(true);
    expect(b.guns[TANK_A].d).toBeCloseTo(ENEMY_TANK.speed * 10, 0);
    // Parked where it sees the tank: it halts at once, fires after layFirst, then every reload.
    b.placeTank(TANK_A, r.meetD);
    const shots = run(b, onLane(r.meetZ), ENEMY_TANK.layFirst + 2 * ENEMY_TANK.reload + 0.5);
    expect(b.guns[TANK_A].moving).toBe(false);
    // It drives on until its next look sees the tank.
    expect(b.guns[TANK_A].d - r.meetD).toBeLessThan(ENEMY_TANK.speed * 0.5);
    expect(shots).toHaveLength(3);
    expect(shots.every((s) => s.gun === TANK_A)).toBe(true);
    // Smoke between: it loses the tank after loseAfter, and drives on.
    const hidden = run(b, onLane(r.meetZ), ENEMY_TANK.loseAfter + 1, () => false);
    expect(hidden).toHaveLength(0);
    expect(b.guns[TANK_A].tracking).toBe(false);
    expect(b.guns[TANK_A].moving).toBe(true);
    expect(b.guns[TANK_A].d).toBeGreaterThan(r.meetD);
    // Knocked out, it stops where it is and falls silent.
    expect(b.kill(TANK_A)).toBe(true);
    const at = b.guns[TANK_A].d;
    expect(run(b, onLane(r.meetZ), 20)).toHaveLength(0);
    expect(b.guns[TANK_A].d).toBe(at);
  });

  it('fire from their turrets with their own numbers, and hit less on a tank on the move', () => {
    const r = ENEMY_TANKS[1];
    const b = tanksAt(TANK_B, r.meetD);
    const shot = b.fire(TANK_B, onLane(r.meetZ));
    expect(shot.from[1]).toBeCloseTo(groundHeight(shot.from[0], shot.from[2]) + ENEMY_TANK.muzzleHeight, 0);
    expect(specOf(TANK_B).muzzleSpeed).toBe(ENEMY_TANK.muzzleSpeed);
    const count = (speed: number) => {
      const hits = [0, 1, 2, 3].map(() => 0);
      for (let k = 0; k < 400; k++) {
        const battery = new EnemyBattery(100 + k);
        battery.start(undefined, 'tanks');
        battery.placeTank(TANK_B, r.meetD);
        for (let s = 0; s < 4; s++) if (battery.fire(TANK_B, onLane(r.meetZ, speed)).hit) hits[s]++;
      }
      return hits;
    };
    const still = count(0);
    expect(still[2]).toBeGreaterThan(still[0]);
    const moving = count(20 / 3.6);
    expect(moving[2]).toBeLessThan(still[2]);
  });

  it('start and stop apart from the guns', () => {
    const b = new EnemyBattery();
    b.start();
    expect(b.groupOn('guns')).toBe(true);
    expect(b.groupOn('tanks')).toBe(false);
    b.fire(0, onLane(ENEMY_GUNS[0].meetZ));
    b.hits = 1;
    b.start(undefined, 'tanks');
    expect(b.alive()).toBe(ENEMY_COUNT);
    expect(b.alive('tanks')).toBe(2);
    // Starting the tanks with the guns running keeps the count.
    expect(b.shotsFired).toBe(1);
    b.stop('tanks');
    expect(b.groupOn('tanks')).toBe(false);
    expect(b.on).toBe(true);
    expect(b.kill(TANK_A)).toBe(false);
    b.stop();
    expect(b.on).toBe(false);
  });

  it('show the crew their silhouette square to the line of sight, side or front, where a shell fired now finds them', () => {
    const f: HitFace = { x: 0, y: 0, z: 0, halfWidth: 0, halfHeight: 0, yaw: 0 };
    // Tank A drives west along z -380: from due south it shows its side, from due west its front.
    const p = routePose(ENEMY_TANKS[0], 100, { x: 0, z: 0, heading: 0 });
    tankFace(TANK_A, 100, 0, p.x, p.z + 300, f);
    expect(f.halfWidth).toBeCloseTo(ENEMY_TANK.length / 2, 6);
    expect(f.yaw).toBeCloseTo(0, 6);
    expect(f.y).toBeCloseTo(groundHeight(p.x, p.z) + ENEMY_TANK.height / 2, 6);
    tankFace(TANK_A, 100, 0, p.x - 300, p.z, f);
    expect(f.halfWidth).toBeCloseTo(ENEMY_TANK.width / 2, 6);
    // `ahead` m on, it is where the tank will be.
    tankFace(TANK_A, 100, 6, 0, -200, f);
    const later = routePose(ENEMY_TANKS[0], 106, { x: 0, z: 0, heading: 0 });
    expect(f.x).toBeCloseTo(later.x, 6);
    expect(f.z).toBeCloseTo(later.z, 6);
  });

  it('are among the shells\' targets, off until started, armoured: AP knocks one out, HE does not', () => {
    const faces = targetFaces();
    expect(faces).toHaveLength(ENEMY_TARGET_FIRST + ENEMY_COUNT);
    expect(faces[ENEMY_TARGET_FIRST + TANK_A].off).toBe(true);
    expect(TARGET_NAMES[ENEMY_TARGET_FIRST + TANK_A]).toBe('tank A');
    expect(TARGET_NAMES[ENEMY_TARGET_FIRST + TANK_B]).toBe('tank B');
    expect(enemyName(TANK_B)).toBe('Tank B');
    const soft = softTargets();
    const armoured = armouredTargets();
    expect(soft[ENEMY_TARGET_FIRST + TANK_A]).toBe(false);
    expect(armoured[ENEMY_TARGET_FIRST + TANK_A]).toBe(true);
    expect(armoured.filter(Boolean)).toHaveLength(2);
    expect(armoured[ENEMY_TARGET_FIRST]).toBe(false);

    // The crew parked where Meet A puts it, tank A halted at its meeting place, its face square to the crew.
    const r = ENEMY_TANKS[0];
    const tank = createTankDrive();
    tank.z = r.meetZ;
    tank.y = groundHeight(0, r.meetZ);
    const t = ENEMY_TARGET_FIRST + TANK_A;
    faces[t].off = false;
    Object.assign(faces[t], tankFace(TANK_A, r.meetD, 0, tank.x, tank.z, { ...faces[t] }));
    const shoot = (ammo: 'ap' | 'he', rightBy = 0) => {
      const face = { ...faces[t], x: faces[t].x + Math.cos(faces[t].yaw) * rightBy, z: faces[t].z - Math.sin(faces[t].yaw) * rightBy };
      const aim = aimAt(tank, face, muzzlePoint, undefined, AMMO[ammo].speed);
      const origin = hullToWorld(tank, muzzlePoint(aim.yaw, aim.elevation, [0, 0, 0]), [0, 0, 0]);
      const dir = hullDirToWorld(tank, barrelDirection(aim.yaw, aim.elevation, [0, 0, 0]), [0, 0, 0]);
      const result = flyShell(origin, dir, faces, createShotResult(), undefined, AMMO[ammo].speed);
      return { result, decision: decideShot(ammo, result, faces, soft, undefined, armoured), origin, dir };
    };
    const ap = shoot('ap');
    expect(ap.result.target).toBe(t);
    expect(ap.decision.target).toBe(t);
    const he = shoot('he');
    expect(he.result.target).toBe(t);
    expect(he.decision.target).toBe(-1);
    expect(describeRound('he', he.result, he.decision, he.origin, he.dir, faces, TARGET_NAMES)).toBe('HE on tank A: no effect on its armour');
    // An HE burst on the ground beside it does nothing either: it is not soft.
    const beside = shoot('he', ENEMY_TANK.length / 2 + 2);
    expect(beside.decision.target).toBe(-1);
  });

  it('share their places and whether they drive, reading what an older message leaves out', () => {
    const b = tanksAt(TANK_A, 77.5);
    b.start();
    b.kill(TANK_B);
    const s = sharedOf(b, noEnemies());
    expect(s.present).toEqual(Array.from({ length: ENEMY_COUNT }, () => true));
    expect(s.d[TANK_A]).toBe(77.5);
    const back = parseShared(JSON.parse(JSON.stringify({ t: 'enemy', ...s })));
    expect(back).toEqual(s);
    // From a build before F3.3: the guns only, there while on.
    const old = parseShared({ on: true, alive: [true, false, true], hits: 2, shots: 5, v: 9 });
    expect(old?.present).toEqual([true, true, true, false, false]);
    expect(old?.alive).toEqual([true, false, true, true, true]);
    expect(old?.d).toEqual([0, 0, 0, 0, 0]);
  });

  it('says how the fight with the tanks stands', () => {
    const s = noEnemies();
    expect(batteryLine(s, 'tanks')).toBe('Enemy tanks off');
    s.on = true;
    s.present.fill(true, FIRST_TANK);
    s.alive[TANK_A] = false;
    s.hits = 2;
    s.shots = 5;
    expect(batteryLine(s, 'tanks')).toBe('1 of 2 tanks in action, 1 knocked out. Hits taken 2 of 5 shots');
    expect(batteryLine(s, 'guns')).toBe('Enemy guns off');
    s.alive[TANK_B] = false;
    expect(batteryLine(s, 'tanks')).toBe('All 2 tanks knocked out. Hits taken 2');
  });
});
