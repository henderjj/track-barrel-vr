import { describe, expect, it } from 'vitest';
import { MAX_SPEED, MAX_TRAVERSE } from '../src/sim/comfort.js';
import { LEVER_CLOSED } from '../src/sim/loading.js';
import {
  CABIN_SECONDS,
  CASING_BOUNCES,
  ENGINE_LOOP_CYCLES,
  LINK_GATE,
  renderCabinImpulse,
  renderEngineLoop,
  renderGate,
  renderNoiseLoop,
  renderSound,
  renderSquealGate,
  SHOT_ECHOES,
  SQUEAL_SECONDS,
  TICK_GATE,
} from '../src/sim/sound-render.js';
import {
  AUTO_OPEN_WINDOW,
  bankHz,
  createCues,
  createDriveVoice,
  createEngineVoice,
  createTourState,
  createTrackVoice,
  createTraverseVoice,
  CRANK_BEAT_HZ,
  type CueState,
  driveVoice,
  DUCK_DB,
  Ducker,
  dbToGain,
  engineVoice,
  ENGINE_IDLE_HZ,
  ENGINE_TOP_HZ,
  FINAL_DRIVE_HZ_PER_MS,
  GEARBOX_TEETH,
  GRIND_TEETH_HZ,
  handGearVoice,
  HAND_TICKS_PER_TURN,
  IDLE_REV_HZ,
  LINK_PITCH,
  LOOPED,
  MIX,
  SOUND_FROM,
  SOUND_IDS,
  SOUND_PLACES,
  SOUND_SECONDS,
  SoundCues,
  soundTour,
  SPEAKING_LEVEL,
  TOUR_SECONDS,
  trackVoice,
  traverseVoice,
} from '../src/sim/tank-audio.js';
import { IDLE_RPM, MAX_RPM } from '../src/sim/tank-drive.js';

const RATE = 48000;

const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rmsOf = (a: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / (to - from));
};
/** How strongly `a` holds `hz`: the size of that one frequency in it. */
const tone = (a: Float32Array, hz: number) => {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    re += a[i] * Math.cos((2 * Math.PI * hz * i) / RATE);
    im += a[i] * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return (2 * Math.hypot(re, im)) / a.length;
};
/** The biggest step between neighbouring samples, and the step from the last sample round to the first. */
const steps = (a: Float32Array) => {
  let biggest = 0;
  for (let i = 1; i < a.length; i++) biggest = Math.max(biggest, Math.abs(a[i] - a[i - 1]));
  return { biggest, join: Math.abs(a[0] - a[a.length - 1]) };
};

describe('the engine', () => {
  it("beats as the multibank's banks fire: three times a turn, 40 Hz at idle and 130 Hz flat out", () => {
    expect(ENGINE_IDLE_HZ).toBe(40);
    expect(ENGINE_TOP_HZ).toBe(130);
    const idle = engineVoice(IDLE_RPM, 0, createEngineVoice());
    const top = engineVoice(MAX_RPM, 1, createEngineVoice());
    expect(idle.freq).toBe(ENGINE_IDLE_HZ);
    expect(top.freq).toBe(ENGINE_TOP_HZ);
    // The loop plays as fast as the engine turns.
    expect(idle.rate).toBe(1);
    expect(top.rate).toBeCloseTo(MAX_RPM / IDLE_RPM);
    // Muffled always, opening up with the revs: the filter stays far below what would make a buzz.
    expect(top.cutoff).toBeGreaterThan(idle.cutoff);
    expect(top.cutoff).toBeLessThan(1000);
    expect(top.gain).toBeGreaterThan(idle.gain);
    expect(top.gain).toBeLessThanOrEqual(1);
    expect(top.roar).toBeGreaterThan(idle.roar * 4);
    expect(top.roar).toBeLessThanOrEqual(1);
  });

  it('is louder, harder-edged and roars more pulling than spinning at the same revs with the throttle shut', () => {
    const coasting = engineVoice(2000, 0, createEngineVoice());
    const pulling = engineVoice(2000, 1, createEngineVoice());
    expect(pulling.freq).toBe(coasting.freq);
    expect(pulling.gain).toBeGreaterThan(coasting.gain * 1.3);
    expect(pulling.cutoff).toBeGreaterThan(coasting.cutoff + 100);
    expect(pulling.roar).toBeGreaterThan(coasting.roar * 1.5);
  });

  it('slows and fades to silence as a stopped engine runs down (F1.17)', () => {
    const idle = engineVoice(IDLE_RPM, 0, createEngineVoice());
    const dying = engineVoice(IDLE_RPM / 2, 0, createEngineVoice());
    const stopped = engineVoice(0, 0, createEngineVoice());
    expect(dying.freq).toBeLessThan(idle.freq);
    expect(dying.rate).toBeLessThan(idle.rate);
    expect(dying.gain).toBeLessThan(idle.gain / 2);
    expect(stopped.gain).toBe(0);
    expect(stopped.roar).toBe(0);
    expect(stopped.rate).toBeGreaterThan(0);
  });

  it('renders thirty cylinders burbling: a loop of whole cycles that joins without a click', () => {
    const c = renderEngineLoop(RATE);
    expect(c.length).toBe(Math.round(((ENGINE_LOOP_CYCLES * 2) / IDLE_REV_HZ) * RATE));
    expect(peak(c)).toBeCloseTo(1, 5);
    expect(c).toEqual(renderEngineLoop(RATE));
    expect(Math.abs(c.reduce((a, v) => a + v, 0) / c.length)).toBeLessThan(1e-6);
    const { biggest, join } = steps(c);
    expect(join).toBeLessThanOrEqual(biggest);
  });

  it('is five sixes together, not one hum: the banks\' beat and its harmonics, and a roughness between them', () => {
    const c = renderEngineLoop(RATE);
    // The banks' beat (40 Hz) and its harmonics all stand out...
    const bank = [1, 2, 3, 4, 5].map((k) => tone(c, k * ENGINE_IDLE_HZ));
    // ...over what lies between them: the half-orders that uneven cylinders make.
    const between = [1.5, 2.5, 3.5, 4.5].map((k) => tone(c, k * ENGINE_IDLE_HZ));
    expect(Math.min(...bank)).toBeGreaterThan(Math.max(...between) * 1.5);
    // No one of them drowns the rest (thirty perfectly even cylinders would leave only the fifth, 200 Hz).
    expect(Math.max(...bank)).toBeLessThan(Math.min(...bank) * 12);
    // Uneven cylinders: the cycle's own beat (every other turn, 6.7 Hz) is in there too.
    const half = [5, 7, 11, 13].map((k) => tone(c, (k * IDLE_REV_HZ) / 2));
    expect(Math.max(...half)).toBeGreaterThan(Math.max(...bank) * 0.02);
  });
});

describe('the gears', () => {
  it("whine with what turns them: the gearbox with the engine, the final drives with the tracks", () => {
    const slow = driveVoice(IDLE_RPM, 2, true, 0.5, createDriveVoice());
    const fast = driveVoice(MAX_RPM, MAX_SPEED, true, 0.5, createDriveVoice());
    expect(slow.gearboxHz).toBeCloseTo((IDLE_RPM / 60) * GEARBOX_TEETH);
    expect(fast.gearboxHz).toBeGreaterThan(slow.gearboxHz * 3);
    expect(fast.finalHz).toBeCloseTo(MAX_SPEED * FINAL_DRIVE_HZ_PER_MS);
    // A low growl, never a scream.
    expect(fast.finalHz).toBeLessThan(300);
    expect(fast.final).toBeGreaterThan(slow.final);
    expect(fast.gearbox).toBeLessThanOrEqual(1);
    expect(fast.final).toBeLessThanOrEqual(1);
  });

  it('are quiet out of gear and silent at a halt or with the engine stopped', () => {
    const neutral = driveVoice(2000, 0, false, 0.8, createDriveVoice());
    const pulling = driveVoice(2000, 4, true, 0.8, createDriveVoice());
    expect(neutral.gearbox).toBeLessThan(pulling.gearbox / 3);
    expect(neutral.final).toBe(0);
    const stopped = driveVoice(0, 0, false, 0, createDriveVoice());
    expect(stopped.gearbox).toBe(0);
    expect(stopped.final).toBe(0);
    // Backwards whines the same.
    expect(driveVoice(1500, -3, true, 0.5, createDriveVoice()).final).toBeCloseTo(driveVoice(1500, 3, true, 0.5, createDriveVoice()).final);
  });
});

describe('the tracks', () => {
  it('are silent at rest and rumble and clatter faster with speed, a link every 15 cm', () => {
    const rest = trackVoice(0, 0, createTrackVoice());
    expect(rest.rumble).toBe(0);
    expect(rest.clatter).toBe(0);
    expect(rest.squeal).toBe(0);
    const slow = trackVoice(1, 1, createTrackVoice());
    const fast = trackVoice(MAX_SPEED, MAX_SPEED, createTrackVoice());
    expect(slow.clatterHz).toBeCloseTo(1 / LINK_PITCH);
    expect(slow.left.hz).toBeCloseTo(1 / LINK_PITCH);
    expect(fast.rumble).toBeCloseTo(1);
    expect(fast.rumbleCutoff).toBeGreaterThan(slow.rumbleCutoff);
    expect(fast.clatterHz).toBeCloseTo(MAX_SPEED / LINK_PITCH);
    expect(fast.left.gain).toBeCloseTo(1);
    expect(fast.left.gain).toBeGreaterThan(slow.left.gain);
  });

  it('rumble in a pivot turn, the tracks running opposite ways', () => {
    expect(trackVoice(-1, 1, createTrackVoice()).rumble).toBeCloseTo(trackVoice(1, 1, createTrackVoice()).rumble);
  });

  it('clatter each at its own rate in a turn, and squeal most while steering', () => {
    const straight = trackVoice(4, 4, createTrackVoice());
    const turning = trackVoice(1.5, 4.5, createTrackVoice());
    expect(turning.left.hz).toBeCloseTo(1.5 / LINK_PITCH);
    expect(turning.right.hz).toBeCloseTo(4.5 / LINK_PITCH);
    expect(turning.right.gain).toBeGreaterThan(turning.left.gain);
    expect(turning.squeal).toBeGreaterThan(straight.squeal * 2);
    expect(turning.squeal).toBeLessThanOrEqual(1);
    expect(straight.squeal).toBeGreaterThan(0);
    // The swells come faster with speed, within limits.
    expect(trackVoice(MAX_SPEED, MAX_SPEED, createTrackVoice()).squealRate).toBeGreaterThan(straight.squealRate);
    expect(trackVoice(0.01, 0.01, createTrackVoice()).squealRate).toBeGreaterThan(0);
  });
});

describe('the traverse', () => {
  it('is silent with the turret still and whines, growls and rumbles more with its rate either way', () => {
    const still = traverseVoice(0, createTraverseVoice());
    expect(still.gain).toBe(0);
    expect(still.gear).toBe(0);
    expect(still.rumble).toBe(0);
    const left = traverseVoice(MAX_TRAVERSE, createTraverseVoice());
    const right = traverseVoice(-MAX_TRAVERSE / 2, createTraverseVoice());
    expect(left.gain).toBeCloseTo(1);
    expect(left.gear).toBeCloseTo(1);
    expect(left.rumble).toBeCloseTo(1);
    expect(right.freq).toBeLessThan(left.freq);
    expect(right.meshHz).toBeLessThan(left.meshHz);
    expect(right.gain).toBeGreaterThan(0);
    // An electric motor's whine, not a whistle.
    expect(left.freq).toBeLessThan(600);
  });

  it("ticks with the gunner's handwheels, a tick a tooth", () => {
    const still = handGearVoice(0, 0, { hz: 0, gain: 0 });
    expect(still.gain).toBe(0);
    const crank = handGearVoice(1, 0, { hz: 0, gain: 0 });
    expect(crank.hz).toBeCloseTo(HAND_TICKS_PER_TURN);
    expect(crank.gain).toBeGreaterThan(0);
    const both = handGearVoice(-1, 0.5, { hz: 0, gain: 0 });
    expect(both.hz).toBeCloseTo(1.5 * HAND_TICKS_PER_TURN);
    expect(both.gain).toBeGreaterThanOrEqual(crank.gain);
    expect(both.gain).toBeLessThanOrEqual(1);
  });
});

describe('where the sounds come from', () => {
  it('puts the engine behind the crew, the gearbox ahead and a track each side', () => {
    expect(SOUND_PLACES.engine[2]).toBeGreaterThan(2);
    expect(SOUND_PLACES.gearbox[2]).toBeLessThan(-1.5);
    expect(SOUND_PLACES.leftTrack[0]).toBeLessThan(-1);
    expect(SOUND_PLACES.rightTrack[0]).toBeGreaterThan(1);
    expect(SOUND_FROM.clunk).toBe('gearbox');
    expect(SOUND_FROM.breech).toBe('breech');
    expect(SOUND_FROM.casing).toBe('bin');
    expect(SOUND_FROM.catch).toBe('engine');
    // The blast and a bump come through the whole hull.
    expect(SOUND_FROM.shot).toBeNull();
    expect(SOUND_FROM.bump).toBeNull();
    for (const id of SOUND_IDS) expect(SOUND_FROM[id] === null || SOUND_FROM[id] in SOUND_PLACES).toBe(true);
  });
});

describe('the sound tour', () => {
  it('runs the engine up, drives off through the gears, turns, halts, traverses and turns the handwheels', () => {
    const at = (t: number) => ({ ...soundTour(t, createTourState()) });
    expect(at(1).rpm).toBe(IDLE_RPM);
    expect(at(5.8).rpm).toBeGreaterThan(2200);
    expect(at(5.8).left).toBe(0);
    expect(at(8.9).rpm).toBeLessThan(IDLE_RPM + 50);
    // Pulling away: faster and faster, the revs falling back at each change.
    expect(at(12).left).toBeGreaterThan(at(10).left);
    expect(at(17).left).toBeGreaterThan(MAX_SPEED * 0.8);
    expect(at(10.4).rpm).toBeGreaterThan(at(10.6).rpm);
    expect(at(18.2).left).toBeLessThan(at(18.2).right * 0.6);
    expect(Math.abs(at(21.99).left)).toBeLessThan(0.05);
    expect(at(23.8).traverse).toBeCloseTo(MAX_TRAVERSE);
    expect(at(26).traverse).toBeLessThan(0);
    expect(at(27.8).crank).toBeGreaterThan(1);
    expect(at(29.2).wheel).toBeGreaterThan(1);
    const end = at(TOUR_SECONDS);
    expect(end.left + end.traverse + end.crank + end.wheel).toBeCloseTo(0, 5);
    for (let t = 0; t <= TOUR_SECONDS; t += 0.05) {
      const s = at(t);
      expect(s.rpm).toBeGreaterThanOrEqual(IDLE_RPM - 1);
      expect(s.rpm).toBeLessThanOrEqual(MAX_RPM);
      expect(Math.abs(s.left)).toBeLessThanOrEqual(MAX_SPEED);
      expect(Math.abs(s.right)).toBeLessThanOrEqual(MAX_SPEED);
      expect(s.load).toBeGreaterThanOrEqual(0);
      expect(s.load).toBeLessThanOrEqual(1);
    }
  });
});

describe('the intercom duck', () => {
  it('drops the tank 12 dB within a quarter of a second of either player speaking', () => {
    for (const [mic, crew] of [[0.05, 0], [0, 0.05]]) {
      const d = new Ducker();
      for (let t = 0; t < 0.25; t += 1 / 90) d.step(mic, crew, 1 / 90);
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

  it('loop the grind and the starter without a click: whole beats, the end ringing on into the start', () => {
    expect((SOUND_SECONDS.grind * GRIND_TEETH_HZ) % 1).toBe(0);
    expect((SOUND_SECONDS.crank * CRANK_BEAT_HZ) % 1).toBe(0);
    for (const id of LOOPED) {
      const { biggest, join } = steps(renderSound(id, RATE));
      expect(join).toBeLessThanOrEqual(biggest);
    }
  });

  it('turn the engine over a bank at a time: the starter beats eight times a second', () => {
    const c = renderSound('crank', RATE);
    // Louder at each compression than between them.
    const beat = RATE / CRANK_BEAT_HZ;
    for (let k = 0; k < SOUND_SECONDS.crank * CRANK_BEAT_HZ; k++) {
      const mid = Math.round((k + 0.5) * beat);
      const quarter = Math.round(beat / 4);
      expect(rmsOf(c, mid, mid + quarter)).toBeGreaterThan(rmsOf(c, mid - 2 * quarter, mid - quarter));
    }
  });

  it('give the gun a crack, a boom that outlasts it, the breech flying open and the report rolling back', () => {
    const s = renderSound('shot', RATE);
    const at = (t: number, seconds = 0.02) => rmsOf(s, Math.round(t * RATE), Math.round((t + seconds) * RATE));
    // Loudest at once, still booming a third of a second on, and far quieter by a second.
    expect(at(0)).toBeGreaterThan(at(0.3) * 2);
    expect(at(0.3)).toBeGreaterThan(at(1.2) * 3);
    // The top is over in a few hundredths; the bottom carries on.
    let quick = 0;
    for (let i = 1; i < 0.02 * RATE; i++) quick = Math.max(quick, Math.abs(s[i] - s[i - 1]));
    let late = 0;
    for (let i = Math.round(0.3 * RATE) + 1; i < 0.32 * RATE; i++) late = Math.max(late, Math.abs(s[i] - s[i - 1]));
    expect(quick).toBeGreaterThan(late * 5);
    // Each echo off the range comes up out of the tail before it.
    for (const echo of SHOT_ECHOES.slice(1)) expect(at(echo + 0.15, 0.1)).toBeGreaterThan(at(echo - 0.12, 0.1));
  });

  it('give the casing a clang as it lands and each bounce after, lower and sooner each time', () => {
    const c = renderSound('casing', RATE);
    const at = (s: number) => rmsOf(c, Math.round(s * RATE), Math.round(s * RATE) + 240);
    for (const bounce of CASING_BOUNCES.slice(1, 4)) expect(at(bounce + 0.002)).toBeGreaterThan(at(bounce - 0.01));
    for (let k = 2; k < CASING_BOUNCES.length; k++) {
      expect(CASING_BOUNCES[k] - CASING_BOUNCES[k - 1]).toBeLessThan(CASING_BOUNCES[k - 1] - CASING_BOUNCES[k - 2]);
    }
    expect(at(CASING_BOUNCES[0] + 0.002)).toBeGreaterThan(at(CASING_BOUNCES[2] + 0.002));
    // Brass rings: its lowest mode is still there a tenth of a second after it lands.
    expect(tone(c.subarray(Math.round(0.08 * RATE), Math.round(0.16 * RATE)), 1120)).toBeGreaterThan(0.002);
  });
});

describe('the loops', () => {
  it('of noise peak at 1, centre on zero and meet themselves at the join', () => {
    for (const kind of ['white', 'brown'] as const) {
      const n = renderNoiseLoop(kind, RATE, 1);
      expect(peak(n)).toBeCloseTo(1, 5);
      expect(Math.abs(n.reduce((a, v) => a + v, 0) / n.length)).toBeLessThan(0.05);
    }
    const brown = renderNoiseLoop('brown', RATE, 2);
    expect(Math.abs(brown[brown.length - 1] - brown[0])).toBeLessThan(1e-4);
  });

  it('of gates open once a link or a tooth, between 0 and 1, no two pulses quite alike', () => {
    for (const shape of [LINK_GATE, TICK_GATE]) {
      const g = renderGate(shape, RATE);
      expect(g).toEqual(renderGate(shape, RATE));
      expect(g.length).toBe(Math.round((shape.count / shape.hz) * RATE));
      expect(g.every((v) => v >= 0 && v <= 1)).toBe(true);
      // A pulse in every gap, shut again before the next.
      const gap = RATE / shape.hz;
      const tops: number[] = [];
      for (let k = 0; k < shape.count; k++) {
        let top = 0;
        for (let i = Math.round(k * gap); i < Math.round((k + 1) * gap); i++) top = Math.max(top, g[i]);
        tops.push(top);
        expect(top).toBeGreaterThanOrEqual(shape.weakest * 0.99);
        expect(g[Math.round(k * gap)]).toBeLessThan(0.05);
      }
      expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(0.1);
    }
  });

  it("of the pins' squeal are mostly shut, with a few swells", () => {
    const g = renderSquealGate(RATE);
    expect(g.length).toBe(SQUEAL_SECONDS * RATE);
    expect(g.every((v) => v >= 0 && v <= 1)).toBe(true);
    let open = 0;
    for (let i = 0; i < g.length; i++) if (g[i] > 0.05) open++;
    expect(open / g.length).toBeGreaterThan(0.05);
    expect(open / g.length).toBeLessThan(0.4);
    expect(g[0]).toBe(0);
    expect(g[g.length - 1]).toBeLessThan(0.01);
  });
});

describe("the cabin's echo", () => {
  it('is short, has an energy of 1, dies away and differs between the ears', () => {
    const left = renderCabinImpulse(RATE, 0);
    const right = renderCabinImpulse(RATE, 1);
    expect(left.length).toBe(Math.round(CABIN_SECONDS * RATE));
    expect(left).toEqual(renderCabinImpulse(RATE, 0));
    for (const ear of [left, right]) {
      expect(ear.reduce((a, v) => a + v * v, 0)).toBeCloseTo(1, 4);
      // Nothing before the first wall is reached, most of it within a twentieth of a second, silence by the end.
      expect(peak(ear.subarray(0, Math.round(0.002 * RATE)))).toBe(0);
      const early = rmsOf(ear, 0, Math.round(0.05 * RATE));
      expect(rmsOf(ear, Math.round(0.2 * RATE), Math.round(0.25 * RATE))).toBeLessThan(early * 0.2);
      expect(Math.abs(ear[ear.length - 1])).toBeLessThan(1e-6);
    }
    let same = 0;
    for (let i = 0; i < left.length; i++) same += left[i] * right[i];
    expect(Math.abs(same)).toBeLessThan(0.5);
  });
});
