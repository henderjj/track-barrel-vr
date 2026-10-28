import { createSystem, VisibilityState } from '@iwsdk/core';
import { onSettingChange } from '../live-settings.js';
import { settings } from '../settings.js';
import { CASING_FLIGHT, RECOIL } from '../sim/loading.js';
import {
  createCues,
  createEngineVoice,
  createTrackVoice,
  type CueState,
  Ducker,
  engineVoice,
  MIX,
  renderEngineCycle,
  renderNoiseLoop,
  renderSound,
  SOUND_IDS,
  SoundCues,
  type SoundId,
  trackVoice,
  whineVoice,
} from '../sim/tank-audio.js';
import { shownDriverState } from './drive-system.js';
import { shotListeners } from './firing-system.js';
import { loadingShown } from './loading-system.js';
import { netLink } from './net-system.js';
import { turretState } from './turret-system.js';

/** The continuous sounds follow the tank this often, Hz (Web Audio glides between). */
const PARAM_HZ = 20;
/** How smoothly they glide to each new value, s (a time constant). */
const GLIDE = 0.06;
/** Practice → Tank sounds → Play each: the sounds in turn, s apart, and how long the grind runs. */
const PLAY_EACH: readonly SoundId[] = ['clunk', 'grind', 'ram', 'breech', 'shot', 'latch', 'bump'];
const PLAY_EACH_GAP = 1.1;
const PLAY_EACH_GRIND = 1;

let active: TankAudioSystem | null = null;

/** Practice → Tank sounds → Play each: every short sound in turn, so a headset check can hear them without driving or loading. */
export function playEachSound(): void {
  active?.playEach();
}

/** One line for the menu: whether sound plays, and the duck. */
export function audioStatus(): string {
  return active?.status() ?? '';
}

interface AudioDebug {
  state(): {
    context: string;
    sound: number;
    engineHz: number;
    engineGain: number;
    rumble: number;
    clatterHz: number;
    whine: number;
    grinding: boolean;
    duckDb: number;
    speaking: boolean;
    /** Each short sound played (or sent to play) so far on this page. */
    heard: Record<SoundId, number>;
  };
  playEach(): void;
}

/**
 * The tank's sounds (F1.12, docs/audio.md), synthesised with Web Audio and
 * the rules in src/sim/tank-audio.ts, no sample files:
 *
 * - the engine from the RPM (a V12 diesel's lumpy firing beat, 30 Hz at
 *   idle to 62 Hz flat out, muffled by the hull), the tracks' rumble and the links' clatter from their
 *   speed, and the power traverse's whine from the turret's turn;
 * - short sounds rendered once at load: gears going in and grinding, the
 *   hull bumping, a shell rammed, the breech slamming shut or opened by
 *   hand, the gun (with the breech flying open) and the casing landing in
 *   the bin half a second later.
 *
 * Each page plays the tank as it draws it (shownDriverState, the turret,
 * the loading as drawn, and every shot through `shotListeners`), so both
 * crew hear the same tank with nothing more sent. Everything goes through
 * one bus that drops 6 dB while either player speaks (the voice analysers,
 * `netLink.micLevel` and `crewLevel`), then the player's Tank sounds
 * setting. The voice itself plays outside it, plain like an intercom.
 *
 * Browsers start audio only after a click or Enter VR; the context
 * suspends while the page is hidden or the setting is Off. The practice
 * crewmate's page makes no sound.
 */
export class TankAudioSystem extends createSystem({}) {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private duck!: GainNode;
  private buffers = {} as Record<SoundId, AudioBuffer>;
  private engineCycle!: AudioBufferSourceNode;
  private engineFilter!: BiquadFilterNode;
  private engineAmp!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  private rumbleAmp!: GainNode;
  private clatterBeat!: OscillatorNode;
  private clatterAmp!: GainNode;
  private whine!: OscillatorNode;
  private whineAmp!: GainNode;
  private grindAmp!: GainNode;
  private readonly engine = createEngineVoice();
  private readonly tracks = createTrackVoice();
  private readonly whineNow = { freq: 0, gain: 0 };
  private readonly ducker = new Ducker();
  private readonly cues = new SoundCues();
  private readonly cueOut = createCues();
  private readonly cueState: CueState = { gear: 0, grinding: false, bumps: 0, lever: 0, rammed: false };
  private readonly heard = Object.fromEntries(SOUND_IDS.map((id) => [id, 0])) as Record<SoundId, number>;
  private grinding = false;
  private paramClock = 0;
  private time = 0;
  private shotAt = Number.NEGATIVE_INFINITY;
  private hidden = false;

  init(): void {
    active = this;
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
    });
    const self = this;
    (window as unknown as { __audio: AudioDebug }).__audio = {
      state: () => ({
        context: self.ctx?.state ?? 'none',
        sound: settings.sound,
        engineHz: self.engine.freq,
        engineGain: self.engine.gain,
        rumble: self.tracks.rumble,
        clatterHz: self.tracks.clatterHz,
        whine: self.whineNow.gain,
        grinding: self.grinding,
        duckDb: self.ducker.db,
        speaking: self.ducker.speaking,
        heard: { ...self.heard },
      }),
      playEach: () => self.playEach(),
    };
    // The practice crewmate's PC page stays quiet: it would only echo the headset's tank.
    if (settings.bot || typeof AudioContext === 'undefined') return;
    try {
      this.build(new AudioContext({ latencyHint: 'interactive' }));
    } catch (error) {
      console.warn(`[Audio] no Web Audio: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const onShot = () => this.onShot();
    shotListeners.add(onShot);
    // Browsers only start audio after a user gesture: any click or key, or entering VR.
    const resume = () => this.resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    const onPageVisibility = () => this.checkHidden();
    document.addEventListener('visibilitychange', onPageVisibility);
    this.cleanupFuncs.push(
      () => shotListeners.delete(onShot),
      () => window.removeEventListener('pointerdown', resume),
      () => window.removeEventListener('keydown', resume),
      () => document.removeEventListener('visibilitychange', onPageVisibility),
      this.world.visibilityState.subscribe(() => this.checkHidden()),
      onSettingChange((key) => {
        if (key === 'sound') this.applySound();
      }),
      () => void this.ctx?.close(),
    );
    this.applySound();
  }

  /** The graph: every sound into the duck, the duck into the player's level. */
  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const rate = ctx.sampleRate;
    for (const id of SOUND_IDS) {
      const samples = renderSound(id, rate);
      const buffer = ctx.createBuffer(1, samples.length, rate);
      buffer.copyToChannel(samples, 0);
      this.buffers[id] = buffer;
    }
    this.master = new GainNode(ctx, { gain: settings.sound });
    this.master.connect(ctx.destination);
    this.duck = new GainNode(ctx, { gain: 1 });
    this.duck.connect(this.master);

    // The engine: the diesel's firing cycle, played faster as it revs, muffled by the hull.
    engineVoice(800, this.engine);
    this.engineCycle = this.loop(renderEngineCycle(rate));
    this.engineFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: this.engine.cutoff, Q: 0.9 });
    this.engineAmp = new GainNode(ctx, { gain: MIX.engine * this.engine.gain });
    this.engineCycle.connect(this.engineFilter).connect(this.engineAmp).connect(this.duck);

    // The tracks: brown noise under a low-pass, and white noise through a band-pass beating at the links' rate.
    const rumble = this.loop(renderNoiseLoop('brown', rate, 2));
    this.rumbleFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 90, Q: 0.7 });
    this.rumbleAmp = new GainNode(ctx, { gain: 0 });
    rumble.connect(this.rumbleFilter).connect(this.rumbleAmp).connect(this.duck);
    const clatter = this.loop(renderNoiseLoop('white', rate, 1));
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1100, Q: 1.2 });
    // A falling sawtooth (1 to 0 each link) on the band's level: a tick that dies away per link.
    const beat = new GainNode(ctx, { gain: 0.5 });
    this.clatterBeat = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 1 });
    this.clatterBeat.connect(new GainNode(ctx, { gain: -0.5 })).connect(beat.gain);
    this.clatterAmp = new GainNode(ctx, { gain: 0 });
    clatter.connect(band).connect(beat).connect(this.clatterAmp).connect(this.duck);

    // The power traverse's whine.
    this.whine = new OscillatorNode(ctx, { type: 'triangle', frequency: 180 });
    this.whineAmp = new GainNode(ctx, { gain: 0 });
    this.whine.connect(this.whineAmp).connect(this.duck);

    // The grind, looping, heard while the gears grind.
    const grind = this.loop(this.buffers.grind);
    this.grindAmp = new GainNode(ctx, { gain: 0 });
    grind.connect(this.grindAmp).connect(this.duck);

    for (const osc of [this.clatterBeat, this.whine]) osc.start();
  }

  /** A buffer playing round and round from now. */
  private loop(samples: Float32Array<ArrayBuffer> | AudioBuffer): AudioBufferSourceNode {
    const ctx = this.ctx!;
    let buffer: AudioBuffer;
    if (samples instanceof Float32Array) {
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
    } else {
      buffer = samples;
    }
    const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    source.start();
    return source;
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.time += dt;
    const ctx = this.ctx;
    const s = shownDriverState();
    const turret = turretState();
    const loading = loadingShown();
    if (s) {
      engineVoice(s.rpm, this.engine);
      trackVoice(s.leftTrack, s.rightTrack, this.tracks);
      this.grinding = s.grinding;
    }
    whineVoice(turret.rate, this.whineNow);
    const duck = this.ducker.step(netLink.micLevel(), netLink.crewLevel(), dt);

    // The short sounds this frame's changes make.
    const c = this.cueState;
    c.gear = s?.gear ?? 0;
    c.grinding = s?.grinding ?? false;
    c.bumps = s?.bumps ?? 0;
    c.lever = loading?.lever ?? 0;
    c.rammed = loading?.rammed ?? false;
    const cues = this.cues.step(c, this.time - this.shotAt, this.cueOut);
    if (cues.clunk) this.sound('clunk');
    if (cues.bump) this.sound('bump');
    if (cues.ram) this.sound('ram');
    if (cues.breech) this.sound('breech');
    if (cues.latch) this.sound('latch');

    if (ctx == null || ctx.state !== 'running') return;
    this.paramClock += dt;
    if (this.paramClock < 1 / PARAM_HZ) return;
    this.paramClock = 0;
    const t = ctx.currentTime;
    const e = this.engine;
    this.engineCycle.playbackRate.setTargetAtTime(e.rate, t, GLIDE);
    this.engineFilter.frequency.setTargetAtTime(e.cutoff, t, GLIDE);
    this.engineAmp.gain.setTargetAtTime(MIX.engine * e.gain, t, GLIDE);
    const k = this.tracks;
    this.rumbleFilter.frequency.setTargetAtTime(k.rumbleCutoff, t, GLIDE);
    this.rumbleAmp.gain.setTargetAtTime(MIX.rumble * k.rumble, t, GLIDE);
    this.clatterBeat.frequency.setTargetAtTime(Math.max(1, k.clatterHz), t, GLIDE);
    this.clatterAmp.gain.setTargetAtTime(MIX.clatter * k.clatter, t, GLIDE);
    this.whine.frequency.setTargetAtTime(this.whineNow.freq, t, GLIDE);
    this.whineAmp.gain.setTargetAtTime(MIX.whine * this.whineNow.gain, t, GLIDE);
    this.grindAmp.gain.setTargetAtTime(this.grinding ? 1 : 0, t, 0.03);
    this.duck.gain.setTargetAtTime(duck, t, 0.02);
  }

  /** The gun fired on either page: the report now, the casing landing in the bin as it gets there. */
  private onShot(): void {
    this.shotAt = this.time;
    this.sound('shot');
    this.sound('casing', RECOIL.back + CASING_FLIGHT);
  }

  /**
   * Play a short sound `delay` s from now. A Web Audio source plays once, so
   * this makes one node per sound; they come a few times a second at most.
   */
  private sound(id: SoundId, delay = 0, seconds = 0): void {
    this.heard[id]++;
    const ctx = this.ctx;
    if (ctx == null || ctx.state !== 'running') return;
    const source = new AudioBufferSourceNode(ctx, { buffer: this.buffers[id], loop: seconds > 0 });
    source.connect(this.duck);
    const at = ctx.currentTime + delay;
    source.start(at);
    if (seconds > 0) source.stop(at + seconds);
  }

  playEach(): void {
    console.info('[Audio] Practice: play each sound');
    PLAY_EACH.forEach((id, i) => this.sound(id, 0.2 + i * PLAY_EACH_GAP, id === 'grind' ? PLAY_EACH_GRIND : 0));
    this.sound('casing', 0.2 + PLAY_EACH.indexOf('shot') * PLAY_EACH_GAP + RECOIL.back + CASING_FLIGHT);
  }

  status(): string {
    if (settings.bot) return "The practice crewmate's page makes no sound.";
    const ctx = this.ctx;
    if (ctx == null) return 'No sound: this browser has no Web Audio.';
    if (settings.sound === 0) return 'Tank sounds off (Sound and view).';
    if (ctx.state !== 'running') return 'Sound starts with a click or Enter VR.';
    const duck = this.ducker.speaking ? `ducked ${this.ducker.db.toFixed(0)} dB for the intercom` : 'nobody speaking';
    return `Sound on: engine ${this.engine.freq.toFixed(0)} Hz, ${duck}.`;
  }

  private resume(): void {
    if (this.ctx && settings.sound > 0 && !this.hidden && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Quiet while the page is hidden or the headset is off: the tank stops being drawn, so it stops being heard. */
  private checkHidden(): void {
    const hidden = document.visibilityState === 'hidden' || this.world.visibilityState.peek() === VisibilityState.Hidden;
    this.hidden = hidden;
    if (hidden) {
      void this.ctx?.suspend();
    } else {
      this.resume();
    }
  }

  /** The player's Tank sounds setting: the level, and the context stopped while Off. */
  private applySound(): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    this.master.gain.setTargetAtTime(settings.sound, ctx.currentTime, 0.05);
    if (settings.sound === 0) {
      void ctx.suspend();
    } else {
      this.resume();
    }
    console.info(`[Audio] tank sounds ${settings.sound === 0 ? 'off' : settings.sound < 1 ? 'quiet' : 'on'}`);
  }
}
