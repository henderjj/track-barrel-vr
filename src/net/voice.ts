/**
 * Spike S5: voice between the two crew members on the S4 peer connection.
 *
 * The microphone is captured with the browser's echo cancellation, noise
 * suppression and automatic gain (Opus is WebRTC's default voice codec). The
 * crewmate's voice is played in one of three ways, chosen with `?voice=`:
 *
 * - `plain` (default since F1.12): an ordinary audio element, not
 *   positioned, like a tank's intercom in the crew's headphones.
 * - `spatial`: Web Audio with an HRTF panner at the crewmate's head, so the
 *   voice comes from where they stand.
 * - `off`: no microphone and no playback.
 *
 * Chromium's echo canceller only "hears" audio played through WebRTC's own
 * output, so the spatial mix played straight from Web Audio may echo on a
 * headset whose speakers sit next to its microphones. `?voiceloop=1` routes
 * the Web Audio mix through a local loopback peer connection into an audio
 * element so the echo canceller can see it (the "loopback workaround").
 */

import { SPEECH_BAND_HZ, type SpeechReading } from '../sim/tank-audio.js';

export type VoiceMode = 'spatial' | 'plain' | 'off';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export class Voice {
  readonly mode: VoiceMode;
  readonly loopback: boolean;
  micTrack: MediaStreamTrack | null = null;
  micError = '';
  muted = false;
  /** The browser has allowed the microphone (asked up front, or remembered from before). */
  permitted = false;
  /** This player has turned the crewmate's voice off (the in-game menu). */
  remoteMuted = false;

  private ctx: AudioContext | null = null;
  private panner: PannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelData: Float32Array<ArrayBuffer> | null = null;
  /** This player's microphone level, for the tank sounds' duck (F1.12). */
  private micAnalyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micData: Float32Array<ArrayBuffer> | null = null;
  /** Both voices in the speech band only, for the duck (above the tank's engine, which the microphone hears from the speakers). */
  private micSpeech: SpeechMeter | null = null;
  private remoteSpeech: SpeechMeter | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  /** Keeps Chromium pulling the remote stream; muted in spatial mode (Web Audio plays it). */
  private sink: HTMLAudioElement | null = null;
  private loopOut: HTMLAudioElement | null = null;
  private loopPcs: RTCPeerConnection[] = [];
  private remoteStream: MediaStream | null = null;
  private onMicChange: (track: MediaStreamTrack | null) => void;

  constructor(mode: VoiceMode, loopback: boolean, onMicChange: (track: MediaStreamTrack | null) => void) {
    this.mode = mode;
    this.loopback = loopback && mode === 'spatial';
    this.onMicChange = onMicChange;
  }

  get enabled(): boolean {
    return this.mode !== 'off';
  }

  /**
   * Ask for microphone permission before the player joins a crew or enters
   * VR (a permission prompt inside VR is easy to miss), without keeping the
   * microphone open: it opens when they join a crew.
   */
  async askPermission(): Promise<void> {
    if (!this.enabled || this.micTrack || !navigator.mediaDevices?.getUserMedia) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      this.permitted = true;
      this.micError = '';
    } catch (error) {
      this.micError = error instanceof Error ? error.name : String(error);
      console.warn(`[Voice] microphone not allowed: ${this.micError}`);
    }
  }

  /** Whether the browser already allows the microphone, without asking. */
  async checkPermission(): Promise<boolean> {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      this.permitted ||= status?.state === 'granted';
    } catch {
      // Not every browser can query the microphone permission.
    }
    return this.permitted;
  }

  /** Ask for the microphone. Call from a click or another user gesture where possible. */
  async startMic(): Promise<void> {
    if (!this.enabled || this.micTrack || !navigator.mediaDevices?.getUserMedia) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      this.micTrack = stream.getAudioTracks()[0] ?? null;
      this.permitted = true;
      this.micError = '';
      if (this.micTrack) {
        this.micTrack.enabled = !this.muted;
        this.attachMicAnalyser(this.micTrack);
        const s = this.micTrack.getSettings();
        console.info(
          `[Voice] mic on: echoCancellation=${s.echoCancellation} noiseSuppression=${s.noiseSuppression} autoGainControl=${s.autoGainControl}`,
        );
      }
      this.onMicChange(this.micTrack);
    } catch (error) {
      this.micError = error instanceof Error ? error.name : String(error);
      console.warn(`[Voice] no microphone: ${this.micError}`);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.micTrack) {
      this.micTrack.enabled = !muted;
    }
  }

  /**
   * Turn the crewmate's voice off or on again. Their audio track is disabled
   * here, which plays silence, so nothing else in the chain changes.
   */
  setRemoteMuted(muted: boolean): void {
    this.remoteMuted = muted;
    for (const track of this.remoteStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  /** Start or resume audio output; browsers only allow this after a user gesture. */
  resume(): void {
    void this.ctx?.resume();
    void this.sink?.play().catch(() => undefined);
    void this.loopOut?.play().catch(() => undefined);
  }

  /** Play the crewmate's voice. */
  playRemote(stream: MediaStream): void {
    if (!this.enabled) {
      return;
    }
    this.stopRemote();
    this.remoteStream = stream;
    this.setRemoteMuted(this.remoteMuted);
    this.sink = new Audio();
    this.sink.srcObject = stream;
    this.sink.autoplay = true;
    if (this.mode === 'plain') {
      void this.sink.play().catch(() => undefined);
      this.attachAnalyser(stream, false);
      return;
    }
    // Chromium only feeds a remote WebRTC stream into Web Audio while a media element plays it too.
    this.sink.muted = true;
    void this.sink.play().catch(() => undefined);
    const ctx = this.context();
    this.source = ctx.createMediaStreamSource(stream);
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 50,
      rolloffFactor: 1,
    });
    this.source.connect(this.panner);
    this.attachAnalyser(stream, true);
    if (this.loopback) {
      void this.startLoopback(this.panner);
    } else {
      this.panner.connect(ctx.destination);
    }
  }

  stopRemote(): void {
    this.remoteStream = null;
    this.source?.disconnect();
    this.panner?.disconnect();
    this.analyser?.disconnect();
    this.remoteSpeech?.disconnect();
    this.remoteSpeech = null;
    this.source = null;
    this.panner = null;
    this.analyser = null;
    if (this.sink) {
      this.sink.srcObject = null;
      this.sink = null;
    }
    for (const pc of this.loopPcs) {
      pc.close();
    }
    this.loopPcs = [];
    if (this.loopOut) {
      this.loopOut.srcObject = null;
      this.loopOut = null;
    }
  }

  /** Place the listener (this player's head). Allocation free. */
  setListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
    const ctx = this.ctx;
    if (!ctx || !this.panner) {
      return;
    }
    const l = ctx.listener;
    const t = ctx.currentTime;
    l.positionX.setTargetAtTime(position.x, t, 0.02);
    l.positionY.setTargetAtTime(position.y, t, 0.02);
    l.positionZ.setTargetAtTime(position.z, t, 0.02);
    l.forwardX.setTargetAtTime(forward.x, t, 0.02);
    l.forwardY.setTargetAtTime(forward.y, t, 0.02);
    l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
    l.upX.setTargetAtTime(up.x, t, 0.02);
    l.upY.setTargetAtTime(up.y, t, 0.02);
    l.upZ.setTargetAtTime(up.z, t, 0.02);
  }

  /** Place the crewmate's voice at their mouth. Allocation free. */
  setSource(position: Vec3Like): void {
    const p = this.panner;
    if (!p || !this.ctx) {
      return;
    }
    const t = this.ctx.currentTime;
    p.positionX.setTargetAtTime(position.x, t, 0.02);
    p.positionY.setTargetAtTime(position.y, t, 0.02);
    p.positionZ.setTargetAtTime(position.z, t, 0.02);
  }

  /** RMS level of the crewmate's voice, 0 to 1 (speaking indicator and tests). */
  remoteLevel(): number {
    return rms(this.analyser, this.levelData);
  }

  /** RMS level of this player's microphone as sent, 0 to 1 (0 while muted): the tank sounds duck while it is up (F1.12). */
  micLevel(): number {
    return rms(this.micAnalyser, this.micData);
  }

  /** The crewmate's voice above SPEECH_BAND_HZ since the last read: what the tank sounds' duck listens to. Read once a frame. */
  remoteSpeechLevel(): SpeechReading {
    return this.remoteSpeech?.read() ?? SILENT;
  }

  /** This player's microphone above SPEECH_BAND_HZ since the last read (silent while muted): what the tank sounds' duck listens to. Read once a frame. */
  micSpeechLevel(): SpeechReading {
    return this.micSpeech?.read() ?? SILENT;
  }

  /** True once the loopback route is playing the spatial mix. */
  get loopbackActive(): boolean {
    return this.loopOut?.srcObject != null;
  }

  get audioState(): string {
    return this.ctx?.state ?? 'none';
  }

  dispose(): void {
    this.stopRemote();
    this.micSpeech?.disconnect();
    this.micSpeech = null;
    this.micSource?.disconnect();
    this.micSource = null;
    this.micAnalyser = null;
    this.micTrack?.stop();
    this.micTrack = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    return this.ctx;
  }

  private attachAnalyser(stream: MediaStream, reuseSource: boolean): void {
    const ctx = this.context();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.levelData = new Float32Array(this.analyser.fftSize);
    const input = reuseSource && this.source ? this.source : ctx.createMediaStreamSource(stream);
    input.connect(this.analyser);
    this.remoteSpeech = new SpeechMeter(ctx, input);
  }

  /** Listen to this player's own microphone (not played anywhere), to know when they speak. */
  private attachMicAnalyser(track: MediaStreamTrack): void {
    const ctx = this.context();
    this.micSource = ctx.createMediaStreamSource(new MediaStream([track]));
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;
    this.micData = new Float32Array(this.micAnalyser.fftSize);
    this.micSource.connect(this.micAnalyser);
    this.micSpeech = new SpeechMeter(ctx, this.micSource);
  }

  /** Route `node` through a local peer connection pair into an audio element (see the header comment). */
  private async startLoopback(node: AudioNode): Promise<void> {
    const ctx = this.context();
    const dest = ctx.createMediaStreamDestination();
    node.connect(dest);
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    this.loopPcs = [a, b];
    a.onicecandidate = (e) => e.candidate && void b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && void a.addIceCandidate(e.candidate);
    this.loopOut = new Audio();
    this.loopOut.autoplay = true;
    b.ontrack = (e) => {
      if (this.loopOut) {
        this.loopOut.srcObject = e.streams[0];
        void this.loopOut.play().catch(() => undefined);
      }
    };
    for (const track of dest.stream.getAudioTracks()) {
      a.addTrack(track, dest.stream);
    }
    // Opus is mono by default, which would undo the HRTF panning; ask for stereo.
    const offer = await a.createOffer();
    await a.setLocalDescription({ type: 'offer', sdp: stereoOpus(offer.sdp ?? '') });
    await b.setRemoteDescription(a.localDescription!);
    const answer = await b.createAnswer();
    await b.setLocalDescription({ type: 'answer', sdp: stereoOpus(answer.sdp ?? '') });
    await a.setRemoteDescription(b.localDescription!);
  }
}

const SILENT: SpeechReading = Object.freeze({ level: 0, quiet: 0 });
/** The speech meter measures in blocks this long, s. */
const SPEECH_BLOCK = 0.01;

/**
 * A level meter on the speech band: two high-passes at SPEECH_BAND_HZ
 * before an analyser, so the tank's engine and tracks, low-passed below
 * 900 Hz and heard by the headset's microphone from its own speakers,
 * hardly register (docs/audio.md).
 *
 * Each read covers everything heard since the last one (up to the
 * analyser's 0.7 s or so), in 10 ms blocks: the loudest block is the
 * level, the quietest the background under it. A single 10 ms look once a
 * frame missed short sounds whenever frames came slowly (a software-drawn
 * test browser draws a few a second), and a word that fell between looks.
 */
class SpeechMeter {
  private readonly ctx: BaseAudioContext;
  private readonly input: AudioNode;
  private readonly low: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  private readonly analyser: AnalyserNode;
  private readonly data: Float32Array<ArrayBuffer>;
  private readonly reading: SpeechReading = { level: 0, quiet: 0 };
  private lastRead = -1;

  constructor(ctx: BaseAudioContext, input: AudioNode) {
    this.ctx = ctx;
    this.input = input;
    this.low = new BiquadFilterNode(ctx, { type: 'highpass', frequency: SPEECH_BAND_HZ, Q: Math.SQRT1_2 });
    this.high = new BiquadFilterNode(ctx, { type: 'highpass', frequency: SPEECH_BAND_HZ, Q: Math.SQRT1_2 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 32768 });
    this.data = new Float32Array(this.analyser.fftSize);
    input.connect(this.low).connect(this.high).connect(this.analyser);
  }

  /** Allocation free: the same reading object each time. */
  read(): SpeechReading {
    const now = this.ctx.currentTime;
    const block = Math.max(1, Math.round(SPEECH_BLOCK * this.ctx.sampleRate));
    const data = this.data;
    const elapsed = this.lastRead < 0 ? 0 : Math.round((now - this.lastRead) * this.ctx.sampleRate);
    this.lastRead = now;
    const blocks = Math.max(1, Math.min(Math.floor(data.length / block), Math.round(elapsed / block)));
    this.analyser.getFloatTimeDomainData(data);
    let loudest = 0;
    let quietest = Number.POSITIVE_INFINITY;
    for (let b = 0; b < blocks; b++) {
      const end = data.length - b * block;
      let sum = 0;
      for (let i = end - block; i < end; i++) sum += data[i] * data[i];
      const level = Math.sqrt(sum / block);
      if (level > loudest) loudest = level;
      if (level < quietest) quietest = level;
    }
    this.reading.level = loudest;
    this.reading.quiet = quietest;
    return this.reading;
  }

  disconnect(): void {
    this.input.disconnect(this.low);
    this.low.disconnect();
    this.high.disconnect();
  }
}

/** RMS level of what `analyser` hears now, 0 to 1. */
function rms(analyser: AnalyserNode | null, data: Float32Array<ArrayBuffer> | null): number {
  if (!analyser || !data) {
    return 0;
  }
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
}

/** Add stereo and a high bitrate to the Opus format line of an SDP. */
export function stereoOpus(sdp: string): string {
  const match = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp);
  if (!match) {
    return sdp;
  }
  const pt = match[1];
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (line, params: string) =>
    params.includes('stereo=1') ? line : `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=256000`,
  );
}
