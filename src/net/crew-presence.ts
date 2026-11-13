import type { SessionState } from './net-session.js';

/**
 * Whether the crewmate is here (spike S10). The game needs both players, so
 * when one of them can't play (headset off, Meta button, headset asleep,
 * network down, tab closed) the game pauses with a message saying why, and
 * carries on when they're back. Pure TypeScript.
 *
 * - `solo`: no crewmate yet in this room; nothing pauses.
 * - `together`: both playing.
 * - `away`: the crewmate's headset or tab is not showing the game.
 * - `silent`: connected, but nothing has arrived from the crewmate for a
 *   while (a frozen page or a dying network).
 * - `reconnecting`: the connection dropped and is being made again.
 * - `waiting`: the crewmate left the room (closed the tab); waiting for them.
 * - `lost`: reconnecting gave up.
 */
export type CrewStatus = 'solo' | 'together' | 'away' | 'silent' | 'reconnecting' | 'waiting' | 'lost';

/** No packets from a connected crewmate for this long counts as silent (they send at 45 Hz). */
export const SILENT_MS = 1500;

/** How many statuses `CrewPresence.history` keeps. */
const HISTORY = 16;

export class CrewPresence {
  status: CrewStatus = 'solo';
  /** A crewmate has been connected since this player joined the room. */
  hadCrew = false;
  /**
   * The statuses this player has been through, the newest last. A status
   * can come and go between two frames (a reconnect takes a few hundred
   * milliseconds, a frame of the software-rendered tests as long), so
   * whoever needs to know that it happened reads this, not `status`.
   */
  readonly history: CrewStatus[] = ['solo'];
  /** How many statuses `history` has ever held, to find the new ones once old ones have dropped off. */
  changes = 1;

  /**
   * `state` is the session state, `reconnecting` says the session is getting
   * back after a drop, `crewAway` is the crewmate's last presence report and
   * `packetAgeMs` the time since anything arrived from them.
   */
  update(state: SessionState, reconnecting: boolean, crewAway: boolean, packetAgeMs: number): CrewStatus {
    const before = this.status;
    this.decide(state, reconnecting, crewAway, packetAgeMs);
    if (this.status !== before) {
      this.history.push(this.status);
      this.changes++;
      if (this.history.length > HISTORY) {
        this.history.shift();
      }
    }
    return this.status;
  }

  private decide(state: SessionState, reconnecting: boolean, crewAway: boolean, packetAgeMs: number): void {
    if (state === 'connected') {
      this.hadCrew = true;
      this.status = crewAway ? 'away' : packetAgeMs > SILENT_MS ? 'silent' : 'together';
    } else if (state === 'idle' || state === 'closed' || state === 'full') {
      // This player left (or never got in): the old crew no longer applies.
      this.hadCrew = false;
      this.status = 'solo';
    } else if (!this.hadCrew) {
      this.status = 'solo';
    } else if (state === 'error') {
      this.status = 'lost';
    } else if (reconnecting) {
      this.status = 'reconnecting';
    } else if (state === 'waiting') {
      this.status = 'waiting';
    } else {
      // Lobby or connecting again after the crewmate came back.
      this.status = 'reconnecting';
    }
  }

  /** The shared game is on hold. */
  get paused(): boolean {
    return this.status !== 'solo' && this.status !== 'together';
  }

  /** What to tell this player while paused. */
  message(): string {
    switch (this.status) {
      case 'away':
        return 'Your crewmate stepped away';
      case 'silent':
        return 'Your crewmate is not responding';
      case 'reconnecting':
        return 'Reconnecting to your crewmate';
      case 'waiting':
        return 'Your crewmate left. Waiting for them to rejoin';
      case 'lost':
        return 'Lost the connection to your crew';
      default:
        return '';
    }
  }
}

/** This player's view of the crewmate, shared by the systems that pause or show it. */
export const crewPresence = new CrewPresence();
