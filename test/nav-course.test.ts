import { describe, expect, it } from 'vitest';
import {
  applyNav,
  courseLength,
  cpRef,
  createNav,
  NAV,
  NAV_PLACES,
  navDone,
  navEvent,
  navMedal,
  navResult,
  navTasks,
  parTime,
  pickCourse,
  startNav,
  stepNav,
  stopNav,
} from '../src/sim/nav-course.js';
import { waterDepth } from '../src/sim/course.js';
import { FIELD_MAP } from '../src/sim/field-map.js';
import { groundHeight, OBSTACLES, TILE } from '../src/sim/terrain.js';

/** Distance from (x, z) to the nearest copy of an obstacle's middle on the repeating ground, less its larger half size. */
function clearOf(x: number, z: number): number {
  let near = Infinity;
  for (const o of OBSTACLES) {
    const dx = x - o.x - Math.round((x - o.x) / TILE) * TILE;
    const dz = z - o.z - Math.round((z - o.z) / TILE) * TILE;
    near = Math.min(near, Math.hypot(dx, dz) - Math.max(o.hx, o.hz));
  }
  return near;
}

/** Drive the run straight to each checkpoint in turn at `speed` m/s, in steps of `dt`. */
function driveIt(speed: number, dt = 0.1) {
  const s = createNav();
  startNav(s, 42);
  let x = NAV.start.x;
  let z = NAV.start.z;
  const reached: number[] = [];
  for (let step = 0; step < 100000 && !navDone(s); step++) {
    const p = NAV_PLACES[s.cps[s.next]];
    const d = Math.hypot(p.x - x, p.z - z);
    const go = Math.min(d, speed * dt);
    if (d > 0) {
      x += ((p.x - x) / d) * go;
      z += ((p.z - z) / d) * go;
    }
    const k = stepNav(s, x, z, dt);
    if (k >= 0) reached.push(k);
  }
  return { s, reached };
}

describe('the map-reading places (F2.12)', () => {
  it('are all on the map, out of the water and the ditch, and clear of houses and walls', () => {
    for (const p of NAV_PLACES) {
      expect(p.x, p.name).toBeGreaterThan(FIELD_MAP.west + 30);
      expect(p.x, p.name).toBeLessThan(FIELD_MAP.east - 30);
      expect(p.z, p.name).toBeGreaterThan(FIELD_MAP.north + 30);
      expect(p.z, p.name).toBeLessThan(FIELD_MAP.south - 30);
      expect(waterDepth(p.x, p.z), p.name).toBe(0);
      expect(groundHeight(p.x, p.z), p.name).toBeGreaterThan(-0.5);
      expect(clearOf(p.x, p.z), p.name).toBeGreaterThan(5);
    }
  });

  it('are far enough apart that reaching one never reaches another, and none is at the start', () => {
    for (let a = 0; a < NAV_PLACES.length; a++) {
      const p = NAV_PLACES[a];
      expect(Math.hypot(p.x - NAV.start.x, p.z - NAV.start.z)).toBeGreaterThan(3 * NAV.arrive);
      for (let b = a + 1; b < NAV_PLACES.length; b++) {
        const q = NAV_PLACES[b];
        expect(Math.hypot(p.x - q.x, p.z - q.z), `${p.name} and ${q.name}`).toBeGreaterThan(2 * NAV.arrive);
      }
    }
  });

  it('each have their own six-figure grid reference', () => {
    const refs = NAV_PLACES.map((_, i) => cpRef(i));
    for (const r of refs) expect(r).toMatch(/^\d{6}$/);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe('picking a course (F2.12)', () => {
  it('picks the same five different places for a seed, and different courses for different seeds', () => {
    const a = pickCourse(7);
    expect(a).toEqual(pickCourse(7));
    expect(a.length).toBe(NAV.points);
    expect(new Set(a).size).toBe(NAV.points);
    for (const i of a) expect(i >= 0 && i < NAV_PLACES.length).toBe(true);
    const courses = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) courses.add(pickCourse(seed).join(','));
    expect(courses.size).toBeGreaterThan(10);
  });

  it('orders them nearest first from the start', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const cps = pickCourse(seed);
      let x: number = NAV.start.x;
      let z: number = NAV.start.z;
      const left = [...cps];
      for (const i of cps) {
        const d = Math.hypot(NAV_PLACES[i].x - x, NAV_PLACES[i].z - z);
        for (const j of left) expect(d).toBeLessThanOrEqual(Math.hypot(NAV_PLACES[j].x - x, NAV_PLACES[j].z - z) + 1e-9);
        left.splice(left.indexOf(i), 1);
        x = NAV_PLACES[i].x;
        z = NAV_PLACES[i].z;
      }
    }
  });

  it('gives a par time of a few minutes, and medals by it', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const cps = pickCourse(seed);
      const par = parTime(cps);
      expect(par).toBeCloseTo((courseLength(cps) * NAV.parDetour) / NAV.parSpeed, 6);
      expect(par).toBeGreaterThan(90);
      expect(par).toBeLessThan(900);
      expect(navMedal(par, cps)).toBe('gold');
      expect(navMedal(par * 1.2, cps)).toBe('silver');
      expect(navMedal(par * 1.5, cps)).toBe('bronze');
      expect(navMedal(par * 2, cps)).toBe('');
    }
  });
});

describe('a run (F2.12)', () => {
  it('reaches each checkpoint in order, within 20 m, and stops the clock at the last', () => {
    const { s, reached } = driveIt(8);
    expect(reached).toEqual([0, 1, 2, 3, 4]);
    expect(s.on).toBe(false);
    expect(s.splits.length).toBe(NAV.points);
    for (let k = 1; k < s.splits.length; k++) expect(s.splits[k]).toBeGreaterThan(s.splits[k - 1]);
    // At 8 m/s straight, well inside the par (6 m/s with a fifth more).
    expect(navMedal(s.splits[4], s.cps)).toBe('gold');
    const before = s.time;
    expect(stepNav(s, 0, 0, 1)).toBe(-1);
    expect(s.time).toBe(before);
  });

  it('only counts the next checkpoint, not a later one passed first', () => {
    const s = createNav();
    startNav(s, 3);
    const later = NAV_PLACES[s.cps[2]];
    expect(stepNav(s, later.x, later.z, 0.1)).toBe(-1);
    expect(s.next).toBe(0);
    const first = NAV_PLACES[s.cps[0]];
    expect(stepNav(s, first.x + NAV.arrive - 1, first.z, 0.1)).toBe(0);
    expect(s.next).toBe(1);
  });

  it('puts the next two checkpoints on the board, then the result', () => {
    const s = createNav();
    startNav(s, 9);
    expect(navTasks(s)).toEqual([`Next: CP1 at ${cpRef(s.cps[0])}`, `Then: CP2 at ${cpRef(s.cps[1])}`, 'Reached 0 of 5']);
    s.next = 4;
    expect(navTasks(s)).toEqual([`Next: CP5 at ${cpRef(s.cps[4])}`, 'Reached 4 of 5']);
    const { s: done } = driveIt(8);
    expect(navResult(done)).toMatch(/^Map reading: all 5 in \d+:\d\d, gold$/);
  });

  it('stops, clearing the board and the map', () => {
    const s = createNav();
    startNav(s, 5);
    const v = s.v;
    stopNav(s);
    expect(s.on).toBe(false);
    expect(s.cps).toEqual([]);
    expect(s.v).toBe(v + 1);
    stopNav(s);
    expect(s.v).toBe(v + 1);
  });
});

describe('sharing a run (F2.12)', () => {
  it('goes to the guest whole, checkpoints from the seed, and an older run never replaces a newer', () => {
    const { s: host } = driveIt(8);
    const guest = createNav();
    const sent = JSON.parse(JSON.stringify(navEvent(host)));
    expect(applyNav(guest, sent)).toBe(true);
    expect(guest).toEqual(host);
    expect(applyNav(guest, sent)).toBe(false);
    expect(applyNav(guest, { ...sent, v: sent.v - 1 })).toBe(false);
  });

  it('half way through, and stopped', () => {
    const host = createNav();
    startNav(host, 11);
    const p = NAV_PLACES[host.cps[0]];
    stepNav(host, p.x, p.z, 30);
    const guest = createNav();
    applyNav(guest, navEvent(host));
    expect(guest.cps).toEqual(host.cps);
    expect(guest.next).toBe(1);
    expect(guest.on).toBe(true);
    stopNav(host);
    expect(applyNav(guest, navEvent(host))).toBe(true);
    expect(guest.cps).toEqual([]);
  });

  it('turns away a malformed run', () => {
    const s = createNav();
    expect(applyNav(s, null)).toBe(false);
    expect(applyNav(s, { t: 'nav', on: true, seed: 1, next: 0, time: 0, splits: [Number.NaN], v: 1 })).toBe(false);
    expect(applyNav(s, { t: 'nav', on: 'yes', seed: 1, next: 0, time: 0, splits: [], v: 1 })).toBe(false);
    expect(applyNav(s, { t: 'nav', on: true, seed: 1, next: 99, time: 0, splits: [], v: 1 })).toBe(true);
    expect(s.next).toBe(NAV.points);
  });
});
