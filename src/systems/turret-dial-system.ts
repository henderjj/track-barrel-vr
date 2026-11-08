import { CanvasTexture, createSystem, Group, type Mesh, type MeshBasicMaterial, SRGBColorSpace } from '@iwsdk/core';
import { createDialPointer, createTurretDialFace } from '../scene-assets/turret-dial.scene-asset.js';
import { HULL, TURRET } from '../sim/cabin.js';
import { clockHour, DIAL_HULL, hourOnDial, hullOnDial, pointerAngle, TURRET_DIAL, yawForHour } from '../sim/turret-dial.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { traverseTo, turretState, turretTraversing } from './turret-system.js';

const DEG = Math.PI / 180;
/** The face's canvas, px square. */
const FACE_PX = 256;

/**
 * Practice → Lay the gun → To 3 o'clock (F2.3): alone, into the driver's
 * seat; then the turret turns itself to `hour` o'clock (the gunner's page
 * turns it; this one asks if it isn't the gunner's), with a sign saying to
 * watch the dial.
 */
export function turretToHour(hour: number): void {
  if (!netLink.connected) seating.ask('driver');
  traverseTo(yawForHour(hour), [`Turret to ${hour} o'clock`, 'Watch the dial right of the slit', 'Practice: Forward turns it back']);
}

interface TurretDialDebug {
  /** What the dial shows: the turret's angle (degrees, + left), the pointer's turn as drawn, and the clock hour it reads. */
  state(): { turretDeg: number; pointerDeg: number; hour: number; traversing: boolean };
  /** Practice → Turret to `hour` o'clock (the shortcut's own sum). */
  toHour(hour: number): void;
  /** The dial's face's middle in hull space, and which way it faces (a unit vector): for the test's camera. */
  readonly at: number[];
  readonly facing: number[];
}

/**
 * The driver's turret position dial (F2.3, docs/turret-dial.md): a round
 * dial on the hood's face right of the vision slit, with the hull drawn
 * from above, nose up, and a pointer shaped like the turret and its gun
 * turning over it as the turret turns. Its case is part of the hull's mesh;
 * this system places the face and pointer in it, paints the face once, and
 * turns the pointer each frame to the turret as this page draws it (the
 * gunner's own, or the gunner's packets, TurretSystem's `shown`), so both
 * pages agree with nothing new sent. Runs after TurretSystem.
 */
export class TurretDialSystem extends createSystem({}) {
  private pointer!: Mesh;
  private texture!: CanvasTexture;

  init(): void {
    const d = TURRET_DIAL;
    const mount = new Group();
    mount.name = 'Turret Dial';
    mount.position.set(d.x, d.y, d.z);
    mount.rotation.y = d.yaw;
    const face = createTurretDialFace();
    this.texture = paintFace();
    const material = face.material as MeshBasicMaterial;
    material.map = this.texture;
    material.color.setRGB(1, 1, 1);
    material.needsUpdate = true;
    mount.add(face);
    this.pointer = createDialPointer();
    mount.add(this.pointer);
    this.world.createTransformEntity(mount);
    this.cleanupFuncs.push(() => {
      this.texture.dispose();
      face.geometry.dispose();
      material.dispose();
      this.pointer.geometry.dispose();
    });

    const self = this;
    const facing = [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
    (window as unknown as { __turretDial: TurretDialDebug }).__turretDial = {
      state: () => {
        const yaw = turretState().yaw;
        return { turretDeg: yaw / DEG, pointerDeg: self.pointer.rotation.z / DEG, hour: clockHour(yaw), traversing: turretTraversing() };
      },
      toHour: (hour) => turretToHour(hour),
      at: [d.x, d.y, d.z],
      facing,
    };
  }

  update(): void {
    this.pointer.rotation.z = pointerAngle(turretState().yaw);
  }
}

/** The face, painted once: cream with the hull from above, nose up, its tracks either side, and the clock's hours round the rim. */
function paintFace(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_PX;
  canvas.height = FACE_PX;
  const ctx = canvas.getContext('2d')!;
  const px = FACE_PX / (2 * TURRET_DIAL.radius);
  const c = FACE_PX / 2;
  const at: [number, number] = [0, 0];
  /** A hull-space point to canvas px. */
  const X = (x: number, z: number) => c + hullOnDial(x, z, at)[0] * px;
  const Y = (x: number, z: number) => c - hullOnDial(x, z, at)[1] * px;

  ctx.fillStyle = '#efe6c8';
  ctx.fillRect(0, 0, FACE_PX, FACE_PX);
  ctx.strokeStyle = '#1a1a14';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(c, c, c - 3, 0, 2 * Math.PI);
  ctx.stroke();

  // The hull from above: the tracks either side, the body between, the nose's slope at the front.
  const h = DIAL_HULL;
  ctx.fillStyle = '#6b6b4c';
  for (const side of [-1, 1]) {
    const x0 = side * h.halfWidth;
    const x1 = side * h.trackHalfWidth;
    ctx.fillRect(Math.min(X(x0, 0), X(x1, 0)), Y(0, h.front), Math.abs(X(x1, 0) - X(x0, 0)), Y(0, h.rear) - Y(0, h.front));
  }
  ctx.fillStyle = '#8d8a62';
  ctx.strokeStyle = '#2b2a1c';
  ctx.lineWidth = 3;
  const nose = h.front + 0.5;
  ctx.beginPath();
  ctx.moveTo(X(-h.halfWidth, nose), Y(0, nose));
  ctx.lineTo(X(-h.halfWidth * 0.7, h.front), Y(0, h.front));
  ctx.lineTo(X(h.halfWidth * 0.7, h.front), Y(0, h.front));
  ctx.lineTo(X(h.halfWidth, nose), Y(0, nose));
  ctx.lineTo(X(h.halfWidth, h.rear), Y(0, h.rear));
  ctx.lineTo(X(-h.halfWidth, h.rear), Y(0, h.rear));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The driver's hood, front left, where the driver sits: a dark patch.
  ctx.fillStyle = '#2b2a1c';
  ctx.fillRect(X(-0.75, 0), Y(0, HULL.front + 0.2), X(-0.25, 0) - X(-0.75, 0), Y(0, -1.4) - Y(0, HULL.front + 0.2));
  // The turret ring the pointer turns on.
  ctx.strokeStyle = '#2b2a1c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, TURRET.ringRadius * h.scale * px, 0, 2 * Math.PI);
  ctx.stroke();

  // The hours: a tick for each, the four quarters numbered.
  ctx.strokeStyle = '#1a1a14';
  for (let hour = 1; hour <= 12; hour++) {
    const quarter = hour % 3 === 0;
    hourOnDial(hour, 0.93, at);
    const ox = c + at[0] * px;
    const oy = c - at[1] * px;
    hourOnDial(hour, quarter ? 0.8 : 0.85, at);
    ctx.lineWidth = quarter ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(c + at[0] * px, c - at[1] * px);
    ctx.stroke();
  }
  ctx.fillStyle = '#1a1a14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px sans-serif';
  for (const hour of [12, 3, 6, 9]) {
    hourOnDial(hour, 0.71, at);
    ctx.fillText(String(hour), c + at[0] * px, c - at[1] * px + 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
