import { Quaternion, Vector3 } from '@iwsdk/core';
import { FIST_AXIS, FIST_CENTRE } from '../scene-assets/hand.scene-asset.js';
import type { FingerCurls } from '../sim/hand-pose.js';

/**
 * Grip locking (see docs/hands.md): while a hand holds a handle (a crank, a
 * rope, a lever, a wheel: whatever your game adds), its glove is drawn closed on the handle rather
 * than at the controller, with the handle through the middle of the fist,
 * turned only as far as that takes, so it keeps the twist of the player's
 * real hand. It eases between the two over 80 ms on taking hold and letting
 * go. (No arms are drawn, so nothing else decides its angle.)
 *
 * The systems that own the controls say where each one is held by
 * registering a resolver for its kind; OwnHandsSystem locks this player's
 * hands and NetSystem the crewmate's, from which control each hand holds.
 */

/**
 * What a hand holds, as sent to the crewmate (four bits per hand, so up to
 * fifteen kinds). Add one per handle your game has, register a resolver for
 * it in the system that owns the handle, and map the system's `handUse` name
 * to it in `holdKindOf` (net-system.ts). Something drawn in the hand (a
 * block, a tool) needs a kind only if the crewmate must see that it is held.
 */
export const HoldKind = {
  None: 0,
  /** A block (ThrowablesSystem): drawn in the hand, so the hand isn't locked. */
  Block: 1,
  /** The driver's controls (DriverStationSystem, F1.5): each tiller, the gear lever and the hand throttle. */
  TillerLeft: 2,
  TillerRight: 3,
  GearLever: 4,
  HandThrottle: 5,
  /** The breech lever's handle (LoadingDrillSystem, spike S4). 6–9 are kept for Phase 1's wheels, periscope and shell. */
  BreechLever: 10,
  /** The gunner's manual traverse crank and elevation handwheel (TurretSystem, F1.8). */
  TraverseCrank: 6,
  ElevationWheel: 7,
  /** The gunner's power traverse grip (TurretSystem, F1.8). */
  PowerTraverse: 12,
  /**
   * A mechanism-kit control only this page has (MechanismSystem): spike S3's
   * test tillers and the kit's test bench, placed where this player stands.
   * Never sent (LOCAL_HOLD_KINDS); resolved by which hand holds which control.
   */
  LocalControl: 11,
} as const;

/**
 * Kinds held on controls only this page has (a test rig placed where this
 * player stands), which the crewmate's page would lock their hand onto in
 * the wrong place: sent as None.
 */
export const LOCAL_HOLD_KINDS: ReadonlySet<number> = new Set([HoldKind.LocalControl]);

/**
 * The HoldKind of each mechanism-kit control by its `handUse` name, kept by
 * MechanismSystem as controls are added, so `holdKindOf` (net-system.ts)
 * knows them without a case each.
 */
export const controlHoldKinds = new Map<string, number>();

/**
 * Where a hand at `hand` (scene space) holding a control grips it: the point
 * on the handle's centre line its palm closes round, and which way the
 * handle runs (unit, either sign). `side` is which hand it is, and `own`
 * whether it is this player's (false: the crewmate's), for controls that
 * remember where each of this player's hands took hold.
 */
export type LockResolver = (hand: Vector3, point: Vector3, axis: Vector3, side: 'left' | 'right', own: boolean) => void;

/** Resolvers by `HoldKind`, registered by the systems that own the controls. */
export const lockResolvers = new Map<number, LockResolver>();

/** Taking hold or letting go eases the drawn hand over this long, s. */
export const LOCK_EASE = 0.08;
/** A hand further than this from what it holds lets go, so the drawn hand never stretches far from the real one, m. */
export const LOCK_SLIP = 0.25;
/** The pose a hand takes on a handle. */
const CLOSED: FingerCurls = { index: 0.9, grip: 1, thumb: 1 };

/** One hand's locking state: where it was last held, and how far it is eased onto it. */
export class LockedHand {
  /** 0 at the controller, 1 on the handle. */
  blend = 0;
  /** The real hand's distance from the handle it holds this frame, m (0 when it holds nothing lockable). */
  strain = 0;
  /** The fist's hole axis and centre in this hand's grip space. */
  private readonly fistAxis: Vector3;
  private readonly centre: Vector3;
  private point = new Vector3();
  private axis = new Vector3(0, 0, -1);
  private kind: number = HoldKind.None;
  private handAxis = new Vector3();
  private fist = new Vector3();
  private turn = new Quaternion();
  private lockQuat = new Quaternion();
  private lockPos = new Vector3();
  private holding = false;
  private sign = 1;

  /** `own`: this player's hand (false: the crewmate's, drawn by NetSystem). */
  constructor(readonly side: 'left' | 'right' = 'right', readonly own = true) {
    const m = side === 'left' ? -1 : 1;
    this.fistAxis = new Vector3(FIST_AXIS[0] * m, FIST_AXIS[1], FIST_AXIS[2]).normalize();
    this.centre = new Vector3(FIST_CENTRE[0] * m, FIST_CENTRE[1], FIST_CENTRE[2]);
  }

  /**
   * Work out the drawn pose for a hand at `pos`/`quat` (its grip pose) that
   * holds `kind`, into `outPos`/`outQuat` (which may be `pos`/`quat`), and
   * close `curls` round the handle as far as it is eased on. The hand is
   * turned only as far as it takes to lie along the handle. No allocation.
   */
  update(
    dt: number,
    kind: number,
    pos: Vector3,
    quat: Quaternion,
    outPos: Vector3,
    outQuat: Quaternion,
    curls: FingerCurls | null,
  ): void {
    const resolver = kind === HoldKind.None ? undefined : lockResolvers.get(kind);
    this.handAxis.copy(this.fistAxis).applyQuaternion(quat);
    this.fist.copy(this.centre).applyQuaternion(quat).add(pos);
    if (resolver) {
      resolver(this.fist, this.point, this.axis, this.side, this.own);
      // Grip it the way round the hand faces as it takes hold, and keep to that.
      if (!this.holding || kind !== this.kind) {
        this.sign = this.handAxis.dot(this.axis) < 0 ? -1 : 1;
      }
      if (this.sign < 0) {
        this.axis.negate();
      }
      this.holding = true;
      this.kind = kind;
      this.strain = this.fist.distanceTo(this.point);
      this.blend = Math.min(1, this.blend + dt / LOCK_EASE);
    } else {
      this.holding = false;
      this.strain = 0;
      this.blend = Math.max(0, this.blend - dt / LOCK_EASE);
    }
    if (this.blend <= 0) {
      if (outPos !== pos) outPos.copy(pos);
      if (outQuat !== quat) outQuat.copy(quat);
      return;
    }
    // Letting go: ease back from the handle where it was last held.
    this.turn.setFromUnitVectors(this.handAxis, this.axis);
    this.lockQuat.multiplyQuaternions(this.turn, quat);
    // The middle of the fist on the handle.
    this.lockPos.copy(this.centre).applyQuaternion(this.lockQuat);
    this.lockPos.subVectors(this.point, this.lockPos);
    const b = this.blend;
    const t = b * b * (3 - 2 * b);
    outPos.lerpVectors(pos, this.lockPos, t);
    outQuat.slerpQuaternions(quat, this.lockQuat, t);
    if (curls) {
      curls.index += (Math.max(curls.index, CLOSED.index) - curls.index) * t;
      curls.grip += (CLOSED.grip - curls.grip) * t;
      curls.thumb += (Math.max(curls.thumb, CLOSED.thumb) - curls.thumb) * t;
    }
  }
}
