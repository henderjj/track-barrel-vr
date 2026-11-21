import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import { crewLog } from '../sim/crew-board.js';
import { gridRef } from '../sim/field-map.js';
import {
  applyReport,
  catchUpReportRun,
  createReportRun,
  marchBriefing,
  reportCall,
  reportDone,
  reportEvent,
  type ReportRun,
  type ReportStep,
  reportTally,
  ROUTE_MISSIONS,
  ROUTES,
  type RouteMission,
  startReportRun,
  stepReportRun,
  stopReportRun,
} from '../sim/report-points.js';
import { shownScenario, stopScenario } from './combat-system.js';
import { repairTank } from './damage-system.js';
import { resetTank, tankState } from './drive-system.js';
import { enemyShared, startEnemies } from './enemy-system.js';
import { shownEscort, stopEscort } from './escort-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { beginHillInPlace, shownHill, stopHill } from './hill-system.js';
import { setAmmoRack } from './loading-system.js';
import { type MapCheckpoint, showMapRoute } from './map-case-system.js';
import { shownAmbush, startMissionInPlace, stopMissionRun } from './missions-system.js';
import { shownNav, stopMapCourse } from './nav-course-system.js';
import { netLink } from './net-system.js';
import { shownRun, stopRun } from './range-run-system.js';

/** The host sends the run again this often while one is shown, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
const SIGN_SECONDS = 9;

let active: ReportPointsSystem | null = null;
const NO_RUN: ReportRun = createReportRun();

/** The route as this page shows it: the host's, or the host's as last sent. */
export function shownReport(): Readonly<ReportRun> {
  return active?.shown ?? NO_RUN;
}

/** Missions → Hold the hill (or Ambush a column) → March: the crew at SP, to cross the SL and pass the RPs to the position. The host does it; a guest asks. */
export function startMarch(mission: RouteMission): void {
  active?.march(mission);
}

/** Missions → Stop while marching: the march ends (a mission's own Stop still stops the mission). */
export function stopMarch(): void {
  active?.stopMarch();
}

/** The menu's status line while a march to `mission` is on, else ''. */
export function marchStatus(mission: RouteMission): string {
  const s = shownReport();
  if (s.mission !== mission || !s.march) return '';
  return `${ROUTES[mission].name}: approach march. ${reportTally(s)}`;
}

/** The phase each mission shows. */
function missionPhase(m: RouteMission): string {
  return m === 'escort' ? shownEscort().phase : m === 'hill' ? shownHill().phase : shownAmbush().phase;
}

interface ReportDebug {
  state(): ReportRun & { lastSign: string };
  march(mission: RouteMission): void;
  stop(): void;
  /** Report point `k` of the shown route, world x and z ([] if none). */
  at(k: number): number[];
  /** The shown route's start line, world [ax, az, bx, bz] ([] if none). */
  sl(): number[];
}

/**
 * Mission report points (F2.12b, docs/report-points.md). Each mission has a
 * start line (SL) and report points (RP1, RP2 ...) along its way, drawn on
 * the commander's map in blue. The host keeps the route: it starts the
 * convoy's when Escort a convoy begins, and Missions → March starts Hold
 * the hill's or Ambush a column's with the crew at SP. It calls the SL as
 * the tank crosses it going north and each RP, in order, as the tank
 * passes within 20 m of it. On a march the last RP is the position (15 m):
 * reaching it begins the mission where the tank stands. The route goes to
 * the guest whole (`report`) on every change; a guest's March or Stop asks
 * the host (`report-ask`). Registered after the missions, the map-reading
 * course and the map case, before the board.
 */
export class ReportPointsSystem extends createSystem({}) {
  /** The host's route; on a guest, the host's as last sent. */
  shown: ReportRun = createReportRun();
  private sinceSend = 0;
  private sentV = -1;
  private mapV = -1;
  private wasConnected = false;
  private readonly phases: Record<RouteMission, string> = { escort: 'off', hill: 'off', ambush: 'off' };
  private talliedV = -1;
  /** The convoy's clock last frame: a Restart sets it back, and the route begins again. */
  private escortTime = 0;
  private px = 0;
  private pz = 0;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;
  private readonly points: MapCheckpoint[] = [];

  init(): void {
    active = this;
    this.sign = new FloatingSign('Report Sign', 0.85, [720, 200], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);
    netLink.events.set('report', (e) => {
      if (netLink.isHost) return;
      const s = this.shown;
      const wasMission = s.mission;
      const wasMarch = s.march;
      const wasSl = s.slAt;
      const wasNext = s.next;
      if (!applyReport(s, e)) return;
      if (s.mission !== '' && s.march && s.slAt < 0 && s.next === 0 && (wasMission !== s.mission || !wasMarch)) this.sayMarch(s.mission);
      else if (s.mission === wasMission) this.announce(wasSl, wasNext, s.next === wasNext + 1 && wasMarch && !s.march);
    });
    netLink.events.set('report-ask', (e) => {
      if (!netLink.isHost) return;
      const ask = e as { march?: unknown; stop?: unknown };
      if (ask.stop === true) this.stopMarch();
      else if ((ROUTE_MISSIONS as readonly unknown[]).includes(ask.march)) this.march(ask.march as RouteMission);
    });
    this.cleanupFuncs.push(
      () => netLink.events.delete('report'),
      () => netLink.events.delete('report-ask'),
      () => {
        if (active === this) active = null;
      },
    );
    const self = this;
    (window as unknown as { __report: ReportDebug }).__report = {
      state: () => ({ ...self.shown, times: [...self.shown.times], lastSign: self.signText }),
      march: (m) => self.march(m),
      stop: () => self.stopMarch(),
      at: (k) => {
        const m = self.shown.mission;
        const p = m === '' ? undefined : ROUTES[m].points[k];
        return p ? [p.x, p.z] : [];
      },
      sl: () => {
        const m = self.shown.mission;
        return m === '' ? [] : [...ROUTES[m].start.a, ...ROUTES[m].start.b];
      },
    };
  }

  /** The approach march: every other fight and drill stopped, the tank mended and warm at SP facing north, the mission's rack. */
  march(mission: RouteMission): void {
    if (!ROUTES[mission].position) return;
    if (!netLink.isHost) {
      const event = { t: 'report-ask', march: mission };
      netLink.sendEvent(event);
      return;
    }
    if (shownScenario().phase !== 'off') stopScenario();
    if (shownEscort().phase !== 'off') stopEscort();
    if (shownHill().phase !== 'off') stopHill();
    if (shownAmbush().phase !== 'off') stopMissionRun('ambush');
    if (shownNav().cps.length > 0) stopMapCourse();
    if (shownRun().phase !== 'idle') stopRun();
    if (enemyShared().on) startEnemies(false);
    repairTank();
    resetTank('warm');
    setAmmoRack(mission === 'hill' ? 'ap' : 'mixed');
    const t = tankState();
    this.px = t.x;
    this.pz = t.z;
    startReportRun(this.shown, mission, true);
    this.sayMarch(mission);
    console.info(`[Report] march to ${mission} begun`);
  }

  stopMarch(): void {
    if (!netLink.isHost) {
      const event = { t: 'report-ask', stop: true };
      netLink.sendEvent(event);
      return;
    }
    if (!this.shown.march) return;
    stopReportRun(this.shown);
    console.info('[Report] march stopped');
  }

  update(delta: number): void {
    this.time += delta;
    const s = this.shown;
    if (netLink.isHost) this.host(delta);
    else if (s.mission !== '' && !reportDone(s)) s.time += delta;
    if (s.v !== this.mapV) {
      this.mapV = s.v;
      this.drawMap();
    }
    if (this.sign.visible) {
      if (this.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }

  /** The host's part: follow the missions, step the route, and keep the guest told. */
  private host(delta: number): void {
    const s = this.shown;
    const t = tankState();
    const escort = shownEscort();
    const restarted = escort.phase === 'on' && escort.time < this.escortTime - 1;
    this.escortTime = escort.time;
    for (const m of ROUTE_MISSIONS) {
      const phase = missionPhase(m);
      const was = this.phases[m];
      this.phases[m] = phase;
      if (phase === was && !(m === 'escort' && restarted)) continue;
      // The convoy's route begins with the escort (at the start, or 210 m up the road on Ambush), and again on a Restart.
      if (m === 'escort' && phase === 'on') {
        startReportRun(s, 'escort', false);
        catchUpReportRun(s, t.z);
        this.talliedV = -1;
        console.info('[Report] escort route begun');
      } else if (s.mission === m && !s.march) {
        if (phase === 'off') stopReportRun(s);
        else if ((phase === 'won' || phase === 'lost') && this.talliedV !== s.v) {
          this.talliedV = s.v;
          crewLog.post(reportTally(s), reportDone(s) ? 'good' : 'info');
        }
      }
    }
    // On a march, another fight, a range run or the map course starting ends it: the board shows one thing at a time.
    if (s.march) {
      const busy =
        shownScenario().phase === 'on' ||
        shownEscort().phase === 'on' ||
        shownHill().phase === 'on' ||
        shownAmbush().phase === 'on' ||
        shownRun().phase === 'running' ||
        (shownNav().on && shownNav().cps.length > 0);
      if (busy) {
        stopReportRun(s);
        console.info('[Report] march stopped: something else began');
      }
    }
    // Frozen while the crewmate is away, like the rest of the host's simulation.
    if (!crewPresence.paused) {
      const wasSl = s.slAt;
      const wasNext = s.next;
      const step: ReportStep = stepReportRun(s, this.px, this.pz, t.x, t.z, delta);
      if (step !== null) {
        this.announce(wasSl, wasNext, step === 'position');
        if (step === 'position') {
          // In position: the mission begins where the tank stands, running.
          if (s.mission === 'hill') beginHillInPlace();
          else if (s.mission === 'ambush') startMissionInPlace('ambush');
          // The mission's start doesn't stop its own route.
          this.phases[s.mission as RouteMission] = missionPhase(s.mission as RouteMission);
        }
      }
    }
    this.px = t.x;
    this.pz = t.z;
    this.sinceSend += delta;
    const joined = netLink.connected && !this.wasConnected;
    if (netLink.connected && (joined || s.v !== this.sentV || (s.mission !== '' && this.sinceSend > RESYNC_SECONDS))) {
      netLink.sendEvent(reportEvent(s));
      this.sentV = s.v;
      this.sinceSend = 0;
    }
    this.wasConnected = netLink.connected;
  }

  /** The calls for what the route passed since (wasSl, wasNext), on the board here; `position`, the last on a march. */
  private announce(wasSl: number, wasNext: number, position: boolean): void {
    const s = this.shown;
    if (s.mission === '') return;
    if (wasSl < 0 && s.slAt >= 0) crewLog.post(reportCall(s, 'sl'), 'good');
    if (s.next > wasNext) {
      // Calls for each point passed (a guest that missed one gets them together; the last is the one to say).
      const call = reportCall(s, position ? 'position' : 'rp');
      // In position, the mission's own briefing takes the sign.
      crewLog.post(call, 'good');
    }
  }

  private drawMap(): void {
    const s = this.shown;
    if (s.mission === '') {
      showMapRoute(null);
      return;
    }
    const route = ROUTES[s.mission];
    this.points.length = 0;
    route.points.forEach((p, k) => this.points.push({ x: p.x, z: p.z, n: k + 1, done: k < s.next, label: p.label }));
    showMapRoute({ sl: { a: route.start.a, b: route.start.b, crossed: s.slAt >= 0 }, points: this.points });
  }

  /** The march's briefing, on both pages. */
  private sayMarch(mission: RouteMission): void {
    const [title, line] = marchBriefing(mission);
    const sl = ROUTES[mission].start;
    this.say(title, line, `SL across the road at ${gridRef((sl.a[0] + sl.b[0]) / 2, (sl.a[1] + sl.b[1]) / 2, 6)}: the map has the route in blue`);
    crewLog.post(title, 'info');
  }

  private say(title: string, line1: string, line2: string): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(title, width / 2, 64, width - 30);
    ctx.font = '25px sans-serif';
    ctx.fillText(line1, width / 2, 118, width - 30);
    ctx.fillText(line2, width / 2, 160, width - 30);
    this.sign.refresh();
    this.sign.setVisible(true, 'setup');
    this.signText = `${title}. ${line1} ${line2}`.trim();
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[Report] sign: ${this.signText}`);
  }
}
