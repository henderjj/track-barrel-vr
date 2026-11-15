import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIVE_ITEMS, VOLUME_ITEMS } from '../src/live-settings.js';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.js';
import { SOUND_GROUP, SOUND_IDS } from '../src/sim/tank-audio.js';
import { commanderGain, commanderHeard, stepVolume, tankHeard, volumeAt, volumeGain, volumeText } from '../src/sim/volume.js';

describe('the volume sliders (docs/volume.md)', () => {
  it('are Master, Engine, Effects and Commander, all full by default', () => {
    expect(VOLUME_ITEMS.map((i) => [i.key, i.label])).toEqual([
      ['sound', 'Master'],
      ['enginevol', 'Engine'],
      ['effectsvol', 'Effects'],
      ['commander', 'Commander'],
    ]);
    for (const item of VOLUME_ITEMS) expect(item.current(DEFAULT_SETTINGS)).toBe('1');
  });

  it("replace the old Tank sounds and Commander rows, so they aren't also buttons", () => {
    const live = new Set<string>(LIVE_ITEMS.map((i) => i.key));
    expect(VOLUME_ITEMS.filter((i) => live.has(i.key))).toEqual([]);
  });

  it('read from the URL and the saved settings, clamped to 0 to 1; an old Tank sounds choice is the Master level', () => {
    const s = parseSettings('?sound=0.5&enginevol=0.3&effectsvol=2&commander=-1');
    expect([s.sound, s.enginevol, s.effectsvol, s.commander]).toEqual([0.5, 0.3, 1, 0]);
  });

  it('each have a row in the Sound and view tab: a track with its fill, - and +, and the level', () => {
    const menu = readFileSync(new URL('../public/ui/menu.uikitml', import.meta.url), 'utf8');
    const page = menu.slice(menu.indexOf('id="page-view"'), menu.indexOf('id="page-', menu.indexOf('id="page-view"') + 1));
    for (const { key } of VOLUME_ITEMS) {
      for (const part of ['track', 'fill', 'down', 'up', 'value']) expect(page, `vol-${key}-${part}`).toContain(`id="vol-${key}-${part}"`);
    }
  });

  it('turn a level into a gain as the ear hears it: the square, so half way is -12 dB', () => {
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0)).toBe(0);
    expect(20 * Math.log10(volumeGain(0.5))).toBeCloseTo(-12.04, 2);
    expect(20 * Math.log10(volumeGain(0.1))).toBeCloseTo(-40, 6);
    expect(volumeGain(2)).toBe(1);
    expect(volumeGain(-1)).toBe(0);
  });

  it('snap a touch on the track to 5% steps, inside 0 to 100%', () => {
    expect(volumeAt(0)).toBe(0);
    expect(volumeAt(0.012)).toBe(0);
    expect(volumeAt(0.49)).toBe(0.5);
    expect(volumeAt(0.731)).toBe(0.75);
    expect(volumeAt(0.99)).toBe(1);
    expect(volumeAt(-0.2)).toBe(0);
    expect(volumeAt(1.3)).toBe(1);
  });

  it('step - and + to the next whole tenth', () => {
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(1, -1)).toBe(0.9);
    expect(stepVolume(0.85, -1)).toBe(0.8);
    expect(stepVolume(0.85, 1)).toBe(0.9);
    expect(stepVolume(0.1, -1)).toBe(0);
    expect(stepVolume(0, -1)).toBe(0);
    expect(stepVolume(0.7, 1)).toBe(0.8);
    // Ten presses of - from full is off, ten of + back.
    let level = 1;
    for (let i = 0; i < 10; i++) level = stepVolume(level, -1);
    expect(level).toBe(0);
    for (let i = 0; i < 10; i++) level = stepVolume(level, 1);
    expect(level).toBe(1);
  });

  it('show the level as a percentage, or Off', () => {
    expect(volumeText(1)).toBe('100%');
    expect(volumeText(0.35)).toBe('35%');
    expect(volumeText(0)).toBe('Off');
  });

  it('let Master silence everything, and the tank go quiet only when both its sliders are down', () => {
    const v = { sound: 1, enginevol: 1, effectsvol: 1, commander: 1 };
    expect(tankHeard(v) && commanderHeard(v)).toBe(true);
    expect(tankHeard({ ...v, sound: 0 }) || commanderHeard({ ...v, sound: 0 })).toBe(false);
    expect(tankHeard({ ...v, enginevol: 0 })).toBe(true);
    expect(tankHeard({ ...v, enginevol: 0, effectsvol: 0 })).toBe(false);
    expect(commanderHeard({ ...v, enginevol: 0, effectsvol: 0 })).toBe(true);
    expect(commanderHeard({ ...v, commander: 0 })).toBe(false);
    expect(commanderGain({ ...v, sound: 0.5, commander: 0.5 })).toBeCloseTo(1 / 16, 9);
  });

  it("put the engine's own short sounds under Engine and the rest under Effects", () => {
    const engine = SOUND_IDS.filter((id) => SOUND_GROUP[id] === 'engine');
    expect(engine).toEqual(['crank', 'catch', 'cough', 'stall']);
  });
});
