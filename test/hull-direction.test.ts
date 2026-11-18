import { describe, expect, it } from 'vitest';
import { AMMO } from '../src/sim/ammo.js';
import { HULL } from '../src/sim/cabin.js';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.js';
import { LIVE_ITEMS } from '../src/live-settings.js';
import {
  fieldToMark,
  gunTurn,
  hullOnMark,
  hullTurn,
  type LensField,
  MARK_DRAWING,
  MARK_EDGE,
  MARK_LAYERS,
  MARK_RADIUS,
  markPlace,
  markToField,
  markUv,
  noseHour,
  turnedUp,
} from '../src/sim/hull-direction.js';
import { HALF_FIELD_X, HALF_FIELD_Y, PERISCOPE_POWER } from '../src/sim/periscope.js';
import { MAGNIFICATION, rangeMarks, TRUE_HALF_FIELD } from '../src/sim/sight.js';
import { DIAL_HULL, yawForHour } from '../src/sim/turret-dial.js';

const DEG = Math.PI / 180;
const SIGHT: LensField = { magnification: MAGNIFICATION, halfFieldX: TRUE_HALF_FIELD, halfFieldY: TRUE_HALF_FIELD, stop: 'round' };
const PERISCOPE: LensField = { magnification: PERISCOPE_POWER, halfFieldX: HALF_FIELD_X, halfFieldY: HALF_FIELD_Y, stop: 'rectangle' };

/** The ray the eye sees field point (x, y) along (the lens shader's sums backwards): a unit vector, −Z into the lens. */
function eyeRay(field: LensField, x: number, y: number): [number, number, number] {
  const tx = x * Math.tan(field.halfFieldX);
  const ty = y * Math.tan(field.halfFieldY);
  const t = Math.hypot(tx, ty);
  const apparent = field.magnification * Math.atan(t);
  const s = t > 0 ? Math.sin(apparent) / t : 0;
  return [tx * s, ty * s, -Math.cos(apparent)];
}

/** The angle between the eye's rays to two field points, radians. */
function apart(field: LensField, a: [number, number], b: [number, number]): number {
  const p = eyeRay(field, ...a);
  const q = eyeRay(field, ...b);
  return Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
}

/** Points round the mark's rim in field units. */
function rim(field: LensField, r = 1): [number, number][] {
  const place = markPlace(field);
  const out: [number, number][] = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    out.push(markToField(place, field, Math.cos(a) * r, Math.sin(a) * r, [0, 0]));
  }
  return out;
}

describe('the hull direction mark (F2.4)', () => {
  it('sits in the lower left of each view, inside the field stop', () => {
    for (const field of [SIGHT, PERISCOPE]) {
      const place = markPlace(field);
      expect(place.at[0]).toBeLessThan(0);
      expect(place.at[1]).toBeLessThan(0);
      for (const [x, y] of rim(field)) {
        // The round stop darkens from 0.94 of the radius, the window's from 0.94 of each half.
        const edge = field.stop === 'round' ? Math.hypot(x, y) : Math.max(Math.abs(x), Math.abs(y));
        expect(edge).toBeLessThanOrEqual(MARK_EDGE + 1e-9);
        expect(edge).toBeLessThan(0.94);
      }
    }
  });

  it('looks about 6° across in both, as big as a gauge on the instrument box', () => {
    for (const field of [SIGHT, PERISCOPE]) {
      const place = markPlace(field);
      const middle: [number, number] = [place.at[0], place.at[1]];
      for (const p of rim(field)) {
        const r = apart(field, middle, p);
        expect(r).toBeGreaterThan(MARK_RADIUS * 0.85);
        expect(r).toBeLessThan(MARK_RADIUS * 1.15);
      }
    }
    expect(2 * MARK_RADIUS).toBeCloseTo(6 * DEG, 6);
  });

  it("keeps clear of the gunsight's reticle and range marks, which stay near the middle", () => {
    // The reticle: lead marks to 16 mils either side, range marks down the stem to the HE's deepest, labels beside them.
    const mil = 0.001 / Math.tan(TRUE_HALF_FIELD);
    const deepest = Math.max(...rangeMarks(TRUE_HALF_FIELD, AMMO.he.speed).map((m) => m.drop), ...rangeMarks(TRUE_HALF_FIELD, AMMO.ap.speed).map((m) => m.drop));
    const reticle = Math.hypot(17 * mil, deepest + 3 * mil);
    for (const [x, y] of rim(SIGHT)) expect(Math.hypot(x, y)).toBeGreaterThan(reticle + 0.1);
  });

  it('maps field points to the mark and back as the shader does', () => {
    for (const field of [SIGHT, PERISCOPE]) {
      const place = markPlace(field);
      const m = fieldToMark(place, field, place.at[0], place.at[1], [0, 0]);
      expect(m[0]).toBeCloseTo(0, 9);
      expect(m[1]).toBeCloseTo(0, 9);
      const f = markToField(place, field, 0.3, -0.8, [0, 0]);
      const back = fieldToMark(place, field, f[0], f[1], [0, 0]);
      expect(back[0]).toBeCloseTo(0.3, 9);
      expect(back[1]).toBeCloseTo(-0.8, 9);
    }
  });

  it("turns the hull's nose the other way from the turret in the gunsight: turret to 3 o'clock, nose to 9", () => {
    const up: [number, number] = [0, 0];
    const cases: [hour: number, nose: number, x: number, y: number][] = [
      [12, 12, 0, 1],
      [3, 9, -1, 0],
      [9, 3, 1, 0],
      [6, 6, 0, -1],
      [7, 5, 0.5, -Math.sqrt(3) / 2],
    ];
    for (const [hour, nose, x, y] of cases) {
      const yaw = yawForHour(hour);
      turnedUp(hullTurn(yaw), up);
      expect(up[0], `turret at ${hour}`).toBeCloseTo(x, 9);
      expect(up[1], `turret at ${hour}`).toBeCloseTo(y, 9);
      expect(noseHour(yaw)).toBe(nose);
      // The gunsight looks along the gun: the gun pointer stays up.
      expect(gunTurn(0)).toBe(0);
    }
  });

  it("in the gunner's periscope turns the hull by the turret and periscope together, and the gun by the periscope alone", () => {
    const up: [number, number] = [0, 0];
    // Turret forward, periscope turned 90° left: the nose and the gun both to the right.
    turnedUp(hullTurn(0 + 90 * DEG), up);
    expect(up[0]).toBeCloseTo(1, 9);
    turnedUp(gunTurn(90 * DEG), up);
    expect(up[0]).toBeCloseTo(1, 9);
    // Turret to 3 o'clock, periscope 90° left of the gun: looking straight up the hull, nose up, the gun to the right.
    const yaw = yawForHour(3);
    const fromGun = 90 * DEG;
    turnedUp(hullTurn(yaw + fromGun), up);
    expect(up[0]).toBeCloseTo(0, 9);
    expect(up[1]).toBeCloseTo(1, 9);
    expect(noseHour(yaw + fromGun)).toBe(12);
    turnedUp(gunTurn(fromGun), up);
    expect(up[0]).toBeCloseTo(1, 9);
  });

  it('samples each layer turned back, so a drawing turns the way its turn says', () => {
    const uv: [number, number] = [0, 0];
    const at: [number, number] = [0, 0];
    for (const turn of [0, 30 * DEG, -90 * DEG, 180 * DEG]) {
      for (let layer = 0; layer < MARK_LAYERS; layer++) {
        // The drawing's nose, 0.6 up its own square, shows at 0.6 up the mark turned by `turn`.
        turnedUp(turn, at);
        markUv(at[0] * 0.6, at[1] * 0.6, turn, layer, uv);
        expect(uv[0]).toBeCloseTo((0.5 + layer) / MARK_LAYERS, 9);
        expect(uv[1]).toBeCloseTo(0.8, 9);
      }
    }
  });

  it("draws the hull to the dial's shape inside the rim at any turn, the gun out past it and under the notch", () => {
    const d = MARK_DRAWING;
    const p: [number, number] = [0, 0];
    let furthest = 0;
    for (const x of [-DIAL_HULL.halfWidth, DIAL_HULL.halfWidth]) {
      for (const z of [DIAL_HULL.front, DIAL_HULL.rear]) {
        hullOnMark(x, z, p);
        furthest = Math.max(furthest, Math.hypot(p[0], p[1]));
      }
    }
    expect(furthest).toBeLessThan(d.rim - 0.03);
    // The arrowhead ahead of the nose: past the hull's front, inside the rim (its tip under the notch, its corners clear of the rim at any turn).
    expect(d.arrow.from).toBeGreaterThan(hullOnMark(0, DIAL_HULL.front, p)[1]);
    expect(d.arrow.to).toBeLessThan(d.rim - d.notch);
    expect(Math.hypot(d.arrow.halfWidth, d.arrow.from)).toBeLessThan(d.rim - 0.03);
    // Nose up: the front is up the mark, the driver's hood on the left.
    expect(hullOnMark(0, HULL.front, p)[1]).toBeGreaterThan(0);
    expect(hullOnMark((d.hood.x0 + d.hood.x1) / 2, HULL.front, p)[0]).toBeLessThan(0);
    // The gun reaches past the hull's nose and stops short of the notch at the top of the rim.
    expect(d.gunReach).toBeGreaterThan(hullOnMark(0, DIAL_HULL.front, p)[1]);
    expect(d.gunReach).toBeLessThan(d.rim - d.notch);
    expect(d.opacity).toBeLessThan(1);
  });

  it('is shown by default, and the Sights tab hides it at once', () => {
    expect(DEFAULT_SETTINGS.hullmark).toBe(true);
    expect(parseSettings('?hullmark=0').hullmark).toBe(false);
    const item = LIVE_ITEMS.find((i) => i.key === 'hullmark')!;
    expect(item.options.map(([v]) => v)).toEqual(['1', '0']);
    expect(item.current(DEFAULT_SETTINGS)).toBe('1');
  });
});
