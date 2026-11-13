/**
 * What the tracks run on, and what that does to their sound (the sound
 * pass, F6.1; docs/audio.md, "What the tracks run on"). Engine-free: no
 * IWSDK, DOM or renderer imports.
 *
 * The world has three surfaces, each drawn where these rules say it is:
 * grass everywhere, the range's two dirt roads (src/sim/range.ts) and the
 * biathlon course's gravel track (src/sim/course.ts). A track is nearly
 * four metres of steel lying on the ground, so each track has a footing of
 * its own: how much of its length is on each surface, and the blend of
 * what those surfaces sound like. One track on the road and one on the
 * verge sound like it, and a track crossing a road's edge changes over as
 * it goes, not all at once.
 *
 * A new surface (cobbles, tarmac, a bridge's planks) is a name in
 * SURFACES, a row in SURFACE_SOUND and a rule in surfaceAt: nothing else
 * needs to know it.
 */
import { onGravel } from './course.js';
import { BOGIES, TRACK } from './exterior.js';
import { onRoad } from './range.js';

export const SURFACES = ['grass', 'dirt', 'gravel'] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * How a surface changes a track's sound. Each is a factor on the track's
 * sound as tuned on a dirt road (1 there), but for `gritHz`.
 */
export interface SurfaceSound {
  /** The links' lower ring (under about 1.2 kHz): turf beds a link in and damps it, stone lets it ring. */
  ring: number;
  /** The links' upper ring, the clink of steel on something hard. */
  top: number;
  /** Each link's thud through the floor as it lands. */
  thud: number;
  /** The ground's own noise under the links: grit and stones crushed and thrown, or turf torn. Gravel is 1. */
  grit: number;
  /** Where that noise lies, Hz: a low rustle on turf, a bright crunch on stones. */
  gritHz: number;
  /** The rumble through the floor: its level, and how far its low-pass opens. */
  rumble: number;
  rumbleOpen: number;
  /** The pins' squeal: a track slips on wet turf, and bites on a hard road. */
  squeal: number;
}

export const SURFACE_SOUND: Record<Surface, SurfaceSound> = {
  // Turf over soft earth: the links bed in, so little rings; a low tearing rustle and a duller rumble.
  grass: { ring: 0.85, top: 0.5, thud: 0.7, grit: 0.5, gritHz: 750, rumble: 0.9, rumbleOpen: 0.75, squeal: 0.6 },
  // Packed earth with grit on it: what the tracks were tuned on.
  dirt: { ring: 1, top: 1, thud: 1, grit: 0.45, gritHz: 1600, rumble: 1, rumbleOpen: 1, squeal: 1 },
  // Loose stones over a hard bed: a crunch under every link, the links clinking on stone, the floor busier.
  gravel: { ring: 1.05, top: 1.2, thud: 1.1, grit: 1, gritHz: 3000, rumble: 1.08, rumbleOpen: 1.2, squeal: 0.85 },
};

/** The surface at (x, z), world space: as drawn. */
export function surfaceAt(x: number, z: number): Surface {
  if (onRoad(x, z)) return 'dirt';
  if (onGravel(x, z)) return 'gravel';
  return 'grass';
}

/** What the tracks are on, in words: for the line under Practice → Tank sounds. */
export function groundLine(left: Surface, right: Surface): string {
  return left === right ? left : `${left} (left) and ${right} (right)`;
}

/** Where a track lies on the ground: from its first road wheel to its last, hull z, m (forward is -z). */
export const TRACK_CONTACT = {
  front: BOGIES.z[0] - BOGIES.spread,
  rear: BOGIES.z[BOGIES.z.length - 1] + BOGIES.spread,
} as const;

/** A track's footing is judged at this many points along it, evenly spaced from end to end. */
export const CONTACT_POINTS = 5;

/** What one track is on: the share of its length on each surface (in SURFACES' order), the one most of it is on, and the blend of their sounds. */
export interface Footing extends SurfaceSound {
  shares: number[];
  surface: Surface;
}

export function createFooting(surface: Surface = 'dirt'): Footing {
  const out: Footing = { shares: SURFACES.map(() => 0), surface, ...SURFACE_SOUND[surface] };
  out.shares[SURFACES.indexOf(surface)] = 1;
  return out;
}

/** Work out a footing's sound from its shares: levels blend straight, the grit's place by ratio (half way from 750 to 3000 Hz is 1500). */
function blend(out: Footing): Footing {
  let ring = 0;
  let top = 0;
  let thud = 0;
  let grit = 0;
  let logHz = 0;
  let rumble = 0;
  let rumbleOpen = 0;
  let squeal = 0;
  let most = 0;
  for (let i = 0; i < SURFACES.length; i++) {
    const share = out.shares[i];
    if (share > out.shares[most]) most = i;
    if (share === 0) continue;
    const s = SURFACE_SOUND[SURFACES[i]];
    ring += share * s.ring;
    top += share * s.top;
    thud += share * s.thud;
    grit += share * s.grit;
    logHz += share * Math.log(s.gritHz);
    rumble += share * s.rumble;
    rumbleOpen += share * s.rumbleOpen;
    squeal += share * s.squeal;
  }
  out.surface = SURFACES[most];
  out.ring = ring;
  out.top = top;
  out.thud = thud;
  out.grit = grit;
  out.gritHz = Math.exp(logHz);
  out.rumble = rumble;
  out.rumbleOpen = rumbleOpen;
  out.squeal = squeal;
  return out;
}

/** A footing `t` of the way (0 to 1) from all on surface `a` to all on `b`: the sound tour's and the preview clips'. */
export function footingBetween(a: Surface, b: Surface, t: number, out: Footing): Footing {
  const u = Math.min(1, Math.max(0, t));
  out.shares.fill(0);
  out.shares[SURFACES.indexOf(a)] += 1 - u;
  out.shares[SURFACES.indexOf(b)] += u;
  return blend(out);
}

/**
 * What the track on one side (`side` -1 left, 1 right) of a tank at
 * (x, z) facing `heading` is on.
 */
export function footingUnder(x: number, z: number, heading: number, side: -1 | 1, out: Footing): Footing {
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  // The track's middle line: `side` × TRACK.x to the right of the hull's (right is forward turned a quarter clockwise seen from above).
  const mx = x - fz * side * TRACK.x;
  const mz = z + fx * side * TRACK.x;
  out.shares.fill(0);
  for (let i = 0; i < CONTACT_POINTS; i++) {
    // Hull z runs backwards, so a point at hull z is that far behind the middle.
    const back = TRACK_CONTACT.front + ((TRACK_CONTACT.rear - TRACK_CONTACT.front) * i) / (CONTACT_POINTS - 1);
    const surface = surfaceAt(mx - fx * back, mz - fz * back);
    out.shares[SURFACES.indexOf(surface)] += 1 / CONTACT_POINTS;
  }
  return blend(out);
}

/** A tank that has moved this far, m, or turned this far, rad, since its tracks' footings were last judged has them judged again. */
export const FOOTING_STEP = 0.25;
export const FOOTING_TURN = 0.03;

/**
 * Both tracks' footings, kept up as the tank moves: judged again only once
 * it has moved FOOTING_STEP or turned FOOTING_TURN, since finding the
 * gravel means looking along the whole course.
 */
export class TankFooting {
  readonly left = createFooting('grass');
  readonly right = createFooting('grass');
  /** How many times the footings have been judged. */
  judged = 0;
  private x = Number.NaN;
  private z = Number.NaN;
  private heading = Number.NaN;

  /** The tank is at (x, z) facing `heading`: true if the footings were judged again. */
  update(x: number, z: number, heading: number): boolean {
    const moved = Math.hypot(x - this.x, z - this.z);
    // NaN the first time, and so judged.
    if (moved < FOOTING_STEP && Math.abs(heading - this.heading) < FOOTING_TURN) return false;
    this.x = x;
    this.z = z;
    this.heading = heading;
    footingUnder(x, z, heading, -1, this.left);
    footingUnder(x, z, heading, 1, this.right);
    this.judged++;
    return true;
  }
}
