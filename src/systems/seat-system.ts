import { BackSide, createSystem, Euler, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from '@iwsdk/core';
import { saveSettings, settings } from '../settings.js';
import {
  HEAD_JUMP,
  headDrop,
  headFade,
  headFix,
  type HeadFix,
  otherSeat,
  parseSeat,
  placeInSeat,
  RESEAT_AFTER,
  type RigPlace,
  type SeatId,
  SEATS,
  seatingWith,
  seatToHull,
  type SwapAsks,
  swapAgreed,
  SWAP_WAIT_SECONDS,
} from '../sim/cabin.js';
import { body } from './body-height-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';

/** How long the sign about a swap of seats stays up, s. */
const SWAP_SIGN_SECONDS = 8;

interface SeatDebug {
  readonly mine: SeatId;
  readonly crew: SeatId;
  ask(seat: SeatId): void;
  reseat(): void;
  /** A seat's eye point, hull space. */
  eye(seat: SeatId): number[];
  /** This player's head, hull space. */
  head(): number[];
  /** How often the view faded with the head past its box's edge and over the roof stop, and the player was put back in the seat. */
  readonly fixes: { walls: number; roof: number; reseat: number };
  /** How dark the view is now, 0 to 1, from the head past its box or over the roof stop. */
  readonly fade: number;
  /** A swap waiting for a word: 'asked', 'offered' or 'none'. */
  readonly swap: string;
  /** The sign about a swap is showing, and what it says. */
  readonly swapSign: string;
}

/**
 * Sits each player in their seat (src/sim/cabin.ts, docs/cabin.md). There
 * is no walking: the play space is placed so the player's eyes are over
 * their seat's eye point, facing the seat's way, when VR starts, when they
 * change seats, and from the menu (Back in my seat). Its floor goes at the
 * seat's floor, with the body-height system's offset on top.
 *
 * After that the player moves their head freely within the seat's head
 * box. Leaning past its edge, as the eyes come up to a wall or the hood,
 * fades the whole view to black over 4 cm (`headFade`), and rising up to
 * the roof does the same: the play space stays where the player was
 * calibrated, so the seat never shifts under them, and leaning back clears
 * the view. A head that jumps far outside the box (the headset recentred),
 * or stays far outside for two seconds (the player stood up and walked),
 * puts the player back in the seat.
 *
 * Seats are shared: the host decides who sits where (`seats` event). Alone,
 * or before the crewmate is aboard, the player sits where they like. In a
 * crew, seats change only when both want to swap (docs/seat-choice.md): a
 * guest's ask goes to the host (`seat-ask`), a host's to the guest
 * (`seat-offer`), a sign tells the other player, and the host swaps both
 * once both have asked within `SWAP_WAIT_SECONDS`. The practice crewmate
 * always agrees. The crewmate's seat decides where NetSystem draws their
 * legs.
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
  private fixes = { walls: 0, roof: 0, reseat: 0 };
  private lastFix: HeadFix = 'inside';
  private overRoof = false;
  /** How long the head has been far outside its box, s. */
  private farFor = 0;
  /** The head's play-space position last frame, for telling a recentre's jump. */
  private lastLocal = new Vector3();
  private fade = 0;
  /** Black round the eyes, as dark as `fade`. */
  private blind!: Mesh<SphereGeometry, MeshBasicMaterial>;
  private wasAway = false;
  /** Host: when each player last asked to swap, s (performance clock). */
  private asks: SwapAsks = { host: -Infinity, guest: -Infinity };
  /** When the swap waiting for a word started, s. */
  private swapSince = 0;
  private sign!: FloatingSign;
  private signUntil = 0;
  private signText = '';

  init(): void {
    this.sign = new FloatingSign('Seat Sign', 0.7, [560, 160], 1.1, 0.3);
    // Half a metre out: a shell much nearer than that crosses the near clipping plane (5 cm) towards the edges of each
    // eye's view, which blacked out only the middle of the view (John's headset check, 2026-10-31). Drawn last, without
    // the depth test, it covers everything nearer too.
    this.blind = new Mesh(
      new SphereGeometry(0.5, 16, 12),
      new MeshBasicMaterial({ color: 0x000000, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.blind.name = 'Head Fade';
    this.blind.frustumCulled = false;
    this.blind.renderOrder = 1000;
    this.blind.visible = false;
    this.camera.add(this.blind);
    this.world.createTransformEntity(this.sign.mesh);
    seating.ask = (seat) => this.ask(seat);
    seating.reseat = () => {
      seating.away = false;
      this.needsPlace = true;
    };
    netLink.events.set('seats', (e) => {
      // The host's word on who sits where; a host never takes it from a guest.
      if (netLink.isHost) return;
      this.setSwap('none');
      this.sit(parseSeat(e.guest, seating.mine), parseSeat(e.host, seating.crew));
    });
    netLink.events.set('seats-please', () => {
      // A guest who has just joined asks where to sit. A host that hasn't seen its own connection yet sends on seeing it.
      if (netLink.isHost && netLink.connected) this.sendSeats();
    });
    netLink.events.set('seat-ask', (e) => {
      // The guest wants a seat: their own is no change, the host's is an ask to swap.
      if (!netLink.isHost || parseSeat(e.seat, seating.crew) === seating.crew) return;
      this.asks.guest = now();
      if (settings.bot) {
        // The practice crewmate always agrees.
        this.asks.host = now();
      }
      if (!this.trySwap()) {
        this.offered();
      }
    });
    netLink.events.set('seat-offer', () => {
      // The host asks to swap.
      if (netLink.isHost) return;
      if (settings.bot) {
        this.ask(otherSeat(seating.mine));
        return;
      }
      this.offered();
    });
    this.cleanupFuncs.push(() => {
      this.blind.removeFromParent();
      this.blind.geometry.dispose();
      this.blind.material.dispose();
      netLink.events.delete('seats');
      netLink.events.delete('seat-ask');
      netLink.events.delete('seat-offer');
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
      get fade() { return self.fade; },
      get swap() { return seating.swap; },
      get swapSign() { return self.sign.visible ? self.signText : ''; },
    };
    (window as unknown as { __seats: SeatDebug }).__seats = debug;
  }

  update(delta: number): void {
    this.shareSeats();
    this.updateSwap(delta);
    const player = this.player;
    const seat = SEATS[seating.mine];
    netLink.feet = seat.floorY;
    if (seating.away !== this.wasAway) {
      // Back from a spike's seat: sit down here afresh.
      this.wasAway = seating.away;
      this.needsPlace = true;
    }
    if (seating.away) {
      this.setFade(0);
      return;
    }
    if (!this.world.session) {
      this.setFade(0);
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
    const jumped = local.distanceTo(this.lastLocal) > HEAD_JUMP;
    this.lastLocal.copy(local);
    // Standing up out of the seat: the head is over the roof stop. The play space only turns about the vertical, so its height adds straight on.
    const over = -headDrop(seat, player.position.y + local.y);
    if (over > 0 && !this.overRoof) this.fixes.roof++;
    this.overRoof = over > 0;
    let out = 0;
    if (!this.needsPlace) {
      player.head.getWorldPosition(this.head);
      this.headHull[0] = this.head.x;
      this.headHull[1] = this.head.y;
      this.headHull[2] = this.head.z;
      const fix = headFix(seat, seating.turretYaw, this.headHull, this.fix);
      if (fix === 'fade') {
        out = Math.hypot(this.fix[0], this.fix[1]);
        if (this.lastFix === 'inside') this.fixes.walls++;
      }
      this.farFor = fix === 'reseat' ? this.farFor + delta : 0;
      if (fix === 'reseat') {
        out = Infinity;
        if (jumped || this.farFor >= RESEAT_AFTER) {
          this.needsPlace = true;
          this.fixes.reseat++;
          this.farFor = 0;
        }
      }
      this.lastFix = fix;
    }
    this.setFade(this.needsPlace ? 0 : headFade(Math.max(out, over)));
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

  /** Darken the view to `fade` (0 clear, 1 black). */
  private setFade(fade: number): void {
    if (fade === this.fade) return;
    this.fade = fade;
    this.blind.material.opacity = fade;
    this.blind.visible = fade > 0;
  }

  /**
   * Ask for `seat`. Alone (or before the crewmate is aboard), take it. In a
   * crew, the player's own seat just puts them back in it; the crewmate's
   * asks to swap: a host notes it and tells the guest, a guest asks the
   * host. Either way the choice is kept for the next visit.
   */
  private ask(seat: SeatId): void {
    seating.away = false;
    this.needsPlace = true;
    if (!settings.bot && seat !== settings.seat) {
      settings.seat = seat;
      saveSettings({ seat: seat === 'driver' ? null : seat });
    }
    if (!netLink.connected) {
      this.sit(seat, otherSeat(seat));
      return;
    }
    if (seat === seating.mine) {
      return;
    }
    if (netLink.isHost) {
      this.asks.host = now();
      if (!this.trySwap()) {
        netLink.sendEvent({ t: 'seat-offer' });
        this.asked();
      }
    } else {
      const event = { t: 'seat-ask', seat };
      netLink.sendEvent(event);
      if (seating.swap !== 'offered') this.asked();
    }
  }

  /** Host: swap both players if both have asked lately. */
  private trySwap(): boolean {
    if (!swapAgreed(this.asks, now())) {
      return false;
    }
    this.asks.host = -Infinity;
    this.asks.guest = -Infinity;
    this.setSwap('none');
    const wanted = seatingWith('host', seating.crew);
    this.sit(wanted.host, wanted.guest);
    this.sendSeats();
    console.info('[Seat] swapped seats with the crewmate');
    return true;
  }

  /** This player asked to swap: wait for the crewmate's word. */
  private asked(): void {
    this.setSwap('asked');
    this.say(['Asked your crewmate to swap seats', 'You swap when they agree from their game menu']);
  }

  /** The crewmate asked to swap: tell this player how to agree. */
  private offered(): void {
    this.setSwap('offered');
    this.say(['Your crewmate asks to swap seats', 'To agree: game menu (Y), Swap seats']);
  }

  private setSwap(swap: typeof seating.swap): void {
    seating.swap = swap;
    this.swapSince = now();
    if (swap === 'none' && this.sign.visible) {
      this.sign.setVisible(false);
    }
  }

  /** Forget an ask nobody answered, and keep the sign in front of the player while it shows. */
  private updateSwap(delta: number): void {
    if (seating.swap !== 'none' && (!netLink.connected || now() - this.swapSince > SWAP_WAIT_SECONDS)) {
      this.setSwap('none');
    }
    if (this.sign.visible) {
      if (now() > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.player.head, delta);
    }
  }

  private say(lines: [string, string]): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText(lines[0], width / 2, 66);
    ctx.font = '28px sans-serif';
    ctx.fillText(lines[1], width / 2, 116);
    this.sign.refresh();
    this.sign.setVisible(true);
    this.signText = lines.join(' / ');
    this.signUntil = now() + SWAP_SIGN_SECONDS;
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

  /**
   * A host tells a guest who has just joined where to sit: the host keeps their seat and the guest takes the other.
   * The guest asks as well, since the host's `seats` can arrive before the guest's page has seen its own connection,
   * while it still counts itself a host and drops it.
   */
  private shareSeats(): void {
    if (netLink.connected === this.wasConnected) {
      return;
    }
    this.wasConnected = netLink.connected;
    this.asks.host = -Infinity;
    this.asks.guest = -Infinity;
    if (netLink.connected && netLink.isHost) {
      const wanted = seatingWith('host', seating.mine);
      this.sit(wanted.host, wanted.guest);
      this.sendSeats();
    } else if (netLink.connected) {
      netLink.sendEvent({ t: 'seats-please' });
    }
  }
}

/** Seconds on the page's clock. */
function now(): number {
  return performance.now() / 1000;
}
