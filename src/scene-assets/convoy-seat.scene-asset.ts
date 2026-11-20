import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { SEATS } from '../sim/cabin.js';
import { CONVOY_GRIP, CONVOY_GRIP_OFFSET, CONVOY_MOVE, SEAT_LEVER_BRACKET, SEAT_LEVER_FROM_CUSHION } from '../sim/convoy-seat.js';
import { litInside } from './cabin-light.js';
import { interiorFinish } from './finish.js';
import { beam, mergeParts, type Part } from './lowpoly.js';

const LEATHER = 0x5a3d26;
const STEEL = 0x3c3d3f;
const STEEL_LIGHT = 0x55595e;
const RUBBER = 0x1c1c1c;

const material = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }), { finish: true });

/** The name of the driver's seat's moving part (SeatSystem's convoy position moves it up and back by CONVOY_MOVE). */
export const DRIVER_SEAT_NAME = 'Driver Seat';

/**
 * A crewman's seat in its frame, its cushion's top's middle at (x, top, z),
 * the front towards -Z: a leather cushion with a rolled front edge on a
 * steel pan, and a padded backrest on a steel back plate held up on two
 * stays from the pan. Shared by the driver's seat and the cabin's others.
 */
export function seatShellParts(x: number, top: number, z: number): Part[] {
  const parts: Part[] = [
    { geometry: new BoxGeometry(0.42, 0.07, 0.38), color: LEATHER, position: [x, top - 0.035, z + 0.01] },
    { geometry: new CylinderGeometry(0.035, 0.035, 0.42, 10, 1), color: LEATHER, position: [x, top - 0.035, z - 0.18], rotation: [0, 0, Math.PI / 2] },
    { geometry: new BoxGeometry(0.45, 0.025, 0.43), color: STEEL, position: [x, top - 0.0825, z] },
    { geometry: new BoxGeometry(0.4, 0.4, 0.06), color: LEATHER, position: [x, top + 0.26, z + 0.235] },
    { geometry: new BoxGeometry(0.42, 0.43, 0.014), color: STEEL, position: [x, top + 0.255, z + 0.272] },
  ];
  // The backrest's padding in two rolls across, standing proud of it.
  for (const dy of [0.12, 0.38]) parts.push({ geometry: new CylinderGeometry(0.03, 0.03, 0.38, 10, 1), color: LEATHER, position: [x, top + dy, z + 0.215], rotation: [0, 0, Math.PI / 2] });
  for (const side of [-1, 1]) parts.push(beam([x + side * 0.17, top - 0.09, z + 0.18], [x + side * 0.17, top + 0.1, z + 0.282], 0.012, STEEL, 6));
  return parts;
}

/** The way the seat rides up its column, a unit vector (hull space): up and back to the convoy position. */
const RISE = (() => {
  const length = Math.hypot(CONVOY_MOVE[0], CONVOY_MOVE[1], CONVOY_MOVE[2]);
  return { x: CONVOY_MOVE[0] / length, y: CONVOY_MOVE[1] / length, z: CONVOY_MOVE[2] / length, length };
})();

/** Where the seat's column meets the cushion's underside, seat down, hull space. */
function columnTop(): [number, number, number] {
  const [x, top, z] = SEATS.driver.cushion;
  return [x, top - 0.08, z + 0.05];
}

/**
 * The fixed part of the driver's seat, merged into the hull: a sleeve from
 * the floor, leaning back the way the seat rises, that the seat's column
 * slides in.
 */
export function driverSeatBaseParts(): Part[] {
  const top = columnTop();
  const floorY = SEATS.driver.floorY;
  const down = (top[1] - floorY) / RISE.y;
  const foot = [top[0] - RISE.x * down, floorY - 0.01, top[2] - RISE.z * down];
  const sleeveTop = [top[0] - RISE.x * 0.02 / RISE.y, top[1] - 0.02, top[2] - RISE.z * 0.02 / RISE.y];
  return [beam(foot, sleeveTop, 0.034, STEEL, 8), { geometry: new BoxGeometry(0.16, 0.012, 0.16), color: STEEL, position: [foot[0], floorY + 0.006, foot[2]] }];
}

/**
 * The driver's seat that moves: the cushion, its back, the column under it
 * and the seat lever's bracket and hinge on the cushion's right, seat down
 * (ConvoySeatSystem hangs the lever on the hinge). In the convoy position SeatSystem moves it by CONVOY_MOVE;
 * the column then still reaches into the sleeve.
 */
export function createDriverSeat(): Mesh {
  const [x, top, z] = SEATS.driver.cushion;
  const c = columnTop();
  const reach = RISE.length + 0.05;
  const parts: Part[] = [
    ...seatShellParts(x, top, z),
    beam(c, [c[0] - RISE.x * reach, c[1] - RISE.y * reach, c[2] - RISE.z * reach], 0.024, STEEL_LIGHT, 8),
  ];
  // The seat lever's bracket (John's headset note, 20 November 2026: the lever looked as if it floated beside the seat):
  // a plate bolted along the seat pan's side, with an arm rising from it to the lever's pivot, and the boss the lever
  // turns in, from the plate out round the lever's foot, with the pivot's pin and nut through it.
  const b = SEAT_LEVER_BRACKET;
  const [px, py, pz] = [x + SEAT_LEVER_FROM_CUSHION[0], top + SEAT_LEVER_FROM_CUSHION[1], z + SEAT_LEVER_FROM_CUSHION[2]];
  const plateX = x + b.from + b.thickness / 2;
  const strapTop = top - b.strapTop;
  const strapBottom = top - b.strapBottom;
  parts.push({ geometry: new BoxGeometry(b.thickness, strapTop - strapBottom, b.strapBack - b.strapFront), color: STEEL, position: [plateX, (strapTop + strapBottom) / 2, z + (b.strapFront + b.strapBack) / 2] });
  parts.push({ geometry: new BoxGeometry(b.thickness, py + b.armAbove - strapBottom, b.armDepth), color: STEEL, position: [plateX, (py + b.armAbove + strapBottom) / 2, pz] });
  for (const dz of [b.strapFront + 0.025, b.strapBack - 0.025]) {
    parts.push({ geometry: new CylinderGeometry(0.007, 0.007, 0.012, 6, 1), color: STEEL_LIGHT, position: [x + b.from + b.thickness, (strapTop + strapBottom) / 2, z + dz], rotation: [0, 0, Math.PI / 2] });
  }
  const bossFrom = x + b.from + b.thickness - 0.002;
  const bossTo = px + 0.0225;
  parts.push({ geometry: new CylinderGeometry(0.016, 0.016, bossTo - bossFrom, 8, 1), color: STEEL_LIGHT, position: [(bossFrom + bossTo) / 2, py, pz], rotation: [0, 0, Math.PI / 2] });
  parts.push({ geometry: new CylinderGeometry(0.0105, 0.0105, 0.008, 6, 1), color: STEEL, position: [bossTo + 0.004, py, pz], rotation: [0, 0, Math.PI / 2] });
  const mesh = new Mesh(mergeParts(parts, interiorFinish), material);
  mesh.name = DRIVER_SEAT_NAME;
  return mesh;
}

/**
 * A convoy grip (docs/convoy-seat.md): a rod from a lever's handle top, up
 * and back to an upright rubber grip where a raised driver's hand rests. The
 * origin is the handle's top; it moves with the handle without turning
 * (DriverStationSystem places it).
 */
export function createConvoyGrip(): Mesh {
  const o = CONVOY_GRIP_OFFSET;
  const g = CONVOY_GRIP.gripLength;
  const bottom = [o[0], o[1] - g, o[2]];
  const parts: Part[] = [
    // A clamp over the handle's cap, wider than it so their faces don't meet.
    { geometry: new CylinderGeometry(0.03, 0.03, 0.03, 8, 1), color: STEEL, position: [0, 0.019, 0] },
    beam([0, 0.03, 0], [bottom[0], bottom[1] + 0.01, bottom[2]], CONVOY_GRIP.rodRadius, STEEL_LIGHT, 6),
    { geometry: new CylinderGeometry(CONVOY_GRIP.radius, CONVOY_GRIP.radius, g, 8, 1), color: RUBBER, position: [o[0], o[1] - g / 2, o[2]] },
    { geometry: new CylinderGeometry(CONVOY_GRIP.radius + 0.004, CONVOY_GRIP.radius + 0.006, 0.014, 8, 1), color: STEEL, position: [o[0], o[1] + 0.004, o[2]] },
  ];
  const mesh = new Mesh(mergeParts(parts, interiorFinish), material);
  mesh.name = 'Convoy Grip';
  return mesh;
}
