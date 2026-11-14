import { describe, expect, it } from 'vitest';
import { COURSE, COURSE_START, onCourse, onGravel, PENALTY, PENALTY_PATH } from '../src/sim/course.js';
import { TRACK } from '../src/sim/exterior.js';
import {
  CONTACT_POINTS,
  createFooting,
  FOOTING_STEP,
  FOOTING_TURN,
  footingBetween,
  footingUnder,
  groundLine,
  SURFACE_SOUND,
  SURFACES,
  surfaceAt,
  TankFooting,
  TRACK_CONTACT,
} from '../src/sim/ground-surface.js';
import { ROAD } from '../src/sim/range.js';
import { TILE } from '../src/sim/terrain.js';

const share = (f: { shares: number[] }, s: (typeof SURFACES)[number]) => f.shares[SURFACES.indexOf(s)];

describe('the surface at a place', () => {
  it('is dirt on the two roads, gravel on the course and its penalty loop, and grass everywhere else', () => {
    expect(surfaceAt(0, 0)).toBe('dirt');
    // Up the range, to the road's edge and no further.
    expect(surfaceAt(ROAD.halfWidth - 0.1, -300)).toBe('dirt');
    expect(surfaceAt(ROAD.halfWidth + 0.1, -300)).toBe('grass');
    // Across the start.
    expect(surfaceAt(150, ROAD.crossHalfWidth - 0.1)).toBe('dirt');
    expect(surfaceAt(150, ROAD.crossHalfWidth + 0.1)).toBe('grass');
    // The course's east side, to the gravel's edge (the samples along it leave 10 cm of doubt).
    expect(surfaceAt(COURSE.east, -150)).toBe('gravel');
    expect(surfaceAt(COURSE.east + COURSE.halfWidth - 0.2, -150)).toBe('gravel');
    expect(surfaceAt(COURSE.east + COURSE.halfWidth + 0.2, -150)).toBe('grass');
    expect(surfaceAt(COURSE_START.x, COURSE_START.z)).toBe('gravel');
    // The infield and the open ground.
    expect(surfaceAt((COURSE.west + COURSE.east) / 2, (COURSE.north + COURSE.south) / 2)).toBe('grass');
    expect(surfaceAt(-200, -200)).toBe('grass');
  });

  it("follows the penalty loop's own, narrower gravel", () => {
    // Half way round the loop, well away from the course's own track.
    const p = PENALTY_PATH.at(PENALTY_PATH.length * 0.4);
    const lx = -Math.cos(p.heading);
    const lz = Math.sin(p.heading);
    expect(surfaceAt(p.x, p.z)).toBe('gravel');
    expect(surfaceAt(p.x + lx * (PENALTY.halfWidth - 0.3), p.z + lz * (PENALTY.halfWidth - 0.3))).toBe('gravel');
    expect(surfaceAt(p.x + lx * (PENALTY.halfWidth + 0.3), p.z + lz * (PENALTY.halfWidth + 0.3))).toBe('grass');
  });

  it('is the gravel as drawn, not the wider strip that scatter keeps off', () => {
    const x = COURSE.east + COURSE.halfWidth + 1;
    expect(onCourse(x, -150)).toBe(true);
    expect(onGravel(x, -150)).toBe(false);
  });

  it('repeats with the ground, a tile on', () => {
    expect(surfaceAt(TILE, -300)).toBe('dirt');
    expect(surfaceAt(COURSE.east + TILE, -150 - TILE)).toBe('gravel');
  });
});

describe("a surface's sound", () => {
  it('is the tuned one on dirt, and every surface has a sensible row', () => {
    const d = SURFACE_SOUND.dirt;
    expect([d.ring, d.top, d.thud, d.rumble, d.rumbleOpen, d.squeak]).toEqual([1, 1, 1, 1, 1, 1]);
    for (const s of SURFACES) {
      const k = SURFACE_SOUND[s];
      for (const v of [k.ring, k.top, k.thud, k.rumble, k.rumbleOpen, k.squeak]) {
        expect(v).toBeGreaterThan(0.3);
        expect(v).toBeLessThan(1.5);
      }
      expect(k.grit).toBeGreaterThan(0);
      expect(k.grit).toBeLessThanOrEqual(1);
      expect(k.gritHz).toBeGreaterThan(300);
      expect(k.gritHz).toBeLessThan(5000);
    }
  });

  it('goes from soft to hard: grass, dirt, gravel', () => {
    const { grass, dirt, gravel } = SURFACE_SOUND;
    expect(grass.top).toBeLessThan(dirt.top);
    expect(dirt.top).toBeLessThan(gravel.top);
    expect(grass.gritHz).toBeLessThan(dirt.gritHz);
    expect(dirt.gritHz).toBeLessThan(gravel.gritHz);
    expect(grass.rumbleOpen).toBeLessThan(dirt.rumbleOpen);
    expect(dirt.rumbleOpen).toBeLessThan(gravel.rumbleOpen);
  });
});

describe("a track's footing", () => {
  it('starts all on one surface', () => {
    const f = createFooting('gravel');
    expect(f.surface).toBe('gravel');
    expect(share(f, 'gravel')).toBe(1);
    expect(f.top).toBe(SURFACE_SOUND.gravel.top);
    expect(createFooting().surface).toBe('dirt');
  });

  it('blends two surfaces by how much of the track is on each', () => {
    const f = createFooting();
    footingBetween('grass', 'gravel', 0.25, f);
    expect(share(f, 'grass')).toBeCloseTo(0.75);
    expect(share(f, 'gravel')).toBeCloseTo(0.25);
    expect(f.surface).toBe('grass');
    expect(f.top).toBeCloseTo(0.75 * SURFACE_SOUND.grass.top + 0.25 * SURFACE_SOUND.gravel.top);
    expect(f.grit).toBeCloseTo(0.75 * SURFACE_SOUND.grass.grit + 0.25 * SURFACE_SOUND.gravel.grit);
    // The grit's place moves by ratio: half way from 750 to 3000 Hz is 1500.
    footingBetween('grass', 'gravel', 0.5, f);
    expect(f.gritHz).toBeCloseTo(Math.sqrt(SURFACE_SOUND.grass.gritHz * SURFACE_SOUND.gravel.gritHz));
    // Before and after the crossing it is all one or the other.
    expect(footingBetween('grass', 'gravel', -3, f).surface).toBe('grass');
    expect(f.top).toBe(SURFACE_SOUND.grass.top);
    expect(footingBetween('grass', 'gravel', 7, f).surface).toBe('gravel');
    expect(f.gritHz).toBeCloseTo(SURFACE_SOUND.gravel.gritHz);
    expect(footingBetween('dirt', 'dirt', 0.5, f).top).toBe(1);
  });

  it('lies under the track as drawn: from the first road wheel to the last, beside the hull', () => {
    expect(TRACK_CONTACT.front).toBeLessThan(-1);
    expect(TRACK_CONTACT.rear).toBeGreaterThan(2);
    expect(TRACK_CONTACT.rear - TRACK_CONTACT.front).toBeGreaterThan(3.5);
    expect(TRACK_CONTACT.rear - TRACK_CONTACT.front).toBeLessThan(4.5);
    expect(CONTACT_POINTS).toBeGreaterThanOrEqual(3);
  });

  it('has one track on the road and one on the verge when the tank straddles the edge', () => {
    // Heading up the range (north, -z) with the hull's middle on the road's east edge: the left track is on the road, the right on grass.
    const left = footingUnder(ROAD.halfWidth, -300, 0, -1, createFooting());
    const right = footingUnder(ROAD.halfWidth, -300, 0, 1, createFooting());
    expect(left.surface).toBe('dirt');
    expect(share(left, 'dirt')).toBeCloseTo(1);
    expect(right.surface).toBe('grass');
    expect(share(right, 'grass')).toBeCloseTo(1);
    // Facing the other way, the tracks have changed sides.
    expect(footingUnder(ROAD.halfWidth, -300, Math.PI, -1, createFooting()).surface).toBe('grass');
    expect(footingUnder(ROAD.halfWidth, -300, Math.PI, 1, createFooting()).surface).toBe('dirt');
    // And each track is TRACK.x from the middle: a little further over, both are off the road.
    expect(footingUnder(ROAD.halfWidth + TRACK.x + 0.1, -300, 0, -1, createFooting()).surface).toBe('grass');
    expect(footingUnder(ROAD.halfWidth + TRACK.x - 0.1, -300, 0, -1, createFooting()).surface).toBe('dirt');
  });

  it('changes over bit by bit as a track crosses an edge end on', () => {
    // Heading east (-x is west, so heading -π/2 faces +x) off the road up the range: more and more of each track is on the grass.
    const heading = -Math.PI / 2;
    let last = -1;
    let steps = 0;
    for (let x = ROAD.halfWidth - 3; x <= ROAD.halfWidth + 3; x += 0.25) {
      const f = footingUnder(x, -300, heading, -1, createFooting());
      const grass = share(f, 'grass');
      expect(grass).toBeGreaterThanOrEqual(last - 1e-9);
      expect(share(f, 'dirt') + grass).toBeCloseTo(1);
      if (grass > last + 1e-9) steps++;
      last = grass;
    }
    expect(last).toBeCloseTo(1);
    // Every contact point crossed by itself.
    expect(steps).toBe(CONTACT_POINTS + 1);
    // The front of the track is on the grass first: with the hull's middle at the edge, its front (hull -z, 1.5 m ahead) is over.
    const f = footingUnder(ROAD.halfWidth - 1, -300, heading, -1, createFooting());
    expect(share(f, 'grass')).toBeGreaterThan(0);
    expect(share(f, 'grass')).toBeLessThan(0.5);
  });

  it('is gravel on the course, with the inner track on the grass when the tank runs wide of it', () => {
    // The east side is driven north (heading 0); the infield is to the west, on the driver's left.
    expect(footingUnder(COURSE.east, -150, 0, -1, createFooting()).surface).toBe('gravel');
    expect(footingUnder(COURSE.east, -150, 0, 1, createFooting()).surface).toBe('gravel');
    const wide = COURSE.east + COURSE.halfWidth;
    expect(footingUnder(wide, -150, 0, -1, createFooting()).surface).toBe('gravel');
    expect(footingUnder(wide, -150, 0, 1, createFooting()).surface).toBe('grass');
  });
});

describe("a tank's footing", () => {
  it('is judged at once, then only when the tank has moved or turned enough', () => {
    const f = new TankFooting();
    expect(f.update(0, -300, 0)).toBe(true);
    expect([f.left.surface, f.right.surface]).toEqual(['dirt', 'dirt']);
    expect(f.judged).toBe(1);
    // Standing, or creeping less than a step: not judged again.
    expect(f.update(0, -300, 0)).toBe(false);
    expect(f.update(0, -300 - FOOTING_STEP * 0.9, 0)).toBe(false);
    expect(f.update(0, -300 - FOOTING_STEP * 1.1, 0)).toBe(true);
    // A pivot turn moves the tracks without moving the middle.
    expect(f.update(0, -300 - FOOTING_STEP * 1.1, FOOTING_TURN * 0.9)).toBe(false);
    expect(f.update(0, -300 - FOOTING_STEP * 1.1, FOOTING_TURN * 1.1)).toBe(true);
    expect(f.judged).toBe(3);
  });

  it('follows the tank off the road, one track at a time', () => {
    const f = new TankFooting();
    const seen: string[] = [];
    // Drifting east off the road while heading north.
    for (let x = 0; x <= 8; x += 0.1) {
      f.update(x, -300, 0);
      const now = groundLine(f.left.surface, f.right.surface);
      if (seen[seen.length - 1] !== now) seen.push(now);
    }
    expect(seen).toEqual(['dirt', 'dirt (left) and grass (right)', 'grass']);
    // Placed somewhere else altogether (Practice): judged again.
    expect(f.update(COURSE_START.x, COURSE_START.z, COURSE_START.heading)).toBe(true);
    expect(groundLine(f.left.surface, f.right.surface)).toBe('gravel');
  });
});
