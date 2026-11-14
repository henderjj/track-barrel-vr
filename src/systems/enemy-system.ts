import { createSystem, type Mesh, Vector3, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { createEnemyGun, MUZZLE } from '../scene-assets/enemy-gun.scene-asset.js';
import { createEnemyTank, createEnemyTankWreck, TANK_MUZZLE, TURRET_RING } from '../scene-assets/enemy-tank.scene-asset.js';
import { createBurst, createMuzzleFlash, createTracer } from '../scene-assets/loading.scene-asset.js';
import { AMMO, smokeBlocks } from '../sim/ammo.js';
import { ENEMY_TARGET_FIRST, type HitFace, type Vec3 } from '../sim/ballistics.js';
import {
  batteryLine,
  ENEMY_COUNT,
  ENEMY_GUNS,
  EnemyBattery,
  type EnemyGroup,
  enemyName,
  enemyBearing,
  type EnemyBearing,
  enemyNoteLines,
  type EnemyShared,
  type EnemyShot,
  FIRST_TANK,
  groupOf,
  gunNear,
  noEnemies,
  parseShared,
  parseShot,
  sharedGroupOn,
  sharedOf,
  type SightCheck,
  specOf,
  tankFace,
  type TankTarget,
} from '../sim/enemy-guns.js';
import { ENEMY_TANK, ENEMY_TANKS, type RoutePose, routePose, wrapRoute } from '../sim/enemy-tanks.js';
import { type CombatTuning, type TankView } from '../sim/combat.js';
import { groundHeight, wrapTile } from '../sim/terrain.js';
import { type DamageHit, resolveDamage, type TankPose } from '../sim/damage.js';
import { rng } from '../sim/random.js';
import { damageState, repairTank, takeHit } from './damage-system.js';
import { placeTank, resetTank, tankState } from './drive-system.js';
import { decidedListeners, setFaceOff, setFacePose } from './firing-system.js';
import { type BoardCall, crewLog } from '../sim/crew-board.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { smokeClouds, smokeNow } from './smoke-system.js';
import { playTankSound } from './tank-audio-system.js';
import { turretState } from './turret-system.js';

/** Incoming shells followed at once: five enemies firing every 7 or 8 s never have more than five in the air. */
const SHELLS = 6;
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
/** A tank's turret traverses this fast, rad/s (F3.3). */
const TURRET_RATE = 0.5;
/** A tank's hull is tilted to the ground between points this far ahead of and behind its middle, m. */
const PITCH_SPAN = 2.5;
/** How long a note stays on the sign, s. */
const NOTE_SECONDS = 4;
/** The host sends the battery's state again this often while it runs, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;

/** A note for the sign: plain text, or a notice about an enemy worked out as it shows. */
interface Note {
  text: string;
  gun: number;
  hit: boolean;
}

let active: EnemySystem | null = null;

/** The battery as this page shows it (F3.2, F3.3). */
export function enemyShared(): Readonly<EnemyShared> {
  return active?.shared ?? noEnemies();
}

/** Whether enemy `i` has fired since its group started, as this page has seen: the crew knows where it is. */
export function enemyRevealed(i: number): boolean {
  return active?.revealed[i] ?? false;
}

/** Host: the fight's tuning (F3.10, set by CombatSystem): spotting, aim, reactions, the tank's size, and its armour's toughness. */
export function setBatteryTuning(t: Readonly<CombatTuning>): void {
  if (active) Object.assign(active.battery.tuning, t);
}

/** Host: some enemy has the tank spotted (F3.10). */
export function enemySpotted(): boolean {
  return active?.battery.spotted() ?? false;
}

/** Host: the enemy's shots at the tank since the battery started (F3.10). */
export function enemyShotsFired(): number {
  return active?.battery.shotsFired ?? 0;
}

/**
 * Host: the combat scenario's battery (F3.10): every enemy stopped, then
 * the guns started afresh with `seed` (the tanks come up later,
 * bringTanks), or nothing.
 */
export function startBattle(on: boolean, seed?: number): void {
  if (!netLink.isHost || !active) return;
  active.battery.stop();
  active.holdFire = false;
  if (on) active.battery.start(seed, 'guns');
  active.restarted();
}

/** Host: the scenario's tanks come up (F3.10), at their routes' starts. */
export function bringTanks(): void {
  if (!netLink.isHost || !active) return;
  active.battery.start(undefined, 'tanks');
  active.restarted();
}

/** Host: the enemy holds its fire (the scenario is over) or fights on. */
export function holdEnemyFire(hold: boolean): void {
  if (active) active.holdFire = hold;
}

/** One line for the menu, for the guns or the tanks. */
export function enemyStatus(group: EnemyGroup = 'guns'): string {
  return batteryLine(enemyShared(), group);
}

/** Combat → Enemy guns (or tanks) → Start (the tank back at its start, warm) or Stop. The host does it; a guest asks. */
export function startEnemies(on: boolean, group: EnemyGroup = 'guns'): void {
  if (on) {
    // A fresh fight: the tank mended (F3.4) and back at the start.
    repairTank();
    resetTank('warm');
  }
  if (!netLink.isHost) {
    const event = { t: 'enemy-ask', on, group };
    netLink.sendEvent(event);
    return;
  }
  active?.setOn(on, group);
}

/** Combat → Enemy guns → Meet gun A/B/C: the guns started if they aren't, the tank parked on the lane where that gun first sees it. */
export function meetGun(i: number): void {
  if (!ENEMY_GUNS[i]) return;
  if (!sharedGroupOn(enemyShared(), 'guns')) startEnemies(true, 'guns');
  placeTank(0, ENEMY_GUNS[i].meetZ, 0);
  // The gun has the tank already (F3.10): Meet is for seeing it fire, not for waiting while it spots.
  if (netLink.isHost) {
    active?.battery.spotNow(i);
    // A scenario that ended held the enemy's fire: a Meet fights on.
    if (active) active.holdFire = false;
  } else {
    const event = { t: 'enemy-ask', spot: i };
    netLink.sendEvent(event);
  }
}

/**
 * Combat → Enemy tanks → Meet tank A/B (F3.3): the tanks started if they
 * aren't, that tank put at its meeting place on its route and the crew's
 * tank parked on the lane facing up it, where that tank will see it. The
 * host does it all; a guest asks.
 */
export function meetTank(j: number): void {
  if (!ENEMY_TANKS[j]) return;
  if (!netLink.isHost) {
    const event = { t: 'enemy-ask', on: true, group: 'tanks', meet: j };
    netLink.sendEvent(event);
    return;
  }
  active?.meet(j);
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
    guns: {
      name: string;
      group: EnemyGroup;
      present: boolean;
      alive: boolean;
      revealed: boolean;
      sees: boolean;
      /** What of the tank it sees, and how far it has got to spotting it (F3.10). */
      view: TankView;
      spot: number;
      tracking: boolean;
      ready: number;
      drawn: boolean;
      along: number;
      moving: boolean;
      /** Where this page draws it, tile-local, and its turret's turn on the hull (tanks), rad. */
      x: number;
      z: number;
      turret: number;
    }[];
    faceOff: boolean[];
  };
  start(seed?: number, group?: EnemyGroup): void;
  stop(group?: EnemyGroup): void;
  /** Host: enemy `i` fires at the tank now, seeing it or not, at the whole tank (hull down or not). */
  fireNow(i: number): void;
  /** Host: enemy `i` is knocked out at once. */
  kill(i: number): void;
  /** Host: whether enemy `i` could see the tank now. */
  canSee(i: number): boolean;
  /** Host: hold tank `i` (an enemy index) where it is, or let it drive on. */
  hold(i: number, held: boolean): void;
  /** Host: put tank `i` (an enemy index) `d` m along its route. */
  place(i: number, d: number): void;
  /** The shots this page has seen, oldest first. */
  shots(): EnemyShot[];
  meet(i: number): void;
  meetTank(j: number): void;
  readonly sign: string;
  /** The sign's second line: the gunner's traverse to the enemy in the notice, or ''. */
  readonly signLine: string;
  /** Host: the battery's tuning (F3.10). */
  tuning(): CombatTuning;
}

/**
 * Enemy anti-tank guns (F3.2, docs/enemy-guns.md) and tanks on fixed
 * routes (F3.3, docs/enemy-tanks.md). The host runs the battery
 * (src/sim/enemy-guns.ts): the guns and tanks look for the crew's tank, lay
 * and fire, and the tanks drive their routes, halting while they have it;
 * it sends their state (`enemy`) and each shot (`enemy-shot`), and a guest
 * draws what it is told, driving the tanks on between messages. Both pages
 * draw them, each shot's flash, tracer and strike, and put a note on the
 * sign when one fires on the tank, hits it or is knocked out. A shell the
 * host decides hit one (FiringSystem's decidedListeners) knocks it out when
 * it gets there. Each is among the shells' targets only while its group is
 * started and it is alive (setFaceOff); a tank's face moves with it
 * (setFacePose). Runs after SmokeSystem, whose clouds hide the tank from
 * them.
 */
export class EnemySystem extends createSystem({}) {
  readonly battery = new EnemyBattery();
  readonly shared: EnemyShared = noEnemies();
  readonly revealed: boolean[] = Array.from({ length: ENEMY_COUNT }, () => false);
  /** How far along its route each tank is as this page draws it, m. */
  private along: number[] = Array.from({ length: ENEMY_COUNT }, () => 0);
  /** Each tank's turret's turn on its hull as drawn, rad. */
  private turretYaw: number[] = Array.from({ length: ENEMY_COUNT }, () => 0);
  /** Where each is drawn, tile-local (tests). */
  private drawnAt: [number, number][] = Array.from({ length: ENEMY_COUNT }, () => [0, 0] as [number, number]);
  private time = 0;
  private whole: Mesh[] = [];
  private turrets: (Mesh | null)[] = [];
  private wrecks: Mesh[] = [];
  private flashes: Mesh[] = [];
  private dusts: Mesh[] = [];
  private firedAt: number[] = Array.from({ length: ENEMY_COUNT }, () => -100);
  private incoming: Incoming[] = [];
  private seen: EnemyShot[] = [];
  private pendingKills: { gun: number; at: number }[] = [];
  private fired: EnemyShot[] = [];
  private sentVersion = -1;
  /** Host: the enemy holds its fire (the combat scenario is over, F3.10). */
  holdFire = false;
  private sentAt = 0;
  private wasConnected = false;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private notes: Note[] = [];
  /** The crew board's call for the notice on the sign (F6.5), kept up to date as the bearing changes. */
  private noteCall: BoardCall | null = null;
  /** The enemy the sign's notice is about, kept live while it shows (-1 for a plain note), and whether it is a hit. */
  private noteGun = -1;
  private noteHit = false;
  /** The second line (the gunner's traverse), and the numbers last drawn, so the sign is redrawn only when they change. */
  private signLine = '';
  private bearing: EnemyBearing = { clock: 0, range: 0, traverse: 0 };
  private drawnBearing: EnemyBearing = { clock: -1, range: -1, traverse: 0 };
  private drawnGunner = false;
  private target: TankTarget = { x: 0, ground: 0, z: 0, heading: 0, speed: 0 };
  private at: [number, number] = [0, 0];
  private pose: RoutePose = { x: 0, z: 0, heading: 0 };
  /** The crew's tank as a shell finds it, and the host's dice for what a hit does (F3.4). */
  private tankPose: TankPose = { x: 0, z: 0, ground: 0, heading: 0, turretYaw: 0 };
  private damageRandom = rng(4242);
  private face: HitFace = { x: 0, y: 0, z: 0, halfWidth: 0, halfHeight: 0, yaw: 0 };
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
    for (let i = 0; i < ENEMY_COUNT; i++) {
      if (i < FIRST_TANK) {
        this.whole.push(add(createEnemyGun(i)));
        this.turrets.push(null);
        this.wrecks.push(add(createEnemyGun(i, true)));
      } else {
        const { hull, turret } = createEnemyTank(i - FIRST_TANK);
        hull.rotation.order = 'YXZ';
        hull.visible = false;
        hull.frustumCulled = false;
        turret.frustumCulled = false;
        // The turret a child of the hull, so it turns and tilts with it.
        const hullEntity = ground ? this.world.createTransformEntity(hull, { parent: ground }) : null;
        if (hullEntity) this.world.createTransformEntity(turret, { parent: hullEntity });
        this.whole.push(hull);
        this.turrets.push(turret);
        const wreck = add(createEnemyTankWreck(i - FIRST_TANK));
        wreck.rotation.order = 'YXZ';
        this.wrecks.push(wreck);
      }
      this.flashes.push(add(createMuzzleFlash()));
      this.dusts.push(add(createBurst(false)));
    }
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
      if (!netLink.isHost) return;
      const ask = e as { on?: unknown; group?: unknown; meet?: unknown; spot?: unknown };
      const group: EnemyGroup = ask.group === 'tanks' ? 'tanks' : 'guns';
      if (typeof ask.meet === 'number' && ENEMY_TANKS[ask.meet]) this.meet(ask.meet);
      else if (typeof ask.on === 'boolean') this.setOn(ask.on, group);
      if (typeof ask.spot === 'number') this.battery.spotNow(ask.spot);
    });
    // A shell the host decided hit a live enemy knocks it out when it gets there (FiringSystem gives its flight time).
    const onDecided = (target: number, flight: number) => {
      // Every shot the crew fires gives the tank away for a while (F3.10).
      if (netLink.isHost) this.battery.crewFired();
      const gun = target - ENEMY_TARGET_FIRST;
      if (netLink.isHost && gun >= 0 && gun < ENEMY_COUNT && this.shared.present[gun] && this.shared.alive[gun]) {
        this.pendingKills.push({ gun, at: this.time + flight });
      }
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
        present: [...self.shared.present],
        alive: [...self.shared.alive],
        d: [...self.shared.d],
        moving: [...self.shared.moving],
        guns: Array.from({ length: ENEMY_COUNT }, (_, i) => ({
          name: enemyName(i),
          group: groupOf(i),
          present: self.shared.present[i],
          alive: self.shared.alive[i],
          revealed: self.revealed[i],
          sees: self.battery.guns[i].sees,
          view: self.battery.guns[i].view,
          spot: self.battery.guns[i].spot,
          tracking: self.battery.guns[i].tracking,
          ready: self.battery.guns[i].ready,
          drawn: self.whole[i].visible || self.wrecks[i].visible,
          along: self.along[i],
          moving: self.moving(i),
          x: self.drawnAt[i][0],
          z: self.drawnAt[i][1],
          turret: self.turretYaw[i],
        })),
        faceOff: Array.from({ length: ENEMY_COUNT }, (_, i) => self.faceOff(i)),
      }),
      start: (seed, group) => {
        if (!netLink.isHost) return;
        self.battery.start(seed, group ?? 'guns');
        self.afterChange();
      },
      stop: (group) => {
        if (!netLink.isHost) return;
        self.battery.stop(group);
        self.afterChange();
      },
      fireNow: (i) => {
        if (!netLink.isHost || !self.battery.guns[i]?.present || !self.battery.guns[i].alive) return;
        self.tankTarget();
        self.send(self.battery.fire(i, self.target, 'full'));
        self.afterChange();
      },
      kill: (i) => {
        if (netLink.isHost && self.battery.kill(i)) self.afterChange();
      },
      canSee: (i) => {
        self.tankTarget();
        return self.battery.canSee(i, self.target, self.clear);
      },
      hold: (i, held) => {
        const g = self.battery.guns[i];
        if (!netLink.isHost || i < FIRST_TANK || !g) return;
        g.held = held;
      },
      place: (i, d) => {
        if (!netLink.isHost) return;
        self.battery.placeTank(i, d);
        self.afterChange();
      },
      shots: () => self.seen.map((s) => ({ ...s, from: [...s.from] as Vec3, to: [...s.to] as Vec3 })),
      meet: (i) => meetGun(i),
      meetTank: (j) => meetTank(j),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
      get signLine() {
        return self.sign.visible ? self.signLine : '';
      },
      tuning: () => ({ ...self.battery.tuning }),
    };
  }

  /** Host: the battery was started or stopped from outside (the scenario): show it, and forget kills on the way. */
  restarted(): void {
    this.pendingKills.length = 0;
    this.afterChange();
  }

  /** Host: start or stop a group. */
  setOn(on: boolean, group: EnemyGroup = 'guns'): void {
    if (!netLink.isHost) return;
    this.holdFire = false;
    if (on) this.battery.start(undefined, group);
    else this.battery.stop(group);
    this.pendingKills.length = 0;
    this.afterChange();
    console.info(`[Enemy] ${group} ${on ? 'started' : 'stopped'}`);
  }

  /** Host: Meet tank `j`: the tanks started if they aren't, it at its meeting place, the crew's tank parked where it will be seen. */
  meet(j: number): void {
    if (!netLink.isHost || !ENEMY_TANKS[j]) return;
    this.holdFire = false;
    if (!this.battery.groupOn('tanks')) {
      repairTank();
      resetTank('warm');
      this.setOn(true, 'tanks');
    }
    this.battery.placeTank(FIRST_TANK + j, ENEMY_TANKS[j].meetD);
    // It has the tank already (F3.10): Meet is for seeing it halt and fire.
    this.battery.spotNow(FIRST_TANK + j);
    this.afterChange();
    placeTank(0, ENEMY_TANKS[j].meetZ, 0);
  }

  /** Host: the battery changed; show it here (the guest hears it in update). */
  private afterChange(): void {
    this.applyShared(sharedOf(this.battery, noEnemies()));
  }

  /** Take the battery's shared state: what to draw, which enemies shells can hit, and notes for those started or knocked out. */
  private applyShared(s: EnemyShared): void {
    const was = this.shared;
    if (s.on && !was.on) this.seen.length = 0;
    for (const group of ['guns', 'tanks'] as const) {
      const before = sharedGroupOn(was, group);
      const now = sharedGroupOn(s, group);
      if (now && !before) this.note(group === 'guns' ? 'Enemy guns ahead: watch for their flashes' : 'Enemy tanks about: watch for them moving');
      if (!now || !before) continue;
      let knocked = false;
      let left = 0;
      let count = 0;
      for (let i = 0; i < ENEMY_COUNT; i++) {
        if (groupOf(i) !== group || !s.present[i]) continue;
        count++;
        if (s.alive[i]) left++;
        if (was.present[i] && was.alive[i] && !s.alive[i]) {
          this.note(`${enemyName(i)} knocked out`);
          knocked = true;
        }
      }
      if (knocked && left === 0) this.note(group === 'guns' ? `All ${count} guns knocked out` : count === 2 ? 'Both tanks knocked out' : `All ${count} tanks knocked out`);
    }
    for (let i = 0; i < ENEMY_COUNT; i++) {
      if (s.present[i] && !was.present[i]) this.revealed[i] = false;
      if (!netLink.isHost) this.along[i] = s.d[i];
    }
    was.on = s.on;
    was.present = [...s.present];
    was.alive = [...s.alive];
    was.d = [...s.d];
    was.moving = [...s.moving];
    was.hits = s.hits;
    was.shots = s.shots;
    was.v = s.v;
    this.applyFaces();
  }

  private faceOff(i: number): boolean {
    return !(this.shared.present[i] && this.shared.alive[i]);
  }

  private applyFaces(): void {
    for (let i = 0; i < ENEMY_COUNT; i++) setFaceOff(ENEMY_TARGET_FIRST + i, this.faceOff(i));
  }

  /** Whether tank `i` is driving on, as this page has it. */
  private moving(i: number): boolean {
    if (i < FIRST_TANK) return false;
    if (netLink.isHost) return this.battery.guns[i].present && this.battery.guns[i].alive && this.battery.guns[i].moving;
    return this.shared.present[i] && this.shared.alive[i] && this.shared.moving[i];
  }

  /** The tank as the enemies see it. */
  private tankTarget(): TankTarget {
    const t = tankState();
    this.target.x = t.x;
    this.target.z = t.z;
    this.target.ground = groundHeight(t.x, t.z);
    this.target.heading = t.heading;
    this.target.speed = t.speed;
    return this.target;
  }

  /** Host: an enemy fired; what a hit will do (F3.4), shown here and told to the guest. */
  private send(shot: EnemyShot): void {
    if (shot.hit) shot.damage = this.hitDamage(shot);
    this.show(shot);
    if (netLink.connected) {
      const event = { t: 'enemy-shot', ...shot, from: [...shot.from], to: [...shot.to] };
      netLink.sendEvent(event);
    }
  }

  /** Where a hit strikes the tank, through its armour or not, and what it does inside (src/sim/damage.ts). */
  private hitDamage(shot: EnemyShot): DamageHit {
    const t = tankState();
    this.tankPose.x = t.x;
    this.tankPose.z = t.z;
    this.tankPose.ground = groundHeight(t.x, t.z);
    this.tankPose.heading = t.heading;
    this.tankPose.turretYaw = turretState().yaw;
    return resolveDamage(shot.from, shot.to, shot.range, this.tankPose, this.damageRandom, this.battery.tuning.armour);
  }

  /** An enemy fired: its flash and dust now, its shell on the way. */
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
    if (first && !shot.hit) this.noteEnemy(shot.gun, false);
    console.info(`[Enemy] ${enemyName(shot.gun)} fired from ${Math.round(shot.range)} m: ${shot.hit ? 'hit' : 'miss'}`);
  }

  private note(text: string): void {
    this.notes.push({ text, gun: -1, hit: false });
  }

  /** A notice about enemy `gun` (it fired, or its shell hit): its clock, range and the gunner's traverse are worked out as it shows. */
  private noteEnemy(gun: number, hit: boolean): void {
    this.notes.push({ text: '', gun, hit });
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    const paused = netLink.connected && crewPresence.paused;
    if (netLink.isHost) this.host(dt, paused);
    this.driveTanks(dt, paused);
    this.draw(dt);
    this.drawSign(delta);
  }

  /** The host's part: step the battery, knock out enemies hit, and keep the guest told. */
  private host(dt: number, paused: boolean): void {
    // Knocked out (F3.4), the tank is out of the fight: the enemies hold their fire.
    if (!paused && this.battery.on && !damageState().out && !this.holdFire) {
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
      // The tanks' places as they are now, not as at the last change.
      sharedOf(this.battery, this.shared);
      const event = { t: 'enemy', ...this.shared };
      netLink.sendEvent(event);
      this.sentVersion = this.battery.version;
      this.sentAt = this.time;
    }
    this.wasConnected = netLink.connected;
  }

  /**
   * The tanks along their routes as this page draws them: the host's where
   * the battery has them; a guest's driven on between the host's messages.
   * Then each live tank's face for the crew's shells: its silhouette square
   * to the crew's tank, where an AP shell fired now would find it.
   */
  private driveTanks(dt: number, paused: boolean): void {
    const tank = tankState();
    for (let i = FIRST_TANK; i < ENEMY_COUNT; i++) {
      const route = ENEMY_TANKS[i - FIRST_TANK];
      if (netLink.isHost) this.along[i] = this.battery.guns[i].d;
      else if (!paused && this.moving(i)) this.along[i] = wrapRoute(route, this.along[i] + ENEMY_TANK.speed * dt);
      if (this.faceOff(i)) continue;
      gunNear(i, tank.x, tank.z, this.at, this.along[i]);
      const flight = Math.hypot(this.at[0] - tank.x, this.at[1] - tank.z) / AMMO.ap.speed;
      const ahead = this.moving(i) ? ENEMY_TANK.speed * flight : 0;
      setFacePose(ENEMY_TARGET_FIRST + i, tankFace(i, this.along[i], ahead, wrapTile(tank.x), wrapTile(tank.z), this.face));
    }
  }

  /** The enemies where they stand (each one's copy nearest the tank), their flashes, and the shells on their way. */
  private draw(dt: number): void {
    const tank = tankState();
    // The ground is drawn at the tank's position less whole tiles: world points are drawn that much nearer.
    const offX = tank.x - wrapTile(tank.x);
    const offZ = tank.z - wrapTile(tank.z);
    this.player.head.getWorldPosition(this.eye);
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const present = this.shared.present[i];
      const alive = this.shared.alive[i];
      const whole = this.whole[i];
      const wreck = this.wrecks[i];
      whole.visible = present && alive;
      wreck.visible = present && !alive;
      const flash = this.flashes[i];
      const dust = this.dusts[i];
      if (!present) {
        flash.visible = false;
        dust.visible = false;
        continue;
      }
      const [x, z] = gunNear(i, tank.x, tank.z, this.at, this.along[i]);
      this.drawnAt[i][0] = wrapTile(x);
      this.drawnAt[i][1] = wrapTile(z);
      const y = groundHeight(x, z);
      const toTank = Math.atan2(tank.x - x, tank.z - z);
      const mesh = alive ? whole : wreck;
      const since = this.time - this.firedAt[i];
      if (i < FIRST_TANK) {
        // A live gun turns its barrel towards the tank, within its traverse.
        let yaw = ENEMY_GUNS[i].yaw;
        if (alive) {
          const off = Math.atan2(Math.sin(toTank - yaw), Math.cos(toTank - yaw));
          yaw += Math.max(-TRAVERSE, Math.min(TRAVERSE, off));
        }
        mesh.position.set(x - offX, y, z - offZ);
        mesh.rotation.set(0, yaw, 0);
        this.muzzleAt(flash, dust, x - offX, y, z - offZ, yaw, MUZZLE[2], MUZZLE[1], since);
        continue;
      }
      // A tank faces along its route (its model's +Z), tilted to the ground under it; its turret turns on the crew's tank while it halts for it.
      routePose(ENEMY_TANKS[i - FIRST_TANK], this.along[i], this.pose);
      const hullYaw = this.pose.heading + Math.PI;
      const fx = Math.sin(hullYaw);
      const fz = Math.cos(hullYaw);
      const front = groundHeight(x + fx * PITCH_SPAN, z + fz * PITCH_SPAN);
      const rear = groundHeight(x - fx * PITCH_SPAN, z - fz * PITCH_SPAN);
      mesh.position.set(x - offX, y, z - offZ);
      mesh.rotation.set(Math.atan2(rear - front, 2 * PITCH_SPAN), hullYaw, 0);
      const turret = this.turrets[i];
      if (alive && turret) {
        const want = this.moving(i) ? 0 : Math.atan2(Math.sin(toTank - hullYaw), Math.cos(toTank - hullYaw));
        const off = Math.atan2(Math.sin(want - this.turretYaw[i]), Math.cos(want - this.turretYaw[i]));
        const step = TURRET_RATE * dt;
        this.turretYaw[i] += Math.max(-step, Math.min(step, off));
        turret.rotation.set(0, this.turretYaw[i], 0);
      }
      // The muzzle: the turret ring's place on the hull, then the barrel ahead along the turret.
      const ringX = x - offX + fx * TURRET_RING[2];
      const ringZ = z - offZ + fz * TURRET_RING[2];
      this.muzzleAt(flash, dust, ringX, y, ringZ, hullYaw + this.turretYaw[i], TANK_MUZZLE[2], TURRET_RING[1] + TANK_MUZZLE[1], since);
    }
    for (const slot of this.incoming) this.drawShell(slot, offX, offZ);
  }

  /** The flash at a muzzle `ahead` m along `yaw` from (x, z), `height` above the ground at y, its cone opening along the barrel, and the dust its blast raises. */
  private muzzleAt(flash: Mesh, dust: Mesh, x: number, y: number, z: number, yaw: number, ahead: number, height: number, since: number): void {
    flash.visible = since < FLASH.seconds;
    if (flash.visible) {
      flash.position.set(x + Math.sin(yaw) * ahead, y + height, z + Math.cos(yaw) * ahead);
      flash.rotation.set(0, yaw + Math.PI, 0);
      flash.scale.setScalar(FLASH.scale * this.seenScale(flash));
    }
    dust.visible = since < FLASH.grow + FLASH.fade;
    if (dust.visible) {
      const grow = since < FLASH.grow ? since / FLASH.grow : 1 - (since - FLASH.grow) / FLASH.fade;
      const out = ahead - 0.9;
      dust.position.set(x + Math.sin(yaw) * out, y + 0.6, z + Math.cos(yaw) * out);
      const s = Math.max(0.01, FLASH.dust * grow * this.seenScale(dust));
      dust.scale.set(s * 1.4, s * 0.7, s * 1.4);
    }
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
      slot.tracer.scale.set(thick, thick, Math.min(TRACER_LENGTH, Math.max(0.1, t * specOf(shot.gun).muzzleSpeed)));
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
        // The host takes the hit's damage as the shell gets there (F3.4).
        if (netLink.isHost && shot.damage) takeHit(shot.damage);
        this.noteEnemy(shot.gun, true);
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

  /**
   * The newest note on the sign in front of each player for a few seconds.
   * A notice about an enemy keeps its clock, range and (for the gunner) its
   * traverse live from the tank as it is now, not as it was when the enemy
   * fired: John's play test (14 November 2026) found the direction didn't
   * follow the tank.
   */
  private drawSign(delta: number): void {
    if (this.notes.length > 0) {
      const n = this.notes[this.notes.length - 1];
      this.notes.length = 0;
      this.signUntil = this.time + NOTE_SECONDS;
      this.noteGun = n.gun;
      this.noteHit = n.hit;
      this.drawnBearing.clock = -1;
      this.noteCall = null;
      if (n.gun < 0) this.paintSign(n.text, '', false);
      else this.enemyNotice();
      this.noteCall = crewLog.post(this.signText, n.gun < 0 ? (n.text.includes('knocked out') ? 'good' : 'info') : n.hit ? 'bad' : 'info');
      if (this.noteCall) crewLog.update(this.noteCall, this.signText, this.signLine);
      this.sign.setVisible(true, 'game');
      console.info(`[Enemy] sign: ${this.signText}${this.signLine ? ` (${this.signLine})` : ''}`);
    } else if (this.sign.visible && this.noteGun >= 0) {
      this.enemyNotice();
    }
    if (this.sign.visible && this.time > this.signUntil) {
      this.sign.setVisible(false);
      this.noteGun = -1;
      this.noteCall = null;
    }
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }

  /** The enemy notice from the tank as it is now, redrawn when its numbers change. */
  private enemyNotice(): void {
    const t = tankState();
    const b = enemyBearing(this.noteGun, t.x, t.z, t.heading, turretState().yaw, this.along[this.noteGun], this.bearing);
    const gunner = seating.mine === 'gunner';
    const was = this.drawnBearing;
    if (was.clock === b.clock && was.range === b.range && was.traverse === b.traverse && this.drawnGunner === gunner) return;
    was.clock = b.clock;
    was.range = b.range;
    was.traverse = b.traverse;
    this.drawnGunner = gunner;
    const [head, line] = enemyNoteLines(this.noteGun, this.noteHit, b, gunner);
    this.paintSign(head, line, this.noteHit);
    if (this.noteCall) crewLog.update(this.noteCall, head, line);
  }

  private paintSign(head: string, line: string, bad: boolean): void {
    this.signText = head;
    this.signLine = line;
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = bad ? '#ffb0a0' : '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(head, width / 2, line ? height / 2 - 6 : height / 2 + 14, width - 30);
    if (line) {
      ctx.fillStyle = '#f4ead8';
      ctx.font = '30px sans-serif';
      ctx.fillText(line, width / 2, height / 2 + 38, width - 30);
    }
    this.sign.refresh();
  }
}
