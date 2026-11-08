/**
 * The driver's convoy position (docs/convoy-seat.md): the seat raised so the
 * driver drives with their head out of the open hatch, as a Sherman's
 * driver did on the march ("Lower periscope. Open hatch. Raise seat to
 * convoy position", FM 17-67, 1944). Engine-free, so it is unit tested.
 *
 * The player sits in a real chair, so raising the seat lowers the whole tank
 * round them, and the controls with it. In our tank the roof is 24 cm over the
 * driver's eyes (docs/crew-heights.md), so the eyes must rise about 42 cm to
 * see over the hatch's rim, which would leave the tillers below the knees,
 * out of a seated arm's reach. So the tillers and the gear lever get convoy
 * grips: a rod up from each handle to a grip where the hands rest seated,
 * moving with the handle (John picked this, 2026-11-08). The hand throttle,
 * the parking brake and the switch strip stay where they are: set them before
 * going up.
 */
import { DRIVER_HATCH, HULL, type Seat, type SeatId, SEATS } from './cabin.js';
import type { LeverSpec, Vec3 } from './mechanism.js';

/** How far the eyes stand over the roof's top in the convoy position, m: enough to see the road over the hood. */
export const CONVOY_EYES_OVER_ROOF = 0.1;

/** The seat's rise to the convoy position, m: the eyes from under the roof to `CONVOY_EYES_OVER_ROOF` over its top. */
export const CONVOY_RAISE = HULL.roof + HULL.wall + CONVOY_EYES_OVER_ROOF - SEATS.driver.eye[1];

/**
 * How far back the seat goes as it rises, m: the head comes up in the
 * hatch's middle rather than at its front edge, and the hands' place
 * (where the convoy grips are) comes back from the hood's face.
 */
export const CONVOY_BACK = 0.22;

/** How far the convoy grips stand below where the hands are seated with the seat down, m: a raised driver's hands rest a little lower. */
export const CONVOY_GRIP_DROP = 0.04;

/**
 * Where each convoy grip is from its lever's handle, lever space (which is
 * hull space moved to the pivot), m: up with the seat and back with it. It
 * moves with the handle without turning, so the hand moves it exactly as
 * it would the handle (src/sim/mechanism.ts, `Lever.gripOffset`).
 */
export const CONVOY_GRIP_OFFSET: Readonly<Vec3> = [0, CONVOY_RAISE - CONVOY_GRIP_DROP, CONVOY_BACK];

/** The convoy grips' rod and handle, m: as thick as a tiller's handle. */
export const CONVOY_GRIP = { radius: 0.016, gripLength: 0.11, rodRadius: 0.009 } as const;

/** How the neck keeps clear of the hatch's rim, m: the head box stops this far from it. */
export const NECK_CLEARANCE = 0.07;

/** How far the eyes may rise in the convoy position before the player has stood up from the seat, m. */
export const CONVOY_HEAD_UP = 0.25;

const down = SEATS.driver;
const raisedEye = [down.eye[0], down.eye[1] + CONVOY_RAISE, down.eye[2] + CONVOY_BACK] as const;

/**
 * The driver's seat in the convoy position: the eye point, the cushion and
 * the floor under the player's real floor all up and back. The head is in
 * the hatch: the box stops the neck `NECK_CLEARANCE` from the rim; above
 * the roof nothing stands in the way.
 */
export const CONVOY_SEAT: Seat = {
  ...down,
  floorY: down.floorY + CONVOY_RAISE,
  eye: raisedEye,
  headBox: [
    raisedEye[0] - DRIVER_HATCH[0] - NECK_CLEARANCE,
    DRIVER_HATCH[2] - raisedEye[0] - NECK_CLEARANCE,
    raisedEye[2] - DRIVER_HATCH[1] - NECK_CLEARANCE,
    DRIVER_HATCH[3] - raisedEye[2] - NECK_CLEARANCE,
  ],
  headUp: CONVOY_HEAD_UP,
  cushion: [down.cushion[0], down.cushion[1] + CONVOY_RAISE, down.cushion[2] + CONVOY_BACK],
};

/** The seat `id` as it stands: the driver's raised when `convoy`. */
export function seatAs(id: SeatId, convoy: boolean): Seat {
  return id === 'driver' && convoy ? CONVOY_SEAT : SEATS[id];
}

/** The seat's move from down to up (and back), hull space, m. */
export const CONVOY_MOVE: Readonly<Vec3> = [0, CONVOY_RAISE, CONVOY_BACK];

/**
 * Raising and lowering the seat: the view fades to black, the seat moves
 * while it is black (a lift felt through the eyes alone is a comfort
 * problem), then it clears. Seconds for each half.
 */
export const CONVOY_FADE_SECONDS = 0.25;

/** A seat on its way up or down: where the fade is. */
export interface ConvoyMove {
  /** The seat as the player sits now (it changes at the darkest moment). */
  shown: boolean;
  /** Seconds into the move, or -1 when still. */
  t: number;
}

/**
 * Step a move towards `wanted` by `dt` s. Returns how dark the view is (0 to 1);
 * `move.shown` flips once, when it is black.
 */
export function stepConvoyMove(move: ConvoyMove, wanted: boolean, dt: number): number {
  if (move.t < 0) {
    if (wanted === move.shown) return 0;
    move.t = 0;
  }
  move.t += dt;
  const half = CONVOY_FADE_SECONDS;
  if (move.t < half) return move.t / half;
  if (move.shown !== wanted && move.t >= half) {
    // Black: the seat moves now.
    move.shown = wanted;
  }
  const back = 1 - (move.t - half) / half;
  if (back <= 0) {
    move.t = -1;
    return 0;
  }
  return back;
}

/**
 * The seat lever, on the right of the cushion's front, moving with the seat:
 * pull it back and the seat goes up, pull it again and it comes down, as a
 * Sherman's seat had a lever to free it. A kit lever that springs back
 * upright; pulled past `SEAT_LEVER_PULL` it moves the seat once, and must go
 * back past `SEAT_LEVER_RESET` before it moves it again.
 */
const DEG = Math.PI / 180;
/** Pulled this far back (rad, negative), the seat lever moves the seat. */
export const SEAT_LEVER_PULL = -22 * DEG;
/** Back within this of upright (rad, negative), it may move the seat again. */
export const SEAT_LEVER_RESET = -8 * DEG;
/** The seat lever: 28 cm, springing back upright, pulled back up to 30°, a tick where it moves the seat. */
export const SEAT_LEVER: LeverSpec = {
  length: 0.28,
  gripLength: 0.07,
  min: -30 * DEG,
  max: 0,
  rest: 0,
  spring: 10,
  detents: [SEAT_LEVER_PULL],
  deadband: 0,
};
/** The seat lever's pivot from the cushion's top middle, seat frame, m: right of the right thigh, at the cushion's front edge. */
export const SEAT_LEVER_FROM_CUSHION: Readonly<Vec3> = [0.26, -0.06, -0.14];

/** The seat lever's latch: true once a pull has moved the seat, until it goes back. Returns true on the pull that moves the seat. */
export function seatLeverPulled(latch: { pulled: boolean }, angle: number): boolean {
  if (latch.pulled) {
    if (angle > SEAT_LEVER_RESET) latch.pulled = false;
    return false;
  }
  if (angle <= SEAT_LEVER_PULL) {
    latch.pulled = true;
    return true;
  }
  return false;
}

/** The seat lever's pivot in hull space for the seat as it stands, into `out`. */
export function seatLeverPivot(convoy: boolean, out: Vec3): Vec3 {
  const c = seatAs('driver', convoy).cushion;
  out[0] = c[0] + SEAT_LEVER_FROM_CUSHION[0];
  out[1] = c[1] + SEAT_LEVER_FROM_CUSHION[1];
  out[2] = c[2] + SEAT_LEVER_FROM_CUSHION[2];
  return out;
}

/**
 * How far the driver's periscope goes down into its holder in the convoy
 * position, so it isn't in front of the face, m: its head's top stays 6 mm
 * proud of the roof (test/z-fighting.test.ts).
 */
export function periscopeLowered(head: { bottom: number; top: number }): number {
  return head.top - (HULL.roof + HULL.wall) - 0.006;
}

/**
 * The hatch's lid swung open beside the hole, as the convoy position needs:
 * lifted a little and swung outboard (left) about a post at the hole's
 * front-left corner, lying flat, so nothing stands ahead of the driver's face.
 * Its box (x0, x1, y0, y1, z0, z1), hull space, m.
 */
export const LID_ASIDE = (() => {
  const [hx0, hz0, hx1, hz1] = DRIVER_HATCH;
  const top = HULL.roof + HULL.wall;
  const gap = 0.03;
  const lift = 0.03;
  const thickness = 0.05;
  return {
    x0: hx0 - gap - (hx1 - hx0),
    x1: hx0 - gap,
    y0: top + lift,
    y1: top + lift + thickness,
    z0: hz0,
    z1: hz1,
    post: { x: hx0 - gap / 2, z: hz0 + 0.03, radius: 0.025 },
  };
})();

/** The eyes' clearance from the lid swung aside at the head box's edge, m (test/convoy-seat.test.ts holds it to EYE_CLEARANCE). */
export function eyesFromLid(): number {
  return CONVOY_SEAT.eye[0] - CONVOY_SEAT.headBox[0] - LID_ASIDE.x1;
}
