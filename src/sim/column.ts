/**
 * The enemy column (F5.10, docs/ambush.md): four vehicles, a tank at
 * each end and two lorries between, driving one way along a road across
 * the crew's front for the "Ambush a column" scenario. They join the enemy
 * battery (src/sim/enemy-guns.ts) as its 'column' group, which looks, lays
 * and fires for the tanks as it does for the patrolling tanks (F3.3); this
 * module holds the road, the vehicles and how the column moves.
 *
 * Unsprung, the column drives on in order at a steady pace. Once the
 * ambush is sprung (the crew fires, or a vehicle spots the crew's tank),
 * each tank halts while it has the crew's tank and fights; the lorries run
 * for it at their best speed. A vehicle can't close on a stopped one ahead
 * (a wreck, or a tank halted to fire): it waits, then pulls off the road to
 * the right and passes it. A vehicle at the road's end has got away.
 *
 * Engine-free and deterministic. World space as src/sim/range.ts: x and z
 * tile-local (the ground repeats every TILE), heights above the ground.
 */

import type { EnemyTankRoute, RoutePose } from './enemy-tanks.js';
import { routeLength } from './enemy-tanks.js';

/** A column vehicle: a tank (armoured, it fights) or a lorry (soft, it runs). */
export type ColumnKind = 'tank' | 'truck';

export interface ColumnVehicle {
  name: string;
  kind: ColumnKind;
}

/** The column in its order of march, the lead first. */
export const COLUMN_VEHICLES: readonly ColumnVehicle[] = [
  { name: 'Lead tank', kind: 'tank' },
  { name: 'Lorry 1', kind: 'truck' },
  { name: 'Lorry 2', kind: 'truck' },
  { name: 'Rear tank', kind: 'tank' },
];

/**
 * The road the column takes, one way: west along the cross road's copy at
 * z -800 (the range's second road, a tile north of the start) from x 235,
 * past the ambush, then away north at x -525. Every point lies within 400 m
 * of the ambush spot in x and in z, so the copy of the column drawn is
 * always this one (the ground repeats every 800 m). It comes onto the road
 * 460 m from the ambush, where the fog begins, and leaves it 520 m away.
 * North of the road east of x 100 is the biathlon course's copy, so it
 * can't come in from the north there.
 */
export const COLUMN_ROUTE: EnemyTankRoute = {
  name: 'Column',
  points: [
    [235, -800],
    [-525, -800],
    [-525, -930],
  ],
  meetZ: -800,
  meetD: 0,
};

/** The column's numbers. */
export const COLUMN = {
  /** Its pace on the march, m/s (18 km/h on a road). */
  speed: 5,
  /** A lorry running for it once the ambush is sprung, m/s (about 32 km/h). */
  run: 9,
  /** Between vehicles at the start, m: each starts this much further back along the road. */
  gap: 30,
  /** A vehicle stops this close behind a stopped one ahead, m. */
  close: 14,
  /** Held up behind a stopped vehicle this long, it pulls round it, s. */
  bypassAfter: 5,
  /** How far off the road it pulls to pass, to the right of its way, m. */
  passOffset: 7,
  /** How fast it moves across to pass or back, m/s. */
  sideRate: 2.5,
} as const;

/** A lorry's size, m: length, width, height to its canvas top; and its driver's eyes above the ground. */
export const COLUMN_TRUCK = { length: 6.1, width: 2.3, height: 2.9, eye: 2.0 } as const;

/** The road's length, m. */
export const COLUMN_LENGTH = routeLength(COLUMN_ROUTE);

/** Whether a vehicle `d` m along the road is on it (not yet arrived: d < 0; got away: d ≥ its length). */
export function onRoad(d: number): boolean {
  return d >= 0 && d < COLUMN_LENGTH;
}

/** A vehicle `d` m along the road has got away. */
export function gotAway(d: number): boolean {
  return d >= COLUMN_LENGTH;
}

/** Where vehicle `k` starts along the road: the lead at its start, the others `gap` apart behind it, m. */
export function columnStart(k: number): number {
  return k === 0 ? 0 : -k * COLUMN.gap;
}

/**
 * Where a vehicle `d` m along the road is, `off` m to the right of its way
 * (passing), and which way it faces (rad, as the crew's tank's: 0 faces
 * -z), into `out`. Off the road's ends it stands at the nearer end.
 */
export function columnPose(d: number, off: number, out: RoutePose): RoutePose {
  const pts = COLUMN_ROUTE.points;
  let along = Math.max(0, Math.min(COLUMN_LENGTH, d));
  let k = 1;
  for (; k < pts.length - 1; k++) {
    const leg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (along <= leg) break;
    along -= leg;
  }
  const ax = pts[k - 1][0];
  const az = pts[k - 1][1];
  const dx = pts[k][0] - ax;
  const dz = pts[k][1] - az;
  const leg = Math.hypot(dx, dz) || 1;
  const t = Math.min(1, along / leg);
  const ux = dx / leg;
  const uz = dz / leg;
  // To the right of the way (-uz, ux): facing -z, the right is +x.
  out.x = ax + dx * t - uz * off;
  out.z = az + dz * t + ux * off;
  out.heading = Math.atan2(-dx, -dz);
  return out;
}

/** What the column's movement reads and writes of each vehicle (EnemyBattery's state). */
export interface ColumnState extends ColumnPlace {
  present: boolean;
  alive: boolean;
  /** It has the crew's tank (a tank halts for it). */
  tracking: boolean;
  held: boolean;
  /** Along the road, m. */
  d: number;
  moving: boolean;
  /** Pulling round a stopped vehicle ahead, and how far off the road it is now, m. */
  pass: boolean;
  off: number;
  /** Held up behind a stopped vehicle this long, s. */
  blocked: number;
}

/** Vehicle `k`'s pace now, m/s: a lorry runs once the ambush is sprung. */
export function columnSpeed(k: number, sprung: boolean): number {
  return sprung && COLUMN_VEHICLES[k]?.kind === 'truck' ? COLUMN.run : COLUMN.speed;
}

/** What the column's pace reads of each vehicle: on both pages (the guest from the host's messages). */
export interface ColumnPlace {
  present: boolean;
  alive: boolean;
  d: number;
  moving: boolean;
  pass: boolean;
}

/**
 * Vehicle `k`'s pace `dt` s on, m/s, with the others where `vehicles` has
 * them: its own (columnSpeed) unless one ahead on the road is within
 * `close` and it isn't passing: then that one's pace if it is driving on
 * slower, or -1 if it is stopped (a wreck, or a tank halted to fire).
 */
export function columnPace(vehicles: readonly Readonly<ColumnPlace>[], k: number, sprung: boolean, dt: number): number {
  const v = vehicles[k];
  let pace = columnSpeed(k, sprung);
  if (v.pass) return pace;
  const reach = COLUMN.close + pace * dt;
  for (let j = 0; j < vehicles.length; j++) {
    const o = vehicles[j];
    if (j === k || !o.present || gotAway(o.d) || o.d <= v.d || o.d - v.d >= reach) continue;
    if (!o.alive || !o.moving) return -1;
    pace = Math.min(pace, columnSpeed(j, sprung));
  }
  return pace;
}

/**
 * `dt` s on for the column (`vehicles` in its order of march): each live
 * vehicle drives on at its pace (columnPace) unless it is a tank that has
 * the crew's tank, or a stopped one ahead holds it up; held up behind a
 * stopped or slower one for `bypassAfter`, it pulls off the road and
 * passes, and comes back on once clear. Returns whether any vehicle started
 * or stopped, or began or ended passing (the guest must be told).
 */
export function stepColumn(vehicles: ColumnState[], dt: number, sprung: boolean): boolean {
  let changed = false;
  for (let k = 0; k < vehicles.length; k++) {
    const v = vehicles[k];
    if (!v.present) continue;
    if (!v.alive || gotAway(v.d)) {
      if (v.moving) changed = true;
      v.moving = false;
      continue;
    }
    const tank = COLUMN_VEHICLES[k]?.kind === 'tank';
    let pace = tank && v.tracking ? 0 : v.held ? 0 : columnPace(vehicles, k, sprung, dt);
    if (!(tank && v.tracking) && !v.held && pace < columnSpeed(k, sprung)) {
      // Held up behind a stopped or a slower vehicle: after a while it pulls round.
      v.blocked += dt;
      if (v.blocked >= COLUMN.bypassAfter) {
        v.pass = true;
        v.blocked = 0;
        changed = true;
        pace = columnSpeed(k, sprung);
      }
    } else {
      v.blocked = 0;
    }
    if (v.pass && onRoad(v.d)) {
      // Back on the road once nothing else is within `close` of it, ahead or behind.
      let clear = true;
      for (let j = 0; j < vehicles.length; j++) {
        const o = vehicles[j];
        if (j !== k && o.present && !gotAway(o.d) && Math.abs(o.d - v.d) <= COLUMN.close) clear = false;
      }
      if (clear) {
        v.pass = false;
        changed = true;
      }
    }
    const go = pace > 0;
    if (go !== v.moving) {
      v.moving = go;
      changed = true;
    }
    if (go) v.d += pace * dt;
    v.off = easeOff(v.off, v.pass, dt);
  }
  return changed;
}

/** A vehicle's way off the road `dt` s on: towards passOffset while passing, back to 0 after. */
export function easeOff(off: number, pass: boolean, dt: number): number {
  const want = pass ? COLUMN.passOffset : 0;
  const step = COLUMN.sideRate * dt;
  return off + Math.max(-step, Math.min(step, want - off));
}
