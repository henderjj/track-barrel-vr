import { describe, expect, it } from 'vitest';
import { AMBUSH } from '../src/sim/ambush.js';
import { FIELD_MAP } from '../src/sim/field-map.js';
import { HILL } from '../src/sim/hill.js';
import { pathBlocked, pathLength, planPath } from '../src/sim/nav-path.js';
import {
  applyReport,
  catchUpReportRun,
  createReportRun,
  marchBriefing,
  POSITION_REACH,
  reportCall,
  reportDone,
  reportEvent,
  reportNextLine,
  reportTally,
  reportTasks,
  ROUTE_MISSIONS,
  ROUTES,
  type RouteMission,
  startReportRun,
  stepReportRun,
  stopReportRun,
} from '../src/sim/report-points.js';

/** Drive straight from (x, z) to (tx, tz) at 5 m/s in 0.1 s steps, stepping the run; the steps it returned. */
function driveTo(s: ReturnType<typeof createReportRun>, from: [number, number], tx: number, tz: number, out: string[]): [number, number] {
  let [x, z] = from;
  for (let i = 0; i < 100000; i++) {
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) break;
    const step = Math.min(d, 0.5);
    const nx = x + (dx / d) * step;
    const nz = z + (dz / d) * step;
    const r = stepReportRun(s, x, z, nx, nz, 0.1);
    if (r) out.push(r);
    x = nx;
    z = nz;
  }
  return [x, z];
}

/** March a route from SP, straight from point to point. */
function march(m: RouteMission): { s: ReturnType<typeof createReportRun>; steps: string[] } {
  const s = createReportRun();
  startReportRun(s, m, true);
  const steps: string[] = [];
  let at: [number, number] = [0, 0];
  for (const p of ROUTES[m].points) at = driveTo(s, at, p.x, p.z, steps);
  return { s, steps };
}

describe('mission report points (F2.12b)', () => {
  it('puts every route on the map, on clear ground, with a way from SP through each point', () => {
    for (const m of ROUTE_MISSIONS) {
      const route = ROUTES[m];
      let fx = 0;
      let fz = 0;
      for (const p of route.points) {
        expect(p.x).toBeGreaterThan(FIELD_MAP.west);
        expect(p.x).toBeLessThan(FIELD_MAP.east);
        expect(p.z).toBeGreaterThan(FIELD_MAP.north);
        expect(p.z).toBeLessThan(FIELD_MAP.south);
        expect(pathBlocked(p.x, p.z), `${m} ${p.label}`).toBe(false);
        const path = planPath(fx, fz, p.x, p.z);
        expect(path.length, `${m} way to ${p.label}`).toBeGreaterThan(0);
        // The way round isn't much longer than the straight line: the points sit on open going.
        expect(pathLength(fx, fz, path)).toBeLessThan(Math.hypot(p.x - fx, p.z - fz) * 1.5 + 30);
        fx = p.x;
        fz = p.z;
      }
      for (const x of [route.start.a[0], 0, route.start.b[0]]) expect(pathBlocked(x, route.start.a[1])).toBe(false);
    }
  });

  it('ends the marches on the missions\' own start points', () => {
    const hill = ROUTES.hill.points[ROUTES.hill.points.length - 1];
    expect([hill.x, hill.z]).toEqual([HILL.startX, HILL.startZ]);
    expect(hill.r).toBe(POSITION_REACH);
    const ambush = ROUTES.ambush.points[ROUTES.ambush.points.length - 1];
    expect([ambush.x, ambush.z]).toEqual([AMBUSH.x, AMBUSH.z]);
    expect(ROUTES.escort.position).toBe(false);
  });

  it('counts the start line crossed going north only', () => {
    const s = createReportRun();
    startReportRun(s, 'hill', true);
    // Southward across it: nothing.
    expect(stepReportRun(s, 0, -40, 0, -20, 0.1)).toBeNull();
    // Beside it, past its end: nothing.
    expect(stepReportRun(s, 30, -20, 30, -40, 0.1)).toBeNull();
    expect(s.slAt).toBe(-1);
    // An RP reached before the line doesn't count.
    expect(stepReportRun(s, 0, -240, 0, -250, 0.1)).toBeNull();
    expect(s.next).toBe(0);
    expect(stepReportRun(s, 5, -25, 5, -35, 0.1)).toBe('sl');
    expect(s.slAt).toBeCloseTo(0.4);
    expect(reportCall(s, 'sl')).toBe('Crossed the start line, 0:00');
  });

  it('passes the points in order, and the last on a march is the position', () => {
    for (const m of ['hill', 'ambush'] as const) {
      const { s, steps } = march(m);
      expect(steps).toEqual(['sl', 'rp', 'rp', 'position']);
      expect(reportDone(s)).toBe(true);
      expect(s.march).toBe(false);
      expect(s.times).toHaveLength(3);
      expect(s.times[0]).toBeLessThan(s.times[1]);
      expect(reportCall(s, 'position')).toMatch(/^RP3: in position, \d+:\d\d$/);
      expect(reportTally(s)).toBe('Reports: SL, 3 of 3 RPs');
      // Nothing more once done.
      expect(stepReportRun(s, 0, 0, 0, -50, 0.1)).toBeNull();
    }
    // Skipping RP1 for RP2 doesn't count RP2.
    const s = createReportRun();
    startReportRun(s, 'ambush', true);
    stepReportRun(s, 0, -20, 0, -40, 0.1);
    expect(stepReportRun(s, -90, -460, -90, -470, 0.1)).toBeNull();
    expect(s.next).toBe(0);
  });

  it('runs the convoy\'s route without a position', () => {
    const s = createReportRun();
    startReportRun(s, 'escort', true);
    expect(s.march).toBe(false);
    const steps: string[] = [];
    driveTo(s, [0, 0], 0, -420, steps);
    expect(steps).toEqual(['sl', 'rp', 'rp']);
    expect(reportNextLine(s)).toBe('');
    expect(reportCall(s, 'rp')).toMatch(/^Passing RP2, /);
  });

  it('credits what a route began past (Escort → Ambush, 210 m up the road)', () => {
    const s = createReportRun();
    startReportRun(s, 'escort', false);
    catchUpReportRun(s, -210);
    expect(s.slAt).toBe(0);
    // RP1 (z −200) is within reach there: passed, and called, on the first step.
    expect(s.next).toBe(0);
    expect(stepReportRun(s, 0, -210, 0, -210, 0.1)).toBe('rp');
    expect(reportNextLine(s)).toMatch(/^Report: RP2 at \d{6}$/);
    const past = createReportRun();
    startReportRun(past, 'escort', false);
    catchUpReportRun(past, -250);
    expect(past.next).toBe(1);
    const fresh = createReportRun();
    startReportRun(fresh, 'escort', false);
    catchUpReportRun(fresh, 0);
    expect(fresh.slAt).toBe(-1);
    expect(reportNextLine(fresh)).toBe('Report: cross the SL');
  });

  it('gives the board its lines and the sign its briefing', () => {
    const s = createReportRun();
    expect(reportTasks(s)).toEqual([]);
    startReportRun(s, 'hill', true);
    const lines = reportTasks(s);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Next: cross the SL');
    expect(lines[1]).toMatch(/^Then: RP1 at \d{6}$/);
    expect(lines[2]).toBe('Reports: SL not crossed, 0 of 3 RPs');
    stepReportRun(s, 0, -20, 0, -40, 0.1);
    stepReportRun(s, 0, -240, 0, -250, 0.1);
    stepReportRun(s, 110, -350, 110, -360, 0.1);
    expect(reportTasks(s)[0]).toMatch(/^Next: RP3 \(position\) at \d{6}$/);
    const [title, line] = marchBriefing('ambush');
    expect(title).toBe('Approach march: Ambush a column');
    expect(line).toMatch(/^Cross the SL, report RP1, RP2, take up position at RP3 \(\d{6}\)$/);
  });

  it('sends the run whole, and a guest takes only newer ones', () => {
    const { s } = march('hill');
    const guest = createReportRun();
    expect(applyReport(guest, JSON.parse(JSON.stringify(reportEvent(s))))).toBe(true);
    expect(guest).toEqual(s);
    expect(applyReport(guest, reportEvent(s))).toBe(false);
    expect(applyReport(guest, { ...reportEvent(s), v: s.v + 1, m: 'tank' })).toBe(false);
    expect(applyReport(guest, { ...reportEvent(s), v: s.v + 1, times: ['x'] })).toBe(false);
    expect(applyReport(guest, { ...reportEvent(s), v: s.v + 1, next: 99 })).toBe(true);
    expect(guest.next).toBe(3);
    stopReportRun(s);
    expect(s.mission).toBe('');
    expect(applyReport(guest, reportEvent(s))).toBe(false);
    s.v = guest.v + 1;
    expect(applyReport(guest, reportEvent(s))).toBe(true);
    expect(guest.mission).toBe('');
  });
});
