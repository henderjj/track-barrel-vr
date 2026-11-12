/**
 * The tank's damage model (F3.4, docs/damage.md): where an enemy shell
 * strikes the crew's tank (its hit zone), whether it gets through the
 * armour there, and what it does inside: the engine, a track or the
 * transmission, the power traverse, and the crew. Three hits through the
 * armour knock the tank out.
 *
 * Engine-free and deterministic for a random source: the host decides each
 * hit when the enemy fires (EnemySystem), applies it when the shell gets
 * there (DamageSystem), and both pages show what it did.
 */

import type { Vec3 } from './ballistics.js';

const DEG = Math.PI / 180;

/** Where a shell strikes the tank. */
export const HIT_ZONES = ['hull-front', 'hull-side', 'hull-rear', 'turret-front', 'turret-side', 'turret-rear', 'running-gear'] as const;
export type HitZone = (typeof HIT_ZONES)[number];

/** What a hit through the armour (or on the running gear) does. */
export const DAMAGE_EFFECTS = ['engine', 'left-track', 'right-track', 'transmission', 'traverse', 'driver', 'gunner'] as const;
export type DamageEffect = (typeof DAMAGE_EFFECTS)[number];

/**
 * An M4A4's armour by zone: its thickness, mm, and its slope back from
 * upright, rad. The glacis is 51 mm laid back 56°; the hull's sides and
 * rear 38 mm, upright; the turret's front 76 mm (with the mantlet) rounded
 * back about 30°, its sides and rear 51 mm. The running gear has no armour
 * to speak of: a shell there breaks the track or not.
 */
export const ARMOUR: Readonly<Record<Exclude<HitZone, 'running-gear'>, { mm: number; slope: number }>> = {
  'hull-front': { mm: 51, slope: 56 * DEG },
  'hull-side': { mm: 38, slope: 0 },
  'hull-rear': { mm: 38, slope: 10 * DEG },
  'turret-front': { mm: 76, slope: 30 * DEG },
  'turret-side': { mm: 51, slope: 5 * DEG },
  'turret-rear': { mm: 51, slope: 0 },
};

/** The zones' names as the crew says them. */
export const ZONE_NAMES: Readonly<Record<HitZone, string>> = {
  'hull-front': 'the front plate',
  'hull-side': 'side',
  'hull-rear': 'the rear',
  'turret-front': 'the turret front',
  'turret-side': "the turret's side",
  'turret-rear': "the turret's rear",
  'running-gear': 'running gear',
};

/** The damage model's numbers. */
export const DAMAGE = {
  /** An enemy 75 mm AP shell's penetration of upright armour at 100 m, mm, and how much it loses per 100 m further. */
  penAt100: 124,
  penPer100: 4,
  /** The spread of a shell's penetration, a share of it (one standard deviation). */
  penSpread: 0.08,
  /** Struck this far off square or more, a shell glances off whatever the armour, rad: the glacis angled 35° or more to the shot. */
  ricochet: 65 * DEG,
  /** The hull's top above the ground, m: a strike higher is on the turret. */
  hullTop: 1.85,
  /** A strike on the side lower than this is on the running gear (the tracks and bogies), m. */
  runningGear: 0.75,
  /** Along the hull from its middle (forward positive), m: ahead of `driverFrom` is the driver's compartment, behind `engineFrom` the engine's. */
  driverFrom: 0.9,
  engineFrom: -1.2,
  /** A shell on the running gear breaks the track this often. */
  trackChance: 0.7,
  /** Through the front plate: the driver is hit this often on the driver's (the left) side, this often on the other; the transmission this often. */
  frontDriverNear: 0.7,
  frontDriverFar: 0.3,
  transmissionChance: 0.4,
  /** Through the side: the driver ahead of driverFrom, the gunner in the fighting compartment. */
  sideDriver: 0.6,
  sideGunner: 0.4,
  /** Through the turret: the gunner, and the traverse (not through its front, where the gun's mount takes it). */
  turretGunner: 0.6,
  traverseChance: 0.4,
  /** This many hits through the armour knock the tank out. */
  knockOut: 3,
  /** A crewman hit is stunned this long, s (twice as long badly wounded). */
  stunSeconds: 4,
} as const;

/** What one enemy shell did: where it struck, whether it got through, and what it did inside. */
export interface DamageHit {
  zone: HitZone;
  /** Through the armour (or, on the running gear, breaking the track). */
  through: boolean;
  /** The armour it met, mm along its path, and its penetration, mm (0 on the running gear). */
  armour: number;
  pen: number;
  effects: DamageEffect[];
  /** The tank's right side (seen from inside) for a side or running-gear strike. */
  right: boolean;
}

/** The tank as a shell finds it: where it is (world x, z), the ground under it, its heading and its turret's turn on the hull, rad. */
export interface TankPose {
  x: number;
  z: number;
  ground: number;
  heading: number;
  turretYaw: number;
}

/** A standard normal number from `random`. */
function normal(random: () => number): number {
  const u = Math.max(1e-12, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** An enemy AP shell's penetration of upright armour at `range` m, mm. */
export function penetration(range: number): number {
  return Math.max(0, DAMAGE.penAt100 - (DAMAGE.penPer100 * (range - 100)) / 100);
}

/** The armour a shell meets on plate `mm` thick laid back `slope`, striking `across` off square in plan: mm along its path, and how far off square it strikes, rad. */
export function armourMet(mm: number, slope: number, across: number): { mm: number; off: number } {
  const c = Math.cos(slope) * Math.cos(across);
  const off = Math.acos(Math.max(-1, Math.min(1, c)));
  return { mm: mm / Math.max(1e-6, c), off };
}

/** Where a shell from `from` striking at `to` (world space) hits the tank at `tank`: its zone, the angle off square in plan, which side, and how far along the hull. */
export function hitZone(from: Readonly<Vec3>, to: Readonly<Vec3>, tank: Readonly<TankPose>): { zone: HitZone; across: number; right: boolean; along: number; height: number } {
  // Towards the shooter, flat.
  let sx = from[0] - to[0];
  let sz = from[2] - to[2];
  const n = Math.hypot(sx, sz) || 1;
  sx /= n;
  sz /= n;
  const height = to[1] - tank.ground;
  const turret = height > DAMAGE.hullTop;
  const heading = turret ? tank.heading + tank.turretYaw : tank.heading;
  // Forward is (-sin h, -cos h); right (cos h, -sin h).
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const ahead = sx * fx + sz * fz;
  const side = sx * Math.cos(heading) - sz * Math.sin(heading);
  const right = side > 0;
  const theta = Math.acos(Math.max(-1, Math.min(1, ahead)));
  // Along the hull from its middle, for the side's compartments.
  const hx = -Math.sin(tank.heading);
  const hz = -Math.cos(tank.heading);
  const along = (to[0] - tank.x) * hx + (to[2] - tank.z) * hz;
  let zone: HitZone;
  let across: number;
  if (theta < 45 * DEG) {
    zone = turret ? 'turret-front' : 'hull-front';
    across = theta;
  } else if (theta > 135 * DEG) {
    zone = turret ? 'turret-rear' : 'hull-rear';
    across = Math.PI - theta;
  } else {
    zone = turret ? 'turret-side' : height < DAMAGE.runningGear ? 'running-gear' : 'hull-side';
    across = Math.abs(Math.PI / 2 - theta);
  }
  return { zone, across, right, along, height };
}

/**
 * What an enemy shell fired from `from` that strikes the tank at `to`
 * (world space) from `range` m does: its zone, whether it gets through the
 * armour there (its penetration at that range, spread, against the armour
 * along its path; glancing off past DAMAGE.ricochet), and what it hits
 * inside, by chance and where it got in.
 */
export function resolveDamage(
  from: Readonly<Vec3>,
  to: Readonly<Vec3>,
  range: number,
  tank: Readonly<TankPose>,
  random: () => number,
): DamageHit {
  const z = hitZone(from, to, tank);
  const hit: DamageHit = { zone: z.zone, through: false, armour: 0, pen: 0, effects: [], right: z.right };
  const chance = (p: number) => random() < p;
  if (z.zone === 'running-gear') {
    hit.through = chance(DAMAGE.trackChance);
    if (hit.through) hit.effects.push(z.right ? 'right-track' : 'left-track');
    return hit;
  }
  const plate = ARMOUR[z.zone];
  const met = armourMet(plate.mm, plate.slope, z.across);
  hit.armour = Math.round(met.mm);
  hit.pen = Math.round(penetration(range) * (1 + DAMAGE.penSpread * normal(random)));
  hit.through = met.off < DAMAGE.ricochet && hit.pen > met.mm;
  if (!hit.through) return hit;
  switch (z.zone) {
    case 'hull-front':
      // The driver sits on the left, the transmission across the front.
      if (chance(z.right ? DAMAGE.frontDriverFar : DAMAGE.frontDriverNear)) hit.effects.push('driver');
      if (chance(DAMAGE.transmissionChance)) hit.effects.push('transmission');
      break;
    case 'hull-side':
      if (z.along > DAMAGE.driverFrom) {
        if (chance(DAMAGE.sideDriver)) hit.effects.push('driver');
      } else if (z.along < DAMAGE.engineFrom) {
        hit.effects.push('engine');
      } else if (chance(DAMAGE.sideGunner)) {
        hit.effects.push('gunner');
      }
      break;
    case 'hull-rear':
      hit.effects.push('engine');
      break;
    default:
      if (chance(DAMAGE.turretGunner)) hit.effects.push('gunner');
      if (z.zone !== 'turret-front' && chance(DAMAGE.traverseChance)) hit.effects.push('traverse');
  }
  return hit;
}

/** The tank's damage as both pages share it (the `damage` event). */
export interface DamageState {
  /** 0 sound, 1 damaged (less pull, runs hot), 2 knocked out (won't run). */
  engine: number;
  /** What keeps the tank from moving: '' nothing, or a broken track or the transmission. */
  immobile: '' | 'left-track' | 'right-track' | 'transmission';
  /** The power traverse is knocked out: only the hand crank turns the turret. */
  traverse: boolean;
  /** Each crewman's wounds: 0, 1 wounded, 2 badly wounded. */
  driver: number;
  gunner: number;
  /** Hits taken, and hits through the armour. */
  hits: number;
  through: number;
  /** Knocked out: the tank is out of the fight until repaired. */
  out: boolean;
  /** Bumped on every change. */
  v: number;
}

export function freshDamage(): DamageState {
  return { engine: 0, immobile: '', traverse: false, driver: 0, gunner: 0, hits: 0, through: 0, out: false, v: 0 };
}

/** Take a hit: what it did, onto `s`. Returns whether the tank was knocked out by it. */
export function applyHit(s: DamageState, hit: Readonly<DamageHit>): boolean {
  s.hits++;
  s.v++;
  if (!hit.through) return false;
  if (hit.zone !== 'running-gear') s.through++;
  for (const e of hit.effects) {
    if (e === 'engine') s.engine = Math.min(2, s.engine + 1);
    else if (e === 'left-track' || e === 'right-track' || e === 'transmission') s.immobile ||= e;
    else if (e === 'traverse') s.traverse = true;
    else if (e === 'driver') s.driver = Math.min(2, s.driver + 1);
    else if (e === 'gunner') s.gunner = Math.min(2, s.gunner + 1);
  }
  if (s.out || s.through < DAMAGE.knockOut) return false;
  s.out = true;
  s.engine = 2;
  return true;
}

/** Repair everything (Combat → Damage → Repair, or starting the enemies). */
export function repair(s: DamageState): void {
  const v = s.v;
  Object.assign(s, freshDamage());
  s.v = v + 1;
}

const EFFECT_WORDS: Readonly<Record<DamageEffect, string>> = {
  engine: 'engine hit',
  'left-track': 'left track broken',
  'right-track': 'right track broken',
  transmission: 'transmission hit',
  traverse: 'power traverse out',
  driver: 'driver hit',
  gunner: 'gunner hit',
};

/** What a hit did, as the sign's second line: "Bounced off the front plate", "Through the right side: engine hit". */
export function hitLine(hit: Readonly<DamageHit>): string {
  const side = hit.right ? 'right' : 'left';
  if (hit.zone === 'running-gear') {
    return hit.through ? `Struck the ${side} running gear: the track is broken` : `Struck the ${side} running gear: no harm done`;
  }
  const where = hit.zone === 'hull-side' ? `the ${side} side` : ZONE_NAMES[hit.zone];
  if (!hit.through) return `Bounced off ${where}`;
  const what = hit.effects.length > 0 ? hit.effects.map((e) => EFFECT_WORDS[e]).join(', ') : 'no one hurt';
  return `Through ${where}: ${what}`;
}

/** One line for the menu: what is damaged, and the hits. */
export function damageLine(s: Readonly<DamageState>): string {
  if (s.hits === 0) return 'No damage';
  const parts: string[] = [];
  if (s.out) parts.push('Knocked out');
  if (s.engine === 1) parts.push('engine damaged');
  else if (s.engine === 2 && !s.out) parts.push('engine knocked out');
  if (s.immobile) parts.push(EFFECT_WORDS[s.immobile]);
  if (s.traverse) parts.push('power traverse out');
  if (s.driver) parts.push(s.driver > 1 ? 'driver badly wounded' : 'driver wounded');
  if (s.gunner) parts.push(s.gunner > 1 ? 'gunner badly wounded' : 'gunner wounded');
  const head = parts.length > 0 ? parts.join(', ') : 'No damage inside';
  return `${head[0].toUpperCase()}${head.slice(1)}. ${s.through} of ${s.hits} hits through the armour`;
}

/** Read the `damage` event's state, or null if it is malformed. */
export function parseDamage(raw: unknown): DamageState | null {
  const e = raw as Partial<Record<keyof DamageState, unknown>>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (num(e?.engine) === null || num(e?.v) === null || num(e?.hits) === null) return null;
  const level = (v: unknown) => Math.max(0, Math.min(2, Math.round(num(v) ?? 0)));
  const immobile = e.immobile === 'left-track' || e.immobile === 'right-track' || e.immobile === 'transmission' ? e.immobile : '';
  return {
    engine: level(e.engine),
    immobile,
    traverse: e.traverse === true,
    driver: level(e.driver),
    gunner: level(e.gunner),
    hits: num(e.hits) ?? 0,
    through: num(e.through) ?? 0,
    out: e.out === true,
    v: num(e.v) ?? 0,
  };
}

/** Read a hit sent with an `enemy-shot`, or null if there is none or it is malformed. */
export function parseHit(raw: unknown): DamageHit | null {
  const e = raw as Partial<Record<keyof DamageHit, unknown>>;
  if (!e || !(HIT_ZONES as readonly unknown[]).includes(e.zone) || typeof e.through !== 'boolean' || !Array.isArray(e.effects)) return null;
  return {
    zone: e.zone as HitZone,
    through: e.through,
    armour: typeof e.armour === 'number' ? e.armour : 0,
    pen: typeof e.pen === 'number' ? e.pen : 0,
    effects: (e.effects as unknown[]).filter((x): x is DamageEffect => (DAMAGE_EFFECTS as readonly unknown[]).includes(x)),
    right: e.right === true,
  };
}
