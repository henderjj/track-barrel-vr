import { turretToHull } from '../sim/interior.js';
import {
  CABIN_SECONDS,
  GATE_HZ,
  LINK_GATE,
  renderCabinImpulse,
  renderEngineBreath,
  renderEngineLoop,
  renderGate,
  renderGritGate,
  renderNoiseLoop,
  renderSound,
  renderSqueak,
  renderStrainGate,
  TICK_GATE,
} from '../sim/sound-render.js';
import {
  BLAST_ATTACK,
  BLAST_DIP,
  BLAST_HOLD,
  BLAST_RECOVER,
  CABIN_SEND,
  createDriveVoice,
  createEngineVoice,
  createTrackVoice,
  createTraverseVoice,
  type DriveVoice,
  type EngineVoice,
  MIX,
  PLACED_SHARE,
  SOUND_FROM,
  SOUND_IDS,
  SOUND_PLACES,
  SQUEAK_VARIANTS,
  type SoundId,
  type SoundPlace,
  type TrackVoice,
  type TraverseVoice,
  TURRET_PLACES,
} from '../sim/tank-audio.js';

/** How smoothly the continuous sounds glide to each new value, s (a time constant). */
const GLIDE = 0.06;
const SIDES = ['left', 'right'] as const;

/** Everything the continuous sounds follow, as TankAudioSystem (or a preview render) works it out. */
export interface TankVoices {
  engine: EngineVoice;
  drive: DriveVoice;
  tracks: TrackVoice;
  traverse: TraverseVoice;
  handGear: { hz: number; gain: number };
  siren: { freq: number; gain: number; glide: number };
  grinding: boolean;
  cranking: boolean;
  /** The turret's turn on the hull, rad: the breech, the bin and the traverse gear turn with it. */
  turretYaw: number;
}

export function createTankVoices(): TankVoices {
  return {
    engine: createEngineVoice(),
    drive: createDriveVoice(),
    tracks: createTrackVoice(),
    traverse: createTraverseVoice(),
    handGear: { hz: 0, gain: 0 },
    siren: { freq: 120, gain: 0, glide: 0.5 },
    grinding: false,
    cranking: false,
    turretYaw: 0,
  };
}

/** Somewhere sounds come from: steady ones (which dip at the gun's blast) and knocks go in, and come out partly from its place and partly, through the cabin's echo, from all round. */
interface Place {
  steady: GainNode;
  knock: GainNode;
  panner: PannerNode | null;
}

/** What a track's links ring like when they meet the sprocket and the wheels, heard through the hull: band-passes at Hz, with their sharpness and share. */
const LINK_RING = [
  [330, 5, 1],
  [590, 7, 0.8],
  [1040, 9, 0.6],
  [1730, 10, 0.45],
  [2600, 8, 0.32],
  [4300, 5, 0.22],
] as const;

/** The exhaust's second low-pass sits this many times above its first: 12 dB an octave off above the cutoff, 24 above this. */
const EXHAUST_TOP = 2.5;
/** What the engine's roar rings in (pipes, plates, the engine bay): peaks at Hz, with their sharpness and height in dB. */
const ROAR_RING = [
  [650, 1.5, 5],
  [1050, 3, 4],
  [2000, 3, 5],
  [2500, 4, 3],
] as const;
/** Nothing of the roar above this, Hz: the hull between the engine and the crew. */
const ROAR_TOP = 3400;
/** How much of the roar is steady (fan, intakes), and how much comes and goes with each cylinder's breath (renderEngineBreath, which averages about a sixth). */
const ROAR_STEADY = 0.06;
const ROAR_BREATH = 2;
/** The roar's noise comes out of its filters far quieter than it went in: bring it back up. */
const ROAR_MAKEUP = 8;
/** How loud a link's ring is, and its thud through the floor beside it. */
const LINK_RING_LEVEL = 2.5;
const LINK_THUD = 0.6;
/** A link's rings above this, Hz, are its clink: what the ground under the track brightens or dulls most (src/sim/ground-surface.ts). */
const LINK_TOP_FROM = 1200;
/**
 * The ground's own noise under a track: how wide its band is, and the
 * make-up for what the band and the grains' gate let through. At a crawl
 * each grain is heard by itself; as the links come faster the grains run
 * together, so a steady share comes in under them (a grain at its hardest
 * is 1), all of it by GRIT_RUN_HZ links a second.
 */
const GRIT_Q = 0.9;
const GRIT_STEADY = 0.12;
const GRIT_RUN_HZ = 30;
const GRIT_MAKEUP = 4.3;
/**
 * What a strained track rings in as it judders against the road wheels,
 * the idler and the ground: the steel of the wheels, the guide horns and
 * the links, a groan through the suspension at the bottom (band-passes at
 * Hz, with their sharpness and share).
 */
const STRAIN_RING = [
  [140, 2.5, 1],
  [310, 4, 0.9],
  [540, 5, 0.75],
  [880, 6, 0.55],
  [1450, 7, 0.35],
] as const;
/** How loud the strain's ring is, and the links scrubbing sideways over the ground beside it (in a band at STRAIN_SCRUB of the ground's own). */
const STRAIN_LEVEL = 2;
const STRAIN_SCRUB_LEVEL = 1.2;
const STRAIN_SCRUB = 0.6;

/** A gear's whine: a fundamental with a few weaker harmonics, far duller than a sawtooth. */
const WHINE_HARMONICS = [0, 1, 0.5, 0.28, 0.12, 0.05];
/** An electric motor: its hum and the commutator's ripple above it. */
const MOTOR_HARMONICS = [0, 1, 0.35, 0.3, 0.08, 0.14, 0.04, 0.06];

/**
 * The tank's sounds as a Web Audio graph (F6.1, docs/audio.md), on a live
 * context for the game or an offline one for rendering a preview. Nothing
 * here knows about the game: `apply` glides the continuous sounds to a set
 * of voices and `play` starts a short sound.
 *
 * - The engine is its exhaust loop played as fast as it turns, through the
 *   exhaust's and hull's filters, which stay put; the fan, intake and
 *   combustion roar is noise that comes and goes with each cylinder's
 *   breath; the gearbox and final drives whine.
 * - The tracks are a rumble through the floor, each side's links striking
 *   a set of resonances (left and right on their own sides), the tracks
 *   groaning and scrubbing as they strain in a hard turn, and dry pins
 *   squeaking now and then (`squeak`).
 * - The traverse is a motor's whine, a gear train's growl and the ring's
 *   rumble; the handwheels' gears tick.
 * - A placed sound comes partly from its place in the tank (head-related
 *   panning against the listener, the player's head) and partly from all
 *   round, through the cabin's echo, which every sound goes through.
 * - For a moment after the gun fires, the steady sounds dip.
 *
 * Everything passes the duck (the intercom), the player's level, and a
 * soft clip so the gun over a roaring engine doesn't crackle.
 */
export class TankSoundGraph {
  readonly master: GainNode;
  readonly duck: GainNode;
  private readonly buffers = {} as Record<SoundId, AudioBuffer>;
  private readonly cabin: ConvolverNode;
  private readonly shotSend: GainNode;
  private readonly places = {} as Record<SoundPlace | 'all', Place>;
  private readonly white: AudioBuffer;
  private readonly brown: AudioBuffer;
  private whiteAt = 0;

  private readonly engineLoop: AudioBufferSourceNode;
  private readonly engineBreath: AudioBufferSourceNode;
  private readonly exhaust: BiquadFilterNode[];
  private readonly engineAmp: GainNode;
  private readonly roarAmp: GainNode;
  private readonly gearboxOsc: OscillatorNode;
  private readonly gearboxAmp: GainNode;
  private readonly finalOsc: OscillatorNode;
  private readonly finalAmp: GainNode;
  private readonly rumbleFilter: BiquadFilterNode;
  private readonly rumbleAmp: GainNode;
  private readonly linkGate: Record<'left' | 'right', AudioBufferSourceNode>;
  private readonly linkAmp: Record<'left' | 'right', GainNode>;
  private readonly linkRing: Record<'left' | 'right', GainNode>;
  private readonly linkTop: Record<'left' | 'right', GainNode>;
  private readonly linkThud: Record<'left' | 'right', GainNode>;
  private readonly gritGate: Record<'left' | 'right', AudioBufferSourceNode>;
  private readonly gritGrain: Record<'left' | 'right', GainNode>;
  private readonly gritBand: Record<'left' | 'right', BiquadFilterNode>;
  private readonly gritAmp: Record<'left' | 'right', GainNode>;
  private readonly strainGate: Record<'left' | 'right', AudioBufferSourceNode>;
  private readonly strainScrub: Record<'left' | 'right', BiquadFilterNode>;
  private readonly strainAmp: Record<'left' | 'right', GainNode>;
  private readonly squeaks: AudioBuffer[] = [];
  private readonly motor: OscillatorNode;
  private readonly motorAmp: GainNode;
  private readonly mesh: OscillatorNode;
  private readonly traverseGearAmp: GainNode;
  private readonly traverseRumbleAmp: GainNode;
  private readonly tickGate: AudioBufferSourceNode;
  private readonly handAmp: GainNode;
  private readonly grindAmp: GainNode;
  private readonly crankAmp: GainNode;
  private readonly siren: OscillatorNode;
  private readonly sirenAmp: GainNode;
  private readonly at: [number, number, number] = [0, 0, 0];

  constructor(
    readonly ctx: BaseAudioContext,
    level: number,
  ) {
    const rate = ctx.sampleRate;
    for (const id of SOUND_IDS) this.buffers[id] = this.buffer(renderSound(id, rate));
    this.white = this.buffer(renderNoiseLoop('white', rate, 3));
    this.brown = this.buffer(renderNoiseLoop('brown', rate, 2));

    // Out: the duck, the player's level, and a soft clip (straight up to 0.7, bending over to 1 by twice full scale).
    const clip = new WaveShaperNode(ctx, { curve: softClip(), oversample: 'none' });
    const pre = new GainNode(ctx, { gain: 0.5 });
    this.master = new GainNode(ctx, { gain: level });
    this.master.connect(pre).connect(clip).connect(ctx.destination);
    this.duck = new GainNode(ctx, { gain: 1 });
    this.duck.connect(this.master);

    // The cabin's echo.
    const impulse = ctx.createBuffer(2, Math.round(CABIN_SECONDS * rate), rate);
    impulse.copyToChannel(renderCabinImpulse(rate, 0), 0);
    impulse.copyToChannel(renderCabinImpulse(rate, 1), 1);
    this.cabin = new ConvolverNode(ctx, { buffer: impulse, disableNormalization: true });
    this.cabin.connect(this.duck);
    this.shotSend = new GainNode(ctx, { gain: CABIN_SEND.shot - CABIN_SEND.blows });
    this.shotSend.connect(this.cabin);

    this.places.all = this.place(null, CABIN_SEND.hull);
    this.places.engine = this.place('engine', CABIN_SEND.engine);
    this.places.gearbox = this.place('gearbox', CABIN_SEND.engine);
    this.places.leftTrack = this.place('leftTrack', CABIN_SEND.tracks);
    this.places.rightTrack = this.place('rightTrack', CABIN_SEND.tracks);
    this.places.siren = this.place('siren', 0);
    this.places.breech = this.place('breech', CABIN_SEND.turret);
    this.places.bin = this.place('bin', CABIN_SEND.turret);
    this.places.traverse = this.place('traverse', CABIN_SEND.turret);

    // The engine's exhaust: the firing loop through the silencers and the hull (two low-passes that open with
    // the load), the pipes' own resonances, which don't move with the revs, and nothing below what a hull passes.
    this.engineLoop = this.loop(this.buffer(renderEngineLoop(rate)));
    // No engine holds its revs dead steady: it hunts a little, slowly.
    this.waver(this.engineLoop, 0.31, 10);
    this.waver(this.engineLoop, 1.13, 6);
    this.exhaust = [
      new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300, Q: 0.7 }),
      new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300 * EXHAUST_TOP, Q: 0.7 }),
    ];
    const pipe1 = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 115, Q: 1.5, gain: 4 });
    const pipe2 = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 240, Q: 1.5, gain: 5 });
    const floor = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 28, Q: 0.7 });
    this.engineAmp = new GainNode(ctx, { gain: 0 });
    this.engineLoop.connect(this.exhaust[0]).connect(this.exhaust[1]).connect(pipe1).connect(pipe2).connect(floor).connect(this.engineAmp);
    this.engineAmp.connect(this.places.engine.steady);

    // Its roar: noise in the fan's and intakes' band, fluttering as the cylinders blow, through resonances that stay where
    // they are whatever the revs (ROAR_RING: the same bands stand out all through the recording of a real Sherman).
    const roarBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 560, Q: 0.5 });
    const roarTop = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: ROAR_TOP, Q: 0.7 });
    const roarPulse = new GainNode(ctx, { gain: ROAR_STEADY * ROAR_MAKEUP });
    this.engineBreath = this.loop(this.buffer(renderEngineBreath(rate)));
    // In step with the exhaust, so it hunts the same way.
    this.waver(this.engineBreath, 0.31, 10);
    this.waver(this.engineBreath, 1.13, 6);
    this.engineBreath.connect(new GainNode(ctx, { gain: ROAR_BREATH * ROAR_MAKEUP })).connect(roarPulse.gain);
    this.roarAmp = new GainNode(ctx, { gain: 0 });
    let roar: AudioNode = this.noise().connect(roarBand);
    for (const [f, q, gain] of ROAR_RING) roar = roar.connect(new BiquadFilterNode(ctx, { type: 'peaking', frequency: f, Q: q, gain }));
    roar.connect(roarTop).connect(roarPulse).connect(this.roarAmp).connect(this.places.engine.steady);

    // The gears: the gearbox's whine through its case, and the final drives', each wavering a little as real gears do.
    const whine = ctx.createPeriodicWave(new Float32Array(WHINE_HARMONICS.length), new Float32Array(WHINE_HARMONICS));
    this.gearboxOsc = new OscillatorNode(ctx, { periodicWave: whine, frequency: 250 });
    this.waver(this.gearboxOsc, 5.7, 14);
    const gearCase = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 620, Q: 0.8 });
    this.gearboxAmp = new GainNode(ctx, { gain: 0 });
    this.gearboxOsc.connect(gearCase).connect(this.gearboxAmp).connect(this.places.gearbox.steady);
    this.finalOsc = new OscillatorNode(ctx, { periodicWave: whine, frequency: 20 });
    this.waver(this.finalOsc, 3.1, 22);
    const finalTop = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 900, Q: 0.7 });
    this.finalAmp = new GainNode(ctx, { gain: 0 });
    this.finalOsc.connect(finalTop).connect(this.finalAmp).connect(this.places.gearbox.steady);

    // The tracks' rumble: brown noise under a low-pass that opens with speed, through the floor's own resonances,
    // with nothing under what a hull (or a headset's speakers) can pass.
    this.rumbleFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 140, Q: 0.7 });
    const rumbleFloor = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 38, Q: 0.8 });
    const floor1 = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 78, Q: 1.5, gain: 6 });
    const floor2 = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 155, Q: 2, gain: 5 });
    const floor3 = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 245, Q: 2.5, gain: 4 });
    this.rumbleAmp = new GainNode(ctx, { gain: 0 });
    this.loop(this.brown).connect(this.rumbleFilter).connect(rumbleFloor).connect(floor1).connect(floor2).connect(floor3).connect(this.rumbleAmp);
    this.rumbleAmp.connect(this.places.all.steady);

    // Each track's links: a gate opens for each strike of a link (played faster as the track runs faster) and lets
    // noise into resonances that stay where they are, so the links come quicker without turning into a higher note.
    this.linkGate = { left: this.gate(renderGate(LINK_GATE, rate), 0), right: this.gate(renderGate(LINK_GATE, rate), 1.37) };
    this.linkAmp = { left: new GainNode(ctx, { gain: 0 }), right: new GainNode(ctx, { gain: 0 }) };
    // What a track runs on changes how much of each part is heard (src/sim/ground-surface.ts): the links' lower ring,
    // their clink and their thud each have a level of their own, and the ground's own noise plays beside them.
    const sides = () => ({ left: new GainNode(ctx, { gain: 1 }), right: new GainNode(ctx, { gain: 1 }) });
    this.linkRing = sides();
    this.linkTop = sides();
    this.linkThud = sides();
    this.gritGate = { left: this.gate(renderGritGate(rate), 0), right: this.gate(renderGritGate(rate), 2.11) };
    this.gritBand = {
      left: new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1600, Q: GRIT_Q }),
      right: new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1600, Q: GRIT_Q }),
    };
    this.gritAmp = { left: new GainNode(ctx, { gain: 0 }), right: new GainNode(ctx, { gain: 0 }) };
    // A gain's own value adds to what is connected to it: the steady share under the grains.
    this.gritGrain = { left: new GainNode(ctx, { gain: 0 }), right: new GainNode(ctx, { gain: 0 }) };
    for (const side of ['left', 'right'] as const) {
      const out = this.places[side === 'left' ? 'leftTrack' : 'rightTrack'].steady;
      const strike = new GainNode(ctx, { gain: 0 });
      this.linkGate[side].connect(strike.gain);
      this.noise().connect(strike);
      for (const [f, q, share] of LINK_RING) {
        // A narrow band lets less of the noise through: make up for it.
        const ring = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f * (side === 'left' ? 1 : 1.04), Q: q });
        strike
          .connect(ring)
          .connect(new GainNode(ctx, { gain: LINK_RING_LEVEL * share * Math.sqrt(q) }))
          .connect(f > LINK_TOP_FROM ? this.linkTop[side] : this.linkRing[side]);
      }
      this.linkRing[side].connect(this.linkAmp[side]);
      this.linkTop[side].connect(this.linkAmp[side]);
      // Each link also lands as a thud through the floor: slow, a thud a link; fast, the drone of the tracks.
      const thud = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 110, Q: 0.6 });
      this.linkGate[side].connect(thud).connect(new GainNode(ctx, { gain: LINK_THUD })).connect(this.linkThud[side]).connect(this.linkAmp[side]);
      this.linkAmp[side].connect(out);
      // The ground under the links: a grain of noise for each stone crushed or tuft torn, as fast as the links come,
      // in a band that is the ground's own (a low rustle on turf, a bright crunch on stones).
      this.gritGate[side].connect(this.gritGrain[side].gain);
      this.noise().connect(this.gritGrain[side]).connect(this.gritBand[side]).connect(new GainNode(ctx, { gain: GRIT_MAKEUP })).connect(this.gritAmp[side]).connect(out);
    }

    // The tracks straining in a hard turn, each its own share (the outer one most): stick and slip let noise into the
    // steel of the wheels, the guide horns and the links, with a groan through the suspension under it, and the links
    // scrubbing sideways over the ground, in a band below the ground's own crunch.
    this.strainGate = { left: this.gate(renderStrainGate(rate), 0), right: this.gate(renderStrainGate(rate), 1.73) };
    this.strainScrub = {
      left: new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000, Q: 0.8 }),
      right: new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000, Q: 0.8 }),
    };
    this.strainAmp = { left: new GainNode(ctx, { gain: 0 }), right: new GainNode(ctx, { gain: 0 }) };
    for (const side of SIDES) {
      const slip = new GainNode(ctx, { gain: 0 });
      this.strainGate[side].connect(slip.gain);
      this.noise().connect(slip);
      for (const [f, q, share] of STRAIN_RING) {
        const ring = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f * (side === 'left' ? 1 : 1.05), Q: q });
        slip.connect(ring).connect(new GainNode(ctx, { gain: STRAIN_LEVEL * share * Math.sqrt(q) })).connect(this.strainAmp[side]);
      }
      slip.connect(this.strainScrub[side]).connect(new GainNode(ctx, { gain: STRAIN_SCRUB_LEVEL })).connect(this.strainAmp[side]);
      this.strainAmp[side].connect(this.places[side === 'left' ? 'leftTrack' : 'rightTrack'].steady);
    }
    // The pins' squeaks: each played by itself when it comes (`squeak`).
    for (let k = 0; k < SQUEAK_VARIANTS; k++) this.squeaks.push(this.buffer(renderSqueak(rate, k)));

    // The power traverse: its motor, the gear train's growl beating with its teeth, and the ring rumbling round.
    const motorWave = ctx.createPeriodicWave(new Float32Array(MOTOR_HARMONICS.length), new Float32Array(MOTOR_HARMONICS));
    this.motor = new OscillatorNode(ctx, { periodicWave: motorWave, frequency: 110 });
    this.waver(this.motor, 7.3, 10);
    const motorTop = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1500, Q: 0.7 });
    this.motorAmp = new GainNode(ctx, { gain: 0 });
    this.motor.connect(motorTop).connect(this.motorAmp).connect(this.places.traverse.steady);
    const growl = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 420, Q: 1.5 });
    const teeth = new GainNode(ctx, { gain: 0.5 });
    this.mesh = new OscillatorNode(ctx, { type: 'sine', frequency: 8 });
    this.mesh.connect(new GainNode(ctx, { gain: 0.5 })).connect(teeth.gain);
    this.traverseGearAmp = new GainNode(ctx, { gain: 0 });
    this.noise().connect(growl).connect(teeth).connect(this.traverseGearAmp).connect(this.places.traverse.steady);
    const ringLow = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220, Q: 0.7 });
    const ringFloor = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 55, Q: 0.8 });
    this.traverseRumbleAmp = new GainNode(ctx, { gain: 0 });
    this.loop(this.brown, 0.71).connect(ringLow).connect(ringFloor).connect(this.traverseRumbleAmp).connect(this.places.traverse.steady);

    // The handwheels' gears: a tick a tooth.
    this.tickGate = this.gate(renderGate(TICK_GATE, rate), 0);
    const tick = new GainNode(ctx, { gain: 0 });
    this.tickGate.connect(tick.gain);
    this.noise().connect(tick);
    this.handAmp = new GainNode(ctx, { gain: 0 });
    for (const [f, q, share] of [[1300, 4, 0.6], [2800, 3, 1]] as const) {
      tick.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f, Q: q })).connect(new GainNode(ctx, { gain: share * Math.sqrt(q) })).connect(this.handAmp);
    }
    this.handAmp.connect(this.places.traverse.steady);

    // The grind and the starter, looping, let through while they last.
    this.grindAmp = new GainNode(ctx, { gain: 0 });
    this.loop(this.buffers.grind).connect(this.grindAmp).connect(this.places.gearbox.knock);
    this.crankAmp = new GainNode(ctx, { gain: 0 });
    this.loop(this.buffers.crank).connect(this.crankAmp).connect(this.places.engine.knock);

    // The siren: a motor siren's wail, a square wave through a band-pass, gliding up while held (F1.17).
    this.siren = new OscillatorNode(ctx, { type: 'square', frequency: 120 });
    this.sirenAmp = new GainNode(ctx, { gain: 0 });
    const sirenBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 700, Q: 0.8 });
    this.siren.connect(sirenBand).connect(this.sirenAmp).connect(this.places.siren.steady);

    for (const osc of [this.gearboxOsc, this.finalOsc, this.motor, this.mesh, this.siren]) osc.start();
  }

  /** Glide every continuous sound to `v`, from time `t` on the context's clock. */
  apply(v: TankVoices, t: number): void {
    const e = v.engine;
    this.engineLoop.playbackRate.setTargetAtTime(e.rate, t, GLIDE);
    this.engineBreath.playbackRate.setTargetAtTime(e.rate, t, GLIDE);
    this.exhaust[0].frequency.setTargetAtTime(e.cutoff, t, GLIDE);
    this.exhaust[1].frequency.setTargetAtTime(e.cutoff * EXHAUST_TOP, t, GLIDE);
    this.engineAmp.gain.setTargetAtTime(MIX.engine * e.gain, t, GLIDE);
    this.roarAmp.gain.setTargetAtTime(MIX.roar * e.roar, t, GLIDE);
    const d = v.drive;
    this.gearboxOsc.frequency.setTargetAtTime(d.gearboxHz, t, GLIDE);
    this.gearboxAmp.gain.setTargetAtTime(MIX.gearbox * d.gearbox, t, GLIDE);
    this.finalOsc.frequency.setTargetAtTime(d.finalHz, t, GLIDE);
    this.finalAmp.gain.setTargetAtTime(MIX.finalDrive * d.final, t, GLIDE);
    const k = v.tracks;
    this.rumbleFilter.frequency.setTargetAtTime(k.rumbleCutoff, t, GLIDE);
    this.rumbleAmp.gain.setTargetAtTime(MIX.rumble * k.rumble, t, GLIDE);
    for (const side of SIDES) {
      const link = k[side];
      const rate = Math.max(0.01, link.hz / GATE_HZ);
      this.linkGate[side].playbackRate.setTargetAtTime(rate, t, GLIDE);
      this.linkAmp[side].gain.setTargetAtTime(MIX.clatter * link.gain, t, GLIDE);
      this.linkRing[side].gain.setTargetAtTime(link.ring, t, GLIDE);
      this.linkTop[side].gain.setTargetAtTime(link.top, t, GLIDE);
      this.linkThud[side].gain.setTargetAtTime(link.thud, t, GLIDE);
      this.gritGate[side].playbackRate.setTargetAtTime(rate, t, GLIDE);
      this.gritGrain[side].gain.setTargetAtTime(GRIT_STEADY * Math.min(1, link.hz / GRIT_RUN_HZ), t, GLIDE);
      this.gritBand[side].frequency.setTargetAtTime(link.gritHz, t, GLIDE);
      this.gritAmp[side].gain.setTargetAtTime(MIX.grit * link.grit, t, GLIDE);
    }
    for (const side of SIDES) {
      this.strainGate[side].playbackRate.setTargetAtTime(k.judder, t, GLIDE);
      this.strainScrub[side].frequency.setTargetAtTime(k[side].gritHz * STRAIN_SCRUB, t, GLIDE);
      // The strain comes in a little more slowly than the rest: a load building, not a switch.
      this.strainAmp[side].gain.setTargetAtTime(MIX.strain * k[side].strain, t, GLIDE * 2);
    }
    const w = v.traverse;
    this.motor.frequency.setTargetAtTime(w.freq, t, GLIDE);
    this.motorAmp.gain.setTargetAtTime(MIX.whine * w.gain, t, GLIDE);
    this.mesh.frequency.setTargetAtTime(w.meshHz, t, GLIDE);
    this.traverseGearAmp.gain.setTargetAtTime(MIX.traverseGear * w.gear, t, GLIDE);
    this.traverseRumbleAmp.gain.setTargetAtTime(MIX.traverseRumble * w.rumble, t, GLIDE);
    this.tickGate.playbackRate.setTargetAtTime(Math.max(0.01, v.handGear.hz / GATE_HZ), t, GLIDE);
    this.handAmp.gain.setTargetAtTime(MIX.handGear * v.handGear.gain, t, 0.03);
    this.grindAmp.gain.setTargetAtTime(v.grinding ? 1 : 0, t, 0.03);
    this.crankAmp.gain.setTargetAtTime(v.cranking ? 1 : 0, t, 0.04);
    this.siren.frequency.setTargetAtTime(v.siren.freq, t, v.siren.glide);
    this.sirenAmp.gain.setTargetAtTime(MIX.siren * v.siren.gain, t, v.siren.glide);
    for (const name of TURRET_PLACES) {
      const panner = this.places[name].panner!;
      const p = turretToHull(SOUND_PLACES[name], v.turretYaw, this.at);
      panner.positionX.setTargetAtTime(p[0], t, GLIDE);
      panner.positionZ.setTargetAtTime(p[2], t, GLIDE);
    }
  }

  /**
   * Play a short sound at time `at` on the context's clock (for `seconds`,
   * if it is a looped one). A Web Audio source plays once, so this makes
   * one node per sound; they come a few times a second at most. The gun
   * brings its blast with it.
   */
  play(id: SoundId, at: number, seconds = 0): void {
    const source = new AudioBufferSourceNode(this.ctx, { buffer: this.buffers[id], loop: seconds > 0 });
    const from = SOUND_FROM[id];
    source.connect(this.places[from ?? 'all'].knock);
    if (id === 'shot') {
      source.connect(this.shotSend);
      this.blast(at);
    }
    source.start(at);
    if (seconds > 0) source.stop(at + seconds);
  }

  /**
   * A pin squeaking at time `at` on the context's clock: the `variant`th of
   * the rendered squeaks, from the left track (`side` 0) or the right, at
   * `level` (0 to 1, before MIX.squeak). Two nodes a squeak; they come a
   * few times a second at most.
   */
  squeak(side: 0 | 1, variant: number, level: number, at: number): void {
    const source = new AudioBufferSourceNode(this.ctx, { buffer: this.squeaks[variant % this.squeaks.length] });
    source.connect(new GainNode(this.ctx, { gain: MIX.squeak * level })).connect(this.places[side === 0 ? 'leftTrack' : 'rightTrack'].knock);
    source.start(at);
  }

  /** The gun's blast at `at`: the steady sounds drop away and come back. */
  private blast(at: number): void {
    for (const name in this.places) {
      const g = this.places[name as SoundPlace].steady.gain;
      g.setTargetAtTime(BLAST_DIP, at, BLAST_ATTACK);
      g.setTargetAtTime(1, at + BLAST_HOLD, BLAST_RECOVER);
    }
  }

  /** The intercom's duck, linear, from `t`. */
  setDuck(gain: number, t: number): void {
    this.duck.gain.setTargetAtTime(gain, t, 0.02);
  }

  /** The player's Tank sounds setting, from `t`. */
  setLevel(level: number, t: number): void {
    this.master.gain.setTargetAtTime(level, t, 0.05);
  }

  /** Where the player's head is and which way it faces, in the hull's space, from `t`. Allocation free. */
  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number, t: number): void {
    const l = this.ctx.listener;
    if (l.positionX == null) {
      // An older browser's listener has no parameters to glide.
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
      return;
    }
    l.positionX.setTargetAtTime(px, t, 0.02);
    l.positionY.setTargetAtTime(py, t, 0.02);
    l.positionZ.setTargetAtTime(pz, t, 0.02);
    l.forwardX.setTargetAtTime(fx, t, 0.02);
    l.forwardY.setTargetAtTime(fy, t, 0.02);
    l.forwardZ.setTargetAtTime(fz, t, 0.02);
    l.upX.setTargetAtTime(ux, t, 0.02);
    l.upY.setTargetAtTime(uy, t, 0.02);
    l.upZ.setTargetAtTime(uz, t, 0.02);
  }

  /**
   * Somewhere sounds come from. PLACED_SHARE of what goes in is heard from
   * `name`'s spot in the tank (no quieter for being further: the cabin is
   * small); `send` of the steady sounds and CABIN_SEND.knocks of the knocks
   * (CABIN_SEND.blows of those from nowhere in particular) go through the cabin's echo, which is how the rest reaches the crew,
   * from all round. Nothing placed is also played straight: the browser's
   * head-related panning comes out about 6 ms late, and the two together
   * would cancel every 160 Hz up the scale (a hollow, pipe-like sound that
   * sweeps as the head turns).
   */
  private place(name: SoundPlace | null, send: number): Place {
    const ctx = this.ctx;
    const steady = new GainNode(ctx, { gain: 1 });
    const knock = new GainNode(ctx, { gain: 1 });
    const sum = new GainNode(ctx, { gain: 1 });
    steady.connect(sum);
    knock.connect(sum);
    if (send > 0) steady.connect(new GainNode(ctx, { gain: send })).connect(this.cabin);
    knock.connect(new GainNode(ctx, { gain: name == null ? CABIN_SEND.blows : CABIN_SEND.knocks })).connect(this.cabin);
    if (name == null) {
      sum.connect(this.duck);
      return { steady, knock, panner: null };
    }
    const [x, y, z] = SOUND_PLACES[name];
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'linear',
      rolloffFactor: 0,
      positionX: x,
      positionY: y,
      positionZ: z,
    });
    sum.connect(panner).connect(new GainNode(ctx, { gain: PLACED_SHARE })).connect(this.duck);
    return { steady, knock, panner };
  }

  private buffer(samples: Float32Array<ArrayBuffer>): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  /** A buffer playing round and round from the start, beginning `offset` s in. */
  private loop(buffer: AudioBuffer, offset = 0): AudioBufferSourceNode {
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true });
    source.start(0, offset);
    return source;
  }

  /** White noise, each user of it starting somewhere else in the loop so no two hear the same noise. */
  private noise(): AudioBufferSourceNode {
    this.whiteAt = (this.whiteAt + 0.377) % 3;
    return this.loop(this.white, this.whiteAt);
  }

  /** A gate loop (src/sim/sound-render.ts) playing round and round. */
  private gate(samples: Float32Array<ArrayBuffer>, offset: number): AudioBufferSourceNode {
    return this.loop(this.buffer(samples), offset);
  }

  /** Make an oscillator's (or a loop's) pitch waver by `cents` at `hz`. */
  private waver(osc: OscillatorNode | AudioBufferSourceNode, hz: number, cents: number): void {
    const lfo = new OscillatorNode(this.ctx, { type: 'sine', frequency: hz });
    lfo.connect(new GainNode(this.ctx, { gain: cents })).connect(osc.detune);
    lfo.start();
  }
}

/** The soft clip's curve, for inputs from −2 to 2: straight up to 0.7, then bending over towards 1. */
function softClip(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
  }
  return curve;
}
