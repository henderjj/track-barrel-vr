import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import {
  BRIEFING,
  type CombatTuning,
  debriefLines,
  defaultTuning,
  noScenario,
  parseScenario,
  parseTuning,
  SCENARIO,
  ScenarioRun,
  type ScenarioSnapshot,
  scenarioLine,
  setTune,
  type TuneKey,
  tuningLine,
} from '../sim/combat.js';
import { damageState, repairTank, setKnockOut } from './damage-system.js';
import { resetTank, tankState } from './drive-system.js';
import { bringTanks, enemyShared, enemyShotsFired, enemySpotted, holdEnemyFire, setBatteryTuning, startBattle } from './enemy-system.js';
import { FIRST_TANK } from '../sim/enemy-guns.js';
import { crewLog } from '../sim/crew-board.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { setAmmoRack } from './loading-system.js';
import { netLink } from './net-system.js';

/** The host sends the scenario again this often while it runs, s, in case a guest missed it. */
const RESYNC_SECONDS = 5;
/** How long the briefing and the debrief stay on the sign, s. */
const BRIEF_SECONDS = 8;
const DEBRIEF_SECONDS = 15;
/** Where the host keeps its tuning between visits (per browser; the guest is told the host's). */
const TUNING_KEY = 'trackBarrel.combatTuning';

let active: CombatSystem | null = null;

/** The scenario and the tuning as this page shows them (F3.10). */
export function shownScenario(): Readonly<ScenarioSnapshot> {
  return active?.shown ?? noScenario();
}

/** One line for the menu: the scenario's state, or its debrief. */
export function scenarioStatus(): string {
  return scenarioLine(shownScenario());
}

/** One line for the menu: what differs from the recommended tuning. */
export function tuningStatus(): string {
  return tuningLine(shownScenario().tune);
}

/** Battle → Advance to contact → Start (or Restart). The host does it; a guest asks. */
export function startScenario(): void {
  if (!netLink.isHost) {
    const event = { t: 'combat-ask', start: true };
    netLink.sendEvent(event);
    return;
  }
  active?.start();
}

/** Battle → Advance to contact → Stop: the enemy goes. */
export function stopScenario(): void {
  if (!netLink.isHost) {
    const event = { t: 'combat-ask', stop: true };
    netLink.sendEvent(event);
    return;
  }
  active?.stop();
}

/** A Battle tab tuning button. The host decides; a guest asks. */
export function setCombatTune(key: TuneKey, value: number): void {
  if (!netLink.isHost) {
    const event = { t: 'combat-ask', key, value };
    netLink.sendEvent(event);
    return;
  }
  active?.tune(key, value);
}

/** Battle → Tuning → Recommended: every value back to the recommended. */
export function resetCombatTuning(): void {
  if (!netLink.isHost) {
    const event = { t: 'combat-ask', reset: true };
    netLink.sendEvent(event);
    return;
  }
  active?.resetTuning();
}

interface CombatDebug {
  state(): ScenarioSnapshot;
  start(): void;
  stop(): void;
  tune(key: TuneKey, value: number): void;
  resetTuning(): void;
  readonly sign: string;
}

/**
 * The combat scenario and the fight's tuning (F3.10,
 * docs/combat-scenario.md). The host keeps the tuning (saved in this
 * browser), hands it to the enemy battery and the damage model, and runs
 * the scenario: the tank at the start, mended and warm with a mixed rack,
 * the guns and the tanks brought in with the scenario's seed, and the run
 * judged each frame (the objective reached, every enemy knocked out, or the
 * tank knocked out). It sends the scenario and the tuning to the guest
 * (`combat`, reliable) and takes a guest's asks (`combat-ask`). Both pages
 * show the briefing and the debrief on a sign. Registered after
 * DamageSystem, whose state it reads.
 */
export class CombatSystem extends createSystem({}) {
  readonly run = new ScenarioRun();
  tuning: CombatTuning = defaultTuning();
  /** What this page shows: the host's run with its tuning; a guest's as last told. */
  shown: ScenarioSnapshot = noScenario();
  private time = 0;
  private sentV = -1;
  private sentAt = 0;
  private wasConnected = false;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private lastPhase: ScenarioSnapshot['phase'] = 'off';

  init(): void {
    active = this;
    this.tuning = loadTuning();
    this.shown.tune = { ...this.tuning };
    this.applyTuning();
    this.sign = new FloatingSign('Combat Sign', 0.95, [640, 150], 1.1, -0.06);
    this.world.createTransformEntity(this.sign.mesh);

    netLink.events.set('combat', (e) => {
      if (netLink.isHost) return;
      const s = parseScenario(e);
      if (s) this.show(s);
    });
    netLink.events.set('combat-ask', (e) => {
      if (!netLink.isHost) return;
      const ask = e as { start?: unknown; stop?: unknown; key?: unknown; value?: unknown; reset?: unknown };
      if (ask.start === true) this.start();
      else if (ask.stop === true) this.stop();
      else if (ask.reset === true) this.resetTuning();
      else if (typeof ask.key === 'string' && typeof ask.value === 'number') this.tune(ask.key as TuneKey, ask.value);
    });
    this.cleanupFuncs.push(
      () => netLink.events.delete('combat'),
      () => netLink.events.delete('combat-ask'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __combat: CombatDebug }).__combat = {
      state: () => ({ ...self.shown, tune: { ...self.shown.tune } }),
      start: () => startScenario(),
      stop: () => stopScenario(),
      tune: (key, value) => setCombatTune(key, value),
      resetTuning: () => resetCombatTuning(),
      get sign() {
        return self.sign.visible ? self.signText : '';
      },
    };
  }

  /** Host: start the scenario afresh. */
  start(): void {
    if (!netLink.isHost) return;
    repairTank();
    resetTank('warm');
    setAmmoRack('mixed');
    startBattle(true, SCENARIO.seed);
    this.run.start(this.tuning);
    this.publish();
    console.info(`[Combat] scenario started. ${tuningLine(this.tuning)}`);
  }

  /** Host: stop it: the enemy goes. */
  stop(): void {
    if (!netLink.isHost) return;
    this.run.stop();
    startBattle(false);
    this.publish();
    console.info('[Combat] scenario stopped');
  }

  /** Host: one tuning value; it applies at once, the scenario running or not. */
  tune(key: TuneKey, value: number): void {
    if (!netLink.isHost || !setTune(this.tuning, key, value)) return;
    this.tuningChanged();
  }

  /** Host: every tuning value back to the recommended. */
  resetTuning(): void {
    if (!netLink.isHost) return;
    this.tuning = defaultTuning();
    this.tuningChanged();
  }

  private tuningChanged(): void {
    saveTuning(this.tuning);
    this.applyTuning();
    this.run.snap.tune = { ...this.tuning };
    this.run.snap.v++;
    this.publish();
    console.info(`[Combat] ${tuningLine(this.tuning)}`);
  }

  /** Host: hand the tuning to the battery and the damage model. */
  private applyTuning(): void {
    if (!netLink.isHost) return;
    setBatteryTuning(this.tuning);
    setKnockOut(this.tuning.knockOut);
  }

  /** Host: show the run here (the guest is told in update). */
  private publish(): void {
    this.show({ ...this.run.snap, tune: { ...this.tuning } });
  }

  /** Take the scenario as the host has it; a change of phase puts the briefing or the debrief on the sign. */
  private show(s: ScenarioSnapshot): void {
    const was = this.lastPhase;
    this.shown = s;
    this.lastPhase = s.phase;
    if (s.phase === was) return;
    if (s.phase === 'on') this.note(BRIEFING[0], BRIEFING[1], BRIEF_SECONDS, false);
    else if (s.phase === 'won' || s.phase === 'lost') {
      const [head, counts] = debriefLines(s);
      this.note(head, counts, DEBRIEF_SECONDS, s.phase === 'lost');
      console.info(`[Combat] debrief: ${head}. ${counts}. ${tuningLine(s.tune)}`);
    }
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    if (netLink.isHost) this.host(dt);
    else if (this.shown.phase === 'on' && !(netLink.connected && crewPresence.paused)) this.shown.time += dt;
    this.drawSign(delta);
  }

  /** The host's part: judge the run, and keep the guest told. */
  private host(dt: number): void {
    const paused = netLink.connected && crewPresence.paused;
    if (this.run.snap.phase === 'on' && !paused) {
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
      const tanksWere = this.run.snap.tanksIn;
      const d = damageState();
      const ended = this.run.step(dt, {
        z: tankState().z,
        out: d.out,
        spotted: enemySpotted(),
        gunsKilled,
        killed,
        enemies,
        shots: enemyShotsFired(),
        hits: d.hits,
        through: d.through,
      });
      if (this.run.snap.tanksIn && !tanksWere) bringTanks();
      // Won, the enemy holds its fire while the crew reads the debrief; lost, it already does (knocked out).
      if (ended) holdEnemyFire(true);
      if (ended || this.run.snap.v !== this.shown.v) this.publish();
      else this.shown.time = this.run.snap.time;
    }
    const joined = netLink.connected && !this.wasConnected;
    const resync = this.run.snap.phase === 'on' && this.time - this.sentAt >= RESYNC_SECONDS;
    if (netLink.connected && (joined || resync || this.sentV !== this.run.snap.v)) {
      const event = { t: 'combat', ...this.run.snap, tune: { ...this.tuning } };
      netLink.sendEvent(event);
      this.sentV = this.run.snap.v;
      this.sentAt = this.time;
    }
    this.wasConnected = netLink.connected;
  }

  private note(head: string, line: string, seconds: number, bad: boolean): void {
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
    // The board already shows the objective and the counts: its call is the head.
    crewLog.post(head, bad ? 'bad' : this.shown.phase === 'won' ? 'good' : 'info');
    console.info(`[Combat] sign: ${this.signText}`);
  }

  private drawSign(delta: number): void {
    if (this.sign.visible && this.time > this.signUntil) this.sign.setVisible(false);
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}

/** The tuning this browser kept, or the recommended. */
function loadTuning(): CombatTuning {
  try {
    const raw = localStorage.getItem(TUNING_KEY);
    return (raw && parseTuning(JSON.parse(raw))) || defaultTuning();
  } catch {
    return defaultTuning();
  }
}

function saveTuning(t: Readonly<CombatTuning>): void {
  try {
    localStorage.setItem(TUNING_KEY, JSON.stringify(t));
  } catch {
    // Private windows may refuse; the tuning still holds for this visit.
  }
}
