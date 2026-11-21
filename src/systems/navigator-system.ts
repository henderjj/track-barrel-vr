import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewLog } from '../sim/crew-board.js';
import { FIELD_MAP, gridRef } from '../sim/field-map.js';
import { NAV_PLACES, navDone } from '../sim/nav-course.js';
import { onMap } from '../sim/map-marks.js';
import { planPath } from '../sim/nav-path.js';
import { goOrder, type GotoEvent, HEADING_EVERY, headingOrder, parseGoto, type SpotFrom, spotFrom } from '../sim/navigator.js';
import { botCommanding, botDriving, botGoTo } from './crew-bot-system.js';
import { tankState } from './drive-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { onMapTouch, showMapGoal } from './map-case-system.js';
import { shownNav } from './nav-course-system.js';
import { netLink } from './net-system.js';

const SIGN_SECONDS = 6;

interface NavigatorDebug {
  /** The goal as this page has it, the last order given or heard, the headings the crewmate gave, and the sign. */
  state(): { goal: number[] | null; lastOrder: string; headings: number; lastHeading: string; sign: string; lastSign: string };
}

/**
 * The commander navigating (F2.13, docs/navigator.md). A touch on the map
 * (MapCaseSystem) is an order to the driver: this page pencils the spot in
 * blue, logs "Driver, go to 046036: 045°, 320 m, right 30°" and sends
 * `nav-goto`; the other page pencils it too and shows the order on a sign
 * and the board, and the practice crewmate, driving, plans a way round
 * houses, walls, the ditch, the stream and the mud (src/sim/nav-path.ts)
 * and drives there. The practice crewmate as gunner is the commander on
 * the map course: it gives the driver the next checkpoint's bearing,
 * distance and turn (`nav-heading`) at the start, at each checkpoint and
 * every HEADING_EVERY s.
 */
export class NavigatorSystem extends createSystem({}) {
  private goal: { x: number; z: number } | null = null;
  private lastOrder = '';
  private headings = 0;
  private lastHeading = '';
  private sinceHeading = 0;
  private headedFor = -1;
  private headedRun = -1;
  private spot: SpotFrom = { bearing: 0, distance: 0, turn: 0 };
  /** The tank on the map's copy of the ground. */
  private onMapAt: [number, number] = [0, 0];
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;

  init(): void {
    this.sign = new FloatingSign('Navigator Sign', 0.85, [720, 160], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);
    onMapTouch((x, z) => this.order(x, z));
    netLink.events.set('nav-goto', (e) => {
      const at = parseGoto(e, FIELD_MAP);
      if (at) this.heard(at.x, at.z);
    });
    netLink.events.set('nav-heading', (e) => {
      const text = typeof e.text === 'string' ? e.text.slice(0, 80) : '';
      if (!text) return;
      this.lastHeading = text;
      this.headings++;
      crewLog.post(`Commander: ${text}`);
      this.say('Commander', text);
    });
    this.cleanupFuncs.push(
      () => onMapTouch(null),
      () => netLink.events.delete('nav-goto'),
      () => netLink.events.delete('nav-heading'),
    );
    const self = this;
    (window as unknown as { __navigator: NavigatorDebug }).__navigator = {
      state: () => ({
        goal: self.goal ? [self.goal.x, self.goal.z] : null,
        lastOrder: self.lastOrder,
        headings: self.headings,
        lastHeading: self.lastHeading,
        sign: self.sign.visible ? self.signText : '',
        lastSign: self.signText,
      }),
    };
  }

  /** This player touched the map: the order to the driver, here and on the crewmate's page. */
  private order(x: number, z: number): void {
    const t = tankState();
    const [mx, mz] = onMap(t.x, t.z, this.onMapAt);
    const words = goOrder(spotFrom(mx, mz, t.heading, x, z, this.spot), x, z);
    this.setGoal(x, z, words);
    crewLog.post(`You: ${words}`);
    if (netLink.connected) {
      const event: GotoEvent = { t: 'nav-goto', x, z };
      netLink.sendEvent(event);
      this.say('To the driver', words);
    } else this.say('No driver aboard', words);
    console.info(`[Navigator] order: ${words}`);
  }

  /** The crewmate's order heard: the spot on this map, the order on the sign and the board, and the practice crewmate driving there. */
  private heard(x: number, z: number): void {
    const t = tankState();
    const [mx, mz] = onMap(t.x, t.z, this.onMapAt);
    const words = goOrder(spotFrom(mx, mz, t.heading, x, z, this.spot), x, z);
    this.setGoal(x, z, words);
    crewLog.post(`Commander: ${words}`);
    this.say('Commander', words);
    if (!botDriving()) return;
    // The spot as the map shows it, from where the map has the tank, back on the tank's own copy of the ground.
    const path = planPath(mx, mz, x, z).map(([px, pz]): [number, number] => [px + t.x - mx, pz + t.z - mz]);
    if (botGoTo(path, gridRef(x, z, 6))) console.info(`[Navigator] driving there by ${path.length} legs`);
  }

  private setGoal(x: number, z: number, words: string): void {
    this.goal = { x, z };
    this.lastOrder = words;
    showMapGoal(this.goal);
  }

  update(delta: number): void {
    this.time += delta;
    this.commandCourse(delta);
    if (this.sign.visible) {
      if (this.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }

  /** The practice crewmate as commander on the map course: the next checkpoint's heading, at the start, at each checkpoint and every HEADING_EVERY s. */
  private commandCourse(delta: number): void {
    const run = shownNav();
    if (!botCommanding() || !run.on || navDone(run)) {
      this.headedFor = -1;
      return;
    }
    this.sinceHeading += delta;
    const fresh = run.next !== this.headedFor || run.seed !== this.headedRun;
    if (!fresh && this.sinceHeading < HEADING_EVERY) return;
    this.headedFor = run.next;
    this.headedRun = run.seed;
    this.sinceHeading = 0;
    const t = tankState();
    const p = NAV_PLACES[run.cps[run.next]];
    const text = headingOrder(run.next + 1, spotFrom(t.x, t.z, t.heading, p.x, p.z, this.spot));
    this.lastHeading = text;
    this.headings++;
    const event = { t: 'nav-heading', text };
    netLink.sendEvent(event);
    crewLog.post(`You: ${text}`);
    console.info(`[Navigator] heading: ${text}`);
  }

  private say(title: string, line: string): void {
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(title, width / 2, 58);
    ctx.font = '28px sans-serif';
    ctx.fillText(line, width / 2, 112, width - 30);
    this.sign.refresh();
    this.sign.setVisible(true, 'game');
    this.signText = `${title}: ${line}`;
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[Navigator] sign: ${this.signText}`);
  }
}
