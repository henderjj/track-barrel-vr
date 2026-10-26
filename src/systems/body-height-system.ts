import { createSystem } from '@iwsdk/core';
import { type BodyChoice, clampEyeRaise, glide, rigOffset, targetEyeHeight, UprightEye } from '../sim/body-height.js';
import { saveSettings, settings } from '../settings.js';
import { netLink } from './net-system.js';

/** Eye height in the seat, seated or standing play and calibration, for the HUD and menus. */
export const body = {
  /** The player's choice in effect. */
  choice: { raise: settings.raise, seated: settings.seated } as BodyChoice,
  /** How far the player's rig is raised (+) or lowered (-), m. */
  offset: 0,
  /** This player's eye height above their seat's floor, offset included, m (NaN until measured in VR). */
  eye: Number.NaN,
  /** The crewmate's upright eye height above their seat's floor, as drawn, m (NaN with no crewmate). */
  crewEye: Number.NaN,
  /** The eye height calibration took, in the play space, m (NaN until calibrated this session; CalibrationSystem sets it). */
  calibratedEye: Number.NaN,
  /** The reach calibration took, m (NaN until taken). */
  reach: Number.NaN,
  /** Set by chooseBody and calibration: move straight to the new height rather than glide. */
  changed: false,
  /** Start calibrating again (CalibrationSystem sets it). */
  calibrate: (): void => undefined,
};

/**
 * Change the eye raise (m from the seat's eye point) or seated play while
 * playing, from an in-game menu. Takes effect at once and is kept for the
 * next visit, as the Settings menu's choices are. Changing between seated
 * and standing calibrates again, as the eyes are somewhere else now.
 */
export function chooseBody(choice: BodyChoice): void {
  const raise = clampEyeRaise(choice.raise);
  const postureChanged = choice.seated !== body.choice.seated;
  body.choice = { raise, seated: choice.seated };
  body.changed = true;
  settings.raise = raise;
  settings.seated = choice.seated;
  saveSettings({ raise: raise !== 0 ? String(raise) : null, seated: choice.seated ? null : '0' });
  if (postureChanged) {
    body.calibrate();
  }
}

/**
 * Puts the player's eyes on their seat's eye point (src/sim/body-height.ts)
 * by raising or lowering the player rig, which carries the view and both
 * hands: from the calibrated eye height once there is one, the highest the
 * head has been until then. The seat system adds the seat's floor on top.
 * Only in VR; the flat page's camera is left alone. Runs before anything
 * reads the head or hands this frame.
 */
export class BodyHeightSystem extends createSystem({}) {
  private own = new UprightEye();
  private crew = new UprightEye();
  private inVr = false;
  /** Jump to the next offset rather than glide (a new session or a new choice). */
  private snap = true;

  init(): void {
    (window as { __body?: unknown }).__body = {
      state: body,
      choose: chooseBody,
      upright: () => this.own.upright,
      target: () => targetEyeHeight(body.choice),
    };
  }

  update(delta: number): void {
    this.measureCrew(delta);
    const player = this.player;
    if (!this.world.session) {
      if (this.inVr) {
        this.inVr = false;
        player.position.y = 0;
        body.offset = 0;
        body.eye = Number.NaN;
      }
      return;
    }
    if (!this.inVr || body.changed) {
      // Someone else may be wearing the headset now, or they've just sat down: measure afresh.
      if (!this.inVr) {
        body.calibratedEye = Number.NaN;
        body.reach = Number.NaN;
      }
      this.inVr = true;
      body.changed = false;
      this.own.reset();
      this.snap = true;
    }
    this.own.push(player.head.position.y, delta);
    const eye = Number.isFinite(body.calibratedEye) ? body.calibratedEye : this.own.upright;
    if (Number.isNaN(eye)) {
      player.position.y = body.offset;
      return;
    }
    const want = rigOffset(targetEyeHeight(body.choice), eye);
    body.offset = this.snap ? want : glide(body.offset, want, delta);
    this.snap = false;
    player.position.y = body.offset;
    body.eye = eye + body.offset;
  }

  /** The crewmate's upright eye height as they're drawn, for the HUD. */
  private measureCrew(delta: number): void {
    if (!netLink.haveRemote) {
      if (!Number.isNaN(this.crew.upright)) {
        this.crew.reset();
        body.crewEye = Number.NaN;
      }
      return;
    }
    // Measured from their feet, in case your game lifts them off the deck (netLink.feet).
    this.crew.push(netLink.remote.head.py - netLink.remote.feet, delta);
    body.crewEye = this.crew.upright;
  }
}
