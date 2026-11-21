import { describe, expect, it } from 'vitest';
import { BotDriver, createDriveWish, GOTO_KMH } from '../src/sim/crew-bot.js';
import { FIELD_MAP } from '../src/sim/field-map.js';
import { MAP_CASE, sheetToWorld } from '../src/sim/map-case.js';
import { NAV_PLACES, NAV } from '../src/sim/nav-course.js';
import { lineClear, pathBlocked, pathLength, planPath } from '../src/sim/nav-path.js';
import { bearingWords, distanceWords, goOrder, headingOrder, parseGoto, spotFrom, turnWords } from '../src/sim/navigator.js';
import { DITCH, OBSTACLES } from '../src/sim/terrain.js';
import { createControls, createTankDrive, stepDrive } from '../src/sim/tank-drive.js';

const spot = () => ({ bearing: 0, distance: 0, turn: 0 });

describe("the commander's words (F2.13)", () => {
  it('gives bearings clockwise from north, and the turn from the way the tank faces', () => {
    // Facing north at the origin.
    expect(spotFrom(0, 0, 0, 0, -100, spot())).toMatchObject({ bearing: 0, distance: 100 });
    expect(spotFrom(0, 0, 0, 100, 0, spot())).toMatchObject({ bearing: 90, turn: 90 });
    expect(spotFrom(0, 0, 0, -100, 0, spot())).toMatchObject({ bearing: 270, turn: -90 });
    expect(spotFrom(0, 0, 0, 0, 100, spot()).bearing).toBe(180);
    // Facing west (heading +90°, a left turn): north is to the right.
    const w = spotFrom(0, 0, Math.PI / 2, 0, -100, spot());
    expect(w.bearing).toBe(0);
    expect(w.turn).toBeCloseTo(90, 6);
  });

  it('says them as a commander would', () => {
    expect(bearingWords(45)).toBe('045°');
    expect(distanceWords(318)).toBe('320 m');
    expect(distanceWords(3)).toBe('10 m');
    expect(distanceWords(1260)).toBe('1.25 km');
    expect(turnWords(4)).toBe('dead ahead');
    expect(turnWords(-31)).toBe('left 30°');
    expect(turnWords(62)).toBe('right 60°');
    expect(turnWords(178)).toBe('behind you');
    const s = spotFrom(0, 0, 0, 100, -100, spot());
    expect(goOrder(s, 100, -100)).toMatch(/^Driver, go to \d{6}: 045°, 140 m, right 45°$/);
    expect(headingOrder(2, s)).toBe('CP2: steer 045°, 140 m, right 45°');
  });

  it('turns away a malformed or off-map goto', () => {
    expect(parseGoto({ t: 'nav-goto', x: 10, z: -50 }, FIELD_MAP)).toEqual({ x: 10, z: -50 });
    expect(parseGoto({ t: 'nav-goto', x: Number.NaN, z: 0 }, FIELD_MAP)).toBeNull();
    expect(parseGoto({ t: 'nav-goto', x: 10 }, FIELD_MAP)).toBeNull();
    expect(parseGoto({ t: 'nav-goto', x: 5000, z: 0 }, FIELD_MAP)).toBeNull();
    expect(parseGoto(null, FIELD_MAP)).toBeNull();
  });
});

describe('touching the map (F2.13)', () => {
  it("finds the world point under a touch on the map's window, and nothing in its margins", () => {
    const out: [number, number] = [0, 0];
    // The middle of the window is the middle of the map's frame (the title band makes it a little south of the map's middle).
    const mid = sheetToWorld(0, 0, out)!;
    expect(mid[0]).toBeCloseTo((FIELD_MAP.west + FIELD_MAP.east) / 2, 0);
    // Right is east, up is north.
    const east = sheetToWorld(0.05, 0, [0, 0])!;
    const north = sheetToWorld(0, 0.05, [0, 0])!;
    expect(east[0]).toBeGreaterThan(mid[0]);
    expect(north[1]).toBeLessThan(mid[1]);
    // 5 cm on the sheet is about 160 m on the ground (1:3,200 or so).
    expect(east[0] - mid[0]).toBeGreaterThan(140);
    expect(east[0] - mid[0]).toBeLessThan(180);
    // The title band and the margins aren't the map.
    expect(sheetToWorld(0, MAP_CASE.sheet / 2 - 0.002, [0, 0])).toBeNull();
    expect(sheetToWorld(MAP_CASE.sheet / 2 - 0.002, 0, [0, 0])).toBeNull();
    expect(sheetToWorld(MAP_CASE.sheet, 0, [0, 0])).toBeNull();
  });
});

describe("the crewmate driver's way across country (F2.13)", () => {
  it('keeps off houses, walls, rocks, the ditch and the water', () => {
    for (const o of OBSTACLES.slice(0, 10)) expect(pathBlocked(o.x, o.z)).toBe(true);
    expect(pathBlocked(DITCH.from + 20, DITCH.z)).toBe(true);
    expect(pathBlocked(0, -100)).toBe(false);
  });

  it('drives straight when the way is clear', () => {
    const path = planPath(0, 0, 0, -150);
    expect(path).toEqual([[0, -150]]);
  });

  it('goes round the ditch rather than through it, on clear legs', () => {
    // From south of the ditch to north of it, straight across its middle.
    const from: [number, number] = [70, -150];
    const to: [number, number] = [70, -240];
    expect(lineClear(from[0], from[1], to[0], to[1])).toBe(false);
    const path = planPath(from[0], from[1], to[0], to[1]);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(to);
    let [x, z] = from;
    for (const [px, pz] of path.slice(0, -1)) {
      expect(lineClear(x, z, px, pz)).toBe(true);
      x = px;
      z = pz;
    }
    // Not a long way round.
    expect(pathLength(from[0], from[1], path)).toBeLessThan(260);
  });

  it('finds a way from SP to every map course place', () => {
    for (const p of NAV_PLACES) {
      const path = planPath(NAV.start.x, NAV.start.z, p.x, p.z);
      expect(path.length, p.name).toBeGreaterThan(0);
      const [ex, ez] = path[path.length - 1];
      expect(Math.hypot(ex - p.x, ez - p.z), p.name).toBeLessThan(NAV.arrive);
      expect(pathLength(0, 0, path), p.name).toBeLessThan(2.2 * Math.hypot(p.x, p.z) + 100);
    }
  });

  it.each([0, 2, 4, 5, 6])('drives the real tank to map course place %i round what is in the way, and halts and stays', (place) => {
    const target = NAV_PLACES[place];
    const tank = createTankDrive();
    const bot = new BotDriver();
    const wish = createDriveWish();
    const controls = createControls();
    const step = () => {
      const w = bot.update(0.05, tank, wish);
      controls.left = w.left;
      controls.right = w.right;
      // Houses, walls and rocks as they are.
      stepDrive(tank, controls, 0.05);
    };
    bot.goTo(planPath(0, 0, target.x, target.z), 'there', { x: 0, z: 0 });
    let t = 0;
    while (t < 300 && !bot.there) {
      step();
      t += 0.05;
    }
    expect(bot.there).toBe(true);
    expect(Math.hypot(tank.x - target.x, tank.z - target.z)).toBeLessThan(5);
    expect(bot.describe()).toBe('halted at there');
    // About the time it takes at GOTO_KMH, with the start and the stop.
    expect(t).toBeLessThan((pathLength(0, 0, planPath(0, 0, target.x, target.z)) / (GOTO_KMH / 3.6)) * 1.8 + 10);
    const facing = tank.heading;
    for (let k = 0; k < 100; k++) step();
    expect(Math.hypot(tank.x - target.x, tank.z - target.z)).toBeLessThan(5);
    // It stays as it stopped: no turning on the spot afterwards.
    expect(Math.abs(tank.heading - facing)).toBeLessThan(5 * (Math.PI / 180));
    expect(bot.call('halt', tank.heading)).toBe(true);
    expect(bot.mode).toBe('calls');
  });
});
