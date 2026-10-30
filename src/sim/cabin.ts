/**
 * The tank's cabin: its main dimensions and the two seats, shared by the
 * procedural model (src/scene-assets/cabin.scene-asset.ts), the systems, the
 * practice crewmate and the tests, so they all use one set of numbers.
 * Engine-free, so it can be unit tested. Design note: docs/cabin.md.
 *
 * Hull space: the hull floor inside is at y = 0, the tank's front towards
 * -Z, +X to the driver's and gunner's right. The tank stays at the origin
 * and the world moves round it (plan decision 4), so hull space is the
 * scene's space and poses go over the network in it.
 *
 * Turret space: the same, turned about the turret ring's centre by the
 * turret's angle (0 while the turret faces forward, as it always does
 * until the turret is built in F1.8). The gunner's seat is fixed to the
 * turret basket, so it turns with the turret.
 */

import { EYES_BELOW_TOP, SEATED_EYE } from './body-height.js';

/** The hull: inner faces of the walls, the roof's underside and the armour's drawn thickness, m. */
export const HULL = {
  /** The side walls' inner faces are at x = ±halfWidth. */
  halfWidth: 1.1,
  /** Inner face of the front plate. */
  front: -2.4,
  /** Inner face of the bulkhead in front of the engine. */
  rear: 2.0,
  /** Underside of the roof: 35 cm over a seated driver's eyes. */
  roof: 1.8,
  /** Thickness of the walls, roof and floor plate as drawn. */
  wall: 0.08,
} as const;

/**
 * The hull's front, as on a Sherman (docs/interior.md): an upright nose
 * plate from the floor in front of the driver's legs to `noseTop`, the
 * glacis sloping back from it at 57° from upright, as the Sherman's does
 * at 56°, and the driver's hood: an upright face from `hoodBottom` to the
 * roof with the vision slit in it, 30 cm ahead of the driver's eyes, so
 * they see out with their hands on the tillers. Inner faces, hull space, m.
 */
export const GLACIS = {
  /** Top of the nose plate, which stands at z = HULL.front. */
  noseTop: 1.0,
  /** Bottom of the hood's face, where the glacis meets it. */
  hoodBottom: 1.32,
  /** The hood face's inner face, hull z. */
  face: -1.9,
} as const;

/** The front armour's inner face at height `y` (hull space), hull z: the nose, the glacis or the hood's face. */
export function frontAt(y: number): number {
  const { noseTop, hoodBottom, face } = GLACIS;
  if (y <= noseTop) return HULL.front;
  if (y >= hoodBottom) return face;
  return HULL.front + ((y - noseTop) / (hoodBottom - noseTop)) * (face - HULL.front);
}

/** The glacis's slope from upright, radians. */
export const GLACIS_SLOPE = Math.atan2(GLACIS.face - HULL.front, GLACIS.hoodBottom - GLACIS.noseTop);

/** The ground under the tracks, m (the tracks reach down to it). */
export const GROUND_Y = -0.6;

/**
 * The turret: its ring in the hull roof, the basket that hangs from it (the
 * gunner's floor, which turns with the turret), and its walls in turret
 * space, m.
 */
export const TURRET = {
  /** The ring's centre, hull z. */
  z: 0.2,
  /** Inner radius of the ring, the hole in the hull roof. */
  ringRadius: 0.92,
  /** Radius of the basket floor. */
  basketRadius: 0.86,
  /** Top of the basket floor, 80 cm above the hull floor so the gunner's eyes are near the gun's height. */
  basketFloor: 0.8,
  /** Outer faces of the walls in turret space: x = ±halfWidth, z from front to rear. */
  halfWidth: 1.15,
  front: -1.15,
  rear: 1.15,
  /** Underside of the turret roof. */
  roof: 2.75,
} as const;

/**
 * The race ring the turret turns on, round the hole in the hull roof, turret
 * space: its middle's height and radius, its tube's radius across and its
 * half-height, m. Its inner edge is 87 cm from the middle, so the gunner's
 * crank and the hand on it turn inside it (docs/interior.md).
 */
export const TURRET_RING = { y: HULL.roof + HULL.wall - 0.02, radius: 0.91, tube: 0.04, halfHeight: 0.035 } as const;

/** The gun, in turret space: its axis's height, its breech beside the gunner, and its barrel, m. */
export const GUN = {
  y: 2.05,
  /**
   * The breech: half its width, and the turret z its back (the breech
   * mouth) reaches, 50 cm ahead of the gunner's eyes so a seated gunner can
   * ram a shell home (F1.10, spike S4's reach).
   */
  breechHalfWidth: 0.14,
  breechBack: -0.7,
  /** From the mantlet to the muzzle. */
  barrelLength: 4.4,
  barrelRadius: 0.06,
} as const;

/** The driver's vision slit: an opening in the hood's face in front of the driver's eyes (middle x, y, z of the inner face; width, height), m. */
export const VISION_SLIT = { x: -0.5, y: 1.45, z: GLACIS.face, width: 0.34, height: 0.1 } as const;

/** Height of a seat's cushion above the floor it stands on, m. */
export const CUSHION_HEIGHT = 0.55;

export type SeatId = 'driver' | 'gunner';
export const SEAT_IDS: readonly SeatId[] = ['driver', 'gunner'];

export interface Seat {
  id: SeatId;
  /** Shown in menus and signs. */
  label: string;
  /** What it is fixed to: the hull, or the turret basket (it turns with the turret). */
  frame: 'hull' | 'turret';
  /** The floor under the seat, in its frame: where the player's real floor goes, m. */
  floorY: number;
  /**
   * The design eye point, in its frame: a seated player's eyes (raised to
   * SEATED_EYE above the floor, src/sim/body-height.ts) land here.
   */
  eye: readonly [number, number, number];
  /**
   * The box the head is kept in, as offsets from the eye point in the
   * seat's frame: [left, right, forward, back], m. Leaning further meets
   * the walls, the breech or the controls, so the head stops at its edge.
   */
  headBox: readonly [number, number, number, number];
  /**
   * How far the eyes may rise above the eye point before the top of the
   * head meets the roof, m (F1.2). Rising further (standing up from the
   * chair) stops the head there.
   */
  headUp: number;
  /** Middle of the seat cushion's top, in its frame, m. */
  cushion: readonly [number, number, number];
}

const DRIVER_FLOOR = 0;
const GUNNER_FLOOR = TURRET.basketFloor;
/** Room left between the top of the head and the roof when the head stops, m. */
const HEAD_CLEARANCE = 0.02;
/** How far the eyes may rise in a seat whose eye point is `eyeY`, under a roof at `roofY`, m. */
const headUpUnder = (roofY: number, eyeY: number) => roofY - EYES_BELOW_TOP - HEAD_CLEARANCE - eyeY;

/**
 * The driver sits front left in the hull, under a hatch, with the vision
 * slit in the hood 30 cm ahead of their eyes and room under the glacis for
 * the tillers and the gear lever (F1.5); leaning 10 cm in brings the eyes
 * to 20 cm from it, the brow just short of its pad. The gunner sits in the
 * turret basket right of the gun, with the breech on their left at chest
 * height and the gunsight's eyepiece 18 cm ahead of their eyes, a short
 * lean away (F1.9, F1.10); their head stops 4 cm short of it. Both leans
 * keep the hands on the controls (docs/interior.md).
 */
export const SEATS: Readonly<Record<SeatId, Seat>> = {
  driver: {
    id: 'driver',
    label: 'Driver',
    frame: 'hull',
    floorY: DRIVER_FLOOR,
    eye: [-0.5, DRIVER_FLOOR + SEATED_EYE, -1.6],
    headBox: [0.35, 0.3, 0.1, 0.35],
    // Under the hull roof (the hatch above opens in F2.1).
    headUp: headUpUnder(HULL.roof, DRIVER_FLOOR + SEATED_EYE),
    cushion: [-0.5, DRIVER_FLOOR + CUSHION_HEIGHT, -1.45],
  },
  gunner: {
    id: 'gunner',
    label: 'Gunner',
    frame: 'turret',
    floorY: GUNNER_FLOOR,
    eye: [0.4, GUNNER_FLOOR + SEATED_EYE, -0.2],
    headBox: [0.22, 0.35, 0.14, 0.45],
    headUp: headUpUnder(TURRET.roof, GUNNER_FLOOR + SEATED_EYE),
    cushion: [0.4, GUNNER_FLOOR + CUSHION_HEIGHT, -0.08],
  },
};

/**
 * The driver's hatch in the hull roof, over their head (x0, z0, x1, z1), m:
 * from 10 cm ahead of their eyes, so the periscope's head stands on the
 * roof in front of it.
 */
export const DRIVER_HATCH = [
  SEATS.driver.eye[0] - 0.25,
  SEATS.driver.eye[2] - 0.1,
  SEATS.driver.eye[0] + 0.25,
  SEATS.driver.eye[2] + 0.4,
] as const;

/** The gunsight's eyepiece, in turret space, m: 18 cm ahead of the gunner's eyes, over the elevation wheel. */
export const SIGHT_EYEPIECE = [0.32, SEATS.gunner.eye[1], -0.38] as const;

/** The other seat. */
export function otherSeat(seat: SeatId): SeatId {
  return seat === 'driver' ? 'gunner' : 'driver';
}

/** A seat id from text (a URL, an event), or `fallback`. */
export function parseSeat(raw: unknown, fallback: SeatId): SeatId {
  return raw === 'driver' || raw === 'gunner' ? raw : fallback;
}

/** Which seat each player sits in. The host decides (docs/cabin.md). */
export interface Seating {
  host: SeatId;
  guest: SeatId;
}

/**
 * The host's answer when `who` asks for `seat`: they get it, and the other
 * player the other one. With two seats and two players, there is no other
 * way to share them.
 */
export function seatingWith(who: 'host' | 'guest', seat: SeatId): Seating {
  return who === 'host' ? { host: seat, guest: otherSeat(seat) } : { host: otherSeat(seat), guest: seat };
}

/** The seat's frame's turn about the vertical, rad: 0 for the hull, the turret's angle for the turret. */
function frameYaw(seat: Seat, turretYaw: number): number {
  return seat.frame === 'turret' ? turretYaw : 0;
}

/**
 * A point in the seat's frame, in hull space, written to `out`. Turret
 * space turns about the ring's centre by `turretYaw` (rad, positive turns
 * left, as Three.js turns about +Y).
 */
export function seatToHull(seat: Seat, turretYaw: number, p: readonly number[], out: [number, number, number]): [number, number, number] {
  if (seat.frame === 'hull') {
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    return out;
  }
  const c = Math.cos(turretYaw);
  const s = Math.sin(turretYaw);
  const x = p[0];
  const z = p[2];
  out[0] = x * c + z * s;
  out[1] = p[1];
  out[2] = -x * s + z * c + TURRET.z;
  return out;
}

/** A hull-space point in the seat's frame, written to `out` (the inverse of seatToHull). */
export function hullToSeat(seat: Seat, turretYaw: number, p: readonly number[], out: [number, number, number]): [number, number, number] {
  if (seat.frame === 'hull') {
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    return out;
  }
  const c = Math.cos(turretYaw);
  const s = Math.sin(turretYaw);
  const x = p[0];
  const z = p[2] - TURRET.z;
  out[0] = x * c - z * s;
  out[1] = p[1];
  out[2] = x * s + z * c;
  return out;
}

/**
 * Beyond the head box by more than this, the head is far outside: a jump this
 * far in one frame (the headset recentred) or a head kept out here for
 * `RESEAT_AFTER` (the player stood up and walked) puts them back in the seat, m.
 */
export const RESEAT_DISTANCE = 0.3;
/** How long a head stays far outside the box before the player is put back in the seat, s. */
export const RESEAT_AFTER = 2;
/** A head that moves this far in one frame has jumped (the headset recentred), m. */
export const HEAD_JUMP = 0.2;
/** How far past the head box's edge, or over the roof stop, the view has faded to black, m. */
export const HEAD_FADE_DEPTH = 0.08;

/**
 * How dark the view is with the head `depth` m past the box's edge or the
 * roof stop: 0 at the edge, 1 (black) from `HEAD_FADE_DEPTH`, easing in.
 */
export function headFade(depth: number): number {
  const t = Math.min(1, Math.max(0, depth / HEAD_FADE_DEPTH));
  return t * t * (3 - 2 * t);
}

/** Where the head is: inside its box, past the edge (the view fades), or far outside. */
export type HeadFix = 'inside' | 'fade' | 'reseat';

/**
 * Keeping the head in the seat's box. `head` is the head's hull-space
 * position (only x and z are used). Writes to `out` the hull-space x and z
 * from the head back to the box's edge (its length is how far out the head
 * is), and says where the head is:
 *
 * - 'inside': nothing to do (out is [0, 0]);
 * - 'fade': the head leant past the edge, into the walls, the breech or the
 *   controls, so the view fades (`headFade`); the seat stays where the
 *   player calibrated it, and leaning back clears the view;
 * - 'reseat': the head is far outside (the player recentred the headset,
 *   or stood up and walked); after a jump or `RESEAT_AFTER` out there, put
 *   them back in the seat (`placeInSeat`).
 */
export function headFix(seat: Seat, turretYaw: number, head: readonly number[], out: [number, number]): HeadFix {
  const local = hullToSeat(seat, turretYaw, head, tmpLocal);
  const [left, right, forward, back] = seat.headBox;
  const ex = seat.eye[0];
  const ez = seat.eye[2];
  const x = Math.min(ex + right, Math.max(ex - left, local[0]));
  const z = Math.min(ez + back, Math.max(ez - forward, local[2]));
  const dx = x - local[0];
  const dz = z - local[2];
  out[0] = 0;
  out[1] = 0;
  if (dx === 0 && dz === 0) {
    return 'inside';
  }
  if (Math.hypot(dx, dz) > RESEAT_DISTANCE) {
    return 'reseat';
  }
  // The correction turned from seat space into hull space.
  const yaw = frameYaw(seat, turretYaw);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = dx * c + dz * s;
  out[1] = -dx * s + dz * c;
  return 'fade';
}
const tmpLocal: [number, number, number] = [0, 0, 0];

/**
 * How far over the seat's roof stop a head at height `headY` (hull space)
 * is, as a drop (m, 0 or less): the eyes may rise `seat.headUp` above the
 * eye point before the head meets the roof. Past it the view fades
 * (`headFade` of the drop's size).
 */
export function headDrop(seat: Seat, headY: number): number {
  return Math.min(0, seat.eye[1] + seat.headUp - headY);
}

/** Where the play space goes to put a player in a seat: its x, z and turn about the vertical (rad). */
export interface RigPlace {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Put a player in a seat: turn their play space so they face the seat's
 * way, and move it so their eyes are over the seat's eye point. `headX`,
 * `headZ` and `headYaw` are the head's position and heading in the play
 * space (as tracked, before the play space is placed). The height is left
 * to the body-height system, on top of the seat's floor.
 */
export function placeInSeat(seat: Seat, turretYaw: number, headX: number, headZ: number, headYaw: number, out: RigPlace): RigPlace {
  const eye = seatToHull(seat, turretYaw, seat.eye, tmpEye);
  const yaw = frameYaw(seat, turretYaw) - headYaw;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // The head's offset from the play space's origin, turned as the play space will be (as Three.js turns about +Y).
  out.x = eye[0] - (headX * c + headZ * s);
  out.z = eye[2] - (-headX * s + headZ * c);
  out.yaw = yaw;
  return out;
}
const tmpEye: [number, number, number] = [0, 0, 0];

/**
 * Where the play-space origin goes when the player turns by `angle` (rad,
 * positive turns left) about their head, so the head stays put. `out` gets
 * [x, z].
 */
export function turnAboutHead(
  originX: number,
  originZ: number,
  headX: number,
  headZ: number,
  angle: number,
  out: [number, number],
): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ox = originX - headX;
  const oz = originZ - headZ;
  out[0] = headX + ox * c + oz * s;
  out[1] = headZ - ox * s + oz * c;
  return out;
}

/** Where a seated crewmate's hips are: on the cushion, a little back from its middle, in the seat's frame, m. */
export function hipPoint(seat: Seat, out: [number, number, number]): [number, number, number] {
  out[0] = seat.cushion[0];
  out[1] = seat.cushion[1] + 0.08;
  out[2] = seat.cushion[2] + 0.04;
  return out;
}

/** How long a player's ask to swap seats waits for the crewmate's word, s. */
export const SWAP_WAIT_SECONDS = 30;

/**
 * In a crew, seats change only when both players want to swap (plan
 * decision 5): the host keeps when each last asked (s on the host's clock,
 * -Infinity for never) and swaps the pair once both asks are fresh.
 */
export interface SwapAsks {
  host: number;
  guest: number;
}

/** Whether both players have asked to swap seats within `SWAP_WAIT_SECONDS` of `now`. */
export function swapAgreed(asks: SwapAsks, now: number): boolean {
  return now - asks.host <= SWAP_WAIT_SECONDS && now - asks.guest <= SWAP_WAIT_SECONDS;
}
