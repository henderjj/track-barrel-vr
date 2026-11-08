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
  ENGINE_CYCLE_FIRINGS,
  ENGINE_IDLE_HZ,
  ENGINE_TOP_HZ,
  GRIND_TEETH_HZ,
  MAX_CLATTER_HZ,
  MIX,
  renderEngineCycle,
  renderNoiseLoop,
  renderSound,
  LOOPED,
  SOUND_IDS,
  SOUND_SECONDS,
  SoundCues,
  SPEECH_LEVEL,
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
  it('beats low like a heavy diesel, over a narrow range, growing louder and harder with the revs', () => {
    const idle = engineVoice(IDLE_RPM, createEngineVoice());
    const top = engineVoice(MAX_RPM, createEngineVoice());
    expect(idle.freq).toBe(ENGINE_IDLE_HZ);
    expect(top.freq).toBe(ENGINE_TOP_HZ);
    expect(top.freq).toBeLessThan(70);
    // Far less spread than the RPM's 3.25 times.
    expect(top.freq / idle.freq).toBeLessThan(2.2);
    expect(idle.rate).toBe(1);
    expect(top.rate).toBeCloseTo(ENGINE_TOP_HZ / ENGINE_IDLE_HZ);
    expect(top.cutoff).toBeGreaterThan(idle.cutoff);
    expect(top.cutoff).toBeLessThan(1000);
    expect(top.gain).toBeGreaterThan(idle.gain);
    expect(top.gain).toBeLessThanOrEqual(1);
  });

  it('slows and fades to silence as a stopped engine runs down (F1.17)', () => {
    const idle = engineVoice(IDLE_RPM, createEngineVoice());
    const dying = engineVoice(IDLE_RPM / 2, createEngineVoice());
    const stopped = engineVoice(0, createEngineVoice());
    expect(dying.freq).toBeLessThan(idle.freq);
    expect(dying.gain).toBeLessThan(idle.gain / 2);
    expect(stopped.gain).toBe(0);
    expect(stopped.rate).toBeGreaterThan(0);
  });

  it('renders a lumpy firing cycle that loops without a click', () => {
    const c = renderEngineCycle(RATE);
    expect(c.length).toBe(Math.round((ENGINE_CYCLE_FIRINGS / ENGINE_IDLE_HZ) * RATE));
    expect(peak(c)).toBeCloseTo(1, 5);
    expect(c).toEqual(renderEngineCycle(RATE));
    expect(Math.abs(c.reduce((a, v) => a + v, 0) / c.length)).toBeLessThan(1e-6);
    // The join is no bigger a step than the cycle takes anywhere else.
    let biggest = 0;
    for (let i = 1; i < c.length; i++) biggest = Math.max(biggest, Math.abs(c[i] - c[i - 1]));
    expect(Math.abs(c[0] - c[c.length - 1])).toBeLessThanOrEqual(biggest);
    // Each firing is a pulse: loudest just after it, quiet before the next.
    const period = Math.round(RATE / ENGINE_IDLE_HZ);
    const strength: number[] = [];
    for (let k = 0; k < ENGINE_CYCLE_FIRINGS; k++) {
      const start = k * period;
      const third = Math.round(period / 3);
      strength.push(rmsOf(c, start, start + third));
      expect(rmsOf(c, start, start + third)).toBeGreaterThan(rmsOf(c, start + 2 * third, start + period) * 1.5);
    }
    // Not every firing the same: the beat is lumpy, not a pure tone.
    expect(Math.max(...strength) / Math.min(...strength)).toBeGreaterThan(1.1);
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
    for (let t = 0; t < 2; t += 1 / 90) d.step(SPEECH_LEVEL * 0.5, SPEECH_LEVEL * 0.3, 1 / 90);
    expect(d.speaking).toBe(false);
    expect(d.gain).toBe(1);
  });

  // John's play test (2026-11-07): the menu said ducked but the engine never dipped. Each
  // microphone hears its own tank from the headset's speakers (ducked with it), and the
  // crewmate's voice carries their tank too; that steady sound held the duck in all the time.
  const DT = 1 / 72;
  const BLEED = SPEECH_LEVEL * 3;
  /** A sentence: 0.25 s syllables 0.1 s apart. */
  const talking = (t: number) => (t % 0.35 < 0.25 ? 0.05 : 0);
  /** Run `seconds` of the tank heard through both microphones (ducked as the tank is) plus `voice(t)` on the crewmate's; the frames ducked and the duck after. */
  const run = (d: Ducker, seconds: number, voice: (t: number) => number = () => 0) => {
    let ducked = 0;
    for (let t = 0; t < seconds; t += DT) {
      const bleed = BLEED * d.gain;
      d.step(bleed, Math.hypot(bleed, voice(t)), DT);
      if (d.speaking) ducked++;
    }
    return ducked * DT;
  };

  it('lets go of the tank heard through the microphones within a few seconds, and stays off without pumping', () => {
    const d = new Ducker();
    expect(run(d, 6)).toBeLessThan(5);
    expect(d.speaking).toBe(false);
    expect(run(d, 30)).toBe(0);
    expect(d.gain).toBeCloseTo(1, 3);
  });

  it('still ducks for speech over the tank, lets go after it, and does not duck again on its own', () => {
    const d = new Ducker();
    run(d, 10);
    const during = run(d, 3, talking);
    expect(during).toBeGreaterThan(2.9);
    expect(d.db).toBeLessThan(DUCK_DB + 0.5);
    run(d, 3);
    expect(d.speaking).toBe(false);
    expect(d.gain).toBeGreaterThan(0.97);
    expect(run(d, 20)).toBe(0);
  });

  it('keeps hearing a crew that talks a lot', () => {
    const d = new Ducker();
    run(d, 10);
    // A minute of chatter: two sentences and a pause, over and over.
    let ducked = 0;
    for (let k = 0; k < 15; k++) ducked += run(d, 3, talking) + run(d, 1);
    expect(ducked).toBeGreaterThan(15 * 3);
    // The last sentence ducks as surely as the first.
    expect(run(d, 3, talking)).toBeGreaterThan(2.9);
  });
});

describe('the cues', () => {
  const state = (over: Partial<CueState> = {}): CueState => ({
    gear: 1, grinding: false, bumps: 0, lever: 0, rammed: false, running: true, stalls: 0, coughs: 0, ...over,
  });
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

  it('fire up as the engine catches, and are heard on each cough and stall (F1.17)', () => {
    const c = new SoundCues();
    heard(c, state({ running: false }));
    expect(heard(c, state({ running: false }))).toEqual([]);
    expect(heard(c, state({ running: true }))).toEqual(['catch']);
    expect(heard(c, state({ coughs: 1 }))).toEqual(['cough']);
    expect(heard(c, state({ coughs: 2, stalls: 1, running: false }))).toEqual(['stall']);
    // Switched off is no stall: the engine just runs down.
    heard(c, state({ coughs: 2, stalls: 1, running: true }));
    expect(heard(c, state({ coughs: 2, stalls: 1, running: false }))).toEqual([]);
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
      if (LOOPED.includes(id)) continue;
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
