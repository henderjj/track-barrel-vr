import {
  createSystem,
  type Entity,
  Group,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  type ShaderMaterial,
  Vector3,
  type WebGLRenderTarget,
} from '@iwsdk/core';
import { decodePeriscopeState, encodePeriscopeState, PERISCOPE_STATE_BYTES, type PeriscopePacket } from '../net/periscope-codec.js';
import { PacketType } from '../net/pose-codec.js';
import type { TankHeader } from '../net/tank-codec.js';
import { GpuTimer } from '../perf/gpu-timer.js';
import { createWheel } from '../scene-assets/mechanism.scene-asset.js';
import {
  createPeriscopeBody,
  createPeriscopeTurning,
  createPeriscopeWindowGeometry,
  crankInPeriscope,
  lensInPeriscope,
} from '../scene-assets/periscope.scene-asset.js';
import { turnAboutHead } from '../sim/cabin.js';
import { periscopeLowered } from '../sim/convoy-seat.js';
import { Wheel } from '../sim/mechanism.js';
import {
  bearing,
  crankFor,
  EYEPIECE_TILT,
  HALF_FIELD_X,
  HALF_FIELD_Y,
  HEAD_SIZE,
  knobMiddle,
  lookText,
  PERISCOPE_CRANK,
  PERISCOPE_IDS,
  PERISCOPE_POWER,
  type PeriscopeId,
  periscopeAngle,
  PERISCOPES,
  periscopesLine,
  type PeriscopeSpec,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  PITCH,
} from '../sim/periscope.js';
import { angleDelta } from '../sim/turret.js';
import { HoldKind } from './hand-lock.js';
import { addControl } from './mechanism-system.js';
import { netLink } from './net-system.js';
import { ride } from './ride-system.js';
import {
  createLensMaterial,
  createScopeTarget,
  LensPlacer,
  renderScope,
  watchLensView,
} from './scope-lens.js';
import { type PracticeButton, sightStats } from './sight-system.js';
import { convoyUp } from './convoy-seat-system.js';
import { seating } from './seating.js';

const DEG = Math.PI / 180;
/** The camera's near and far planes, m: the head it sits in is hidden while it renders. Near enough not to cut away the roof in the bottom of the view or the hatch lid behind the driver's (John, 2026-11-07: 0.3 m let the view clip through the tank). */
const NEAR = 0.05;
const FAR = 1500;
/** How far behind the window "Go to it" puts the head, m: lean in 6 cm and it opens. */
const APPROACH = 0.15;
/** Packets a second from the owning page. */
const SEND_HZ = 45;
/** The other page's periscope eases to where the packets put it at this rate, 1/s. */
const FOLLOW_RATE = 20;

/** Each periscope's packet type, reliable "turn it" event and hold kind. */
const WIRE: Record<PeriscopeId, { packet: PeriscopePacket; turnEvent: string; kind: number }> = {
  driver: { packet: PacketType.PeriscopeState, turnEvent: 'periscope-turn', kind: HoldKind.Periscope },
  gunner: { packet: PacketType.GunnerPeriscopeState, turnEvent: 'gunner-periscope-turn', kind: HoldKind.GunnerPeriscope },
};

interface ScopeStats {
  /** An eye is at the window. */
  open: boolean;
  renders: number;
  /** performance.now() of the last render, ms. */
  lastRender: number;
  /** Main-thread and GPU time of its render, ms (smoothed; GPU NaN without timer queries). */
  cpuMs: number;
  gpuMs: number;
  calls: number;
  triangles: number;
}

const newStats = (): ScopeStats => ({ open: false, renders: 0, lastRender: 0, cpuMs: 0, gpuMs: Number.NaN, calls: 0, triangles: 0 });

/** What the periscopes are doing, for the perf HUD and the tests. */
export const periscopeStats = {
  driver: newStats(),
  gunner: newStats(),
};

/** One line for the perf HUD while a periscope renders (within the last second), or null. */
export function periscopeSummary(now: number): string | null {
  const id = periscopeStats.driver.lastRender >= periscopeStats.gunner.lastRender ? 'driver' : 'gunner';
  const s = periscopeStats[id];
  if (now - s.lastRender > 1000) return null;
  const gpu = Number.isNaN(s.gpuMs) ? '-' : `${s.gpuMs.toFixed(2)}`;
  return `${id === 'driver' ? 'periscope' : 'g.periscope'} ${PICTURE_WIDTH}×${PICTURE_HEIGHT} cpu ${s.cpuMs.toFixed(2)} gpu ${gpu} ms ${s.calls} calls ${(s.triangles / 1000).toFixed(0)}k`;
}

let active: PeriscopeSystem | null = null;

/** One line for the menu: where both periscopes look. */
export function periscopeStatus(): string {
  return active?.status() ?? '';
}

/** The game menu's Sights buttons for the periscopes. */
export const PERISCOPE_BUTTONS: readonly PracticeButton[] = [
  { id: 'menu-periscope-driver', label: () => "Driver's", press: () => active?.goTo('driver'), closes: true },
  { id: 'menu-periscope-gunner', label: () => "Gunner's", press: () => active?.goTo('gunner'), closes: true },
  { id: 'menu-periscope-ahead', label: () => 'Ahead', press: () => active?.ahead() },
];

interface ScopeDebug {
  /** Its turn (degrees, positive left; and as a bearing), the crank's, who holds it, whether it is open, and what it has sent and received. */
  state(): ScopeStats & {
    angleDeg: number;
    bearingDeg: number;
    crankDeg: number;
    held: boolean;
    owner: boolean;
    usable: boolean;
    status: string;
    sent: number;
    received: number;
  };
  /** Practice: sit in its seat with the head just behind its window. */
  goTo(): void;
  /** Turn it to `degrees` (positive left), unless a hand holds it; the other page asks the owner's. */
  turn(degrees: number): void;
  /** The middle of the crank's knob in scene space: where it is, or where it would be with the crank at `crankDegrees`. */
  knob(crankDegrees?: number): number[];
  /** The window's middle and the way it faces (towards the eye), world space. */
  lens(): { at: number[]; facing: number[] };
  /** The camera's position and the way it looks, world space. */
  view(): { at: number[]; looking: number[] };
  /** The head on the roof: where its middle is drawn, world space, and the way it faces. */
  head(): { at: number[]; facing: number[] };
  /** Spread of the rendered picture's brightness in a few texels (0 for a blank picture). */
  pictureSpread(): number;
}

interface PeriscopeDebug {
  driver: ScopeDebug;
  gunner: ScopeDebug;
  /** The menu's line. */
  status(): string;
}

/** One periscope: its crank, model, lens, camera and what it sends. */
class Scope {
  readonly crank = new Wheel(PERISCOPE_CRANK);
  /** Periscope space: the upright at the window's height, in the hull or the turret. */
  readonly mount = new Group();
  /** The crank's mechanism space (the kit's frame). */
  readonly crankMount = new Group();
  readonly crankPart: Mesh;
  readonly turning: Mesh;
  readonly lens: Mesh;
  readonly material: ShaderMaterial;
  readonly target: WebGLRenderTarget;
  readonly camera = new PerspectiveCamera((2 * HALF_FIELD_Y) / DEG, Math.tan(HALF_FIELD_X) / Math.tan(HALF_FIELD_Y), NEAR, FAR);
  readonly placer: LensPlacer;
  readonly stats: ScopeStats;
  readonly wire: (typeof WIRE)[PeriscopeId];
  gpu: GpuTimer | null = null;
  header: TankHeader = { seq: 0, timeMs: 0 };
  packet = new ArrayBuffer(PERISCOPE_STATE_BYTES);
  seq = 0;
  sendAccumulator = 0;
  sent = 0;
  received = 0;
  /** Where the owner's page says it looks (NaN before its first packet). */
  shownAngle = Number.NaN;
  /** "Go to it" is waiting for the seat system to sit the player in this seat (the placement count it waits to pass), or -1. */
  approachAfter = -1;

  constructor(readonly spec: PeriscopeSpec) {
    this.stats = periscopeStats[spec.id];
    this.wire = WIRE[spec.id];
    this.mount.name = `Periscope ${spec.id}`;
    this.mount.position.set(spec.axis[0], spec.lens[1], spec.axis[1]);
    this.mount.add(createPeriscopeBody(spec));
    this.turning = createPeriscopeTurning(spec);
    this.mount.add(this.turning);
    this.camera.position.set(0, spec.cameraY - spec.lens[1], -HEAD_SIZE.depth / 2 - 0.006);
    this.camera.rotation.x = PITCH;
    this.turning.add(this.camera);

    this.crankMount.name = `Periscope ${spec.id} crank mount`;
    this.crankMount.position.set(...crankInPeriscope(spec));
    this.crankPart = createWheel(PERISCOPE_CRANK);
    this.crankMount.add(this.crankPart);
    this.mount.add(this.crankMount);

    this.target = createScopeTarget(PICTURE_WIDTH, PICTURE_HEIGHT);
    this.material = createLensMaterial(this.target, {
      magnification: PERISCOPE_POWER,
      halfFieldX: HALF_FIELD_X,
      halfFieldY: HALF_FIELD_Y,
      reticle: null,
      stop: 'rectangle',
    });
    this.lens = new Mesh(createPeriscopeWindowGeometry(), this.material);
    this.lens.name = `Periscope Window ${spec.id}`;
    this.lens.position.set(...lensInPeriscope(spec));
    this.lens.rotation.x = EYEPIECE_TILT;
    watchLensView(this.lens, this.material);
    this.mount.add(this.lens);
    this.placer = new LensPlacer(this.lens, this.material);
  }

  /** Which way it looks, radians, positive left (from the hull's nose, or the gun's line). */
  get angle(): number {
    return periscopeAngle(this.crank.angle);
  }

  /** This seat's page owns it; alone, this page owns both, whichever seat it sits in. */
  isOwner(): boolean {
    return !netLink.connected || seating.mine === this.spec.id;
  }

  /** This player can turn it: in its seat, not riding or sat somewhere else. */
  usable(): boolean {
    return seating.mine === this.spec.id && !seating.away && !ride.active;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.lens.geometry.dispose();
    this.gpu?.dispose();
  }
}

/**
 * The crew's periscopes (F1.6, both crew since F1.19, docs/periscope.md):
 * the driver's in the hull roof ahead of their hatch, the gunner's in the
 * turret roof over the gunsight. Each has an eyepiece fixed under the roof
 * just above the station's main view; its head on the roof turns about an
 * upright, so turning it swings the view while the eye stays at the window,
 * as on a panoramic sight. A crank on the eyepiece's right turns it (a
 * mechanism-kit Wheel; HoldKind 8 the driver's, 14 the gunner's), a quarter
 * of the way round for each turn. Put an eye within about 9 cm of a window
 * and a camera in its head renders the view into a texture that the window
 * shows at 1× (spike S1's lens, src/systems/scope-lens.ts, with a
 * rectangular field stop); further away it is dark glass and nothing extra
 * is drawn.
 *
 * Each seat's page owns its periscope (alone, this page owns both): it sends
 * the angle 45 times a second (PacketType 9 the driver's, 10 the gunner's),
 * and the other page eases its periscope there, so each sees the other's
 * hand turn it and the head turn on the roof. Each page draws its own view.
 */
export class PeriscopeSystem extends createSystem({}) {
  private scopes!: Record<PeriscopeId, Scope>;
  private head = new Vector3();
  private headQuat = new Quaternion();
  private forward = new Vector3();
  private lensAt = new Vector3();
  private turned: [number, number] = [0, 0];
  private tmp: [number, number, number] = [0, 0, 0];
  private pixels = new Uint8Array(4 * 9);

  init(): void {
    active = this;
    this.scopes = { driver: new Scope(PERISCOPES.driver), gunner: new Scope(PERISCOPES.gunner) };
    const gl = this.renderer.getContext();
    const timers = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    // The gunner's turns with the turret (TurretSystem, before this, turns its entity).
    const turret: Entity | null = this.world.getSceneEntity('turret') ?? null;
    if (turret == null) console.warn("[Periscope] no turret in the scene: the gunner's periscope stands still in the hull");

    for (const id of PERISCOPE_IDS) {
      const scope = this.scopes[id];
      if (timers) scope.gpu = new GpuTimer(gl as WebGL2RenderingContext);
      this.world.createTransformEntity(scope.mount, id === 'gunner' && turret ? { parent: turret } : undefined);
      this.cleanupFuncs.push(
        addControl({
          name: scope.spec.control,
          mech: scope.crank,
          frame: scope.crankMount,
          kind: scope.wire.kind,
          active: () => scope.usable(),
        }),
      );
      netLink.handlers.set(scope.wire.packet, (view) => this.onPacket(scope, view));
      netLink.events.set(scope.wire.turnEvent, (event) => {
        const angle = (event as { angle?: unknown }).angle;
        if (scope.isOwner() && typeof angle === 'number' && Number.isFinite(angle)) this.turn(id, angle);
      });
      this.cleanupFuncs.push(
        () => netLink.handlers.delete(scope.wire.packet),
        () => netLink.events.delete(scope.wire.turnEvent),
        () => scope.dispose(),
      );
    }
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
    });

    const debug = (id: PeriscopeId): ScopeDebug => {
      const scope = this.scopes[id];
      return {
        state: () => ({
          ...scope.stats,
          angleDeg: scope.angle / DEG,
          bearingDeg: bearing(scope.angle),
          crankDeg: scope.crank.angle / DEG,
          held: scope.crank.anyHeld,
          owner: scope.isOwner(),
          usable: scope.usable(),
          status: lookText(scope.spec, scope.angle),
          sent: scope.sent,
          received: scope.received,
        }),
        goTo: () => this.goTo(id),
        turn: (degrees) => this.turn(id, degrees * DEG),
        knob: (crankDegrees) => {
          const p = knobMiddle(scope.spec, crankDegrees === undefined ? scope.crank.angle : crankDegrees * DEG, this.tmp);
          // The knob in the frame, through the mount (periscope space) into the scene.
          scope.mount.updateWorldMatrix(true, false);
          return new Vector3(p[0] - scope.spec.axis[0], p[1] - scope.spec.lens[1], p[2] - scope.spec.axis[1]).applyMatrix4(scope.mount.matrixWorld).toArray();
        },
        lens: () => {
          const at = scope.placer.restAt(new Vector3());
          return { at: at.toArray(), facing: worldPose(scope.lens, new Vector3(0, 0, 1)).facing };
        },
        view: () => {
          scope.camera.updateWorldMatrix(true, false);
          return {
            at: new Vector3().setFromMatrixPosition(scope.camera.matrixWorld).toArray(),
            looking: scope.camera.getWorldDirection(new Vector3()).toArray(),
          };
        },
        head: () => {
          scope.turning.updateWorldMatrix(true, false);
          const at = new Vector3(0, (scope.spec.head.bottom + scope.spec.head.top) / 2 - scope.spec.lens[1], 0).applyMatrix4(scope.turning.matrixWorld);
          const facing = new Vector3(0, 0, -1).transformDirection(scope.turning.matrixWorld);
          return { at: at.toArray(), facing: facing.toArray() };
        },
        pictureSpread: () => this.pictureSpread(scope),
      };
    };
    (window as unknown as { __periscope: PeriscopeDebug }).__periscope = {
      driver: debug('driver'),
      gunner: debug('gunner'),
      status: () => this.status(),
    };
  }

  status(): string {
    return periscopesLine(this.scopes.driver.angle, this.scopes.gunner.angle);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    for (const id of PERISCOPE_IDS) {
      const scope = this.scopes[id];
      if (scope.approachAfter >= 0 && seating.mine === id && seating.placements > scope.approachAfter) {
        scope.approachAfter = -1;
        this.approach(scope);
      }
      if (scope.isOwner()) {
        this.send(scope, delta);
      } else if (!Number.isNaN(scope.shownAngle) && !scope.crank.anyHeld) {
        // Its seat's player turns it: follow their packets.
        scope.crank.angle += crankFor(angleDelta(scope.angle, scope.shownAngle)) * (1 - Math.exp(-FOLLOW_RATE * dt));
      }
      scope.turning.rotation.y = scope.angle;
      // "Lower periscope. Open hatch. Raise seat to convoy position": the driver's goes down into its holder (docs/convoy-seat.md).
      const lowered = id === 'driver' && convoyUp();
      scope.turning.position.y = lowered ? -periscopeLowered(scope.spec.head) : 0;
      scope.crankPart.rotation.z = scope.crank.angle;

      const gpu = scope.gpu;
      const s = scope.stats;
      gpu?.poll();
      if (gpu && !Number.isNaN(gpu.ms)) s.gpuMs = Number.isNaN(s.gpuMs) ? gpu.ms : s.gpuMs * 0.9 + gpu.ms * 0.1;
      scope.placer.update(this.player.head, 3);
      // Over the gunsight, whichever window the eyes are nearer has them: the sight (SightSystem, before this) yields
      // to this one when the eyes are nearer it, and this one stays shut while the sight is open. Only one draws.
      if (id === 'gunner') sightStats.periscopeEye = scope.placer.eyeDistance(3);
      const was = s.open;
      const open = !ride.active && !lowered && !(id === 'gunner' && sightStats.open) && scope.placer.eyesAt(3, was);
      s.open = open;
      scope.material.uniforms.uOpen.value = open ? 1 : 0;
      if (open !== was) console.info(`[Periscope] ${id}'s ${open ? 'open' : 'closed'}`);
      if (open) this.render(scope);
    }
  }

  private render(scope: Scope): void {
    const renderer = this.renderer;
    // The camera sits in the head: leave the turning part out of its picture.
    const cpu = renderScope(renderer, this.world.scene, scope.camera, scope.target, [scope.lens, scope.turning], scope.gpu);
    const s = scope.stats;
    // The first render compiles the scene's shaders for the texture, so start averaging from the second.
    s.cpuMs = s.renders < 2 ? cpu : s.cpuMs * 0.9 + cpu * 0.1;
    s.calls = renderer.info.render.calls;
    s.triangles = renderer.info.render.triangles;
    s.renders++;
    s.lastRender = performance.now();
  }

  /**
   * Turn periscope `id` to `angle` (radians, positive left) unless a hand
   * holds its crank. Its seat's page turns it; the other page asks that one.
   */
  turn(id: PeriscopeId, angle: number): void {
    const scope = this.scopes[id];
    if (!scope.isOwner()) {
      netLink.sendEvent({ t: scope.wire.turnEvent, angle } as { t: string });
      return;
    }
    if (!scope.crank.anyHeld) scope.crank.angle = crankFor(angle);
    console.info(`[Periscope] ${id}'s turned ${lookText(scope.spec, angle)}`);
  }

  /** Practice → Ahead: both periscopes straight ahead (the gunner's along the gun). */
  ahead(): void {
    for (const id of PERISCOPE_IDS) this.turn(id, 0);
  }

  /**
   * Practice: sit the player in periscope `id`'s seat with their head just
   * behind its window, facing it. From the other seat it waits for the seat
   * system to move them first (in a crew, the host swaps both).
   */
  goTo(id: PeriscopeId): void {
    const scope = this.scopes[id];
    if (seating.mine === id) {
      this.approach(scope);
      return;
    }
    scope.approachAfter = seating.placements;
    seating.ask(id);
  }

  private approach(scope: Scope): void {
    const player = this.player;
    player.head.getWorldPosition(this.head);
    player.head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    const headYaw = Math.atan2(-this.forward.x, -this.forward.z);
    // The window faces straight back down the hull, or down the turret for the gunner's.
    const yaw = scope.spec.frame === 'turret' ? seating.turretYaw : 0;
    const turn = yaw - headYaw;
    turnAboutHead(player.position.x, player.position.z, this.head.x, this.head.z, turn, this.turned);
    player.rotateY(turn);
    player.position.x = this.turned[0];
    player.position.z = this.turned[1];
    scope.placer.restAt(this.lensAt);
    player.position.x += this.lensAt.x + Math.sin(yaw) * APPROACH - this.head.x;
    player.position.z += this.lensAt.z + Math.cos(yaw) * APPROACH - this.head.z;
    console.info(`[Periscope] player moved to the ${scope.spec.label} eyepiece`);
  }

  /** 45 times a second, the owning page sends where its periscope looks. */
  private send(scope: Scope, delta: number): void {
    if (!netLink.connected) return;
    scope.sendAccumulator += delta;
    if (scope.sendAccumulator < 1 / SEND_HZ) return;
    scope.sendAccumulator = Math.min(scope.sendAccumulator - 1 / SEND_HZ, 1 / SEND_HZ);
    netLink.send(scope.packet, encodePeriscopeState(scope.packet, scope.seq, performance.now(), scope.angle, scope.wire.packet));
    scope.seq = (scope.seq + 1) & 0xffff;
    scope.sent++;
  }

  private onPacket(scope: Scope, view: DataView): void {
    if (scope.isOwner()) return;
    const angle = decodePeriscopeState(view, scope.header, scope.wire.packet);
    if (Number.isNaN(angle)) return;
    scope.received++;
    scope.shownAngle = angle;
  }

  /** For the tests: how much the brightness varies over nine texels across the picture's middle (0 for a blank one). */
  private pictureSpread(scope: Scope): number {
    let min = 255;
    let max = 0;
    for (let i = 0; i < 9; i++) {
      const x = Math.round(PICTURE_WIDTH * (0.1 + 0.1 * i));
      const y = Math.round(PICTURE_HEIGHT * (0.3 + 0.05 * i));
      this.renderer.readRenderTargetPixels(scope.target, x, y, 1, 1, this.pixels.subarray(i * 4, i * 4 + 4));
      const v = this.pixels[i * 4] + this.pixels[i * 4 + 1] + this.pixels[i * 4 + 2];
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return max - min;
  }
}

/** Where `o` is in the world and which way its local `axis` points there. */
function worldPose(o: Object3D, axis: Vector3): { at: number[]; facing: number[] } {
  o.updateWorldMatrix(true, false);
  return { at: new Vector3().setFromMatrixPosition(o.matrixWorld).toArray(), facing: axis.transformDirection(o.matrixWorld).toArray() };
}
