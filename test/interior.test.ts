import { describe, expect, it } from 'vitest';
import { EYE_CLEARANCE, frontAt, GLACIS, GLACIS_SLOPE, HULL, OPEN_LEAN, SEATS, seatToHull, SIGHT_EYEPIECE, TURRET, VISION_SLIT } from '../src/sim/cabin.js';
import { DRIVER_CONTROLS } from '../src/sim/driver-station.js';
import {
  type CabinLook,
  cabinLook,
  HATCH_AMBIENT_SHARE,
  INTERIOR_AMBIENT,
  INTERIOR_LIGHTS,
  insideCabin,
  interiorLight,
  lookFor,
  parseHatches,
  turretToHull,
} from '../src/sim/interior.js';
import { Lever, type Vec3, Wheel } from '../src/sim/mechanism.js';
import { LENS } from '../src/sim/periscope.js';
import { ELEVATION_WHEEL, STATION, TRAVERSE_CRANK, TRUNNION } from '../src/sim/turret.js';
import { interiorUniforms, setCabinLook, setInteriorTurret } from '../src/scene-assets/cabin-light.js';
import { createGun, createHull, createTurret, HATCH_LID_NAMES } from '../src/scene-assets/cabin.scene-asset.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { type Object3D, Raycaster, Vector3 } from '@iwsdk/core';

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

  it("brings what the driver looks through within a short lean, the tillers in easy reach from the seat", () => {
    const [ex, ey, ez] = SEATS.driver.eye;
    // The slit 30 cm ahead (it was 80), the periscope's window 15 cm ahead and 26 cm to the right.
    expect(ez - VISION_SLIT.z).toBeCloseTo(0.3, 6);
    expect(Math.hypot(LENS[0] - ex, LENS[2] - ez)).toBeLessThan(0.32);
    // From the seat, without leaning, the tillers' handles are where seated hands rest with the elbows bent, at
    // either end of their travel: full forwards within a short reach of the shoulder (John's headset check).
    for (const id of ['tillerLeft', 'tillerRight'] as const) {
      const { spec } = DRIVER_CONTROLS[id];
      for (const angle of [spec.min, 0, spec.max]) {
        const h = tillerHandle(id, angle);
        const label = `${id} at ${(angle / DEG).toFixed(0)}°`;
        expect(ez - h[2], label).toBeGreaterThan(0.15);
        expect(ez - h[2], label).toBeLessThan(0.5);
        expect(ey - h[1], label).toBeGreaterThan(0.35);
        expect(ey - h[1], label).toBeLessThan(0.48);
        const shoulder: Vec3 = [ex + (h[0] < ex ? -0.18 : 0.18), ey - 0.2, ez + 0.05];
        expect(Math.hypot(h[0] - shoulder[0], h[1] - shoulder[1], h[2] - shoulder[2]), label).toBeLessThan(0.6);
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
  /** The look the lighting was first tuned in: both hatches open, the ambient and the lamps as set in src/sim/interior.ts. */
  const open: CabinLook = { driverHatch: true, gunnerHatch: true, ambient: 1, lamps: 1 };
  const lit = (p: number[], n = up, yaw = 0) => {
    const c = interiorLight(p, n, yaw, v3(), open);
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

  it('darkens the inside: dark away from the hatches and lamps, darkest low down, the pool under an open hatch standing out', () => {
    const rearFloor = lit([0.8, 0.02, 1.8]);
    const rearWall = lit([0, 1.2, HULL.rear], [0, 0, -1]);
    expect(rearFloor).toBeLessThan(rearWall);
    // About a tenth of the sky's light away from the pools (John's headset check: a quarter still read as bright).
    expect(rearWall).toBeLessThan(0.15);
    // The driver's seat cushion, under their hatch, is several times brighter than the rear of the hull.
    const cushion = SEATS.driver.cushion;
    expect(lit([...cushion])).toBeGreaterThan(4 * rearWall);
    // Nowhere inside is quite black, nor brighter than the sky outside (beyond a little right under an open hatch).
    for (const p of [[0, 0.02, -2.3], [-0.5, 1.7, -1.5], [0.9, 1.0, 0.5], [0.4, 2.7, -0.1], [0, 2.0, 1.0]]) {
      expect(lit(p)).toBeGreaterThan(0.03);
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
      // Right under the turret's dome lamp, wherever it has turned, is lit well above the ambient.
      const lamp = INTERIOR_LIGHTS.find((l) => l.id === 'turret-lamp')!;
      const ambient = (INTERIOR_AMBIENT[0] + INTERIOR_AMBIENT[1] + INTERIOR_AMBIENT[2]) / 3;
      expect(lit(turretToHull([lamp.at[0], lamp.at[1] - 0.2, lamp.at[2]], yaw, v3()), [0, 1, 0], yaw)).toBeGreaterThan(ambient + 0.15);
    }
    setInteriorTurret(0);
  });

  it("shuts the hatches, dims or brightens the cabin and the lamps as the menu asks (John's headset check, 2026-10-30)", () => {
    const look = (hatches: string, ambient = 1, lamps = 1): CabinLook =>
      lookFor(parseHatches(hatches), ambient, lamps, { driverHatch: true, gunnerHatch: true, ambient: 1, lamps: 1 });
    const at = (p: number[], l: CabinLook, n = up) => {
      const c = interiorLight(p, n, 0, v3(), l);
      return (c[0] + c[1] + c[2]) / 3;
    };
    const cushion = [...SEATS.driver.cushion];
    const gunnerCushion = turretToHull([...SEATS.gunner.cushion], 0, v3());
    const rearWall = [0, 1.2, HULL.rear];
    const back = [0, 0, -1];
    // Shutting the driver's hatch takes its pool away; the gunner's stays.
    expect(at(cushion, look('gunner'))).toBeLessThan(at(cushion, look('both')) / 3);
    expect(at(gunnerCushion, look('gunner'))).toBeGreaterThan(0.8 * at(gunnerCushion, look('both')));
    // Each shut hatch takes its share of the ambient too.
    expect(at(rearWall, look('none'), back) / at(rearWall, look('both'), back)).toBeLessThan(1 - HATCH_AMBIENT_SHARE);
    // The cabin light scales the ambient; the lamps only the pools under them.
    const lamp = INTERIOR_LIGHTS.find((l) => l.id === 'hull-lamp')!;
    const underLamp = [lamp.at[0], lamp.at[1] - 0.3, lamp.at[2]];
    expect(at(rearWall, look('both', 2), back)).toBeGreaterThan(1.5 * at(rearWall, look('both'), back));
    expect(at(underLamp, look('both', 1, 0))).toBeLessThan(at(underLamp, look('both', 1, 2)) / 3);
    expect(parseHatches('nonsense')).toBe('both');
    // The shader's uniforms follow, and the defaults put them back.
    setCabinLook(look('none', 0.5, 0));
    INTERIOR_LIGHTS.forEach((light, i) => {
      const off = light.id !== 'slit';
      expect(interiorUniforms.cabinLightColor.value[i].x === 0, light.id).toBe(off);
    });
    expect(interiorUniforms.cabinAmbient.value.x).toBeCloseTo(INTERIOR_AMBIENT[0] * 0.5 * (1 - 2 * HATCH_AMBIENT_SHARE), 6);
    setCabinLook(look('both'));
    expect(cabinLook).toEqual(open);
    expect(interiorUniforms.cabinAmbient.value.x).toBeCloseTo(INTERIOR_AMBIENT[0], 6);
    setCabinLook(lookFor(DEFAULT_SETTINGS.hatches, DEFAULT_SETTINGS.cabin, DEFAULT_SETTINGS.lamps, look('both')));
  });

  it("starts in the look John picked at his headset check of 2026-10-31: both hatches shut, the darkest cabin light then, the lamps normal", () => {
    expect([DEFAULT_SETTINGS.hatches, DEFAULT_SETTINGS.cabin, DEFAULT_SETTINGS.lamps]).toEqual(['none', 0.5, 1]);
    expect(lookFor(DEFAULT_SETTINGS.hatches, DEFAULT_SETTINGS.cabin, DEFAULT_SETTINGS.lamps, { ...open })).toEqual({ driverHatch: false, gunnerHatch: false, ambient: 0.5, lamps: 1 });
  });

  it("lights the gunner's controls with a lamp of their own, ahead and right of their head and clear of their hatch", () => {
    const lamp = INTERIOR_LIGHTS.find((l) => l.id === 'gunner-lamp')!;
    expect(lamp.frame).toBe('turret');
    const g = SEATS.gunner;
    // Clear of the gunner's hatch (radius 27 cm round its middle, 10 cm behind the eyes) and above the highest the eyes go.
    expect(Math.hypot(lamp.at[0] - g.eye[0], lamp.at[2] - (g.eye[2] + 0.1))).toBeGreaterThan(0.27 + 0.1);
    expect(lamp.at[1]).toBeGreaterThan(g.eye[1] + g.headUp);
    // With the hatches shut and the cabin at its default, the lamps more than double the light on the elevation wheel's
    // and the crank's hubs (the turret's other lamp, behind the gun, is over 1.4 m from them).
    const turretLamp = INTERIOR_LIGHTS.find((l) => l.id === 'turret-lamp')!;
    const shut = (lamps: number): CabinLook => ({ driverHatch: false, gunnerHatch: false, ambient: 0.5, lamps });
    for (const key of ['elevation', 'crank'] as const) {
      const at = STATION[key].at;
      expect(Math.hypot(at[0] - turretLamp.at[0], at[1] - turretLamp.at[1], at[2] - turretLamp.at[2]), key).toBeGreaterThan(1.4);
      const hub = turretToHull([...at], 0, v3());
      expect(interiorLight(hub, up, 0, v3(), shut(1))[0], key).toBeGreaterThan(2 * interiorLight(hub, up, 0, v3(), shut(0))[0]);
    }
  });

  it("draws each hatch's lid open by default and has a shut one ready in the hole", () => {
    for (const [hatch, root] of [['driver', createHull()], ['gunner', createTurret()]] as const) {
      const names = HATCH_LID_NAMES[hatch];
      expect(root.getObjectByName(names.open)?.visible, names.open).toBe(true);
      expect(root.getObjectByName(names.closed)?.visible, names.closed).toBe(false);
    }
  });

  it('keeps the lamps warm and the daylight cool', () => {
    for (const l of INTERIOR_LIGHTS) {
      const [r, , b] = l.color;
      if (l.id.endsWith('lamp')) expect(r).toBeGreaterThan(b);
      else expect(b).toBeGreaterThan(r);
    }
  });
});

describe("the turret's foot (John's headset check, 2026-10-30)", () => {
  it('closes the floor under the turret wherever it turns: no ground seen past the hull roof where its corners overhang', () => {
    const hull = createHull();
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const inner = TURRET.halfWidth - HULL.wall - 0.03;
    for (const yaw of [0, 0.05, 0.3, Math.PI / 4, 1.2, -0.7, Math.PI]) {
      const turret = createTurret();
      turret.position.set(0, 0, TURRET.z);
      turret.rotation.y = yaw;
      turret.updateMatrixWorld(true);
      hull.updateMatrixWorld(true);
      for (const x of [-1, -0.5, 0, 0.5, 1].map((k) => k * inner)) {
        for (const z of [-1, -0.5, 0, 0.5, 1].map((k) => k * inner)) {
          if (Math.hypot(x, z) < TURRET.ringRadius + 0.1) continue;
          const from = turretToHull([x, TURRET.roof - 0.2, z], yaw, v3());
          ray.set(new Vector3(...from), down);
          const hit = ray.intersectObjects([hull, turret], true)[0];
          expect(hit?.point.y ?? -Infinity, `turret at ${yaw.toFixed(2)} rad, (${x.toFixed(2)}, ${z.toFixed(2)}) in turret space`).toBeGreaterThan(HULL.roof);
        }
      }
    }
  });
});

describe("the head boxes against the cabin's meshes (John's headset check, 2026-10-31)", () => {
  // Rays out from a point in every direction: its distance to the nearest drawn face.
  const dirs: Vector3[] = [];
  for (let i = 0, n = 200; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const t = i * Math.PI * (3 - Math.sqrt(5));
    dirs.push(new Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
  }
  const ray = new Raycaster();
  ray.far = 0.5;
  const shown = (o: Object3D | null): boolean => o === null || (o.visible && shown(o.parent));
  const hull = createHull();
  const turret = createTurret();
  turret.position.set(0, 0, TURRET.z);
  const gun = createGun();
  gun.position.set(0, TRUNNION.y, TRUNNION.z);
  turret.add(gun);
  // The hatches shut, for the roof.
  for (const [hatch, root] of [['driver', hull], ['gunner', turret]] as const) {
    root.getObjectByName(HATCH_LID_NAMES[hatch].open)!.visible = false;
    root.getObjectByName(HATCH_LID_NAMES[hatch].closed)!.visible = true;
  }
  hull.updateMatrixWorld(true);
  turret.updateMatrixWorld(true);
  const clearance = (p: Vec3): number => {
    let best = Infinity;
    for (const d of dirs) {
      ray.set(new Vector3(...p), d);
      const hit = ray.intersectObjects([hull, turret], true).find((h) => shown(h.object));
      if (hit) best = Math.min(best, hit.distance);
    }
    return best;
  };
  /** A point offset from a seat's eye point in its frame, in hull space (the turret facing forward). */
  const at = (id: 'driver' | 'gunner', dx: number, dy: number, dz: number): Vec3 =>
    seatToHull(SEATS[id], 0, [SEATS[id].eye[0] + dx, SEATS[id].eye[1] + dy, SEATS[id].eye[2] + dz], v3()) as Vec3;

  it('keeps the eyes EYE_CLEARANCE from every wall, the hood and the roof all along each box\'s edges, with the periscope and the gunsight left out', () => {
    for (const id of ['driver', 'gunner'] as const) {
      const [left, right, forward, back] = SEATS[id].headBox;
      for (let k = 0; k <= 4; k++) {
        const x = -left + ((left + right) * k) / 4;
        const z = -forward + ((forward + back) * k) / 4;
        for (const p of [at(id, x, 0, -forward), at(id, x, 0, back), at(id, -left, 0, z), at(id, right, 0, z), at(id, 0, SEATS[id].headUp, 0)]) {
          expect(clearance(p), `${id} at ${p.map((v) => v.toFixed(2))}`).toBeGreaterThan(EYE_CLEARANCE - 0.01);
        }
      }
    }
  });

  it('starts the fade only as the eyes come up to a wall, the hood or the roof, not before', () => {
    // Straight out from the eye point to each edge with something there, the eyes are then about EYE_CLEARANCE from it.
    const edges: [string, Vec3][] = [
      ['driver left wall', at('driver', -SEATS.driver.headBox[0], 0, 0)],
      ['driver hood', at('driver', 0, 0, -SEATS.driver.headBox[2])],
      ['driver roof', at('driver', 0, SEATS.driver.headUp, 0)],
      ['gunner wall', at('gunner', SEATS.gunner.headBox[1], 0, 0)],
      ['gunner roof', at('gunner', 0, SEATS.gunner.headUp, 0)],
    ];
    for (const [name, p] of edges) expect(clearance(p), name).toBeLessThan(EYE_CLEARANCE + 0.015);
    // Where nothing stands in the way, OPEN_LEAN.
    expect([SEATS.driver.headBox[1], SEATS.driver.headBox[3], SEATS.gunner.headBox[0], SEATS.gunner.headBox[3]]).toEqual([OPEN_LEAN, OPEN_LEAN, OPEN_LEAN, OPEN_LEAN]);
  });
});
