import {
  CanvasTexture,
  createSystem,
  type Entity,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  VisibilityState,
} from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { createHitFlag, RUN_CLOCKS, type RunClockPlace } from '../scene-assets/range-run.scene-asset.js';
import { aimAt, rangeFaces } from '../sim/ballistics.js';
import {
  clockLines,
  copyRunSnapshot,
  countdownNumber,
  createRunSnapshot,
  FINISH_SECONDS,
  flagUp,
  GO_SECONDS,
  hitFlagFoot,
  hitFlagYaw,
  RangeRun,
  readRunEvent,
  runEvent,
  runLine,
  runSign,
  type RunSnapshot,
  targetsHit,
} from '../sim/range-run.js';
import { RANGE_TARGETS } from '../sim/range.js';
import { groundHeight, wrapTile } from '../sim/terrain.js';
import { muzzlePoint } from '../sim/turret.js';
import { createTankDrive } from '../sim/tank-drive.js';
import { resetTank, tankState } from './drive-system.js';
import { decidedListeners } from './firing-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { loadForPractice, resetLoading } from './loading-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { aimTurret, turretForward } from './turret-system.js';

/** Ready to fire waits this long for the tank to reach the start before laying the gun, s. */
const READY_WAIT = 5;
/** The tank counts as parked at the start within this distance (m) and below this speed (m/s). */
const AT_START = 0.5;
const STILL = 0.1;

type RunAsk = 'start' | 'stop' | 'assist';
const ASKS: readonly RunAsk[] = ['start', 'stop', 'assist'];

let active: RangeRunSystem | null = null;

/** Practice → Range run → Start (or Restart): the tank back at the start, a countdown, then the clock runs until all three targets are hit. The host does it; a guest asks. */
export function startRun(): void {
  active?.ask('start');
}

/** Practice → Range run → Stop: no time, the clock and the flags go. */
export function stopRun(): void {
  active?.ask('stop');
}

/**
 * Practice → Ready to fire (100 m, 250 m, 500 m): the tank parked at the
 * start, where each target stands at its marked range, the gun laid on
 * target `i` and loaded, so one pull of the trigger hits it. Alone, the
 * player goes to the gunner's seat; in a crew the seats stay and the
 * gunner's page lays and loads. Marks a run on now as assisted.
 */
export function readyToFire(i: number): void {
  active?.ready(i);
}

/** One line for the game menu. */
export function runStatus(): string {
  return active ? runLine(active.run.s) : '';
}

/** The run as this page shows it (the host's own, or its word on a guest): for F1.14's play-test stats. */
export function shownRun(): Readonly<RunSnapshot> {
  return active?.run.s ?? createRunSnapshot();
}

/** Whether this page lays and loads the gun: the gunner's page, or alone whichever seat (as TurretSystem and LoadingSystem own them). */
function ownsGun(): boolean {
  return !netLink.connected || seating.mine === 'gunner';
}

interface RunClock {
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
}

interface RangeRunDebug {
  /** The run as this page shows it. */
  state(): RunSnapshot & { targets: number; line: string };
  start(): void;
  stop(): void;
  ready(i: number): void;
  /** What the two run clocks say. */
  clock(): string[];
  /** Which hit flags are up. */
  flags(): boolean[];
  /** Where flag `i` is drawn (ground space), or null while it's down. */
  flagAt(i: number): number[] | null;
  /** A Ready to fire waiting for the tank to reach the start, or -1. */
  readonly pending: number;
  readonly sign: string;
  readonly sent: number;
  readonly received: number;
}

/**
 * The range run (F1.11, docs/range-run.md): how long a crew takes to hit
 * the range's three targets (the concept's play-test question). Start it
 * from the game menu and the tank goes back to the start, the turret
 * forward and the shells back in the rack; a sign counts down 3, 2, 1, Go!
 * and the clock runs until each target has been hit once. A red flag goes
 * up beside each target as it is hit, and a run clock in each seat (on the
 * front plate right of the driver's slit, over the gunner's loading board)
 * shows the time, the targets and the shots.
 *
 * The host keeps the run (src/sim/range-run.ts), as it decides hits
 * (FiringSystem's decidedListeners), and sends it as a reliable `run` event
 * whenever it changes; the guest copies it and runs the clock on between
 * events, on the shared clock. A guest's Start and Stop ask the host
 * (`run-ask`). The clock stands still while the crewmate is away. Ready to
 * fire parks the tank and has the gunner's page lay the gun with `aimAt`
 * and load it (`range-ready` when the button was pressed on the other
 * page). Runs after FiringSystem.
 */
export class RangeRunSystem extends createSystem({}) {
  readonly run = new RangeRun();
  private faces = rangeFaces();
  private start = createTankDrive();
  private flags: Mesh[] = [];
  private flagY: number[] = [];
  private clocks: RunClock[] = [];
  /** What the clocks were last drawn from: phase, tenths on the clock, targets, shots, paused, assisted, best. */
  private clockKey: number[] = [-1, 0, 0, 0, 0, 0, 0];
  private clockText: string[] = [];
  private sign!: FloatingSign;
  private signKey = '';
  /** What the sign was last drawn for: the countdown's number, 4 for Go!, 5 for the finish, 0 for none. */
  private signState = -1;
  private sentVersion = -1;
  private wasConnected = false;
  private seenId = 0;
  private wasDone = false;
  private doneAt = 0;
  private pendingTarget = -1;
  private pendingSince = 0;
  private time = 0;
  private sent = 0;
  private received = 0;

  init(): void {
    active = this;
    const ground = this.world.getSceneEntity('ground') ?? null;
    if (ground == null) console.warn('[RangeRun] no ground in the scene');
    RANGE_TARGETS.forEach((_, i) => {
      const flag = createHitFlag();
      flag.visible = false;
      flag.rotation.y = hitFlagYaw(i);
      this.flags.push(flag);
      const [x, z] = hitFlagFoot(i);
      this.flagY.push(groundHeight(x, z));
      if (ground) this.world.createTransformEntity(flag, { parent: ground });
    });
    const turret = this.world.getSceneEntity('turret') ?? null;
    this.clocks.push(this.createClock(RUN_CLOCKS.driver, null, 'Run Clock Driver'));
    this.clocks.push(this.createClock(RUN_CLOCKS.gunner, turret, 'Run Clock Gunner'));
    this.sign = new FloatingSign('Run Sign', 0.8, [512, 140], 1.1, 0.05);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.events.set('run', (e) => this.onRun(e));
    netLink.events.set('run-ask', (e) => {
      const what = ASKS.find((a) => a === e.what);
      if (netLink.isHost && what) this.act(what);
    });
    netLink.events.set('range-ready', (e) => {
      const target = Number(e.target);
      if (Number.isInteger(target) && target >= 0 && target < RANGE_TARGETS.length && ownsGun()) this.pend(target);
    });
    const onDecided = (target: number, flight: number) => {
      if (netLink.isHost) this.run.shot(target, flight);
    };
    decidedListeners.add(onDecided);
    this.cleanupFuncs.push(
      () => netLink.events.delete('run'),
      () => netLink.events.delete('run-ask'),
      () => netLink.events.delete('range-ready'),
      () => decidedListeners.delete(onDecided),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __rangeRun: RangeRunDebug }).__rangeRun = {
      state: () => {
        const s = copyRunSnapshot(self.run.s, createRunSnapshot());
        return { ...s, targets: s.hitAt.filter((t) => t >= 0).length, line: runLine(s) };
      },
      start: () => startRun(),
      stop: () => stopRun(),
      ready: (i) => readyToFire(i),
      clock: () => [...self.clockText],
      flags: () => self.flags.map((f) => f.visible),
      flagAt: (i) => (self.flags[i]?.visible ? self.flags[i].position.toArray() : null),
      get pending() { return self.pendingTarget; },
      get sign() { return self.sign.visible ? self.signKey : ''; },
      get sent() { return self.sent; },
      get received() { return self.received; },
    };
  }

  /** Start, stop or mark the run assisted: the host does it; a guest asks the host. */
  ask(what: RunAsk): void {
    if (netLink.isHost) this.act(what);
    else {
      const event = { t: 'run-ask', what };
      netLink.sendEvent(event);
    }
  }

  /** The host. */
  private act(what: RunAsk): void {
    if (what === 'start') {
      this.run.start();
      resetTank();
      console.info(`[RangeRun] run ${this.run.s.id} starting`);
    } else if (what === 'stop') {
      this.run.stop();
      console.info('[RangeRun] stopped');
    } else {
      this.run.assist();
    }
  }

  ready(i: number): void {
    if (!(i >= 0 && i < RANGE_TARGETS.length)) return;
    // Alone, into the gunner's seat to pull the trigger; in a crew the seats stay.
    if (!netLink.connected) seating.ask('gunner');
    resetTank();
    this.ask('assist');
    if (ownsGun()) this.pend(i);
    else {
      const event = { t: 'range-ready', target: i };
      netLink.sendEvent(event);
    }
    console.info(`[RangeRun] ready to fire on the ${RANGE_TARGETS[i].range} m target`);
  }

  /** The gunner's page: lay and load once the tank stands at the start. */
  private pend(i: number): void {
    this.pendingTarget = i;
    this.pendingSince = this.time;
  }

  /** The host's word on the run. */
  private onRun(e: Record<string, unknown>): void {
    if (netLink.isHost) return;
    const incoming = createRunSnapshot();
    const read = readRunEvent(e, incoming);
    if (read == null) return;
    this.received++;
    const age = netLink.clockSynced ? (performance.now() - netLink.toLocal(read.at)) / 1000 : 0;
    this.run.apply(incoming, age);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    const run = this.run;
    if (netLink.isHost) {
      run.setPaused(netLink.connected && crewPresence.paused);
      run.step(dt);
      const joined = netLink.connected && !this.wasConnected;
      if (netLink.connected && (joined || run.version !== this.sentVersion)) {
        netLink.sendEvent(runEvent(run.s, performance.now()));
        this.sent++;
      }
      this.sentVersion = run.version;
    } else {
      run.follow(dt);
    }
    this.wasConnected = netLink.connected;

    const s = run.s;
    if (s.id !== this.seenId) {
      this.seenId = s.id;
      // A fresh start (not a run joined part-way): the gunner's page puts the turret forward and the shells back.
      if (s.phase === 'running' && s.clock < 0 && ownsGun()) {
        turretForward();
        resetLoading();
        this.pendingTarget = -1;
      }
    }
    const done = s.phase === 'done';
    if (done && !this.wasDone) {
      this.doneAt = this.time;
      console.info(`[RangeRun] ${runLine(s)}`);
    }
    this.wasDone = done;

    this.layAndLoad();
    this.drawFlags();
    this.drawClocks();
    this.drawSign(delta);
  }

  /** Ready to fire, on the gunner's page: once the tank stands at the start, lay the gun on the target and load it. */
  private layAndLoad(): void {
    const i = this.pendingTarget;
    if (i < 0) return;
    if (!ownsGun() || this.time - this.pendingSince > READY_WAIT) {
      this.pendingTarget = -1;
      console.warn('[RangeRun] ready to fire: gave up waiting for the tank');
      return;
    }
    const tank = tankState();
    if (Math.hypot(tank.x - this.start.x, tank.z - this.start.z) > AT_START || Math.abs(tank.speed) > STILL) return;
    const aim = aimAt(tank, this.faces[i], muzzlePoint);
    aimTurret(aim.yaw, aim.elevation);
    loadForPractice();
    this.pendingTarget = -1;
  }

  /** Each hit target's flag at the copy of it nearest the tank (the ground repeats every tile). */
  private drawFlags(): void {
    const s = this.run.s;
    const tank = tankState();
    // The ground is drawn at the tank's position less whole tiles (as FiringSystem's tracers).
    const tx = wrapTile(tank.x);
    const tz = wrapTile(tank.z);
    for (let i = 0; i < this.flags.length; i++) {
      const flag = this.flags[i];
      const up = flagUp(s, i);
      if (flag.visible !== up) flag.visible = up;
      if (!up) continue;
      const [x, z] = hitFlagFoot(i);
      flag.position.set(tx + wrapTile(x - tank.x), this.flagY[i], tz + wrapTile(z - tank.z));
    }
  }

  private createClock(place: RunClockPlace, parent: Entity | null, name: string): RunClock {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(place.width, place.height), new MeshBasicMaterial({ map: texture }));
    mesh.name = name;
    mesh.position.set(place.x, place.y, place.z);
    mesh.rotation.y = place.yaw;
    if (parent) this.world.createTransformEntity(mesh, { parent });
    else this.world.createTransformEntity(mesh);
    return { ctx, texture };
  }

  /** Both clocks show the same; drawn only when what they say changes (ten times a second while the clock runs). */
  private drawClocks(): void {
    const s = this.run.s;
    const k = this.clockKey;
    const phase = s.phase === 'idle' ? 0 : s.phase === 'running' ? 1 : 2;
    const tenths = Math.floor(s.clock * 10);
    const targets = targetsHit(s);
    const flags = (s.paused ? 1 : 0) + (s.assisted ? 2 : 0);
    if (k[0] === phase && k[1] === tenths && k[2] === targets && k[3] === s.shots && k[4] === flags && k[5] === s.best && k[6] === s.time) return;
    k[0] = phase;
    k[1] = tenths;
    k[2] = targets;
    k[3] = s.shots;
    k[4] = flags;
    k[5] = s.best;
    k[6] = s.time;
    const lines = clockLines(s);
    this.clockText = lines;
    const lit = s.phase === 'done' ? '#3f5a2a' : s.phase === 'running' && s.clock >= 0 && !s.paused ? '#2b3a4a' : '#2b2622';
    for (const { ctx, texture } of this.clocks) {
      ctx.fillStyle = lit;
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#c9a03a';
      ctx.lineWidth = 5;
      ctx.strokeRect(2.5, 2.5, 251, 123);
      ctx.fillStyle = '#f4ead8';
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(lines[0], 128, 28);
      ctx.font = 'bold 52px monospace';
      ctx.fillText(lines[1], 128, 82);
      ctx.font = '19px sans-serif';
      ctx.fillText(lines[2], 128, 114);
      texture.needsUpdate = true;
    }
  }

  /** The countdown, Go! and the finish, on a sign in front of each player. */
  private drawSign(delta: number): void {
    const s = this.run.s;
    const doneFor = this.time - this.doneAt;
    const state = s.phase === 'running' ? (s.clock < 0 ? countdownNumber(s) : s.clock < GO_SECONDS ? 4 : 0) : s.phase === 'done' && doneFor < FINISH_SECONDS ? 5 : 0;
    if (state !== this.signState) {
      this.signState = state;
      const text = runSign(s, doneFor);
      this.signKey = text;
      if (text === '') {
        this.sign.setVisible(false);
      } else {
        const { ctx, width, height } = this.sign;
        drawSignBackground(ctx, width, height);
        ctx.fillStyle = '#f4ead8';
        ctx.textAlign = 'center';
        ctx.font = 'bold 44px sans-serif';
        ctx.fillText(text, width / 2, height / 2 + 15, width - 30);
        this.sign.refresh();
        this.sign.setVisible(true);
      }
    }
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}
