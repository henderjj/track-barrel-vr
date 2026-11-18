import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { smokeBlocks } from '../sim/ammo.js';
import type { Vec3 } from '../sim/ballistics.js';
import {
  AMBUSH,
  AMBUSH_BRIEFING,
  AMBUSH_SEEN,
  ambushBoard,
  ambushDebrief,
  ambushLine,
  AmbushRun,
  type AmbushSnapshot,
  COLUMN_COUNT,
  noAmbush,
  parseAmbush,
} from '../sim/ambush.js';
import { gotAway } from '../sim/column.js';
import { type EnemyGroup, FIRST_COLUMN, gunNear, type SightCheck } from '../sim/enemy-guns.js';
import {
  inReportView,
  noRecon,
  parseRecon,
  RECON,
  RECON_ALL_REPORTED,
  RECON_BRIEFING,
  RECON_ENEMIES,
  RECON_WARNING,
  reconBoard,
  reconDebrief,
  reconLine,
  ReconRun,
  type ReconSnapshot,
  reportedCount,
  reportLines,
} from '../sim/recon.js';
import { groundHeight, wrapTile } from '../sim/terrain.js';
import { crewLog } from '../sim/crew-board.js';
import { shownScenario, stopScenario } from './combat-system.js';
import { shownEscort, stopEscort } from './escort-system.js';
import { damageState, repairTank } from './damage-system.js';
import { placeTank, resetTank, tankState } from './drive-system.js';
import { enemyAlong, enemyShared, enemyShotsFired, enemySpots, enemyTracking, holdEnemyFire, startMission } from './enemy-system.js';
import { decidedListeners } from './firing-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { setAmmoRack } from './loading-system.js';
import { netLink } from './net-system.js';
import { smokeClouds, smokeNow } from './smoke-system.js';
import { turretState } from './turret-system.js';

/** The host sends a mission again this often while it runs, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
/** How long the briefing, a note and the debrief stay on the sign, s. */
const BRIEF_SECONDS = 9;
const NOTE_SECONDS = 5;
const DEBRIEF_SECONDS = 15;

export type Mission = 'recon' | 'ambush';

let active: MissionsSystem | null = null;

/** Recon unseen as this page shows it (F5.10). */
export function shownRecon(): Readonly<ReconSnapshot> {
  return active?.reconShown ?? noRecon();
}

/** Ambush a column as this page shows it (F5.10). */
export function shownAmbush(): Readonly<AmbushSnapshot> {
  return active?.ambushShown ?? noAmbush();
}

/** One line for the menu: the recon's state, or its debrief. */
export function reconStatus(): string {
  return reconLine(shownRecon());
}

/** One line for the menu: the ambush's state, or its debrief. */
export function ambushStatus(): string {
  return ambushLine(shownAmbush());
}

/** The orders board's objective and tasks while a mission runs (F6.5), or null. */
export function missionBoard(): { drill: string; tasks: { text: string; done: boolean }[] } | null {
  if (shownRecon().phase === 'on') return reconBoard(shownRecon());
  if (shownAmbush().phase === 'on') return ambushBoard(shownAmbush());
  return null;
}

/** Missions → Start (or Restart) a mission. The host does it; a guest asks. */
export function startMissionRun(mission: Mission): void {
  if (!netLink.isHost) {
    const event = { t: `${mission}-ask`, start: true };
    netLink.sendEvent(event);
    return;
  }
  active?.startRun(mission);
}

/** Missions → Stop a mission: the enemy goes. */
export function stopMissionRun(mission: Mission): void {
  if (!netLink.isHost) {
    const event = { t: `${mission}-ask`, stop: true };
    netLink.sendEvent(event);
    return;
  }
  active?.stopRun(mission);
}

interface MissionDebug<S> {
  state(): S;
  start(): void;
  stop(): void;
  readonly sign: string;
}

interface ReconDebug extends MissionDebug<ReconSnapshot> {
  /** Host: how long the gun has been on each enemy, s, and whether each is in view to report now. */
  laid(): { laidFor: number[]; inView: boolean[] };
}

/** The battery's groups each mission brings in. */
const GROUPS: Readonly<Record<Mission, readonly EnemyGroup[]>> = { recon: ['guns', 'tanks'], ambush: ['column'] };

/**
 * The F5.10 missions (docs/recon-ambush.md): Recon unseen and Ambush a
 * column. The host runs each (src/sim/recon.ts, src/sim/ambush.ts): it
 * brings in the enemy battery's groups with the mission's seed, puts the
 * tank where the mission starts, judges the run each frame and sends it to
 * the guest (`recon`, `ambush`, reliable), taking a guest's asks
 * (`recon-ask`, `ambush-ask`). Starting one stops the other and the Battle
 * tab's Advance to contact: they share the battery. Both pages show the
 * briefing, the notes as it goes and the debrief on a sign. Registered
 * after CombatSystem.
 */
export class MissionsSystem extends createSystem({}) {
  readonly recon = new ReconRun();
  readonly ambush = new AmbushRun();
  reconShown: ReconSnapshot = noRecon();
  ambushShown: AmbushSnapshot = noAmbush();
  private time = 0;
  private sent: Record<Mission, { v: number; at: number }> = { recon: { v: -1, at: 0 }, ambush: { v: -1, at: 0 } };
  private wasConnected = false;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private readonly laid: boolean[] = Array.from({ length: RECON_ENEMIES }, () => false);
  private readonly out: boolean[] = Array.from({ length: RECON_ENEMIES }, () => false);
  private readonly spots: number[] = [];
  private readonly columnOut: boolean[] = Array.from({ length: COLUMN_COUNT }, () => false);
  private readonly columnAway: boolean[] = Array.from({ length: COLUMN_COUNT }, () => false);
  private readonly at: [number, number] = [0, 0];
  private clear: SightCheck = (a, b) => !smokeBlocks(smokeClouds(), smokeNow(), a as Vec3, b as Vec3);

  init(): void {
    active = this;
    this.sign = new FloatingSign('Mission Sign', 0.95, [640, 150], 1.1, -0.06);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.events.set('recon', (e) => {
      if (netLink.isHost) return;
      const s = parseRecon(e);
      if (s) this.showRecon(s);
    });
    netLink.events.set('ambush', (e) => {
      if (netLink.isHost) return;
      const s = parseAmbush(e);
      if (s) this.showAmbush(s);
    });
    for (const mission of ['recon', 'ambush'] as const) {
      netLink.events.set(`${mission}-ask`, (e) => {
        if (!netLink.isHost) return;
        const ask = e as { start?: unknown; stop?: unknown };
        if (ask.start === true) this.startRun(mission);
        else if (ask.stop === true) this.stopRun(mission);
      });
    }
    // Every shell the crew fires counts against a recon (the host hears them).
    const onDecided = () => this.recon.fired();
    decidedListeners.add(onDecided);
    this.cleanupFuncs.push(
      () => netLink.events.delete('recon'),
      () => netLink.events.delete('ambush'),
      () => netLink.events.delete('recon-ask'),
      () => netLink.events.delete('ambush-ask'),
      () => decidedListeners.delete(onDecided),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    const w = window as unknown as { __recon: ReconDebug; __ambush: MissionDebug<AmbushSnapshot> };
    w.__recon = {
      state: () => ({ ...self.reconShown, reported: [...self.reconShown.reported] }),
      start: () => startMissionRun('recon'),
      stop: () => stopMissionRun('recon'),
      laid: () => ({ laidFor: [...self.recon.laidFor], inView: [...self.laid] }),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
    w.__ambush = {
      state: () => ({ ...self.ambushShown, out: [...self.ambushShown.out], away: [...self.ambushShown.away] }),
      start: () => startMissionRun('ambush'),
      stop: () => stopMissionRun('ambush'),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
  }

  /** Host: start a mission afresh: the other and Advance to contact stopped, the tank mended, warm and where it starts, the enemy brought in. */
  startRun(mission: Mission): void {
    if (!netLink.isHost) return;
    if (shownScenario().phase === 'on') stopScenario();
    if (shownEscort().phase === 'on') stopEscort();
    const other = mission === 'recon' ? this.ambush : this.recon;
    other.stop();
    repairTank();
    resetTank('warm');
    if (mission === 'ambush') placeTank(AMBUSH.x, AMBUSH.z, AMBUSH.heading);
    setAmmoRack('mixed');
    startMission(GROUPS[mission], mission === 'recon' ? RECON.seed : AMBUSH.seed);
    if (mission === 'recon') this.recon.start();
    else this.ambush.start();
    this.publish();
    console.info(`[Mission] ${mission} started`);
  }

  /** Host: stop a mission: the enemy goes. */
  stopRun(mission: Mission): void {
    if (!netLink.isHost) return;
    const run = mission === 'recon' ? this.recon : this.ambush;
    if (run.snap.phase === 'off') return;
    run.stop();
    startMission([]);
    this.publish();
    console.info(`[Mission] ${mission} stopped`);
  }

  /** Host: show the runs here (the guest is told in update). */
  private publish(): void {
    this.showRecon({ ...this.recon.snap, reported: [...this.recon.snap.reported] });
    this.showAmbush({ ...this.ambush.snap, out: [...this.ambush.snap.out], away: [...this.ambush.snap.away] });
  }

  /** Take the recon as the host has it: a report, a warning or a change of phase puts a note on the sign. */
  private showRecon(s: ReconSnapshot): void {
    const was = this.reconShown;
    this.reconShown = s;
    if (s.phase === 'on' && was.phase !== 'on') {
      this.note(RECON_BRIEFING[0], RECON_BRIEFING[1], BRIEF_SECONDS, 'info');
      return;
    }
    if (s.phase === 'won' || s.phase === 'lost') {
      if (was.phase === s.phase) return;
      const [head, counts] = reconDebrief(s);
      this.note(head, counts, DEBRIEF_SECONDS, s.phase === 'won' ? 'good' : 'bad');
      console.info(`[Recon] debrief: ${head}. ${counts}`);
      return;
    }
    if (s.phase !== 'on') return;
    const t = tankState();
    for (let i = 0; i < RECON_ENEMIES; i++) {
      if (!s.reported[i] || was.reported[i]) continue;
      const left = RECON_ENEMIES - reportedCount(s);
      if (left === 0) {
        this.note(RECON_ALL_REPORTED[0], RECON_ALL_REPORTED[1], NOTE_SECONDS, 'good');
      } else {
        gunNear(i, t.x, t.z, this.at, enemyAlong(i));
        const [head, line] = reportLines(i, Math.hypot(this.at[0] - t.x, this.at[1] - t.z), left);
        this.note(head, line, NOTE_SECONDS, 'good');
      }
    }
    if (s.warned > was.warned) this.note(RECON_WARNING[0], RECON_WARNING[1], NOTE_SECONDS, 'bad');
  }

  /** Take the ambush as the host has it: the briefing, being seen first, and the debrief on the sign. */
  private showAmbush(s: AmbushSnapshot): void {
    const was = this.ambushShown;
    this.ambushShown = s;
    if (s.phase === 'on' && was.phase !== 'on') {
      this.note(AMBUSH_BRIEFING[0], AMBUSH_BRIEFING[1], BRIEF_SECONDS, 'info');
      return;
    }
    if (s.phase === 'won' || s.phase === 'lost') {
      if (was.phase === s.phase) return;
      const [head, counts] = ambushDebrief(s);
      this.note(head, counts, DEBRIEF_SECONDS, s.phase === 'won' ? 'good' : 'bad');
      console.info(`[Ambush] debrief: ${head}. ${counts}`);
      return;
    }
    if (s.phase === 'on' && s.seen && was.sprungAt < 0 && s.sprungAt >= 0) this.note(AMBUSH_SEEN[0], AMBUSH_SEEN[1], NOTE_SECONDS, 'bad');
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    const paused = netLink.connected && crewPresence.paused;
    if (netLink.isHost) {
      if (!paused) {
        this.hostRecon(dt);
        this.hostAmbush(dt);
      }
      this.tell();
    } else if (!paused) {
      if (this.reconShown.phase === 'on') this.reconShown.time += dt;
      if (this.ambushShown.phase === 'on') this.ambushShown.time += dt;
    }
    this.drawSign(delta);
  }

  /** Advance to contact or the convoy escort (F5.8) is on: only one fight at a time, so a mission gives way. */
  private otherFight(): boolean {
    return shownScenario().phase === 'on' || shownEscort().phase === 'on';
  }

  /** Host: judge the recon: what the gun is on, how close the enemy is to spotting the tank, and whether one has. */
  private hostRecon(dt: number): void {
    if (this.recon.snap.phase !== 'on') return;
    const shared = enemyShared();
    if (this.otherFight() || (!shared.present[0] && !shared.present[RECON_ENEMIES - 1])) {
      // Another fight started (Advance to contact, the convoy), or its enemy was taken away from under it.
      this.recon.stop();
      this.publish();
      return;
    }
    const t = tankState();
    const ground = groundHeight(t.x, t.z);
    const gunYaw = t.heading + turretState().yaw;
    for (let i = 0; i < RECON_ENEMIES; i++) {
      const there = shared.present[i] && shared.alive[i];
      this.out[i] = shared.present[i] && !shared.alive[i];
      this.laid[i] = there && !this.recon.snap.reported[i] && inReportView(i, t.x, t.z, ground, gunYaw, enemyAlong(i), this.clear);
    }
    enemySpots(this.spots);
    const tracking = enemyTracking();
    const before = this.recon.snap.v;
    const ended = this.recon.step(dt, {
      fromStart: Math.hypot(wrapTile(t.x), wrapTile(t.z)),
      laid: this.laid,
      out: this.out,
      spot: this.spots,
      spottedBy: tracking >= 0 && tracking < RECON_ENEMIES ? tracking : -1,
    });
    // Over either way, the enemy holds its fire while the crew reads the debrief.
    if (ended) holdEnemyFire(true);
    if (ended || this.recon.snap.v !== before) this.publish();
    else this.reconShown.time = this.recon.snap.time;
  }

  /** Host: judge the ambush: the column's vehicles knocked out or away, the ambush sprung, and the tank's hits. */
  private hostAmbush(dt: number): void {
    if (this.ambush.snap.phase !== 'on') return;
    const shared = enemyShared();
    if (this.otherFight() || !shared.present[FIRST_COLUMN]) {
      this.ambush.stop();
      this.publish();
      return;
    }
    for (let k = 0; k < COLUMN_COUNT; k++) {
      const i = FIRST_COLUMN + k;
      this.columnOut[k] = shared.present[i] && !shared.alive[i];
      this.columnAway[k] = gotAway(enemyAlong(i));
    }
    const d = damageState();
    const before = this.ambush.snap.v;
    const ended = this.ambush.step(dt, {
      tankOut: d.out,
      out: this.columnOut,
      away: this.columnAway,
      sprung: shared.sprung,
      spotted: enemyTracking() >= FIRST_COLUMN,
      shots: enemyShotsFired(),
      hits: d.hits,
      through: d.through,
    });
    if (ended) holdEnemyFire(true);
    if (ended || this.ambush.snap.v !== before) this.publish();
    else this.ambushShown.time = this.ambush.snap.time;
  }

  /** Host: keep the guest told of both missions: on a change, when it joins, and every few seconds while one runs. */
  private tell(): void {
    const joined = netLink.connected && !this.wasConnected;
    this.wasConnected = netLink.connected;
    if (!netLink.connected) return;
    for (const mission of ['recon', 'ambush'] as const) {
      const snap = mission === 'recon' ? this.recon.snap : this.ambush.snap;
      const sent = this.sent[mission];
      const resync = snap.phase === 'on' && this.time - sent.at >= RESYNC_SECONDS;
      if (!joined && !resync && sent.v === snap.v) continue;
      const event = { t: mission, ...snap };
      netLink.sendEvent(event);
      sent.v = snap.v;
      sent.at = this.time;
    }
  }

  private note(head: string, line: string, seconds: number, tone: 'info' | 'good' | 'bad'): void {
    this.signText = `${head}. ${line}`;
    this.signUntil = this.time + seconds;
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = tone === 'bad' ? '#ffb0a0' : '#f4ead8';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(head, width / 2, height / 2 - 12, width - 30);
    ctx.fillStyle = '#f4ead8';
    ctx.font = '28px sans-serif';
    ctx.fillText(line, width / 2, height / 2 + 34, width - 30);
    this.sign.refresh();
    this.sign.setVisible(true, 'game');
    crewLog.post(head, tone);
    console.info(`[Mission] sign: ${this.signText}`);
  }

  private drawSign(delta: number): void {
    if (this.sign.visible && this.time > this.signUntil) this.sign.setVisible(false);
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}
