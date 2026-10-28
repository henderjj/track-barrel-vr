import { describe, expect, it } from 'vitest';
import { crewBumps, groundFeel, MAX_ACCEL, MAX_REVERSE, MAX_SPEED, MAX_TILT, MAX_YAW_ACCEL, MAX_YAW_RATE, REDUCED_BUMPS } from '../src/sim/comfort.js';
import { GROUND_Y } from '../src/sim/cabin.js';
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
  HIGH,
  IDLE_RPM,
  settle,
  keyControls,
  lerpTankDrive,
  LOW,
  MAX_RPM,
  NEUTRAL,
  OUTLINE,
  SHIFT_SECONDS,
  stepDrive,
  type TankDrive,
  targetRpm,
  TRACK_GAUGE,
  twinStickControls,
} from '../src/sim/tank-drive.js';
import { groundHeight, type Obstacle, obstacleDistance, OBSTACLES, wrapTile } from '../src/sim/terrain.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const NONE: readonly Obstacle[] = [];

function controls(left: number, right: number, gear = LOW, throttle = 0): DriverControls {
  return { left, right, gear, throttle };
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
  it('starts at rest on the ground at the start, its hull floor GROUND_Y above it', () => {
    const s = createTankDrive();
    expect(s.speed).toBe(0);
    expect(s.gear).toBe(LOW);
    expect(s.rpm).toBe(IDLE_RPM);
    expect(s.y).toBeCloseTo(-GROUND_Y, 6);
    expect(CLEARANCE).toBeCloseTo(0.6);
  });

  it('both tillers forwards drive straight ahead (towards -Z) up to the gear\'s top speed', () => {
    const s = run(createTankDrive(), controls(1, 1), 10, NONE, (t, speed) => {
      expect(t.speed - speed).toBeLessThanOrEqual(MAX_ACCEL * DT + 1e-9);
    });
    expect(s.speed).toBeCloseTo(GEARS[LOW].top, 3);
    expect(s.z).toBeLessThan(-15);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    expect(s.heading).toBe(0);
    expect(s.rpm).toBeGreaterThan(MAX_RPM - 50);
    expect(s.leftTrack).toBeCloseTo(s.rightTrack, 9);
  });

  it('high range reaches 35 km/h, and never more', () => {
    const s = createTankDrive();
    s.gear = HIGH;
    run(s, controls(1, 1, HIGH), 30);
    expect(s.speed).toBeCloseTo(MAX_SPEED, 3);
    expect(GEARS[HIGH].top).toBeCloseTo(MAX_SPEED);
  });

  it('pulls gently at idle and harder as the engine revs up', () => {
    const s = createTankDrive();
    stepDrive(s, controls(1, 1), DT, NONE);
    const first = s.accel;
    run(s, controls(1, 1), 1.5);
    expect(first).toBeLessThan(0.6 * MAX_ACCEL);
    expect(s.accel).toBeGreaterThan(0.85 * MAX_ACCEL);
  });

  it('backs up no faster than the reverse cap', () => {
    const s = run(createTankDrive(), controls(-1, -1), 10);
    expect(s.speed).toBeCloseTo(-MAX_REVERSE, 3);
    expect(s.z).toBeGreaterThan(10);
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

  it('rolls to a stop at the braking cap when the tillers are let go', () => {
    const s = run(createTankDrive(), controls(1, 1), 8);
    run(s, controls(0, 0), 5, NONE, (t, speed) => {
      expect(speed - t.speed).toBeLessThanOrEqual(MAX_ACCEL * DT + 1e-9);
    });
    expect(s.speed).toBe(0);
  });

  it('the RPM follows the demand with lag, from the hand throttle\'s idle', () => {
    expect(targetRpm(controls(0, 0))).toBe(IDLE_RPM);
    expect(targetRpm(controls(0, 0, LOW, 1))).toBeGreaterThan(IDLE_RPM + 500);
    expect(targetRpm(controls(0.5, -1))).toBe(MAX_RPM);
    const s = createTankDrive();
    stepDrive(s, controls(1, 1), 0.1, NONE);
    expect(s.rpm).toBeGreaterThan(IDLE_RPM);
    expect(s.rpm).toBeLessThan(IDLE_RPM + 0.3 * (MAX_RPM - IDLE_RPM));
  });

  describe('gears', () => {
    it('shift with the tillers centred, after a moment in neutral', () => {
      const s = createTankDrive();
      stepDrive(s, controls(0, 0, HIGH), DT, NONE);
      expect(s.gear).toBe(NEUTRAL);
      expect(s.grinding).toBe(false);
      run(s, controls(0, 0, HIGH), SHIFT_SECONDS + 0.05);
      expect(s.gear).toBe(HIGH);
    });

    it('grind when shifted with a tiller off centre: out of gear, no shift, until the tillers come back', () => {
      const s = run(createTankDrive(), controls(1, 1), 3);
      const speed = s.speed;
      run(s, controls(1, 1, HIGH), 2);
      expect(s.grinding).toBe(true);
      expect(s.gear).toBe(NEUTRAL);
      // Out of gear the tank slows.
      expect(s.speed).toBeLessThan(speed);
      run(s, controls(0.1, 0, HIGH), SHIFT_SECONDS + 0.05);
      expect(s.grinding).toBe(false);
      expect(s.gear).toBe(HIGH);
    });

    it('neutral drives nothing, and the lever goes to neutral at any time', () => {
      const s = run(createTankDrive(), controls(1, 1), 3);
      stepDrive(s, controls(1, 1, NEUTRAL), DT, NONE);
      expect(s.gear).toBe(NEUTRAL);
      expect(s.grinding).toBe(false);
      run(s, controls(1, 1, NEUTRAL), 6);
      expect(s.speed).toBe(0);
    });
  });

  describe('ground', () => {
    it('follows the ground within the tilt caps, its tracks on it', () => {
      // Away from the start field and from both roads' flat corridors (the
      // range's roads, src/sim/range.ts), where the ground rolls.
      const s = createTankDrive(150, 150, Math.PI / 2);
      let maxTilt = 0;
      run(s, controls(1, 1, LOW), 60, NONE, (t) => {
        maxTilt = Math.max(maxTilt, Math.abs(t.pitch), Math.abs(t.roll));
      });
      expect(maxTilt).toBeGreaterThan(0.5 * DEG);
      expect(maxTilt).toBeLessThanOrEqual(MAX_TILT + 1e-9);
    });

    it('with reduced bumps (F1.14) takes less of the tilt, more gently, along the same path', () => {
      const full = createTankDrive(150, 150, Math.PI / 2);
      const reduced = settle(createTankDrive(150, 150, Math.PI / 2), REDUCED_BUMPS);
      const c = controls(1, 1, LOW);
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
      s.gear = HIGH;
      let hardest = 0;
      run(s, controls(1, 1, HIGH), 30, [rock], (t, speed) => {
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
      const s = run(createTankDrive(), controls(1, 1), 30, [wall]);
      expect(gapTo(s, wall)).toBeGreaterThanOrEqual(-0.01);
      expect(s.speed).toBeLessThan(0.05);
      const stoppedZ = s.z;
      run(s, controls(-1, -1), 3, [wall]);
      expect(s.z).toBeGreaterThan(stoppedZ + 1);
      expect(s.touching).toBe(false);
    });

    it('driving past an obstacle beside it is not slowed', () => {
      const beside: Obstacle = { ...rock, x: FOOTPRINT.halfWidth + rock.r + 0.6 };
      const free = run(createTankDrive(), controls(1, 1), 30);
      const past = run(createTankDrive(), controls(1, 1), 30, [beside]);
      expect(past.z).toBeCloseTo(free.z, 3);
    });

    it('none of the ground\'s obstacles stand on the start, the lane or each other', () => {
      const s = createTankDrive();
      for (const o of OBSTACLES) expect(gapTo(s, o)).toBeGreaterThan(5);
      // Straight up the lane for a whole tile: nothing in the way.
      const lane = run(createTankDrive(), controls(1, 1, HIGH), 2);
      lane.gear = HIGH;
      run(lane, controls(1, 1, HIGH), 800 / MAX_SPEED);
      expect(lane.touching).toBe(false);
      expect(lane.bumps).toBe(0);
      expect(Math.abs(wrapTile(lane.x))).toBeLessThan(0.01);
    });
  });

  it('draws between two states, the heading the short way round', () => {
    const a = createTankDrive(0, 0, Math.PI - 0.1);
    const b = createTankDrive(2, -4, -Math.PI + 0.1);
    b.gear = HIGH;
    const out = createTankDrive();
    lerpTankDrive(a, b, 0.5, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(-2);
    expect(Math.abs(angleDelta(Math.PI, out.heading))).toBeLessThan(1e-9);
    expect(out.gear).toBe(HIGH);
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
