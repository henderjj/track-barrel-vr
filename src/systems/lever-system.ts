import {
  CanvasTexture,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { createLeverRig, createTiller, SCREEN_GAP } from '../scene-assets/lever-rig.scene-asset.js';
import { FIST_CENTRE } from '../scene-assets/hand.scene-asset.js';
import { angleOf, Lever, LEVER_RIG, LeverEvent, TILLER } from '../sim/lever.js';
import { LANE, LANE_HALF_WIDTH, LaneRun, TRACK_SPACING } from '../sim/lever-lane.js';
import { grip, handUse } from './grip-system.js';
import { HoldKind, lockResolvers } from './hand-lock.js';
import { buzz } from './haptics.js';

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];
/** The `handUse` name of a hand on each tiller. */
const USE: Record<Side, string> = { left: 'tiller-left', right: 'tiller-right' };
const KIND: Record<Side, number> = { left: HoldKind.TillerLeft, right: HoldKind.TillerRight };

/** The lane board's canvas, px: a band of figures along the top, the map below. */
const PX = 512;
const BAND = 64;
/** The map shows this much of the lane round the tank, m across. */
const VIEW_M = 48;
/** The board is redrawn this often, Hz (a 512² upload each time). */
const DRAW_HZ = 20;
/** After a finish, or with the tank off the lane, letting go of both tillers this long starts again, s. */
const RESET_AFTER = 3;
/** While the hand pushes past a limit, a light buzz this often, s, stronger the further past. */
const STRAIN_BUZZ_EVERY = 0.1;
const DEG = Math.PI / 180;

let requested: 'show' | 'hide' | null = null;
/** Practice > Lever test: put the lever test rig in front of the player (again) and start the lane afresh. */
export function showLeverTest(): void {
  requested = 'show';
}
/** Practice > Put away: hide the lever test rig. */
export function hideLeverTest(): void {
  requested = 'hide';
}

interface LeverDebug {
  readonly shown: boolean;
  show(): void;
  hide(): void;
  /** Each tiller: angle and overshoot (degrees), which hand holds it, its drive demand, and counts of limit and detent ticks. */
  tillers(): Record<Side, { angle: number; overshoot: number; heldBy: Side | null; demand: number; limits: number; detents: number }>;
  /** The middle of a tiller's handle, scene space. */
  handle(side: Side): number[];
  /** How far a scene-space point is from a tiller's handle (its centre line), m. */
  handleGap(side: Side, point: number[]): number;
  lane(): { x: number; y: number; heading: number; time: number; offTime: number; started: boolean; finished: boolean; off: boolean; best: number };
  resetLane(): void;
}

/**
 * Spike S3, lever feel: a pair of tank tillers that follow the hand gripping
 * them, stop at their limits with the hand kept on the handle (grip locking),
 * tick at their limits and the middle, spring back when let go, and drive a
 * tank along a lane on a board in front of them (src/sim/lever-lane.ts).
 * Works with controllers (the grip button) and tracked hands (a fist or a
 * pinch: see GripSystem); tracked hands are steadied by a one-euro filter.
 *
 * One player's only: the rig is drawn where this player put it and nothing
 * goes over the network (the crewmate sees their hand where it is, not
 * closed on a tiller). The mechanism kit (F1.3) makes shared controls.
 */
export class LeverSystem extends createSystem({}) {
  private root = new Group();
  private pivots: Record<Side, Group> = { left: new Group(), right: new Group() };
  private levers: Record<Side, Lever> = { left: new Lever(TILLER), right: new Lever(TILLER) };
  /** Which hand holds each tiller. */
  private holder: Record<Side, Side | null> = { left: null, right: null };
  private counts = { left: { limits: 0, detents: 0 }, right: { limits: 0, detents: 0 } };
  private strainClock = { left: 0, right: 0 };
  private run = new LaneRun();
  private bestTime = 0;
  private idle = 0;
  private drawClock = 0;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private gripPos = new Vector3();
  private gripQuat = new Quaternion();
  private fist = new Vector3();
  private local = new Vector3();
  private centre = { left: new Vector3(), right: new Vector3() };
  private handleTmp: [number, number, number] = [0, 0, 0];
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private forward = new Vector3();

  init(): void {
    for (const side of SIDES) {
      const m = side === 'left' ? -1 : 1;
      this.centre[side].set(FIST_CENTRE[0] * m, FIST_CENTRE[1], FIST_CENTRE[2]);
      this.pivots[side].position.set(m * LEVER_RIG.side, 0, 0);
      this.pivots[side].add(createTiller());
      this.root.add(this.pivots[side]);
    }
    this.root.add(createLeverRig());
    this.root.add(this.createScreen());
    this.root.name = 'Lever Test';
    this.root.visible = false;
    this.world.createTransformEntity(this.root);
    this.run.reset();

    for (const side of SIDES) {
      lockResolvers.set(KIND[side], (hand, point, axis) => this.resolve(side, hand, point, axis));
    }
    this.cleanupFuncs.push(() => {
      for (const side of SIDES) lockResolvers.delete(KIND[side]);
    });

    const self = this;
    const debug: LeverDebug = {
      get shown() { return requested === 'show' || (requested === null && self.root.visible); },
      show: showLeverTest,
      hide: hideLeverTest,
      tillers: () => {
        const out = {} as ReturnType<LeverDebug['tillers']>;
        for (const side of SIDES) {
          const l = this.levers[side];
          out[side] = { angle: l.angle / DEG, overshoot: l.overshoot / DEG, heldBy: this.holder[side], demand: l.demand(), ...this.counts[side] };
        }
        return out;
      },
      handle: (side) => this.handleWorld(side, new Vector3()).toArray(),
      handleGap: (side, point) => {
        this.root.updateMatrixWorld(true);
        return this.handleDistance(side, this.root.worldToLocal(new Vector3(point[0], point[1], point[2])));
      },
      lane: () => ({
        x: this.run.x, y: this.run.y, heading: this.run.heading, time: this.run.time, offTime: this.run.offTime,
        started: this.run.started, finished: this.run.finished, off: this.run.off, best: this.run.best,
      }),
      resetLane: () => this.run.reset(),
    };
    (window as unknown as { __lever: LeverDebug }).__lever = debug;
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    if (requested) {
      if (requested === 'show') this.place();
      else this.putAway();
      requested = null;
    }
    if (!this.root.visible) {
      return;
    }
    this.root.updateMatrixWorld(true);
    for (const side of SIDES) {
      this.updateHand(side);
    }
    for (const side of SIDES) {
      this.updateLever(side, dt);
    }
    this.updateLane(dt);
    this.drawClock += dt;
    if (this.drawClock >= 1 / DRAW_HZ) {
      this.drawClock = 0;
      this.draw();
    }
  }

  /** Put the rig in front of the player's eyes, facing the way they face, and start afresh. */
  private place(): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const head = immersive ? this.player.head : this.camera;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this.headPos);
    head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.root.position.copy(this.headPos).addScaledVector(this.forward, LEVER_RIG.ahead);
    this.root.position.y -= LEVER_RIG.below;
    this.root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    this.root.visible = true;
    this.run.reset();
    this.idle = 0;
    this.draw();
  }

  private putAway(): void {
    for (const side of SIDES) {
      const hand = this.holder[side];
      if (hand) this.letGo(side, hand);
      this.levers[side].angle = TILLER.rest;
      this.pivots[side].rotation.x = 0;
    }
    this.root.visible = false;
  }

  /** Take hold of a tiller on a fresh grip near its handle; let go when the grip is let go. */
  private updateHand(hand: Side): void {
    const held = this.holding(hand);
    const present = this.input.xr.getPrimaryInputSource(hand) !== undefined;
    if (held) {
      if (!grip[hand].pressed || !present || handUse[hand] !== USE[held]) {
        this.letGo(held, hand);
      }
      return;
    }
    if (!present || !grip[hand].down || handUse[hand]) {
      return;
    }
    this.fistLocal(hand, this.local);
    let best: Side | null = null;
    let bestDistance: number = LEVER_RIG.reach;
    for (const side of SIDES) {
      if (this.holder[side]) continue;
      const d = this.handleDistance(side, this.local);
      if (d < bestDistance) {
        best = side;
        bestDistance = d;
      }
    }
    if (best && this.levers[best].grab(angleOf(this.local.y, this.local.z), grip[hand].hand)) {
      this.holder[best] = hand;
      handUse[hand] = USE[best];
      this.pulse(hand, 0.4, 20);
    }
  }

  private letGo(side: Side, hand: Side): void {
    this.levers[side].release();
    this.holder[side] = null;
    if (handUse[hand] === USE[side]) handUse[hand] = null;
  }

  private holding(hand: Side): Side | null {
    return this.holder.left === hand ? 'left' : this.holder.right === hand ? 'right' : null;
  }

  private updateLever(side: Side, dt: number): void {
    const lever = this.levers[side];
    const hand = this.holder[side];
    let angle = Number.NaN;
    if (hand) {
      this.fistLocal(hand, this.local);
      angle = angleOf(this.local.y, this.local.z);
    }
    const events = lever.update(dt, angle);
    this.pivots[side].rotation.x = -lever.angle;
    if (!hand) return;
    if (events & LeverEvent.Limit) {
      this.counts[side].limits++;
      this.pulse(hand, 0.8, 35);
    } else if (events & LeverEvent.Detent) {
      this.counts[side].detents++;
      this.pulse(hand, 0.3, 15);
    }
    // Pushing on past a limit: a light buzz, stronger the further the hand goes.
    const strain = Math.abs(lever.overshoot);
    this.strainClock[side] += dt;
    if (strain > 2 * DEG && this.strainClock[side] >= STRAIN_BUZZ_EVERY) {
      this.strainClock[side] = 0;
      this.pulse(hand, Math.min(0.6, 0.15 + strain / (20 * DEG)), 40);
    }
  }

  private updateLane(dt: number): void {
    const run = this.run;
    run.update(dt, this.levers.left.demand(), this.levers.right.demand());
    if (run.finished && (this.bestTime === 0 || run.time < this.bestTime)) {
      this.bestTime = run.time;
    }
    const letGo = !this.holder.left && !this.holder.right;
    this.idle = letGo && run.started && (run.finished || run.off) ? this.idle + dt : 0;
    if (this.idle >= RESET_AFTER) {
      run.reset();
      this.idle = 0;
    }
  }

  /** The middle of `hand`'s fist (where a handle runs through it), in rig space, into `out`. */
  private fistLocal(hand: Side, out: Vector3): Vector3 {
    const space = this.player.gripSpaces[hand];
    space.updateWorldMatrix(true, false);
    space.getWorldPosition(this.gripPos);
    space.getWorldQuaternion(this.gripQuat);
    out.copy(this.centre[hand]).applyQuaternion(this.gripQuat).add(this.gripPos);
    return this.root.worldToLocal(out);
  }

  /** How far a point in rig space is from `side`'s handle's centre line. */
  private handleDistance(side: Side, local: Vector3): number {
    const t = this.handleParam(side, local);
    const a = this.levers[side].angle;
    const px = this.pivots[side].position.x;
    return Math.hypot(local.x - px, local.y - t * Math.cos(a), local.z + t * Math.sin(a));
  }

  /** How far up `side`'s lever from its pivot the point nearest `local` on its handle is. */
  private handleParam(side: Side, local: Vector3): number {
    const a = this.levers[side].angle;
    const along = local.y * Math.cos(a) - local.z * Math.sin(a);
    const lo = TILLER.length - TILLER.gripLength;
    return along < lo ? lo : along > TILLER.length ? TILLER.length : along;
  }

  /** Grip locking: the point on the handle nearest the hand, and the lever's direction, scene space. */
  private resolve(side: Side, hand: Vector3, point: Vector3, axis: Vector3): void {
    this.root.updateMatrixWorld(true);
    this.local.copy(hand);
    this.root.worldToLocal(this.local);
    const t = this.handleParam(side, this.local);
    const a = this.levers[side].angle;
    point.set(this.pivots[side].position.x, t * Math.cos(a), -t * Math.sin(a));
    this.root.localToWorld(point);
    axis.set(0, Math.cos(a), -Math.sin(a)).applyQuaternion(this.root.quaternion);
  }

  private handleWorld(side: Side, out: Vector3): Vector3 {
    const [x, y, z] = this.levers[side].gripCentre(this.handleTmp);
    out.set(x + this.pivots[side].position.x, y, z);
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(out);
  }

  private pulse(hand: Side, intensity: number, ms: number): void {
    buzz(this.input.xr.gamepads[hand]?.gamepad, hand, intensity, ms);
  }

  private createScreen(): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = PX;
    canvas.height = PX;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const { board } = LEVER_RIG;
    const screen = new Mesh(
      new PlaneGeometry(board.width, board.width),
      new MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    screen.name = 'Lane Board';
    screen.position.set(0, board.y + Math.sin(board.tilt) * SCREEN_GAP, board.z + Math.cos(board.tilt) * SCREEN_GAP);
    screen.rotation.x = -board.tilt;
    return screen;
  }

  /** The lane round the tank, north up, with the run's figures along the top and each tiller's demand down the sides. */
  private draw(): void {
    const { ctx } = this;
    const run = this.run;
    const scale = PX / VIEW_M;
    const mapH = PX - BAND;
    // The tank sits a little below the middle of the map, so more of the lane ahead shows.
    const cx = PX / 2 - run.x * scale;
    const cy = BAND + mapH * 0.62 + run.y * scale;
    ctx.fillStyle = '#5d6b3a';
    ctx.fillRect(0, BAND, PX, mapH);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < LANE.length; i++) {
      const x = cx + LANE[i][0] * scale;
      const y = cy - LANE[i][1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#b09a6e';
    ctx.lineWidth = LANE_HALF_WIDTH * 2 * scale;
    ctx.stroke();
    ctx.strokeStyle = '#d8c79a';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Start and finish lines.
    const [ex, ey] = LANE[LANE.length - 1];
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(cx + ex * scale - LANE_HALF_WIDTH * scale, cy - ey * scale - 3, LANE_HALF_WIDTH * 2 * scale, 6);
    ctx.fillRect(cx - LANE_HALF_WIDTH * scale, cy - 3, LANE_HALF_WIDTH * 2 * scale, 6);

    // The tank: a hull with a turret and a gun, pointing its way.
    ctx.save();
    ctx.translate(PX / 2, BAND + mapH * 0.62);
    ctx.rotate(run.heading);
    const w = (TRACK_SPACING + 0.6) * scale;
    const l = 6.5 * scale;
    ctx.fillStyle = run.off ? '#c0563a' : '#2f3a1a';
    ctx.fillRect(-w / 2, -l / 2, w, l);
    ctx.fillStyle = '#1b1f10';
    ctx.fillRect(-w / 2, -l / 2, w * 0.2, l);
    ctx.fillRect(w / 2 - w * 0.2, -l / 2, w * 0.2, l);
    ctx.fillStyle = '#48562a';
    ctx.fillRect(-w * 0.25, -l * 0.2, w * 0.5, w * 0.5);
    ctx.fillRect(-2, -l * 0.75, 4, l * 0.55);
    ctx.restore();

    // Each tiller's demand, a bar down each side of the map.
    for (const side of SIDES) {
      const d = this.levers[side].demand();
      const x = side === 'left' ? 6 : PX - 22;
      const mid = BAND + mapH / 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(x, BAND + 10, 16, mapH - 20);
      ctx.fillStyle = this.holder[side] ? '#f0c040' : '#a0a0a0';
      const h = (d * (mapH - 20)) / 2;
      ctx.fillRect(x, h > 0 ? mid - h : mid, 16, Math.abs(h) || 2);
    }

    ctx.fillStyle = '#1d2012';
    ctx.fillRect(0, 0, PX, BAND);
    ctx.fillStyle = '#efe6c8';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`${run.time.toFixed(1)} s`, 14, BAND / 2);
    ctx.font = '20px sans-serif';
    ctx.fillStyle = run.offTime > 0 ? '#e8a080' : '#c9c0a0';
    ctx.fillText(`off lane ${run.offTime.toFixed(1)} s`, 120, BAND / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c9c0a0';
    ctx.fillText(this.bestTime > 0 ? `best ${this.bestTime.toFixed(1)} s` : 'drive to the line', PX - 14, BAND / 2);

    const note = !run.started
      ? 'Grip both tillers and push them forwards'
      : run.finished
        ? 'Finished! Let go of both to go again'
        : run.off && !this.holder.left && !this.holder.right
          ? 'Off the lane: let go of both to start again'
          : '';
    if (note) {
      ctx.fillStyle = 'rgba(20, 22, 12, 0.8)';
      ctx.fillRect(20, PX - 64, PX - 40, 44);
      ctx.fillStyle = '#efe6c8';
      ctx.textAlign = 'center';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText(note, PX / 2, PX - 42, PX - 60);
    }
    this.texture.needsUpdate = true;
  }
}
