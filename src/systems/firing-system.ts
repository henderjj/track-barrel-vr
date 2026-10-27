import { createSystem, type Entity, type Mesh, Vector3 } from '@iwsdk/core';
import { createBurst, createTracer } from '../scene-assets/loading.scene-asset.js';
import {
  aimAt,
  createShotResult,
  describeShot,
  flyShell,
  hullDirToWorld,
  hullToWorld,
  MUZZLE_SPEED,
  RANGE_TARGET_NAMES,
  rangeFaces,
  shellAt,
  shellVelocity,
  type ShotResult,
  type Vec3,
} from '../sim/ballistics.js';
import { wrapTile } from '../sim/terrain.js';
import { barrelDirection, muzzlePoint } from '../sim/turret.js';
import { tankState } from './drive-system.js';
import { netLink } from './net-system.js';
import { aimTurret, turretState } from './turret-system.js';

/** Shots followed at once: a tracer and a burst each. A gun that loads in about 5 s never has more than one or two in the air. */
const SHOTS = 4;
/** The tracer's length behind the shell, m (about a hundredth of a second of flight), and how far away it stops growing thinner, m. */
const TRACER_LENGTH = 7;
const TRACER_FULL_SIZE = 40;
/** The burst where a shell lands: how big it gets (m), how long it takes to grow and then to die away, s. */
const BURST = { dirt: 1.6, hit: 1.2, grow: 0.12, fade: 0.7 } as const;
/** A burst stays at least this big as seen, for each this many metres away (a 1.6 m burst would be a dot at 500 m), m. */
const BURST_FULL_SIZE = 250;

/** One shot as both pages follow it. */
interface Shot {
  /** Its id: the firing page's count, odd from a guest, even from the host. Negative for a free slot. */
  id: number;
  origin: Vec3;
  dir: Vec3;
  /** Local time it left the muzzle, s. */
  firedAt: number;
  /** Where it goes, flown on this page for drawing (the host's word decides hits). */
  flight: ShotResult;
  /** Whether its burst has been set off. */
  landed: boolean;
  tracer: Mesh;
  burst: Mesh;
  hitBurst: Mesh;
}

/** What a shot's result says, kept for the board, the menu and the tests. */
export interface ShotRecord {
  id: number;
  kind: ShotResult['kind'];
  target: number;
  point: Vec3;
  time: number;
  line: string;
}

/** Things that want to hear of every shot, this page's or the crewmate's (LoadingSystem recoils the gun and throws the casing). */
export const shotListeners = new Set<(own: boolean) => void>();

/**
 * The host's word on every shot, its own page's or the crewmate's: the range
 * target it hit (an index into RANGE_TARGETS, or -1) and how long the shell
 * flies, s. Only the host hears these (F1.11's range run counts them).
 */
export const decidedListeners = new Set<(target: number, flight: number) => void>();

let active: FiringSystem | null = null;

/** The gunner's page fires the gun: the shell leaves the muzzle as this page draws the tank and turret. LoadingSystem calls it once the breech has fired. */
export function fireShell(): void {
  active?.fire();
}

/** The last shot's result as a line ("Hit: the 250 m gun", "Miss the 500 m tank: 20 m short"), or '' before any. */
export function lastShotLine(): string {
  return active?.records[active.records.length - 1]?.line ?? '';
}

/** One line for the menu: shots, hits and the last result. */
export function firingStatus(): string {
  const a = active;
  if (a == null || a.records.length === 0) return 'No shots yet';
  const hits = a.hits.reduce((n, h) => n + h, 0);
  return `${a.records.length} shots, ${hits} hits. ${lastShotLine()}`;
}

interface FiringDebug {
  /** Every shot's result so far, oldest first (on a guest, as the host decided it). */
  records(): ShotRecord[];
  /** Hits on each range target (the host counts; a guest copies its word). */
  hits(): number[];
  /** Shots in the air now. */
  flying(): number;
  /** Fire a shell as if the breech had fired (tests): it leaves the muzzle as the turret is laid. */
  fire(): void;
  /** Where a shell from the muzzle as laid now would land, world space, and what it would hit. */
  predict(): ShotRecord;
  /** Lay the gun on range target `i` from where the tank stands (tests; the page that owns the turret). */
  aimAt(i: number): { yaw: number; elevation: number };
  readonly sent: number;
  readonly received: number;
}

/**
 * Firing (F1.10, docs/loading-firing.md): the shell's flight, its tracer
 * and where it lands. The gunner's page fires (LoadingSystem calls
 * fireShell when the trigger fires a loaded breech): the shell leaves the
 * muzzle as that page draws the tank and turret, so it goes where the
 * gunner aimed, and the shot goes to the other page as a reliable `shot`
 * event with its origin and direction in world space.
 *
 * Both pages fly every shot (src/sim/ballistics.ts is deterministic) and
 * draw its tracer and the burst where it lands; the host alone decides what
 * it hit and counts hits (plan §4.6), and tells a guest with `shot-hit`.
 * The tracers and bursts are children of the ground, so they stay put in
 * the world as the tank drives. Runs after TurretSystem and LoadingSystem.
 */
export class FiringSystem extends createSystem({}) {
  readonly records: ShotRecord[] = [];
  readonly hits: number[] = rangeFaces().map(() => 0);
  private faces = rangeFaces();
  private shots: Shot[] = [];
  private count = 0;
  private time = 0;
  private sent = 0;
  private received = 0;
  private ground: Entity | null = null;
  private p: Vec3 = [0, 0, 0];
  private v: Vec3 = [0, 0, 0];
  private hull: Vec3 = [0, 0, 0];
  private dir = new Vector3();
  private back = new Vector3(0, 0, 1);
  private eye = new Vector3();
  private at = new Vector3();

  init(): void {
    active = this;
    const ground = this.world.getSceneEntity('ground') ?? null;
    if (ground == null) console.warn('[Firing] no ground in the scene');
    this.ground = ground ?? null;
    for (let i = 0; i < SHOTS; i++) {
      const tracer = createTracer();
      const burst = createBurst(false);
      const hitBurst = createBurst(true);
      for (const mesh of [tracer, burst, hitBurst]) {
        mesh.visible = false;
        mesh.frustumCulled = false;
        if (ground) this.world.createTransformEntity(mesh, { parent: ground });
      }
      this.shots.push({ id: -1, origin: [0, 0, 0], dir: [0, 0, -1], firedAt: 0, flight: createShotResult(), landed: true, tracer, burst, hitBurst });
    }

    netLink.events.set('shot', (e) => this.onShot(e));
    netLink.events.set('shot-hit', (e) => this.onShotHit(e));
    this.cleanupFuncs.push(
      () => netLink.events.delete('shot'),
      () => netLink.events.delete('shot-hit'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __firing: FiringDebug }).__firing = {
      records: () => self.records.map((r) => ({ ...r, point: [...r.point] as Vec3 })),
      hits: () => [...self.hits],
      flying: () => self.shots.filter((s) => s.id >= 0 && !s.landed).length,
      fire: () => self.fire(),
      predict: () => {
        const origin: Vec3 = [0, 0, 0];
        const dir: Vec3 = [0, 0, 0];
        self.aimNow(origin, dir);
        const result = flyShell(origin, dir, self.faces, createShotResult());
        return self.record(-1, result, origin, dir);
      },
      aimAt: (i) => {
        const aim = aimAt(tankState(), self.faces[i], muzzlePoint);
        aimTurret(aim.yaw, aim.elevation);
        return aim;
      },
      get sent() { return self.sent; },
      get received() { return self.received; },
    };
  }

  /** The gun fires on this page: from the muzzle as drawn, along the bore. */
  fire(): void {
    const id = 2 * this.count++ + (netLink.isHost ? 0 : 1);
    const shot = this.start(id, this.time);
    if (shot == null) return;
    this.aimNow(shot.origin, shot.dir);
    this.fly(shot);
    if (netLink.connected) {
      const event = { t: 'shot', id, o: [...shot.origin], d: [...shot.dir] };
      netLink.sendEvent(event);
      this.sent++;
    }
    for (const listener of shotListeners) listener(true);
    if (netLink.isHost) this.decide(shot);
    console.info(`[Firing] shot ${id} from (${shot.origin.map((v) => v.toFixed(1)).join(', ')})`);
  }

  /** Where the shell leaves from and which way, world space, as this page draws the tank and the turret. */
  private aimNow(origin: Vec3, dir: Vec3): void {
    const turret = turretState();
    const tank = tankState();
    hullToWorld(tank, muzzlePoint(turret.yaw, turret.elevation, this.hull), origin);
    hullDirToWorld(tank, barrelDirection(turret.yaw, turret.elevation, this.hull), dir);
  }

  /** The crewmate's gun fired. */
  private onShot(e: Record<string, unknown>): void {
    const id = Number(e.id);
    const o = e.o as number[] | undefined;
    const d = e.d as number[] | undefined;
    if (!Number.isFinite(id) || !Array.isArray(o) || !Array.isArray(d) || o.length !== 3 || d.length !== 3) return;
    this.received++;
    const shot = this.start(id, this.time);
    if (shot == null) return;
    for (let k = 0; k < 3; k++) {
      shot.origin[k] = Number(o[k]);
      shot.dir[k] = Number(d[k]);
    }
    this.fly(shot);
    for (const listener of shotListeners) listener(false);
    if (netLink.isHost) this.decide(shot);
  }

  /** The host's word on a guest's or its own shot. */
  private onShotHit(e: Record<string, unknown>): void {
    if (netLink.isHost) return;
    const p = e.p as number[] | undefined;
    const kind = e.kind === 'target' || e.kind === 'ground' ? e.kind : 'none';
    const target = Number(e.target);
    const result = createShotResult();
    result.kind = kind;
    result.target = kind === 'target' && target >= 0 && target < this.hits.length ? target : -1;
    if (Array.isArray(p) && p.length === 3) for (let k = 0; k < 3; k++) result.point[k] = Number(p[k]);
    result.time = Number(e.time) || 0;
    const shot = this.shots.find((s) => s.id === Number(e.id));
    if (result.target >= 0) this.hits[result.target] = Number(e.hits) || this.hits[result.target] + 1;
    this.record(Number(e.id), result, shot?.origin ?? result.point, shot?.dir ?? [0, 0, -1]);
  }

  /** The host decides what a shot hit, counts it, and tells the guest. */
  private decide(shot: Shot): void {
    const result = shot.flight;
    if (result.kind === 'target') this.hits[result.target]++;
    this.record(shot.id, result, shot.origin, shot.dir);
    for (const listener of decidedListeners) listener(result.kind === 'target' ? result.target : -1, result.time);
    if (netLink.connected) {
      const event = {
        t: 'shot-hit',
        id: shot.id,
        kind: result.kind,
        target: result.target,
        hits: result.target >= 0 ? this.hits[result.target] : 0,
        p: [...result.point],
        time: result.time,
      };
      netLink.sendEvent(event);
    }
  }

  private record(id: number, result: ShotResult, origin: Readonly<Vec3>, dir: Readonly<Vec3>): ShotRecord {
    const record: ShotRecord = {
      id,
      kind: result.kind,
      target: result.target,
      point: [...result.point] as Vec3,
      time: result.time,
      line: describeShot(result, origin, dir, this.faces, RANGE_TARGET_NAMES),
    };
    if (id >= 0) {
      this.records.push(record);
      if (this.records.length > 50) this.records.shift();
      console.info(`[Firing] shot ${id}: ${record.line}`);
    }
    return record;
  }

  /** A free slot for a new shot (the oldest if all are busy). */
  private start(id: number, time: number): Shot | null {
    let shot = this.shots.find((s) => s.id < 0 || (s.landed && time - s.firedAt - s.flight.time > BURST.grow + BURST.fade));
    if (shot == null) shot = this.shots.reduce((a, b) => (a.firedAt < b.firedAt ? a : b));
    shot.id = id;
    shot.firedAt = time;
    shot.landed = false;
    shot.burst.visible = false;
    shot.hitBurst.visible = false;
    return shot;
  }

  private fly(shot: Shot): void {
    flyShell(shot.origin, shot.dir, this.faces, shot.flight);
  }

  update(delta: number): void {
    this.time += Math.min(delta, 0.25);
    const tank = tankState();
    // The ground is drawn at the tank's position less whole tiles: world points are drawn that much nearer.
    const offX = tank.x - wrapTile(tank.x);
    const offZ = tank.z - wrapTile(tank.z);
    this.player.head.getWorldPosition(this.eye);
    for (const shot of this.shots) {
      if (shot.id < 0) continue;
      const t = this.time - shot.firedAt;
      const end = shot.flight.time;
      if (!shot.landed && t >= end) {
        shot.landed = true;
        shot.tracer.visible = false;
      }
      if (!shot.landed) this.drawTracer(shot, t, offX, offZ);
      else this.drawBurst(shot, t - end, offX, offZ);
    }
  }

  private drawTracer(shot: Shot, t: number, offX: number, offZ: number): void {
    const p = shellAt(shot.origin, shot.dir, t, this.p);
    const v = shellVelocity(shot.dir, t, this.v);
    const tracer = shot.tracer;
    tracer.position.set(p[0] - offX, p[1], p[2] - offZ);
    this.dir.set(v[0], v[1], v[2]).normalize();
    // The rod runs back from the shell along -Z of its own: point its +Z along the flight.
    tracer.quaternion.setFromUnitVectors(this.back, this.dir);
    const flown = t * MUZZLE_SPEED;
    tracer.getWorldPosition(this.at);
    const thick = Math.max(1, this.at.distanceTo(this.eye) / TRACER_FULL_SIZE);
    tracer.scale.set(thick, thick, Math.min(TRACER_LENGTH, Math.max(0.1, flown)));
    tracer.visible = true;
  }

  private drawBurst(shot: Shot, since: number, offX: number, offZ: number): void {
    const hit = shot.flight.kind === 'target';
    const mesh = hit ? shot.hitBurst : shot.burst;
    if (shot.flight.kind === 'none' || since > BURST.grow + BURST.fade) {
      if (mesh.visible) mesh.visible = false;
      return;
    }
    const size = hit ? BURST.hit : BURST.dirt;
    const grow = since < BURST.grow ? since / BURST.grow : 1 - (since - BURST.grow) / BURST.fade;
    const p = shot.flight.point;
    mesh.position.set(p[0] - offX, p[1], p[2] - offZ);
    mesh.getWorldPosition(this.at);
    const seen = Math.max(1, this.at.distanceTo(this.eye) / BURST_FULL_SIZE);
    const s = Math.max(0.01, size * grow * seen);
    mesh.scale.set(s, s * 0.8, s);
    mesh.visible = true;
  }
}
