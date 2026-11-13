import { createSystem, VisibilityState } from '@iwsdk/core';
import { crewPresence } from '../net/crew-presence.js';
import {
  BOX_Z,
  boxSpot,
  copyCourseSnapshot,
  COURSE_PATH,
  COURSE_START,
  COURSE_TARGETS,
  courseEvent,
  courseLine,
  CourseProgress,
  type CourseSnapshot,
  createCourseSnapshot,
  GATES,
  PENALTY_PATH,
  readCourseEvent,
} from '../sim/course.js';
import { placeTank, startEngine, tankState } from './drive-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';

/** How long a note (a lap, a missed gate, a penalty loop, a halt in a box) stays on the sign, s. */
const NOTE_SECONDS = 3;

let active: CourseSystem | null = null;

/**
 * Practice → Biathlon → Course: the tank parked on the course's east side
 * short of the start line, facing up it, so the first lap starts as it
 * drives off. Alone, the player takes the driver's seat; in a crew the seats
 * stay. The progress starts again (the tank jumped).
 */
export function goToCourse(): void {
  if (!netLink.connected) seating.ask('driver');
  placeTank(COURSE_START.x, COURSE_START.z, COURSE_START.heading);
}

/**
 * Practice → Biathlon → Line 1 or Line 2: the tank parked in firing box
 * `k` with its engine running for the power traverse, the line's three
 * boards down its lane behind the tank, at 6 o'clock. Alone, the player takes the
 * gunner's seat; in a crew the seats stay.
 */
export function goToFiringLine(k: number): void {
  if (!(k >= 0 && k < BOX_Z.length)) return;
  if (!netLink.connected) seating.ask('gunner');
  const [x, z, heading] = boxSpot(k);
  placeTank(x, z, heading);
  startEngine();
}

/** One line for the game menu. */
export function courseStatus(): string {
  return active ? courseLine(active.progress.s) : '';
}

/** The crew's progress round the course as this page shows it (the host's own, or its word on a guest): for F5.3b's race. */
export function shownCourse(): Readonly<CourseSnapshot> {
  return active?.progress.s ?? createCourseSnapshot();
}

interface CourseDebug {
  /** The progress as this page shows it, and the menu's line. */
  state(): CourseSnapshot & { line: string };
  /** Where the course's gates, boxes and boards stand (world space), and its length. */
  layout(): {
    length: number;
    penalty: number;
    gates: { x: number; z: number; heading: number }[];
    boxes: number[][];
    boards: { x: number; z: number; name: string }[];
  };
  /** The course's middle line `s` m along from the finish line (tests drive along it). */
  pointAt(s: number): { x: number; z: number; heading: number };
  go(): void;
  line(k: number): void;
  readonly sign: string;
  /** Frames this system has run: a test waits for one to pass after moving the tank. */
  readonly frames: number;
  readonly sent: number;
  readonly received: number;
}

/**
 * The biathlon course (F5.3a, docs/biathlon-course.md). The course itself
 * is geometry built into the ground's model (course.scene-asset.ts), and its
 * boards are among the shells' targets (ballistics' targetFaces), so what is
 * left for a system is the crew's progress round it.
 *
 * The host follows the tank round the course (src/sim/course.ts's
 * CourseProgress): the start line, each gate passed on a lap, laps counted
 * or not (a missed gate), penalty loops, and the firing box the tank halts
 * in, with a lap clock that stands still while the crewmate is away. It
 * sends that as a reliable `course` event whenever it changes; the guest
 * copies it and runs the lap clock on between events. Each note (Lap 1: go!,
 * a lap's time, a missed gate, a penalty loop, a halt in a box) goes on a
 * sign in front of each player for a few seconds. Runs after DriveSystem.
 */
export class CourseSystem extends createSystem({}) {
  readonly progress = new CourseProgress();
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private shownNote = 0;
  private sentVersion = -1;
  private wasConnected = false;
  private time = 0;
  private sent = 0;
  private received = 0;
  private frames = 0;

  init(): void {
    active = this;
    this.sign = new FloatingSign('Course Sign', 0.8, [512, 120], 1.1, 0.24);
    this.world.createTransformEntity(this.sign.mesh);
    netLink.events.set('course', (e) => this.onCourse(e));
    this.cleanupFuncs.push(
      () => netLink.events.delete('course'),
      () => {
        if (active === this) active = null;
      },
    );

    const self = this;
    (window as unknown as { __course: CourseDebug }).__course = {
      state: () => ({ ...copyCourseSnapshot(self.progress.s, createCourseSnapshot()), line: courseLine(self.progress.s) }),
      layout: () => ({
        length: COURSE_PATH.length,
        penalty: PENALTY_PATH.length,
        gates: GATES.map((g) => ({ x: g.x, z: g.z, heading: g.heading })),
        boxes: BOX_Z.map((_, k) => boxSpot(k)),
        boards: COURSE_TARGETS.map((t) => ({ x: t.x, z: t.z, name: t.name })),
      }),
      pointAt: (at) => {
        const p = COURSE_PATH.at(at);
        return { x: p.x, z: p.z, heading: p.heading };
      },
      go: () => goToCourse(),
      line: (k) => goToFiringLine(k),
      get sign() { return self.sign.visible ? self.signText : ''; },
      get sent() { return self.sent; },
      get received() { return self.received; },
      get frames() { return self.frames; },
    };
  }

  /** The host's word on the progress. */
  private onCourse(e: Record<string, unknown>): void {
    if (netLink.isHost) return;
    const incoming = createCourseSnapshot();
    const read = readCourseEvent(e, incoming);
    if (read == null) return;
    this.received++;
    const age = netLink.clockSynced ? (performance.now() - netLink.toLocal(read.at)) / 1000 : 0;
    this.progress.apply(incoming, age);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.25);
    this.time += dt;
    this.frames++;
    const progress = this.progress;
    if (netLink.isHost) {
      progress.setPaused(netLink.connected && crewPresence.paused);
      const tank = tankState();
      progress.step(dt, tank.x, tank.z, tank.speed);
      const joined = netLink.connected && !this.wasConnected;
      if (netLink.connected && (joined || progress.version !== this.sentVersion)) {
        netLink.sendEvent(courseEvent(progress.s, performance.now()));
        this.sent++;
      }
      this.sentVersion = progress.version;
    } else {
      progress.follow(dt);
    }
    this.wasConnected = netLink.connected;
    this.drawSign(delta);
  }

  /** A new note from the host goes on the sign for a few seconds. */
  private drawSign(delta: number): void {
    const s = this.progress.s;
    if (s.noteId !== this.shownNote) {
      // The first note heard on joining is old news.
      const fresh = this.shownNote !== 0 || netLink.isHost;
      this.shownNote = s.noteId;
      if (fresh && s.note !== '') {
        this.signText = s.note;
        this.signUntil = this.time + NOTE_SECONDS;
        const { ctx, width, height } = this.sign;
        drawSignBackground(ctx, width, height);
        ctx.fillStyle = '#f4ead8';
        ctx.textAlign = 'center';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(s.note, width / 2, height / 2 + 14, width - 30);
        this.sign.refresh();
        this.sign.setVisible(true);
        console.info(`[Course] ${s.note}`);
      }
    }
    if (this.sign.visible && this.time > this.signUntil) this.sign.setVisible(false);
    if (this.sign.visible) {
      this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
  }
}
