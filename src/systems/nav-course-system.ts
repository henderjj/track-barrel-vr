import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewLog } from '../sim/crew-board.js';
import { applyNav, cpRef, NAV, createNav, navDone, navEvent, navResult, NAV_PLACES, type NavState, startNav, stepNav, stopNav } from '../sim/nav-course.js';
import { shownScenario, stopScenario } from './combat-system.js';
import { repairTank } from './damage-system.js';
import { placeTank, resetTank, tankState } from './drive-system.js';
import { enemyShared, startEnemies } from './enemy-system.js';
import { shownEscort, stopEscort } from './escort-system.js';
import { shownHill, stopHill } from './hill-system.js';
import { shownRun, stopRun } from './range-run-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { showMapCheckpoints } from './map-case-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { crewPresence } from '../net/crew-presence.js';

/** The host sends the run again this often while one is shown, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
const SIGN_SECONDS = 9;

let active: NavCourseSystem | null = null;
const NO_RUN: NavState = createNav();

/** The run as this page shows it: the host's, or the host's as last sent. */
export function shownNav(): Readonly<NavState> {
  return active?.shown ?? NO_RUN;
}

/** Practice → Commander → Map course: a new course (the host starts it; a guest asks). Alone, the driver's seat. */
export function startMapCourse(seed?: number): void {
  active?.start(seed);
}

/** Practice → Commander → Stop course. */
export function stopMapCourse(): void {
  active?.stop();
}

interface NavDebug {
  state(): NavState & { refs: string[]; lastSign: string };
  start(seed?: number): void;
  stop(): void;
  /** Checkpoint `k`'s place, world x and z. */
  at(k: number): number[];
}

/**
 * The map-reading course (F2.12, docs/nav-course.md). The host keeps the
 * run: it picks five checkpoints from places the map shows, times the
 * crew from the start point to the last, and calls each as the tank comes
 * within 20 m of it. The run goes to the guest whole (`nav`) on every
 * change; a guest's Start or Stop asks the host (`nav-ask`). The board
 * shows the next checkpoints' grid references; the map, their circles.
 */
export class NavCourseSystem extends createSystem({}) {
  /** The host's run; on a guest, the host's as last sent. */
  shown: NavState = createNav();
  private sinceSend = 0;
  private sentV = -1;
  private mapV = -1;
  private wasBusy = false;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;

  init(): void {
    active = this;
    this.sign = new FloatingSign('Map Course Sign', 0.8, [640, 200], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);
    netLink.events.set('nav', (e) => {
      if (netLink.isHost) return;
      const was = this.shown.on ? this.shown.seed : -1;
      if (!applyNav(this.shown, e)) return;
      if (navDone(this.shown)) this.say('All checkpoints', navResult(this.shown), '');
      else if (this.shown.on && this.shown.next === 0 && this.shown.seed !== was) this.sayStart();
    });
    netLink.events.set('nav-ask', (e) => {
      if (!netLink.isHost) return;
      const ask = e as { on?: unknown; seed?: unknown };
      if (ask.on === true) this.start(typeof ask.seed === 'number' ? ask.seed : undefined);
      else if (ask.on === false) this.stop();
    });
    this.cleanupFuncs.push(
      () => netLink.events.delete('nav'),
      () => netLink.events.delete('nav-ask'),
      () => {
        if (active === this) active = null;
      },
    );
    const self = this;
    (window as unknown as { __nav: NavDebug }).__nav = {
      state: () => ({ ...self.shown, cps: [...self.shown.cps], splits: [...self.shown.splits], refs: self.shown.cps.map(cpRef), lastSign: self.signText }),
      start: (seed) => self.start(seed),
      stop: () => self.stop(),
      at: (k) => {
        const p = NAV_PLACES[self.shown.cps[k]];
        return p ? [p.x, p.z] : [];
      },
    };
  }

  start(seed?: number): void {
    const s = seed ?? Math.floor(Math.random() * 1e9);
    if (!netLink.connected) seating.ask('driver');
    if (!netLink.isHost) {
      netLink.sendEvent({ t: 'nav-ask', on: true, seed: s } as { t: string });
      return;
    }
    // A drive, not a fight: whatever fight is on gives way, and the tank starts mended, warm, at SP facing north.
    if (shownScenario().phase !== 'off') stopScenario();
    if (shownEscort().phase !== 'off') stopEscort();
    if (shownHill().phase !== 'off') stopHill();
    if (enemyShared().on) startEnemies(false);
    if (shownRun().phase !== 'idle') stopRun();
    repairTank();
    resetTank('warm');
    placeTank(NAV.start.x, NAV.start.z, 0);
    startNav(this.shown, s);
    crewLog.post(`Map reading: ${this.shown.cps.length} checkpoints, CP1 at ${cpRef(this.shown.cps[0])}`, 'info');
    this.sayStart();
    console.info(`[Nav] started, seed ${s}, checkpoints ${this.shown.cps.map(cpRef).join(' ')}`);
  }

  stop(): void {
    if (!netLink.isHost) {
      netLink.sendEvent({ t: 'nav-ask', on: false } as { t: string });
      return;
    }
    stopNav(this.shown);
  }

  update(delta: number): void {
    this.time += delta;
    const s = this.shown;
    if (netLink.isHost) {
      // A fight, a mission or a range run starting gives the course way: the board shows one thing at a time.
      const busy = shownScenario().phase === 'on' || shownEscort().phase === 'on' || shownHill().phase === 'on' || shownRun().phase === 'running';
      if (busy && !this.wasBusy && s.cps.length > 0) {
        stopNav(s);
        console.info('[Nav] stopped: a fight or a run began');
      }
      this.wasBusy = busy;
      // Frozen while the crewmate is away, like the rest of the host's simulation.
      const t = tankState();
      const reached = crewPresence.paused ? -1 : stepNav(s, t.x, t.z, delta);
      if (reached >= 0) {
        const done = navDone(s);
        const next = done ? '' : `, CP${reached + 2} at ${cpRef(s.cps[reached + 1])}`;
        crewLog.post(`CP${reached + 1} reached${next}`, 'good');
        if (done) {
          crewLog.post(navResult(s), 'good');
          this.say('All checkpoints', navResult(s), '');
        }
        console.info(`[Nav] CP${reached + 1} reached at ${s.time.toFixed(1)} s`);
      }
      this.sinceSend += delta;
      if (netLink.connected && (s.v !== this.sentV || (s.cps.length > 0 && this.sinceSend > RESYNC_SECONDS))) {
        netLink.sendEvent(navEvent(s));
        this.sentV = s.v;
        this.sinceSend = 0;
      }
    } else if (s.on && !navDone(s)) {
      // The guest runs the clock on between the host's events.
      s.time += delta;
    }
    if (s.v !== this.mapV) {
      this.mapV = s.v;
      showMapCheckpoints(s.cps.map((place, k) => ({ x: NAV_PLACES[place].x, z: NAV_PLACES[place].z, n: k + 1, done: k < s.next })));
    }
    if (this.sign.visible) {
      if (this.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }

  /** The sign for a new run, on both pages. */
  private sayStart(): void {
    const alone = !netLink.connected;
    this.say('Map reading', `CP1 at ${cpRef(this.shown.cps[0])}: the board has the next two`,
      alone ? 'Swap to the gunner\'s seat to read the map, back to drive' : 'Commander: find them on the map and steer the driver');
  }

  private say(title: string, line1: string, line2: string): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(title, width / 2, 64);
    ctx.font = '26px sans-serif';
    ctx.fillText(line1, width / 2, 118);
    ctx.fillText(line2, width / 2, 160);
    this.sign.refresh();
    this.sign.setVisible(true, 'setup');
    this.signText = `${title}. ${line1} ${line2}`.trim();
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[Nav] sign: ${this.signText}`);
  }
}
