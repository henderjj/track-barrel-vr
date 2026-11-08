import { createSystem, type Entity, MeshBasicMaterial, Vector3 } from '@iwsdk/core';
import { createLampLens } from '../scene-assets/firing-lamp.scene-asset.js';
import { seatToHull, SEATS } from '../sim/cabin.js';
import { twistAcross } from '../sim/crew-bot.js';
import { FiringLamp, FIRING_LAMP, gunReady, LAMP_REPEATER, type LampLook, lensFront, PRACTICE_FIRE_AFTER, type ReadyInputs } from '../sim/firing-lamp.js';
import type { Vec3 } from '../sim/mechanism.js';
import { shotListeners } from './firing-system.js';
import { handUse } from './grip-system.js';
import { HoldKind } from './hand-lock.js';
import { loadingShown, practiceLoads } from './loading-system.js';
import { findControl, scriptedHands } from './mechanism-system.js';
import { holdKindOf, netLink } from './net-system.js';
import { readyToFire } from './range-run-system.js';
import { seating } from './seating.js';
import { ownsTurret, pullTrigger, sayAboutTheGun, turretState } from './turret-system.js';

/** The lamp's amber, lit; unlit it is LAMP_DARK of it; a flash is near white. */
const AMBER = 0xffa21f;
const FLASH_COLOR = 0xfff4d0;
const LAMP_DARK = 0.1;
/** The two controls with a trigger: a gunner's hand on either can fire the gun. */
const TRIGGER_KINDS: ReadonlySet<number> = new Set([HoldKind.PowerTraverse, HoldKind.ElevationWheel]);
/** The power grip's name in the mechanism kit (TurretSystem's `turret-${key}`). */
const POWER_GRIP = 'turret-twist';

let active: FiringLampSystem | null = null;

/** Whether the firing lamp is lit on this page (ready to fire, or flashing at a shot): the practice crewmate holds the tank steady while it is (F2.5). */
export function firingLampLit(): boolean {
  return active != null && active.lamp.look !== 'dark';
}

/**
 * Practice → Ready to fire → Driver's lamp (F2.5): the gun laid on the
 * 100 m target and loaded. Alone, the player sits in the driver's seat,
 * the lamp lights at once, and a pretend gunner fires PRACTICE_FIRE_AFTER
 * seconds later so the flash can be seen; in a crew the seats stay, the
 * gunner's page lays and loads, and the lamp lights when the gunner takes
 * the power grip or the elevation handle.
 */
export function watchTheLamp(): void {
  active?.watch();
}

interface FiringLampDebug {
  /** What the lamp has to go on and how it looks now. */
  state(): ReadyInputs & { ready: boolean; look: LampLook; flashes: number; practiceFire: boolean };
  /** Practice → Ready to fire → Driver's lamp. */
  watch(): void;
  /** A scripted right hand on the power grip (true) or back to the real hand (false), on this page: the tests' gunner's hand. */
  holdGrip(on: boolean): void;
  /** Each lens's front middle, hull space (the repeater's with the turret as drawn), and which way it faces: for the test's camera. */
  at(): { driver: number[]; gunner: number[]; facing: { driver: number[]; gunner: number[] } };
}

/**
 * The firing lamp (F2.5, docs/firing-lamp.md): a lamp on the top bar of
 * the driver's vision slit, lit by itself while the gun is ready to fire (a
 * shell rammed, the breech closed, and the gunner's hand on the power grip
 * or the elevation handle), flashing at the shot; and its repeater on the
 * turret's front wall right of the gunsight, so the gunner sees what the
 * driver sees. No button: the gunner's signal buttons were cut.
 *
 * Nothing new goes over the network: each page decides from what it
 * already has. The loading as drawn (PacketType 8 on the driver's page),
 * the gunner's hands (their own `handUse` on the gunner's page, the hold
 * kinds in the pose packets on the other), and every shot (FiringSystem's
 * `shotListeners`). The driver's page sees it as the gunner's page did,
 * a packet or two later. The bezels are part of the hull's and turret's
 * meshes; the two lenses share one unlit material. Runs after
 * FiringSystem.
 */
export class FiringLampSystem extends createSystem({}) {
  readonly lamp = new FiringLamp();
  private material!: MeshBasicMaterial;
  private inputs: ReadyInputs = { loaded: false, handOnTrigger: false, practice: false };
  private ready = false;
  private shownLook: LampLook | null = null;
  /** Practice loads seen: a new one made alone counts as the gunner's hand (`inputs.practice`) while the gun stays loaded. */
  private practiceSeen = 0;
  /** Practice → Driver's lamp alone: the pretend gunner fires once the lamp has been lit `litFor` PRACTICE_FIRE_AFTER s. */
  private practiceFire = false;
  private litFor = 0;
  private wasLoaded = false;
  private testGrip = false;
  private v = new Vector3();
  private q: Vec3 = [0, 0, 0];
  private across: Vec3 = [0, 0, 0];

  init(): void {
    active = this;
    this.material = new MeshBasicMaterial({ color: AMBER, toneMapped: false });
    this.material.color.multiplyScalar(LAMP_DARK);
    const lamp = createLampLens(FIRING_LAMP, this.material, 'Firing Lamp');
    this.world.createTransformEntity(lamp);
    const turret: Entity | null = this.world.getSceneEntity('turret') ?? null;
    const repeater = createLampLens(LAMP_REPEATER, this.material, 'Firing Lamp Repeater');
    if (turret) this.world.createTransformEntity(repeater, { parent: turret });
    else console.warn('[FiringLamp] no turret in the scene for the repeater');
    const onShot = () => this.lamp.fired();
    shotListeners.add(onShot);
    this.practiceSeen = practiceLoads();
    this.cleanupFuncs.push(
      () => shotListeners.delete(onShot),
      () => {
        lamp.geometry.dispose();
        repeater.geometry.dispose();
        this.material.dispose();
        if (this.testGrip) scriptedHands.right = null;
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __firingLamp: FiringLampDebug }).__firingLamp = {
      state: () => ({ ...self.inputs, ready: self.ready, look: self.lamp.look, flashes: self.lamp.flashes, practiceFire: self.practiceFire }),
      watch: () => self.watch(),
      holdGrip: (on) => {
        self.testGrip = on;
        if (!on) scriptedHands.right = null;
      },
      at: () => {
        const yaw = turretState().yaw;
        const gunner = seatToHull(SEATS.gunner, yaw, [LAMP_REPEATER.x, LAMP_REPEATER.y, lensFront(LAMP_REPEATER)], [0, 0, 0]);
        return {
          driver: [FIRING_LAMP.x, FIRING_LAMP.y, lensFront(FIRING_LAMP)],
          gunner,
          facing: { driver: [0, 0, 1], gunner: [Math.sin(yaw), 0, Math.cos(yaw)] },
        };
      },
    };
  }

  watch(): void {
    const alone = !netLink.connected;
    readyToFire(0, 'driver');
    this.practiceFire = alone;
    this.litFor = 0;
    sayAboutTheGun(
      'Gun ready',
      alone ? ['The lamp over the slit is lit: hold steady', `It flashes at the shot, in ${PRACTICE_FIRE_AFTER} s`] : ["The gunner's page lays and loads", 'The lamp lights as they take the grip'],
    );
    console.info(`[FiringLamp] Practice: watch the lamp${alone ? ', firing by itself' : ''}`);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    if (this.testGrip) this.gripForTest();
    const loading = loadingShown();
    const i = this.inputs;
    i.loaded = loading?.loaded ?? false;
    i.handOnTrigger = this.gunnerHandOnTrigger();
    // A load made by Practice → Ready to fire alone counts as the gunner's hand until the gun is no longer loaded.
    const practice = practiceLoads();
    if (practice !== this.practiceSeen) {
      this.practiceSeen = practice;
      i.practice = !netLink.connected;
    }
    // (The load shows in the loading's drawn state a frame after Ready to fire makes it, so it ends when a loaded gun stops being so.)
    if ((this.wasLoaded && !i.loaded) || netLink.connected) i.practice = false;
    this.wasLoaded = i.loaded;
    this.ready = gunReady(i);

    const look = this.lamp.step(dt, this.ready);
    if (look !== this.shownLook) {
      this.shownLook = look;
      if (look === 'flash') this.material.color.setHex(FLASH_COLOR);
      else this.material.color.setHex(AMBER).multiplyScalar(look === 'lit' ? 1 : LAMP_DARK);
    }

    // Practice → Driver's lamp alone: the pretend gunner fires once the lamp has been lit a while.
    if (this.practiceFire) {
      if (netLink.connected) this.practiceFire = false;
      else if (this.ready) {
        this.litFor += dt;
        if (this.litFor >= PRACTICE_FIRE_AFTER) {
          this.practiceFire = false;
          pullTrigger();
          console.info('[FiringLamp] Practice: the pretend gunner fires');
        }
      }
    }
  }

  /** Whether a gunner's hand is on a control with a trigger: this page's own on the gunner's page (or alone), else the crewmate's hold kinds. */
  private gunnerHandOnTrigger(): boolean {
    if (ownsTurret()) return TRIGGER_KINDS.has(holdKindOf(handUse.left)) || TRIGGER_KINDS.has(holdKindOf(handUse.right));
    if (!netLink.haveRemote || seating.crew !== 'gunner') return false;
    const holds = netLink.remote.holds;
    return TRIGGER_KINDS.has(holds & 15) || TRIGGER_KINDS.has(holds >> 4);
  }

  /** The tests' gunner's hand: a scripted right fist on the power grip, squeezed, following the turret. */
  private gripForTest(): void {
    const control = findControl(POWER_GRIP);
    if (control == null) return;
    const local = control.mech.handle(1, this.q);
    control.frame.updateWorldMatrix(true, false);
    this.v.set(local[0], local[1], local[2]).applyMatrix4(control.frame.matrixWorld);
    const hand = scriptedHands.right ?? { fist: [0, 0, 0], across: [0, 0, 0], squeeze: true, trigger: 0 };
    hand.fist[0] = this.v.x;
    hand.fist[1] = this.v.y;
    hand.fist[2] = this.v.z;
    twistAcross(0, this.across);
    this.v.set(this.across[0], this.across[1], this.across[2]).transformDirection(control.frame.matrixWorld);
    hand.across[0] = this.v.x;
    hand.across[1] = this.v.y;
    hand.across[2] = this.v.z;
    hand.squeeze = true;
    scriptedHands.right = hand;
  }
}
