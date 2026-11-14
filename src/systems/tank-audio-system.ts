import { createSystem, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { onSettingChange } from '../live-settings.js';
import { settings } from '../settings.js';
import { demandOf, NEUTRAL } from '../sim/gearbox.js';
import { groundLine, TankFooting, type Footing, type Surface } from '../sim/ground-surface.js';
import { CASING_FLIGHT, RECOIL } from '../sim/loading.js';
import {
  createCues,
  createSqueak,
  createTourState,
  type CueState,
  driveVoice,
  Ducker,
  engineVoice,
  handGearVoice,
  SOUND_IDS,
  SoundCues,
  type SoundId,
  SqueakTimer,
  sirenVoice,
  soundTour,
  TOUR_SECONDS,
  trackVoice,
  traverseVoice,
} from '../sim/tank-audio.js';
import { angleDelta, ELEVATION_PER_TURN } from '../sim/turret.js';
import { shownDriverControls, shownDriverState } from './drive-system.js';
import { shotListeners } from './firing-system.js';
import { loadingShown } from './loading-system.js';
import { netLink } from './net-system.js';
import { createTankVoices, TankSoundGraph } from './tank-sound-graph.js';
import { turretState } from './turret-system.js';

/** The continuous sounds follow the tank this often, Hz (Web Audio glides between). */
const PARAM_HZ = 20;
/** How quickly the engine's sound follows the throttle, and the handwheels' ticking follows the hands, s (time constants). */
const LOAD_SECONDS = 0.12;
const HAND_SECONDS = 0.08;
/** A handwheel can't be turned faster than this, turns a second: anything more is the turret being put somewhere, not turned. */
const MAX_HAND_TURNS = 4;
/** Practice → Tank sounds → Play each: the sounds in turn, s apart, and how long the grind runs. */
const PLAY_EACH: readonly SoundId[] = ['clunk', 'grind', 'ram', 'breech', 'shot', 'latch', 'bump', 'crank', 'catch', 'cough', 'stall'];
const PLAY_EACH_GAP = 1.1;
const PLAY_EACH_GRIND = 1;

let active: TankAudioSystem | null = null;

/** Practice → Tank sounds → Play each: every short sound in turn, so a headset check can hear them without driving or loading. */
/** Play one of the tank's short sounds now (F3.2: an enemy shell striking the hull rings it as a bump does). */
export function playTankSound(id: SoundId): void {
  active?.playNow(id);
}

export function playEachSound(): void {
  active?.playEach();
}

/** Practice → Tank sounds → Run through: the engine, tracks, traverse and handwheels put through their paces for TOUR_SECONDS, without driving or laying the gun. */
export function playSoundTour(): void {
  active?.startTour();
}

/** One line for the menu: whether sound plays, and the duck. */
export function audioStatus(): string {
  return active?.status() ?? '';
}

interface AudioDebug {
  state(): {
    context: string;
    sound: number;
    /** One bank of the engine's firing beat, Hz, its exhaust's level and its roar. */
    engineHz: number;
    engineGain: number;
    roar: number;
    /** How far the throttle is open as the sounds have it, 0 to 1. */
    load: number;
    /** The gears' whine: the gearbox's and the final drives'. */
    gearbox: number;
    finalDrive: number;
    rumble: number;
    clatterHz: number;
    /** Each track's links a second. */
    leftHz: number;
    rightHz: number;
    /** The sideways push on the tracks, m/s², how hard it strains them (0 to 1) and each track's share. */
    side: number;
    strain: number;
    strainSides: Record<'left' | 'right', number>;
    /** How many pins squeak a second on average now, and how many have squeaked on this page so far. */
    squeakRate: number;
    squeaks: number;
    /** What each track is on (src/sim/ground-surface.ts): the surface most of it is on, the share of its length on each (in SURFACES' order), and what that makes of its clink, the ground's own noise and the rumble. */
    ground: Record<'left' | 'right', Surface>;
    groundShares: Record<'left' | 'right', number[]>;
    top: Record<'left' | 'right', number>;
    grit: Record<'left' | 'right', number>;
    gritHz: Record<'left' | 'right', number>;
    rumbleCutoff: number;
    /** The power traverse's whine, and the handwheels' ticks a second. */
    whine: number;
    handHz: number;
    grinding: boolean;
    /** The starter cranking, and the siren's level (F1.17). */
    cranking: boolean;
    siren: number;
    /** The sound tour is running (Practice → Tank sounds → Run through). */
    tour: boolean;
    duckDb: number;
    /** The duck's gain as the audio graph has it now, linear: what the player hears, not just what the duck worked out. */
    duckGain: number;
    speaking: boolean;
    /** Where the sounds are heard from: the player's head in the hull's space. */
    ear: [number, number, number];
    /** Each short sound played (or sent to play) so far on this page. */
    heard: Record<SoundId, number>;
  };
  playEach(): void;
  /** Start the run through (or stop it), `from` s in, held there if `hold`: the tests skip to the moment they check, however slow the frames. */
  tour(from?: number, hold?: boolean): void;
  /** RMS of what the tank sounds put out right now (after the duck and the Tank sounds setting), 0 to 1: a meter added on first use, for the tests. */
  outputLevel(): number;
}

/**
 * The tank's sounds (F1.12, rebuilt in F6.1; docs/audio.md), synthesised
 * with Web Audio by TankSoundGraph from the rules in src/sim/tank-audio.ts
 * and the samples in src/sim/sound-render.ts, no sample files:
 *
 * - the engine from the RPM and the throttle (the A57 multibank's burble,
 *   its roar, the gearbox's and final drives' whine), each track's rumble,
 *   clatter from its speed, the tracks straining in a hard turn at speed
 *   (the sideways push that also warns of a thrown track), the pins
 *   squeaking now and then, the power traverse from the turret's turn and the handwheels' ticking from the gunner's hands;
 * - short sounds rendered once at load: gears going in and grinding, the
 *   hull bumping, a shell rammed, the breech slamming shut or opened by
 *   hand, the gun (with the breech flying open) and the casing landing in
 *   the bin half a second later; the starter cranking, the engine
 *   catching, coughing and stalling (F1.17);
 * - the siren while the driver holds its button (F1.17), heard on both pages.
 *
 * Each page plays the tank as it draws it (shownDriverState, the turret,
 * the loading as drawn, and every shot through `shotListeners`), so both
 * crew hear the same tank with nothing more sent. Each sound comes from
 * its place in the tank relative to the player's head, and through the
 * cabin's echo. Everything goes through one bus that drops 12 dB while
 * either player speaks (the voice analysers, `netLink.micLevel` and
 * `crewLevel`), then the player's Tank sounds setting. The voice itself
 * plays outside it, plain like an intercom.
 *
 * Browsers start audio only after a click or Enter VR; the context
 * suspends while the page is hidden or the setting is Off. The practice
 * crewmate's page makes no sound.
 */
export class TankAudioSystem extends createSystem({}) {
  private ctx: AudioContext | null = null;
  private graph: TankSoundGraph | null = null;
  private readonly voices = createTankVoices();
  private readonly tour = createTourState();
  private tourAt = Number.NEGATIVE_INFINITY;
  /** The tests can hold the tour at one moment (`__audio.tour(from, true)`). */
  private tourHeld: number | null = null;
  private load = 0;
  private handTurns = { crank: 0, wheel: 0 };
  private lastCrank = Number.NaN;
  private lastElevation = Number.NaN;
  private readonly ducker = new Ducker();
  private readonly cues = new SoundCues();
  private readonly cueOut = createCues();
  private readonly cueState: CueState = { gear: 0, grinding: false, bumps: 0, lever: 0, rammed: false, running: true, stalls: 0, coughs: 0 };
  private readonly squeakTimer = new SqueakTimer();
  private readonly squeakOut = createSqueak();
  private squeakCount = 0;
  private readonly heard = Object.fromEntries(SOUND_IDS.map((id) => [id, 0])) as Record<SoundId, number>;
  private paramClock = 0;
  /** What each track is on: the tank's own footing, or the sound tour's while it runs. */
  private readonly footing = new TankFooting();
  private leftGround: Footing = this.footing.left;
  private rightGround: Footing = this.footing.right;
  private time = 0;
  private shotAt = Number.NEGATIVE_INFINITY;
  private hidden = false;
  private readonly ear = new Vector3();
  private readonly earTurn = new Quaternion();
  private readonly earScale = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

  init(): void {
    active = this;
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
    });
    const self = this;
    (window as unknown as { __audio: AudioDebug }).__audio = {
      state: () => {
        const v = self.voices;
        return {
          context: self.ctx?.state ?? 'none',
          sound: settings.sound,
          engineHz: v.engine.freq,
          engineGain: v.engine.gain,
          roar: v.engine.roar,
          load: self.load,
          gearbox: v.drive.gearbox,
          finalDrive: v.drive.final,
          rumble: v.tracks.rumble,
          clatterHz: v.tracks.clatterHz,
          leftHz: v.tracks.left.hz,
          rightHz: v.tracks.right.hz,
          side: v.tracks.side,
          strain: v.tracks.strain,
          strainSides: { left: v.tracks.left.strain, right: v.tracks.right.strain },
          squeakRate: v.tracks.squeaks,
          squeaks: self.squeakCount,
          ground: { left: self.leftGround.surface, right: self.rightGround.surface },
          groundShares: { left: [...self.leftGround.shares], right: [...self.rightGround.shares] },
          top: { left: v.tracks.left.top, right: v.tracks.right.top },
          grit: { left: v.tracks.left.grit, right: v.tracks.right.grit },
          gritHz: { left: v.tracks.left.gritHz, right: v.tracks.right.gritHz },
          rumbleCutoff: v.tracks.rumbleCutoff,
          whine: v.traverse.gain,
          handHz: v.handGear.hz,
          grinding: v.grinding,
          cranking: v.cranking,
          siren: v.siren.gain,
          tour: self.touring(),
          duckDb: self.ducker.db,
          duckGain: self.graph ? self.graph.duck.gain.value : 1,
          speaking: self.ducker.speaking,
          ear: [self.ear.x, self.ear.y, self.ear.z],
          heard: { ...self.heard },
        };
      },
      playEach: () => self.playEach(),
      tour: (from?: number, hold?: boolean) => self.startTour(from, hold),
      outputLevel: () => self.outputLevel(),
    };
    // The practice crewmate's PC page stays quiet: it would only echo the headset's tank.
    if (settings.bot || typeof AudioContext === 'undefined') return;
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      engineVoice(800, 0, this.voices.engine);
      this.graph = new TankSoundGraph(this.ctx, settings.sound);
    } catch (error) {
      this.ctx = null;
      this.graph = null;
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

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    this.time += dt;
    const ctx = this.ctx;
    const s = shownDriverState();
    const controls = shownDriverControls();
    const turret = turretState();
    const loading = loadingShown();
    const v = this.voices;

    // How fast the gunner's handwheels are turning, from the turret as drawn.
    if (delta > 0) {
      // Over the frame's real length, however slow the frame: a slow frame is no faster a hand.
      const crank = Number.isNaN(this.lastCrank) ? 0 : Math.abs(angleDelta(this.lastCrank, turret.crank)) / (2 * Math.PI) / delta;
      const wheel = Number.isNaN(this.lastElevation) ? 0 : Math.abs(turret.elevation - this.lastElevation) / ELEVATION_PER_TURN / delta;
      const follow = 1 - Math.exp(-dt / HAND_SECONDS);
      this.handTurns.crank += ((crank > MAX_HAND_TURNS ? 0 : crank) - this.handTurns.crank) * follow;
      this.handTurns.wheel += ((wheel > MAX_HAND_TURNS ? 0 : wheel) - this.handTurns.wheel) * follow;
      this.lastCrank = turret.crank;
      this.lastElevation = turret.elevation;
    }

    if (this.touring()) {
      // Practice → Tank sounds → Run through: the tour's tank in place of the real one.
      const tour = soundTour(this.tourTime(), this.tour);
      this.load = tour.load;
      engineVoice(tour.rpm, tour.load, v.engine);
      driveVoice(tour.rpm, (tour.left + tour.right) / 2, tour.inGear, tour.load, v.drive);
      this.leftGround = tour.leftGround;
      this.rightGround = tour.rightGround;
      trackVoice(tour.left, tour.right, v.tracks, tour.leftGround, tour.rightGround);
      traverseVoice(tour.traverse, v.traverse);
      handGearVoice(tour.crank, tour.wheel, v.handGear);
      v.grinding = v.cranking = false;
    } else {
      if (s) {
        const asked = s.running && controls ? demandOf(controls) : 0;
        this.load += (asked - this.load) * (1 - Math.exp(-dt / LOAD_SECONDS));
        engineVoice(s.rpm, this.load, v.engine);
        driveVoice(s.rpm, (s.leftTrack + s.rightTrack) / 2, s.gear !== NEUTRAL, this.load, v.drive);
        // What each track is on, from where the tank is drawn: the same on both pages, with nothing sent.
        this.footing.update(s.x, s.z, s.heading);
        this.leftGround = this.footing.left;
        this.rightGround = this.footing.right;
        // The sideways push as the drive works it out (a turn's, a slope's lean, more on mud): what strains the
        // tracks and, past THROW_WARN, puts up the sign (src/sim/going.ts).
        trackVoice(s.leftTrack, s.rightTrack, v.tracks, this.leftGround, this.rightGround, s.side);
        v.grinding = s.grinding;
        v.cranking = s.cranking;
      }
      traverseVoice(turret.rate, v.traverse);
      handGearVoice(this.handTurns.crank, this.handTurns.wheel, v.handGear);
    }
    sirenVoice(controls?.siren ?? false, v.siren);
    v.turretYaw = turret.yaw;
    const duck = this.ducker.step(netLink.micLevel(), netLink.crewLevel(), dt);

    // The short sounds this frame's changes make.
    const c = this.cueState;
    c.gear = s?.gear ?? 0;
    c.grinding = s?.grinding ?? false;
    c.bumps = s?.bumps ?? 0;
    c.lever = loading?.lever ?? 0;
    c.rammed = loading?.rammed ?? false;
    c.running = s?.running ?? true;
    c.stalls = s?.stalls ?? 0;
    c.coughs = s?.coughs ?? 0;
    const cues = this.cues.step(c, this.time - this.shotAt, this.cueOut);
    // Now and then a pin squeaks: at random, over the frame's real length (one at most a frame), so a slow frame
    // doesn't thin them out.
    if (this.squeakTimer.step(Math.min(delta, 1), v.tracks, this.squeakOut)) this.squeakNow();
    if (cues.clunk) this.sound('clunk');
    if (cues.bump) this.sound('bump');
    if (cues.ram) this.sound('ram');
    if (cues.breech) this.sound('breech');
    if (cues.latch) this.sound('latch');
    if (cues.catch) this.sound('catch');
    if (cues.cough) this.sound('cough');
    if (cues.stall) this.sound('stall');

    const graph = this.graph;
    if (ctx == null || graph == null) return;
    // The sounds are heard from the player's head: the tank stays put at the origin, so its world space is the hull's.
    const head = this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera;
    head.updateWorldMatrix(true, false);
    head.matrixWorld.decompose(this.ear, this.earTurn, this.earScale);
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.forward.set(0, 0, -1).applyQuaternion(this.earTurn);
    this.up.set(0, 1, 0).applyQuaternion(this.earTurn);
    graph.setListener(this.ear.x, this.ear.y, this.ear.z, this.forward.x, this.forward.y, this.forward.z, this.up.x, this.up.y, this.up.z, t);

    this.paramClock += dt;
    if (this.paramClock < 1 / PARAM_HZ) return;
    this.paramClock = 0;
    graph.apply(v, t);
    graph.setDuck(duck, t);
  }

  /** The gun fired on either page: the report now, the casing landing in the bin as it gets there. */
  private onShot(): void {
    this.shotAt = this.time;
    this.sound('shot');
    this.sound('casing', RECOIL.back + CASING_FLIGHT);
  }

  /** A pin squeaking now (counted even while the context is suspended, for the tests). */
  private squeakNow(): void {
    this.squeakCount++;
    const ctx = this.ctx;
    if (ctx == null || this.graph == null || ctx.state !== 'running') return;
    const q = this.squeakOut;
    this.graph.squeak(q.side, q.variant, q.level, ctx.currentTime);
  }

  /** Play a short sound `delay` s from now (counted even while the context is suspended, for the tests). */
  playNow(id: SoundId): void {
    this.sound(id);
  }

  private sound(id: SoundId, delay = 0, seconds = 0): void {
    this.heard[id]++;
    const ctx = this.ctx;
    if (ctx == null || this.graph == null || ctx.state !== 'running') return;
    this.graph.play(id, ctx.currentTime + delay, seconds);
  }

  private meter: AnalyserNode | null = null;
  private meterData: Float32Array<ArrayBuffer> | null = null;

  private outputLevel(): number {
    if (!this.ctx) return 0;
    if (!this.meter) {
      this.meter = new AnalyserNode(this.ctx, { fftSize: 4096 });
      this.meterData = new Float32Array(this.meter.fftSize);
      this.graph!.master.connect(this.meter);
    }
    const data = this.meterData!;
    this.meter.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  playEach(): void {
    console.info('[Audio] Practice: play each sound');
    PLAY_EACH.forEach((id, i) => this.sound(id, 0.2 + i * PLAY_EACH_GAP, id === 'grind' || id === 'crank' ? PLAY_EACH_GRIND : 0));
    this.sound('casing', 0.2 + PLAY_EACH.indexOf('shot') * PLAY_EACH_GAP + RECOIL.back + CASING_FLIGHT);
  }

  /** Practice → Tank sounds → Run through: pressed again while it runs, it stops. */
  startTour(from = 0, hold = false): void {
    const stop = this.touring();
    console.info(`[Audio] Practice: run through the continuous sounds${stop ? ' stopped' : from > 0 ? ` from ${from} s${hold ? ', held' : ''}` : ''}`);
    this.tourAt = stop ? Number.NEGATIVE_INFINITY : performance.now() - from * 1000;
    this.tourHeld = !stop && hold ? from : null;
  }

  /** How far into the tour, s, by the clock on the wall: it runs at its own pace however slow the frames. */
  private tourTime(): number {
    if (this.tourHeld != null) return this.tourHeld;
    return (performance.now() - this.tourAt) / 1000;
  }

  private touring(): boolean {
    return this.tourTime() < TOUR_SECONDS;
  }

  status(): string {
    if (settings.bot) return "The practice crewmate's page makes no sound.";
    const ctx = this.ctx;
    if (ctx == null) return 'No sound: this browser has no Web Audio.';
    if (settings.sound === 0) return 'Tank sounds off (Sound and view).';
    if (ctx.state !== 'running') return 'Sound starts with a click or Enter VR.';
    const duck = this.ducker.speaking ? `ducked ${this.ducker.db.toFixed(0)} dB for the intercom` : 'nobody speaking';
    const tour = this.touring() ? `run through ${Math.ceil(TOUR_SECONDS - this.tourTime())} s to go, ` : '';
    return `Sound on: ${tour}engine ${this.voices.engine.freq.toFixed(0)} Hz, tracks on ${groundLine(this.leftGround.surface, this.rightGround.surface)}, ${duck}.`;
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
    if (ctx == null || this.graph == null) return;
    this.graph.setLevel(settings.sound, ctx.currentTime);
    if (settings.sound === 0) {
      void ctx.suspend();
    } else {
      this.resume();
    }
    console.info(`[Audio] tank sounds ${settings.sound === 0 ? 'off' : settings.sound < 1 ? 'quiet' : 'on'}`);
  }
}
