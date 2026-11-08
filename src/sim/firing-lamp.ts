/**
 * The firing lamp (F2.5, docs/firing-lamp.md): a lamp on the top bar of the
 * driver's vision slit that lights by itself while the gun is ready to fire
 * (a shell rammed, the breech closed and the gunner's hand on a control
 * with a trigger), and flashes at the shot, so the driver holds the tank
 * steady for the shot and knows when it has gone. A repeater on the
 * turret's front wall right of the gunsight shows the gunner what the
 * driver sees. Engine-free: the rule, the lamp's look over time, and where
 * both lamps sit. Shared by the model, FiringLampSystem, the crewmate and
 * the tests. Allocates nothing per frame.
 *
 * Hull space for the driver's lamp and turret space for the repeater, as in
 * src/sim/cabin.ts. Each lamp's lens faces +Z, back down the hull at the
 * driver and back down the turret at the gunner.
 */

import { HULL, SIGHT_EYEPIECE, TURRET, VISION_SLIT } from './cabin.js';
import { SLIT_FRAME } from './driver-station.js';

/** A round lamp flat on a face: its lens's middle, the lens's and the bezel's radii, and how far each stands out, m. */
export interface LampPlace {
  /** The lens's middle on the face it is set in (x, y), and that face's z. */
  x: number;
  y: number;
  z: number;
  /** The lens's radius, and the dark bezel ring's round it. */
  lens: number;
  bezel: number;
  /**
   * The bezel stands this far out of the face (and sinks `sunk` into it):
   * 8 mm or more, as the cabin is also seen from outside on the range; the
   * lens this far out of the bezel (3 mm or more, test/z-fighting.test.ts).
   */
  proud: number;
  sunk: number;
  lensProud: number;
}

/**
 * The driver's lamp: in the middle of the slit frame's top bar, the bar's
 * face 3 cm in front of the hood, so it sits about 7 cm over the line
 * through the slit and 27 cm from the eyes: in sight (about 15° up) while
 * the driver looks out, and under the brow pad's front edge, so a head
 * leaning into the slit meets the pad first (EYE_CLEARANCE,
 * test/interior.test.ts). 1.6 cm across: about 3.4° from the seat, about
 * the size of the gear readout's figure.
 */
export const FIRING_LAMP: LampPlace = (() => {
  const s = VISION_SLIT;
  const f = SLIT_FRAME;
  return {
    x: s.x,
    y: s.y + s.height / 2 + f.inset + f.bar / 2,
    z: s.z + f.depth,
    lens: 0.008,
    bezel: 0.012,
    proud: 0.009,
    sunk: 0.004,
    lensProud: 0.004,
  };
})();

/**
 * The gunner's repeater: on the turret's front wall right of the gunsight's
 * knuckle, just over the gunner's eye height, about 88 cm ahead of the
 * eyes, where the wall is clear past the sight's arm. Bigger than the
 * driver's lamp for the distance: 3.6 cm across is about 2.3°.
 */
export const LAMP_REPEATER: LampPlace = {
  x: SIGHT_EYEPIECE[0] + 0.2,
  y: SIGHT_EYEPIECE[1] + 0.02,
  z: TURRET.front + HULL.wall,
  lens: 0.018,
  bezel: 0.025,
  proud: 0.009,
  sunk: 0.005,
  lensProud: 0.004,
};

/** The front of a lamp's lens, out from the face it is set in, m. */
export function lensFront(p: LampPlace): number {
  return p.z + p.proud + p.lensProud;
}

/** What makes the gun ready to fire, as this page has it. */
export interface ReadyInputs {
  /** A shell rammed and the breech closed (the loading's `loaded`). */
  loaded: boolean;
  /** One of the gunner's hands on the power grip or the elevation handwheel's handle: the two controls with a trigger. */
  handOnTrigger: boolean;
  /** Practice → Ready to fire, played alone: the gun was laid and loaded for the player, which counts as the gunner's hand until it fires. */
  practice: boolean;
}

/** The gun is ready to fire: loaded, and someone could pull a trigger now. */
export function gunReady(i: Readonly<ReadyInputs>): boolean {
  return i.loaded && (i.handOnTrigger || i.practice);
}

/** How the lamp looks: dark, lit (ready to fire), or bright in one of the shot's flashes. */
export type LampLook = 'dark' | 'lit' | 'flash';

/** The shot's flashes: how many, how long each is on and off, s. 0.66 s in all, past the recoil and the casing. */
export const FLASH = { count: 3, on: 0.12, off: 0.1 } as const;
export const FLASH_SECONDS = FLASH.count * (FLASH.on + FLASH.off);

/**
 * The lamp over time: `step` it each frame with whether the gun is ready,
 * and `fired()` at each shot. Lit while ready; at a shot, FLASH.count
 * bright flashes with dark between, whatever the gun's state, then lit or
 * dark again as the gun stands (after a shot the breech is open, so dark
 * until the next load).
 */
export class FiringLamp {
  look: LampLook = 'dark';
  /** Shots it has flashed for. */
  flashes = 0;
  private sinceShot = Infinity;

  /** A shot left the gun: flash. */
  fired(): void {
    this.sinceShot = 0;
    this.flashes++;
  }

  step(dt: number, ready: boolean): LampLook {
    if (this.sinceShot < FLASH_SECONDS) {
      const t = this.sinceShot;
      this.sinceShot += dt;
      this.look = t % (FLASH.on + FLASH.off) < FLASH.on ? 'flash' : 'dark';
      return this.look;
    }
    this.look = ready ? 'lit' : 'dark';
    return this.look;
  }
}

/**
 * Practice → Ready to fire → Driver's lamp, alone: how long the lamp stays
 * lit before the pretend gunner pulls the trigger, s. Long enough to look
 * at it, short enough to wait for.
 */
export const PRACTICE_FIRE_AFTER = 3;
