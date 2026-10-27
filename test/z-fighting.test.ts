import { type BufferGeometry, Group, Mesh, MeshLambertMaterial, type Object3D, type Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import * as avatar from '../src/scene-assets/avatar.scene-asset.js';
import * as cabin from '../src/scene-assets/cabin.scene-asset.js';
import * as ride from '../src/scene-assets/ride.scene-asset.js';
import * as loading from '../src/scene-assets/loading.scene-asset.js';
import {
  BREECH_MOUTH,
  casingRest,
  CASINGS_KEPT,
  LEVER_CLOSED,
  LEVER_PIVOT,
  RACK_SLOTS,
  RECOIL,
  SHELL_LENGTH,
} from '../src/sim/loading.js';
import { mergeParts } from '../src/scene-assets/lowpoly.js';
import { markerParts, targetParts } from '../src/scene-assets/range.scene-asset.js';
import { MARKER_RANGES, RANGE_TARGETS } from '../src/sim/range.js';
import * as sight from '../src/scene-assets/sight.scene-asset.js';
import { createTerrain } from '../src/scene-assets/terrain.scene-asset.js';
import { GROUND_Y } from '../src/sim/cabin.js';
import { TURRET } from '../src/sim/cabin.js';
import { SIGHT_STAND } from '../src/sim/sight.js';
import {
  ELEVATION_WHEEL,
  MAX_ELEVATION,
  MIN_ELEVATION,
  POWER_GRIP,
  STATION,
  STATION_CONTROLS,
  TRAVERSE_CRANK,
  TRUNNION,
} from '../src/sim/turret.js';
import * as leverRig from '../src/scene-assets/lever-rig.scene-asset.js';
import * as mechanism from '../src/scene-assets/mechanism.scene-asset.js';
import * as bench from '../src/sim/mechanism-bench.js';
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

/** Faces flat on a floor at y = 0, facing down into it, can never be seen. */
const onFloor = (at: Vector3, n: Vector3) => n.y < -0.99 && Math.abs(at.y) < 0.005;

function expectNone(objects: Object3D[], gap: number, ignore?: (at: Vector3, n: Vector3) => boolean): void {
  const found = coplanarOverlaps(objects.flatMap((o) => trianglesOf(o)), gap, 2e-5, ignore);
  expect(found.length, `faces sharing a plane:\n${describeOverlaps(found)}`).toBe(0);
}

/**
 * The turret turned `yaw`, with its gun elevated `elevation` and the
 * gunner's controls on their mounts, the wheels turned `turn` and the grip
 * twisted to match (F1.8), as TurretSystem draws them.
 */
function turretWith(yaw: number, elevation: number, turn: number, load: Loading = OPEN): Object3D {
  const turret = cabin.createTurret();
  turret.position.set(0, 0, TURRET.z);
  turret.rotation.y = yaw;
  const gun = cabin.createGun();
  gun.position.set(0, TRUNNION.y, TRUNNION.z);
  gun.rotation.x = elevation;
  turret.add(gun);
  addLoading(turret, gun, load);
  const parts = {
    elevation: mechanism.createWheel(ELEVATION_WHEEL),
    crank: mechanism.createWheel(TRAVERSE_CRANK),
    twist: mechanism.createTwistGrip(POWER_GRIP),
  };
  for (const key of STATION_CONTROLS) {
    const mount = new Group();
    mount.position.set(...STATION[key].at);
    mount.rotation.x = STATION[key].tilt;
    const part = parts[key];
    if (key === 'twist') part.rotation.y = Math.max(-POWER_GRIP.max, Math.min(POWER_GRIP.max, turn / 3));
    else part.rotation.z = turn;
    mount.add(part);
    turret.add(mount);
  }
  turret.updateMatrixWorld(true);
  return turret;
}

/** How the loading is drawn (F1.10): the breech open or closed, a shell rammed in it, the gun recoiled, casings in the bin. */
interface Loading {
  closed: boolean;
  rammed: boolean;
  recoil: number;
  casings: number;
}
const OPEN: Loading = { closed: false, rammed: false, recoil: 0, casings: 0 };

/** The loading's moving parts as LoadingSystem draws them: the block and lever on the gun's recoiling part, the shells in the rack (or one in the breech), the casings in the bin. */
function addLoading(turret: Object3D, gun: Object3D, load: Loading): void {
  const recoil = gun.getObjectByName('Gun Recoil')!;
  recoil.position.z = load.recoil;
  const block = loading.createBreechBlock();
  block.position.set(0, load.closed ? loading.BLOCK_CLOSED_Y : loading.BLOCK_OPEN_Y, loading.BLOCK_Z);
  const lever = loading.createBreechLever();
  lever.position.set(...LEVER_PIVOT);
  lever.rotation.x = load.closed ? LEVER_CLOSED : 0;
  recoil.add(block, lever);
  RACK_SLOTS.forEach((slot, i) => {
    const shell = loading.createShell(i);
    if (load.rammed && i === 0) {
      // Home in the breech, gun space.
      shell.position.set(BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] - SHELL_LENGTH / 2);
      recoil.add(shell);
    } else {
      shell.position.set(...slot);
      turret.add(shell);
    }
  });
  for (let n = 0; n < load.casings; n++) {
    const casing = loading.createCasing(n);
    casing.position.set(...casingRest(n, [0, 0, 0]));
    casing.rotation.y = Math.PI;
    turret.add(casing);
  }
}

describe('no faces that flicker through each other (z-fighting)', () => {
  // Add every new model here: static scenery with what stands on it, and
  // each moving part in each of the poses it is drawn in.
  it('in the tank: hull, and the turret facing every way it turns', () => {
    const hull = cabin.createHull();
    expectNone([hull], CABIN_GAP);
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      expectNone([hull, turretWith(yaw, 0, 0)], CABIN_GAP);
    }
  });

  it("in the turret: the gun at each end of its elevation, and the gunner's controls turned (F1.8)", () => {
    const hull = cabin.createHull();
    for (const [elevation, turn] of [[MIN_ELEVATION, 0], [MAX_ELEVATION, 1.3], [0.05, -2.2], [-0.1, Math.PI]]) {
      expectNone([hull, turretWith(0.3, elevation, turn)], CABIN_GAP);
    }
  });

  it("on the driver's station (F1.5): its levers at both ends and in their notches, and its needles on the panel", async () => {
    const { Group } = await import('@iwsdk/core');
    const station = await import('../src/sim/driver-station.js');
    const { createNeedle } = await import('../src/scene-assets/driver-station.scene-asset.js');
    const hull = cabin.createHull();
    for (const pose of ['min', 'rest', 'max'] as const) {
      const root = new Group();
      for (const id of station.DRIVER_CONTROL_IDS) {
        const { spec, pivot } = station.DRIVER_CONTROLS[id];
        const lever = mechanism.createLever(spec);
        lever.position.set(pivot[0], pivot[1], pivot[2]);
        lever.rotation.x = -spec[pose];
        root.add(lever);
      }
      const panel = new Group();
      panel.position.set(...station.PANEL.centre);
      panel.rotation.x = -station.PANEL.tilt;
      const at: [number, number] = [0, 0];
      station.DIALS.forEach((dial, i) => {
        const needle = createNeedle();
        station.dialCentre(i, at);
        needle.position.set(at[0], at[1], 0);
        needle.rotation.z = -station.needleAngle(dial, pose === 'min' ? dial.min : pose === 'max' ? dial.max : (dial.min + dial.max) / 2);
        panel.add(needle);
      });
      root.add(panel);
      root.updateMatrixWorld(true);
      expectNone([hull, root], CABIN_GAP);
    }
  });

  /** The test range's ground (F1.4, F1.7) where the scene puts it, under the hull parked at the start. */
  const ground = () => {
    const terrain = createTerrain();
    terrain.position.y = GROUND_Y;
    terrain.updateMatrixWorld(true);
    return terrain;
  };

  it('on the range: the ground with its roads, targets, markers, rocks, walls and houses, and the tank parked on it', () => {
    expectNone([ground(), cabin.createHull()], WORLD_GAP);
  });

  it("on each of the test range's targets and markers on their own (F1.7)", () => {
    RANGE_TARGETS.forEach((target, i) => {
      expectNone([mesh(mergeParts(targetParts(i)), `Target ${target.range} m`)], WORLD_GAP);
    });
    for (const range of MARKER_RANGES) {
      expectNone([mesh(mergeParts(markerParts(range)), `Marker ${range} m`)], WORLD_GAP);
    }
  });

  it('on the range run\'s hit flags (F1.11), on their own and raised beside each target on the ground', async () => {
    const run = await import('../src/scene-assets/range-run.scene-asset.js');
    const { hitFlagFoot, hitFlagYaw } = await import('../src/sim/range-run.js');
    const { groundHeight } = await import('../src/sim/terrain.js');
    expectNone([run.createHitFlag()], WORLD_GAP);
    const terrain = ground();
    const flags = RANGE_TARGETS.map((_, i) => {
      const flag = run.createHitFlag();
      const [x, z] = hitFlagFoot(i);
      flag.position.set(x, GROUND_Y + groundHeight(x, z), z);
      flag.rotation.y = hitFlagYaw(i);
      flag.updateMatrixWorld(true);
      return flag;
    });
    expectNone([terrain, ...flags], WORLD_GAP);
  });

  it("on spike S1's sight, hanging in the turret and aimed", () => {
    const stand = sight.createSightStand();
    stand.position.set(SIGHT_STAND.x, 0, SIGHT_STAND.z);
    const lens = mesh(sight.createSightLensGeometry(), 'Sight Lens');
    const turret = turretWith(0, 0, 0);
    for (const [pitch, yaw] of [[0, 0], [0.02, 0.05]]) {
      const body = sight.createSightBody();
      body.position.set(0, SIGHT_STAND.lensHeight, 0);
      body.rotation.set(pitch, yaw, 0, 'YXZ');
      body.add(lens);
      stand.add(body);
      expectNone([stand, turret], CABIN_GAP);
      stand.remove(body);
    }
  });

  it('in the turret with the loading drawn (F1.10): breech open and closed, a shell rammed, recoiled, casings in the bin', () => {
    const hull = cabin.createHull();
    const loads: Loading[] = [
      { closed: false, rammed: false, recoil: 0, casings: 0 },
      { closed: true, rammed: true, recoil: 0, casings: CASINGS_KEPT },
      { closed: false, rammed: false, recoil: RECOIL.length, casings: 3 },
    ];
    for (const elevation of [MIN_ELEVATION, 0, MAX_ELEVATION]) {
      for (const load of loads) {
        expectNone([hull, turretWith(0, elevation, 0, load)], CABIN_GAP);
      }
    }
  });

  it('on a shell and a casing', () => {
    expectNone([loading.createShell(0)], CABIN_GAP);
    expectNone([loading.createCasing(0)], CABIN_GAP);
  });

  it('on the lever test rig, with its tillers upright and at both limits', async () => {
    const { Group } = await import('@iwsdk/core');
    const { LEVER_RIG, TILLER } = await import('../src/sim/lever.js');
    for (const angle of [0, TILLER.min, TILLER.max]) {
      const rig = new Group();
      rig.add(leverRig.createLeverRig());
      for (const side of [-1, 1]) {
        const tiller = mechanism.createLever(TILLER);
        tiller.position.x = side * LEVER_RIG.side;
        tiller.rotation.x = -angle;
        rig.add(tiller);
      }
      rig.updateMatrixWorld(true);
      expectNone([rig], CABIN_GAP);
    }
  });

  it("on the mechanism kit's test bench, with every control at its ends and in between", async () => {
    const { Group } = await import('@iwsdk/core');
    const { MOUNTS, NOTCHED_LEVER, CRANK, HANDWHEEL, TWIST, YOKE, BUTTON, SWITCH } = bench;
    const DEG = Math.PI / 180;
    const poses = [
      { lever: NOTCHED_LEVER.min, crank: 0, wheel: 0, twist: -TWIST.max, yoke: 0, button: 0, switch: 0 },
      { lever: 0, crank: 50 * DEG, wheel: 100 * DEG, twist: 0, yoke: 35 * DEG, button: BUTTON.travel, switch: SWITCH.travel / 2 },
      { lever: NOTCHED_LEVER.max, crank: 200 * DEG, wheel: -170 * DEG, twist: TWIST.max, yoke: 90 * DEG, button: BUTTON.travel / 2, switch: SWITCH.travel },
      { lever: 12 * DEG, crank: -95 * DEG, wheel: 7 * DEG, twist: 17 * DEG, yoke: -150 * DEG, button: 0, switch: 0 },
    ];
    for (const pose of poses) {
      const root = new Group();
      root.add(mechanism.createBench());
      const part = (key: keyof typeof MOUNTS, mesh: Object3D) => {
        const mount = new Group();
        mount.position.set(MOUNTS[key].at[0], MOUNTS[key].at[1], MOUNTS[key].at[2]);
        mount.rotation.x = MOUNTS[key].tilt;
        mount.add(mesh);
        root.add(mount);
        return mesh;
      };
      part('lever', mechanism.createLever(NOTCHED_LEVER)).rotation.x = -pose.lever;
      part('crank', mechanism.createWheel(CRANK)).rotation.z = pose.crank;
      part('wheel', mechanism.createWheel(HANDWHEEL)).rotation.z = pose.wheel;
      part('twist', mechanism.createTwistGrip(TWIST)).rotation.y = pose.twist;
      part('yoke', mechanism.createYoke(YOKE)).rotation.y = pose.yoke;
      part('button', mechanism.createButtonCap(BUTTON, 0xa83228)).position.z = -pose.button;
      part('switch', mechanism.createButtonCap(SWITCH, 0x3a8a3a)).position.z = -pose.switch;
      root.updateMatrixWorld(true);
      expectNone([root], CABIN_GAP);
    }
  });

  it('on the crew', () => {
    for (const index of [0, 1]) {
      expectNone([avatar.createAvatarHead(index)], CABIN_GAP);
      expectNone([avatar.createAvatarTorso(index)], CABIN_GAP);
      expectNone([avatar.createAvatarLegs(index, 0.63)], CABIN_GAP);
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
      expectNone([ride.createRideHull(), turned(ride.createRideTurret(), angle), turned(ride.createRideTurretOpen(), angle)], CABIN_GAP);
      expectNone([ride.createRideHull(), ride.createRideHullRoof(), turned(ride.createRideTurret(), angle), turned(ride.createRideTurretClosed(), angle)], CABIN_GAP);
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
    expect(coplanarOverlaps(trianglesOf(flush), CABIN_GAP).length).toBeGreaterThan(0);
    const proud = mesh(mergeParts([
      { geometry: new BoxGeometry(1, 0.1, 1), color: 0x804020, position: [0, -0.05, 0] },
      { geometry: new BoxGeometry(0.2, 0.108, 0.2), color: 0x202020, position: [0, -0.05, 0] },
    ]), 'proud');
    expect(coplanarOverlaps(trianglesOf(proud), CABIN_GAP).length).toBe(0);
  });
});
