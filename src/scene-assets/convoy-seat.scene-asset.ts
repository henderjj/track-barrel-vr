import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { SEATS } from '../sim/cabin.js';
import { CONVOY_GRIP, CONVOY_GRIP_OFFSET, CONVOY_MOVE, SEAT_LEVER_BRACKET, SEAT_LEVER_FROM_CUSHION } from '../sim/convoy-seat.js';
import { litInside } from './cabin-light.js';
import { beam, mergeParts, type Part } from './lowpoly.js';

const LEATHER = 0x5a3d26;
const STEEL = 0x3c3d3f;
const STEEL_LIGHT = 0x55595e;
const RUBBER = 0x1c1c1c;

const material = litInside(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }));

/** The name of the driver's seat's moving part (SeatSystem's convoy position moves it up and back by CONVOY_MOVE). */
export const DRIVER_SEAT_NAME = 'Driver Seat';

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
    { geometry: new BoxGeometry(0.44, 0.08, 0.42), color: LEATHER, position: [x, top - 0.04, z] },
    { geometry: new BoxGeometry(0.44, 0.5, 0.07), color: LEATHER, position: [x, top + 0.25 - 0.02, z + 0.245] },
    beam(c, [c[0] - RISE.x * reach, c[1] - RISE.y * reach, c[2] - RISE.z * reach], 0.024, STEEL_LIGHT, 8),
  ];
  // The seat lever's bracket, out from the cushion's side, and the hinge it turns on, across the seat.
  const b = SEAT_LEVER_BRACKET;
  const [px, py, pz] = [x + SEAT_LEVER_FROM_CUSHION[0], top + SEAT_LEVER_FROM_CUSHION[1], z + SEAT_LEVER_FROM_CUSHION[2]];
  parts.push({ geometry: new BoxGeometry(b.to - b.from, b.height, b.depth), color: STEEL, position: [x + (b.from + b.to) / 2, py, pz] });
  parts.push({ geometry: new CylinderGeometry(0.016, 0.016, 0.045, 8, 1), color: STEEL_LIGHT, position: [px, py, pz], rotation: [0, 0, Math.PI / 2] });
  const mesh = new Mesh(mergeParts(parts), material);
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
  const mesh = new Mesh(mergeParts(parts), material);
  mesh.name = 'Convoy Grip';
  return mesh;
}
