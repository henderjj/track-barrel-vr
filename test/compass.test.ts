import { describe, expect, it } from 'vitest';
import { EYE_CLEARANCE, GLACIS, HULL, SEATS, TURRET } from '../src/sim/cabin.js';
import {
  backFront,
  bearingDelta,
  bearingText,
  boxDirToFrame,
  boxToFrame,
  cardOffset,
  cardY,
  caseSize,
  type CompassPlace,
  COMPASSES,
  COURSE_CRANK,
  COURSE_CRANK_HUB,
  COURSE_KNOB_OUT,
  courseFromCrank,
  createCourseDrill,
  DRIVER_COMPASS,
  GUNNER_COMPASS,
  gunBearing,
  HOLD_COURSE,
  hullBearing,
  pickCourse,
  pointName,
  stepCourseDrill,
  windowSize,
  wrapBearing,
} from '../src/sim/compass.js';
import { BOARD_BORDER, BOARDS, CLIP } from '../src/sim/crew-board.js';
import { FIRING_LAMP, LAMP_REPEATER } from '../src/sim/firing-lamp.js';
import { TURRET_INSIDE_ROUNDING } from '../src/sim/exterior.js';
import { PERISCOPE_CRANK, PERISCOPES } from '../src/sim/periscope.js';
import { TURRET_DIAL } from '../src/sim/turret-dial.js';

const DEG = Math.PI / 180;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The case's corners, front and back plate, in its frame's space. */
function caseCorners(p: CompassPlace): number[][] {
  const [w, h] = caseSize(p);
  const out: number[][] = [];
  for (const x of [-w, w]) for (const y of [-h, h]) for (const z of [p.frameFront, backFront(p) - 0.004]) out.push(boxToFrame(p, [x, y, z], [0, 0, 0]));
  return out;
}

/** Points on the cards' edges seen through the window (its middle 80%), in the frame's space. */
function windowTargets(p: CompassPlace): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < p.cards.length; i++) {
    for (const k of [-0.8, -0.4, 0, 0.4, 0.8]) {
      const a = k * p.window;
      for (const dy of [-0.35, 0, 0.35]) {
        out.push(boxToFrame(p, [p.radius * Math.sin(a), cardY(p, i) + dy * p.band, -p.radius * (1 - Math.cos(a))], [0, 0, 0]));
      }
    }
  }
  return out;
}

describe('compass bearings (F2.9)', () => {
  it('reads the hull heading clockwise from north, as a map does', () => {
    // A heading of 0 faces north (−Z); a positive heading turns left.
    expect(hullBearing(0)).toBe(0);
    expect(hullBearing(-90 * DEG)).toBeCloseTo(90);
    expect(hullBearing(90 * DEG)).toBeCloseTo(270);
    expect(hullBearing(Math.PI)).toBeCloseTo(180);
    expect(hullBearing(-2 * Math.PI - 30 * DEG)).toBeCloseTo(30);
  });

  it("reads the gun's bearing from the hull's and the turret's angle", () => {
    // The hull east, the turret turned 90° left: the gun points north.
    expect(gunBearing(-90 * DEG, 90 * DEG)).toBeCloseTo(0);
    // The hull north, the turret at 3 o'clock (90° right): the gun east.
    expect(gunBearing(0, -90 * DEG)).toBeCloseTo(90);
  });

  it('wraps, differences and names bearings', () => {
    expect(wrapBearing(-10)).toBe(350);
    expect(wrapBearing(720)).toBe(0);
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(10, 350)).toBe(-20);
    expect(bearingDelta(0, 180)).toBe(180);
    expect(bearingText(60)).toBe('060');
    expect(bearingText(359.7)).toBe('000');
    expect(pointName(45)).toBe('NE');
    expect(pointName(200)).toBe('SSW');
    expect(pointName(355)).toBe('N');
  });

  it("slides each card's strip so the bearing is on the lubber line, figures growing to the right", () => {
    expect(cardOffset(0)).toBe(0);
    expect(cardOffset(90)).toBeCloseTo(0.25);
    expect(cardOffset(-90)).toBeCloseTo(0.75);
    // A point 20° right of the line on a card showing 090 is the strip's 110°: u (θ over a turn) plus the offset.
    expect((20 / 360 + cardOffset(90)) * 360).toBeCloseTo(110);
  });

  it('turns the course card clockwise with the crank turned clockwise, 90° a turn', () => {
    expect(courseFromCrank(0, 0)).toBe(0);
    expect(courseFromCrank(0, -2 * Math.PI)).toBeCloseTo(90);
    expect(courseFromCrank(30, Math.PI)).toBeCloseTo(345);
    expect(COURSE_CRANK.perTurn).toBe(90);
  });
});

describe('Practice → Steer a course (F2.9)', () => {
  it('orders a course in tens, well round from the heading', () => {
    for (const heading of [0, 37, 180, 355]) {
      for (let r = 0; r < 1; r += 0.05) {
        const c = pickCourse(heading, r);
        expect(c % 10).toBe(0);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(360);
        expect(Math.abs(bearingDelta(heading, c))).toBeGreaterThanOrEqual(55);
      }
    }
  });

  it('is done once held within 5° for 3 s on the move, and starts over off course or halted', () => {
    const d = createCourseDrill(120);
    const dt = 0.1;
    let done = false;
    for (let t = 0; t < 2; t += dt) done = stepCourseDrill(d, 118, 3, dt) || done;
    expect(done).toBe(false);
    stepCourseDrill(d, 140, 3, dt);
    expect(d.held).toBe(0);
    for (let t = 0; t < 5; t += dt) done = stepCourseDrill(d, 123, 0, dt) || done;
    expect(done).toBe(false);
    let steps = 0;
    while (!stepCourseDrill(d, 124, 3, dt)) steps++;
    expect(steps * dt).toBeCloseTo(HOLD_COURSE - dt, 5);
    expect(d.done).toBe(true);
    expect(stepCourseDrill(d, 124, 3, dt)).toBe(false);
  });
});

describe("the driver's compass (F2.9)", () => {
  const p = DRIVER_COMPASS;
  const eye = SEATS.driver.eye;

  it("stands on the hood's face right of the turret dial and the firing lamp, a little under the eyes, turned to face the driver", () => {
    expect(p.wall).toBeCloseTo(GLACIS.face);
    expect(p.cards).toEqual(['course', 'gyro']);
    const lampRight = FIRING_LAMP.x + FIRING_LAMP.bezel;
    const dialRight = TURRET_DIAL.x + TURRET_DIAL.radius + TURRET_DIAL.rim;
    for (const c of caseCorners(p)) {
      expect(c[0] - Math.max(lampRight, dialRight)).toBeGreaterThan(0.06);
      expect(c[1]).toBeGreaterThan(GLACIS.hoodBottom + 0.03);
      expect(c[1]).toBeLessThan(HULL.roof - 0.1);
      expect(c[0]).toBeLessThan(HULL.halfWidth - 0.2);
    }
    // The back plate's corners stand in front of the wall (a turned box's near side comes nearest it).
    const [w, h] = caseSize(p);
    for (const x of [-w, w]) for (const y of [-h, h]) expect(boxToFrame(p, [x, y, backFront(p)], [0, 0, 0])[2] - p.wall).toBeGreaterThanOrEqual(0.003 - 1e-9);
    // Turned towards the eyes: the window looks within 40° of them.
    const n = boxDirToFrame(p, [0, 0, 1]);
    const to = [eye[0] - p.x, eye[2] - p.z];
    const cos = (n[0] * to[0] + n[2] * to[1]) / Math.hypot(to[0], to[1]);
    expect(Math.acos(cos) / DEG).toBeLessThan(40);
  });

  it("keeps the driver's eyes EYE_CLEARANCE from it and its crank all along the head box's edges", () => {
    const seat = SEATS.driver;
    const [left, right, forward, back] = seat.headBox;
    const hub = COURSE_CRANK_HUB;
    const points = caseCorners(p).concat([[hub[0], hub[1], hub[2] + 0.01 + COURSE_CRANK.knobLength]]);
    for (let k = 0; k <= 8; k++) {
      const x = seat.eye[0] - left + ((left + right) * k) / 8;
      const z = seat.eye[2] - forward + ((forward + back) * k) / 8;
      for (const at of [[x, seat.eye[1], seat.eye[2] - forward], [seat.eye[0] + right, seat.eye[1], z], [seat.eye[0], seat.eye[1] + seat.headUp, seat.eye[2]]]) {
        for (const q of points) expect(dist(at, q), `head at ${at.map((v) => v.toFixed(2))}, box at ${q.map((v) => v.toFixed(3))}`).toBeGreaterThan(EYE_CLEARANCE - 0.01);
      }
    }
  });

  it('is a glance right from the slit, its cards big enough to read', () => {
    const toFace = [p.x - eye[0], p.y - eye[1], p.z - eye[2]];
    const away = Math.hypot(...toFace);
    expect(away).toBeLessThan(0.7);
    const right = Math.atan2(toFace[0], -toFace[2]) / DEG;
    expect(right).toBeGreaterThan(40);
    expect(right).toBeLessThan(68);
    // A card's band (its figures about half of it) at least 1.5° tall to the eye; the window at least 6° across.
    expect(Math.atan2(p.band, away) / DEG).toBeGreaterThan(1.5);
    expect(Math.atan2(2 * windowSize(p)[0], away) / DEG).toBeGreaterThan(6);
  });

  it("is in plain sight through its window from the driver's seat: nothing of its own frame, the hull, the periscope or its crank (turned any way) in front of the cards", async () => {
    const { Group, Raycaster, Vector3 } = await import('@iwsdk/core');
    const { createHull } = await import('../src/scene-assets/cabin.scene-asset.js');
    const periscope = await import('../src/scene-assets/periscope.scene-asset.js');
    const { createWheel } = await import('../src/scene-assets/mechanism.scene-asset.js');
    const s = PERISCOPES.driver;
    const hull = createHull();
    const mount = new Group();
    mount.position.set(s.axis[0], s.lens[1], s.axis[1]);
    mount.add(periscope.createPeriscopeBody(s));
    mount.add(periscope.createPeriscopeTurning(s));
    const crank = createWheel(PERISCOPE_CRANK);
    crank.position.set(...periscope.crankInPeriscope(s));
    mount.add(crank);
    hull.add(mount);
    const ray = new Raycaster();
    const targets = windowTargets(p);
    for (let k = 0; k < 12; k++) {
      crank.rotation.z = (k / 12) * 2 * Math.PI;
      hull.updateMatrixWorld(true);
      for (const [dx, dy] of [[0, 0], [0.03, 0], [-0.03, 0], [0, 0.03], [0, -0.03]]) {
        const from = new Vector3(eye[0] + dx, eye[1] + dy, eye[2]);
        for (const t of targets) {
          const to = new Vector3(t[0], t[1], t[2]);
          const length = from.distanceTo(to);
          ray.set(from, to.sub(from).normalize());
          ray.far = length - 0.002;
          const hit = ray.intersectObject(hull, true)[0];
          expect(hit ? hit.object.name || 'a mesh' : 'nothing', `crank at ${k * 30}°, eyes moved (${dx}, ${dy}), at ${t.map((v) => v.toFixed(3))}, hit ${hit?.point.toArray().map((v) => v.toFixed(3))}`).toBe('nothing');
        }
      }
    }
  });

  it("has its course crank beside it, the knob's circle clear of the box, in reach from the seat and clear of the periscope's crank", () => {
    const hub = COURSE_CRANK_HUB;
    const rightmost = Math.max(...caseCorners(p).map((c) => c[0]));
    expect(hub[0] - COURSE_KNOB_OUT - rightmost).toBeGreaterThan(0.009);
    // The hub's 4 cm drum sunk a little into the hood's face.
    expect(hub[2] - 0.02).toBeLessThan(GLACIS.face);
    expect(hub[2] - 0.02).toBeGreaterThan(GLACIS.face - 0.01);
    // Over the glacis's top edge, the knob's lowest included.
    expect(hub[1] - COURSE_KNOB_OUT).toBeGreaterThan(GLACIS.hoodBottom + 0.01);
    // Within a seated arm's reach, at chest height.
    const knobFront = [hub[0], hub[1], hub[2] + 0.01 + COURSE_CRANK.knobLength];
    expect(dist(eye, knobFront)).toBeLessThan(0.8);
    expect(eye[1] - hub[1]).toBeGreaterThan(-0.05);
    expect(eye[1] - hub[1]).toBeLessThan(0.4);
    // The periscope's crank's knob circle (with the knob's own radius) and this one's don't meet.
    const s = PERISCOPES.driver;
    expect(Math.hypot(hub[0] - s.crank[0], hub[1] - s.crank[1])).toBeGreaterThan(COURSE_KNOB_OUT + PERISCOPE_CRANK.radius + 0.015 + 0.03);
  });
});

describe("the gunner's compass (F2.9)", () => {
  const p = GUNNER_COMPASS;
  const eye = SEATS.gunner.eye;

  it("is on the turret's front wall over the crew board, under the roof's rounded edge, clear of the board's clip and the lamp's repeater", () => {
    expect(p.wall).toBeCloseTo(TURRET.front + HULL.wall);
    expect(p.yaw).toBe(0);
    expect(p.cards).toEqual(['gyro']);
    const [w, h] = caseSize(p);
    expect(p.y + h).toBeLessThan(TURRET.roof - TURRET_INSIDE_ROUNDING);
    const b = BOARDS.gunner;
    const clipTop = b.y + b.height / 2 + BOARD_BORDER + CLIP.height;
    expect(p.y - h - clipTop).toBeGreaterThan(0.02);
    const repeaterRight = LAMP_REPEATER.x + LAMP_REPEATER.bezel;
    expect(p.x - w - repeaterRight).toBeGreaterThan(0.05);
    expect(p.x + w).toBeLessThan(TURRET.halfWidth - HULL.wall - TURRET_INSIDE_ROUNDING);
    expect(p.z + backFront(p) - p.wall).toBeGreaterThanOrEqual(0.003 - 1e-9);
  });

  it("is about a metre from the eyes, up and right of the sight, and bigger for it: its figures as big to the eye as the driver's", () => {
    const away = dist(eye, [p.x, p.y, p.z]);
    expect(away).toBeGreaterThan(0.8);
    expect(away).toBeLessThan(1.1);
    const d = DRIVER_COMPASS;
    const driverAway = dist(SEATS.driver.eye, [d.x, d.y, d.z]);
    expect(p.band / away).toBeGreaterThan((d.band / driverAway) * 0.95);
    // Square to the wall, it looks within 30° of the eyes.
    const to = [eye[0] - p.x, eye[2] - p.z];
    expect(Math.atan2(Math.abs(to[0]), to[1]) / DEG).toBeLessThan(30);
  });

  it("is in plain sight through its window from the gunner's seat: nothing of its frame, the turret, the gun, the sight or the gunner's periscope in front of the card", async () => {
    const { Group, Raycaster, Vector3 } = await import('@iwsdk/core');
    const { createTurret, createGun } = await import('../src/scene-assets/cabin.scene-asset.js');
    const periscope = await import('../src/scene-assets/periscope.scene-asset.js');
    const { createWheel } = await import('../src/scene-assets/mechanism.scene-asset.js');
    const s = PERISCOPES.gunner;
    const turret = createTurret();
    const gun = createGun();
    turret.add(gun);
    const mount = new Group();
    mount.position.set(s.axis[0], s.lens[1], s.axis[1]);
    mount.add(periscope.createPeriscopeBody(s));
    mount.add(periscope.createPeriscopeTurning(s));
    const crank = createWheel(PERISCOPE_CRANK);
    crank.position.set(...periscope.crankInPeriscope(s));
    mount.add(crank);
    turret.add(mount);
    const ray = new Raycaster();
    const targets = windowTargets(p);
    for (let k = 0; k < 12; k++) {
      crank.rotation.z = (k / 12) * 2 * Math.PI;
      turret.updateMatrixWorld(true);
      for (const [dx, dy] of [[0, 0], [0.03, 0], [-0.03, 0], [0, 0.03]]) {
        const from = new Vector3(eye[0] + dx, eye[1] + dy, eye[2]);
        for (const t of targets) {
          const to = new Vector3(t[0], t[1], t[2]);
          const length = from.distanceTo(to);
          ray.set(from, to.sub(from).normalize());
          ray.far = length - 0.002;
          const hit = ray.intersectObject(turret, true)[0];
          expect(hit ? hit.object.name || 'a mesh' : 'nothing', `crank at ${k * 30}°, eyes moved (${dx}, ${dy}), at ${t.map((v) => v.toFixed(3))}`).toBe('nothing');
        }
      }
    }
  });

  it('has both compasses named in COMPASSES by seat', () => {
    expect(COMPASSES.driver.frame).toBe('hull');
    expect(COMPASSES.gunner.frame).toBe('turret');
  });
});
