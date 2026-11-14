import { CanvasTexture, createSystem, type Entity, type Mesh, MeshBasicMaterial, type Object3D, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { createCrewBoard } from '../scene-assets/crew-board.scene-asset.js';
import { AMMO_KINDS, type AmmoKind } from '../sim/ammo.js';
import { SEAT_IDS, type SeatId } from '../sim/cabin.js';
import { courseLine } from '../sim/course.js';
import {
  BOARD_CALLS,
  type BoardCall,
  type BoardInput,
  boardKey,
  BOARDS,
  type BoardText,
  boardText,
  type CallTone,
  crewLog,
  type EnemyCount,
  toGo,
} from '../sim/crew-board.js';
import { FIRST_TANK } from '../sim/enemy-guns.js';
import { clockLines } from '../sim/range-run.js';
import { shownScenario } from './combat-system.js';
import { shownCourse } from './course-system.js';
import { damageState } from './damage-system.js';
import { tankState } from './drive-system.js';
import { enemyShared } from './enemy-system.js';
import { loadedRound, loadingShown } from './loading-system.js';
import { shownRun } from './range-run-system.js';

interface CrewBoardDebug {
  /** What the boards say now. */
  text(): BoardText;
  /** The digest of what was last drawn. */
  key(): string;
  /** How many times the face has been drawn. */
  readonly draws: number;
  /** Whether the board's fonts have loaded (the face is drawn in fallback fonts until they have). */
  readonly fonts: boolean;
  /** The calls in the log, oldest first. */
  calls(): readonly BoardCall[];
  /** Log a call as a system would (tests). */
  post(text: string, tone?: CallTone): void;
  /** The middle of `seat`'s board's paper in world space, and the way it faces (a unit vector). */
  face(seat: SeatId): { at: number[]; normal: number[] };
}

/** The canvas: the board's 4:3, about 3.2 px a millimetre on the driver's board. */
const PX_W = 1024;
const PX_H = 768;
const PHASES = ['off', 'on', 'won', 'lost'];
/** How often the board looks for a change, s. */
const LOOK_EVERY = 0.25;

const PAPER = '#efe6cc';
const RULE = '#3c3a30';
const LABEL = '#4a463a';
const INK = '#1a2a55';
const RED = '#b0261b';
const OLD = '#4f566e';
const DONE = '#6d6a5e';

const STENCIL = "'Stardos Stencil', 'Arial Black', sans-serif";
const TYPE = "'Special Elite', 'Courier New', monospace";
const HAND = "'Kalam', 'Comic Sans MS', sans-serif";

const FONTS: readonly (readonly [family: string, file: string, weight: string])[] = [
  ['Stardos Stencil', 'fonts/StardosStencil-Bold.woff2', '700'],
  ['Special Elite', 'fonts/SpecialElite-Regular.woff2', '400'],
  ['Kalam', 'fonts/Kalam-Bold.woff2', '700'],
];

/**
 * Clips a crew board up in each seat (F6.5, docs/crew-board.md): the
 * driver's to their front right, the gunner's on the turret wall to their
 * right, turning with it. Both papers show one canvas, drawn for this
 * page's seat (the gunner's calls carry their traverse). Four times a
 * second it checks what the board would show, and redraws only when that
 * has changed: the clock's second, the distance to go, a call, a hit, the
 * round in the gun.
 */
export class CrewBoardSystem extends createSystem({}) {
  private boards: { seat: SeatId; mesh: Mesh }[] = [];
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private time = 0;
  private lookAt = 0;
  private drawnKey = '';
  private draws = 0;
  private fontsReady = false;
  /** The last numbers looked at: a change in any means the board is built again. */
  private seen = new Float64Array(16).fill(Number.NaN);
  private now = new Float64Array(16);
  private rack: Record<AmmoKind, number> = { ap: 0, he: 0, smoke: 0 };
  private guns: EnemyCount = { out: 0, total: 0, in: false };
  private tanks: EnemyCount = { out: 0, total: 0, in: false };

  init(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PX_W;
    this.canvas.height = PX_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const material = new MeshBasicMaterial({ map: this.texture, toneMapped: false });
    for (const seat of SEAT_IDS) {
      const place = BOARDS[seat];
      const mesh = createCrewBoard(place, material);
      mesh.name = `Crew Board ${seat}`;
      const parent: Entity | undefined = this.world.getSceneEntity(place.frame) ?? undefined;
      if (parent === undefined) console.warn(`[CrewBoard] no ${place.frame} in the scene: the ${seat}'s board hangs in the world`);
      this.world.createTransformEntity(mesh, parent ? { parent } : undefined);
      this.boards.push({ seat, mesh });
    }
    this.cleanupFuncs.push(() => {
      this.texture.dispose();
      material.dispose();
      crewLog.now = () => 0;
    });
    crewLog.now = () => this.clock();
    this.loadFonts();

    const at = new Vector3();
    const normal = new Vector3();
    const paper = (seat: SeatId): Object3D => this.boards.find((b) => b.seat === seat)!.mesh.getObjectByName('Crew Board Paper')!;
    const self = this;
    (window as unknown as { __crewBoard: CrewBoardDebug }).__crewBoard = {
      text: () => boardText(this.boardInput()),
      key: () => this.drawnKey,
      get draws() {
        return self.draws;
      },
      get fonts() {
        return self.fontsReady;
      },
      calls: () => crewLog.entries,
      post: (text, tone) => {
        crewLog.post(text, tone);
      },
      face: (seat) => {
        const p = paper(seat);
        p.updateWorldMatrix(true, false);
        p.getWorldPosition(at);
        p.getWorldDirection(normal);
        return { at: at.toArray(), normal: normal.toArray() };
      },
    };
    this.redraw();
  }

  update(delta: number): void {
    this.time += Math.min(delta, 0.25);
    if (this.time < this.lookAt) return;
    this.lookAt = this.time + LOOK_EVERY;
    if (this.changed()) this.redraw();
  }

  /** Load the board's three faces from public/fonts, then draw again in them. A page that can't load them keeps the fallbacks. */
  private loadFonts(): void {
    if (typeof FontFace === 'undefined') return;
    const loads = FONTS.map(([family, file, weight]) =>
      new FontFace(family, `url(${import.meta.env.BASE_URL}${file})`, { weight }).load().then((face) => {
        document.fonts.add(face);
      }),
    );
    Promise.all(loads)
      .then(() => {
        this.fontsReady = true;
        this.drawnKey = '';
        this.redraw();
      })
      .catch((error: unknown) => console.warn(`[CrewBoard] fonts didn't load, drawing in the fallbacks: ${String(error)}`));
  }

  /** The board's clock, s: the fight's or the run's time while one is on, else the time since the game started. */
  private clock(): number {
    const s = shownScenario();
    if (s.phase !== 'off') return s.time;
    const r = shownRun();
    if (r.phase !== 'idle') return Math.max(0, r.clock);
    return this.time;
  }

  private timed(): boolean {
    return shownScenario().phase !== 'off' || shownRun().phase !== 'idle';
  }

  /** The numbers the board depends on, into `now`; whether any differs from last time. */
  private changed(): boolean {
    const n = this.now;
    const s = shownScenario();
    const run = shownRun();
    const course = shownCourse();
    const e = enemyShared();
    const loaded = loadedRound();
    const shells = loadingShown();
    let rack = 0;
    if (shells) for (let i = 0; i < shells.shells.length; i++) if (shells.shells[i].place === 'rack') rack += 1 + 8 * AMMO_KINDS.indexOf(shells.kinds[i]);
    n[0] = crewLog.v;
    n[1] = damageState().v;
    n[2] = s.v * 4 + PHASES.indexOf(s.phase);
    n[3] = e.v;
    n[4] = loaded ? AMMO_KINDS.indexOf(loaded) : -1;
    n[5] = rack;
    n[6] = s.phase === 'on' ? toGo(tankState().z) : -1;
    n[7] = this.timed() ? Math.floor(this.clock()) : -1;
    let hits = 0;
    for (const at of run.hitAt) if (at >= 0) hits++;
    n[8] = run.phase === 'idle' ? -1 : run.shots * 16 + hits;
    n[9] = course.started ? course.laps * 1000 + course.passed + course.penalties * 100 : -1;
    n[10] = this.fontsReady ? 1 : 0;
    let differs = false;
    for (let i = 0; i < 11; i++) {
      if (n[i] !== this.seen[i]) {
        differs = true;
        this.seen[i] = n[i];
      }
    }
    return differs;
  }

  /** What the board is built from, as this page shows the shared state. */
  private boardInput(): BoardInput {
    const run = shownRun();
    const course = shownCourse();
    const e = enemyShared();
    this.guns.out = 0;
    this.guns.total = 0;
    this.guns.in = false;
    this.tanks.out = 0;
    this.tanks.total = 0;
    this.tanks.in = false;
    e.present.forEach((present, i) => {
      if (!present) return;
      const c = i < FIRST_TANK ? this.guns : this.tanks;
      c.total++;
      c.in = true;
      if (!e.alive[i]) c.out++;
    });
    for (const k of AMMO_KINDS) this.rack[k] = 0;
    const shells = loadingShown();
    if (shells) shells.shells.forEach((shell, i) => shell.place === 'rack' && this.rack[shells.kinds[i]]++);
    let drill = '';
    let drillTasks: string[] = [];
    if (run.phase !== 'idle') {
      const [heading, time, count] = clockLines(run);
      drill = heading;
      drillTasks = [count, time].filter((t) => t !== '');
    } else if (course.started) {
      drill = 'Driving course';
      drillTasks = courseLine(course).split('. ').slice(0, 3);
    }
    return {
      clock: this.clock(),
      timed: this.timed(),
      scenario: shownScenario(),
      tankZ: tankState().z,
      guns: this.guns,
      tanks: this.tanks,
      damage: damageState(),
      loaded: loadedRound(),
      rack: this.rack,
      drill,
      drillTasks,
      calls: crewLog.latest(BOARD_CALLS),
    };
  }

  private redraw(): void {
    const text = boardText(this.boardInput());
    const key = boardKey(text);
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    this.draw(text);
    this.texture.needsUpdate = true;
    this.draws++;
  }

  /** The paper: the orders on the left, the tank and its damage on the right, the latest calls along the bottom. */
  private draw(t: BoardText): void {
    const ctx = this.ctx;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PX_W, PX_H);
    ctx.textBaseline = 'alphabetic';

    // Header.
    ctx.fillStyle = RULE;
    ctx.fillRect(0, 72, PX_W, 3);
    ctx.fillRect(0, 540, PX_W, 3);
    ctx.fillRect(520, 75, 3, 465);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#222';
    ctx.font = `700 46px ${STENCIL}`;
    ctx.fillText('ORDERS', 26, 56);
    if (t.clock) {
      ctx.textAlign = 'right';
      ctx.font = `40px ${TYPE}`;
      ctx.fillText(t.clock, PX_W - 26, 54);
    }

    // The orders.
    const label = (text: string, x: number, y: number) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = LABEL;
      ctx.font = `25px ${TYPE}`;
      ctx.fillText(text, x, y);
    };
    const hand = (text: string, x: number, y: number, maxWidth: number, colour: string, size = 38) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = colour;
      ctx.font = `700 ${size}px ${HAND}`;
      ctx.fillText(text, x, y, maxWidth);
    };
    let y = 108;
    label('OBJECTIVE', 26, y);
    const objective = wrap(ctx, t.objective, 470, `700 38px ${HAND}`).slice(0, 2);
    for (const line of objective) {
      y += 44;
      hand(line, 26, y, 470, INK);
    }
    y += 40;
    label('TASKS', 26, y);
    for (const task of t.tasks.slice(0, 3)) {
      y += 46;
      hand(task.text, 26, y, 470, task.done ? DONE : INK, 36);
      if (task.done) {
        ctx.fillStyle = DONE;
        ctx.fillRect(24, y - 12, Math.min(470, ctx.measureText(task.text).width) + 4, 4);
      }
    }
    label('ROUND IN GUN', 26, 470);
    hand(t.round, 26, 514, 120, INK, 40);
    hand(t.rack, 150, 512, 360, INK, 30);

    // The tank from above, hatched where it's damaged.
    label('OUR TANK', 540, 108);
    this.drawTank(t, 560, 124);
    label('DAMAGE', 760, 108);
    y = 108;
    for (const line of t.damage) {
      for (const part of wrap(ctx, line.text, 240, `700 32px ${HAND}`)) {
        y += 38;
        hand(part, 760, y, 240, line.bad ? RED : INK, 32);
      }
    }
    y += 40;
    label('CREW', 760, y);
    for (const line of t.crew) {
      y += 38;
      hand(line.text, 760, y, 240, line.bad ? RED : INK, 32);
    }
    y += 40;
    label('HITS', 760, y);
    y += 38;
    hand(t.hits, 760, y, 240, INK, 32);

    // The latest calls, newest first, the newest dark and with its detail.
    label('LAST CALLS', 26, 576);
    t.calls.forEach((call, i) => {
      const text = `${call.time}  ${call.text}${call.detail ? `  · ${call.detail}` : ''}`;
      const colour = i > 0 ? OLD : call.tone === 'bad' ? RED : INK;
      ctx.textAlign = 'left';
      ctx.fillStyle = colour;
      ctx.font = i === 0 ? `700 36px ${HAND}` : `30px ${HAND}`;
      ctx.fillText(text, 26, 624 + i * 52, PX_W - 52);
    });
    if (t.calls.length === 0) hand('None yet', 26, 624, 400, OLD, 32);
  }

  /** The tank seen from above, front up: tracks, hull, turret and gun, the engine bay behind a dashed line; damaged parts hatched red. */
  private drawTank(t: BoardText, x: number, y: number): void {
    const ctx = this.ctx;
    const w = 180;
    const h = 270;
    const track = 30;
    const z = t.zones;
    const hatch = (rx: number, ry: number, rw: number, rh: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.strokeStyle = RED;
      ctx.lineWidth = 5;
      for (let d = -rh; d < rw + rh; d += 11) {
        ctx.beginPath();
        ctx.moveTo(rx + d, ry + rh);
        ctx.lineTo(rx + d + rh, ry);
        ctx.stroke();
      }
      ctx.restore();
    };
    const engineTop = y + h * 0.7;
    if (z.leftTrack) hatch(x, y + 6, track, h - 12);
    if (z.rightTrack) hatch(x + w - track, y + 6, track, h - 12);
    if (z.engine) hatch(x + track + 2, engineTop, w - 2 * track - 4, y + h - 10 - engineTop);
    if (z.transmission) hatch(x + track + 2, y + 18, w - 2 * track - 4, 30);
    ctx.strokeStyle = '#2a2a24';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y + 6, track, h - 12);
    ctx.strokeRect(x + w - track, y + 6, track, h - 12);
    ctx.strokeRect(x + track, y + 16, w - 2 * track, h - 26);
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(x + track, engineTop);
    ctx.lineTo(x + w - track, engineTop);
    ctx.stroke();
    ctx.setLineDash([]);
    const cx = x + w / 2;
    const cy = y + h * 0.42;
    if (z.turret) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 38, 0, Math.PI * 2);
      ctx.clip();
      hatch(cx - 40, cy - 40, 80, 80);
      ctx.restore();
    }
    ctx.strokeStyle = '#2a2a24';
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 38);
    ctx.lineTo(cx, y - 8);
    ctx.stroke();
    ctx.font = `18px ${TYPE}`;
    ctx.textAlign = 'center';
    // On a patch of paper, so the hatching doesn't hide it.
    ctx.fillStyle = PAPER;
    ctx.fillRect(cx - 38, engineTop + 24, 76, 22);
    ctx.fillStyle = LABEL;
    ctx.fillText('ENGINE', cx, engineTop + 40);
    // The two seats: the driver front left, the gunner in the turret right of the gun; a red cross on a wounded one.
    const seatMark = (sx: number, sy: number, name: string, hurt: boolean) => {
      ctx.fillStyle = LABEL;
      ctx.fillText(name, sx, sy);
      if (hurt) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(sx - 14, sy - 26);
        ctx.lineTo(sx + 14, sy + 2);
        ctx.moveTo(sx + 14, sy - 26);
        ctx.lineTo(sx - 14, sy + 2);
        ctx.stroke();
      }
    };
    seatMark(x + track + 26, y + 50, 'DRV', z.driver);
    seatMark(cx + 18, cy + 6, 'GNR', z.gunner);
  }
}

/** `text` split into lines no wider than `maxWidth` in `font`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
  ctx.font = font;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
