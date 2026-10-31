import { createSystem, Euler, Matrix4, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import type { PoseSample } from '../net/pose-codec.js';
import { settings } from '../settings.js';
import { aimAt, rangeFaces } from '../sim/ballistics.js';
import { hullToSeat, SEATS, seatToHull, type SeatId } from '../sim/cabin.js';
import { MAX_TRAVERSE_ACCEL } from '../sim/comfort.js';
import {
  BotDriver,
  CALL_FROM,
  CALL_WORDS,
  chooseTarget,
  createDriveWish,
  createPath,
  type CrewCall,
  FIRE_SPEED,
  idleLook,
  LAY,
  leverGrip,
  loadPlan,
  parseCall,
  pathAt,
  pathLength,
  restingHandInSeat,
  type StartTask,
  startTask,
  stepTowards,
  traverseDemand,
  twistAcross,
  twistForDemand,
  wheelGrip,
} from '../sim/crew-bot.js';
import { DRIVER_TILLER, ENGINE_NAMES, HAND_THROTTLE, PARKING_BRAKE, throttleAngle, tillerAngle, TILLER_NAMES } from '../sim/driver-station.js';
import type { TwistGrip, Wheel } from '../sim/mechanism.js';
import { sightLimit } from '../sim/range.js';
import {
  ELEVATION_WHEEL,
  muzzlePoint,
  POWER_GRIP,
  powerTraverseRate,
  wheelForElevation,
  wrapAngle,
} from '../sim/turret.js';
import { drive, engineRpm, engineStart, shownDriverState, tankState } from './drive-system.js';
import { lastShot } from './firing-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { handUse } from './grip-system.js';
import { loadingShown, scriptLoadingHand } from './loading-system.js';
import { findControl, type ScriptedHand, scriptedHands } from './mechanism-system.js';
import { FLAG_LEFT_TRACKED, FLAG_RIGHT_TRACKED, netLink } from './net-system.js';
import { ride } from './ride-system.js';
import { seating } from './seating.js';
import { turretState } from './turret-system.js';

type Vec3 = [number, number, number];
type Side = 'left' | 'right';
const SIDES = ['left', 'right'] as const;

/** How fast the bot's head moves to a new seat, m/s. */
const MOVE_SPEED = 1.5;
/** How fast its hands move from one thing to the next, m/s. */
const HAND_SPEED = 0.8;
/** A hand this close to a handle squeezes to take hold, m (it comes to rest exactly there). */
const ON_HANDLE = 0.001;
/** A squeeze that hasn't taken hold in this long lets go and tries again, s. */
const GRAB_TIMEOUT = 0.6;
/** How fast its hand winds the elevation handwheel's handle round, rad/s. */
const WHEEL_SPEED = 6;
/** Laid this long before it fires, s; the trigger is held this long, s. */
const LAID_FOR = 0.3;
const TRIGGER_FOR = 0.25;
/** It waits this long for a shot's result before loading again, s. */
const RESULT_WAIT = 5;
/** Laid and loaded with the tank moving this long, it calls the driver to halt; then not again for a while, s. */
const HALT_ASK_AFTER = 2;
const HALT_ASK_EVERY = 15;
/** How long a call stays on the sign, s. */
const CALL_SIGN_SECONDS = 4;

/** The kit's names for the controls the bot works (DriverStationSystem's and TurretSystem's). */
const TILLER = TILLER_NAMES;
const TWIST = 'turret-twist';
const ELEVATION = 'turret-elevation';

/** One of the bot's hands: where it is and where it is going in its seat's frame, and what it does. */
interface BotHand {
  at: Vec3;
  goal: Vec3;
  /** Working a control (the kit's), the loading, or resting. */
  mode: 'rest' | 'control' | 'loading';
  squeeze: boolean;
  trigger: number;
  /** The control it is after or holds, by name. */
  control: string | null;
  /** How long it has squeezed without taking hold, s. */
  squeezing: number;
  /** What it held last frame (handUse). */
  held: string | null;
  /** What the kit is given: the fist and across it in scene space. */
  scripted: ScriptedHand;
  pose: PoseSample;
}

function createHand(): BotHand {
  return {
    at: [0, 0, 0], goal: [0, 0, 0], mode: 'rest', squeeze: false, trigger: 0, control: null, squeezing: 0, held: null,
    scripted: { fist: [0, 0, 0], across: [1, 0, 0], squeeze: false, trigger: 0 },
    pose: { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
  };
}

/** Send a call to the crewmate (the game menu's Calls; the practice crewmate's reports). */
export function sendCrewCall(call: CrewCall): void {
  if (!netLink.connected) return;
  const event = { t: 'crew-call', call };
  netLink.sendEvent(event);
  console.info(`[Bot] call: ${CALL_WORDS[call]}`);
  if (active) active.lastSent = call;
}

/** One line for the menu's Calls: what the practice crewmate says it is doing, or the last call. */
export function crewCallStatus(): string {
  const a = active;
  if (a == null) return '';
  if (a.crewBotLine) return `Practice crewmate: ${a.crewBotLine}`;
  return a.lastSent ? `You called: ${CALL_WORDS[a.lastSent]}` : 'Calls show on your crewmate\'s sign';
}

let active: CrewBotSystem | null = null;

/**
 * The practice crewmate (F1.13, docs/crewmate.md): with "This page plays as:
 * Practice crewmate" in Settings (or ?bot=1), this page joins the crew as
 * a bot second player, so one person can test either seat with the bot's
 * page on a PC and the player in the headset. It sits in the seat the host
 * gives it (the other one from the player's) and looks about.
 *
 * In the driver's seat it drives through the driver's station: its hands
 * take the tillers and the gear lever, and it follows the gunner's calls
 * (advance, halt, reverse, left, right) or drives the route up the range
 * and back (BotDriver in src/sim/crew-bot.ts). In the gunner's seat it
 * loads (a shell from the rack, rammed, the lever closed), lays the gun on
 * the nearest range target it hasn't hit with the power traverse grip and
 * the elevation wheel, and fires with the grip's trigger once laid and the
 * tank is halted; it calls "On the way!", "Target!" and, when the tank
 * won't stop, "Driver, halt". Its hands are scripted hands the mechanism
 * kit and the loading take as they take real ones, so the player sees them
 * on the controls. The page must stay showing (a hidden tab counts as a
 * crewmate who stepped away).
 *
 * On every page it also carries the calls: the reliable event `crew-call`
 * from the game menu's Calls, shown on a sign to the other player (and
 * done by the practice crewmate), and `bot-status`, the crewmate's line
 * for the menu. Registered after the systems it drives: they read its
 * hands next frame.
 */
export class CrewBotSystem extends createSystem({}) {
  /** The crewmate bot's line on what it is doing, as it last said (on the player's page). */
  crewBotLine = '';
  /** The last call this page sent. */
  lastSent: CrewCall | null = null;
  private started = false;
  private startedAt = 0;
  private seat: SeatId | null = null;
  private head: Vec3 = [0, 0, 0];
  private headGoal: Vec3 = [0, 0, 0];
  private hands: Record<Side, BotHand> = { left: createHand(), right: createHand() };
  private look: [number, number] = [0, 0];
  private euler = new Euler(0, 0, 0, 'YXZ');
  private quat = new Quaternion();
  private headPose: PoseSample = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  private v = new Vector3();
  private m = new Matrix4();
  private p: Vec3 = [0, 0, 0];
  private q: Vec3 = [0, 0, 0];
  private across: Vec3 = [1, 0, 0];
  private time = 0;
  private dt = 0;

  // The driver.
  private driver = new BotDriver();
  private wish = createDriveWish();
  private tank = { x: 0, z: 0, heading: 0, speed: 0, gear: 1 as 0 | 1 | 2 };
  /** The engine ran last frame, when it last caught (s on this.time), and the start-up step under way (F1.17). */
  private engineRan = false;
  private caughtAt = 0;
  private task: StartTask = null;

  // The gunner.
  private phase: 'load' | 'lay' | 'result' = 'load';
  private fireAtWill = true;
  private faces = rangeFaces();
  private hit: boolean[] = this.faces.map(() => false);
  private target = -1;
  private aim = { yaw: 0, elevation: 0 };
  private path = createPath();
  private pathCount = 0;
  /** Time into the path, s; negative while the hand is still on its way to the path's start. */
  private pathTime = -1;
  private laidFor = 0;
  private triggerFor = 0;
  private waitedFor = 0;
  private shotBefore: unknown = null;
  private movingFor = 0;
  private haltAskedAt = -Infinity;
  private loads = 0;
  private shots = 0;
  private hits = 0;
  /** The twist grip's angle when its hand took hold, and the elevation handwheel's handle's angle its hand is at. */
  private twistAtGrab = 0;
  private knobAngle = 0;
  private status = '';
  private statusSentAt = -Infinity;
  private lastCall = '';

  // The sign showing the crewmate's calls (every page).
  private sign!: FloatingSign;
  private signUntil = 0;
  private signText = '';

  init(): void {
    active = this;
    this.sign = new FloatingSign('Crew Call Sign', 0.6, [560, 140], 1.1, 0.12);
    this.world.createTransformEntity(this.sign.mesh);
    netLink.events.set('crew-call', (e) => this.onCall(e));
    netLink.events.set('bot-status', (e) => {
      if (!settings.bot && typeof e.line === 'string') this.crewBotLine = e.line.slice(0, 80);
    });
    this.cleanupFuncs.push(
      () => netLink.events.delete('crew-call'),
      () => netLink.events.delete('bot-status'),
      () => {
        if (active === this) active = null;
      },
    );
    const self = this;
    (window as { __crewCalls?: unknown }).__crewCalls = {
      send: (call: CrewCall) => sendCrewCall(call),
      get sign() { return self.sign.visible ? self.signText : ''; },
      get crewmate() { return self.crewBotLine; },
      get lastHeard() { return self.lastCall; },
    };
    if (!settings.bot) {
      return;
    }
    console.info('[Bot] this page plays as the practice crewmate');
    netLink.headOverride = () => {
      const p = this.headPose;
      p.px = this.head[0];
      p.py = this.head[1];
      p.pz = this.head[2];
      p.qx = this.quat.x;
      p.qy = this.quat.y;
      p.qz = this.quat.z;
      p.qw = this.quat.w;
      return p;
    };
    netLink.feetOverride = () => SEATS[seating.mine].floorY;
    for (const side of SIDES) {
      const hand = this.hands[side];
      scriptLoadingHand(side, () => {
        if (hand.mode !== 'loading' || this.seat !== 'gunner') return null;
        seatToHull(SEATS.gunner, seating.turretYaw, hand.at, this.q);
        return { x: this.q[0], y: this.q[1], z: this.q[2], squeeze: hand.squeeze };
      });
    }
    this.cleanupFuncs.push(() => {
      netLink.headOverride = null;
      netLink.feetOverride = null;
      this.setHands(false);
      for (const side of SIDES) scriptLoadingHand(side, null);
    });
    (window as { __bot?: unknown }).__bot = {
      get head() { return [...self.head]; },
      get seat() { return seating.mine; },
      hand: (side: Side) => seatToHull(SEATS[seating.mine], seating.turretYaw, self.hands[side].at, [0, 0, 0]),
      /** What each hand holds (handUse) and what it is doing. */
      holding: () => ({ left: handUse.left, right: handUse.right, modes: [self.hands.left.mode, self.hands.right.mode] }),
      get status() { return self.status; },
      get driving() { return { mode: self.driver.mode, motion: self.driver.motion, leg: self.driver.leg, arrivals: self.driver.arrivals, wish: { ...self.wish } }; },
      get gunning() {
        return { phase: self.phase, target: self.target, aim: { ...self.aim }, loads: self.loads, shots: self.shots, hits: self.hits, hit: [...self.hit], fireAtWill: self.fireAtWill };
      },
      /** As if the crewmate had called it (tests). */
      call: (call: CrewCall) => self.obey(call),
    };
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.dt = dt;
    this.time += dt;
    this.drawSign(delta);
    if (!settings.bot) {
      return;
    }
    if (!netLink.connected) {
      if (this.started) {
        this.started = false;
        this.setHands(false);
      }
      return;
    }
    const seat = SEATS[seating.mine];
    seatToHull(seat, seating.turretYaw, seat.eye, this.headGoal);
    if (!this.started) {
      this.started = true;
      this.startedAt = this.time;
      console.info(`[Bot] sitting in the ${seat.label.toLowerCase()}'s seat`);
      this.head[0] = this.headGoal[0];
      this.head[1] = this.headGoal[1];
      this.head[2] = this.headGoal[2];
      for (const side of SIDES) restingHandInSeat(seat, side, this.hands[side].at);
      this.setHands(true);
    }
    if (this.seat !== seating.mine) {
      // A new seat: start its job afresh, hands off whatever they held.
      const was = this.seat === null ? null : SEATS[this.seat];
      if (was) console.info(`[Bot] now the ${seat.label.toLowerCase()}`);
      this.seat = seating.mine;
      this.driver.mode = 'calls';
      this.driver.motion = 'halt';
      this.driver.heading = Number.NaN;
      this.phase = 'load';
      this.pathCount = 0;
      for (const side of SIDES) {
        const hand = this.hands[side];
        hand.mode = 'rest';
        hand.squeeze = false;
        hand.control = null;
        // The hands keep their place in the hull as the frame they are kept in changes.
        if (was) hullToSeat(seat, seating.turretYaw, seatToHull(was, seating.turretYaw, hand.at, this.q), hand.at);
      }
    }
    // Moved seats: slide across rather than jump.
    stepTowards(this.head, this.headGoal, MOVE_SPEED * dt);

    if (ride.active || seating.away) {
      this.rest('left');
      this.rest('right');
    } else if (seating.mine === 'driver') {
      this.drive(dt);
    } else {
      this.gun(dt);
    }
    for (const side of SIDES) this.moveHand(side, dt);
    this.say();

    idleLook((this.time - this.startedAt), this.look);
    const yaw = (seat.frame === 'turret' ? seating.turretYaw : 0) + this.look[0];
    this.euler.set(this.look[1], yaw, 0, 'YXZ');
    this.quat.setFromEuler(this.euler);
  }

  // ------------------------------------------------------------ Calls

  private onCall(e: Record<string, unknown>): void {
    const call = parseCall(e.call);
    if (call === null) return;
    this.lastCall = call;
    console.info(`[Bot] heard: ${CALL_WORDS[call]}`);
    if (settings.bot) {
      this.obey(call);
      return;
    }
    const from = SEATS[seating.crew].label;
    this.showSign(`${from}: ${CALL_WORDS[call]}`);
  }

  /** The practice crewmate does what a call says, if it is for its seat. */
  private obey(call: CrewCall): void {
    if (CALL_FROM[call] === seating.mine) return;
    if (seating.mine === 'driver') {
      const s = shownDriverState();
      this.driver.call(call, s ? s.heading : 0);
    } else if (call === 'fire' || call === 'hold') {
      this.fireAtWill = call === 'fire';
    }
  }

  private showSign(text: string): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(text, width / 2, height / 2, width - 30);
    this.sign.refresh();
    this.sign.setVisible(true);
    this.signText = text;
    this.signUntil = this.time + CALL_SIGN_SECONDS;
  }

  private drawSign(delta: number): void {
    if (!this.sign.visible) return;
    if (this.time > this.signUntil) {
      this.sign.setVisible(false);
      return;
    }
    const vr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.sign.follow(vr ? this.player.head : this.camera, delta);
  }

  /** Tell the player's page what the bot is doing (for the menu), when it changes, at most once a second. */
  private say(): void {
    // Looked at once a second (the line is a new string each time).
    if (this.time - this.statusSentAt < 1) return;
    this.statusSentAt = this.time;
    const line = seating.mine === 'driver' ? this.driverLine() : this.gunnerLine();
    if (line === this.status) return;
    this.status = line;
    const event = { t: 'bot-status', line };
    netLink.sendEvent(event);
  }

  private driverLine(): string {
    const t = this.task;
    if (t === null) return drive.parkingBrake ? 'letting off the parking brake' : this.driver.describe();
    if (t.kind === 'throttle') return 'setting the hand throttle';
    return t.id === 'starter' ? 'starting the engine' : `switching the ${t.id} ${t.id === 'choke' ? (drive.choke ? 'in' : 'out') : 'on'}`;
  }

  private gunnerLine(): string {
    const name = this.target >= 0 ? `the ${Math.round(this.facesRange(this.target))} m target` : 'no target in sight';
    const fire = this.fireAtWill ? '' : ', holding fire';
    switch (this.phase) {
      case 'load': return `loading${fire}`;
      case 'lay': return `laying on ${name}${fire}`;
      default: return `fired at ${name}`;
    }
  }

  private facesRange(i: number): number {
    const t = tankState();
    return Math.hypot(this.faces[i].x - t.x, this.faces[i].z - t.z);
  }

  // ------------------------------------------------------------ Driving

  /** The driver's job: the bot's wishes through the tillers and the gear lever. */
  private drive(dt: number): void {
    const s = shownDriverState();
    if (s == null) return;
    const tank = this.tank;
    tank.x = s.x;
    tank.z = s.z;
    tank.heading = s.heading;
    tank.speed = s.speed;
    // The engine first (F1.17): its left hand works the instrument box and the hand throttle, the right holds its tiller.
    if (s.running && !this.engineRan) this.caughtAt = this.time;
    this.engineRan = s.running;
    this.task = startTask(
      { running: s.running, starterHot: s.starterRest > 0, coolant: s.coolant },
      { battery: drive.battery, ignition: drive.ignition, choke: drive.choke, throttle: drive.throttle, start: engineStart() },
      this.time - this.caughtAt,
    );
    const left = this.hands.left;
    left.trigger = 0;
    if (this.task) {
      const t = this.task;
      if (t.kind === 'press') this.onControl('left', ENGINE_NAMES[t.id], null);
      else this.onControl('left', 'hand-throttle', leverGrip(HAND_THROTTLE, throttleAngle(t.to), this.p));
      this.onControl('right', TILLER.right, leverGrip(DRIVER_TILLER, tillerAngle(0), this.p));
      return;
    }
    if (drive.parkingBrake) {
      // The parking brake on (F1.18): the left hand takes its lever, holds the release (the trigger) and pushes it down.
      this.onControl('left', 'parking-brake', leverGrip(PARKING_BRAKE, PARKING_BRAKE.max, this.p));
      left.trigger = handUse.left === 'parking-brake' ? 1 : 0;
      this.onControl('right', TILLER.right, leverGrip(DRIVER_TILLER, tillerAngle(0), this.p));
      return;
    }
    // It drives with the automatic box (DriveSystem gives the crewmate's page no other), so its hands stay on the tillers.
    const wish = this.driver.update(dt, tank, this.wish);
    this.onControl('left', TILLER.left, leverGrip(DRIVER_TILLER, tillerAngle(wish.left), this.p));
    this.onControl('right', TILLER.right, leverGrip(DRIVER_TILLER, tillerAngle(wish.right), this.p));
  }

  // ------------------------------------------------------------ Gunning

  /** The gunner's job: load, lay on the nearest target not yet hit, fire from a halt, see where it went. */
  private gun(dt: number): void {
    const loading = loadingShown();
    if (loading == null) return;
    const turret = turretState();
    const tank = tankState();
    const right = this.hands.right;
    if (this.triggerFor > 0) {
      // Squeezing the trigger, still laid: the gun fires as it is pulled.
      this.triggerFor -= dt;
      right.trigger = this.triggerFor > 0 ? 1 : 0;
      this.twist(0);
      this.holdElevation(this.aim.elevation);
      if (this.triggerFor <= 0) {
        this.shots++;
        this.phase = 'result';
        this.waitedFor = 0;
        sendCrewCall('on-the-way');
      }
      return;
    }
    if (this.phase === 'result') {
      this.waitedFor += dt;
      const shot = lastShot();
      if (shot === this.shotBefore && this.waitedFor <= RESULT_WAIT) {
        this.twist(0);
        this.holdElevation(this.aim.elevation);
        return;
      }
      if (shot && shot !== this.shotBefore && shot.kind === 'target' && shot.target >= 0) {
        this.hit[shot.target] = true;
        this.hits++;
        sendCrewCall('target');
      }
      this.phase = 'load';
    }
    if (!loading.loaded) this.phase = 'load';
    if (this.phase === 'load') {
      // The left hand holds the elevation wheel where it is; the right loads.
      this.holdElevation(turret.elevation);
      if (this.load(dt)) this.phase = 'lay';
      return;
    }
    // Laying: the nearest target not hit yet; all hit, round again.
    this.target = chooseTarget(tank.x, tank.z, this.faces, this.hit, sightLimit());
    if (this.target < 0 && this.hit.includes(true)) {
      this.hit.fill(false);
      this.target = chooseTarget(tank.x, tank.z, this.faces, this.hit, sightLimit());
    }
    if (this.target < 0) {
      this.holdElevation(turret.elevation);
      this.twist(0);
      return;
    }
    aimAt(tank, this.faces[this.target], muzzlePoint, this.aim);
    const yawError = wrapAngle(this.aim.yaw - turret.yaw);
    const demand = traverseDemand(yawError, turret.rate, powerTraverseRate(engineRpm()), MAX_TRAVERSE_ACCEL);
    this.twist(twistForDemand(POWER_GRIP, demand));
    this.holdElevation(this.aim.elevation);
    const laid = Math.abs(yawError) < LAY.yawDone && Math.abs(turret.rate) < LAY.still
      && Math.abs(turret.elevation - this.aim.elevation) < LAY.elevationDone;
    const halted = Math.abs(tank.speed) < FIRE_SPEED && Math.abs(tank.yawRate) < 0.01;
    this.laidFor = laid && halted ? this.laidFor + dt : 0;
    this.movingFor = laid && !halted ? this.movingFor + dt : 0;
    if (this.movingFor > HALT_ASK_AFTER && this.fireAtWill && this.time - this.haltAskedAt > HALT_ASK_EVERY) {
      this.haltAskedAt = this.time;
      sendCrewCall('halt');
    }
    if (this.laidFor > LAID_FOR && this.fireAtWill && handUse.right === TWIST) {
      this.shotBefore = lastShot();
      this.triggerFor = TRIGGER_FOR;
      right.trigger = 1;
      console.info(`[Bot] firing at target ${this.target}`);
    }
  }

  /** The right hand's loading: plan a move from how the breech stands, go to its start, play it; true once loaded. */
  private load(dt: number): boolean {
    const hand = this.hands.right;
    const s = loadingShown();
    if (s == null) return false;
    if (s.loaded && this.pathCount === 0) return true;
    if (s.loaded && this.pathTime < 0) {
      // Loaded while it was on its way (the other player loaded it): nothing to do.
      this.pathCount = 0;
      return true;
    }
    if (this.pathCount === 0) {
      const shell = s.shells.findIndex((x) => x.place === 'rack');
      restingHandInSeat(SEATS.gunner, 'right', this.p);
      this.pathCount = loadPlan(s, shell >= 0 ? s.shells[shell].centre : null, turretState().elevation, this.p, this.path);
      this.pathTime = -1;
      if (this.pathCount === 0) {
        this.rest('right');
        return false;
      }
    }
    hand.mode = 'loading';
    hand.control = null;
    hand.trigger = 0;
    if (this.pathTime < 0) {
      // On the way to the path's start, open-handed.
      hand.squeeze = false;
      const start = this.path[0].p;
      for (let k = 0; k < 3; k++) hand.goal[k] = start[k];
      if (Math.hypot(hand.at[0] - start[0], hand.at[1] - start[1], hand.at[2] - start[2]) < ON_HANDLE) this.pathTime = 0;
      return false;
    }
    this.pathTime += dt;
    hand.squeeze = pathAt(this.path, this.pathCount, this.pathTime, hand.goal);
    // Exactly on its path: the path is timed already.
    for (let k = 0; k < 3; k++) hand.at[k] = hand.goal[k];
    if (this.pathTime >= pathLength(this.path, this.pathCount)) {
      this.pathCount = 0;
      if (s.loaded) {
        this.loads++;
        console.info(`[Bot] loaded (${this.loads})`);
      }
      return s.loaded;
    }
    return false;
  }

  /** The right hand on the power grip, twisted to `angle` (rad) from where it was when it took hold. */
  private twist(angle: number): void {
    const control = findControl(TWIST);
    if (control == null) return;
    const grip = control.mech as TwistGrip;
    const hand = this.hands.right;
    if (handUse.right === TWIST && hand.held !== TWIST) this.twistAtGrab = grip.angle;
    const roll = handUse.right === TWIST ? angle - this.twistAtGrab : 0;
    this.onControl('right', TWIST, null, twistAcross(roll, this.across));
    if (handUse.right !== TWIST) hand.trigger = 0;
  }

  /** The left hand on the elevation handwheel's handle, winding it until the gun is at `elevation`. */
  private holdElevation(elevation: number): void {
    const control = findControl(ELEVATION);
    if (control == null) return;
    const wheel = control.mech as Wheel;
    const hand = this.hands.left;
    if (handUse.left !== ELEVATION) {
      this.onControl('left', ELEVATION, null);
      return;
    }
    // Just took hold, on the handle: the wheel turns with the hand's angle from here.
    if (hand.held !== ELEVATION) this.knobAngle = wheel.angle;
    const wanted = Math.min(ELEVATION_WHEEL.max, Math.max(ELEVATION_WHEEL.min, wheelForElevation(elevation)));
    const step = WHEEL_SPEED * this.dt;
    this.knobAngle += Math.max(-step, Math.min(step, wanted - this.knobAngle));
    this.onControl('left', ELEVATION, wheelGrip(ELEVATION_WHEEL, this.knobAngle, this.p));
  }

  // ------------------------------------------------------------ Hands

  private rest(side: Side): void {
    const hand = this.hands[side];
    hand.mode = 'rest';
    hand.control = null;
    hand.squeeze = false;
    hand.trigger = 0;
    if (side === 'right') this.pathCount = 0;
    restingHandInSeat(SEATS[seating.mine], side, hand.goal);
  }

  /**
   * Put `side` on the kit control `name`: to its handle where it is now,
   * squeezing once there; once it holds it, to `point` (the control's own
   * space; null: stay on the handle) with the hand rolled `across` (the
   * control's space, for a twist grip).
   */
  private onControl(side: Side, name: string, point: Vec3 | null, across: Vec3 | null = null): void {
    const hand = this.hands[side];
    const control = findControl(name);
    if (control == null) {
      this.rest(side);
      return;
    }
    if (hand.mode === 'loading' && side === 'right') this.pathCount = 0;
    hand.mode = 'control';
    hand.control = name;
    const holding = handUse[side] === name;
    const local = holding && point ? point : control.mech.handle(side === 'left' ? 0 : 1, this.p);
    control.frame.updateWorldMatrix(true, false);
    this.v.set(local[0], local[1], local[2]).applyMatrix4(control.frame.matrixWorld);
    hullToSeat(SEATS[seating.mine], seating.turretYaw, this.v.toArray(this.q), hand.goal);
    if (across) {
      this.v.set(across[0], across[1], across[2]).transformDirection(control.frame.matrixWorld);
      hand.scripted.across[0] = this.v.x;
      hand.scripted.across[1] = this.v.y;
      hand.scripted.across[2] = this.v.z;
    }
    if (holding) {
      hand.squeeze = true;
      hand.squeezing = 0;
      return;
    }
    // Not holding it (yet, or any more): another control is let go of first; squeeze once on the handle.
    const there = Math.hypot(hand.at[0] - hand.goal[0], hand.at[1] - hand.goal[1], hand.at[2] - hand.goal[2]) < ON_HANDLE;
    if (handUse[side] !== null || !there || hand.squeezing > GRAB_TIMEOUT) {
      hand.squeeze = false;
      hand.squeezing = 0;
      return;
    }
    hand.squeeze = true;
  }

  /** Move a hand towards its goal, and hand the kit what it does this frame. */
  private moveHand(side: Side, dt: number): void {
    const hand = this.hands[side];
    if (hand.mode !== 'loading' || this.pathTime < 0) stepTowards(hand.at, hand.goal, HAND_SPEED * dt);
    if (hand.squeeze && handUse[side] === null) hand.squeezing += dt;
    if (hand.mode !== 'control') hand.trigger = 0;
    hand.held = handUse[side];
    const s = hand.scripted;
    seatToHull(SEATS[seating.mine], seating.turretYaw, hand.at, s.fist);
    s.squeeze = hand.mode === 'control' && hand.squeeze;
    s.trigger = hand.trigger;
    netLink.scriptedSqueeze[side] = handUse[side] !== null || hand.squeeze;
  }

  /** Send the bot's hands as tracked hands and give them to the kit, or stop. */
  private setHands(on: boolean): void {
    for (const side of SIDES) {
      const hand = this.hands[side];
      netLink.handOverride[side] = on
        ? () => {
            const s = hand.scripted.fist;
            hand.pose.px = s[0];
            hand.pose.py = s[1];
            hand.pose.pz = s[2];
            return hand.pose;
          }
        : null;
      netLink.scriptedSqueeze[side] = false;
      scriptedHands[side] = on ? hand.scripted : null;
      if (!on) hand.scripted.squeeze = false;
    }
    netLink.extraFlags.bot = on ? FLAG_LEFT_TRACKED | FLAG_RIGHT_TRACKED : 0;
  }
}
