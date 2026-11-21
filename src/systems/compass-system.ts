import { CanvasTexture, createSystem, type Entity, Group, type Mesh, type MeshBasicMaterial, RepeatWrapping, SRGBColorSpace, type Texture, VisibilityState } from '@iwsdk/core';
import { createWheel } from '../scene-assets/mechanism.scene-asset.js';
import { createCardEdge, createLubber } from '../scene-assets/compass.scene-asset.js';
import { SEATS, seatToHull } from '../sim/cabin.js';
import {
  bearingText,
  boxDirToFrame,
  cardOffset,
  COMPASSES,
  type CompassId,
  type CompassPlace,
  COURSE_CRANK,
  COURSE_CRANK_HUB,
  courseFromCrank,
  type CourseDrill,
  createCourseDrill,
  gunBearing,
  HOLD_COURSE,
  hullBearing,
  pickCourse,
  pointName,
  stepCourseDrill,
  wrapBearing,
} from '../sim/compass.js';
import { crewLog } from '../sim/crew-board.js';
import { Wheel } from '../sim/mechanism.js';
import { startDriving, tankState } from './drive-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { HoldKind } from './hand-lock.js';
import { addControl } from './mechanism-system.js';
import { netLink } from './net-system.js';
import { seating } from './seating.js';
import { turretState } from './turret-system.js';

const DEG = Math.PI / 180;
/** A card's edge, painted 0° to 360° left to right, px. */
const STRIP_W = 4096;
const STRIP_H = 176;
/** The course crank's name in the mechanism kit and handUse. */
const CRANK = 'course-crank';
/** How long the drill's sign stays up, s. */
const SIGN_SECONDS = 8;

let active: CompassSystem | null = null;

/** Practice → Drive the tank → Steer a course (F2.9): into the driver's seat, with an order to steer a new course on the board. */
export function steerACourse(): void {
  active?.startDrill();
}

interface CompassDebug {
  /** What each compass shows, degrees: the bearing on its lubber line, the driver's course card's; each card as drawn (its strip's offset as degrees); the drill. */
  state(): {
    driver: { bearing: number; reads: string; course: number; gyroDeg: number; courseDeg: number };
    gunner: { bearing: number; reads: string; hull: number; gyroDeg: number };
    crankDeg: number;
    held: boolean;
    drill: { course: number; held: number; done: boolean } | null;
    sign: string;
    /** The last sign put up, shown or since faded (a slow page's 8 s can pass before a test reads it). */
    lastSign: string;
  };
  /** Set the driver's course card, degrees (as the crank would leave it). */
  setCourse(deg: number): void;
  /** Practice → Steer a course; `course` instead of a random one. */
  drill(course?: number): void;
  /** Where the crank's knob is (hull space) with the crank at `deg` (unwrapped degrees, + anticlockwise as the driver sees it). */
  knob(deg: number): number[];
  /** Each window's middle (hull space, the gunner's with the turret as drawn) and which way it faces: for the test's camera. */
  at(): { driver: number[]; gunner: number[]; facing: { driver: number[]; gunner: number[] } };
}

interface Face {
  place: CompassPlace;
  mount: Group;
  /** Each card's edge, top first, and its texture (its own offset, the strip shared). */
  cards: Mesh[];
  maps: Texture[];
  lubber: Mesh;
}

/**
 * Compasses at both seats (F2.9, docs/compass.md), as a German tank's
 * gyro compass: a box with a window showing the edges of horizontal cards
 * behind a red lubber line. The driver's, on the hood's face right of the
 * turret dial, has the course card over the gyro card; the gunner's, on
 * the turret's front wall over the crew board, the gyro card alone. Each
 * card's edge is painted once as a strip, 0° to 360°, and slid past the
 * line each frame by its texture's offset: the gyro card's to the hull's
 * heading (driver) or the gun's bearing (gunner), the course card's to the
 * course the driver sets with a small crank beside the box. Both read the
 * tank and turret as this page draws them (DriveSystem's and
 * TurretSystem's `shown`), so nothing is sent; the course card is the
 * driver's own reminder, never shared. Runs after TurretSystem.
 */
export class CompassSystem extends createSystem({}) {
  private faces!: Record<CompassId, Face>;
  private strips!: Record<'course' | 'gyro', CanvasTexture>;
  private crank = new Wheel(COURSE_CRANK);
  private crankPart!: Mesh;
  private crankMount = new Group();
  /** The course the crank's angle 0 stands for, degrees: setCourse moves it so the crank's own angle never jumps. */
  private courseAtZero = 0;
  private course = 0;
  private drillState: CourseDrill | null = null;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;

  init(): void {
    active = this;
    this.strips = { course: paintStrip('course'), gyro: paintStrip('gyro') };
    const turret: Entity | null = this.world.getSceneEntity('turret') ?? null;
    const make = (id: CompassId): Face => {
      const place = COMPASSES[id];
      const mount = new Group();
      mount.name = `Compass ${id}`;
      mount.position.set(place.x, place.y, place.z);
      mount.rotation.y = place.yaw;
      const cards: Mesh[] = [];
      const maps: Texture[] = [];
      place.cards.forEach((kind, i) => {
        const card = createCardEdge(place, i);
        const map = this.strips[kind].clone();
        map.needsUpdate = true;
        const material = card.material as MeshBasicMaterial;
        material.map = map;
        material.needsUpdate = true;
        mount.add(card);
        cards.push(card);
        maps.push(map);
      });
      const lubber = createLubber(place);
      mount.add(lubber);
      if (id === 'gunner' && turret) this.world.createTransformEntity(mount, { parent: turret });
      else {
        if (id === 'gunner') console.warn('[Compass] no turret in the scene for the gunner\'s compass');
        this.world.createTransformEntity(mount);
      }
      return { place, mount, cards, maps, lubber };
    };
    this.faces = { driver: make('driver'), gunner: make('gunner') };

    // The course crank, beside the driver's compass, on the hood's face: the driver's own, never sent.
    this.crankMount.name = 'Compass course crank mount';
    this.crankMount.position.set(...COURSE_CRANK_HUB);
    this.crankPart = createWheel(COURSE_CRANK);
    this.crankMount.add(this.crankPart);
    this.world.createTransformEntity(this.crankMount);
    this.cleanupFuncs.push(
      addControl({
        name: CRANK,
        mech: this.crank,
        frame: this.crankMount,
        kind: HoldKind.LocalControl,
        active: () => seating.mine === 'driver' && !seating.away,
      }),
    );

    this.sign = new FloatingSign('Compass Sign', 0.75, [600, 200], 1.1, 0.3);
    this.world.createTransformEntity(this.sign.mesh);

    this.cleanupFuncs.push(() => {
      for (const t of Object.values(this.strips)) t.dispose();
      for (const f of Object.values(this.faces)) {
        for (const m of f.maps) m.dispose();
        for (const c of f.cards) {
          c.geometry.dispose();
          (c.material as MeshBasicMaterial).dispose();
        }
        f.lubber.geometry.dispose();
        (f.lubber.material as MeshBasicMaterial).dispose();
      }
      this.crankPart.geometry.dispose();
      if (active === this) active = null;
    });

    const self = this;
    (window as unknown as { __compass: CompassDebug }).__compass = {
      state: () => {
        const t = tankState();
        const yaw = turretState().yaw;
        const hb = hullBearing(t.heading);
        const gb = gunBearing(t.heading, yaw);
        const d = self.drillState;
        return {
          driver: { bearing: hb, reads: bearingText(hb), course: self.course, courseDeg: self.faces.driver.maps[0].offset.x * 360, gyroDeg: self.faces.driver.maps[1].offset.x * 360 },
          gunner: { bearing: gb, reads: bearingText(gb), hull: hb, gyroDeg: self.faces.gunner.maps[0].offset.x * 360 },
          crankDeg: self.crank.angle / DEG,
          held: self.crank.held[0] || self.crank.held[1],
          drill: d ? { course: d.course, held: d.held, done: d.done } : null,
          sign: self.sign.visible ? self.signText : '',
          lastSign: self.signText,
        };
      },
      setCourse: (deg) => self.setCourse(deg),
      drill: (course) => self.startDrill(course),
      knob: (deg) => {
        const a = deg * DEG;
        const r = COURSE_CRANK.radius;
        const [x, y, z] = COURSE_CRANK_HUB;
        return [x - r * Math.sin(a), y + r * Math.cos(a), z + 0.01 + (COURSE_CRANK.knobLength - 0.01) / 2];
      },
      at: () => {
        const yaw = turretState().yaw;
        const d = COMPASSES.driver;
        const g = COMPASSES.gunner;
        const gf = boxDirToFrame(g, [0, 0, 1]);
        return {
          driver: [d.x, d.y, d.z],
          gunner: seatToHull(SEATS.gunner, yaw, [g.x, g.y, g.z], [0, 0, 0]),
          facing: {
            driver: boxDirToFrame(d, [0, 0, 1]),
            gunner: [gf[0] * Math.cos(yaw) + gf[2] * Math.sin(yaw), 0, -gf[0] * Math.sin(yaw) + gf[2] * Math.cos(yaw)],
          },
        };
      },
    };
  }

  /** Set the course mark to `deg`, the crank staying where it is. */
  setCourse(deg: number): void {
    this.course = wrapBearing(Math.round(deg));
    this.courseAtZero = wrapBearing(this.course + (this.crank.angle / (2 * Math.PI)) * COURSE_CRANK.perTurn);
  }

  /** Practice → Steer a course: alone, into the driver's seat (in a crew the drill is this page's own); an order on the board, and a sign saying how. */
  startDrill(course?: number): void {
    if (!netLink.connected) seating.ask('driver');
    startDriving();
    const now = hullBearing(tankState().heading);
    const c = course ?? pickCourse(now, Math.random());
    this.drillState = createCourseDrill(wrapBearing(c));
    const text = bearingText(c);
    crewLog.post(`Commander: driver, steer ${text} (${pointName(c)})`, 'info');
    const vr = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.say(`Steer ${text}`, vr ? 'Turn the crank by the compass: set the upper card to it' : 'Compass right of the turret dial: set the upper card to it',
      `Then steer till the lower card's figures line up with it, ${HOLD_COURSE} s`);
  }

  update(delta: number): void {
    this.time += delta;
    const t = tankState();
    const yaw = turretState().yaw;
    const hb = hullBearing(t.heading);
    const gb = gunBearing(t.heading, yaw);
    // The course crank: its turn moves the course card (clockwise raises the course).
    this.crankPart.rotation.z = this.crank.angle;
    this.course = courseFromCrank(this.courseAtZero, this.crank.angle);
    const d = this.faces.driver.maps;
    d[0].offset.x = cardOffset(this.course);
    d[1].offset.x = cardOffset(hb);
    this.faces.gunner.maps[0].offset.x = cardOffset(gb);

    const drill = this.drillState;
    if (drill && !drill.done && stepCourseDrill(drill, hb, t.speed, delta)) {
      crewLog.post(`On course ${bearingText(drill.course)}`, 'good');
      this.say(`On course ${bearingText(drill.course)}`, 'Held for 3 s', 'Practice: Steer a course for another');
    }
    if (this.sign.visible) {
      if (this.time > this.signUntil) this.sign.setVisible(false);
      else this.sign.follow(this.world.visibilityState.peek() !== VisibilityState.NonImmersive ? this.player.head : this.camera, delta);
    }
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
    this.signText = `${title}. ${line1} ${line2}`;
    this.signUntil = this.time + SIGN_SECONDS;
    console.info(`[Compass] sign: ${this.signText}`);
  }
}

/**
 * A card's edge, painted once as a strip 0° to 360° left to right (the
 * cards read directly: figures grow to the right): a tick every 5°, longer
 * every 10°, and every 10° its figure in tens (6 for 060, as compass cards
 * are marked), bigger every 30°, the four quarters as N, E, S and W, N in
 * red. The gyro card is cream with its ticks along its top edge; the
 * course card, over it, is buff with its ticks along its bottom edge, so
 * the two cards' ticks meet across the gap between them.
 */
function paintStrip(kind: 'course' | 'gyro'): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = STRIP_W;
  canvas.height = STRIP_H;
  const ctx = canvas.getContext('2d')!;
  const top = kind === 'gyro';
  ctx.fillStyle = kind === 'gyro' ? '#efe6c8' : '#e2c48e';
  ctx.fillRect(0, 0, STRIP_W, STRIP_H);
  const perDeg = STRIP_W / 360;
  ctx.strokeStyle = '#1a1a14';
  for (let deg = 0; deg < 360; deg += 5) {
    const x = deg * perDeg;
    const ten = deg % 10 === 0;
    const thirty = deg % 30 === 0;
    const length = thirty ? 54 : ten ? 42 : 26;
    ctx.lineWidth = thirty ? 7 : ten ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(x, top ? 0 : STRIP_H);
    ctx.lineTo(x, top ? length : STRIP_H - length);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  const y = top ? STRIP_H * 0.66 : STRIP_H * 0.34;
  for (let deg = 0; deg < 360; deg += 10) {
    const word = words[deg] ?? String(deg / 10);
    const thirty = deg % 30 === 0;
    ctx.fillStyle = deg === 0 ? '#b3261e' : '#1a1a14';
    ctx.font = `bold ${thirty ? 92 : 64}px sans-serif`;
    // Each figure also past either end, so those near 0° are whole where the strip repeats.
    for (const x of [deg * perDeg, deg * perDeg + STRIP_W, deg * perDeg - STRIP_W]) ctx.fillText(word, x, y);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}
