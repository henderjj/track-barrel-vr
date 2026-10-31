import {
  createSystem,
  type CylinderGeometry,
  Euler,
  InputComponent,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  type ShaderMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { PacketType, seqNewer } from '../net/pose-codec.js';
import { TankBuffer } from '../net/tank-buffer.js';
import {
  decodeDriverControls,
  decodeTankState,
  DRIVER_CONTROLS_BYTES,
  encodeDriverControls,
  encodeTankState,
  TANK_STATE_BYTES,
  type TankHeader,
} from '../net/tank-codec.js';
import { onSettingChange } from '../live-settings.js';
import { settings } from '../settings.js';
import { type Bumps, crewBumps, groundFeel, parseBumps, vignetteLevel } from '../sim/comfort.js';
import { ENGINE_START_NAMES, type EngineStart, startable, startEngine as startSim, type StallCause, stopEngine } from '../sim/engine.js';
import { GEARBOX_NAMES, type GearboxMode, nextGear, realControls } from '../sim/gearbox.js';
import {
  angleDelta,
  COOLANT_IDLE,
  copyEngine,
  copyTankDrive,
  createControls,
  createTankDrive,
  type DriverControls,
  type Gear,
  GEARS,
  IDLE_RPM,
  keyControls,
  NEUTRAL,
  REVERSE,
  kmh,
  settle,
  stepDrive,
  type TankDrive,
  twinStickControls,
} from '../sim/tank-drive.js';
import { wrapTile } from '../sim/terrain.js';
import { createVignette } from './comfort-vignette.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { gameMenu } from './game-menu-system.js';
import { bufferDelayMs, netLink } from './net-system.js';
import { ride } from './ride-system.js';
import { seating } from './seating.js';

/**
 * The driver's controls as this page's driver's station reads them, and the
 * drive's options, for the menu and the tests. DriverStationSystem (F1.5)
 * writes the controls from its levers while this player sits in the
 * driver's seat; this system drives by them.
 */
export const drive = {
  /** The gear the gear lever is in. The right stick, A and B, keys and the tests move the lever with `setGear` and `shiftBy`. */
  gear: NEUTRAL as Gear,
  /** Where the gear lever is asked to go (the stick, keys, tests): the station puts it there unless a hand holds it. */
  gearAsked: null as Gear | null,
  /** The clutch pedal and the accelerator, 0 to 1, as someone other than this page's controllers works them (the tests). */
  clutch: 0,
  accel: 0,
  /** The hand throttle, 0 (idle) to 1. */
  throttle: 0,
  /** The tillers' demands, -1 to 1; while a hand holds either (`tillersHeld`) they drive and the sticks don't. */
  left: 0,
  right: 0,
  tillersHeld: false,
  /**
   * The instrument box (F1.17): the battery and ignition switches and the
   * choke where they are set (the station's switches, keys B, I and C), and
   * the starter and siren buttons held in on the station.
   */
  battery: false,
  ignition: false,
  choke: false,
  starter: false,
  siren: false,
};

const SEND_HZ = 45;
/** Longest step the simulation takes in one go, s; a slow frame takes several. */
const MAX_STEP = 1 / 60;
/** A guest driver's controls older than this are treated as let go, ms. */
const CONTROLS_STALE_MS = 500;
/** How long a sign stays up, s. */
const SIGN_SECONDS = 6;

let active: DriveSystem | null = null;

function copyControls(from: DriverControls, to: DriverControls): void {
  to.left = from.left;
  to.right = from.right;
  to.accel = from.accel;
  to.gear = from.gear;
  to.throttle = from.throttle;
  to.clutch = from.clutch;
  to.mode = from.mode;
  to.battery = from.battery;
  to.ignition = from.ignition;
  to.starter = from.starter;
  to.choke = from.choke;
  to.siren = from.siren;
  to.start = from.start;
}

/** What Back to start, a Practice shortcut or a run does with the engine: stop it (cold), leave it as it is, or start it warm. */
type EngineReset = 'off' | 'keep' | 'warm';

/** A thumbstick pushed this far forwards or back changes gear, once, until it comes back within STICK_REARM of the middle. */
const STICK_FLICK = 0.7;
const STICK_REARM = 0.3;

/** Practice → Drive: into the driver's seat, with a sign saying how to drive. */
export function startDriving(): void {
  seating.ask('driver');
  active?.sayHowToDrive();
}

/**
 * Practice → Back to start: the tank parked where it began (the host does
 * it; a guest asks), its engine stopped and cold (F1.17) unless the
 * driver's Engine start is Running; a range run keeps it as it was
 * (`engine` 'keep'), and Ready to fire starts it warm ('warm').
 */
export function resetTank(engine: EngineReset = 'off'): void {
  active?.reset(engine);
}

/**
 * Start the engine, warm, for a Practice shortcut that needs it running
 * (Lay the gun, Ready to fire: the power traverse runs off it). The host
 * does it; a guest asks.
 */
export function startEngine(): void {
  if (!netLink.isHost) {
    netLink.sendEvent({ t: 'engine-start' });
    return;
  }
  active?.warmStart();
}

/** Where a guest asks the host to park the tank (Practice shortcuts, F1.7). */
interface PlaceEvent {
  t: 'drive-place';
  x: number;
  z: number;
  heading: number;
}

/**
 * Park the tank at rest at (x, z) in world space facing `heading` (rad):
 * Practice shortcuts that put the crew somewhere on the range (F1.7). The
 * host does it; a guest asks the host, as Back to start does.
 */
export function placeTank(x: number, z: number, heading: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(heading)) return;
  if (!netLink.isHost) {
    const event: PlaceEvent = { t: 'drive-place', x, z, heading };
    netLink.sendEvent(event);
    return;
  }
  active?.park(x, z, heading);
}

/** Move the gear lever to a gear's notch (keys 0 to 5 and R, tests); a hand on it keeps it. */
export function setGear(gear: Gear): void {
  drive.gear = gear;
  drive.gearAsked = gear;
}

/** Move the gear lever one notch forwards (+1, a gear up) or back (-1, down towards neutral and reverse): the right stick, A and B, keys E and Q. */
export function shiftBy(step: number): void {
  setGear(nextGear(drive.gearAsked ?? drive.gear, step));
}

/**
 * How this page's driver works the gearbox (F1.16): the Gearbox setting,
 * except the automatic box for the practice crewmate's page (it drives
 * the tillers only) and for tracked hands (no triggers to squeeze).
 */
export function gearboxMode(): GearboxMode {
  return active?.mode ?? settings.gearbox;
}

/**
 * The driver's controls the tank is driven by as this page sees them: the
 * host's own or its guest driver's on the host, this page's own on a guest
 * driver, and the host's word on a guest that doesn't drive. The driver's
 * station draws the crewmate's levers from it.
 */
export function shownDriverControls(): DriverControls | null {
  return active?.shownControls ?? null;
}

/** The tank as this page draws it (the host's simulation, or the guest's copy of it), for the driver's gauges. */
export function shownDriverState(): TankDrive | null {
  return active?.shown ?? null;
}

/** The engine's RPM as drawn on this page (the host's, or the guest's copy of it): the turret's power traverse runs off it (F1.8), so has nothing with the engine stopped (F1.17). */
export function engineRpm(): number {
  return active?.shown.rpm ?? IDLE_RPM;
}

/** How this page's driver starts the engine (F1.17): the Engine start setting, or a test's. */
export function engineStart(): EngineStart {
  return active?.start ?? settings.engine;
}

/** The bumps the tank rides on (F1.14): reduced if either player asked for it in their Comfort settings. */
export function tankBumps(): Bumps {
  return active?.bumps ?? settings.bumps;
}

/** The tank as drawn on this page (the host's simulation, or the guest's copy of it): where a shot leaves from (F1.10) and the gunsight's view (F1.9). */
export function tankState(): Readonly<TankDrive> {
  return active?.shown ?? createTankDrive();
}

/** One line on the tank for the menu: who drives, speed, gear, RPM. */
export function driveStatus(): string {
  const s = active?.shown;
  if (s == null) return '';
  const who = seating.mine === 'driver' ? 'You drive' : netLink.connected && seating.crew === 'driver' ? 'Your crewmate drives' : 'Nobody drives';
  const gear = s.grinding ? 'grinding' : s.gear === NEUTRAL ? 'neutral' : `${GEARS[s.gear].name.toLowerCase()} gear`;
  const engine = s.running ? `${Math.round(s.rpm / 10) * 10} rpm` : s.cranking ? 'cranking' : 'engine off';
  return `${who}: ${kmh(s)} km/h${s.speed < -0.05 ? ' backwards' : ''}, ${gear}, ${engine}`;
}

interface DriveDebug {
  /** The tank as drawn on this page (the host's simulation, or the guest's copy of it). */
  state(): TankDrive;
  /** The controls the tank is driven by on the host, or this page's own on a guest driver. */
  controls(): DriverControls;
  /** The controls as this page sees them (shownDriverControls). */
  shownControls(): DriverControls;
  /** Who drives, as this page sees it. */
  driver(): 'me' | 'crew' | 'nobody';
  /** Drive as if from the sticks (tests): tillers, accelerator, clutch, lever, gearbox mode, the engine's switches and start setting, or null to go back to the real ones. */
  set(controls: Partial<DriverControls> | null): void;
  /** Back to the start: the engine kept as it is unless `engine` says (the menu's Back to start stops it). */
  reset(engine?: EngineReset): void;
  /** Host only: start the engine warm (as the Practice shortcuts do) or stop it, cold (tests). */
  engine(action: 'start' | 'stop'): void;
  /** Host only: put the tank at rest at (x, z) facing `heading` (tests and Practice). */
  place(x: number, z: number, heading: number): void;
  /** Where a world-space point is drawn, in hull space. */
  drawnAt(x: number, y: number, z: number): number[];
  readonly vignetteAlpha: number;
  /** The bumps the tank rides on, and the crewmate's ask (null alone or before it is heard). */
  readonly bumps: Bumps;
  readonly crewBumps: Bumps | null;
  readonly sign: string;
  /** Tank packets sent and received. */
  readonly sent: number;
  readonly received: number;
  readonly lateFrames: number;
}

/**
 * The tank's drive (F1.4, docs/tank-drive.md). The tank stays at the
 * origin and the ground moves round it by the inverse of the tank's pose
 * (plan decision 4), so the cabin, the crew and everything aboard stay
 * still relative to each other however the tank moves.
 *
 * The host runs the simulation (src/sim/tank-drive.ts) whichever seat it
 * sits in, and sends the tank's state 45 times a second (PacketType 5).
 * Whoever sits in the driver's seat drives: the host from its own
 * controls, a guest by sending its controls 45 times a second (PacketType
 * 6). A guest draws the tank from the host's states a little in the past
 * (TankBuffer). With nobody in the driver's seat, or while the crew is on
 * hold (crewPresence.paused, with its sign), the tillers count as let go
 * and the tank rolls to a stop.
 *
 * The driver's station (DriverStationSystem, F1.5) reads its tillers,
 * gear lever and hand throttle into `drive`. While no hand holds a tiller
 * the thumbsticks drive (each stick's forward push its own track), or
 * W A S D on the flat page; the menu and keys 0, 1, 2 move the gear
 * lever too. A comfort vignette darkens the edge of view with the tank's
 * motion, as dark as this player's Vignette setting allows (F1.14). The
 * host follows the ground with reduced bumps if either player's Bumps
 * setting asks (each page tells the other with a reliable `comfort`
 * event). Spike S2's ride takes over while it runs.
 *
 * Everything the tank drives past — the range's roads, targets, markers and
 * obstacles (F1.7, src/sim/range.ts) — is part of the ground this moves, so
 * it all stays where it stands however far the tank goes.
 */
export class DriveSystem extends createSystem({}) {
  /** The host's simulation. */
  private sim = createTankDrive();
  /** What is drawn: the simulation on the host, the host's states on a guest. */
  readonly shown = createTankDrive();
  private controls = createControls();
  /** The controls the tank is driven by, as this page sees them (see shownDriverControls). */
  readonly shownControls = createControls();
  private remoteControls = createControls();
  private remoteAt = Number.NEGATIVE_INFINITY;
  private remoteSeq = -1;
  private override: Partial<DriverControls> | null = null;
  private spare = createTankDrive();
  private buffer = new TankBuffer();
  private incoming = createTankDrive();
  private header: TankHeader = { seq: 0, timeMs: 0 };
  private stateBuffer = new ArrayBuffer(TANK_STATE_BYTES);
  private controlsBuffer = new ArrayBuffer(DRIVER_CONTROLS_BYTES);
  private seq = 0;
  private sendAccumulator = 0;
  private sent = 0;
  private received = 0;
  private wasHost = true;
  private wasConnected = false;
  /** The crewmate's Bumps setting, once heard. */
  private theirBumps: Bumps | null = null;
  private ground: Object3D | null = null;
  private vignette!: Mesh<CylinderGeometry, ShaderMaterial>;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;
  private wasGrinding = false;
  private wasBogging = false;
  /** The stalls counted when last looked at (-1 before the first), and how long the starter has been held without turning, s. */
  private stallsSeen = -1;
  private starterHeld = 0;
  private crankHeld = 0;
  /** This page's driver's Engine start setting (engineStart). */
  start: EngineStart = settings.engine;
  /** This page's driver's gearbox mode (gearboxMode). */
  mode: GearboxMode = settings.gearbox;
  /** Each stick (left, right) has flicked and not yet come back: no further shift until it does. */
  private flicked = [false, false];
  private keys = new Set<string>();
  private matrix = new Matrix4();
  private euler = new Euler(0, 0, 0, 'YXZ');
  private quat = new Quaternion();
  private pos = new Vector3();
  private one = new Vector3(1, 1, 1);

  init(): void {
    active = this;
    // The tank begins with its engine stopped and cold, unless this player's Engine start is Running (F1.17).
    if (settings.engine !== 'running') this.stopCold(this.sim);
    copyTankDrive(this.sim, this.shown);
    this.ground = this.world.getSceneEntity('ground')?.object3D ?? null;
    if (this.ground == null) console.warn('[Drive] no ground in the scene');
    else if (!settings.ground) this.ground.visible = false;
    this.vignette = createVignette();
    this.vignette.visible = false;
    this.camera.add(this.vignette);
    this.sign = new FloatingSign('Drive Sign', 0.7, [512, 160], 1.1, 0.25);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.handlers.set(PacketType.TankState, (view) => this.onTankState(view));
    netLink.handlers.set(PacketType.DriverControls, (view) => this.onDriverControls(view));
    netLink.events.set('drive-reset', (data) => {
      const engine = (data as { engine?: unknown }).engine;
      if (netLink.isHost) this.reset(engine === 'keep' || engine === 'warm' ? engine : 'off');
    });
    netLink.events.set('engine-start', () => {
      if (netLink.isHost) this.warmStart();
    });
    netLink.events.set('comfort', (data) => {
      this.theirBumps = parseBumps((data as { bumps?: unknown }).bumps);
    });
    netLink.events.set('drive-place', (data) => {
      const { x, z, heading } = data as { x?: unknown; z?: unknown; heading?: unknown };
      if (!netLink.isHost || typeof x !== 'number' || typeof z !== 'number' || typeof heading !== 'number') return;
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(heading)) return;
      this.park(x, z, heading);
    });

    const typing = (event: KeyboardEvent) => (event.target as Element | null)?.closest?.('input, textarea, select') != null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event) || this.world.visibilityState.peek() !== VisibilityState.NonImmersive) return;
      const key = event.key.toLowerCase();
      if (key >= '0' && key <= '5' && key.length === 1) setGear(Number(key) as Gear);
      else if (key === 'r') setGear(REVERSE);
      // The instrument box's switches (F1.17); Space holds the starter and N the siren.
      else if (key === 'b' && !event.repeat) drive.battery = !drive.battery;
      else if (key === 'i' && !event.repeat) drive.ignition = !drive.ignition;
      else if (key === 'c' && !event.repeat) drive.choke = !drive.choke;
      else if (key === 'e') shiftBy(1);
      else if (key === 'q') shiftBy(-1);
      else this.keys.add(key);
    };
    const onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());
    const onBlur = () => this.keys.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanupFuncs.push(
      () => {
        if (active === this) active = null;
        this.vignette.removeFromParent();
        this.vignette.geometry.dispose();
        this.vignette.material.dispose();
      },
      () => netLink.handlers.delete(PacketType.TankState),
      () => netLink.handlers.delete(PacketType.DriverControls),
      () => netLink.events.delete('drive-reset'),
      () => netLink.events.delete('engine-start'),
      () => netLink.events.delete('drive-place'),
      () => netLink.events.delete('comfort'),
      onSettingChange((key) => {
        if (key === 'bumps') this.tellBumps();
      }),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
    );

    const self = this;
    (window as unknown as { __drive: DriveDebug }).__drive = {
      state: () => ({ ...self.shown }),
      controls: () => ({ ...self.controls }),
      shownControls: () => ({ ...self.shownControls }),
      driver: () => self.driver(),
      set: (controls) => {
        self.override = controls === null ? null : { ...controls };
        if (controls?.gear !== undefined) setGear(controls.gear);
      },
      // The tests put the tank back without stopping its engine, unless they ask.
      reset: (engine = 'keep') => self.reset(engine),
      engine: (action) => {
        if (action === 'start') self.warmStart();
        else if (netLink.isHost) {
          stopEngine(self.sim);
          self.sim.rpm = 0;
          copyTankDrive(self.sim, self.shown);
        }
      },
      place: (x, z, heading) => self.park(x, z, heading),
      drawnAt: (x, y, z) => (self.ground ? self.ground.localToWorld(new Vector3(x, y, z)).toArray() : []),
      get vignetteAlpha() { return self.vignette.material.uniforms.uAlpha.value as number; },
      get bumps() { return self.bumps; },
      get crewBumps() { return self.theirBumps; },
      get sign() { return self.sign.visible ? self.signText : ''; },
      get sent() { return self.sent; },
      get received() { return self.received; },
      get lateFrames() { return self.buffer.late; },
    };
  }

  /** The bumps the tank rides on: reduced if either player asks. */
  get bumps(): Bumps {
    return crewBumps(settings.bumps, netLink.connected ? this.theirBumps : null);
  }

  /** Tell the crewmate this player's Bumps setting. */
  private tellBumps(): void {
    if (!netLink.connected) return;
    const event = { t: 'comfort', bumps: settings.bumps };
    netLink.sendEvent(event);
  }

  /** Who sits in the driver's seat, as this page sees it. */
  private driver(): 'me' | 'crew' | 'nobody' {
    if (seating.mine === 'driver') return 'me';
    return netLink.connected && seating.crew === 'driver' ? 'crew' : 'nobody';
  }

  /** Host only: the tank at rest at (x, z) facing `heading`, settled on the ground, its engine as it was. */
  park(x: number, z: number, heading: number): void {
    if (!netLink.isHost) return;
    const was = copyTankDrive(this.sim, this.spare);
    Object.assign(this.sim, createTankDrive(x, z, heading), { gear: was.gear });
    copyEngine(was, this.sim);
    settle(this.sim, groundFeel(this.bumps));
    copyTankDrive(this.sim, this.shown);
  }

  reset(engine: EngineReset = 'off'): void {
    if (!netLink.isHost) {
      const event = { t: 'drive-reset', engine };
      netLink.sendEvent(event);
      return;
    }
    const was = copyTankDrive(this.sim, this.spare);
    Object.assign(this.sim, createTankDrive(), { gear: was.gear });
    if (engine === 'keep') copyEngine(was, this.sim);
    else if (engine === 'warm') this.sim.coolant = COOLANT_IDLE;
    else if (this.shownControls.start !== 'running') this.stopCold(this.sim);
    // The stall count carries on (the stats count its changes).
    this.sim.stalls = was.stalls;
    this.sim.coughs = was.coughs;
    copyTankDrive(this.sim, this.shown);
    console.info(`[Drive] back at the start, engine ${engine === 'keep' ? 'as it was' : this.sim.running ? 'running' : 'off'}`);
  }

  /** Host only: the engine running and warm, at once (a Practice shortcut that needs the power traverse). */
  warmStart(): void {
    if (!netLink.isHost) return;
    if (!this.sim.running) {
      startSim(this.sim);
      this.sim.rpm = IDLE_RPM;
    }
    this.sim.coolant = Math.max(this.sim.coolant, COOLANT_IDLE);
    copyTankDrive(this.sim, this.shown);
    console.info('[Drive] engine started for a Practice shortcut');
  }

  /** The engine stopped and run down, at the air's temperature: as the tank is found. */
  private stopCold(s: TankDrive): void {
    stopEngine(s);
    s.rpm = 0;
  }

  sayHowToDrive(): void {
    const vr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!this.shown.running) {
      const how: Record<EngineStart, [string, string]> = {
        running: ['Hold the starter (instrument box)', 'Hold Space: the starter'],
        starter: ['Hold the starter (instrument box)', 'Hold Space: the starter'],
        full: ['Battery, ignition, choke, starter', 'B, I, C, then hold Space'],
      };
      this.say(`Start the engine: ${ENGINE_START_NAMES[this.start].toLowerCase()}`, how[this.start][vr ? 0 : 1]);
      return;
    }
    const how: Record<GearboxMode, [string, string]> = {
      auto: ['Grip the tillers and push', 'W A S D to drive'],
      stick: ['R trigger: go. Tillers: brakes. R stick: gears', 'W: go, S A D: brakes, E Q: gears'],
      clutch: ['Hold L trigger (clutch), flick R stick to shift', 'W: go, S A D: brakes, Shift: clutch, E Q: gears'],
    };
    this.say(`Driving: ${GEARBOX_NAMES[this.mode].toLowerCase()}`, how[this.mode][vr ? 0 : 1]);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    const isHost = netLink.isHost;
    if (isHost && !this.wasHost) {
      // The host left and this page took over: carry on from the tank as drawn.
      copyTankDrive(this.shown, this.sim);
      this.buffer.clear();
      console.info('[Drive] running the tank now');
    } else if (!isHost && this.wasHost) {
      this.buffer.clear();
      this.remoteSeq = -1;
    }
    this.wasHost = isHost;
    if (netLink.connected !== this.wasConnected) {
      this.wasConnected = netLink.connected;
      if (netLink.connected) this.tellBumps();
      else this.theirBumps = null;
    }

    this.readLocalControls();
    if (isHost) {
      this.runHost(dt);
    } else {
      this.followHost();
      if (seating.mine === 'driver') copyControls(this.controls, this.shownControls);
    }
    this.send(delta);

    // Spike S2's ride moves its own world and hides this one.
    if (ride.active) {
      this.vignette.visible = false;
      return;
    }
    this.placeGround();
    this.shade(dt);
    this.signs(delta);
  }

  /**
   * This page's own controls: the driver's station's tillers while a hand
   * holds either, otherwise the sticks in VR or keys on the flat page; its
   * gear lever and hand throttle; or a test's.
   */
  private readLocalControls(): void {
    const c = this.controls;
    const vr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const pads = this.input.xr.gamepads;
    // The practice crewmate drives the tillers only; tracked hands have no triggers to squeeze.
    this.mode = this.override?.mode ?? (settings.bot || (vr && pads.left == null && pads.right == null) ? 'auto' : settings.gearbox);
    this.start = this.override?.start ?? settings.engine;
    c.mode = this.mode;
    c.start = this.start;
    c.gear = drive.gear;
    c.throttle = drive.throttle;
    c.left = 0;
    c.right = 0;
    c.accel = drive.accel;
    c.clutch = drive.clutch;
    // The switches stay where they were set; the buttons are held only by whoever sits in the seat.
    c.battery = this.override?.battery ?? drive.battery;
    c.ignition = this.override?.ignition ?? drive.ignition;
    c.choke = this.override?.choke ?? drive.choke;
    c.starter = false;
    c.siren = false;
    // Spike S2's ride has the sticks while it runs.
    if (seating.mine !== 'driver' || ride.active) return;
    c.starter = this.override?.starter ?? (drive.starter || (!vr && this.keys.has(' ')));
    c.siren = this.override?.siren ?? (drive.siren || (!vr && this.keys.has('n')));
    const real = realControls(this.mode);
    if (vr) {
      // The pedals: the left trigger the clutch, the right the accelerator (a finger each on the tillers' grips).
      if (this.mode === 'clutch') c.clutch = Math.max(c.clutch, pads.left?.getButtonValue(InputComponent.Trigger) ?? 0);
      if (real) c.accel = Math.max(c.accel, pads.right?.getButtonValue(InputComponent.Trigger) ?? 0);
    }
    if (drive.tillersHeld) {
      c.left = drive.left;
      c.right = drive.right;
      // Hands on the tillers: the right stick flicked forwards or back changes gear.
      if (vr && this.mode !== 'auto') this.flick(1, pads.right?.getAxesValues(InputComponent.Thumbstick)?.y ?? 0);
    } else if (vr) {
      const left = pads.left?.getAxesValues(InputComponent.Thumbstick);
      const right = pads.right?.getAxesValues(InputComponent.Thumbstick);
      twinStickControls(left?.y ?? 0, right?.y ?? 0, c);
      // Driving on the sticks: A changes up, B down (B closes the menu while it is open).
      if (this.mode !== 'auto' && !gameMenu.open) {
        if (pads.right?.getButtonDown(InputComponent.A_Button)) shiftBy(1);
        if (pads.right?.getButtonDown(InputComponent.B_Button)) shiftBy(-1);
      }
    } else if (this.keys.size > 0) {
      const k = this.keys;
      const forward = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const turn = (k.has('a') || k.has('arrowleft') ? 1 : 0) - (k.has('d') || k.has('arrowright') ? 1 : 0);
      keyControls(forward, turn, c);
      // With a Sherman's controls W is the accelerator (S, A and D brake through the tillers); Shift is the clutch.
      if (real && (k.has('w') || k.has('arrowup'))) c.accel = 1;
      if (this.mode === 'clutch' && k.has('shift')) c.clutch = 1;
    }
    const o = this.override;
    if (o) {
      c.left = o.left ?? c.left;
      c.right = o.right ?? c.right;
      c.throttle = o.throttle ?? c.throttle;
      c.accel = o.accel ?? c.accel;
      c.clutch = o.clutch ?? c.clutch;
    }
  }

  /** A stick (0 left, 1 right) pushed past STICK_FLICK forwards changes up a gear, back down one; once each push. */
  private flick(i: number, y: number): void {
    if (this.flicked[i]) {
      if (Math.abs(y) < STICK_REARM) this.flicked[i] = false;
      return;
    }
    if (Math.abs(y) < STICK_FLICK) return;
    this.flicked[i] = true;
    // Forwards on a stick is -Y.
    shiftBy(y < 0 ? 1 : -1);
  }

  /** The host: drive the tank from whoever sits in the driver's seat. */
  private runHost(dt: number): void {
    let source = this.controls;
    const driver = this.driver();
    if (driver === 'crew') {
      source = this.remoteControls;
      if (performance.now() - this.remoteAt > CONTROLS_STALE_MS) {
        source.left = 0;
        source.right = 0;
        source.accel = 0;
        source.starter = false;
        source.siren = false;
      }
    } else if (driver === 'nobody') {
      // An empty seat: tillers let go, the lever where it was left, the automatic box holding the tank still.
      source.left = 0;
      source.right = 0;
      source.accel = 0;
      source.clutch = 0;
      source.gear = this.sim.gear;
      source.mode = 'auto';
      source.starter = false;
      source.siren = false;
    }
    if (crewPresence.paused) {
      // The crew is on hold (its sign says why): the tank rolls to a stop.
      source.left = 0;
      source.right = 0;
      source.accel = 0;
      source.starter = false;
      source.siren = false;
    }
    const feel = groundFeel(this.bumps);
    for (let left = dt; left > 1e-6; left -= MAX_STEP) {
      stepDrive(this.sim, source, Math.min(left, MAX_STEP), undefined, feel);
    }
    if (driver === 'crew') copyControls(source, this.controls);
    copyControls(source, this.shownControls);
    copyTankDrive(this.sim, this.shown);
  }

  /** A guest: draw the host's tank a little in the past. */
  private followHost(): void {
    const b = this.buffer;
    if (b.count === 0) return;
    const delay = Math.max(0, b.transit) + bufferDelayMs(b.interval, b.jitter);
    const heading = this.shown.heading;
    b.sample(performance.now() - delay, this.shown);
    // Keep the drawn heading continuous (the packets carry it within one turn).
    this.shown.heading = heading + angleDelta(heading, this.shown.heading);
  }

  /** 45 times a second: the host sends the tank; a guest driver sends its controls. */
  private send(delta: number): void {
    if (!netLink.connected) return;
    this.sendAccumulator += delta;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = Math.min(this.sendAccumulator - 1 / SEND_HZ, 1 / SEND_HZ);
    const now = performance.now();
    if (netLink.isHost) {
      netLink.send(this.stateBuffer, encodeTankState(this.stateBuffer, this.seq, now, this.sim, this.shownControls));
    } else if (seating.mine === 'driver') {
      netLink.send(this.controlsBuffer, encodeDriverControls(this.controlsBuffer, this.seq, now, this.controls));
    } else {
      return;
    }
    this.seq = (this.seq + 1) & 0xffff;
    this.sent++;
  }

  private onTankState(view: DataView): void {
    // A guest driver keeps its own controls; anyone else draws the host's.
    const controls = seating.mine === 'driver' ? null : this.shownControls;
    if (netLink.isHost || !decodeTankState(view, this.header, this.incoming, controls)) return;
    this.received++;
    // Until the clocks are matched, a packet's time can't be placed.
    if (!netLink.clockSynced) return;
    this.buffer.push(netLink.toLocal(this.header.timeMs), performance.now(), this.incoming);
  }

  private onDriverControls(view: DataView): void {
    if (!netLink.isHost || !decodeDriverControls(view, this.header, this.remoteControls)) return;
    this.received++;
    if (this.remoteSeq >= 0 && !seqNewer(this.header.seq, this.remoteSeq)) return;
    this.remoteSeq = this.header.seq;
    this.remoteAt = performance.now();
  }

  /** The ground goes where the tank's inverse pose puts it, less whole tiles. */
  private placeGround(): void {
    const ground = this.ground;
    if (ground == null) return;
    const s = this.shown;
    this.euler.set(s.pitch, s.heading, s.roll, 'YXZ');
    this.quat.setFromEuler(this.euler);
    this.pos.set(wrapTile(s.x), s.y, wrapTile(s.z));
    this.matrix.compose(this.pos, this.quat, this.one).invert();
    this.matrix.decompose(ground.position, ground.quaternion, ground.scale);
  }

  /** The vignette follows what the eyes see turn, speed up and tilt. */
  private shade(dt: number): void {
    const alpha = this.vignette.material.uniforms.uAlpha;
    let target = 0;
    if (settings.vignette > 0 && this.world.session != null) {
      const s = this.shown;
      // The gunner's view turns with the turret too.
      const turn = s.yawRate + (seating.mine === 'gunner' ? seating.turretRate : 0);
      target = vignetteLevel(turn, s.accel, Math.abs(s.pitchRate) + Math.abs(s.rollRate), s.speed) * settings.vignette;
    }
    alpha.value += (target - alpha.value) * Math.min(1, dt * 6);
    this.vignette.visible = alpha.value > 0.002;
  }

  private signs(delta: number): void {
    const { grinding, bogging } = this.shown;
    if (grinding && !this.wasGrinding && seating.mine === 'driver') {
      this.say('Gears grinding', this.controls.clutch < 0.8 ? 'Hold the clutch (left trigger) to change gear' : 'Too fast for that gear: slow down first');
    }
    if (bogging && !this.wasBogging && seating.mine === 'driver') this.say('Engine labouring', 'Clutch in, or a lower gear');
    this.wasGrinding = grinding;
    this.wasBogging = bogging;
    this.engineSigns(delta);
    if (this.sign.visible) {
      if (this.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }

  /** The engine's signs for the driver (F1.17): a stall and why, and why the starter won't turn or the engine won't fire. */
  private engineSigns(delta: number): void {
    const s = this.shown;
    const stalls = s.stalls;
    const mine = seating.mine === 'driver';
    if (this.stallsSeen >= 0 && stalls !== this.stallsSeen && !s.running && mine) {
      const why: Record<StallCause, string> = {
        none: 'Clutch in or neutral, then the starter',
        bog: 'Clutch in, then the starter. Pull away in a lower gear',
        cold: 'Warm it up with the hand throttle at two thirds',
        choke: 'Choke in too soon: leave it out a few seconds',
        flood: 'Flooded: push the choke in once it runs',
      };
      this.say('Engine stalled', why[s.stallCause]);
    }
    this.stallsSeen = stalls;
    const c = this.controls;
    const holding = mine && c.starter && !s.running;
    this.starterHeld = holding && !s.cranking ? this.starterHeld + delta : 0;
    this.crankHeld = holding && s.cranking ? this.crankHeld + delta : 0;
    if (this.starterHeld > 0.4 && this.starterHeld - delta <= 0.4) {
      const full = c.start === 'full';
      if (full && !c.battery) this.say('Nothing turns', 'Battery switch on first');
      else if (s.starterRest > 0) this.say('Starter too hot', 'Let it cool for a while');
      else if (!startable(s, c)) this.say('In gear', this.mode === 'clutch' ? 'Clutch in, or neutral, to start' : 'Neutral to start');
    }
    if (this.crankHeld > 4 && this.crankHeld - delta <= 4) {
      this.say('It won\'t fire', c.start === 'full' && !c.ignition ? 'Ignition on' : 'Choke out and the hand throttle a little open');
    }
  }

  private say(title: string, line: string): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(title, width / 2, 68);
    ctx.font = '30px sans-serif';
    ctx.fillText(line, width / 2, 120);
    this.sign.refresh();
    this.sign.setVisible(true);
    this.signText = `${title}. ${line}`;
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[Drive] sign: ${this.signText}`);
  }
}
