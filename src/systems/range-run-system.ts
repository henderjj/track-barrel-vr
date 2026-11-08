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
import { boardCoverSpot, createBoardCover, createHitFlag, RUN_CLOCKS, type RunClockPlace } from '../scene-assets/range-run.scene-asset.js';
import { aimAt, targetFaces } from '../sim/ballistics.js';
import { BOARD_FIRST, boardDown, boardsDown, BOARDS_PER_LINE, lineClosed, lineFor } from '../sim/biathlon.js';
import { BOX_Z, boxSpot, COURSE_START, COURSE_TARGETS } from '../sim/course.js';
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
  type RunMode,
  RUN_MODES,
  type RunSnapshot,
  targetsHit,
} from '../sim/range-run.js';
import type { SeatId } from '../sim/cabin.js';
import { RANGE_TARGETS } from '../sim/range.js';
import { groundHeight, wrapTile } from '../sim/terrain.js';
import { muzzlePoint } from '../sim/turret.js';
import { createTankDrive } from '../sim/tank-drive.js';
import { goToFiringLine, shownCourse } from './course-system.js';
import { placeTank, resetTank, tankState } from './drive-system.js';
import { decidedListeners } from './firing-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { limitRounds, loadForPractice, loadingRounds, resetLoading } from './loading-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { aimTurret, turretForward } from './turret-system.js';

/** Ready to fire waits this long for the tank to reach the start before laying the gun, s. */
const READY_WAIT = 5;
/** The tank counts as parked at the start within this distance (m) and below this speed (m/s). */
const AT_START = 0.5;
const STILL = 0.1;
/** How long a race's note (a line shot, a loop driven, the finish) stays on the sign, s. */
const NOTE_SECONDS = 4;
/**
 * While a run's clock runs, the host sends it again at least this often, s,
 * so the guest's clock (run on by its own frames between the host's words)
 * can't drift from the host's: a page's slow frames are cut to 0.25 s each,
 * so the two pages lose different amounts of time when they stutter, and a
 * race runs about nine minutes.
 */
const RESYNC_SECONDS = 1;

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
 * Practice → Biathlon race → Start (or Restart), F5.3b: the tank parked
 * short of the course's start line, a countdown, then three laps against
 * the clock with three rounds at each firing line. The host does it; a
 * guest asks.
 */
export function startRace(): void {
  active?.ask('start', 'biathlon');
}

/**
 * Practice → Biathlon race → Ready at line 1 or 2: the tank parked halted
 * in firing box `k` with the engine running, the gun laid on the line's
 * first board still standing and loaded. Alone, the player takes the
 * gunner's seat. Marks a race on now as assisted.
 */
export function readyAtLine(k: number): void {
  active?.readyLine(k);
}

/**
 * Practice → Ready to fire (100 m, 250 m, 500 m): the tank parked at the
 * start, where each target stands at its marked range, the gun laid on
 * target `i` and loaded, so one pull of the trigger hits it. Alone, the
 * player goes to `seat` (the gunner's, or the driver's to watch the firing
 * lamp, F2.5); in a crew the seats stay and the gunner's page lays and
 * loads. Marks a run on now as assisted.
 */
export function readyToFire(i: number, seat: SeatId = 'gunner'): void {
  active?.ready(i, seat);
}

/** One line for the game menu's Range run row. */
export function runStatus(): string {
  if (active == null) return '';
  const s = active.run.s;
  return s.mode === 'range' ? runLine(s) : 'No range run on: a biathlon race is.';
}

/** One line for the game menu's Biathlon race row (F5.3b). */
export function raceStatus(): string {
  if (active == null) return '';
  const s = active.run.s;
  return s.mode === 'biathlon' ? runLine(s) : 'No race on: three laps of the course, three rounds at each line.';
}

/** The run as this page shows it (the host's own, or its word on a guest): for F1.14's play-test stats. */
export function shownRun(): Readonly<RunSnapshot> {
  return active?.run.s ?? NO_RUN;
}
const NO_RUN = createRunSnapshot();

/**
 * The firing line whose boards a shot can bring down now in a race (F5.3b),
 * or -1: the race's clock running, this lap's line not shot yet, and the
 * tank halted in its box. The practice crewmate fires only then.
 */
export function raceLineNow(): number {
  const s = shownRun();
  if (s.mode !== 'biathlon' || s.phase !== 'running' || s.clock < 0 || s.paused) return -1;
  const line = lineFor(s.laps);
  if (line < 0 || lineClosed(s, line) || s.rounds <= 0) return -1;
  const c = shownCourse();
  return c.box === line && c.halted ? line : -1;
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
  /** Start a biathlon race (F5.3b). */
  race(): void;
  /** Ready at line k: parked in its box, laid on a standing board and loaded. */
  readyLine(k: number): void;
  /** Which course boards are covered (fallen), line 1's three then line 2's. */
  covers(): boolean[];
  /** Where board cover `j` is drawn (ground space), or null while it's hidden. */
  coverAt(j: number): number[] | null;
  /** The rounds the loading on this page allows (null: no limit, or not the loading page). */
  rounds(): number | null;
  /** The line a shot counts at now, or -1. */
  lineNow(): number;
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
 * whenever it changes (and each second while the clock runs); the guest
 * copies it and runs the clock on between events, on the shared clock. A guest's Start and Stop ask the host
 * (`run-ask`). The clock stands still while the crewmate is away. Ready to
 * fire parks the tank and has the gunner's page lay the gun with `aimAt`
 * and load it (`range-ready` when the button was pressed on the other
 * page). Runs after FiringSystem.
 */
export class RangeRunSystem extends createSystem({}) {
  readonly run = new RangeRun();
  private faces = targetFaces();
  /** The course boards' covers (F5.3b), and the ground's height under each board's middle. */
  private covers: Mesh[] = [];
  private coverSpots: [number, number, number, number][] = [];
  /** The race's rounds last given to the loading (the run's id and rounds then). */
  private roundsId = -1;
  private roundsGiven = -1;
  /** The race note on the sign, and until when, s. */
  private shownNote = 0;
  private noteUntil = 0;
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
  /** When the host last sent the run (this.time), for RESYNC_SECONDS. */
  private sentAt = 0;
  private wasConnected = false;
  private seenId = 0;
  private wasDone = false;
  private doneAt = 0;
  private pendingTarget = -1;
  private pendingSince = 0;
  /** Where Ready to fire waits for the tank to stand: the range's start, or a firing box. */
  private pendingX = 0;
  private pendingZ = 0;
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
    COURSE_TARGETS.forEach((_, j) => {
      const cover = createBoardCover();
      cover.visible = false;
      const spot = boardCoverSpot(j, [0, 0, 0, 0]);
      cover.rotation.y = spot[3];
      this.covers.push(cover);
      this.coverSpots.push(spot);
      if (ground) this.world.createTransformEntity(cover, { parent: ground });
    });
    const turret = this.world.getSceneEntity('turret') ?? null;
    this.clocks.push(this.createClock(RUN_CLOCKS.driver, null, 'Run Clock Driver'));
    this.clocks.push(this.createClock(RUN_CLOCKS.gunner, turret, 'Run Clock Gunner'));
    this.sign = new FloatingSign('Run Sign', 0.8, [512, 140], 1.1, 0.05);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.events.set('run', (e) => this.onRun(e));
    netLink.events.set('run-ask', (e) => {
      const what = ASKS.find((a) => a === e.what);
      // A page from before the race (F5.3b) sends no mode: a range run.
      const mode = RUN_MODES.find((m) => m === e.mode) ?? 'range';
      if (netLink.isHost && what) this.act(what, mode);
    });
    netLink.events.set('range-ready', (e) => {
      const target = Number(e.target);
      // A firing line's box (F5.3b), or the range's start.
      const line = Number(e.line);
      const [x, z] = Number.isInteger(line) && line >= 0 && line < BOX_Z.length ? boxSpot(line) : [this.start.x, this.start.z];
      if (Number.isInteger(target) && target >= 0 && target < this.faces.length && ownsGun()) this.pend(target, x, z);
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
      race: () => startRace(),
      readyLine: (k) => readyAtLine(k),
      covers: () => self.covers.map((c) => c.visible),
      coverAt: (j) => (self.covers[j]?.visible ? self.covers[j].position.toArray() : null),
      rounds: () => {
        const n = loadingRounds();
        return Number.isFinite(n) ? n : null;
      },
      lineNow: () => raceLineNow(),
      get pending() { return self.pendingTarget; },
      get sign() { return self.sign.visible ? self.signKey : ''; },
      get sent() { return self.sent; },
      get received() { return self.received; },
    };
  }

  /** Start (a run of `mode`), stop or mark the run assisted: the host does it; a guest asks the host. */
  ask(what: RunAsk, mode: RunMode = 'range'): void {
    if (netLink.isHost) this.act(what, mode);
    else {
      const event = { t: 'run-ask', what, mode };
      netLink.sendEvent(event);
    }
  }

  /** The host. */
  private act(what: RunAsk, mode: RunMode = 'range'): void {
    if (what === 'start') {
      this.run.start(mode);
      // The run starts at its start line with the engine as the crew left it (F1.17): the range's, or short of the course's.
      if (mode === 'biathlon') placeTank(COURSE_START.x, COURSE_START.z, COURSE_START.heading);
      else resetTank('keep');
      console.info(`[RangeRun] ${mode === 'biathlon' ? 'race' : 'run'} ${this.run.s.id} starting`);
    } else if (what === 'stop') {
      this.run.stop();
      console.info('[RangeRun] stopped');
    } else {
      this.run.assist();
    }
  }

  ready(i: number, seat: SeatId = 'gunner'): void {
    if (!(i >= 0 && i < RANGE_TARGETS.length)) return;
    // Alone, into the gunner's seat to pull the trigger (or the driver's, to watch the firing lamp); in a crew the seats stay.
    if (!netLink.connected) seating.ask(seat);
    // Parked with the engine running warm, for the power traverse (F1.17).
    resetTank('warm');
    this.ask('assist');
    if (ownsGun()) this.pend(i, this.start.x, this.start.z);
    else {
      const event = { t: 'range-ready', target: i };
      netLink.sendEvent(event);
    }
    console.info(`[RangeRun] ready to fire on the ${RANGE_TARGETS[i].range} m target`);
  }

  /** Ready at line `k` (F5.3b): parked halted in its box, engine running, laid on its first board still standing and loaded. */
  readyLine(k: number): void {
    if (!(k >= 0 && k < BOX_Z.length)) return;
    goToFiringLine(k);
    this.ask('assist');
    const s = this.run.s;
    let board = k * BOARDS_PER_LINE;
    for (let j = board; j < board + BOARDS_PER_LINE; j++) {
      if (!boardDown(s, j)) {
        board = j;
        break;
      }
    }
    const target = BOARD_FIRST + board;
    if (ownsGun()) {
      const [x, z] = boxSpot(k);
      this.pend(target, x, z);
    } else {
      const event = { t: 'range-ready', target, line: k };
      netLink.sendEvent(event);
    }
    console.info(`[RangeRun] ready at line ${k + 1}, on ${COURSE_TARGETS[board].name}`);
  }

  /** The gunner's page: lay on target `i` (of targetFaces) and load, once the tank stands at (x, z). */
  private pend(i: number, x: number, z: number): void {
    this.pendingTarget = i;
    this.pendingSince = this.time;
    this.pendingX = x;
    this.pendingZ = z;
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
      // A race counts laps and penalty loops from the course's progress (F5.3a), and shots only from a halt in a box.
      run.course(shownCourse());
      run.step(dt);
      const joined = netLink.connected && !this.wasConnected;
      const resync = run.s.phase === 'running' && !run.s.paused && this.time - this.sentAt >= RESYNC_SECONDS;
      if (netLink.connected && (joined || resync || run.version !== this.sentVersion)) {
        netLink.sendEvent(runEvent(run.s, performance.now()));
        this.sent++;
        this.sentAt = this.time;
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
      // The first note heard of a run is old news.
      this.shownNote = s.noteId;
    }
    this.giveRounds();
    const done = s.phase === 'done';
    if (done && !this.wasDone) {
      this.doneAt = this.time;
      console.info(`[RangeRun] ${runLine(s)}`);
    }
    this.wasDone = done;

    this.layAndLoad();
    this.drawFlags();
    this.drawCovers();
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
    if (Math.hypot(tank.x - this.pendingX, tank.z - this.pendingZ) > AT_START || Math.abs(tank.speed) > STILL) return;
    const aim = aimAt(tank, this.faces[i], muzzlePoint);
    aimTurret(aim.yaw, aim.elevation);
    loadForPractice();
    this.pendingTarget = -1;
  }

  /**
   * A race's rounds into the gunner's rack (F5.3b), on the page that loads:
   * whenever the host's count changes (a new line, a line shot, a round
   * fired), or the loading started again unlimited (the seats swapped).
   * Between, the rack spends its own rounds as they are fired, ahead of the
   * host's word. Out of a race the rack is full again.
   */
  private giveRounds(): void {
    const s = this.run.s;
    const have = loadingRounds();
    if (Number.isNaN(have)) {
      this.roundsId = -1;
      return;
    }
    if (s.mode === 'biathlon' && s.phase === 'running') {
      if (s.id === this.roundsId && s.rounds === this.roundsGiven && Number.isFinite(have)) return;
      this.roundsId = s.id;
      this.roundsGiven = s.rounds;
      limitRounds(s.rounds);
    } else if (Number.isFinite(have)) {
      this.roundsId = -1;
      limitRounds(Number.POSITIVE_INFINITY);
    }
  }

  /** Each fallen course board's cover over its disc (F5.3b), at the copy of it nearest the tank. */
  private drawCovers(): void {
    const s = this.run.s;
    const tank = tankState();
    const tx = wrapTile(tank.x);
    const tz = wrapTile(tank.z);
    for (let j = 0; j < this.covers.length; j++) {
      const cover = this.covers[j];
      const down = boardDown(s, j);
      if (cover.visible !== down) cover.visible = down;
      if (!down) continue;
      const [x, y, z] = this.coverSpots[j];
      cover.position.set(tx + wrapTile(x - tank.x), y, tz + wrapTile(z - tank.z));
    }
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
    // A race's clocks also show its lap, the line's rounds, what is owed and what is down (F5.3b).
    const race = s.mode === 'biathlon';
    const targets = race ? boardsDown(s) + 10 * s.laps + 100 * s.owed + 1000 * s.rounds + 10000 * s.loops : targetsHit(s);
    const flags = (s.paused ? 1 : 0) + (s.assisted ? 2 : 0) + (race ? 4 : 0) + 8 * s.closed;
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

  /** The countdown, Go! and the finish (a race's notes: a line shot, a loop driven, the finish), on a sign in front of each player. */
  private drawSign(delta: number): void {
    const s = this.run.s;
    const doneFor = this.time - this.doneAt;
    const race = s.mode === 'biathlon';
    if (race && s.noteId !== this.shownNote) {
      this.shownNote = s.noteId;
      if (s.note !== '') {
        this.noteUntil = this.time + NOTE_SECONDS;
        console.info(`[RangeRun] ${s.note}`);
      }
    }
    let state = s.phase === 'running' ? (s.clock < 0 ? countdownNumber(s) : s.clock < GO_SECONDS ? 4 : 0) : !race && s.phase === 'done' && doneFor < FINISH_SECONDS ? 5 : 0;
    // A race's note, once the countdown and Go! are off the sign: its own state for each note.
    if (race && state === 0 && this.time < this.noteUntil) state = 6 + this.shownNote;
    if (state !== this.signState) {
      this.signState = state;
      const text = state > 5 ? s.note : runSign(s, doneFor);
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
