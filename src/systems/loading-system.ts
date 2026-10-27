import {
  CanvasTexture,
  createSystem,
  type Entity,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { decodeLoadingState, encodeLoadingState, LOADING_STATE_BYTES } from '../net/loading-codec.js';
import { PacketType } from '../net/pose-codec.js';
import { StateBuffer } from '../net/state-buffer.js';
import type { TankHeader } from '../net/tank-codec.js';
import {
  BLOCK_CLOSED_Y,
  BLOCK_OPEN_Y,
  BLOCK_Z,
  BOARD,
  createBreechBlock,
  createBreechLever,
  createCasing,
  createMuzzleFlash,
  createShell,
} from '../scene-assets/loading.scene-asset.js';
import { GUN, SEATS, seatToHull, TURRET } from '../sim/cabin.js';
import {
  boardLines,
  BREECH_MOUTH,
  CASINGS_KEPT,
  copyLoadingSnapshot,
  createDrillHand,
  createLoadingSnapshot,
  type DrillHand,
  extrapolateLoadingSnapshot,
  GunAction,
  gunToTurret,
  HOLD_LEVER,
  HOLD_NONE,
  LEVER_CLOSED,
  LEVER_HANDLE_X,
  LEVER_LENGTH,
  LEVER_PIVOT,
  leverHandle,
  lerpLoadingSnapshot,
  LoadingDrill,
  type LoadingSnapshot,
  RACK_SLOTS,
  type Side,
  type Vec3,
} from '../sim/loading.js';
import { MANTLET_DEPTH, TRUNNION } from '../sim/turret.js';
import { fireShell, lastShotLine, shotListeners } from './firing-system.js';
import { grip, handUse } from './grip-system.js';
import { HoldKind, lockResolvers } from './hand-lock.js';
import { buzz } from './haptics.js';
import { bufferDelayMs, netLink } from './net-system.js';
import { ride } from './ride-system.js';
import { seating } from './seating.js';
import { takeTriggerPulls, turretState } from './turret-system.js';

const SIDES = ['left', 'right'] as const;
const SEND_HZ = 45;

/** What a hand holding part of the loading puts in `handUse` (mapped to a HoldKind in holdKindOf, net-system.ts). */
export const SHELL_USE = 'shell';
export const LEVER_USE = 'breech-lever';

/** A scripted hand for tests without a headset: grip position in hull space and squeeze (held level, turned with the turret). */
export interface DrillTestHand {
  x: number;
  y: number;
  z: number;
  squeeze: boolean;
}
type DrillTestHandFn = (nowMs: number) => DrillTestHand | null;

let active: LoadingSystem | null = null;

/** The game menu's Practice → Load and fire: into the gunner's seat with every shell in the rack, the breech open and the stats cleared. */
export function startLoading(): void {
  seating.ask('gunner');
  active?.start();
}

/** The loading as this page draws it (the gunner's own, or their packets): the tank sounds hear the breech and the ram in it (F1.12). */
export function loadingShown(): Readonly<LoadingSnapshot> | null {
  return active?.shown ?? null;
}

/** One line for the menu: who loads, and the loads so far. */
export function loadingStatus(): string {
  const a = active;
  if (a == null) return '';
  const s = a.shown;
  const who = seating.mine === 'gunner' ? 'You load' : netLink.connected && seating.crew === 'gunner' ? 'Your crewmate loads' : 'Nobody loads';
  const best = Number.isNaN(s.best) ? '' : `, best ${s.best.toFixed(1)} s`;
  return `${who}: ${s.loads} loads${best}${s.loaded ? ', loaded' : ''}`;
}

/**
 * Loading the gun (F1.10, docs/loading-firing.md; spike S4's drill moved
 * into the turret). Feeds the gunner's hands to the loading rules
 * (src/sim/loading.ts) each frame: take a shell from the ready rack on the
 * right, swing it to the breech, ram it, close the breech with the lever.
 * The power grip's trigger (TurretSystem) then fires a loaded gun: the
 * breech opens, the casing flies into the bin, the barrel recoils, and
 * FiringSystem flies the shell. Buzzes as the shell snaps onto the bore,
 * goes home, as the breech closes, and as the gun fires.
 *
 * The gunner's page does the loading, as it owns the turret (plan decision
 * 2): it sends where the lever, the breech and the shells are 45 times a
 * second (PacketType 8), and the other page draws them from those, a little
 * in the past (StateBuffer), so the crewmate sees the shell in the
 * gunner's hand. Every shot (FiringSystem's `shot` event) recoils the gun
 * and throws a casing on both pages. Alone, this page loads whichever seat
 * it sits in.
 *
 * Everything is drawn in the turret: the shells and casings as its
 * children, the block, the lever and the muzzle flash on the gun's
 * recoiling part. Runs after TurretSystem (it reads the gun's elevation and
 * the trigger) and before FiringSystem and the throwables, which skip a
 * hand that holds a shell or the lever.
 */
export class LoadingSystem extends createSystem({}) {
  readonly drill = new LoadingDrill();
  readonly gun = new GunAction();
  /** What is drawn: the drill's own, or the gunner's packets. */
  readonly shown = createLoadingSnapshot();
  private hands: Record<Side, DrillHand> = { left: createDrillHand(), right: createDrillHand() };
  private testHands: Record<Side, DrillTestHandFn | null> = { left: null, right: null };
  private turret: Entity | null = null;
  private recoilPart: Object3D | null = null;
  private shells: Mesh[] = [];
  private casings: Mesh[] = [];
  private block: Mesh | null = null;
  private lever: Mesh | null = null;
  private flash: Mesh | null = null;
  private board!: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  /** What the board shows now. */
  private boardKey = { loads: -1, last: 0, best: 0, fumbles: 0, streak: 0, bestStreak: 0, phase: -1, shot: '' };
  private boardText: [string, string, string] = ['', '', ''];
  private wasOwner = true;
  private time = 0;
  private buffer = new StateBuffer<LoadingSnapshot>({
    create: createLoadingSnapshot,
    copy: copyLoadingSnapshot,
    lerp: lerpLoadingSnapshot,
    extrapolate: extrapolateLoadingSnapshot,
  });
  private incoming = createLoadingSnapshot();
  private header: TankHeader = { seq: 0, timeMs: 0 };
  private packet = new ArrayBuffer(LOADING_STATE_BYTES);
  private seq = 0;
  private sendAccumulator = 0;
  private sent = 0;
  private received = 0;
  private pos = new Vector3();
  private quat = new Quaternion();
  private turretQuat = new Quaternion();
  private toTurret = new Matrix4();
  private axis = new Vector3();
  private v: Vec3 = [0, 0, 0];

  init(): void {
    active = this;
    const turret = this.world.getSceneEntity('turret') ?? null;
    this.turret = turret;
    if (turret == null) {
      console.warn('[Loading] no turret in the scene');
    } else {
      this.build(turret);
    }

    // Grip locking: a hand on the lever is drawn closed round its handle, which runs along the gun's X.
    lockResolvers.set(HoldKind.BreechLever, (_hand, point, axis) => {
      const lever = this.lever;
      if (lever == null) return;
      point.set(LEVER_HANDLE_X, LEVER_LENGTH, 0);
      lever.localToWorld(point);
      axis.set(1, 0, 0).transformDirection(lever.matrixWorld);
    });
    netLink.handlers.set(PacketType.LoadingState, (view) => this.onLoadingState(view));
    const onShot = () => this.gunFired();
    shotListeners.add(onShot);
    this.cleanupFuncs.push(
      () => {
        lockResolvers.delete(HoldKind.BreechLever);
        if (active === this) active = null;
      },
      () => netLink.handlers.delete(PacketType.LoadingState),
      () => shotListeners.delete(onShot),
    );

    const self = this;
    (window as unknown as { __loading: unknown }).__loading = {
      /** The loading as drawn, positions in hull space with the turret as drawn. */
      state: () => {
        const s = self.shown;
        return {
          shells: s.shells.map((shell, i) => ({
            place: shell.place,
            centre: self.hull(shell.centre),
            nose: self.hull([0, 1, 2].map((k) => shell.centre[k] + (shell.axis[k] * 0.3)) as Vec3),
            heldBy: self.isOwner() ? self.drill.shells[i].heldBy : null,
          })),
          holds: { ...self.drill.holds },
          lever: s.lever,
          leverHandle: self.hull(gunToTurret(leverHandle(s.lever, [0, 0, 0]), turretState().elevation, self.gun.recoil, [0, 0, 0])),
          breechShell: s.breechShell,
          depth: s.depth,
          rammed: s.rammed,
          loaded: s.loaded,
          board: [...self.boardText],
          owner: self.isOwner(),
          recoil: self.gun.recoil,
          kick: self.gun.kick,
          casings: self.gun.thrown,
          casingInBin: self.gun.thrown > 0 ? self.hull(self.gun.casings[(self.gun.thrown - 1) % CASINGS_KEPT].centre) : null,
          sent: self.sent,
          received: self.received,
        };
      },
      stats: self.drill.stats,
      start: () => self.start(),
      reset: () => self.drill.reset(),
      setTestHand: (side: Side, hand: DrillTestHandFn | null) => {
        self.testHands[side] = hand;
      },
      /** Where the breech mouth and the lever's pivot are, hull space, with the gun as drawn; the lever's sizes; the seated eye point. */
      layout: () => {
        const e = turretState().elevation;
        return {
          mouth: self.hull(gunToTurret(BREECH_MOUTH, e, 0, [0, 0, 0])),
          bore: self.hullDir(gunToTurret([0, 0, -1], e, 0, [0, 0, 0]), gunToTurret([0, 0, 0], e, 0, [0, 0, 0])),
          pivot: self.hull(gunToTurret(LEVER_PIVOT, e, 0, [0, 0, 0])),
          leverLength: LEVER_LENGTH,
          handleX: LEVER_HANDLE_X,
          elevation: e,
          rack: RACK_SLOTS.map((slot) => self.hull(slot)),
          eye: self.hull(SEATS.gunner.eye),
        };
      },
    };
  }

  /** The shells and casings in the turret; the block, lever and muzzle flash on the gun's recoiling part; the board on the wall. */
  private build(turret: Entity): void {
    for (let i = 0; i < this.drill.shells.length; i++) {
      const shell = createShell(i);
      this.shells.push(shell);
      this.world.createTransformEntity(shell, { parent: turret });
    }
    for (let i = 0; i < CASINGS_KEPT; i++) {
      const casing = createCasing(i);
      casing.visible = false;
      this.casings.push(casing);
      this.world.createTransformEntity(casing, { parent: turret });
    }
    const recoil = turret.object3D?.getObjectByName('Gun Recoil') ?? null;
    this.recoilPart = recoil;
    if (recoil == null) {
      console.warn('[Loading] no gun in the turret');
    } else {
      // Parts of the gun's own mesh, moving with it as it elevates and recoils.
      this.block = createBreechBlock();
      this.block.position.set(0, BLOCK_OPEN_Y, BLOCK_Z);
      this.lever = createBreechLever();
      this.lever.position.set(...LEVER_PIVOT);
      this.flash = createMuzzleFlash();
      this.flash.position.set(0, 0, TURRET.front - MANTLET_DEPTH - GUN.barrelLength - TRUNNION.z - 0.05);
      this.flash.visible = false;
      recoil.add(this.block, this.lever, this.flash);
    }
    this.createBoard(turret);
  }

  /** The gunner's page loads, as it owns the turret; alone, this page does whichever seat it sits in. */
  private isOwner(): boolean {
    return !netLink.connected || seating.mine === 'gunner';
  }

  /** Practice: every shell back in the rack, the breech open and the stats cleared (the gunner's page does it). */
  start(): void {
    if (this.isOwner()) this.drill.reset();
    console.info('[Loading] Practice: load and fire');
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.time += dt;
    const owner = this.isOwner();
    if (owner && !this.wasOwner) {
      // The gunner's seat came to this page: carry on from the loading as it was drawn.
      this.restore(this.shown);
      console.info('[Loading] loading here now');
    } else if (!owner && this.wasOwner) {
      this.drill.releaseAll();
      this.clearHandUse();
      this.buffer.clear();
    }
    this.wasOwner = owner;

    if (owner) {
      this.load(dt);
    } else {
      this.followGunner();
      // A pull of the trigger on this page fires nothing: it isn't the gunner's.
      takeTriggerPulls();
    }
    this.gun.update(this.time);
    this.send(delta);
    this.draw();
  }

  /** The gunner: step the loading from the hands, and fire a loaded gun on the trigger. */
  private load(dt: number): void {
    const now = performance.now();
    for (const side of SIDES) this.readHand(side, now);
    const drill = this.drill;
    drill.elevation = turretState().elevation;
    drill.update(dt, this.hands.left, this.hands.right);
    const pulls = takeTriggerPulls();
    if (pulls > 0) {
      if (drill.fire()) {
        fireShell();
      } else {
        // A dry click: nothing in the breech.
        this.pulse('right', 0.2, 15);
      }
    }
    for (const side of SIDES) {
      const hold = drill.holds[side];
      const use = hold === HOLD_LEVER ? LEVER_USE : hold === HOLD_NONE ? null : SHELL_USE;
      if (use !== null) {
        handUse[side] = use;
      } else if (handUse[side] === SHELL_USE || handUse[side] === LEVER_USE) {
        handUse[side] = null;
      }
    }
    this.handleEvents();
    drill.snapshot(this.shown);
  }

  /** Not the gunner: draw the gunner's loading a little in the past. */
  private followGunner(): void {
    const b = this.buffer;
    if (b.count > 0) {
      const delay = Math.max(0, b.transit) + bufferDelayMs(b.interval, b.jitter);
      b.sample(performance.now() - delay, this.shown);
    }
  }

  /** Take over the loading from what was drawn (the seats swapped): a shell that was in the crewmate's hand goes back in the rack. */
  private restore(s: LoadingSnapshot): void {
    const d = this.drill;
    d.reset();
    d.lever = s.lever;
    d.breechShell = s.breechShell;
    d.depth = s.depth;
    d.rammed = s.rammed;
    d.loaded = s.loaded;
    for (let i = 0; i < d.shells.length; i++) {
      const from = s.shells[i];
      const to = d.shells[i];
      if (from.place === 'breech' && i === s.breechShell) {
        to.place = 'breech';
        to.centre[0] = from.centre[0];
        to.centre[1] = from.centre[1];
        to.centre[2] = from.centre[2];
        to.axis[0] = from.axis[0];
        to.axis[1] = from.axis[1];
        to.axis[2] = from.axis[2];
      }
    }
    if (d.breechShell >= 0 && d.shells[d.breechShell].place !== 'breech') {
      d.breechShell = -1;
      d.rammed = false;
      d.loaded = false;
    }
    Object.assign(d.stats, { loads: s.loads, last: s.last, best: s.best, fumbles: s.fumbles, streak: s.streak, bestStreak: s.bestStreak });
  }

  private clearHandUse(): void {
    for (const side of SIDES) {
      if (handUse[side] === SHELL_USE || handUse[side] === LEVER_USE) handUse[side] = null;
    }
  }

  /** A shot left the gun (this page's or the crewmate's): the barrel recoils, the flash, the casing, a buzz. */
  private gunFired(): void {
    this.gun.fire(this.time, turretState().elevation);
    this.pulse('left', 1, 150);
    this.pulse('right', 1, 150);
  }

  /** A hand's grip pose in turret space. */
  private readHand(side: Side, now: number): void {
    const hand = this.hands[side];
    const turret = this.turret?.object3D;
    const test = this.testHands[side];
    if (turret == null || ride.active) {
      hand.present = false;
      return;
    }
    turret.updateMatrixWorld();
    this.toTurret.copy(turret.matrixWorld).invert();
    if (test) {
      const h = test(now);
      hand.present = h !== null;
      hand.pressed = h?.squeeze ?? false;
      hand.busy = false;
      if (h) {
        this.pos.set(h.x, h.y, h.z).applyMatrix4(this.toTurret);
        hand.pos[0] = this.pos.x;
        hand.pos[1] = this.pos.y;
        hand.pos[2] = this.pos.z;
        hand.quat[0] = 0;
        hand.quat[1] = 0;
        hand.quat[2] = 0;
        hand.quat[3] = 1;
      }
      return;
    }
    hand.present = !!this.input.xr.gamepads[side];
    hand.pressed = grip[side].pressed;
    const use = handUse[side];
    hand.busy = use !== null && use !== SHELL_USE && use !== LEVER_USE;
    if (hand.present) {
      const space = this.player.gripSpaces[side];
      space.getWorldPosition(this.pos);
      space.getWorldQuaternion(this.quat);
      this.pos.applyMatrix4(this.toTurret);
      turret.getWorldQuaternion(this.turretQuat).invert();
      this.quat.premultiply(this.turretQuat);
      hand.pos[0] = this.pos.x;
      hand.pos[1] = this.pos.y;
      hand.pos[2] = this.pos.z;
      hand.quat[0] = this.quat.x;
      hand.quat[1] = this.quat.y;
      hand.quat[2] = this.quat.z;
      hand.quat[3] = this.quat.w;
    }
  }

  private handleEvents(): void {
    const drill = this.drill;
    for (let e = 0; e < drill.eventCount; e++) {
      const { kind, side } = drill.events[e];
      switch (kind) {
        case 'grab-shell':
        case 'grab-lever':
          this.pulse(side, 0.4, 30);
          break;
        case 'capture':
          this.pulse(side, 0.5, 40);
          break;
        case 'rammed':
          this.pulse(side, 0.9, 60);
          break;
        case 'closed':
        case 'opened':
          this.pulse(side, 0.7, 40);
          break;
        case 'blocked':
          this.pulse(side, 1, 120);
          console.info('[Loading] fumble: the breech closed on a shell not rammed home');
          break;
        case 'dropped':
          console.info('[Loading] fumble: shell dropped');
          break;
        case 'loaded': {
          const st = drill.stats;
          console.info(
            `[Loading] load ${st.loads} in ${st.last.toFixed(2)} s (handling ${st.lastHandling.toFixed(2)} s), ${st.fumblesThisLoad} fumbles, ${st.streak} in a row`,
          );
          break;
        }
        case 'fired':
          console.info(`[Loading] fired, shot ${drill.stats.shots}`);
          break;
        default:
          break;
      }
    }
  }

  private pulse(side: Side | null, intensity: number, ms: number): void {
    if (side === null || this.testHands[side]) {
      return;
    }
    buzz(this.input.xr.gamepads[side]?.gamepad, side, intensity, ms);
  }

  /** 45 times a second, the gunner's page sends the loading. */
  private send(delta: number): void {
    if (!netLink.connected || !this.isOwner()) return;
    this.sendAccumulator += delta;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = Math.min(this.sendAccumulator - 1 / SEND_HZ, 1 / SEND_HZ);
    netLink.send(this.packet, encodeLoadingState(this.packet, this.seq, performance.now(), this.shown));
    this.seq = (this.seq + 1) & 0xffff;
    this.sent++;
  }

  private onLoadingState(view: DataView): void {
    if (this.isOwner() || !decodeLoadingState(view, this.header, this.incoming)) return;
    this.received++;
    if (!netLink.clockSynced) return;
    this.buffer.push(netLink.toLocal(this.header.timeMs), performance.now(), this.incoming);
  }

  private draw(): void {
    const s = this.shown;
    for (let i = 0; i < this.shells.length; i++) {
      const shell = s.shells[i];
      const mesh = this.shells[i];
      mesh.position.set(shell.centre[0], shell.centre[1], shell.centre[2]);
      // The model's nose points to -Z; shells are round, so their roll doesn't show.
      this.axis.set(shell.axis[0], shell.axis[1], shell.axis[2]);
      mesh.quaternion.setFromUnitVectors(FORWARD, this.axis);
    }
    const g = this.gun;
    for (let i = 0; i < this.casings.length; i++) {
      const c = g.casings[i];
      const mesh = this.casings[i];
      if (c.n < 0) continue;
      mesh.visible = true;
      mesh.position.set(c.centre[0], c.centre[1], c.centre[2]);
      // The casing's model has its mouth to -Z; its axis runs base to mouth.
      this.axis.set(c.axis[0], c.axis[1], c.axis[2]);
      mesh.quaternion.setFromUnitVectors(FORWARD, this.axis);
    }
    if (this.recoilPart) this.recoilPart.position.z = g.recoil;
    if (this.flash && this.flash.visible !== g.flash) this.flash.visible = g.flash;
    if (this.lever) this.lever.rotation.x = s.lever;
    if (this.block) this.block.position.y = BLOCK_OPEN_Y + (BLOCK_CLOSED_Y - BLOCK_OPEN_Y) * (s.lever / LEVER_CLOSED);
    this.drawBoard();
  }

  /** The loading board on the turret wall: a canvas, redrawn only when what it says changes. */
  private createBoard(turret: Entity): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.board = { ctx, texture };
    const mesh = new Mesh(new PlaneGeometry(BOARD.width, BOARD.height), new MeshBasicMaterial({ map: texture }));
    mesh.name = 'Loading Board';
    mesh.position.set(BOARD.x, BOARD.y, BOARD.z);
    mesh.rotation.y = BOARD.yaw;
    this.world.createTransformEntity(mesh, { parent: turret });
  }

  private drawBoard(): void {
    const s = this.shown;
    const shot = lastShotLine();
    // Drawn only when a number on it changed (a few times a load).
    if (this.boardKeyUnchanged(s, shot)) return;
    const { ctx, texture } = this.board;
    const lines = boardLines(s, shot);
    this.boardText = lines;
    ctx.fillStyle = s.loaded ? '#3f5a2a' : '#2b2622';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#c9a03a';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 506, 250);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Loading', 256, 52);
    ctx.font = '28px sans-serif';
    ctx.fillText(lines[0], 256, 112);
    ctx.fillText(lines[1], 256, 160);
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#e8c86a';
    ctx.fillText(lines[2], 256, 222, 490);
    texture.needsUpdate = true;
  }

  /** Whether the board already shows `s` and `shot`; remembers them if not. */
  private boardKeyUnchanged(s: LoadingSnapshot, shot: string): boolean {
    const phase = s.loaded ? 3 : s.breechShell >= 0 ? (s.rammed ? 2 : 1) : s.lever > 0.3 ? 4 : 0;
    const k = this.boardKey;
    if (
      k.loads === s.loads && Object.is(k.last, s.last) && Object.is(k.best, s.best) && k.fumbles === s.fumbles &&
      k.streak === s.streak && k.bestStreak === s.bestStreak && k.phase === phase && k.shot === shot
    ) {
      return true;
    }
    k.loads = s.loads;
    k.last = s.last;
    k.best = s.best;
    k.fumbles = s.fumbles;
    k.streak = s.streak;
    k.bestStreak = s.bestStreak;
    k.phase = phase;
    k.shot = shot;
    return false;
  }

  /** A turret-space point in hull space with the turret as drawn (the test hook's). */
  private hull(p: Readonly<Vec3>): number[] {
    return seatToHull(SEATS.gunner, turretState().yaw, p, [0, 0, 0]);
  }

  /** The turret-space direction from `from` to `to`, in hull space (the test hook's). */
  private hullDir(to: Readonly<Vec3>, from: Readonly<Vec3>): number[] {
    const a = this.hull(to);
    const b = this.hull(from);
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
}

const FORWARD = new Vector3(0, 0, -1);
