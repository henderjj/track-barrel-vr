import { createSystem, type Mesh, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { createTruck, createTruckWreck } from '../scene-assets/escort-truck.scene-asset.js';
import { crewLog } from '../sim/crew-board.js';
import { phaseCue, type VoiceCue } from '../sim/commander-voice.js';
import { enemyName, FIRST_TANK, type TruckTarget } from '../sim/enemy-guns.js';
import {
  copyEscort,
  driveTrucks,
  ESCORT,
  ESCORT_BRIEFING,
  escortDebrief,
  escortLine,
  EscortRun,
  type EscortSnapshot,
  noEscort,
  parseEscort,
  TRUCK_NAMES,
  truckExposed,
  trucksLeft,
} from '../sim/escort.js';
import { groundHeight, wrapTile } from '../sim/terrain.js';
import { shownScenario, stopScenario } from './combat-system.js';
import { damageState, repairTank } from './damage-system.js';
import { placeTank, resetTank, tankState } from './drive-system.js';
import {
  bringTanks,
  enemyShared,
  enemyTruckShots,
  enemyShotsFired,
  fireOnTruckNow,
  holdEnemyFire,
  setConvoyTargets,
  spotConvoyNow,
  startBattle,
  truckStruckListeners,
} from './enemy-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { setAmmoRack } from './loading-system.js';
import { netLink } from './net-system.js';

/** The host sends the convoy again this often while it runs, s: the trucks' places, in case a guest drifted or missed a message. */
const RESYNC_SECONDS = 2;
/** How long the briefing, a note and the debrief stay on the sign, s. */
const BRIEF_SECONDS = 8;
const NOTE_SECONDS = 5;
const DEBRIEF_SECONDS = 15;
/** A truck's body is tilted to the ground between points this far ahead of and behind its middle, m. */
const PITCH_SPAN = 2.2;
/** A knocked-out truck slews this far round as it runs off the road, rad. */
const WRECK_SLEW = 0.35;

let active: EscortSystem | null = null;

/** The convoy as this page shows it (F5.8). */
export function shownEscort(): Readonly<EscortSnapshot> {
  return active?.shown ?? noEscort();
}

/** One line for the menu: the convoy's state, or its debrief. */
export function escortStatus(): string {
  return escortLine(shownEscort());
}

/** Missions → Escort a convoy → Start (or Restart). The host does it; a guest asks. */
export function startEscort(): void {
  if (!netLink.isHost) {
    const event = { t: 'escort-ask', start: true };
    netLink.sendEvent(event);
    return;
  }
  active?.start();
}

/** Missions → Escort a convoy → Stop: the convoy and the enemy go. */
export function stopEscort(): void {
  if (!netLink.isHost) {
    const event = { t: 'escort-ask', stop: true };
    netLink.sendEvent(event);
    return;
  }
  active?.stop();
}

/** Missions → Escort a convoy → Ambush: started, the tank 210 m up the road with the convoy closed up behind, gun A laid on the trucks. */
export function escortAmbush(): void {
  if (!netLink.isHost) {
    const event = { t: 'escort-ask', ambush: true };
    netLink.sendEvent(event);
    return;
  }
  active?.ambush();
}

interface EscortDebug {
  state(): EscortSnapshot;
  start(): void;
  stop(): void;
  ambush(): void;
  /** Host: enemy `i` fires at truck `k` now. */
  fireAt(i: number, k: number): void;
  /** Host: the convoy closed up behind the tank at `tankD` along the road (tests). */
  closeUp(tankD: number): void;
  /** Where this page draws each truck, world x and z, and whether it is drawn as a wreck. */
  drawn(): { x: number; z: number; visible: boolean; wreck: boolean }[];
  readonly sign: string;
}

/**
 * Scenario: escort a convoy (F5.8, docs/escort.md). The host runs it: the
 * tank back at the start, mended and warm with a mixed rack, the guns
 * started with the scenario's seed and the tanks brought up later, four
 * trucks following the tank up the road, and the run judged each frame. It
 * hands the trucks to the enemy battery as targets (setConvoyTargets), knocks
 * a truck out when a shell that hit it gets there, and sends the convoy to
 * the guest (`escort`, reliable) on each change and every 2 s while it runs;
 * a guest's asks come as `escort-ask`. A guest drives its trucks on by the
 * same rule from the tank it sees between messages. Both pages draw the
 * trucks and show the briefing, a note for each truck lost, and the debrief
 * on a sign. Registered after CombatSystem, whose scenario it stops (and
 * which stops it) so only one runs at a time.
 */
export class EscortSystem extends createSystem({}) {
  readonly run = new EscortRun();
  /** What this page shows: the host's run; a guest's as last told, its trucks driven on since. */
  readonly shown: EscortSnapshot = noEscort();
  private time = 0;
  private sentV = -1;
  private sentAt = 0;
  private wasConnected = false;
  private lastPhase: EscortSnapshot['phase'] = 'off';
  private trucks: Mesh[] = [];
  private wrecks: Mesh[] = [];
  /** The trucks as the enemy sees them (host), updated in place each frame. */
  private readonly targets: TruckTarget[] = Array.from({ length: ESCORT.trucks }, () => ({ x: ESCORT.x, ground: 0, z: 0, heading: 0, speed: 0, alive: true }));
  private readonly drawnAt = Array.from({ length: ESCORT.trucks }, () => ({ x: 0, z: 0, visible: false, wreck: false }));
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;

  init(): void {
    active = this;
    const ground = this.world.getSceneEntity('ground') ?? null;
    const add = (mesh: Mesh) => {
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.rotation.order = 'YXZ';
      if (ground) this.world.createTransformEntity(mesh, { parent: ground });
      return mesh;
    };
    for (let k = 0; k < ESCORT.trucks; k++) {
      this.trucks.push(add(createTruck(k)));
      this.wrecks.push(add(createTruckWreck(k)));
    }
    this.sign = new FloatingSign('Escort Sign', 0.95, [640, 150], 1.1, -0.06);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.events.set('escort', (e) => {
      if (netLink.isHost) return;
      const s = parseEscort(e);
      if (s) this.show(s);
    });
    netLink.events.set('escort-ask', (e) => {
      if (!netLink.isHost) return;
      const ask = e as { start?: unknown; stop?: unknown; ambush?: unknown };
      if (ask.start === true) this.start();
      else if (ask.stop === true) this.stop();
      else if (ask.ambush === true) this.ambush();
    });
    // A shell that hit a truck knocks it out as it gets there (the host decides; the guest is told).
    const onStruck = (truck: number, gun: number) => {
      if (netLink.isHost && this.run.knockOut(truck, gun)) this.publish();
    };
    truckStruckListeners.add(onStruck);
    this.cleanupFuncs.push(
      () => netLink.events.delete('escort'),
      () => netLink.events.delete('escort-ask'),
      () => truckStruckListeners.delete(onStruck),
      () => {
        setConvoyTargets(null);
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __escort: EscortDebug }).__escort = {
      state: () => copyEscort(self.shown, noEscort()),
      start: () => startEscort(),
      stop: () => stopEscort(),
      ambush: () => escortAmbush(),
      fireAt: (i, k) => fireOnTruckNow(i, k),
      closeUp: (tankD) => {
        if (!netLink.isHost || self.run.snap.phase !== 'on') return;
        self.run.closeUp(tankD);
        self.placeTargets();
        self.publish();
      },
      drawn: () => self.drawnAt.map((d) => ({ ...d })),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
  }

  /** Host: start the convoy afresh (stopping Advance to contact if it runs). */
  start(): void {
    if (!netLink.isHost) return;
    if (shownScenario().phase === 'on') stopScenario();
    repairTank();
    resetTank('warm');
    setAmmoRack('mixed');
    startBattle(true, ESCORT.seed);
    this.run.start();
    this.placeTargets();
    setConvoyTargets(this.targets);
    this.publish();
    console.info('[Escort] convoy started');
  }

  /** Host: stop it: the convoy and the enemy go. */
  stop(): void {
    if (!netLink.isHost) return;
    const was = this.run.snap.phase;
    this.run.stop();
    setConvoyTargets(null);
    if (was !== 'off') startBattle(false);
    this.publish();
    console.info('[Escort] convoy stopped');
  }

  /** Host: Ambush: started, the tank up the road where gun A sees the convoy behind it, gun A laid on the trucks. */
  ambush(): void {
    if (!netLink.isHost) return;
    this.start();
    placeTank(0, -ESCORT.ambushD, 0);
    this.run.closeUp(ESCORT.ambushD);
    this.placeTargets();
    spotConvoyNow(0);
    this.publish();
  }

  /** Host: show the run here (the guest is told in update). */
  private publish(): void {
    this.show(this.run.snap);
  }

  /**
   * Take the convoy as the host has it: a change of phase puts the briefing
   * or the debrief on the sign, a truck lost or the convoy released a note.
   */
  private show(s: Readonly<EscortSnapshot>): void {
    const was = this.lastPhase;
    const released = this.shown.released;
    let lost = -1;
    for (let k = 0; k < ESCORT.trucks; k++) if (s.phase === 'on' && was === 'on' && this.shown.alive[k] && !s.alive[k]) lost = k;
    copyEscort(s, this.shown);
    this.lastPhase = s.phase;
    if (s.phase === was) {
      if (lost >= 0) {
        const by = s.by[lost] >= 0 ? ` by ${enemyName(s.by[lost])}` : '';
        this.note(`${TRUCK_NAMES[lost]} knocked out${by}`, `${trucksLeft(s)} of ${ESCORT.trucks} trucks running`, NOTE_SECONDS, true);
      } else if (s.phase === 'on' && s.released && !released) {
        this.note('Convoy driving in', 'The trucks pass you to the 600 m marker', NOTE_SECONDS, false);
      }
      return;
    }
    if (s.phase === 'on') this.note(ESCORT_BRIEFING[0], ESCORT_BRIEFING[1], BRIEF_SECONDS, false, phaseCue('on', true));
    else if (s.phase === 'won' || s.phase === 'lost') {
      const [head, counts] = escortDebrief(s);
      this.note(head, counts, DEBRIEF_SECONDS, s.phase === 'lost', phaseCue(s.phase, true));
      console.info(`[Escort] debrief: ${head}. ${counts}`);
    }
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    const paused = netLink.connected && crewPresence.paused;
    if (netLink.isHost) this.host(dt, paused);
    else if (this.shown.phase === 'on' && !paused) {
      this.shown.time += dt;
      driveTrucks(this.shown, dt, -tankState().z);
    }
    this.draw();
    this.drawSign(delta);
  }

  /** The host's part: run the convoy, judge it, and keep the guest told. */
  private host(dt: number, paused: boolean): void {
    const s = this.run.snap;
    // Advance to contact started from the Battle tab: only one fight at a time.
    if (s.phase !== 'off' && shownScenario().phase === 'on') {
      this.run.stop();
      setConvoyTargets(null);
      this.publish();
    }
    if (s.phase === 'on' && !paused) {
      const shared = enemyShared();
      let enemies = 0;
      let killed = 0;
      let gunsKilled = 0;
      shared.present.forEach((p, i) => {
        if (!p) return;
        enemies++;
        if (shared.alive[i]) return;
        killed++;
        if (i < FIRST_TANK) gunsKilled++;
      });
      const tanksWere = s.tanksIn;
      const d = damageState();
      const ended = this.run.step(dt, {
        tankD: -tankState().z,
        out: d.out,
        gunsKilled,
        killed,
        enemies,
        truckShots: enemyTruckShots(),
        shots: enemyShotsFired(),
        hits: d.hits,
        through: d.through,
      });
      if (s.tanksIn && !tanksWere) bringTanks();
      this.placeTargets();
      if (ended) {
        // Over, the enemy holds its fire while the crew reads the debrief.
        holdEnemyFire(true);
        setConvoyTargets(null);
      }
      if (ended || s.v !== this.shown.v || s.released !== this.shown.released) this.publish();
      else copyEscort(s, this.shown);
    }
    const joined = netLink.connected && !this.wasConnected;
    const resync = s.phase === 'on' && this.time - this.sentAt >= RESYNC_SECONDS;
    if (netLink.connected && (joined || resync || this.sentV !== s.v)) {
      const event = { t: 'escort', ...s, d: s.d.map((v) => Math.round(v * 100) / 100), speed: s.speed.map((v) => Math.round(v * 100) / 100), alive: [...s.alive] };
      netLink.sendEvent(event);
      this.sentV = s.v;
      this.sentAt = this.time;
    }
    this.wasConnected = netLink.connected;
  }

  /** Host: the trucks as the enemy sees them, where the run has them. */
  private placeTargets(): void {
    const s = this.run.snap;
    for (let k = 0; k < ESCORT.trucks; k++) {
      const t = this.targets[k];
      // Behind the start the trucks are in cover (truckExposed): the enemy sees no truck there to aim at.
      t.alive = s.alive[k] && truckExposed(s.d[k]);
      t.x = s.alive[k] ? ESCORT.x : ESCORT.wreckX;
      t.z = -s.d[k];
      t.ground = groundHeight(t.x, t.z);
      t.heading = 0;
      t.speed = s.speed[k];
    }
  }

  /** The trucks where this page has them (each one's copy nearest the tank), tilted to the ground; wrecks slewed onto the verge. */
  private draw(): void {
    const s = this.shown;
    const on = s.phase !== 'off';
    const tank = tankState();
    const offX = tank.x - wrapTile(tank.x);
    const offZ = tank.z - wrapTile(tank.z);
    for (let k = 0; k < ESCORT.trucks; k++) {
      const alive = s.alive[k];
      const truck = this.trucks[k];
      const wreck = this.wrecks[k];
      truck.visible = on && alive;
      wreck.visible = on && !alive;
      const at = this.drawnAt[k];
      at.visible = on;
      at.wreck = !alive;
      if (!on) continue;
      const x = alive ? ESCORT.x : ESCORT.wreckX;
      // The copy of the road nearest the tank: the ground repeats every tile.
      const z = tank.z + wrapTile(-s.d[k] - tank.z);
      at.x = x;
      at.z = z;
      const y = groundHeight(x, z);
      const yaw = Math.PI + (alive ? 0 : WRECK_SLEW);
      // Facing -z: its front (the model's +Z) is towards -z.
      const front = groundHeight(x, z - PITCH_SPAN);
      const rear = groundHeight(x, z + PITCH_SPAN);
      const mesh = alive ? truck : wreck;
      mesh.position.set(x - offX, y, z - offZ);
      mesh.rotation.set(Math.atan2(rear - front, 2 * PITCH_SPAN), yaw, 0);
    }
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
    console.info(`[Escort] sign: ${this.signText}`);
  }

  private drawSign(delta: number): void {
    if (this.sign.visible && this.time > this.signUntil) this.sign.setVisible(false);
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}
