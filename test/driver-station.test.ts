import { describe, expect, it } from 'vitest';
import { rigOffset, targetEyeHeight } from '../src/sim/body-height.js';
import { frontAt, HULL, SEATS, VISION_SLIT } from '../src/sim/cabin.js';
import {
  DIALS,
  dialCentre,
  dialValue,
  DRIVER_CONTROL_IDS,
  DRIVER_CONTROLS,
  DRIVER_TILLER,
  GEAR_ANGLES,
  GEAR_LEVER,
  GEARBOX,
  gearOfLever,
  HAND_THROTTLE,
  needleAngle,
  PANEL,
  panelToHull,
  SLIT_FRAME,
  throttleAngle,
  throttleOf,
  tillerAngle,
  TILLER_PEDESTAL,
  TOP_ROW,
} from '../src/sim/driver-station.js';
import { type HandInput, Lever, type Vec3 } from '../src/sim/mechanism.js';
import {
  COOLANT_FULL,
  COOLANT_IDLE,
  COOLANT_START,
  createControls,
  createTankDrive,
  FUEL_RESERVE,
  HIGH,
  IDLE_RPM,
  LOW,
  MAX_RPM,
  NEUTRAL,
  oilPressure,
  stepDrive,
  stepEngineGauges,
} from '../src/sim/tank-drive.js';

const DEG = Math.PI / 180;
const DT = 1 / 90;
const EYE = SEATS.driver.eye;

/** A controller hand at lever angle `deg`, `r` from the pivot, in lever space. */
function leverHand(deg: number, r: number): HandInput {
  return { fist: [0, r * Math.cos(deg * DEG), -r * Math.sin(deg * DEG)], across: [1, 0, 0], tip: null, trigger: 0, tracked: false };
}

/** A control's handle middle in hull space with the lever at `angle`. */
function handleAt(id: (typeof DRIVER_CONTROL_IDS)[number], angle: number): Vec3 {
  const { spec, pivot } = DRIVER_CONTROLS[id];
  const lever = new Lever(spec);
  lever.angle = angle;
  const p = lever.handle(1, [0, 0, 0]);
  return [pivot[0] + p[0], pivot[1] + p[1], pivot[2] + p[2]];
}

describe('the driver\'s controls (F1.5)', () => {
  it('puts every handle in reach from a chair, between knee and chest height, at either end of its travel', () => {
    // As test/body-height.test.ts: a seated player's hands reach from about
    // 0.45 m to 1.4 m above their real floor, which the seat system puts on the hull floor.
    const raised = rigOffset(targetEyeHeight({ raise: 0, seated: true }), 1.2);
    for (const id of DRIVER_CONTROL_IDS) {
      const { spec } = DRIVER_CONTROLS[id];
      for (const angle of [spec.min, spec.rest, spec.max]) {
        const [x, y, z] = handleAt(id, angle);
        const label = `${id} at ${(angle / DEG).toFixed(0)}°`;
        expect(y - raised, label).toBeGreaterThan(0.45);
        expect(y - raised, label).toBeLessThan(1.4);
        // Ahead of the chest (the gear lever and throttle are beside the knees) and within an arm's length of
        // the nearer shoulder (20 cm under the eyes, 18 cm to the side): spike S3's tillers at their front stop are 73 cm.
        expect(EYE[2] - z, label).toBeGreaterThan(0.18);
        expect(EYE[2] - z, label).toBeLessThan(0.65);
        const shoulder = EYE[0] + (x < EYE[0] ? -0.18 : 0.18);
        expect(Math.hypot(x - shoulder, y - (EYE[1] - 0.2), z - EYE[2]), label).toBeLessThan(0.75);
        // Inside the hull, clear of its walls.
        expect(Math.abs(x), label).toBeLessThan(HULL.halfWidth - 0.05);
      }
    }
  });

  it('keeps each handle further from the others than a hand reaches, so a squeeze takes the one meant', () => {
    for (let i = 0; i < DRIVER_CONTROL_IDS.length; i++) {
      for (let j = i + 1; j < DRIVER_CONTROL_IDS.length; j++) {
        const a = DRIVER_CONTROL_IDS[i];
        const b = DRIVER_CONTROL_IDS[j];
        for (const ta of [DRIVER_CONTROLS[a].spec.min, 0, DRIVER_CONTROLS[a].spec.max]) {
          for (const tb of [DRIVER_CONTROLS[b].spec.min, 0, DRIVER_CONTROLS[b].spec.max]) {
            const p = handleAt(a, ta);
            const q = handleAt(b, tb);
            expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), `${a} to ${b}`).toBeGreaterThan(0.15);
          }
        }
      }
    }
  });

  it('stands the tillers outside the driver\'s knees, and the gear lever on the gearbox\'s hump', () => {
    // The crewmate's drawn shins and boots, by the pedestals, are 10 cm either side of the seat's middle, under 6 cm thick (avatar.scene-asset.ts).
    const legOuter = 0.1 + 0.06;
    for (const id of ['tillerLeft', 'tillerRight'] as const) {
      const x = DRIVER_CONTROLS[id].pivot[0];
      expect(Math.abs(x - SEATS.driver.cushion[0]) - TILLER_PEDESTAL.halfWidth).toBeGreaterThan(legOuter);
    }
    const right = DRIVER_CONTROLS.tillerRight.pivot[0] + TILLER_PEDESTAL.halfWidth;
    expect(right).toBeLessThan(GEARBOX.x0);
    const [gx, gy, gz] = DRIVER_CONTROLS.gear.pivot;
    expect(gx).toBeGreaterThan(GEARBOX.x0);
    expect(gy).toBe(GEARBOX.top);
    expect(gz).toBeGreaterThan(GEARBOX.z0);
    expect(gz).toBeLessThan(GEARBOX.z1);
  });

  it('reads the tillers as the drive\'s demand and draws a demand back on them', () => {
    const lever = new Lever(DRIVER_TILLER);
    for (const demand of [-1, -0.5, -0.1, 0, 0.3, 1]) {
      lever.angle = tillerAngle(demand);
      expect(lever.demand()).toBeCloseTo(demand, 6);
    }
    expect(tillerAngle(1)).toBeCloseTo(DRIVER_TILLER.max, 6);
    expect(tillerAngle(-1)).toBeCloseTo(DRIVER_TILLER.min, 6);
    expect(tillerAngle(5)).toBeCloseTo(DRIVER_TILLER.max, 6);
  });

  it('puts the gear lever in a gear only near that gear\'s notch: back low, upright neutral, forwards high', () => {
    expect(gearOfLever(GEAR_ANGLES[LOW])).toBe(LOW);
    expect(gearOfLever(GEAR_ANGLES[NEUTRAL])).toBe(NEUTRAL);
    expect(gearOfLever(GEAR_ANGLES[HIGH])).toBe(HIGH);
    expect(GEAR_ANGLES[LOW]).toBeLessThan(0);
    expect(GEAR_ANGLES[HIGH]).toBeGreaterThan(0);
    // Between notches it is out of gear.
    expect(gearOfLever(-12 * DEG)).toBe(NEUTRAL);
    expect(gearOfLever(13 * DEG)).toBe(NEUTRAL);
    expect(gearOfLever(GEAR_LEVER.max)).toBe(HIGH);
    expect(gearOfLever(GEAR_LEVER.min)).toBe(LOW);
    for (const gear of [NEUTRAL, LOW, HIGH] as const) expect(GEAR_LEVER.notches).toContain(GEAR_ANGLES[gear]);
  });

  it('shifts from low to high by hand through neutral, and drops into high when let go near it', () => {
    const lever = new Lever(GEAR_LEVER);
    lever.angle = GEAR_ANGLES[LOW];
    const r = GEAR_LEVER.length - GEAR_LEVER.gripLength / 2;
    expect(lever.grab(1, leverHand(-24, r))).toBe(true);
    const seen = new Set<number>();
    for (let deg = -24; deg <= 18; deg += 0.5) {
      lever.update(DT, [null, leverHand(deg, r)]);
      seen.add(gearOfLever(lever.angle));
    }
    expect([...seen]).toEqual([LOW, NEUTRAL, HIGH]);
    lever.release(1);
    for (let i = 0; i < 90; i++) lever.update(DT, [null, null]);
    expect(lever.angle).toBeCloseTo(GEAR_ANGLES[HIGH], 3);
    expect(gearOfLever(lever.angle)).toBe(HIGH);
  });

  it('keeps the hand throttle where it is left, idle upright and full forwards', () => {
    const lever = new Lever(HAND_THROTTLE);
    expect(throttleOf(lever.angle)).toBe(0);
    lever.angle = 30 * DEG;
    for (let i = 0; i < 90; i++) lever.update(DT, [null, null]);
    expect(lever.angle).toBeCloseTo(30 * DEG, 6);
    expect(throttleOf(lever.angle)).toBeCloseTo(0.75, 6);
    expect(throttleOf(HAND_THROTTLE.max)).toBe(1);
    expect(throttleAngle(0.75)).toBeCloseTo(30 * DEG, 6);
    expect(throttleAngle(2)).toBe(HAND_THROTTLE.max);
  });

  it('raises the idle with the hand throttle', () => {
    const idle = createTankDrive();
    const raised = createTankDrive();
    const c = createControls();
    const t = { ...createControls(), throttle: 1 };
    for (let i = 0; i < 360; i++) {
      stepDrive(idle, c, DT);
      stepDrive(raised, t, DT);
    }
    expect(idle.rpm).toBeCloseTo(IDLE_RPM, 0);
    expect(raised.rpm).toBeGreaterThan(1500);
    expect(raised.speed).toBe(0);
  });
});

describe('the driver\'s gauges (F1.5)', () => {
  it('sweeps each needle from the bottom left to the bottom right, pinned at its ends', () => {
    for (const dial of DIALS) {
      expect(needleAngle(dial, dial.min)).toBeCloseTo(-135 * DEG, 6);
      expect(needleAngle(dial, dial.max)).toBeCloseTo(135 * DEG, 6);
      expect(needleAngle(dial, (dial.min + dial.max) / 2)).toBeCloseTo(0, 6);
      expect(needleAngle(dial, dial.max * 10)).toBeCloseTo(135 * DEG, 6);
      const mid = dial.min + 0.3 * (dial.max - dial.min);
      expect(dialValue(dial, needleAngle(dial, mid))).toBeCloseTo(mid, 6);
    }
  });

  it('covers what the tank can show on each dial', () => {
    const range = (id: string) => DIALS.find((d) => d.id === id)!;
    expect(range('speed').max).toBeGreaterThanOrEqual(35);
    expect(range('rpm').max).toBeGreaterThanOrEqual(MAX_RPM);
    expect(range('coolant').min).toBeLessThanOrEqual(COOLANT_START);
    expect(range('coolant').max).toBeGreaterThan(COOLANT_FULL);
    expect(range('oil').max).toBeGreaterThanOrEqual(oilPressure(MAX_RPM, COOLANT_START));
  });

  it("puts the instrument box on the left wall by the knee, as the M4A4's, inside the armour and clear of the head and the throttle", () => {
    const corners: Vec3[] = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const z of [0, -0.06]) corners.push(panelToHull([(sx * (PANEL.width + 0.03)) / 2, (sy * (PANEL.height + 0.03)) / 2, z], [0, 0, 0]));
      }
    }
    const [left, , forward, back] = SEATS.driver.headBox;
    for (const c of corners) {
      // Inside the side wall (the box's back may sink into it) and behind the hood and glacis.
      expect(c[0]).toBeGreaterThan(-HULL.halfWidth - HULL.wall / 2);
      expect(c[2]).toBeGreaterThan(frontAt(c[1]) + 0.01);
      // Left of and below the eyes; what is within 25 cm under them, a head's half-width clear of where the head can go.
      expect(c[0]).toBeLessThan(EYE[0] - left);
      if (EYE[1] - c[1] < 0.25) expect(c[0]).toBeLessThan(EYE[0] - left - 0.08);
      expect(c[1]).toBeLessThan(EYE[1] - 0.12);
      expect(c[2]).toBeLessThan(EYE[2] + back);
      expect(c[2]).toBeGreaterThan(EYE[2] - forward - 0.3);
    }
    // Over the hand throttle's handle, with a fist's room, wherever it stands.
    for (const angle of [HAND_THROTTLE.min, HAND_THROTTLE.max]) {
      const h = handleAt('throttle', angle);
      const lowest = Math.min(...corners.filter((c) => Math.abs(c[2] - h[2]) < 0.15).map((c) => c[1]));
      expect(lowest - h[1], `the throttle at ${(angle / DEG).toFixed(0)}°`).toBeGreaterThan(0.1);
    }
    // Its face turned towards the eyes: the eyes are in front of it.
    const middle = panelToHull([0, 0, 0], [0, 0, 0]);
    const out = panelToHull([0, 0, 1], [0, 0, 0]);
    const normal = [out[0] - middle[0], out[1] - middle[1], out[2] - middle[2]];
    const toEye = [EYE[0] - middle[0], EYE[1] - middle[1], EYE[2] - middle[2]];
    const len = Math.hypot(...toEye);
    expect((normal[0] * toEye[0] + normal[1] * toEye[1] + normal[2] * toEye[2]) / len).toBeGreaterThan(0.9);
    const at: [number, number] = [0, 0];
    // Each dial, and the gear plate in the bottom row's third place, on the face and apart.
    const places: [number, number][] = [];
    for (let i = 0; i < DIALS.length + 1; i++) {
      dialCentre(i === DIALS.length ? TOP_ROW + 2 : i, at);
      expect(Math.abs(at[0]) + PANEL.dialRadius).toBeLessThan(PANEL.width / 2);
      expect(Math.abs(at[1]) + PANEL.dialRadius).toBeLessThan(PANEL.height / 2);
      for (const p of places) expect(Math.hypot(at[0] - p[0], at[1] - p[1])).toBeGreaterThan(2 * PANEL.dialRadius + 0.005);
      places.push([at[0], at[1]]);
    }
  });

  it('can be read past the tillers and the gear lever from the seat', () => {
    // The sight line from the eye point to the bottom of each dial passes over every handle's top.
    const at: [number, number] = [0, 0];
    for (let i = 0; i < DIALS.length; i++) {
      dialCentre(i, at);
      const dial = panelToHull([at[0], at[1] - PANEL.dialRadius, 0], [0, 0, 0]);
      for (const id of DRIVER_CONTROL_IDS) {
        const { spec, pivot } = DRIVER_CONTROLS[id];
        for (const angle of [spec.min, 0, spec.max]) {
          const topZ = pivot[2] - spec.length * Math.sin(angle);
          const topY = pivot[1] + spec.length * Math.cos(angle);
          const t = (topZ - EYE[2]) / (dial[2] - EYE[2]);
          if (t <= 0 || t >= 1) continue;
          expect(EYE[1] + t * (dial[1] - EYE[1]), `${id} under dial ${i}`).toBeGreaterThan(topY + 0.03);
        }
      }
    }
  });

  it('warms the coolant slowly with the revs and burns fuel, never running dry', () => {
    const s = createTankDrive();
    expect(s.coolant).toBe(COOLANT_START);
    expect(s.fuel).toBe(1);
    stepEngineGauges(s, 10);
    expect(s.coolant).toBeGreaterThan(COOLANT_START);
    expect(s.coolant).toBeLessThan(COOLANT_START + 2);
    for (let i = 0; i < 3600; i++) stepEngineGauges(s, 1);
    expect(s.coolant).toBeCloseTo(COOLANT_IDLE, 0);
    s.rpm = MAX_RPM;
    const before = s.fuel;
    for (let i = 0; i < 3600; i++) stepEngineGauges(s, 1);
    expect(s.coolant).toBeCloseTo(COOLANT_FULL, 0);
    expect(before - s.fuel).toBeCloseTo(0.5, 1);
    for (let i = 0; i < 36000; i++) stepEngineGauges(s, 1);
    expect(s.fuel).toBe(FUEL_RESERVE);
  });

  it('gives an oil pressure that rises with the revs', () => {
    expect(oilPressure(IDLE_RPM, COOLANT_IDLE)).toBeCloseTo(1.5, 6);
    expect(oilPressure(MAX_RPM, COOLANT_IDLE)).toBeCloseTo(5, 6);
    expect(oilPressure(MAX_RPM, COOLANT_FULL)).toBeLessThan(5);
  });
});

describe('the vision slit (F1.5)', () => {
  it('keeps its frame off the opening and its brow pad just out of the head\'s reach', () => {
    const f = SLIT_FRAME;
    expect(f.inset).toBeGreaterThan(0.008);
    // The furthest forwards the eyes go (the head box), and the forehead about 9 cm ahead of them.
    const eyes = EYE[2] - SEATS.driver.headBox[2];
    const padFace = VISION_SLIT.z + f.padDepth;
    expect(eyes - 0.09).toBeGreaterThan(padFace);
    // In the hood, 30 cm ahead (docs/interior.md): about 60° across from the seat, so the driver sees out
    // with their hands on the tillers, and 80° leant in.
    const across = (z: number) => (2 * Math.atan(VISION_SLIT.width / 2 / (z - VISION_SLIT.z))) / DEG;
    expect(EYE[2] - VISION_SLIT.z).toBeLessThan(0.32);
    expect(across(EYE[2])).toBeGreaterThan(55);
    expect(across(eyes)).toBeGreaterThan(75);
    // The pad's underside at the brow, above the eyes.
    const padBottom = VISION_SLIT.y + VISION_SLIT.height / 2 + f.padAbove;
    expect(padBottom - EYE[1]).toBeGreaterThan(0.04);
    expect(padBottom - EYE[1]).toBeLessThan(0.12);
  });
});
