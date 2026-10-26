import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  TorusGeometry,
  type Vector3,
} from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import {
  GROUND_Y,
  GUN,
  HULL,
  SEATS,
  TURRET,
  VISION_SLIT,
} from '../sim/cabin.js';
import { MANTLET_DEPTH, POWER_GRIP, STATION, TRUNNION } from '../sim/turret.js';

/**
 * The tank, seen from inside: the hull with the driver's seat, and the
 * turret with its basket, the gunner's seat, the breech and the gun. The
 * ground it drives on is src/scene-assets/terrain.scene-asset.ts. Sizes come from
 * src/sim/cabin.ts, so the systems and tests use the same numbers.
 *
 * Hull space: hull floor at y = 0, the front towards -Z. The turret is its
 * own mesh in turret space (origin at the ring's centre), so it can turn,
 * and the gun its own again inside it, so it can elevate (F1.8); the seats' moving controls come as their own meshes too (F1.5).
 * Each is merged into one draw call, vertex-coloured and flat-shaded.
 *
 * Plates are painted on the outside and ivory inside, as the real tanks'
 * crew compartments were, so the inside reads light even with the hatches
 * shut.
 */

const PAINT = 0x8f8a5c;
const PAINT_DARK = 0x6f6b47;
const IVORY = 0xe6dcc0;
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

/** The driver's hatch in the hull roof, over their eyes (x0, z0, x1, z1), m. */
const DRIVER_HATCH = [SEATS.driver.eye[0] - 0.25, SEATS.driver.eye[2] - 0.25, SEATS.driver.eye[0] + 0.25, SEATS.driver.eye[2] + 0.25] as const;
/** The gunner's hatch in the turret roof, in turret space, over their seat (x0, z0, x1, z1), m. */
const GUNNER_HATCH = [SEATS.gunner.eye[0] - 0.27, SEATS.gunner.eye[2] - 0.17, SEATS.gunner.eye[0] + 0.27, SEATS.gunner.eye[2] + 0.37] as const;
/** How high a hatch lid stands when open, m. */
const LID = 0.5;

/** A seat: cushion, backrest and a post down to its floor, in its frame. */
function seatParts(cushion: Vec3, floorY: number): Part[] {
  const [x, top, z] = cushion;
  return [
    box([0.44, 0.08, 0.42], [x, top - 0.04, z], LEATHER),
    box([0.44, 0.5, 0.07], [x, top + 0.25 - 0.02, z + 0.245], LEATHER),
    box([0.06, top - 0.08 - floorY + 0.01, 0.06], [x, (top - 0.08 + floorY) / 2, z + 0.05], STEEL),
  ];
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
    // Side walls, running the hull's full length; the front plate and the bulkhead fit between them.
    plate([t, height, length], [-w - t / 2, midY, midZ], inside),
    plate([t, height, length], [w + t / 2, midY, midZ], inside),
    // The bulkhead in front of the engine.
    plate([2 * w, height, t], [0, midY, HULL.rear + t / 2], inside),
  ];
  // The front plate, round the vision slit.
  const s = VISION_SLIT;
  const slitBottom = s.y - s.height / 2;
  const slitTop = s.y + s.height / 2;
  const fz = HULL.front - t / 2;
  parts.push(
    plate([2 * w, slitBottom - bottom, t], [0, (slitBottom + bottom) / 2, fz], inside),
    plate([2 * w, top - slitTop, t], [0, (top + slitTop) / 2, fz], inside),
    plate([s.x - s.width / 2 + w, s.height, t], [(s.x - s.width / 2 - w) / 2, s.y, fz], inside),
    plate([w - (s.x + s.width / 2), s.height, t], [(s.x + s.width / 2 + w) / 2, s.y, fz], inside),
  );
  // The roof, with the turret ring and the driver's hatch cut out.
  const outline = rectangle(new Shape(), -outer, front, outer, rear) as Shape;
  outline.holes.push(new Path().absarc(0, TURRET.z, TURRET.ringRadius, 0, Math.PI * 2, true));
  const [hx0, hz0, hx1, hz1] = DRIVER_HATCH;
  outline.holes.push(rectangle(new Path(), hx0, hz1, hx1, hz0));
  parts.push(roof(outline, top, t));
  // The driver's hatch lid, standing open behind the hole.
  parts.push(box([hx1 - hx0, LID, 0.05], [(hx0 + hx1) / 2, top + LID / 2, hz1 + 0.03], PAINT_DARK));

  // The driver's place: seat, a dash under the slit, and the gearbox's hump beside their legs.
  const driver = SEATS.driver;
  parts.push(...seatParts(driver.cushion, driver.floorY));
  parts.push(box([0.8, 0.08, 0.2], [s.x, slitBottom - 0.26, HULL.front + 0.1], STEEL_LIGHT));
  parts.push(box([0.6, 0.45, 1.3], [0, 0.225, HULL.front + 0.65], PAINT_DARK));

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
  const [hx0, hz0, hx1, hz1] = GUNNER_HATCH;
  outline.holes.push(rectangle(new Path(), hx0, hz1, hx1, hz0));
  parts.push(roof(outline, top, t));
  parts.push(box([hx1 - hx0, LID, 0.05], [(hx0 + hx1) / 2, top + LID / 2, hz1 + 0.03], PAINT_DARK));
  // The ring the turret turns on.
  // The ring the turret turns on, flattened, with the basket's posts hanging from it.
  const ringTop = bottom - 0.02;
  const ring = new TorusGeometry(0.9, 0.07, 4, 24);
  ring.rotateX(Math.PI / 2);
  ring.scale(1, 0.5, 1);
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
  return parts;
}

/** The fixed parts of the gunner's station, in turret space: what the moving controls (src/systems/turret-system.ts) are mounted on. */
function stationParts(): Part[] {
  const parts: Part[] = [];
  const floor = TURRET.basketFloor;
  for (const key of ['elevation', 'crank'] as const) {
    const { at, tilt } = STATION[key];
    // The gearbox sits behind the wheel's hub, which ends inside it; its column stands on the basket floor.
    const back = -0.045;
    const centre: Vec3 = [at[0], at[1] - back * Math.sin(tilt), at[2] + back * Math.cos(tilt)];
    parts.push({ geometry: new BoxGeometry(0.08, 0.08, 0.06), color: STEEL_LIGHT, position: centre, rotation: [tilt, 0, 0] });
    parts.push(beam([centre[0], floor - 0.01, centre[2]], [centre[0], centre[1] - 0.02, centre[2]], 0.022, STEEL, 6));
  }
  // The power grip's pedestal: its top 15 mm under the grip's flange, as the kit's bench has it.
  const { at } = STATION.twist;
  const top = at[1] + POWER_GRIP.base - 0.015;
  parts.push({ geometry: new CylinderGeometry(0.034, 0.042, top - floor + 0.01, 10, 1), color: PAINT_DARK, position: [at[0], (top + floor - 0.01) / 2, at[2]] });
  return parts;
}

/**
 * The gun, in gun space: its origin on the trunnions (place it at
 * (0, TRUNNION.y, TRUNNION.z) in turret space) and elevated with
 * `rotation.x`. The mantlet, barrel and muzzle brake are outside the
 * turret's front plate; the breech block reaches back beside the gunner.
 */
function gunParts(): Part[] {
  const t = HULL.wall;
  const z0 = TRUNNION.z;
  const parts: Part[] = [];
  parts.push(box([0.9, 0.32, MANTLET_DEPTH], [0, 0.01, TURRET.front - MANTLET_DEPTH / 2 + 0.01 - z0], PAINT));
  // Thicker at the mantlet end (+Z once turned).
  const barrel = new CylinderGeometry(GUN.barrelRadius * 1.15, GUN.barrelRadius, GUN.barrelLength, 10, 1);
  barrel.rotateX(Math.PI / 2);
  const muzzle = TURRET.front - MANTLET_DEPTH - GUN.barrelLength - z0;
  parts.push({ geometry: barrel, color: PAINT_DARK, position: [0, 0, muzzle + GUN.barrelLength / 2 + 0.02] });
  const brake = new CylinderGeometry(0.09, 0.09, 0.26, 10, 1);
  brake.rotateX(Math.PI / 2);
  parts.push({ geometry: brake, color: PAINT_DARK, position: [0, 0, muzzle + 0.12] });
  const breechFront = TURRET.front + t - z0;
  const breechLength = GUN.breechBack - TURRET.front - t;
  parts.push(box([2 * GUN.breechHalfWidth, 0.3, breechLength], [0, 0, breechFront + breechLength / 2], STEEL));
  // The breech's opening at its back, a darker ring standing 5 mm proud.
  const mouth = new CylinderGeometry(0.075, 0.075, 0.03, 10, 1);
  mouth.rotateX(Math.PI / 2);
  parts.push({ geometry: mouth, color: RUBBER, position: [0, 0, GUN.breechBack + 0.01 - z0] });
  return parts;
}

const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });

/** The hull, with everything fixed to it, in one mesh. */
export function createHull(): Mesh {
  const mesh = new Mesh(mergeParts(hullParts()), material);
  mesh.name = 'Hull';
  return mesh;
}

/** The gun in one mesh, in gun space: place it on the trunnions, (0, TRUNNION.y, TRUNNION.z) in turret space, and elevate it with rotation.x. */
export function createGun(): Mesh {
  const mesh = new Mesh(mergeParts(gunParts()), material);
  mesh.name = 'Gun';
  return mesh;
}

/** The turret and its basket in one mesh, in turret space (the gun apart): place it at the ring's centre, (0, 0, TURRET.z). */
export function createTurret(): Mesh {
  const mesh = new Mesh(mergeParts(turretParts()), material);
  mesh.name = 'Turret';
  return mesh;
}
