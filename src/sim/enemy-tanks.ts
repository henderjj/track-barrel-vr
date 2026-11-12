/**
 * Enemy tanks on fixed routes (F3.3, docs/enemy-tanks.md): two tanks that
 * patrol there and back along a fixed line, halt to fire once they have
 * the crew's tank in sight, and drive on when they lose it. They join the
 * F3.2 guns in the battery (src/sim/enemy-guns.ts), which looks, lays and
 * fires for both; this module holds the routes and how a tank moves on one.
 *
 * Engine-free and deterministic. World space as src/sim/range.ts: x and z
 * tile-local, heights above the ground.
 */

/**
 * A tank's route: its name, the points it drives between, there and back
 * (tile-local x, z), and where Combat → Meet puts the two tanks: the crew's
 * tank parked on the lane at meetZ facing up it, this tank `meetD` m along
 * its route.
 */
export interface EnemyTankRoute {
  name: string;
  points: readonly (readonly [number, number])[];
  meetZ: number;
  meetD: number;
}

/**
 * The two routes, both well off the lane and clear of the obstacles, the
 * biathlon course's field and the guns, and out of a tank's spot range of
 * the range's start (test/enemy-tanks.test.ts): tank A patrols east and
 * west beyond the course's field, about 380 m up the range; tank B
 * north-east and south-west on the far left, beyond the guns. Seen from the
 * lane, both mostly cross the line of sight, so the gunner must lead them
 * while they move.
 */
export const ENEMY_TANKS: readonly EnemyTankRoute[] = [
  { name: 'Tank A', points: [[330, -380], [140, -380]], meetZ: -230, meetD: 80 },
  { name: 'Tank B', points: [[-310, -305], [-190, -395]], meetZ: -300, meetD: 40 },
];

/** The tanks' numbers. */
export const ENEMY_TANK = {
  /** Along its route, m/s (about 14 km/h, across country). */
  speed: 4,
  /** Its gun's AP, m/s (a long 75 mm's, as the guns'). */
  muzzleSpeed: 790,
  /** It spots the tank this far away and nearer, with a clear line, m: buttoned up, less far than a dug-in gun's crew. */
  spotRange: 400,
  /** From first sight to the first shot, s: halting, traversing the turret and laying. */
  layFirst: 5,
  /** Between shots, s. */
  reload: 7,
  /** Out of sight this long it loses the tank, and drives on, s. */
  loseAfter: 4,
  /** Its gun's muzzle above the ground, m. */
  muzzleHeight: 1.95,
  /** The muzzle ahead of its turret's middle, m. */
  muzzleAhead: 3.3,
  /** Its hull's length, width and height to the turret top, m. */
  length: 5.9,
  width: 2.9,
  height: 2.6,
} as const;

/** A tank's place on its route: tile-local x and z, and its heading (rad, as the crew's tank's: 0 faces -z). */
export interface RoutePose {
  x: number;
  z: number;
  heading: number;
}

/** A route's length one way, m. */
export function routeLength(r: EnemyTankRoute): number {
  let n = 0;
  for (let k = 1; k < r.points.length; k++) n += Math.hypot(r.points[k][0] - r.points[k - 1][0], r.points[k][1] - r.points[k - 1][1]);
  return n;
}

/** How far along a route there and back a tank has gone, wrapped into [0, 2 × its length). */
export function wrapRoute(r: EnemyTankRoute, d: number): number {
  const loop = 2 * routeLength(r);
  return loop > 0 ? ((d % loop) + loop) % loop : 0;
}

/**
 * Where a tank `d` m along its route there and back is, and which way it
 * faces, into `out`: out along the points, then back.
 */
export function routePose(r: EnemyTankRoute, d: number, out: RoutePose): RoutePose {
  const length = routeLength(r);
  let along = wrapRoute(r, d);
  const back = along > length;
  if (back) along = 2 * length - along;
  let k = 1;
  let ax = r.points[0][0];
  let az = r.points[0][1];
  let bx = ax;
  let bz = az;
  let leg = 0;
  for (; k < r.points.length; k++) {
    bx = r.points[k][0];
    bz = r.points[k][1];
    leg = Math.hypot(bx - ax, bz - az);
    if (along <= leg || k === r.points.length - 1) break;
    along -= leg;
    ax = bx;
    az = bz;
  }
  const t = leg > 0 ? Math.min(1, along / leg) : 0;
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  // Heading 0 faces -z: the direction (dx, dz) has heading atan2(-dx, -dz).
  const dx = back ? ax - bx : bx - ax;
  const dz = back ? az - bz : bz - az;
  out.heading = Math.atan2(-dx, -dz);
  return out;
}
