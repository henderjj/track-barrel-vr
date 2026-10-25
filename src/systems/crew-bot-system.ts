import { createSystem } from '@iwsdk/core';
import type { PoseSample } from '../net/pose-codec.js';
import { settings } from '../settings.js';
import { interceptPoint, stepTowards, throwFlightTime, throwVelocity } from '../sim/crew-bot.js';
import { CREW_SPOT } from '../sim/play-area.js';
import { netLink } from './net-system.js';
import { type ObjectView, type TestHand, ThrowablesSystem } from './throwables-system.js';

type Vec3 = [number, number, number];
type ThrowPhase = 'ready' | 'catching' | 'holding' | 'windup' | 'swing';

/** Eye height, m, and how fast the bot walks about the deck, m/s. */
const EYE_HEIGHT = 1.6;
const WALK_SPEED = 1.5;
/** How long the bot holds a caught block before throwing it back, and the throw's wind-up and swing, ms. */
const HOLD_MS = 1500;
const WINDUP_MS = 300;
const SWING_MS = 250;
/** A block counts as thrown when it moves faster than this, m/s. */
const FLYING_SPEED = 1.5;
const HAND_SPEED = 4;
const CATCH_TIMEOUT_MS = 1000;

/**
 * The practice crewmate: with "This page plays as: Practice crewmate" in
 * Settings (or ?bot=1), this page joins the crew as a bot second player, so
 * one person can test the parts of the game that need two, with the bot's
 * page on a PC and the player in the headset. In the demo it stands across
 * the table facing the player, reaches for a block thrown near it, and
 * throws it back to their chest after a moment.
 *
 * Grow it with the game: give it a mode per co-op job (take the other end
 * of a shared control and copy the player's hand, as last drawn, moved on
 * by the time since; answer a ready check; hand gear over), chosen each
 * frame from what the player's packets say they are doing. It works the
 * game through the same scripted hands the two-player tests use, so the
 * player sees its hands move, and its avatar walks to each job. The page
 * must stay showing (a hidden tab counts as a crewmate who stepped away).
 */
export class CrewBotSystem extends createSystem({}) {
  private throws: ThrowablesSystem | undefined;
  /** What the bot has done, for tests and the console. */
  private stats = { catches: 0, throws: 0 };
  private started = false;

  // The bot's head, where it's walking to, and the way it faces.
  private head: Vec3 = [CREW_SPOT[0], EYE_HEIGHT, CREW_SPOT[1]];
  private headTarget: Vec3 = [CREW_SPOT[0], EYE_HEIGHT, CREW_SPOT[1]];
  private yaw = 0;
  private headPose: PoseSample = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  // Catching and throwing.
  private phase: ThrowPhase = 'ready';
  private phaseSince = 0;
  private catching = -1;
  private rest: Vec3 = [0, 0, 0];
  private leftRest: Vec3 = [0, 0, 0];
  private hand: Vec3 = [0, 0, 0];
  private handGoal: Vec3 = [0, 0, 0];
  private squeeze = false;
  private throwFrom: Vec3 = [0, 0, 0];
  private throwStart: Vec3 = [0, 0, 0];
  private throwVel: Vec3 = [0, 0, 0];
  private released = false;
  private view: ObjectView = { remote: false, heldBy: null, remoteHeld: false, pos: [0, 0, 0], speed: 0 };
  private prevPos: Vec3[] = [];
  private vel: Vec3 = [0, 0, 0];
  private aim: Vec3 = [0, 0, 0];
  private rightOut: TestHand = { x: 0, y: 0, z: 0, squeeze: false };
  private leftOut: TestHand = { x: 0, y: 0, z: 0, squeeze: false };
  private readonly rightHand = (nowMs: number): TestHand => this.throwHand(nowMs);
  private readonly leftHand = (): TestHand => {
    this.leftOut.x = this.leftRest[0];
    this.leftOut.y = this.leftRest[1];
    this.leftOut.z = this.leftRest[2];
    return this.leftOut;
  };

  init(): void {
    if (!settings.bot) {
      return;
    }
    console.info('[Bot] this page plays as the practice crewmate');
    netLink.headOverride = () => {
      const p = this.headPose;
      p.px = this.head[0];
      p.py = this.head[1];
      p.pz = this.head[2];
      p.qx = 0;
      p.qy = Math.sin(this.yaw / 2);
      p.qz = 0;
      p.qw = Math.cos(this.yaw / 2);
      return p;
    };
    netLink.feetOverride = () => Math.max(0, this.head[1] - EYE_HEIGHT);
    this.cleanupFuncs.push(() => {
      netLink.headOverride = null;
      netLink.feetOverride = null;
    });
    const self = this;
    (window as { __bot?: unknown }).__bot = {
      get head() { return [...self.head]; },
      get phase() { return self.phase; },
      stats: this.stats,
    };
  }

  update(delta: number): void {
    if (!settings.bot) {
      return;
    }
    this.throws ??= this.world.getSystem(ThrowablesSystem);
    const now = performance.now();
    const dt = Math.min(delta, 0.1);
    if (!netLink.connected) {
      if (this.started) {
        this.started = false;
        for (const side of ['left', 'right'] as const) this.throws?.setScriptedHand(side, null);
      }
      return;
    }
    if (!this.started) {
      this.started = true;
      console.info('[Bot] waiting for a throw');
      this.phase = 'ready';
      this.squeeze = false;
      this.catching = -1;
      this.placeHands();
      this.copyRest(this.hand);
      this.throws?.setScriptedHand('right', this.rightHand);
      this.throws?.setScriptedHand('left', this.leftHand);
    }
    // Face the player from its spot across the table.
    const p = netLink.remote.head;
    this.yaw = Math.atan2(-(p.px - this.head[0]), -(p.pz - this.head[2]));
    stepTowards(this.head, this.headTarget, WALK_SPEED * dt);
    this.placeHands();
    this.catchAndThrow(now, dt);
  }

  private placeHands(): void {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // Right of facing is (−fz, fx).
    this.rest[0] = this.head[0] + fx * 0.4 - fz * 0.15;
    this.rest[1] = this.head[1] - 0.4;
    this.rest[2] = this.head[2] + fz * 0.4 + fx * 0.15;
    this.leftRest[0] = this.head[0] + fx * 0.3 + fz * 0.2;
    this.leftRest[1] = this.head[1] - 0.45;
    this.leftRest[2] = this.head[2] + fz * 0.3 - fx * 0.2;
  }

  private copyRest(out: Vec3): void {
    out[0] = this.rest[0];
    out[1] = this.rest[1];
    out[2] = this.rest[2];
  }

  /** Reach for a block thrown its way, hold it a moment, throw it back to the player's chest. */
  private catchAndThrow(now: number, dt: number): void {
    const throws = this.throws;
    if (!throws) {
      return;
    }
    const t = now - this.phaseSince;
    // Each block's velocity from its last two positions.
    for (let id = 0; id < throws.objectCount; id++) {
      this.prevPos[id] ??= [Number.NaN, 0, 0];
    }
    let holding = -1;
    let target = -1;
    for (let id = 0; id < throws.objectCount; id++) {
      throws.readObject(id, this.view);
      const v = this.view;
      const prev = this.prevPos[id];
      if (v.heldBy === 'right') {
        holding = id;
      }
      if (!Number.isNaN(prev[0]) && dt > 0 && (this.phase === 'ready' || id === this.catching) && target < 0) {
        this.vel[0] = (v.pos[0] - prev[0]) / dt;
        this.vel[1] = (v.pos[1] - prev[1]) / dt;
        this.vel[2] = (v.pos[2] - prev[2]) / dt;
        if (v.remote && !v.remoteHeld && v.speed > FLYING_SPEED && interceptPoint(v.pos, this.vel, this.rest, this.aim)) {
          target = id;
          this.handGoal[0] = this.aim[0];
          this.handGoal[1] = this.aim[1];
          this.handGoal[2] = this.aim[2];
        }
      }
      prev[0] = v.pos[0];
      prev[1] = v.pos[1];
      prev[2] = v.pos[2];
    }

    switch (this.phase) {
      case 'ready':
        this.copyRest(this.handGoal);
        if (holding >= 0) {
          this.setPhase(now, 'holding');
        } else if (target >= 0) {
          this.catching = target;
          this.squeeze = true;
          this.setPhase(now, 'catching');
        }
        break;
      case 'catching':
        if (holding >= 0) {
          this.stats.catches++;
          console.info('[Bot] caught it');
          this.setPhase(now, 'holding');
        } else if (t > CATCH_TIMEOUT_MS) {
          this.squeeze = false;
          this.catching = -1;
          this.setPhase(now, 'ready');
        } else if (target < 0) {
          this.copyRest(this.handGoal);
        }
        break;
      case 'holding':
        this.copyRest(this.handGoal);
        if (holding < 0) {
          this.squeeze = false;
          this.setPhase(now, 'ready');
        } else if (t > HOLD_MS) {
          this.aimThrow();
          this.throwFrom[0] = this.hand[0];
          this.throwFrom[1] = this.hand[1];
          this.throwFrom[2] = this.hand[2];
          this.setPhase(now, 'windup');
        }
        break;
      case 'windup':
        if (t > WINDUP_MS) {
          this.setPhase(now, 'swing');
        }
        break;
      case 'swing':
        if (this.released) {
          this.released = false;
          this.squeeze = false;
          this.catching = -1;
          this.copyRest(this.hand);
          this.stats.throws++;
          console.info('[Bot] threw it back');
          this.setPhase(now, 'ready');
        }
        break;
    }
    if (this.phase === 'ready' || this.phase === 'catching' || this.phase === 'holding') {
      stepTowards(this.hand, this.handGoal, HAND_SPEED * dt);
    }
  }

  private setPhase(now: number, phase: ThrowPhase): void {
    this.phase = phase;
    this.phaseSince = now;
  }

  /** Throw from the resting hand to just in front of the player's chest. */
  private aimThrow(): void {
    const p = netLink.remote.head;
    const dx = this.head[0] - p.px;
    const dz = this.head[2] - p.pz;
    const flat = Math.hypot(dx, dz) || 1;
    this.aim[0] = p.px + (dx / flat) * 0.3;
    this.aim[1] = p.py - 0.45;
    this.aim[2] = p.pz + (dz / flat) * 0.3;
    const distance = Math.hypot(this.aim[0] - this.rest[0], this.aim[1] - this.rest[1], this.aim[2] - this.rest[2]);
    throwVelocity(this.rest, this.aim, throwFlightTime(distance), this.throwVel);
    for (let i = 0; i < 3; i++) {
      this.throwStart[i] = this.rest[i] - (this.throwVel[i] * SWING_MS) / 1000;
    }
  }

  /** The right hand as the throwables system reads it: resting, reaching, winding up or swinging through the release. */
  private throwHand(nowMs: number): TestHand {
    const o = this.rightOut;
    const t = nowMs - this.phaseSince;
    let squeeze = this.squeeze;
    if (this.phase === 'windup') {
      const k = Math.min(1, t / WINDUP_MS);
      o.x = this.throwFrom[0] + (this.throwStart[0] - this.throwFrom[0]) * k;
      o.y = this.throwFrom[1] + (this.throwStart[1] - this.throwFrom[1]) * k;
      o.z = this.throwFrom[2] + (this.throwStart[2] - this.throwFrom[2]) * k;
      squeeze = true;
    } else if (this.phase === 'swing') {
      // The hand keeps moving through the release, as a real arm does, and
      // lets go in the frame the game reads it.
      const k = t / 1000;
      o.x = this.throwStart[0] + this.throwVel[0] * k;
      o.y = this.throwStart[1] + this.throwVel[1] * k;
      o.z = this.throwStart[2] + this.throwVel[2] * k;
      squeeze = t < SWING_MS;
      if (!squeeze) {
        this.released = true;
      }
    } else {
      o.x = this.hand[0];
      o.y = this.hand[1];
      o.z = this.hand[2];
    }
    o.squeeze = squeeze;
    return o;
  }
}
