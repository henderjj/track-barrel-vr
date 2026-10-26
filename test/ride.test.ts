import { describe, expect, it } from 'vitest';
import { SEATED_EYE } from '../src/sim/body-height.js';
import {
  createTankState,
  DRIVER_EYE,
  groundHeight,
  HULL,
  MAX_ACCEL,
  MAX_SPEED,
  MAX_TILT,
  MAX_YAW_ACCEL,
  MAX_YAW_RATE,
  rigForSeat,
  ROUTE_SECONDS,
  routeCommand,
  SCAN,
  scanRate,
  seatEye,
  SLIT,
  stepTank,
  stepTurret,
  stickCommand,
  stickTraverse,
  type TankCommand,
  TILE,
  TRAVERSE_ACCEL,
  TRAVERSE_MAX,
  treeScale,
  TREE_FULL,
  TREE_GONE,
  TURRET,
  vignetteLevel,
  wrapTile,
} from '../src/sim/ride.js';

const DT = 1 / 90;
const DEG = Math.PI / 180;

/** Ride the scripted route for `seconds`, calling `each` after every step. */
function rideRoute(seconds: number, each: (s: ReturnType<typeof createTankState>, prevYawRate: number) => void): ReturnType<typeof createTankState> {
  const s = createTankState();
  const command: TankCommand = { speed: 0, yawRate: 0 };
  for (let t = 0; t < seconds; t += DT) {
    const prevYawRate = s.yawRate;
    stepTank(s, routeCommand(t, command), DT);
    each(s, prevYawRate);
  }
  return s;
}

describe('riding the tank (spike S2)', () => {
  it('keeps every motion of a whole loop of the route within the comfort caps', () => {
    let fastest = 0;
    let hardest = 0;
    let quickestTurn = 0;
    let turnChange = 0;
    let steepest = 0;
    const end = rideRoute(ROUTE_SECONDS, (s, prevYawRate) => {
      fastest = Math.max(fastest, Math.abs(s.speed));
      hardest = Math.max(hardest, Math.abs(s.accel));
      quickestTurn = Math.max(quickestTurn, Math.abs(s.yawRate));
      turnChange = Math.max(turnChange, Math.abs(s.yawRate - prevYawRate) / DT);
      steepest = Math.max(steepest, Math.abs(s.pitch), Math.abs(s.roll));
    });
    expect(fastest).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
    expect(fastest).toBeGreaterThan(MAX_SPEED * 0.95);
    expect(hardest).toBeLessThanOrEqual(MAX_ACCEL + 1e-6);
    expect(quickestTurn).toBeLessThanOrEqual(MAX_YAW_RATE + 1e-9);
    expect(turnChange).toBeLessThanOrEqual(MAX_YAW_ACCEL + 1e-6);
    expect(steepest).toBeLessThanOrEqual(MAX_TILT + 1e-9);
    // It actually goes somewhere and tilts over the ground.
    expect(end.odometer).toBeGreaterThan(500);
    expect(steepest).toBeGreaterThan(0.5 * DEG);
  });

  it('keeps the hull floor its clearance above the ground under it', () => {
    let worst = 0;
    rideRoute(120, (s) => {
      worst = Math.max(worst, Math.abs(s.y - HULL.clearance - groundHeight(s.x, s.z)));
    });
    // Eased, and the ground is sampled under the track ends, so within a few centimetres.
    expect(worst).toBeLessThan(0.1);
  });

  it('pivots on the spot when the route stops and turns', () => {
    const s = createTankState();
    const command: TankCommand = { speed: 0, yawRate: 15 * DEG };
    for (let t = 0; t < 6; t += DT) stepTank(s, command, DT);
    expect(Math.hypot(s.x, s.z)).toBe(0);
    expect(s.heading).toBeGreaterThan(60 * DEG);
  });

  it('drives forward, back and round with the thumbstick, within the caps', () => {
    const c: TankCommand = { speed: 0, yawRate: 0 };
    expect(stickCommand(0, -1, c).speed).toBeCloseTo(MAX_SPEED, 9);
    expect(stickCommand(0, 1, c).speed).toBeLessThan(0);
    expect(stickCommand(1, 0, c).yawRate).toBeCloseTo(-MAX_YAW_RATE, 9);
    const s = createTankState();
    for (let t = 0; t < 2; t += DT) stepTank(s, stickCommand(0, -1, c), DT);
    // Forward is -Z at heading 0, and 2 s at 1 m/s² reaches 2 m/s.
    expect(s.z).toBeLessThan(-1.5);
    expect(s.speed).toBeCloseTo(2, 1);
  });

  it('repeats the ground every tile, so the world can be moved less whole tiles', () => {
    for (const [x, z] of [[3, 7], [-50, 101], [119, -119]]) {
      expect(groundHeight(x + TILE, z)).toBeCloseTo(groundHeight(x, z), 9);
      expect(groundHeight(x, z - 2 * TILE)).toBeCloseTo(groundHeight(x, z), 9);
    }
    expect(wrapTile(TILE * 3 + 5)).toBeCloseTo(5, 9);
    expect(Math.abs(wrapTile(-TILE * 0.7))).toBeLessThanOrEqual(TILE / 2);
  });

  it('traverses the turret at power-traverse rates, and the scan comes back near the front', () => {
    const turret = { angle: 0, rate: 0 };
    let fastest = 0;
    let quickestStart = 0;
    for (let t = 0; t < SCAN.reduce((sum, [s]) => sum + s, 0); t += DT) {
      const before = turret.rate;
      stepTurret(turret, scanRate(t), DT);
      fastest = Math.max(fastest, Math.abs(turret.rate));
      quickestStart = Math.max(quickestStart, Math.abs(turret.rate - before) / DT);
    }
    expect(fastest).toBeLessThanOrEqual(TRAVERSE_MAX + 1e-9);
    expect(fastest).toBeGreaterThan(TRAVERSE_MAX * 0.9);
    expect(quickestStart).toBeLessThanOrEqual(TRAVERSE_ACCEL + 1e-6);
    expect(Math.abs(turret.angle)).toBeLessThan(15 * DEG);
    expect(stickTraverse(1)).toBeCloseTo(-TRAVERSE_MAX, 9);
  });

  it('puts the rider\'s head at their seat\'s eyes wherever they sit in the room, and turns the gunner with the turret', () => {
    const rig: [number, number, number] = [0, 0, 0];
    const eye: [number, number] = [0, 0];
    // A head 0.4 m right of and 0.3 m behind the room's middle, looking 30° left.
    const hx = 0.4;
    const hz = 0.3;
    const yaw = 30 * DEG;
    for (const seat of ['driver', 'gunner'] as const) {
      for (const turret of [0, 40 * DEG, -120 * DEG]) {
        rigForSeat(seat, turret, hx, hz, yaw, rig);
        // The head's place in the hull: the rig's position plus the head turned by the rig's yaw.
        const c = Math.cos(rig[2]);
        const s = Math.sin(rig[2]);
        const headX = rig[0] + hx * c + hz * s;
        const headZ = rig[1] - hx * s + hz * c;
        seatEye(seat, turret, eye);
        expect(headX).toBeCloseTo(eye[0], 9);
        expect(headZ).toBeCloseTo(eye[1], 9);
        // Facing the hull's front (driver) or the gun (gunner).
        expect(rig[2] + yaw).toBeCloseTo(seat === 'gunner' ? turret : 0, 9);
      }
    }
    // The gunner's eyes go round the turret's middle with it.
    seatEye('gunner', Math.PI / 2, eye);
    expect(Math.hypot(eye[0] - TURRET.x, eye[1] - TURRET.z)).toBeCloseTo(Math.hypot(...seatEye('gunner', 0, [0, 0]).map((v, i) => v - [TURRET.x, TURRET.z][i])), 9);
  });

  it('seats both crew inside the hull, with the driver\'s slit at seated eye height', () => {
    const eye: [number, number] = [0, 0];
    for (const turret of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      seatEye('gunner', turret, eye);
      expect(Math.abs(eye[0])).toBeLessThan(HULL.width / 2 - 0.3);
      expect(Math.abs(eye[1])).toBeLessThan(HULL.length / 2 - 0.3);
    }
    expect(Math.abs(DRIVER_EYE[0])).toBeLessThan(HULL.width / 2 - 0.3);
    expect(Math.abs(SLIT.y - SEATED_EYE)).toBeLessThan(SLIT.height / 2);
    // The open cabin's sides are below seated eyes, so the world shows over them; the closed roof is above.
    expect(HULL.wallTop).toBeLessThan(SEATED_EYE - 0.3);
    expect(HULL.roof).toBeGreaterThan(SEATED_EYE + 0.2);
  });

  it('darkens the vignette with turning, speeding up and tilting, and only lightly at a steady speed', () => {
    expect(vignetteLevel(0, 0, 0, 0)).toBe(0);
    expect(vignetteLevel(20 * DEG, 0, 0, 0)).toBeCloseTo(1, 9);
    expect(vignetteLevel(-10 * DEG, 0, 0, 0)).toBeCloseTo(0.5, 9);
    expect(vignetteLevel(0, -1, 0, 0)).toBeCloseTo(1, 9);
    expect(vignetteLevel(0, 0, 0, MAX_SPEED)).toBeLessThan(0.5);
    expect(vignetteLevel(90 * DEG, 5, 1, 50)).toBe(1);
  });

  it('sinks trees in the tank\'s way and grows them back behind it', () => {
    expect(treeScale(0)).toBe(0);
    expect(treeScale(TREE_GONE)).toBe(0);
    expect(treeScale(TREE_FULL)).toBe(1);
    expect(treeScale(100)).toBe(1);
    const mid = treeScale((TREE_GONE + TREE_FULL) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    // Gone before it reaches the hull's corners.
    expect(TREE_GONE).toBeGreaterThan(Math.hypot(HULL.width, HULL.length) / 2 + 1);
  });
});
