import { describe, expect, it } from 'vitest';
import {
  BATTERY_VOLTS,
  BOG_STALL_ACCEL,
  BOG_STALL_SECONDS,
  CATCH_SECONDS,
  CHOKE_HOLD,
  COLD_PULL,
  COLD_STALL_SECONDS,
  CRANK_RPM,
  CRANK_VOLTS,
  FLOOD_SECONDS,
  parseEngineStart,
  RUNNING_VOLTS,
  STARTER_LIMIT,
  STARTER_REST,
  stopEngine,
  volts,
  WARM_COOLANT,
} from '../src/sim/engine.js';
import { type Gear, IDLE_RPM, NEUTRAL } from '../src/sim/gearbox.js';
import { createControls, createTankDrive, type DriverControls, oilPressure, stepDrive, type TankDrive } from '../src/sim/tank-drive.js';

const DT = 1 / 60;

/** A tank with its engine stopped, cold. */
function stopped(): TankDrive {
  const s = createTankDrive();
  stopEngine(s);
  s.rpm = 0;
  return s;
}

function c(over: Partial<DriverControls> = {}): DriverControls {
  return { ...createControls(), ...over };
}

/** The Full procedure's controls, everything done right but the starter. */
function full(over: Partial<DriverControls> = {}): DriverControls {
  return c({ start: 'full', battery: true, ignition: true, choke: true, throttle: 0.3, ...over });
}

function run(s: TankDrive, controls: DriverControls, seconds: number, each?: (s: TankDrive, t: number) => void): TankDrive {
  for (let t = 0; t < seconds; t += DT) {
    stepDrive(s, controls, DT, []);
    each?.(s, t);
  }
  return s;
}

/** How long the starter cranks before it runs, s (Infinity if it never does within `limit`). */
function timeToCatch(s: TankDrive, controls: DriverControls, limit = 10): number {
  let caught = Infinity;
  run(s, { ...controls, starter: true }, limit, (t, at) => {
    if (t.running && caught === Infinity) caught = at;
  });
  return caught;
}

describe('engine start-up and stalls (F1.17)', () => {
  it('reads the Engine start setting', () => {
    expect(parseEngineStart('full', 'starter')).toBe('full');
    expect(parseEngineStart('nonsense', 'starter')).toBe('starter');
    expect(createControls().start).toBe('starter');
  });

  it('with the Starter button, cranks for a moment and catches; let go too soon, it starts over', () => {
    const s = stopped();
    run(s, c({ starter: true }), 0.6);
    expect(s.cranking).toBe(true);
    expect(s.running).toBe(false);
    expect(s.rpm).toBeGreaterThan(CRANK_RPM * 0.5);
    expect(s.rpm).toBeLessThanOrEqual(CRANK_RPM);
    // Let go: it stops turning, and the next press starts again from nothing.
    run(s, c(), 0.5);
    expect(s.cranking).toBe(false);
    expect(s.crankTime).toBe(0);
    expect(timeToCatch(s, c())).toBeCloseTo(CATCH_SECONDS, 1);
    expect(s.cranking).toBe(false);
    run(s, c(), 2);
    expect(s.rpm).toBeCloseTo(IDLE_RPM, -1);
    expect(s.stalls).toBe(0);
  });

  it('turns over only out of gear, or with the clutch held down', () => {
    const inGear = (s: TankDrive, gear: Gear) => {
      s.gear = gear;
      return s;
    };
    expect(timeToCatch(inGear(stopped(), 2), c({ mode: 'clutch', gear: 2 }), 3)).toBe(Infinity);
    expect(timeToCatch(inGear(stopped(), 2), c({ mode: 'clutch', gear: 2, clutch: 1 }), 3)).toBeLessThan(3);
    expect(timeToCatch(stopped(), c({ mode: 'clutch', gear: NEUTRAL }), 3)).toBeLessThan(3);
    // Stick shift works its clutch for the driver; the automatic box sits in neutral while the engine is stopped.
    expect(timeToCatch(inGear(stopped(), 2), c({ mode: 'stick', gear: 2 }), 3)).toBeLessThan(3);
    const auto = inGear(stopped(), 3);
    run(auto, c(), 0.1);
    expect(auto.gear).toBe(NEUTRAL);
    expect(timeToCatch(auto, c(), 3)).toBeLessThan(3);
  });

  it('in the Full procedure, needs the battery to turn and the ignition to fire, and overheats the starter after 30 s', () => {
    const dead = stopped();
    run(dead, full({ battery: false, starter: true }), 1);
    expect(dead.cranking).toBe(false);
    expect(dead.power).toBe(false);
    expect(volts(dead)).toBe(0);

    const noSpark = stopped();
    run(noSpark, full({ ignition: false, starter: true }), 1);
    expect(noSpark.cranking).toBe(true);
    expect(volts(noSpark)).toBe(CRANK_VOLTS);
    run(noSpark, full({ ignition: false, starter: true }), STARTER_LIMIT);
    expect(noSpark.running).toBe(false);
    expect(noSpark.cranking).toBe(false);
    expect(noSpark.starterRest).toBeGreaterThan(STARTER_REST - 2);
    // Still hot: the starter won't turn, even let go and pressed again, until it has rested.
    run(noSpark, full(), 0.2);
    run(noSpark, full({ starter: true }), 1);
    expect(noSpark.cranking).toBe(false);
    run(noSpark, full(), STARTER_REST);
    expect(timeToCatch(noSpark, full())).toBeLessThan(1.5);
  });

  it('in the Full procedure, catches in 1 to 3 s: quickest with the choke out and the hand throttle a little open', () => {
    const best = timeToCatch(stopped(), full());
    const noChoke = timeToCatch(stopped(), full({ choke: false }));
    const shut = timeToCatch(stopped(), full({ choke: false, throttle: 0 }));
    expect(best).toBeCloseTo(1, 1);
    expect(noChoke).toBeGreaterThan(best + 1);
    expect(shut).toBeGreaterThan(noChoke + 0.5);
    expect(shut).toBeLessThanOrEqual(3.05);
  });

  it('started cold, dies if the choke goes in too soon, floods if it is left out, and runs if it is eased in', () => {
    const early = stopped();
    timeToCatch(early, full(), 2);
    run(early, full({ choke: false }), 0.5);
    expect(early.running).toBe(false);
    expect(early.stalls).toBe(1);
    expect(early.stallCause).toBe('choke');

    const flooded = stopped();
    timeToCatch(flooded, full(), 2);
    run(flooded, full({ throttle: 0.7 }), CHOKE_HOLD + 1);
    expect(flooded.running).toBe(true);
    expect(flooded.rough).toBe(true);
    run(flooded, full({ throttle: 0.7 }), FLOOD_SECONDS);
    expect(flooded.running).toBe(false);
    expect(flooded.stallCause).toBe('flood');

    const eased = stopped();
    timeToCatch(eased, full(), 2);
    run(eased, full({ throttle: 0.7 }), CHOKE_HOLD + 2);
    run(eased, full({ choke: false, throttle: 0.7 }), 20);
    expect(eased.running).toBe(true);
    expect(eased.rough).toBe(false);
    expect(eased.stalls).toBe(0);
  });

  it('cold, coughs and stalls at an 800 rpm idle, but runs at the hand throttle\'s 1300 until warm, and pulls less', () => {
    const slow = stopped();
    timeToCatch(slow, full({ choke: false }), 4);
    let coughs = 0;
    run(slow, full({ choke: false, throttle: 0 }), COLD_STALL_SECONDS + 4, (t) => (coughs = t.coughs));
    expect(coughs).toBeGreaterThan(3);
    expect(slow.running).toBe(false);
    expect(slow.stallCause).toBe('cold');

    const fast = stopped();
    timeToCatch(fast, full({ choke: false }), 4);
    run(fast, full({ choke: false, throttle: 1 / 3 }), 60);
    expect(fast.running).toBe(true);
    expect(fast.rpm).toBeGreaterThan(1300);
    run(fast, full({ choke: false, throttle: 1 / 3 }), 120);
    expect(fast.coolant).toBeGreaterThan(WARM_COOLANT);
    // Warm, it idles happily.
    run(fast, full({ choke: false, throttle: 0 }), 30);
    expect(fast.running).toBe(true);
    expect(fast.rough).toBe(false);

    // Pulling away cold in the Full procedure is slower than warm.
    const pull = (coolant: number) => {
      const s = createTankDrive();
      s.coolant = coolant;
      run(s, full({ choke: false, throttle: 1 / 3, left: 1, right: 1 }), 1.5);
      return s.speed;
    };
    expect(pull(20) / pull(80)).toBeCloseTo(COLD_PULL, 1);
  });

  it('stops when the ignition is switched off, without counting a stall', () => {
    const s = createTankDrive();
    run(s, full(), 0.5);
    expect(s.running).toBe(true);
    run(s, full({ ignition: false }), 2);
    expect(s.running).toBe(false);
    expect(s.stalls).toBe(0);
    expect(s.rpm).toBeLessThan(200);
    expect(oilPressure(s.rpm, s.coolant)).toBeLessThan(0.5);
  });

  it('with the Clutch, stalls when the clutch comes out in too high a gear: the needles drop and the tank coasts', () => {
    const s = createTankDrive();
    run(s, c({ mode: 'clutch', gear: 4, clutch: 1 }), 0.5);
    let bogged = 0;
    run(s, c({ mode: 'clutch', gear: 4 }), BOG_STALL_SECONDS + 1, (t) => (bogged += t.bogging ? DT : 0));
    expect(s.running).toBe(false);
    expect(s.stalls).toBe(1);
    expect(s.stallCause).toBe('bog');
    expect(bogged).toBeCloseTo(BOG_STALL_SECONDS, 1);
    expect(s.rpm).toBeLessThan(150);
    expect(oilPressure(s.rpm, s.coolant)).toBeLessThan(0.3);
    // Stopped, nothing drives the tracks; the accelerator does nothing.
    run(s, c({ mode: 'clutch', gear: 4, accel: 1 }), 1);
    expect(s.speed).toBe(0);
    // More accelerator keeps it labouring longer before it dies.
    const floored = createTankDrive();
    run(floored, c({ mode: 'clutch', gear: 4, clutch: 1 }), 0.5);
    run(floored, c({ mode: 'clutch', gear: 4, accel: 1 }), BOG_STALL_SECONDS + 1);
    expect(floored.running).toBe(true);
    run(floored, c({ mode: 'clutch', gear: 4, accel: 1 }), BOG_STALL_ACCEL);
    expect(floored.running).toBe(false);
  });

  it('coasts after a stall on the move, and restarts on the starter with the clutch in', () => {
    const s = run(createTankDrive(), c({ mode: 'clutch', gear: 2, clutch: 1 }), 0.5);
    // Feathered out over two seconds with the accelerator down.
    for (let t = 0; t < 2; t += DT) stepDrive(s, c({ mode: 'clutch', gear: 2, accel: 0.6, clutch: 1 - t / 2 }), DT, []);
    run(s, c({ mode: 'clutch', gear: 2, accel: 1 }), 2);
    expect(s.speed).toBeGreaterThan(1.5);
    stopEngine(s, 'bog');
    const moving = s.speed;
    run(s, c({ mode: 'clutch', gear: 2 }), 1);
    expect(s.speed).toBeLessThan(moving);
    expect(s.speed).toBeGreaterThan(moving - 0.5);
    expect(timeToCatch(s, c({ mode: 'clutch', gear: 2, clutch: 1 }), 3)).toBeLessThan(2);
  });

  it('starts by itself when the setting changes to Running', () => {
    const s = stopped();
    run(s, c(), 0.5);
    expect(s.running).toBe(false);
    run(s, c({ start: 'running' }), 0.1);
    expect(s.running).toBe(true);
  });

  it('reads 24 V on the battery, dips while cranking and charges at 28 V running', () => {
    const s = stopped();
    expect(volts(s)).toBe(BATTERY_VOLTS);
    s.cranking = true;
    expect(volts(s)).toBe(CRANK_VOLTS);
    s.running = true;
    expect(volts(s)).toBe(RUNNING_VOLTS);
  });
});
