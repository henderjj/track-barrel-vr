import { createSystem, Matrix4, type Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { FIST_AXIS, FIST_CENTRE, INDEX_TIP } from '../scene-assets/hand.scene-asset.js';
import { type HandIndex, type HandInput, MechEvent, type Mechanism, type Vec3 } from '../sim/mechanism.js';
import { fingerInputs, grip, handCurls, handUse } from './grip-system.js';
import { controlHoldKinds, HoldKind, type LockResolver, lockResolvers } from './hand-lock.js';
import { buzz } from './haptics.js';

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];
const DEG = Math.PI / 180;

/**
 * One control built from the kit, as its owner (a station's system, the
 * test bench) hands it to MechanismSystem with `addControl`.
 */
export interface Control {
  /** What `handUse` says while a hand holds it, and its name in `window.__mechanisms`. */
  readonly name: string;
  readonly mech: Mechanism;
  /** The object whose own space is the mechanism's space: it doesn't move with the mechanism, only with what it is mounted on. */
  readonly frame: Object3D;
  /** Its HoldKind, so both players see a hand on it closed round its handle (None: not drawn on it, as for a button). */
  readonly kind: number;
  /** Whether it can be used now (say, its rig is shown). A control that stops being usable lets go. */
  active(): boolean;
  /** Called each frame it is usable, once it has moved, with what happened (MechEvent bits): draw it here. */
  moved?(events: number): void;
}

interface Entry {
  control: Control;
  /** Time since each holding hand's last strain buzz, s. */
  strainClock: [number, number];
  /** How many limits, detents and presses it has felt, for the test hook. */
  counts: { limits: number; detents: number; presses: number };
}

const entries: Entry[] = [];

/**
 * Hand a control to the kit: from now on a squeeze near it takes hold of
 * it, it follows the hand and buzzes, and hands on it are drawn closed on
 * its handle (this player's and, for a kind that is sent, the crewmate's).
 * Returns the function that takes it away again; call it in the owner's
 * cleanup.
 */
export function addControl(control: Control): () => void {
  const entry: Entry = { control, strainClock: [0, 0], counts: { limits: 0, detents: 0, presses: 0 } };
  entries.push(entry);
  controlHoldKinds.set(control.name, control.kind);
  if (control.kind !== HoldKind.None && !lockResolvers.has(control.kind)) {
    lockResolvers.set(control.kind, resolverFor(control.kind));
  }
  return () => {
    letGo(control);
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
    controlHoldKinds.delete(control.name);
    if (control.kind !== HoldKind.None && !entries.some((e) => e.control.kind === control.kind)) {
      lockResolvers.delete(control.kind);
    }
  };
}

/** Make every hand on `control` let go of it (when its owner puts it away). */
export function letGo(control: Control): void {
  for (let i = 0; i < 2; i++) {
    const side = SIDES[i];
    if (control.mech.held[i]) control.mech.release(i as HandIndex);
    if (handUse[side] === control.name) handUse[side] = null;
  }
}

// Scratch for the resolvers and the hands, made once.
const toLocal = new Matrix4();
const scratch = new Vector3();
const lockFist: Vec3 = [0, 0, 0];
const lockPoint: Vec3 = [0, 0, 0];
const lockAxis: Vec3 = [0, 0, 0];

/** Into `out` as [x, y, z]: a scene-space point in `frame`'s own space. */
function pointIn(frame: Object3D, p: Vector3, out: Vec3): Vec3 {
  frame.updateWorldMatrix(true, false);
  toLocal.copy(frame.matrixWorld).invert();
  scratch.copy(p).applyMatrix4(toLocal);
  out[0] = scratch.x;
  out[1] = scratch.y;
  out[2] = scratch.z;
  return out;
}

/**
 * Grip locking for every control of a kind: a hand of this player's goes on
 * the control it holds, where it took hold; the crewmate's on the nearest
 * usable control of that kind (in practice there is one).
 */
function resolverFor(kind: number): LockResolver {
  return (hand, point, axis, side, own) => {
    const i: HandIndex = side === 'left' ? 0 : 1;
    let best: Entry | null = null;
    let bestDistance = Infinity;
    for (const entry of entries) {
      const { control } = entry;
      if (control.kind !== kind || !control.active()) continue;
      pointIn(control.frame, hand, lockFist);
      if (own && control.mech.held[i]) {
        best = entry;
        break;
      }
      control.mech.lock(-1, lockFist, lockPoint, lockAxis);
      const d = Math.hypot(lockFist[0] - lockPoint[0], lockFist[1] - lockPoint[1], lockFist[2] - lockPoint[2]);
      if (d < bestDistance) {
        bestDistance = d;
        best = entry;
      }
    }
    if (!best) {
      point.copy(hand);
      axis.set(0, 1, 0);
      return;
    }
    const { frame, mech } = best.control;
    pointIn(frame, hand, lockFist);
    mech.lock(own && mech.held[i] ? i : -1, lockFist, lockPoint, lockAxis);
    point.set(lockPoint[0], lockPoint[1], lockPoint[2]).applyMatrix4(frame.matrixWorld);
    axis.set(lockAxis[0], lockAxis[1], lockAxis[2]).transformDirection(frame.matrixWorld);
  };
}

/** A tip counts for pressing buttons while the index finger is curled less than this. */
const POINTING = 0.6;
/** While a hand pushes past where its control can go, a light buzz this often, s, stronger the further past. */
const STRAIN_BUZZ_EVERY = 0.1;

interface MechanismsDebug {
  names(): string[];
  /** A control's state: who holds it, and its mechanism's readings (angles in degrees). */
  state(name: string): Record<string, unknown> | null;
  /** A point to take hold of it at, scene space (`which` 0 the left handle, 1 the right, where it has two). */
  handle(name: string, which?: number): number[] | null;
  /** How far a scene-space point is from where a hand there would be drawn on it, m. */
  gap(name: string, point: number[]): number;
  /** A point in a control's own space, in scene space. */
  toScene(name: string, point: number[]): number[] | null;
  /** What each hand holds (`handUse`). */
  holding(): Record<Side, string | null>;
}

/**
 * The mechanism kit (F1.3, docs/mechanisms.md): drives every control built
 * from src/sim/mechanism.ts. Each frame it lets go of controls whose grip
 * was let go (or that were put away), takes hold of the control nearest a
 * fist that squeezes within reach of one, moves each control with the
 * hands on it, buzzes at limits, detents and presses (and a light strain
 * buzz while a hand pushes on past a limit), and tells each owner to draw
 * its control. Works with controllers and tracked hands (a fist or a
 * pinch, GripSystem).
 *
 * Runs after GripSystem (grip state) and before the systems that read the
 * controls and OwnHandsSystem, which draws hands on them (grip locking,
 * through the resolvers registered here).
 */
export class MechanismSystem extends createSystem({}) {
  private fist = { left: new Vector3(), right: new Vector3() };
  private across = { left: new Vector3(), right: new Vector3() };
  private tip = { left: new Vector3(), right: new Vector3() };
  private present = { left: false, right: false };
  private pointing = { left: false, right: false };
  private gripPos = new Vector3();
  private tmpQuat = new Quaternion();
  private centre = { left: new Vector3(), right: new Vector3() };
  private acrossGrip = { left: new Vector3(), right: new Vector3() };
  private tipGrip = { left: new Vector3(), right: new Vector3() };
  private inputs: [HandInput, HandInput] = [newInput(), newInput()];
  private tips: [Vec3, Vec3] = [[0, 0, 0], [0, 0, 0]];
  private given: (HandInput | null)[] = [null, null];
  private tmp = new Vector3();

  init(): void {
    // Across the fist: the grip space's +X (out of the back of a right hand), made square to the fist's hole.
    const axis = new Vector3(...FIST_AXIS).normalize();
    const across = new Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
    for (const side of SIDES) {
      const m = side === 'left' ? -1 : 1;
      this.centre[side].set(FIST_CENTRE[0] * m, FIST_CENTRE[1], FIST_CENTRE[2]);
      this.acrossGrip[side].set(across.x * m, across.y, across.z);
      this.tipGrip[side].set(INDEX_TIP[0] * m, INDEX_TIP[1], INDEX_TIP[2]);
    }
    const findEntry = (name: string) => entries.find((e) => e.control.name === name);
    const find = (name: string) => findEntry(name)?.control;
    const debug: MechanismsDebug = {
      names: () => entries.map((e) => e.control.name),
      state: (name) => {
        const entry = findEntry(name);
        return entry ? { ...describe(entry.control), ...entry.counts } : null;
      },
      handle: (name, which = 1) => {
        const control = find(name);
        if (!control) return null;
        const p = control.mech.handle(which === 0 ? 0 : 1, [0, 0, 0]);
        control.frame.updateWorldMatrix(true, false);
        return new Vector3(p[0], p[1], p[2]).applyMatrix4(control.frame.matrixWorld).toArray();
      },
      gap: (name, point) => {
        const control = find(name);
        if (!control) return Infinity;
        const fist = pointIn(control.frame, new Vector3(point[0], point[1], point[2]), [0, 0, 0]);
        const at: Vec3 = [0, 0, 0];
        control.mech.lock(-1, fist, at, [0, 0, 0]);
        return Math.hypot(fist[0] - at[0], fist[1] - at[1], fist[2] - at[2]);
      },
      holding: () => ({ ...handUse }),
      toScene: (name, point) => {
        const control = find(name);
        if (!control) return null;
        control.frame.updateWorldMatrix(true, false);
        return new Vector3(point[0], point[1], point[2]).applyMatrix4(control.frame.matrixWorld).toArray();
      },
    };
    (window as unknown as { __mechanisms: MechanismsDebug }).__mechanisms = debug;
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    for (const side of SIDES) {
      this.readHand(side);
    }
    // Let go of whatever a hand stopped gripping, or was put away.
    for (const entry of entries) {
      const { control } = entry;
      const active = control.active();
      for (let i = 0; i < 2; i++) {
        if (!control.mech.held[i]) continue;
        const side = SIDES[i];
        if (!active || !grip[side].pressed || !this.present[side] || handUse[side] !== control.name) {
          control.mech.release(i as HandIndex);
          if (handUse[side] === control.name) handUse[side] = null;
        }
      }
    }
    // Take hold of the nearest control in reach of a fresh squeeze.
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      if (!this.present[side] || !grip[side].down || handUse[side]) continue;
      let best: Control | null = null;
      let bestDistance = Infinity;
      for (const { control } of entries) {
        if (!control.active()) continue;
        const input = this.localHand(control, i as HandIndex);
        const d = control.mech.reach(i as HandIndex, input);
        if (d < control.mech.reachRadius && d < bestDistance) {
          best = control;
          bestDistance = d;
        }
      }
      if (best && best.mech.grab(i as HandIndex, this.localHand(best, i as HandIndex))) {
        handUse[side] = best.name;
        this.pulse(side, 0.4, 20);
      }
    }
    // Move each control with its hands, and feel it.
    for (const entry of entries) {
      const { control } = entry;
      if (!control.active()) continue;
      const mech = control.mech;
      this.given[0] = this.present.left ? this.localHand(control, 0) : null;
      this.given[1] = this.present.right ? this.localHand(control, 1) : null;
      const events = mech.update(dt, this.given);
      if (events & MechEvent.Limit) entry.counts.limits++;
      if (events & MechEvent.Detent) entry.counts.detents++;
      if (events & MechEvent.Press) entry.counts.presses++;
      for (let i = 0; i < 2; i++) {
        const side = SIDES[i];
        if (!mech.held[i]) {
          entry.strainClock[i] = 0;
          continue;
        }
        if (events & MechEvent.Limit) {
          this.pulse(side, 0.8, 35);
        } else if (events & MechEvent.Detent) {
          this.pulse(side, 0.3, 15);
        }
        if (events & MechEvent.Press) {
          this.pulse(side, 0.5, 20);
        }
        // Pushing on past where it can go: a light buzz, stronger the further the hand goes.
        const strain = mech.strain[i];
        entry.strainClock[i] += dt;
        if (strain > 2 * DEG && entry.strainClock[i] >= STRAIN_BUZZ_EVERY) {
          entry.strainClock[i] = 0;
          this.pulse(side, Math.min(0.6, 0.15 + strain / (20 * DEG)), 40);
        }
      }
      // A button pressed by a fingertip buzzes that hand.
      if (events & MechEvent.Press && !mech.anyHeld) {
        const by = (mech as Mechanism & { pressedBy?: number }).pressedBy;
        if (by === 0 || by === 1) this.pulse(SIDES[by], 0.5, 20);
      }
      control.moved?.(events);
    }
  }

  /** This frame's fist centre, across-the-fist direction and fingertip of `side`, scene space. */
  private readHand(side: Side): void {
    this.present[side] = this.input.xr.getPrimaryInputSource(side) !== undefined;
    if (!this.present[side]) return;
    const space = this.player.gripSpaces[side];
    space.updateWorldMatrix(true, false);
    space.getWorldPosition(this.gripPos);
    space.getWorldQuaternion(this.tmpQuat);
    this.fist[side].copy(this.centre[side]).applyQuaternion(this.tmpQuat).add(this.gripPos);
    this.across[side].copy(this.acrossGrip[side]).applyQuaternion(this.tmpQuat);
    this.tip[side].copy(this.tipGrip[side]).applyQuaternion(this.tmpQuat).add(this.gripPos);
    // A hand holding something, or with its finger curled, doesn't press buttons.
    this.pointing[side] = handUse[side] === null && handCurls[side].index < POINTING;
  }

  /** Hand `i` in `control`'s space, in a reused input. */
  private localHand(control: Control, i: HandIndex): HandInput {
    const side = SIDES[i];
    const input = this.inputs[i];
    const frame = control.frame;
    frame.updateWorldMatrix(true, false);
    toLocal.copy(frame.matrixWorld).invert();
    this.tmp.copy(this.fist[side]).applyMatrix4(toLocal);
    input.fist[0] = this.tmp.x;
    input.fist[1] = this.tmp.y;
    input.fist[2] = this.tmp.z;
    this.tmp.copy(this.across[side]).transformDirection(toLocal);
    input.across[0] = this.tmp.x;
    input.across[1] = this.tmp.y;
    input.across[2] = this.tmp.z;
    if (this.pointing[side]) {
      this.tmp.copy(this.tip[side]).applyMatrix4(toLocal);
      const tip = this.tips[i];
      tip[0] = this.tmp.x;
      tip[1] = this.tmp.y;
      tip[2] = this.tmp.z;
      input.tip = tip;
    } else {
      input.tip = null;
    }
    input.trigger = grip[side].hand ? 0 : fingerInputs[side].trigger;
    input.tracked = grip[side].hand;
    return input;
  }

  private pulse(side: Side, intensity: number, ms: number): void {
    buzz(this.input.xr.gamepads[side]?.gamepad, side, intensity, ms);
  }
}

function newInput(): HandInput {
  return { fist: [0, 0, 0], across: [1, 0, 0], tip: null, trigger: 0, tracked: false };
}

/** A control's state for the test hook: who holds it, and its mechanism's readings, angles in degrees. */
function describe(control: Control): Record<string, unknown> {
  const mech = control.mech as Mechanism & Record<string, unknown>;
  const [l, r] = mech.held;
  const out: Record<string, unknown> = {
    heldBy: l && r ? 'both' : l ? 'left' : r ? 'right' : null,
    strain: [mech.strain[0] / DEG, mech.strain[1] / DEG],
  };
  for (const key of ['angle', 'overshoot']) {
    if (typeof mech[key] === 'number') out[key] = (mech[key] as number) / DEG;
  }
  for (const key of ['turns', 'depth', 'down', 'on', 'presses', 'firing']) {
    if (mech[key] !== undefined) out[key] = mech[key];
  }
  for (const key of ['demand', 'notch']) {
    if (typeof mech[key] === 'function') out[key] = (mech[key] as () => number).call(mech);
  }
  return out;
}
