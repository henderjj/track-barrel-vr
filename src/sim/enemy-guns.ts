/**
 * Enemy anti-tank guns (F3.2, docs/enemy-guns.md): three guns dug in round
 * the range that spot the tank, lay on it and fire, and that the crew can
 * knock out with AP on the shield or an HE burst beside it.
 *
 * Engine-free and deterministic for a seed: the host runs a battery
 * (EnemyBattery), the guest only shows what the host sends, and the tests
 * drive it directly. World space as src/sim/range.ts: x and z tile-local
 * (the ground repeats every TILE), heights above the ground.
 */

import type { HitFace, Vec3 } from './ballistics.js';
import { type CombatTuning, DEFAULT_TUNING, SPOTTING, spotRate, type TankView } from './combat.js';
import { DAMAGE, type DamageHit, parseHit } from './damage.js';
import { ENEMY_TANK, ENEMY_TANKS, type RoutePose, routePose, wrapRoute } from './enemy-tanks.js';
import { rng } from './random.js';
import { groundHeight, OBSTACLES, wrapTile } from './terrain.js';
import { clockHour } from './turret-dial.js';

/**
 * A gun's spot: its name, where it stands (tile-local), which way its
 * barrel faces (rad, the model's +Z turned by yaw), and where up the lane
 * (z, at x 0) it first has the tank in sight: Combat → Meet parks there.
 */
export interface EnemyGunSpot {
  name: string;
  x: number;
  z: number;
  yaw: number;
  meetZ: number;
}

/** The yaw that turns a model's +Z from (x, z) towards (tx, tz), as targetYaw does for the range's boards. */
function facing(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

function spot(name: string, x: number, z: number, coverX: number, coverZ: number, meetZ: number): EnemyGunSpot {
  return { name, x, z, yaw: facing(x, z, coverX, coverZ), meetZ };
}

/**
 * The three guns, in the order the tank driving up the lane from its start
 * comes into their sight, all dug in on the lane's left (the right is too
 * open to hide a gun from the start): A out at about 240 m, seeing the lane
 * from 80 m up it; B further up at about 230 m, from 160 m up; C close to
 * the lane, about 120 m off, from 240 m up. None sees the start; each stands
 * on open ground clear of the obstacles, with no rise between it and the
 * lane where it first sees the tank, so its whole shield is in the crew's
 * view (test/enemy-guns.test.ts).
 */
export const ENEMY_GUNS: readonly EnemyGunSpot[] = [
  spot('Gun A', -200, -220, 0, -120, -80),
  spot('Gun B', -90, -370, 0, -220, -160),
  spot('Gun C', -110, -280, 0, -260, -240),
];

/** The guns' numbers. */
export const ENEMY_GUN = {
  /** A 75 mm anti-tank gun's AP, m/s (the PaK 40's 790). */
  muzzleSpeed: 790,
  /** It spots the tank this far away and nearer, with a clear line, m: inside the fog's far edge (FOG.far 780). */
  spotRange: 600,
  /** How often it looks, s. */
  lookEvery: 0.25,
  /** From spotting the tank to the first shot, s: traversing, laying and the order to fire (6 before F3.10's tuning). */
  layFirst: 8,
  /** Between shots, s: an aimed rate, slowed for play (8 before F3.10). */
  reload: 10,
  /** Out of sight this long it loses the tank and must lay afresh when it sees it again, s. */
  loseAfter: 3,
  /** Its muzzle above the ground, m. */
  muzzleHeight: 0.95,
  /** The spread of its shots, mils (1 m at 1,000 m), whatever the laying. */
  dispersion: 0.4,
  /**
   * The layer's error on this sighting's first, second, third and later
   * shots, mils: it corrects by the fall of each shot. F3.10 widened it from
   * 8, 4, 2 (a stationary Sherman side-on at 250 m hit by about one first
   * shot in seven, half the third, nearly every one after; see
   * docs/combat-scenario.md).
   */
  layError: [16, 9, 5, 3] as readonly number[],
  /** How well it leads a moving tank: aims this share of the way it will move while the shell flies. */
  lead: 0.8,
  /** And its spread grows by this share of how far the tank moves while the shell flies. */
  leadError: 1,
} as const;

/**
 * Every enemy the battery runs: the three guns first, then the tanks
 * (F3.3, src/sim/enemy-tanks.ts). An enemy's index here is its index in
 * the battery, in shots, and (after ENEMY_TARGET_FIRST) among the shells'
 * targets.
 */
export const ENEMY_COUNT = ENEMY_GUNS.length + ENEMY_TANKS.length;
/** Where the tanks start among the enemies. */
export const FIRST_TANK = ENEMY_GUNS.length;

/** The two kinds of enemy, started and stopped apart: Combat → Enemy guns, Combat → Enemy tanks. */
export type EnemyGroup = 'guns' | 'tanks';

/** Which group enemy `i` is in. */
export function groupOf(i: number): EnemyGroup {
  return i >= FIRST_TANK ? 'tanks' : 'guns';
}

/** Enemy `i`'s name: "Gun A", "Tank B". */
export function enemyName(i: number): string {
  return i >= FIRST_TANK ? (ENEMY_TANKS[i - FIRST_TANK]?.name ?? '') : (ENEMY_GUNS[i]?.name ?? '');
}

/** How an enemy looks, lays and fires: a gun's numbers, or a tank's. */
export interface EnemySpec {
  muzzleSpeed: number;
  spotRange: number;
  lookEvery: number;
  layFirst: number;
  reload: number;
  loseAfter: number;
  muzzleHeight: number;
  dispersion: number;
  layError: readonly number[];
  lead: number;
  leadError: number;
}

const TANK_SPEC: EnemySpec = {
  ...ENEMY_GUN,
  muzzleSpeed: ENEMY_TANK.muzzleSpeed,
  spotRange: ENEMY_TANK.spotRange,
  layFirst: ENEMY_TANK.layFirst,
  reload: ENEMY_TANK.reload,
  loseAfter: ENEMY_TANK.loseAfter,
  muzzleHeight: ENEMY_TANK.muzzleHeight,
};

/** Enemy `i`'s numbers. */
export function specOf(i: number): EnemySpec {
  return i >= FIRST_TANK ? TANK_SPEC : ENEMY_GUN;
}

/** The gun's shield, the face a shell hits it on: half its width and height, and its middle above the ground, m. */
export const GUN_SHIELD = { halfWidth: 1.05, halfHeight: 0.62, middle: 0.82 } as const;

/**
 * The tank as the guns aim at it: its hull's width and length, its height
 * to the turret's top above the ground, and the height they aim at, m; and
 * (F3.10) its turret's width seen from any side, over the hull's top
 * (DAMAGE.hullTop): a shell above the hull and wide of the turret misses.
 */
export const TANK_SILHOUETTE = { width: 2.62, length: 5.84, height: 2.74, aim: 1.37, turret: 2.3 } as const;

/** Where an enemy looks for the hull (F3.10): this high above the ground, about its middle, m. Over cover too high to see it, only the turret shows. */
export const HULL_SIGHT = 1.1;

/** The guns' shields as faces a shell hits (ballistics' targetFaces appends them), at the copy in the tile round the start. */
export function enemyGunFaces(): HitFace[] {
  return ENEMY_GUNS.map((g) => ({
    x: g.x,
    y: groundHeight(g.x, g.z) + GUN_SHIELD.middle,
    z: g.z,
    halfWidth: GUN_SHIELD.halfWidth,
    halfHeight: GUN_SHIELD.halfHeight,
    yaw: g.yaw,
  }));
}

const pose: RoutePose = { x: 0, z: 0, heading: 0 };

/** Enemy `i`'s copy nearest (x, z), world x and z, into `out`: a gun where it stands, a tank `d` m along its route. */
export function gunNear(i: number, x: number, z: number, out: [number, number], d = 0): [number, number] {
  let ex: number;
  let ez: number;
  if (i >= FIRST_TANK) {
    routePose(ENEMY_TANKS[i - FIRST_TANK], d, pose);
    ex = pose.x;
    ez = pose.z;
  } else {
    ex = ENEMY_GUNS[i].x;
    ez = ENEMY_GUNS[i].z;
  }
  out[0] = x + wrapTile(ex - x);
  out[1] = z + wrapTile(ez - z);
  return out;
}

/**
 * Enemy `i`'s muzzle nearest the tank at (x, z), world space, into `out`:
 * a gun's where it stands; a tank's (`d` m along its route) its turret
 * turned on the tank, the muzzle ahead of it.
 */
export function muzzleNear(i: number, x: number, z: number, out: Vec3, d = 0): Vec3 {
  const at = gunNear(i, x, z, [0, 0], d);
  out[0] = at[0];
  out[2] = at[1];
  if (i >= FIRST_TANK) {
    const dx = x - at[0];
    const dz = z - at[1];
    const n = Math.hypot(dx, dz) || 1;
    out[0] += (dx / n) * ENEMY_TANK.muzzleAhead;
    out[2] += (dz / n) * ENEMY_TANK.muzzleAhead;
  }
  out[1] = groundHeight(at[0], at[1]) + specOf(i).muzzleHeight;
  return out;
}

/**
 * Tank `i` (an enemy index) as a face for the crew's shells, seen from
 * (fromX, fromZ): its silhouette as it shows that way, its front, side or
 * between, square to the line of sight, `ahead` m on along its route (where
 * a shell fired now finds it), into `out`.
 */
export function tankFace(i: number, d: number, ahead: number, fromX: number, fromZ: number, out: HitFace): HitFace {
  routePose(ENEMY_TANKS[i - FIRST_TANK], d + ahead, pose);
  const dx = wrapTile(fromX - pose.x);
  const dz = wrapTile(fromZ - pose.z);
  const yaw = Math.atan2(dx, dz);
  // Its hull's along (-sin h, -cos h) and the line of sight's angle to it.
  const rel = yaw - Math.atan2(-Math.sin(pose.heading), -Math.cos(pose.heading));
  out.x = pose.x;
  out.z = pose.z;
  out.y = groundHeight(pose.x, pose.z) + ENEMY_TANK.height / 2;
  out.halfWidth = 0.5 * (Math.abs(Math.cos(rel)) * ENEMY_TANK.width + Math.abs(Math.sin(rel)) * ENEMY_TANK.length);
  out.halfHeight = ENEMY_TANK.height / 2;
  out.yaw = yaw;
  return out;
}

/** The tanks as faces for the shells, at their routes' starts facing the range's start (EnemySystem turns them each frame). */
export function enemyTankFaces(): HitFace[] {
  return ENEMY_TANKS.map((_, j) => tankFace(FIRST_TANK + j, 0, 0, 0, 0, { x: 0, y: 0, z: 0, halfWidth: 0, halfHeight: 0, yaw: 0 }));
}

/** The ground blocks the line from a to b (world space): it stands above the line anywhere along it, sampled every `step` m. */
export function groundBlocks(a: Readonly<Vec3>, b: Readonly<Vec3>, step = 8): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const n = Math.max(2, Math.ceil(Math.hypot(dx, dz) / step));
  // Not the ends: each stands on the ground.
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (groundHeight(a[0] + dx * t, a[2] + dz * t) > a[1] + dy * t) return true;
  }
  return false;
}

/**
 * A house, wall or rock stands above the line from a to b (world space,
 * F3.10): the line crosses its footprint (its copy nearest the line's
 * middle) lower than its top anywhere there. Walls (1 to 1.6 m) hide a
 * tank's hull but not its turret; houses hide all of it.
 */
export function obstaclesBlock(a: Readonly<Vec3>, b: Readonly<Vec3>): boolean {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const midX = (a[0] + b[0]) / 2;
  const midZ = (a[2] + b[2]) / 2;
  const half = Math.hypot(dx, dz) / 2;
  for (const o of OBSTACLES) {
    const ox = midX + wrapTile(o.x - midX);
    const oz = midZ + wrapTile(o.z - midZ);
    // Too far from the line's middle to touch it.
    if (Math.hypot(ox - midX, oz - midZ) > half + o.r) continue;
    // The line in the obstacle's own axes, from its middle (as obstacleDistance turns them).
    const c = Math.cos(o.yaw);
    const sn = Math.sin(o.yaw);
    const ax = a[0] - ox;
    const az = a[2] - oz;
    let t0 = 0;
    let t1 = 1;
    if (o.kind === 'rock') {
      // Where the line is inside its circle: |a + t d|² = r².
      const qa = dx * dx + dz * dz;
      const qb = 2 * (ax * dx + az * dz);
      const qc = ax * ax + az * az - o.r * o.r;
      const disc = qb * qb - 4 * qa * qc;
      if (qa < 1e-9 || disc < 0) continue;
      const root = Math.sqrt(disc);
      t0 = Math.max(0, (-qb - root) / (2 * qa));
      t1 = Math.min(1, (-qb + root) / (2 * qa));
    } else {
      // Clip the line to the box, one pair of faces at a time.
      const lax = ax * c - az * sn;
      const laz = ax * sn + az * c;
      const ldx = dx * c - dz * sn;
      const ldz = dx * sn + dz * c;
      for (const [p, d, h] of [
        [lax, ldx, o.hx],
        [laz, ldz, o.hz],
      ] as const) {
        if (Math.abs(d) < 1e-9) {
          if (Math.abs(p) > h) t1 = -1;
          continue;
        }
        const u0 = (-h - p) / d;
        const u1 = (h - p) / d;
        t0 = Math.max(t0, Math.min(u0, u1));
        t1 = Math.min(t1, Math.max(u0, u1));
      }
    }
    if (t1 < t0) continue;
    // The line is straight, so it is lowest over the footprint at one of the ends of that stretch.
    const top = groundHeight(ox, oz) + o.height;
    const low = Math.min(a[1] + (b[1] - a[1]) * t0, a[1] + (b[1] - a[1]) * t1);
    if (low < top) return true;
  }
  return false;
}

/** The clock direction from a tank at heading `heading` to a point (dx, dz) from it, 12 ahead, as the crew calls it. */
export function clockTo(heading: number, dx: number, dz: number): number {
  return clockHour(Math.atan2(-dx, -dz) - heading);
}

/** The tank as a gun sees it. */
export interface TankTarget {
  x: number;
  /** The ground under it, m (world y). */
  ground: number;
  z: number;
  heading: number;
  /** Along its heading, m/s. */
  speed: number;
}

/** One enemy's state, a gun's or a tank's. */
export interface EnemyGunState {
  /** Its group is started: it is there (drawn, and among the shells' targets while alive). */
  present: boolean;
  alive: boolean;
  /** It sees the tank now (as of its last look): something of it shows, with a clear line. */
  sees: boolean;
  /** What of the tank it sees (F3.10): all of it, only its turret over cover, or nothing. */
  view: TankView;
  /** How far it has got to spotting the tank (F3.10): 1 is spotted; it lays and fires only then. */
  spot: number;
  /** It has the tank: laying on it, or laid; out of sight for loseAfter it loses it. */
  tracking: boolean;
  /** Until its next shot can go, s. */
  ready: number;
  /** Out of sight for this long, s. */
  blind: number;
  /** Shots fired on this sighting (its layer corrects with each). */
  shots: number;
  /** Until its next look, s. */
  look: number;
  /** It has fired at least once since the battery started: the crew has seen its flash. */
  revealed: boolean;
  /** A tank: how far along its route there and back, m, and whether it is driving on (it halts while it has the crew's tank). */
  d: number;
  moving: boolean;
  /** A tank held where it is (tests). */
  held: boolean;
}

/** A shot a gun fired: from its muzzle to where the shell went (world space), whether it hit the tank, and how long it flies, s. */
export interface EnemyShot {
  gun: number;
  from: Vec3;
  to: Vec3;
  hit: boolean;
  flight: number;
  /** Where the gun is from the tank, as a clock direction, and how far, m. */
  clock: number;
  range: number;
  /** A hit: where it struck and what it did (F3.4), decided by the host as it fires. */
  damage?: DamageHit;
}

/** What a gun's eyes check besides range and the ground: the smoke (the battery is engine-free, so the caller says). */
export type SightCheck = (from: Readonly<Vec3>, to: Readonly<Vec3>) => boolean;

/** A standard normal number from `random`. */
function normal(random: () => number): number {
  const u = Math.max(1e-12, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * The battery: the three guns and the two tanks (F3.3), what they see,
 * where the tanks drive and when they fire. The host steps it; a group not
 * started is gone (not drawn, not hit). A shell that kills one calls
 * kill().
 */
export class EnemyBattery {
  readonly guns: EnemyGunState[] = Array.from({ length: ENEMY_COUNT }, () => EnemyBattery.freshGun());
  /** Hits the tank has taken, and shots fired at it, since it was started. */
  hits = 0;
  shotsFired = 0;
  /** The fight's tuning (F3.10, src/sim/combat.ts): spotting, aim, reactions, the tank's size. */
  tuning: CombatTuning = { ...DEFAULT_TUNING };
  /** Since the crew last fired, s (F3.10): its flash gives the tank away. */
  crewFiredAgo = Infinity;
  /** Bumped on every change both pages must agree on (on, alive, hits). */
  version = 0;
  private random: () => number;
  private readonly muzzle: Vec3 = [0, 0, 0];
  private readonly at: [number, number] = [0, 0];
  private readonly eye: Vec3 = [0, 0, 0];
  private readonly hull: Vec3 = [0, 0, 0];
  private readonly situation = { range: 0, view: 'none' as TankView, moving: false, fired: false, alert: false, driving: false };

  constructor(seed = 7531, tuning: Readonly<CombatTuning> = DEFAULT_TUNING) {
    this.random = rng(seed);
    this.tuning = { ...tuning };
  }

  private static freshGun(): EnemyGunState {
    return { present: false, alive: true, sees: false, view: 'none', spot: 0, tracking: false, ready: 0, blind: 0, shots: 0, look: 0, revealed: false, d: 0, moving: true, held: false };
  }

  /** Any group is started. */
  get on(): boolean {
    return this.guns.some((g) => g.present);
  }

  /** Whether `group` is started. */
  groupOn(group: EnemyGroup): boolean {
    return this.guns.some((g, i) => g.present && groupOf(i) === group);
  }

  /**
   * Start (or restart) a group, the guns unless said: each of them there and
   * alive, none yet seeing the tank, the tanks at their routes' starts.
   * Starting with nothing else running counts hits and shots afresh.
   */
  start(seed?: number, group: EnemyGroup = 'guns'): void {
    if (seed !== undefined) this.random = rng(seed);
    if (!this.on) {
      this.hits = 0;
      this.shotsFired = 0;
      this.crewFiredAgo = Infinity;
    }
    for (let i = 0; i < this.guns.length; i++) {
      if (groupOf(i) !== group) continue;
      this.guns[i] = EnemyBattery.freshGun();
      this.guns[i].present = true;
    }
    this.version++;
  }

  /** Stop a group, or every enemy. */
  stop(group?: EnemyGroup): void {
    let changed = false;
    this.guns.forEach((g, i) => {
      if (!g.present || (group && groupOf(i) !== group)) return;
      g.present = false;
      changed = true;
    });
    if (changed) this.version++;
  }

  /** Put tank `i` (an enemy index) `d` m along its route (Combat → Meet). */
  placeTank(i: number, d: number): void {
    const g = this.guns[i];
    if (i < FIRST_TANK || !g) return;
    g.d = wrapRoute(ENEMY_TANKS[i - FIRST_TANK], d);
    this.version++;
  }

  /** The crew fired (F3.10): for a while its flash makes the tank quick to spot. */
  crewFired(): void {
    this.crewFiredAgo = 0;
  }

  /** Enemy `i` has spotted the tank already (Combat → Meet, which parks the tank where it is waiting for it). */
  spotNow(i: number): void {
    const g = this.guns[i];
    if (g) g.spot = 1;
  }

  /** Whether any enemy there and alive has the tank (laying on it or laid). */
  spotted(): boolean {
    return this.guns.some((g) => g.present && g.alive && g.tracking);
  }

  /** A shell knocked enemy `i` out. Returns whether it was there and alive. */
  kill(i: number): boolean {
    const g = this.guns[i];
    if (!g?.present || !g.alive) return false;
    g.alive = false;
    g.tracking = false;
    g.sees = false;
    g.moving = false;
    this.version++;
    return true;
  }

  /** Enemies there and still in action, of a group or all. */
  alive(group?: EnemyGroup): number {
    return this.guns.filter((g, i) => g.present && g.alive && (!group || groupOf(i) === group)).length;
  }

  /** Whether enemy `i` (alive) could see the tank now: in range, the ground, the houses, walls and rocks (F3.10) and `clear` (the smoke) letting a line through to some of it. */
  canSee(i: number, tank: Readonly<TankTarget>, clear: SightCheck): boolean {
    return this.viewOf(i, tank, clear) !== 'none';
  }

  /**
   * What of the tank enemy `i` sees now (F3.10): within its spot range, a
   * clear line to its hull (all of it), or only to its turret's top (hull
   * down behind a crest or a wall), or neither.
   */
  viewOf(i: number, tank: Readonly<TankTarget>, clear: SightCheck): TankView {
    const m = muzzleNear(i, tank.x, tank.z, this.muzzle, this.guns[i].d);
    if (Math.hypot(tank.x - m[0], tank.z - m[2]) > specOf(i).spotRange) return 'none';
    const open = (to: Vec3) => !groundBlocks(m, to) && !obstaclesBlock(m, to) && clear(m, to);
    this.hull[0] = tank.x;
    this.hull[1] = tank.ground + HULL_SIGHT;
    this.hull[2] = tank.z;
    if (open(this.hull)) return 'full';
    // Its eye on the tank's turret top, a little under it.
    this.eye[0] = tank.x;
    this.eye[1] = tank.ground + TANK_SILHOUETTE.height - 0.3;
    this.eye[2] = tank.z;
    return open(this.eye) ? 'turret' : 'none';
  }

  /**
   * `dt` seconds on: each enemy looks every lookEvery, takes the tank when
   * it sees it, lays for layFirst and fires every reload while it still
   * sees it; out of sight loseAfter, it loses it. A tank drives along its
   * route while it hasn't the tank, and halts while it has. Shots fired go
   * into `out` (cleared first); returns how many.
   */
  step(dt: number, tank: Readonly<TankTarget>, clear: SightCheck, out: EnemyShot[]): number {
    out.length = 0;
    this.crewFiredAgo += dt;
    const alert = this.shotsFired > 0;
    for (let i = 0; i < this.guns.length; i++) {
      const g = this.guns[i];
      if (!g.present || !g.alive) continue;
      const spec = specOf(i);
      g.look -= dt;
      if (g.look <= 0) {
        g.look += spec.lookEvery;
        if (g.look <= 0) g.look = spec.lookEvery;
        g.view = this.viewOf(i, tank, clear);
        g.sees = g.view !== 'none';
      }
      // Spotting (F3.10): seeing it builds up to spotting it; out of sight, that fades.
      if (g.sees && g.spot < 1) {
        const s = this.situation;
        gunNear(i, tank.x, tank.z, this.at, g.d);
        s.range = Math.hypot(tank.x - this.at[0], tank.z - this.at[1]);
        s.view = g.view;
        s.moving = Math.abs(tank.speed) > SPOTTING.movingSpeed;
        s.fired = this.crewFiredAgo < SPOTTING.firedFor;
        s.alert = alert;
        s.driving = i >= FIRST_TANK && g.moving;
        g.spot = Math.min(1, g.spot + spotRate(s, this.tuning.spot) * dt);
      } else if (!g.sees) {
        g.spot = Math.max(0, g.spot - SPOTTING.forget * dt);
      }
      if (g.sees && g.spot >= 1) {
        g.blind = 0;
        if (!g.tracking) {
          g.tracking = true;
          g.ready = spec.layFirst * this.tuning.react;
          g.shots = 0;
        }
      } else if (g.tracking) {
        g.blind += dt;
        if (g.blind >= spec.loseAfter) g.tracking = false;
      }
      if (i >= FIRST_TANK) {
        const moving = !g.tracking && !g.held;
        if (moving !== g.moving) {
          g.moving = moving;
          this.version++;
        }
        if (moving) g.d = wrapRoute(ENEMY_TANKS[i - FIRST_TANK], g.d + ENEMY_TANK.speed * dt);
      }
      if (!g.tracking) continue;
      g.ready -= dt;
      if (g.ready > 0 || !g.sees) continue;
      out.push(this.fire(i, tank));
      g.ready = spec.reload * this.tuning.react;
    }
    return out.length;
  }

  /**
   * Gun `i` fires at the tank now (the tests call it too): where the shell
   * goes and whether it hits. It aims at what it last saw of the tank, or
   * at `view` (the tests' fireNow: the whole tank, seeing it or not).
   */
  fire(i: number, tank: Readonly<TankTarget>, view: TankView = this.guns[i].view): EnemyShot {
    const g = this.guns[i];
    const shot = resolveShot(i, tank, g.shots, this.random, g.d, { aim: this.tuning.aim, box: this.tuning.box, view });
    g.shots++;
    g.revealed = true;
    this.shotsFired++;
    if (shot.hit) {
      this.hits++;
      this.version++;
    }
    return shot;
  }
}

/** The spread of an enemy's `shots`th shot on a sighting (0 first) at `range` m on a tank moving `speed` m/s, m (one standard deviation); `aim` (F3.10) scales its laying error and dispersion. */
export function shotSpread(shots: number, range: number, speed: number, spec: EnemySpec = ENEMY_GUN, aim = 1): number {
  const lay = spec.layError[Math.min(shots, spec.layError.length - 1)];
  const mils = aim * Math.hypot(spec.dispersion, lay);
  const moved = Math.abs(speed) * (range / spec.muzzleSpeed);
  return Math.hypot((range * mils) / 1000, moved * spec.leadError);
}

/** How a shot is tuned (F3.10): the aim and the tank's size (CombatTuning), and what of the tank the gun sees. */
export interface ShotOptions {
  aim?: number;
  box?: number;
  view?: TankView;
}

/**
 * Where enemy `i`'s shell goes (a tank's `along` m along its route), fired
 * at the tank as it is now. The shell
 * flies range / muzzleSpeed; the tank moves on meanwhile and the gun leads
 * it by `lead` of that. Its errors across and up (shotSpread) put it on the
 * tank (inside its silhouette as the gun sees it: the hull front, side or
 * between, and the turret over it) or past it: low, it strikes the ground
 * short; high or wide, it lands well beyond. Seeing only the turret over
 * cover (hull down, F3.10), the gun aims at the turret, and a shell low of
 * it strikes the cover short.
 */
export function resolveShot(i: number, tank: Readonly<TankTarget>, shots: number, random: () => number, along = 0, opts: ShotOptions = {}): EnemyShot {
  const box = opts.box ?? 1;
  const turretOnly = opts.view === 'turret';
  const spec = specOf(i);
  const from = muzzleNear(i, tank.x, tank.z, [0, 0, 0], along);
  const dx0 = tank.x - from[0];
  const dz0 = tank.z - from[2];
  const range = Math.hypot(dx0, dz0);
  const flight = range / spec.muzzleSpeed;
  // Where the tank will be when the shell gets there, and where the gun aims.
  const vx = -Math.sin(tank.heading) * tank.speed;
  const vz = -Math.cos(tank.heading) * tank.speed;
  const ax = tank.x + vx * flight;
  const az = tank.z + vz * flight;
  const aimX = tank.x + vx * flight * spec.lead;
  const aimZ = tank.z + vz * flight * spec.lead;
  // Along the line of fire and across it (to its right).
  const dx = ax - from[0];
  const dz = az - from[2];
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  const rx = -uz;
  const rz = ux;
  const spread = shotSpread(shots, range, tank.speed, spec, opts.aim ?? 1);
  const across = (aimX - ax) * rx + (aimZ - az) * rz + normal(random) * spread;
  const up = normal(random) * spread;
  // The tank as the gun sees it, `box` times its size: the hull's half width (its front, its side or between), the turret's, and their tops.
  const rel = Math.atan2(-Math.sin(tank.heading), -Math.cos(tank.heading)) - Math.atan2(ux, uz);
  const half = 0.5 * box * (Math.abs(Math.cos(rel)) * TANK_SILHOUETTE.width + Math.abs(Math.sin(rel)) * TANK_SILHOUETTE.length);
  const turretHalf = 0.5 * box * TANK_SILHOUETTE.turret;
  const hullTop = box * DAMAGE.hullTop;
  const top = box * TANK_SILHOUETTE.height;
  // Where it struck, up from the ground: aimed at the middle of what it sees.
  const h = (turretOnly ? (hullTop + top) / 2 : top / 2) + up;
  const onTurret = h > hullTop && h <= top && Math.abs(across) <= turretHalf;
  const onHull = !turretOnly && h >= 0 && h <= hullTop && Math.abs(across) <= half;
  const hit = onTurret || onHull;
  const ground = groundHeight(ax, az);
  const to: Vec3 = [0, 0, 0];
  if (hit) {
    // On the near face of the tank, at the height on the true-sized tank (the damage model's zones go by it).
    const near = Math.min(half, 1.4);
    to[0] = ax + rx * across - ux * near;
    to[2] = az + rz * across - uz * near;
    to[1] = ground + h / box;
  } else {
    // Low: into the ground (or the cover) short, nearer the lower it went. High or wide: on past, landing well beyond.
    const floor = turretOnly ? hullTop : 0;
    const short = h < floor ? Math.min(40, Math.max(4, (floor - h) * 15)) : -120;
    to[0] = ax + rx * across - ux * short;
    to[2] = az + rz * across - uz * short;
    to[1] = groundHeight(to[0], to[2]);
  }
  const travelled = Math.hypot(to[0] - from[0], to[2] - from[2]);
  return {
    gun: i,
    from,
    to,
    hit,
    flight: travelled / spec.muzzleSpeed,
    clock: clockTo(tank.heading, from[0] - tank.x, from[2] - tank.z),
    range,
  };
}

/**
 * The battery's state as both pages share it (the `enemy` event): whether
 * any enemy is there, which are there and alive, the tanks' places on their
 * routes and whether they are driving on, and the hits taken.
 */
export interface EnemyShared {
  on: boolean;
  present: boolean[];
  alive: boolean[];
  d: number[];
  moving: boolean[];
  hits: number;
  shots: number;
  v: number;
}

/** An empty shared state: nothing there. */
export function noEnemies(): EnemyShared {
  return {
    on: false,
    present: Array.from({ length: ENEMY_COUNT }, () => false),
    alive: Array.from({ length: ENEMY_COUNT }, () => true),
    d: Array.from({ length: ENEMY_COUNT }, () => 0),
    moving: Array.from({ length: ENEMY_COUNT }, () => false),
    hits: 0,
    shots: 0,
    v: 0,
  };
}

/** The battery's shared state, into `out`. */
export function sharedOf(b: EnemyBattery, out: EnemyShared): EnemyShared {
  out.on = b.on;
  out.present.length = 0;
  out.alive.length = 0;
  out.d.length = 0;
  out.moving.length = 0;
  for (const g of b.guns) {
    out.present.push(g.present);
    out.alive.push(g.alive);
    out.d.push(Math.round(g.d * 100) / 100);
    out.moving.push(g.moving);
  }
  out.hits = b.hits;
  out.shots = b.shotsFired;
  out.v = b.version;
  return out;
}

/** Whether a group is there in a shared state. */
export function sharedGroupOn(s: Readonly<EnemyShared>, group: EnemyGroup): boolean {
  return s.present.some((p, i) => p && groupOf(i) === group);
}

/** Read the `enemy` event's state, or null if it is malformed. A message from before F3.3 has the guns only, there while `on`. */
export function parseShared(raw: unknown): EnemyShared | null {
  const e = raw as Partial<Record<keyof EnemyShared, unknown>>;
  if (typeof e?.on !== 'boolean' || !Array.isArray(e.alive) || typeof e.hits !== 'number' || typeof e.v !== 'number') return null;
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
  const present = list(e.present);
  const d = list(e.d);
  const moving = list(e.moving);
  const on = e.on;
  return {
    on,
    present: Array.from({ length: ENEMY_COUNT }, (_, i) => (Array.isArray(e.present) ? present[i] === true : on && i < FIRST_TANK)),
    alive: Array.from({ length: ENEMY_COUNT }, (_, i) => (e.alive as unknown[])[i] !== false),
    d: Array.from({ length: ENEMY_COUNT }, (_, i) => (typeof d[i] === 'number' && Number.isFinite(d[i]) ? (d[i] as number) : 0)),
    moving: Array.from({ length: ENEMY_COUNT }, (_, i) => moving[i] === true),
    hits: e.hits,
    shots: typeof e.shots === 'number' ? e.shots : 0,
    v: e.v,
  };
}

/** Read an `enemy-shot` event, or null if it is malformed. */
export function parseShot(raw: unknown): EnemyShot | null {
  const e = raw as Record<string, unknown>;
  const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
  if (typeof e?.gun !== 'number' || !Number.isInteger(e.gun) || e.gun < 0 || e.gun >= ENEMY_COUNT || !vec(e.from) || !vec(e.to) || typeof e.hit !== 'boolean' || typeof e.flight !== 'number') return null;
  return {
    gun: e.gun,
    from: e.from,
    to: e.to,
    hit: e.hit,
    flight: Math.max(0, Math.min(5, e.flight)),
    clock: typeof e.clock === 'number' ? e.clock : 12,
    range: typeof e.range === 'number' ? e.range : 0,
    damage: e.hit ? (parseHit(e.damage) ?? undefined) : undefined,
  };
}

/** One line for the menu, for the guns or the tanks. */
export function batteryLine(s: Readonly<EnemyShared>, group: EnemyGroup = 'guns'): string {
  const word = group === 'guns' ? 'guns' : 'tanks';
  if (!sharedGroupOn(s, group)) return `Enemy ${word} off`;
  let count = 0;
  let alive = 0;
  s.present.forEach((p, i) => {
    if (!p || groupOf(i) !== group) return;
    count++;
    if (s.alive[i]) alive++;
  });
  if (alive === 0) return `All ${count} ${word} knocked out. Hits taken ${s.hits}`;
  return `${alive} of ${count} ${word} in action, ${count - alive} knocked out. Hits taken ${s.hits} of ${s.shots} shots`;
}
