import { CanvasTexture, createSystem, type ShaderMaterial, SRGBColorSpace } from '@iwsdk/core';
import {
  gunTurn,
  hullOnMark,
  hullTurn,
  MARK_DRAWING,
  MARK_LAYERS,
  noseHour,
} from '../sim/hull-direction.js';
import { DIAL_HULL, yawForHour } from '../sim/turret-dial.js';
import { TURRET } from '../sim/cabin.js';
import { settings } from '../settings.js';
import { markDrawn, setMarkTurn, showMark } from './scope-lens.js';
import { traverseTo, turretState, turretTraversing } from './turret-system.js';

const DEG = Math.PI / 180;
/** Each of the mark texture's square layers, px. */
const LAYER_PX = 256;

/** The lenses that show the hull direction mark. */
export type MarkedLens = 'sight' | 'periscope';

interface Marked {
  material: ShaderMaterial;
  /** Which way this lens looks from the gun's line, radians, positive left: 0 for the gunsight, the periscope's own angle for the gunner's periscope. */
  fromGun: () => number;
  /** Whether its picture is showing. */
  open: () => boolean;
  /** Practice: put the player's eye to it (the gunsight's "Go to it"). */
  goTo?: () => void;
}

const marked = new Map<MarkedLens, Marked>();
let texture: CanvasTexture | null = null;
let users = 0;

/**
 * The hull direction mark's texture (F2.4), painted once and shared by
 * every lens that shows it; give it back with `releaseMarkTexture`.
 */
export function acquireMarkTexture(): CanvasTexture {
  users++;
  texture ??= paintMark();
  return texture;
}

export function releaseMarkTexture(): void {
  users = Math.max(0, users - 1);
  if (users === 0) {
    texture?.dispose();
    texture = null;
  }
}

/**
 * Show the hull direction mark on lens `id` (the gunsight, the gunner's
 * periscope): HullDirectionSystem turns it each frame. Returns the call
 * that stops it.
 */
export function markLens(id: MarkedLens, lens: Marked): () => void {
  marked.set(id, lens);
  return () => {
    if (marked.get(id) === lens) marked.delete(id);
  };
}

/**
 * Practice → Sights → Hull outline → Turret to `hour` o'clock (F2.4): the
 * player goes to the gunsight (alone, into the gunner's seat) and the
 * turret turns itself there, with a sign saying where the hull's nose
 * should show.
 */
export function hullToHour(hour: number): void {
  marked.get('sight')?.goTo?.();
  const yaw = yawForHour(hour);
  traverseTo(yaw, [
    `Turret to ${hour} o'clock`,
    'Lean in to the sight: the hull outline in its lower left',
    `turns its nose to ${noseHour(yaw)} o'clock. Forward turns it back`,
  ]);
}

interface HullDirectionDebug {
  /**
   * What each lens's mark shows: the hull's turn and the gun's as the shader
   * draws them (degrees anticlockwise), the hour the hull's nose is at,
   * whether the lens is open, and whether the Hull outline setting shows it.
   */
  state(): {
    shown: boolean;
    turretDeg: number;
    traversing: boolean;
    lenses: Record<string, { hullDeg: number; gunDeg: number; noseHour: number; open: boolean; shown: boolean }>;
  };
  /** Practice → Sights → Hull outline → Turret to `hour` (the shortcut's own sum). */
  toHour(hour: number): void;
}

/**
 * The hull direction mark in the gunner's sights (F2.4,
 * docs/hull-direction.md): a small round mark in the lower left of the
 * gunsight's and the gunner's periscope's view, the hull drawn from above
 * under a turret-and-gun pointer, the way the gunner looks always up it.
 * The lens's shader draws it over the picture (src/systems/scope-lens.ts);
 * each frame this turns the hull by the turret's angle as this page draws
 * it (plus the periscope's in the periscope) and the gun by the periscope's,
 * so both pages agree with nothing new sent. Runs after SightSystem and
 * PeriscopeSystem, which make the lenses; the lenses draw after every system.
 */
export class HullDirectionSystem extends createSystem({}) {
  init(): void {
    (window as unknown as { __hullDirection: HullDirectionDebug }).__hullDirection = {
      state: () => {
        const lenses: ReturnType<HullDirectionDebug['state']>['lenses'] = {};
        for (const [id, lens] of marked) {
          const drawn = markDrawn(lens.material);
          lenses[id] = {
            hullDeg: drawn.hull / DEG,
            gunDeg: drawn.gun / DEG,
            noseHour: noseHour(turretState().yaw + lens.fromGun()),
            open: lens.open(),
            shown: drawn.shown,
          };
        }
        return { shown: settings.hullmark, turretDeg: turretState().yaw / DEG, traversing: turretTraversing(), lenses };
      },
      toHour: (hour) => hullToHour(hour),
    };
  }

  update(): void {
    const yaw = turretState().yaw;
    const shown = settings.hullmark;
    for (const lens of marked.values()) {
      const fromGun = lens.fromGun();
      setMarkTurn(lens.material, hullTurn(yaw + fromGun), gunTurn(fromGun));
      showMark(lens.material, shown);
    }
  }
}

/**
 * The mark's texture: three square layers side by side (MARK_LAYERS,
 * src/sim/hull-direction.ts), each the mark's disc, y up: the face (a cream
 * disc a little see-through, a dark rim, a notch at the top for where one
 * looks), the hull from above nose up (the driver's dial's drawing, olive
 * with its tracks and the driver's hood, an arrowhead ahead of its nose), and the turret and its gun
 * pointing up in the dial's pointer orange.
 */
function paintMark(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LAYER_PX * MARK_LAYERS;
  canvas.height = LAYER_PX;
  const ctx = canvas.getContext('2d')!;
  const half = LAYER_PX / 2;
  const d = MARK_DRAWING;
  /** Mark units (1 = the edge, y up) in layer `layer` to canvas px. */
  const px = (layer: number, x: number) => layer * LAYER_PX + half + x * half;
  const py = (y: number) => half - y * half;
  const at: [number, number] = [0, 0];
  const hx = (x: number, z: number) => px(1, hullOnMark(x, z, at)[0]);
  const hy = (x: number, z: number) => py(hullOnMark(x, z, at)[1]);

  // The face: cream, a little see-through, a dark rim and a notch at the top.
  ctx.fillStyle = `rgba(239, 230, 200, ${d.opacity})`;
  ctx.beginPath();
  ctx.arc(px(0, 0), py(0), half * 0.98, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = '#1a1a14';
  ctx.lineWidth = half * (0.98 - d.rim);
  ctx.beginPath();
  ctx.arc(px(0, 0), py(0), half * ((0.98 + d.rim) / 2), 0, 2 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = '#1a1a14';
  ctx.beginPath();
  ctx.moveTo(px(0, -d.notch / 2), py(d.rim));
  ctx.lineTo(px(0, 0), py(d.rim - d.notch));
  ctx.lineTo(px(0, d.notch / 2), py(d.rim));
  ctx.closePath();
  ctx.fill();

  // The hull from above, nose up, as on the driver's dial (src/systems/turret-dial-system.ts).
  const h = DIAL_HULL;
  ctx.fillStyle = '#6b6b4c';
  for (const side of [-1, 1]) {
    const x0 = side * h.halfWidth;
    const x1 = side * h.trackHalfWidth;
    ctx.fillRect(Math.min(hx(x0, 0), hx(x1, 0)), hy(0, h.front), Math.abs(hx(x1, 0) - hx(x0, 0)), hy(0, h.rear) - hy(0, h.front));
  }
  ctx.fillStyle = '#8d8a62';
  ctx.strokeStyle = '#2b2a1c';
  ctx.lineWidth = 4;
  const nose = h.front + 0.5;
  ctx.beginPath();
  ctx.moveTo(hx(-h.halfWidth, nose), hy(0, nose));
  ctx.lineTo(hx(-h.halfWidth * 0.7, h.front), hy(0, h.front));
  ctx.lineTo(hx(h.halfWidth * 0.7, h.front), hy(0, h.front));
  ctx.lineTo(hx(h.halfWidth, nose), hy(0, nose));
  ctx.lineTo(hx(h.halfWidth, h.rear), hy(0, h.rear));
  ctx.lineTo(hx(-h.halfWidth, h.rear), hy(0, h.rear));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const hood = d.hood;
  ctx.fillStyle = '#2b2a1c';
  ctx.fillRect(hx(hood.x0, 0), hy(0, hood.z0), hx(hood.x1, 0) - hx(hood.x0, 0), hy(0, hood.z1) - hy(0, hood.z0));
  ctx.strokeStyle = '#2b2a1c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px(1, 0), py(0), TURRET.ringRadius * d.scale * half, 0, 2 * Math.PI);
  ctx.stroke();
  // An arrowhead ahead of the nose.
  ctx.beginPath();
  ctx.moveTo(px(1, -d.arrow.halfWidth), py(d.arrow.from));
  ctx.lineTo(px(1, 0), py(d.arrow.to));
  ctx.lineTo(px(1, d.arrow.halfWidth), py(d.arrow.from));
  ctx.closePath();
  ctx.fill();

  // The turret and its gun, up the mark.
  ctx.fillStyle = '#e8741c';
  ctx.strokeStyle = '#3a1d08';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px(2, 0), py(0), d.turretRadius * half, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  const w = d.gunWidth / 2;
  ctx.beginPath();
  ctx.rect(px(2, -w), py(d.gunReach), 2 * w * half, (d.gunReach - d.turretRadius * 0.5) * half);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(px(2, -w * 1.6), py(d.gunReach), 3.2 * w * half, 0.08 * half);
  ctx.fill();
  ctx.stroke();

  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}
