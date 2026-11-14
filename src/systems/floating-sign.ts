import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { settings } from '../settings.js';

/**
 * What a sign is for. A 'game' sign carries news of the fight or the drill
 * (a hit, an enemy firing, a track thrown): since the crew board (F6.5,
 * docs/crew-board.md) it goes on the board's calls instead, and floats in
 * front of the player only with the Pop-ups setting on. A 'setup' sign
 * (seating, calibration, how a station's controls work) always floats.
 */
export type SignKind = 'game' | 'setup';

/**
 * A canvas sign that floats in front of the player and follows their heading
 * slowly, so it stays readable without being stuck to their face. Drawn over
 * the scene so the scenery never hides it. The owner draws on `ctx` and calls
 * `refresh()`; `follow()` once a frame while it is visible.
 */
export class FloatingSign {
  readonly mesh: Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  private texture: CanvasTexture;
  private placed = false;
  /** Shown, as far as its owner and the tests are concerned; it is drawn only if its kind may float (`drawn`). */
  private shown = false;
  private kind: SignKind = 'setup';
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private scale = new Vector3();
  private forward = new Vector3();
  private target = new Vector3();

  /**
   * `widthM` is the sign's width in metres; `pixels` its canvas size.
   * `distance` how far ahead it floats and `drop` how far below eye level, m.
   */
  constructor(
    name: string,
    widthM: number,
    pixels: [number, number],
    private distance = 1.2,
    private drop = 0,
    private followRate = 3,
  ) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = pixels;
    this.width = pixels[0];
    this.height = pixels[1];
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: this.texture, toneMapped: false, depthTest: false, transparent: true });
    this.mesh = new Mesh(new PlaneGeometry(widthM, (widthM * pixels[1]) / pixels[0]), material);
    this.mesh.name = name;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    // Never in a ray's way: a sign floating between the player and the game menu would swallow its clicks.
    this.mesh.raycast = () => {};
  }

  /** Shown: its owner put it up and hasn't taken it down (whether or not it floats in view). */
  get visible(): boolean {
    return this.shown;
  }

  /** Floating in front of the player now. */
  get drawn(): boolean {
    return this.mesh.visible;
  }

  /**
   * Show or hide; a sign shown again appears straight in front of the
   * player. `kind` says what this showing is for (it stays until changed):
   * a 'game' sign floats only with the Pop-ups setting on.
   */
  setVisible(visible: boolean, kind?: SignKind): void {
    if (kind) this.kind = kind;
    this.shown = visible;
    this.place();
  }

  /** Float it or not, as shown and as the Pop-ups setting allows. */
  private place(): void {
    const floats = this.shown && (this.kind === 'setup' || settings.popups);
    if (floats !== this.mesh.visible) {
      this.mesh.visible = floats;
      this.placed = false;
    }
  }

  /** Upload what was drawn on `ctx`. */
  refresh(): void {
    this.texture.needsUpdate = true;
  }

  /** Move towards the spot in front of `head`, over `delta` seconds. */
  follow(head: Object3D, delta: number): void {
    // The Pop-ups setting can change while a sign is up.
    this.place();
    head.updateWorldMatrix(true, false);
    head.matrixWorld.decompose(this.headPos, this.headQuat, this.scale);
    // Level heading only, so looking down doesn't drag the sign into the floor.
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) {
      this.forward.set(0, 0, -1);
    }
    this.forward.normalize();
    this.target.copy(this.headPos).addScaledVector(this.forward, this.distance);
    this.target.y -= this.drop;
    if (this.placed) {
      this.mesh.position.lerp(this.target, Math.min(1, this.followRate * delta));
    } else {
      this.mesh.position.copy(this.target);
      this.placed = true;
    }
    this.mesh.lookAt(this.headPos.x, this.mesh.position.y, this.headPos.z);
  }
}

/** The house style for signs: dark wood with a brass edge. */
export function drawSignBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(43, 29, 18, 0.92)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#c9a03a';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);
}
