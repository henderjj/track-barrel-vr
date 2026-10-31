import { createSystem } from '@iwsdk/core';
import { settings } from '../settings.js';
import {
  createTally,
  type Crewmate,
  crewStatsEvent,
  fumbleGroup,
  lastRunLine,
  queasyRow,
  readCrewStats,
  RunRecorder,
  runRow,
  type RowContext,
  type RunTally,
  StatsLog,
  type StatsRow,
  stepTally,
  visitRow,
  wallClock,
} from '../sim/play-stats.js';
import { formatRunTime } from '../sim/range-run.js';
import { shownDriverState, tankBumps, tankState } from './drive-system.js';
import { type FumbleHow, fumbleListeners, squeezeNear } from './fumbles.js';
import { handUse } from './grip-system.js';
import { netLink } from './net-system.js';
import { shownRun } from './range-run-system.js';
import { seating } from './seating.js';

/** Where the log is kept in this browser between visits. */
const STORAGE_KEY = 'track-barrel.stats';
const SIDES = ['left', 'right'] as const;

let active: PlayStatsSystem | null = null;

/** Comfort → I feel queasy: a row saying when, in which seat and how the tank was moving. */
export function markQueasy(): void {
  active?.markQueasy();
}

/** Comfort → Save CSV: the log as a file (in VR it lands in the browser's downloads). */
export function saveStatsCsv(): void {
  if (active) downloadText(active.csv(), `track-barrel-stats-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
}

/** Comfort → Clear: forget the rows kept in this browser. */
export function clearStats(): void {
  active?.clear();
}

/** One line for the game menu: the last run, and how many rows are kept. */
export function statsStatus(): string {
  return active ? active.status() : '';
}

interface StatsDebug {
  rows(): StatsRow[];
  csv(): string;
  /** What this player has done in the run on now, and since the page loaded. */
  tally(): RunTally;
  visit(): RunTally;
  readonly counting: boolean;
  readonly line: string;
  queasy(): void;
  clear(): void;
  /** Count a fumble as if a hand had made it (tests). */
  fumble(control: string, how?: FumbleHow): void;
  readonly sent: number;
  readonly received: number;
}

/**
 * Play-test stats (F1.14, docs/comfort-stats.md). Each page watches the
 * range run as it shows it (F1.11's `shownRun()`) and, while the run's
 * clock runs, counts what its own player does: seconds in each seat,
 * seconds talking (and hearing the crewmate talk), fumbles per control
 * (src/systems/fumbles.ts), the gears grinding and queasy marks. When a run
 * ends (done, stopped or restarted) it writes a row, keeps the log in this
 * browser, and sends its numbers to the crewmate's page (a reliable
 * `run-stats` event) so either player's CSV has the whole crew; the
 * practice crewmate's page sends its own too. Counts the whole visit as
 * well, written as a last row when the CSV is saved. Runs after every
 * system that holds a hand, so a squeeze the loading took a shell with is
 * no miss.
 */
export class PlayStatsSystem extends createSystem({}) {
  readonly log = new StatsLog();
  private recorder = new RunRecorder();
  /** Everything since the page loaded. */
  private visit = createTally();
  private seconds = 0;
  private wasGrinding = false;
  /** The tank's stall count when last looked at (-1 before the first). */
  private stallsSeen = -1;
  private sent = 0;
  private received = 0;
  private lastMark = '';

  init(): void {
    active = this;
    try {
      this.log.load(localStorage.getItem(STORAGE_KEY));
    } catch {
      // Private browsing: the log lasts for this visit only.
    }
    const onFumble = (control: string, how: FumbleHow) => this.fumble(control, how);
    fumbleListeners.add(onFumble);
    netLink.events.set('run-stats', (e) => {
      const read = readCrewStats(e);
      if (!read) return;
      this.received++;
      this.log.addCrew(read.run, read.crew);
      this.keep();
    });
    this.cleanupFuncs.push(
      () => fumbleListeners.delete(onFumble),
      () => netLink.events.delete('run-stats'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __stats: StatsDebug }).__stats = {
      rows: () => self.log.rows.map((r) => ({ ...r, fumbles: [...r.fumbles], crew: r.crew && { ...r.crew } })),
      csv: () => self.csv(),
      tally: () => ({ ...self.recorder.tally, fumbles: [...self.recorder.tally.fumbles] }),
      visit: () => ({ ...self.visit, fumbles: [...self.visit.fumbles] }),
      get counting() { return self.recorder.counting; },
      get line() { return self.status(); },
      queasy: () => self.markQueasy(),
      clear: () => self.clear(),
      fumble: (control, how = 'miss') => self.fumble(control, how),
      get sent() { return self.sent; },
      get received() { return self.received; },
    };
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.seconds += dt;
    // A squeeze that nothing took hold of, near a control: a miss.
    for (const side of SIDES) {
      const near = squeezeNear[side];
      if (near !== null && near !== '' && handUse[side] === null) this.fumble(near, 'miss');
      squeezeNear[side] = null;
    }
    const grinding = shownDriverState()?.grinding ?? false;
    if (grinding && !this.wasGrinding) {
      this.visit.grinds++;
      if (this.recorder.counting) this.recorder.tally.grinds++;
    }
    this.wasGrinding = grinding;
    // The engine stalling while this player drives (F1.17): the count's changes, as a guest's wraps at 256.
    const stalls = shownDriverState()?.stalls ?? -1;
    if (this.stallsSeen >= 0 && stalls >= 0 && stalls !== this.stallsSeen && seating.mine === 'driver') {
      this.visit.stalls++;
      if (this.recorder.counting) this.recorder.tally.stalls++;
    }
    this.stallsSeen = stalls;

    const end = this.recorder.watch(shownRun());
    if (end) {
      this.log.add(runRow(end, this.context()));
      this.keep();
      if (netLink.connected) {
        netLink.sendEvent(crewStatsEvent(end.run, end.tally, settings.bot));
        this.sent++;
      }
      console.info(`[Stats] ${this.status()}`);
    }
    const mic = netLink.micLevel();
    const crew = netLink.connected ? netLink.crewLevel() : 0;
    stepTally(this.visit, dt, seating.mine, mic, crew);
    if (this.recorder.counting) stepTally(this.recorder.tally, dt, seating.mine, mic, crew);
  }

  private fumble(control: string, how: FumbleHow): void {
    const group = fumbleGroup(control);
    this.visit.fumbles[group]++;
    if (this.recorder.counting) this.recorder.tally.fumbles[group]++;
    console.info(`[Stats] fumble (${how}): ${control}`);
  }

  markQueasy(): void {
    const run = shownRun();
    const running = run.phase === 'running';
    const tank = tankState();
    const turn = tank.yawRate + (seating.mine === 'gunner' ? seating.turretRate : 0);
    const clock = running ? Math.max(0, run.clock) : -1;
    this.log.add(queasyRow(running ? run.id : 0, clock, tank.speed, turn, this.context()));
    this.visit.queasy++;
    if (running) this.recorder.tally.queasy++;
    this.keep();
    this.lastMark = running ? `at ${formatRunTime(clock)} into run ${run.id}` : 'outside a run';
    console.info(`[Stats] feeling queasy ${this.lastMark}, ${(tank.speed * 3.6).toFixed(0)} km/h`);
  }

  clear(): void {
    this.log.clear();
    this.lastMark = '';
    this.keep();
  }

  csv(): string {
    return this.log.csv(visitRow(this.visit, this.seconds, this.context()));
  }

  status(): string {
    const mark = this.lastMark ? ` Marked queasy ${this.lastMark}: take a break if you need one.` : '';
    return lastRunLine(this.log) + mark;
  }

  private context(): RowContext {
    const crewmate: Crewmate = netLink.connected ? 'player' : 'none';
    return {
      at: wallClock(new Date()),
      seat: seating.mine,
      crewmate,
      vignette: settings.vignette,
      bumps: tankBumps(),
      label: settings.label,
    };
  }

  /** Keep the log in this browser. */
  private keep(): void {
    try {
      if (this.log.rows.length > 0) localStorage.setItem(STORAGE_KEY, this.log.toJSON());
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private browsing or a full store: the log lasts for this visit.
    }
  }
}

function downloadText(text: string, name: string): void {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
