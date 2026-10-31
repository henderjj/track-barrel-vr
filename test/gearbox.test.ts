import { describe, expect, it } from 'vitest';
import { MAX_ACCEL, MAX_SPEED } from '../src/sim/comfort.js';
import {
  BOG_RPM,
  clutchEngagement,
  COAST_DECEL,
  type Gear,
  GEAR_PULL,
  type GearboxMode,
  GEARS,
  gearFits,
  LEVER_ORDER,
  MAX_RPM,
  nextGear,
  NEUTRAL,
  parseGearbox,
  REVERSE,
  REVERSE_TOP,
  TOP_GEAR,
} from '../src/sim/gearbox.js';
import { createControls, createTankDrive, type DriverControls, stepDrive, type TankDrive } from '../src/sim/tank-drive.js';

const DT = 1 / 60;

function c(gear: Gear, accel: number, mode: GearboxMode, clutch = 0, left = 0, right = 0): DriverControls {
  return { ...createControls(), gear, accel, mode, clutch, left, right };
}

function run(s: TankDrive, controls: DriverControls, seconds: number, each?: (s: TankDrive) => void): TankDrive {
  for (let t = 0; t < seconds; t += DT) {
    stepDrive(s, controls, DT, []);
    each?.(s);
  }
  return s;
}

describe('gearbox (F1.16)', () => {
  it('has the Sherman\'s five speeds, 5th at the tank\'s top speed, and a slow reverse', () => {
    const kmh = GEARS.slice(1, TOP_GEAR + 1).map((g) => g.top * 3.6);
    expect(kmh[4]).toBeCloseTo(MAX_SPEED * 3.6, 6);
    expect(kmh[0]).toBeCloseTo(3.4, 1);
    expect(kmh[1]).toBeCloseTo(8.2, 1);
    expect(kmh[2]).toBeCloseTo(14.4, 1);
    expect(kmh[3]).toBeCloseTo(23, 0);
    expect(GEARS[REVERSE].top).toBe(REVERSE_TOP);
    expect(GEARS.map((g) => g.short)).toEqual(['N', '1', '2', '3', '4', '5', 'R']);
    // Each gear pulls no harder than the one under it.
    for (let g = 2; g <= TOP_GEAR; g++) expect(GEAR_PULL[g]).toBeLessThanOrEqual(GEAR_PULL[g - 1]);
  });

  it('steps along the lever from reverse through neutral to 5th, stopping at the ends', () => {
    expect(LEVER_ORDER).toEqual([REVERSE, NEUTRAL, 1, 2, 3, 4, 5]);
    expect(nextGear(NEUTRAL, 1)).toBe(1);
    expect(nextGear(1, -1)).toBe(NEUTRAL);
    expect(nextGear(NEUTRAL, -1)).toBe(REVERSE);
    expect(nextGear(REVERSE, -1)).toBe(REVERSE);
    expect(nextGear(TOP_GEAR, 1)).toBe(TOP_GEAR);
    expect(nextGear(REVERSE, 1)).toBe(NEUTRAL);
  });

  it('takes a gear only at a speed it can turn the engine at; 1st and reverse need the tank (all but) stopped', () => {
    expect(gearFits(3, GEARS[3].top)).toBe(true);
    expect(gearFits(2, GEARS[3].top)).toBe(false);
    expect(gearFits(1, 1.5)).toBe(false);
    expect(gearFits(1, 0.5)).toBe(true);
    expect(gearFits(REVERSE, 0.5)).toBe(false);
    expect(gearFits(REVERSE, 0)).toBe(true);
    expect(gearFits(NEUTRAL, 9)).toBe(true);
  });

  it('reads the clutch pedal: engaged up, slipping part way, free fully down', () => {
    expect(clutchEngagement(0)).toBe(1);
    expect(clutchEngagement(0.5)).toBeCloseTo(0.5, 6);
    expect(clutchEngagement(1)).toBe(0);
    expect(parseGearbox('clutch', 'auto')).toBe('clutch');
    expect(parseGearbox('nonsense', 'auto')).toBe('auto');
  });

  describe('Stick shift', () => {
    it('changes gear with the stick alone, coasting a moment out of gear', () => {
      const s = run(createTankDrive(), c(2, 1, 'stick'), 6);
      expect(s.gear).toBe(2);
      const before = s.speed;
      run(s, c(3, 1, 'stick'), DT * 3);
      expect(s.gear).toBe(NEUTRAL);
      expect(s.grinding).toBe(false);
      expect(s.speed).toBeGreaterThan(before - COAST_DECEL * DT * 4);
      run(s, c(3, 1, 'stick'), 0.5);
      expect(s.gear).toBe(3);
    });

    it('waits with a change down that would over-rev the engine until the tank has slowed', () => {
      const s = run(createTankDrive(), c(4, 1, 'stick'), 30);
      expect(s.speed).toBeGreaterThan(GEARS[2].top * 1.5);
      run(s, c(2, 0, 'stick'), 0.5);
      expect(s.gear).toBe(NEUTRAL);
      expect(s.grinding).toBe(false);
      run(s, c(2, 0, 'stick', 0, -1, -1), 10);
      expect(s.gear).toBe(2);
    });

    it('doesn\'t creep at a standstill with the accelerator released', () => {
      const s = run(createTankDrive(), c(1, 0, 'stick'), 5);
      expect(s.gear).toBe(1);
      expect(s.speed).toBe(0);
    });
  });

  describe('Clutch', () => {
    it('grinds without the clutch, and on into 1st or too low a gear on the move; the clutch in, the gear goes in', () => {
      const s = run(createTankDrive(), c(NEUTRAL, 0, 'clutch', 1), 0.1);
      run(s, c(2, 0, 'clutch', 1), 0.3);
      expect(s.gear).toBe(2);
      run(s, c(2, 1, 'clutch', 0), 8);
      expect(s.speed).toBeGreaterThan(1.5);
      // Into 3rd without the clutch: it grinds and coasts.
      run(s, c(3, 1, 'clutch', 0), 0.2);
      expect(s.grinding).toBe(true);
      expect(s.gear).toBe(NEUTRAL);
      run(s, c(3, 1, 'clutch', 1), 0.3);
      expect(s.grinding).toBe(false);
      expect(s.gear).toBe(3);
      // Into 1st on the move grinds even with the clutch in.
      run(s, c(1, 0, 'clutch', 1), 0.2);
      expect(s.grinding).toBe(true);
    });

    it('lets out the clutch slowly to pull away; dropped in a high gear, the engine bogs and barely pulls', () => {
      const s = run(createTankDrive(), c(2, 0, 'clutch', 1), 0.5);
      let bogged = false;
      // Feathered out over two seconds with the accelerator down.
      for (let t = 0; t < 2; t += DT) {
        stepDrive(s, c(2, 0.6, 'clutch', 1 - t / 2), DT, []);
        bogged ||= s.bogging;
      }
      run(s, c(2, 0.6, 'clutch', 0), 2, (t) => (bogged ||= t.bogging));
      expect(bogged).toBe(false);
      expect(s.speed).toBeGreaterThan(1.5);
      // 4th, the clutch dropped at a standstill.
      const dropped = run(createTankDrive(), c(4, 0, 'clutch', 1), 0.5);
      run(dropped, c(4, 1, 'clutch', 0), 1);
      expect(dropped.bogging).toBe(true);
      expect(dropped.rpm).toBeLessThan(BOG_RPM);
      expect(dropped.accel).toBeLessThan(0.15 * MAX_ACCEL);
    });

    it('revs the engine freely with the clutch in, and ties the revs to the tracks with it out', () => {
      const s = run(createTankDrive(), c(NEUTRAL, 0, 'clutch', 1), 0.1);
      run(s, c(2, 1, 'clutch', 1), 2);
      expect(s.rpm).toBeGreaterThan(MAX_RPM - 100);
      expect(s.speed).toBe(0);
    });
  });
});
