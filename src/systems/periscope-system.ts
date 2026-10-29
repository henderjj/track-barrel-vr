import { createSystem, Group, Mesh, type Object3D, PerspectiveCamera, Quaternion, type ShaderMaterial, Vector3, type WebGLRenderTarget } from '@iwsdk/core';
import { decodePeriscopeState, encodePeriscopeState, PERISCOPE_STATE_BYTES } from '../net/periscope-codec.js';
import { PacketType } from '../net/pose-codec.js';
import type { TankHeader } from '../net/tank-codec.js';
import { GpuTimer } from '../perf/gpu-timer.js';
import { createPeriscopeBody, createPeriscopeTurning, createPeriscopeWindowGeometry } from '../scene-assets/periscope.scene-asset.js';
import { turnAboutHead } from '../sim/cabin.js';
import { Yoke } from '../sim/mechanism.js';
import {
  AXIS,
  bearing,
  bearingText,
  CAMERA_Y,
  HALF_FIELD_X,
  HALF_FIELD_Y,
  HEAD,
  LENS,
  PERISCOPE_POWER,
  PERISCOPE_POWERS,
  PERISCOPE_YOKE,
  type PeriscopePower,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  PITCH,
  YOKE_Y,
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
  setLensMagnification,
  watchLensView,
} from './scope-lens.js';
import type { PracticeButton } from './sight-system.js';
import { seating } from './seating.js';

const DEG = Math.PI / 180;
/** The camera's near and far planes, m: the head it sits in is hidden while it renders. */
const NEAR = 0.3;
const FAR = 1500;
/** How far behind the window "Go to it" puts the head, m: lean in 6 cm and it opens. */
const APPROACH = 0.15;
/** Packets a second from the driver's page. */
const SEND_HZ = 45;
/** The other page's periscope eases to where the packets put it at this rate, 1/s. */
const FOLLOW_RATE = 20;
/** The yoke's handle name in handUse and `window.__mechanisms`. */
const NAME = 'periscope';

/** What the periscope is doing, for the perf HUD and the tests. */
export const periscopeStats = {
  power: PERISCOPE_POWER as PeriscopePower,
  /** An eye is at the window. */
  open: false,
  renders: 0,
  /** performance.now() of the last render, ms. */
  lastRender: 0,
  /** Main-thread and GPU time of its render, ms (smoothed; GPU NaN without timer queries). */
  cpuMs: 0,
  gpuMs: Number.NaN,
  calls: 0,
  triangles: 0,
};

/** One line for the perf HUD while the periscope renders (within the last second), or null. */
export function periscopeSummary(now: number): string | null {
  const s = periscopeStats;
  if (now - s.lastRender > 1000) return null;
  const gpu = Number.isNaN(s.gpuMs) ? '-' : `${s.gpuMs.toFixed(2)}`;
  return `periscope ${PICTURE_WIDTH}×${PICTURE_HEIGHT} ${s.power}× cpu ${s.cpuMs.toFixed(2)} gpu ${gpu} ms ${s.calls} calls ${(s.triangles / 1000).toFixed(0)}k`;
}

let active: PeriscopeSystem | null = null;

/** One line for the menu: where the periscope looks. */
export function periscopeStatus(): string {
  return active?.status() ?? '';
}

const next = <T>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length];

/** The game menu's Practice buttons for the periscope. */
export const PERISCOPE_BUTTONS: readonly PracticeButton[] = [
  { id: 'menu-periscope-go', label: () => 'Go to it', press: () => active?.goTo(), closes: true },
  { id: 'menu-periscope-ahead', label: () => 'Ahead', press: () => active?.turn(0) },
  { id: 'menu-periscope-power', label: () => `Power ${periscopeStats.power}x`, press: () => active?.setPower(next(PERISCOPE_POWERS, periscopeStats.power)) },
];

interface PeriscopeDebug {
  /** Its turn (degrees, positive left; and as a bearing), who holds which handle, whether it is open, and what it has sent and received. */
  state(): typeof periscopeStats & {
    angleDeg: number;
    bearingDeg: number;
    heldBy: 'left' | 'right' | 'both' | null;
    strain: number[];
    owner: boolean;
    usable: boolean;
    status: string;
    sent: number;
    received: number;
  };
  goTo(): void;
  /** Turn it to `degrees` (positive left), unless a hand holds it; the other page asks the driver's. */
  turn(degrees: number): void;
  setPower(power: PeriscopePower): void;
  /** The middle of handle `which` (0 left, 1 right) in scene space: where it is, or where it would be at `degrees`. */
  handle(which: 0 | 1, degrees?: number): number[];
  /** The window's middle and the way it faces (towards the eye), world space. */
  lens(): { at: number[]; facing: number[] };
  /** The camera's position and the way it looks, world space. */
  view(): { at: number[]; looking: number[] };
  /** The head on the roof: where its middle is drawn, world space, and the way it faces. */
  head(): { at: number[]; facing: number[] };
  /** Spread of the rendered picture's brightness in a few texels (0 for a blank picture). */
  pictureSpread(): number;
}

/**
 * The driver's periscope (F1.6, docs/periscope.md). Its eyepiece is fixed
 * in the hull right of the vision slit; its head on the roof and the yoke
 * under the eyepiece turn together about an upright, so turning the yoke
 * swings the view while the eye stays at the window, as on a panoramic
 * sight. The yoke is a mechanism-kit Yoke (HoldKind 8): quick in both
 * hands, slower in one. Put an eye within about 9 cm of the window and a
 * camera in the head renders the view into a texture that the window shows
 * at 2× (spike S1's lens, src/systems/scope-lens.ts, with a rectangular
 * field stop); further away it is dark glass and nothing extra is drawn.
 *
 * The driver's page owns the periscope (alone, this page does): it sends
 * the yoke's angle 45 times a second (PacketType 9), and the other page
 * eases its periscope there, so each sees the other's hands turn it and
 * the head turn on the roof. Each page draws its own view.
 */
export class PeriscopeSystem extends createSystem({}) {
  private yoke = new Yoke(PERISCOPE_YOKE);
  private mount = new Group();
  private turning!: Mesh;
  private lens!: Mesh;
  private material!: ShaderMaterial;
  private target!: WebGLRenderTarget;
  private camera3 = new PerspectiveCamera(2 * HALF_FIELD_Y / DEG, Math.tan(HALF_FIELD_X) / Math.tan(HALF_FIELD_Y), NEAR, FAR);
  private gpu: GpuTimer | null = null;
  private lensAt = new Vector3();
  private placer!: LensPlacer;
  private head = new Vector3();
  private headQuat = new Quaternion();
  private forward = new Vector3();
  private turned: [number, number] = [0, 0];
  private tmp = new Vector3();
  private header: TankHeader = { seq: 0, timeMs: 0 };
  private packet = new ArrayBuffer(PERISCOPE_STATE_BYTES);
  private seq = 0;
  private sendAccumulator = 0;
  private sent = 0;
  private received = 0;
  /** Where the driver's page says it looks (NaN before its first packet). */
  private shownAngle = Number.NaN;
  private pixels = new Uint8Array(4 * 9);
  /** "Go to it" is waiting for the seat system to sit the player in the driver's seat (the placement count it waits to pass), or -1. */
  private approachAfter = -1;

  init(): void {
    active = this;
    this.mount.name = 'Periscope';
    this.mount.position.set(AXIS[0], YOKE_Y, AXIS[1]);
    this.mount.add(createPeriscopeBody());
    this.turning = createPeriscopeTurning();
    this.mount.add(this.turning);
    this.camera3.position.set(0, CAMERA_Y - YOKE_Y, -HEAD.depth / 2 - 0.006);
    this.camera3.rotation.x = PITCH;
    this.turning.add(this.camera3);

    this.target = createScopeTarget(PICTURE_WIDTH, PICTURE_HEIGHT);
    this.material = createLensMaterial(this.target, {
      magnification: periscopeStats.power,
      halfFieldX: HALF_FIELD_X,
      halfFieldY: HALF_FIELD_Y,
      reticle: null,
      stop: 'rectangle',
    });
    this.lens = new Mesh(createPeriscopeWindowGeometry(), this.material);
    this.lens.name = 'Periscope Window';
    this.lens.position.set(0, LENS[1] - YOKE_Y, LENS[2] - AXIS[1]);
    watchLensView(this.lens, this.material);
    this.mount.add(this.lens);
    this.placer = new LensPlacer(this.lens, this.material);
    this.world.createTransformEntity(this.mount);

    this.cleanupFuncs.push(addControl({
      name: NAME,
      mech: this.yoke,
      frame: this.mount,
      kind: HoldKind.Periscope,
      active: () => this.usable(),
    }));

    netLink.handlers.set(PacketType.PeriscopeState, (view) => this.onPacket(view));
    netLink.events.set('periscope-turn', (event) => {
      const angle = (event as { angle?: unknown }).angle;
      if (this.isOwner() && typeof angle === 'number' && Number.isFinite(angle)) this.turn(angle);
    });
    const gl = this.renderer.getContext();
    if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
      this.gpu = new GpuTimer(gl);
    }
    this.cleanupFuncs.push(
      () => {
        if (active === this) active = null;
      },
      () => netLink.handlers.delete(PacketType.PeriscopeState),
      () => netLink.events.delete('periscope-turn'),
      () => {
        this.target.dispose();
        this.material.dispose();
        this.lens.geometry.dispose();
        this.gpu?.dispose();
      },
    );

    const self = this;
    (window as unknown as { __periscope: PeriscopeDebug }).__periscope = {
      state: () => {
        const y = self.yoke;
        return {
          ...periscopeStats,
          angleDeg: y.angle / DEG,
          bearingDeg: bearing(y.angle),
          heldBy: y.held[0] && y.held[1] ? 'both' : y.held[0] ? 'left' : y.held[1] ? 'right' : null,
          strain: [y.strain[0] / DEG, y.strain[1] / DEG],
          owner: self.isOwner(),
          usable: self.usable(),
          status: self.status(),
          sent: self.sent,
          received: self.received,
        };
      },
      goTo: () => self.goTo(),
      turn: (degrees) => self.turn(degrees * DEG),
      setPower: (power) => self.setPower(power),
      handle: (which, degrees) => {
        const r = (PERISCOPE_YOKE.inner + PERISCOPE_YOKE.outer) / 2;
        const a = degrees === undefined ? self.yoke.angle : degrees * DEG;
        const dir = which === 0 ? -1 : 1;
        self.mount.updateWorldMatrix(true, false);
        return self.tmp.set(r * Math.cos(a) * dir, 0, -r * Math.sin(a) * dir).applyMatrix4(self.mount.matrixWorld).toArray();
      },
      lens: () => worldPose(self.lens, new Vector3(0, 0, 1)),
      view: () => {
        self.camera3.updateWorldMatrix(true, false);
        return {
          at: new Vector3().setFromMatrixPosition(self.camera3.matrixWorld).toArray(),
          looking: self.camera3.getWorldDirection(new Vector3()).toArray(),
        };
      },
      head: () => {
        self.turning.updateWorldMatrix(true, false);
        const at = new Vector3(0, (HEAD.bottom + HEAD.top) / 2 - YOKE_Y, 0).applyMatrix4(self.turning.matrixWorld);
        const facing = new Vector3(0, 0, -1).transformDirection(self.turning.matrixWorld);
        return { at: at.toArray(), facing: facing.toArray() };
      },
      pictureSpread: () => self.pictureSpread(),
    };
  }

  /** The driver's page owns the periscope; alone, this page does whichever seat it sits in. */
  isOwner(): boolean {
    return !netLink.connected || seating.mine === 'driver';
  }

  /** This player can turn it: in the driver's seat, not riding or sat somewhere else. */
  private usable(): boolean {
    return seating.mine === 'driver' && !seating.away && !ride.active;
  }

  status(): string {
    return `The periscope looks ${bearingText(this.yoke.angle)}`;
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    if (this.approachAfter >= 0 && seating.mine === 'driver' && seating.placements > this.approachAfter) {
      this.approachAfter = -1;
      this.approach();
    }
    if (this.isOwner()) {
      this.send(delta);
    } else if (!Number.isNaN(this.shownAngle) && !this.yoke.anyHeld) {
      // The driver turns it: follow their packets.
      this.yoke.angle += angleDelta(this.yoke.angle, this.shownAngle) * (1 - Math.exp(-FOLLOW_RATE * dt));
    }
    this.turning.rotation.y = this.yoke.angle;

    this.gpu?.poll();
    if (this.gpu && !Number.isNaN(this.gpu.ms)) {
      periscopeStats.gpuMs = Number.isNaN(periscopeStats.gpuMs) ? this.gpu.ms : periscopeStats.gpuMs * 0.9 + this.gpu.ms * 0.1;
    }
    this.placer.update(this.player.head, 3);
    const was = periscopeStats.open;
    const open = !ride.active && this.placer.eyesAt(3, was);
    periscopeStats.open = open;
    this.material.uniforms.uOpen.value = open ? 1 : 0;
    if (open !== was) console.info(`[Periscope] ${open ? 'open' : 'closed'}`);
    if (open) this.render();
  }

  private render(): void {
    const renderer = this.renderer;
    // The camera sits in the head: leave the turning part out of its picture.
    const cpu = renderScope(renderer, this.world.scene, this.camera3, this.target, [this.lens, this.turning], this.gpu);
    const s = periscopeStats;
    // The first render compiles the scene's shaders for the texture, so start averaging from the second.
    s.cpuMs = s.renders < 2 ? cpu : s.cpuMs * 0.9 + cpu * 0.1;
    s.calls = renderer.info.render.calls;
    s.triangles = renderer.info.render.triangles;
    s.renders++;
    s.lastRender = performance.now();
  }

  /**
   * Turn the periscope to `angle` (radians, positive left) unless a hand
   * holds it. The driver's page turns it; the other page asks that one.
   */
  turn(angle: number): void {
    if (!this.isOwner()) {
      netLink.sendEvent({ t: 'periscope-turn', angle } as { t: string });
      return;
    }
    if (!this.yoke.anyHeld) this.yoke.angle = angle;
    console.info(`[Periscope] turned ${bearingText(angle)}`);
  }

  setPower(power: PeriscopePower): void {
    periscopeStats.power = PERISCOPE_POWERS.includes(power) ? power : PERISCOPE_POWER;
    setLensMagnification(this.material, periscopeStats.power);
  }

  /**
   * Practice: sit the player in the driver's seat with their head just
   * behind the window, facing it. From the gunner's seat it waits for the
   * seat system to move them first (in a crew, the host swaps both).
   */
  goTo(): void {
    if (seating.mine === 'driver') {
      this.approach();
      return;
    }
    this.approachAfter = seating.placements;
    seating.ask('driver');
  }

  private approach(): void {
    const player = this.player;
    player.head.getWorldPosition(this.head);
    player.head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    const headYaw = Math.atan2(-this.forward.x, -this.forward.z);
    // The window faces straight back down the hull.
    const turn = -headYaw;
    turnAboutHead(player.position.x, player.position.z, this.head.x, this.head.z, turn, this.turned);
    player.rotateY(turn);
    player.position.x = this.turned[0];
    player.position.z = this.turned[1];
    this.placer.restAt(this.lensAt);
    player.position.x += this.lensAt.x - this.head.x;
    player.position.z += this.lensAt.z + APPROACH - this.head.z;
    console.info('[Periscope] player moved to the eyepiece');
  }

  /** 45 times a second, the driver's page sends where the periscope looks. */
  private send(delta: number): void {
    if (!netLink.connected) return;
    this.sendAccumulator += delta;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = Math.min(this.sendAccumulator - 1 / SEND_HZ, 1 / SEND_HZ);
    netLink.send(this.packet, encodePeriscopeState(this.packet, this.seq, performance.now(), this.yoke.angle));
    this.seq = (this.seq + 1) & 0xffff;
    this.sent++;
  }

  private onPacket(view: DataView): void {
    if (this.isOwner()) return;
    const angle = decodePeriscopeState(view, this.header);
    if (Number.isNaN(angle)) return;
    this.received++;
    this.shownAngle = angle;
  }

  /** For the tests: how much the brightness varies over nine texels across the picture's middle (0 for a blank one). */
  private pictureSpread(): number {
    let min = 255;
    let max = 0;
    for (let i = 0; i < 9; i++) {
      const x = Math.round(PICTURE_WIDTH * (0.1 + 0.1 * i));
      const y = Math.round(PICTURE_HEIGHT * (0.3 + 0.05 * i));
      this.renderer.readRenderTargetPixels(this.target, x, y, 1, 1, this.pixels.subarray(i * 4, i * 4 + 4));
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
