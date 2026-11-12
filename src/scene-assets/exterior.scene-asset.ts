import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Path,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { beam, type Part } from './lowpoly.js';
import { DRIVER_HATCH_ROUND, GLACIS, HULL, SEATS, TURRET, VISION_SLIT } from '../sim/cabin.js';
import {
  BOGIES,
  DECK_TOP,
  HULL_REAR,
  IDLER,
  NOSE,
  oblongPoint,
  ROAD_WHEEL,
  ROAD_WHEEL_Y,
  SPONSON,
  SPROCKET,
  TRACK,
  trackLoop,
  TURRET_INSIDE_ROUNDING,
  TURRET_SHELL,
  turretShellInset,
  turretShellRings,
} from '../sim/exterior.js';
import { HEAD_SIZE } from '../sim/periscope.js';

/**
 * The tank's outside, as an M4A4 Sherman's (docs/exterior.md): the cast
 * turret's rounded shell round its square inside, and the parts of the
 * hull's outside that stand round the cabin's plates (cabin.scene-asset.ts
 * draws the plates, sponsons and roof): the tracks with their bogies,
 * sprockets and idlers, the transmission's rounded cover on the nose, the
 * driver's hoods, the headlights, the engine deck and the rear plate's
 * fittings. Numbers come from src/sim/exterior.ts. Everything here is merged
 * into the hull's or the turret's one mesh.
 */

/** The tank's colours, as cabin.scene-asset.ts's. */
const PAINT = 0x8f8a5c;
const PAINT_DARK = 0x6f6b47;
const IVORY = 0xe6dcc0;
const STEEL = 0x3c3d3f;
const STEEL_LIGHT = 0x5b5d60;
const RUBBER = 0x1e1e1e;
const TRACK_STEEL = 0x34322e;
const WHEEL = 0x5f5b3e;
const WOOD = 0x7a5a35;
const GLASS = 0xd8d2b0;
const RED_LENS = 0x8a2018;

type Vec3 = readonly [number, number, number];

function box(size: Vec3, position: Vec3, color: number, rotation?: Vec3): Part {
  return { geometry: new BoxGeometry(...size), color, position, rotation };
}

/** A cylinder lying along X (an axle's way). */
function wheel(radius: number, width: number, position: Vec3, color: number, segments = 16): Part {
  const g = new CylinderGeometry(radius, radius, width, segments, 1);
  g.rotateZ(Math.PI / 2);
  return { geometry: g, color, position };
}

/** A cylinder lying along Z (pointing ahead). */
function lens(radius: number, depth: number, position: Vec3, color: number, segments = 12): Part {
  const g = new CylinderGeometry(radius, radius, depth, segments, 1);
  g.rotateX(Math.PI / 2);
  return { geometry: g, color, position };
}

/**
 * Turn each triangle of `geometry` (non-indexed) to face the way `want`
 * says at its middle (a direction it should agree with), so a surface
 * built from rings shows from the side it is meant to.
 */
function facing(geometry: BufferGeometry, want: (centre: Vector3, out: Vector3) => Vector3): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position');
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const centre = new Vector3();
  const w = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    centre.copy(a).add(b).add(c).divideScalar(3);
    if (n.dot(want(centre, w)) < 0) {
      pos.setXYZ(i + 1, c.x, c.y, c.z);
      pos.setXYZ(i + 2, b.x, b.y, b.z);
    }
  }
  pos.needsUpdate = true;
  return g;
}

/** A surface joining rings of points (each ring the same count, going round), ring to ring. */
function loft(rings: readonly (readonly Vec3[])[]): BufferGeometry {
  const out: number[] = [];
  const n = rings[0].length;
  for (let r = 0; r + 1 < rings.length; r++) {
    const lo = rings[r];
    const hi = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push(...lo[i], ...lo[j], ...hi[j], ...lo[i], ...hi[j], ...hi[i]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
  return g;
}

/** A flat face from an outline (x, z points) with round holes, at height `y`, facing up or down. */
function cap(outline: readonly (readonly [number, number])[], holes: readonly { x: number; z: number; radius: number }[], y: number, up: boolean): BufferGeometry {
  // The shape's (x, y) is (x, -z), so turning it a quarter back about X lays it flat facing up.
  const shape = new Shape(outline.map(([x, z]) => new Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new Path().absarc(h.x, -h.z, h.radius, 0, Math.PI * 2, true));
  const g = new ShapeGeometry(shape, 24);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return facing(g, (_c, o) => o.set(0, up ? 1 : -1, 0));
}

/** How many points round each of the turret's rings. */
const TURRET_SEGMENTS = 72;
/** The gunner's round hatch (as cabin.scene-asset.ts's GUNNER_HATCH), turret space. */
const GUNNER_HATCH = { x: SEATS.gunner.eye[0], z: SEATS.gunner.eye[2] + 0.1, radius: 0.27 } as const;
/** The turret's inside as a rounded oblong (src/sim/interior.ts, TURRET_INSIDE). */
const INSIDE = {
  halfWidth: TURRET.halfWidth - HULL.wall,
  front: TURRET.halfWidth - HULL.wall,
  rear: TURRET.halfWidth - HULL.wall,
  frontCorner: TURRET_INSIDE_ROUNDING,
  rearCorner: TURRET_INSIDE_ROUNDING,
} as const;

/** One ring of an oblong at height `y`, shrunk by `inset`. */
function ring(shape: Parameters<typeof oblongPoint>[0], inset: number, y: number): Vec3[] {
  const p: [number, number] = [0, 0];
  const points: Vec3[] = [];
  for (let i = 0; i < TURRET_SEGMENTS; i++) {
    oblongPoint(shape, inset, (i / TURRET_SEGMENTS) * Math.PI * 2, p);
    points.push([p[0], y, p[1]]);
  }
  return points;
}

/** The inside's section at height `y`: square with rounded corners, shrinking over the roof's rounded edge. */
function insideRing(y: number): Vec3[] {
  const r = TURRET_INSIDE_ROUNDING;
  const above = Math.max(0, y - (TURRET.roof - r));
  const s = Math.sqrt(Math.max(0, r * r - above * above));
  return ring(INSIDE, r - s, y);
}

/**
 * The cast turret's walls and roof in one solid, turret space: the outside
 * rounded (TURRET_SHELL), painted; the inside the cabin's square one with
 * its corners and the roof's edges rounded, ivory; the foot closed under
 * it; the roof's top and underside with the gunner's hatch through them.
 * Its inside starts at `insideFrom`, inside the foot plate (cabin.scene-asset.ts).
 */
export function turretShellParts(insideFrom: number): Part[] {
  const s = TURRET_SHELL;
  const outerRings = turretShellRings().map((y) => ring(s, turretShellInset(y), y));
  const outward = (c: Vector3, o: Vector3) => o.set(c.x, 0, c.z);
  const outer = facing(loft(outerRings), outward);

  const r = TURRET_INSIDE_ROUNDING;
  const insideYs = [insideFrom, s.foot + 0.1, TURRET.roof - r];
  for (let i = 1; i <= 5; i++) insideYs.push(TURRET.roof - r + r * Math.sin((i / 5) * (Math.PI / 2)));
  const inner = facing(loft(insideYs.map(insideRing)), (c, o) => o.set(-c.x, 0, -c.z));

  // The foot: from the outside's bottom ring in under the inside's.
  const foot = facing(loft([outerRings[0], insideRing(s.foot)]), (_c, o) => o.set(0, -1, 0));
  const top = outerRings[outerRings.length - 1].map((p): [number, number] => [p[0], p[2]]);
  const roofTop = cap(top, [GUNNER_HATCH], s.top, true);
  const under = insideRing(TURRET.roof).map((p): [number, number] => [p[0], p[2]]);
  const roofUnder = cap(under, [GUNNER_HATCH], TURRET.roof, false);
  // The hatch's hole through the roof, seen from inside the hole.
  const hole = new CylinderGeometry(GUNNER_HATCH.radius, GUNNER_HATCH.radius, s.top - TURRET.roof, 24, 1, true);
  hole.translate(GUNNER_HATCH.x, (s.top + TURRET.roof) / 2, GUNNER_HATCH.z);
  const holeIn = facing(hole, (c, o) => o.set(GUNNER_HATCH.x - c.x, 0, GUNNER_HATCH.z - c.z));
  return [
    { geometry: outer, color: PAINT },
    { geometry: inner, color: IVORY },
    { geometry: foot, color: PAINT },
    { geometry: roofTop, color: PAINT },
    { geometry: roofUnder, color: IVORY },
    { geometry: holeIn, color: PAINT },
    ...turretFittings(),
  ];
}

/** Where the shell's outside is at height `y` in direction `angle` (as oblongPoint), turret space. */
function onShell(angle: number, y: number): Vec3 {
  const p = oblongPoint(TURRET_SHELL, turretShellInset(y), angle, [0, 0]);
  return [p[0], y, p[1]];
}

/**
 * What stands on the cast turret's outside: the pistol port's plug on its
 * left, the ventilator's dome on the roof over the loader's side, lifting
 * eyes either side and a raised ring round the gunner's hatch.
 */
function turretFittings(): Part[] {
  const parts: Part[] = [];
  const s = TURRET_SHELL;
  // The pistol port on the left side, a little behind the middle.
  const port = onShell(Math.PI / 2 + 0.25, s.foot + 0.38);
  const plug = new CylinderGeometry(0.1, 0.11, 0.06, 14, 1);
  plug.rotateZ(Math.PI / 2);
  parts.push({ geometry: plug, color: PAINT_DARK, position: [port[0] + 0.015, port[1], port[2]], rotation: [0, -0.25, 0] });
  // The ventilator's dome over the inside's grille (cabin.scene-asset.ts).
  const dome = new SphereGeometry(0.13, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.55, 1);
  parts.push({ geometry: dome, color: PAINT_DARK, position: [-0.5, s.top - 0.01, -0.5] });
  // Lifting eyes on the roof's edge, left and right.
  for (const side of [-1, 1]) {
    const at = onShell(side * (Math.PI / 2), s.top - 0.06);
    const eye = new TorusGeometry(0.04, 0.012, 4, 10);
    parts.push({ geometry: eye, color: PAINT_DARK, position: [at[0] - side * 0.04, s.top + 0.01, at[2] + 0.35] });
  }
  // The hatch's ring, a low collar round the hole (its lids are cabin.scene-asset.ts's).
  const collar = new TorusGeometry(GUNNER_HATCH.radius + 0.02, 0.016, 4, 28);
  collar.rotateX(Math.PI / 2);
  collar.scale(1, 0.8, 1);
  parts.push({ geometry: collar, color: PAINT_DARK, position: [GUNNER_HATCH.x, s.top + 0.004, GUNNER_HATCH.z] });
  return parts;
}

/**
 * The gun's shield, gun space (its origin on the trunnions): a rounded
 * rotor round the trunnions' axis standing out of the turret's front, as
 * the 75 mm gun's M34 mount, with the coaxial machine gun's muzzle beside
 * the gun's. It turns with the gun; its back, inside the turret's front
 * wall, stays hidden from 10° down to 20° up.
 */
export function mantletParts(): Part[] {
  const radius = 0.2;
  const width = 0.74;
  // The front half and 20° more each way, so its cut edges stay inside the wall as the gun elevates.
  const spare = (20 * Math.PI) / 180;
  // Turned onto X, the cylinder's angle 0 is at +Z (behind), a quarter round is on top and a half round ahead (-Z).
  const rotor = new CylinderGeometry(radius, radius, width, 20, 1, false, Math.PI / 2 - spare, Math.PI + 2 * spare);
  rotor.rotateZ(Math.PI / 2);
  const parts: Part[] = [{ geometry: rotor, color: PAINT, position: [0, 0.01, 0] }];
  // The gun's collar out of the shield's face, and the coaxial gun's muzzle to its right.
  parts.push(lens(0.1, 0.12, [0, 0, -radius - 0.03], PAINT_DARK));
  parts.push(lens(0.02, 0.16, [0.2, -0.04, -radius - 0.02], STEEL));
  parts.push(lens(0.04, 0.03, [-0.2, 0.05, -radius + 0.012], STEEL_LIGHT));
  return parts;
}

/** The hull's outside: tracks and running gear both sides, nose, hoods, lights, deck and rear fittings. */
export function hullOutsideParts(): Part[] {
  const parts: Part[] = [];
  for (const side of [-1, 1] as const) parts.push(...trackParts(side), ...runningGearParts(side));
  parts.push(...noseParts(), ...hoodParts(), ...headlightParts(), ...deckParts(), ...rearParts());
  return parts;
}

/** The track round its loop: its links, and a cleat across each shoe on the outside. */
function trackParts(side: -1 | 1): Part[] {
  const parts: Part[] = [];
  const loop = trackLoop();
  const x = side * TRACK.x;
  const t = TRACK.thickness;
  const n = loop.length;
  let along = 0;
  const cleat = { width: TRACK.width - 0.03, height: 0.022, length: 0.05, sink: 0.012 };
  let next = 0;
  for (let i = 0; i < n; i++) {
    const [z0, y0] = loop[i];
    const [z1, y1] = loop[(i + 1) % n];
    const dz = z1 - z0;
    const dy = y1 - y0;
    const length = Math.hypot(dz, dy);
    const angle = Math.atan2(-dy, dz);
    parts.push(box([TRACK.width, t, length + 0.012], [x, (y0 + y1) / 2, (z0 + z1) / 2], TRACK_STEEL, [angle, 0, 0]));
    // The outside is to the right of the way round (the loop goes counter-clockwise in z, y).
    const oz = dy / length;
    const oy = -dz / length;
    while (next <= along + length) {
      const k = (next - along) / length;
      const out = t / 2 + cleat.height / 2 - cleat.sink;
      // Not on the run lying on the ground, where they would be in it; the track's own colour, so where one meets a
      // link's end at a bend nothing flickers (flat shading shows them).
      if (oy > -0.9) parts.push(box([cleat.width, cleat.height, cleat.length], [x, y0 + dy * k + oy * out, z0 + dz * k + oz * out], TRACK_STEEL, [angle, 0, 0]));
      next += TRACK.pitch;
    }
    along += length;
  }
  return parts;
}

/** A pair of road wheels (or the idler's or the sprocket's discs) either side of the track's guides, on an axle at (z, y). */
function wheelPair(x: number, z: number, y: number, radius: number, tyre: boolean): Part[] {
  const parts: Part[] = [];
  const off = ROAD_WHEEL.gap / 2 + ROAD_WHEEL.width / 2;
  for (const s of [-1, 1]) {
    const wx = x + s * off;
    if (tyre) {
      parts.push(wheel(radius, ROAD_WHEEL.width, [wx, y, z], RUBBER, 16));
      parts.push(wheel(radius - 0.05, ROAD_WHEEL.width + 0.02, [wx, y, z], WHEEL, 16));
    } else {
      parts.push(wheel(radius, ROAD_WHEEL.width, [wx, y, z], WHEEL, 16));
    }
    parts.push(wheel(0.07, ROAD_WHEEL.width + 0.04, [wx, y, z], STEEL_LIGHT, 8));
  }
  return parts;
}

/**
 * One side's running gear: three bogies (each a housing on the hull's side
 * over a pair of road wheels, a return roller on its back), the drive
 * sprocket with its teeth at the front on the final drive's hub, and the
 * idler on its bracket at the back.
 */
function runningGearParts(side: -1 | 1): Part[] {
  const parts: Part[] = [];
  const x = side * TRACK.x;
  const hullSide = side * (HULL.halfWidth + HULL.wall);
  const wheelTop = ROAD_WHEEL_Y + ROAD_WHEEL.radius;
  for (const z of BOGIES.z) {
    // The housing over the wheels, bolted to the hull's side, and the arms down to the axles behind the wheels.
    const housing = { bottom: wheelTop + 0.012, top: 0.27, out: x + 0.11 };
    parts.push(box([housing.out * side - hullSide * side + 0.02, housing.top - housing.bottom, 0.4], [(housing.out + hullSide) / 2, (housing.top + housing.bottom) / 2, z], PAINT_DARK));
    parts.push(box([0.06, 0.08, 0.16], [housing.out - side * 0.04, housing.top + 0.03, z - 0.06], PAINT_DARK));
    for (const s of [-1, 1]) {
      const az = z + s * BOGIES.spread;
      parts.push(beam([hullSide + side * 0.04, housing.bottom, z + s * 0.08], [hullSide + side * 0.04, ROAD_WHEEL_Y, az], 0.035, STEEL, 6));
      parts.push(wheel(0.03, Math.abs(x - hullSide) + 0.04, [(x + hullSide) / 2 + side * 0.02, ROAD_WHEEL_Y, az], STEEL, 8));
      parts.push(...wheelPair(x, az, ROAD_WHEEL_Y, ROAD_WHEEL.radius, true));
    }
    // The return roller on its post at the housing's back.
    const rz = z + BOGIES.roller.dz;
    const ry = BOGIES.roller.y;
    parts.push(box([0.07, ry - housing.top + 0.04, 0.09], [hullSide + side * 0.06, (ry + housing.top) / 2, rz], PAINT_DARK));
    parts.push(wheel(BOGIES.roller.radius, TRACK.width - 0.08, [x, ry, rz], STEEL_LIGHT, 12));
    parts.push(wheel(0.025, Math.abs(x - hullSide) + 0.04, [(x + hullSide) / 2, ry, rz], STEEL, 8));
  }
  // The sprocket: the final drive's hub out of the hull's side, two toothed rings on it.
  const sp = SPROCKET;
  parts.push(wheel(0.13, Math.abs(x - hullSide) + 0.12, [(x + hullSide) / 2 + side * 0.07, sp.y, sp.z], PAINT_DARK, 14));
  const off = ROAD_WHEEL.gap / 2 + ROAD_WHEEL.width / 2;
  for (const s of [-1, 1]) {
    const wx = x + s * off;
    parts.push(wheel(sp.radius - 0.035, 0.05, [wx, sp.y, sp.z], WHEEL, 20));
    for (let i = 0; i < sp.teeth; i++) {
      const a = (i / sp.teeth) * Math.PI * 2;
      const r = sp.radius - 0.005;
      parts.push(box([0.05, 0.075, 0.06], [wx, sp.y + Math.sin(a) * r, sp.z + Math.cos(a) * r], WHEEL, [-a, 0, 0]));
    }
  }
  // The idler, on an arm from a bracket on the hull's back corner.
  const id = IDLER;
  parts.push(...wheelPair(x, id.z, id.y, id.radius, false));
  parts.push(wheel(0.03, Math.abs(x - hullSide) + 0.07, [(x + hullSide) / 2 + side * 0.005, id.y, id.z], STEEL, 8));
  parts.push(beam([hullSide + side * 0.05, id.y + 0.02, id.z], [hullSide + side * 0.05, 0.25, HULL_REAR.bellyEnd - 0.1], 0.05, PAINT_DARK, 6));
  return parts;
}

/**
 * The nose between the tracks: the transmission's rounded cover in three
 * bolted pieces (the early M4A4's), with towing clevises at its foot.
 */
function noseParts(): Part[] {
  const parts: Part[] = [];
  const front = HULL.front - HULL.wall;
  const { bulge, top, bottom } = NOSE;
  // The cover's profile: an arc from the nose plate's foot out by `bulge` and back up to under the glacis.
  const chord = top - bottom;
  const radius = (chord * chord) / 4 / (2 * bulge) + bulge / 2;
  const middle = (top + bottom) / 2;
  const centreZ = front - bulge + radius;
  const half = Math.asin(chord / 2 / radius);
  const outline: [number, number][] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const a = -half + (2 * half * i) / steps;
    outline.push([centreZ - radius * Math.cos(a), middle + radius * Math.sin(a)]);
  }
  const width = 2 * (HULL.halfWidth + HULL.wall) - 0.08;
  parts.push(sideways([...outline, [front + 0.02, top], [front + 0.02, bottom]], -width / 2, width, PAINT));
  // The flanges where its three pieces bolt together, standing proud of it, with bolt heads.
  const flange: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -half + (2 * half * i) / steps;
    flange.push([centreZ - (radius + 0.025) * Math.cos(a), middle + (radius + 0.025) * Math.sin(a)]);
  }
  for (const fx of [-0.38, 0.38]) {
    parts.push(sideways([...flange, [front + 0.035, top], [front + 0.035, bottom]], fx - 0.03, 0.06, PAINT_DARK));
  }
  // Towing clevises at the foot.
  for (const cx of [-0.62, 0.62]) {
    const z = centreZ - radius * Math.cos(half * 0.6) - 0.03;
    const y = middle - radius * Math.sin(half * 0.6) + 0.02;
    parts.push(box([0.14, 0.1, 0.12], [cx, y, z + 0.03], PAINT_DARK));
    const shackle = new TorusGeometry(0.055, 0.016, 5, 12, Math.PI);
    shackle.rotateY(Math.PI / 2);
    shackle.rotateX(Math.PI);
    parts.push({ geometry: shackle, color: STEEL, position: [cx, y - 0.02, z - 0.05] });
  }
  return parts;
}

/** A solid from a (z, y) outline, `width` across in x from `x0` (as cabin.scene-asset.ts's). */
function sideways(outline: [number, number][], x0: number, width: number, color: number): Part {
  // The shape's x is -z, so turning it a quarter about +Y lays the extrusion along +X.
  const shape = new Shape(outline.map(([z, y]) => new Vector2(-z, y)));
  const g = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return { geometry: g, color };
}

/**
 * The driver's and the assistant driver's hoods on the hood's upright face:
 * a raised rim round each, the driver's vision slit's armoured visor
 * swung up and open over the slit, the assistant's shut. The rims stand
 * clear of what the driver sees through the slit leaning in to its pad.
 */
function hoodParts(): Part[] {
  const parts: Part[] = [];
  const face = GLACIS.face - HULL.wall;
  const proud = 0.025;
  const z = face - proud / 2 + 0.004;
  const slit = VISION_SLIT;
  for (const hx of [slit.x, -slit.x]) {
    const half = 0.32;
    const bottom = GLACIS.hoodBottom + 0.05;
    const top = DECK_TOP - 0.025;
    // Cheeks either side and a brow over the top.
    for (const s of [-1, 1]) parts.push(box([0.04, top - bottom, proud], [hx + s * (half - 0.02), (top + bottom) / 2, z], PAINT_DARK));
    parts.push(box([2 * half, 0.04, proud], [hx, top - 0.02, z], PAINT_DARK));
    const visorTop = slit.y + slit.height / 2 + 0.012;
    if (hx === slit.x) {
      // Open: hinged over the slit, swung up and out.
      const open = 1.05;
      const h = 0.15;
      parts.push(box([slit.width + 0.08, h, 0.03], [hx, visorTop + (h / 2) * Math.cos(open), face - 0.015 - (h / 2) * Math.sin(open)], PAINT, [open, 0, 0]));
    } else {
      // Shut over its slit.
      parts.push(box([slit.width + 0.08, slit.height + 0.08, 0.03], [hx, slit.y, face - 0.015], PAINT));
    }
    // The hinge's knuckles along the visor's top.
    parts.push(wheel(0.018, slit.width + 0.1, [hx, visorTop + 0.005, face - 0.012], PAINT_DARK, 8));
  }
  // The assistant driver's round hatch, shut, and his periscope's head ahead of it (beside the driver's).
  const h = DRIVER_HATCH_ROUND;
  const lid = new CylinderGeometry(h.radius + 0.01, h.radius + 0.01, 0.035, 28, 1);
  parts.push({ geometry: lid, color: PAINT_DARK, position: [-h.x, DECK_TOP + 0.0075, h.z] });
  parts.push(box([0.06, 0.03, 0.04], [-h.x + h.radius - 0.02, DECK_TOP + 0.03, h.z], STEEL_LIGHT));
  parts.push(box([HEAD_SIZE.width, HEAD_SIZE.height + 0.01, HEAD_SIZE.depth], [-h.x, DECK_TOP + HEAD_SIZE.height / 2 - 0.005, -1.86], PAINT_DARK));
  return parts;
}

/** The glacis's outside at height `y` (between the nose's top and the hood's bottom), hull z. */
function glacisOutside(y: number): number {
  const { noseTop, hoodBottom, face } = GLACIS;
  const t = HULL.wall;
  const len = Math.hypot(face - HULL.front, hoodBottom - noseTop);
  // The inside's line moved out along its normal (forwards and up) by the wall's thickness.
  const nz = -(hoodBottom - noseTop) / len;
  const ny = (face - HULL.front) / len;
  const k = (y - (noseTop + t * ny)) / (hoodBottom - noseTop);
  return HULL.front + t * nz + k * (face - HULL.front);
}

/** Headlights in their brush guards on the glacis's top corners, over the sponsons. */
function headlightParts(): Part[] {
  const parts: Part[] = [];
  const y = GLACIS.hoodBottom - 0.06;
  const z = glacisOutside(y);
  for (const side of [-1, 1]) {
    const x = side * (SPONSON.halfWidth - 0.2);
    parts.push(lens(0.075, 0.12, [x, y + 0.07, z - 0.08], PAINT_DARK));
    parts.push(lens(0.06, 0.02, [x, y + 0.07, z - 0.14], GLASS));
    parts.push(box([0.05, 0.08, 0.06], [x, y + 0.01, z - 0.04], PAINT_DARK));
    // The guard: a hoop over the light from the glacis.
    for (const s of [-1, 1]) parts.push(beam([x + s * 0.11, y - 0.02, z - 0.02], [x + s * 0.11, y + 0.1, z - 0.2], 0.012, PAINT_DARK, 5));
    parts.push(beam([x - 0.11, y + 0.1, z - 0.2], [x + 0.11, y + 0.1, z - 0.2], 0.012, PAINT_DARK, 5));
  }
  return parts;
}

/**
 * The engine deck behind the turret: the engine's access doors with their
 * hinges and handles, the radiator's grille at the back, the fuel fillers
 * on the sponsons and the crew's tools strapped along them, all clear of
 * the turret's sweep.
 */
function deckParts(): Part[] {
  const parts: Part[] = [];
  const y = DECK_TOP;
  // Two doors side by side over the engine.
  for (const side of [-1, 1]) {
    const x = side * 0.46;
    parts.push(box([0.84, 0.016, 0.95], [x, y + 0.004, 2.65], PAINT_DARK));
    parts.push(box([0.2, 0.025, 0.05], [x, y + 0.016, 2.12], STEEL));
    parts.push(beam([x - 0.08, y + 0.03, 3.0], [x + 0.08, y + 0.03, 3.0], 0.01, STEEL, 5));
  }
  // The grille: bars across the deck's back.
  for (let i = 0; i < 6; i++) parts.push(box([1.8, 0.02, 0.025], [0, y + 0.008, 3.2 + i * 0.05], PAINT_DARK));
  // Fuel fillers on each sponson.
  for (const side of [-1, 1]) {
    for (const z of [2.2, 3.05]) parts.push({ geometry: new CylinderGeometry(0.06, 0.065, 0.035, 12, 1), color: STEEL_LIGHT, position: [side * 1.38, y + 0.01, z] });
  }
  // Tools on the sponsons' tops: a shovel and an axe on the left, a crowbar and a sledge on the right.
  const tx = SPONSON.halfWidth - 0.12;
  parts.push(beam([-tx, y + 0.025, 1.45], [-tx, y + 0.025, 2.4], 0.018, WOOD, 6));
  parts.push(box([0.2, 0.012, 0.26], [-tx, y + 0.012, 2.55], STEEL));
  parts.push(beam([-tx + 0.12, y + 0.022, 1.95], [-tx + 0.12, y + 0.022, 2.65], 0.016, WOOD, 6));
  parts.push(box([0.04, 0.035, 0.16], [-tx + 0.12, y + 0.022, 2.73], STEEL));
  parts.push(beam([tx, y + 0.02, 1.4], [tx, y + 0.02, 2.75], 0.014, STEEL, 6));
  parts.push(beam([tx - 0.12, y + 0.022, 1.9], [tx - 0.12, y + 0.022, 2.65], 0.016, WOOD, 6));
  parts.push(box([0.07, 0.07, 0.15], [tx - 0.12, y + 0.035, 2.72], STEEL));
  // Straps over them.
  for (const z of [1.6, 2.3]) for (const s of [-1, 1]) parts.push(box([0.26, 0.012, 0.035], [s * (tx - 0.06), y + 0.046, z], PAINT_DARK));
  return parts;
}

/** The rear plate's fittings: the two big air cleaners, the exhaust's deflector, tail lights and the towing pintle. */
function rearParts(): Part[] {
  const parts: Part[] = [];
  const z = HULL_REAR.plate;
  for (const side of [-1, 1]) {
    parts.push({ geometry: new CylinderGeometry(0.11, 0.11, 0.42, 14, 1), color: PAINT_DARK, position: [side * 0.82, 1.1, z + 0.12] });
    parts.push({ geometry: new CylinderGeometry(0.085, 0.11, 0.05, 14, 1), color: PAINT_DARK, position: [side * 0.82, 1.335, z + 0.12] });
    parts.push(box([0.06, 0.05, 0.03], [side * 0.82, 0.97, z + 0.014], STEEL));
    // Tail lights near the corners.
    parts.push(box([0.1, 0.08, 0.05], [side * 1.4, 1.35, z + 0.02], PAINT_DARK));
    parts.push(box([0.06, 0.04, 0.012], [side * 1.4, 1.35, z + 0.051], RED_LENS));
  }
  // The exhaust deflector across the bottom of the rear plate, leaning out.
  parts.push(box([1.9, 0.3, 0.025], [0, HULL_REAR.lowY + 0.22, z + 0.08], PAINT_DARK, [-0.45, 0, 0]));
  for (const side of [-1, 0, 1]) parts.push(box([0.03, 0.26, 0.1], [side * 0.9, HULL_REAR.lowY + 0.2, z + 0.05], PAINT_DARK));
  // The towing pintle.
  parts.push(box([0.16, 0.14, 0.12], [0, HULL_REAR.lowY - 0.02, z + 0.04], PAINT_DARK));
  parts.push(beam([0, HULL_REAR.lowY + 0.03, z + 0.09], [0, HULL_REAR.lowY - 0.08, z + 0.12], 0.025, STEEL, 6));
  return parts;
}
