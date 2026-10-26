import {
  CanvasTexture,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import {
  createBench,
  createButtonCap,
  createLever,
  createTwistGrip,
  createWheel,
  createYoke,
  SCREEN_GAP,
} from '../scene-assets/mechanism.scene-asset.js';
import { Button, Lever, type Mechanism, MechEvent, TwistGrip, Wheel, Yoke } from '../sim/mechanism.js';
import {
  BENCH,
  BUTTON,
  type BenchControl,
  CRANK,
  HANDWHEEL,
  MOUNTS,
  NOTCHED_LEVER,
  SWITCH,
  TWIST,
  YOKE,
} from '../sim/mechanism-bench.js';
import { HoldKind } from './hand-lock.js';
import { addControl, type Control, letGo } from './mechanism-system.js';

const DEG = Math.PI / 180;
/** The board's canvas, px. */
const PX_W = 512;
const PX_H = 256;
/** The board is redrawn this often, Hz. */
const DRAW_HZ = 10;
const BUTTON_RED = 0xa83228;
const SWITCH_GREEN = 0x3a8a3a;

let requested: 'show' | 'hide' | null = null;
/** Practice > Mechanism kit > In front of me: put the test bench in front of the player (again). */
export function showMechanismBench(): void {
  requested = 'show';
}
/** Practice > Mechanism kit > Put away. */
export function hideMechanismBench(): void {
  requested = 'hide';
}

interface BenchDebug {
  readonly shown: boolean;
  show(): void;
  hide(): void;
  /** The board's lines as drawn last. */
  lines(): string[];
  /** Trigger pulls on the twist grip since the bench was put out. */
  readonly pulls: number;
  /** Each control's name in window.__mechanisms. */
  names: Record<BenchControl, string>;
}

/**
 * The mechanism kit's test bench (F1.3, docs/mechanisms.md): Practice >
 * Mechanism kit puts one of each mechanism on a bench in front of the
 * player, facing the way they face, with a board reading each one out: a
 * notched lever, a crank, a handwheel with stops, a twist grip with a
 * trigger, a yoke, a push button and a switch. MechanismSystem takes hold
 * of them, moves them and buzzes; this system places the bench, draws the
 * moving parts and the board.
 *
 * One player's only, like spike S3's rig: it is drawn where this player
 * put it, its handles are HoldKind.LocalControl (not sent), and nothing
 * goes over the network.
 */
export class MechanismBenchSystem extends createSystem({}) {
  private root = new Group();
  private lever = new Lever(NOTCHED_LEVER);
  private crank = new Wheel(CRANK);
  private wheel = new Wheel(HANDWHEEL);
  private twist = new TwistGrip(TWIST);
  private yoke = new Yoke(YOKE);
  private button = new Button(BUTTON);
  private switch = new Button(SWITCH);
  private controls: Control[] = [];
  /** The moving part of each control. */
  private parts = {} as Record<BenchControl, Object3D>;
  private pulls = 0;
  private lines: string[] = [];
  private drawClock = 0;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private forward = new Vector3();

  init(): void {
    this.root.add(createBench());
    const mechs: Record<BenchControl, Mechanism> = {
      lever: this.lever, crank: this.crank, wheel: this.wheel, twist: this.twist,
      yoke: this.yoke, button: this.button, switch: this.switch,
    };
    const meshes: Record<BenchControl, Object3D> = {
      lever: createLever(NOTCHED_LEVER),
      crank: createWheel(CRANK),
      wheel: createWheel(HANDWHEEL),
      twist: createTwistGrip(TWIST),
      yoke: createYoke(YOKE),
      button: createButtonCap(BUTTON, BUTTON_RED),
      switch: createButtonCap(SWITCH, SWITCH_GREEN),
    };
    const names = {} as Record<BenchControl, string>;
    for (const key of Object.keys(MOUNTS) as BenchControl[]) {
      // The mount is the mechanism's space; the part inside it moves.
      const mount = new Group();
      const [x, y, z] = MOUNTS[key].at;
      mount.position.set(x, y, z);
      mount.rotation.x = MOUNTS[key].tilt;
      mount.add(meshes[key]);
      this.root.add(mount);
      this.parts[key] = meshes[key];
      names[key] = `bench-${key}`;
      const isButton = key === 'button' || key === 'switch';
      const control: Control = {
        name: names[key],
        mech: mechs[key],
        frame: mount,
        kind: isButton ? HoldKind.None : HoldKind.LocalControl,
        active: () => this.root.visible,
        moved: (events) => this.moved(key, events),
      };
      this.controls.push(control);
      this.cleanupFuncs.push(addControl(control));
    }
    this.root.add(this.createScreen());
    this.root.name = 'Mechanism Bench';
    this.root.visible = false;
    this.world.createTransformEntity(this.root);

    const self = this;
    const debug: BenchDebug = {
      get shown() { return requested === 'show' || (requested === null && self.root.visible); },
      show: showMechanismBench,
      hide: hideMechanismBench,
      lines: () => [...this.lines],
      get pulls() { return self.pulls; },
      names,
    };
    (window as unknown as { __bench: BenchDebug }).__bench = debug;
  }

  update(delta: number): void {
    if (requested) {
      if (requested === 'show') this.place();
      else this.putAway();
      requested = null;
    }
    if (!this.root.visible) {
      return;
    }
    this.drawClock += Math.min(delta, 0.1);
    if (this.drawClock >= 1 / DRAW_HZ) {
      this.drawClock = 0;
      this.draw();
    }
  }

  /** The kit moved a control: draw it, and count trigger pulls. */
  private moved(key: BenchControl, events: number): void {
    const part = this.parts[key];
    switch (key) {
      case 'lever': part.rotation.x = -this.lever.angle; break;
      case 'crank': part.rotation.z = this.crank.angle; break;
      case 'wheel': part.rotation.z = this.wheel.angle; break;
      case 'twist':
        part.rotation.y = this.twist.angle;
        if (events & MechEvent.Press) this.pulls++;
        break;
      case 'yoke': part.rotation.y = this.yoke.angle; break;
      case 'button':
      case 'switch': {
        const b = key === 'button' ? this.button : this.switch;
        // A switch that is on stays part way in, and glows.
        part.position.z = -Math.max(b.depth, b.spec.latching && b.on ? b.spec.travel * 0.5 : 0);
        const lit = (part as Mesh).material as MeshStandardMaterial;
        lit.emissive.setHex(b.on ? (key === 'button' ? BUTTON_RED : SWITCH_GREEN) : 0x000000);
        lit.emissiveIntensity = b.on ? 0.8 : 0;
        break;
      }
    }
  }

  /** Put the bench in front of the player's eyes, facing the way they face, every control back at its start. */
  private place(): void {
    this.putAway();
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const head = immersive ? this.player.head : this.camera;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this.headPos);
    head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.root.position.copy(this.headPos).addScaledVector(this.forward, BENCH.ahead);
    this.root.position.y -= BENCH.below;
    this.root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    this.root.visible = true;
    this.draw();
  }

  private putAway(): void {
    for (const control of this.controls) letGo(control);
    this.lever.angle = NOTCHED_LEVER.rest;
    this.crank.angle = 0;
    this.wheel.angle = 0;
    this.twist.angle = 0;
    this.yoke.angle = 0;
    for (const b of [this.button, this.switch]) {
      b.on = false;
      b.down = false;
      b.depth = 0;
      b.presses = 0;
    }
    this.pulls = 0;
    for (const key of Object.keys(MOUNTS) as BenchControl[]) this.moved(key, 0);
    this.root.visible = false;
  }

  private createScreen(): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = PX_W;
    canvas.height = PX_H;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const { board } = BENCH;
    const screen = new Mesh(
      new PlaneGeometry(board.width, board.height),
      new MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    screen.name = 'Mechanism Board';
    screen.position.set(0, board.y + Math.sin(board.tilt) * SCREEN_GAP, board.z + Math.cos(board.tilt) * SCREEN_GAP);
    screen.rotation.x = -board.tilt;
    return screen;
  }

  /** Each control's reading, one line each, the held ones in yellow. */
  private draw(): void {
    const sign = (v: number, digits: number) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
    const held = (m: Mechanism) => (m.anyHeld ? '  held' : '');
    const notches = NOTCHED_LEVER.notches!;
    const lines = [
      `Lever   notch ${this.lever.notch() + 1} of ${notches.length}  ${sign(this.lever.angle / DEG, 0)}°${held(this.lever)}`,
      `Crank   ${sign(this.crank.turns, 2)} turns${held(this.crank)}`,
      `Wheel   ${sign(this.wheel.turns, 2)} turns, stops at ±2${held(this.wheel)}`,
      `Twist   ${sign(this.twist.demand() * 100, 0)}%  trigger pulls ${this.pulls}${this.twist.firing ? ' FIRE' : ''}${held(this.twist)}`,
      `Yoke    ${sign(this.yoke.angle / DEG, 0)}°${held(this.yoke)}`,
      `Button  ${this.button.presses} presses   Switch ${this.switch.on ? 'ON' : 'off'}`,
    ];
    this.lines = lines;
    const { ctx } = this;
    ctx.fillStyle = '#1d2012';
    ctx.fillRect(0, 0, PX_W, PX_H);
    ctx.fillStyle = '#c9c0a0';
    ctx.font = 'bold 20px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('MECHANISM KIT', 16, 20);
    ctx.font = '22px monospace';
    const mechs = [this.lever, this.crank, this.wheel, this.twist, this.yoke, null];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = mechs[i]?.anyHeld ? '#f0c040' : '#efe6c8';
      ctx.fillText(lines[i], 16, 56 + i * 34, PX_W - 32);
    }
    this.texture.needsUpdate = true;
  }
}
