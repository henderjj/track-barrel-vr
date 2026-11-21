/**
 * The commander's words to the driver (F2.13, docs/navigator.md): where a
 * spot is from the tank, as a bearing off north, a distance and a turn
 * from the way the tank faces, for a goal touched on the map or the map
 * course's next checkpoint. Engine-free.
 *
 * World space as src/sim/terrain.ts: +X east, −Z north; a heading of 0
 * faces north and positive turns left (west).
 */

import { gridRef } from './field-map.js';

const DEG = 180 / Math.PI;

/** A spot from the tank: its bearing (degrees clockwise from north, 0 to 359), distance (m) and the turn to face it (degrees, positive right). */
export interface SpotFrom {
  bearing: number;
  distance: number;
  turn: number;
}

/** Where (x, z) is from a tank at (tx, tz) facing `heading`, both on the same copy of the repeating ground. */
export function spotFrom(tx: number, tz: number, heading: number, x: number, z: number, out: SpotFrom): SpotFrom {
  const dx = x - tx;
  const dz = z - tz;
  // Clockwise from north: east is 90°.
  const bearing = Math.atan2(dx, -dz) * DEG;
  out.bearing = Math.round((bearing + 360) % 360) % 360;
  out.distance = Math.hypot(dx, dz);
  // The tank faces (-sin h, -cos h); its bearing is -h.
  let turn = bearing + heading * DEG;
  turn = ((turn + 540) % 360) - 180;
  out.turn = turn;
  return out;
}

/** A bearing as a commander says it: three figures. */
export function bearingWords(bearing: number): string {
  return `${String(Math.round(bearing) % 360).padStart(3, '0')}°`;
}

/** A distance as a commander says it: to 10 m, or 50 m past a kilometre. */
export function distanceWords(distance: number): string {
  if (distance >= 1000) return `${(Math.round(distance / 50) * 50 / 1000).toFixed(2).replace(/0$/, '')} km`;
  return `${Math.max(10, Math.round(distance / 10) * 10)} m`;
}

/** The turn as a driver wants it: "dead ahead" within 10°, else left or right by so many degrees (to 5°). */
export function turnWords(turn: number): string {
  const a = Math.abs(turn);
  if (a < 10) return 'dead ahead';
  if (a > 170) return 'behind you';
  return `${turn > 0 ? 'right' : 'left'} ${Math.round(a / 5) * 5}°`;
}

/** The order for a spot touched on the map: "Driver, go to 046036: 045°, 320 m, right 30°". */
export function goOrder(spot: SpotFrom, x: number, z: number): string {
  return `Driver, go to ${gridRef(x, z, 6)}: ${bearingWords(spot.bearing)}, ${distanceWords(spot.distance)}, ${turnWords(spot.turn)}`;
}

/** The crewmate commander's heading for the map course's next checkpoint: "CP2: steer 045°, 320 m, left 30°". */
export function headingOrder(cp: number, spot: SpotFrom): string {
  return `CP${cp}: steer ${bearingWords(spot.bearing)}, ${distanceWords(spot.distance)}, ${turnWords(spot.turn)}`;
}

/** The crewmate gives the next heading this often while the course runs, s, and at once when a checkpoint is reached. */
export const HEADING_EVERY = 12;

/** A `nav-goto` event: the spot the commander touched, on the map's copy of the ground. */
export interface GotoEvent {
  t: 'nav-goto';
  x: number;
  z: number;
}

/** A goto from the network, or null if it isn't one (a spot on the map's ground, finite). */
export function parseGoto(e: unknown, bounds: { west: number; east: number; north: number; south: number }): { x: number; z: number } | null {
  const o = e as Partial<GotoEvent> | null;
  if (!o || typeof o.x !== 'number' || typeof o.z !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.z)) return null;
  if (o.x < bounds.west || o.x > bounds.east || o.z < bounds.north || o.z > bounds.south) return null;
  return { x: o.x, z: o.z };
}
