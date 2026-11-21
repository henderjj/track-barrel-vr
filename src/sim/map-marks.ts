/**
 * Enemies seen, pencilled on the map (F2.11, docs/map-marks.md): an enemy
 * gun, tank or lorry the crew has seen through the gunsight or a periscope
 * (in its field, with a clear line, for SEE_TIME), or whose flash it has
 * seen, goes on the commander's map in red where it was seen, numbered in
 * the order seen; a tank seen again further on is rubbed out and pencilled
 * where it is now; one knocked out is crossed through. The host keeps the
 * book and sends it to the guest whole whenever it changes. Engine-free:
 * the field and line sums, the seeing clocks and the book.
 *
 * World space as src/sim/terrain.ts: +X east, −Z north. A heading or a
 * turn is about +Y, positive left; the way it faces is (−sin, −cos).
 */

import { ENEMY_COUNT, groupOf, isTank } from './enemy-guns.js';
import { FIELD_MAP } from './field-map.js';
import { TILE } from './terrain.js';

/** What a mark is drawn as: the map's symbols for an anti-tank gun, a tank and a lorry. */
export type MarkKind = 'gun' | 'tank' | 'lorry';

/** How the crew came to know of it: seen through a sight or periscope, or only its gun's flash. */
export type MarkHow = 'seen' | 'flash';

export interface MapMark {
  /** The enemy's index (src/sim/enemy-guns.ts). */
  enemy: number;
  kind: MarkKind;
  /** Where it was pencilled, world m, on the map's copy of the ground. */
  x: number;
  z: number;
  /** Its number on the map: 1 for the first seen. */
  n: number;
  /** Crossed through: knocked out. */
  out: boolean;
  how: MarkHow;
}

/** In a sight's field with a clear line this long, s, an enemy is seen and pencilled. */
export const SEE_TIME = 1;
/** Out of the field, a part-seen enemy's clock runs back this fast (a share of SEE_TIME a second). */
export const SEE_FORGET = 0.5;
/** Nothing further than this is made out through a sight or periscope, m. */
export const MAX_SEE_RANGE = 1500;
/** A tank seen again this far from its mark is pencilled afresh where it is, m. */
export const MOVED = 25;
/** Marks are pencilled to this, m: a six-figure grid reference's 10 m. */
export const MARK_ROUND = 10;

/** What enemy `i` is drawn as on the map. */
export function kindOf(i: number): MarkKind {
  if (groupOf(i) === 'guns') return 'gun';
  return isTank(i) ? 'tank' : 'lorry';
}

/** A number of metres to the nearest MARK_ROUND. */
function rounded(m: number): number {
  return Math.round(m / MARK_ROUND) * MARK_ROUND;
}

/**
 * The copy of a world point (the ground repeats every TILE) on the map,
 * into `out`: the one nearest the map's middle.
 */
export function onMap(x: number, z: number, out: [number, number]): [number, number] {
  const mx = (FIELD_MAP.west + FIELD_MAP.east) / 2;
  const mz = (FIELD_MAP.north + FIELD_MAP.south) / 2;
  out[0] = x + Math.round((mx - x) / TILE) * TILE;
  out[1] = z + Math.round((mz - z) / TILE) * TILE;
  return out;
}

/** Something to look through: where it is, the way it looks (world yaw, positive left, and pitch, up) and its half fields, rad. */
export interface Viewer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  halfX: number;
  halfY: number;
}

export function createViewer(): Viewer {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, halfX: 0, halfY: 0 };
}

/** Whether the point (x, y, z) is in the viewer's field and within MAX_SEE_RANGE (the line to it not checked). */
export function inField(v: Readonly<Viewer>, x: number, y: number, z: number): boolean {
  const dx = x - v.x;
  const dy = y - v.y;
  const dz = z - v.z;
  const flat = Math.hypot(dx, dz);
  if (flat < 1 || flat > MAX_SEE_RANGE) return false;
  // Its bearing round from the way the viewer looks, positive left, within (−π, π].
  const bearing = Math.atan2(-dx, -dz);
  let across = bearing - v.yaw;
  across -= 2 * Math.PI * Math.round(across / (2 * Math.PI));
  if (Math.abs(across) > v.halfX) return false;
  const up = Math.atan2(dy, flat) - v.pitch;
  return Math.abs(up) <= v.halfY;
}

/**
 * Each enemy's seeing clock: run up while it is in a field with a clear
 * line, back (slower) while not. Allocation-free.
 */
export class SeeingClocks {
  readonly t = new Float32Array(ENEMY_COUNT);

  /** Step enemy `i`'s clock by `dt` s; true the moment it reaches SEE_TIME (then it starts again). */
  step(i: number, inView: boolean, dt: number): boolean {
    if (inView) {
      this.t[i] += dt;
      if (this.t[i] >= SEE_TIME) {
        this.t[i] = 0;
        return true;
      }
    } else {
      this.t[i] = Math.max(0, this.t[i] - dt * SEE_FORGET);
    }
    return false;
  }

  clear(): void {
    this.t.fill(0);
  }
}

/** The host's book of marks: what the map shows. `v` goes up on every change. */
export class MarkBook {
  marks: MapMark[] = [];
  v = 0;
  private next = 1;
  private readonly at: [number, number] = [0, 0];

  /**
   * Enemy `i` seen (or its flash) at world (x, z): pencilled if new, moved if
   * a tank or lorry now further than MOVED from its mark, a flash's mark made
   * a seen one. True if the map changed.
   */
  seen(i: number, x: number, z: number, how: MarkHow): boolean {
    onMap(x, z, this.at);
    const mx = rounded(this.at[0]);
    const mz = rounded(this.at[1]);
    const m = this.marks.find((k) => k.enemy === i);
    if (!m) {
      this.marks.push({ enemy: i, kind: kindOf(i), x: mx, z: mz, n: this.next++, out: false, how });
      this.v++;
      return true;
    }
    let changed = false;
    if (m.kind !== 'gun' && !m.out && Math.hypot(mx - m.x, mz - m.z) > MOVED) {
      m.x = mx;
      m.z = mz;
      changed = true;
    }
    if (how === 'seen' && m.how === 'flash') {
      m.how = 'seen';
      changed = true;
    }
    if (changed) this.v++;
    return changed;
  }

  /** Enemy `i` knocked out: its mark (if it has one) crossed through. True if the map changed. */
  knockedOut(i: number): boolean {
    const m = this.marks.find((k) => k.enemy === i);
    if (!m || m.out) return false;
    m.out = true;
    this.v++;
    return true;
  }

  /** Rub out the marks of enemies no longer there (a mission over, another begun); numbering starts again when none are left. True if the map changed. */
  keep(present: readonly boolean[]): boolean {
    const before = this.marks.length;
    this.marks = this.marks.filter((m) => present[m.enemy]);
    if (this.marks.length === 0) this.next = 1;
    if (this.marks.length === before) return false;
    this.v++;
    return true;
  }

  /** The book as the host sends it. */
  encode(): MarksEvent {
    return { t: 'marks', v: this.v, m: this.marks.map((k) => [k.enemy, k.x, k.z, k.n, (k.out ? 1 : 0) | (k.how === 'flash' ? 2 : 0)]) };
  }

  /** Take the host's book (a guest): false if it is older than this one, or not a book. */
  apply(e: unknown): boolean {
    const book = parseMarks(e);
    if (!book || book.v <= this.v) return false;
    this.marks = book.marks;
    this.v = book.v;
    this.next = this.marks.reduce((n, k) => Math.max(n, k.n + 1), 1);
    return true;
  }
}

/** The `marks` event: each mark as [enemy, x, z, n, flags (1 out, 2 flash)]. */
export interface MarksEvent {
  t: 'marks';
  v: number;
  m: [number, number, number, number, number][];
}

/** A `marks` event's book, or null if it isn't one. */
export function parseMarks(e: unknown): { v: number; marks: MapMark[] } | null {
  const o = e as Partial<MarksEvent> | null;
  if (!o || typeof o.v !== 'number' || !Array.isArray(o.m)) return null;
  const marks: MapMark[] = [];
  for (const row of o.m) {
    if (!Array.isArray(row) || row.length < 5 || !row.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [enemy, x, z, n, flags] = row;
    if (!Number.isInteger(enemy) || enemy < 0 || enemy >= ENEMY_COUNT) return null;
    marks.push({ enemy, kind: kindOf(enemy), x, z, n, out: (flags & 1) !== 0, how: (flags & 2) !== 0 ? 'flash' : 'seen' });
  }
  return { v: o.v, marks };
}

/** The `mark-seen` event: a guest's crew saw enemy `i` at (x, z), world m. */
export interface MarkSeenEvent {
  t: 'mark-seen';
  i: number;
  x: number;
  z: number;
}

/** A `mark-seen` event's enemy and place, or null. */
export function parseMarkSeen(e: unknown): { i: number; x: number; z: number } | null {
  const o = e as Partial<MarkSeenEvent> | null;
  if (!o || !Number.isInteger(o.i) || typeof o.x !== 'number' || typeof o.z !== 'number') return null;
  if ((o.i as number) < 0 || (o.i as number) >= ENEMY_COUNT || !Number.isFinite(o.x) || !Number.isFinite(o.z)) return null;
  return { i: o.i as number, x: o.x, z: o.z };
}

/** How high to look at enemy `i` above the ground, m: a gun's shield, a tank's turret, a lorry's cab. */
export function sightHeight(i: number): number {
  if (groupOf(i) === 'guns') return 0.8;
  return isTank(i) ? 1.9 : 1.6;
}

