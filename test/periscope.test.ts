import { describe, expect, it } from 'vitest';
import { decodePeriscopeState, encodePeriscopeState, PERISCOPE_STATE_BYTES } from '../src/net/periscope-codec.js';
import { PacketType } from '../src/net/pose-codec.js';
import type { TankHeader } from '../src/net/tank-codec.js';
import { GRIP_RADIUS } from '../src/scene-assets/mechanism.scene-asset.js';
import { rigOffset, targetEyeHeight } from '../src/sim/body-height.js';
import { HULL, SEATS, TURRET, VISION_SLIT } from '../src/sim/cabin.js';
import { DIALS, dialCentre, DRIVER_CONTROL_IDS, DRIVER_CONTROLS, PANEL, panelToHull } from '../src/sim/driver-station.js';
import { type HandInput, Lever, type Vec3, Yoke } from '../src/sim/mechanism.js';
import {
  AXIS,
  BARREL_UNDERSIDE,
  bearing,
  bearingText,
  CAMERA_Y,
  EYEPIECE_BOX,
  HALF_FIELD_X,
  HALF_FIELD_Y,
  HEAD,
  handleMiddle,
  LENS,
  lookDirection,
  PERISCOPE_YOKE,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  periscopeToHull,
  SHAFT_RADIUS,
  WINDOW,
  YOKE_Y,
} from '../src/sim/periscope.js';
import { HALF_IPD, OPEN_DISTANCE } from '../src/sim/sight.js';

const DEG = Math.PI / 180;
const DT = 1 / 90;
const EYE = SEATS.driver.eye;
const ANGLES = Array.from({ length: 24 }, (_, i) => i * 15 * DEG);

type P = readonly number[];
const sub = (a: P, b: P) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The shortest distance between segments a0-a1 and b0-b1 (sampled finely: plenty for these sizes). */
function segmentGap(a0: P, a1: P, b0: P, b1: P): number {
  let best = Infinity;
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const p = [0, 1, 2].map((k) => a0[k] + ((a1[k] - a0[k]) * i) / n);
    const d = sub(b1, b0);
    const t = Math.max(0, Math.min(1, dot(sub(p, b0), d) / dot(d, d)));
    best = Math.min(best, dist(p, [b0[0] + d[0] * t, b0[1] + d[1] * t, b0[2] + d[2] * t]));
  }
  return best;
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

/** A handle's two ends in hull space at yoke angle `angle`. */
function handleEnds(dir: -1 | 1, angle: number): [Vec3, Vec3] {
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  periscopeToHull([dir * PERISCOPE_YOKE.inner, 0, 0], angle, a);
  periscopeToHull([dir * PERISCOPE_YOKE.outer, 0, 0], angle, b);
  return [a, b];
}

/** A driver's lever's handle middle in hull space at its angle `angle`. */
function leverHandle(id: (typeof DRIVER_CONTROL_IDS)[number], angle: number): Vec3 {
  const { spec, pivot } = DRIVER_CONTROLS[id];
  const lever = new Lever(spec);
  lever.angle = angle;
  const p = lever.handle(1, [0, 0, 0]);
  return [pivot[0] + p[0], pivot[1] + p[1], pivot[2] + p[2]];
}

/** A controller hand at `deg` round the yoke on handle `dir`, `r` out, in periscope space. */
function yokeHand(dir: -1 | 1, deg: number, r = 0.12): HandInput {
  const a = deg * DEG;
  return { fist: [r * Math.cos(a) * dir, 0, -r * Math.sin(a) * dir], across: [1, 0, 0], tip: null, trigger: 0, tracked: false };
}

describe('the periscope (F1.6)', () => {
  it('puts both handles in reach from a chair, between knee and chest height, however it is turned', () => {
    // As test/driver-station.test.ts: a seated player's hands reach from about 0.45 m to 1.4 m above their real floor.
    const raised = rigOffset(targetEyeHeight({ raise: 0, seated: true }), 1.2);
    for (const angle of ANGLES) {
      for (const dir of [-1, 1] as const) {
        const [x, y, z] = handleMiddle(dir, angle, [0, 0, 0]);
        const label = `${dir < 0 ? 'left' : 'right'} handle at ${(angle / DEG).toFixed(0)}°`;
        expect(y - raised, label).toBeGreaterThan(0.45);
        expect(y - raised, label).toBeLessThan(1.4);
        // Ahead of the chest, and within an arm's length of the nearer shoulder (20 cm under the eyes, 18 cm to the side).
        expect(EYE[2] - z, label).toBeGreaterThan(0.18);
        const shoulder = EYE[0] + (x < EYE[0] ? -0.18 : 0.18);
        expect(Math.hypot(x - shoulder, y - (EYE[1] - 0.2), z - EYE[2]), label).toBeLessThan(0.75);
        // Clear of the face, and inside the hull clear of its walls and the front plate.
        expect(dist([x, y, z], EYE), label).toBeGreaterThan(0.25);
        expect(Math.abs(x) + PERISCOPE_YOKE.outer - (PERISCOPE_YOKE.inner + PERISCOPE_YOKE.outer) / 2, label).toBeLessThan(HULL.halfWidth - 0.05);
        expect(z, label).toBeGreaterThan(HULL.front + 0.1);
      }
    }
  });

  it("keeps its handles further from the driver's levers than a hand reaches, so a squeeze takes the one meant", () => {
    for (const angle of ANGLES) {
      for (const dir of [-1, 1] as const) {
        const p = handleMiddle(dir, angle, [0, 0, 0]);
        for (const id of DRIVER_CONTROL_IDS) {
          const { spec } = DRIVER_CONTROLS[id];
          for (const a of [spec.min, 0, spec.max]) {
            expect(dist(p, leverHandle(id, a)), `${id} to the periscope at ${(angle / DEG).toFixed(0)}°`).toBeGreaterThan(0.15);
          }
        }
      }
    }
  });

  it('puts the window a lean ahead and to the left, with room to lean in to it inside the head box', () => {
    const [left, , forward] = SEATS.driver.headBox;
    // 25 to 40 cm from the eye point: a lean, not a reach.
    expect(dist(LENS, EYE)).toBeGreaterThan(0.25);
    expect(dist(LENS, EYE)).toBeLessThan(0.4);
    // The head can get both eyes within the opening distance: the head box lets it reach a point 6 cm behind the window.
    const head = [LENS[0], EYE[1], LENS[2] + 0.06];
    expect(head[0]).toBeGreaterThan(EYE[0] - left);
    expect(head[2]).toBeGreaterThan(EYE[2] - forward);
    expect(Math.hypot(HALF_IPD, 0.06, LENS[1] - EYE[1])).toBeLessThan(OPEN_DISTANCE);
    // Wide enough for both eyes to look through at once.
    expect(WINDOW.width).toBeGreaterThan(4 * HALF_IPD);
    expect(WINDOW.width).toBeLessThan(EYEPIECE_BOX.width);
    expect(WINDOW.height).toBeLessThan(EYEPIECE_BOX.height);
  });

  it('leaves the vision slit clear from the seat and when leaning in to it', () => {
    const lo = [AXIS[0] - EYEPIECE_BOX.width / 2, EYEPIECE_BOX.y - EYEPIECE_BOX.height / 2, AXIS[1] - EYEPIECE_BOX.depth / 2];
    const hi = [AXIS[0] + EYEPIECE_BOX.width / 2, EYEPIECE_BOX.y + EYEPIECE_BOX.height / 2, AXIS[1] + EYEPIECE_BOX.depth / 2 + 0.012];
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [VISION_SLIT.x + (sx * VISION_SLIT.width) / 2, VISION_SLIT.y + (sy * VISION_SLIT.height) / 2, HULL.front]));
    for (const z of [EYE[2], EYE[2] - SEATS.driver.headBox[2]]) {
      for (const side of [-1, 1]) {
        const eye = [EYE[0] + side * HALF_IPD, EYE[1], z];
        for (const c of corners) expect(segmentHitsBox(eye, c, lo, hi), `eye ${eye.map((v) => v.toFixed(2))} to ${c.map((v) => v.toFixed(2))}`).toBe(false);
      }
    }
    // Leaning straight in to the slit, the head (8 cm either side of the eyes) passes the eyepiece.
    expect(VISION_SLIT.x - 0.08).toBeGreaterThan(hi[0] + 0.02);
  });

  it('can read the gauges past the yoke and its shaft, however it is turned', () => {
    const at: [number, number] = [0, 0];
    const shaft = [[AXIS[0], YOKE_Y, AXIS[1]], [AXIS[0], EYEPIECE_BOX.y, AXIS[1]]];
    for (let i = 0; i < DIALS.length; i++) {
      dialCentre(i, at);
      for (const dy of [-PANEL.dialRadius, 0, PANEL.dialRadius]) {
        for (const dx of [-PANEL.dialRadius, 0, PANEL.dialRadius]) {
          const dial = panelToHull([at[0] + dx, at[1] + dy, 0], [0, 0, 0]);
          expect(segmentGap(EYE, dial, shaft[0], shaft[1]), `the shaft over dial ${i}`).toBeGreaterThan(SHAFT_RADIUS + 0.01);
          for (const angle of ANGLES) {
            for (const dir of [-1, 1] as const) {
              const [a, b] = handleEnds(dir, angle);
              expect(segmentGap(EYE, dial, a, b), `handle ${dir} at ${(angle / DEG).toFixed(0)}° over dial ${i}`).toBeGreaterThan(GRIP_RADIUS + 0.01);
            }
          }
        }
      }
    }
  });

  it('stands its head on the roof ahead of the hatch, outside the turret ring and under the gun', () => {
    const roofTop = HULL.roof + HULL.wall;
    expect(HEAD.bottom).toBeLessThan(roofTop);
    expect(HEAD.bottom).toBeGreaterThan(HULL.roof);
    expect(CAMERA_Y).toBeGreaterThan(roofTop + 0.03);
    expect(CAMERA_Y).toBeLessThan(HEAD.top);
    // Under the barrel with the gun level, as it sweeps over the hull (the lid 1 cm over the head's top).
    expect(HEAD.top + 0.01).toBeLessThan(BARREL_UNDERSIDE);
    // The driver's hatch is 50 cm square over their eyes (cabin.scene-asset.ts): the shaft and the head go through the roof ahead of it.
    const reach = Math.hypot(HEAD.width / 2, HEAD.depth / 2);
    expect(AXIS[1] + reach).toBeLessThan(EYE[2] - 0.25);
    // Clear of the turret's walls however it turns (their corners are 1.63 m from the ring's middle).
    expect(Math.hypot(AXIS[0], AXIS[1] - TURRET.z) - reach).toBeGreaterThan(Math.hypot(TURRET.halfWidth, TURRET.front) + 0.1);
    // Inside the hull's sides and front.
    expect(Math.abs(AXIS[0]) + reach).toBeLessThan(HULL.halfWidth);
    expect(AXIS[1] - reach).toBeGreaterThan(HULL.front);
  });

  it('looks the way the yoke turns: ahead at 0, left for a positive turn, a little down', () => {
    const out: [number, number, number] = [0, 0, 0];
    lookDirection(0, out);
    expect(out[2]).toBeCloseTo(-Math.cos(2 * DEG), 9);
    expect(out[1]).toBeLessThan(0);
    lookDirection(90 * DEG, out);
    expect(out[0]).toBeCloseTo(-Math.cos(2 * DEG), 9);
    expect(Math.hypot(...out)).toBeCloseTo(1, 9);
    // The right handle pushed forwards turns it left.
    const right0 = handleMiddle(1, 0, [0, 0, 0]);
    const right30 = handleMiddle(1, 30 * DEG, [0, 0, 0]);
    expect(right30[2]).toBeLessThan(right0[2]);
    expect(bearing(370 * DEG)).toBeCloseTo(10, 9);
    expect(bearing(-Math.PI)).toBe(180);
    expect(bearingText(0.01)).toBe('ahead');
    expect(bearingText(40 * DEG)).toBe('40° left');
    expect(bearingText(-90 * DEG)).toBe('90° right');
    expect(bearingText(Math.PI)).toBe('behind');
  });

  it('draws its picture with square texels over a field wider than tall', () => {
    expect(PICTURE_WIDTH / PICTURE_HEIGHT).toBeCloseTo(Math.tan(HALF_FIELD_X) / Math.tan(HALF_FIELD_Y), 1);
    expect(HALF_FIELD_X).toBeGreaterThan(HALF_FIELD_Y);
  });

  it('turns quickly in both hands and at 30°/s in one, all the way round', () => {
    const both = new Yoke(PERISCOPE_YOKE);
    expect(both.grab(0, yokeHand(-1, 0))).toBe(true);
    expect(both.grab(1, yokeHand(1, 0))).toBe(true);
    for (let i = 1; i <= 90; i++) both.update(DT, [yokeHand(-1, i * 4), yokeHand(1, i * 4)]);
    expect(both.angle / DEG).toBeGreaterThan(355);
    const one = new Yoke(PERISCOPE_YOKE);
    expect(one.grab(1, yokeHand(1, 0))).toBe(true);
    for (let i = 1; i <= 90; i++) one.update(DT, [null, yokeHand(1, i)]);
    expect(one.angle / DEG).toBeCloseTo(30, 0);
    expect(one.strain[1] / DEG).toBeGreaterThan(50);
  });
});

describe('the periscope packet (F1.6)', () => {
  it('uses its own packet type and round-trips the angle, wrapped', () => {
    expect(PacketType.PeriscopeState).toBe(9);
    const buffer = new ArrayBuffer(PERISCOPE_STATE_BYTES);
    const header: TankHeader = { seq: 0, timeMs: 0 };
    for (const angle of [0, 0.5, -2.9, Math.PI, 7.5]) {
      const length = encodePeriscopeState(buffer, 65537, 123456.7, angle);
      expect(length).toBe(PERISCOPE_STATE_BYTES);
      const got = decodePeriscopeState(new DataView(buffer, 0, length), header);
      const want = Math.atan2(Math.sin(angle), Math.cos(angle));
      expect(Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want)))).toBeLessThan(1e-4);
      expect(header.seq).toBe(1);
      expect(header.timeMs).toBe(123456);
    }
  });

  it('turns away other packets and short ones', () => {
    const header: TankHeader = { seq: 0, timeMs: 0 };
    const buffer = new ArrayBuffer(PERISCOPE_STATE_BYTES);
    encodePeriscopeState(buffer, 1, 0, 1);
    expect(decodePeriscopeState(new DataView(buffer, 0, PERISCOPE_STATE_BYTES - 1), header)).toBeNaN();
    new DataView(buffer).setUint8(0, PacketType.TurretState);
    expect(decodePeriscopeState(new DataView(buffer), header)).toBeNaN();
  });
});
