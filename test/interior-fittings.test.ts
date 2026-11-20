import { describe, expect, it } from 'vitest';
import { GUN, HULL, SEATS, TURRET, TURRET_RING } from '../src/sim/cabin.js';
import { BRAKE_POST, DRIVER_CONTROLS, GEAR_LEVER, GEARBOX, TILLER_PEDESTAL } from '../src/sim/driver-station.js';
import {
  BASKET_SKIRT,
  BASKET_SWEEP,
  BRAKE_DRUMS,
  BREATHER,
  CLUTCH_MASTER,
  CLUTCH_PUSH_ROD,
  clutchPoint,
  COAX,
  DIFFERENTIAL,
  FOOT_PLATE,
  HULL_BIN,
  HULL_RACK,
  PEDAL_BOX,
  pedalAngle,
  PEDALS,
  pedalTurn,
  PROPELLER_SHAFT,
  RECOIL_CYLINDERS,
  RECOIL_GUARD,
  TRANSMISSION,
  TRAVERSE_GEARBOX,
  TRAVERSE_MOTOR,
} from '../src/sim/interior-fittings.js';
import { CASING_BIN, LEVER_HANDLE_X, LEVER_PIVOT, RECOIL, SHELL_RADIUS } from '../src/sim/loading.js';
import { ELEVATING_GEAR, STATION, TRAVERSE_CRANK } from '../src/sim/turret.js';
import { BOARDS } from '../src/sim/crew-board.js';
import { FINISH, INTERIOR_COLORS, interiorFinish } from '../src/scene-assets/finish.js';
import { mergeParts } from '../src/scene-assets/lowpoly.js';
import { BoxGeometry } from '@iwsdk/core';

/** A hand closed on a handle reaches about this far round it, m. */
const FIST = 0.05;

describe("the compartment's fittings (docs/interior.md, the fifth pass)", () => {
  it('keeps the drive train clear of the gear lever and the steering levers at their furthest', () => {
    // The gear lever's top at its furthest forward, a fist round it, still behind the differential's ribs and boss and the breather pipe.
    const [, py, pz] = DRIVER_CONTROLS.gear.pivot;
    const forward = GEAR_LEVER.max;
    const topZ = pz - Math.sin(forward) * GEAR_LEVER.length;
    expect(topZ - FIST).toBeGreaterThan(DIFFERENTIAL.back + 0.04);
    expect(topZ - FIST).toBeGreaterThan(BREATHER.z + BREATHER.radius);
    // Where the lever passes the boss's height, it is well behind the boss and its nut.
    const atBoss = pz - Math.tan(forward) * (DIFFERENTIAL.y - py);
    expect(atBoss).toBeGreaterThan(DIFFERENTIAL.back + 0.08);
    // The gear lever stands on the case's flat top.
    expect(Math.abs(DRIVER_CONTROLS.gear.pivot[0] - TRANSMISSION.x)).toBeLessThan(TRANSMISSION.topHalfWidth - 0.04);
    expect(TRANSMISSION.flangeZ - 0.03).toBeGreaterThan(pz + 0.1);
    // The steering levers' pedestals are beside the case, not in it.
    const right = DRIVER_CONTROLS.tillerRight.pivot[0] + TILLER_PEDESTAL.halfWidth;
    expect(GEARBOX.x0 - right).toBeGreaterThan(0.03);
  });

  it('puts the pedals under the steering levers, clear of their pedestals, the brake drums and the parking brake', () => {
    for (const [pedal, tiller] of [
      [PEDALS.clutch, DRIVER_CONTROLS.tillerLeft],
      [PEDALS.accelerator, DRIVER_CONTROLS.tillerRight],
    ] as const) {
      expect(Math.abs(pedal.x - tiller.pivot[0])).toBeLessThan(0.15);
      expect(Math.abs(pedal.x - tiller.pivot[0]) - pedal.width / 2 - TILLER_PEDESTAL.halfWidth).toBeGreaterThan(0.01);
      expect(pedal.x - pedal.width / 2).toBeGreaterThan(FOOT_PLATE.x0);
      expect(pedal.x + pedal.width / 2).toBeLessThan(FOOT_PLATE.x1);
    }
    expect(BRAKE_DRUMS.left[0] - (PEDALS.accelerator.x + PEDALS.accelerator.width / 2)).toBeGreaterThan(0.02);
    expect(FOOT_PLATE.x0).toBeGreaterThan(DRIVER_CONTROLS.brake.pivot[0] + BRAKE_POST.halfWidth);
    // The plate stops short of the pedestals and the transmission.
    expect(FOOT_PLATE.z1).toBeLessThan(DRIVER_CONTROLS.tillerLeft.pivot[2] - TILLER_PEDESTAL.depth / 2);
    expect(FOOT_PLATE.x1).toBeLessThan(GEARBOX.x0);
  });

  it("faces the pedals' pads at the driver and moves them as a car's pedals move (John's headset notes, 20 November 2026)", () => {
    const c = PEDALS.clutch;
    const a = PEDALS.accelerator;
    expect(pedalAngle('clutch', -1)).toBe(0);
    expect(pedalAngle('clutch', 2)).toBe(c.travel);
    const pad: [number, number] = [0, 0];
    const at = (press: number) => clutchPoint(c.pad, pedalTurn('clutch', press), [0, 0]);
    for (const press of [0, 0.5, 1]) {
      // The clutch hangs from its pivot: the pad on the arm's end, turned with it; its face's normal points back at the driver (+Z) and not down.
      const turn = pedalTurn('clutch', press);
      const tilt = c.padTilt + turn;
      expect(Math.sin(tilt)).toBeGreaterThan(0.6);
      expect(Math.cos(tilt)).toBeGreaterThan(-0.2);
      clutchPoint(c.pad, turn, pad);
      // Within a seated foot's reach, in front of the steering levers' pedestals, behind the nose plate and over the foot plate.
      expect(pad[1]).toBeLessThan(DRIVER_CONTROLS.tillerLeft.pivot[2] - TILLER_PEDESTAL.depth / 2 - 0.1);
      expect(pad[1] - c.length / 2).toBeGreaterThan(HULL.front + 0.04);
      expect(pad[0]).toBeGreaterThan(0.12);
      expect(pad[0]).toBeLessThan(0.3);
      // The arm and knee stay behind the master cylinder's end and the nose plate.
      const knee = clutchPoint(c.knee, turn, [0, 0]);
      expect(knee[1]).toBeGreaterThan(HULL.front + 0.02);
      const underCylinder = clutchPoint([-(c.clevis + CLUTCH_MASTER.radius), 0], turn, [0, 0]);
      expect(underCylinder[1] - 0.012).toBeGreaterThan(CLUTCH_MASTER.back + 0.005);
      // The accelerator: rising from its heel, its toe forwards and its face up and back.
      const ta = pedalAngle('accelerator', press);
      const rise = a.rise - ta;
      expect(rise).toBeGreaterThan(0.2);
      const toeY = a.pivot[0] + Math.sin(rise) * a.length;
      expect(toeY).toBeGreaterThan(FOOT_PLATE.top + 0.04);
      expect(a.pivot[1] - Math.cos(rise) * a.length).toBeGreaterThan(HULL.front + 0.05);
    }
    // Pressed, the clutch's pad swings forwards over 12 cm, as a car's, and drops a little, never rising.
    const up = at(0);
    const down = at(1);
    expect(up[1] - down[1]).toBeGreaterThan(0.12);
    expect(down[0]).toBeLessThanOrEqual(up[0]);
    expect(up[0] - down[0]).toBeLessThan(0.04);
    // Its pivot is in the pedal box on the nose plate, between the cheeks, over the master cylinder; the push rod stays in the cylinder.
    expect(c.pivot[0]).toBeGreaterThan(PEDAL_BOX.bottom);
    expect(c.pivot[0]).toBeLessThan(PEDAL_BOX.top);
    expect(c.pivot[1]).toBeGreaterThan(HULL.front);
    expect(c.pivot[1]).toBeLessThan(PEDAL_BOX.back);
    expect(PEDAL_BOX.bottom).toBeGreaterThanOrEqual(c.pivot[0] - c.clevis + CLUTCH_MASTER.radius - 0.003);
    const clevis = clutchPoint([-c.clevis, 0], pedalTurn('clutch', 1), [0, 0]);
    expect(Math.abs(clevis[0] - (c.pivot[0] - c.clevis))).toBeLessThan(CLUTCH_MASTER.radius - CLUTCH_MASTER.rod);
    for (const press of [0, 1]) {
      const pin = clutchPoint([-c.clevis, 0], pedalTurn('clutch', press), [0, 0]);
      const end = pin[1] - CLUTCH_PUSH_ROD.from - CLUTCH_PUSH_ROD.length;
      expect(end).toBeLessThan(CLUTCH_MASTER.back - 0.01);
      expect(end).toBeGreaterThan(HULL.front + 0.012);
    }
    expect(Math.sin(a.rise - a.travel)).toBeLessThan(Math.sin(a.rise));
    // John's notes (20 November 2026): more range, starting higher off the floor, and going a little lower pressed (11.5°, 18° before).
    expect(a.rise).toBeGreaterThanOrEqual(0.75);
    expect(a.rise - a.travel).toBeCloseTo(0.2, 2);
    // The accelerator stands on the foot plate.
    expect(a.pivot[1]).toBeGreaterThan(FOOT_PLATE.z0);
    expect(a.pivot[1]).toBeLessThan(FOOT_PLATE.z1);
  });

  it('runs the propeller shaft from the transmission to the bulkhead under the basket', () => {
    expect(PROPELLER_SHAFT.from).toBeLessThanOrEqual(GEARBOX.z1);
    expect(PROPELLER_SHAFT.to).toBeGreaterThan(HULL.rear);
    expect(PROPELLER_SHAFT.y + PROPELLER_SHAFT.radius + 0.035).toBeLessThan(TURRET.basketFloor - 0.1);
  });

  it("keeps the hull's racks outside the basket's sweep, the posts, rail, skirt and power grip's pedestal", () => {
    // The rounds' primers stand 3 cm out of the rack's face; the bin's front with its handles 2 cm.
    expect(HULL_RACK.x - 0.031).toBeGreaterThan(BASKET_SWEEP);
    expect(-HULL_BIN.x - 0.02).toBeGreaterThan(BASKET_SWEEP);
    expect(BASKET_SKIRT.radius + BASKET_SKIRT.thickness + 0.01).toBeLessThan(BASKET_SWEEP);
    const grip = STATION.twist.at;
    expect(Math.hypot(grip[0], grip[2]) + 0.042).toBeLessThan(BASKET_SWEEP);
    // Under the hull roof, and above the sponson's floor line inside.
    for (const r of [HULL_RACK, HULL_BIN]) expect(r.y1 + 0.03).toBeLessThan(HULL.roof - 0.1);
  });

  it("keeps the recoil cylinders over the breech, the rods in them at full recoil, the guard clear of the lever and the casings' fall", () => {
    const r = RECOIL_CYLINDERS;
    expect(r.y - r.radius).toBeGreaterThan(GUN.breechHalfHeight + 0.005);
    // Recoiled, the rods' front ends are still inside the cylinders.
    expect(r.rodFront).toBeLessThan(r.front);
    expect(r.rodFront + RECOIL.length).toBeLessThan(r.back - 0.02);
    const g = RECOIL_GUARD;
    // The breech lever's handle and a fist round it.
    expect(-g.x - (-(LEVER_PIVOT[0] + LEVER_HANDLE_X)) - FIST).toBeGreaterThan(0.06);
    // The casings drop into the bin under the breech, a casing's width either side of its middle.
    expect(-g.x).toBeGreaterThan(-CASING_BIN.x + SHELL_RADIUS + 0.01);
  });

  it('fits the coaxial machine gun between the breech and the elevating arc', () => {
    expect(COAX.x - COAX.width / 2).toBeGreaterThan(GUN.breechHalfWidth + 0.01);
    expect(COAX.x + COAX.width / 2 + 0.006).toBeLessThan(ELEVATING_GEAR.x - ELEVATING_GEAR.half - 0.01);
    // Its back clear of the pinion's housing, which is beyond the arc.
    expect(ELEVATING_GEAR.housing[0] - 0.0175).toBeGreaterThan(COAX.x + COAX.width / 2 + 0.03);
  });

  it("keeps the traverse gear behind the crank, out of the gunner's view of their board, and clear of the turret's foot", () => {
    const g = TRAVERSE_GEARBOX;
    const crank = STATION.crank.at;
    // Behind the crank's face, so the hand on its knob turns clear.
    expect(g.at[2] + g.size[2] / 2).toBeLessThan(crank[2] - 0.06);
    // A turret part beyond the ring's hole must stay over the turret's foot plate (1.60 m) and the ring.
    const footTop = HULL.roof + HULL.wall + 0.05;
    const m = TRAVERSE_MOTOR;
    expect(m.y - m.radius).toBeGreaterThan(footTop);
    expect(g.at[1] - g.size[1] / 2).toBeGreaterThan(TURRET_RING.y + TURRET_RING.halfHeight);
    // Every line from the gunner's eye to the board's lower edge passes over the motor and the gearbox.
    const eye = SEATS.gunner.eye;
    const b = BOARDS.gunner;
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const corner = [b.x - b.width / 2 + k * b.width, b.y - b.height / 2, b.z];
      for (const [z, top, x0, x1] of [
        [m.z, m.y + m.radius + 0.04, m.x0, m.x1],
        [g.at[2], g.at[1] + g.size[1] / 2, g.at[0] - g.size[0] / 2, g.at[0] + g.size[0] / 2],
      ]) {
        const t = (z - eye[2]) / (corner[2] - eye[2]);
        const x = eye[0] + t * (corner[0] - eye[0]);
        const y = eye[1] + t * (corner[1] - eye[1]);
        if (x > x0 - 0.02 && x < x1 + 0.02) expect(y, `line to the board's edge at ${k}`).toBeGreaterThan(top);
      }
    }
    // The crank's knob circle stays clear of the gearbox's front.
    expect(crank[2] - TRAVERSE_CRANK.radius * Math.sin(-STATION.crank.tilt) - 0.02).toBeGreaterThan(g.at[2] + g.size[2] / 2 - 0.07);
  });

  it('gives each colour one finish, in range, and writes it per vertex for a finished material', () => {
    for (const f of Object.values(FINISH)) for (const v of f) expect(v >= 0 && v <= 1).toBe(true);
    expect(interiorFinish(INTERIOR_COLORS.steel)?.[1]).toBeGreaterThan(0.3);
    expect(interiorFinish(INTERIOR_COLORS.brass)?.[0]).toBeGreaterThan(0.4);
    expect(interiorFinish(0x123456)).toBeUndefined();
    const geometry = mergeParts(
      [
        { geometry: new BoxGeometry(0.1, 0.1, 0.1), color: INTERIOR_COLORS.steel },
        { geometry: new BoxGeometry(0.1, 0.1, 0.1), color: 0x123456, position: [1, 0, 0] },
      ],
      interiorFinish,
    );
    const finish = geometry.getAttribute('finish');
    expect(finish.count).toBe(geometry.getAttribute('position').count);
    expect([finish.getX(0), finish.getY(0)]).toEqual([...FINISH.steel].map((v) => Math.fround(v)));
    expect([finish.getX(finish.count - 1), finish.getY(finish.count - 1)]).toEqual([0, 0]);
    // Without a finish table, no attribute: other models are unchanged.
    expect(mergeParts([{ geometry: new BoxGeometry(0.1, 0.1, 0.1), color: INTERIOR_COLORS.steel }]).getAttribute('finish')).toBeUndefined();
  });
});
