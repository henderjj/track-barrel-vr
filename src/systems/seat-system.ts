import { createSystem, Euler, Quaternion, Vector3 } from '@iwsdk/core';
import {
  headFix,
  type HeadFix,
  parseSeat,
  placeInSeat,
  type RigPlace,
  type SeatId,
  SEATS,
  seatingWith,
  seatToHull,
} from '../sim/cabin.js';
import { body } from './body-height-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';

interface SeatDebug {
  readonly mine: SeatId;
  readonly crew: SeatId;
  ask(seat: SeatId): void;
  reseat(): void;
  /** A seat's eye point, hull space. */
  eye(seat: SeatId): number[];
  /** This player's head, hull space. */
  head(): number[];
  /** How often the head was stopped at its box's edge, and the player put back in the seat. */
  readonly fixes: { push: number; reseat: number };
}

/**
 * Sits each player in their seat (src/sim/cabin.ts, docs/cabin.md). There
 * is no walking: the play space is placed so the player's eyes are over
 * their seat's eye point, facing the seat's way, when VR starts, when they
 * change seats, and from the menu (Back in my seat). Its floor goes at the
 * seat's floor, with the body-height system's offset on top.
 *
 * After that the player moves their head freely within the seat's head
 * box. Leaning past its edge stops the head there, as the walls, the
 * breech and the controls would, by moving the play space back: the head
 * is limited, not the play space's origin, so a lean or a step in the room
 * can't put a head through the armour. A head far outside the box (the
 * headset recentred, or the player stood up and walked) puts the player
 * back in the seat.
 *
 * Seats are shared: the host decides who sits where (`seats` event), a
 * guest asks (`seat-ask`). Alone, the player sits where they like. The
 * crewmate's seat decides where NetSystem draws their legs.
 */
export class SeatSystem extends createSystem({}) {
  private inVr = false;
  private needsPlace = true;
  private wasConnected = false;
  private head = new Vector3();
  private headQuat = new Quaternion();
  private euler = new Euler(0, 0, 0, 'YXZ');
  private headHull: [number, number, number] = [0, 0, 0];
  private fix: [number, number] = [0, 0];
  private place: RigPlace = { x: 0, z: 0, yaw: 0 };
  private fixes = { push: 0, reseat: 0 };
  private lastFix: HeadFix = 'inside';
  private wasAway = false;

  init(): void {
    seating.ask = (seat) => this.ask(seat);
    seating.reseat = () => {
      seating.away = false;
      this.needsPlace = true;
    };
    netLink.events.set('seats', (e) => {
      // The host's word on who sits where; a host never takes it from a guest.
      if (netLink.isHost) return;
      this.sit(parseSeat(e.guest, seating.mine), parseSeat(e.host, seating.crew));
    });
    netLink.events.set('seat-ask', (e) => {
      if (!netLink.isHost) return;
      const wanted = seatingWith('guest', parseSeat(e.seat, seating.crew));
      this.sit(wanted.host, wanted.guest);
      this.sendSeats();
    });
    this.cleanupFuncs.push(() => {
      netLink.events.delete('seats');
      netLink.events.delete('seat-ask');
    });
    const self = this;
    const debug: SeatDebug = {
      get mine() { return seating.mine; },
      get crew() { return seating.crew; },
      ask: (seat) => this.ask(seat),
      reseat: () => seating.reseat(),
      eye: (seat) => seatToHull(SEATS[seat], seating.turretYaw, SEATS[seat].eye, [0, 0, 0]),
      head: () => this.player.head.getWorldPosition(new Vector3()).toArray(),
      get fixes() { return self.fixes; },
    };
    (window as unknown as { __seats: SeatDebug }).__seats = debug;
  }

  update(): void {
    this.shareSeats();
    const player = this.player;
    const seat = SEATS[seating.mine];
    netLink.feet = seat.floorY;
    if (seating.away !== this.wasAway) {
      // Back from a spike's seat: sit down here afresh.
      this.wasAway = seating.away;
      this.needsPlace = true;
    }
    if (seating.away) {
      return;
    }
    if (!this.world.session) {
      if (this.inVr) {
        // Back on the flat page: the play space goes back where it started.
        this.inVr = false;
        player.position.set(0, 0, 0);
        player.rotation.set(0, 0, 0);
      }
      return;
    }
    if (!this.inVr) {
      this.inVr = true;
      this.needsPlace = true;
    }
    // On top of the body-height system's offset (it runs just before this).
    player.position.y = seat.floorY + body.offset;
    const local = player.head.position;
    if (local.x === 0 && local.y === 0 && local.z === 0) {
      return; // no head pose yet
    }
    if (!this.needsPlace) {
      player.head.getWorldPosition(this.head);
      this.headHull[0] = this.head.x;
      this.headHull[1] = this.head.y;
      this.headHull[2] = this.head.z;
      const fix = headFix(seat, seating.turretYaw, this.headHull, this.fix);
      if (fix === 'push') {
        player.position.x += this.fix[0];
        player.position.z += this.fix[1];
        if (this.lastFix !== 'push') this.fixes.push++;
      } else if (fix === 'reseat') {
        this.needsPlace = true;
        this.fixes.reseat++;
      }
      this.lastFix = fix;
    }
    if (this.needsPlace) {
      this.needsPlace = false;
      this.headQuat.copy(player.head.quaternion);
      this.euler.setFromQuaternion(this.headQuat, 'YXZ');
      placeInSeat(seat, seating.turretYaw, local.x, local.z, this.euler.y, this.place);
      player.rotation.set(0, this.place.yaw, 0);
      player.position.x = this.place.x;
      player.position.z = this.place.z;
      seating.placements++;
      console.info(`[Seat] in the ${seat.label.toLowerCase()}'s seat`);
    }
  }

  /** Ask for `seat`: alone, take it; as the host, take it and give the guest the other; as a guest, ask the host. */
  private ask(seat: SeatId): void {
    seating.away = false;
    this.needsPlace = true;
    if (!netLink.connected) {
      this.sit(seat, seating.crew === seat ? seating.mine : seating.crew);
      return;
    }
    if (netLink.isHost) {
      const wanted = seatingWith('host', seat);
      this.sit(wanted.host, wanted.guest);
      this.sendSeats();
    } else {
      const event = { t: 'seat-ask', seat };
      netLink.sendEvent(event);
    }
  }

  /** Sit this player in `mine` and the crewmate in `crew`. */
  private sit(mine: SeatId, crew: SeatId): void {
    seating.crew = crew;
    if (mine !== seating.mine) {
      seating.mine = mine;
      this.needsPlace = true;
    }
  }

  /** Host: tell the guest who sits where. */
  private sendSeats(): void {
    const event = { t: 'seats', host: seating.mine, guest: seating.crew };
    netLink.sendEvent(event);
  }

  /** A host tells a guest who has just joined where to sit: the host keeps their seat and the guest takes the other. */
  private shareSeats(): void {
    if (netLink.connected === this.wasConnected) {
      return;
    }
    this.wasConnected = netLink.connected;
    if (netLink.connected && netLink.isHost) {
      const wanted = seatingWith('host', seating.mine);
      this.sit(wanted.host, wanted.guest);
      this.sendSeats();
    }
  }
}
