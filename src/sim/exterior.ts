/**
 * The tank's outside, shaped as an M4A4 Sherman's (docs/exterior.md): the
 * upper hull widened into sponsons over the tracks, the long engine deck of
 * the A4's lengthened hull, the cast turret rounded outside its square
 * inside, and the vertical volute suspension's three bogies a side, with the
 * drive sprocket at the front and the idler at the back. Shared by the model
 * (src/scene-assets/exterior.scene-asset.ts and cabin.scene-asset.ts), the
 * tank's footprint on the ground (src/sim/tank-drive.ts), the driver's
 * turret dial and the tests, so they use one set of numbers. Engine-free.
 *
 * Hull space, as src/sim/cabin.ts: the hull floor inside at y = 0, the
 * front towards -Z, +X to the right. Nothing here moves the inside: the
 * walls, roof, hatches and seats stay where cabin.ts puts them, and the
 * outside is built round them.
 */

import { GROUND_Y, HULL, TURRET } from './cabin.js';

/** The upper hull over the tracks: its sides' outer faces at x = ±halfWidth, its floor (over the tracks) at `floor`, m. */
export const SPONSON = { halfWidth: 1.64, floor: 0.5 } as const;

/** The hull's top outside: the roof plate's top, hull y, m. */
export const DECK_TOP = HULL.roof + HULL.wall;

/**
 * The hull's back, behind the engine: the upright rear plate's outer face
 * (hull z) down to `lowY`, then the lower plate sloping forward to the belly,
 * which ends at `bellyEnd`; the belly's underside at `bottom`, m.
 */
export const HULL_REAR = { plate: 3.5, lowY: 0.25, bellyEnd: 3.1, bottom: -0.1 } as const;

/** The nose's rounded transmission cover, between the tracks: how far it bulges out of the nose plate, and its top and bottom, hull space, m. */
export const NOSE = { bulge: 0.2, top: 0.8, bottom: -0.1 } as const;

/** The tracks: the middle of each across (x = ±x), its width and thickness, and the distance between its shoes, m (16 1/2 in shoes, 6 in pitch). */
export const TRACK = { x: 1.41, width: 0.42, thickness: 0.05, pitch: 0.15 } as const;

/** The road wheels: radius, each of a pair's width and the gap between the pair (the track's guide horns run in it), m. */
export const ROAD_WHEEL = { radius: 0.26, width: 0.09, gap: 0.06 } as const;
/** The road wheels' axles' height: on the track lying on the ground, hull y, m. */
export const ROAD_WHEEL_Y = GROUND_Y + TRACK.thickness + ROAD_WHEEL.radius;

/**
 * The three bogies a side (the A4's are spaced wider than other Shermans'
 * for its longer hull): each one's middle, hull z, and its two road wheels'
 * axles `spread` either side of it; the return roller on its top, `roller`
 * behind the middle, m.
 */
export const BOGIES = {
  z: [-1.25, 0.45, 2.15] as readonly number[],
  spread: 0.28,
  roller: { dz: 0.12, y: 0.31, radius: 0.07 },
} as const;

/** The drive sprocket at the front and the idler at the back: middles (hull z, y) and radii (to the track's inside), m. */
export const SPROCKET = { z: -2.28, y: 0.1, radius: 0.3, teeth: 13 } as const;
export const IDLER = { z: 3.2, y: 0.05, radius: 0.24 } as const;

/**
 * The tank's outline seen from above, hull space, m: the sponsons' and the
 * tracks' outer faces, the transmission cover's nose and the rear plate.
 * It is what meets obstacles (src/sim/tank-drive.ts, FOOTPRINT).
 */
export const OUTLINE_EXTENT = {
  halfWidth: SPONSON.halfWidth,
  // The towing shackles stand a little out of the nose's cover.
  front: HULL.front - HULL.wall - NOSE.bulge - 0.08,
  // The air cleaners on the rear plate stand furthest back.
  rear: HULL_REAR.plate + 0.24,
} as const;

/** A circle in the side view (hull z, y) and its radius, m. */
type Circle = readonly [number, number, number];

/** What the track runs round, as circles to its middle (its inside plus half its thickness), side view. */
function trackCircles(): Circle[] {
  const half = TRACK.thickness / 2;
  const circles: Circle[] = [
    [SPROCKET.z, SPROCKET.y, SPROCKET.radius + half],
    [IDLER.z, IDLER.y, IDLER.radius + half],
  ];
  for (const z of BOGIES.z) {
    for (const s of [-1, 1]) circles.push([z + s * BOGIES.spread, ROAD_WHEEL_Y, ROAD_WHEEL.radius + half]);
    circles.push([z + BOGIES.roller.dz, BOGIES.roller.y, BOGIES.roller.radius + half]);
  }
  return circles;
}

/**
 * The track's middle line seen from the side, (hull z, y) points going
 * round: the tight loop round the sprocket, the road wheels, the idler and
 * the return rollers (the convex hull of their circles), m.
 */
export function trackLoop(): [number, number][] {
  const points: [number, number][] = [];
  for (const [z, y, r] of trackCircles()) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      points.push([z + r * Math.cos(a), y + r * Math.sin(a)]);
    }
  }
  return convexHull(points);
}

/** The convex hull of 2D points, counter-clockwise (Andrew's monotone chain), dropping points in line. */
function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-9) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-9) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The cast turret's outside, turret space (origin at the ring's middle on
 * the hull floor's level, the gun towards -Z), m. Seen from above it is a
 * rounded oblong (`halfWidth` either side, `front` ahead and `rear` behind,
 * its corners rounded with `frontCorner` and `rearCorner`), its sides
 * leaning in a little to the top and its roof's edge rounded over with
 * `edge` (turretShellInset). Its inside stays cabin.ts's square one, its
 * corners and the roof's edges rounded with `TURRET_INSIDE_ROUNDING`; the
 * outside is kept clear of it all round (test/exterior.test.ts).
 */
export const TURRET_SHELL = {
  halfWidth: 1.22,
  front: 1.22,
  rear: 1.3,
  frontCorner: 0.4,
  rearCorner: 0.42,
  /** The shell's foot: over the hull's deck it turns on, and over the hatches' lids shut on it (3 cm), as it sweeps over them. */
  foot: DECK_TOP + 0.045,
  /** The roof's top: TURRET.roof's plate's top, as before (the gunner's periscope and hatch stand on it). */
  top: TURRET.roof + HULL.wall,
  /** The roof's edge: its radius, and how far the sides have leant in where it starts. */
  edge: 0.28,
  lean: 0.05,
  /** How far the foot is tucked in under the sides' widest. */
  tuck: 0.035,
} as const;

/** The radius of the turret's inside's rounded corners and roof edges, m: as the chamfers inside it before. */
export const TURRET_INSIDE_ROUNDING = 0.15;

/**
 * How far in from the shell's widest outline (TURRET_SHELL) the outside is
 * at height `y` (turret space), m: tucked in at the foot, widest from a
 * little above it, leaning in towards the roof, then rounded over its edge
 * to the flat roof.
 */
export function turretShellInset(y: number): number {
  const s = TURRET_SHELL;
  const widest = s.foot + 0.07;
  const edgeStart = s.top - s.edge;
  const leanStart = s.foot + 0.3;
  if (y <= widest) return s.tuck * (1 - Math.max(0, y - s.foot) / (widest - s.foot));
  if (y <= leanStart) return 0;
  if (y <= edgeStart) return s.lean * ((y - leanStart) / (edgeStart - leanStart)) ** 1.5;
  const k = Math.min(1, (y - edgeStart) / s.edge);
  // A quarter circle: in by the radius times (1 - cos) as it rises by the radius times sin.
  const angle = Math.asin(k);
  return s.lean + s.edge * (1 - Math.cos(angle));
}

/** The heights the shell's outside is drawn at, foot to roof, with the edge's quarter circle in even steps. */
export function turretShellRings(): number[] {
  const s = TURRET_SHELL;
  const edgeStart = s.top - s.edge;
  const ys = [s.foot, s.foot + 0.03, s.foot + 0.07, s.foot + 0.3, s.foot + 0.45, edgeStart];
  const steps = 6;
  for (let i = 1; i <= steps; i++) ys.push(edgeStart + s.edge * Math.sin((i / steps) * (Math.PI / 2)));
  return ys;
}

/**
 * A rounded oblong: `halfWidth` either side, `front` ahead (-Z) and `rear`
 * behind, its front corners rounded with `frontCorner` and its back ones
 * with `rearCorner`, all shrunk by `inset`. Its point in direction `angle`
 * from its middle (0 straight ahead, -Z; positive turning towards -X, as
 * Three.js turns about +Y), into `out` as [x, z].
 */
export interface Oblong {
  halfWidth: number;
  front: number;
  rear: number;
  frontCorner: number;
  rearCorner: number;
}

/** How far a point (x, z) is outside an oblong shrunk by `inset` (negative inside), m. */
export function oblongDistance(o: Oblong, inset: number, x: number, z: number): number {
  const ahead = z < 0;
  const r = Math.max(0, (ahead ? o.frontCorner : o.rearCorner) - inset);
  const hx = o.halfWidth - inset - r;
  const hz = (ahead ? o.front : o.rear) - inset - r;
  const qx = Math.abs(x) - hx;
  const qz = Math.abs(z) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

/** The oblong's edge in direction `angle` (see Oblong), into `out` [x, z]. */
export function oblongPoint(o: Oblong, inset: number, angle: number, out: [number, number]): [number, number] {
  const dx = -Math.sin(angle);
  const dz = -Math.cos(angle);
  // Bisect along the ray for the edge: inside at 0, outside past the widest reach.
  let lo = 0;
  let hi = Math.max(o.halfWidth, o.front, o.rear) * 1.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (oblongDistance(o, inset, dx * mid, dz * mid) < 0) lo = mid;
    else hi = mid;
  }
  out[0] = dx * lo;
  out[1] = dz * lo;
  return out;
}

/**
 * How far the turret's outside reaches from the ring's middle, m: the
 * furthest any of it sweeps as it turns (the rear corners).
 */
export function turretReach(): number {
  const s = TURRET_SHELL;
  const p: [number, number] = [0, 0];
  let best = 0;
  for (let i = 0; i < 720; i++) {
    oblongPoint(s, 0, (i / 720) * Math.PI * 2, p);
    best = Math.max(best, Math.hypot(p[0], p[1]));
  }
  return best;
}
