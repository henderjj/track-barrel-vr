import { type BufferGeometry, Mesh, MeshLambertMaterial, type Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import * as avatar from '../src/scene-assets/avatar.scene-asset.js';
import * as deck from '../src/scene-assets/deck.scene-asset.js';
import * as ride from '../src/scene-assets/ride.scene-asset.js';
import * as loading from '../src/scene-assets/loading-drill.scene-asset.js';
import { BREECH_MOUTH, LEVER_CLOSED, LEVER_PIVOT, RACK_SLOTS, SHELL_LENGTH } from '../src/sim/loading.js';
import * as sight from '../src/scene-assets/sight.scene-asset.js';
import { SIGHT_STAND } from '../src/sim/sight.js';
import { coplanarOverlaps, describeOverlaps, trianglesOf } from './support/coplanar.js';

/**
 * Z-fighting: two differently coloured faces facing the same way, in (nearly)
 * the same plane and overlapping, flicker through each other in the headset
 * as the head moves (in the game this template came from, a crate's edges,
 * a hatch's edges and a jetty's root all did). Keep faces like that at least this
 * far apart: 3 mm on and around the deck (seen from 0.3 to 3 m), 8 mm out in
 * the world (seen from 5 m and further). Docs: docs/testing.md#z-fighting.
 */
const DECK_GAP = 0.003;
const WORLD_GAP = 0.008;

const material = new MeshLambertMaterial({ vertexColors: true });
function mesh(geometry: BufferGeometry, name: string): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  return m;
}

/** Faces flat on the deck, facing down into it, can never be seen. */
const onDeck = (at: Vector3, n: Vector3) => n.y < -0.99 && Math.abs(at.y) < 0.005;

function expectNone(objects: Object3D[], gap: number, ignore?: (at: Vector3, n: Vector3) => boolean): void {
  const found = coplanarOverlaps(objects.flatMap((o) => trianglesOf(o)), gap, 2e-5, ignore);
  expect(found.length, `faces sharing a plane:\n${describeOverlaps(found)}`).toBe(0);
}

describe('no faces that flicker through each other (z-fighting)', () => {
  // Add every new model here: static scenery with what stands on it, and
  // each moving prop in each of the poses it is drawn in.
  it('on the play area: deck, rails, table, hoop and ground', () => {
    expectNone([deck.createPlayArea()], DECK_GAP, onDeck);
  });

  it('in each prop that moves about the deck', () => {
    const props: Object3D[] = [deck.createBlock(0), deck.createBlock(1)];
    for (const prop of props) {
      expectNone([prop], DECK_GAP);
    }
  });

  it("on spike S1's sight, on its stand and aimed, and its range", () => {
    const stand = sight.createSightStand();
    const lens = mesh(sight.createSightLensGeometry(), 'Sight Lens');
    for (const [pitch, yaw] of [[0, 0], [0.02, 0.05]]) {
      const body = sight.createSightBody();
      body.position.set(0, SIGHT_STAND.lensHeight, 0);
      body.rotation.set(pitch, yaw, 0, 'YXZ');
      body.add(lens);
      body.updateMatrixWorld(true);
      expectNone([stand, body], DECK_GAP, onDeck);
    }
    expectNone([sight.createSightRange()], WORLD_GAP);
    // The range's plain overlaps the deck's ground.
    expectNone([deck.createPlayArea(), sight.createSightRange()], DECK_GAP, onDeck);
  });

  it('on the loading station (spike S4), with its shells in the rack and the breech open and closed', () => {
    for (const closed of [false, true]) {
      const block = loading.createBreechBlock();
      block.position.set(loading.BLOCK_X, closed ? loading.BLOCK_CLOSED_Y : loading.BLOCK_OPEN_Y, loading.BLOCK_Z);
      const lever = loading.createBreechLever();
      lever.position.set(...LEVER_PIVOT);
      lever.rotation.x = closed ? LEVER_CLOSED : 0;
      const racked = RACK_SLOTS.map((slot, i) => {
        const shell = loading.createShell(i);
        shell.position.set(...slot);
        return shell;
      });
      // With the breech closed, one shell is rammed home in it instead of in the rack.
      const rammed = loading.createShell(0);
      rammed.position.set(BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] - SHELL_LENGTH / 2);
      const shells = closed ? [rammed, ...racked.slice(1)] : racked;
      expectNone([loading.createLoadingStation(), block, lever, ...shells], DECK_GAP, onDeck);
    }
  });

  it('on a shell', () => {
    expectNone([loading.createShell(0)], DECK_GAP);
  });

  it('on the crew', () => {
    for (const index of [0, 1]) {
      expectNone([avatar.createAvatarHead(index)], DECK_GAP);
      expectNone([avatar.createAvatarTorso(index)], DECK_GAP);
      expectNone([avatar.createAvatarLegs(index)], DECK_GAP);
    }
  });

  it('in the riding spike\'s hull and turret, open and closed, with the turret turned', () => {
    const turned = (mesh: Object3D, angle: number) => {
      mesh.rotation.y = angle;
      mesh.position.set(0, 0, 0.1);
      mesh.updateMatrixWorld(true);
      return mesh;
    };
    for (const angle of [0, 0.7, Math.PI / 2]) {
      expectNone([ride.createRideHull(), turned(ride.createRideTurret(), angle), turned(ride.createRideTurretOpen(), angle)], DECK_GAP);
      expectNone([ride.createRideHull(), ride.createRideHullRoof(), turned(ride.createRideTurret(), angle), turned(ride.createRideTurretClosed(), angle)], DECK_GAP);
    }
  });

  it('on the riding spike\'s ground and trees', () => {
    expectNone([ride.createRideGround()], WORLD_GAP);
    // One tree, as each instance draws it.
    expectNone([ride.createRideTrees()], WORLD_GAP);
  });

  it('catches two boxes painted different colours sharing a face', async () => {
    const { BoxGeometry } = await import('@iwsdk/core');
    const { mergeParts } = await import('../src/scene-assets/lowpoly.js');
    const flush = mesh(mergeParts([
      { geometry: new BoxGeometry(1, 0.1, 1), color: 0x804020, position: [0, -0.05, 0] },
      { geometry: new BoxGeometry(0.2, 0.1, 0.2), color: 0x202020, position: [0, -0.05, 0] },
    ]), 'flush');
    expect(coplanarOverlaps(trianglesOf(flush), DECK_GAP).length).toBeGreaterThan(0);
    const proud = mesh(mergeParts([
      { geometry: new BoxGeometry(1, 0.1, 1), color: 0x804020, position: [0, -0.05, 0] },
      { geometry: new BoxGeometry(0.2, 0.108, 0.2), color: 0x202020, position: [0, -0.05, 0] },
    ]), 'proud');
    expect(coplanarOverlaps(trianglesOf(proud), DECK_GAP).length).toBe(0);
  });
});
