import {
  CanvasTexture,
  createSystem,
  type Entity,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import {
  BLOCK_CLOSED_Y,
  BLOCK_OPEN_Y,
  BLOCK_X,
  BLOCK_Z,
  BOARD,
  createBreechBlock,
  createBreechLever,
  createLoadingStation,
  createShell,
} from '../scene-assets/loading-drill.scene-asset.js';
import {
  boardLines,
  BREECH_MOUTH,
  createDrillHand,
  type DrillHand,
  HOLD_LEVER,
  HOLD_NONE,
  LEVER_CLOSED,
  LEVER_HANDLE_X,
  LEVER_LENGTH,
  LEVER_PIVOT,
  leverHandle,
  LOADER_SEAT,
  LoadingDrill,
  type Side,
  STATION_SPOT,
  type Vec3,
} from '../sim/loading.js';
import { grip, handUse } from './grip-system.js';
import { HoldKind, lockResolvers } from './hand-lock.js';
import { buzz } from './haptics.js';
import { seating } from './seating.js';

const SIDES = ['left', 'right'] as const;

/** What a hand holding part of the drill puts in `handUse` (mapped to a HoldKind in holdKindOf, net-system.ts). */
export const SHELL_USE = 'shell';
export const LEVER_USE = 'breech-lever';

/** A scripted hand for tests without a headset: grip position in hull space and squeeze (held level). */
export interface DrillTestHand {
  x: number;
  y: number;
  z: number;
  squeeze: boolean;
}
type DrillTestHandFn = (nowMs: number) => DrillTestHand | null;

/** A station-space point in hull space, for the test hook. */
function toHull(p: readonly number[]): number[] {
  return [p[0] + STATION_SPOT.x, p[1], p[2] + STATION_SPOT.z];
}

let active: LoadingDrillSystem | null = null;

/** The game menu's Practice → Loading drill: sit at the breech with every shell in the rack and the stats cleared. */
export function startLoadingDrill(): void {
  active?.start();
}

/**
 * Spike S4: the loading drill (docs/spikes/s4-loading.md). Draws the
 * loading station and feeds both hands to the drill's rules
 * (src/sim/loading.ts) each frame: take a shell from the rack, swing it to
 * the breech, ram it, close the breech with the lever; the drill fires by
 * itself and times the next load. Buzzes the controller as the shell snaps
 * onto the bore, goes home, and as the breech closes and fires.
 *
 * Each player has their own drill: nothing of it is sent to the crewmate,
 * who sees only the hands (F1.10 makes loading shared). Runs before the
 * throwables, which skip a hand that holds a shell or the lever.
 *
 * The station stands beside the tank: everything is drawn under one
 * entity at STATION_SPOT, and the hands are moved into station space
 * before the drill sees them. The test hook speaks hull space.
 */
export class LoadingDrillSystem extends createSystem({}) {
  readonly drill = new LoadingDrill();
  private hands: Record<Side, DrillHand> = { left: createDrillHand(), right: createDrillHand() };
  private testHands: Record<Side, DrillTestHandFn | null> = { left: null, right: null };
  private shells: Mesh[] = [];
  private block!: Mesh;
  private lever!: Mesh;
  private board!: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  private shownVersion = -1;
  private boardText: [string, string, string] = ['', '', ''];
  private pos = new Vector3();
  private quat = new Quaternion();
  private axis = new Vector3();
  private handle: Vec3 = [0, 0, 0];

  init(): void {
    active = this;
    const station = this.world.createTransformEntity();
    station.object3D!.name = 'Loading Drill';
    station.object3D!.position.set(STATION_SPOT.x, 0, STATION_SPOT.z);
    this.world.createTransformEntity(createLoadingStation(), station);
    for (let i = 0; i < this.drill.shells.length; i++) {
      const shell = createShell(i);
      this.shells.push(shell);
      this.world.createTransformEntity(shell, station);
    }
    this.block = createBreechBlock();
    this.block.position.set(BLOCK_X, BLOCK_OPEN_Y, BLOCK_Z);
    this.world.createTransformEntity(this.block, station);
    this.lever = createBreechLever();
    this.lever.position.set(...LEVER_PIVOT);
    this.world.createTransformEntity(this.lever, station);
    this.createBoard(station);
    this.draw();

    // Grip locking: a hand on the lever is drawn closed round its handle, which runs along X.
    lockResolvers.set(HoldKind.BreechLever, (_hand, point, axis) => {
      leverHandle(this.drill.lever, this.handle);
      point.set(this.handle[0] + STATION_SPOT.x, this.handle[1], this.handle[2] + STATION_SPOT.z);
      axis.set(1, 0, 0);
    });
    this.cleanupFuncs.push(() => {
      lockResolvers.delete(HoldKind.BreechLever);
      if (active === this) active = null;
    });

    const drill = this.drill;
    (window as unknown as { __loading: unknown }).__loading = {
      state: () => ({
        shells: drill.shells.map((s, i) => ({ place: s.place, heldBy: s.heldBy, centre: toHull(s.centre), nose: toHull(drill.nose(i, [0, 0, 0])) })),
        holds: { ...drill.holds },
        lever: drill.lever,
        leverHandle: toHull(leverHandle(drill.lever, [0, 0, 0])),
        breechShell: drill.breechShell,
        depth: drill.depth,
        rammed: drill.rammed,
        loaded: drill.loaded,
        board: [...this.boardText],
      }),
      stats: drill.stats,
      start: startLoadingDrill,
      reset: () => drill.reset(),
      setTestHand: (side: Side, hand: DrillTestHandFn | null) => {
        this.testHands[side] = hand;
      },
      /** Where the seated loader's eyes go, and where the breech and the lever are, hull space. */
      seat: { x: LOADER_SEAT.x + STATION_SPOT.x, z: LOADER_SEAT.z + STATION_SPOT.z },
      layout: { mouth: toHull(BREECH_MOUTH), pivot: toHull(LEVER_PIVOT), leverLength: LEVER_LENGTH, handleX: LEVER_HANDLE_X },
    };
  }

  update(delta: number): void {
    const now = performance.now();
    for (const side of SIDES) {
      this.readHand(side, now);
    }
    this.drill.update(Math.min(delta, 0.1), this.hands.left, this.hands.right);
    for (const side of SIDES) {
      const hold = this.drill.holds[side];
      const use = hold === HOLD_LEVER ? LEVER_USE : hold === HOLD_NONE ? null : SHELL_USE;
      if (use !== null) {
        handUse[side] = use;
      } else if (handUse[side] === SHELL_USE || handUse[side] === LEVER_USE) {
        handUse[side] = null;
      }
    }
    this.handleEvents();
    this.draw();
  }

  /** Sit at the breech (in VR), every shell back in the rack, the breech open and the stats cleared. */
  start(): void {
    this.drill.reset();
    if (this.world.session) {
      // Turn the player to face the gun (-Z) and put their head over the seat; the seat system waits till they go back to theirs.
      seating.away = true;
      const player = this.player;
      player.rotation.set(0, 0, 0);
      player.updateMatrixWorld(true);
      const head = this.player.head.position;
      player.position.x = LOADER_SEAT.x + STATION_SPOT.x - head.x;
      player.position.z = LOADER_SEAT.z + STATION_SPOT.z - head.z;
    }
    console.info('[Loading] drill started');
  }

  private readHand(side: Side, now: number): void {
    const hand = this.hands[side];
    const test = this.testHands[side];
    if (test) {
      const h = test(now);
      hand.present = h !== null;
      hand.pressed = h?.squeeze ?? false;
      hand.busy = false;
      if (h) {
        hand.pos[0] = h.x - STATION_SPOT.x;
        hand.pos[1] = h.y;
        hand.pos[2] = h.z - STATION_SPOT.z;
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
      hand.pos[0] = this.pos.x - STATION_SPOT.x;
      hand.pos[1] = this.pos.y;
      hand.pos[2] = this.pos.z - STATION_SPOT.z;
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
          this.pulse('left', 1, 150);
          this.pulse('right', 1, 150);
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

  private draw(): void {
    const drill = this.drill;
    for (let i = 0; i < this.shells.length; i++) {
      const s = drill.shells[i];
      const mesh = this.shells[i];
      mesh.position.set(s.centre[0], s.centre[1], s.centre[2]);
      // The model's nose points to -Z; shells are round, so their roll doesn't show.
      this.axis.set(s.axis[0], s.axis[1], s.axis[2]);
      mesh.quaternion.setFromUnitVectors(FORWARD, this.axis);
    }
    this.lever.rotation.x = drill.lever;
    this.block.position.y = BLOCK_OPEN_Y + (BLOCK_CLOSED_Y - BLOCK_OPEN_Y) * (drill.lever / LEVER_CLOSED);
    if (drill.version !== this.shownVersion) {
      this.shownVersion = drill.version;
      this.drawBoard();
    }
  }

  /** The drill's board on its post ahead of the seat. */
  private createBoard(station: Entity): void {
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
    this.world.createTransformEntity(mesh, station);
  }

  private drawBoard(): void {
    const { ctx, texture } = this.board;
    const lines = boardLines(this.drill);
    this.boardText = lines;
    ctx.fillStyle = this.drill.loaded ? '#3f5a2a' : '#2b2622';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#c9a03a';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 506, 250);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Loading drill', 256, 52);
    ctx.font = '30px sans-serif';
    ctx.fillText(lines[0], 256, 112);
    ctx.fillText(lines[1], 256, 160);
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = '#e8c86a';
    ctx.fillText(lines[2], 256, 222);
    texture.needsUpdate = true;
  }
}

const FORWARD = new Vector3(0, 0, -1);
