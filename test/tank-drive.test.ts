import { describe, expect, it } from 'vitest';
import { crewBumps, groundFeel, MAX_ACCEL, MAX_SPEED, MAX_TILT, MAX_YAW_ACCEL, MAX_YAW_RATE, REDUCED_BUMPS } from '../src/sim/comfort.js';
import { GROUND_Y } from '../src/sim/cabin.js';
import { type GearboxMode, REVERSE_TOP, UP_RPM } from '../src/sim/gearbox.js';
import {
  angleDelta,
  BUMP_DECEL,
  CLEARANCE,
  createControls,
  createTankDrive,
  type DriverControls,
  extrapolateTankDrive,
  FOOTPRINT,
  GEARS,
  type Gear,
  IDLE_RPM,
  settle,
  keyControls,
  lerpTankDrive,
  MAX_RPM,
  NEUTRAL,
  OUTLINE,
  REVERSE,
  STEER_RADIUS,
  stepDrive,
  type TankDrive,
  targetRpm,
  TOP_GEAR,
  TRACK_GAUGE,
  twinStickControls,
} from '../src/sim/tank-drive.js';
import { groundHeight, type Obstacle, obstacleDistance, OBSTACLES, wrapTile } from '../src/sim/terrain.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const NONE: readonly Obstacle[] = [];
/** The tillers' push that asks the automatic box for 12 km/h, the old low range's top. */
const LOW_PUSH = 12 / 3.6 / MAX_SPEED;

/** The automatic box's controls: tillers, and the hand throttle. */
function controls(left: number, right: number, throttle = 0): DriverControls {
  return { ...createControls(), left, right, throttle };
}

/** A Sherman's controls (Stick shift or Clutch): tillers as brakes, the accelerator, the lever and the clutch. */
function real(gear: Gear, accel: number, left = 0, right = 0, mode: GearboxMode = 'stick', clutch = 0): DriverControls {
  return { ...createControls(), left, right, accel, gear, clutch, mode };
}

/** Drive for `seconds`, calling `each` after every step with the speed and turn rate before it. */
function run(s: TankDrive, c: DriverControls, seconds: number, obstacles: readonly Obstacle[] = NONE, each?: (s: TankDrive, speed: number, yawRate: number) => void): TankDrive {
  for (let t = 0; t < seconds; t += DT) {
    const speed = s.speed;
    const yawRate = s.yawRate;
    stepDrive(s, c, DT, obstacles);
    each?.(s, speed, yawRate);
  }
  return s;
}

/** The closest any point of the tank's outline comes to `o`, m. */
function gapTo(s: TankDrive, o: Obstacle): number {
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  const n: [number, number] = [0, 0];
  let gap = Infinity;
  for (const [hx, hz] of OUTLINE) gap = Math.min(gap, obstacleDistance(o, s.x + hx * c + hz * sn, s.z - hx * sn + hz * c, n));
  return gap;
}

describe('tank drive (F1.4)', () => {
  it('starts at rest on the ground at the start, its hull floor GROUND_Y above it, in neutral', () => {
    const s = createTankDrive();
    expect(s.speed).toBe(0);
    expect(s.gear).toBe(NEUTRAL);
    expect(s.rpm).toBe(IDLE_RPM);
    expect(s.y).toBeCloseTo(-GROUND_Y, 6);
    expect(CLEARANCE).toBeCloseTo(0.6);
  });

  it('both tillers forwards drive straight ahead (towards -Z), the automatic box changing up to 5th and 35 km/h, never more', () => {
    const gears = new Set<number>();
    const s = run(createTankDrive(), controls(1, 1), 60, NONE, (t, speed) => {
      expect(t.speed - speed).toBeLessThanOrEqual(MAX_ACCEL * DT + 1e-9);
      expect(t.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
      gears.add(t.gear);
    });
    expect(s.speed).toBeCloseTo(MAX_SPEED, 2);
    expect([...gears].filter((g) => g !== NEUTRAL).sort()).toEqual([2, 3, 4, 5]);
    expect(s.gear).toBe(TOP_GEAR);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    expect(s.heading).toBe(0);
    expect(s.rpm).toBeGreaterThan(MAX_RPM - 50);
    expect(s.leftTrack).toBeCloseTo(s.rightTrack, 9);
  });

  it('a part push asks for a share of the top speed, in the gear that suits it', () => {
    const s = run(createTankDrive(), controls(LOW_PUSH, LOW_PUSH), 20);
    expect(s.speed * 3.6).toBeCloseTo(12, 1);
    expect(s.gear).toBe(3);
  });

  it('pulls hardest in the low gears and less in each one up', () => {
    const s = createTankDrive();
    let in2 = 0;
    let in5 = 0;
    run(s, controls(1, 1), 60, NONE, (t) => {
      if (t.gear === 2 && t.speed > 0.5) in2 = Math.max(in2, t.accel);
      if (t.gear === 5 && t.speed < MAX_SPEED - 1) in5 = Math.max(in5, t.accel);
    });
    expect(in2).toBeCloseTo(MAX_ACCEL, 2);
    expect(in5).toBeLessThan(0.4 * MAX_ACCEL);
    expect(in5).toBeGreaterThan(0.2 * MAX_ACCEL);
  });

  it('backs up no faster than the reverse gear would', () => {
    const s = run(createTankDrive(), controls(-1, -1), 10);
    expect(s.speed).toBeCloseTo(-REVERSE_TOP, 3);
    expect(REVERSE_TOP * 3.6).toBeCloseTo(4.5, 1);
    expect(s.z).toBeGreaterThan(5);
  });

  it('one tiller forwards turns the tank the other way; opposite tillers pivot it on the spot, within the turn caps', () => {
    const right = run(createTankDrive(), controls(1, 0), 3, NONE, (t, _speed, yawRate) => {
      expect(Math.abs(t.yawRate - yawRate)).toBeLessThanOrEqual(MAX_YAW_ACCEL * DT + 1e-9);
      expect(Math.abs(t.yawRate)).toBeLessThanOrEqual(MAX_YAW_RATE + 1e-9);
    });
    expect(right.yawRate).toBeLessThan(0);
    expect(right.leftTrack).toBeGreaterThan(right.rightTrack);
    const pivot = run(createTankDrive(), controls(-1, 1), 4);
    expect(pivot.yawRate).toBeCloseTo(MAX_YAW_RATE, 6);
    expect(Math.abs(pivot.speed)).toBeLessThan(1e-9);
    expect(Math.hypot(pivot.x, pivot.z)).toBeLessThan(1e-6);
    // Tracks turning against each other, by the gauge.
    expect(pivot.rightTrack - pivot.leftTrack).toBeCloseTo(MAX_YAW_RATE * TRACK_GAUGE, 6);
  });

  it('rolls to a stop, no harder than the braking cap, when the tillers are let go', () => {
    const s = run(createTankDrive(), controls(1, 1), 30);
    run(s, controls(0, 0), 30, NONE, (t, speed) => {
      expect(speed - t.speed).toBeLessThanOrEqual(MAX_ACCEL * DT + 1e-9);
    });
    expect(s.speed).toBe(0);
    expect(s.gear).toBe(2);
  });

  it('the RPM follows the demand with lag out of gear, from the hand throttle\'s idle, and the tracks in gear', () => {
    expect(targetRpm(controls(0, 0))).toBe(IDLE_RPM);
    expect(targetRpm(controls(0, 0, 1))).toBeGreaterThan(IDLE_RPM + 500);
    expect(targetRpm(controls(0.5, -1))).toBe(MAX_RPM);
    const s = createTankDrive();
    stepDrive(s, controls(1, 1), 0.1, NONE);
    expect(s.rpm).toBeGreaterThan(IDLE_RPM);
    expect(s.rpm).toBeLessThan(IDLE_RPM + 0.3 * (MAX_RPM - IDLE_RPM));
    // In gear, the revs follow the speed through the gear: they drop as each gear goes in.
    let gear = s.gear;
    let time = 0;
    let inAt = -1;
    const after: number[] = [];
    run(s, controls(1, 1), 40, NONE, (t) => {
      time += DT;
      if (t.gear !== gear && t.gear !== NEUTRAL) {
        gear = t.gear;
        inAt = time;
      }
      if (gear > 2 && inAt > 0 && time - inAt > 0.5) {
        after.push(t.rpm);
        inAt = -1;
      }
    });
    expect(after.length).toBe(3);
    for (const rpm of after) expect(rpm).toBeLessThan(UP_RPM - 400);
    expect(s.rpm).toBeCloseTo((s.speed / GEARS[s.gear].top) * MAX_RPM, -1);
  });

  describe('a Sherman\'s controls (Stick shift, Clutch)', () => {
    it('the accelerator drives through the gear; released, the engine idles and the tank slows to a crawl', () => {
      const s = run(createTankDrive(), real(2, 1), 10);
      expect(s.gear).toBe(2);
      expect(s.speed).toBeCloseTo(GEARS[2].top, 2);
      // Pushing the tillers forwards does nothing more: they are only brakes.
      const pushed = run(createTankDrive(), real(2, 1, 1, 1), 10);
      expect(pushed.speed).toBeCloseTo(s.speed, 6);
      run(s, real(2, 0), 20);
      expect(s.speed).toBeLessThan(0.05);
    });

    it('a tiller pulled back brakes its track: the tank turns that way on a radius, and can\'t turn standing', () => {
      const s = run(createTankDrive(), real(2, 1), 10);
      run(s, real(2, 1, -1, 0), 4, NONE, (t) => expect(Math.abs(t.yawRate)).toBeLessThanOrEqual(MAX_YAW_RATE + 1e-9));
      expect(s.yawRate).toBeGreaterThan(0);
      expect(s.yawRate).toBeCloseTo(Math.min(MAX_YAW_RATE, s.speed / STEER_RADIUS), 2);
      const right = run(createTankDrive(), real(2, 1), 10);
      run(right, real(2, 1, 0, -1), 4);
      expect(right.yawRate).toBeLessThan(0);
      const standing = run(createTankDrive(), real(NEUTRAL, 0, -1, 1), 3);
      expect(standing.yawRate).toBe(0);
      expect(standing.speed).toBe(0);
    });

    it('both tillers back stop it and hold it, in gear with the accelerator down', () => {
      const s = run(createTankDrive(), real(3, 1), 15);
      run(s, real(3, 1, -1, -1), 10, NONE, (t, speed) => expect(speed - t.speed).toBeLessThanOrEqual(MAX_ACCEL * DT + 1e-9));
      expect(s.speed).toBe(0);
      expect(s.z).toBeLessThan(-10);
    });

    it('reverses only in reverse gear, which won\'t go in until the tank stops', () => {
      const s = run(createTankDrive(), real(2, 1), 6);
      run(s, real(REVERSE, 1), 0.5);
      // Rolling still: reverse grinds and the box stays in 2nd.
      expect(s.grinding).toBe(true);
      expect(s.gear).toBe(2);
      expect(s.speed).toBeGreaterThan(0);
      run(s, real(REVERSE, 1, -1, -1), 6);
      expect(s.gear).toBe(REVERSE);
      expect(Math.abs(s.speed)).toBe(0);
      run(s, real(REVERSE, 1), 10);
      expect(s.speed).toBeCloseTo(-REVERSE_TOP, 2);
    });

    it('a slow pull-away in a high gear: 5th barely moves the tank from a standstill', () => {
      const second = run(createTankDrive(), real(2, 1), 3);
      const fifth = run(createTankDrive(), real(5, 1), 3);
      expect(fifth.speed).toBeLessThan(second.speed * 0.6);
    });
  });

  describe('changing gear', () => {
    it('coasts while the gear changes, rather than braking', () => {
      const s = run(createTankDrive(), real(2, 1), 8);
      const before = s.speed;
      run(s, real(3, 1), 0.3);
      // Out of gear for the change: the tank slows only by its tracks' drag.
      expect(s.speed).toBeGreaterThan(before - 0.35 * 0.3 - 1e-6);
      run(s, real(3, 1), 1);
      expect(s.gear).toBe(3);
    });

    it('the automatic box never grinds; the clutch\'s gears do without the clutch', () => {
      let ground = false;
      run(createTankDrive(), controls(1, 1), 40, NONE, (t) => (ground ||= t.grinding));
      expect(ground).toBe(false);
      const s = createTankDrive();
      run(s, real(2, 0, 0, 0, 'clutch', 0), 0.5);
      expect(s.grinding).toBe(true);
      expect(s.gear).toBe(NEUTRAL);
      run(s, real(2, 0, 0, 0, 'clutch', 1), 0.5);
      expect(s.grinding).toBe(false);
      expect(s.gear).toBe(2);
    });

    it('neutral drives nothing: the tank coasts to a stop', () => {
      const s = run(createTankDrive(), real(2, 1), 6);
      run(s, real(NEUTRAL, 1), 1);
      expect(s.gear).toBe(NEUTRAL);
      run(s, real(NEUTRAL, 1), 12);
      expect(s.speed).toBe(0);
    });
  });

  describe('ground', () => {
    it('follows the ground within the tilt caps, its tracks on it', () => {
      // Away from the start field and from both roads' flat corridors (the
      // range's roads, src/sim/range.ts), where the ground rolls.
      const s = createTankDrive(150, 150, Math.PI / 2);
      let maxTilt = 0;
      run(s, controls(LOW_PUSH, LOW_PUSH), 60, NONE, (t) => {
        maxTilt = Math.max(maxTilt, Math.abs(t.pitch), Math.abs(t.roll));
      });
      expect(maxTilt).toBeGreaterThan(0.5 * DEG);
      expect(maxTilt).toBeLessThanOrEqual(MAX_TILT + 1e-9);
    });

    it('with reduced bumps (F1.14) takes less of the tilt, more gently, along the same path', () => {
      const full = createTankDrive(150, 150, Math.PI / 2);
      const reduced = settle(createTankDrive(150, 150, Math.PI / 2), REDUCED_BUMPS);
      const c = controls(LOW_PUSH, LOW_PUSH);
      let fullTilt = 0;
      let reducedTilt = 0;
      let fullRate = 0;
      let reducedRate = 0;
      for (let t = 0; t < 60; t += DT) {
        stepDrive(full, c, DT, NONE);
        stepDrive(reduced, c, DT, NONE, REDUCED_BUMPS);
        fullTilt = Math.max(fullTilt, Math.abs(full.pitch), Math.abs(full.roll));
        reducedTilt = Math.max(reducedTilt, Math.abs(reduced.pitch), Math.abs(reduced.roll));
        fullRate = Math.max(fullRate, Math.abs(full.pitchRate) + Math.abs(full.rollRate));
        reducedRate = Math.max(reducedRate, Math.abs(reduced.pitchRate) + Math.abs(reduced.rollRate));
      }
      expect(reducedTilt).toBeLessThanOrEqual(REDUCED_BUMPS.tilt * MAX_TILT + 1e-9);
      expect(reducedTilt).toBeLessThan(fullTilt * 0.6);
      expect(reducedRate).toBeLessThan(fullRate * 0.5);
      // Bumps only change how the hull sways: it goes where it would have gone.
      expect(Math.hypot(reduced.x - full.x, reduced.z - full.z)).toBeLessThan(1e-6);
      // Its tracks stay near the ground under it.
      expect(Math.abs(reduced.y - (groundHeight(reduced.x, reduced.z) + CLEARANCE))).toBeLessThan(0.15);
    });

    it('rides reduced if either player asks', () => {
      expect(crewBumps('full', null)).toBe('full');
      expect(crewBumps('full', 'full')).toBe('full');
      expect(crewBumps('reduced', null)).toBe('reduced');
      expect(crewBumps('full', 'reduced')).toBe('reduced');
      expect(groundFeel('reduced')).toBe(REDUCED_BUMPS);
    });
  });

  describe('obstacles', () => {
    const rock: Obstacle = { kind: 'rock', x: 0, z: -30, r: 1.5, hx: 1.5, hz: 1.5, yaw: 0, height: 2 };
    const wall: Obstacle = { kind: 'wall', x: 0, z: -40, r: 6, hx: 6, hz: 0.35, yaw: 0.2, height: 1.2 };

    it('a rock ahead stops the tank softly, never through it, slowing no harder than BUMP_DECEL', () => {
      const s = createTankDrive();
      let hardest = 0;
      run(s, controls(1, 1), 30, [rock], (t, speed) => {
        hardest = Math.max(hardest, (speed - t.speed) / DT);
      });
      expect(s.speed).toBeLessThan(0.05);
      expect(gapTo(s, rock)).toBeGreaterThanOrEqual(-0.01);
      expect(gapTo(s, rock)).toBeLessThan(0.2);
      expect(s.touching).toBe(true);
      expect(s.bumps).toBeLessThanOrEqual(1);
      expect(hardest).toBeLessThanOrEqual(BUMP_DECEL * 1.05);
    });

    it('a wall ahead stops it too; it can back away, and pivot away', () => {
      const s = run(createTankDrive(), controls(LOW_PUSH, LOW_PUSH), 30, [wall]);
      expect(gapTo(s, wall)).toBeGreaterThanOrEqual(-0.01);
      expect(s.speed).toBeLessThan(0.05);
      const stoppedZ = s.z;
      run(s, controls(-1, -1), 3, [wall]);
      expect(s.z).toBeGreaterThan(stoppedZ + 1);
      expect(s.touching).toBe(false);
    });

    it('driving past an obstacle beside it is not slowed', () => {
      const beside: Obstacle = { ...rock, x: FOOTPRINT.halfWidth + rock.r + 0.6 };
      const free = run(createTankDrive(), controls(LOW_PUSH, LOW_PUSH), 30);
      const past = run(createTankDrive(), controls(LOW_PUSH, LOW_PUSH), 30, [beside]);
      expect(past.z).toBeCloseTo(free.z, 3);
    });

    it('none of the ground\'s obstacles stand on the start, the lane or each other', () => {
      const s = createTankDrive();
      for (const o of OBSTACLES) expect(gapTo(s, o)).toBeGreaterThan(5);
      // Straight up the lane for a whole tile: nothing in the way.
      const lane = run(createTankDrive(), controls(1, 1), 30);
      run(lane, controls(1, 1), 800 / MAX_SPEED);
      expect(lane.touching).toBe(false);
      expect(lane.bumps).toBe(0);
      expect(Math.abs(wrapTile(lane.x))).toBeLessThan(0.01);
    });
  });

  it('draws between two states, the heading the short way round', () => {
    const a = createTankDrive(0, 0, Math.PI - 0.1);
    const b = createTankDrive(2, -4, -Math.PI + 0.1);
    b.gear = TOP_GEAR;
    const out = createTankDrive();
    lerpTankDrive(a, b, 0.5, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(-2);
    expect(Math.abs(angleDelta(Math.PI, out.heading))).toBeLessThan(1e-9);
    expect(out.gear).toBe(TOP_GEAR);
  });

  it('carries a state on at its speed and turn rate', () => {
    const s = createTankDrive();
    s.speed = 2;
    const out = extrapolateTankDrive(s, 0.5, createTankDrive());
    expect(out.z).toBeCloseTo(-1);
    expect(out.odometer).toBeCloseTo(1);
  });

  it('maps the sticks and keys onto the tillers', () => {
    const c = createControls();
    twinStickControls(-1, 0.5, c);
    expect(c.left).toBe(1);
    expect(c.right).toBe(-0.5);
    keyControls(1, 0, c);
    expect([c.left, c.right]).toEqual([1, 1]);
    keyControls(0, 1, c);
    expect([c.left, c.right]).toEqual([-1, 1]);
    keyControls(1, -1, c);
    expect([c.left, c.right]).toEqual([1, 0]);
  });
});
