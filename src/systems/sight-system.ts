import {
  CanvasTexture,
  createSystem,
  LinearFilter,
  Matrix4,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { GpuTimer } from '../perf/gpu-timer.js';
import { createSightEyepiece, createSightHead, createSightLensGeometry } from '../scene-assets/sight.scene-asset.js';
import { turnAboutHead } from '../sim/cabin.js';
import {
  type AimPoint,
  createLay,
  createSightError,
  EYEPIECE,
  layOn,
  onRangeAhead,
  OBJECTIVE,
  type SightError,
  sightError,
} from '../sim/gunsight.js';
import { RANGE_TARGETS, targetFace } from '../sim/range.js';
import {
  DRAW_MODES,
  type DrawMode,
  eyeMask,
  HALF_IPD,
  MAGNIFICATION,
  rangeMarks,
  SIGHT_EYES,
  SIGHT_SIZES,
  type SightEye,
  type SightSize,
  sightOpen,
  superelevation,
  TRUE_HALF_FIELD,
} from '../sim/sight.js';
import { groundHeight, wrapTile } from '../sim/terrain.js';
import { tankState } from './drive-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { gunEntity, layGun, ownsTurret, turretForward, turretState } from './turret-system.js';

/** The reticle's texture, texels square: finer than the view so its marks stay crisp at 256² and 512². */
const RETICLE_SIZE = 1024;
/** The sight camera's near and far planes, m: past the muzzle brake's reach beside it, and beyond the fog. */
const NEAR = 0.5;
const FAR = 1500;
/** How far behind the lens "Go to it" puts the head, m: lean in 6 cm and it opens. */
const APPROACH = 0.15;
/** Log the sight's cost this often while it renders, ms. */
const LOG_EVERY = 10000;

/** What the sight is doing, for the perf HUD and the tests. */
export const sightStats = {
  size: 512 as SightSize,
  mode: 'auto' as DrawMode,
  eye: 'both' as SightEye,
  /** An eye is at the eyepiece (or the mode is "always"). */
  open: false,
  /** Frames rendered since load. */
  renders: 0,
  /** When the last one was, performance.now() ms. */
  lastRender: 0,
  /** Main-thread time of the sight's render call, ms (smoothed). */
  cpuMs: 0,
  /** GPU time of the sight's render, ms (smoothed), or NaN where the browser has no timer queries. */
  gpuMs: Number.NaN,
  /** Draw calls and triangles in the sight's last render. */
  calls: 0,
  triangles: 0,
};

/** One line for the perf HUD: the sight's texture and its own cost while it renders. */
export function sightSummary(now: number): string {
  const s = sightStats;
  if (now - s.lastRender > 1000) {
    return `sight ${s.size}² ${s.mode === 'off' ? 'off' : 'closed'}`;
  }
  const gpu = Number.isNaN(s.gpuMs) ? '-' : `${s.gpuMs.toFixed(2)}`;
  return `sight ${s.size}² ${s.eye} cpu ${s.cpuMs.toFixed(2)} gpu ${gpu} ms ${s.calls} calls ${(s.triangles / 1000).toFixed(0)}k`;
}

/** What Practice can lay the gun on: straight ahead, or one of the range's targets (by its index in RANGE_TARGETS). */
export type SightAim = 'ahead' | number;

/** A Practice button in the game menu (public/ui/menu.uikitml): its id, its label now, what pressing it does, and whether it closes the menu. */
export interface PracticeButton {
  id: string;
  label: () => string;
  press: () => void;
  closes?: boolean;
}

let active: SightSystem | null = null;

const next = <T>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length];

/** One line for the menu: what the gun was last laid on from here, and which mark to read. */
export function sightStatus(): string {
  return active?.status ?? '';
}

/** The game menu's Practice buttons for the gunsight. */
export const SIGHT_BUTTONS: readonly PracticeButton[] = [
  { id: 'menu-sight-go', label: () => 'Go to it', press: () => active?.goTo(), closes: true },
  { id: 'menu-sight-lay-ahead', label: () => 'Ahead', press: () => active?.lay('ahead'), closes: true },
  ...RANGE_TARGETS.map((t, i): PracticeButton => ({ id: `menu-sight-lay-${i}`, label: () => `${t.range} m`, press: () => active?.lay(i), closes: true })),
  {
    id: 'menu-sight-draw',
    label: () => ({ auto: 'Draw: near', always: 'Draw: always', off: 'Draw: off' })[sightStats.mode],
    press: () => active?.setMode(next(DRAW_MODES, sightStats.mode)),
  },
  { id: 'menu-sight-size', label: () => `${sightStats.size}²`, press: () => active?.setSize(next(SIGHT_SIZES, sightStats.size)) },
  {
    id: 'menu-sight-eye',
    label: () => ({ both: 'Both eyes', left: 'Left eye', right: 'Right eye' })[sightStats.eye],
    press: () => active?.setEye(next(SIGHT_EYES, sightStats.eye)),
  },
];

interface SightDebug {
  state(): typeof sightStats & { aim: SightAim; status: string };
  goTo(): void;
  setMode(mode: DrawMode): void;
  setSize(size: SightSize): void;
  setEye(eye: SightEye): void;
  /** Lay the gun ahead, or on target `i` (its index in RANGE_TARGETS) from wherever the tank stands. */
  lay(aim: SightAim): void;
  /** Where target `i` sits from the mark for its range by the sums (the tank and turret as drawn), mils right and up, and its range. */
  error(i: number): SightError;
  /** The same, measured from the sight camera as it is drawn and the target as the ground draws it. */
  drawnError(i: number): SightError;
  /** The lens's middle and the way it faces (towards the eye), world space. */
  lens(): { at: number[]; facing: number[] };
  /** The sight camera's position and the way it looks, world space. */
  view(): { at: number[]; looking: number[] };
  /** Spread of the rendered picture's brightness in a few texels (0 for a blank picture). */
  pictureSpread(): number;
}

/**
 * The gunsight (F1.9, docs/gunsight.md), built on spike S1's renderer
 * (docs/spikes/s1-sight-render.md). An articulated sight: the eyepiece is
 * fixed in the turret where the seated gunner leans in to it, and the
 * objective rides on the gun beside the bore, so the sight looks wherever
 * the gun points while the eye stays put. Put an eye within about 9 cm of
 * the eyepiece and a camera at the objective renders the scene into a 512²
 * texture that the lens shows at 3×, with a reticle and range marks;
 * further away the lens is dark glass and nothing extra is drawn.
 *
 * The lens's shader turns each eye's ray into a true angle (src/sim/sight.ts)
 * so the picture sits at infinity for both eyes; it can be shown to one eye
 * only. Practice buttons go to the sight, lay the gun on each of the
 * range's targets from wherever the tank stands (on the page that owns the
 * turret; the other page asks it), and change when the sight draws, its
 * texture size and its eyes; the perf HUD shows its own cost. Nothing about
 * the sight goes over the network: each page draws its own view, and the
 * gun it follows is the turret's.
 */
export class SightSystem extends createSystem({}) {
  aim: SightAim = 'ahead';
  status = '';
  private eyepiece: Mesh | null = null;
  private lens!: Mesh;
  private gun: Object3D | null = null;
  private ground: Object3D | null = null;
  private material!: ShaderMaterial;
  private camera3 = new PerspectiveCamera((2 * TRUE_HALF_FIELD * 180) / Math.PI, 1, NEAR, FAR);
  private target!: WebGLRenderTarget;
  private reticle!: CanvasTexture;
  private gpu: GpuTimer | null = null;
  private lastLog = 0;
  private head = new Vector3();
  private headQuat = new Quaternion();
  private right = new Vector3();
  private eye = new Vector3();
  private lensAt = new Vector3();
  private lensQuat = new Quaternion();
  private local = new Vector3();
  private worldToLens = new Matrix4();
  private forward = new Vector3();
  private turned: [number, number] = [0, 0];
  private laid = createLay();
  private pixels = new Uint8Array(4 * 9);
  /** "Go to it" is waiting for the seat system to sit the player in the gunner's seat (the placement count it waits to pass), or -1. */
  private approachAfter = -1;

  init(): void {
    active = this;
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
    });

    this.target = this.createTarget(sightStats.size);
    this.reticle = createReticle();
    this.material = createLensMaterial(this.target, this.reticle);
    this.lens = new Mesh(createSightLensGeometry(), this.material);
    this.lens.name = 'Sight Lens';
    const uniforms = this.material.uniforms;
    // Which eye is being drawn, where each eye is drawn in a pass of its own (no multiview).
    this.lens.onBeforeRender = (renderer, _scene, camera) => {
      const xr = renderer.xr;
      uniforms.uView.value = !xr.isPresenting ? -1 : camera === xr.getCamera().cameras[1] ? 1 : 0;
    };

    // The eyepiece half is fixed in the turret; the objective half and the camera ride on the gun (TurretSystem makes it, before this).
    const turret = this.world.getSceneEntity('turret');
    const gun = gunEntity();
    if (turret == null || gun == null) {
      console.warn('[Sight] no turret or gun in the scene: the gunsight is missing');
    } else {
      this.eyepiece = createSightEyepiece();
      this.eyepiece.position.set(EYEPIECE[0], EYEPIECE[1], EYEPIECE[2]);
      const eyepieceEntity = this.world.createTransformEntity(this.eyepiece, { parent: turret });
      this.world.createTransformEntity(this.lens, { parent: eyepieceEntity });
      this.world.createTransformEntity(createSightHead(), { parent: gun });
      this.gun = gun.object3D ?? null;
      this.camera3.position.set(OBJECTIVE[0], OBJECTIVE[1], OBJECTIVE[2]);
      this.gun?.add(this.camera3);
    }
    this.ground = this.world.getSceneEntity('ground')?.object3D ?? null;

    netLink.events.set('sight-lay', (event) => {
      const aim = (event as { aim?: unknown }).aim;
      if (ownsTurret() && (aim === 'ahead' || (typeof aim === 'number' && RANGE_TARGETS[aim] != null))) this.lay(aim);
    });
    this.cleanupFuncs.push(() => netLink.events.delete('sight-lay'));

    const gl = this.renderer.getContext();
    if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
      this.gpu = new GpuTimer(gl);
    }
    this.cleanupFuncs.push(() => {
      this.target.dispose();
      this.reticle.dispose();
      this.material.dispose();
      this.lens.geometry.dispose();
      this.gpu?.dispose();
    });
    this.setEye(sightStats.eye);

    (window as unknown as { __sight: SightDebug }).__sight = {
      state: () => ({ ...sightStats, aim: this.aim, status: this.status }),
      goTo: () => this.goTo(),
      setMode: (mode) => this.setMode(mode),
      setSize: (size) => this.setSize(size),
      setEye: (eye) => this.setEye(eye),
      lay: (aim) => this.lay(aim),
      error: (i) => {
        const t = turretState();
        return sightError(tankState(), t.yaw, t.elevation, aimPoint(i), createSightError());
      },
      drawnError: (i) => this.drawnError(i),
      lens: () => {
        this.lens.getWorldPosition(this.lensAt);
        this.lens.getWorldQuaternion(this.lensQuat);
        return { at: this.lensAt.toArray(), facing: new Vector3(0, 0, 1).applyQuaternion(this.lensQuat).toArray() };
      },
      view: () => {
        this.camera3.updateWorldMatrix(true, false);
        return {
          at: new Vector3().setFromMatrixPosition(this.camera3.matrixWorld).toArray(),
          looking: this.camera3.getWorldDirection(new Vector3()).toArray(),
        };
      },
      pictureSpread: () => this.pictureSpread(),
    };
  }

  update(): void {
    if (this.approachAfter >= 0 && seating.mine === 'gunner' && seating.placements > this.approachAfter) {
      this.approachAfter = -1;
      this.approach();
    }
    this.gpu?.poll();
    if (this.gpu && !Number.isNaN(this.gpu.ms)) {
      sightStats.gpuMs = Number.isNaN(sightStats.gpuMs) ? this.gpu.ms : sightStats.gpuMs * 0.9 + this.gpu.ms * 0.1;
    }
    if (this.eyepiece == null) return;

    this.lens.updateWorldMatrix(true, false);
    this.lens.getWorldPosition(this.lensAt);
    this.worldToLens.copy(this.lens.matrixWorld).invert();
    this.material.uniforms.uWorldToLens.value.copy(this.worldToLens);

    const was = sightStats.open;
    const open = sightStats.mode === 'always' || (sightStats.mode === 'auto' && this.eyeAtEyepiece(was));
    sightStats.open = open;
    this.material.uniforms.uOpen.value = open ? 1 : 0;
    if (open !== was) {
      console.info(`[Sight] ${open ? 'open' : 'closed'}`);
    }
    if (open) {
      this.renderSight();
    }
  }

  /** Whether one of the eyes the sight shows to is at the eyepiece, with the lens's hysteresis. */
  private eyeAtEyepiece(wasOpen: boolean): boolean {
    const head = this.player.head;
    head.getWorldPosition(this.head);
    head.getWorldQuaternion(this.headQuat);
    this.right.set(1, 0, 0).applyQuaternion(this.headQuat);
    const mask = this.material.uniforms.uEyes.value as number;
    let open = false;
    for (const [bit, side] of [[1, -1], [2, 1]] as const) {
      if ((mask & bit) === 0) {
        continue;
      }
      this.eye.copy(this.head).addScaledVector(this.right, side * HALF_IPD);
      const distance = this.eye.distanceTo(this.lensAt);
      this.local.copy(this.eye).applyMatrix4(this.worldToLens);
      open ||= sightOpen(wasOpen, distance, this.local.z);
    }
    return open;
  }

  private renderSight(): void {
    const renderer = this.renderer;
    const xrEnabled = renderer.xr.enabled;
    const previous = renderer.getRenderTarget();
    // With XR on, render() would swap our camera for the headset's.
    renderer.xr.enabled = false;
    this.lens.visible = false;
    // The barrel runs alongside the objective: leave the gun out of its own sight's picture.
    const gun = this.gun;
    if (gun) gun.visible = false;
    renderer.setRenderTarget(this.target);
    const start = performance.now();
    this.gpu?.begin();
    renderer.render(this.world.scene, this.camera3);
    this.gpu?.end();
    const cpu = performance.now() - start;
    renderer.setRenderTarget(previous);
    renderer.xr.enabled = xrEnabled;
    this.lens.visible = true;
    if (gun) gun.visible = true;

    // The first render compiles the scene's shaders for the texture, so start averaging from the second.
    sightStats.cpuMs = sightStats.renders < 2 ? cpu : sightStats.cpuMs * 0.9 + cpu * 0.1;
    sightStats.calls = renderer.info.render.calls;
    sightStats.triangles = renderer.info.render.triangles;
    sightStats.renders++;
    const now = performance.now();
    sightStats.lastRender = now;
    if (now - this.lastLog > LOG_EVERY) {
      this.lastLog = now;
      console.info(
        `[Sight] ${sightStats.size}² ${MAGNIFICATION}× ${sightStats.eye}: cpu ${sightStats.cpuMs.toFixed(2)} ms, gpu ${Number.isNaN(sightStats.gpuMs) ? '-' : sightStats.gpuMs.toFixed(2) + ' ms'}, ${sightStats.calls} calls, ${sightStats.triangles} tris`,
      );
    }
  }

  /**
   * Practice: sit the player in the gunner's seat with their head just
   * behind the eyepiece, facing along the sight. From the driver's seat it
   * waits for the seat system to move them first (in a crew, the host swaps
   * both players).
   */
  goTo(): void {
    if (seating.mine === 'gunner') {
      this.approach();
      return;
    }
    this.approachAfter = seating.placements;
    seating.ask('gunner');
  }

  private approach(): void {
    const player = this.player;
    player.head.getWorldPosition(this.head);
    player.head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    const headYaw = Math.atan2(-this.forward.x, -this.forward.z);
    // The eyepiece faces straight back down the turret.
    const yaw = seating.turretYaw;
    const turn = yaw - headYaw;
    turnAboutHead(player.position.x, player.position.z, this.head.x, this.head.z, turn, this.turned);
    player.rotateY(turn);
    player.position.x = this.turned[0];
    player.position.z = this.turned[1];
    this.lens.getWorldPosition(this.lensAt);
    player.position.x += this.lensAt.x + Math.sin(yaw) * APPROACH - this.head.x;
    player.position.z += this.lensAt.z + Math.cos(yaw) * APPROACH - this.head.z;
    console.info('[Sight] player moved to the eyepiece');
  }

  /**
   * Practice: lay the gun straight ahead, or on target `aim` so it sits on
   * the reticle's mark for its range, from wherever the tank stands now.
   * The page that owns the turret lays it; the other asks that one.
   */
  lay(aim: SightAim): void {
    this.aim = aim === 'ahead' || RANGE_TARGETS[aim] == null ? 'ahead' : aim;
    if (!ownsTurret()) {
      netLink.sendEvent({ t: 'sight-lay', aim: this.aim } as { t: string });
      this.status = 'Asked the gunner to lay';
      return;
    }
    if (this.aim === 'ahead') {
      turretForward();
      this.status = 'Laid straight ahead';
    } else {
      const lay = layOn(tankState(), aimPoint(this.aim), this.laid);
      layGun(lay.yaw, lay.elevation);
      const range = Math.round(lay.range / 10) * 10;
      this.status = lay.limited
        ? `The ${RANGE_TARGETS[this.aim].range} m target is out of the gun's reach`
        : `Laid on the ${RANGE_TARGETS[this.aim].range} m target, ${range} m off: read the ${range} m mark`;
    }
    console.info(`[Sight] ${this.status}`);
  }

  /** Target `i` as the ground draws it and the sight camera sees it, against the mark for its range. */
  private drawnError(i: number): SightError {
    const out = createSightError();
    const ground = this.ground;
    if (ground == null) return out;
    const s = tankState();
    const p = onRangeAhead(s, aimPoint(i), { x: 0, above: 0, z: 0 });
    // The ground's own space is world space less whole tiles round the tank (DriveSystem).
    const x = wrapTile(s.x) + p.x - s.x;
    const z = wrapTile(s.z) + p.z - s.z;
    ground.updateWorldMatrix(true, false);
    this.camera3.updateWorldMatrix(true, false);
    const at = ground.localToWorld(new Vector3(x, groundHeight(p.x, p.z) + p.above, z));
    const seen = this.camera3.worldToLocal(at);
    out.range = seen.length();
    out.across = Math.atan2(seen.x, -seen.z) * 1000;
    out.up = (Math.atan2(seen.y, Math.hypot(seen.x, seen.z)) + superelevation(out.range)) * 1000;
    return out;
  }

  setMode(mode: DrawMode): void {
    sightStats.mode = DRAW_MODES.includes(mode) ? mode : 'auto';
    console.info(`[Sight] draw ${sightStats.mode}`);
  }

  setSize(size: SightSize): void {
    if (!SIGHT_SIZES.includes(size) || size === sightStats.size) {
      return;
    }
    sightStats.size = size;
    this.target.setSize(size, size);
    console.info(`[Sight] ${size}²`);
  }

  setEye(eye: SightEye): void {
    sightStats.eye = SIGHT_EYES.includes(eye) ? eye : 'both';
    this.material.uniforms.uEyes.value = eyeMask(sightStats.eye);
  }

  private createTarget(size: number): WebGLRenderTarget {
    const target = new WebGLRenderTarget(size, size, { samples: 4, minFilter: LinearFilter, magFilter: LinearFilter });
    target.texture.colorSpace = SRGBColorSpace;
    target.texture.generateMipmaps = false;
    return target;
  }

  /** For the tests: how much the brightness varies over nine texels across the picture's middle (0 for a blank one). */
  private pictureSpread(): number {
    const size = sightStats.size;
    let min = 255;
    let max = 0;
    for (let i = 0; i < 9; i++) {
      const x = Math.round(size * (0.1 + 0.1 * i));
      const y = Math.round(size * (0.3 + 0.05 * i));
      this.renderer.readRenderTargetPixels(this.target, x, y, 1, 1, this.pixels.subarray(i * 4, i * 4 + 4));
      const v = this.pixels[i * 4] + this.pixels[i * 4 + 1] + this.pixels[i * 4 + 2];
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return max - min;
  }
}

/** The middle of target `i`'s face, to lay on. */
function aimPoint(i: number): AimPoint {
  const face = targetFace(i);
  return { x: face.x, above: face.y, z: face.z };
}

/** The reticle: an aiming chevron, lead marks either side and the range marks below, black on clear. */
function createReticle(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = RETICLE_SIZE;
  canvas.height = RETICLE_SIZE;
  const ctx = canvas.getContext('2d')!;
  const half = RETICLE_SIZE / 2;
  /** Field units (1 = the edge, y up) to canvas pixels. */
  const px = (x: number) => half + x * half;
  const py = (y: number) => half - y * half;
  const mrad = half / (Math.tan(TRUE_HALF_FIELD) * 1000);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineCap = 'round';

  // The aiming chevron, its point on the gun's line, 4 mils across.
  ctx.lineWidth = 4;
  chevron(ctx, px(0), py(0), 2 * mrad);
  // Lead marks every 4 mils either side: smaller chevrons.
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    for (let k = 1; k <= 4; k++) {
      chevron(ctx, px(0) + side * k * 4 * mrad, py(0), mrad);
    }
  }
  // Range marks below the chevron, right of a stem from it: long and
  // labelled in hundreds of metres every 200 m. At 600 m/s they are only
  // about 1.4 mils per 100 m apart, so the labels are only as tall as the
  // gap between two long marks allows.
  const marks = rangeMarks();
  const last = marks[marks.length - 1];
  const gap = (marks[1].drop - marks[0].drop) * half;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(px(0), py(0) + 3 * mrad);
  ctx.lineTo(px(0), py(-last.drop));
  ctx.stroke();
  ctx.font = `bold ${Math.round(Math.min(7 * mrad, gap * 1.8))}px sans-serif`;
  ctx.textBaseline = 'middle';
  for (const mark of marks) {
    const y = py(-mark.drop);
    const length = (mark.major ? 5 : 2.5) * mrad;
    ctx.lineWidth = mark.major ? 3 : 2.5;
    ctx.beginPath();
    ctx.moveTo(px(0), y);
    ctx.lineTo(px(0) + length, y);
    ctx.stroke();
    if (mark.major) {
      ctx.fillText(`${mark.range / 100}`, px(0) + length + mrad, y);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A chevron (an upturned V) with its point at x, y and arms `size` px out and down. */
function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x - size, y + size);
  ctx.lineTo(x, y);
  ctx.lineTo(x + size, y + size);
  ctx.stroke();
}

/**
 * The lens: shows the sight camera's picture as an image at infinity
 * (src/sim/sight.ts, fieldPoint, does the same sums), the reticle over it,
 * a soft field stop at the edge, and dark glass while the sight is closed
 * or for an eye it isn't shown to.
 */
function createLensMaterial(target: WebGLRenderTarget, reticle: CanvasTexture): ShaderMaterial {
  return new ShaderMaterial({
    name: 'SightLens',
    uniforms: {
      uScene: { value: target.texture },
      uReticle: { value: reticle },
      uWorldToLens: { value: new Matrix4() },
      uMagnification: { value: MAGNIFICATION },
      uTanHalfField: { value: Math.tan(TRUE_HALF_FIELD) },
      uOpen: { value: 0 },
      uEyes: { value: 3 },
      uView: { value: -1 },
    },
    vertexShader: /* glsl */ `
      uniform mat4 uWorldToLens;
      varying vec3 vRay;
      void main() {
        // This view's eye, from its view matrix (one per eye under multiview).
        vec3 eye = -transpose(mat3(viewMatrix)) * viewMatrix[3].xyz;
        vec3 eyeLocal = (uWorldToLens * vec4(eye, 1.0)).xyz;
        vRay = position - eyeLocal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScene;
      uniform sampler2D uReticle;
      uniform float uMagnification;
      uniform float uTanHalfField;
      uniform float uOpen;
      uniform int uEyes;
      uniform int uView;
      varying vec3 vRay;
      void main() {
        vec3 d = normalize(vRay);
        float apparent = acos(clamp(-d.z, -1.0, 1.0));
        float across = length(d.xy);
        vec2 dir = across > 1e-6 ? d.xy / across : vec2(0.0);
        vec2 p = dir * tan(min(apparent / uMagnification, 1.5)) / uTanHalfField;
        vec2 uv = p * 0.5 + 0.5;
        vec3 scene = texture2D(uScene, uv).rgb;
        float ink = texture2D(uReticle, uv).a;
        vec3 picture = mix(scene, vec3(0.01), ink) * smoothstep(1.0, 0.94, length(p));
        #ifdef VIEW_ID
          int view = int(VIEW_ID);
        #else
          int view = uView;
        #endif
        bool shown = uOpen > 0.5 && (view < 0 || (uEyes & (1 << view)) != 0);
        vec3 glass = vec3(0.012, 0.02, 0.026) + 0.04 * pow(1.0 - abs(d.z), 3.0);
        gl_FragColor = vec4(shown ? picture : glass, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
