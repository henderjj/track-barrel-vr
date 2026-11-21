import { CanvasTexture, createSystem, type Entity, Group, Matrix4, type Mesh, type MeshBasicMaterial, Quaternion, SRGBColorSpace, Vector3, VisibilityState } from '@iwsdk/core';
import { FIST_AXIS, FIST_CENTRE } from '../scene-assets/hand.scene-asset.js';
import { createMapCase, createMapSheet } from '../scene-assets/map-case.scene-asset.js';
import { contours, FIELD_MAP, gridLines, gridRef, type MapFeature, mapFeatures, MAP_HEIGHT, MAP_WIDTH, sampleGround } from '../sim/field-map.js';
import { canGrab, CASE_CLIPPED, clippedPose, createHeldPose, type HeldPose, heldPose, SPRING_BACK, TO_HAND } from '../sim/map-case.js';
import type { MapMark } from '../sim/map-marks.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { grip, handUse } from './grip-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { HoldKind } from './hand-lock.js';

/** The map case's `handUse` name; holdKindOf maps it to HoldKind.MapCase. */
export const MAP_USE = 'map-case';
/** The painted map, px square. */
const MAP_PX = 2048;
/** On a PC page, G holds the map up this far in front of the eyes, m. */
const FLAT_AWAY = 0.42;
const SIGN_SECONDS = 8;

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];

/** Who holds the case this frame: this player's hand, the crewmate's, held up on a PC page, or nobody (on its clips, or springing back to them). */
type Holder = Side | 'crew-left' | 'crew-right' | 'flat' | null;

let active: MapCaseSystem | null = null;

/** The marks the map shows (F2.11, MapMarksSystem), and their version: the sheet is painted again when it changes. */
let shownMarks: readonly MapMark[] = [];
let marksVersion = 0;

/** Show these marks on the map (MapMarksSystem, on every change of the book). */
export function showMapMarks(marks: readonly MapMark[]): void {
  shownMarks = marks.map((m) => ({ ...m }));
  marksVersion++;
}

/** A map-reading checkpoint as the map shows it (F2.12, NavCourseSystem): a red circle, numbered, ticked once reached. */
export interface MapCheckpoint {
  x: number;
  z: number;
  n: number;
  done: boolean;
}

let shownCheckpoints: readonly MapCheckpoint[] = [];

/** Show these checkpoints on the map (NavCourseSystem, on every change of the run); none clears them. */
export function showMapCheckpoints(cps: readonly MapCheckpoint[]): void {
  shownCheckpoints = cps.map((c) => ({ ...c }));
  marksVersion++;
}

/** Practice → Commander → Read the map (F2.10): into the gunner's seat, with a sign saying where the map case is. */
export function readTheMap(): void {
  active?.practice();
}

interface MapCaseDebug {
  /** Who holds it, whether it is on its clips, its middle and the way its face looks (turret space), how square its face is to this player's eyes (1 square on), and the sign. */
  state(): { holder: Holder; clipped: boolean; centre: number[]; facing: number[]; facesEyes: number; sign: string; lastSign: string; checkpoints: MapCheckpoint[] };
  /** The middle of the case on its clips, `out` m in front of its face, scene space (with the turret as drawn): where a hand goes to take it. */
  at(out?: number): number[];
  /** Hold it up in front of the eyes on a PC page (G), or put it back. */
  holdUp(on: boolean): void;
  /** A map reference for a world point, as the map's grid gives it. */
  gridRef(x: number, z: number, figures?: 4 | 6): string;
  /** The painted map, as a PNG data URL. */
  image(): string;
}

/**
 * The commander's map case (F2.10, docs/map-case.md): the field map
 * (src/sim/field-map.ts), painted once, in a leather case clipped to the
 * turret's right wall behind the gunner. A hand that squeezes at it takes
 * it, held by its edge with its face to the eyes and turned by the wrist's
 * roll; let go, it springs back to its clips. The crewmate's page draws it
 * in their hand from the hand they hold it in (`HoldKind.MapCase` in the
 * pose packet) and their head, so nothing new is sent. On a PC page G holds
 * it up in front of the eyes. Runs after TurretSystem (the turret's turn
 * this frame) and before OwnHandsSystem.
 */
export class MapCaseSystem extends createSystem({}) {
  private texture!: CanvasTexture;
  /** The map as painted at load, and the sheet shown: the map with the marks over it (F2.11). */
  private base!: HTMLCanvasElement;
  private canvas!: HTMLCanvasElement;
  private paintedMarks = -1;
  private group = new Group();
  private caseMesh!: Mesh;
  private sheet!: Mesh;
  private turret: Entity | null = null;
  private holder: Holder = null;
  private wasPressed: Record<Side, boolean> = { left: false, right: false };
  private flat = false;
  private keyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'g' && !event.repeat && this.world.visibilityState.peek() === VisibilityState.NonImmersive) this.flat = !this.flat;
  };
  /** Blending from `from` (turret space) to where it should be, over `blendTime` s; 1 when there. */
  private blend = 1;
  private blendTime = SPRING_BACK;
  private fromPos = new Vector3();
  private fromQuat = new Quaternion();
  private target: HeldPose = createHeldPose();
  private axisU = new Vector3();
  private axisV = new Vector3();
  private axisW = new Vector3();
  private toTurret = new Matrix4();
  private basis = new Matrix4();
  private tmpPos = new Vector3();
  private tmpQuat = new Quaternion();
  private tmpVec = new Vector3();
  private fist: [number, number, number] = [0, 0, 0];
  private axis: [number, number, number] = [0, 0, 0];
  private eyes: [number, number, number] = [0, 0, 0];
  private goalPos = new Vector3();
  private goalQuat = new Quaternion();
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;

  init(): void {
    active = this;
    this.base = paintFieldMap();
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_PX;
    this.canvas.height = MAP_PX;
    this.canvas.getContext('2d')!.drawImage(this.base, 0, 0);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.caseMesh = createMapCase();
    this.sheet = createMapSheet();
    const material = this.sheet.material as MeshBasicMaterial;
    material.map = this.texture;
    material.needsUpdate = true;
    this.group.name = 'Map Case Mount';
    this.group.add(this.caseMesh, this.sheet);
    this.turret = this.world.getSceneEntity('turret') ?? null;
    clippedPose(this.target);
    this.place(this.target);
    if (this.turret) this.world.createTransformEntity(this.group, { parent: this.turret });
    else {
      console.warn('[MapCase] no turret in the scene');
      this.world.createTransformEntity(this.group);
    }
    this.sign = new FloatingSign('Map Case Sign', 0.75, [600, 200], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);
    window.addEventListener('keydown', this.keyDown);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', this.keyDown);
      this.texture.dispose();
      this.caseMesh.geometry.dispose();
      this.sheet.geometry.dispose();
      material.dispose();
      for (const side of SIDES) if (handUse[side] === MAP_USE) handUse[side] = null;
      if (active === this) active = null;
    });

    const self = this;
    (window as unknown as { __mapCase: MapCaseDebug }).__mapCase = {
      state: () => {
        const p = self.group.position;
        const f = new Vector3(0, 0, 1).applyQuaternion(self.group.quaternion);
        const eyes = new Vector3();
        (self.world.visibilityState.peek() !== VisibilityState.NonImmersive ? self.player.head : self.camera).getWorldPosition(eyes);
        if (self.turret) eyes.applyMatrix4(self.turret.object3D!.matrixWorld.clone().invert());
        const toEyes = eyes.sub(p).normalize();
        return {
          holder: self.holder,
          clipped: self.holder === null && self.blend >= 1,
          centre: [p.x, p.y, p.z],
          facing: [f.x, f.y, f.z],
          facesEyes: f.dot(toEyes),
          sign: self.sign.visible ? self.signText : '',
          lastSign: self.signText,
          checkpoints: self.paintedMarks === marksVersion ? shownCheckpoints.map((c) => ({ ...c })) : [],
        };
      },
      at: (out = 0) => {
        const t = self.turret?.object3D;
        const v = new Vector3(CASE_CLIPPED.x - out, CASE_CLIPPED.y, CASE_CLIPPED.z);
        if (t) {
          t.updateMatrixWorld(true);
          v.applyMatrix4(t.matrixWorld);
        }
        return [v.x, v.y, v.z];
      },
      holdUp: (on) => {
        self.flat = on;
      },
      gridRef: (x, z, figures) => gridRef(x, z, figures),
      image: () => self.canvas.toDataURL('image/png'),
    };
  }

  practice(): void {
    if (!netLink.connected) seating.ask('gunner');
    const vr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.say('Read the map', vr ? 'Map case on the wall behind your right shoulder: squeeze to take it' : 'G: hold the map up, G again to put it back',
      'North is up; the grid is 100 m squares');
  }

  update(delta: number): void {
    this.time += delta;
    if (marksVersion !== this.paintedMarks) this.paintMarks();
    const turret = this.turret?.object3D;
    if (!turret) return;
    turret.updateMatrixWorld();
    this.toTurret.copy(turret.matrixWorld).invert();
    const vr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (vr) this.flat = false;

    // This player's hands: take it with a squeeze at it, let go to put it back.
    let holder: Holder = this.holder === 'left' || this.holder === 'right' ? this.holder : null;
    for (const side of SIDES) {
      const pressed = grip[side].pressed;
      const down = pressed && !this.wasPressed[side];
      this.wasPressed[side] = pressed;
      if (holder === side && !pressed) holder = null;
      if (holder === null && down && handUse[side] === null && vr && this.input.xr.gamepads[side] && this.fistInTurret(side) && canGrab(this.fist)) holder = side;
    }
    for (const side of SIDES) {
      if (holder === side) handUse[side] = MAP_USE;
      else if (handUse[side] === MAP_USE) handUse[side] = null;
    }
    if (holder === null && this.flat) holder = 'flat';
    // Else the crewmate's hand, as their pose packets say.
    if (holder === null && netLink.connected && netLink.haveRemote) {
      const holds = netLink.remote.holds;
      if ((holds & 15) === HoldKind.MapCase) holder = 'crew-left';
      else if (((holds >> 4) & 15) === HoldKind.MapCase) holder = 'crew-right';
    }
    if (holder !== this.holder) {
      // Blend from where it is drawn now: to the hand quickly, back to the clips more slowly.
      this.fromPos.copy(this.group.position);
      this.fromQuat.copy(this.group.quaternion);
      this.blend = 0;
      this.blendTime = holder === null ? SPRING_BACK : TO_HAND;
      this.holder = holder;
    }

    if (holder === null) clippedPose(this.target);
    else this.heldTarget(holder);
    this.blend = Math.min(1, this.blend + delta / this.blendTime);
    this.toGoal(this.target);
    if (this.blend >= 1) {
      this.group.position.copy(this.goalPos);
      this.group.quaternion.copy(this.goalQuat);
    } else {
      const t = smooth(this.blend);
      this.group.position.copy(this.fromPos).lerp(this.goalPos, t);
      this.group.quaternion.copy(this.fromQuat).slerp(this.goalQuat, t);
    }

    if (this.sign.visible) {
      if (this.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(vr ? this.player.head : this.camera, delta);
    }
  }

  /** The middle of this player's fist and the handle's way through it, turret space, into `fist` and `axis`; false with no hand. */
  private fistInTurret(side: Side): boolean {
    const space = this.player.gripSpaces[side];
    if (!space) return false;
    space.updateWorldMatrix(true, false);
    space.getWorldPosition(this.tmpPos);
    space.getWorldQuaternion(this.tmpQuat);
    this.fistFrom(side, this.tmpPos, this.tmpQuat);
    return true;
  }

  /** From a grip pose in scene space: the fist's middle and the handle's way, turret space. */
  private fistFrom(side: Side, pos: Vector3, quat: Quaternion): void {
    const m = side === 'left' ? -1 : 1;
    this.tmpVec.set(FIST_CENTRE[0] * m, FIST_CENTRE[1], FIST_CENTRE[2]).applyQuaternion(quat).add(pos).applyMatrix4(this.toTurret);
    this.fist[0] = this.tmpVec.x;
    this.fist[1] = this.tmpVec.y;
    this.fist[2] = this.tmpVec.z;
    this.tmpVec.set(FIST_AXIS[0] * m, FIST_AXIS[1], FIST_AXIS[2]).normalize().applyQuaternion(quat).transformDirection(this.toTurret);
    this.axis[0] = this.tmpVec.x;
    this.axis[1] = this.tmpVec.y;
    this.axis[2] = this.tmpVec.z;
  }

  /** Where it should be held this frame, turret space, into `target`. */
  private heldTarget(holder: Exclude<Holder, null>): void {
    if (holder === 'flat') {
      // Held up in front of the camera, square to the view.
      const cam = this.camera;
      cam.getWorldPosition(this.tmpPos);
      cam.getWorldQuaternion(this.tmpQuat);
      this.tmpVec.set(0, -0.02, -FLAT_AWAY).applyQuaternion(this.tmpQuat).add(this.tmpPos).applyMatrix4(this.toTurret);
      this.tmpVec.toArray(this.target.centre);
      this.axisU.set(1, 0, 0).applyQuaternion(this.tmpQuat).transformDirection(this.toTurret).toArray(this.target.right);
      this.axisV.set(0, 1, 0).applyQuaternion(this.tmpQuat).transformDirection(this.toTurret).toArray(this.target.up);
      this.axisW.set(0, 0, 1).applyQuaternion(this.tmpQuat).transformDirection(this.toTurret).toArray(this.target.out);
      return;
    }
    let side: Side;
    if (holder === 'crew-left' || holder === 'crew-right') {
      side = holder === 'crew-left' ? 'left' : 'right';
      const r = netLink.remote;
      const p = side === 'left' ? r.left : r.right;
      this.tmpPos.set(p.px, p.py, p.pz);
      this.tmpQuat.set(p.qx, p.qy, p.qz, p.qw);
      this.fistFrom(side, this.tmpPos, this.tmpQuat);
      this.tmpVec.set(r.head.px, r.head.py, r.head.pz).applyMatrix4(this.toTurret);
    } else {
      side = holder;
      this.fistInTurret(side);
      this.player.head.getWorldPosition(this.tmpVec);
      this.tmpVec.applyMatrix4(this.toTurret);
    }
    this.eyes[0] = this.tmpVec.x;
    this.eyes[1] = this.tmpVec.y;
    this.eyes[2] = this.tmpVec.z;
    heldPose(this.fist, this.axis, this.eyes, side, this.target);
  }

  /** A pose's middle and axes as a position and turn, into goalPos and goalQuat. */
  private toGoal(p: HeldPose): void {
    this.goalPos.set(p.centre[0], p.centre[1], p.centre[2]);
    this.basis.makeBasis(this.axisU.fromArray(p.right), this.axisV.fromArray(p.up), this.axisW.fromArray(p.out));
    this.goalQuat.setFromRotationMatrix(this.basis);
  }

  private place(p: HeldPose): void {
    this.toGoal(p);
    this.group.position.copy(this.goalPos);
    this.group.quaternion.copy(this.goalQuat);
  }

  /** The enemies seen, pencilled over the map (F2.11): the map as painted, then each mark. */
  private paintMarks(): void {
    this.paintedMarks = marksVersion;
    const ctx = this.canvas.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0);
    for (const c of shownCheckpoints) paintCheckpoint(ctx, c);
    for (const m of shownMarks) paintMark(ctx, m);
    this.texture.needsUpdate = true;
  }

  private say(title: string, line1: string, line2: string): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(title, width / 2, 64);
    ctx.font = '26px sans-serif';
    ctx.fillText(line1, width / 2, 118);
    ctx.fillText(line2, width / 2, 160);
    this.sign.refresh();
    this.sign.setVisible(true, 'setup');
    this.signText = `${title}. ${line1} ${line2}`;
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[MapCase] sign: ${this.signText}`);
  }
}

/** The map's frame on the sheet, px: margins for the grid's numbers, a title band on top. */
const MAP_LEFT = 96;
const MAP_TOP = 170;
/** Sheet pixels per world metre. */
const MAP_SCALE = (MAP_PX - 2 * MAP_LEFT) / MAP_WIDTH;
/** The red pencil's colour. */
const PENCIL = '#c0262d';

/** A world x's place across the sheet, px. */
function mapPx(x: number): number {
  return MAP_LEFT + (x - FIELD_MAP.west) * MAP_SCALE;
}

/** A world z's place down the sheet, px. */
function mapPy(z: number): number {
  return MAP_TOP + (z - FIELD_MAP.north) * MAP_SCALE;
}

/**
 * One enemy seen, in red pencil (F2.11): the map's symbol for it (an
 * anti-tank gun's arrow on its bar, a tank's track oval, a lorry's box on
 * wheels), dashed if only its flash was seen, its number beside it, and a
 * cross through it if knocked out.
 */
function paintMark(ctx: CanvasRenderingContext2D, m: Readonly<MapMark>): void {
  const x = mapPx(m.x);
  const y = mapPy(m.z);
  ctx.save();
  ctx.strokeStyle = PENCIL;
  ctx.fillStyle = PENCIL;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(m.how === 'flash' ? [10, 8] : []);
  ctx.beginPath();
  if (m.kind === 'gun') {
    ctx.moveTo(x - 20, y + 14);
    ctx.lineTo(x + 20, y + 14);
    ctx.moveTo(x, y + 14);
    ctx.lineTo(x, y - 22);
    ctx.moveTo(x - 10, y - 10);
    ctx.lineTo(x, y - 22);
    ctx.lineTo(x + 10, y - 10);
  } else if (m.kind === 'tank') {
    ctx.roundRect(x - 32, y - 17, 64, 34, 17);
  } else {
    ctx.rect(x - 28, y - 18, 56, 28);
    ctx.moveTo(x - 10, y + 17);
    ctx.arc(x - 16, y + 17, 6, 0, 2 * Math.PI);
    ctx.moveTo(x + 22, y + 17);
    ctx.arc(x + 16, y + 17, 6, 0, 2 * Math.PI);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (m.out) {
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - 34, y - 34);
    ctx.lineTo(x + 34, y + 34);
    ctx.moveTo(x + 34, y - 34);
    ctx.lineTo(x - 34, y + 34);
    ctx.stroke();
  }
  ctx.font = 'bold italic 44px serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(m.how === 'flash' ? `${m.n}?` : `${m.n}`, x + 34, y - 14);
  ctx.restore();
}

/** The blue pencil for map-reading checkpoints (F2.12), so they never read as the red of the objectives or the enemy. */
const BLUE_PENCIL = '#1c4f9c';

/**
 * A map-reading checkpoint (F2.12) as a commander would ring it in pencil:
 * a blue circle round the place with CPn beside it, ticked through once
 * the tank has been there. The label has a halo of paper so it reads over
 * whatever is drawn beneath.
 */
function paintCheckpoint(ctx: CanvasRenderingContext2D, c: Readonly<MapCheckpoint>): void {
  const x = mapPx(c.x);
  const y = mapPy(c.z);
  ctx.save();
  ctx.strokeStyle = BLUE_PENCIL;
  ctx.fillStyle = BLUE_PENCIL;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(x, y, 28, 0, 2 * Math.PI);
  ctx.stroke();
  if (c.done) {
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x - 4, y + 14);
    ctx.lineTo(x + 20, y - 18);
    ctx.stroke();
  }
  ctx.font = 'bold italic 48px serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.strokeStyle = '#f2ead4';
  ctx.lineWidth = 10;
  ctx.strokeText(`CP${c.n}`, x - 24, y - 20);
  ctx.fillText(`CP${c.n}`, x - 24, y - 20);
  ctx.restore();
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The field map, painted once: a 1944-style sheet, north up. The sheet's
 * margins carry the title, the grid's numbers, a scale and a north arrow;
 * the map has the contours, the water, the roads and the course's track,
 * houses and walls, the range's markers and targets, spot heights and
 * names, and the objectives pencilled in red.
 */
export function paintFieldMap(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_PX;
  canvas.height = MAP_PX;
  const ctx = canvas.getContext('2d')!;
  const left = MAP_LEFT;
  const top = MAP_TOP;
  const scale = MAP_SCALE;
  const mapH = MAP_HEIGHT * scale;
  const px = mapPx;
  const py = mapPy;
  const ink = '#1d1a14';
  const red = PENCIL;

  ctx.fillStyle = '#e9dfc4';
  ctx.fillRect(0, 0, MAP_PX, MAP_PX);
  ctx.fillStyle = '#f2ead4';
  ctx.fillRect(left, top, MAP_WIDTH * scale, mapH);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, MAP_WIDTH * scale, mapH);
  ctx.clip();

  // The water: the ford's stream.
  const field = sampleGround();
  ctx.fillStyle = '#9cc4dc';
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      if (field.water[r * field.cols + c]) {
        const x = FIELD_MAP.west + c * field.step;
        const z = FIELD_MAP.north + r * field.step;
        ctx.fillRect(px(x - field.step / 2), py(z - field.step / 2), field.step * scale + 1, field.step * scale + 1);
      }
    }
  }

  // The contours: brown, every index contour heavier.
  ctx.strokeStyle = '#b5773f';
  ctx.lineCap = 'round';
  for (const index of [false, true]) {
    ctx.lineWidth = index ? 2.4 : 1.3;
    ctx.beginPath();
    for (const s of contours(field)) {
      if (s.index !== index) continue;
      ctx.moveTo(px(s.x0), py(s.z0));
      ctx.lineTo(px(s.x1), py(s.z1));
    }
    ctx.stroke();
  }

  // The grid.
  const grid = gridLines();
  ctx.strokeStyle = 'rgba(29, 26, 20, 0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const e of grid.eastings) {
    ctx.moveTo(px(e.x), top);
    ctx.lineTo(px(e.x), top + mapH);
  }
  for (const n of grid.northings) {
    ctx.moveTo(left, py(n.z));
    ctx.lineTo(left + MAP_WIDTH * scale, py(n.z));
  }
  ctx.stroke();

  for (const f of mapFeatures()) paintFeature(ctx, f, px, py, scale, ink, red);
  ctx.restore();

  // The neat line, the grid's numbers in the margins, the title, the scale and the north arrow.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.strokeRect(left, top, MAP_WIDTH * scale, mapH);
  ctx.fillStyle = ink;
  ctx.font = 'bold 34px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of grid.eastings) {
    ctx.fillText(e.label, px(e.x), top - 26);
    ctx.fillText(e.label, px(e.x), top + mapH + 30);
  }
  for (const n of grid.northings) {
    ctx.fillText(n.label, left / 2, py(n.z));
    ctx.fillText(n.label, MAP_PX - left / 2, py(n.z));
  }
  ctx.textAlign = 'left';
  ctx.font = 'bold 56px serif';
  ctx.fillText('TRAINING AREA', left, 64);
  ctx.font = 'italic 30px serif';
  ctx.fillText('Sheet 1  ·  1:3,500  ·  Grid 100 m squares  ·  Contours every 1 m', left, 116);
  // The scale bar: 200 m, in 50 m steps, bottom right.
  const barX = MAP_PX - left - 200 * scale;
  const barY = top + mapH + 58;
  if (barY + 30 < MAP_PX) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? ink : '#f2ead4';
      ctx.fillRect(barX + i * 50 * scale, barY, 50 * scale, 12);
    }
    ctx.strokeRect(barX, barY, 200 * scale, 12);
    ctx.fillStyle = ink;
    ctx.font = '24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const m of [0, 100, 200]) ctx.fillText(m === 200 ? '200 m' : String(m), barX + m * scale, barY + 16);
  }
  // The north arrow, top right.
  const nx = MAP_PX - left - 40;
  const ny = 70;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(nx, ny - 50);
  ctx.lineTo(nx + 22, ny + 30);
  ctx.lineTo(nx, ny + 14);
  ctx.lineTo(nx - 22, ny + 30);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 40px serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', nx - 60, ny);
  return canvas;
}

function paintFeature(ctx: CanvasRenderingContext2D, f: MapFeature, px: (x: number) => number, py: (z: number) => number, scale: number, ink: string, red: string): void {
  const line = (points: readonly (readonly [number, number])[]) => {
    ctx.beginPath();
    points.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(px(x), py(z)) : ctx.lineTo(px(x), py(z))));
  };
  switch (f.kind) {
    case 'road': {
      const w = Math.max(10, f.width * scale);
      line([f.from, f.to]);
      ctx.strokeStyle = ink;
      ctx.lineWidth = w + 5;
      ctx.stroke();
      ctx.strokeStyle = '#e29a4c';
      ctx.lineWidth = w;
      ctx.stroke();
      break;
    }
    case 'track': {
      // A cart track: two dashed lines.
      line(f.points);
      ctx.strokeStyle = '#6b4f33';
      ctx.lineWidth = Math.max(8, f.width * scale);
      ctx.setLineDash([16, 10]);
      ctx.stroke();
      ctx.strokeStyle = '#f2ead4';
      ctx.lineWidth = Math.max(8, f.width * scale) - 5;
      ctx.setLineDash([]);
      ctx.stroke();
      break;
    }
    case 'mud': {
      ctx.strokeStyle = '#6b4f2e';
      ctx.lineWidth = 2;
      const x0 = px(f.west);
      const x1 = px(f.east);
      const y0 = py(f.north);
      const y1 = py(f.south);
      ctx.beginPath();
      for (let x = x0; x < x1; x += 9) {
        ctx.moveTo(x, (y0 + y1) / 2 - 3);
        ctx.lineTo(x + 5, (y0 + y1) / 2 - 3);
        ctx.moveTo(x + 4, (y0 + y1) / 2 + 4);
        ctx.lineTo(x + 9, (y0 + y1) / 2 + 4);
      }
      ctx.stroke();
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      break;
    }
    case 'bridge': {
      const x = px(f.x);
      const y0 = py(f.z - f.length / 2);
      const y1 = py(f.z + f.length / 2);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const dx of [-7, 7]) {
        ctx.moveTo(x + dx, y0);
        ctx.lineTo(x + dx, y1);
      }
      ctx.moveTo(x - 12, y0 - 5);
      ctx.lineTo(x - 7, y0);
      ctx.moveTo(x + 12, y0 - 5);
      ctx.lineTo(x + 7, y0);
      ctx.moveTo(x - 12, y1 + 5);
      ctx.lineTo(x - 7, y1);
      ctx.moveTo(x + 12, y1 + 5);
      ctx.lineTo(x + 7, y1);
      ctx.stroke();
      break;
    }
    case 'building':
    case 'wall': {
      ctx.save();
      ctx.translate(px(f.x), py(f.z));
      ctx.rotate(-f.yaw);
      ctx.fillStyle = ink;
      const w = Math.max(f.kind === 'building' ? 7 : 3, 2 * f.hx * scale);
      const h = Math.max(f.kind === 'building' ? 7 : 3, 2 * f.hz * scale);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      break;
    }
    case 'marker': {
      ctx.fillStyle = ink;
      ctx.fillRect(px(f.x) - 4, py(f.z) - 4, 8, 8);
      ctx.font = '22px serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, px(f.x) + 10, py(f.z));
      break;
    }
    case 'target': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px(f.x) - 8, py(f.z) + 6);
      ctx.lineTo(px(f.x), py(f.z) - 8);
      ctx.lineTo(px(f.x) + 8, py(f.z) + 6);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'box': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(px(f.x - f.width / 2), py(f.z - f.length / 2), f.width * scale, f.length * scale);
      break;
    }
    case 'spot': {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(px(f.x), py(f.z), 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.font = 'italic 28px serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(f.height), px(f.x) + 9, py(f.z) - 2);
      break;
    }
    case 'name': {
      ctx.fillStyle = ink;
      ctx.font = f.size === 'large' ? 'italic 44px serif' : 'italic 30px serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, px(f.x), py(f.z));
      break;
    }
    case 'objective-line': {
      line(f.points);
      ctx.strokeStyle = red;
      ctx.lineWidth = 6;
      ctx.setLineDash(f.dashed ? [22, 14] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      const [x0, z0] = f.points[f.points.length - 2];
      const [x1, z1] = f.points[f.points.length - 1];
      if (f.arrow) {
        const a = Math.atan2(py(z1) - py(z0), px(x1) - px(x0));
        ctx.beginPath();
        ctx.moveTo(px(x1), py(z1));
        ctx.lineTo(px(x1) - 26 * Math.cos(a - 0.45), py(z1) - 26 * Math.sin(a - 0.45));
        ctx.moveTo(px(x1), py(z1));
        ctx.lineTo(px(x1) - 26 * Math.cos(a + 0.45), py(z1) - 26 * Math.sin(a + 0.45));
        ctx.stroke();
      }
      const [sx, sz] = f.points[0];
      ctx.fillStyle = red;
      ctx.font = 'bold italic 34px serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(f.text, Math.min(px(sx), px(x1)) + 4, Math.min(py(sz), py(z1)) - 10);
      break;
    }
    case 'objective-point': {
      ctx.strokeStyle = red;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(px(f.x), py(f.z), 16, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = red;
      ctx.font = 'bold italic 34px serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.textBaseline = 'bottom';
      ctx.fillText(f.text, px(f.x) + 18, py(f.z) - 12);
      break;
    }
  }
}
