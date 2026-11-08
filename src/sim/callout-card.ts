/**
 * The callout card (F2.6, docs/callout-card.md): a placard in each seat
 * with the crew's short callouts and a clock face for target directions,
 * so a new crew has the words in front of them. Engine-free: where each
 * card hangs and what it says, shared by the model
 * (src/scene-assets/callout-card.scene-asset.ts), the system that draws its
 * face (src/systems/callout-card-system.ts) and the tests.
 *
 * The words the menu's Calls send (src/sim/crew-bot.ts CALL_WORDS) are on
 * the card exactly as the sign shows them, so the card, the sign and the
 * practice crewmate use one vocabulary; the card adds the calls that are
 * voice only (traverse and target calls).
 */

import { CALL_FROM, CALL_WORDS, type CrewCall } from './crew-bot.js';
import { HULL, otherSeat, type SeatId, SEATS, TURRET } from './cabin.js';

/**
 * Where a card hangs, in its seat's frame (hull space for the driver,
 * turret space for the gunner): its face's middle, its size, and its turn
 * about +Y (the face looks along its own +Z), m and rad.
 */
export interface CardPlace {
  frame: 'hull' | 'turret';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  yaw: number;
}

/** The backing plate: how far it sinks into the wall, how far its face stands proud of the wall, m. */
export const CARD_SUNK = 0.008;
export const CARD_PROUD = 0.006;
/** The printed face stands this far in front of the backing's face (the 3 mm rule, with room), m. */
export const CARD_FACE_GAP = 0.004;
/** The backing's border round the face, m. */
export const CARD_BORDER = 0.012;

/** The card's face's distance out from the wall it hangs on, m. */
export const CARD_OUT = CARD_PROUD + CARD_FACE_GAP;

/**
 * The two cards. The driver's is on the hull's left wall beside their
 * head, a turn of the head to the left and a little down, below the cable
 * conduit and above the hand throttle, 60 cm from the eyes. The gunner's
 * is on the turret's front wall left of the gunsight, over the breech and
 * clear of the eyepiece from the eye point, where the gunner sees it when
 * they sit back from the sight; it is further away (about 1.3 m), so it is
 * bigger. Both are 3:2, as the face's canvas.
 */
export const CARDS: Readonly<Record<SeatId, CardPlace>> = {
  driver: {
    frame: 'hull',
    x: -HULL.halfWidth + CARD_OUT,
    y: 1.24,
    z: SEATS.driver.eye[2],
    width: 0.36,
    height: 0.24,
    yaw: Math.PI / 2,
  },
  gunner: {
    frame: 'turret',
    x: -0.58,
    y: 2.42,
    z: TURRET.front + HULL.wall + CARD_OUT,
    width: 0.54,
    height: 0.36,
    yaw: 0,
  },
};

/** Calls on the menu's Calls that are only for practice, so not on the card. */
const PRACTICE_ONLY: readonly CrewCall[] = ['route'];

/** Calls made by voice only (no Calls button), by who makes them. */
export const VOICE_CALLS: Readonly<Record<SeatId, readonly string[]>> = {
  driver: ['Traverse left', 'Traverse right', "Target, tank, 2 o'clock"],
  gunner: [],
};

/** The words `seat` calls out, the Calls' first, then the voice-only ones. */
export function callsBy(seat: SeatId): string[] {
  const words: string[] = [];
  for (const call of Object.keys(CALL_WORDS) as CrewCall[]) {
    if (CALL_FROM[call] === seat && !PRACTICE_ONLY.includes(call)) words.push(CALL_WORDS[call]);
  }
  return words.concat(VOICE_CALLS[seat]);
}

/** What one card says: the calls its seat makes, the calls it hears, and the clock face's notes. */
export interface CardText {
  title: string;
  sayHeading: string;
  say: string[];
  hearHeading: string;
  hear: string[];
  clockHeading: string;
  clockNote: string;
}

/** The card in `seat`. */
export function cardText(seat: SeatId): CardText {
  const other = otherSeat(seat);
  return {
    title: 'CREW CALLS',
    sayHeading: `YOU CALL (${SEATS[seat].label.toUpperCase()})`,
    say: callsBy(seat),
    hearHeading: `YOU HEAR (${SEATS[other].label.toUpperCase()})`,
    hear: callsBy(other),
    clockHeading: 'TARGETS BY THE CLOCK',
    clockNote: "12 is the hull's front",
  };
}

/**
 * The clock face's hours as drawn on the card, looking down on the hull:
 * hour `h` (1 to 12) at angle `clockAngle(h)` from 12, clockwise, rad.
 * 12 is the hull's front, 3 its right, 6 its rear and 9 its left.
 */
export function clockAngle(hour: number): number {
  return ((hour % 12) / 12) * Math.PI * 2;
}
