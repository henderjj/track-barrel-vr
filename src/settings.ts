import { clampEyeRaise } from './sim/body-height.js';
import { parseSeat, type SeatId } from './sim/cabin.js';
import { type Bumps, parseBumps, VIGNETTE_STRENGTHS } from './sim/comfort.js';
import { type EngineStart, parseEngineStart } from './sim/engine.js';
import { type GearboxMode, parseGearbox } from './sim/gearbox.js';
import { type OpenHatches, parseHatches } from './sim/interior.js';

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
  /** Crewmate voice: 'plain' (the intercom, not positioned; the default since F1.12), 'spatial' (HRTF at their head) or 'off'. */
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
  /** How far to raise (+) or drop (-) the player's eyes from their seat's eye point, m (src/sim/body-height.ts). */
  raise: number;
  /** Playing seated (the default) or standing: either way the eyes land on the seat's eye point; it changes what calibration asks. */
  seated: boolean;
  /** The seat a player starts in when playing alone or starting a crew (a guest is given the other one), src/sim/cabin.ts. */
  seat: SeatId;
  /**
   * Draw the drive's ground (F1.4). `ground=0` hides it, for the network
   * test: its software renderer slows to about half the frame rate drawing
   * the ground's triangles, too few frames for the motion checks.
   */
  ground: boolean;
  /**
   * The test range's fog (F1.7, src/sim/range.ts). `fog=0` turns it off at
   * load; the game menu's Range section turns it off at once.
   */
  fog: boolean;
  /**
   * The tank's sounds (F1.12, src/systems/tank-audio-system.ts): 1 full,
   * 0.5 quiet, 0 off. The game menu's Sound and view section changes it at once.
   */
  sound: number;
  /**
   * How dark the comfort vignette gets at its strongest while the tank
   * moves (F1.14, src/sim/comfort.ts): 0 off, 0.3 light, 0.5 normal (the
   * default), 0.8 strong. The game menu's Comfort section changes it at once.
   */
  vignette: number;
  /**
   * Reduced bumps (F1.14): 'reduced' asks for the hull to take less of the
   * ground's tilt, more slowly; the tank rides reduced if either player
   * asks. 'full' (the default) is every bump within the comfort caps.
   */
  bumps: Bumps;
  /**
   * How this player drives the tank's gearbox (F1.16, src/sim/gearbox.ts):
   * 'auto' (the default; tillers push to drive), 'stick' (the right stick
   * changes gear) or 'clutch' (the left trigger is the clutch). With 'stick'
   * and 'clutch' the right trigger is the accelerator and the tillers are
   * brakes. The game menu's Driving section changes it at once.
   */
  gearbox: GearboxMode;
  /**
   * How much of the engine's start-up this player does as the driver
   * (F1.17, src/sim/engine.ts): 'running' (the engine is already running),
   * 'starter' (the default; hold the starter button) or 'full' (battery,
   * ignition, choke, hand throttle and starter, then a warm-up). The game
   * menu's Driving section changes it at once.
   */
  engine: EngineStart;
  /**
   * The cabin's look (src/sim/interior.ts's CabinLook), to find what looks
   * best (John's headset check, 2026-10-30): which hatches stand open
   * ('both', the default, 'driver', 'gunner' or 'none'); the ambient light
   * inside times `cabin` (1 the default); the dome lamps times `lamps` (0
   * off, 1 the default). The game menu's Sound and view tab changes them at once.
   */
  hatches: OpenHatches;
  cabin: number;
  lamps: number;
}

export const DEFAULT_SETTINGS: Settings = {
  hz: 90,
  shadows: false,
  foveation: 1,
  framebufferScale: 1,
  hud: true,
  room: '',
  lobby: '',
  name: '',
  netLag: 0,
  netJitter: 0,
  netLoss: 0,
  voice: 'plain',
  voiceLoop: false,
  fist: 0.6,
  pinch: 2,
  label: '',
  bot: false,
  raise: 0,
  seated: true,
  seat: 'driver',
  ground: true,
  fog: true,
  sound: 1,
  vignette: VIGNETTE_STRENGTHS.normal,
  bumps: 'full',
  gearbox: 'auto',
  engine: 'starter',
  hatches: 'both',
  cabin: 1,
  lamps: 1,
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
    raise: clampEyeRaise(num(params, 'raise', d.raise, -1, 1)),
    seated: bool(params, 'seated', d.seated),
    seat: parseSeat(params.get('seat'), d.seat),
    ground: bool(params, 'ground', d.ground),
    fog: bool(params, 'fog', d.fog),
    sound: num(params, 'sound', d.sound, 0, 1),
    vignette: num(params, 'vignette', d.vignette, 0, 1),
    bumps: parseBumps(params.get('bumps'), d.bumps),
    gearbox: parseGearbox(params.get('gearbox'), d.gearbox),
    engine: parseEngineStart(params.get('engine'), d.engine),
    hatches: parseHatches(params.get('hatches'), d.hatches),
    cabin: num(params, 'cabin', d.cabin, 0.1, 8),
    lamps: num(params, 'lamps', d.lamps, 0, 4),
  };
}

/** Where the Settings menu keeps its choices, as a URL query string. */
export const SAVED_SETTINGS_KEY = 'track-barrel.settings';

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
