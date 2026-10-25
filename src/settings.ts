import { clampCharacterHeight } from './sim/body-height.js';

/**
 * Runtime settings, read once when the page loads: first the ones saved from
 * the in-game menu (src/live-settings.ts) and the page's start-up settings
 * (src/settings-menu.ts), then any in the
 * page URL on top, so a test build can still be tuned from the address bar
 * without a rebuild. Example: `?hz=72&hud=1&netlag=75`.
 */
export interface Settings {
  /** Requested XR frame rate; the nearest supported rate at or below is used. */
  hz: number;
  /** One shadow-casting directional light limited to the play area. */
  shadows: boolean;
  /** Fixed foveation, 0 (off) to 1 (maximum). */
  foveation: number;
  /** WebXR framebuffer scale; 1 is the browser default. */
  framebufferScale: number;
  /** Loose physics blocks on the table. */
  blocks: number;
  /** Show the perf HUD from the start. */
  hud: boolean;
  /** Crew room code to join on load (four letters), or '' to stay solo. */
  room: string;
  /** Lobby base URL (ws:// or wss://); '' uses the build default. */
  lobby: string;
  /** Player name shown to the crewmate. */
  name: string;
  /** Simulated extra one-way latency on received packets, ms (testing only). */
  netLag: number;
  /** Simulated random extra delay on received packets, 0 to this many ms. */
  netJitter: number;
  /** Simulated loss of received pose packets, 0 to 1. */
  netLoss: number;
  /** Crewmate voice: 'spatial' (HRTF at their head), 'plain' (not positioned) or 'off'. */
  voice: 'spatial' | 'plain' | 'off';
  /** Route spatial voice through a loopback peer connection so echo cancellation sees it. */
  voiceLoop: boolean;
  /** Tracked hands grip when the fingers' average curl falls below this (1 straight, about 0.4 a fist). */
  fist: number;
  /** Tracked hands grip when the thumb and index tips are closer than this, cm; 0 turns pinch-to-grip off. */
  pinch: number;
  /** A tag for this session (tester or variant) written into the perf log. */
  label: string;
  /**
   * This page plays as the practice crewmate, a bot that joins the crew as
   * the second player so one person can test the two-player parts.
   */
  bot: boolean;
  /** Character height, m: the player's eyes are put at this height less 0.13 m when upright; 0 keeps their own (src/sim/body-height.ts). */
  height: number;
  /** Playing seated: the view is raised to a little under an average standing eye height. */
  seated: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hz: 90,
  shadows: false,
  foveation: 1,
  framebufferScale: 1,
  blocks: 6,
  hud: true,
  room: '',
  lobby: '',
  name: '',
  netLag: 0,
  netJitter: 0,
  netLoss: 0,
  voice: 'spatial',
  voiceLoop: false,
  fist: 0.6,
  pinch: 2,
  label: '',
  bot: false,
  height: 0,
  seated: false,
};

function num(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function bool(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) {
    return fallback;
  }
  return raw === '1' || raw === 'true' || raw === 'on' || raw === '';
}

function voiceMode(raw: string | null, fallback: Settings['voice']): Settings['voice'] {
  return raw === 'spatial' || raw === 'plain' || raw === 'off' ? raw : fallback;
}

export function parseSettings(search: string): Settings {
  const params = new URLSearchParams(search);
  const d = DEFAULT_SETTINGS;
  return {
    hz: num(params, 'hz', d.hz, 60, 120),
    shadows: bool(params, 'shadows', d.shadows),
    foveation: num(params, 'foveation', d.foveation, 0, 1),
    framebufferScale: num(params, 'fbscale', d.framebufferScale, 0.5, 1.5),
    blocks: Math.round(num(params, 'blocks', d.blocks, 0, 30)),
    hud: bool(params, 'hud', d.hud),
    room: params.get('room') ?? d.room,
    lobby: params.get('lobby') ?? d.lobby,
    name: (params.get('name') ?? d.name).slice(0, 24),
    netLag: num(params, 'netlag', d.netLag, 0, 2000),
    netJitter: num(params, 'netjitter', d.netJitter, 0, 1000),
    netLoss: num(params, 'netloss', d.netLoss, 0, 1),
    voice: voiceMode(params.get('voice'), d.voice),
    voiceLoop: bool(params, 'voiceloop', d.voiceLoop),
    fist: num(params, 'fist', d.fist, 0.2, 0.95),
    pinch: num(params, 'pinch', d.pinch, 0, 6),
    label: (params.get('label') ?? d.label).slice(0, 40),
    bot: bool(params, 'bot', d.bot),
    height: clampCharacterHeight(num(params, 'height', d.height, 0, 3)),
    seated: bool(params, 'seated', d.seated),
  };
}

/** Where the Settings menu keeps its choices, as a URL query string. */
export const SAVED_SETTINGS_KEY = 'coop-vr.settings';

/** The saved settings with the URL's on top, as one query string. */
export function mergeSettings(saved: string, search: string): string {
  const params = new URLSearchParams(saved);
  new URLSearchParams(search).forEach((value, key) => params.set(key, value));
  return params.toString();
}

/**
 * Keep settings chosen while playing (null drops one, back to its default)
 * for the next load, as the Settings menu would. The URL still wins.
 */
export function saveSettings(changes: Readonly<Record<string, string | null>>): void {
  try {
    const params = new URLSearchParams(savedSettings());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    localStorage.setItem(SAVED_SETTINGS_KEY, params.toString());
  } catch {
    // Private browsing: the choice lasts until the page is closed.
  }
}

function savedSettings(): string {
  try {
    return localStorage.getItem(SAVED_SETTINGS_KEY) ?? '';
  } catch {
    return '';
  }
}

export const settings: Settings =
  typeof location === 'undefined' ? DEFAULT_SETTINGS : parseSettings(mergeSettings(savedSettings(), location.search));
