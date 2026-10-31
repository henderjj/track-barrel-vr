import { describe, expect, it } from 'vitest';
import {
  angleOf,
  Button,
  type HandInput,
  Lever,
  type LeverSpec,
  MechEvent,
  OneEuro,
  rollOf,
  PullKnob,
  type PullSpec,
  Toggle,
  type ToggleSpec,
  TwistGrip,
  type Vec3,
  Wheel,
  wheelAngleOf,
  Yoke,
} from '../src/sim/mechanism.js';
import { TILLER } from '../src/sim/lever.js';
import { BENCH, BUTTON, CRANK, HANDWHEEL, MOUNTS, mountToBench, NOTCHED_LEVER, SWITCH, TWIST, YOKE } from '../src/sim/mechanism-bench.js';
import { rigOffset, SEATED_EYE, targetEyeHeight } from '../src/sim/body-height.js';

const DEG = Math.PI / 180;
const DT = 1 / 90;

/** A controller hand with its fist at (x, y, z) in the mechanism's space. */
function hand(x: number, y: number, z: number, more: Partial<HandInput> = {}): HandInput {
  return { fist: [x, y, z], across: [1, 0, 0], tip: null, trigger: 0, tracked: false, ...more };
}
/** A hand at lever angle `deg`, `r` from the pivot. */
const leverHand = (deg: number, r = 0.39, x = 0, tracked = false) => hand(x, r * Math.cos(deg * DEG), -r * Math.sin(deg * DEG), { tracked });
/** Just the right hand. */
const right = (h: HandInput | null) => [null, h];
/** A hand at wheel angle `deg` (0 at the top, anticlockwise), `r` from the axle and `z` out from its face. */
const wheelHand = (deg: number, r: number, z = 0) => hand(-r * Math.sin(deg * DEG), r * Math.cos(deg * DEG), z);
/** A hand rolled `deg` about a twist grip's upright handle, at its middle. */
const rolled = (deg: number, trigger = 0) => hand(0, TWIST.base + TWIST.length / 2, 0, { across: [Math.cos(deg * DEG), 0, -Math.sin(deg * DEG)], trigger });
/** A hand on a yoke's handle `dir` (-1 left, 1 right), the yoke turned `deg`. */
const yokeHand = (dir: number, deg: number, r = 0.12) => hand(dir * r * Math.cos(deg * DEG), 0, -dir * r * Math.sin(deg * DEG));

describe('the lever', () => {
  it('reads the hand angle round the pivot, forwards positive', () => {
    expect(angleOf(0.39, 0)).toBeCloseTo(0);
    expect(angleOf(...(leverHand(20).fist.slice(1) as [number, number]))).toBeCloseTo(20 * DEG);
    expect(angleOf(...(leverHand(-15).fist.slice(1) as [number, number]))).toBeCloseTo(-15 * DEG);
    expect(angleOf(0.01, 0.01)).toBeNaN();
  });

  it('does not jump when taken hold of off the handle, then follows the hand', () => {
    const lever = new Lever(TILLER);
    expect(lever.grab(1, leverHand(5))).toBe(true);
    lever.update(DT, right(leverHand(5)));
    expect(lever.angle).toBeCloseTo(0, 5);
    for (let i = 1; i <= 30; i++) lever.update(DT, right(leverHand(5 + i / 2)));
    for (let i = 0; i < 30; i++) lever.update(DT, right(leverHand(20)));
    expect(lever.angle / DEG).toBeCloseTo(15, 1);
    expect(lever.overshoot).toBe(0);
    expect(lever.strain[1]).toBe(0);
  });

  it('stops at its limits, says how far past the hand is, and ticks once on reaching one', () => {
    const lever = new Lever(TILLER);
    lever.grab(1, leverHand(0));
    let limits = 0;
    for (let i = 0; i <= 90; i++) if (lever.update(DT, right(leverHand(i * 0.5))) & MechEvent.Limit) limits++;
    for (let i = 0; i < 60; i++) if (lever.update(DT, right(leverHand(45))) & MechEvent.Limit) limits++;
    expect(lever.angle).toBeCloseTo(TILLER.max);
    expect(lever.overshoot / DEG).toBeCloseTo(20, 0);
    expect(lever.strain[1] / DEG).toBeCloseTo(20, 0);
    expect(limits).toBe(1);
    // Back off and push again: felt again.
    for (let i = 0; i < 60; i++) lever.update(DT, right(leverHand(10)));
    for (let i = 0; i < 60; i++) if (lever.update(DT, right(leverHand(40))) & MechEvent.Limit) limits++;
    expect(limits).toBe(2);
    for (let i = 0; i < 90; i++) lever.update(DT, right(leverHand(-40)));
    expect(lever.angle).toBeCloseTo(TILLER.min);
    expect(lever.overshoot).toBeLessThan(0);
  });

  it('ignores the hand’s sideways position and distance from the pivot', () => {
    const lever = new Lever(TILLER);
    lever.grab(1, leverHand(0));
    for (let i = 0; i < 90; i++) lever.update(DT, right(leverHand(12, 0.3, 0.08)));
    expect(lever.angle / DEG).toBeCloseTo(12, 1);
  });

  it('ticks passing the middle detent while held', () => {
    const lever = new Lever(TILLER);
    lever.grab(1, leverHand(0));
    for (let i = 0; i < 45; i++) lever.update(DT, right(leverHand(-10)));
    let detents = 0;
    for (let i = 0; i < 90; i++) if (lever.update(DT, right(leverHand(10))) & MechEvent.Detent) detents++;
    expect(detents).toBe(1);
  });

  it('holds still for a step where the hand is lost, and springs back when let go', () => {
    const lever = new Lever(TILLER);
    lever.grab(1, leverHand(0));
    for (let i = 0; i < 90; i++) lever.update(DT, right(leverHand(20)));
    const held = lever.angle;
    lever.update(DT, right(null));
    expect(lever.angle).toBe(held);
    lever.release(1);
    expect(lever.anyHeld).toBe(false);
    for (let i = 0; i < 30; i++) lever.update(DT, right(null));
    expect(Math.abs(lever.angle)).toBeLessThan(1 * DEG);
  });

  it('settles into its nearest notch when let go, or stays put with no spring', () => {
    const lever = new Lever(NOTCHED_LEVER);
    lever.grab(1, leverHand(0, 0.23));
    for (let i = 0; i < 90; i++) lever.update(DT, right(leverHand(17, 0.23)));
    lever.release(1);
    for (let i = 0; i < 60; i++) lever.update(DT, right(null));
    expect(lever.angle / DEG).toBeCloseTo(25, 1);
    expect(lever.notch()).toBe(2);
    const friction: LeverSpec = { ...TILLER, spring: 0 };
    const throttle = new Lever(friction);
    throttle.grab(1, leverHand(0));
    for (let i = 0; i < 90; i++) throttle.update(DT, right(leverHand(-9)));
    throttle.release(1);
    for (let i = 0; i < 90; i++) throttle.update(DT, right(null));
    expect(throttle.angle / DEG).toBeCloseTo(-9, 1);
  });

  it('reads as a drive demand with a deadband round rest', () => {
    const lever = new Lever(TILLER);
    lever.angle = 1.5 * DEG;
    expect(lever.demand()).toBe(0);
    lever.angle = TILLER.max;
    expect(lever.demand()).toBeCloseTo(1);
    lever.angle = TILLER.min;
    expect(lever.demand()).toBeCloseTo(-1);
    lever.angle = (TILLER.max + TILLER.deadband) / 2;
    expect(lever.demand()).toBeCloseTo(0.5);
  });

  it('steadies a tracked hand’s jitter while still but keeps up when it moves', () => {
    // ±4 mm of jitter on a hand 39 cm from the pivot is about ±0.6°.
    const jittery = (i: number) => leverHand(10 + (((i * 7919) % 13) - 6) * 0.1, 0.39, 0, true);
    const lever = new Lever(TILLER);
    lever.grab(1, leverHand(10, 0.39, 0, true));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 180; i++) {
      lever.update(DT, right(jittery(i)));
      if (i > 90) {
        lo = Math.min(lo, lever.angle);
        hi = Math.max(hi, lever.angle);
      }
    }
    expect((hi - lo) / DEG).toBeLessThan(0.3);
    // A deliberate 15° push in 0.2 s is followed to within 2° 0.1 s after it
    // ends (the lever was taken hold of 10° behind the hand, so it ends at 15°).
    for (let i = 1; i <= 18; i++) lever.update(DT, right(leverHand(10 + (15 * i) / 18, 0.39, 0, true)));
    for (let i = 0; i < 9; i++) lever.update(DT, right(leverHand(25, 0.39, 0, true)));
    expect(lever.angle / DEG).toBeGreaterThan(13);
  });

  it('is in reach only at its handle, only for the hand holding it, and draws the hand on the handle', () => {
    const lever = new Lever(TILLER);
    expect(lever.reach(1, leverHand(0, 0.39))).toBeCloseTo(0);
    expect(lever.reach(1, leverHand(0, 0.39, 0.05))).toBeCloseTo(0.05);
    // Below the handle, the distance is to its bottom end.
    expect(lever.reach(1, leverHand(0, 0.2))).toBeCloseTo(0.13);
    lever.grab(1, leverHand(0));
    expect(lever.reach(0, leverHand(0))).toBe(Infinity);
    lever.angle = 20 * DEG;
    const point: Vec3 = [0, 0, 0];
    const axis: Vec3 = [0, 0, 0];
    lever.lock(1, [0.02, 0.38 * Math.cos(20 * DEG), -0.38 * Math.sin(20 * DEG)], point, axis);
    expect(Math.hypot(point[0], point[1], point[2])).toBeCloseTo(0.38);
    expect(point[0]).toBe(0);
    expect(Math.atan2(-axis[2], axis[1]) / DEG).toBeCloseTo(20);
  });

  it('one-euro filter passes a still value straight through', () => {
    const f = new OneEuro(1, 0);
    for (let i = 0; i < 10; i++) expect(f.filter(0.3, 0.01)).toBeCloseTo(0.3);
  });
});

describe('the wheel and the crank', () => {
  it('reads the hand angle round the axle, anticlockwise from the top', () => {
    expect(wheelAngleOf(0, 0.1)).toBeCloseTo(0);
    expect(wheelAngleOf(-0.1, 0) / DEG).toBeCloseTo(90);
    expect(wheelAngleOf(0.01, 0.01)).toBeNaN();
  });

  it('turns a crank round and round after the hand, ticking each quarter turn', () => {
    const crank = new Wheel(CRANK);
    const r = CRANK.radius;
    expect(crank.reach(1, wheelHand(0, r, 0.04))).toBeCloseTo(0);
    expect(crank.grab(1, wheelHand(0, r, 0.04))).toBe(true);
    // Three turns anticlockwise in three seconds, the hand a little off the knob's line.
    let ticks = 0;
    for (let i = 1; i <= 270; i++) {
      if (crank.update(DT, right(wheelHand((i * 1090) / 270, r + 0.01, 0.05))) & MechEvent.Detent) ticks++;
    }
    for (let i = 0; i < 30; i++) if (crank.update(DT, right(wheelHand(1090, r + 0.01, 0.05))) & MechEvent.Detent) ticks++;
    expect(crank.turns).toBeCloseTo(3, 1);
    expect(crank.value()).toBeCloseTo(3 * CRANK.perTurn, 1);
    expect(ticks).toBe(12);
    // And back one.
    for (let i = 1; i <= 90; i++) crank.update(DT, right(wheelHand(1090 - (i * 360) / 90, r, 0.05)));
    for (let i = 0; i < 30; i++) crank.update(DT, right(wheelHand(730, r, 0.05)));
    expect(crank.turns).toBeCloseTo(2, 1);
    // One hand on a crank only.
    expect(crank.reach(0, wheelHand(crank.angle / DEG, r, 0.04))).toBe(Infinity);
    // A crank let go stays where it is.
    crank.release(1);
    const left = crank.angle;
    for (let i = 0; i < 90; i++) crank.update(DT, right(null));
    expect(crank.angle).toBe(left);
  });

  it('turns smoothly with the hand going round a circle off the axle, never stopping or jumping', () => {
    // A hand circling 4 cm off the crank's axle passes 4 cm from it, too near to read its angle there.
    for (const [ox, oy] of [[0.04, 0], [0, 0.04], [-0.03, -0.03]]) {
      const crank = new Wheel(CRANK);
      const r = CRANK.radius;
      const at = (deg: number) => hand(ox - r * Math.sin(deg * DEG), oy + r * Math.cos(deg * DEG), 0.04);
      expect(crank.grab(1, at(0))).toBe(true);
      let before = crank.angle;
      let biggest = 0;
      // Two turns anticlockwise in two seconds: it moves on every frame, by no more than a few degrees.
      for (let i = 1; i <= 180; i++) {
        crank.update(DT, right(at(i * 4)));
        const step = crank.angle - before;
        before = crank.angle;
        expect(step).toBeGreaterThan(0);
        biggest = Math.max(biggest, step);
      }
      expect(biggest / DEG).toBeLessThan(15);
      expect(crank.turns).toBeGreaterThan(1.9);
      expect(crank.turns).toBeLessThan(2.1);
    }
  });

  it('takes hold of a fist too near the axle to read as if it were on the knob, and turns from there', () => {
    const crank = new Wheel(CRANK);
    expect(crank.grab(1, wheelHand(0, 0.03, 0.04))).toBe(true);
    crank.update(DT, right(wheelHand(0, 0.03, 0.04)));
    expect(crank.angle).toBe(0);
    crank.update(DT, right(wheelHand(0, CRANK.radius, 0.04)));
    for (let i = 1; i <= 30; i++) crank.update(DT, right(wheelHand(i * 2, CRANK.radius, 0.04)));
    for (let i = 0; i < 30; i++) crank.update(DT, right(wheelHand(60, CRANK.radius, 0.04)));
    expect(crank.angle / DEG).toBeCloseTo(60, 0);
  });

  it('does not jump when a rim is taken hold of anywhere, and stops at its limits with the hand kept where it closed', () => {
    const wheel = new Wheel(HANDWHEEL);
    const r = HANDWHEEL.radius;
    expect(wheel.reach(1, wheelHand(-70, r, 0.02))).toBeCloseTo(0.02);
    wheel.grab(1, wheelHand(-70, r));
    wheel.update(DT, right(wheelHand(-70, r)));
    expect(wheel.angle).toBeCloseTo(0, 5);
    const point: Vec3 = [0, 0, 0];
    const axis: Vec3 = [0, 0, 0];
    // Turn it 90° anticlockwise: the drawn hand goes round with the rim.
    for (let i = 1; i <= 45; i++) wheel.update(DT, right(wheelHand(-70 + i * 2, r)));
    for (let i = 0; i < 30; i++) wheel.update(DT, right(wheelHand(20, r)));
    expect(wheel.angle / DEG).toBeCloseTo(90, 0);
    wheel.lock(1, wheelHand(20, r).fist, point, axis);
    expect(wheelAngleOf(point[0], point[1]) / DEG).toBeCloseTo(20, 0);
    // Wind it on to its stop at two turns.
    let limits = 0;
    for (let i = 1; i <= 360; i++) if (wheel.update(DT, right(wheelHand(20 + i * 2, r))) & MechEvent.Limit) limits++;
    for (let i = 0; i < 30; i++) wheel.update(DT, right(wheelHand(740, r)));
    expect(wheel.turns).toBeCloseTo(2, 5);
    expect(limits).toBe(1);
    expect(wheel.strain[1] / DEG).toBeCloseTo(90, 0);
    // The drawn hand stays where the rim stopped while the real hand goes on.
    wheel.lock(1, wheelHand(740, r).fist, point, axis);
    expect(wrap360(wheelAngleOf(point[0], point[1]) / DEG)).toBeCloseTo(wrap360(-70 + 720), 0);
    // The axis runs along the rim.
    expect(Math.abs(axis[0] * point[0] + axis[1] * point[1])).toBeLessThan(1e-9);
  });

  it('turns with two hands on the rim by the mean of where each would take it', () => {
    const wheel = new Wheel(HANDWHEEL);
    const r = HANDWHEEL.radius;
    wheel.grab(0, wheelHand(90, r));
    wheel.grab(1, wheelHand(-90, r));
    expect(wheel.anyHeld).toBe(true);
    for (let i = 1; i <= 30; i++) wheel.update(DT, [wheelHand(90 + i, r), wheelHand(-90 + i, r)]);
    for (let i = 0; i < 30; i++) wheel.update(DT, [wheelHand(120, r), wheelHand(-60, r)]);
    expect(wheel.angle / DEG).toBeCloseTo(30, 0);
    // One hand still, the other moving on: half as far.
    for (let i = 0; i < 60; i++) wheel.update(DT, [wheelHand(140, r), wheelHand(-60, r)]);
    expect(wheel.angle / DEG).toBeCloseTo(40, 0);
  });

  it('puts the crewmate’s hand on the nearest point of the rim', () => {
    const wheel = new Wheel(HANDWHEEL);
    const point: Vec3 = [0, 0, 0];
    const axis: Vec3 = [0, 0, 0];
    wheel.lock(-1, wheelHand(130, 0.15, 0.03).fist, point, axis);
    expect(Math.hypot(point[0], point[1])).toBeCloseTo(HANDWHEEL.radius);
    expect(wheelAngleOf(point[0], point[1]) / DEG).toBeCloseTo(130);
  });
});

describe('the twist grip', () => {
  it('reads the hand’s roll about the handle', () => {
    expect(rollOf([1, 0, 0])).toBeCloseTo(0);
    expect(rollOf(rolled(30).across) / DEG).toBeCloseTo(30);
    expect(rollOf([0, 1, 0])).toBeNaN();
  });

  it('twists with the hand’s roll up to its limit, springs back, and fires with the trigger', () => {
    const twist = new TwistGrip(TWIST);
    expect(twist.reach(1, rolled(0))).toBeCloseTo(0);
    twist.grab(1, rolled(10));
    for (let i = 1; i <= 30; i++) twist.update(DT, right(rolled(10 - i)));
    for (let i = 0; i < 30; i++) twist.update(DT, right(rolled(-20)));
    expect(twist.angle / DEG).toBeCloseTo(-30, 0);
    expect(twist.demand()).toBeCloseTo(-(26 / 36), 1);
    let limits = 0;
    for (let i = 0; i < 60; i++) if (twist.update(DT, right(rolled(-70))) & MechEvent.Limit) limits++;
    expect(twist.angle / DEG).toBeCloseTo(-40);
    expect(limits).toBe(1);
    expect(twist.strain[1] / DEG).toBeCloseTo(40, 0);
    // The trigger: on above 0.6, off again only below 0.4.
    expect(twist.update(DT, right(rolled(-70, 0.7))) & MechEvent.Press).toBeTruthy();
    expect(twist.firing).toBe(true);
    expect(twist.update(DT, right(rolled(-70, 0.5)))).toBe(0);
    expect(twist.update(DT, right(rolled(-70, 0.2))) & MechEvent.Release).toBeTruthy();
    twist.release(1);
    for (let i = 0; i < 30; i++) twist.update(DT, right(null));
    expect(Math.abs(twist.angle)).toBeLessThan(2 * DEG);
    expect(twist.demand()).toBe(0);
  });

  it('takes hold of a hand lying along the handle and twists once its roll can be read', () => {
    const twist = new TwistGrip(TWIST);
    expect(twist.grab(1, hand(0, 0.09, 0, { across: [0, 1, 0] }))).toBe(true);
    twist.update(DT, right(hand(0, 0.09, 0, { across: [0, 1, 0] })));
    expect(twist.angle).toBe(0);
    twist.update(DT, right(rolled(50)));
    for (let i = 0; i < 60; i++) twist.update(DT, right(rolled(70)));
    expect(twist.angle / DEG).toBeCloseTo(20, 0);
  });
});

describe('the yoke', () => {
  it('turns with both hands as they go, each on its own handle', () => {
    const yoke = new Yoke(YOKE);
    expect(yoke.reach(0, yokeHand(-1, 0))).toBeCloseTo(0);
    expect(yoke.grab(0, yokeHand(-1, 0))).toBe(true);
    expect(yoke.grab(1, yokeHand(1, 0))).toBe(true);
    let ticks = 0;
    for (let i = 1; i <= 50; i++) if (yoke.update(DT, [yokeHand(-1, i), yokeHand(1, i)]) & MechEvent.Detent) ticks++;
    for (let i = 0; i < 30; i++) yoke.update(DT, [yokeHand(-1, 50), yokeHand(1, 50)]);
    expect(yoke.angle / DEG).toBeCloseTo(50, 0);
    expect(ticks).toBe(3);
    expect(yoke.strain[0]).toBeLessThan(0.5 * DEG);
    const point: Vec3 = [0, 0, 0];
    const axis: Vec3 = [0, 0, 0];
    yoke.lock(0, yokeHand(-1, 50, 0.1).fist, point, axis);
    expect(point[0]).toBeCloseTo(-0.1 * Math.cos(50 * DEG));
    expect(point[2]).toBeCloseTo(0.1 * Math.sin(50 * DEG));
  });

  it('turns slower in one hand, which gets ahead of it and feels the strain', () => {
    const yoke = new Yoke(YOKE);
    yoke.grab(1, yokeHand(1, 0));
    // The hand swings 60° in a quarter second; the yoke follows at 30°/s.
    for (let i = 1; i <= 22; i++) yoke.update(DT, right(yokeHand(1, (60 * i) / 22)));
    expect(yoke.angle / DEG).toBeCloseTo(7.3, 0);
    expect(yoke.strain[1] / DEG).toBeGreaterThan(45);
    for (let i = 0; i < 180; i++) yoke.update(DT, right(yokeHand(1, 60)));
    expect(yoke.angle / DEG).toBeCloseTo(60, 0);
    // A second hand takes the other handle.
    expect(yoke.reach(0, yokeHand(1, 60))).toBeGreaterThan(0.15);
    expect(yoke.reach(0, yokeHand(-1, 60))).toBeCloseTo(0);
  });
});

describe('the button and the switch', () => {
  const tip = (x: number, y: number, z: number) => hand(x, y, z + 0.1, { tip: [x, y, z] });

  it('goes in under a fingertip, presses once, and comes out', () => {
    const button = new Button(BUTTON);
    expect(button.update(DT, right(tip(0, 0, 0.01)))).toBe(0);
    expect(button.update(DT, right(tip(0.005, 0, -0.003)))).toBe(0);
    expect(button.depth).toBeCloseTo(0.003);
    expect(button.update(DT, right(tip(0.005, 0, -0.007))) & MechEvent.Press).toBeTruthy();
    expect(button.on).toBe(true);
    expect(button.pressedBy).toBe(1);
    // Pushed further, it goes no further and presses no more.
    expect(button.update(DT, right(tip(0, 0, -0.02)))).toBe(0);
    expect(button.depth).toBeCloseTo(BUTTON.travel);
    expect(button.update(DT, right(tip(0, 0, -0.004)))).toBe(0);
    expect(button.update(DT, right(tip(0, 0, 0.01))) & MechEvent.Release).toBeTruthy();
    expect(button.on).toBe(false);
    expect(button.presses).toBe(1);
  });

  it('ignores a fingertip beside it or far behind it', () => {
    const button = new Button(BUTTON);
    button.update(DT, right(tip(0.04, 0, -0.007)));
    button.update(DT, right(tip(0, 0, -0.06)));
    expect(button.presses).toBe(0);
  });

  it('is held right in by a squeeze', () => {
    const button = new Button(BUTTON);
    expect(button.reach(0, hand(0, 0.03, 0.03))).toBeLessThan(button.reachRadius);
    button.grab(0, hand(0, 0.03, 0.03));
    expect(button.update(DT, [hand(0, 0.03, 0.03), null]) & MechEvent.Press).toBeTruthy();
    expect(button.on).toBe(true);
    button.release(0);
    button.update(DT, [null, null]);
    expect(button.on).toBe(false);
  });

  it('turns a switch on with one press and off with the next', () => {
    const sw = new Button(SWITCH);
    for (const expected of [true, false, true]) {
      sw.update(DT, right(tip(0, 0, -0.008)));
      sw.update(DT, right(tip(0, 0, 0.02)));
      expect(sw.on).toBe(expected);
    }
    expect(sw.presses).toBe(3);
  });
});

describe('the toggle switch (headset feedback, 31 October 2026)', () => {
  const SPEC: ToggleSpec = { length: 0.024, radius: 0.0032, lean: 25 * DEG };
  const tip = (x: number, y: number, z: number) => hand(x, y - 0.05, z + 0.08, { tip: [x, y, z] });
  /** A fingertip moved through the bat's box from `from` to `to` up the face, in steps; the presses seen. */
  const flick = (t: Toggle, from: number, to: number, x = 0, z = 0.015) => {
    let presses = 0;
    for (let i = 0; i <= 10; i++) if (t.update(DT, right(tip(x, from + ((to - from) * i) / 10, z))) & MechEvent.Press) presses++;
    return presses;
  };
  const away = (t: Toggle) => t.update(DT, right(tip(0, 0, 0.2)));

  it('a fingertip flicking it up turns it on, flicking it down turns it off, once a flick', () => {
    const t = new Toggle(SPEC);
    expect(t.on).toBe(false);
    expect(flick(t, -0.012, 0.015)).toBe(1);
    expect(t.on).toBe(true);
    expect(t.pressedBy).toBe(1);
    // Moving back down without leaving the bat doesn't flip it straight back.
    flick(t, 0.015, -0.012);
    expect(t.on).toBe(true);
    away(t);
    expect(flick(t, 0.012, -0.015)).toBe(1);
    expect(t.on).toBe(false);
    expect(t.presses).toBe(2);
    // Its bat swings over.
    for (let i = 0; i < 60; i++) away(t);
    expect(t.angle).toBeCloseTo(-SPEC.lean, 3);
  });

  it('a quick flick seen once below the bat and once over it still counts', () => {
    const t = new Toggle(SPEC);
    t.update(DT, right(tip(0, -0.05, 0.015)));
    expect(t.update(DT, right(tip(0, 0.012, 0.015))) & MechEvent.Press).toBeTruthy();
    expect(t.on).toBe(true);
  });

  it('pushing it the way it already is, or a fingertip off to the side or behind the face, does nothing', () => {
    const t = new Toggle(SPEC);
    away(t);
    expect(flick(t, 0.015, -0.015)).toBe(0);
    away(t);
    expect(flick(t, -0.012, 0.015, 0.03)).toBe(0);
    away(t);
    expect(flick(t, -0.012, 0.015, 0, -0.01)).toBe(0);
    expect(t.on).toBe(false);
  });

  it('a fist squeezed on it flips it once, however long it is held', () => {
    const t = new Toggle(SPEC);
    const fist = hand(0, 0, 0.03);
    expect(t.reach(0, fist)).toBeLessThan(t.reachRadius);
    t.grab(0, fist);
    expect(t.update(DT, [fist, null]) & MechEvent.Press).toBeTruthy();
    for (let i = 0; i < 30; i++) t.update(DT, [fist, null]);
    expect(t.on).toBe(true);
    expect(t.presses).toBe(1);
    t.release(0);
    t.grab(0, fist);
    t.update(DT, [fist, null]);
    expect(t.on).toBe(false);
  });

  it('a fingertip on a toggle or a button picks it for a squeeze over a nearer fist', () => {
    const t = new Toggle(SPEC);
    expect(t.reach(1, hand(0.04, 0, 0.1, { tip: [0, 0.005, 0.01] }))).toBe(0);
    const b = new Button(BUTTON);
    expect(b.reach(1, hand(0.04, 0, 0.1, { tip: [0.005, 0, 0.01] }))).toBe(0);
    expect(b.reach(1, hand(0.04, 0, 0.1, { tip: [0.05, 0, 0.01] }))).toBeGreaterThan(0.1);
  });
});

describe('the pull knob (the choke, 31 October 2026)', () => {
  const SPEC: PullSpec = { radius: 0.011, depth: 0.012, travel: 0.03, detents: [0.5] };
  const fist = (z: number) => hand(0, 0, z);

  it('a fist on the knob pulls it out, clicking half out and stopping at the end, and it stays where it is let go', () => {
    const k = new PullKnob(SPEC);
    expect(k.reach(1, fist(0.006))).toBeLessThan(k.reachRadius);
    k.grab(1, fist(0.006));
    let events = 0;
    for (let i = 0; i <= 20; i++) events |= k.update(DT, right(fist(0.006 + (0.02 * i) / 20)));
    expect(k.share).toBeCloseTo(2 / 3, 3);
    expect(events & MechEvent.Detent).toBeTruthy();
    // On past the end it stops there, the hand straining.
    events = 0;
    for (let i = 0; i <= 10; i++) events |= k.update(DT, right(fist(0.026 + (0.03 * i) / 10)));
    expect(k.share).toBe(1);
    expect(events & MechEvent.Limit).toBeTruthy();
    expect(k.strain[1]).toBeGreaterThan(0);
    // Pushed back to half and let go, it stays.
    for (let i = 0; i <= 10; i++) k.update(DT, right(fist(0.056 - (0.035 * i) / 10)));
    k.release(1);
    for (let i = 0; i < 30; i++) k.update(DT, [null, null]);
    expect(k.share).toBeCloseTo(0.5, 2);
  });

  it('a fingertip on its face pushes it in, but can\'t pull it out', () => {
    const k = new PullKnob(SPEC);
    k.share = 1;
    const tip = (z: number) => hand(0, -0.05, z + 0.08, { tip: [0.004, 0, z] });
    k.update(DT, right(tip(0.03 + 0.012 + 0.001)));
    expect(k.share).toBe(1);
    k.update(DT, right(tip(0.025)));
    expect(k.out).toBeCloseTo(0.013, 5);
    k.update(DT, right(tip(0.005)));
    expect(k.out).toBe(0);
    k.update(DT, right(tip(0.04)));
    expect(k.out).toBe(0);
  });
});

describe('the test bench', () => {
  it('puts every handle in reach from a chair, between knee and chest height', () => {
    // As test/body-height.test.ts: a seated player's hands reach from about
    // 0.45 m to 1.4 m above their real floor. The bench is placed from the eyes.
    const raised = rigOffset(targetEyeHeight({ raise: 0, seated: true }), 1.2);
    const lever = new Lever(NOTCHED_LEVER);
    const crank = new Wheel(CRANK);
    const wheel = new Wheel(HANDWHEEL);
    const twist = new TwistGrip(TWIST);
    const yoke = new Yoke(YOKE);
    const button = new Button(BUTTON);
    const sw = new Button(SWITCH);
    const points: Vec3[] = [];
    const at = (mount: (typeof MOUNTS)[keyof typeof MOUNTS], p: Vec3) => points.push(mountToBench(mount, p, [0, 0, 0]));
    for (const angle of [NOTCHED_LEVER.min, 0, NOTCHED_LEVER.max]) {
      lever.angle = angle;
      at(MOUNTS.lever, lever.handle(1, [0, 0, 0]));
    }
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 4) {
      crank.angle = a;
      at(MOUNTS.crank, crank.handle(1, [0, 0, 0]));
      at(MOUNTS.wheel, [-HANDWHEEL.radius * Math.sin(a), HANDWHEEL.radius * Math.cos(a), 0]);
    }
    // The yoke as far as two seated hands turn it without letting go.
    for (const a of [-60 * DEG, 0, 60 * DEG]) {
      yoke.angle = a;
      at(MOUNTS.yoke, yoke.handle(0, [0, 0, 0]));
      at(MOUNTS.yoke, yoke.handle(1, [0, 0, 0]));
    }
    at(MOUNTS.twist, twist.handle(1, [0, 0, 0]));
    at(MOUNTS.button, button.handle(1, [0, 0, 0]));
    at(MOUNTS.switch, sw.handle(1, [0, 0, 0]));
    for (const [x, y, z] of points) {
      const height = SEATED_EYE - BENCH.below + y - raised;
      expect(height).toBeGreaterThan(0.45);
      expect(height).toBeLessThan(1.4);
      expect(BENCH.ahead - z).toBeGreaterThan(0.2);
      expect(BENCH.ahead - z).toBeLessThan(0.65);
      expect(Math.abs(x)).toBeLessThan(0.45);
    }
  });

  it('keeps each control’s grip further from its neighbours’ than the reach, so a squeeze takes the one meant', () => {
    const grips: [string, Vec3][] = [];
    const add = (name: string, mount: (typeof MOUNTS)[keyof typeof MOUNTS], p: Vec3) => grips.push([name, mountToBench(mount, p, [0, 0, 0])]);
    add('lever', MOUNTS.lever, new Lever(NOTCHED_LEVER).handle(1, [0, 0, 0]));
    add('crank', MOUNTS.crank, new Wheel(CRANK).handle(1, [0, 0, 0]));
    add('wheel left', MOUNTS.wheel, new Wheel(HANDWHEEL).handle(0, [0, 0, 0]));
    add('wheel right', MOUNTS.wheel, new Wheel(HANDWHEEL).handle(1, [0, 0, 0]));
    add('twist', MOUNTS.twist, new TwistGrip(TWIST).handle(1, [0, 0, 0]));
    add('yoke left', MOUNTS.yoke, new Yoke(YOKE).handle(0, [0, 0, 0]));
    add('yoke right', MOUNTS.yoke, new Yoke(YOKE).handle(1, [0, 0, 0]));
    add('button', MOUNTS.button, [0, 0, 0]);
    add('switch', MOUNTS.switch, [0, 0, 0]);
    for (let i = 0; i < grips.length; i++) {
      for (let j = i + 1; j < grips.length; j++) {
        const [a, p] = grips[i];
        const [b, q] = grips[j];
        if (a.split(' ')[0] === b.split(' ')[0]) continue;
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), `${a} to ${b}`).toBeGreaterThan(0.1);
      }
    }
  });
});

function wrap360(deg: number): number {
  return ((deg % 360) + 540) % 360 - 180;
}
