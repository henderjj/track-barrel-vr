import { describe, expect, it } from 'vitest';
import { rangeFaces } from '../src/sim/ballistics.js';
import { hullToSeat, SEAT_IDS, SEATS } from '../src/sim/cabin.js';
import { MAX_TRAVERSE_ACCEL } from '../src/sim/comfort.js';
import {
  ARRIVED,
  BotDriver,
  CALL_WORDS,
  chooseTarget,
  createDriveWish,
  createPath,
  CREW_CALLS,
  headingTo,
  idleLook,
  LAY,
  leverGrip,
  loadPlan,
  parseCall,
  pathAt,
  pathLength,
  restingHand,
  restingHandInSeat,
  ROUTE,
  steer,
  stepTowards,
  traverseDemand,
  TURN_STEP,
  twistAcross,
  twistForDemand,
  wheelGrip,
} from '../src/sim/crew-bot.js';
import { DRIVER_TILLER } from '../src/sim/driver-station.js';
import { createDrillHand, createLoadingSnapshot, HOLD_NONE, LoadingDrill } from '../src/sim/loading.js';
import { Lever, rollOf, TwistGrip, Wheel, wheelAngleOf } from '../src/sim/mechanism.js';
import { createControls, createTankDrive, IDLE_RPM, stepDrive, type TankDrive } from '../src/sim/tank-drive.js';
import {
  angleDelta,
  createGunnerInput,
  createTurretState,
  ELEVATION_WHEEL,
  POWER_GRIP,
  powerTraverseRate,
  stepTurret,
  TRAVERSE_CRANK,
  wrapAngle,
} from '../src/sim/turret.js';

const DEG = Math.PI / 180;
const DT = 1 / 60;

describe('practice crewmate', () => {
  it('rests its hands in front of it, in reach and inside the cabin, in either seat and with the turret turned', () => {
    const hand: [number, number, number] = [0, 0, 0];
    const local: [number, number, number] = [0, 0, 0];
    for (const id of SEAT_IDS) {
      const seat = SEATS[id];
      for (const turretYaw of [0, 1.2]) {
        for (const side of ['left', 'right'] as const) {
          restingHand(seat, turretYaw, side, hand);
          hullToSeat(seat, turretYaw, hand, local);
          const reach = Math.hypot(local[0] - seat.eye[0], local[1] - seat.eye[1], local[2] - seat.eye[2]);
          expect(reach).toBeLessThan(0.75);
          expect(local[2]).toBeLessThan(seat.eye[2]);
          // Between knee and chest height above the seat's floor.
          expect(local[1] - seat.floorY).toBeGreaterThan(0.45);
          expect(local[1] - seat.floorY).toBeLessThan(1.4);
        }
      }
    }
  });

  it('looks about gently, never far from the seat\'s way', () => {
    const look: [number, number] = [0, 0];
    let widest = 0;
    for (let t = 0; t < 60; t += 0.1) {
      idleLook(t, look);
      widest = Math.max(widest, Math.abs(look[0]));
      expect(Math.abs(look[1])).toBeLessThan(0.3);
    }
    expect(widest).toBeGreaterThan(0.2);
    expect(widest).toBeLessThan(0.6);
  });

  it('moves at a limited speed', () => {
    const p: [number, number, number] = [0, 0, 0];
    expect(stepTowards(p, [1, 0, 0], 0.25)).toBeCloseTo(0.75);
    expect(p[0]).toBeCloseTo(0.25);
    expect(stepTowards(p, [1, 0, 0], 1)).toBe(0);
    expect(p[0]).toBe(1);
  });
});

describe('practice crewmate: driving (F1.13)', () => {
  /** Drive the real tank simulation by the bot's wishes for `seconds`, the gearbox and all. */
  function run(bot: BotDriver, tank: TankDrive, seconds: number): void {
    const wish = createDriveWish();
    const controls = createControls();
    for (let t = 0; t < seconds; t += DT) {
      bot.update(DT, tank, wish);
      controls.left = wish.left;
      controls.right = wish.right;
      stepDrive(tank, controls, DT, []);
    }
  }

  it('stands until called, advances holding its heading, and halts', () => {
    const bot = new BotDriver();
    const tank = createTankDrive();
    run(bot, tank, 3);
    expect(tank.odometer).toBe(0);
    bot.call('advance', tank.heading);
    run(bot, tank, 15);
    expect(tank.z).toBeLessThan(-25);
    expect(Math.abs(tank.x)).toBeLessThan(0.5);
    expect(Math.abs(tank.heading)).toBeLessThan(1 * DEG);
    bot.call('halt', tank.heading);
    run(bot, tank, 6);
    expect(tank.speed).toBe(0);
    bot.call('reverse', tank.heading);
    const z = tank.z;
    run(bot, tank, 6);
    expect(tank.z).toBeGreaterThan(z + 3);
  });

  it('turns 45° on a call: on the spot at a halt, and on the move while advancing', () => {
    const bot = new BotDriver();
    const tank = createTankDrive();
    bot.call('left', tank.heading);
    run(bot, tank, 8);
    expect(tank.heading).toBeCloseTo(TURN_STEP, 1);
    expect(Math.hypot(tank.x, tank.z)).toBeLessThan(0.5);
    bot.call('advance', tank.heading);
    bot.call('right', tank.heading);
    run(bot, tank, 10);
    expect(Math.abs(tank.heading)).toBeLessThan(2 * DEG);
    expect(bot.motion).toBe('advance');
    expect(tank.speed).toBeGreaterThan(2);
  });

  it('settles on its new heading though it sees the tank a third of a second late (the levers and the network)', () => {
    const bot = new BotDriver();
    const tank = createTankDrive();
    const wish = createDriveWish();
    const controls = createControls();
    const late: TankDrive[] = [];
    bot.call('left', tank.heading);
    for (let t = 0; t < 15; t += DT) {
      late.push({ ...tank });
      const seen = late.length > 20 ? late.shift()! : late[0];
      bot.update(DT, seen, wish);
      controls.left = wish.left;
      controls.right = wish.right;
      stepDrive(tank, controls, DT, []);
    }
    expect(tank.heading).toBeCloseTo(TURN_STEP, 1);
    expect(tank.yawRate).toBe(0);
  });

  it('drives the route: up the road with a halt at each stop, back fast in 4th or 5th, and round again', () => {
    const bot = new BotDriver();
    const tank = createTankDrive();
    bot.call('route', tank.heading);
    const reached: number[] = [];
    const wish = createDriveWish();
    const controls = createControls();
    let grinding = 0;
    let fastest = 0;
    for (let t = 0; t < 600 && bot.arrivals < ROUTE.length + 1; t += DT) {
      const before = bot.arrivals;
      bot.update(DT, tank, wish);
      if (bot.arrivals > before) {
        reached.push(bot.leg);
        const leg = ROUTE[bot.leg];
        expect(Math.hypot(tank.x - leg.x, tank.z - leg.z)).toBeLessThan(ARRIVED + 0.5);
      }
      controls.left = wish.left;
      controls.right = wish.right;
      stepDrive(tank, controls, DT, []);
      if (tank.grinding) grinding++;
      fastest = Math.max(fastest, tank.speed);
      // The road's corridor: never more than a few metres off it.
      expect(Math.abs(tank.x)).toBeLessThan(5);
    }
    expect(reached).toEqual([0, 1, 2, 3, 0]);
    // Back to the start at 30 km/h: the automatic box's 4th or 5th.
    expect(fastest * 3.6).toBeGreaterThan(25);
    expect(grinding).toBe(0);
    // A call takes it off the route.
    bot.call('halt', tank.heading);
    expect(bot.mode).toBe('calls');
  });

  it('steers by the tracks: a left error slows the left track; a big one pivots', () => {
    const out = { left: 0, right: 0 };
    steer(0.9, 10 * DEG, 3, out);
    expect(out.left).toBeLessThan(out.right);
    // Turning at the gain's rate: 10°/s for 10° off.
    expect(((out.right - out.left) * 3) / 3).toBeCloseTo(10 * DEG);
    steer(0.9, 90 * DEG, 3, out);
    expect(out.left).toBeCloseTo(-out.right);
    steer(0, 0.5 * DEG, 3, out);
    expect(out).toEqual({ left: 0, right: 0 });
    expect(headingTo(-1, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('knows its calls', () => {
    for (const call of CREW_CALLS) {
      expect(parseCall(call)).toBe(call);
      expect(CALL_WORDS[call].length).toBeGreaterThan(3);
    }
    expect(parseCall('dance')).toBeNull();
    expect(parseCall(3)).toBeNull();
  });
});

describe('practice crewmate: gunning (F1.13)', () => {
  it('picks the nearest target it hasn\'t hit, within reach', () => {
    const faces = rangeFaces();
    expect(chooseTarget(0, 0, faces, [false, false, false], 620)).toBe(0);
    expect(chooseTarget(0, 0, faces, [true, false, false], 620)).toBe(1);
    expect(chooseTarget(0, 0, faces, [true, true, false], 400)).toBe(-1);
    // Up the road past the 250 m gun, the 500 m tank is nearer than the 100 m one behind.
    expect(chooseTarget(0, -350, faces, [false, true, false], 620)).toBe(2);
  });

  it('lays the turret onto an aim with the power traverse, without overshooting, close enough to hit', () => {
    for (const goal of [30 * DEG, -100 * DEG, 0.4 * DEG]) {
      const s = createTurretState();
      const input = createGunnerInput();
      let worst = 0;
      let t = 0;
      for (; t < 30; t += DT) {
        const error = angleDelta(s.yaw, goal);
        if (Math.abs(error) < LAY.yawDone && Math.abs(s.rate) < LAY.still) break;
        // Through the grip as a hand would twist it.
        const grip = new TwistGrip(POWER_GRIP);
        grip.angle = twistForDemand(POWER_GRIP, traverseDemand(error, s.rate, powerTraverseRate(IDLE_RPM), MAX_TRAVERSE_ACCEL));
        input.traverse = grip.demand();
        stepTurret(s, input, IDLE_RPM, DT);
        worst = Math.max(worst, Math.sign(goal) * angleDelta(goal, s.yaw));
      }
      expect(Math.abs(angleDelta(s.yaw, goal))).toBeLessThan(LAY.yawDone);
      expect(worst).toBeLessThan(0.2 * DEG);
      expect(t).toBeLessThan(Math.abs(goal) / powerTraverseRate(IDLE_RPM) + 8);
    }
  });

  it('turns a twist demand into the twist that reads as it', () => {
    const grip = new TwistGrip(POWER_GRIP);
    for (const d of [-1, -0.3, 0.02, 0.5, 1]) {
      grip.angle = twistForDemand(POWER_GRIP, d);
      expect(grip.demand()).toBeCloseTo(d, 6);
    }
    expect(twistForDemand(POWER_GRIP, 0)).toBe(0);
    const across: [number, number, number] = [0, 0, 0];
    expect(rollOf(twistAcross(0.3, across))).toBeCloseTo(0.3);
  });

  it('puts its hand on a lever\'s handle and a wheel\'s rim or knob where the kit takes hold', () => {
    const p: [number, number, number] = [0, 0, 0];
    const lever = new Lever(DRIVER_TILLER);
    for (const a of [-20 * DEG, 0, 15 * DEG]) {
      lever.angle = a;
      leverGrip(DRIVER_TILLER, a, p);
      expect(lever.reach(0, { fist: p, across: [1, 0, 0], tip: null, trigger: 0, tracked: false })).toBeLessThan(1e-9);
    }
    for (const spec of [ELEVATION_WHEEL, TRAVERSE_CRANK]) {
      const wheel = new Wheel(spec);
      wheel.angle = spec.grip === 'crank' ? 1 : 0;
      wheelGrip(spec, wheel.angle, p);
      expect(wheel.reach(0, { fist: p, across: [1, 0, 0], tip: null, trigger: 0, tracked: false })).toBeLessThan(1e-9);
      expect(wheelAngleOf(p[0], p[1])).toBeCloseTo(wrapAngle(wheel.angle));
    }
  });

  /** Play a loading plan through the loading rules with the right hand. */
  function play(drill: LoadingDrill, elevation: number): number {
    const keys = createPath();
    const left = createDrillHand();
    const right = createDrillHand();
    right.present = true;
    const rest = restingHandInSeat(SEATS.gunner, 'right', [0, 0, 0]);
    const s = createLoadingSnapshot();
    drill.snapshot(s);
    const shell = s.shells.findIndex((x) => x.place === 'rack');
    const n = loadPlan(s, shell >= 0 ? s.shells[shell].centre : null, elevation, rest, keys);
    if (n === 0) return 0;
    const length = pathLength(keys, n);
    drill.elevation = elevation;
    for (let t = 0; t <= length + 0.2; t += DT) {
      right.pressed = pathAt(keys, n, t, right.pos);
      drill.update(DT, left, right);
    }
    return n;
  }

  it('loads through the loading rules: grab, swing, ram, close, at any elevation it lays', () => {
    for (const elevation of [0, -2 * DEG, 1.5 * DEG]) {
      const drill = new LoadingDrill();
      expect(play(drill, elevation)).toBeGreaterThan(0);
      expect(drill.loaded).toBe(true);
      expect(drill.stats.fumbles).toBe(0);
      expect(drill.holds.right).toBe(HOLD_NONE);
      expect(play(drill, elevation)).toBe(0);
    }
  });

  it('finishes a load someone else started: pushes a shell home, closes the lever, opens one closed on nothing', () => {
    // Rammed, lever open: close it.
    let drill = new LoadingDrill();
    play(drill, 0);
    drill.fire();
    const half = new LoadingDrill();
    half.lever = 1.0;
    half.version++;
    play(half, 0);
    expect(half.lever).toBeLessThan(0.05);
    play(half, 0);
    expect(half.loaded).toBe(true);
    // Part-way in: pushed home, then closed.
    drill = new LoadingDrill();
    const keys = createPath();
    const left = createDrillHand();
    const right = createDrillHand();
    right.present = true;
    const s = createLoadingSnapshot();
    drill.snapshot(s);
    const n = loadPlan(s, s.shells[0].centre, 0, restingHandInSeat(SEATS.gunner, 'right', [0, 0, 0]), keys);
    // Let go after the swing, before ramming (the fourth key puts the nose at the mouth).
    for (let t = 0; t <= keys[4].t + 0.3; t += DT) {
      right.pressed = pathAt(keys, n, t, right.pos) && t < keys[4].t + 0.2;
      drill.update(DT, left, right);
    }
    expect(drill.breechShell).toBe(0);
    expect(drill.rammed).toBe(false);
    play(drill, 0);
    expect(drill.rammed).toBe(true);
    play(drill, 0);
    expect(drill.loaded).toBe(true);
  });
});
