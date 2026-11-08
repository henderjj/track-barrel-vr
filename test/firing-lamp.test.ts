import { describe, expect, it } from 'vitest';
import { EYE_CLEARANCE, GLACIS, HULL, SEATS, SIGHT_EYEPIECE, TURRET, VISION_SLIT } from '../src/sim/cabin.js';
import { createDriveWish, BotDriver } from '../src/sim/crew-bot.js';
import { FiringLamp, FIRING_LAMP, FLASH, FLASH_SECONDS, gunReady, LAMP_REPEATER, type LampLook, lensFront } from '../src/sim/firing-lamp.js';
import { KNUCKLE } from '../src/sim/gunsight.js';
import { createTankDrive } from '../src/sim/tank-drive.js';
import { TURRET_DIAL } from '../src/sim/turret-dial.js';
import { RUN_CLOCKS } from '../src/scene-assets/range-run.scene-asset.js';

const DEG = Math.PI / 180;
const DT = 1 / 90;

/** Points round a lamp's lens's front rim and its middle, in its frame. */
function lensFrontPoints(p: typeof FIRING_LAMP): number[][] {
  const z = lensFront(p);
  const out: number[][] = [[p.x, p.y, z]];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 2 * Math.PI;
    out.push([p.x + Math.cos(a) * p.bezel, p.y + Math.sin(a) * p.bezel, p.z + p.proud]);
    out.push([p.x + Math.cos(a) * p.lens, p.y + Math.sin(a) * p.lens, z]);
  }
  return out;
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('the firing lamp (F2.5)', () => {
  it('is ready only with the breech loaded and closed and a hand on a trigger, or a lone Practice load', () => {
    for (const loaded of [false, true]) {
      for (const handOnTrigger of [false, true]) {
        for (const practice of [false, true]) {
          expect(gunReady({ loaded, handOnTrigger, practice })).toBe(loaded && (handOnTrigger || practice));
        }
      }
    }
  });

  it('lights while ready, goes dark when not, and flashes three times at the shot whatever the gun does', () => {
    const lamp = new FiringLamp();
    expect(lamp.step(DT, false)).toBe('dark');
    expect(lamp.step(DT, true)).toBe('lit');
    expect(lamp.step(DT, false)).toBe('dark');
    lamp.step(DT, true);
    lamp.fired();
    expect(lamp.flashing).toBe(true);
    // Through the flashes: the breech opens at the shot, so not ready from the first frame.
    const looks: LampLook[] = [];
    for (let t = 0; t < FLASH_SECONDS + 0.2; t += DT) looks.push(lamp.step(DT, false));
    const runs: [LampLook, number][] = [];
    for (const look of looks) {
      const last = runs[runs.length - 1];
      if (last && last[0] === look) last[1]++;
      else runs.push([look, 1]);
    }
    expect(runs.map((r) => r[0])).toEqual(['flash', 'dark', 'flash', 'dark', 'flash', 'dark']);
    for (const [look, frames] of runs.slice(0, 5)) {
      expect(frames * DT).toBeCloseTo(look === 'flash' ? FLASH.on : FLASH.off, 1);
    }
    expect(lamp.flashes).toBe(1);
    expect(lamp.flashing).toBe(false);
    expect(FLASH_SECONDS).toBeLessThan(1);
    // Loaded again with the hand still on: lit.
    expect(lamp.step(DT, true)).toBe('lit');
    // A shot while lit flashes too, and ends lit if the gun is (somehow) ready again.
    lamp.fired();
    for (let t = 0; t < FLASH_SECONDS; t += DT) lamp.step(DT, true);
    expect(lamp.step(DT, true)).toBe('lit');
    expect(lamp.flashes).toBe(2);
  });

  it("sits on the hood's face just right of the turret dial, at its height, and is big enough to read from the seat", () => {
    const p = FIRING_LAMP;
    const d = TURRET_DIAL;
    // Flat on the hood's face, beside the dial's case and clear of it, level with its middle.
    expect(p.z).toBe(VISION_SLIT.z);
    expect(p.y).toBe(d.y);
    const gap = p.x - p.bezel - (d.x + d.radius + d.rim);
    expect(gap).toBeGreaterThan(0.01);
    expect(gap).toBeLessThan(0.03);
    // Above the hood's bottom edge and well inside the hull's right wall; the run clock stays on the slit's other side.
    expect(p.y - p.bezel).toBeGreaterThan(GLACIS.hoodBottom);
    expect(p.x + p.bezel).toBeLessThan(HULL.halfWidth - 0.2);
    expect(RUN_CLOCKS.driver.x + RUN_CLOCKS.driver.width / 2).toBeLessThan(VISION_SLIT.x);
    // Under 2 cm proud of the armour, as the dial is (docs/turret-dial.md).
    expect(lensFront(p) - VISION_SLIT.z).toBeLessThan(0.02);
    // From the seat's eyes: under 55 cm away, and over 3° across.
    const eye = SEATS.driver.eye;
    const dd = dist(eye, [p.x, p.y, lensFront(p)]);
    expect(dd).toBeLessThan(0.55);
    expect((2 * Math.atan(p.lens / dd)) / DEG).toBeGreaterThan(3);
  });

  it("is in plain sight from the driver's seat: nothing of the hull, the periscope's eyepiece or its crank (turned any way) in front of it (John's headset check, 2026-11-08)", async () => {
    const { Group, Raycaster, Vector3 } = await import('@iwsdk/core');
    const { createHull } = await import('../src/scene-assets/cabin.scene-asset.js');
    const periscope = await import('../src/scene-assets/periscope.scene-asset.js');
    const { createWheel } = await import('../src/scene-assets/mechanism.scene-asset.js');
    const { PERISCOPE_CRANK, PERISCOPES } = await import('../src/sim/periscope.js');
    const s = PERISCOPES.driver;
    const hull = createHull();
    const mount = new Group();
    mount.position.set(s.axis[0], s.lens[1], s.axis[1]);
    mount.add(periscope.createPeriscopeBody(s));
    mount.add(periscope.createPeriscopeTurning(s));
    const crank = createWheel(PERISCOPE_CRANK);
    crank.position.set(...periscope.crankInPeriscope(s));
    mount.add(crank);
    hull.add(mount);
    const ray = new Raycaster();
    const eye = SEATS.driver.eye;
    const p = FIRING_LAMP;
    const targets = [[p.x, p.y, lensFront(p)]];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      targets.push([p.x + Math.cos(a) * p.lens, p.y + Math.sin(a) * p.lens, lensFront(p)]);
    }
    for (let k = 0; k < 12; k++) {
      crank.rotation.z = (k / 12) * 2 * Math.PI;
      hull.updateMatrixWorld(true);
      // From the eye point and a few centimetres round it, as a seated head moves.
      for (const [dx, dy] of [[0, 0], [0.03, 0], [-0.03, 0], [0, 0.03], [0, -0.03]]) {
        const from = new Vector3(eye[0] + dx, eye[1] + dy, eye[2]);
        for (const t of targets) {
          const to = new Vector3(t[0], t[1], t[2]);
          const length = from.distanceTo(to);
          ray.set(from, to.sub(from).normalize());
          ray.far = length - 0.002;
          const hit = ray.intersectObject(hull, true)[0];
          expect(hit ? hit.object.name || 'a mesh' : 'nothing', `crank at ${k * 30}°, eyes moved (${dx}, ${dy})`).toBe('nothing');
        }
      }
    }
  });

  it("keeps the driver's eyes EYE_CLEARANCE from the lens all along the head box's edges", () => {
    const seat = SEATS.driver;
    const [left, right, forward, back] = seat.headBox;
    const points = lensFrontPoints(FIRING_LAMP);
    for (let k = 0; k <= 8; k++) {
      const x = seat.eye[0] - left + ((left + right) * k) / 8;
      const z = seat.eye[2] - forward + ((forward + back) * k) / 8;
      for (const eye of [[x, seat.eye[1], seat.eye[2] - forward], [seat.eye[0] - left, seat.eye[1], z], [seat.eye[0], seat.eye[1] + seat.headUp, seat.eye[2]]]) {
        // As test/interior.test.ts allows for the hood and the brow pad round it.
        for (const q of points) expect(dist(eye, q)).toBeGreaterThan(EYE_CLEARANCE - 0.01);
      }
    }
  });

  it("puts the repeater on the turret's front wall right of the gunsight, where the gunner sees it past the sight's arm", () => {
    const p = LAMP_REPEATER;
    expect(p.z).toBeCloseTo(TURRET.front + 0.08, 9);
    // Right of the sight's knuckle (10 cm wide) and arm (4 cm radius), left of the turret's corner fillets.
    expect(p.x - p.bezel).toBeGreaterThan(KNUCKLE[0] + 0.05 + 0.05);
    expect(p.x + p.bezel).toBeLessThan(TURRET.halfWidth - 0.4);
    // From the seated eyes the line to it passes the sight's arm (along z at x, y of the eyepiece) by more than the arm's radius.
    const eye = SEATS.gunner.eye;
    const lamp = [p.x, p.y, lensFront(p)];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const q = eye.map((e, i) => e + (lamp[i] - e) * t);
      if (q[2] > SIGHT_EYEPIECE[2] || q[2] < KNUCKLE[2]) continue;
      expect(Math.hypot(q[0] - SIGHT_EYEPIECE[0], q[1] - SIGHT_EYEPIECE[1])).toBeGreaterThan(0.04 + 0.01);
    }
    const d = dist(eye, lamp);
    expect(d).toBeGreaterThan(0.8);
    expect(d).toBeLessThan(1);
    expect((2 * Math.atan(p.lens / d)) / DEG).toBeGreaterThan(2);
    // Out of the gunner's way: far beyond where the eyes can lean.
    expect(eye[2] - SEATS.gunner.headBox[2] - lensFront(p)).toBeGreaterThan(0.5);
  });
});

describe('practice crewmate: holding steady for the gun (F2.5)', () => {
  it('stops and holds while the lamp is lit, then carries on with what it was told', () => {
    const bot = new BotDriver();
    const tank = createTankDrive();
    const wish = createDriveWish();
    bot.call('advance', tank.heading);
    bot.update(DT, tank, wish);
    expect(wish.left).toBeGreaterThan(0.2);
    expect(wish.right).toBeGreaterThan(0.2);
    bot.update(DT, tank, wish, true);
    expect(wish).toEqual({ left: 0, right: 0 });
    expect(bot.describe()).toMatch(/holding steady/);
    // A turn called while lit waits too.
    bot.call('left', tank.heading);
    bot.update(DT, tank, wish, true);
    expect(wish).toEqual({ left: 0, right: 0 });
    bot.update(DT, tank, wish, false);
    expect(bot.motion).toBe('advance');
    expect(wish.right).toBeGreaterThan(wish.left);
    expect(bot.describe()).toBe('advancing');
  });

  it("doesn't let a route halt run out while the lamp is lit", () => {
    const bot = new BotDriver();
    const tank = createTankDrive();
    const wish = createDriveWish();
    bot.call('route', tank.heading);
    bot.halting = 2;
    for (let t = 0; t < 5; t += DT) bot.update(DT, tank, wish, true);
    expect(bot.halting).toBe(2);
    expect(bot.leg).toBe(0);
    for (let t = 0; t < 2.1; t += DT) bot.update(DT, tank, wish, false);
    expect(bot.halting).toBe(0);
    expect(bot.leg).toBe(1);
  });
});
