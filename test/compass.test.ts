import { describe, expect, it } from 'vitest';
import { EYE_CLEARANCE, GLACIS, HULL, SEATS, TURRET } from '../src/sim/cabin.js';
import {
  bearingDelta,
  bearingText,
  bugAngle,
  cardAngle,
  COMPASSES,
  COURSE_CRANK,
  COURSE_CRANK_HUB,
  courseFromCrank,
  createCourseDrill,
  DRIVER_COMPASS,
  faceOut,
  GUNNER_COMPASS,
  gunBearing,
  HOLD_COURSE,
  hullBearing,
  hullMarkAngle,
  pickCourse,
  pointName,
  stepCourseDrill,
  wrapBearing,
} from '../src/sim/compass.js';
import { BOARD_BORDER, BOARDS, CLIP } from '../src/sim/crew-board.js';
import { FIRING_LAMP, LAMP_REPEATER } from '../src/sim/firing-lamp.js';
import { TURRET_INSIDE_ROUNDING } from '../src/sim/exterior.js';
import { PERISCOPE_CRANK, PERISCOPES } from '../src/sim/periscope.js';
import { TURRET_DIAL } from '../src/sim/turret-dial.js';

const DEG = Math.PI / 180;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Points round a compass's face's edge and its middle, in its frame, at the face's front. */
function facePoints(p: typeof DRIVER_COMPASS, at = p.radius): number[][] {
  const out = [[p.x, p.y, p.z]];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    out.push([p.x + Math.cos(a) * at, p.y + Math.sin(a) * at, p.z]);
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

  it('turns the card to bring the bearing under the lubber, and the course mark with it', () => {
    // Painted north up, clockwise: east is a quarter turn clockwise, so the card turns a quarter anticlockwise.
    expect(cardAngle(90)).toBeCloseTo(Math.PI / 2);
    // Heading 090, course 120: the mark 30° right of the lubber (clockwise, a negative turn about +Z).
    expect(bugAngle(90, 120)).toBeCloseTo(-30 * DEG);
    expect(bugAngle(120, 120)).toBeCloseTo(0);
    // The gunner's hull mark: the turret turned left, the hull shows to the right of the gun.
    expect(hullMarkAngle(90 * DEG)).toBeCloseTo(-90 * DEG);
  });

  it('turns the course mark clockwise with the crank turned clockwise, 90° a turn', () => {
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

  it("lies on the hood's face at the eyes' height, right of the firing lamp, clear of the lamp and the dial", () => {
    expect(p.z - faceOut(p)).toBeCloseTo(GLACIS.face);
    expect(Math.abs(p.y - TURRET_DIAL.y)).toBeLessThan(0.05);
    const lampRight = FIRING_LAMP.x + FIRING_LAMP.bezel;
    expect(p.x - p.radius - p.rim - lampRight).toBeGreaterThan(0.015);
    // Wholly on the hood's face: over the glacis's top edge, under the roof.
    expect(p.y - p.radius - p.rim).toBeGreaterThan(GLACIS.hoodBottom + 0.01);
    expect(p.y + p.radius + p.rim).toBeLessThan(HULL.roof - 0.05);
    expect(p.x + p.radius + p.rim).toBeLessThan(HULL.halfWidth - 0.2);
  });

  it('stands out of the way of a head leaning in, marks and all, as the dial does', () => {
    const front = p.z + 2 * p.markGap + 0.002;
    // The eyes come no further forward than headBox[2] ahead of the eye point; nothing of it within the fade's EYE_CLEARANCE of there.
    expect(SEATS.driver.eye[2] - SEATS.driver.headBox[2] - front).toBeGreaterThan(EYE_CLEARANCE - 0.012);
    expect(faceOut(p) + 2 * p.markGap + 0.002).toBeLessThanOrEqual(TURRET_DIAL.proud + TURRET_DIAL.faceGap + TURRET_DIAL.pointerGap + 0.002 + 0.004);
    expect(p.faceGap).toBeGreaterThanOrEqual(0.003);
    expect(p.markGap).toBeGreaterThanOrEqual(0.003);
  });

  it("keeps the driver's eyes EYE_CLEARANCE from it all along the head box's edges", () => {
    const seat = SEATS.driver;
    const [left, right, forward, back] = seat.headBox;
    const points = facePoints(p, p.radius + p.rim).map((q) => [q[0], q[1], q[2] + 2 * p.markGap + 0.002]);
    for (let k = 0; k <= 8; k++) {
      const x = seat.eye[0] - left + ((left + right) * k) / 8;
      const z = seat.eye[2] - forward + ((forward + back) * k) / 8;
      for (const at of [[x, seat.eye[1], seat.eye[2] - forward], [seat.eye[0] - left, seat.eye[1], z], [seat.eye[0], seat.eye[1] + seat.headUp, seat.eye[2]]]) {
        for (const q of points) expect(dist(at, q)).toBeGreaterThan(EYE_CLEARANCE - 0.01);
      }
    }
  });

  it('is a glance right from the slit, its figures as big to the eye as the dial\'s', () => {
    const toFace = [p.x - eye[0], p.y - eye[1], p.z - eye[2]];
    const away = Math.hypot(...toFace);
    expect(away).toBeLessThan(0.65);
    const right = Math.atan2(toFace[0], -toFace[2]) / DEG;
    expect(right).toBeGreaterThan(40);
    expect(right).toBeLessThan(62);
    // The card's radius seen from the eyes: at least the dial's.
    const dialAway = dist(eye, [TURRET_DIAL.x, TURRET_DIAL.y, TURRET_DIAL.z]);
    expect(p.radius / away).toBeGreaterThan((TURRET_DIAL.radius / dialAway) * 0.95);
  });

  it("is in plain sight from the driver's seat: nothing of the hull, the periscope or its crank (turned any way) in front of it", async () => {
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
    const targets = facePoints(p, p.radius * 0.95);
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

  it("has its course crank beside it, the knob's circle never over the face, in reach from the seat and clear of the periscope's crank", () => {
    const hub = COURSE_CRANK_HUB;
    const knobOut = COURSE_CRANK.radius + 0.015;
    expect(Math.hypot(hub[0] - p.x, hub[1] - p.y) - knobOut - (p.radius + p.rim)).toBeGreaterThan(0.009);
    // The hub's 4 cm drum sunk a little into the hood's face.
    expect(hub[2] - 0.02).toBeLessThan(GLACIS.face);
    expect(hub[2] - 0.02).toBeGreaterThan(GLACIS.face - 0.01);
    // Over the glacis's top edge, the knob's lowest included.
    expect(hub[1] - knobOut).toBeGreaterThan(GLACIS.hoodBottom + 0.01);
    // Within a seated arm's reach, at chest height.
    const knobFront = [hub[0], hub[1], hub[2] + 0.01 + COURSE_CRANK.knobLength];
    expect(dist(eye, knobFront)).toBeLessThan(0.75);
    expect(eye[1] - hub[1]).toBeGreaterThan(-0.05);
    expect(eye[1] - hub[1]).toBeLessThan(0.4);
    // The periscope's crank's knob circle (with the knob's own radius) and this one's don't meet.
    const s = PERISCOPES.driver;
    expect(Math.hypot(hub[0] - s.crank[0], hub[1] - s.crank[1])).toBeGreaterThan(knobOut + PERISCOPE_CRANK.radius + 0.015 + 0.03);
  });
});

describe("the gunner's compass (F2.9)", () => {
  const p = GUNNER_COMPASS;
  const eye = SEATS.gunner.eye;

  it("is on the turret's front wall over the crew board, under the roof's rounded edge, clear of the board's clip and the lamp's repeater", () => {
    expect(p.z - faceOut(p)).toBeCloseTo(TURRET.front + HULL.wall);
    const top = p.y + p.radius + p.rim;
    const bottom = p.y - p.radius - p.rim;
    expect(top).toBeLessThan(TURRET.roof - TURRET_INSIDE_ROUNDING);
    const b = BOARDS.gunner;
    const clipTop = b.y + b.height / 2 + BOARD_BORDER + CLIP.height;
    expect(bottom - clipTop).toBeGreaterThan(0.02);
    const repeaterRight = LAMP_REPEATER.x + LAMP_REPEATER.bezel;
    expect(p.x - p.radius - p.rim - repeaterRight).toBeGreaterThan(0.05);
    expect(p.x + p.radius + p.rim).toBeLessThan(TURRET.halfWidth - HULL.wall - TURRET_INSIDE_ROUNDING);
  });

  it('is about a metre from the eyes, up and right of the sight, bigger for it, if not as big to the eye as the driver\'s', () => {
    const away = dist(eye, [p.x, p.y, p.z]);
    expect(away).toBeGreaterThan(0.8);
    expect(away).toBeLessThan(1.1);
    const d = DRIVER_COMPASS;
    const driverAway = dist(SEATS.driver.eye, [d.x, d.y, d.z]);
    expect(p.radius).toBeGreaterThan(d.radius);
    expect(p.radius / away).toBeGreaterThan((d.radius / driverAway) * 0.55);
  });

  it("is in plain sight from the gunner's seat: nothing of the turret, the gun, the sight or the gunner's periscope in front of it", async () => {
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
    const targets = facePoints(p, p.radius * 0.95);
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
          expect(hit ? hit.object.name || 'a mesh' : 'nothing', `crank at ${k * 30}°, eyes moved (${dx}, ${dy})`).toBe('nothing');
        }
      }
    }
  });

  it('has both compasses named in COMPASSES by seat', () => {
    expect(COMPASSES.driver.frame).toBe('hull');
    expect(COMPASSES.gunner.frame).toBe('turret');
  });
});
