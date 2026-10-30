import type { SessionState } from './net/net-session.js';
import type { SeatId } from './sim/cabin.js';

/**
 * How the player chose to play on the start screen
 * (src/systems/start-screen-system.ts). Pure TypeScript, so the words can be
 * tested.
 *
 * - `solo`: on their own.
 * - `practice`: a crew whose second player is the practice crewmate, a bot
 *   played by a page on a PC.
 * - `host`: started a crew for a friend to join.
 * - `join`: joined a friend's crew by its code.
 * - `link`: opened a link with a crew code in it.
 */
export type PlayMode = 'solo' | 'practice' | 'host' | 'join' | 'link';

/** The start screen's pages. */
export type StartPage = 'home' | 'join' | 'crew';

/** What the start screen's crew page says. */
export interface CrewScreen {
  title: string;
  status: string;
  help: string;
  /** The crewmate is here: the game starts by itself. */
  ready: boolean;
}

/**
 * The crew page's words for crew `room` in session state `state` (with the
 * session's `detail`), for a crew made or joined as `mode`. `gameUrl` is the
 * game's address without the scheme, for the practice crewmate's page.
 */
export function crewScreen(mode: PlayMode, state: SessionState, room: string, detail: string, crewmate: string, gameUrl: string): CrewScreen {
  const title = `Crew ${room}`;
  const practiceHelp = `On a PC, open ${gameUrl}/?room=${room}&bot=1 or open the game, choose Join a crew, type ${room} and press Join as practice crewmate.`;
  const hostHelp = `Tell your crewmate the code ${room}. They choose Join a crew and type it in.`;
  switch (state) {
    case 'connected':
      return { title, status: `${crewmate || 'Your crewmate'} is aboard.`, help: 'Starting...', ready: true };
    case 'full':
      return { title, status: `Crew ${room} already has two players.`, help: 'Check the code, or start a crew of your own.', ready: false };
    case 'error':
      return { title, status: `Couldn't reach crew ${room}: ${detail || 'connection problem'}.`, help: 'Go back and try again.', ready: false };
    case 'connecting':
      return { title, status: detail?.startsWith('reconnecting') ? 'Reconnecting to your crewmate...' : 'Connecting to your crewmate...', help: '', ready: false };
    case 'waiting':
      return {
        title,
        status: mode === 'practice' ? 'Waiting for the practice crewmate.' : 'Waiting for your crewmate.',
        help: mode === 'practice' ? practiceHelp : mode === 'join' || mode === 'link' ? `Your crewmate can join with the code ${room}.` : hostHelp,
        ready: false,
      };
    case 'lobby':
      return { title, status: `Joining crew ${room}...`, help: '', ready: false };
    case 'idle':
    case 'closed':
      return { title, status: 'Not in a crew.', help: '', ready: false };
  }
}

/** The code typed so far on the join page, with blanks for the letters still to come. */
export function codeShown(typed: string): string {
  return [0, 1, 2, 3].map((i) => typed[i] ?? '_').join(' ');
}

/** `typed` with key `key` pressed: a letter is added (up to four), 'del' removes the last. */
export function typeCode(typed: string, key: string): string {
  if (key === 'del') {
    return typed.slice(0, -1);
  }
  return typed.length < 4 && /^[A-Z]$/.test(key) ? typed + key : typed;
}

/** The menu's line about the crew, '' when playing solo. */
export function menuCrewLine(state: SessionState, room: string, crewmate: string, practice: boolean): string {
  if (!room || state === 'idle' || state === 'closed') {
    return '';
  }
  const who = crewmate || (practice ? 'the practice crewmate' : 'your crewmate');
  switch (state) {
    case 'connected':
      return `Crew ${room}: playing with ${who}.`;
    case 'waiting':
      return `Crew ${room}: waiting for ${practice ? 'the practice crewmate' : 'a crewmate'}.`;
    case 'connecting':
    case 'lobby':
      return `Crew ${room}: connecting...`;
    case 'full':
      return `Crew ${room} already has two players.`;
    case 'error':
      return `Crew ${room}: connection problem.`;
  }
}

/** The game menu's tabs, top to bottom (`tab-<id>` and `page-<id>` in public/ui/menu.uikitml). */
export const MENU_TABS = ['crew', 'you', 'comfort', 'view', 'tank', 'practice', 'sights', 'rigs'] as const;
export type MenuTab = (typeof MENU_TABS)[number];

/** The tab the menu opens on, the first time. */
export const FIRST_MENU_TAB: MenuTab = 'you';

/** The tab the menu shows when `wanted` was picked last: Crew's only shows in a crew, so out of one it falls back to the first. */
export function menuTab(wanted: MenuTab, inCrew: boolean): MenuTab {
  return wanted === 'crew' && !inCrew ? FIRST_MENU_TAB : wanted;
}

/** `id` as one of the menu's tabs, or `fallback` if it isn't one. */
export function parseMenuTab(id: string, fallback: MenuTab): MenuTab {
  return (MENU_TABS as readonly string[]).includes(id) ? (id as MenuTab) : fallback;
}

/**
 * The eye raise after one press of the menu's + (`direction` 1) or −
 * (-1): one `step` up or down, between -`max` and `max`.
 */
export function stepRaise(raise: number, direction: 1 | -1, step: number, max: number): number {
  const steps = Math.round(raise / step) + direction;
  const stepped = Math.min(max, Math.max(-max, steps * step));
  return Number(stepped.toFixed(2)) || 0;
}

/** What the menu shows for eye raise `raise` (m): how far above or below the seat's eye point, in cm. */
export function raiseShown(raise: number): string {
  const cm = Math.round(raise * 100);
  if (cm === 0) {
    return '0 cm';
  }
  return `${cm > 0 ? '+' : '−'}${Math.abs(cm)} cm`;
}

/** The menu's line about the last calibration: eye height and reach, or that there was none. */
export function calibrationShown(eye: number, reach: number): string {
  if (!Number.isFinite(eye)) {
    return 'Not calibrated yet: eyes measured as you play.';
  }
  const reachText = Number.isFinite(reach) ? `, reach ${Math.round(reach * 100)} cm` : '';
  return `Calibrated: eyes ${eye.toFixed(2)} m above your floor${reachText}.`;
}

/** "You drive" or "You gun", for seat `seat`. */
function youIn(seat: SeatId): string {
  return seat === 'driver' ? 'You drive' : 'You lay and fire the gun';
}

/**
 * The crew page's line about the seats: where this player sits, where the
 * crewmate does once aboard, and any swap waiting for a word.
 */
export function seatsLine(mine: SeatId, crew: SeatId, aboard: boolean, swap: 'none' | 'asked' | 'offered'): string {
  if (!aboard) {
    return `${youIn(mine)}. If your crewmate picks the same seat, whoever started the crew keeps it.`;
  }
  if (swap === 'asked') {
    return 'Asked your crewmate to swap seats.';
  }
  if (swap === 'offered') {
    return 'Your crewmate asks to swap seats: pick their seat to agree.';
  }
  return `${youIn(mine)}; your crewmate is the ${crew === 'driver' ? 'driver' : 'gunner'}.`;
}
