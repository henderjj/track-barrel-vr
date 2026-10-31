import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  SphereGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  TorusGeometry,
  Vector2,
  type Vector3,
} from '@iwsdk/core';
import { driverStationParts } from './driver-station.scene-asset.js';
import { beam, mergeParts, type Part } from './lowpoly.js';
import { GEARBOX } from '../sim/driver-station.js';
import {
  DRIVER_HATCH,
  GLACIS,
  GROUND_Y,
  GUN,
  HULL,
  SEATS,
  TURRET,
  TURRET_RING,
  VISION_SLIT,
} from '../sim/cabin.js';
import { ELEVATING_GEAR, MANTLET_DEPTH, mountToTurret, POWER_GRIP, STATION, type StationMount, TRUNNION } from '../sim/turret.js';
import { DOME_LAMPS } from '../sim/interior.js';
import { binParts, boardParts, BREECH_HOLE, breechFittings, rackParts } from './loading.scene-asset.js';
import { driverClockParts, gunnerClockParts } from './range-run.scene-asset.js';
import { litInside } from './cabin-light.js';

/**
 * The tank, seen from inside: the hull with the driver's seat, and the
 * turret with its basket, the gunner's seat, the breech and the gun. The
 * ground it drives on is src/scene-assets/terrain.scene-asset.ts. Sizes come from
 * src/sim/cabin.ts, so the systems and tests use the same numbers.
 *
 * Hull space: hull floor at y = 0, the front towards -Z. The turret is its
 * own mesh in turret space (origin at the ring's centre), so it can turn,
 * and the gun its own again inside it, so it can elevate (F1.8); the seats' moving controls come as their own meshes too (the driver's from DriverStationSystem, F1.5).
 * Each is merged into one draw call, vertex-coloured and flat-shaded.
 *
 * Plates are painted on the outside and ivory inside, as the real tanks'
 * crew compartments were, so the inside reads light even with the hatches
 * shut.
 */

const PAINT = 0x8f8a5c;
const PAINT_DARK = 0x6f6b47;
const IVORY = 0xe6dcc0;
/** A rib or casting on an ivory plate, a shade darker so it reads. */
const IVORY_SHADE = 0xcfc5a8;
const FLOOR = 0x55534c;
const BASKET = 0x6a6860;
const STEEL = 0x3c3d3f;
const STEEL_LIGHT = 0x5b5d60;
const LEATHER = 0x5a3d26;
const RUBBER = 0x1e1e1e;
const TRACK = 0x34322e;
const WHEEL = 0x5f5b3e;

type Vec3 = readonly [number, number, number];

function box(size: Vec3, position: Vec3, color: number): Part {
  return { geometry: new BoxGeometry(...size), color, position };
}

/**
 * A plate painted on the outside and ivory on the face that looks into the
 * cabin: each of the box's faces is ivory when it faces `inside` (a point
 * in the cabin), painted otherwise.
 */
function plate(size: Vec3, position: Vec3, inside: Vec3): Part {
  const half = [size[0] / 2, size[1] / 2, size[2] / 2];
  return {
    geometry: new BoxGeometry(...size),
    position,
    color: (_tri: number, c: Vector3) => {
      // The face's axis is the one along which the triangle sits at the box's surface.
      const d = [c.x - position[0], c.y - position[1], c.z - position[2]];
      let axis = 0;
      let best = 0;
      for (let i = 0; i < 3; i++) {
        const k = Math.abs(d[i]) / half[i];
        if (k > best) {
          best = k;
          axis = i;
        }
      }
      return d[axis] * (inside[axis] - position[axis]) > 0 && Math.abs(inside[axis] - position[axis]) > half[axis] ? IVORY : PAINT;
    },
  };
}

/**
 * A flat plate with holes, from an outline in the XZ plane (x, z points),
 * `thickness` thick with its top at `top`: ivory underneath, painted on
 * top and round its edges.
 */
function roof(outline: Shape, top: number, thickness: number): Part {
  // The shape's y becomes z; extruding along +z then turning about X puts the plate below y = 0.
  const geometry = new ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false, curveSegments: 20 });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, top, 0);
  return {
    geometry,
    color: (_tri: number, c: Vector3) => (c.y < top - thickness + 0.005 ? IVORY : PAINT),
  };
}

function rectangle(path: Path, x0: number, z0: number, x1: number, z1: number): Path {
  path.moveTo(x0, z0);
  path.lineTo(x1, z0);
  path.lineTo(x1, z1);
  path.lineTo(x0, z1);
  path.lineTo(x0, z0);
  return path;
}

/** The gunner's round hatch in the turret roof, turret space, over their seat: its middle's x and z and its radius, m (src/sim/interior.ts's GUNNER_HATCH_MIDDLE). */
const GUNNER_HATCH = { x: SEATS.gunner.eye[0], z: SEATS.gunner.eye[2] + 0.1, radius: 0.27 } as const;
/** The cast turret's rounding inside: how far the chamfers along the roof's edges and down its corners reach across each face, m. */
const TURRET_FILLET = 0.12;
/** How high a hatch lid stands when open, m. */
const LID = 0.5;
/**
 * The plate at the turret's foot, turret space: it stands `lift` above the hull roof it turns on and is `thickness`
 * thick, its hole round the ring clear of the ring's torus, m.
 */
const TURRET_FOOT = { lift: 0.01, thickness: 0.03, hole: TURRET_RING.radius + TURRET_RING.tube + 0.01 } as const;

/** A seat: cushion, backrest and a post down to its floor, in its frame. */
function seatParts(cushion: Vec3, floorY: number): Part[] {
  const [x, top, z] = cushion;
  return [
    box([0.44, 0.08, 0.42], [x, top - 0.04, z], LEATHER),
    box([0.44, 0.5, 0.07], [x, top + 0.25 - 0.02, z + 0.245], LEATHER),
    box([0.06, top - 0.08 - floorY + 0.01, 0.06], [x, (top - 0.08 + floorY) / 2, z + 0.05], STEEL),
  ];
}

/**
 * The hull's outline seen from the side, (z, y) points, the inside's or
 * the armour's outside `out` m beyond it: up the nose, along the glacis and
 * up the hood's face (src/sim/cabin.ts, GLACIS). The outside's bends are
 * where the offset faces meet.
 */
function frontProfile(out: number, bottom: number, top: number): [number, number][] {
  const { noseTop, hoodBottom, face } = GLACIS;
  const front = HULL.front;
  if (out === 0) return [[front, bottom], [front, noseTop], [face, hoodBottom], [face, top]];
  // The glacis's outward normal (z, y): forwards and up.
  const len = Math.hypot(face - front, hoodBottom - noseTop);
  const nz = -(hoodBottom - noseTop) / len;
  const ny = (face - front) / len;
  // Where the glacis moved out by `out` meets an upright moved out by `out` at z0 - out.
  const meet = (z0: number, y0: number): [number, number] => {
    const z = z0 - out;
    // Along the glacis from (z0 + out nz, y0 + out ny) to z.
    const k = (z - (z0 + out * nz)) / (face - front);
    return [z, y0 + out * ny + k * (hoodBottom - noseTop)];
  };
  return [[front - out, bottom], meet(front, noseTop), meet(face, hoodBottom), [face - out, top]];
}

/** A solid from a (z, y) outline, `width` across in x from `x0`, coloured per triangle. */
function sideways(outline: [number, number][], x0: number, width: number, color: Part['color']): Part {
  // The shape's x is -z, so turning it a quarter about +Y lays the extrusion along +X.
  const shape = new Shape(outline.map(([z, y]) => new Vector2(-z, y)));
  const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(x0, 0, 0);
  return { geometry, color };
}

/** The nose plate and the glacis: ivory on their inside faces, painted elsewhere. */
function frontArmour(bottom: number): Part {
  const t = HULL.wall;
  const w = HULL.halfWidth;
  const inner = frontProfile(0, bottom, GLACIS.hoodBottom);
  const outer = frontProfile(t, bottom, GLACIS.hoodBottom);
  // Inside up to the glacis's top, out along the hood face's bottom to the outside, and back down it.
  const outline: [number, number][] = [inner[0], inner[1], inner[2], [GLACIS.face - t, GLACIS.hoodBottom], outer[2], outer[1], outer[0]];
  const { noseTop, hoodBottom, face } = GLACIS;
  const len = Math.hypot(face - HULL.front, hoodBottom - noseTop);
  return sideways(outline, -w, 2 * w, (_tri, c) => {
    if (Math.abs(c.x) > w - 0.001) return PAINT;
    if (c.y <= noseTop && Math.abs(c.z - HULL.front) < 0.001) return IVORY;
    // On the glacis's inner face: no distance from the line through the nose's top and the hood's bottom.
    const off = ((c.z - HULL.front) * (hoodBottom - noseTop) - (c.y - noseTop) * (face - HULL.front)) / len;
    return Math.abs(off) < 0.001 && c.y > noseTop ? IVORY : PAINT;
  });
}

/** A side wall, cut to the front's slope: ivory on the face towards the cabin. */
function sideWall(side: -1 | 1, bottom: number, top: number): Part {
  const t = HULL.wall;
  const w = HULL.halfWidth;
  const front = frontProfile(t, bottom, top);
  const outline: [number, number][] = [...front, [HULL.rear + t, top], [HULL.rear + t, bottom]];
  return sideways(outline, side < 0 ? -w - t : w, t, (_tri, c) => (Math.abs(Math.abs(c.x) - w) < 0.001 ? IVORY : PAINT));
}

/** Everything fixed to the hull, as seen from inside: plates, floor, the driver's seat, dash and slit, tracks. */
function hullParts(): Part[] {
  const w = HULL.halfWidth;
  const t = HULL.wall;
  const outer = w + t;
  const bottom = -0.1;
  const top = HULL.roof + t;
  const front = HULL.front - t;
  const rear = HULL.rear + t;
  const inside: Vec3 = [0, 0.9, -0.2];
  const height = top - bottom;
  const midY = (top + bottom) / 2;
  const length = rear - front;
  const midZ = (rear + front) / 2;
  const parts: Part[] = [
    // Floor plate.
    box([2 * w, 0.1, HULL.rear - HULL.front], [0, -0.05, (HULL.rear + HULL.front) / 2], FLOOR),
    // Side walls, running the hull's full length and cut to the front's slope; the front and the bulkhead fit between them.
    sideWall(-1, bottom, top),
    sideWall(1, bottom, top),
    // The bulkhead in front of the engine.
    plate([2 * w, height, t], [0, midY, HULL.rear + t / 2], inside),
    // The nose and the glacis, up to the hood's face.
    frontArmour(bottom),
  ];
  // The hood's face, round the vision slit.
  const s = VISION_SLIT;
  const slitBottom = s.y - s.height / 2;
  const slitTop = s.y + s.height / 2;
  const fz = s.z - t / 2;
  parts.push(
    plate([2 * w, slitBottom - GLACIS.hoodBottom, t], [0, (slitBottom + GLACIS.hoodBottom) / 2, fz], inside),
    plate([2 * w, top - slitTop, t], [0, (top + slitTop) / 2, fz], inside),
    plate([s.x - s.width / 2 + w, s.height, t], [(s.x - s.width / 2 - w) / 2, s.y, fz], inside),
    plate([w - (s.x + s.width / 2), s.height, t], [(s.x + s.width / 2 + w) / 2, s.y, fz], inside),
  );
  // The roof, with the turret ring and the driver's hatch cut out.
  const outline = rectangle(new Shape(), -outer, GLACIS.face - t, outer, rear) as Shape;
  outline.holes.push(new Path().absarc(0, TURRET.z, TURRET.ringRadius, 0, Math.PI * 2, true));
  const [hx0, hz0, hx1, hz1] = DRIVER_HATCH;
  outline.holes.push(rectangle(new Path(), hx0, hz1, hx1, hz0));
  parts.push(roof(outline, top, t));

  // The driver's place: seat, the gearbox's hump beside their legs, and the station's fixed parts (F1.5).
  const driver = SEATS.driver;
  parts.push(...seatParts(driver.cushion, driver.floorY));
  const g = GEARBOX;
  parts.push(box([g.x1 - g.x0, g.top, g.z1 - g.z0], [(g.x0 + g.x1) / 2, g.top / 2, (g.z0 + g.z1) / 2], PAINT_DARK));
  parts.push(...driverStationParts());
  // The range run's clock on the hood's face, left of the slit (F1.11).
  parts.push(...driverClockParts());
  // The rest of a Sherman's front compartment (docs/interior.md).
  parts.push(...hullDetailParts());

  // The engine compartment behind the bulkhead.
  parts.push(box([2 * outer, 1.7, 0.6], [0, bottom + 0.85, rear + 0.3], PAINT));
  // Tracks with their road wheels standing proud on the outside, and the fenders over them.
  for (const side of [-1, 1]) {
    const trackX = side * (outer + 0.32);
    parts.push(box([0.6, 0.5 - GROUND_Y, 5.6], [trackX, (0.5 + GROUND_Y) / 2, -0.2], TRACK));
    parts.push(box([0.68, 0.04, 5.7], [side * (outer + 0.34), 0.54, -0.2], PAINT_DARK));
    for (let i = 0; i < 6; i++) {
      const wheel = new CylinderGeometry(0.3, 0.3, 0.06, 10, 1);
      wheel.rotateZ(Math.PI / 2);
      parts.push({ geometry: wheel, color: WHEEL, position: [side * (outer + 0.63), -0.12, -2.45 + i * 0.9] });
    }
  }
  return parts;
}

const RED = 0xa8281c;
const BRASS = 0xb08a3c;
const OLIVE = 0x5d5f45;
const RADIO = 0x55594a;

/** A dome lamp's housing (steel, on the roof's underside at `roofY`) over the light's point, in its frame. */
function lampHousing(at: Vec3, roofY: number): Part[] {
  return [{ geometry: new CylinderGeometry(0.055, 0.06, roofY - at[1] + 0.005, 10, 1), color: STEEL_LIGHT, position: [at[0], (roofY + at[1]) / 2, at[2]] }];
}

/**
 * The hull's front compartment past the driver's station, as on an M4A4
 * (TM 9-754, figure 9): the final drive's housing in the nose between the
 * seats with ribs across it, the assistant driver's seat and the bow
 * machine gun in the glacis in front of it, two fire extinguishers on the
 * right, the 75 mm rounds in the left sponson's rack behind the driver,
 * cable conduits along both walls, and the dome lamp's housing.
 */
function hullDetailParts(): Part[] {
  const parts: Part[] = [];
  const w = HULL.halfWidth;
  // The final drive's housing: in front of the gear lever's furthest reach, ribbed on top.
  const g = GEARBOX;
  const housing = { z0: HULL.front - 0.01, z1: -2.24, top: 0.7 };
  parts.push(box([g.x1 - g.x0 + 0.04, housing.top, housing.z1 - housing.z0], [(g.x0 + g.x1) / 2, housing.top / 2, (housing.z0 + housing.z1) / 2], PAINT_DARK));
  for (let i = 0; i < 4; i++) {
    const z = housing.z0 + 0.03 + i * 0.04;
    parts.push(box([g.x1 - g.x0 + 0.01, 0.02, 0.015], [(g.x0 + g.x1) / 2, housing.top + 0.005, z], STEEL));
  }
  // The assistant driver's seat, the driver's mirrored.
  const [cx, cy, cz] = SEATS.driver.cushion;
  parts.push(...seatParts([-cx, cy, cz], SEATS.driver.floorY));
  // The bow machine gun's ball in the glacis ahead of that seat, the gun's body and grips inside, its barrel out.
  const ballY = 1.16;
  const ballZ = frontAtGlacis(ballY) - HULL.wall / 2;
  parts.push({ geometry: new SphereGeometry(0.085, 10, 6), color: PAINT_DARK, position: [-cx, ballY, ballZ] });
  parts.push(box([0.07, 0.09, 0.4], [-cx, ballY - 0.01, ballZ + 0.24], STEEL));
  parts.push(box([0.11, 0.03, 0.03], [-cx, ballY - 0.06, ballZ + 0.38], RUBBER));
  const barrel = new CylinderGeometry(0.018, 0.018, 0.3, 8, 1);
  barrel.rotateX(Math.PI / 2);
  parts.push({ geometry: barrel, color: STEEL, position: [-cx, ballY, ballZ - 0.2] });
  // Two fire extinguishers standing on the floor by the right wall, behind the assistant driver.
  for (const z of [-0.98, -0.82]) {
    parts.push({ geometry: new CylinderGeometry(0.065, 0.065, 0.5, 10, 1), color: RED, position: [w - 0.09, 0.25, z] });
    parts.push({ geometry: new CylinderGeometry(0.02, 0.03, 0.08, 8, 1), color: STEEL_LIGHT, position: [w - 0.09, 0.53, z] });
  }
  parts.push(box([0.03, 0.04, 0.3], [w - 0.02, 0.4, -0.9], STEEL));
  // The left sponson's ready rounds behind the driver: a rack on the wall, six rounds lying fore and aft, their brass bases towards the back.
  const rack = { x: -w + 0.1, y: 0.95, z0: -1.12, z1: -0.62 };
  parts.push(box([0.2, 0.42, 0.03], [rack.x, rack.y, rack.z0 - 0.015], OLIVE));
  parts.push(box([0.2, 0.42, 0.03], [rack.x, rack.y, rack.z1 + 0.035], OLIVE));
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const round = new CylinderGeometry(0.04, 0.04, rack.z1 - rack.z0 + 0.04, 8, 1);
      round.rotateX(Math.PI / 2);
      parts.push({ geometry: round, color: BRASS, position: [rack.x - 0.05 + col * 0.1, rack.y - 0.12 + row * 0.12, (rack.z0 + rack.z1) / 2 + 0.02] });
    }
  }
  // Cable conduits along both walls, standing 3 cm off them on their brackets.
  for (const side of [-1, 1]) {
    parts.push(beam([side * (w - 0.03), 1.62, GLACIS.face + 0.02], [side * (w - 0.03), 1.62, HULL.rear - 0.02], 0.012, STEEL, 6));
    for (let z = -1.6; z < HULL.rear; z += 0.7) parts.push(box([0.05, 0.02, 0.02], [side * (w - 0.02), 1.62, z], STEEL));
  }
  // The dome lamp's housing.
  for (const lamp of DOME_LAMPS) if (lamp.frame === 'hull') parts.push(...lampHousing(lamp.at, HULL.roof));
  return parts;
}

/** The glacis's inner face at height `y` (between the nose's top and the hood's bottom), hull z. */
function frontAtGlacis(y: number): number {
  const { noseTop, hoodBottom, face } = GLACIS;
  return HULL.front + ((y - noseTop) / (hoodBottom - noseTop)) * (face - HULL.front);
}

/** The turret's bustle: the radio set on a shelf against the rear wall, its dials towards the crew, and the dome lamp's housing; turret space. */
function turretDetailParts(): Part[] {
  const parts: Part[] = [];
  const back = TURRET.rear - HULL.wall + 0.01;
  const radio = { width: 0.56, height: 0.32, depth: 0.26, y: 2.18 };
  const front = back - radio.depth;
  parts.push(box([radio.width, radio.height, radio.depth], [0, radio.y, back - radio.depth / 2], RADIO));
  parts.push(box([radio.width + 0.1, 0.03, radio.depth + 0.04], [0, radio.y - radio.height / 2 - 0.015, back - radio.depth / 2 - 0.01], STEEL));
  // Its dials and knobs, standing proud of the front.
  for (let i = 0; i < 3; i++) {
    const knob = new CylinderGeometry(0.025, 0.025, 0.03, 10, 1);
    knob.rotateX(Math.PI / 2);
    parts.push({ geometry: knob, color: RUBBER, position: [-0.17 + i * 0.17, radio.y - 0.06, front - 0.015] });
  }
  parts.push(box([0.4, 0.09, 0.01], [0, radio.y + 0.07, front - 0.004], IVORY));
  for (const lamp of DOME_LAMPS) if (lamp.frame === 'turret') parts.push(...lampHousing(lamp.at, TURRET.roof));
  return parts;
}

/**
 * What makes the turret's inside read as a cast Sherman turret's rather than
 * a box, turret space: chamfers along the roof's four edges and down the
 * four corners, a collar round the hatch, the ventilator's housing in the
 * roof over the loader's side and a rib across the roof behind the hatch.
 */
function turretRoofParts(): Part[] {
  const parts: Part[] = [];
  const inner = TURRET.halfWidth - HULL.wall;
  const f = TURRET_FILLET;
  const thick = 0.03;
  // The roof's edges: a plate at 45° across each top corner, its face f in from the wall and down from the roof.
  const across = f * Math.SQRT2;
  const mid = inner - f / 2 + thick / (2 * Math.SQRT2);
  const midY = TURRET.roof - f / 2 + thick / (2 * Math.SQRT2);
  // Their ends sink into the walls.
  const length = 2 * inner + 0.04;
  for (const side of [-1, 1]) {
    parts.push({ geometry: new BoxGeometry(thick, across, length), color: IVORY, position: [side * mid, midY, 0], rotation: [0, 0, side * (Math.PI / 4)] });
    parts.push({ geometry: new BoxGeometry(length, across, thick), color: IVORY, position: [0, midY, side * mid], rotation: [-side * (Math.PI / 4), 0, 0] });
  }
  // The corners, from just above the walls' foot up to the roof's chamfers.
  const bottom = HULL.roof + HULL.wall + 0.02;
  const height = TURRET.roof - f / 2 - bottom;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new BoxGeometry(across, height, thick),
        color: IVORY,
        position: [sx * mid, bottom + height / 2, sz * mid],
        rotation: [0, sx * sz * (Math.PI / 4), 0],
      });
    }
  }
  // A collar round the hatch, under the roof.
  const h = GUNNER_HATCH;
  const collar = new TorusGeometry(h.radius + 0.03, 0.03, 4, 20);
  collar.rotateX(Math.PI / 2);
  collar.scale(1, 0.7, 1);
  parts.push({ geometry: collar, color: STEEL_LIGHT, position: [h.x, TURRET.roof - 0.015, h.z] });
  // The ventilator's round housing over the loader's side, with a grille of bars under it.
  const vent = { x: -0.5, z: -0.5, radius: 0.12, depth: 0.08 };
  parts.push({ geometry: new CylinderGeometry(vent.radius, vent.radius, vent.depth, 14, 1), color: STEEL, position: [vent.x, TURRET.roof - vent.depth / 2, vent.z] });
  for (let i = -2; i <= 2; i++) {
    const half = Math.sqrt(vent.radius * vent.radius - (i * 0.045) ** 2) - 0.01;
    parts.push(box([2 * half, 0.012, 0.014], [vent.x, TURRET.roof - vent.depth - 0.012, vent.z + i * 0.045], STEEL_LIGHT));
  }
  // A rib across the roof behind the hatch and the dome lamp, between the chamfers, its top sunk into the roof.
  parts.push(box([2 * (inner - f), 0.045, 0.06], [0, TURRET.roof - 0.0125, 0.72], IVORY_SHADE));
  return parts;
}

/** The names of a hatch's two lids: one drawn standing open, one shut in the hole; CabinLightSystem shows one (docs/interior.md). */
export const HATCH_LID_NAMES = {
  driver: { open: 'Driver Hatch Open', closed: 'Driver Hatch Closed' },
  gunner: { open: 'Gunner Hatch Open', closed: 'Gunner Hatch Closed' },
} as const;

/**
 * A hatch's lids, in the hull's frame for the driver's and the turret's for the gunner's: open (shown) and shut (hidden).
 * Shut, it is a plug a little wider than the hole, through the roof: its underside 1 cm under the roof's, inside the
 * cabin and lit as it is, and its top 3 cm over the roof's, painted.
 */
function createHatchLids(hatch: 'driver' | 'gunner'): Mesh[] {
  const open: Part[] = [];
  let shut: BufferGeometry;
  let underside: number;
  if (hatch === 'driver') {
    // Standing open in front of the hole, where the turret's overhang can't sweep into it.
    const [hx0, hz0, hx1, hz1] = DRIVER_HATCH;
    const top = HULL.roof + HULL.wall;
    open.push(box([hx1 - hx0, LID, 0.05], [(hx0 + hx1) / 2, top + LID / 2, hz0 - 0.03], PAINT_DARK));
    underside = HULL.roof - LID_PLUG.under;
    const height = top + LID_PLUG.over - underside;
    shut = new BoxGeometry(hx1 - hx0 + 2 * LID_PLUG.rim, height, hz1 - hz0 + 2 * LID_PLUG.rim);
    shut.translate((hx0 + hx1) / 2, underside + height / 2, (hz0 + hz1) / 2);
  } else {
    // The round lid, standing open behind the hole.
    const h = GUNNER_HATCH;
    const top = TURRET.roof + HULL.wall;
    const lid = new CylinderGeometry(h.radius + 0.02, h.radius + 0.02, 0.05, 16, 1);
    lid.rotateX(Math.PI / 2);
    open.push({ geometry: lid, color: PAINT_DARK, position: [h.x, top + h.radius + 0.02, h.z + h.radius + 0.06] });
    underside = TURRET.roof - LID_PLUG.under;
    const height = top + LID_PLUG.over - underside;
    shut = new CylinderGeometry(h.radius + LID_PLUG.rim, h.radius + LID_PLUG.rim, height, 20, 1);
    shut.translate(h.x, underside + height / 2, h.z);
  }
  const names = HATCH_LID_NAMES[hatch];
  const opened = new Mesh(mergeParts(open), material);
  opened.name = names.open;
  const closed = new Mesh(mergeParts([{ geometry: shut, color: (_tri, c) => (c.y < underside + 0.005 ? IVORY : PAINT_DARK) }]), material);
  closed.name = names.closed;
  closed.visible = false;
  return [opened, closed];
}
/** A shut lid's plug: how far it reaches under the roof and over it, and past the hole's edge all round, m. */
const LID_PLUG = { under: 0.01, over: 0.03, rim: 0.01 } as const;

/** The dome lamps' glowing lenses, each just under its housing, in the frame `frame` (a separate mesh: they glow). */
function createLampLenses(frame: 'hull' | 'turret'): Mesh {
  const parts: Part[] = DOME_LAMPS.filter((l) => l.frame === frame).map((l): Part => ({
    geometry: new CylinderGeometry(0.04, 0.03, 0.03, 10, 1),
    color: 0xffd9a0,
    position: [l.at[0], l.at[1] - 0.012, l.at[2]],
  }));
  const mesh = new Mesh(mergeParts(parts), lampMaterial);
  mesh.name = 'Dome Lamp';
  return mesh;
}
const lampMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/** Everything fixed to the turret, in turret space: walls, roof and hatch, gun and breech, basket, the gunner's seat and sight. */
function turretParts(): Part[] {
  const w = TURRET.halfWidth;
  const t = HULL.wall;
  const bottom = HULL.roof + HULL.wall;
  const top = TURRET.roof + t;
  const height = TURRET.roof - bottom;
  const midY = (TURRET.roof + bottom) / 2;
  const inside: Vec3 = [0, 2.3, 0];
  const parts: Part[] = [
    plate([t, height, TURRET.rear - TURRET.front], [-w + t / 2, midY, 0], inside),
    plate([t, height, TURRET.rear - TURRET.front], [w - t / 2, midY, 0], inside),
    plate([2 * (w - t), height, t], [0, midY, TURRET.front + t / 2], inside),
    plate([2 * (w - t), height, t], [0, midY, TURRET.rear - t / 2], inside),
  ];
  const outline = rectangle(new Shape(), -w, TURRET.front, w, TURRET.rear) as Shape;
  const h = GUNNER_HATCH;
  outline.holes.push(new Path().absarc(h.x, h.z, h.radius, 0, Math.PI * 2, true));
  parts.push(roof(outline, top, t));
  // The turret's foot: a plate from its walls in to the ring, so where a turned turret's corners overhang the hull's sides
  // nobody sees the ground past the hull roof's edge. Its edges are sunk in the walls.
  const foot = rectangle(new Shape(), -w + t / 2, TURRET.front + t / 2, w - t / 2, TURRET.rear - t / 2) as Shape;
  foot.holes.push(new Path().absarc(0, 0, TURRET_FOOT.hole, 0, Math.PI * 2, true));
  const footTop = bottom + TURRET_FOOT.lift + TURRET_FOOT.thickness;
  parts.push({ ...roof(foot, footTop, TURRET_FOOT.thickness), color: (_tri: number, c: Vector3) => (c.y > footTop - 0.005 ? IVORY : PAINT) });
  // The cast turret's inside, rounded rather than a box (docs/interior.md).
  parts.push(...turretRoofParts());
  // The ring the turret turns on.
  // The ring the turret turns on, flattened, with the basket's posts hanging from it.
  // Narrow, at the hole's edge, so the gunner's crank and hands turn inside it.
  const ringTop = TURRET_RING.y;
  const ring = new TorusGeometry(TURRET_RING.radius, TURRET_RING.tube, 4, 24);
  ring.rotateX(Math.PI / 2);
  ring.scale(1, TURRET_RING.halfHeight / TURRET_RING.tube, 1);
  parts.push({ geometry: ring, color: STEEL, position: [0, ringTop, 0] });

  // The gun is its own mesh, so it can elevate (createGun).
  // The gunner's station: a gearbox behind each wheel on a column from the basket floor, and the power grip's pedestal (F1.8).
  parts.push(...stationParts());

  // The gunsight hangs from the roof at SIGHT_EYEPIECE (spike S1's, src/systems/sight-system.ts, until F1.9).

  // The basket: its floor, and posts up to the ring with a rail round them at hand height.
  const floor = TURRET.basketFloor;
  parts.push({ geometry: new CylinderGeometry(TURRET.basketRadius, TURRET.basketRadius, 0.04, 20, 1), color: BASKET, position: [0, floor - 0.02, 0] });
  const postRadius = 0.86;
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const x = Math.sin(a) * postRadius;
    const z = Math.cos(a) * postRadius;
    parts.push(beam([x, floor - 0.01, z], [x, ringTop, z], 0.018, STEEL, 6));
  }
  const rail = new TorusGeometry(postRadius, 0.02, 4, 24);
  rail.rotateX(Math.PI / 2);
  parts.push({ geometry: rail, color: STEEL_LIGHT, position: [0, floor + 0.55, 0] });
  const gunner = SEATS.gunner;
  parts.push(...seatParts(gunner.cushion, gunner.floorY));
  // Loading (F1.10): the ready rack on the right wall, the casing bin under the breech and the loading board's backing.
  parts.push(...rackParts(), ...binParts(), ...boardParts());
  // The range run's clock over the loading board (F1.11).
  parts.push(...gunnerClockParts());
  // The radio in the turret's bustle and the dome lamp's housing (docs/interior.md).
  parts.push(...turretDetailParts());
  return parts;
}

/** The fixed parts of the gunner's station, in turret space: what the moving controls (src/systems/turret-system.ts) are mounted on. */
function stationParts(): Part[] {
  const parts: Part[] = [];
  const floor = TURRET.basketFloor;
  for (const key of ['elevation', 'crank'] as const) {
    const mount: StationMount = STATION[key];
    // The gearbox sits behind the wheel's hub, which ends inside it; its column stands on the basket floor.
    const centre = mountToTurret(mount, [0, 0, -0.04], [0, 0, 0]);
    // Either a tilt or a turn, so the order of the two doesn't matter.
    parts.push({ geometry: new BoxGeometry(0.08, 0.08, 0.05), color: STEEL_LIGHT, position: centre, rotation: [mount.tilt, mount.yaw ?? 0, 0] });
    parts.push(beam([centre[0], floor - 0.01, centre[2]], [centre[0], centre[1] - 0.02, centre[2]], 0.022, STEEL, 6));
    if (key === 'elevation') {
      // As on the Sherman: the gearbox's column carries the drive up to the elevating pinion, which meshes with the arc on the gun (gunParts).
      const { pinion, pinionRadius } = ELEVATING_GEAR;
      parts.push(beam([centre[0], centre[1] + 0.02, centre[2]], [pinion[0], pinion[1] - pinionRadius - 0.005, pinion[2]], 0.02, STEEL, 6));
      parts.push({ geometry: new BoxGeometry(0.035, 0.05, 0.06), color: STEEL_LIGHT, position: [pinion[0] + 0.03, pinion[1], pinion[2]] });
      parts.push({ geometry: new CylinderGeometry(pinionRadius, pinionRadius, 0.03, 10, 1), color: STEEL, position: pinion, rotation: [0, 0, Math.PI / 2] });
    }
  }
  // The power grip's pedestal: its top 15 mm under the grip's flange, as the kit's bench has it.
  const { at } = STATION.twist;
  const top = at[1] + POWER_GRIP.base - 0.015;
  parts.push({ geometry: new CylinderGeometry(0.034, 0.042, top - floor + 0.01, 10, 1), color: PAINT_DARK, position: [at[0], (top + floor - 0.01) / 2, at[2]] });
  return parts;
}

/**
 * The gun's cradle, in gun space: its origin on the trunnions (place it at
 * (0, TRUNNION.y, TRUNNION.z) in turret space) and elevated with
 * `rotation.x`. Only the mantlet: the barrel and breech recoil through it
 * (gunRecoilParts), and the gunsight hangs on it (F1.9).
 */
function gunParts(): Part[] {
  const z0 = TRUNNION.z;
  return [box([0.9, 0.32, MANTLET_DEPTH], [0, 0.01, TURRET.front - MANTLET_DEPTH / 2 + 0.01 - z0], PAINT), ...elevatingArcParts()];
}

/**
 * The toothed elevating arc on the cradle's right side (src/sim/turret.ts
 * ELEVATING_GEAR), gun space: a curved bar round the trunnions with teeth on
 * its outer edge for the pinion, on two arms from a boss just inside the
 * front plate. It turns with the gun, so the handwheel is seen to work it.
 */
function elevatingArcParts(): Part[] {
  const { x, radius: r, half, from, to } = ELEVATING_GEAR;
  const parts: Part[] = [];
  const at = (angle: number, radius: number): Vec3 => [x, radius * Math.cos(angle), radius * Math.sin(angle)];
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const b = from + ((to - from) * (i + 1)) / steps;
    // Each piece runs a little into the next, so the bar has no gaps.
    parts.push(beam(at(a - 0.004, r), at(b + 0.004, r), half, STEEL_LIGHT, 4));
  }
  // A tooth every 3°.
  const teeth = Math.round((to - from) / (Math.PI / 60));
  for (let i = 0; i <= teeth; i++) {
    const a = from + ((to - from) * i) / teeth;
    parts.push(beam(at(a, r + half - 0.004), at(a, r + half + 0.008), 0.004, STEEL, 4));
  }
  const boss: Vec3 = [x, 0, HULL.wall + 0.04];
  parts.push(beam(boss, at(from, r - half + 0.002), 0.012, STEEL, 5));
  parts.push(beam(boss, at(to, r - half + 0.002), 0.012, STEEL, 5));
  parts.push({ geometry: new CylinderGeometry(0.03, 0.03, 0.03, 8, 1), color: STEEL_LIGHT, position: boss, rotation: [0, 0, Math.PI / 2] });
  return parts;
}

/**
 * What recoils when the gun fires (F1.10), gun space with the gun in
 * battery: the barrel and muzzle brake outside the front plate, and the
 * breech beside the gunner, with a square mouth at its back that a shell
 * goes into, the guides its block slides in and the lever's axle.
 */
function gunRecoilParts(): Part[] {
  const t = HULL.wall;
  const z0 = TRUNNION.z;
  const parts: Part[] = [];
  // Thicker at the mantlet end (+Z once turned).
  const barrel = new CylinderGeometry(GUN.barrelRadius * 1.15, GUN.barrelRadius, GUN.barrelLength, 10, 1);
  barrel.rotateX(Math.PI / 2);
  const muzzle = TURRET.front - MANTLET_DEPTH - GUN.barrelLength - z0;
  parts.push({ geometry: barrel, color: PAINT_DARK, position: [0, 0, muzzle + GUN.barrelLength / 2 + 0.02] });
  const brake = new CylinderGeometry(0.09, 0.09, 0.26, 10, 1);
  brake.rotateX(Math.PI / 2);
  parts.push({ geometry: brake, color: PAINT_DARK, position: [0, 0, muzzle + 0.12] });
  // The breech: four bars round the square mouth, the whole way through.
  const front = TURRET.front + t - z0;
  const back = GUN.breechBack - z0;
  const length = back - front;
  const mid = (front + back) / 2;
  const w = GUN.breechHalfWidth;
  const h = 0.15;
  const hole = BREECH_HOLE;
  parts.push(box([2 * w, h - hole, length], [0, (h + hole) / 2, mid], STEEL));
  parts.push(box([2 * w, h - hole, length], [0, -(h + hole) / 2, mid], STEEL));
  parts.push(box([w - hole, 2 * hole, length], [-(w + hole) / 2, 0, mid], STEEL));
  parts.push(box([w - hole, 2 * hole, length], [(w + hole) / 2, 0, mid], STEEL));
  // The chamber's far end, dark, so the mouth reads as a hole: 3 cm ahead of the breech, clear of a rammed shell's driving band.
  parts.push(box([2 * hole, 2 * hole, 0.01], [0, 0, front - 0.03], RUBBER));
  parts.push(...breechFittings(w));
  return parts;
}

const material = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));

/** The hull, with everything fixed to it, in one mesh. */
export function createHull(): Mesh {
  const mesh = new Mesh(mergeParts(hullParts()), material);
  mesh.name = 'Hull';
  mesh.add(createLampLenses('hull'), ...createHatchLids('driver'));
  return mesh;
}

/**
 * The gun, in gun space: place it on the trunnions, (0, TRUNNION.y,
 * TRUNNION.z) in turret space, and elevate it with rotation.x. The mesh
 * is the cradle; its child 'Gun Recoil' (the barrel and breech) slides
 * back along +Z when it fires (LoadingSystem).
 */
export function createGun(): Mesh {
  const mesh = new Mesh(mergeParts(gunParts()), material);
  mesh.name = 'Gun';
  const recoil = new Mesh(mergeParts(gunRecoilParts()), material);
  recoil.name = 'Gun Recoil';
  mesh.add(recoil);
  return mesh;
}

/** The turret and its basket in one mesh, in turret space (the gun apart): place it at the ring's centre, (0, 0, TURRET.z). */
export function createTurret(): Mesh {
  const mesh = new Mesh(mergeParts(turretParts()), material);
  mesh.name = 'Turret';
  mesh.add(createLampLenses('turret'), ...createHatchLids('gunner'));
  return mesh;
}
