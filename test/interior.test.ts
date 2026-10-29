import { describe, expect, it } from 'vitest';
import { frontAt, GLACIS, GLACIS_SLOPE, HULL, SEATS, SIGHT_EYEPIECE, TURRET, VISION_SLIT } from '../src/sim/cabin.js';
import { DRIVER_CONTROLS } from '../src/sim/driver-station.js';
import { INTERIOR_LIGHTS, insideCabin, interiorLight, turretToHull } from '../src/sim/interior.js';
import { Lever, type Vec3, Wheel } from '../src/sim/mechanism.js';
import { LENS } from '../src/sim/periscope.js';
import { ELEVATION_WHEEL, STATION, TRAVERSE_CRANK } from '../src/sim/turret.js';
import { interiorUniforms, setInteriorTurret } from '../src/scene-assets/cabin-light.js';

const DEG = Math.PI / 180;
const v3 = (): [number, number, number] => [0, 0, 0];

/** A tiller's handle middle in hull space at lever angle `angle`. */
function tillerHandle(id: 'tillerLeft' | 'tillerRight', angle: number): Vec3 {
  const { spec, pivot } = DRIVER_CONTROLS[id];
  const lever = new Lever(spec);
  lever.angle = angle;
  const p = lever.handle(1, [0, 0, 0]);
  return [pivot[0] + p[0], pivot[1] + p[1], pivot[2] + p[2]];
}

/** A gunner's wheel's rim (or the crank's knob) at its nearest point to the eye, turret space: the mount's centre moved up its face by the radius. */
function wheelTop(key: 'elevation' | 'crank'): Vec3 {
  const { at, tilt } = STATION[key];
  const r = (key === 'elevation' ? new Wheel(ELEVATION_WHEEL) : new Wheel(TRAVERSE_CRANK)).spec.radius;
  return [at[0], at[1] + r * Math.cos(tilt), at[2] + r * Math.sin(tilt)];
}

describe('a Sherman-like front (docs/interior.md)', () => {
  it('slopes the glacis back about as steeply as a Sherman\'s, from the nose to the hood', () => {
    expect(GLACIS_SLOPE / DEG).toBeGreaterThan(50);
    expect(GLACIS_SLOPE / DEG).toBeLessThan(60);
    expect(frontAt(0)).toBe(HULL.front);
    expect(frontAt(GLACIS.noseTop)).toBe(HULL.front);
    expect(frontAt(GLACIS.hoodBottom)).toBeCloseTo(GLACIS.face, 9);
    expect(frontAt(HULL.roof)).toBe(GLACIS.face);
    // The slit is in the hood's upright face, over its bottom.
    expect(VISION_SLIT.z).toBe(GLACIS.face);
    expect(VISION_SLIT.y - VISION_SLIT.height / 2).toBeGreaterThan(GLACIS.hoodBottom + 0.04);
  });

  it("brings what the driver looks through within a short lean, with their hands still on the tillers", () => {
    const [ex, ey, ez] = SEATS.driver.eye;
    // The slit 30 cm ahead (it was 80), the periscope's window 15 cm ahead and 26 cm to the right.
    expect(ez - VISION_SLIT.z).toBeCloseTo(0.3, 6);
    expect(Math.hypot(LENS[0] - ex, LENS[2] - ez)).toBeLessThan(0.32);
    // Leant in as far as the head goes, the tillers' handles are a forearm ahead and under the shoulders, at either end of their travel.
    const leant: Vec3 = [ex, ey, ez - SEATS.driver.headBox[2]];
    for (const id of ['tillerLeft', 'tillerRight'] as const) {
      const { spec } = DRIVER_CONTROLS[id];
      for (const angle of [spec.min, 0, spec.max]) {
        const h = tillerHandle(id, angle);
        const label = `${id} at ${(angle / DEG).toFixed(0)}°`;
        expect(leant[2] - h[2], label).toBeGreaterThan(0.1);
        expect(leant[2] - h[2], label).toBeLessThan(0.5);
        expect(leant[1] - h[1], label).toBeGreaterThan(0.4);
        expect(leant[1] - h[1], label).toBeLessThan(0.6);
      }
    }
  });

  it("puts the gunner's wheels close under the sight: hands on them with the eye at the eyepiece", () => {
    const g = SEATS.gunner;
    // An 18 cm lean (it was 28), the head stopping 4 cm short.
    expect(g.eye[2] - SIGHT_EYEPIECE[2]).toBeCloseTo(0.18, 6);
    const atSight: Vec3 = [SIGHT_EYEPIECE[0], SIGHT_EYEPIECE[1], g.eye[2] - g.headBox[2]];
    for (const key of ['elevation', 'crank'] as const) {
      // The hub 35 to 45 cm under the eye (it was 47 to 51), the rim's top no nearer than 25 cm, and a short forearm ahead.
      const hub = STATION[key].at;
      const top = wheelTop(key);
      expect(atSight[1] - hub[1], key).toBeGreaterThan(0.35);
      expect(atSight[1] - hub[1], key).toBeLessThan(0.45);
      expect(atSight[1] - top[1], key).toBeGreaterThan(0.25);
      expect(atSight[2] - top[2], key).toBeGreaterThan(0.12);
      expect(atSight[2] - top[2], key).toBeLessThan(0.35);
    }
  });
});

describe('the interior lighting (docs/interior.md)', () => {
  const up = [0, 1, 0];
  const lit = (p: number[], n = up, yaw = 0) => {
    const c = interiorLight(p, n, yaw, v3());
    return (c[0] + c[1] + c[2]) / 3;
  };

  it("leaves everything outside the tank as the sky lights it, the armour's outer faces too", () => {
    expect(lit([0, 0, -20])).toBe(1);
    expect(lit([0, 3.5, 0])).toBe(1);
    // The side wall's and the glacis's outer faces.
    expect(insideCabin([HULL.halfWidth + HULL.wall, 1, 0], 0)).toBe(false);
    const y = (GLACIS.noseTop + GLACIS.hoodBottom) / 2;
    expect(insideCabin([0, y, frontAt(y) - HULL.wall], 0)).toBe(false);
    // The turret's outer faces, however it turns.
    for (const yaw of [0, 0.7, 2]) {
      expect(insideCabin(turretToHull([TURRET.halfWidth, 2.3, 0], yaw, v3()), yaw)).toBe(false);
      expect(insideCabin(turretToHull([0, TURRET.roof + HULL.wall, 0.3], yaw, v3()), yaw)).toBe(false);
    }
  });

  it('darkens the inside: dim away from the hatches and lamps, darkest low down, brightest under an open hatch', () => {
    const rearFloor = lit([0.8, 0.02, 1.8]);
    const rearWall = lit([0, 1.2, HULL.rear], [0, 0, -1]);
    expect(rearFloor).toBeLessThan(rearWall);
    expect(rearWall).toBeLessThan(0.6);
    // The driver's seat cushion, under their hatch, is lit well above the rear of the hull.
    const cushion = SEATS.driver.cushion;
    expect(lit([...cushion])).toBeGreaterThan(rearFloor + 0.15);
    // Nowhere inside is black, nor brighter than the sky outside (beyond a little right under an open hatch).
    for (const p of [[0, 0.02, -2.3], [-0.5, 1.7, -1.5], [0.9, 1.0, 0.5], [0.4, 2.7, -0.1], [0, 2.0, 1.0]]) {
      expect(lit(p)).toBeGreaterThan(0.2);
      expect(lit(p)).toBeLessThan(1.1);
    }
  });

  it("turns the turret's hatch daylight and dome lamp with it, in the shader's lights too", () => {
    for (const yaw of [0, 1, -2.5]) {
      setInteriorTurret(yaw);
      INTERIOR_LIGHTS.forEach((light, i) => {
        const want = light.frame === 'turret' ? turretToHull(light.at, yaw, v3()) : light.at;
        const got = interiorUniforms.cabinLightAt.value[i];
        expect(Math.hypot(got.x - want[0], got.y - want[1], got.z - want[2]), light.id).toBeLessThan(1e-6);
      });
      expect(interiorUniforms.cabinYaw.value).toBe(yaw);
      // Right under the turret's dome lamp, wherever it has turned, is lit above the turret's ambient.
      const lamp = INTERIOR_LIGHTS.find((l) => l.id === 'turret-lamp')!;
      expect(lit(turretToHull([lamp.at[0], lamp.at[1] - 0.2, lamp.at[2]], yaw, v3()), [0, -1, 0], yaw)).toBeGreaterThan(0.5);
    }
    setInteriorTurret(0);
  });

  it('keeps the lamps warm and the daylight cool', () => {
    for (const l of INTERIOR_LIGHTS) {
      const [r, , b] = l.color;
      if (l.id.endsWith('lamp')) expect(r).toBeGreaterThan(b);
      else expect(b).toBeGreaterThan(r);
    }
  });
});
