import { describe, expect, it } from 'vitest';
import { LIVE_ITEMS, MAX_OPTIONS, withSetting } from '../src/live-settings.js';
import { MENU_ITEMS, menuQuery } from '../src/settings-menu.js';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings } from '../src/settings.js';

describe('start-up settings', () => {
  it('saves only the choices that differ from the defaults', () => {
    expect(menuQuery({ voice: 'plain', shadows: '1' })).toBe('shadows=1');
    expect(menuQuery({ voice: 'plain', shadows: '0' })).toBe('');
  });

  it('keeps the in-game settings saved before', () => {
    expect(menuQuery({ voice: 'spatial', shadows: '0' }, 'hud=0&shadows=1&hz=72')).toBe('hud=0&hz=72&voice=spatial');
  });

  it('lets the URL win over the saved settings', () => {
    const merged = mergeSettings('hud=0&voice=plain', '?voice=off&room=ABCD');
    const s = parseSettings(merged);
    expect(s.hud).toBe(false);
    expect(s.voice).toBe('off');
    expect(s.room).toBe('ABCD');
  });

  it('play the intercom voice plain by default (F1.12)', () => {
    expect(DEFAULT_SETTINGS.voice).toBe('plain');
    expect(parseSettings('?voice=spatial').voice).toBe('spatial');
  });

  it('are not also in the game menu', () => {
    const live = new Set(LIVE_ITEMS.map((item) => item.key));
    expect(MENU_ITEMS.filter((item) => live.has(item.key as never))).toEqual([]);
  });
});

describe('in-game settings', () => {
  it('fit a row of the menu', () => {
    for (const item of LIVE_ITEMS) {
      expect(item.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
      expect(item.options.map(([value]) => value)).toContain(item.current(DEFAULT_SETTINGS));
    }
  });

  it('are saved with the others, and dropped when back to the default', () => {
    expect(withSetting('voice=plain', 'hud', '0', '1')).toBe('voice=plain&hud=0');
    expect(withSetting('voice=plain&hud=0', 'hud', '1', '1')).toBe('voice=plain');
    const s = parseSettings(mergeSettings(withSetting('', 'hz', '72', '90'), ''));
    expect(s.hz).toBe(72);
    // Tank sounds (F1.12): quiet is kept, on is the default and dropped.
    expect(withSetting('', 'sound', '0.5', '1')).toBe('sound=0.5');
    expect(parseSettings('?sound=0.5').sound).toBe(0.5);
    expect(parseSettings('?sound=3').sound).toBe(1);
  });

  it("offer the cabin's look: which hatches stand open, the cabin light and the dome lamps (docs/interior.md)", () => {
    expect([DEFAULT_SETTINGS.hatches, DEFAULT_SETTINGS.cabin, DEFAULT_SETTINGS.lamps]).toEqual(['both', 1, 1]);
    const s = parseSettings('?hatches=none&cabin=2&lamps=0');
    expect([s.hatches, s.cabin, s.lamps]).toEqual(['none', 2, 0]);
    expect(parseSettings('?hatches=roof').hatches).toBe('both');
    for (const key of ['hatches', 'cabin', 'lamps']) {
      const item = LIVE_ITEMS.find((i) => i.key === key)!;
      // Each choice parses back to itself, and the default is one of them.
      for (const [value] of item.options) expect(item.current(parseSettings(`?${key}=${value}`)), `${key}=${value}`).toBe(value);
      expect(item.options.map(([v]) => v)).toContain(item.current(DEFAULT_SETTINGS));
    }
  });
});
