import { createSystem, Group, type Object3D } from '@iwsdk/core';
import { DRIVER_SEAT_NAME } from '../scene-assets/convoy-seat.scene-asset.js';
import { createLever } from '../scene-assets/mechanism.scene-asset.js';
import { CONVOY_MOVE, SEAT_LEVER, seatLeverPivot, seatLeverPulled } from '../sim/convoy-seat.js';
import { Lever, type Vec3 } from '../sim/mechanism.js';
import { HoldKind } from './hand-lock.js';
import { addControl } from './mechanism-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';

/** The seat lever's `handUse` name. */
export const SEAT_LEVER_NAME = 'driver-seat-lever';
/** How often the driver's page repeats where its seat is, while in a crew, s: a crewmate who joins late or missed one still sees it. */
const RESEND_SECONDS = 2;

/**
 * Whether the driver's seat stands in the convoy position on this page:
 * this player's own seat as it now stands, or the crewmate driver's as their
 * page last said.
 */
export function convoyUp(): boolean {
  if (seating.mine === 'driver') return seating.convoyShown;
  return netLink.connected && seating.crew === 'driver' && seating.crewConvoy;
}

/**
 * Raise or lower the driver's seat (Practice → Drive the tank → Head out):
 * alone, into the driver's seat first. In a crew it works only from the
 * driver's seat. Returns whether the seat will be up.
 */
export function headOut(up = !seating.convoy): boolean {
  if (!netLink.connected && seating.mine !== 'driver') seating.ask('driver');
  if (seating.mine !== 'driver') return false;
  seating.convoy = up;
  return up;
}

interface ConvoyDebug {
  /** The seat as wanted and as it stands, the crewmate's, and the seat lever. */
  state(): { wanted: boolean; shown: boolean; crew: boolean; up: boolean; lever: number; held: boolean; sent: number; received: number };
  /** Practice → Head out: raise (true), lower (false) or swap. */
  headOut(up?: boolean): boolean;
  /** The seat lever's grip middle, hull space, for the tests' hands. */
  lever(): number[];
}

/**
 * The driver's convoy position (docs/convoy-seat.md): the seat raised so the
 * driver drives with their head out of the open hatch. This system owns the
 * wish and shares it; SeatSystem moves the seat (through a fade), and the
 * driver's station, the periscope and the cabin's lids follow `convoyUp()`.
 *
 * - The seat lever, right of the cushion, rides with the seat: a kit lever
 *   (only this page has it: HoldKind.LocalControl); each pull back past its
 *   tick moves the seat once.
 * - The driver's page sends `convoy` {up} when its seat moves, and every
 *   `RESEND_SECONDS` while in a crew, so the gunner's page draws the driver
 *   raised, their lid open beside the hole and their periscope down.
 */
export class ConvoySeatSystem extends createSystem({}) {
  private lever = new Lever(SEAT_LEVER);
  private mount = new Group();
  private latch = { pulled: false };
  private pivot: Vec3 = [0, 0, 0];
  private lastSent: boolean | null = null;
  private sinceSent = 0;
  private sent = 0;
  private received = 0;
  /** The driver's seat's moving part in the hull's mesh. */
  private seat: Object3D | null = null;

  init(): void {
    this.seat = this.world.getSceneEntity('hull')?.object3D?.getObjectByName(DRIVER_SEAT_NAME) ?? null;
    if (!this.seat) console.warn("[Convoy] no driver's seat in the hull: it won't be drawn rising");
    this.mount.name = 'Seat Lever';
    this.mount.add(createLever(SEAT_LEVER));
    this.world.createTransformEntity(this.mount);
    this.placeLever();
    this.cleanupFuncs.push(
      addControl({
        name: SEAT_LEVER_NAME,
        mech: this.lever,
        frame: this.mount,
        kind: HoldKind.LocalControl,
        active: () => seating.mine === 'driver' && !seating.away,
      }),
    );
    netLink.events.set('convoy', (e) => {
      this.received++;
      seating.crewConvoy = (e as { up?: unknown }).up === true;
    });
    this.cleanupFuncs.push(() => {
      netLink.events.delete('convoy');
      this.mount.removeFromParent();
    });
    const self = this;
    const debug: ConvoyDebug = {
      state: () => ({
        wanted: seating.convoy,
        shown: seating.convoyShown,
        crew: seating.crewConvoy,
        up: convoyUp(),
        lever: self.lever.angle,
        held: self.lever.anyHeld,
        sent: self.sent,
        received: self.received,
      }),
      headOut: (up) => headOut(up),
      lever: () => {
        const p = self.lever.handle(0, [0, 0, 0]);
        return [self.pivot[0] + p[0], self.pivot[1] + p[1], self.pivot[2] + p[2]];
      },
    };
    (window as unknown as { __convoy: ConvoyDebug }).__convoy = debug;
  }

  update(delta: number): void {
    if (seatLeverPulled(this.latch, this.lever.angle) && seating.mine === 'driver') {
      seating.convoy = !seating.convoy;
    }
    this.placeLever();
    if (!netLink.connected) {
      seating.crewConvoy = false;
      this.lastSent = null;
      return;
    }
    if (seating.crew !== 'driver') seating.crewConvoy = false;
    if (seating.mine !== 'driver') {
      this.lastSent = null;
      return;
    }
    this.sinceSent += delta;
    const up = seating.convoyShown;
    if (up !== this.lastSent || this.sinceSent >= RESEND_SECONDS) {
      netLink.sendEvent({ t: 'convoy', up } as { t: string });
      this.lastSent = up;
      this.sinceSent = 0;
      this.sent++;
    }
  }

  /** The seat and its lever as they stand on this page (the driver's own, or the crewmate driver's). */
  private placeLever(): void {
    const up = convoyUp();
    if (this.seat) this.seat.position.set(up ? CONVOY_MOVE[0] : 0, up ? CONVOY_MOVE[1] : 0, up ? CONVOY_MOVE[2] : 0);
    seatLeverPivot(up, this.pivot);
    this.mount.position.set(this.pivot[0], this.pivot[1], this.pivot[2]);
  }
}
