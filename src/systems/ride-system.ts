import {
  createSystem,
  type CylinderGeometry,
  type Entity,
  Euler,
  Fog,
  type FogExp2,
  InputActions,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  type ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import {
  createRideGround,
  createRideHull,
  createRideHullRoof,
  createRideTrees,
  createRideTurret,
  createRideTurretClosed,
  createRideTurretOpen,
  treeSpot,
} from '../scene-assets/ride.scene-asset.js';
import {
  createTankState,
  rigForSeat,
  routeCommand,
  scanRate,
  type Seat,
  stepTank,
  stepTurret,
  stickCommand,
  stickTraverse,
  type TankCommand,
  TREE_SPOTS,
  treeScale,
  TURRET,
  type TurretState,
  vignetteLevel,
  wrapTile,
} from '../sim/ride.js';
import { createVignette } from './comfort-vignette.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { seating } from './seating.js';

export type CabinView = 'open' | 'closed';
export type TankMode = 'route' | 'stick' | 'parked';
export type TurretMode = 'scan' | 'stick' | 'still';

/** The ride's state and options, for the menu and the tests. */
export const ride = {
  active: false,
  seat: 'driver' as Seat,
  /** The comfort vignette, on by default. */
  vignette: true,
  cabin: 'open' as CabinView,
  /** Who drives: the scripted route (the practice crewmate's half), the rider's left thumbstick, or nobody. */
  tank: 'route' as TankMode,
  /** Who traverses: the scripted scan, the rider's right thumbstick, or nobody. */
  turret: 'scan' as TurretMode,
  /** Seconds since the ride started, and how many of them in VR with the vignette on and off. */
  time: 0,
  vignetteOnSeconds: 0,
  vignetteOffSeconds: 0,
};

/** After this long riding in VR, a sign asks how the rider feels (the spike's pass mark is 10 minutes), s. */
const CHECK_IN_SECONDS = 600;
/** How long a sign stays up, s. */
const SIGN_SECONDS = 6;
/** How dark the vignette gets at its strongest. */
const VIGNETTE_STRENGTH = 0.5;
/** Longest step the ride takes in one go, s; a slow frame takes several. */
const MAX_STEP = 1 / 30;
/** Fog, so the repeating ground's edge is never seen: its colour is the sky dome's horizon. */
const FOG_COLOR = 0xd9e0e6;
const FOG_NEAR = 60;
const FOG_FAR = 230;
/**
 * Names of the cabin (F1.1) and of spikes S1's and S4's set-ups, hidden
 * while riding: the ride brings its own blockout hull, turret and ground
 * until F1.4 moves the cabin with the tank.
 */
const DEMO_NAMES = /^(Hull|Turret|Ground|Sight|Sight Stand|Sight Range|Sight Lens|Loading Drill|Loading Station|Loading Board|Shell \d+|Breech Block|Breech Lever)$/;

let active: RideSystem | null = null;

/** Start riding in `seat`, or move to it (sitting down afresh) if already riding. */
export function startRide(seat: Seat): void {
  active?.start(seat);
}

/** Stop riding: the tank, the ground and the seat go, and the cabin comes back with the player in their seat. */
export function stopRide(): void {
  active?.stop();
}

/** Change a ride option from the menu. */
export function setRideOption<K extends 'vignette' | 'cabin' | 'tank' | 'turret'>(key: K, value: (typeof ride)[K]): void {
  ride[key] = value;
  active?.applyCabin();
}

/** One line on the ride for the menu: seat, time and speed. */
export function rideStatus(): string {
  if (!ride.active || active == null) return '';
  const t = Math.floor(ride.time);
  const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const kmh = Math.round(Math.abs(active.tank.speed) * 3.6);
  return `Riding as ${ride.seat} for ${clock}, ${kmh} km/h${active.tank.speed < -0.05 ? ' backwards' : ''}`;
}

interface RideDebug {
  state(): unknown;
  start(seat: Seat): void;
  stop(): void;
  set(key: 'vignette' | 'cabin' | 'tank' | 'turret', value: unknown): void;
  /** Where a point given in world (ground) space is drawn, in hull space. */
  drawnAt(x: number, y: number, z: number): number[];
}

/**
 * Spike S2, riding the tank (docs/spikes/s2-riding.md). The hull stays at
 * the origin and the ground moves round it by the inverse of the tank's
 * pose (src/sim/ride.ts). The driver's seat holds the player's rig still in
 * the hull; the gunner's turns it with the turret, as a real turret basket
 * does. A comfort vignette darkens the edge of view with what the eyes see
 * move, on by default and switchable in the menu.
 *
 * Solo only: the route stands in for the crewmate driver and the scan for
 * the crewmate gunner; F1.4 and F1.8 share the tank and turret over the
 * network. The seat system stands aside while it rides (`seating.away`).
 */
export class RideSystem extends createSystem({}) {
  readonly tank = createTankState();
  readonly turretState: TurretState = { angle: 0, rate: 0 };
  private command: TankCommand = { speed: 0, yawRate: 0 };
  private built: {
    world: Entity;
    hull: Entity;
    roof: Mesh;
    turret: Entity;
    turretOpen: Mesh;
    turretClosed: Mesh;
    trees: InstancedMesh;
  } | null = null;
  private treeX = new Float32Array(0);
  private treeZ = new Float32Array(0);
  private treeShown = new Float32Array(0);
  private demo: Object3D[] = [];
  private savedFog: Fog | FogExp2 | null = null;
  private fog = new Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  private vignette!: Mesh<CylinderGeometry, ShaderMaterial>;
  private sign!: FloatingSign;
  private signUntil = 0;
  private checkedIn = false;
  /** Sit down afresh on the next frame in VR: take the head's place in the room and its heading. */
  private reseat = true;
  private inVr = false;
  private head0 = { x: 0, z: 0, yaw: 0 };
  private rig: [number, number, number] = [0, 0, 0];
  private stick = { x: 0, y: 0 };
  private matrix = new Matrix4();
  private euler = new Euler(0, 0, 0, 'YXZ');
  private quat = new Quaternion();
  private pos = new Vector3();
  private one = new Vector3(1, 1, 1);
  private spot = new Vector3();
  private headQuat = new Quaternion();
  private forward = new Vector3();
  private treeTurn = new Quaternion();
  private treeSize = new Vector3();
  private treeMatrix = new Matrix4();
  private up = new Vector3(0, 1, 0);

  init(): void {
    active = this;
    this.vignette = createVignette();
    this.vignette.visible = false;
    this.camera.add(this.vignette);
    this.sign = new FloatingSign('Ride Sign', 0.7, [512, 160], 1.1, 0.25);
    this.world.createTransformEntity(this.sign.mesh);
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
      this.vignette.removeFromParent();
      this.vignette.geometry.dispose();
      this.vignette.material.dispose();
    });
    const self = this;
    (window as unknown as { __ride: RideDebug }).__ride = {
      state: () => ({
        ...ride,
        tank: { ...self.tank },
        tankMode: ride.tank,
        turret: { ...self.turretState },
        turretMode: ride.turret,
        vignetteAlpha: self.vignette.material.uniforms.uAlpha.value as number,
        vignetteShown: self.vignette.visible,
        rig: [self.player.position.x, self.player.position.y, self.player.position.z, self.player.rotation.y],
        head: self.player.head.getWorldPosition(new Vector3()).toArray(),
        worldShown: self.built?.world.object3D?.visible ?? false,
        roofShown: self.built?.roof.visible ?? false,
        demoShown: self.demo.length === 0 || self.demo.some((o) => o.visible),
        sign: self.sign.visible,
        treesGone: Array.from(self.treeShown).filter((s) => s < 0.01).length,
      }),
      start: startRide,
      stop: stopRide,
      set: (key, value) => setRideOption(key, value as never),
      drawnAt: (x, y, z) => {
        const world = self.built?.world.object3D;
        return world ? world.localToWorld(new Vector3(x, y, z)).toArray() : [];
      },
    };
  }

  start(seat: Seat): void {
    this.build();
    if (!ride.active) {
      ride.active = true;
      ride.time = 0;
      ride.vignetteOnSeconds = 0;
      ride.vignetteOffSeconds = 0;
      this.checkedIn = false;
      this.hideDemo(true);
      // The ride holds the play space now; the seat system waits.
      seating.away = true;
      this.savedFog = this.scene.fog;
      this.scene.fog = this.fog;
      this.built!.world.object3D!.visible = true;
      this.built!.hull.object3D!.visible = true;
    }
    ride.seat = seat;
    this.reseat = true;
    this.applyCabin();
    this.say([`Riding as ${seat}`, `Vignette ${ride.vignette ? 'on' : 'off'}. Y: menu`]);
    console.info(`[Ride] riding as ${seat}`);
  }

  stop(): void {
    if (!ride.active) return;
    ride.active = false;
    this.hideDemo(false);
    this.scene.fog = this.savedFog;
    const built = this.built!;
    built.world.object3D!.visible = false;
    built.hull.object3D!.visible = false;
    Object.assign(this.tank, createTankState());
    this.turretState.angle = 0;
    this.turretState.rate = 0;
    // Back in the cabin, in the player's own seat.
    seating.reseat();
    this.vignette.visible = false;
    this.sign.setVisible(false);
    console.info(`[Ride] stopped after ${Math.round(ride.time)} s`);
  }

  /** Show the closed cabin's roof and turret, or the open ones. */
  applyCabin(): void {
    const built = this.built;
    if (!built) return;
    const closed = ride.cabin === 'closed';
    built.roof.visible = closed;
    built.turretClosed.visible = closed;
    built.turretOpen.visible = !closed;
  }

  update(delta: number): void {
    if (!ride.active) return;
    const inVr = this.world.session != null;
    if (inVr && !this.inVr) this.reseat = true;
    this.inVr = inVr;
    const dt = Math.min(delta, 0.25);
    ride.time += dt;
    if (inVr) {
      if (ride.vignette) ride.vignetteOnSeconds += dt;
      else ride.vignetteOffSeconds += dt;
    }

    // Commands: the scripted crewmate's, the rider's thumbsticks, or none.
    const actions = this.input.actions;
    if (ride.tank === 'route') {
      routeCommand(ride.time, this.command);
    } else if (ride.tank === 'stick') {
      actions.getAxis2D(InputActions.LocomotionMove, this.stick);
      stickCommand(this.stick.x, this.stick.y, this.command);
    } else {
      this.command.speed = 0;
      this.command.yawRate = 0;
    }
    const traverse = ride.turret === 'scan' ? scanRate(ride.time) : ride.turret === 'stick' ? stickTraverse(actions.getAxis1D(InputActions.LocomotionTurn)) : 0;
    for (let left = dt; left > 1e-6; left -= MAX_STEP) {
      const step = Math.min(left, MAX_STEP);
      stepTank(this.tank, this.command, step);
      stepTurret(this.turretState, traverse, step);
    }

    this.placeWorld();
    this.built!.turret.object3D!.rotation.y = this.turretState.angle;
    if (inVr) this.seatPlayer();
    this.shade(dt, inVr);
    this.signs(delta);
  }

  /** The ground goes where the tank's inverse pose puts it, less whole tiles. */
  private placeWorld(): void {
    const t = this.tank;
    const x = wrapTile(t.x);
    const z = wrapTile(t.z);
    this.euler.set(t.pitch, t.heading, t.roll, 'YXZ');
    this.quat.setFromEuler(this.euler);
    this.pos.set(x, t.y, z);
    this.matrix.compose(this.pos, this.quat, this.one).invert();
    const world = this.built!.world.object3D!;
    this.matrix.decompose(world.position, world.quaternion, world.scale);
    // Trees in the tank's way sink into the ground as it comes, rather than pass through the hull.
    const trees = this.built!.trees;
    let changed = false;
    for (let i = 0; i < this.treeShown.length; i++) {
      const scale = treeScale(Math.hypot(this.treeX[i] - x, this.treeZ[i] - z));
      if (Math.abs(scale - this.treeShown[i]) < 0.002) continue;
      this.treeShown[i] = scale;
      const height = TREE_SPOTS[i % TREE_SPOTS.length][2] * Math.max(scale, 1e-3);
      treeSpot(i, this.spot);
      this.spot.y -= 0.1;
      this.treeTurn.setFromAxisAngle(this.up, i * 2.4);
      this.treeSize.set(height, height, height);
      trees.setMatrixAt(i, this.treeMatrix.compose(this.spot, this.treeTurn, this.treeSize));
      changed = true;
    }
    if (changed) trees.instanceMatrix.needsUpdate = true;
  }

  /** Put the rig so the rider's head is at their seat's eyes, facing its way; the gunner's turns with the turret. */
  private seatPlayer(): void {
    const head = this.player.head;
    if (this.reseat) {
      this.reseat = false;
      this.head0.x = head.position.x;
      this.head0.z = head.position.z;
      this.forward.set(0, 0, -1).applyQuaternion(this.headQuat.copy(head.quaternion));
      this.head0.yaw = Math.atan2(-this.forward.x, -this.forward.z);
    }
    rigForSeat(ride.seat, this.turretState.angle, this.head0.x, this.head0.z, this.head0.yaw, this.rig);
    this.player.position.x = this.rig[0];
    this.player.position.z = this.rig[1];
    this.player.rotation.set(0, this.rig[2], 0);
  }

  /** The vignette follows what the rider's eyes see turn, speed up and tilt. */
  private shade(dt: number, inVr: boolean): void {
    const alpha = this.vignette.material.uniforms.uAlpha;
    let target = 0;
    if (inVr && ride.vignette) {
      const t = this.tank;
      const turn = t.yawRate + (ride.seat === 'gunner' ? this.turretState.rate : 0);
      target = vignetteLevel(turn, t.accel, Math.abs(t.pitchRate) + Math.abs(t.rollRate), t.speed) * VIGNETTE_STRENGTH;
    }
    alpha.value += (target - alpha.value) * Math.min(1, dt * 6);
    this.vignette.visible = alpha.value > 0.002;
  }

  private signs(delta: number): void {
    if (this.inVr && !this.checkedIn && ride.vignetteOnSeconds + ride.vignetteOffSeconds >= CHECK_IN_SECONDS) {
      this.checkedIn = true;
      this.say(['10 minutes riding', 'How do you feel? Note it for the headset check']);
    }
    if (this.sign.visible) {
      if (ride.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.player.head, delta);
    }
  }

  private say(lines: [string, string]): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(lines[0], width / 2, 68);
    ctx.font = '30px sans-serif';
    ctx.fillText(lines[1], width / 2, 120);
    this.sign.refresh();
    this.sign.setVisible(true);
    this.signUntil = ride.time + SIGN_SECONDS;
  }

  private hideDemo(hide: boolean): void {
    if (hide) {
      this.demo = [];
      this.scene.traverse((o) => {
        if (DEMO_NAMES.test(o.name) && o.visible) this.demo.push(o);
      });
    }
    for (const o of this.demo) o.visible = !hide;
    if (!hide) this.demo = [];
  }

  /** Build the hull, turret and ground the first time a ride starts. */
  private build(): void {
    if (this.built) return;
    const world = this.world.createTransformEntity();
    world.object3D!.name = 'Ride World';
    this.world.createTransformEntity(createRideGround(), world);
    const trees = createRideTrees();
    this.world.createTransformEntity(trees, world);
    const hull = this.world.createTransformEntity(createRideHull());
    const roof = createRideHullRoof();
    this.world.createTransformEntity(roof, hull);
    const turret = this.world.createTransformEntity(createRideTurret(), hull);
    turret.object3D!.position.set(TURRET.x, 0, TURRET.z);
    const turretOpen = createRideTurretOpen();
    const turretClosed = createRideTurretClosed();
    this.world.createTransformEntity(turretOpen, turret);
    this.world.createTransformEntity(turretClosed, turret);
    this.built = { world, hull, roof, turret, turretOpen, turretClosed, trees };

    const count = trees.count;
    this.treeX = new Float32Array(count);
    this.treeZ = new Float32Array(count);
    this.treeShown = new Float32Array(count).fill(1);
    for (let i = 0; i < count; i++) {
      treeSpot(i, this.spot);
      this.treeX[i] = this.spot.x;
      this.treeZ[i] = this.spot.z;
    }
  }
}
