import { describe, expect, it } from 'vitest';
import { decodeTankState, encodeTankState, TANK_STATE_BYTES } from '../src/net/tank-codec.js';
import { BOT_COOL_HALT, BOT_COOL_RESUME, BotDriver, createDriveWish, startTask } from '../src/sim/crew-bot.js';
import { DIALS, LAMP, LAMPS, OVERHEAT_COOLANT, TEMP_LAMP_COOLANT, zoneOf } from '../src/sim/driver-station.js';
import {
  FADE_COOLANT,
  HEAT_STALL_COOLANT,
  HEAT_STALL_SECONDS,
  heatPull,
  HOT_COOLANT,
  HOT_PULL,
  KNOCK_COOLANT,
  RESTART_COOLANT,
  STALL_CAUSES,
} from '../src/sim/engine.js';
import { DOWN_RPM, type Gear, IDLE_RPM, MAX_RPM, NEUTRAL, REVERSE, TOP_GEAR, UP_RPM } from '../src/sim/gearbox.js';
import { LOW_OIL } from '../src/sim/driver-station.js';
import {
  COOLANT_FULL,
  COOLANT_IDLE,
  coolantTarget,
  createControls,
  createTankDrive,
  type DriverControls,
  engineStrain,
  oilPressure,
  stepDrive,
  stepEngineGauges,
  STRAIN_HEAT,
  type TankDrive,
} from '../src/sim/tank-drive.js';

const DT = 1 / 30;

function c(over: Partial<DriverControls> = {}): DriverControls {
  return { ...createControls(), ...over };
}

/** A warm tank. */
function warm(): TankDrive {
  const s = createTankDrive();
  s.coolant = COOLANT_IDLE;
  return s;
}

/** Run `seconds`, stopping early when `until` says so; returns the time taken (Infinity if never). */
function run(s: TankDrive, controls: DriverControls, seconds: number, until?: (s: TankDrive) => boolean): number {
  for (let t = 0; t < seconds; t += DT) {
    stepDrive(s, controls, DT, []);
    if (until?.(s)) return t;
  }
  return until ? Infinity : seconds;
}

/** Revved flat out in `gear` with the Stick shift's accelerator. */
const flatOut = (gear: Gear) => c({ mode: 'stick', gear, accel: 1 });

describe('overheating (F3.7)', () => {
  it('labours only revved past the change-up point, most in the low gears, none in neutral or top', () => {
    expect(engineStrain(UP_RPM, 1)).toBe(0);
    expect(engineStrain(MAX_RPM, 1)).toBe(1);
    expect(engineStrain(MAX_RPM, NEUTRAL)).toBe(0);
    expect(engineStrain(MAX_RPM, TOP_GEAR)).toBe(0);
    expect(engineStrain(MAX_RPM, 2)).toBeLessThan(1);
    expect(engineStrain(MAX_RPM, 3)).toBeLessThan(engineStrain(MAX_RPM, 2));
    expect(engineStrain(MAX_RPM, REVERSE)).toBeGreaterThan(0);
    // Flat out in neutral or top it runs as hot as Phase 1's engine did, no hotter.
    expect(coolantTarget(MAX_RPM, NEUTRAL)).toBe(COOLANT_FULL);
    expect(coolantTarget(MAX_RPM, TOP_GEAR)).toBe(COOLANT_FULL);
    expect(coolantTarget(MAX_RPM, 1)).toBe(COOLANT_FULL + STRAIN_HEAT);
    expect(coolantTarget(MAX_RPM, 1)).toBeGreaterThan(HEAT_STALL_COOLANT);
    // In 2nd and 3rd it heads for hot but never so hot it stalls.
    for (const gear of [2, 3] as const) {
      expect(coolantTarget(MAX_RPM, gear), `gear ${gear}`).toBeGreaterThan(HOT_COOLANT);
      expect(coolantTarget(MAX_RPM, gear), `gear ${gear}`).toBeLessThan(HEAT_STALL_COOLANT);
    }
    // Driven in the green it runs normal.
    expect(coolantTarget((DOWN_RPM + UP_RPM) / 2, 1)).toBeLessThan(COOLANT_FULL);
  });

  it('keeps its pull to the fade, then loses it down to half', () => {
    expect(heatPull(COOLANT_FULL)).toBe(1);
    expect(heatPull(FADE_COOLANT)).toBe(1);
    expect(heatPull((FADE_COOLANT + HEAT_STALL_COOLANT) / 2)).toBeCloseTo((1 + HOT_PULL) / 2, 6);
    expect(heatPull(HEAT_STALL_COOLANT)).toBe(HOT_PULL);
    expect(heatPull(130)).toBe(HOT_PULL);
    expect(FADE_COOLANT).toBeGreaterThan(HOT_COOLANT);
    expect(KNOCK_COOLANT).toBeGreaterThan(FADE_COOLANT);
    expect(RESTART_COOLANT).toBeLessThan(KNOCK_COOLANT);
  });

  it('flat out in 1st: hot within a minute or so, knocking, slower, and stalled from the heat after about four minutes', () => {
    const s = warm();
    const hot = run(s, flatOut(1), 120, (t) => t.coolant >= HOT_COOLANT);
    expect(hot).toBeGreaterThan(30);
    expect(hot).toBeLessThan(90);
    const knock = run(s, flatOut(1), 200, (t) => t.coolant >= KNOCK_COOLANT);
    expect(knock).toBeLessThan(200);
    // Knocking: rough and coughing.
    run(s, flatOut(1), 2);
    expect(s.rough).toBe(true);
    const coughs = s.coughs;
    run(s, flatOut(1), 3);
    expect(s.coughs).toBeGreaterThan(coughs);
    // Held at the stall point long enough, it dies.
    let atStall = 0;
    const stalled = run(s, flatOut(1), 300, (t) => {
      if (t.coolant >= HEAT_STALL_COOLANT) atStall += DT;
      return !t.running;
    });
    expect(stalled).toBeLessThan(300);
    expect(s.stallCause).toBe('heat');
    expect(atStall).toBeCloseTo(HEAT_STALL_SECONDS, 0);
  });

  it('pulls away slower overheating', () => {
    const cool = warm();
    const hot = warm();
    hot.coolant = 120;
    run(cool, flatOut(2), 3);
    run(hot, flatOut(2), 3);
    expect(hot.speed).toBeLessThan(cool.speed * 0.85);
  });

  it('cools back down when changed up or idled, and the knock goes', () => {
    for (const controls of [c({ mode: 'stick', gear: 4, accel: 0.6 }), c({ mode: 'stick', gear: NEUTRAL })]) {
      const s = warm();
      s.coolant = 114;
      run(s, controls, 2);
      const cool = run(s, controls, 180, (t) => t.coolant < HOT_COOLANT);
      expect(cool).toBeLessThan(120);
      expect(s.rough).toBe(false);
      expect(s.running).toBe(true);
    }
  });

  it('won\'t fire again too hot: the starter turns, but it catches only once cooled below the restart point', () => {
    const s = warm();
    s.coolant = 125;
    run(s, flatOut(1), HEAT_STALL_SECONDS + 1);
    expect(s.running).toBe(false);
    run(s, c({ starter: true }), 5);
    expect(s.cranking).toBe(true);
    expect(s.running).toBe(false);
    // Left to stand, it cools to the restart point in a minute or two.
    const waited = run(s, c(), 300, (t) => t.coolant <= RESTART_COOLANT);
    expect(waited).toBeGreaterThan(30);
    expect(waited).toBeLessThan(150);
    run(s, c({ starter: true }), 3);
    expect(s.running).toBe(true);
  });

  it('never overheats flat out in 2nd, 3rd, top or neutral, however long', () => {
    for (const gear of [NEUTRAL, 2, 3, TOP_GEAR] as const) {
      const s = warm();
      s.rpm = MAX_RPM;
      s.gear = gear;
      for (let i = 0; i < 3600; i++) stepEngineGauges(s, 1);
      expect(s.coolant, `gear ${gear}`).toBeLessThan(HEAT_STALL_COOLANT);
    }
  });

  it('reads lower oil pressure overheating, still above the red at a hot idle', () => {
    expect(oilPressure(IDLE_RPM, KNOCK_COOLANT)).toBeLessThan(oilPressure(IDLE_RPM, COOLANT_FULL));
    expect(oilPressure(IDLE_RPM, HEAT_STALL_COOLANT)).toBeGreaterThan(LOW_OIL);
  });

  it('lights the TEMP lamp where the coolant gauge turns red, in a column of four lamps that don\'t touch', () => {
    expect(TEMP_LAMP_COOLANT).toBe(OVERHEAT_COOLANT);
    const coolant = DIALS.find((d) => d.id === 'coolant')!;
    expect(zoneOf(coolant, TEMP_LAMP_COOLANT)).toBe('danger');
    expect(LAMPS.map((l) => l.id)).toEqual(['temp', 'oil', 'generator', 'brake']);
    for (let i = 1; i < LAMPS.length; i++) {
      expect(LAMPS[i - 1].y - LAMPS[i].y).toBeGreaterThanOrEqual(LAMP.radius * 2 + 0.003);
    }
  });

  it('sends a stall from the heat to the crewmate', () => {
    expect(STALL_CAUSES).toContain('heat');
    const s = warm();
    s.coolant = 117;
    s.stallCause = 'heat';
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    encodeTankState(buffer, 1, 2, s, createControls());
    const out = createTankDrive();
    expect(decodeTankState(new DataView(buffer), { seq: 0, timeMs: 0 }, out)).toBe(true);
    expect(out.stallCause).toBe('heat');
    expect(out.coolant).toBe(117);
  });
});

describe('the crewmate driver and the heat (F3.7)', () => {
  it('halts to let a hot engine cool, then drives on', () => {
    const bot = new BotDriver();
    const tank = { x: 0, z: 0, heading: 0, speed: 0 };
    bot.call('advance', 0);
    const wish = createDriveWish();
    bot.update(0.1, tank, wish, false, COOLANT_FULL);
    expect(wish.left).toBeGreaterThan(0);
    bot.update(0.1, tank, wish, false, BOT_COOL_HALT);
    expect(wish).toEqual({ left: 0, right: 0 });
    expect(bot.describe()).toBe('halted to let the engine cool');
    // Still waiting a little cooler, short of BOT_COOL_RESUME.
    bot.update(0.1, tank, wish, false, BOT_COOL_RESUME + 1);
    expect(wish.left).toBe(0);
    bot.update(0.1, tank, wish, false, BOT_COOL_RESUME - 1);
    expect(wish.left).toBeGreaterThan(0);
    expect(bot.describe()).toBe('advancing');
  });

  it('waits for an overheated engine to cool before it starts it', () => {
    const switches = { battery: true, ignition: true, choke: 0, throttle: 0.15, start: 'starter' as const };
    expect(startTask({ running: false, starterHot: false, coolant: RESTART_COOLANT + 2 }, switches, 0)).toEqual({ kind: 'cool' });
    expect(startTask({ running: false, starterHot: false, coolant: RESTART_COOLANT }, switches, 0)).toEqual({ kind: 'press', id: 'starter', hold: true });
  });
});
