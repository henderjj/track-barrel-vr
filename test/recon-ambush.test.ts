import { describe, expect, it } from 'vitest';
import { AMBUSH, AmbushRun, ambushDebrief, ambushLine, COLUMN_COUNT, noAmbush, parseAmbush, type AmbushInput } from '../src/sim/ambush.js';
import { armouredTargets, ENEMY_TARGET_FIRST, softTargets, TARGET_NAMES, targetFaces } from '../src/sim/ballistics.js';
import {
  COLUMN,
  COLUMN_LENGTH,
  COLUMN_ROUTE,
  COLUMN_VEHICLES,
  columnPace,
  columnPose,
  columnStart,
  type ColumnState,
  gotAway,
  onRoad,
  stepColumn,
} from '../src/sim/column.js';
import { spotTime } from '../src/sim/combat.js';
import {
  ENEMY_COUNT,
  ENEMY_GUNS,
  EnemyBattery,
  type EnemyShot,
  enemyName,
  FIRST_COLUMN,
  FIRST_HILL,
  groupOf,
  groundBlocks,
  gunNear,
  isTank,
  obstaclesBlock,
  noEnemies,
  parseShared,
  sharedOf,
  type TankTarget,
} from '../src/sim/enemy-guns.js';
import type { RoutePose } from '../src/sim/enemy-tanks.js';
import { inReportView, noRecon, parseRecon, RECON, RECON_ENEMIES, reconDebrief, reconLine, ReconRun, reportLines, type ReconInput } from '../src/sim/recon.js';
import { FOG } from '../src/sim/range.js';
import { AMBUSH_WALL, CROSS_HALF, groundHeight, obstacleDistance, OBSTACLES, TILE, wrapTile } from '../src/sim/terrain.js';

const seeAll = () => true;
const LEAD = FIRST_COLUMN;
const LORRY_1 = FIRST_COLUMN + 1;
const REAR = FIRST_COLUMN + 3;

/** The crew's tank waiting in ambush, still. */
function inAmbush(): TankTarget {
  return { x: AMBUSH.x, ground: groundHeight(AMBUSH.x, AMBUSH.z), z: AMBUSH.z, heading: AMBUSH.heading, speed: 0 };
}

function vehicle(d: number, extra: Partial<ColumnState> = {}): ColumnState {
  return { present: true, alive: true, tracking: false, held: false, d, moving: true, pass: false, off: 0, blocked: 0, ...extra };
}

function column(): ColumnState[] {
  return COLUMN_VEHICLES.map((_, k) => vehicle(columnStart(k)));
}

function step(list: ColumnState[], seconds: number, sprung = false, dt = 0.05): void {
  for (let t = 0; t < seconds; t += dt) stepColumn(list, dt, sprung);
}

describe('the enemy column (F5.10)', () => {
  it('is a tank, two lorries and a tank, after the guns and the patrolling tanks among the enemies and the shells\' targets', () => {
    expect(COLUMN_VEHICLES.map((v) => v.kind)).toEqual(['tank', 'truck', 'truck', 'tank']);
    // The hill's attackers (F5.9) come after it.
    expect(FIRST_HILL).toBe(FIRST_COLUMN + 4);
    expect(groupOf(FIRST_HILL)).toBe('hill');
    expect(groupOf(LEAD)).toBe('column');
    expect(groupOf(FIRST_COLUMN - 1)).toBe('tanks');
    expect(enemyName(LEAD)).toBe('Lead tank');
    expect(enemyName(LORRY_1)).toBe('Lorry 1');
    expect(isTank(LEAD) && !isTank(LORRY_1) && isTank(REAR)).toBe(true);
    expect(targetFaces()).toHaveLength(ENEMY_TARGET_FIRST + ENEMY_COUNT);
    expect(TARGET_NAMES[ENEMY_TARGET_FIRST + LEAD]).toBe('lead tank');
    expect(TARGET_NAMES[ENEMY_TARGET_FIRST + LORRY_1]).toBe('lorry 1');
    // Only AP counts on its tanks; HE's blast counts on its lorries.
    expect(armouredTargets()[ENEMY_TARGET_FIRST + LEAD]).toBe(true);
    expect(armouredTargets()[ENEMY_TARGET_FIRST + LORRY_1]).toBe(false);
    expect(softTargets()[ENEMY_TARGET_FIRST + LORRY_1]).toBe(true);
    expect(softTargets()[ENEMY_TARGET_FIRST + REAR]).toBe(false);
  });

  it('drives a road that stays within 400 m of the ambush either way, its ends in the fog, along the cross road past it', () => {
    const p: RoutePose = { x: 0, z: 0, heading: 0 };
    for (let d = 0; d <= COLUMN_LENGTH; d += 5) {
      columnPose(d, 0, p);
      // The copy drawn is always this one.
      expect(Math.abs(p.x - AMBUSH.x)).toBeLessThanOrEqual(TILE / 2 - 5);
      expect(Math.abs(p.z - AMBUSH.z)).toBeLessThanOrEqual(TILE / 2 - 5);
    }
    for (const d of [0, COLUMN_LENGTH]) {
      columnPose(d, 0, p);
      expect(Math.hypot(p.x - AMBUSH.x, p.z - AMBUSH.z)).toBeGreaterThan(FOG.near);
    }
    // The long leg runs along the cross road's flat corridor (z ≡ 0), 240 m off.
    const [a, b] = COLUMN_ROUTE.points;
    expect(Math.abs(wrapTile(a[1]))).toBeLessThan(CROSS_HALF);
    expect(a[1]).toBe(b[1]);
    expect(AMBUSH.z - a[1]).toBe(240);
  });

  it('keeps clear of every house, wall and rock, passing room included', () => {
    const p: RoutePose = { x: 0, z: 0, heading: 0 };
    const n: [number, number] = [0, 0];
    for (let d = 0; d <= COLUMN_LENGTH; d += 3) {
      for (const off of [0, COLUMN.passOffset]) {
        columnPose(d, off, p);
        for (const o of OBSTACLES) expect(obstacleDistance(o, p.x, p.z, n), `${d} m along, ${off} off, near a ${o.kind} at ${o.x}, ${o.z}`).toBeGreaterThan(2);
      }
    }
  });

  it('faces the way it goes and pulls off to its right to pass', () => {
    const p: RoutePose = { x: 0, z: 0, heading: 0 };
    // On the long leg it drives west: heading a quarter turn left of -z.
    columnPose(400, 0, p);
    expect(p.heading).toBeCloseTo(Math.PI / 2, 6);
    const z = p.z;
    // West-bound, its right is north (-z).
    columnPose(400, COLUMN.passOffset, p);
    expect(p.z).toBeCloseTo(z - COLUMN.passOffset, 6);
    // Away up the last leg it faces north.
    columnPose(COLUMN_LENGTH - 20, 0, p);
    expect(p.heading).toBeCloseTo(0, 6);
    expect(onRoad(-1)).toBe(false);
    expect(onRoad(0)).toBe(true);
    expect(gotAway(COLUMN_LENGTH)).toBe(true);
  });

  it('drives on in order at its pace, the gaps kept', () => {
    const list = column();
    step(list, 20);
    list.forEach((v, k) => expect(v.d).toBeCloseTo(columnStart(k) + 20 * COLUMN.speed, 0));
    expect(list.every((v) => v.moving)).toBe(true);
  });

  it('stops behind a stopped vehicle, then pulls round it and comes back on the road', () => {
    const list = column();
    step(list, 20);
    // The lead knocked out: the lorry behind closes to `close` and waits.
    list[0].alive = false;
    step(list, 4);
    expect(list[1].moving).toBe(false);
    expect(list[0].d - list[1].d).toBeGreaterThanOrEqual(COLUMN.close - 0.01);
    expect(list[0].d - list[1].d).toBeLessThan(COLUMN.close + 1);
    // Held up, it pulls round.
    step(list, COLUMN.bypassAfter);
    expect(list[1].pass).toBe(true);
    step(list, 6);
    expect(list[1].d).toBeGreaterThan(list[0].d + COLUMN.close);
    expect(list[1].pass).toBe(false);
    step(list, 4);
    expect(list[1].off).toBe(0);
  });

  it('halts a tank that has the crew\'s tank; once sprung, the lorries run for it and get away at the road\'s end', () => {
    const list = column();
    step(list, 30);
    list[0].tracking = true;
    step(list, 1, true);
    expect(list[0].moving).toBe(false);
    // A lorry's pace sprung, and the pace behind a slower vehicle.
    const pair = [vehicle(100, { moving: true }), vehicle(100 - COLUMN.close - 0.1)];
    expect(columnPace(pair, 1, true, 0.05)).toBe(COLUMN.speed);
    expect(columnPace([vehicle(500), vehicle(100)], 1, true, 0.05)).toBe(COLUMN.run);
    step(list, 400, true);
    expect(gotAway(list[1].d) && gotAway(list[2].d)).toBe(true);
    expect(list[1].moving || list[2].moving).toBe(false);
    // The lead tank still has the crew: it stays.
    expect(list[0].d).toBeLessThan(COLUMN_LENGTH);
  });
});

describe('the column in the battery (F5.10)', () => {
  it('starts strung out behind the road\'s start, off the road and unseeing until it reaches it', () => {
    const b = new EnemyBattery(AMBUSH.seed);
    b.start(AMBUSH.seed, 'column');
    expect(b.groupOn('column')).toBe(true);
    expect(b.groupOn('guns')).toBe(false);
    expect(b.guns.slice(FIRST_COLUMN, FIRST_HILL).map((g) => g.d)).toEqual([0, -30, -60, -90]);
    expect(b.viewOf(LORRY_1, inAmbush(), seeAll)).toBe('none');
    expect(b.sprung).toBe(false);
  });

  it('is sprung by the crew\'s first shot, and only while it is out', () => {
    const b = new EnemyBattery();
    b.crewFired();
    expect(b.sprung).toBe(false);
    b.start(undefined, 'column');
    b.crewFired();
    expect(b.sprung).toBe(true);
    b.start(undefined, 'column');
    expect(b.sprung).toBe(false);
  });

  it('meets the crew hull down behind the ambush wall: the column sees only its turret, the crew sees the road', () => {
    const b = new EnemyBattery();
    b.start(undefined, 'column');
    const tank = inAmbush();
    let turret = 0;
    let seen = 0;
    const leg = COLUMN_ROUTE.points[0][0] - COLUMN_ROUTE.points[1][0];
    const eye: [number, number, number] = [AMBUSH.x, tank.ground + RECON.eye, AMBUSH.z];
    let crewSees = 0;
    for (let d = 0; d <= leg; d += 20) {
      b.guns[LEAD].d = d;
      const view = b.viewOf(LEAD, tank, seeAll);
      expect(view, `lead ${d} m along`).not.toBe('full');
      if (view === 'turret') turret++;
      const at = gunNear(LEAD, tank.x, tank.z, [0, 0], d);
      const top: [number, number, number] = [at[0], groundHeight(at[0], at[1]) + 2, at[1]];
      if (!groundBlocks(eye, top) && !obstaclesBlock(eye, top)) crewSees++;
      seen++;
    }
    // Mostly the turret shows; elsewhere a rise or a rock hides it all.
    expect(turret / seen).toBeGreaterThan(0.6);
    expect(crewSees / seen).toBeGreaterThan(0.9);
    // The wall stands between the spot and the road, square to the line to it.
    expect(AMBUSH_WALL.yaw).toBe(0);
    expect(AMBUSH.z - AMBUSH_WALL.z).toBe(9);
  });

  it('gives the crew time: a still tank behind the wall isn\'t spotted before the lead tank is level with it', () => {
    const b = new EnemyBattery(AMBUSH.seed);
    b.start(AMBUSH.seed, 'column');
    const tank = inAmbush();
    const out: EnemyShot[] = [];
    const p: RoutePose = { x: 0, z: 0, heading: 0 };
    let leadX = Infinity;
    for (let t = 0; t < 240 && !b.sprung; t += 0.05) {
      b.step(0.05, tank, seeAll, out);
      columnPose(b.guns[LEAD].d, 0, p);
      leadX = p.x;
    }
    expect(b.sprung).toBe(true);
    expect(leadX).toBeLessThan(AMBUSH.x);
  });

  it('fires only from its tanks, the lorries never', () => {
    const b = new EnemyBattery(AMBUSH.seed);
    b.start(AMBUSH.seed, 'column');
    for (const g of b.guns.slice(FIRST_COLUMN, FIRST_HILL)) g.d = 400;
    b.guns[LORRY_1].d = 430;
    for (let k = 0; k < 4; k++) b.guns[FIRST_COLUMN + k].d = 330 + k * 30;
    for (let k = 0; k < 4; k++) b.guns[FIRST_COLUMN + k].spot = 1;
    const tank = inAmbush();
    const out: EnemyShot[] = [];
    const shots: EnemyShot[] = [];
    for (let t = 0; t < 30; t += 0.05) {
      b.step(0.05, tank, seeAll, out);
      shots.push(...out);
    }
    expect(b.sprung).toBe(true);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => isTank(s.gun))).toBe(true);
  });

  it('shares whether it is sprung and who is passing, reading an older message without them', () => {
    const b = new EnemyBattery();
    b.start(undefined, 'column');
    b.crewFired();
    b.guns[LORRY_1].pass = true;
    const s = sharedOf(b, noEnemies());
    const back = parseShared(JSON.parse(JSON.stringify({ t: 'enemy', ...s })));
    expect(back).toEqual(s);
    expect(back?.sprung).toBe(true);
    expect(back?.pass[LORRY_1]).toBe(true);
    const old = parseShared({ on: true, alive: [true, true, true], hits: 0, v: 1 });
    expect(old?.sprung).toBe(false);
    expect(old?.pass).toEqual(Array.from({ length: ENEMY_COUNT }, () => false));
  });
});

describe('ambush a column (F5.10)', () => {
  const input = (patch: Partial<AmbushInput> = {}): AmbushInput => ({
    tankOut: false,
    out: [false, false, false, false],
    away: [false, false, false, false],
    sprung: false,
    spotted: false,
    shots: 0,
    hits: 0,
    through: 0,
    ...patch,
  });

  it('notes when it was sprung and by whom, and wins on three knocked out', () => {
    const r = new AmbushRun();
    r.start();
    r.step(30, input());
    expect(r.snap.sprungAt).toBe(-1);
    r.step(1, input({ sprung: true }));
    expect(r.snap.sprungAt).toBe(31);
    expect(r.snap.seen).toBe(false);
    expect(r.step(1, input({ sprung: true, out: [true, true, true, false] }))).toBe(false);
    expect(r.step(1, input({ sprung: true, out: [true, true, true, false], away: [false, false, false, true] }))).toBe(true);
    expect(r.snap.phase).toBe('won');
    expect(ambushDebrief(r.snap)).toEqual(['Ambush won: 3 of 4 knocked out', '1 tank and 2 lorries out, 1 got away, sprung at 0:31, 0 hits taken of 0 shots, 0 through']);
  });

  it('loses when the column gets away with two, or when the tank is knocked out', () => {
    const r = new AmbushRun();
    r.start();
    r.step(1, input({ sprung: true, spotted: true }));
    expect(r.snap.seen).toBe(true);
    r.step(1, input({ out: [true, true, false, false], away: [false, false, true, true] }));
    expect(r.snap.phase).toBe('lost');
    expect(ambushDebrief(r.snap)[0]).toBe('The column got away: 2 of 4 knocked out');
    r.start();
    r.step(70, input({ tankOut: true, hits: 3, through: 3, shots: 5 }));
    expect(r.snap.phase).toBe('lost');
    expect(ambushDebrief(r.snap)[0]).toBe('Knocked out after 1:10');
    r.start();
    r.step(95, input({ out: [true, true, true, true] }));
    expect(ambushDebrief(r.snap)[0]).toBe('Column destroyed in 1:35');
  });

  it('shares its run, and its menu line', () => {
    expect(ambushLine(noAmbush())).toBe('Ambush a column: off');
    const r = new AmbushRun();
    r.start();
    r.step(12, input());
    expect(ambushLine(r.snap)).toBe('Waiting in ambush, 0:12. 0 tanks and 0 lorries out, 0 got away, not sprung, 0 hits taken of 0 shots, 0 through');
    const back = parseAmbush(JSON.parse(JSON.stringify({ t: 'ambush', ...r.snap })));
    expect(back).toEqual(r.snap);
    expect(parseAmbush({ phase: 'maybe', time: 1, v: 1 })).toBeNull();
    expect(COLUMN_COUNT).toBe(4);
  });
});

describe('recon unseen (F5.10)', () => {
  it('reports an enemy in view with the gun on it, not one behind the gun or past its range', () => {
    // Parked where Meet gun A parks (the gun sees it from there, so it sees the gun), the gun turned on it.
    const g = ENEMY_GUNS[0];
    const ground = groundHeight(0, g.meetZ);
    const at = gunNear(0, 0, g.meetZ, [0, 0]);
    const toGun = Math.atan2(-at[0], -(at[1] - g.meetZ));
    expect(inReportView(0, 0, g.meetZ, ground, toGun, 0, seeAll)).toBe(true);
    expect(inReportView(0, 0, g.meetZ, ground, toGun + RECON.cone * 0.9, 0, seeAll)).toBe(true);
    expect(inReportView(0, 0, g.meetZ, ground, toGun + RECON.cone * 1.1, 0, seeAll)).toBe(false);
    expect(inReportView(0, 0, g.meetZ, ground, toGun + Math.PI, 0, seeAll)).toBe(false);
    // Smoke in the way.
    expect(inReportView(0, 0, g.meetZ, ground, toGun, 0, () => false)).toBe(false);
    // From the start, the ground hides it.
    const from0 = gunNear(0, 0, 0, [0, 0]);
    expect(inReportView(0, 0, 0, 0, Math.atan2(-from0[0], -from0[1]), 0, seeAll)).toBe(false);
  });

  it('can be done: each gun can be reported from somewhere up the lane, halted, well before it spots the tank', () => {
    const b = new EnemyBattery();
    b.start(undefined, 'guns');
    for (let i = 0; i < ENEMY_GUNS.length; i++) {
      let best = 0;
      for (let z = 0; z >= -500; z -= 10) {
        const ground = groundHeight(0, z);
        const at = gunNear(i, 0, z, [0, 0]);
        if (!inReportView(i, 0, z, ground, Math.atan2(-at[0], -(at[1] - z)), 0, seeAll)) continue;
        const view = b.viewOf(i, { x: 0, ground, z, heading: 0, speed: 0 }, seeAll);
        const range = Math.hypot(at[0], at[1] - z);
        best = Math.max(best, view === 'none' || range > 600 ? Infinity : spotTime({ range, view, moving: false, fired: false, alert: false, driving: false }));
      }
      expect(best, ENEMY_GUNS[i].name).toBeGreaterThan(2 * RECON.reportFor);
    }
  });

  const input = (patch: Partial<ReconInput> = {}): ReconInput => ({
    fromStart: 300,
    laid: [false, false, false, false, false],
    out: [false, false, false, false, false],
    spot: [0, 0, 0, 0, 0],
    spottedBy: -1,
    ...patch,
  });

  it('reports after the gun has been on it 3 s in all, counts one knocked out as found, and wins back at the start', () => {
    const r = new ReconRun();
    r.start();
    const laid = [true, false, false, false, false];
    r.step(2, input({ laid }));
    expect(r.snap.reported[0]).toBe(false);
    r.step(0.5, input());
    r.step(1, input({ laid }));
    expect(r.snap.reported[0]).toBe(true);
    r.step(1, input({ out: [false, true, false, false, false] }));
    expect(r.snap.reported[1]).toBe(true);
    for (const i of [2, 3, 4]) {
      const l = [false, false, false, false, false];
      l[i] = true;
      r.step(RECON.reportFor, input({ laid: l }));
    }
    expect(r.snap.reported.every(Boolean)).toBe(true);
    expect(r.step(1, input())).toBe(false);
    expect(r.step(1, input({ fromStart: RECON.home - 1 }))).toBe(true);
    expect(r.snap.phase).toBe('won');
    expect(reconDebrief(r.snap)[0]).toMatch(/^Recon complete in 0:1\d$/);
  });

  it('warns when an enemy nearly has it, and is lost the moment one spots it', () => {
    const r = new ReconRun();
    r.start();
    r.step(1, input({ spot: [0, 0.55, 0, 0, 0] }));
    expect(r.snap.warned).toBe(1);
    expect(r.snap.watch).toBe(0.6);
    r.step(1, input({ spot: [0, 0.52, 0, 0, 0] }));
    expect(r.snap.warned).toBe(1);
    r.step(1, input({ spot: [0, 0.2, 0, 0, 0] }));
    r.step(1, input({ spot: [0, 0.6, 0, 0, 0] }));
    expect(r.snap.warned).toBe(2);
    r.fired();
    expect(r.step(1, input({ spottedBy: 2 }))).toBe(true);
    expect(r.snap.phase).toBe('lost');
    expect(reconDebrief(r.snap)).toEqual(['Spotted by Gun C at 0:05', '0 of 5 reported, 1 fired']);
  });

  it('shares its run, and its lines', () => {
    expect(reconLine(noRecon())).toBe('Recon unseen: off');
    expect(reportLines(3, 284, 2)).toEqual(['Reported: Tank A, 280 m', '2 still to find']);
    expect(RECON_ENEMIES).toBe(5);
    const r = new ReconRun();
    r.start();
    r.step(65, input({ spot: [0.31, 0, 0, 0, 0] }));
    expect(reconLine(r.snap)).toBe('Recon, 1:05. 0 of 5 reported, closest call 31%. Being watched 30%');
    const back = parseRecon(JSON.parse(JSON.stringify({ t: 'recon', ...r.snap })));
    expect(back).toEqual(r.snap);
    expect(parseRecon({ phase: 'on' })).toBeNull();
  });
});
