import { CanvasTexture, createSystem, type Entity, Group, type Mesh, type MeshBasicMaterial, SRGBColorSpace, VisibilityState } from '@iwsdk/core';
import { createWheel } from '../scene-assets/mechanism.scene-asset.js';
import { createCompassCard, createCourseBug, createHullMark, createLubber } from '../scene-assets/compass.scene-asset.js';
import { SEATS, seatToHull } from '../sim/cabin.js';
import {
  bearingText,
  bugAngle,
  cardAngle,
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
  hullMarkAngle,
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
/** The card's canvas, px square. */
const CARD_PX = 512;
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
  /** What each compass shows, degrees: the bearing under its lubber, the course mark's (driver's), the card's and marks' turns as drawn; the drill. */
  state(): {
    driver: { bearing: number; reads: string; course: number; cardDeg: number; bugDeg: number };
    gunner: { bearing: number; reads: string; hull: number; cardDeg: number; hullMarkDeg: number };
    crankDeg: number;
    held: boolean;
    drill: { course: number; held: number; done: boolean } | null;
    sign: string;
  };
  /** Set the driver's course mark, degrees (as the crank would leave it). */
  setCourse(deg: number): void;
  /** Practice → Steer a course; `course` instead of a random one. */
  drill(course?: number): void;
  /** Where the crank's knob is (hull space) with the crank at `deg` (unwrapped degrees, + anticlockwise as the driver sees it). */
  knob(deg: number): number[];
  /** Each face's middle (hull space, the gunner's with the turret as drawn) and which way it faces: for the test's camera. */
  at(): { driver: number[]; gunner: number[]; facing: { driver: number[]; gunner: number[] } };
}

interface Face {
  place: CompassPlace;
  mount: Group;
  card: Mesh;
  marks: Mesh[];
}

/**
 * Compasses at both seats (F2.9, docs/compass.md): the driver's on the
 * hood's face right of the firing lamp, the gunner's on the turret's front
 * wall over the crew board. Each card turns so the bearing under its red
 * lubber is the way its seat faces: the hull's heading for the driver, the
 * gun's for the gunner (the card painted once, turned each frame). The
 * driver sets an orange course mark with a small crank beside the case;
 * the gunner's has a small hull under the lubber, turned by the turret's
 * angle. Both read the tank and turret as this page draws them
 * (DriveSystem's and TurretSystem's `shown`), so nothing is sent; the
 * course mark is the driver's own reminder, never shared. Runs after
 * TurretSystem.
 */
export class CompassSystem extends createSystem({}) {
  private faces!: Record<CompassId, Face>;
  private texture!: CanvasTexture;
  private crank = new Wheel(COURSE_CRANK);
  private crankPart!: Mesh;
  private crankMount = new Group();
  /** The course the crank's angle 0 stands for, degrees: setCourse moves it so the crank's own angle never jumps. */
  private courseAtZero = 0;
  private course = 0;
  private bug!: Mesh;
  private hullMark!: Mesh;
  private drillState: CourseDrill | null = null;
  private sign!: FloatingSign;
  private signText = '';
  private signUntil = 0;
  private time = 0;

  init(): void {
    active = this;
    this.texture = paintCard();
    const turret: Entity | null = this.world.getSceneEntity('turret') ?? null;
    const make = (id: CompassId): Face => {
      const place = COMPASSES[id];
      const mount = new Group();
      mount.name = `Compass ${id}`;
      mount.position.set(place.x, place.y, place.z);
      const card = createCompassCard(place);
      const material = card.material as MeshBasicMaterial;
      material.map = this.texture;
      material.color.setRGB(1, 1, 1);
      material.needsUpdate = true;
      mount.add(card);
      const marks = [createLubber(place)];
      if (id === 'driver') marks.push(createCourseBug(place));
      else marks.push(createHullMark(place));
      for (const m of marks) mount.add(m);
      if (id === 'gunner' && turret) this.world.createTransformEntity(mount, { parent: turret });
      else {
        if (id === 'gunner') console.warn('[Compass] no turret in the scene for the gunner\'s compass');
        this.world.createTransformEntity(mount);
      }
      return { place, mount, card, marks };
    };
    this.faces = { driver: make('driver'), gunner: make('gunner') };
    this.bug = this.faces.driver.marks[1];
    this.hullMark = this.faces.gunner.marks[1];

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
      this.texture.dispose();
      for (const f of Object.values(this.faces)) {
        f.card.geometry.dispose();
        (f.card.material as MeshBasicMaterial).dispose();
        for (const m of f.marks) m.geometry.dispose();
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
          driver: { bearing: hb, reads: bearingText(hb), course: self.course, cardDeg: self.faces.driver.card.rotation.z / DEG, bugDeg: self.bug.rotation.z / DEG },
          gunner: { bearing: gb, reads: bearingText(gb), hull: hb, cardDeg: self.faces.gunner.card.rotation.z / DEG, hullMarkDeg: self.hullMark.rotation.z / DEG },
          crankDeg: self.crank.angle / DEG,
          held: self.crank.held[0] || self.crank.held[1],
          drill: d ? { course: d.course, held: d.held, done: d.done } : null,
          sign: self.sign.visible ? self.signText : '',
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
        return {
          driver: [d.x, d.y, d.z],
          gunner: seatToHull(SEATS.gunner, yaw, [g.x, g.y, g.z], [0, 0, 0]),
          facing: { driver: [0, 0, 1], gunner: [Math.sin(yaw), 0, Math.cos(yaw)] },
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
    this.say(`Steer ${text}`, vr ? 'Turn the crank by the compass to set the orange mark' : 'Compass right of the turret dial',
      `Then steer till the mark is under the red lubber, ${HOLD_COURSE} s`);
  }

  update(delta: number): void {
    this.time += delta;
    const t = tankState();
    const yaw = turretState().yaw;
    const hb = hullBearing(t.heading);
    const gb = gunBearing(t.heading, yaw);
    // The course crank: its turn moves the mark (clockwise raises the course).
    this.crankPart.rotation.z = this.crank.angle;
    this.course = courseFromCrank(this.courseAtZero, this.crank.angle);
    this.faces.driver.card.rotation.z = cardAngle(hb);
    this.bug.rotation.z = bugAngle(hb, this.course);
    this.faces.gunner.card.rotation.z = cardAngle(gb);
    this.hullMark.rotation.z = hullMarkAngle(yaw);

    const d = this.drillState;
    if (d && !d.done && stepCourseDrill(d, hb, t.speed, delta)) {
      crewLog.post(`On course ${bearingText(d.course)}`, 'good');
      this.say(`On course ${bearingText(d.course)}`, 'Held for 3 s', 'Practice: Steer a course for another');
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
 * The card, painted once: cream, north up, bearings clockwise; a tick every
 * 5°, longer every 10°, and every 30° its figure in tens (3 for 030, as
 * compass cards are marked), the four quarters as N, E, S and W, N in red.
 * Each figure is written with its top to the rim, so it reads upright when
 * it comes to the lubber at the top.
 */
function paintCard(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_PX;
  canvas.height = CARD_PX;
  const ctx = canvas.getContext('2d')!;
  const c = CARD_PX / 2;
  ctx.fillStyle = '#efe6c8';
  ctx.fillRect(0, 0, CARD_PX, CARD_PX);
  ctx.strokeStyle = '#1a1a14';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(c, c, c - 4, 0, 2 * Math.PI);
  ctx.stroke();
  for (let deg = 0; deg < 360; deg += 5) {
    const a = deg * DEG;
    const ten = deg % 10 === 0;
    const thirty = deg % 30 === 0;
    const outer = c - 10;
    const inner = outer - (thirty ? 34 : ten ? 26 : 16);
    ctx.lineWidth = thirty ? 7 : ten ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(c + Math.sin(a) * outer, c - Math.cos(a) * outer);
    ctx.lineTo(c + Math.sin(a) * inner, c - Math.cos(a) * inner);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let deg = 0; deg < 360; deg += 30) {
    const word = words[deg] ?? String(deg / 10);
    const quarter = deg in words;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(deg * DEG);
    ctx.fillStyle = deg === 0 ? '#b3261e' : '#1a1a14';
    ctx.font = `bold ${quarter ? 76 : 58}px sans-serif`;
    ctx.fillText(word, 0, -(c - 90));
    ctx.restore();
  }
  // The pivot.
  ctx.fillStyle = '#1a1a14';
  ctx.beginPath();
  ctx.arc(c, c, 10, 0, 2 * Math.PI);
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
