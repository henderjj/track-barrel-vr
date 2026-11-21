import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { phaseCue, type VoiceCue } from '../sim/commander-voice.js';
import { crewLog } from '../sim/crew-board.js';
import { routeOf } from '../sim/enemy-guns.js';
import { routePose, type RoutePose } from '../sim/enemy-tanks.js';
import {
  HILL,
  HILL_BRIEFING,
  hillDebrief,
  hillEnemy,
  hillLine,
  HillRun,
  type HillInput,
  type HillSnapshot,
  HOLD_CALLS,
  type HoldView,
  holdView,
  noHill,
  parseHill,
} from '../sim/hill.js';
import { wrapTile } from '../sim/terrain.js';
import { shownScenario, stopScenario } from './combat-system.js';
import { damageState, repairTank } from './damage-system.js';
import { placeTank, resetTank, tankState } from './drive-system.js';
import { shownEscort, stopEscort } from './escort-system.js';
import { beginAttack, bringEnemy, enemyArrived, enemyShared, enemyShotsFired, enemySpotted, enemyView, holdEnemyFire, startBattle } from './enemy-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { setAmmoRack } from './loading-system.js';
import { netLink } from './net-system.js';

/** The host sends the run again this often while it runs, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
/** How long the briefing, a wave's call and the debrief stay on the sign, s. */
const BRIEF_SECONDS = 8;
const DEBRIEF_SECONDS = 15;

let active: HillSystem | null = null;

/** The hill as this page shows it (F5.9). */
export function shownHill(): Readonly<HillSnapshot> {
  return active?.shown ?? noHill();
}

/** One line for the menu: the run's state, or its debrief. */
export function hillStatus(): string {
  return hillLine(shownHill());
}

/** Missions → Hold the hill → Start (or Restart). The host does it; a guest asks. */
export function startHill(): void {
  if (!netLink.isHost) {
    const event = { t: 'hill-ask', start: true };
    netLink.sendEvent(event);
    return;
  }
  active?.start();
}

/** The crew marched to the hill's start (F2.12b, Missions → Hold the hill → March): the run begins where the tank stands. Host only. */
export function beginHillInPlace(): void {
  if (netLink.isHost) active?.start(true);
}

/** Missions → Hold the hill → Stop: the enemy goes. */
export function stopHill(): void {
  if (!netLink.isHost) {
    const event = { t: 'hill-ask', stop: true };
    netLink.sendEvent(event);
    return;
  }
  active?.stop();
}

/** Missions → Hold the hill → Hull down: the tank parked at the hull-down spot behind the crest, facing north (a headset check's shortcut). */
export function hullDownPractice(): void {
  placeTank(HILL.startX, HILL.hullDownZ, 0);
}

interface HillDebug {
  state(): HillSnapshot;
  start(): void;
  stop(): void;
  hullDown(): void;
  /** Host: the run's clock on to the next wave's time (tests: the emulator's frames are slow). */
  nextWave(): void;
  /** Where the tank stands as the commander would judge it now (host). */
  view(): HoldView;
  readonly sign: string;
}

/**
 * "Hold the hill" (F5.9, docs/hold-the-hill.md). The host runs it: the tank
 * on the hill's reverse slope, mended and warm with a rack of AP, the
 * battery begun afresh with the scenario's seed, each wave's attackers
 * brought in when it is due, and the run judged each frame (every attacker
 * knocked out, the tank knocked out, or an attacker at the hill's foot).
 * Halted on the hill, the commander tells the driver where the tank stands
 * (hull down, hull showing, the gun masked), judged from the nearest
 * attacker. It sends the run to the guest (`hill`, reliable) and takes a
 * guest's asks (`hill-ask`). Both pages show the briefing, the waves and
 * the debrief on a sign and the board. The Battle tab's tuning applies.
 * Registered after CombatSystem: starting either stops the other.
 */
export class HillSystem extends createSystem({}) {
  readonly run = new HillRun();
  /** What this page shows: the host's run; a guest's as last told. */
  shown: HillSnapshot = noHill();
  private time = 0;
  private sentV = -1;
  private sentAt = 0;
  private wasConnected = false;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private lastPhase: HillSnapshot['phase'] = 'off';
  private lastWave = 0;
  private lastView: HoldView = 'off';
  /** Host: how long the tank has stood still, s. */
  private stillFor = 0;
  private pose: RoutePose = { x: 0, z: 0, heading: 0 };
  private readonly fight: HillInput = {
    out: false,
    spotted: false,
    killed: 0,
    arrived: false,
    seen: 'none',
    shots: 0,
    hits: 0,
    through: 0,
    view: 'off',
    halted: false,
  };

  init(): void {
    active = this;
    this.sign = new FloatingSign('Hill Sign', 0.95, [640, 150], 1.1, -0.06);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.events.set('hill', (e) => {
      if (netLink.isHost) return;
      const s = parseHill(e);
      if (s) this.show(s);
    });
    netLink.events.set('hill-ask', (e) => {
      if (!netLink.isHost) return;
      const ask = e as { start?: unknown; stop?: unknown };
      if (ask.start === true) this.start();
      else if (ask.stop === true) this.stop();
    });
    this.cleanupFuncs.push(
      () => netLink.events.delete('hill'),
      () => netLink.events.delete('hill-ask'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __hill: HillDebug }).__hill = {
      state: () => ({ ...self.shown }),
      start: () => startHill(),
      stop: () => stopHill(),
      hullDown: () => hullDownPractice(),
      nextWave: () => {
        const s = self.run.snap;
        if (!netLink.isHost || s.phase !== 'on') return;
        s.time = Math.max(s.time, s.wave === 0 ? HILL.firstWave : HILL.secondWave);
      },
      view: () => self.judge(),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
  }

  /**
   * Host: start the run afresh: the advance to contact stopped, the tank on
   * the reverse slope, the battery begun with nothing in yet. `inPlace`: the
   * crew marched there (F2.12b): the tank stays as it came, running.
   */
  start(inPlace = false): void {
    if (!netLink.isHost) return;
    // The advance to contact gives way, its debrief too (the board shows one fight's).
    if (shownScenario().phase !== 'off') stopScenario();
    // So does the convoy escort (F5.8): both are fights with the one battery.
    if (shownEscort().phase !== 'off') stopEscort();
    if (!inPlace) {
      repairTank();
      resetTank('warm');
      placeTank(HILL.startX, HILL.startZ, 0);
    }
    setAmmoRack('ap');
    beginAttack(HILL.seed);
    this.run.start();
    this.stillFor = 0;
    this.publish();
    console.info('[Hill] started');
  }

  /** Host: stop it: the enemy goes. */
  stop(): void {
    if (!netLink.isHost) return;
    const was = this.run.snap.phase;
    this.run.stop();
    if (was !== 'off') startBattle(false);
    this.publish();
    console.info('[Hill] stopped');
  }

  /** Host: where the tank stands, as the nearest attacker in (or the road north of the hill, before any) sees it. */
  private judge(): HoldView {
    const t = tankState();
    const shared = enemyShared();
    let best = Infinity;
    let fromX: number = HILL.lookFrom[0];
    let fromZ: number = HILL.lookFrom[1];
    for (const k of HILL.waves.flat()) {
      const i = hillEnemy(k);
      const route = routeOf(i);
      if (!route || !shared.present[i] || !shared.alive[i]) continue;
      routePose(route, shared.d[i], this.pose);
      const dx = wrapTile(this.pose.x - t.x);
      const dz = wrapTile(this.pose.z - t.z);
      const d = Math.hypot(dx, dz);
      if (d < best) {
        best = d;
        fromX = t.x + dx;
        fromZ = t.z + dz;
      }
    }
    return holdView(t, fromX, fromZ);
  }

  /** Host: show the run here (the guest is told in update). */
  private publish(): void {
    this.show({ ...this.run.snap });
  }

  /** Take the run as the host has it: a change of phase, wave or the tank's place puts a note on the sign and the board. */
  private show(s: HillSnapshot): void {
    const was = this.lastPhase;
    const wave = this.lastWave;
    const view = this.lastView;
    this.shown = s;
    this.lastPhase = s.phase;
    this.lastWave = s.wave;
    this.lastView = s.view;
    if (s.phase !== was) {
      if (s.phase === 'on') this.note(HILL_BRIEFING[0], HILL_BRIEFING[1], BRIEF_SECONDS, false);
      else if (s.phase === 'won' || s.phase === 'lost') {
        const [head, counts] = hillDebrief(s);
        // The commander's "Bail out!" is for a knock-out only; overrun, the board says it.
        this.note(head, counts, DEBRIEF_SECONDS, s.phase === 'lost', s.loss === 'overrun' ? undefined : phaseCue(s.phase, false));
        console.info(`[Hill] debrief: ${head}. ${counts}`);
      }
      return;
    }
    if (s.phase !== 'on') return;
    // The first wave's coming is the enemy's own call (EnemySystem); the second's is ours.
    if (s.wave > wave && s.wave > 1) this.note('Two more tanks coming', 'From the east and the west, turning in at the ends of the hill', BRIEF_SECONDS, false, ['tanks-about']);
    if (s.view !== view && s.view !== 'off') {
      const call = HOLD_CALLS[s.view];
      crewLog.post(call, s.view === 'hull-down' ? 'good' : s.view === 'exposed' ? 'bad' : 'info');
      console.info(`[Hill] ${call}`);
    }
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    if (netLink.isHost) this.host(dt);
    else if (this.shown.phase === 'on' && !(netLink.connected && crewPresence.paused)) this.shown.time += dt;
    this.drawSign(delta);
  }

  /** The host's part: bring the waves, judge the run, and keep the guest told. */
  private host(dt: number): void {
    const paused = netLink.connected && crewPresence.paused;
    const snap = this.run.snap;
    if (snap.phase === 'on' && !paused) {
      const shared = enemyShared();
      // Another fight started over this one (the advance to contact, the convoy escort, a Combat start): it ends quietly.
      if (shownScenario().phase === 'on' || shownEscort().phase === 'on' || (snap.wave > 0 && !HILL.waves.flat().some((k) => shared.present[hillEnemy(k)]))) {
        this.run.stop();
        this.publish();
        console.info('[Hill] stopped: another fight began');
        return;
      }
      const t = tankState();
      this.stillFor = Math.abs(t.speed) < HILL.still ? this.stillFor + dt : 0;
      const f = this.fight;
      f.killed = 0;
      f.arrived = false;
      f.seen = 'none';
      for (const k of HILL.waves.flat()) {
        const i = hillEnemy(k);
        if (!shared.present[i]) continue;
        if (!shared.alive[i]) f.killed++;
        else if (enemyArrived(i)) f.arrived = true;
        const v = enemyView(i);
        if (v === 'full') f.seen = 'full';
        else if (v === 'turret' && f.seen === 'none') f.seen = 'turret';
      }
      const d = damageState();
      f.out = d.out;
      f.spotted = enemySpotted();
      f.shots = enemyShotsFired();
      f.hits = d.hits;
      f.through = d.through;
      f.view = this.judge();
      f.halted = this.stillFor >= HILL.stillFor;
      const { wave, ended } = this.run.step(dt, f);
      if (wave > 0) for (const k of HILL.waves[wave - 1]) bringEnemy(hillEnemy(k));
      // Won, the enemy holds its fire while the crew reads the debrief; lost, there is no one left to shoot at.
      if (ended) holdEnemyFire(true);
      if (ended || wave > 0 || this.run.snap.v !== this.shown.v) this.publish();
      else this.shown.time = this.run.snap.time;
    }
    const joined = netLink.connected && !this.wasConnected;
    const resync = this.run.snap.phase === 'on' && this.time - this.sentAt >= RESYNC_SECONDS;
    if (netLink.connected && (joined || resync || this.sentV !== this.run.snap.v)) {
      const event = { t: 'hill', ...this.run.snap };
      netLink.sendEvent(event);
      this.sentV = this.run.snap.v;
      this.sentAt = this.time;
    }
    this.wasConnected = netLink.connected;
  }

  private note(head: string, line: string, seconds: number, bad: boolean, say?: VoiceCue): void {
    this.signText = `${head}. ${line}`;
    this.signUntil = this.time + seconds;
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = bad ? '#ffb0a0' : '#f4ead8';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(head, width / 2, height / 2 - 12, width - 30);
    ctx.fillStyle = '#f4ead8';
    ctx.font = '28px sans-serif';
    ctx.fillText(line, width / 2, height / 2 + 34, width - 30);
    this.sign.refresh();
    this.sign.setVisible(true, 'game');
    crewLog.post(head, bad ? 'bad' : this.shown.phase === 'won' ? 'good' : 'info', say);
    console.info(`[Hill] sign: ${this.signText}`);
  }

  private drawSign(delta: number): void {
    if (this.sign.visible && this.time > this.signUntil) this.sign.setVisible(false);
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}
