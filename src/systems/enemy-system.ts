import { createSystem, type Mesh, Vector3, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { createEnemyGun, MUZZLE } from '../scene-assets/enemy-gun.scene-asset.js';
import { createBurst, createMuzzleFlash, createTracer } from '../scene-assets/loading.scene-asset.js';
import { smokeBlocks } from '../sim/ammo.js';
import { ENEMY_TARGET_FIRST, type Vec3 } from '../sim/ballistics.js';
import {
  batteryLine,
  ENEMY_GUN,
  ENEMY_GUNS,
  EnemyBattery,
  type EnemyShared,
  type EnemyShot,
  gunNear,
  parseShared,
  parseShot,
  sharedOf,
  type SightCheck,
  type TankTarget,
} from '../sim/enemy-guns.js';
import { groundHeight, wrapTile } from '../sim/terrain.js';
import { placeTank, resetTank, tankState } from './drive-system.js';
import { decidedListeners, setFaceOff } from './firing-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { netLink } from './net-system.js';
import { smokeClouds, smokeNow } from './smoke-system.js';
import { playTankSound } from './tank-audio-system.js';

/** Incoming shells followed at once: three guns firing every 8 s never have more than three in the air. */
const SHELLS = 4;
/** The tracer's length, m, and how far away it stops growing thinner, m (as FiringSystem's). */
const TRACER_LENGTH = 9;
const TRACER_FULL_SIZE = 40;
/** A muzzle's flash lasts this long, s; the dust its blast raises grows to `dust` m over `grow` s and settles over `fade` s. */
const FLASH = { seconds: 0.12, scale: 1.6, dust: 2.6, grow: 0.15, fade: 1.4 } as const;
/** Where a shell strikes: the dirt or the bright hit, m, and how it dies away, s. */
const STRIKE = { dirt: 1.8, hit: 1.4, grow: 0.12, fade: 0.8 } as const;
/** A burst stays at least this big as seen, per this many metres away (as FiringSystem's). */
const FULL_SIZE = 250;
/** A gun turns its barrel towards the tank this far either side of where it was dug in to point, rad. */
const TRAVERSE = 0.6;
/** How long a note stays on the sign, s. */
const NOTE_SECONDS = 4;
/** The host sends the battery's state again this often while it runs, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;

let active: EnemySystem | null = null;

/** The battery as this page shows it (F3.2). */
export function enemyShared(): Readonly<EnemyShared> {
  return active?.shared ?? { on: false, alive: ENEMY_GUNS.map(() => true), hits: 0, shots: 0, v: 0 };
}

/** Whether enemy gun `i` has fired since the battery started, as this page has seen: the crew knows where it is. */
export function enemyRevealed(i: number): boolean {
  return active?.revealed[i] ?? false;
}

/** One line for the menu. */
export function enemyStatus(): string {
  return batteryLine(enemyShared());
}

/** Combat → Enemy guns → Start (the tank back at its start, warm) or Stop. The host does it; a guest asks. */
export function startEnemies(on: boolean): void {
  if (on) resetTank('warm');
  if (!netLink.isHost) {
    const event = { t: 'enemy-ask', on };
    netLink.sendEvent(event);
    return;
  }
  active?.setOn(on);
}

/** Combat → Enemy guns → Meet gun A/B/C: the battery started if it isn't, the tank parked on the lane where that gun first sees it. */
export function meetGun(i: number): void {
  if (!ENEMY_GUNS[i]) return;
  if (!enemyShared().on) startEnemies(true);
  placeTank(0, ENEMY_GUNS[i].meetZ, 0);
}

/** An incoming shell as this page draws it. */
interface Incoming {
  shot: EnemyShot | null;
  /** This page's time it was fired, s. */
  firedAt: number;
  tracer: Mesh;
  dirt: Mesh;
  hit: Mesh;
  /** Its strike has been heard and told. */
  struck: boolean;
}

interface EnemyDebug {
  state(): EnemyShared & {
    guns: { name: string; alive: boolean; revealed: boolean; sees: boolean; tracking: boolean; ready: number; drawn: boolean }[];
    faceOff: boolean[];
  };
  start(seed?: number): void;
  stop(): void;
  /** Host: gun `i` fires at the tank now, seeing it or not. */
  fireNow(i: number): void;
  /** Host: gun `i` is knocked out at once. */
  kill(i: number): void;
  /** Host: whether gun `i` could see the tank now. */
  canSee(i: number): boolean;
  /** The shots this page has seen, oldest first. */
  shots(): EnemyShot[];
  meet(i: number): void;
  readonly sign: string;
}

/**
 * Enemy anti-tank guns (F3.2, docs/enemy-guns.md). The host runs the
 * battery (src/sim/enemy-guns.ts): the guns look for the tank, lay and
 * fire; it sends their state (`enemy`) and each shot (`enemy-shot`), and a
 * guest draws what it is told. Both pages draw the guns where they stand,
 * each shot's flash, tracer and strike, and put a note on the sign when a
 * gun fires on the tank, hits it or is knocked out. A shell the host
 * decides hit a gun (FiringSystem's decidedListeners) knocks it out when
 * it gets there. The guns' shields are among the shells' targets only while
 * the battery is on and the gun alive (setFaceOff). Runs after
 * SmokeSystem, whose clouds hide the tank from the guns.
 */
export class EnemySystem extends createSystem({}) {
  readonly battery = new EnemyBattery();
  readonly shared: EnemyShared = { on: false, alive: ENEMY_GUNS.map(() => true), hits: 0, shots: 0, v: 0 };
  readonly revealed: boolean[] = ENEMY_GUNS.map(() => false);
  private time = 0;
  private guns: Mesh[] = [];
  private wrecks: Mesh[] = [];
  private flashes: Mesh[] = [];
  private dusts: Mesh[] = [];
  private firedAt: number[] = ENEMY_GUNS.map(() => -100);
  private incoming: Incoming[] = [];
  private seen: EnemyShot[] = [];
  private pendingKills: { gun: number; at: number }[] = [];
  private fired: EnemyShot[] = [];
  private sentVersion = -1;
  private sentAt = 0;
  private wasConnected = false;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private notes: string[] = [];
  private target: TankTarget = { x: 0, ground: 0, z: 0, heading: 0, speed: 0 };
  private at: [number, number] = [0, 0];
  private eye = new Vector3();
  private seenAt = new Vector3();
  private dir = new Vector3();
  private back = new Vector3(0, 0, 1);
  private clear: SightCheck = (a, b) => !smokeBlocks(smokeClouds(), smokeNow(), a as Vec3, b as Vec3);

  init(): void {
    active = this;
    const ground = this.world.getSceneEntity('ground') ?? null;
    const add = (mesh: Mesh) => {
      mesh.visible = false;
      mesh.frustumCulled = false;
      if (ground) this.world.createTransformEntity(mesh, { parent: ground });
      return mesh;
    };
    ENEMY_GUNS.forEach((_, i) => {
      this.guns.push(add(createEnemyGun(i)));
      this.wrecks.push(add(createEnemyGun(i, true)));
      this.flashes.push(add(createMuzzleFlash()));
      this.dusts.push(add(createBurst(false)));
    });
    for (let k = 0; k < SHELLS; k++) {
      this.incoming.push({ shot: null, firedAt: 0, tracer: add(createTracer()), dirt: add(createBurst(false)), hit: add(createBurst(true)), struck: true });
    }
    this.sign = new FloatingSign('Enemy Sign', 0.85, [560, 120], 1.1, 0.12);
    this.world.createTransformEntity(this.sign.mesh);
    this.applyFaces();

    netLink.events.set('enemy', (e) => {
      if (netLink.isHost) return;
      const s = parseShared(e);
      if (s) this.applyShared(s);
    });
    netLink.events.set('enemy-shot', (e) => {
      if (netLink.isHost) return;
      const shot = parseShot(e);
      if (shot) this.show(shot);
    });
    netLink.events.set('enemy-ask', (e) => {
      const on = (e as { on?: unknown }).on;
      if (netLink.isHost && typeof on === 'boolean') this.setOn(on);
    });
    // A shell the host decided hit a live gun knocks it out when it gets there (FiringSystem gives its flight time).
    const onDecided = (target: number, flight: number) => {
      const gun = target - ENEMY_TARGET_FIRST;
      if (netLink.isHost && ENEMY_GUNS[gun] && this.shared.on && this.shared.alive[gun]) this.pendingKills.push({ gun, at: this.time + flight });
    };
    decidedListeners.add(onDecided);
    this.cleanupFuncs.push(
      () => netLink.events.delete('enemy'),
      () => netLink.events.delete('enemy-shot'),
      () => netLink.events.delete('enemy-ask'),
      () => decidedListeners.delete(onDecided),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __enemy: EnemyDebug }).__enemy = {
      state: () => ({
        ...self.shared,
        alive: [...self.shared.alive],
        guns: ENEMY_GUNS.map((g, i) => ({
          name: g.name,
          alive: self.shared.alive[i],
          revealed: self.revealed[i],
          sees: self.battery.guns[i].sees,
          tracking: self.battery.guns[i].tracking,
          ready: self.battery.guns[i].ready,
          drawn: self.guns[i].visible || self.wrecks[i].visible,
        })),
        faceOff: ENEMY_GUNS.map((_, i) => self.faceOff(i)),
      }),
      start: (seed) => {
        if (!netLink.isHost) return;
        self.battery.start(seed);
        self.afterChange();
      },
      stop: () => self.setOn(false),
      fireNow: (i) => {
        if (!netLink.isHost || !self.battery.on || !self.battery.guns[i]?.alive) return;
        self.tankTarget();
        self.send(self.battery.fire(i, self.target));
        self.afterChange();
      },
      kill: (i) => {
        if (netLink.isHost && self.battery.kill(i)) self.afterChange();
      },
      canSee: (i) => {
        self.tankTarget();
        return self.battery.canSee(i, self.target, self.clear);
      },
      shots: () => self.seen.map((s) => ({ ...s, from: [...s.from] as Vec3, to: [...s.to] as Vec3 })),
      meet: (i) => meetGun(i),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
  }

  /** Host: start or stop the battery. */
  setOn(on: boolean): void {
    if (!netLink.isHost) return;
    if (on) this.battery.start();
    else this.battery.stop();
    this.pendingKills.length = 0;
    this.afterChange();
    console.info(`[Enemy] guns ${on ? 'started' : 'stopped'}`);
  }

  /** Host: the battery changed; show it here (the guest hears it in update). */
  private afterChange(): void {
    this.applyShared(sharedOf(this.battery, { on: false, alive: [], hits: 0, shots: 0, v: 0 }));
  }

  /** Take the battery's shared state: what to draw, which shields shells can hit, and notes for guns knocked out. */
  private applyShared(s: EnemyShared): void {
    const was = this.shared;
    const fresh = s.on && (!was.on || s.shots < was.shots);
    if (fresh) {
      this.revealed.fill(false);
      this.seen.length = 0;
    }
    if (was.on && s.on && !fresh) {
      s.alive.forEach((alive, i) => {
        if (was.alive[i] && !alive) this.note(`${ENEMY_GUNS[i].name} knocked out`);
      });
      if (s.alive.every((a) => !a) && was.alive.some(Boolean)) this.note(`All ${s.alive.length} guns knocked out`);
    }
    if (s.on && !was.on) this.note('Enemy guns ahead: watch for their flashes');
    was.on = s.on;
    was.alive = [...s.alive];
    was.hits = s.hits;
    was.shots = s.shots;
    was.v = s.v;
    this.applyFaces();
  }

  private faceOff(i: number): boolean {
    return !(this.shared.on && this.shared.alive[i]);
  }

  private applyFaces(): void {
    ENEMY_GUNS.forEach((_, i) => setFaceOff(ENEMY_TARGET_FIRST + i, this.faceOff(i)));
  }

  /** The tank as the guns see it. */
  private tankTarget(): TankTarget {
    const t = tankState();
    this.target.x = t.x;
    this.target.z = t.z;
    this.target.ground = groundHeight(t.x, t.z);
    this.target.heading = t.heading;
    this.target.speed = t.speed;
    return this.target;
  }

  /** Host: a gun fired; show it here and tell the guest. */
  private send(shot: EnemyShot): void {
    this.show(shot);
    if (netLink.connected) {
      const event = { t: 'enemy-shot', ...shot, from: [...shot.from], to: [...shot.to] };
      netLink.sendEvent(event);
    }
  }

  /** A gun fired: its flash and dust now, its shell on the way. */
  private show(shot: EnemyShot): void {
    this.firedAt[shot.gun] = this.time;
    const first = !this.revealed[shot.gun];
    this.revealed[shot.gun] = true;
    this.seen.push(shot);
    if (this.seen.length > 50) this.seen.shift();
    let slot = this.incoming.find((s) => s.shot === null || (s.struck && this.time - s.firedAt > s.shot.flight + STRIKE.grow + STRIKE.fade));
    if (!slot) slot = this.incoming.reduce((a, b) => (a.firedAt < b.firedAt ? a : b));
    slot.shot = shot;
    slot.firedAt = this.time;
    slot.struck = false;
    if (first && !shot.hit) this.note(`${ENEMY_GUNS[shot.gun].name} firing, ${shot.clock} o'clock, ${Math.round(shot.range / 10) * 10} m`);
    console.info(`[Enemy] ${ENEMY_GUNS[shot.gun].name} fired from ${Math.round(shot.range)} m: ${shot.hit ? 'hit' : 'miss'}`);
  }

  private note(text: string): void {
    this.notes.push(text);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    if (netLink.isHost) this.host(dt);
    this.draw();
    this.drawSign(delta);
  }

  /** The host's part: step the battery, knock out guns hit, and keep the guest told. */
  private host(dt: number): void {
    const paused = netLink.connected && crewPresence.paused;
    if (!paused && this.battery.on) {
      this.battery.step(dt, this.tankTarget(), this.clear, this.fired);
      for (const shot of this.fired) this.send(shot);
    }
    for (let k = this.pendingKills.length - 1; k >= 0; k--) {
      const p = this.pendingKills[k];
      if (this.time < p.at) continue;
      this.pendingKills.splice(k, 1);
      this.battery.kill(p.gun);
    }
    if (this.battery.version !== this.shared.v) this.afterChange();
    const joined = netLink.connected && !this.wasConnected;
    const resync = this.battery.on && this.time - this.sentAt >= RESYNC_SECONDS;
    if (netLink.connected && (joined || resync || this.sentVersion !== this.battery.version)) {
      const event = { t: 'enemy', ...this.shared, alive: [...this.shared.alive] };
      netLink.sendEvent(event);
      this.sentVersion = this.battery.version;
      this.sentAt = this.time;
    }
    this.wasConnected = netLink.connected;
  }

  /** The guns where they stand (each one's copy nearest the tank), their flashes, and the shells on their way. */
  private draw(): void {
    const tank = tankState();
    // The ground is drawn at the tank's position less whole tiles: world points are drawn that much nearer.
    const offX = tank.x - wrapTile(tank.x);
    const offZ = tank.z - wrapTile(tank.z);
    const on = this.shared.on;
    this.player.head.getWorldPosition(this.eye);
    for (let i = 0; i < ENEMY_GUNS.length; i++) {
      const g = ENEMY_GUNS[i];
      const alive = this.shared.alive[i];
      const gun = this.guns[i];
      const wreck = this.wrecks[i];
      gun.visible = on && alive;
      wreck.visible = on && !alive;
      const flash = this.flashes[i];
      const dust = this.dusts[i];
      if (!on) {
        flash.visible = false;
        dust.visible = false;
        continue;
      }
      const [x, z] = gunNear(i, tank.x, tank.z, this.at);
      const y = groundHeight(x, z);
      // A live gun turns its barrel towards the tank, within its traverse.
      let yaw = g.yaw;
      if (alive) {
        const toTank = Math.atan2(tank.x - x, tank.z - z);
        const off = Math.atan2(Math.sin(toTank - g.yaw), Math.cos(toTank - g.yaw));
        yaw = g.yaw + Math.max(-TRAVERSE, Math.min(TRAVERSE, off));
      }
      const mesh = alive ? gun : wreck;
      mesh.position.set(x - offX, y, z - offZ);
      mesh.rotation.set(0, yaw, 0);
      // The flash at the muzzle, its cone opening along the barrel (its own -Z), and the dust its blast raises.
      const since = this.time - this.firedAt[i];
      flash.visible = since < FLASH.seconds;
      if (flash.visible) {
        flash.position.set(x - offX + Math.sin(yaw) * MUZZLE[2], y + MUZZLE[1], z - offZ + Math.cos(yaw) * MUZZLE[2]);
        flash.rotation.set(0, yaw + Math.PI, 0);
        flash.scale.setScalar(FLASH.scale * this.seenScale(flash));
      }
      const life = FLASH.grow + FLASH.fade;
      dust.visible = since < life;
      if (dust.visible) {
        const grow = since < FLASH.grow ? since / FLASH.grow : 1 - (since - FLASH.grow) / FLASH.fade;
        dust.position.set(x - offX + Math.sin(yaw) * 2, y + 0.6, z - offZ + Math.cos(yaw) * 2);
        const s = Math.max(0.01, FLASH.dust * grow * this.seenScale(dust));
        dust.scale.set(s * 1.4, s * 0.7, s * 1.4);
      }
    }
    for (const slot of this.incoming) this.drawShell(slot, offX, offZ);
  }

  /** How far from the eye a mesh is, m. */
  private away(mesh: Mesh): number {
    mesh.getWorldPosition(this.seenAt);
    return this.seenAt.distanceTo(this.eye);
  }

  /** How much bigger a burst is drawn so it still shows far away. */
  private seenScale(mesh: Mesh): number {
    return Math.max(1, this.away(mesh) / FULL_SIZE);
  }

  private drawShell(slot: Incoming, offX: number, offZ: number): void {
    const shot = slot.shot;
    if (!shot) return;
    const t = this.time - slot.firedAt;
    const flying = t < shot.flight;
    if (flying) {
      // Straight from the muzzle to where it goes: at 790 m/s over a few hundred metres it drops a few centimetres.
      const k = shot.flight > 0 ? t / shot.flight : 1;
      const px = shot.from[0] + (shot.to[0] - shot.from[0]) * k;
      const py = shot.from[1] + (shot.to[1] - shot.from[1]) * k;
      const pz = shot.from[2] + (shot.to[2] - shot.from[2]) * k;
      slot.tracer.position.set(px - offX, py, pz - offZ);
      this.dir.set(shot.to[0] - shot.from[0], shot.to[1] - shot.from[1], shot.to[2] - shot.from[2]).normalize();
      slot.tracer.quaternion.setFromUnitVectors(this.back, this.dir);
      const thick = Math.max(1, this.away(slot.tracer) / TRACER_FULL_SIZE);
      slot.tracer.scale.set(thick, thick, Math.min(TRACER_LENGTH, Math.max(0.1, t * ENEMY_GUN.muzzleSpeed)));
      slot.tracer.visible = true;
      slot.dirt.visible = false;
      slot.hit.visible = false;
      return;
    }
    slot.tracer.visible = false;
    if (!slot.struck) {
      slot.struck = true;
      if (shot.hit) {
        playTankSound('bump');
        this.note(`Hit! ${ENEMY_GUNS[shot.gun].name}, ${shot.clock} o'clock, ${Math.round(shot.range / 10) * 10} m`);
      }
    }
    const since = t - shot.flight;
    const mesh = shot.hit ? slot.hit : slot.dirt;
    const other = shot.hit ? slot.dirt : slot.hit;
    other.visible = false;
    if (since > STRIKE.grow + STRIKE.fade) {
      mesh.visible = false;
      return;
    }
    const grow = since < STRIKE.grow ? since / STRIKE.grow : 1 - (since - STRIKE.grow) / STRIKE.fade;
    mesh.position.set(shot.to[0] - offX, shot.to[1], shot.to[2] - offZ);
    const s = Math.max(0.01, (shot.hit ? STRIKE.hit : STRIKE.dirt) * grow * this.seenScale(mesh));
    mesh.scale.set(s, s * 0.8, s);
    mesh.visible = true;
  }

  /** The newest note on the sign in front of each player for a few seconds. */
  private drawSign(delta: number): void {
    if (this.notes.length > 0) {
      const text = this.notes[this.notes.length - 1];
      this.notes.length = 0;
      this.signText = text;
      this.signUntil = this.time + NOTE_SECONDS;
      const { ctx, width, height } = this.sign;
      drawSignBackground(ctx, width, height);
      ctx.fillStyle = text.startsWith('Hit!') ? '#ffb0a0' : '#f4ead8';
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText(text, width / 2, height / 2 + 14, width - 30);
      this.sign.refresh();
      this.sign.setVisible(true);
      console.info(`[Enemy] sign: ${text}`);
    }
    if (this.sign.visible && this.time > this.signUntil) this.sign.setVisible(false);
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}
