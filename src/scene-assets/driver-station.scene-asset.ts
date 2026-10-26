import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { mergeParts, type Part } from './lowpoly.js';
import { HULL, VISION_SLIT } from '../sim/cabin.js';
import {
  DRIVER_CONTROLS,
  GEAR_ANGLES,
  GEARBOX,
  PANEL,
  panelToHull,
  SLIT_FRAME,
  THROTTLE_QUADRANT,
  TILLER_PEDESTAL,
} from '../sim/driver-station.js';
import { HIGH, LOW } from '../sim/tank-drive.js';

/**
 * The driver's station (F1.5, docs/driver-station.md), the parts that
 * don't move: the tillers' pedestals, the gear lever's gate on the
 * gearbox's hump, the hand throttle's quadrant on the left wall, the
 * instrument panel's housing under the slit, and the slit's frame and brow
 * pad. They are merged into the hull's mesh (cabin.scene-asset.ts). The
 * levers are the mechanism kit's (`createLever`, mechanism.scene-asset.ts)
 * and the needles are drawn here; DriverStationSystem places and turns them
 * and draws the dials' faces. Sizes from src/sim/driver-station.ts.
 */

const OLIVE_DARK = 0x4a4a32;
const STEEL = 0x3c3d3f;
const STEEL_LIGHT = 0x5b5d60;
const FRAME = 0x2b2e2a;
const LEATHER = 0x5a3d26;
/** The gate's marks: low range green, high range yellow. */
const LOW_MARK = 0x4f8a3a;
const HIGH_MARK = 0xc8a030;
const NEEDLE = 0xf08a24;

/** The dials' face floats this far in front of the panel's housing, and the needles this far in front of the face, m. */
export const FACE_GAP = 0.006;
export const NEEDLE_GAP = 0.004;
/**
 * Slot plates and marks stand this far proud of what they sit on, m: the
 * hull is also checked from outside, where faces need 8 mm between them (9 here, clear of rounding)
 * (test/z-fighting.test.ts).
 */
const PROUD = 0.009;
/** A needle's length from its dial's middle, m. */
const NEEDLE_LENGTH = 0.04;

function box(size: readonly [number, number, number], position: readonly [number, number, number], color: number): Part {
  return { geometry: new BoxGeometry(...size), color, position };
}

/** Everything of the station fixed to the hull, in hull space, for the hull's mesh. */
export function driverStationParts(): Part[] {
  const parts: Part[] = [];
  const p = TILLER_PEDESTAL;
  // The tillers stand on pedestals from the floor, their pivots inside the top, a slot plate half sunk in it.
  for (const id of ['tillerLeft', 'tillerRight'] as const) {
    const [x, y, z] = DRIVER_CONTROLS[id].pivot;
    const top = y + p.above;
    parts.push(box([2 * p.halfWidth, top + 0.01, p.depth], [x, (top - 0.01) / 2, z], OLIVE_DARK));
    parts.push(box([0.035, PROUD * 2, p.depth - 0.03], [x, top, z], FRAME));
  }
  // The gear lever's gate on the hump, with a mark behind it for low and one ahead for high.
  const [gx, gy, gz] = DRIVER_CONTROLS.gear.pivot;
  parts.push(box([0.05, PROUD * 2, 0.2], [gx, gy, gz], FRAME));
  const reach = 0.075;
  parts.push(box([0.02, PROUD * 2.5, 0.02], [gx + 0.045, gy, gz + Math.sin(-GEAR_ANGLES[LOW]) * reach], LOW_MARK));
  parts.push(box([0.02, PROUD * 2.5, 0.02], [gx + 0.045, gy, gz - Math.sin(GEAR_ANGLES[HIGH]) * reach], HIGH_MARK));
  // The hand throttle's quadrant, sunk 1 cm into the left wall, its pivot inside the top.
  const [tx, ty, tz] = DRIVER_CONTROLS.throttle.pivot;
  const q = THROTTLE_QUADRANT;
  const qTop = ty + 0.02;
  const wall = -HULL.halfWidth - 0.01;
  const qRight = tx + q.halfWidth;
  parts.push(box([qRight - wall, q.height, q.depth], [(qRight + wall) / 2, qTop - q.height / 2, tz], OLIVE_DARK));
  parts.push(box([0.03, PROUD * 2, q.depth - 0.04], [tx, qTop, tz], FRAME));

  // The instrument panel's housing, its face FACE_GAP behind the dials' face.
  const housing: [number, number, number] = [0, 0, 0];
  const depth = 0.05;
  panelToHull([0, 0, -FACE_GAP - depth / 2], housing);
  parts.push({
    geometry: new BoxGeometry(PANEL.width + 0.03, PANEL.height + 0.03, depth),
    color: STEEL_LIGHT,
    position: housing,
    rotation: [-PANEL.tilt, 0, 0],
  });

  // The vision slit's frame: four bars round the opening, back from its edges, and a brow pad over it.
  const s = VISION_SLIT;
  const f = SLIT_FRAME;
  const back = HULL.front - 0.005;
  const zMid = (back + HULL.front + f.depth) / 2;
  const zLen = HULL.front + f.depth - back;
  const halfW = s.width / 2 + f.inset;
  const halfH = s.height / 2 + f.inset;
  parts.push(box([2 * (halfW + f.bar), f.bar, zLen], [s.x, s.y + halfH + f.bar / 2, zMid], STEEL));
  parts.push(box([2 * (halfW + f.bar), f.bar, zLen], [s.x, s.y - halfH - f.bar / 2, zMid], STEEL));
  for (const side of [-1, 1]) {
    // Between the top and bottom bars, ending inside them.
    // A little narrower than the bars' ends, so their outer faces don't share a plane.
    parts.push(box([f.bar - 0.004, 2 * halfH + 0.01, zLen - 0.004], [s.x + side * (halfW + (f.bar - 0.004) / 2), s.y, zMid - 0.002], STEEL));
  }
  const padBottom = s.y + s.height / 2 + f.padAbove;
  parts.push(box([s.width + 0.12, f.padHeight, f.padDepth], [s.x, padBottom + f.padHeight / 2, back + f.padDepth / 2], LEATHER));
  return parts;
}

const needleMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/**
 * A gauge's needle, pointing straight up from its dial's middle at the
 * origin, NEEDLE_GAP in front of the face (+Z), with a hub. Turn it with
 * `rotation.z` (negative is clockwise, as a needle sweeps).
 */
export function createNeedle(): Mesh {
  const mesh = new Mesh(mergeParts([
    box([0.004, NEEDLE_LENGTH, 0.002], [0, NEEDLE_LENGTH / 2 - 0.006, NEEDLE_GAP], NEEDLE),
    // The hub stands 4 mm proud of the needle on both faces.
    { geometry: new CylinderGeometry(0.006, 0.006, 0.01, 8, 1), color: STEEL, position: [0, 0, NEEDLE_GAP], rotation: [Math.PI / 2, 0, 0] },
  ]), needleMaterial);
  mesh.name = 'Gauge Needle';
  return mesh;
}
