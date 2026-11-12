import { describe, expect, it } from 'vitest';
import { decodeLoadingState, encodeLoadingState, LOADING_STATE_BYTES, LOADING_STATE_BYTES_V1 } from '../src/net/loading-codec.js';
import {
  AMMO,
  AMMO_KINDS,
  ammoIndex,
  MIXED_RACK,
  parseAmmo,
  parseRackChoice,
  rackKinds,
  SMOKE,
  SMOKE_LIFE,
  smokeBlocks,
  type SmokeCloud,
  smokeCentre,
  smokeHalfLength,
  smokeRadius,
  smokeTail,
  SMOKE_WIND_DIR,
  type AmmoKind,
} from '../src/sim/ammo.js';
import {
  aimAt,
  createShotResult,
  decideShot,
  describeRound,
  distanceToFace,
  dropAt,
  flyShell,
  hullDirToWorld,
  hullToWorld,
  MUZZLE_SPEED,
  RANGE_TARGET_NAMES,
  rangeFaces,
  type ShotResult,
  softTargets,
  targetFaces,
  type Vec3,
} from '../src/sim/ballistics.js';
import { boardLines, createLoadingSnapshot, LoadingDrill, SHELL_COUNT } from '../src/sim/loading.js';
import { RANGE_TARGETS } from '../src/sim/range.js';
import { rangeMarks } from '../src/sim/sight.js';
import { createTankDrive } from '../src/sim/tank-drive.js';
import { barrelDirection, muzzlePoint } from '../src/sim/turret.js';

/** Fire round `ammo` from the tank at its start, laid on face `face` (of `faces`) moved `right` m to its right and `above` m up. */
function shoot(ammo: AmmoKind, faceIndex: number, right = 0, above = 0, layFor: AmmoKind = ammo) {
  const tank = createTankDrive();
  const faces = rangeFaces();
  const f = faces[faceIndex];
  const aimPoint = { ...f, x: f.x + Math.cos(f.yaw) * right, y: f.y + above, z: f.z - Math.sin(f.yaw) * right };
  const { yaw, elevation } = aimAt(tank, aimPoint, muzzlePoint, undefined, AMMO[layFor].speed);
  const origin = hullToWorld(tank, muzzlePoint(yaw, elevation, [0, 0, 0]), [0, 0, 0]);
  const dir = hullDirToWorld(tank, barrelDirection(yaw, elevation, [0, 0, 0]), [0, 0, 0]);
  const result = flyShell(origin, dir, faces, createShotResult(), undefined, AMMO[ammo].speed);
  const decision = decideShot(ammo, result, faces, softTargets().slice(0, faces.length));
  return { result, decision, line: describeRound(ammo, result, decision, origin, dir, faces, RANGE_TARGET_NAMES) };
}

const GUN = RANGE_TARGETS.findIndex((t) => t.kind === 'gun');
const NEAR_TANK = 0;

describe('ammunition (F3.1)', () => {
  it('has AP at Phase 1\'s speed and slower HE and smoke, which drop more', () => {
    expect(AMMO.ap.speed).toBe(MUZZLE_SPEED);
    expect(AMMO.he.speed).toBeLessThan(AMMO.ap.speed);
    expect(dropAt(500, AMMO.he.speed)).toBeGreaterThan(dropAt(500) * 1.5);
    // The sight's HE scale reaches further down than the AP's.
    const ap = rangeMarks(undefined, AMMO.ap.speed);
    const he = rangeMarks(undefined, AMMO.he.speed);
    expect(he[he.length - 1].drop).toBeGreaterThan(ap[ap.length - 1].drop);
    // And still inside the field.
    expect(he[he.length - 1].drop).toBeLessThan(1);
  });

  it('reads a round off the network, armour piercing when there is none', () => {
    for (const kind of AMMO_KINDS) expect(parseAmmo(ammoIndex(kind))).toBe(kind);
    expect(parseAmmo(undefined)).toBe('ap');
    expect(parseAmmo(9)).toBe('ap');
    expect(parseRackChoice('he')).toBe('he');
    expect(parseRackChoice('nonsense')).toBeNull();
  });

  it('fills the rack mixed, all one round, or all AP at a biathlon line', () => {
    const out = new Array<AmmoKind>(SHELL_COUNT);
    expect(rackKinds('mixed', false, out)).toEqual([...MIXED_RACK]);
    expect(MIXED_RACK.slice(0, 2)).toEqual(['ap', 'ap']);
    expect(rackKinds('smoke', false, out)).toEqual(['smoke', 'smoke', 'smoke', 'smoke']);
    expect(rackKinds('he', true, out)).toEqual(['ap', 'ap', 'ap', 'ap']);
  });

  it('hits every range target laid for its own round, AP or HE', () => {
    RANGE_TARGETS.forEach((_, i) => {
      for (const ammo of ['ap', 'he'] as const) {
        const { result, decision, line } = shoot(ammo, i);
        expect(result.kind, `${ammo} on ${i}`).toBe('target');
        expect(decision.target).toBe(i);
        expect(line).toBe(ammo === 'ap' ? `Hit: ${RANGE_TARGET_NAMES[i]}` : `HE hit: ${RANGE_TARGET_NAMES[i]}`);
      }
    });
  });

  it('lands HE short when it is laid as for AP', () => {
    const { result, line } = shoot('he', 2, 0, 0, 'ap');
    expect(result.kind).toBe('ground');
    expect(line).toMatch(/^HE miss the 500 m tank: \d+ m short/);
  });

  it('counts an HE burst within its blast of the gun, not of a tank', () => {
    // Laid a few metres to the gun's right, low, so it bursts on the ground beside it.
    const near = shoot('he', GUN, 3, -1.15);
    expect(near.result.kind).toBe('ground');
    expect(near.decision.target).toBe(GUN);
    expect(near.decision.blast).toBeLessThanOrEqual(AMMO.he.blast);
    expect(near.line).toMatch(/^HE burst \d m from the 250 m gun: hit$/);
    // AP there is a miss.
    const ap = shoot('ap', GUN, 3, -1.15);
    expect(ap.decision.target).toBe(-1);
    // Beside a tank board the blast does nothing (armour; F3.4 does it properly).
    const tank = shoot('he', NEAR_TANK, 3, -1.6);
    expect(tank.result.kind).toBe('ground');
    expect(tank.decision.target).toBe(-1);
    // Well wide of the gun, no.
    const wide = shoot('he', GUN, 12, -1.15);
    expect(wide.decision.target).toBe(-1);
  });

  it('counts no hit for smoke, even on a board, and says where it went down', () => {
    const on = shoot('smoke', GUN);
    expect(on.result.kind).toBe('target');
    expect(on.decision.target).toBe(-1);
    expect(on.line).toBe('Smoke on the 250 m gun');
    const short = shoot('smoke', 2, 0, 0, 'ap');
    expect(short.line).toMatch(/^Smoke \d+ m short of the 500 m tank$/);
  });

  it('measures the blast from the face, on the nearest copy of the ground', () => {
    const f = rangeFaces()[GUN];
    expect(distanceToFace([f.x, f.y, f.z], f)).toBeCloseTo(0, 6);
    // Straight out in front of its middle by 3 m.
    expect(distanceToFace([f.x + Math.sin(f.yaw) * 3, f.y, f.z + Math.cos(f.yaw) * 3], f)).toBeCloseTo(3, 6);
    // Soft: the range's gun, and the three enemy guns (F3.2).
    expect(softTargets().filter(Boolean).length).toBe(4);
    expect(softTargets().length).toBe(targetFaces().length);
  });

  it('decides nothing for a shot that went into the distance', () => {
    const result: ShotResult = { kind: 'none', target: -1, point: [0, 0, 0], time: 4 };
    expect(decideShot('he', result, rangeFaces(), softTargets()).target).toBe(-1);
  });
});

describe('smoke screen (F3.1)', () => {
  it('grows fast, holds and thins away', () => {
    expect(smokeRadius(-1)).toBe(0);
    expect(smokeRadius(0)).toBeCloseTo(SMOKE.firstRadius, 6);
    expect(smokeRadius(SMOKE.grow / 2)).toBeGreaterThan((SMOKE.firstRadius + SMOKE.radius) / 2);
    expect(smokeRadius(SMOKE.grow + 1)).toBe(SMOKE.radius);
    expect(smokeRadius(SMOKE.grow + SMOKE.hold + SMOKE.fade / 2)).toBeCloseTo(SMOKE.radius / 2, 6);
    expect(smokeRadius(SMOKE_LIFE)).toBe(0);
  });

  it('stays where it landed while the wind draws it out downwind, its upwind end put', () => {
    const c: SmokeCloud = { x: 10, y: 2, z: -100, laidAt: 5 };
    const wind = Math.hypot(SMOKE.windX, SMOKE.windZ);
    // The upwind end: the middle less the half length, back along the wind.
    const upwind = (t: number) => {
      const at = smokeCentre(c, t, [0, 0, 0]);
      const l = smokeHalfLength(t - c.laidAt);
      return [at[0] - SMOKE_WIND_DIR[0] * l, at[2] - SMOKE_WIND_DIR[1] * l];
    };
    const grown = 5 + SMOKE.grow;
    const late = 5 + SMOKE.grow + SMOKE.hold - 1;
    expect(upwind(late)[0]).toBeCloseTo(upwind(grown)[0], 6);
    expect(upwind(late)[1]).toBeCloseTo(upwind(grown)[1], 6);
    expect(upwind(late)[0]).toBeCloseTo(10 - SMOKE.radius * SMOKE_WIND_DIR[0], 6);
    // Ten seconds on, the tail is the wind's ten seconds long, and the bank half that further downwind.
    const at = smokeCentre(c, 15, [0, 0, 0]);
    expect(smokeTail(10)).toBeCloseTo(wind * 10, 6);
    expect(at[0]).toBeCloseTo(10 + SMOKE.windX * 5, 6);
    expect(at[2]).toBeCloseTo(-100 + SMOKE.windZ * 5, 6);
    expect(at[1]).toBeGreaterThan(2);
    expect(smokeHalfLength(10)).toBeCloseTo(SMOKE.radius + wind * 5, 6);
    // The tail stops growing; gone, the bank has no length.
    expect(smokeTail(1000)).toBe(SMOKE.maxTail);
    expect(smokeHalfLength(SMOKE_LIFE)).toBe(0);
  });

  it('blocks along its whole drawn-out length, not just round where it landed', () => {
    const c: SmokeCloud = { x: 0, y: 0, z: -200, laidAt: 0 };
    const t = SMOKE.grow + 30;
    const l = smokeHalfLength(30 + SMOKE.grow);
    const at = smokeCentre(c, t, [0, 0, 0]);
    // A sight line crossing the bank a little short of its downwind end, square to the wind.
    const k = l - 3;
    const x = at[0] + SMOKE_WIND_DIR[0] * k;
    const z = at[2] + SMOKE_WIND_DIR[1] * k;
    const across = [-SMOKE_WIND_DIR[1], SMOKE_WIND_DIR[0]];
    const from: Vec3 = [x - across[0] * 100, 2, z - across[1] * 100];
    const to: Vec3 = [x + across[0] * 100, 2, z + across[1] * 100];
    expect(l).toBeGreaterThan(SMOKE.radius + 10);
    expect(smokeBlocks([c], t, from, to)).toBe(true);
    // And one past its end.
    const x2 = at[0] + SMOKE_WIND_DIR[0] * (l + 2);
    const z2 = at[2] + SMOKE_WIND_DIR[1] * (l + 2);
    expect(smokeBlocks([c], t, [x2 - across[0] * 100, 2, z2 - across[1] * 100], [x2 + across[0] * 100, 2, z2 + across[1] * 100])).toBe(false);
  });

  it('blocks a line through it, not one beside it or over it, and not once gone', () => {
    const c: SmokeCloud = { x: 0, y: 0, z: -200, laidAt: 0 };
    const t = SMOKE.grow + 1;
    const at = smokeCentre(c, t, [0, 0, 0]);
    const from: Vec3 = [at[0], 2, 0];
    const to: Vec3 = [at[0], 2, -400];
    expect(smokeBlocks([c], t, from, to)).toBe(true);
    expect(smokeBlocks([c], t, [at[0] + 20, 2, 0], [at[0] + 20, 2, -400])).toBe(false);
    expect(smokeBlocks([c], t, [at[0], 30, 0], [at[0], 30, -400])).toBe(false);
    // Short of it.
    expect(smokeBlocks([c], t, from, [at[0], 2, -150])).toBe(false);
    expect(smokeBlocks([c], SMOKE_LIFE + 1, from, to)).toBe(false);
  });
});

describe('rounds in the loading (F3.1)', () => {
  it('gives each shell its slot\'s round and keeps the rack through a reset', () => {
    const drill = new LoadingDrill();
    expect(drill.kinds).toEqual([...MIXED_RACK]);
    drill.setRack('he');
    expect(drill.kinds).toEqual(['he', 'he', 'he', 'he']);
    drill.reset();
    expect(drill.rack).toBe('he');
    expect(drill.kinds).toEqual(['he', 'he', 'he', 'he']);
    // A biathlon line: all AP while the rounds are limited, back after.
    drill.setRounds(3);
    expect(drill.kinds).toEqual(['ap', 'ap', 'ap', 'ap']);
    drill.setRounds(Number.POSITIVE_INFINITY);
    expect(drill.kinds).toEqual(['he', 'he', 'he', 'he']);
  });

  it('loads the round asked for, swapping one of another kind out of the breech', () => {
    const drill = new LoadingDrill();
    drill.loadNow();
    expect(drill.loadedKind()).toBe('ap');
    drill.loadNow('smoke');
    expect(drill.loaded).toBe(true);
    expect(drill.loadedKind()).toBe('smoke');
    expect(drill.shells.filter((s) => s.place === 'breech').length).toBe(1);
    expect(boardLines(drill.snapshot(createLoadingSnapshot()))[2]).toBe('Loaded Smoke: fire!');
    // A round the rack doesn't hold: the first there.
    drill.setRack('ap');
    expect(drill.loadedKind()).toBe('ap');
    drill.fire();
    drill.loadNow('he');
    expect(drill.loadedKind()).toBe('ap');
  });

  it('sends each shell\'s round in the loading packet, and reads one from before F3.1 as the mixed rack', () => {
    const drill = new LoadingDrill();
    drill.setRack('smoke');
    const a = drill.snapshot(createLoadingSnapshot());
    const buffer = new ArrayBuffer(LOADING_STATE_BYTES);
    expect(encodeLoadingState(buffer, 1, 2, a)).toBe(LOADING_STATE_BYTES);
    const b = createLoadingSnapshot();
    const header = { seq: 0, timeMs: 0 };
    expect(decodeLoadingState(new DataView(buffer), header, b)).toBe(true);
    expect(b.kinds).toEqual(['smoke', 'smoke', 'smoke', 'smoke']);
    const old = createLoadingSnapshot();
    old.kinds.fill('smoke');
    expect(decodeLoadingState(new DataView(buffer, 0, LOADING_STATE_BYTES_V1), header, old)).toBe(true);
    expect(old.kinds).toEqual([...MIXED_RACK]);
  });
});
