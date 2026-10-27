import { describe, expect, it } from 'vitest';
import { MAX_SPEED, MAX_TRAVERSE } from '../src/sim/comfort.js';
import { LEVER_CLOSED } from '../src/sim/loading.js';
import {
  AUTO_OPEN_WINDOW,
  createCues,
  createEngineVoice,
  createTrackVoice,
  type CueState,
  DUCK_DB,
  Ducker,
  dbToGain,
  engineVoice,
  GRIND_TEETH_HZ,
  MAX_CLATTER_HZ,
  MIX,
  renderNoiseLoop,
  renderSound,
  SOUND_IDS,
  SOUND_SECONDS,
  SoundCues,
  SPEAKING_LEVEL,
  trackVoice,
  whineVoice,
} from '../src/sim/tank-audio.js';
import { IDLE_RPM, MAX_RPM } from '../src/sim/tank-drive.js';

const RATE = 48000;

const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rmsOf = (a: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / (to - from));
};

describe('the engine', () => {
  it('sings at the V12 firing rate, opening up and growing louder with the revs', () => {
    const idle = engineVoice(IDLE_RPM, createEngineVoice());
    const top = engineVoice(MAX_RPM, createEngineVoice());
    expect(idle.freq).toBeCloseTo(80);
    expect(top.freq).toBeCloseTo(260);
    expect(top.cutoff).toBeGreaterThan(idle.cutoff * 3);
    expect(top.gain).toBeGreaterThan(idle.gain);
    expect(top.gain).toBeLessThanOrEqual(1);
  });

  it('lopes at idle and runs smooth flat out', () => {
    expect(engineVoice(IDLE_RPM, createEngineVoice()).lopeDepth).toBeGreaterThan(0.2);
    expect(engineVoice(MAX_RPM, createEngineVoice()).lopeDepth).toBe(0);
  });
});

describe('the tracks', () => {
  it('are silent at rest and rumble and clatter faster with speed', () => {
    const rest = trackVoice(0, 0, createTrackVoice());
    expect(rest.rumble).toBe(0);
    expect(rest.clatter).toBe(0);
    const slow = trackVoice(1, 1, createTrackVoice());
    const fast = trackVoice(MAX_SPEED, MAX_SPEED, createTrackVoice());
    expect(slow.clatterHz).toBeCloseTo(1 / 0.15);
    expect(fast.rumble).toBeCloseTo(1);
    expect(fast.rumbleCutoff).toBeGreaterThan(slow.rumbleCutoff);
    expect(fast.clatterHz).toBe(MAX_CLATTER_HZ);
  });

  it('rumble in a pivot turn, the tracks running opposite ways', () => {
    expect(trackVoice(-1, 1, createTrackVoice()).rumble).toBeCloseTo(trackVoice(1, 1, createTrackVoice()).rumble);
  });
});

describe('the traverse whine', () => {
  it('is silent with the turret still and rises with its rate either way', () => {
    expect(whineVoice(0, { freq: 0, gain: 0 }).gain).toBe(0);
    const left = whineVoice(MAX_TRAVERSE, { freq: 0, gain: 0 });
    const right = whineVoice(-MAX_TRAVERSE / 2, { freq: 0, gain: 0 });
    expect(left.gain).toBeCloseTo(1);
    expect(right.freq).toBeLessThan(left.freq);
    expect(right.gain).toBeGreaterThan(0);
  });
});

describe('the intercom duck', () => {
  it('drops the tank 6 dB within a tenth of a second of either player speaking', () => {
    for (const [mic, crew] of [[0.05, 0], [0, 0.05]]) {
      const d = new Ducker();
      for (let t = 0; t < 0.15; t += 1 / 90) d.step(mic, crew, 1 / 90);
      expect(d.speaking).toBe(true);
      expect(d.db).toBeLessThan(DUCK_DB + 0.5);
    }
  });

  it('holds between words and lets go slowly after', () => {
    const d = new Ducker();
    for (let t = 0; t < 0.5; t += 1 / 90) d.step(0.05, 0, 1 / 90);
    for (let t = 0; t < 0.2; t += 1 / 90) d.step(0, 0, 1 / 90);
    expect(d.speaking).toBe(true);
    expect(d.gain).toBeCloseTo(dbToGain(DUCK_DB), 2);
    for (let t = 0; t < 0.4; t += 1 / 90) d.step(0, 0, 1 / 90);
    expect(d.speaking).toBe(false);
    expect(d.gain).toBeLessThan(0.95);
    for (let t = 0; t < 3; t += 1 / 90) d.step(0, 0, 1 / 90);
    expect(d.gain).toBeCloseTo(1, 3);
  });

  it('ignores a quiet room', () => {
    const d = new Ducker();
    for (let t = 0; t < 2; t += 1 / 90) d.step(SPEAKING_LEVEL * 0.5, SPEAKING_LEVEL * 0.3, 1 / 90);
    expect(d.speaking).toBe(false);
    expect(d.gain).toBe(1);
  });
});

describe('the cues', () => {
  const state = (over: Partial<CueState> = {}): CueState => ({ gear: 1, grinding: false, bumps: 0, lever: 0, rammed: false, ...over });
  const heard = (cues: SoundCues, s: CueState, sinceShot = Infinity) => {
    const out = cues.step(s, sinceShot, createCues());
    return Object.entries(out).filter(([, on]) => on).map(([id]) => id);
  };

  it('say nothing on the first frame, whatever the tank is doing', () => {
    expect(heard(new SoundCues(), state({ gear: 2, bumps: 4, lever: LEVER_CLOSED, rammed: true }))).toEqual([]);
  });

  it('clunk as a gear goes in, not as the lever leaves one or while the gears grind', () => {
    const c = new SoundCues();
    heard(c, state({ gear: 1 }));
    expect(heard(c, state({ gear: 0 }))).toEqual([]);
    expect(heard(c, state({ gear: 0, grinding: true }))).toEqual([]);
    expect(heard(c, state({ gear: 2 }))).toEqual(['clunk']);
    expect(heard(c, state({ gear: 2 }))).toEqual([]);
  });

  it('clunk once the grinding gear finally goes in', () => {
    const c = new SoundCues();
    heard(c, state({ gear: 1 }));
    expect(heard(c, state({ gear: 0, grinding: true }))).toEqual([]);
    expect(heard(c, state({ gear: 2 }))).toEqual(['clunk']);
  });

  it('thud on each bump', () => {
    const c = new SoundCues();
    heard(c, state());
    expect(heard(c, state({ bumps: 1 }))).toEqual(['bump']);
    expect(heard(c, state({ bumps: 1 }))).toEqual([]);
  });

  it('thunk as a shell goes home, slam as the breech closes and unlatch as a hand opens it', () => {
    const c = new SoundCues();
    heard(c, state());
    expect(heard(c, state({ rammed: true }))).toEqual(['ram']);
    expect(heard(c, state({ rammed: true, lever: LEVER_CLOSED * 0.8 }))).toEqual([]);
    expect(heard(c, state({ rammed: true, lever: LEVER_CLOSED }))).toEqual(['breech']);
    expect(heard(c, state({ rammed: true, lever: 0.5 }))).toEqual(['latch']);
  });

  it('leave the breech opening after a shot to the shot', () => {
    const c = new SoundCues();
    heard(c, state({ lever: LEVER_CLOSED, rammed: true }));
    expect(heard(c, state({ lever: 0 }), 0.3)).toEqual([]);
    heard(c, state({ lever: LEVER_CLOSED }));
    expect(heard(c, state({ lever: 0 }), AUTO_OPEN_WINDOW + 0.1)).toEqual(['latch']);
  });
});

describe('the short sounds', () => {
  it('are rendered at their length and peak at their mix level', () => {
    for (const id of SOUND_IDS) {
      const s = renderSound(id, RATE);
      expect(s.length).toBe(Math.round(SOUND_SECONDS[id] * RATE));
      expect(peak(s)).toBeCloseTo(MIX[id], 5);
      expect(s.every(Number.isFinite)).toBe(true);
    }
  });

  it('are the same every time (both pages hear the same tank)', () => {
    for (const id of SOUND_IDS) expect(renderSound(id, RATE)).toEqual(renderSound(id, RATE));
  });

  it('die away to silence, the gun last and loudest', () => {
    for (const id of SOUND_IDS) {
      if (id === 'grind') continue;
      const s = renderSound(id, RATE);
      const n = s.length;
      expect(rmsOf(s, n - 480, n)).toBeLessThan(rmsOf(s, 0, Math.min(n, 4800)) * 0.05);
      expect(s[n - 1]).toBeCloseTo(0, 6);
    }
    expect(SOUND_SECONDS.shot).toBe(Math.max(...Object.values(SOUND_SECONDS)));
    expect(MIX.shot).toBe(Math.max(...SOUND_IDS.map((id) => MIX[id])));
  });

  it('loop the grind without a click: a whole number of tooth beats, silent at the join', () => {
    expect((SOUND_SECONDS.grind * GRIND_TEETH_HZ) % 1).toBe(0);
    const g = renderSound('grind', RATE);
    expect(Math.abs(g[0])).toBeLessThan(1e-6);
    expect(Math.abs(g[g.length - 1])).toBeLessThan(0.01 * MIX.grind);
  });

  it('give the casing several pings as it bounces', () => {
    const c = renderSound('casing', RATE);
    const at = (s: number) => rmsOf(c, Math.round(s * RATE), Math.round(s * RATE) + 240);
    // Each bounce is louder than the moment just before it.
    for (const bounce of [0.14, 0.27]) expect(at(bounce + 0.002)).toBeGreaterThan(at(bounce - 0.01));
  });
});

describe('the noise loops', () => {
  it('peak at 1, centre on zero and meet themselves at the join', () => {
    for (const kind of ['white', 'brown'] as const) {
      const n = renderNoiseLoop(kind, RATE, 1);
      expect(peak(n)).toBeCloseTo(1, 5);
      expect(Math.abs(n.reduce((a, v) => a + v, 0) / n.length)).toBeLessThan(0.05);
    }
    const brown = renderNoiseLoop('brown', RATE, 2);
    expect(Math.abs(brown[brown.length - 1] - brown[0])).toBeLessThan(1e-4);
  });
});
