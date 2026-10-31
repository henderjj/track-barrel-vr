/**
 * The tank's interior lighting (docs/interior.md): daylight coming in
 * through the open hatches and the vision slit, and two dome lamps, as a
 * Sherman's crew compartment is lit. There are no real-time lights: the
 * cabin's materials darken the sky's image-based light inside the hull and
 * the turret and add these pools to it, in their shader
 * (src/scene-assets/cabin-light.ts). This is the same sum in plain
 * TypeScript, with the numbers, so the tests can check it. Engine-free.
 *
 * Hull and turret space as in src/sim/cabin.ts. Each light is fixed to the
 * hull or to the turret; a turret light turns with it.
 */

import { DRIVER_HATCH, frontAt, HULL, SEATS, TURRET, VISION_SLIT } from './cabin.js';

export interface InteriorLight {
  /** What it is, for the tests and the design note. */
  id: 'driver-hatch' | 'gunner-hatch' | 'slit' | 'hull-lamp' | 'turret-lamp' | 'gunner-lamp';
  frame: 'hull' | 'turret';
  /** Where it shines from, in its frame, m. */
  at: readonly [number, number, number];
  /** Its colour times its strength, linear RGB. */
  color: readonly [number, number, number];
  /** How far it reaches: it is half as bright this far away, m. */
  range: number;
  /**
   * For daylight through a hatch, how tightly it falls straight down: the
   * light is multiplied by the cosine of the angle from straight down to
   * this power. 0 shines every way, as a lamp does.
   */
  cone: number;
}

/** Daylight, a little blue, and a lamp's warm tungsten. */
const DAY = [0.85, 0.9, 1.0] as const;
const LAMP = [1.0, 0.72, 0.42] as const;
const scaled = (c: readonly number[], k: number) => [c[0] * k, c[1] * k, c[2] * k] as const;

/** The gunner's hatch's middle in the turret roof, turret space (cabin.scene-asset.ts's GUNNER_HATCH). */
const GUNNER_HATCH_MIDDLE = [SEATS.gunner.eye[0], SEATS.gunner.eye[2] + 0.1] as const;

export const INTERIOR_LIGHTS: readonly InteriorLight[] = [
  // The sky through the open hatches: from above each opening, falling mostly straight down through it.
  {
    id: 'driver-hatch',
    frame: 'hull',
    at: [(DRIVER_HATCH[0] + DRIVER_HATCH[2]) / 2, HULL.roof + 0.45, (DRIVER_HATCH[1] + DRIVER_HATCH[3]) / 2],
    color: scaled(DAY, 1.2),
    range: 1.2,
    cone: 12,
  },
  { id: 'gunner-hatch', frame: 'turret', at: [GUNNER_HATCH_MIDDLE[0], TURRET.roof + 0.45, GUNNER_HATCH_MIDDLE[1]], color: scaled(DAY, 1.2), range: 1.2, cone: 12 },
  // A little daylight in through the slit.
  { id: 'slit', frame: 'hull', at: [VISION_SLIT.x, VISION_SLIT.y, VISION_SLIT.z - 0.1], color: scaled(DAY, 0.25), range: 0.35, cone: 0 },
  // The dome lamps: one on the hull roof over the transmission, one on the turret roof behind the gun, and one over the
  // gunner's controls, ahead and right of their head and clear of their hatch (a Sherman's turret had one to three).
  { id: 'hull-lamp', frame: 'hull', at: [0.1, HULL.roof - 0.05, -1.2], color: scaled(LAMP, 0.5), range: 0.5, cone: 0 },
  { id: 'turret-lamp', frame: 'turret', at: [-0.45, TURRET.roof - 0.05, 0.45], color: scaled(LAMP, 0.5), range: 0.5, cone: 0 },
  { id: 'gunner-lamp', frame: 'turret', at: [0.72, TURRET.roof - 0.05, -0.62], color: scaled(LAMP, 0.5), range: 0.6, cone: 0 },
];

/** Where the dome lamps' housings hang, in their frames: the lamps' light comes from just under them. */
export const DOME_LAMPS = INTERIOR_LIGHTS.filter((l) => l.id.endsWith('-lamp'));

/** The sky's light left inside, before any light pools: dim and a little warm, linear RGB. */
export const INTERIOR_AMBIENT = [0.065, 0.062, 0.058] as const;
/** On the hull floor the ambient is this much of what it is from 0.9 m up. */
export const FLOOR_SHADE = 0.55;
export const FLOOR_SHADE_HEIGHT = 0.9;
/** How much of a light reaches a face turned away from it (the rest falls off with the angle). */
export const WRAP = 0.25;

/**
 * How each player has the cabin, from the game menu's Sound and view tab
 * (src/live-settings.ts), to find what looks best (John's headset check,
 * 2026-10-30): which hatches stand open, and the ambient and the dome lamps
 * scaled from the numbers above. Each player's own view: nothing of it goes
 * over the network.
 */
export interface CabinLook {
  driverHatch: boolean;
  gunnerHatch: boolean;
  /** The ambient times this, before the hatches' share of it. */
  ambient: number;
  /** The dome lamps times this: 0 off. */
  lamps: number;
}

/** Which hatches stand open, as the settings spell it. */
export type OpenHatches = 'both' | 'driver' | 'gunner' | 'none';

export function parseHatches(raw: unknown, fallback: OpenHatches = 'both'): OpenHatches {
  return raw === 'both' || raw === 'driver' || raw === 'gunner' || raw === 'none' ? raw : fallback;
}

/** The look the settings ask for: `hatches` open, the ambient times `ambient`, the lamps times `lamps`. */
export function lookFor(hatches: OpenHatches, ambient: number, lamps: number, out: CabinLook): CabinLook {
  out.driverHatch = hatches === 'both' || hatches === 'driver';
  out.gunnerHatch = hatches === 'both' || hatches === 'gunner';
  out.ambient = ambient;
  out.lamps = lamps;
  return out;
}

/** The look in effect, which CabinLightSystem keeps to the settings. */
export const cabinLook: CabinLook = { driverHatch: false, gunnerHatch: false, ambient: 0.5, lamps: 1 };

/**
 * How much of the ambient is the sky's light in through each open hatch, the
 * rest coming through the vision slit, the periscopes and the sight and off
 * the ivory paint: shutting both leaves 40% of it.
 */
export const HATCH_AMBIENT_SHARE = 0.3;

/** What `look` multiplies the ambient by. */
export function ambientScale(look: Readonly<CabinLook>): number {
  const shut = (look.driverHatch ? 0 : 1) + (look.gunnerHatch ? 0 : 1);
  return look.ambient * (1 - HATCH_AMBIENT_SHARE * shut);
}

/** What `look` multiplies `light` by: a shut hatch lets no daylight in; the lamps as set; the slit always. */
export function lightScale(light: InteriorLight, look: Readonly<CabinLook>): number {
  switch (light.id) {
    case 'driver-hatch':
      return look.driverHatch ? 1 : 0;
    case 'gunner-hatch':
      return look.gunnerHatch ? 1 : 0;
    case 'hull-lamp':
    case 'turret-lamp':
    case 'gunner-lamp':
      return look.lamps;
    default:
      return 1;
  }
}

/** Margins round the inner faces for the inside tests, m: inside the walls' 8 cm thickness, so the outer faces are outside. */
const MARGIN = 0.03;
/** The turret's inside: inner faces of its walls, its roof's underside and the hull roof it stands on, turret space, m. */
export const TURRET_INSIDE = { halfWidth: TURRET.halfWidth - HULL.wall, floor: HULL.roof - 0.01, roof: TURRET.roof } as const;

/** A hull-space point in turret space for turret `yaw`, into `out` (as src/sim/cabin.ts's hullToSeat). */
export function hullToTurret(p: readonly number[], yaw: number, out: [number, number, number]): [number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const z = p[2] - TURRET.z;
  out[0] = p[0] * c - z * s;
  out[1] = p[1];
  out[2] = p[0] * s + z * c;
  return out;
}

/** A turret-space point in hull space for turret `yaw`, into `out`. */
export function turretToHull(p: readonly number[], yaw: number, out: [number, number, number]): [number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = p[0];
  const z = p[2];
  out[0] = x * c + z * s;
  out[1] = p[1];
  out[2] = -x * s + z * c + TURRET.z;
  return out;
}

/** Whether a hull-space point is inside the crew compartment: the hull's or the turret's (turned `yaw`). */
export function insideCabin(p: readonly number[], yaw: number): boolean {
  const [x, y, z] = p;
  const inHull = Math.abs(x) < HULL.halfWidth + MARGIN && y > -MARGIN && y < HULL.roof + MARGIN && z > frontAt(y) - MARGIN && z < HULL.rear + MARGIN;
  if (inHull) return true;
  const t = hullToTurret(p, yaw, tmp);
  const i = TURRET_INSIDE;
  return Math.abs(t[0]) < i.halfWidth + MARGIN && Math.abs(t[2]) < i.halfWidth + MARGIN && t[1] > i.floor && t[1] < i.roof + MARGIN;
}
const tmp: [number, number, number] = [0, 0, 0];
const lightAt: [number, number, number] = [0, 0, 0];

/**
 * What the sky's light is multiplied by at hull-space point `p` on a face
 * whose unit normal is `n`, with the turret turned `yaw` and the cabin as
 * `look` has it: 1 outside the cabin; inside, the dim ambient (darker low in
 * the hull) plus each light's pool. Into `out`, linear RGB. The shader does
 * the same sum.
 */
export function interiorLight(
  p: readonly number[],
  n: readonly number[],
  yaw: number,
  out: [number, number, number],
  look: Readonly<CabinLook> = cabinLook,
): [number, number, number] {
  if (!insideCabin(p, yaw)) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return out;
  }
  const t = Math.min(1, Math.max(0, p[1] / FLOOR_SHADE_HEIGHT));
  const low = (FLOOR_SHADE + (1 - FLOOR_SHADE) * t * t * (3 - 2 * t)) * ambientScale(look);
  out[0] = INTERIOR_AMBIENT[0] * low;
  out[1] = INTERIOR_AMBIENT[1] * low;
  out[2] = INTERIOR_AMBIENT[2] * low;
  for (const light of INTERIOR_LIGHTS) {
    const scale = lightScale(light, look);
    if (scale === 0) continue;
    const at = light.frame === 'turret' ? turretToHull(light.at, yaw, lightAt) : light.at;
    const dx = at[0] - p[0];
    const dy = at[1] - p[1];
    const dz = at[2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(d2);
    const facing = WRAP + (1 - WRAP) * Math.max(0, (n[0] * dx + n[1] * dy + n[2] * dz) / d);
    const cone = light.cone > 0 ? Math.max(0, dy / d) ** light.cone : 1;
    const k = (scale * facing * cone) / (1 + d2 / (light.range * light.range));
    out[0] += light.color[0] * k;
    out[1] += light.color[1] * k;
    out[2] += light.color[2] * k;
  }
  return out;
}
