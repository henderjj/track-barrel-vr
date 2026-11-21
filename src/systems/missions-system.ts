import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
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
import { type EnemyGroup, FIRST_COLUMN, isColumn } from '../sim/enemy-guns.js';
import { crewLog } from '../sim/crew-board.js';
import { shownScenario, stopScenario } from './combat-system.js';
import { shownEscort, stopEscort } from './escort-system.js';
import { damageState, repairTank } from './damage-system.js';
import { placeTank, resetTank } from './drive-system.js';
import { enemyAlong, enemyShared, enemyShotsFired, enemyTracking, holdEnemyFire, startMission } from './enemy-system.js';
import { shownHill, stopHill } from './hill-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { setAmmoRack } from './loading-system.js';
import { netLink } from './net-system.js';

/** The host sends a mission again this often while it runs, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
/** How long the briefing, a note and the debrief stay on the sign, s. */
const BRIEF_SECONDS = 9;
const NOTE_SECONDS = 5;
const DEBRIEF_SECONDS = 15;

export type Mission = 'ambush';

let active: MissionsSystem | null = null;

/** Ambush a column as this page shows it (F5.10). */
export function shownAmbush(): Readonly<AmbushSnapshot> {
  return active?.ambushShown ?? noAmbush();
}

/** One line for the menu: the ambush's state, or its debrief. */
export function ambushStatus(): string {
  return ambushLine(shownAmbush());
}

/** The orders board's objective and tasks while a mission runs (F6.5), or null. */
export function missionBoard(): { drill: string; tasks: { text: string; done: boolean }[] } | null {
  if (shownAmbush().phase === 'on') return ambushBoard(shownAmbush());
  return null;
}

/** The crew marched to the mission's position (F2.12b, Missions → March): it begins where the tank stands. Host only. */
export function startMissionInPlace(mission: Mission): void {
  if (netLink.isHost) active?.startRun(mission, true);
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

/** The battery's groups each mission brings in. */
const GROUPS: Readonly<Record<Mission, readonly EnemyGroup[]>> = { ambush: ['column'] };

/**
 * The F5.10 mission (docs/ambush.md): Ambush a column. The host runs it
 * (src/sim/ambush.ts): it brings in the enemy battery's column with the
 * mission's seed, puts the tank where the mission starts, judges the run
 * each frame and sends it to the guest (`ambush`, reliable), taking a
 * guest's asks (`ambush-ask`). Starting it stops the Battle tab's Advance
 * to contact, the convoy and the hill: they share the battery. Both pages
 * show the briefing, the notes as it goes and the debrief on a sign.
 * Registered after CombatSystem.
 */
export class MissionsSystem extends createSystem({}) {
  readonly ambush = new AmbushRun();
  ambushShown: AmbushSnapshot = noAmbush();
  private time = 0;
  private sent: Record<Mission, { v: number; at: number }> = { ambush: { v: -1, at: 0 } };
  private wasConnected = false;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private readonly columnOut: boolean[] = Array.from({ length: COLUMN_COUNT }, () => false);
  private readonly columnAway: boolean[] = Array.from({ length: COLUMN_COUNT }, () => false);

  init(): void {
    active = this;
    this.sign = new FloatingSign('Mission Sign', 0.95, [640, 150], 1.1, -0.06);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.events.set('ambush', (e) => {
      if (netLink.isHost) return;
      const s = parseAmbush(e);
      if (s) this.showAmbush(s);
    });
    for (const mission of ['ambush'] as const) {
      netLink.events.set(`${mission}-ask`, (e) => {
        if (!netLink.isHost) return;
        const ask = e as { start?: unknown; stop?: unknown };
        if (ask.start === true) this.startRun(mission);
        else if (ask.stop === true) this.stopRun(mission);
      });
    }
    this.cleanupFuncs.push(
      () => netLink.events.delete('ambush'),
      () => netLink.events.delete('ambush-ask'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    const w = window as unknown as { __ambush: MissionDebug<AmbushSnapshot> };
    w.__ambush = {
      state: () => ({ ...self.ambushShown, out: [...self.ambushShown.out], away: [...self.ambushShown.away] }),
      start: () => startMissionRun('ambush'),
      stop: () => stopMissionRun('ambush'),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
  }

  /** Host: start a mission afresh: the other fights stopped, the tank mended, warm and where it starts, the enemy brought in. */
  startRun(mission: Mission, inPlace = false): void {
    if (!netLink.isHost) return;
    if (shownScenario().phase === 'on') stopScenario();
    if (shownEscort().phase === 'on') stopEscort();
    if (shownHill().phase !== 'off') stopHill();
    // Marched there (F2.12b): the tank stays as it came, running.
    if (!inPlace) {
      repairTank();
      resetTank('warm');
      if (mission === 'ambush') placeTank(AMBUSH.x, AMBUSH.z, AMBUSH.heading);
    }
    setAmmoRack('mixed');
    startMission(GROUPS[mission], AMBUSH.seed);
    this.ambush.start();
    this.publish();
    console.info(`[Mission] ${mission} started`);
  }

  /** Host: stop a mission: the enemy goes. */
  stopRun(mission: Mission): void {
    if (!netLink.isHost) return;
    const run = this.ambush;
    if (run.snap.phase === 'off') return;
    run.stop();
    startMission([]);
    this.publish();
    console.info(`[Mission] ${mission} stopped`);
  }

  /** Host: show the runs here (the guest is told in update). */
  private publish(): void {
    this.showAmbush({ ...this.ambush.snap, out: [...this.ambush.snap.out], away: [...this.ambush.snap.away] });
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
        this.hostAmbush(dt);
      }
      this.tell();
    } else if (!paused) {
      if (this.ambushShown.phase === 'on') this.ambushShown.time += dt;
    }
    this.drawSign(delta);
  }

  /** Advance to contact, the convoy escort (F5.8) or hold the hill (F5.9) is on: only one fight at a time, so the mission gives way. */
  private otherFight(): boolean {
    return shownScenario().phase === 'on' || shownEscort().phase === 'on' || shownHill().phase === 'on';
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
      spotted: isColumn(enemyTracking()),
      shots: enemyShotsFired(),
      hits: d.hits,
      through: d.through,
    });
    if (ended) holdEnemyFire(true);
    if (ended || this.ambush.snap.v !== before) this.publish();
    else this.ambushShown.time = this.ambush.snap.time;
  }

  /** Host: keep the guest told of the mission: on a change, when it joins, and every few seconds while one runs. */
  private tell(): void {
    const joined = netLink.connected && !this.wasConnected;
    this.wasConnected = netLink.connected;
    if (!netLink.connected) return;
    for (const mission of ['ambush'] as const) {
      const snap = this.ambush.snap;
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
