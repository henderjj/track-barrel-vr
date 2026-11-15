import { describe, expect, it } from 'vitest';
import { STICK_FLICK, STICK_REARM, StickFlick, stickY } from '../src/sim/stick.js';

describe('stickY', () => {
  it('takes the profile reading under the xr-standard mapping (Quest, Rift on Chrome via OpenXR)', () => {
    expect(stickY([0, 0, 0.1, -0.9], 'xr-standard', -0.9)).toBe(-0.9);
    // A real touchpad in axes 0 and 1 is not the stick.
    expect(stickY([0, 0.8, 0, 0], 'xr-standard', 0)).toBe(0);
  });

  it('finds the stick in axes 0 and 1 when the runtime reports only two axes', () => {
    // IWSDK's reading looks at axes 2 and 3, which are missing: it reads 0.
    expect(stickY([0.05, -0.95], '', 0)).toBe(-0.95);
    expect(stickY([0, 0.8], 'xr-standard', 0)).toBe(0.8);
  });

  it('takes the further pushed of axes 1 and 3 with no standard mapping', () => {
    expect(stickY([0, -0.9, 0, 0], '', 0)).toBe(-0.9);
    expect(stickY([0, 0, 0, 0.85], '', 0.85)).toBe(0.85);
    expect(stickY([0, 0.1, 0, -0.9], '', -0.9)).toBe(-0.9);
  });

  it('falls back to the profile reading with no axes', () => {
    expect(stickY(undefined, undefined, -0.4)).toBe(-0.4);
    expect(stickY([], 'xr-standard', 0.3)).toBe(0.3);
  });
});

describe('StickFlick', () => {
  it('steps up for forwards and down for back, once per push', () => {
    const f = new StickFlick();
    expect(f.step(0)).toBe(0);
    expect(f.step(-(STICK_FLICK - 0.05))).toBe(0);
    expect(f.step(-1)).toBe(1);
    // Held forwards, or eased back but not to the middle: no more steps.
    expect(f.step(-1)).toBe(0);
    expect(f.step(-(STICK_REARM + 0.05))).toBe(0);
    expect(f.step(-1)).toBe(0);
    // Back to the middle re-arms it.
    expect(f.step(0)).toBe(0);
    expect(f.step(0.9)).toBe(-1);
    expect(f.step(0.9)).toBe(0);
  });
});
