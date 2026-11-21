/**
 * Mission report points (F2.12b, docs/report-points.md): each mission's
 * start line (SL) and report points (RP1, RP2 ...) on the commander's map,
 * to pass in order. A crew reports crossing the start line and passing each
 * report point, as a 1944 crew reported its progress to the squadron; here
 * the host calls each as the tank gets there and the board and the map
 * keep the tally. On Escort a convoy they lie along the convoy's road. On
 * Hold the hill and Ambush a column, Missions → March starts the crew at
 * SP instead of in position: the last report point is the position, and
 * the fight begins when the tank reaches it.
 * Engine-free: the routes, the run and its event.
 *
 * World space as src/sim/terrain.ts: +X east, −Z north.
 */

import { AMBUSH } from './ambush.js';
import { gridRef } from './field-map.js';
import { HILL } from './hill.js';

export type RouteMission = 'escort' | 'hill' | 'ambush';
export const ROUTE_MISSIONS: readonly RouteMission[] = ['escort', 'hill', 'ambush'];

/** A report point: where, how near the tank's middle must come, m, and its name on the map. */
export interface ReportPoint {
  label: string;
  x: number;
  z: number;
  r: number;
}

/** A mission's route: the start line (from a to b, crossed going north), its report points in order, and whether the last is the mission's position (the fight begins there). */
export interface ReportRoute {
  name: string;
  start: { a: [number, number]; b: [number, number] };
  points: readonly ReportPoint[];
  position: boolean;
}

/** Within this of a report point it is passed, m. The position, where the tank must stop to fight, is tighter. */
export const RP_REACH = 20;
export const POSITION_REACH = 15;

/** The start line every route shares: across the range road 30 m north of SP, 40 m wide. */
const SL = { a: [-20, -30] as [number, number], b: [20, -30] as [number, number] };

export const ROUTES: Readonly<Record<RouteMission, ReportRoute>> = {
  escort: {
    name: 'Escort a convoy',
    start: SL,
    points: [
      { label: 'RP1', x: 0, z: -200, r: RP_REACH },
      { label: 'RP2', x: 0, z: -400, r: RP_REACH },
    ],
    position: false,
  },
  hill: {
    name: 'Hold the hill',
    start: SL,
    points: [
      { label: 'RP1', x: 0, z: -250, r: RP_REACH },
      { label: 'RP2', x: 110, z: -360, r: RP_REACH },
      { label: 'RP3', x: HILL.startX, z: HILL.startZ, r: POSITION_REACH },
    ],
    position: true,
  },
  ambush: {
    name: 'Ambush a column',
    start: SL,
    points: [
      { label: 'RP1', x: 0, z: -300, r: RP_REACH },
      { label: 'RP2', x: -90, z: -470, r: RP_REACH },
      { label: 'RP3', x: AMBUSH.x, z: AMBUSH.z, r: POSITION_REACH },
    ],
    position: true,
  },
};

/** A run along a route, as the host keeps it and both pages show it. */
export interface ReportRun {
  /** The mission ('' for none). */
  mission: RouteMission | '';
  /** Marching to the position (Hold the hill, Ambush: the fight not begun yet). */
  march: boolean;
  /** Crossed the start line, and when, s (−1 not yet). */
  slAt: number;
  /** The next report point (points.length once all are passed). */
  next: number;
  /** When each was passed, s. */
  times: number[];
  /** Since the run began, s. */
  time: number;
  /** Bumped on every change the guest must see. */
  v: number;
}

export function createReportRun(): ReportRun {
  return { mission: '', march: false, slAt: -1, next: 0, times: [], time: 0, v: 0 };
}

/** Begin a mission's route (on a march, the crew at SP). */
export function startReportRun(s: ReportRun, mission: RouteMission, march: boolean): void {
  s.mission = mission;
  s.march = march && ROUTES[mission].position;
  s.slAt = -1;
  s.next = 0;
  s.times = [];
  s.time = 0;
  s.v++;
}

/** Clear it off the board and the map. */
export function stopReportRun(s: ReportRun): void {
  if (s.mission === '') return;
  s.mission = '';
  s.march = false;
  s.slAt = -1;
  s.next = 0;
  s.times = [];
  s.v++;
}

/** Every report point passed. */
export function reportDone(s: Readonly<ReportRun>): boolean {
  return s.mission !== '' && s.next >= ROUTES[s.mission].points.length;
}

/** Whether the segment p→q crosses the segment a→b. */
function crosses(px: number, pz: number, qx: number, qz: number, a: readonly number[], b: readonly number[]): boolean {
  const side = (x: number, z: number) => (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const s1 = side(px, pz);
  const s2 = side(qx, qz);
  if (s1 === s2 || (s1 > 0 && s2 > 0) || (s1 < 0 && s2 < 0)) return false;
  const dx = qx - px;
  const dz = qz - pz;
  const t1 = dx * (a[1] - pz) - dz * (a[0] - px);
  const t2 = dx * (b[1] - pz) - dz * (b[0] - px);
  return (t1 >= 0 && t2 <= 0) || (t1 <= 0 && t2 >= 0);
}

export type ReportStep = 'sl' | 'rp' | 'position' | null;

/**
 * Step the host's run `dt` s with the tank moved from (px, pz) to (x, z):
 * 'sl' as it crosses the start line going north, 'rp' as it passes the next
 * report point (only once over the line, and only the next), 'position' as
 * it reaches the last on a march; null otherwise.
 */
export function stepReportRun(s: ReportRun, px: number, pz: number, x: number, z: number, dt: number): ReportStep {
  if (s.mission === '' || reportDone(s)) return null;
  s.time += dt;
  const route = ROUTES[s.mission];
  if (s.slAt < 0) {
    // Going north: from its south side (larger z) to its north.
    if (z < pz && crosses(px, pz, x, z, route.start.a, route.start.b)) {
      s.slAt = s.time;
      s.v++;
      return 'sl';
    }
    return null;
  }
  const p = route.points[s.next];
  if (Math.hypot(p.x - x, p.z - z) > p.r) return null;
  s.times.push(s.time);
  s.next++;
  s.v++;
  if (reportDone(s) && route.position && s.march) {
    s.march = false;
    return 'position';
  }
  return 'rp';
}

/** A report as the commander makes it, for the board's calls. */
export function reportCall(s: Readonly<ReportRun>, step: Exclude<ReportStep, null>): string {
  const route = ROUTES[s.mission as RouteMission];
  const clock = timeWords(step === 'sl' ? s.slAt : s.times[s.times.length - 1]);
  if (step === 'sl') return `Crossed the start line, ${clock}`;
  const p = route.points[s.next - 1];
  if (step === 'position') return `${p.label}: in position, ${clock}`;
  return `Passing ${p.label}, ${clock}`;
}

/** The board's lines while a route runs: what to cross or pass next and the one after, then how many reported. */
export function reportTasks(s: Readonly<ReportRun>): string[] {
  if (s.mission === '') return [];
  const route = ROUTES[s.mission];
  const lines: string[] = [];
  if (s.slAt < 0) lines.push('Next: cross the SL');
  for (let k = s.next; k < route.points.length && lines.length < 2; k++) {
    const p = route.points[k];
    const what = route.position && s.march && k === route.points.length - 1 ? `${p.label} (position)` : p.label;
    lines.push(`${lines.length === 0 ? 'Next' : 'Then'}: ${what} at ${gridRef(p.x, p.z, 6)}`);
  }
  lines.push(reportTally(s));
  return lines;
}

/** The one line a mission's board has room for (Escort a convoy): what to cross or pass next, or '' once all are reported. */
export function reportNextLine(s: Readonly<ReportRun>): string {
  if (s.mission === '' || reportDone(s)) return '';
  if (s.slAt < 0) return 'Report: cross the SL';
  const p = ROUTES[s.mission].points[s.next];
  return `Report: ${p.label} at ${gridRef(p.x, p.z, 6)}`;
}

/**
 * A route begun with the tank already up it (Escort a convoy → Ambush puts
 * it 210 m up the road): the start line and every report point south of
 * the tank by more than its reach count as passed when the route began.
 * Every route runs north, so south is behind.
 */
export function catchUpReportRun(s: ReportRun, z: number): void {
  if (s.mission === '') return;
  const route = ROUTES[s.mission];
  const sl = Math.min(route.start.a[1], route.start.b[1]);
  if (s.slAt >= 0 || z >= sl) return;
  s.slAt = 0;
  while (s.next < route.points.length && route.points[s.next].z > z + route.points[s.next].r) {
    s.times.push(0);
    s.next++;
  }
  s.v++;
}

/** The march's briefing, for the sign: what to report, and where the position is. */
export function marchBriefing(mission: RouteMission): [string, string] {
  const route = ROUTES[mission];
  const last = route.points[route.points.length - 1];
  const on = route.points.slice(0, -1).map((p) => p.label).join(', ');
  return [`Approach march: ${route.name}`, `Cross the SL, report ${on}, take up position at ${last.label} (${gridRef(last.x, last.z, 6)})`];
}

/** How many reported: "Reports: SL, 1 of 2 RPs". */
export function reportTally(s: Readonly<ReportRun>): string {
  if (s.mission === '') return '';
  const total = ROUTES[s.mission].points.length;
  return `Reports: ${s.slAt < 0 ? 'SL not crossed' : 'SL'}, ${s.next} of ${total} RPs`;
}

function timeWords(t: number): string {
  const m = Math.floor(t / 60);
  const r = Math.floor(t % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** The `report` event the host sends: the whole run. */
export interface ReportEvent {
  t: 'report';
  m: RouteMission | '';
  march: boolean;
  slAt: number;
  next: number;
  times: number[];
  time: number;
  v: number;
}

export function reportEvent(s: Readonly<ReportRun>): ReportEvent {
  return { t: 'report', m: s.mission, march: s.march, slAt: s.slAt, next: s.next, times: [...s.times], time: s.time, v: s.v };
}

/** Take the host's run (a guest). False if it isn't one or is older. */
export function applyReport(s: ReportRun, e: unknown): boolean {
  const o = e as Partial<ReportEvent> | null;
  if (!o || typeof o.v !== 'number' || typeof o.march !== 'boolean' || typeof o.slAt !== 'number' || typeof o.next !== 'number' || typeof o.time !== 'number') return false;
  if (o.m !== '' && !(ROUTE_MISSIONS as readonly unknown[]).includes(o.m)) return false;
  if (!Array.isArray(o.times) || !o.times.every((t) => typeof t === 'number' && Number.isFinite(t))) return false;
  if (o.v <= s.v) return false;
  const m = o.m as RouteMission | '';
  const total = m === '' ? 0 : ROUTES[m].points.length;
  s.mission = m;
  s.march = o.march;
  s.slAt = o.slAt;
  s.next = Math.max(0, Math.min(total, Math.floor(o.next)));
  s.times = o.times.slice(0, total);
  s.time = o.time;
  s.v = o.v;
  return true;
}
