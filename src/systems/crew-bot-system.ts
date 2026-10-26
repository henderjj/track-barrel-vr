import { createSystem, Euler, Quaternion } from '@iwsdk/core';
import type { PoseSample } from '../net/pose-codec.js';
import { settings } from '../settings.js';
import { SEATS, seatToHull } from '../sim/cabin.js';
import { idleLook, restingHand, stepTowards } from '../sim/crew-bot.js';
import { FLAG_LEFT_TRACKED, FLAG_RIGHT_TRACKED, netLink } from './net-system.js';
import { seating } from './seating.js';

type Vec3 = [number, number, number];
const SIDES = ['left', 'right'] as const;

/** How fast the bot's head and hands move to a new seat, m/s. */
const MOVE_SPEED = 1.5;

/**
 * The practice crewmate: with "This page plays as: Practice crewmate" in
 * Settings (or ?bot=1), this page joins the crew as a bot second player, so
 * one person can test the parts of the game that need two, with the bot's
 * page on a PC and the player in the headset. It sits in the seat the
 * host gives it (the other one from the player's), looks about, and rests
 * its hands in front of it where its seat's controls will be.
 *
 * Grow it with the game: give it a mode per co-op job (drive a route or
 * follow calls in the driver's seat, aim at and fire on the nearest target
 * in the gunner's, F1.13), chosen each frame from what the player's
 * packets say they are doing. It works the game through scripted hands,
 * as the two-player tests do, so the player sees its hands move. The page
 * must stay showing (a hidden tab counts as a crewmate who stepped away).
 */
export class CrewBotSystem extends createSystem({}) {
  private started = false;
  private startedAt = 0;
  private head: Vec3 = [0, 0, 0];
  private headGoal: Vec3 = [0, 0, 0];
  private hands: Record<(typeof SIDES)[number], Vec3> = { left: [0, 0, 0], right: [0, 0, 0] };
  private handGoal: Vec3 = [0, 0, 0];
  private look: [number, number] = [0, 0];
  private euler = new Euler(0, 0, 0, 'YXZ');
  private quat = new Quaternion();
  private headPose: PoseSample = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  private handPoses: Record<(typeof SIDES)[number], PoseSample> = {
    left: { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    right: { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
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
      p.qx = this.quat.x;
      p.qy = this.quat.y;
      p.qz = this.quat.z;
      p.qw = this.quat.w;
      return p;
    };
    netLink.feetOverride = () => SEATS[seating.mine].floorY;
    this.cleanupFuncs.push(() => {
      netLink.headOverride = null;
      netLink.feetOverride = null;
      this.setHands(false);
    });
    const self = this;
    (window as { __bot?: unknown }).__bot = {
      get head() { return [...self.head]; },
      get seat() { return seating.mine; },
      hand: (side: (typeof SIDES)[number]) => [...self.hands[side]],
    };
  }

  update(delta: number): void {
    if (!settings.bot) {
      return;
    }
    const now = performance.now();
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
      this.startedAt = now;
      console.info(`[Bot] sitting in the ${seat.label.toLowerCase()}'s seat`);
      this.head[0] = this.headGoal[0];
      this.head[1] = this.headGoal[1];
      this.head[2] = this.headGoal[2];
      for (const side of SIDES) restingHand(seat, seating.turretYaw, side, this.hands[side]);
      this.setHands(true);
    }
    // Moved seats: slide across rather than jump.
    const step = MOVE_SPEED * Math.min(delta, 0.1);
    stepTowards(this.head, this.headGoal, step);
    for (const side of SIDES) {
      stepTowards(this.hands[side], restingHand(seat, seating.turretYaw, side, this.handGoal), step);
    }
    idleLook((now - this.startedAt) / 1000, this.look);
    const yaw = (seat.frame === 'turret' ? seating.turretYaw : 0) + this.look[0];
    this.euler.set(this.look[1], yaw, 0, 'YXZ');
    this.quat.setFromEuler(this.euler);
  }

  /** Send the bot's resting hands as tracked hands, or stop. */
  private setHands(on: boolean): void {
    for (const side of SIDES) {
      const pose = this.handPoses[side];
      const hand = this.hands[side];
      netLink.handOverride[side] = on
        ? () => {
            pose.px = hand[0];
            pose.py = hand[1];
            pose.pz = hand[2];
            return pose;
          }
        : null;
      netLink.scriptedSqueeze[side] = false;
    }
    netLink.extraFlags.bot = on ? FLAG_LEFT_TRACKED | FLAG_RIGHT_TRACKED : 0;
  }
}
