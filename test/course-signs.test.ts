import { describe, expect, it } from 'vitest';
import { COURSE_SIGNS, FORD_LIMIT_KMH } from '../src/sim/course-signs.js';
import {
  BRIDGE,
  COURSE_PATH,
  distanceToTrack,
  forwardOf,
  GATES,
  goingAt,
  inDitch,
  onGravel,
  onMud,
  PENALTY_GATE,
  PENALTY_PATH,
  SLALOM_GATES,
  SLALOM_POSTS,
  type Vec2,
} from '../src/sim/course.js';
import { FORD_SPEED } from '../src/sim/going.js';

/** The nearest point of `path` to (x, z), sampled every 0.5 m. */
function nearest(path: typeof COURSE_PATH, x: number, z: number) {
  let best = { d: Infinity, heading: 0, s: 0 };
  for (let s = 0; s < path.length; s += 0.5) {
    const p = path.at(s);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best.d) best = { d, heading: p.heading, s };
  }
  return best;
}

describe('biathlon course signs', () => {
  it('has each sign John asked for: the ford limit, the mud caution, the penalty loop and its chevrons, the slalom and an arrow for each gate', () => {
    const count = (kind: string) => COURSE_SIGNS.filter((s) => s.kind === kind).length;
    expect(count('ford')).toBe(1);
    expect(count('mud')).toBe(1);
    expect(count('penalty')).toBe(1);
    expect(count('chevron')).toBe(4);
    expect(count('slalom')).toBe(1);
    expect(count('bear-left') + count('bear-right')).toBe(SLALOM_GATES.length);
    // The ford's limit is the drive model's: 8 km/h.
    expect(FORD_LIMIT_KMH).toBe(8);
    expect(FORD_LIMIT_KMH / 3.6).toBeCloseTo(FORD_SPEED, 6);
  });

  it('stands every sign off the gravel, the mud, the water and the ditch, clear of the gates, the slalom posts and the bridge', () => {
    for (const sign of COURSE_SIGNS) {
      const where = `${sign.kind} at (${sign.x.toFixed(1)}, ${sign.z.toFixed(1)})`;
      expect(onGravel(sign.x, sign.z), where).toBe(false);
      expect(onMud(sign.x, sign.z), where).toBe(false);
      expect(goingAt(sign.x, sign.z), where).toBe(0);
      expect(inDitch(sign.x, sign.z), where).toBe(false);
      // At least 2 m outside the nearest track's edge (the course's is 5 m from its middle, the loop's and the bypass's 4 m).
      expect(distanceToTrack(sign.x, sign.z), where).toBeGreaterThan(6.4);
      for (const gate of [...GATES, PENALTY_GATE]) {
        // Each gate's posts and their flags reach about a metre past `half`.
        expect(Math.hypot(sign.x - gate.x, sign.z - gate.z), where).toBeGreaterThan(gate.half + 3);
      }
      for (const [px, pz] of SLALOM_POSTS) expect(Math.hypot(sign.x - px, sign.z - pz), where).toBeGreaterThan(2.5);
      expect(Math.hypot(sign.x - BRIDGE.x, sign.z - BRIDGE.z), where).toBeGreaterThan(BRIDGE.length / 2 + 5);
    }
  });

  it('turns every sign to face a driver coming along the track beside it', () => {
    const f: Vec2 = [0, 0];
    for (const sign of COURSE_SIGNS) {
      const path = sign.kind === 'chevron' ? PENALTY_PATH : COURSE_PATH;
      const near = nearest(path, sign.x, sign.z);
      forwardOf(near.heading, f);
      // The face looks along the sign's own +Z, turned by its yaw: back down the track, against the way it is driven.
      const face = [Math.sin(sign.yaw), Math.cos(sign.yaw)];
      expect(face[0] * f[0] + face[1] * f[1], sign.kind).toBeLessThan(-0.95);
    }
  });

  it("puts each slalom gate's arrow before it, on the side the gate is set to, the way the arrow points", () => {
    const arrows = COURSE_SIGNS.filter((s) => s.kind === 'bear-left' || s.kind === 'bear-right');
    const f: Vec2 = [0, 0];
    SLALOM_GATES.forEach((gate, k) => {
      const sign = arrows[k];
      forwardOf(gate.heading, f);
      // Before the gate along the way it's driven.
      const ahead = (gate.x - sign.x) * f[0] + (gate.z - sign.z) * f[1];
      expect(ahead).toBeGreaterThan(4);
      expect(ahead).toBeLessThan(12);
      // The gate's middle and the sign on the same side of the course's middle line, the side the arrow says.
      const left: Vec2 = [-Math.cos(gate.heading), Math.sin(gate.heading)];
      const middle = COURSE_PATH.at(gate.s);
      const gateSide = Math.sign((gate.x - middle.x) * left[0] + (gate.z - middle.z) * left[1]);
      const signSide = Math.sign((sign.x - middle.x) * left[0] + (sign.z - middle.z) * left[1]);
      expect(signSide).toBe(gateSide);
      expect(sign.kind).toBe(gateSide > 0 ? 'bear-left' : 'bear-right');
    });
  });
});
