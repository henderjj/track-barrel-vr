import { type BufferGeometry, Mesh, MeshLambertMaterial, type Object3D } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import * as avatar from '../src/scene-assets/avatar.scene-asset.js';
import * as cabin from '../src/scene-assets/cabin.scene-asset.js';
import * as sight from '../src/scene-assets/sight.scene-asset.js';
import { TURRET } from '../src/sim/cabin.js';
import { SIGHT_STAND } from '../src/sim/sight.js';
import { coplanarOverlaps, describeOverlaps, trianglesOf } from './support/coplanar.js';

/**
 * Z-fighting: two differently coloured faces facing the same way, in (nearly)
 * the same plane and overlapping, flicker through each other in the headset
 * as the head moves (in the game this template came from, a crate's edges,
 * a hatch's edges and a jetty's root all did). Keep faces like that at least this
 * far apart: 3 mm in and around the tank (seen from 0.3 to 3 m), 8 mm out in
 * the world (seen from 5 m and further). Docs: docs/testing.md#z-fighting.
 */
const CABIN_GAP = 0.003;
const WORLD_GAP = 0.008;

const material = new MeshLambertMaterial({ vertexColors: true });
function mesh(geometry: BufferGeometry, name: string): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  return m;
}

function expectNone(objects: Object3D[], gap: number): void {
  const found = coplanarOverlaps(objects.flatMap((o) => trianglesOf(o)), gap, 2e-5);
  expect(found.length, `faces sharing a plane:\n${describeOverlaps(found)}`).toBe(0);
}

describe('no faces that flicker through each other (z-fighting)', () => {
  // Add every new model here: static scenery with what stands on it, and
  // each moving part in each of the poses it is drawn in.
  it('in the tank: hull, and the turret facing every way it turns', () => {
    const hull = cabin.createHull();
    expectNone([hull], CABIN_GAP);
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const turret = cabin.createTurret();
      turret.position.set(0, 0, TURRET.z);
      turret.rotation.y = yaw;
      turret.updateMatrixWorld(true);
      expectNone([hull, turret], CABIN_GAP);
    }
  });

  it('on the ground', () => {
    expectNone([cabin.createGround(), cabin.createHull()], WORLD_GAP);
  });

  it("on spike S1's sight, hanging in the turret and aimed, and its range", () => {
    const stand = sight.createSightStand();
    stand.position.set(SIGHT_STAND.x, 0, SIGHT_STAND.z);
    const lens = mesh(sight.createSightLensGeometry(), 'Sight Lens');
    const turret = cabin.createTurret();
    turret.position.set(0, 0, TURRET.z);
    for (const [pitch, yaw] of [[0, 0], [0.02, 0.05]]) {
      const body = sight.createSightBody();
      body.position.set(0, SIGHT_STAND.lensHeight, 0);
      body.rotation.set(pitch, yaw, 0, 'YXZ');
      body.add(lens);
      stand.add(body);
      expectNone([stand, turret], CABIN_GAP);
      stand.remove(body);
    }
    expectNone([sight.createSightRange()], WORLD_GAP);
    // The range's plain overlaps the tank's ground.
    expectNone([cabin.createGround(), sight.createSightRange()], WORLD_GAP);
  });

  it('on the crew', () => {
    for (const index of [0, 1]) {
      expectNone([avatar.createAvatarHead(index)], CABIN_GAP);
      expectNone([avatar.createAvatarTorso(index)], CABIN_GAP);
      expectNone([avatar.createAvatarLegs(index, 0.63)], CABIN_GAP);
    }
  });

  it('catches two boxes painted different colours sharing a face', async () => {
    const { BoxGeometry } = await import('@iwsdk/core');
    const { mergeParts } = await import('../src/scene-assets/lowpoly.js');
    const flush = mesh(mergeParts([
      { geometry: new BoxGeometry(1, 0.1, 1), color: 0x804020, position: [0, -0.05, 0] },
      { geometry: new BoxGeometry(0.2, 0.1, 0.2), color: 0x202020, position: [0, -0.05, 0] },
    ]), 'flush');
    expect(coplanarOverlaps(trianglesOf(flush), CABIN_GAP).length).toBeGreaterThan(0);
    const proud = mesh(mergeParts([
      { geometry: new BoxGeometry(1, 0.1, 1), color: 0x804020, position: [0, -0.05, 0] },
      { geometry: new BoxGeometry(0.2, 0.108, 0.2), color: 0x202020, position: [0, -0.05, 0] },
    ]), 'proud');
    expect(coplanarOverlaps(trianglesOf(proud), CABIN_GAP).length).toBe(0);
  });
});
