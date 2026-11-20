import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Mesh, MeshStandardMaterial, Shape, TorusGeometry, Vector2 } from '@iwsdk/core';
import { beam, mergeParts, type Part } from './lowpoly.js';
import { litInside } from './cabin-light.js';
import { GUN, HULL, TURRET } from '../sim/cabin.js';
import { GEARBOX } from '../sim/driver-station.js';
import {
  BASKET_SKIRT,
  BRAKE_DRUMS,
  BREATHER,
  ACCELERATOR_PAD_LIFT,
  ACCELERATOR_STOP,
  CLUTCH_MASTER,
  CLUTCH_PUSH_ROD,
  CLUTCH_RESERVOIR,
  COAX,
  DIFFERENTIAL,
  FOOT_PLATE,
  HULL_BIN,
  HULL_RACK,
  PEDAL_BOX,
  PEDALS,
  type PedalId,
  PISTOL_PORT,
  PROPELLER_SHAFT,
  RECOIL_CYLINDERS,
  RECOIL_GUARD,
  TRANSMISSION,
  TRAVERSE_GEARBOX,
  TRAVERSE_MOTOR,
  TURRET_LOCK,
} from '../sim/interior-fittings.js';
import { INTERIOR_COLORS as C, interiorFinish } from './finish.js';

/**
 * The crew compartment's fittings nobody works (docs/interior.md, "The rest
 * of the compartment"), as on an M4A4 (TM 9-754, figures 9 and 13): merged
 * into the hull's, the turret's, the gun's cradle's and the gun's recoiling
 * part's meshes by cabin.scene-asset.ts. Sizes and places from
 * src/sim/interior-fittings.ts. Low-poly and vertex-coloured; colours from
 * the shared palette, so they take their finishes (src/scene-assets/finish.ts).
 */

type Vec3 = readonly [number, number, number];

const ALONG_X: Vec3 = [0, 0, Math.PI / 2];
const ALONG_Z: Vec3 = [Math.PI / 2, 0, 0];

const material = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }), { finish: true });

function box(size: Vec3, position: Vec3, color: number, rotation?: Vec3): Part {
  return { geometry: new BoxGeometry(...size), color, position, rotation };
}

function cylinder(radius: number, length: number, position: Vec3, color: number, rotation?: Vec3, sides = 10, top = radius): Part {
  return { geometry: new CylinderGeometry(top, radius, length, sides, 1), color, position, rotation };
}

/** A solid from an outline in the XY plane, from z0 back to z1 (z1 > z0). */
function extrudeXY(outline: [number, number][], z0: number, z1: number, color: number, curveSegments = 12): Part {
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  const geometry = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments });
  geometry.translate(0, 0, z0);
  return { geometry, color };
}

/** The transmission's case's cross-section, `out` m outside it (for its flange): the floor, sides, chamfered shoulders and flat top. */
function caseOutline(out: number): [number, number][] {
  const t = TRANSMISSION;
  const x = t.x;
  const w = t.halfWidth + out;
  const tw = t.topHalfWidth + out;
  const top = GEARBOX.top + out;
  return [[x - w, -0.01], [x + w, -0.01], [x + w, t.shoulder], [x + tw, top], [x - tw, top], [x - w, t.shoulder]];
}

/**
 * The driver's compartment's drive train and pedals, hull space: the
 * transmission's case under the gear lever with its split flange, ribs
 * and filler cap, the differential's ribbed cover against the nose plate,
 * the brake drums either side with their breathers and the pipe across,
 * the propeller shaft's tunnel back to the engine, and the driver's foot
 * plate and pedals.
 */
export function driveTrainParts(): Part[] {
  const parts: Part[] = [];
  const t = TRANSMISSION;
  // The case: front half up to the flange, back half behind it, the flange standing 1.2 cm proud between them.
  parts.push(extrudeXY(caseOutline(0), GEARBOX.z0 - 0.01, t.flangeZ - 0.02, C.casting));
  parts.push(extrudeXY(caseOutline(0.012), t.flangeZ - 0.02, t.flangeZ + 0.02, C.casting));
  parts.push(extrudeXY(caseOutline(0), t.flangeZ + 0.02, GEARBOX.z1, C.casting));
  // Bolts round the flange's sides, on its back face.
  for (const side of [-1, 1]) {
    for (const y of [0.04, 0.1, 0.16]) parts.push(cylinder(0.011, 0.04, [t.x + side * (t.halfWidth - 0.004), y, t.flangeZ + 0.01], C.steel, ALONG_Z, 6));
  }
  // Cooling ribs down the case's sides, behind the steering levers' pedestals.
  for (const side of [-1, 1]) {
    for (const z of [-1.62, -1.48, -1.34, -1.2]) parts.push(box([0.026, t.shoulder - 0.02, 0.016], [t.x + side * (t.halfWidth + 0.003), (t.shoulder - 0.02) / 2, z], C.casting));
  }
  // The filler cap on top at the back right.
  parts.push(cylinder(0.03, 0.035, [t.x + 0.12, GEARBOX.top + 0.0125, -1.32], C.steel, undefined, 8));

  // The differential's cover: an arch facing the crew, ribs fanning out from its boss.
  const d = DIFFERENTIAL;
  const arch: [number, number][] = [[d.x - d.radius, -0.01], [d.x + d.radius, -0.01]];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * i) / steps;
    arch.push([d.x + d.radius * Math.cos(a), d.y + d.radius * Math.sin(a)]);
  }
  parts.push(extrudeXY(arch, d.front, d.back, C.casting));
  for (let i = 0; i < d.ribs; i++) {
    const a = (Math.PI * (i + 0.5)) / d.ribs;
    const r0 = 0.07;
    const r1 = d.radius - 0.012;
    const mid = (r0 + r1) / 2;
    parts.push(box([r1 - r0, 0.016, 0.03], [d.x + mid * Math.cos(a), d.y + mid * Math.sin(a), d.back + 0.012], C.casting, [0, 0, a]));
  }
  parts.push(cylinder(0.065, 0.05, [d.x, d.y, d.back + 0.02], C.casting, ALONG_Z, 12));
  parts.push(cylinder(0.025, 0.07, [d.x, d.y, d.back + 0.04], C.steel, ALONG_Z, 6));
  // The cover's foot runs back into the case under the gear lever.
  parts.push(box([2 * d.radius - 0.02, 0.2, 0.05], [d.x, 0.09, d.back + 0.02], C.casting));

  // The brake drums, each with its adjusting hole's cover on its end, and the breathers up to the pipe across.
  const b = BRAKE_DRUMS;
  for (const [x0, x1] of [b.left, b.right]) {
    const outer = x0 < GEARBOX.x0 ? x0 : x1;
    parts.push(cylinder(b.radius, x1 - x0 + 0.01, [(x0 + x1) / 2, b.y, b.z], C.casting, ALONG_X, 14));
    parts.push(cylinder(b.radius + 0.012, 0.025, [outer + (x0 < GEARBOX.x0 ? 0.03 : -0.03), b.y, b.z], C.casting, ALONG_X, 14));
    parts.push(cylinder(0.05, 0.016, [outer + (x0 < GEARBOX.x0 ? -0.004 : 0.004), b.y, b.z], C.steel, ALONG_X, 8));
  }
  const p = BREATHER;
  for (const x of [p.x0 + 0.02, p.x1 - 0.02]) parts.push(cylinder(p.radius, p.y - b.y, [x, (p.y + b.y) / 2, p.z], C.steel, undefined, 6));
  parts.push(cylinder(p.radius, p.x1 - p.x0, [(p.x0 + p.x1) / 2, p.y, p.z], C.steel, ALONG_X, 6));
  for (const x of [p.x0 + 0.02, p.x1 - 0.02]) parts.push(cylinder(p.radius + 0.008, 0.05, [x, p.y, p.z], C.steel, ALONG_X, 6));

  // The propeller shaft's tunnel, with a bell at each end.
  const s = PROPELLER_SHAFT;
  parts.push(cylinder(s.radius, s.to - s.from, [s.x, s.y, (s.from + s.to) / 2], C.casting, ALONG_Z, 12));
  parts.push(cylinder(s.radius + 0.035, 0.12, [s.x, s.y, s.from + 0.06], C.casting, ALONG_Z, 12));
  parts.push(cylinder(s.radius + 0.035, 0.1, [s.x, s.y, s.to - 0.05], C.casting, ALONG_Z, 12));
  for (let z = s.from + 0.6; z < s.to - 0.3; z += 0.75) parts.push(cylinder(s.radius + 0.012, 0.03, [s.x, s.y, z], C.casting, ALONG_Z, 12));

  // The driver's foot plate, with raised diamonds across it.
  const f = FOOT_PLATE;
  parts.push(box([f.x1 - f.x0, f.top + 0.01, f.z1 - f.z0], [(f.x0 + f.x1) / 2, (f.top - 0.01) / 2, (f.z0 + f.z1) / 2], C.steel));
  const across = 7;
  const along = 5;
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < along; j++) {
      const x = f.x0 + ((i + 0.5) / across) * (f.x1 - f.x0);
      const z = f.z0 + ((j + 0.5) / along) * (f.z1 - f.z0);
      const turn = (i + j) % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
      parts.push(box([0.034, 0.008, 0.01], [x, f.top + 0.002, z], C.steel, [0, turn, 0]));
    }
  }
  // The pedals' fixed parts. The clutch's pedal box on the nose plate: a backing plate, two cheeks either side of the
  // arm with the pivot's pin through them, the master cylinder under them in line with the push rod, its reservoir
  // beside them with a hose down to it, and the line from it down the nose plate under the foot plate (to the engine's
  // clutch). Then the accelerator's heel hinge and the rubber stop under its toe (the pedals move: createPedal).
  const c = PEDALS.clutch;
  const pb = PEDAL_BOX;
  const m = CLUTCH_MASTER;
  const [py, pz] = c.pivot;
  const front = HULL.front;
  const bore = py - c.clevis;
  parts.push(box([0.09, pb.top - (bore - m.radius - 0.02), 0.01], [c.x, (pb.top + bore - m.radius - 0.02) / 2, front + 0.004], C.steel));
  for (const side of [-1, 1]) {
    parts.push(box([pb.cheek, pb.top - pb.bottom, pb.back - front - 0.008], [c.x + side * (pb.cheekGap + pb.cheek / 2), (pb.top + pb.bottom) / 2, (front + 0.008 + pb.back) / 2], C.steel));
  }
  parts.push(cylinder(0.008, 2 * (pb.cheekGap + pb.cheek) + 0.012, [c.x, py, pz], C.steel, ALONG_X, 8));
  for (const side of [-1, 1]) parts.push(cylinder(0.011, 0.006, [c.x + side * (pb.cheekGap + pb.cheek + 0.006), py, pz], C.steel, ALONG_X, 6));
  // The master cylinder: its body with a flange on the backing plate, and a boot where the push rod goes in.
  parts.push(cylinder(m.radius, m.back - front - 0.01, [c.x, bore, (front + 0.009 + m.back) / 2], C.casting, ALONG_Z, 12));
  parts.push(box([2 * pb.cheekGap - 0.004, 0.07, 0.008], [c.x, bore, front + 0.013], C.casting));
  parts.push(cylinder(0.012, 0.016, [c.x, bore, m.back + 0.006], C.rubber, ALONG_Z, 8));
  const r = CLUTCH_RESERVOIR;
  const rx = c.x + r.x;
  const rz = front + 0.01 + r.radius + 0.004;
  parts.push(cylinder(r.radius, r.height, [rx, r.y + r.height / 2, rz], C.casting, undefined, 10));
  parts.push(cylinder(r.radius * 0.7, 0.012, [rx, r.y + r.height + 0.006, rz], C.steel, undefined, 8));
  parts.push(box([0.05, 0.016, rz - front - 0.006], [rx, r.y + 0.02, (front + 0.006 + rz) / 2], C.steel));
  parts.push(beam([rx, r.y + 0.004, rz], [c.x + 0.012, bore + m.radius - 0.004, front + 0.03], 0.005, C.rubber, 6));
  parts.push(beam([c.x - 0.01, bore - m.radius + 0.004, front + 0.03], [c.x - 0.03, 0.12, front + 0.012], 0.004, C.steel, 6));
  parts.push(beam([c.x - 0.03, 0.12, front + 0.012], [c.x - 0.03, -0.01, front + 0.012], 0.004, C.steel, 6));
  const a = PEDALS.accelerator;
  for (const side of [-1, 1]) {
    parts.push(box([0.008, a.pivot[0] + 0.012 - f.top, 0.03], [a.x + side * (a.width / 2 + 0.006), (a.pivot[0] + 0.012 + f.top) / 2, a.pivot[1]], C.steel));
  }
  parts.push(cylinder(0.006, a.width + 0.024, [a.x, a.pivot[0], a.pivot[1]], C.steel, ALONG_X, 8));
  // The toe's rubber stop: a post from the plate and a buffer on it tilted to meet the pressed pad's underside flat.
  const st = ACCELERATOR_STOP;
  const cap = 0.008;
  const capMid = [st.top[0] - Math.cos(st.tilt) * cap / 2, st.top[1] - Math.sin(st.tilt) * cap / 2];
  parts.push(cylinder(st.radius, cap, [a.x, capMid[0], capMid[1]], C.rubber, [st.tilt, 0, 0], 8));
  const postTop = capMid[0];
  parts.push(cylinder(st.radius * 0.8, postTop - f.top, [a.x, (postTop + f.top) / 2, capMid[1]], C.rubber, undefined, 8));
  return parts;
}

/**
 * The hull's ammunition either side of the turret basket, hull space: on
 * the right an open rack of rounds lying across the hull, their brass bases
 * and primers towards the basket; on the left an armoured bin with its lid,
 * hinges and latch.
 */
export function hullAmmoParts(): Part[] {
  const parts: Part[] = [];
  const w = HULL.halfWidth;
  const r = HULL_RACK;
  const depth = w + 0.025 - r.x;
  // The rack's face plate (holes for the rounds are where the bases stand) and its top and bottom.
  parts.push(box([depth, r.y1 - r.y0, r.z1 - r.z0], [r.x + depth / 2, (r.y0 + r.y1) / 2, (r.z0 + r.z1) / 2], C.olive));
  parts.push(box([depth + 0.01, 0.03, r.z1 - r.z0 + 0.03], [r.x + depth / 2 - 0.01, r.y1 + 0.01, (r.z0 + r.z1) / 2], C.steel));
  const pitchY = (r.y1 - r.y0) / r.rows;
  const pitchZ = (r.z1 - r.z0) / r.columns;
  for (let i = 0; i < r.rows; i++) {
    for (let j = 0; j < r.columns; j++) {
      const y = r.y0 + (i + 0.5) * pitchY;
      const z = r.z0 + (j + 0.5) * pitchZ;
      // A dark ring round each base, then the brass base standing out of it and the primer out of that.
      // End to end, so their faces at different radii never overlap.
      parts.push(cylinder(0.05, 0.008, [r.x - 0.002, y, z], C.dark, ALONG_X, 10));
      parts.push(cylinder(0.042, 0.0172, [r.x - 0.0148, y, z], C.brass, ALONG_X, 10));
      parts.push(cylinder(0.011, 0.01, [r.x - 0.026, y, z], C.primer, ALONG_X, 6));
    }
  }
  // The armoured bin: its box, a lid a little wider sitting on it, two hinges on the wall side and a latch on the front.
  const b = HULL_BIN;
  const bin = -w - 0.025 - b.x;
  const lid = 0.025;
  const midZ = (b.z0 + b.z1) / 2;
  parts.push(box([-bin, b.y1 - b.y0 - lid, b.z1 - b.z0], [(b.x - w - 0.025) / 2, (b.y0 + b.y1 - lid) / 2, midZ], C.olive));
  parts.push(box([-bin + 0.012, lid, b.z1 - b.z0 + 0.016], [(b.x - w - 0.025) / 2 + 0.006, b.y1 - lid / 2, midZ], C.olive));
  for (const z of [b.z0 + 0.15, b.z1 - 0.15]) parts.push(cylinder(0.012, 0.08, [-w + 0.03, b.y1 + 0.004, z], C.steel, ALONG_Z, 6));
  parts.push(box([0.016, 0.07, 0.05], [b.x + 0.016, b.y1 - 0.07, midZ], C.steel));
  parts.push(box([0.006, 0.06, 0.25], [b.x + 0.004, b.y1 - 0.16, midZ], C.ivory));
  // Two carrying handles on its front.
  for (const z of [b.z0 + 0.2, b.z1 - 0.2]) parts.push(box([0.02, 0.02, 0.1], [b.x + 0.008, (b.y0 + b.y1) / 2 - 0.04, z], C.steel));
  return parts;
}

/**
 * On the gun's cradle, gun space: the recoil cylinders over the breech, the
 * guard behind it on the left, and the coaxial machine gun on its right with
 * its ammunition box.
 */
export function cradleFittingParts(): Part[] {
  const parts: Part[] = [];
  const r = RECOIL_CYLINDERS;
  for (const side of [-1, 1]) {
    parts.push(cylinder(r.radius, r.back - r.front, [side * r.x, r.y, (r.front + r.back) / 2], C.steel, ALONG_Z, 10));
    // A collar at the back, where the piston's rod goes in.
    parts.push(cylinder(r.radius + 0.008, 0.025, [side * r.x, r.y, r.back - 0.012], C.steel, ALONG_Z, 10));
  }
  // A strap across both, sunk into them.
  parts.push(box([2 * r.x, 0.02, 0.04], [0, r.y + r.radius - 0.004, (r.front + r.back) / 2], C.steel));

  // The recoil guard: a top and a bottom rail on two struts from the cradle, bars between them, a plate at the back.
  const g = RECOIL_GUARD;
  for (const y of [g.y0, g.y1]) {
    parts.push(beam([g.x, y, g.z0 - 0.01], [g.x, y, g.z1 + 0.01], 0.012, C.steelLight, 6));
    parts.push(beam([-0.15, y * 0.8, 0.14], [g.x, y, g.z0 + 0.02], 0.012, C.steelLight, 6));
  }
  for (let i = 0; i < g.bars; i++) {
    const z = g.z0 + 0.04 + (i * (g.z1 - g.z0 - 0.08)) / (g.bars - 1);
    parts.push(beam([g.x, g.y0 - 0.006, z], [g.x, g.y1 + 0.006, z], 0.007, C.steelLight, 5));
  }
  parts.push(box([0.012, g.y1 - g.y0 + 0.02, 0.025], [g.x, (g.y0 + g.y1) / 2, g.z1 + 0.012], C.steelLight));

  // The coaxial machine gun: its receiver, barrel jacket forward into the mantlet, back plate and spade grip, feed cover, and ammunition box.
  const m = COAX;
  const midZ = (m.front + m.back) / 2;
  parts.push(box([m.width, m.height, m.back - m.front - 0.15], [m.x, m.y, midZ + 0.075], C.steel));
  parts.push(cylinder(0.022, 0.17, [m.x, m.y - 0.005, m.front + 0.085], C.steel, ALONG_Z, 8));
  parts.push(box([m.width + 0.008, m.height + 0.008, 0.012], [m.x, m.y, m.back - 0.006], C.steel));
  parts.push(box([0.016, 0.07, 0.02], [m.x, m.y - 0.065, m.back + 0.004], C.rubber));
  parts.push(box([m.width - 0.01, 0.012, 0.16], [m.x, m.y + m.height / 2 + 0.004, midZ + 0.1], C.steelLight));
  // The cocking handle on its right.
  parts.push(box([0.03, 0.012, 0.012], [m.x + m.width / 2 + 0.012, m.y + 0.01, midZ + 0.04], C.steelLight));
  // The ammunition box under its feed, on a bracket.
  parts.push(box([0.07, 0.11, 0.16], [m.x - 0.01, m.y - m.height / 2 - 0.07, midZ + 0.02], C.olive));
  parts.push(box([0.074, 0.012, 0.164], [m.x - 0.01, m.y - m.height / 2 - 0.009, midZ + 0.02], C.steel));
  return parts;
}

/** On the gun's recoiling part, gun space in battery: the recoil pistons' rods into the cylinders and the lug that joins them to the breech's top. */
export function recoilRodParts(): Part[] {
  const r = RECOIL_CYLINDERS;
  const back = 0.42;
  const parts: Part[] = [];
  for (const side of [-1, 1]) parts.push(cylinder(r.rod, back - 0.01 - r.rodFront, [side * r.x, r.y, (back - 0.01 + r.rodFront) / 2], C.bright, ALONG_Z, 8));
  parts.push(box([2 * r.x + 0.05, r.y - 0.145, 0.045], [0, (r.y + 0.145) / 2, back - 0.02], C.steel));
  return parts;
}

/**
 * Fixed to the turret, turret space: the traverse gearbox behind the
 * traverse crank and its motor on top, the turret lock's handwheel by the
 * ring, the basket's skirt round its back half, the pistol port in the left
 * wall and the interphone box on the right wall.
 */
export function turretFittingParts(): Part[] {
  const parts: Part[] = [];
  const g = TRAVERSE_GEARBOX;
  parts.push(box(g.size, g.at, C.casting));
  // Its cover plate on the gunner's side, standing proud, and bolts at its corners.
  const face = g.at[2] + g.size[2] / 2;
  parts.push(box([g.size[0] - 0.03, g.size[1] - 0.03, 0.01], [g.at[0], g.at[1], face + 0.004], C.casting));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(cylinder(0.007, 0.012, [g.at[0] + sx * (g.size[0] / 2 - 0.01), g.at[1] + sy * (g.size[1] / 2 - 0.01), face + 0.004], C.steel, ALONG_Z, 6));
  // The shaft from the crank's gearbox into it.
  parts.push(beam([0.52, 1.595, -0.58], [0.535, 1.62, g.at[2]], 0.014, C.steel, 6));
  // The motor lying along its right side: its body, cooling ribs, end cap and cable box on top.
  const m = TRAVERSE_MOTOR;
  const length = m.x1 - m.x0;
  parts.push(cylinder(m.radius, length, [(m.x0 + m.x1) / 2, m.y, m.z], C.olive, ALONG_X, 14));
  for (const k of [0.3, 0.6]) parts.push(cylinder(m.radius + 0.008, 0.016, [m.x0 + length * k, m.y, m.z], C.olive, ALONG_X, 14));
  parts.push(cylinder(m.radius - 0.012, 0.03, [m.x1 + 0.012, m.y, m.z], C.steel, [0, 0, -Math.PI / 2], 12, m.radius - 0.03));
  parts.push(box([0.06, 0.03, 0.05], [m.x0 + length * 0.75, m.y + m.radius + 0.01, m.z], C.olive));

  // The turret lock: a small handwheel on a post standing on the ring's bracket.
  const l = TURRET_LOCK;
  parts.push(box([0.06, 0.04, 0.08], [l.x, l.y - 0.07, l.z], C.casting));
  parts.push(cylinder(0.01, 0.07, [l.x, l.y - 0.03, l.z], C.steel, undefined, 6));
  const rim = new TorusGeometry(l.radius, 0.007, 4, 14);
  rim.rotateX(Math.PI / 2);
  parts.push({ geometry: rim, color: C.red, position: [l.x, l.y, l.z] });
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3;
    parts.push(beam([l.x, l.y, l.z], [l.x + Math.cos(a) * (l.radius - 0.004), l.y, l.z + Math.sin(a) * (l.radius - 0.004)], 0.005, C.red, 4));
  }

  // The basket's skirt round its back half: a thin shell of sheet steel from the floor up, a rolled edge along its top.
  const k = BASKET_SKIRT;
  const floor = TURRET.basketFloor;
  const profile = [
    new Vector2(k.radius, floor - 0.03),
    new Vector2(k.radius + k.thickness, floor - 0.03),
    new Vector2(k.radius + k.thickness, floor + k.height),
    new Vector2(k.radius, floor + k.height),
    new Vector2(k.radius, floor - 0.03),
  ];
  parts.push({ geometry: new LatheGeometry(profile, 28, -Math.PI / 2, Math.PI), color: C.basket });
  const edge = new TorusGeometry(k.radius + k.thickness / 2, 0.01, 4, 28, Math.PI);
  edge.rotateX(Math.PI / 2);
  edge.rotateY(Math.PI);
  parts.push({ geometry: edge, color: C.steelLight, position: [0, floor + k.height, 0] });

  // The pistol port in the left wall: a round plug with its locking handle.
  const p = PISTOL_PORT;
  parts.push(cylinder(p.radius, 0.04, [p.x + 0.005, p.y, p.z], C.casting, ALONG_X, 14));
  parts.push(cylinder(p.radius + 0.015, 0.016, [p.x + 0.008, p.y, p.z], C.casting, ALONG_X, 14));
  parts.push(box([0.025, 0.02, 0.12], [p.x + 0.035, p.y, p.z], C.steel));
  // The interphone's control box on the right wall, behind the ready rack and clear of the gunner's head.
  const wall = TURRET.halfWidth - HULL.wall;
  parts.push(box([0.06, 0.12, 0.09], [wall - 0.025, GUN.y + 0.04, 0.62], C.olive));
  parts.push(cylinder(0.016, 0.02, [wall - 0.062, GUN.y + 0.06, 0.62], C.rubber, ALONG_X, 8));
  parts.push(box([0.008, 0.03, 0.05], [wall - 0.058, GUN.y + 0.01, 0.62], C.ivory));
  return parts;
}

/**
 * A pedal that moves (src/sim/interior-fittings.ts PEDALS), turning about
 * X on its pivot at the origin: put it at the pivot and set `rotation.x`
 * to pedalTurn. The clutch: an arm hanging from its pivot and bending back
 * at a knee to a ribbed pad facing the driver, with the push rod's clevis
 * under the pivot (createClutchPushRod). The accelerator: a long ribbed pad rising
 * forwards from its heel, its face up and back.
 */
export function createPedal(id: PedalId): Mesh {
  const parts: Part[] = [];
  const t = PEDALS.padThickness;
  // A pad `length` long and `width` wide with its middle at `at`, facing (0, cos tilt, sin tilt), with grip ribs across it standing 4 mm proud.
  const pad = (width: number, length: number, at: Vec3, tilt: number): void => {
    parts.push(box([width, t, length], at, C.steel, [tilt, 0, 0]));
    const n = [Math.cos(tilt), Math.sin(tilt)];
    const along = [Math.sin(tilt), -Math.cos(tilt)];
    for (let k = -2; k <= 2; k++) {
      const d = (k * length) / 5.5;
      parts.push(box([width - 0.012, t, 0.008], [at[0], at[1] + n[0] * 0.004 + along[0] * d, at[2] + n[1] * 0.004 + along[1] * d], C.rubber, [tilt, 0, 0]));
    }
  };
  if (id === 'clutch') {
    const c = PEDALS.clutch;
    // The arm's boss on the pivot, the arm dropping to its knee and bending back to the pad, meeting the pad's back,
    // and the push rod's clevis on its front just under the pivot.
    const n = [Math.cos(c.padTilt), Math.sin(c.padTilt)];
    parts.push(cylinder(0.016, 2 * PEDAL_BOX.cheekGap - 0.004, [0, 0, 0], C.steel, ALONG_X, 8));
    parts.push(beam([0, 0, 0], [0, c.knee[0], c.knee[1]], 0.012, C.steel, 6));
    parts.push(beam([0, c.knee[0], c.knee[1]], [0, c.pad[0] - n[0] * 0.006, c.pad[1] - n[1] * 0.006], 0.011, C.steel, 6));
    parts.push(cylinder(0.012, 0.012, [0, c.knee[0], c.knee[1]], C.steel, ALONG_X, 8));
    parts.push(box([0.026, 0.02, 0.022], [0, -c.clevis, -0.012], C.steel));
    pad(c.width, c.length, [0, c.pad[0] + n[0] * 0.004, c.pad[1] + n[1] * 0.004], c.padTilt);
  } else {
    const a = PEDALS.accelerator;
    // The heel's barrel on the hinge, and the pad rising forwards from it, its face up and back.
    parts.push(cylinder(0.011, a.width - 0.004, [0, 0, 0], C.steel, ALONG_X, 8));
    const mid = a.length / 2;
    const lift = ACCELERATOR_PAD_LIFT;
    pad(a.width, a.length, [0, Math.sin(a.rise) * mid + Math.cos(a.rise) * lift, -Math.cos(a.rise) * mid + Math.sin(a.rise) * lift], a.rise);
  }
  const mesh = new Mesh(mergeParts(parts, interiorFinish), material);
  mesh.name = id === 'clutch' ? 'Clutch Pedal' : 'Accelerator Pedal';
  return mesh;
}

/**
 * The clutch's push rod, from the clevis on the pedal's arm forwards into
 * the master cylinder, along -Z from the origin: hang it on the pedal at
 * the clevis and turn it back by the pedal's turn, so it stays level and
 * slides in and out of the cylinder as the pedal moves.
 */
export function createClutchPushRod(): Mesh {
  const { from, length } = CLUTCH_PUSH_ROD;
  const parts: Part[] = [
    cylinder(CLUTCH_MASTER.rod, length, [0, 0, -from - length / 2], C.bright, ALONG_Z, 6),
    cylinder(0.008, 0.03, [0, 0, -0.012], C.steel, ALONG_X, 6),
  ];
  const mesh = new Mesh(mergeParts(parts, interiorFinish), material);
  mesh.name = 'Clutch Push Rod';
  return mesh;
}
