import { createSystem, VisibilityState } from '@iwsdk/core';
import type { Vec3 } from '../sim/ballistics.js';
import { smokeBlocks } from '../sim/ammo.js';
import { ENEMY_COUNT, ENEMY_GUNS, enemyName, gunNear, groundBlocks, obstaclesBlock } from '../sim/enemy-guns.js';
import { createViewer, inField, kindOf, type MapMark, MarkBook, type MarkSeenEvent, parseMarkSeen, SeeingClocks, sightHeight, type Viewer } from '../sim/map-marks.js';
import { HALF_FIELD_X, HALF_FIELD_Y, PITCH } from '../sim/periscope.js';
import { TRUE_HALF_FIELD } from '../sim/sight.js';
import { groundHeight } from '../sim/terrain.js';
import { convoyUp } from './convoy-seat-system.js';
import { placeTank, tankState } from './drive-system.js';
import { enemyRevealed, enemyShared, holdEnemyFire, startEnemies } from './enemy-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { showMapMarks } from './map-case-system.js';
import { netLink } from './net-system.js';
import { periscopeAngleNow, periscopeStats } from './periscope-system.js';
import { seating } from './seating.js';
import { sightStats } from './sight-system.js';
import { smokeClouds, smokeNow } from './smoke-system.js';
import { aimTurret, turretState } from './turret-system.js';

/** Look for enemies this often, s: seeing takes SEE_TIME, so a tenth of a second is plenty and keeps the line checks cheap. */
const LOOK_EVERY = 0.1;
/** The host sends the book again this often while it has marks, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
/** Heights above the hull floor the crew looks from, m: the gunsight's objective, the gunner's periscope head, the driver's. */
const SIGHT_Y = 1.85;
const GUNNER_PERISCOPE_Y = 2.5;
const DRIVER_PERISCOPE_Y = 1.62;
const SIGN_SECONDS = 9;

let active: MapMarksSystem | null = null;

/** Practice → Commander → Spot on the map: alone, the gunner's seat, the enemy guns out (holding their fire) and the tank parked where gun A is ahead. */
export function spotOnTheMap(): void {
  active?.practice();
}

interface MapMarksDebug {
  /** The book as this page has it, and how many of this page's sights and periscopes are open. */
  state(): { v: number; marks: MapMark[]; looking: number; sign: string };
  /** Practice → Commander → Spot on the map. */
  practice(): void;
  /** Lay the gun straight on enemy `i` (the turret's owner page). */
  layOn(i: number): void;
  /** Where enemy `i` is now, world x and z. */
  where(i: number): number[];
}

/**
 * Enemies seen, pencilled on the map (F2.11, docs/map-marks.md). Each page
 * looks through its own open gunsight and periscopes: an enemy in a field,
 * in range, with a clear line (the ground, houses and walls, smoke) for
 * SEE_TIME is seen. The host pencils what its crew and the guest's see (a
 * guest sends `mark-seen`), and each gun's flash; crosses out what is
 * knocked out; rubs out what is gone; and sends the book (`marks`) on every
 * change. MapCaseSystem paints it on the map. Runs after the sight and the
 * periscopes (their open state this frame).
 */
export class MapMarksSystem extends createSystem({}) {
  private book = new MarkBook();
  private clocks = new SeeingClocks();
  private viewers: Viewer[] = [createViewer(), createViewer(), createViewer()];
  private viewing = 0;
  private wasRevealed = new Uint8Array(ENEMY_COUNT);
  private wasAlive = new Uint8Array(ENEMY_COUNT).fill(1);
  private at: [number, number] = [0, 0];
  private eye: Vec3 = [0, 0, 0];
  private target: Vec3 = [0, 0, 0];
  private sinceLook = 0;
  private sinceSend = 0;
  private shownV = -1;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;

  init(): void {
    active = this;
    this.sign = new FloatingSign('Map Marks Sign', 0.75, [600, 200], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);
    netLink.events.set('mark-seen', (e) => {
      if (!netLink.isHost) return;
      const seen = parseMarkSeen(e);
      if (seen && enemyShared().present[seen.i]) this.book.seen(seen.i, seen.x, seen.z, 'seen');
    });
    netLink.events.set('marks', (e) => {
      if (netLink.isHost) return;
      this.book.apply(e);
    });
    this.cleanupFuncs.push(
      () => netLink.events.delete('mark-seen'),
      () => netLink.events.delete('marks'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __mapMarks: MapMarksDebug }).__mapMarks = {
      state: () => ({ v: self.book.v, marks: self.book.marks.map((m) => ({ ...m })), looking: self.viewing, sign: self.sign.visible ? self.signText : '' }),
      practice: () => self.practice(),
      layOn: (i) => self.layOn(i),
      where: (i) => {
        const t = tankState();
        const at = gunNear(i, t.x, t.z, [0, 0], enemyShared().d[i] ?? 0);
        return [at[0], at[1]];
      },
    };
  }

  practice(): void {
    if (!netLink.connected) seating.ask('gunner');
    startEnemies(true, 'guns');
    // Seeing them is the drill, not being shot at.
    holdEnemyFire(true);
    placeTank(0, ENEMY_GUNS[0].meetZ, 0);
    this.say('Spot on the map', 'Find the guns through the sight or the periscope:', 'each one you see is pencilled on the map');
  }

  update(delta: number): void {
    this.time += delta;
    this.sinceLook += delta;
    if (this.sinceLook >= LOOK_EVERY) {
      this.look(this.sinceLook);
      this.sinceLook = 0;
    }
    if (netLink.isHost) {
      this.sinceSend += delta;
      if (this.book.v !== this.shownV || (this.book.marks.length > 0 && netLink.connected && this.sinceSend > RESYNC_SECONDS)) {
        if (netLink.connected) netLink.sendEvent(this.book.encode());
        this.sinceSend = 0;
      }
    }
    if (this.book.v !== this.shownV) {
      this.shownV = this.book.v;
      showMapMarks(this.book.marks);
    }
    if (this.sign.visible) {
      if (this.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }

  /** What this page's crew sees, and (the host) the flashes, the knock-outs and the enemies gone. */
  private look(dt: number): void {
    const shared = enemyShared();
    const host = netLink.isHost;
    if (host) {
      this.book.keep(shared.present);
      for (let i = 0; i < ENEMY_COUNT; i++) {
        const revealed = shared.present[i] && enemyRevealed(i);
        if (revealed && !this.wasRevealed[i] && shared.alive[i]) this.seenAt(i, 'flash');
        this.wasRevealed[i] = revealed ? 1 : 0;
        if (!shared.alive[i] && this.wasAlive[i]) this.book.knockedOut(i);
        this.wasAlive[i] = shared.alive[i] ? 1 : 0;
      }
    }
    this.viewing = this.openViewers();
    if (!shared.on || this.viewing === 0) {
      if (this.viewing === 0) this.clocks.clear();
      return;
    }
    const t = tankState();
    const clouds = smokeClouds();
    const now = smokeNow();
    for (let i = 0; i < ENEMY_COUNT; i++) {
      if (!shared.present[i]) {
        this.clocks.t[i] = 0;
        continue;
      }
      gunNear(i, t.x, t.z, this.at, shared.d[i]);
      const tx = this.at[0];
      const tz = this.at[1];
      const ty = groundHeight(tx, tz) + sightHeight(i);
      let seen = false;
      for (let k = 0; k < this.viewing && !seen; k++) {
        const v = this.viewers[k];
        if (!inField(v, tx, ty, tz)) continue;
        this.eye[0] = v.x;
        this.eye[1] = v.y;
        this.eye[2] = v.z;
        this.target[0] = tx;
        this.target[1] = ty;
        this.target[2] = tz;
        seen = !groundBlocks(this.eye, this.target) && !obstaclesBlock(this.eye, this.target) && !smokeBlocks(clouds, now, this.eye, this.target);
      }
      if (this.clocks.step(i, seen, dt)) {
        if (host) this.seenAt(i, 'seen');
        else {
          const event: MarkSeenEvent = { t: 'mark-seen', i, x: tx, z: tz };
          netLink.sendEvent(event);
        }
        console.info(`[MapMarks] saw ${enemyName(i)} (${kindOf(i)})`);
      }
    }
  }

  /** The host pencils enemy `i` where it is now. */
  private seenAt(i: number, how: 'seen' | 'flash'): void {
    const t = tankState();
    gunNear(i, t.x, t.z, this.at, enemyShared().d[i]);
    this.book.seen(i, this.at[0], this.at[1], how);
  }

  /** This page's sights and periscopes with an eye at them, into `viewers`; how many. */
  private openViewers(): number {
    const t = tankState();
    const turret = turretState();
    let n = 0;
    if (sightStats.open) n = this.put(n, SIGHT_Y, t.heading + turret.yaw, turret.elevation, TRUE_HALF_FIELD, TRUE_HALF_FIELD);
    if (periscopeStats.gunner.open) n = this.put(n, GUNNER_PERISCOPE_Y, t.heading + turret.yaw + periscopeAngleNow('gunner'), PITCH, HALF_FIELD_X, HALF_FIELD_Y);
    if (periscopeStats.driver.open && !convoyUp()) n = this.put(n, DRIVER_PERISCOPE_Y, t.heading + periscopeAngleNow('driver'), PITCH, HALF_FIELD_X, HALF_FIELD_Y);
    return n;
  }

  /** Viewer `n` at `y` over the hull floor, looking `yaw`, `pitch`, with these half fields; the next free index. */
  private put(n: number, y: number, yaw: number, pitch: number, halfX: number, halfY: number): number {
    const t = tankState();
    const v = this.viewers[n];
    v.x = t.x;
    v.y = t.y + y;
    v.z = t.z;
    v.yaw = yaw;
    v.pitch = pitch;
    v.halfX = halfX;
    v.halfY = halfY;
    return n + 1;
  }

  private layOn(i: number): void {
    const t = tankState();
    const at = gunNear(i, t.x, t.z, [0, 0], enemyShared().d[i] ?? 0);
    const dx = at[0] - t.x;
    const dz = at[1] - t.z;
    const flat = Math.hypot(dx, dz) || 1;
    const dy = groundHeight(at[0], at[1]) + sightHeight(i) - (t.y + SIGHT_Y);
    aimTurret(Math.atan2(-dx, -dz) - t.heading, Math.atan2(dy, flat));
  }

  private say(title: string, line1: string, line2: string): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(title, width / 2, 64);
    ctx.font = '26px sans-serif';
    ctx.fillText(line1, width / 2, 118);
    ctx.fillText(line2, width / 2, 160);
    this.sign.refresh();
    this.sign.setVisible(true, 'setup');
    this.signText = `${title}. ${line1} ${line2}`;
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[MapMarks] sign: ${this.signText}`);
  }
}
