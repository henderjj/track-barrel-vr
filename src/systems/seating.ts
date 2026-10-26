import { otherSeat, type SeatId } from '../sim/cabin.js';
import { settings } from '../settings.js';

/**
 * Who sits where, for the systems that draw or drive a seat (SeatSystem
 * owns it; see docs/cabin.md). Kept in a module of its own so NetSystem
 * and SeatSystem can both read it without importing each other.
 */
export const seating = {
  /** This player's seat. */
  mine: settings.seat,
  /** The crewmate's seat, while there is a crewmate. */
  crew: otherSeat(settings.seat),
  /** The turret's angle from facing forward, rad, positive to the left, as drawn on this page (TurretSystem sets it, F1.8). */
  turretYaw: 0,
  /** How fast the turret is traversing, rad/s (TurretSystem; the comfort vignette adds it for the gunner). */
  turretRate: 0,
  /**
   * Ask for a seat: taken at once when alone or before the crewmate is
   * aboard; in a crew, asking for the crewmate's seat asks them to swap,
   * and the host swaps both once both have asked. Set by SeatSystem.
   */
  ask: (_seat: SeatId): void => undefined,
  /**
   * A swap of seats waiting for a word (F1.2): 'asked' while this player's
   * ask waits for the crewmate's, 'offered' while the crewmate's waits for
   * this player's, 'none' otherwise.
   */
  swap: 'none' as 'none' | 'asked' | 'offered',
  /** How many times SeatSystem has put this player in a seat (so a system can wait for the next). */
  placements: 0,
  /** Put this player back in their seat, facing forward (the menu's Back in my seat). Set by SeatSystem. */
  reseat: (): void => undefined,
  /**
   * Set while a spike sits the player somewhere else (riding, S2; the
   * breech, S4): SeatSystem leaves the play space alone until it is
   * cleared, then puts the player back in their seat. Choosing a seat or
   * Back in my seat clears it.
   */
  away: false,
};
