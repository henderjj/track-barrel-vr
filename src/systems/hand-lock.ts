import { Quaternion, Vector3 } from '@iwsdk/core';
import { FIST_AXIS, FIST_CENTRE, indexTip } from '../scene-assets/hand.scene-asset.js';
import { type FingerCurls, INDEX_RESTING } from '../sim/hand-pose.js';

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
  /** The driver's parking brake lever (DriverStationSystem, F1.18). */
  ParkingBrake: 13,
  /** A shell in the hand (LoadingSystem, F1.10): drawn in the hand, so the hand isn't locked. */
  Shell: 9,
  /** The breech lever's handle (LoadingSystem, F1.10). */
  BreechLever: 10,
  /** The crank on the driver's periscope (PeriscopeSystem, F1.6; a two-handled yoke before F1.19). */
  Periscope: 8,
  /** The crank on the gunner's periscope (PeriscopeSystem, F1.19). */
  GunnerPeriscope: 14,
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
 * remember where each of this player's hands took hold. A handle with a
 * squeeze latch under the index finger (the parking brake's release) also
 * sets `latch` to the way the latch lies from the handle's centre line
 * (unit, square to `axis`; left zero for none, as it comes): the hand is
 * then drawn thumb along `axis`, turned so its index finger rests on the
 * latch, and that finger squeezes it with the trigger.
 */
export type LockResolver = (hand: Vector3, point: Vector3, axis: Vector3, side: 'left' | 'right', own: boolean, latch: Vector3) => void;

/** Resolvers by `HoldKind`, registered by the systems that own the controls. */
export const lockResolvers = new Map<number, LockResolver>();

/** Taking hold or letting go eases the drawn hand over this long, s. */
export const LOCK_EASE = 0.08;
/** A hand further than this from what it holds lets go, so the drawn hand never stretches far from the real one, m. */
export const LOCK_SLIP = 0.25;
/** The pose a hand takes on a handle. */
const CLOSED: FingerCurls = { index: 0.9, grip: 1, thumb: 1 };
/**
 * The index finger's curl on a latch: resting on it (the finger off the
 * trigger, or resting there), and squeezing it in (the trigger pulled).
 * Resting, the finger's last joint lies about 4 cm from the handle's centre
 * line, round a latch standing off the handle's front.
 */
export const LATCH_INDEX_REST = 0.64;
export const LATCH_INDEX_SQUEEZED = 0.8;
/** How far along the fist's hole from its middle the index finger lies, m (towards the thumb). */
export const LATCH_INDEX_ALONG = 0.03;

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
  /** The way a latch lies from the handle, as the resolver says (zero: none). */
  private latch = new Vector3();
  /** The way the index finger's last joint lies from the fist's hole when it rests on a latch, this hand's grip space (square to the hole). */
  private readonly indexWay: Vector3;
  private pad = new Vector3();
  private twist = new Quaternion();

  /** `own`: this player's hand (false: the crewmate's, drawn by NetSystem). */
  constructor(readonly side: 'left' | 'right' = 'right', readonly own = true) {
    const m = side === 'left' ? -1 : 1;
    this.fistAxis = new Vector3(FIST_AXIS[0] * m, FIST_AXIS[1], FIST_AXIS[2]).normalize();
    this.centre = new Vector3(FIST_CENTRE[0] * m, FIST_CENTRE[1], FIST_CENTRE[2]);
    this.indexWay = indexTip(LATCH_INDEX_REST, 1, side, new Vector3(), 0.011).sub(this.centre);
    this.indexWay.addScaledVector(this.fistAxis, -this.indexWay.dot(this.fistAxis)).normalize();
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
      this.latch.set(0, 0, 0);
      resolver(this.fist, this.point, this.axis, this.side, this.own, this.latch);
      // Grip it the way round the hand faces as it takes hold, and keep to that; a latch's handle thumb towards the latch.
      if (!this.holding || kind !== this.kind) {
        this.sign = this.latch.lengthSq() > 0 || this.handAxis.dot(this.axis) >= 0 ? 1 : -1;
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
    const latched = this.latch.lengthSq() > 0;
    if (latched) {
      // Turn the hand round the handle until its index finger lies on the latch.
      this.pad.copy(this.indexWay).applyQuaternion(this.lockQuat);
      this.pad.addScaledVector(this.axis, -this.pad.dot(this.axis));
      if (this.pad.lengthSq() > 1e-8) {
        this.pad.normalize();
        const cos = this.pad.dot(this.latch);
        const sin = this.pad.cross(this.latch).dot(this.axis);
        this.twist.setFromAxisAngle(this.axis, Math.atan2(sin, cos));
        this.lockQuat.premultiply(this.twist);
      }
    }
    // The middle of the fist on the handle.
    this.lockPos.copy(this.centre).applyQuaternion(this.lockQuat);
    this.lockPos.subVectors(this.point, this.lockPos);
    const b = this.blend;
    const t = b * b * (3 - 2 * b);
    outPos.lerpVectors(pos, this.lockPos, t);
    outQuat.slerpQuaternions(quat, this.lockQuat, t);
    if (curls) {
      // On a latch the index finger rests on it, squeezing it as the trigger is pulled (the curl from the trigger, 0.4 resting on it to 1 pulled).
      const pull = Math.min(1, Math.max(0, (curls.index - INDEX_RESTING) / (1 - INDEX_RESTING)));
      const index = latched ? LATCH_INDEX_REST + (LATCH_INDEX_SQUEEZED - LATCH_INDEX_REST) * pull : Math.max(curls.index, CLOSED.index);
      curls.index += (index - curls.index) * t;
      curls.grip += (CLOSED.grip - curls.grip) * t;
      curls.thumb += (Math.max(curls.thumb, CLOSED.thumb) - curls.thumb) * t;
    }
  }
}
