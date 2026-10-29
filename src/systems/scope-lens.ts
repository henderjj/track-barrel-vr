import {
  type Camera,
  LinearFilter,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from '@iwsdk/core';
import type { GpuTimer } from '../perf/gpu-timer.js';
import { HALF_IPD, lensSetback, sightOpen } from '../sim/sight.js';

/**
 * A magnified lens that shows a second camera's picture as an image at
 * infinity (spike S1's renderer, docs/spikes/s1-sight-render.md), shared by
 * the gunsight (F1.9) and the driver's periscope (F1.6). The owner makes a
 * render target, a lens mesh with this material, and a camera; while an eye
 * is at the lens (`eyesAtLens`) it renders the camera into the target
 * (`renderScope`) and the lens shows it.
 */

/** What a lens shows and how. */
export interface LensOptions {
  /** How much bigger things look through it. */
  magnification: number;
  /** Half the true field across and up, radians: the camera's picture covers it. */
  halfFieldX: number;
  halfFieldY: number;
  /** Ink drawn over the picture (its alpha is the ink), or null for none. */
  reticle: Texture | null;
  /** The field stop's shape: round (a gunsight's) or a rectangle (a periscope's window). */
  stop: 'round' | 'rectangle';
}

/** A render target for a lens's picture, `width` × `height` texels, with 4× multisampling. */
export function createScopeTarget(width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, { samples: 4, minFilter: LinearFilter, magFilter: LinearFilter });
  target.texture.colorSpace = SRGBColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

/** Change a lens's magnification (its picture's true field stays). */
export function setLensMagnification(material: ShaderMaterial, magnification: number): void {
  material.uniforms.uMagnification.value = magnification;
}

/**
 * Tell the lens's shader which eye is being drawn where each eye is drawn
 * in a pass of its own (no multiview), so it can be shown to one eye only.
 */
export function watchLensView(lens: Mesh, material: ShaderMaterial): void {
  const uniforms = material.uniforms;
  lens.onBeforeRender = (renderer, _scene, camera) => {
    const xr = renderer.xr;
    uniforms.uView.value = !xr.isPresenting ? -1 : camera === xr.getCamera().cameras[1] ? 1 : 0;
  };
}

// Scratch for LensPlacer, made once.
const headAt = new Vector3();
const headQuat = new Quaternion();
const right = new Vector3();
const restInverse = new Matrix4();

/**
 * Places a lens each frame for the eyes looking into it, and says whether
 * one of them is at it. The headset draws nothing closer than its 5 cm
 * near plane, and a seat's head box can let the head get closer than that
 * to the lens, which then vanished: the eye looked straight past it. So
 * with an eye close, the lens moves back along its axis to stay
 * LENS_MIN_GAP from the nearer eye (src/sim/sight.ts, lensSetback), drawn
 * over the eyepiece parts it is then behind. Its picture is at infinity, so
 * it looks the same.
 */
export class LensPlacer {
  /** The lens's middle and its inverse world matrix, as placed this frame. */
  readonly lensAt = new Vector3();
  readonly worldToLens = new Matrix4();
  /** How far the lens has moved back from where it rests, m. */
  setback = 0;
  private readonly rest: Vector3;
  /** Each eye (left, right) in the frame of the lens at rest: +Z towards the eye. */
  private readonly eyes = [new Vector3(), new Vector3()] as const;

  /** `lens` rests where it is now in its parent. */
  constructor(
    private readonly lens: Mesh,
    private readonly material: ShaderMaterial,
  ) {
    this.rest = lens.position.clone();
  }

  /** Find the eyes from `head`, move the lens back from the nearer of those in `mask` (1 left, 2 right) if need be, and tell the shader. */
  update(head: Object3D, mask: number): void {
    const lens = this.lens;
    lens.position.copy(this.rest);
    lens.updateWorldMatrix(true, false);
    restInverse.copy(lens.matrixWorld).invert();
    head.getWorldPosition(headAt);
    head.getWorldQuaternion(headQuat);
    right.set(1, 0, 0).applyQuaternion(headQuat);
    let nearest = Infinity;
    this.eyes.forEach((eye, i) => {
      eye.copy(headAt).addScaledVector(right, (i === 0 ? -1 : 1) * HALF_IPD).applyMatrix4(restInverse);
      if ((mask & (1 << i)) !== 0 && Math.hypot(eye.x, eye.y) < 0.1) nearest = Math.min(nearest, eye.z);
    });
    this.setback = lensSetback(nearest);
    if (this.setback > 0) {
      lens.translateZ(-this.setback);
      lens.updateWorldMatrix(false, false);
    }
    this.material.depthTest = this.setback === 0;
    lens.renderOrder = this.setback === 0 ? 0 : 10;
    lens.getWorldPosition(this.lensAt);
    this.worldToLens.copy(lens.matrixWorld).invert();
    this.material.uniforms.uWorldToLens.value.copy(this.worldToLens);
  }

  /**
   * Whether one of the eyes in `mask` is at the lens, measured from where it
   * rests, with its hysteresis (src/sim/sight.ts, sightOpen). Call after `update`.
   */
  eyesAt(mask: number, wasOpen: boolean): boolean {
    let open = false;
    this.eyes.forEach((eye, i) => {
      if ((mask & (1 << i)) !== 0) open ||= sightOpen(wasOpen, eye.length(), eye.z);
    });
    return open;
  }

  /** Where the lens rests, world space. */
  restAt(out: Vector3): Vector3 {
    const parent = this.lens.parent;
    out.copy(this.rest);
    return parent ? parent.localToWorld(out) : out;
  }
}

/**
 * Render `camera`'s view of `scene` into `target`, with `hidden` left out
 * (the lens itself, and whatever the camera sits inside), and put the
 * renderer back as it was. Returns the render call's main-thread time, ms.
 */
export function renderScope(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  target: WebGLRenderTarget,
  hidden: readonly (Object3D | null)[],
  gpu: GpuTimer | null,
): number {
  const xrEnabled = renderer.xr.enabled;
  const previous = renderer.getRenderTarget();
  // With XR on, render() would swap our camera for the headset's.
  renderer.xr.enabled = false;
  for (const o of hidden) if (o) o.visible = false;
  renderer.setRenderTarget(target);
  const start = performance.now();
  gpu?.begin();
  renderer.render(scene, camera);
  gpu?.end();
  const cpu = performance.now() - start;
  renderer.setRenderTarget(previous);
  renderer.xr.enabled = xrEnabled;
  for (const o of hidden) if (o) o.visible = true;
  return cpu;
}

/**
 * The lens: shows the camera's picture as an image at infinity
 * (src/sim/sight.ts, fieldPoint, does the same sums), the reticle over it,
 * a soft field stop at the edge, and dark glass while it is closed or for
 * an eye it isn't shown to.
 */
export function createLensMaterial(target: WebGLRenderTarget, options: LensOptions): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ScopeLens',
    defines: options.reticle ? { RETICLE: 1 } : {},
    uniforms: {
      uScene: { value: target.texture },
      uReticle: { value: options.reticle },
      uWorldToLens: { value: new Matrix4() },
      uMagnification: { value: options.magnification },
      uTanHalf: { value: new Vector2(Math.tan(options.halfFieldX), Math.tan(options.halfFieldY)) },
      uRect: { value: options.stop === 'rectangle' ? 1 : 0 },
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
      uniform vec2 uTanHalf;
      uniform float uRect;
      uniform float uOpen;
      uniform int uEyes;
      uniform int uView;
      varying vec3 vRay;
      void main() {
        vec3 d = normalize(vRay);
        float apparent = acos(clamp(-d.z, -1.0, 1.0));
        float across = length(d.xy);
        vec2 dir = across > 1e-6 ? d.xy / across : vec2(0.0);
        vec2 p = dir * tan(min(apparent / uMagnification, 1.5)) / uTanHalf;
        vec2 uv = p * 0.5 + 0.5;
        vec3 scene = texture2D(uScene, uv).rgb;
        #ifdef RETICLE
          float ink = texture2D(uReticle, uv).a;
        #else
          float ink = 0.0;
        #endif
        float edge = uRect > 0.5 ? max(abs(p.x), abs(p.y)) : length(p);
        vec3 picture = mix(scene, vec3(0.01), ink) * smoothstep(1.0, 0.94, edge);
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
