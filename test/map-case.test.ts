import { describe, expect, it } from 'vitest';
import {
  canGrab,
  CASE_CLIPPED,
  CASE_HALF,
  clippedPose,
  createHeldPose,
  EDGE_IN_FIST,
  GRAB_REACH,
  heldPose,
  MAP_CASE,
  RIGHT_WALL,
} from '../src/sim/map-case.js';
import { SEATS, TURRET } from '../src/sim/cabin.js';
import { TURRET_INSIDE_ROUNDING } from '../src/sim/exterior.js';
import { RACK_SLOTS, SHELL_LENGTH, SHELL_RADIUS } from '../src/sim/loading.js';
import { rigOffset, targetEyeHeight } from '../src/sim/body-height.js';

type V = readonly number[];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const eye = SEATS.gunner.eye;

describe('map case on the wall (F2.10)', () => {
  it('hangs 5 mm off the turret\'s right wall, face in, under the roof\'s rounding', () => {
    const back = CASE_CLIPPED.x + MAP_CASE.thick / 2;
    expect(RIGHT_WALL - back).toBeCloseTo(0.005, 6);
    const pose = clippedPose(createHeldPose());
    expect(pose.out[0]).toBeCloseTo(-1, 9);
    expect(pose.right[2]).toBeCloseTo(1, 9);
    expect(CASE_CLIPPED.y + CASE_HALF).toBeLessThan(TURRET.roof - TURRET_INSIDE_ROUNDING);
    expect(CASE_CLIPPED.z + CASE_HALF).toBeLessThan(TURRET.rear - 0.2);
  });

  it('is clear of the ready rack\'s shells, so they neither hide it nor block the hand', () => {
    const shellsEnd = Math.max(...RACK_SLOTS.map((s) => s[2] + SHELL_LENGTH / 2));
    expect(CASE_CLIPPED.z - CASE_HALF - shellsEnd).toBeGreaterThan(0.02);
    // And clear of the interphone box behind it (interior-fittings.ts: 9 cm deep at z 0.62).
    expect(0.62 - 0.045 - (CASE_CLIPPED.z + CASE_HALF)).toBeGreaterThan(0.02);
    // The shells are well in from the wall anyway.
    const shellsOut = Math.max(...RACK_SLOTS.map((s) => s[0] + SHELL_RADIUS));
    expect(CASE_CLIPPED.x - MAP_CASE.thick / 2 - 0.01 - shellsOut).toBeGreaterThan(0.03);
  });

  it('is in a seated reach: its near edge within 80 cm of the eyes, between knee and chest', () => {
    const near = [CASE_CLIPPED.x - MAP_CASE.thick / 2, CASE_CLIPPED.y, CASE_CLIPPED.z - CASE_HALF];
    expect(Math.hypot(near[0] - eye[0], near[1] - eye[1], near[2] - eye[2])).toBeLessThan(0.8);
    const raised = rigOffset(targetEyeHeight({ raise: 0, seated: true }), 1.2);
    const y = CASE_CLIPPED.y - SEATS.gunner.floorY - raised;
    expect(y).toBeGreaterThan(0.45);
    expect(y).toBeLessThan(1.4);
  });

  it('comes to a hand that closes on its face or near its edge, not one further off', () => {
    const c = [CASE_CLIPPED.x, CASE_CLIPPED.y, CASE_CLIPPED.z];
    // On its face, 3 cm out.
    expect(canGrab([c[0] - 0.03, c[1], c[2]])).toBe(true);
    // Just past its near edge, at its corner, and 5 cm out from its top.
    expect(canGrab([c[0] - 0.02, c[1], c[2] - CASE_HALF - 0.04])).toBe(true);
    expect(canGrab([c[0] - 0.02, c[1] + CASE_HALF, c[2] - CASE_HALF])).toBe(true);
    expect(canGrab([c[0], c[1] + CASE_HALF + GRAB_REACH - 0.01, c[2]])).toBe(true);
    // Too far: 10 cm out from its face, past its edge, and the seat's eyes.
    expect(canGrab([c[0] - 0.1, c[1], c[2]])).toBe(false);
    expect(canGrab([c[0], c[1], c[2] - CASE_HALF - GRAB_REACH - 0.01])).toBe(false);
    expect(canGrab(eye)).toBe(false);
  });
});

describe('map case in the hand (F2.10)', () => {
  const fist = [0.55, 1.75, -0.45];
  const eyes = [0.4, 1.98, -0.2];

  it('turns its face square to the eyes, its edge in the fist', () => {
    for (const side of ['right', 'left'] as const) {
      const p = heldPose(fist, [0, 0.7, -0.7], eyes, side, createHeldPose());
      // Square on from its own middle (not the fist, 19 cm to one side), so the whole map reads.
      const toEyes = [eyes[0] - p.centre[0], eyes[1] - p.centre[1], eyes[2] - p.centre[2]];
      expect(dot(p.out, toEyes) / len(toEyes)).toBeGreaterThan(0.999);
      for (const a of [p.right, p.up, p.out]) expect(len(a)).toBeCloseTo(1, 6);
      expect(dot(p.right, p.up)).toBeCloseTo(0, 6);
      expect(dot(p.up, p.out)).toBeCloseTo(0, 6);
      // A right-handed frame: right × up = out.
      const cross = [p.right[1] * p.up[2] - p.right[2] * p.up[1], p.right[2] * p.up[0] - p.right[0] * p.up[2], p.right[0] * p.up[1] - p.right[1] * p.up[0]];
      expect(dot(cross, p.out)).toBeCloseTo(1, 6);
      // The right hand holds its right edge (the middle is to the fist's left), the left hand its left.
      const fromFist = [p.centre[0] - fist[0], p.centre[1] - fist[1], p.centre[2] - fist[2]];
      expect(dot(fromFist, p.right)).toBeCloseTo((side === 'right' ? -1 : 1) * (CASE_HALF + EDGE_IN_FIST), 6);
      expect(len(fromFist)).toBeCloseTo(CASE_HALF + EDGE_IN_FIST, 6);
    }
  });

  it('turns with the wrist\'s roll, to set the map to the ground', () => {
    const a = heldPose(fist, [0, 1, 0], eyes, 'right', createHeldPose());
    const b = heldPose(fist, [1, 0, 0], eyes, 'right', createHeldPose());
    // A quarter turn of the handle turns the map 60° to 120° about the view; the case swings round the fist as it
    // turns (held by its edge), its face turning to stay square to the eyes.
    expect(Math.abs(dot(a.up, b.up))).toBeLessThan(0.5);
    for (const p of [a, b]) {
      const toEyes = [eyes[0] - p.centre[0], eyes[1] - p.centre[1], eyes[2] - p.centre[2]];
      expect(dot(p.out, toEyes) / len(toEyes)).toBeGreaterThan(0.999);
    }
  });

  it('keeps upright when the handle points along the view', () => {
    const view = heldPose(fist, [0, 1, 0], eyes, 'right', createHeldPose()).out;
    const p = heldPose(fist, view, eyes, 'right', createHeldPose());
    expect(p.up[1]).toBeGreaterThan(0.5);
    expect(dot(p.up, p.out)).toBeCloseTo(0, 6);
  });

  it('writes in place, so holding it every frame allocates nothing', () => {
    const out = createHeldPose();
    const { centre, right, up } = out;
    expect(heldPose(fist, [0, 1, 0], eyes, 'left', out)).toBe(out);
    expect(out.centre).toBe(centre);
    expect(out.right).toBe(right);
    expect(out.up).toBe(up);
  });
});
