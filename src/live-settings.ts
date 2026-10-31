import { DEFAULT_SETTINGS, SAVED_SETTINGS_KEY, type Settings, settings } from './settings.js';

/**
 * One choice in the in-game Settings menu (src/systems/game-menu-system.ts):
 * a setting that takes effect straight away, without reloading the page.
 * `key` is the setting's name in the URL and in the saved settings, which for
 * these is also its name in `Settings`.
 */
export interface LiveItem {
  key: keyof Settings & string;
  label: string;
  options: readonly (readonly [value: string, label: string])[];
  /** The value in effect, as the URL would spell it. */
  current: (s: Settings) => string;
}

const onOff = (s: boolean) => (s ? '1' : '0');

/**
 * The in-game menu's settings, in the order shown, each a row of buttons
 * with one per choice. Each is applied by the system that owns it, listening
 * with `onSettingChange`. Adding one here needs a row for it in
 * public/ui/menu.uikitml (`row-<key>`, with up to four choices).
 */
export const LIVE_ITEMS: readonly LiveItem[] = [
  {
    key: 'sound',
    label: 'Tank sounds',
    options: [
      ['1', 'On'],
      ['0.5', 'Quiet'],
      ['0', 'Off'],
    ],
    current: (s) => String(s.sound),
  },
  // Comfort (F1.14): shown in the menu's Comfort and stats section.
  {
    key: 'vignette',
    label: 'Vignette',
    options: [
      ['0', 'Off'],
      ['0.3', 'Light'],
      ['0.5', 'Normal'],
      ['0.8', 'Strong'],
    ],
    current: (s) => String(s.vignette),
  },
  {
    key: 'bumps',
    label: 'Bumps',
    options: [
      ['full', 'Full'],
      ['reduced', 'Reduced'],
    ],
    current: (s) => s.bumps,
  },
  // The drive (F1.16): shown in the menu's Driving section.
  {
    key: 'gearbox',
    label: 'Gearbox',
    options: [
      ['auto', 'Automatic'],
      ['stick', 'Stick shift'],
      ['clutch', 'Clutch'],
    ],
    current: (s) => s.gearbox,
  },
  { key: 'hud', label: 'Perf HUD (X)', options: [['1', 'On'], ['0', 'Off']], current: (s) => onOff(s.hud) },
  {
    key: 'hz',
    label: 'Frame rate (Hz)',
    options: [
      ['72', '72'],
      ['80', '80'],
      ['90', '90'],
      ['120', '120'],
    ],
    current: (s) => String(s.hz),
  },
  // The cabin's look (src/sim/interior.ts): shown in the menu's Sound and view tab.
  {
    key: 'hatches',
    label: 'Open hatches',
    options: [
      ['both', 'Both'],
      ['driver', "Driver's"],
      ['gunner', "Gunner's"],
      ['none', 'None'],
    ],
    current: (s) => s.hatches,
  },
  {
    key: 'cabin',
    label: 'Cabin light',
    options: [
      ['0.5', 'Darker'],
      ['1', 'Normal'],
      ['2', 'Lighter'],
      ['4', 'Bright'],
    ],
    current: (s) => String(s.cabin),
  },
  {
    key: 'lamps',
    label: 'Dome lamps',
    options: [
      ['0', 'Off'],
      ['0.5', 'Dim'],
      ['1', 'Normal'],
      ['2', 'Bright'],
    ],
    current: (s) => String(s.lamps),
  },
  { key: 'fog', label: 'Range fog', options: [['1', 'On'], ['0', 'Off']], current: (s) => onOff(s.fog) },
  {
    key: 'foveation',
    label: 'Foveation',
    options: [
      ['0', 'Off'],
      ['0.5', 'Half'],
      ['1', 'Full'],
    ],
    current: (s) => String(s.foveation),
  },
];

/** Most choices a setting may offer: the buttons in a menu row. */
export const MAX_OPTIONS = 4;

/**
 * The saved settings query string with `key` set to `value`, or dropped when
 * `value` is the default, so a later change of default still reaches players
 * who never picked that setting.
 */
export function withSetting(saved: string, key: string, value: string, defaultValue: string): string {
  const params = new URLSearchParams(saved);
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  return params.toString();
}

/** Turn `value`, as the URL spells it, into `key`'s type in `Settings`. */
function typed(key: keyof Settings, value: string): Settings[keyof Settings] {
  const d = DEFAULT_SETTINGS[key];
  if (typeof d === 'boolean') {
    return value === '1' || value === 'true' || value === 'on';
  }
  if (typeof d === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : d;
  }
  return value;
}

type Listener = (key: keyof Settings) => void;
const listeners = new Set<Listener>();

/** Call `listener` with the key whenever an in-game setting changes; returns the unsubscribe. */
export function onSettingChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Change `item`'s setting to `value` (as the URL spells it) while playing:
 * update the settings everyone reads, keep the choice in this browser for
 * next time, and tell the systems that apply it.
 */
export function changeSetting(item: LiveItem, value: string): void {
  (settings as unknown as Record<string, unknown>)[item.key] = typed(item.key, value);
  try {
    const saved = localStorage.getItem(SAVED_SETTINGS_KEY) ?? '';
    const next = withSetting(saved, item.key, value, item.current(DEFAULT_SETTINGS));
    if (next) {
      localStorage.setItem(SAVED_SETTINGS_KEY, next);
    } else {
      localStorage.removeItem(SAVED_SETTINGS_KEY);
    }
  } catch {
    // Private browsing: the choice lasts for this visit only.
  }
  console.info(`[Settings] ${item.key} = ${value}`);
  for (const listener of listeners) {
    listener(item.key);
  }
}
