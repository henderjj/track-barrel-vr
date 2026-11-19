import { Bone, BufferGeometry, Quaternion, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { CREW_COLORS } from '../src/scene-assets/avatar.scene-asset.js';
import { Crewman } from '../src/scene-assets/crewman.js';
import {
  CREWMAN_BONES,
  CREWMAN_COLORS,
  CREWMAN_EYES,
  CREWMAN_FLOOR,
  createCrewmanBones,
  crewmanGeometry,
  crewmanHeadgearGeometry,
} from '../src/scene-assets/crewman.scene-asset.js';
import { hipPoint, SEATS } from '../src/sim/cabin.js';
import { createSeatedBody, NECK_BASE, solveSeatedBody, TORSO_LENGTH } from '../src/sim/seated-body.js';

/**
 * The low-poly crewman (F6.3c, docs/crew-avatars.md): light enough to draw
 * on a Quest 3 without a download, skinned to the bones src/scene-assets/
 * crewman.ts poses, made to the seats' sizes, and the same in both realms.
 */
describe('low-poly crewman (F6.3c)', () => {
  const body = crewmanGeometry(CREW_COLORS[0]);
  const headgear = crewmanHeadgearGeometry();
  const triangles = (g: BufferGeometry) => g.getAttribute('position').count / 3;

  it('is light: under 4,000 triangles, body and headgear, and no textures', () => {
    expect(triangles(body) + triangles(headgear)).toBeLessThan(4000);
    expect(triangles(headgear)).toBeLessThan(800);
  });

  it('is skinned to its own bones, every vertex wholly', () => {
    const index = body.getAttribute('skinIndex');
    const weight = body.getAttribute('skinWeight');
    for (let i = 0; i < index.count; i++) {
      for (let k = 0; k < 4; k++) expect(index.getComponent(i, k)).toBeLessThan(CREWMAN_BONES.length);
      expect(weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i)).toBeCloseTo(1, 6);
    }
    for (const name of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head']) expect(CREWMAN_BONES).toContain(name);
    for (const s of ['l', 'r']) {
      for (const b of ['upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball']) expect(CREWMAN_BONES).toContain(`${b}_${s}`);
    }
    const bones = createCrewmanBones();
    expect(bones.map((b) => b.name)).toEqual(CREWMAN_BONES);
    expect(bones.slice(1).every((b) => b.parent instanceof Bone)).toBe(true);
  });

  it('is made to the seats: eyes 71 cm over the hips, the neck\'s base where the seated body puts it, boots on the floor', () => {
    const hip = hipPoint(SEATS.driver, [0, 0, 0]);
    expect(CREWMAN_EYES[1]).toBeCloseTo(SEATS.driver.eye[1] - hip[1], 2);
    expect(CREWMAN_FLOOR).toBeCloseTo(SEATS.driver.floorY - hip[1], 6);
    const bones = createCrewmanBones();
    bones[0].updateMatrixWorld(true);
    const neck = bones[CREWMAN_BONES.indexOf('neck_01')].getWorldPosition(new Vector3());
    // The neck's base under the eyes as the seated body has it (facing +Z here, so its back is -Z).
    expect(neck.y).toBeCloseTo(CREWMAN_EYES[1] + NECK_BASE[1], 1);
    expect(neck.z).toBeCloseTo(CREWMAN_EYES[2] - NECK_BASE[2], 1);
    expect(neck.length()).toBeCloseTo(TORSO_LENGTH, 1);
    const pos = body.getAttribute('position');
    let lowest = Infinity;
    for (let i = 0; i < pos.count; i++) lowest = Math.min(lowest, pos.getY(i));
    expect(lowest).toBeGreaterThan(CREWMAN_FLOOR - 0.001);
    expect(lowest).toBeLessThan(CREWMAN_FLOOR + 0.01);
  });

  it('builds the same every time, and the crew colour changes only the neckerchief', () => {
    const again = crewmanGeometry(CREW_COLORS[0]);
    expect(Array.from(again.getAttribute('position').array)).toEqual(Array.from(body.getAttribute('position').array));
    const other = crewmanGeometry(CREW_COLORS[1]);
    const a = body.getAttribute('color').array;
    const b = other.getAttribute('color').array;
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(changed / 3).toBeLessThan(200);
    expect(Object.keys(CREWMAN_COLORS).length).toBeGreaterThan(10);
  });

  it('poses in its seat: hips on the hip point, the spine to the neck\'s base, leaning in to a sight', () => {
    const crew = new Crewman(CREW_COLORS[0], 0);
    expect(crew.body.name).toBe('Crew 1 Body');
    expect(crew.head.name).toBe('Crew 1 Head');
    const seat = SEATS.gunner;
    const hip = hipPoint(seat, [0, 0, 0]);
    for (const lean of [0, 0.12]) {
      const eye = new Vector3(seat.eye[0], seat.eye[1] - lean * 0.3, seat.eye[2] - lean);
      const turn = new Quaternion();
      const seated = solveSeatedBody(eye.toArray(), [0, 0, 0, 1], hip, 0, 0, createSeatedBody());
      crew.pose(hip, hip[1] - seat.floorY, 0, eye, turn, seated);
      crew.reach('left', null, null);
      crew.reach('right', null, null);
      expect(crew.boneWorld('pelvis', new Vector3()).distanceTo(new Vector3(...hip))).toBeLessThan(0.01);
      expect(crew.boneWorld('neck_01', new Vector3()).distanceTo(new Vector3(...seated.neckFrom))).toBeLessThan(0.02);
    }
  });
});
