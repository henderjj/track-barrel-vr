import { describe, expect, it } from 'vitest';
import {
  applyHit,
  ARMOUR,
  armourMet,
  DAMAGE,
  type DamageHit,
  damageLine,
  freshDamage,
  hitLine,
  hitZone,
  parseDamage,
  parseHit,
  penetration,
  repair,
  resolveDamage,
  type TankPose,
} from '../src/sim/damage.js';
import { ENEMY_GUNS, parseShot, resolveShot, type TankTarget } from '../src/sim/enemy-guns.js';
import { DAMAGED_PULL, STALL_CAUSES, startEngine } from '../src/sim/engine.js';
import { decodeTankState, encodeTankState, TANK_STATE_BYTES } from '../src/net/tank-codec.js';
import { rng } from '../src/sim/random.js';
import { COOLANT_IDLE, coolantTarget, createControls, createTankDrive, type DriverControls, LEAK_HEAT, stepDrive, stepEngineGauges, type TankDrive } from '../src/sim/tank-drive.js';
import { groundHeight } from '../src/sim/terrain.js';

const DT = 1 / 30;
const DEG = Math.PI / 180;

/** The crew's tank at the origin facing -z (up the lane), its turret straight ahead unless said. */
function pose(turretYaw = 0): TankPose {
  return { x: 0, z: 0, ground: 0, heading: 0, turretYaw };
}

/** A shell from `bearing` (rad, 0 dead ahead, positive to the left as the turret turns) and `range` m, striking at height `h` and `along` m forward of the middle. */
function shell(bearing: number, h: number, range = 300, along = 0): { from: [number, number, number]; to: [number, number, number] } {
  // Ahead is -z; left (positive bearing) is -x.
  const dx = -Math.sin(bearing);
  const dz = -Math.cos(bearing);
  return { from: [dx * range, 1, dz * range], to: [0, h, -along] };
}

function c(over: Partial<DriverControls> = {}): DriverControls {
  return { ...createControls(), ...over };
}

function warm(): TankDrive {
  const s = createTankDrive();
  s.coolant = COOLANT_IDLE;
  return s;
}

function run(s: TankDrive, controls: DriverControls, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) stepDrive(s, controls, DT, []);
}

/** Through-rate of `n` shells, each with its own dice. */
function throughRate(make: () => { from: [number, number, number]; to: [number, number, number] }, range: number, n = 400): number {
  let through = 0;
  for (let k = 0; k < n; k++) {
    const s = make();
    if (resolveDamage(s.from, s.to, range, pose(), rng(10 + k)).through) through++;
  }
  return through / n;
}

describe('the tank damage model (F3.4)', () => {
  it("knows an M4A4's armour and an enemy 75 mm shell's penetration", () => {
    // Head on, the 51 mm glacis laid back 56° is about 91 mm along the shell's path.
    expect(armourMet(ARMOUR['hull-front'].mm, ARMOUR['hull-front'].slope, 0).mm).toBeCloseTo(91, 0);
    // The sides are thinner, and angling them adds armour.
    expect(armourMet(38, 0, 0).mm).toBeCloseTo(38, 6);
    expect(armourMet(38, 0, 60 * DEG).mm).toBeCloseTo(76, 0);
    expect(penetration(100)).toBe(DAMAGE.penAt100);
    expect(penetration(500)).toBeLessThan(penetration(250));
  });

  it('finds where a shell strikes: hull or turret, front, side, rear, or the running gear', () => {
    const at = (bearing: number, h: number, turret = 0, along = 0) => hitZone(shell(bearing, h).from, shell(bearing, h, 300, along).to, pose(turret));
    expect(at(0, 1.2).zone).toBe('hull-front');
    expect(at(0, 2.3).zone).toBe('turret-front');
    expect(at(Math.PI, 1.2).zone).toBe('hull-rear');
    const left = at(90 * DEG, 1.2);
    expect(left.zone).toBe('hull-side');
    expect(left.right).toBe(false);
    expect(at(-90 * DEG, 1.2).right).toBe(true);
    expect(at(-90 * DEG, 0.5).zone).toBe('running-gear');
    // The turret turned to 9 o'clock: a shell from ahead strikes its side.
    expect(at(0, 2.3, 90 * DEG).zone).toBe('turret-side');
    // Along the hull: the driver's compartment ahead, the engine's behind.
    expect(at(-90 * DEG, 1.2, 0, 2).along).toBeCloseTo(2, 6);
  });

  it('lets a shell through the thin sides at any range here, and the front plate less the further it comes from', () => {
    expect(throughRate(() => shell(-90 * DEG, 1.2), 400)).toBe(1);
    const near = throughRate(() => shell(0, 1.2), 150);
    const far = throughRate(() => shell(0, 1.2), 550);
    expect(near).toBeGreaterThan(0.9);
    expect(far).toBeLessThan(near);
    // The glacis angled 44° to the shot glances it off, however close.
    for (let k = 0; k < 50; k++) {
      const glancing = resolveDamage(shell(0, 1.2).from, shell(0, 1.2).to, 100, { ...pose(), heading: 44 * DEG }, rng(k));
      expect(glancing.zone).toBe('hull-front');
      expect(glancing.through).toBe(false);
    }
  });

  it('hits what is where it got in: the engine from behind, the driver in front, the gunner and the traverse in the turret, a track low on the side', () => {
    const effects = (s: ReturnType<typeof shell>, n = 300) => {
      const seen = new Map<string, number>();
      for (let k = 0; k < n; k++) for (const e of resolveDamage(s.from, s.to, 200, pose(), rng(500 + k)).effects) seen.set(e, (seen.get(e) ?? 0) + 1);
      return seen;
    };
    expect(effects(shell(Math.PI, 1.2)).get('engine')).toBe(300);
    expect(effects(shell(-90 * DEG, 1.2, 300, -2)).get('engine')).toBe(300);
    const front = effects(shell(-90 * DEG, 1.2, 300, 2));
    expect(front.get('driver')).toBeGreaterThan(100);
    expect(front.get('engine')).toBeUndefined();
    const turret = effects(shell(-90 * DEG, 2.3));
    expect(turret.get('gunner')).toBeGreaterThan(100);
    expect(turret.get('traverse')).toBeGreaterThan(50);
    const low = effects(shell(-90 * DEG, 0.4));
    expect(low.get('right-track')).toBeGreaterThan(150);
    expect(low.get('left-track')).toBeUndefined();
    const glacis = effects(shell(0, 1.2, 300, 1.5));
    expect(glacis.get('transmission')).toBeGreaterThan(50);
  });

  it('adds up the damage, knocks the tank out after three hits through the armour, and repairs it all', () => {
    const s = freshDamage();
    const engine: DamageHit = { zone: 'hull-rear', through: true, armour: 39, pen: 110, effects: ['engine'], right: false };
    const bounce: DamageHit = { zone: 'hull-front', through: false, armour: 91, pen: 80, effects: [], right: false };
    expect(applyHit(s, bounce)).toBe(false);
    expect(s).toMatchObject({ hits: 1, through: 0, engine: 0 });
    expect(applyHit(s, engine)).toBe(false);
    expect(s.engine).toBe(1);
    applyHit(s, { zone: 'running-gear', through: true, armour: 0, pen: 0, effects: ['left-track'], right: false });
    expect(s.immobile).toBe('left-track');
    // The running gear isn't through the armour.
    expect(s.through).toBe(1);
    applyHit(s, { zone: 'turret-side', through: true, armour: 52, pen: 110, effects: ['gunner', 'traverse'], right: true });
    expect(s).toMatchObject({ gunner: 1, traverse: true, out: false });
    expect(applyHit(s, { zone: 'hull-side', through: true, armour: 38, pen: 110, effects: [], right: true })).toBe(true);
    expect(s.out).toBe(true);
    expect(s.engine).toBe(2);
    expect(damageLine(s)).toBe('Knocked out, left track broken, power traverse out, gunner wounded. 3 of 5 hits through the armour');
    const v = s.v;
    repair(s);
    expect(s).toMatchObject({ ...freshDamage(), v: v + 1 });
    expect(damageLine(s)).toBe('No damage');
  });

  it('says what a hit did', () => {
    expect(hitLine({ zone: 'hull-front', through: false, armour: 91, pen: 80, effects: [], right: false })).toBe('Bounced off the front plate');
    expect(hitLine({ zone: 'hull-side', through: true, armour: 38, pen: 110, effects: ['engine'], right: true })).toBe('Through the right side: engine hit');
    expect(hitLine({ zone: 'turret-front', through: true, armour: 88, pen: 110, effects: [], right: false })).toBe('Through the turret front: no one hurt');
    expect(hitLine({ zone: 'running-gear', through: true, armour: 0, pen: 0, effects: ['left-track'], right: false })).toBe('Struck the left running gear: the track is broken');
  });

  it('holds a broken-down tank: an immobilised one stays put, a damaged engine pulls less and runs hot, a knocked-out one stops and will not start', () => {
    const drive = c({ mode: 'auto', left: 1, right: 1 });
    const sound = warm();
    run(sound, drive, 4);
    const held = warm();
    held.immobile = true;
    run(held, drive, 4);
    expect(sound.speed).toBeGreaterThan(2);
    expect(Math.abs(held.speed)).toBeLessThan(0.01);
    expect(Math.hypot(held.x, held.z)).toBeLessThan(0.05);

    const hurt = warm();
    hurt.damage = 1;
    run(hurt, drive, 4);
    expect(hurt.speed).toBeLessThan(sound.speed);
    expect(DAMAGED_PULL).toBeLessThan(1);
    const hot = warm();
    hot.damage = 1;
    hot.rpm = 2000;
    const cool = warm();
    cool.rpm = 2000;
    for (let t = 0; t < 600; t += 1) {
      stepEngineGauges(hot, 1);
      stepEngineGauges(cool, 1);
    }
    expect(hot.coolant - cool.coolant).toBeGreaterThan(LEAK_HEAT * 0.8);
    expect(hot.coolant).toBeGreaterThan(coolantTarget(2000, hot.gear));

    const dead = warm();
    dead.damage = 2;
    run(dead, c(), 0.2);
    expect(dead.running).toBe(false);
    expect(dead.stallCause).toBe('hit');
    startEngine(dead);
    expect(dead.running).toBe(false);
    run(dead, c({ starter: true }), 5);
    expect(dead.running).toBe(false);
    // The crewmate's page hears why (the cause appended after F3.7's, the packet's index unchanged for the others).
    expect(STALL_CAUSES.indexOf('hit')).toBe(STALL_CAUSES.indexOf('heat') + 1);
    const buffer = new ArrayBuffer(TANK_STATE_BYTES);
    encodeTankState(buffer, 1, 2, dead, createControls());
    const out = createTankDrive();
    expect(decodeTankState(new DataView(buffer), { seq: 0, timeMs: 0 }, out)).toBe(true);
    expect(out.stallCause).toBe('hit');
  });

  it('shares the damage and each hit with the enemy shot, refusing a broken message', () => {
    const s = freshDamage();
    applyHit(s, { zone: 'turret-side', through: true, armour: 52, pen: 110, effects: ['gunner'], right: true });
    expect(parseDamage(JSON.parse(JSON.stringify({ t: 'damage', ...s })))).toEqual(s);
    expect(parseDamage({ engine: 'x' })).toBeNull();
    expect(parseHit({ zone: 'nowhere', through: true, effects: [] })).toBeNull();
    // An enemy shot that hits carries what it did.
    const tank: TankTarget = { x: 0, ground: groundHeight(0, ENEMY_GUNS[0].meetZ), z: ENEMY_GUNS[0].meetZ, heading: 0, speed: 0 };
    const shot = resolveShot(0, tank, 2, rng(1));
    shot.hit = true;
    shot.damage = resolveDamage(shot.from, shot.to, shot.range, { x: tank.x, z: tank.z, ground: tank.ground, heading: 0, turretYaw: 0 }, rng(2));
    expect(parseShot(JSON.parse(JSON.stringify({ t: 'enemy-shot', ...shot })))).toEqual(shot);
    // Gun A is on the left at 10 o'clock: its hits strike the left side or the front.
    expect(['hull-side', 'hull-front', 'turret-side', 'turret-front', 'running-gear']).toContain(shot.damage.zone);
  });
});
