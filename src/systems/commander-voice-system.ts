import { createSystem, VisibilityState } from '@iwsdk/core';
import { onSettingChange } from '../live-settings.js';
import { settings } from '../settings.js';
import { callSeconds, commander, commanderSpeaking, INTERCOM, LINE_IDS } from '../sim/commander-voice.js';
import { commanderGain, commanderHeard, volumeText } from '../sim/volume.js';

/** What the tests read and do (`window.__commander`). */
interface CommanderDebug {
  /** The calls said lately, oldest first: their lines. */
  said: () => (readonly string[])[];
  /** Calls asked for since the page loaded, said or not. */
  asked: () => number;
  speaking: () => boolean;
  /** How many of the lines' clips have loaded, and how many there are. */
  loaded: () => [number, number];
  context: () => string;
  /** Ask for a call as a note would. */
  say: (lines: string[]) => boolean;
  /** Forget what was said lately, so the next call isn't taken for a repeat. */
  reset: () => void;
  /** RMS of what the voice puts out now, 0 to 1 (a meter added on first use). */
  outputLevel: () => number;
}

/** The voice's level under the setting's 1, linear: its peaks about as loud as the tank's under the duck. */
const LEVEL = 0.7;
/** Its drive into the amplifier's clip is set for clips whose filtered peak is about this. */
const FILTERED_PEAK = 0.5;
/** Seconds of looped hiss and crackle. */
const NOISE_SECONDS = 3;

/**
 * The tank commander on the intercom (docs/commander-voice.md). Notes that
 * go on the crew board ask for a call (src/sim/commander-voice.ts); this says
 * them one at a time: the switch's click, the hiss and crackle of a keyed
 * interphone, the lines (a fire order's parts close together, as one call),
 * the hash as the switch is let go. The dry lines ship in
 * public/audio/commander and go through the intercom's filter here, so it
 * matches across a fire order's parts. While he speaks, TankAudioSystem ducks
 * the tank as it does under the crew's own voices.
 *
 * Each page says what its own notes call: nothing new goes over the network.
 * The practice crewmate's page says nothing.
 */
export class CommanderVoiceSystem extends createSystem({}) {
  private ctx: AudioContext | null = null;
  private readonly clips = new Map<string, AudioBuffer>();
  private voiceIn: GainNode | null = null;
  private hiss: GainNode | null = null;
  private crackle: GainNode | null = null;
  private out: GainNode | null = null;
  private click: AudioBuffer | null = null;
  private hash: AudioBuffer | null = null;
  private hashIn: GainNode | null = null;
  private busyUntil = 0;
  private hidden = false;
  private readonly durations: number[] = [];
  private meter: AnalyserNode | null = null;
  private meterData: Float32Array<ArrayBuffer> | null = null;

  init(): void {
    const self = this;
    (window as unknown as { __commander: CommanderDebug }).__commander = {
      said: () => commander.said.map((s) => s.lines),
      asked: () => commander.asked,
      speaking: () => commanderSpeaking.now,
      loaded: () => [self.clips.size, LINE_IDS.length],
      context: () => self.ctx?.state ?? 'none',
      say: (lines: string[]) => commander.ask(lines),
      reset: () => commander.clear(),
      outputLevel: () => self.outputLevel(),
    };
    this.cleanupFuncs.push(() => {
      commander.clear();
      commanderSpeaking.now = false;
    });
    if (settings.bot || typeof AudioContext === 'undefined') return;
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.build(this.ctx);
    } catch (error) {
      this.ctx = null;
      console.warn(`[Commander] no Web Audio: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    void this.load(this.ctx);
    const resume = () => this.resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    const onPageVisibility = () => this.checkHidden();
    document.addEventListener('visibilitychange', onPageVisibility);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', resume),
      () => window.removeEventListener('keydown', resume),
      () => document.removeEventListener('visibilitychange', onPageVisibility),
      this.world.visibilityState.subscribe(() => this.checkHidden()),
      onSettingChange((key) => {
        if (key === 'commander' || key === 'sound') this.applyLevel();
      }),
      () => void this.ctx?.close(),
    );
    this.applyLevel();
  }

  /** The intercom: the voice's band, hump and clip; the keyed hiss and crackle; the switch's click and hash. */
  private build(ctx: AudioContext): void {
    const p = INTERCOM;
    const out = new GainNode(ctx, { gain: 0 });
    out.connect(ctx.destination);
    this.out = out;
    // A 4th-order Butterworth either side of the band: two 2nd-order sections with these Qs.
    const qs = [0.5412, 1.3066];
    const chain = (nodes: AudioNode[]) => nodes.reduce((a, b) => (a.connect(b), b));
    this.voiceIn = new GainNode(ctx, { gain: 1 / FILTERED_PEAK });
    const shaper = new WaveShaperNode(ctx, { curve: tanhCurve(p.drive), oversample: '2x' });
    chain([
      this.voiceIn,
      ...qs.map((Q) => new BiquadFilterNode(ctx, { type: 'highpass', frequency: p.low, Q })),
      ...qs.map((Q) => new BiquadFilterNode(ctx, { type: 'lowpass', frequency: p.high, Q })),
      new BiquadFilterNode(ctx, { type: 'peaking', frequency: p.hump.hz, gain: p.hump.db, Q: p.hump.q }),
      shaper,
      ...qs.map((Q) => new BiquadFilterNode(ctx, { type: 'lowpass', frequency: p.high * p.afterClip, Q })),
      out,
    ]);
    // Hiss: noise through its band, about hissDb under the clipped voice's peak, fluttering.
    const noise = noiseBuffer(ctx, NOISE_SECONDS, 1);
    const hissSource = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true });
    this.hiss = new GainNode(ctx, { gain: 0 });
    // The band passes about its share of white noise's power: scale for that so the hiss sits at hissDb.
    const share = Math.sqrt((p.hissBand[1] - p.hissBand[0]) / (ctx.sampleRate / 2));
    const hissLevel = new GainNode(ctx, { gain: 10 ** (p.hissDb / 20) / share });
    chain([
      hissSource,
      new BiquadFilterNode(ctx, { type: 'highpass', frequency: p.hissBand[0], Q: 0.7 }),
      new BiquadFilterNode(ctx, { type: 'lowpass', frequency: p.hissBand[1], Q: 0.7 }),
      hissLevel,
      this.hiss,
      out,
    ]);
    const flutter = new OscillatorNode(ctx, { frequency: p.flutterHz });
    const depth = new GainNode(ctx, { gain: p.flutter / share * 10 ** (p.hissDb / 20) });
    flutter.connect(depth);
    // The flutter rides on the hiss's level (keyed after it, with the hiss).
    depth.connect(hissLevel.gain);
    // Crackle: short decaying bursts, about `crackle` a second.
    const crackleSource = new AudioBufferSourceNode(ctx, { buffer: crackleBuffer(ctx, NOISE_SECONDS, p.crackle), loop: true });
    this.crackle = new GainNode(ctx, { gain: 0 });
    chain([
      crackleSource,
      new BiquadFilterNode(ctx, { type: 'highpass', frequency: 800, Q: 0.7 }),
      new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 5000, Q: 0.7 }),
      this.crackle,
      out,
    ]);
    // The switch: a click, and a burst of hash as it is let go.
    this.click = clickBuffer(ctx, p.clickHz);
    this.hash = hashBuffer(ctx, p.hash);
    this.hashIn = new GainNode(ctx, { gain: 1 });
    chain([this.hashIn, new BiquadFilterNode(ctx, { type: 'highpass', frequency: 700, Q: 0.7 }), new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4500, Q: 0.7 }), out]);
    hissSource.start();
    crackleSource.start();
    flutter.start();
  }

  /** Fetch and decode every line's clip. */
  private async load(ctx: AudioContext): Promise<void> {
    const base = `${import.meta.env.BASE_URL}audio/commander/`;
    await Promise.all(
      LINE_IDS.map(async (id) => {
        try {
          const res = await fetch(`${base}${id}.ogg`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.clips.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (error) {
          console.warn(`[Commander] line ${id} didn't load: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
    console.info(`[Commander] ${this.clips.size} of ${LINE_IDS.length} lines loaded`);
  }

  update(): void {
    const ctx = this.ctx;
    if (!ctx || !commanderHeard(settings) || this.hidden) {
      // Nothing to say them with: old news by the time there is.
      commander.waiting.length = 0;
      commanderSpeaking.now = false;
      return;
    }
    const now = ctx.currentTime;
    commanderSpeaking.now = now < this.busyUntil;
    if (ctx.state !== 'running' || now < this.busyUntil - 0.05) return;
    const lines = commander.next();
    if (lines) this.speak(ctx, lines, Math.max(now + 0.03, this.busyUntil));
  }

  /** One press of the switch: the lines said as one call from `t0`. */
  private speak(ctx: AudioContext, lines: readonly string[], t0: number): void {
    const p = INTERCOM;
    const durations = this.durations;
    durations.length = 0;
    let at = t0 + p.pre;
    for (const id of lines) {
      const clip = this.clips.get(id);
      if (!clip) continue;
      const source = new AudioBufferSourceNode(ctx, { buffer: clip });
      source.connect(this.voiceIn!);
      source.start(at);
      at += clip.duration + p.join;
      durations.push(clip.duration);
    }
    if (durations.length === 0) return;
    const end = t0 + callSeconds(durations);
    const release = end - p.hash;
    // The keyed hiss and crackle, faded in and out over 10 ms so the ends don't pop.
    for (const g of [this.hiss!.gain, this.crackle!.gain]) {
      g.cancelScheduledValues(t0);
      g.setValueAtTime(0, t0);
      g.linearRampToValueAtTime(1, t0 + 0.01);
      g.setValueAtTime(1, end - 0.01);
      g.linearRampToValueAtTime(0, end);
    }
    this.playBuffer(ctx, this.click!, t0, 1);
    this.playBuffer(ctx, this.hash!, release - p.post / 2, 1, this.hashIn!);
    this.playBuffer(ctx, this.click!, release - p.post / 2, 0.6);
    this.busyUntil = end;
    commanderSpeaking.now = true;
    console.info(`[Commander] ${lines.join(' ')}`);
  }

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer, at: number, gain: number, into: AudioNode = this.out!): void {
    const source = new AudioBufferSourceNode(ctx, { buffer });
    if (gain === 1) {
      source.connect(into);
    } else {
      const g = new GainNode(ctx, { gain });
      source.connect(g);
      g.connect(into);
    }
    source.start(at);
  }

  private resume(): void {
    if (this.ctx && commanderHeard(settings) && !this.hidden && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Quiet while the page is hidden or the headset is off. */
  private checkHidden(): void {
    this.hidden = document.visibilityState === 'hidden' || this.world.visibilityState.peek() === VisibilityState.Hidden;
    if (this.hidden) {
      void this.ctx?.suspend();
    } else {
      this.resume();
    }
  }

  /** The player's Commander setting: the level, and the context stopped while Off. */
  private applyLevel(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    this.out.gain.setTargetAtTime(LEVEL * commanderGain(settings), ctx.currentTime, 0.05);
    if (!commanderHeard(settings)) {
      void ctx.suspend();
    } else {
      this.resume();
    }
    console.info(`[Commander] voice ${commanderHeard(settings) ? volumeText(settings.commander) : 'off'}`);
  }

  private outputLevel(): number {
    if (!this.ctx || !this.out) return 0;
    if (!this.meter) {
      // The longest window an analyser keeps (0.7 s at 48 kHz), so one look on a slow test page still spans a word.
      this.meter = new AnalyserNode(this.ctx, { fftSize: 32768 });
      this.meterData = new Float32Array(this.meter.fftSize);
      this.out.connect(this.meter);
    }
    const data = this.meterData!;
    this.meter.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }
}

/** The amplifier's soft clip: tanh(drive x), scaled so full input still reaches 1. */
function tanhCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

/** A tiny repeatable random sequence, so the hiss is the same on every page and in every test. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Noise, near-normal (the sum of four uniforms), RMS about `rms`. */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, rms: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const r = random(7);
  // Four uniforms in −0.5..0.5 sum to variance 1/3.
  const scale = rms * Math.sqrt(3);
  for (let i = 0; i < data.length; i++) data[i] = (r() + r() + r() + r() - 2) * scale;
  return buffer;
}

/** Short decaying bursts of noise, `rate` a second at random, 0.05–0.15 high. */
function crackleBuffer(ctx: BaseAudioContext, seconds: number, rate: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const r = random(11);
  const burst = 200;
  const count = Math.round(rate * seconds);
  for (let k = 0; k < count; k++) {
    const at = Math.floor(r() * (data.length - burst));
    const height = 0.05 + r() * 0.1;
    for (let j = 0; j < burst; j++) data[at + j] += height * (r() + r() + r() + r() - 2) * Math.sqrt(3) * Math.exp(-j / 30);
  }
  return buffer;
}

/** The switch's click: a short ring at `hz`, gone in a few milliseconds. */
function clickBuffer(ctx: BaseAudioContext, hz: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(0.03 * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = 0.35 * Math.sin((2 * Math.PI * hz * i) / ctx.sampleRate) * Math.exp(-i / (0.003 * ctx.sampleRate));
  return buffer;
}

/** The hash as the switch is let go: noise dying away over `seconds`. */
function hashBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const r = random(13);
  for (let i = 0; i < data.length; i++) data[i] = 0.12 * (r() + r() + r() + r() - 2) * Math.sqrt(3) * Math.exp(-i / (0.04 * ctx.sampleRate));
  return buffer;
}
