import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, INSTANT_SPOTTING } from '../src/sim/combat.js';
import { applyHit, freshDamage, resolveDamage } from '../src/sim/damage.js';
import {
  ENEMY_COUNT,
  ENEMY_GUN,
  EnemyBattery,
  type EnemyShot,
  FIRST_TANK,
  parseShot,
  prefersConvoy,
  resolveShot,
  type TankTarget,
  type TruckTarget,
} from '../src/sim/enemy-guns.js';
import { ENEMY_TANKS } from '../src/sim/enemy-tanks.js';
import {
  convoyToGo,
  copyEscort,
  driveTrucks,
  ESCORT,
  escortBoard,
  escortDebrief,
  type EscortInput,
  escortLine,
  EscortRun,
  noEscort,
  parseEscort,
  TRUCK,
  truckExposed,
  trucksIn,
  trucksLeft,
} from '../src/sim/escort.js';
import { rng } from '../src/sim/random.js';
import { onRoad } from '../src/sim/range.js';
import { groundHeight, OBSTACLES, obstacleDistance } from '../src/sim/terrain.js';

const seeAll = () => true;

/** The tank on the road at d (z = -d), facing up it. */
function tankAt(d: number, speed = 0): TankTarget {
  return { x: 0, ground: groundHeight(0, -d), z: -d, heading: 0, speed };
}

/** The convoy's trucks as the enemy sees them, from a run's snapshot. */
function trucksOf(s = noEscort()): TruckTarget[] {
  return s.d.map((d, k) => {
    const x = s.alive[k] ? ESCORT.x : ESCORT.wreckX;
    return { x, ground: groundHeight(x, -d), z: -d, heading: 0, speed: s.speed[k], alive: s.alive[k] && truckExposed(d) };
  });
}

/** Trucks closed up behind the tank at `tankD`, still. */
function closedUp(tankD: number): TruckTarget[] {
  const r = new EscortRun();
  r.start();
  r.closeUp(tankD);
  return trucksOf(r.snap);
}

/** Only gun A in the fight. */
function gunA(tuning = DEFAULT_TUNING): EnemyBattery {
  const b = new EnemyBattery(3, tuning);
  b.start(3);
  b.kill(1);
  b.kill(2);
  return b;
}

/** Step a battery `seconds`; every shot fired. */
function run(b: EnemyBattery, tank: TankTarget, seconds: number, trucks?: TruckTarget[], dt = 1 / 30): EnemyShot[] {
  const all: EnemyShot[] = [];
  const out: EnemyShot[] = [];
  for (let t = 0; t < seconds; t += dt) {
    b.step(dt, tank, seeAll, out, trucks);
    all.push(...out);
  }
  return all;
}

const input = (f: Partial<EscortInput> = {}): EscortInput => ({
  tankD: 0,
  out: false,
  gunsKilled: 0,
  killed: 0,
  enemies: 3,
  truckShots: 0,
  shots: 0,
  hits: 0,
  through: 0,
  ...f,
});

/** Run the convoy `seconds` with the tank at `tankD`. */
function steps(r: EscortRun, seconds: number, f: Partial<EscortInput> = {}, dt = 0.1): void {
  for (let t = 0; t < seconds && r.snap.phase === 'on'; t += dt) r.step(dt, input(f));
}

describe('the convoy (F5.8)', () => {
  it('waits at the start, the gap behind the tank, a spacing apart, on the road', () => {
    const s = noEscort();
    expect(s.d).toEqual([-50, -70, -90, -110]);
    expect(ESCORT.start).toBe(-ESCORT.gap);
    for (const d of s.d) expect(onRoad(ESCORT.x, -d)).toBe(true);
    // A truck is narrower than the road's half it drives on, with room to pass a wreck on the verge.
    expect(ESCORT.x - TRUCK.width / 2).toBeGreaterThan(0);
    expect(ESCORT.wreckX - ESCORT.x).toBeGreaterThan(TRUCK.width + 1);
    const r = new EscortRun();
    r.start();
    steps(r, 20);
    r.snap.d.forEach((d, k) => expect(d).toBeCloseTo(-50 - 20 * k, 1));
  });

  it('follows the tank at its gap, keeping its spacing, no faster than its top speed', () => {
    const r = new EscortRun();
    r.start();
    let top = 0;
    for (let t = 0; t < 120; t += 0.1) {
      r.step(0.1, input({ tankD: Math.min(300, t * 5) }));
      top = Math.max(top, ...r.snap.speed);
      for (let k = 1; k < 4; k++) expect(r.snap.d[k - 1] - r.snap.d[k]).toBeGreaterThanOrEqual(0.7 * ESCORT.spacing - 1e-9);
    }
    expect(top).toBeLessThanOrEqual(ESCORT.speed);
    expect(r.snap.d[0]).toBeCloseTo(300 - ESCORT.gap, 0);
    r.snap.d.forEach((d, k) => expect(d).toBeCloseTo(250 - 20 * k, 0));
  });

  it('halts where the tank halts, and backs away slowly if the tank backs into it', () => {
    const r = new EscortRun();
    r.start();
    r.closeUp(200);
    steps(r, 30, { tankD: 200 });
    expect(r.snap.d[0]).toBeCloseTo(150, 1);
    let slowest = 0;
    for (let t = 0; t < 30; t += 0.1) {
      r.step(0.1, input({ tankD: 170 }));
      slowest = Math.min(slowest, ...r.snap.speed);
    }
    expect(slowest).toBeGreaterThanOrEqual(-ESCORT.reverse);
    expect(r.snap.d[0]).toBeCloseTo(120, 0);
  });

  it('leaves a knocked-out truck where it stopped, the trucks behind closing on the one ahead', () => {
    const r = new EscortRun();
    r.start();
    r.closeUp(200);
    expect(r.knockOut(1, 0)).toBe(true);
    expect(r.knockOut(1, 0)).toBe(false);
    expect(r.snap.by).toEqual([-1, 0, -1, -1]);
    steps(r, 60, { tankD: 200 });
    expect(r.snap.d[1]).toBe(130);
    expect(r.snap.d[2]).toBeCloseTo(130, 0);
    expect(r.snap.d[3]).toBeCloseTo(110, 0);
    expect(trucksLeft(r.snap)).toBe(3);
  });

  it('drives in past the 600 m marker once the tank is there, and is won with the trucks still running', () => {
    const r = new EscortRun();
    r.start();
    r.closeUp(600);
    r.knockOut(2);
    steps(r, 1, { tankD: 590 });
    expect(r.snap.released).toBe(false);
    steps(r, 120, { tankD: 610 });
    expect(r.snap.released).toBe(true);
    expect(r.snap.phase).toBe('won');
    expect(trucksIn(r.snap)).toBe(3);
    expect(escortDebrief(r.snap)[0]).toMatch(/^Convoy through in \d:\d\d: 3 of 4 trucks$/);
  });

  it('is lost once fewer than two trucks run, or the tank is knocked out', () => {
    const r = new EscortRun();
    r.start();
    r.knockOut(0);
    r.knockOut(1);
    steps(r, 1);
    expect(r.snap.phase).toBe('on');
    r.knockOut(3);
    steps(r, 1);
    expect(r.snap.phase).toBe('lost');
    expect(r.snap.tankOut).toBe(false);
    expect(escortDebrief(r.snap)[0]).toMatch(/^Convoy lost after 0:0\d: 3 of 4 trucks knocked out$/);
    r.start();
    steps(r, 1, { out: true });
    expect(r.snap.phase).toBe('lost');
    expect(r.snap.tankOut).toBe(true);
    expect(escortDebrief(r.snap)[0]).toMatch(/^Escort knocked out after/);
    // Over, a truck can't be knocked out.
    expect(r.knockOut(0)).toBe(false);
  });

  it('brings the tanks up once the lead truck is 250 m up the road, or two guns are out', () => {
    const r = new EscortRun();
    r.start();
    r.closeUp(290);
    steps(r, 0.2, { tankD: 290 });
    expect(r.snap.tanksIn).toBe(false);
    r.closeUp(305);
    steps(r, 0.2, { tankD: 305 });
    expect(r.snap.tanksIn).toBe(true);
    const r2 = new EscortRun();
    r2.start();
    steps(r2, 0.2, { gunsKilled: 2 });
    expect(r2.snap.tanksIn).toBe(true);
  });

  it('shares its state, reading a broken message as nothing, and says it on the menu and the board', () => {
    const r = new EscortRun();
    r.start();
    r.closeUp(200);
    r.knockOut(3, 1);
    steps(r, 3, { tankD: 200, killed: 1, enemies: 3, truckShots: 4, shots: 2, hits: 1 });
    const back = parseEscort(JSON.parse(JSON.stringify({ t: 'escort', ...r.snap })));
    expect(back).toEqual(r.snap);
    expect(parseEscort({ phase: 'maybe', time: 0, v: 0 })).toBeNull();
    expect(parseEscort(null)).toBeNull();
    const copy = copyEscort(r.snap, noEscort());
    expect(copy).toEqual(r.snap);
    expect(copy.d).not.toBe(r.snap.d);
    expect(escortLine(noEscort())).toBe('Escort a convoy: off');
    expect(escortLine(r.snap)).toBe('Escorting, 0:03, 3 of 4 trucks. 1 of 3 enemies out, 4 shots at the trucks, 1 truck lost; hit 1 times, 0 through');
    expect(convoyToGo(r.snap)).toBe(450);
    const board = escortBoard(r.snap);
    expect(board.objective).toBe('Convoy to the 600 m marker, 450 m');
    expect(board.tasks.map((t) => t.text)).toEqual(['Trucks: 3 of 4 running', 'Enemies: 1 of 3 out', 'Lead them in: they follow you']);
  });

  it('a guest driving its trucks by the same rule stays with the host', () => {
    const host = new EscortRun();
    host.start();
    const guest = copyEscort(host.snap, noEscort());
    for (let t = 0; t < 60; t += 0.1) {
      const tankD = Math.min(250, t * 5);
      host.step(0.1, input({ tankD }));
      driveTrucks(guest, 0.1, tankD);
    }
    guest.d.forEach((d, k) => expect(d).toBeCloseTo(host.snap.d[k], 6));
  });
});

describe('the enemy and the convoy (F5.8)', () => {
  it('has the guns go for the trucks and the tanks for the escort', () => {
    for (let i = 0; i < ENEMY_COUNT; i++) expect(prefersConvoy(i)).toBe(i < FIRST_TANK);
  });

  it('sees no truck waiting at the start: they are in its cover there', () => {
    const b = new EnemyBattery(1);
    b.start(1, 'guns');
    b.start(1, 'tanks');
    const trucks = trucksOf();
    expect(trucks.every((t) => !t.alive)).toBe(true);
    for (let i = 0; i < ENEMY_COUNT; i++) expect(b.truckInView(i, trucks, seeAll)).toBe(-1);
    expect(truckExposed(-1)).toBe(false);
    expect(truckExposed(0)).toBe(true);
  });

  it('has gun A see the convoy closed up behind the tank where Ambush puts it, and lay on it first', () => {
    const b = gunA(INSTANT_SPOTTING);
    const tank = tankAt(ESCORT.ambushD);
    const trucks = closedUp(ESCORT.ambushD);
    expect(b.truckInView(0, trucks, seeAll)).toBeGreaterThanOrEqual(0);
    const shots = run(b, tank, ENEMY_GUN.layFirst + 0.5, trucks);
    expect(shots).toHaveLength(1);
    expect(shots[0].truck).toBeGreaterThanOrEqual(0);
    expect(b.truckShots).toBe(1);
    expect(b.shotsFired).toBe(0);
  });

  it('spots the convoy over time as it does the tank, and fires on it only once spotted', () => {
    const b = gunA();
    const tank = tankAt(ESCORT.ambushD);
    const trucks = closedUp(ESCORT.ambushD);
    expect(run(b, tank, 3, trucks)).toHaveLength(0);
    expect(b.guns[0].convoySpot).toBeGreaterThan(0);
    expect(b.guns[0].convoySpot).toBeLessThan(1);
    const later = run(b, tank, 60, trucks);
    expect(later.some((s) => s.truck !== undefined)).toBe(true);
  });

  it('has a gun fire on the tank when no truck is in its sight, and forgets the convoy out of sight', () => {
    const b = gunA(INSTANT_SPOTTING);
    const tank = tankAt(150);
    const trucks = trucksOf();
    const shots = run(b, tank, ENEMY_GUN.layFirst + 0.5, trucks);
    expect(shots).toHaveLength(1);
    expect(shots[0].truck).toBeUndefined();
    expect(b.guns[0].convoyTracking).toBe(false);
  });

  it('has an enemy tank fire on the escort before a truck', () => {
    const b = new EnemyBattery(5, INSTANT_SPOTTING);
    b.start(5, 'tanks');
    const j = 0;
    const i = FIRST_TANK + j;
    b.placeTank(i, ENEMY_TANKS[j].meetD);
    b.guns[FIRST_TANK + 1].present = false;
    const tank = tankAt(-ENEMY_TANKS[j].meetZ);
    // Trucks just ahead of the tank, in the enemy tank's sight with it.
    const trucks = closedUp(-ENEMY_TANKS[j].meetZ).map((t, k) => ({ ...t, z: tank.z - 10 - 5 * k, ground: groundHeight(t.x, tank.z - 10 - 5 * k) }));
    expect(b.truckInView(i, trucks, seeAll)).toBeGreaterThanOrEqual(0);
    const shots = run(b, tank, 30, trucks);
    expect(shots.length).toBeGreaterThan(0);
    expect(b.guns[i].convoyTracking).toBe(true);
    expect(shots.every((s) => s.truck === undefined)).toBe(true);
  });

  it('counts shots at the trucks apart from those at the tank, and hits a truck as one box its size', () => {
    const b = gunA(INSTANT_SPOTTING);
    const trucks = closedUp(ESCORT.ambushD);
    const shot = b.fireAtTruck(0, trucks[0], 0);
    expect(shot.truck).toBe(0);
    expect(b.truckShots).toBe(1);
    expect(b.hits).toBe(0);
    // Hits land inside the truck's box; a truck side-on at 250 m is hit about as often as the tank.
    const random = rng(9);
    let truckHits = 0;
    let tankHits = 0;
    const t = { ...trucks[0], x: 0, z: -150, ground: groundHeight(0, -150) };
    for (let k = 0; k < 400; k++) {
      const s = resolveShot(0, t, 3, random, 0, { truck: true });
      if (s.hit) {
        truckHits++;
        expect(s.to[1] - t.ground).toBeLessThanOrEqual(TRUCK.height + 1e-6);
      }
      if (resolveShot(0, tankAt(150), 3, random).hit) tankHits++;
    }
    expect(truckHits / 400).toBeGreaterThan(0.6);
    expect(Math.abs(truckHits - tankHits) / 400).toBeLessThan(0.2);
  });

  it('shares a shot at a truck with its index and no damage to the tank', () => {
    const b = gunA(INSTANT_SPOTTING);
    const trucks = closedUp(ESCORT.ambushD);
    const shot = b.fireAtTruck(0, trucks[2], 2);
    const back = parseShot(JSON.parse(JSON.stringify({ t: 'enemy-shot', ...shot, damage: { through: true } })));
    expect(back?.truck).toBe(2);
    expect(back?.damage).toBeUndefined();
    const old = parseShot(JSON.parse(JSON.stringify({ t: 'enemy-shot', ...shot, truck: undefined })));
    expect(old?.truck).toBeUndefined();
  });

  it('keeps the convoy off every obstacle on its way up the road', () => {
    const normal: [number, number] = [0, 0];
    for (let d = -110; d <= ESCORT.end + ESCORT.spacing * ESCORT.trucks; d += 2) {
      for (const x of [ESCORT.x, ESCORT.wreckX]) {
        for (const o of OBSTACLES) expect(obstacleDistance(o, x, -d, normal)).toBeGreaterThan(TRUCK.width / 2);
      }
    }
  });
});

describe('a convoy run headless (F5.8)', () => {
  /**
   * A crude crew that drives the tank up the road at 5 m/s and never fires:
   * the guns find the trucks behind it. The doc's numbers come from this and
   * crews that halt and knock out each enemy a set time after it fires.
   */
  it('loses the convoy driving straight through the ambush without a fight', () => {
    let lost = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const b = new EnemyBattery(seed);
      b.start(ESCORT.seed + seed, 'guns');
      const r = new EscortRun();
      r.start();
      const dmg = freshDamage();
      const random = rng(seed);
      const out: EnemyShot[] = [];
      let tankD = 0;
      for (let t = 0; t < 400 && r.snap.phase === 'on'; t += 0.1) {
        tankD = Math.min(ESCORT.end + 20, tankD + 0.5);
        const tank = tankAt(tankD, 5);
        b.step(0.1, tank, seeAll, out, trucksOf(r.snap));
        for (const shot of out) {
          if (!shot.hit) continue;
          if (shot.truck !== undefined) r.knockOut(shot.truck, shot.gun);
          else applyHit(dmg, resolveDamage(shot.from, shot.to, shot.range, { x: 0, z: -tankD, ground: tank.ground, heading: 0, turretYaw: 0 }, random));
        }
        const was = r.snap.tanksIn;
        r.step(0.1, input({ tankD, out: dmg.out }));
        if (r.snap.tanksIn && !was) b.start(undefined, 'tanks');
      }
      if (r.snap.phase === 'lost') lost++;
    }
    expect(lost).toBeGreaterThanOrEqual(8);
  });
});
