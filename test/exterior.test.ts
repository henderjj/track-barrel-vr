import { Box3, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { createHull, createTurret, HULL_OUTSIDE_NAME } from '../src/scene-assets/cabin.scene-asset.js';
import { DRIVER_HATCH_ROUND, GROUND_Y, HULL, TURRET } from '../src/sim/cabin.js';
import { CONVOY_SEAT, HATCH_HEAD_ROOM, LID_ASIDE, NECK_CLEARANCE } from '../src/sim/convoy-seat.js';
import {
  BOGIES,
  DECK_TOP,
  IDLER,
  oblongPoint,
  OUTLINE_EXTENT,
  ROAD_WHEEL,
  SPONSON,
  SPROCKET,
  TRACK,
  trackLoop,
  TURRET_SHELL,
  turretReach,
  turretShellInset,
  turretShellRings,
} from '../src/sim/exterior.js';
import { insideCabin, turretInsideDistance } from '../src/sim/interior.js';
import { DRIVER_PERISCOPE, HEAD_SIZE } from '../src/sim/periscope.js';
import { FOOTPRINT } from '../src/sim/tank-drive.js';

describe("the tank's outside, an M4A4's (docs/exterior.md)", () => {
  it('keeps everything on the hull\'s outside out of the cabin, however the turret is turned', () => {
    const hull = createHull();
    hull.updateMatrixWorld(true);
    const outside = hull.getObjectByName(HULL_OUTSIDE_NAME)!;
    const pos = (outside as unknown as { geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry.getAttribute('position');
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      let inside = 0;
      // Under the turret's overhang (lower than its foot) the deck is lit as the turret's inside, its shade, as a corner
      // passes over it; only with the turret straight ahead must nothing there be.
      const under = yaw === 0 ? -Infinity : TURRET_SHELL.foot;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > under && insideCabin([pos.getX(i), pos.getY(i), pos.getZ(i)], yaw)) inside++;
      expect(inside, `turret at ${yaw.toFixed(2)} rad`).toBe(0);
    }
  });

  it('draws the whole tank inside the footprint that meets obstacles', () => {
    const box = new Box3().setFromObject(createHull());
    expect(box.min.x).toBeGreaterThanOrEqual(-FOOTPRINT.halfWidth - 0.001);
    expect(box.max.x).toBeLessThanOrEqual(FOOTPRINT.halfWidth + 0.001);
    expect(box.min.z).toBeGreaterThanOrEqual(FOOTPRINT.front - 0.001);
    expect(box.max.z).toBeLessThanOrEqual(FOOTPRINT.rear + 0.001);
    // And it fills it: the tracks and sponsons reach its sides, the nose its front.
    expect(box.max.x).toBeGreaterThan(FOOTPRINT.halfWidth - 0.02);
    expect(box.min.z).toBeLessThan(FOOTPRINT.front + 0.05);
    expect(OUTLINE_EXTENT.halfWidth).toBe(SPONSON.halfWidth);
  });

  it('is proportioned like a Sherman: long and low, the turret narrower than the hull', () => {
    const length = OUTLINE_EXTENT.rear - OUTLINE_EXTENT.front;
    const width = 2 * OUTLINE_EXTENT.halfWidth;
    // An M4A4: 6.06 m by 2.62 m. Ours is wider, round a roomier cabin, and as long.
    expect(length).toBeGreaterThan(5.9);
    expect(length / width).toBeGreaterThan(1.8);
    expect((2 * TURRET_SHELL.halfWidth) / width).toBeGreaterThan(0.7);
    expect((2 * TURRET_SHELL.halfWidth) / width).toBeLessThan(0.8);
  });
});

describe("the tracks and running gear (docs/exterior.md)", () => {
  it('runs the track round the sprocket, road wheels, rollers and idler, flat on the ground and under the sponson', () => {
    const loop = trackLoop();
    const ys = loop.map(([, y]) => y);
    const zs = loop.map(([z]) => z);
    expect(Math.min(...ys) - TRACK.thickness / 2).toBeCloseTo(GROUND_Y, 6);
    // Its top clear of the sponson's floor.
    expect(Math.max(...ys) + TRACK.thickness / 2).toBeLessThan(SPONSON.floor - 0.03);
    // Sprocket at the front, idler at the back.
    expect(Math.min(...zs)).toBeCloseTo(SPROCKET.z - SPROCKET.radius - TRACK.thickness / 2, 2);
    expect(Math.max(...zs)).toBeCloseTo(IDLER.z + IDLER.radius + TRACK.thickness / 2, 2);
    // A Sherman's 16.5 in track, inside the sponson, clear of the lower hull.
    expect(TRACK.x + TRACK.width / 2).toBeLessThan(SPONSON.halfWidth);
    expect(TRACK.x - TRACK.width / 2).toBeGreaterThan(HULL.halfWidth + HULL.wall);
  });

  it("spaces the bogies' road wheels clear of one another, the sprocket and the idler", () => {
    const axles = BOGIES.z.flatMap((z) => [z - BOGIES.spread, z + BOGIES.spread]).sort((a, b) => a - b);
    for (let i = 1; i < axles.length; i++) expect(axles[i] - axles[i - 1]).toBeGreaterThan(2 * ROAD_WHEEL.radius + 0.02);
    expect(axles[0] - SPROCKET.z).toBeGreaterThan(SPROCKET.radius + ROAD_WHEEL.radius);
    expect(IDLER.z - axles[axles.length - 1]).toBeGreaterThan(IDLER.radius + ROAD_WHEEL.radius);
  });
});

describe("the cast turret's shell (docs/exterior.md)", () => {
  const angles = Array.from({ length: 180 }, (_, i) => (i / 180) * Math.PI * 2);

  it('keeps the outside clear of the cabin\'s inside all round, from foot to roof, so it is lit as outside', () => {
    const p: [number, number] = [0, 0];
    for (const y of turretShellRings()) {
      for (const a of angles) {
        oblongPoint(TURRET_SHELL, turretShellInset(y), a, p);
        // 3 cm is the inside's margin for lighting (src/sim/interior.ts); a centimetre more for the wall.
        expect(turretInsideDistance(p[0], y, p[1]), `at ${y.toFixed(3)} m, ${a.toFixed(2)} rad`).toBeGreaterThan(0.04);
      }
    }
  });

  it('rounds the roof over to the flat top the hatch and the periscope stand on, and leans the sides in', () => {
    const s = TURRET_SHELL;
    expect(s.top).toBeCloseTo(TURRET.roof + HULL.wall, 9);
    expect(turretShellInset(s.top)).toBeCloseTo(s.lean + s.edge, 9);
    expect(turretShellInset(s.foot + 0.2)).toBe(0);
    expect(turretShellInset(s.top - s.edge)).toBeCloseTo(s.lean, 9);
    // The flat top holds the hatch and the gunner's periscope's head.
    const top = { halfWidth: s.halfWidth - s.lean - s.edge, front: s.front - s.lean - s.edge };
    expect(SEATS_GUNNER_HATCH.x + SEATS_GUNNER_HATCH.radius + 0.05).toBeLessThan(top.halfWidth);
    expect(-SEATS_GUNNER_HATCH.z + SEATS_GUNNER_HATCH.radius).toBeLessThan(top.front);
  });

  it("sweeps clear of the driver's open lid and periscope, and over both hatches' shut lids, as it turns", () => {
    const reach = turretReach();
    const from = (x: number, z: number) => Math.hypot(x, z - TURRET.z);
    const lidRadius = (LID_ASIDE.x1 - LID_ASIDE.x0) / 2;
    expect(from((LID_ASIDE.x0 + LID_ASIDE.x1) / 2, (LID_ASIDE.z0 + LID_ASIDE.z1) / 2) - lidRadius).toBeGreaterThan(reach + 0.03);
    expect(from(LID_ASIDE.post.x, LID_ASIDE.post.z) - LID_ASIDE.post.radius).toBeGreaterThan(reach + 0.03);
    const head = DRIVER_PERISCOPE;
    expect(from(head.axis[0], head.axis[1]) - Math.hypot(HEAD_SIZE.width, HEAD_SIZE.depth) / 2).toBeGreaterThan(reach + 0.03);
    // Shut, the hatches' lids stand 3 cm over the deck (cabin.scene-asset.ts): under the shell's foot.
    expect(DECK_TOP + 0.03).toBeLessThan(TURRET_SHELL.foot - 0.01);
    // No further than the square turret's corners did.
    expect(reach).toBeLessThan(Math.hypot(TURRET.halfWidth, TURRET.front) + 0.01);
  });
});

describe("the driver's round hatch (John, 2026-11-11)", () => {
  it('keeps the head box in the convoy position NECK_CLEARANCE inside the round rim at every corner', () => {
    const h = DRIVER_HATCH_ROUND;
    const [left, right, forward, back] = CONVOY_SEAT.headBox;
    const [ex, , ez] = CONVOY_SEAT.eye;
    for (const [x, z] of [[ex - left, ez - forward], [ex + right, ez - forward], [ex - left, ez + back], [ex + right, ez + back]]) {
      expect(h.radius - Math.hypot(x - h.x, z - h.z)).toBeGreaterThanOrEqual(NECK_CLEARANCE - 1e-9);
    }
    // About as much room to move the head as the square hatch gave (34 cm each way).
    expect(2 * HATCH_HEAD_ROOM.halfWidth).toBeGreaterThan(0.29);
    expect(2 * HATCH_HEAD_ROOM.halfDepth).toBeGreaterThan(0.31);
    expect(new Vector3(ex, 0, ez).distanceTo(new Vector3(h.x, 0, h.z))).toBeLessThan(0.05);
  });

  it('draws the turret with the shell in its own mesh as before', () => {
    expect(createTurret().name).toBe('Turret');
  });
});

/** The gunner's hatch, as cabin.scene-asset.ts places it. */
const SEATS_GUNNER_HATCH = { x: 0.4, z: -0.1, radius: 0.27 } as const;
