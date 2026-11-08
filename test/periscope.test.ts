import { describe, expect, it } from 'vitest';
import { decodePeriscopeState, encodePeriscopeState, PERISCOPE_STATE_BYTES } from '../src/net/periscope-codec.js';
import { PacketType } from '../src/net/pose-codec.js';
import type { TankHeader } from '../src/net/tank-codec.js';
import { DRIVER_HATCH, GLACIS, HULL, SEATS, TURRET, VISION_SLIT } from '../src/sim/cabin.js';
import { DRIVER_CONTROL_IDS, DRIVER_CONTROLS, SLIT_FRAME } from '../src/sim/driver-station.js';
import { EYEPIECE } from '../src/sim/gunsight.js';
import { LEVER_PIVOT } from '../src/sim/loading.js';
import { type HandInput, Lever, type Vec3, Wheel } from '../src/sim/mechanism.js';
import {
  BARREL_UNDERSIDE,
  bearing,
  bearingText,
  CRANK_RATIO,
  crankFor,
  DRIVER_LID_FRONT,
  DRIVER_PERISCOPE,
  EYEPIECE_BOX,
  EYEPIECE_TILT,
  GUNNER_PERISCOPE,
  HALF_FIELD_X,
  HALF_FIELD_Y,
  HEAD_SIZE,
  knobMiddle,
  lookDirection,
  lookingIn,
  lookText,
  PERISCOPE_CRANK,
  PERISCOPE_IDS,
  periscopeAngle,
  PERISCOPES,
  periscopesLine,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  RELAY,
  WINDOW,
  WINDOW_PROUD,
} from '../src/sim/periscope.js';
import { HALF_IPD, OPEN_DISTANCE } from '../src/sim/sight.js';
import { STATION, STATION_CONTROLS, TRUNNION } from '../src/sim/turret.js';

const DEG = Math.PI / 180;
const DT = 1 / 90;
/** Crank angles all the way round, every 15°. */
const CRANKS = Array.from({ length: 24 }, (_, i) => i * 15 * DEG);
/** A fist round a knob, m. */
const FIST = 0.045;

type P = readonly number[];
const sub = (a: P, b: P) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The shortest distance from point p to the segment a-b. */
function pointSegment(p: P, a: P, b: P): number {
  const d = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d)));
  return dist(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]);
}

/** Whether the segment a-b passes through the box with corners lo and hi (slab test). */
function segmentHitsBox(a: P, b: P, lo: P, hi: P): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < lo[k] || a[k] > hi[k]) return false;
      continue;
    }
    let u0 = (lo[k] - a[k]) / d;
    let u1 = (hi[k] - a[k]) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return false;
  }
  return true;
}

/** The eyepiece box (with the window's surround behind it) in its own space: the window's middle at the origin, facing +Z, before it is tipped. */
const EYEPIECE_LO: Vec3 = [-EYEPIECE_BOX.width / 2, -EYEPIECE_BOX.height / 2, -WINDOW_PROUD - EYEPIECE_BOX.depth];
const EYEPIECE_HI: Vec3 = [EYEPIECE_BOX.width / 2, EYEPIECE_BOX.height / 2, 0.012];

/** A point in periscope `id`'s frame taken into its eyepiece's own space (untipped about the window's middle). */
function toEyepiece(id: 'driver' | 'gunner', p: P): Vec3 {
  const l = PERISCOPES[id].lens;
  const c = Math.cos(EYEPIECE_TILT);
  const n = Math.sin(EYEPIECE_TILT);
  const y = p[1] - l[1];
  const z = p[2] - l[2];
  return [p[0] - l[0], y * c + z * n, -y * n + z * c];
}

/** The eyepiece box's eight corners in the frame. */
function eyepieceCorners(id: 'driver' | 'gunner'): Vec3[] {
  const l = PERISCOPES[id].lens;
  const c = Math.cos(EYEPIECE_TILT);
  const n = Math.sin(EYEPIECE_TILT);
  const out: Vec3[] = [];
  for (const x of [EYEPIECE_LO[0], EYEPIECE_HI[0]])
    for (const y of [EYEPIECE_LO[1], EYEPIECE_HI[1]])
      for (const z of [EYEPIECE_LO[2], EYEPIECE_HI[2]]) out.push([l[0] + x, l[1] + y * c - z * n, l[2] + y * n + z * c]);
  return out;
}

/** Whether the segment a-b passes through periscope `id`'s eyepiece. */
function segmentHitsEyepiece(id: 'driver' | 'gunner', a: P, b: P): boolean {
  return segmentHitsBox(toEyepiece(id, a), toEyepiece(id, b), EYEPIECE_LO, EYEPIECE_HI);
}

/** How far point p is from periscope `id`'s eyepiece (0 inside it). */
function eyepieceDistance(id: 'driver' | 'gunner', p: P): number {
  const q = toEyepiece(id, p);
  return Math.hypot(...[0, 1, 2].map((k) => Math.max(EYEPIECE_LO[k] - q[k], 0, q[k] - EYEPIECE_HI[k])));
}

/** The crank and its gearbox as a box in the frame: everything that sticks out of the eyepiece's right side. */
function crankBox(id: 'driver' | 'gunner'): [Vec3, Vec3] {
  const s = PERISCOPES[id];
  const r = PERISCOPE_CRANK.radius + 0.012;
  return [
    [s.lens[0] + EYEPIECE_BOX.width / 2, s.crank[1] - r, s.crank[2] - 0.06],
    [s.crank[0] + r, s.crank[1] + r, s.crank[2] + PERISCOPE_CRANK.knobLength],
  ];
}

/** A driver's lever's handle middle in hull space at its angle `angle`. */
function leverHandle(id: (typeof DRIVER_CONTROL_IDS)[number], angle: number): Vec3 {
  const { spec, pivot } = DRIVER_CONTROLS[id];
  const lever = new Lever(spec);
  lever.angle = angle;
  const p = lever.handle(1, [0, 0, 0]);
  return [pivot[0] + p[0], pivot[1] + p[1], pivot[2] + p[2]];
}

/** A hand on the crank's knob at `deg` round it (0 at the top, anticlockwise as the player sees it), in wheel space. */
function knobHand(deg: number): HandInput {
  const a = deg * DEG;
  const r = PERISCOPE_CRANK.radius;
  return { fist: [-r * Math.sin(a), r * Math.cos(a), 0.03], across: [0, 0, 1], tip: null, trigger: 0, tracked: false };
}

/** The eyes looking into a window: both eyes `back` m behind its middle, level with it. */
function eyesAt(lens: P, back: number): Vec3[] {
  return [-1, 1].map((side): Vec3 => [lens[0] + side * HALF_IPD, lens[1], lens[2] + back]);
}

/** The eyes looking into periscope `id`'s window: both `back` m out from its middle along the way it faces (up and into it). */
function eyesInto(id: 'driver' | 'gunner', back: number): Vec3[] {
  const at = lookingIn(PERISCOPES[id], back, [0, 0, 0]);
  return [-1, 1].map((side): Vec3 => [at[0] + side * HALF_IPD, at[1], at[2]]);
}

describe('the crew periscopes (F1.6, F1.19)', () => {
  it('puts each window just above its seat\'s main view: a short sit-up and lean, reachable inside the head box', () => {
    for (const id of PERISCOPE_IDS) {
      const s = PERISCOPES[id];
      const eye = SEATS[id].eye;
      const [left, right, forward] = SEATS[id].headBox;
      // The window 8 to 15 cm above the eye point, straight ahead of it give or take 10 cm, 15 to 30 cm away all told.
      expect(s.lens[1] - eye[1], id).toBeGreaterThan(0.08);
      expect(s.lens[1] - eye[1], id).toBeLessThan(0.15);
      expect(Math.abs(s.lens[0] - eye[0]), id).toBeLessThan(0.1);
      expect(dist(s.lens, eye), id).toBeGreaterThan(0.15);
      expect(dist(s.lens, eye), id).toBeLessThan(0.3);
      // Tipped a little to face down towards the eyes, so they meet it a short sit-up above the eye point (John, 2026-11-07:
      // 12 to 14 cm was too far; 2026-11-08: the 30° tilt was too steep to look into comfortably). The gunner's sits over
      // the sight's hood, so a little higher.
      expect(s.facing[1], id).toBeLessThan(-0.2);
      expect(s.facing[1], id).toBeGreaterThan(-0.3);
      expect(s.facing[2], id).toBeGreaterThan(0.95);
      const rise = id === 'driver' ? 0.085 : 0.11;
      expect(lookingIn(s, 0.06, [0, 0, 0])[1] - eye[1], id).toBeLessThan(rise);
      expect(lookingIn(s, OPEN_DISTANCE, [0, 0, 0])[1] - eye[1], id).toBeLessThan(rise - 0.005);
      // The head can bring both eyes within the opening distance: 6 cm out from the window, inside the head box and under its roof stop.
      for (const e of eyesInto(id, 0.06)) {
        expect(e[0], id).toBeGreaterThan(eye[0] - left);
        expect(e[0], id).toBeLessThan(eye[0] + right);
        expect(e[2], id).toBeGreaterThan(eye[2] - forward);
        expect(e[1] - eye[1], id).toBeLessThan(SEATS[id].headUp);
        expect(dist(e, s.lens), id).toBeLessThan(OPEN_DISTANCE);
      }
      // Wide enough for both eyes to look through at once.
      expect(WINDOW.width).toBeGreaterThan(4 * HALF_IPD);
      expect(WINDOW.width).toBeLessThan(EYEPIECE_BOX.width);
      expect(WINDOW.height).toBeLessThan(EYEPIECE_BOX.height);
    }
  });

  it("leaves the driver's vision slit clear from the seat and leant in to it, crank and all, however the crank is turned", () => {
    const eye = SEATS.driver.eye;
    const [cranklo, crankhi] = crankBox('driver');
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [VISION_SLIT.x + (sx * VISION_SLIT.width) / 2, VISION_SLIT.y + (sy * VISION_SLIT.height) / 2, VISION_SLIT.z]));
    for (const z of [eye[2], eye[2] - SEATS.driver.headBox[2]]) {
      for (const side of [-1, 1]) {
        const e = [eye[0] + side * HALF_IPD, eye[1], z];
        for (const c of corners) {
          const label = `eye ${e.map((v) => v.toFixed(2))} to ${c.map((v) => v.toFixed(2))}`;
          expect(segmentHitsEyepiece('driver', e, c), label).toBe(false);
          expect(segmentHitsBox(e, c, cranklo, crankhi), label).toBe(false);
          // A hand on the knob anywhere round stays out of the view too.
          for (const crank of CRANKS) {
            const knob = knobMiddle(DRIVER_PERISCOPE, crank, [0, 0, 0]);
            expect(pointSegment(knob, e, c), `the knob at ${(crank / DEG).toFixed(0)}°`).toBeGreaterThan(FIST);
          }
        }
      }
    }
    // Leant right in to the slit, the eyes stay further than the near plane (5 cm) from the eyepiece over them.
    for (const side of [-1, 1]) {
      const leant = [eye[0] + side * HALF_IPD, eye[1], eye[2] - SEATS.driver.headBox[2]];
      expect(eyepieceDistance('driver', leant)).toBeGreaterThan(0.055);
      expect(Math.min(...eyepieceCorners('driver').map((p) => p[2]))).toBeLessThan(leant[2]);
    }
  });

  it("keeps the gunner's eyepiece and crank clear of the gunsight, and only one of them opens", () => {
    const corners = eyepieceCorners('gunner');
    // Over the sight's eyepiece (its hood 10 cm high, 11 cm wide), with room between.
    expect(Math.min(...corners.map((p) => p[1])) - (EYEPIECE[1] + 0.05)).toBeGreaterThan(0.025);
    expect(Math.abs(GUNNER_PERISCOPE.lens[0] - EYEPIECE[0])).toBeLessThan(0.01);
    // An eye at the sight is beyond the periscope's opening distance, and nearer the sight's lens than the periscope's window.
    for (const e of eyesAt(EYEPIECE, 0.05)) {
      expect(dist(e, GUNNER_PERISCOPE.lens)).toBeGreaterThan(OPEN_DISTANCE + 0.03);
      expect(dist(e, GUNNER_PERISCOPE.lens) - dist(e, EYEPIECE)).toBeGreaterThan(0.05);
    }
    // The eyes looking up into the periscope are nearer its window than the sight's lens, so the periscope has them (SightSystem yields).
    for (const back of [0.05, 0.07, OPEN_DISTANCE - 0.005]) {
      for (const e of eyesInto('gunner', back)) expect(dist(e, EYEPIECE) - dist(e, GUNNER_PERISCOPE.lens), `${back}`).toBeGreaterThan(0.01);
    }
    // The eyes at the sight sit under the eyepiece, clear of it: the forehead 9 cm over them.
    const atSight = [EYEPIECE[0], EYEPIECE[1], EYEPIECE[2] + 0.05];
    expect(eyepieceDistance('gunner', [atSight[0], atSight[1] + 0.09, atSight[2]])).toBeGreaterThan(0.005);
    expect(Math.max(...corners.map((p) => p[2]))).toBeLessThan(atSight[2] - 0.02);
  });

  it('puts each crank in reach of the right hand, clear of the face at the window and of the other controls', () => {
    for (const id of PERISCOPE_IDS) {
      const s = PERISCOPES[id];
      const eye = SEATS[id].eye;
      const shoulder = [eye[0] + 0.18, eye[1] - 0.2, eye[2]];
      for (const crank of CRANKS) {
        const knob = knobMiddle(s, crank, [0, 0, 0]);
        const label = `${id}'s knob at ${(crank / DEG).toFixed(0)}°`;
        // At face height: a raised hand, within an easy reach of the right shoulder (a departure from knee-to-chest height, docs/periscope.md).
        expect(dist(knob, shoulder), label).toBeLessThan(0.5);
        expect(knob[1] - eye[1], label).toBeLessThan(0.25);
        // Clear of the face with the eyes at the window: the fist stays 10 cm from each eye.
        for (const e of eyesInto(id, 0.06)) expect(dist(knob, e), label).toBeGreaterThan(0.1);
        // Under the roof and in front of the seat.
        expect(knob[1] + FIST, label).toBeLessThan(s.roof - 0.02);
        expect(knob[2], label).toBeLessThan(eye[2]);
      }
    }
    // Further from the driver's levers, and from the gunner's wheels, grip and breech lever, than a hand reaches.
    for (const crank of CRANKS) {
      const knob = knobMiddle(DRIVER_PERISCOPE, crank, [0, 0, 0]);
      for (const id of DRIVER_CONTROL_IDS) {
        const { spec } = DRIVER_CONTROLS[id];
        for (const a of [spec.min, 0, spec.max]) expect(dist(knob, leverHandle(id, a)), `${id}`).toBeGreaterThan(0.15);
      }
      const gknob = knobMiddle(GUNNER_PERISCOPE, crank, [0, 0, 0]);
      for (const key of STATION_CONTROLS) expect(dist(gknob, STATION[key].at), key).toBeGreaterThan(0.25);
      const lever = [LEVER_PIVOT[0], TRUNNION.y + LEVER_PIVOT[1], TRUNNION.z + LEVER_PIVOT[2]];
      expect(dist(gknob, lever)).toBeGreaterThan(0.25);
    }
    // The cranks are inside the hull's and the turret's walls.
    expect(DRIVER_PERISCOPE.crank[0] + PERISCOPE_CRANK.radius).toBeLessThan(HULL.halfWidth - 0.1);
    expect(GUNNER_PERISCOPE.crank[0] + PERISCOPE_CRANK.radius).toBeLessThan(TURRET.halfWidth - 0.2);
  });

  it("stands the driver's head on the hull roof ahead of the hatch and its open lid, outside the turret's sweep and under the gun", () => {
    const s = DRIVER_PERISCOPE;
    expect(s.head.bottom).toBeLessThan(s.roofTop);
    expect(s.head.bottom).toBeGreaterThan(HULL.roof);
    expect(s.cameraY).toBeGreaterThan(s.roofTop + 0.03);
    expect(s.cameraY).toBeLessThan(s.head.top);
    // Under the barrel with the gun level, as it sweeps over the hull (the lid 1 cm over the head's top).
    expect(s.head.top + 0.01).toBeLessThan(BARREL_UNDERSIDE);
    // Ahead of the hatch's hole and of its lid standing open in front of it.
    const reach = Math.hypot(HEAD_SIZE.width / 2, HEAD_SIZE.depth / 2);
    expect(s.axis[1] + reach).toBeLessThan(DRIVER_HATCH[1]);
    expect(s.axis[1] + reach).toBeLessThan(DRIVER_LID_FRONT - 0.003);
    // Clear of the turret's walls however it turns (their corners are 1.63 m from the ring's middle).
    expect(Math.hypot(s.axis[0], s.axis[1] - TURRET.z) - reach).toBeGreaterThan(Math.hypot(TURRET.halfWidth, TURRET.front) + 0.1);
    // Inside the hull's sides and behind the hood's face.
    expect(Math.abs(s.axis[0]) + reach).toBeLessThan(HULL.halfWidth);
    expect(s.axis[1] - reach).toBeGreaterThan(GLACIS.face - HULL.wall);
    // The eyepiece hangs behind the slit's leather brow pad (SLIT_FRAME), the housing over the pad's top.
    const front = Math.min(...eyepieceCorners('driver').map((p) => p[2]));
    expect(front - (VISION_SLIT.z - 0.005 + SLIT_FRAME.padDepth)).toBeGreaterThan(0.01);
    expect(s.roof - RELAY.depth - (VISION_SLIT.y + VISION_SLIT.height / 2 + SLIT_FRAME.padAbove + SLIT_FRAME.padHeight)).toBeGreaterThan(0.025);
    expect(s.axis[1] - 0.035).toBeGreaterThan(GLACIS.face);
  });

  it("stands the gunner's head on the turret roof ahead of the hatch, clear of its collar, inside the roof's edges", () => {
    const s = GUNNER_PERISCOPE;
    expect(s.roof).toBe(TURRET.roof);
    expect(s.head.bottom).toBeLessThan(s.roofTop);
    expect(s.head.bottom).toBeGreaterThan(TURRET.roof);
    expect(s.cameraY).toBeGreaterThan(s.roofTop + 0.03);
    // The hatch (cabin.scene-asset.ts): a 27 cm hole over the gunner's eyes, 10 cm behind them, with a collar 3 cm round it under the roof.
    const hatch = [SEATS.gunner.eye[0], SEATS.gunner.eye[2] + 0.1];
    const collar = 0.045;
    expect(Math.hypot(s.axis[0] - hatch[0], s.axis[1] - hatch[1]) - collar).toBeGreaterThan(0.27 + 0.06);
    // Inside the roof's chamfered edges (12 cm), and ahead of the hatch.
    const reach = Math.hypot(HEAD_SIZE.width / 2, HEAD_SIZE.depth / 2);
    expect(Math.abs(s.axis[0]) + reach).toBeLessThan(TURRET.halfWidth - 0.12);
    expect(s.axis[1] - reach).toBeGreaterThan(TURRET.front + 0.12);
    expect(s.axis[1]).toBeLessThan(hatch[1] - 0.27);
    // The eyepiece hangs from the roof, clear of the gun's breech below (the breech's top at most 20 cm over the trunnions' line).
    expect(s.lens[1] - EYEPIECE_BOX.height / 2).toBeGreaterThan(TRUNNION.y + 0.2);
  });

  it('looks the way the crank turns: ahead at 0, left for an anticlockwise turn, a quarter of the way round a turn', () => {
    const out: Vec3 = [0, 0, 0];
    lookDirection(0, out);
    expect(out[2]).toBeCloseTo(-Math.cos(2 * DEG), 9);
    expect(out[1]).toBeLessThan(0);
    lookDirection(90 * DEG, out);
    expect(out[0]).toBeCloseTo(-Math.cos(2 * DEG), 9);
    expect(Math.hypot(...out)).toBeCloseTo(1, 9);
    expect(CRANK_RATIO).toBeCloseTo(4, 9);
    expect(periscopeAngle(2 * Math.PI)).toBeCloseTo(90 * DEG, 9);
    expect(crankFor(periscopeAngle(1.234))).toBeCloseTo(1.234, 9);
    // A tick every 15° of the periscope.
    expect(PERISCOPE_CRANK.tickEvery).toBeCloseTo(60 * DEG, 9);
    // Anticlockwise as the player sees it moves the knob from the top to the left.
    const top = knobMiddle(DRIVER_PERISCOPE, 0, [0, 0, 0]);
    const quarter = knobMiddle(DRIVER_PERISCOPE, 90 * DEG, [0, 0, 0]);
    expect(quarter[0]).toBeLessThan(top[0]);
    expect(quarter[1]).toBeLessThan(top[1]);
    expect(bearing(370 * DEG)).toBeCloseTo(10, 9);
    expect(bearing(-Math.PI)).toBe(180);
    expect(bearingText(0.01)).toBe('ahead');
    expect(bearingText(40 * DEG)).toBe('40° left');
    expect(bearingText(-90 * DEG)).toBe('90° right');
    expect(bearingText(Math.PI)).toBe('behind');
    expect(lookText(GUNNER_PERISCOPE, 0)).toBe('along the gun');
    expect(lookText(GUNNER_PERISCOPE, -30 * DEG)).toBe('30° right of the gun');
    expect(periscopesLine(40 * DEG, 0)).toBe("The driver's periscope looks 40° left, the gunner's along the gun");
  });

  it('draws its picture with square texels over a field wider than tall', () => {
    expect(PICTURE_WIDTH / PICTURE_HEIGHT).toBeCloseTo(Math.tan(HALF_FIELD_X) / Math.tan(HALF_FIELD_Y), 1);
    expect(HALF_FIELD_X).toBeGreaterThan(HALF_FIELD_Y);
  });

  it('turns with the hand on the crank, all the way round and on', () => {
    const crank = new Wheel(PERISCOPE_CRANK);
    expect(crank.grab(1, knobHand(0))).toBe(true);
    // Five turns anticlockwise, 4° a frame: the periscope goes 450° left (the crank a frame behind the hand).
    for (let i = 1; i <= 450; i++) crank.update(DT, [null, knobHand(i * 4)]);
    expect(Math.abs(crank.angle / DEG - 1800)).toBeLessThan(5);
    expect(Math.abs(periscopeAngle(crank.angle) / DEG - 450)).toBeLessThan(1.5);
    expect(Math.abs(bearing(periscopeAngle(crank.angle)) - 90)).toBeLessThan(1.5);
  });
});

describe('the periscope packets (F1.6, F1.19)', () => {
  it('use a packet type each and round-trip the angle, wrapped', () => {
    expect(PacketType.PeriscopeState).toBe(9);
    expect(PacketType.GunnerPeriscopeState).toBe(10);
    const buffer = new ArrayBuffer(PERISCOPE_STATE_BYTES);
    const header: TankHeader = { seq: 0, timeMs: 0 };
    for (const type of [PacketType.PeriscopeState, PacketType.GunnerPeriscopeState] as const) {
      for (const angle of [0, 0.5, -2.9, Math.PI, 7.5]) {
        const length = encodePeriscopeState(buffer, 65537, 123456.7, angle, type);
        expect(length).toBe(PERISCOPE_STATE_BYTES);
        const got = decodePeriscopeState(new DataView(buffer, 0, length), header, type);
        const want = Math.atan2(Math.sin(angle), Math.cos(angle));
        expect(Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want)))).toBeLessThan(1e-4);
        expect(header.seq).toBe(1);
        expect(header.timeMs).toBe(123456);
      }
    }
  });

  it("turn away other packets and short ones, so the gunner's is never taken for the driver's (as an older page would)", () => {
    const header: TankHeader = { seq: 0, timeMs: 0 };
    const buffer = new ArrayBuffer(PERISCOPE_STATE_BYTES);
    encodePeriscopeState(buffer, 1, 0, 1);
    expect(decodePeriscopeState(new DataView(buffer, 0, PERISCOPE_STATE_BYTES - 1), header)).toBeNaN();
    expect(decodePeriscopeState(new DataView(buffer), header, PacketType.GunnerPeriscopeState)).toBeNaN();
    encodePeriscopeState(buffer, 1, 0, 1, PacketType.GunnerPeriscopeState);
    expect(decodePeriscopeState(new DataView(buffer), header)).toBeNaN();
    new DataView(buffer).setUint8(0, PacketType.TurretState);
    expect(decodePeriscopeState(new DataView(buffer), header)).toBeNaN();
  });
});
