import { describe, expect, it } from 'vitest';
import {
  boardLines,
  BREECH_MOUTH as MOUTH_GUN,
  CAPTURE_ANGLE,
  CASING_BIN,
  CASING_FLIGHT,
  CASINGS_KEPT,
  copyLoadingSnapshot,
  createDrillHand,
  createLoadingSnapshot,
  type DrillHand,
  type DrillEventKind,
  GunAction,
  gunToTurret,
  HOLD_LEVER,
  HOLD_NONE,
  LEVER_BLOCKED,
  LEVER_CLOSED,
  LEVER_LENGTH,
  LEVER_PIVOT as PIVOT_GUN,
  lerpLoadingSnapshot,
  LoadingDrill,
  RACK_SLOTS,
  RECOIL,
  recoilAt,
  RETURN_DELAY,
  rotate,
  SHELL_LENGTH,
  STREAK_GOAL,
  unrotate,
  turretToGun,
  type Vec3,
} from '../src/sim/loading.js';
import { decodeLoadingState, encodeLoadingState, LOADING_STATE_BYTES } from '../src/net/loading-codec.js';
import { TURRET } from '../src/sim/cabin.js';

/** The breech mouth and the lever's pivot in turret space with the gun level: the drill works in turret space. */
const BREECH_MOUTH = gunToTurret(MOUTH_GUN, 0, 0, [0, 0, 0]);
const LEVER_PIVOT = gunToTurret(PIVOT_GUN, 0, 0, [0, 0, 0]);
/** Where the hands rest, out of the way: over the gunner's lap, turret space. */
const LEFT_REST: Vec3 = [0.25, 1.75, -0.15];
const RIGHT_REST: Vec3 = [0.55, 1.75, -0.15];

const DT = 1 / 90;

/** A drill with scripted hands, stepped at 90 Hz. */
class Rig {
  drill = new LoadingDrill();
  left = createDrillHand();
  right = createDrillHand();
  seen: DrillEventKind[] = [];

  constructor() {
    this.right.present = true;
    this.left.present = true;
    this.left.pos = [...LEFT_REST];
    this.right.pos = [...RIGHT_REST];
  }

  step(frames = 1): void {
    for (let i = 0; i < frames; i++) {
      this.drill.update(DT, this.left, this.right);
      for (let e = 0; e < this.drill.eventCount; e++) this.seen.push(this.drill.events[e].kind);
    }
  }

  /** Move `hand` in a straight line to `to` over `seconds`. */
  move(hand: DrillHand, to: Readonly<Vec3>, seconds = 0.3): void {
    const from = [...hand.pos] as Vec3;
    const frames = Math.max(1, Math.round(seconds / DT));
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      hand.pos = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
      this.step();
    }
  }

  squeeze(hand: DrillHand, on: boolean): void {
    hand.pressed = on;
    this.step();
  }

  wait(seconds: number): void {
    this.step(Math.round(seconds / DT));
  }

  /** Where the right hand must be for the held shell's nose to be at `nose`. */
  handForNose(nose: Readonly<Vec3>): Vec3 {
    const n = this.drill.nose(this.drill.holds.right, [0, 0, 0]);
    return [this.right.pos[0] + nose[0] - n[0], this.right.pos[1] + nose[1] - n[1], this.right.pos[2] + nose[2] - n[2]];
  }

  /** Take shell `slot` from the rack near its base and put its nose `outside` m short of the mouth. */
  toMouth(slot: number, outside = 0.03): void {
    const c = RACK_SLOTS[slot];
    this.move(this.right, [c[0], c[1], c[2] + 0.2]);
    this.squeeze(this.right, true);
    this.move(this.right, this.handForNose([BREECH_MOUTH[0] + 0.25, BREECH_MOUTH[1] + 0.05, BREECH_MOUTH[2] + 0.05]), 0.4);
    this.move(this.right, this.handForNose([BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] + outside]), 0.3);
  }

  /** Pull the lever from where it is to `angle`, with the left hand, and let go. */
  pullLever(angle: number): void {
    const a = this.drill.lever;
    this.move(this.left, [LEVER_PIVOT[0], LEVER_PIVOT[1] + LEVER_LENGTH * Math.cos(a), LEVER_PIVOT[2] + LEVER_LENGTH * Math.sin(a)]);
    this.squeeze(this.left, true);
    for (let k = 1; k <= 10; k++) {
      const t = a + ((angle - a) * k) / 10;
      this.move(this.left, [LEVER_PIVOT[0], LEVER_PIVOT[1] + LEVER_LENGTH * Math.cos(t), LEVER_PIVOT[2] + LEVER_LENGTH * Math.sin(t)], 0.03);
    }
    this.squeeze(this.left, false);
    this.move(this.left, LEFT_REST, 0.2);
  }

  /** One clean load: rack, breech, ram by pushing, close. */
  load(slot: number): void {
    this.toMouth(slot);
    this.move(this.right, [this.right.pos[0], this.right.pos[1], this.right.pos[2] - SHELL_LENGTH - 0.05], 0.4);
    this.squeeze(this.right, false);
    this.move(this.right, RIGHT_REST, 0.2);
    this.pullLever(LEVER_CLOSED + 0.2);
  }
}

describe('loading the gun (F1.10, after spike S4)', () => {
  it('loads a shell: grab from the rack, swing to the breech, ram, close; then the trigger fires it and the breech opens', () => {
    const rig = new Rig();
    rig.toMouth(0);
    expect(rig.drill.breechShell).toBe(0);
    expect(rig.seen).toContain('capture');
    // Rammed by pushing it home while held: the hand lets go of it.
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - SHELL_LENGTH - 0.05], 0.4);
    expect(rig.drill.rammed).toBe(true);
    expect(rig.drill.holds.right).toBe(HOLD_NONE);
    expect(rig.drill.depth).toBe(SHELL_LENGTH);
    rig.squeeze(rig.right, false);
    rig.move(rig.right, RIGHT_REST, 0.2);
    const before = rig.drill.time;
    rig.pullLever(LEVER_CLOSED + 0.2);
    expect(rig.drill.lever).toBe(LEVER_CLOSED);
    expect(rig.drill.loaded).toBe(true);
    expect(rig.drill.stats.loads).toBe(1);
    expect(rig.drill.stats.last).toBeGreaterThan(before);
    expect(rig.drill.stats.lastHandling).toBeLessThan(rig.drill.stats.last);
    expect(rig.drill.stats.streak).toBe(1);
    // Loaded, it waits for the trigger.
    rig.wait(3);
    expect(rig.drill.loaded).toBe(true);
    expect(rig.drill.fire()).toBe(true);
    expect(rig.drill.events.slice(0, rig.drill.eventCount).map((e) => e.kind)).toContain('fired');
    expect(rig.drill.stats.shots).toBe(1);
    expect(rig.drill.loaded).toBe(false);
    expect(rig.drill.lever).toBe(0);
    expect(rig.drill.breechShell).toBe(-1);
    expect(rig.drill.shells[0].place).toBe('rack');
    expect(rig.drill.shells[0].centre).toEqual([...RACK_SLOTS[0]]);
  });

  it("loads at once for Practice's Ready to fire (F1.11), without counting a load or a fumble, a held shell back in the rack", () => {
    const rig = new Rig();
    rig.move(rig.right, [RACK_SLOTS[1][0], RACK_SLOTS[1][1], RACK_SLOTS[1][2] + 0.2]);
    rig.squeeze(rig.right, true);
    expect(rig.drill.holds.right).toBe(1);
    rig.drill.elevation = 0.1;
    rig.drill.loadNow();
    expect(rig.drill.loaded).toBe(true);
    expect(rig.drill.rammed).toBe(true);
    expect(rig.drill.lever).toBe(LEVER_CLOSED);
    expect(rig.drill.depth).toBe(SHELL_LENGTH);
    expect(rig.drill.holds.right).toBe(HOLD_NONE);
    expect(rig.drill.shells[1].place).toBe('rack');
    expect(rig.drill.shells[rig.drill.breechShell].place).toBe('breech');
    expect(rig.drill.stats.loads).toBe(0);
    expect(rig.drill.stats.fumbles).toBe(0);
    // Steps on with the hand still squeezed (it doesn't take the shell back) and fires.
    rig.step(5);
    expect(rig.drill.loaded).toBe(true);
    expect(rig.drill.fire()).toBe(true);
    expect(rig.drill.shells.every((sh) => sh.place === 'rack')).toBe(true);
    // Again while loaded: nothing changes.
    rig.drill.loadNow();
    const breech = rig.drill.breechShell;
    rig.drill.loadNow();
    expect(rig.drill.breechShell).toBe(breech);
  });

  it('times each load from the breech opening', () => {
    const rig = new Rig();
    rig.load(0);
    rig.wait(0.5);
    rig.drill.fire();
    const opened = rig.drill.readyAt;
    rig.wait(1);
    rig.load(1);
    const closedAt = rig.drill.time;
    expect(rig.drill.stats.loads).toBe(2);
    expect(rig.drill.stats.last).toBeGreaterThan(1);
    expect(rig.drill.stats.last).toBeLessThanOrEqual(closedAt - opened + 1e-9);
    expect(rig.drill.stats.times).toHaveLength(2);
    expect(rig.drill.stats.best).toBe(Math.min(...rig.drill.stats.times));
  });

  it('snaps a shell onto the bore only when its nose is near the mouth and it points down the bore', () => {
    // 7 cm off the bore's line: no.
    let rig = new Rig();
    const c = RACK_SLOTS[0];
    rig.move(rig.right, [c[0], c[1], c[2] + 0.2]);
    rig.squeeze(rig.right, true);
    rig.move(rig.right, rig.handForNose([BREECH_MOUTH[0] + 0.07, BREECH_MOUTH[1], BREECH_MOUTH[2] + 0.02]));
    expect(rig.drill.breechShell).toBe(-1);
    // Pointing 30° off the bore, nose right at the mouth: no.
    rig = new Rig();
    rig.move(rig.right, [c[0], c[1], c[2] + 0.2]);
    rig.right.quat = yaw(30);
    rig.squeeze(rig.right, true);
    // Grabbed turned: turn the hand back, which turns the shell 30° off.
    rig.right.quat = [0, 0, 0, 1];
    rig.step();
    const axis = rig.drill.shells[0].axis;
    expect(Math.acos(-axis[2])).toBeGreaterThan(CAPTURE_ANGLE);
    rig.move(rig.right, rig.handForNose([BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] + 0.02]));
    expect(rig.drill.breechShell).toBe(-1);
    // 4 cm off the line, 15° off the bore: yes.
    rig = new Rig();
    rig.move(rig.right, [c[0], c[1], c[2] + 0.2]);
    rig.right.quat = yaw(15);
    rig.squeeze(rig.right, true);
    rig.right.quat = [0, 0, 0, 1];
    rig.step();
    rig.move(rig.right, rig.handForNose([BREECH_MOUTH[0] + 0.04, BREECH_MOUTH[1], BREECH_MOUTH[2] + 0.06]));
    expect(rig.drill.breechShell).toBe(0);
    expect(rig.drill.shells[0].axis).toEqual([0, 0, -1]);
  });

  it('lets a shell be pulled back out of the breech', () => {
    const rig = new Rig();
    rig.toMouth(0);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - 0.2]);
    expect(rig.drill.depth).toBeGreaterThan(0.15);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] + 0.4]);
    expect(rig.seen).toContain('unseat');
    expect(rig.drill.breechShell).toBe(-1);
    expect(rig.drill.shells[0].place).toBe('hand');
  });

  it('rams a shell shoved and let go, sliding home by itself', () => {
    const rig = new Rig();
    rig.toMouth(0);
    // A quick shove of 0.35 m at about 1.4 m/s, letting go still moving.
    const p = rig.right.pos;
    rig.move(rig.right, [p[0], p[1], p[2] - 0.35], 0.25);
    expect(rig.drill.rammed).toBe(false);
    rig.squeeze(rig.right, false);
    rig.wait(0.5);
    expect(rig.drill.rammed).toBe(true);
    expect(rig.drill.stats.fumbles).toBe(0);
  });

  it('rams a shell left part-way in with an open hand on its base', () => {
    const rig = new Rig();
    rig.toMouth(0);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - 0.2], 0.5);
    rig.wait(0.1);
    rig.squeeze(rig.right, false);
    rig.wait(0.3);
    expect(rig.drill.rammed).toBe(false);
    const depth = rig.drill.depth;
    expect(depth).toBeGreaterThan(0.1);
    // Bring the open hand behind the base on the bore's line, then push.
    const base = BREECH_MOUTH[2] - (depth - SHELL_LENGTH);
    rig.move(rig.right, [BREECH_MOUTH[0] + 0.2, BREECH_MOUTH[1], base + 0.15]);
    rig.move(rig.right, [BREECH_MOUTH[0], BREECH_MOUTH[1], base + 0.08]);
    expect(rig.drill.depth).toBe(depth);
    rig.move(rig.right, [BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] - 0.02], 0.4);
    expect(rig.drill.rammed).toBe(true);
  });

  it('stops the lever against a shell not rammed home, and counts it as a fumble', () => {
    const rig = new Rig();
    rig.load(0);
    expect(rig.drill.stats.streak).toBe(1);
    rig.drill.fire();
    rig.toMouth(1);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - 0.2], 0.5);
    rig.wait(0.1);
    rig.squeeze(rig.right, false);
    rig.move(rig.right, RIGHT_REST);
    rig.pullLever(LEVER_CLOSED);
    expect(rig.drill.lever).toBeCloseTo(LEVER_BLOCKED, 6);
    expect(rig.drill.loaded).toBe(false);
    expect(rig.drill.stats.blocked).toBe(1);
    expect(rig.drill.stats.fumbles).toBe(1);
    expect(rig.drill.stats.streak).toBe(0);
  });

  it('counts a dropped shell as a fumble and puts it back in the rack', () => {
    const rig = new Rig();
    const c = RACK_SLOTS[2];
    rig.move(rig.right, [c[0], c[1], c[2]]);
    rig.squeeze(rig.right, true);
    rig.move(rig.right, [0.45, 1.9, -0.45]);
    rig.squeeze(rig.right, false);
    expect(rig.drill.shells[2].place).toBe('falling');
    expect(rig.drill.stats.dropped).toBe(1);
    rig.wait(0.6);
    expect(rig.drill.shells[2].place).toBe('floor');
    rig.wait(RETURN_DELAY);
    expect(rig.drill.shells[2].place).toBe('rack');
    expect(rig.seen).toContain('returned');
  });

  it('a hand holding something else takes nothing here', () => {
    const rig = new Rig();
    const c = RACK_SLOTS[0];
    rig.right.busy = true;
    rig.move(rig.right, [c[0], c[1], c[2]]);
    rig.squeeze(rig.right, true);
    expect(rig.drill.holds.right).toBe(HOLD_NONE);
  });

  it('takes the lever without it jumping to the hand', () => {
    const rig = new Rig();
    rig.move(rig.left, [LEVER_PIVOT[0], LEVER_PIVOT[1] + LEVER_LENGTH - 0.03, LEVER_PIVOT[2] + 0.05]);
    rig.squeeze(rig.left, true);
    expect(rig.drill.holds.left).toBe(HOLD_LEVER);
    expect(rig.drill.lever).toBe(0);
  });

  it(`passes after ${STREAK_GOAL} loads in a row without a fumble`, () => {
    const rig = new Rig();
    for (let n = 0; n < STREAK_GOAL; n++) {
      rig.load(n % 4);
      rig.drill.fire();
    }
    expect(rig.drill.stats.loads).toBe(STREAK_GOAL);
    expect(rig.drill.stats.bestStreak).toBe(STREAK_GOAL);
    const lines = boardLines(rig.drill.snapshot(createLoadingSnapshot()));
    expect(lines[0]).toMatch(/^Loads 10 {3}last \d+\.\d s {3}best \d+\.\d s$/);
    expect(lines[1]).toBe('Fumbles 0   10 in a row: passed');
    expect(lines[2]).toBe('Load!');
  });

  it('fires only a loaded breech', () => {
    const rig = new Rig();
    expect(rig.drill.fire()).toBe(false);
    rig.toMouth(0);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - SHELL_LENGTH - 0.05], 0.4);
    // Rammed but the breech still open: no.
    expect(rig.drill.fire()).toBe(false);
    rig.squeeze(rig.right, false);
    rig.move(rig.right, RIGHT_REST, 0.2);
    rig.pullLever(LEVER_CLOSED + 0.2);
    expect(rig.drill.fire()).toBe(true);
    // The breech opened by itself and the rack has its shell again.
    expect(rig.drill.lever).toBe(0);
    expect(rig.drill.shells[0].place).toBe('rack');
    expect(rig.drill.fire()).toBe(false);
    expect(rig.drill.stats.shots).toBe(1);
  });

  it('moves a shell in the breech with the gun as it elevates, and loads with the gun elevated', () => {
    const rig = new Rig();
    rig.toMouth(0);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - SHELL_LENGTH - 0.05], 0.4);
    expect(rig.drill.rammed).toBe(true);
    rig.squeeze(rig.right, false);
    const before = [...rig.drill.shells[0].centre];
    const e = (15 * Math.PI) / 180;
    rig.drill.elevation = e;
    rig.step();
    const s = rig.drill.shells[0];
    // Still on the bore's line, as far in, with the bore tilted up: the breech end dips.
    const inGun = turretToGun(s.centre, e, 0, [0, 0, 0]);
    expect(inGun[0]).toBeCloseTo(0, 6);
    expect(inGun[1]).toBeCloseTo(0, 6);
    expect(inGun[2]).toBeCloseTo(MOUTH_GUN[2] - SHELL_LENGTH / 2, 6);
    expect(s.centre[1]).toBeLessThan(before[1]);
    expect(s.axis[1]).toBeCloseTo(Math.sin(e), 6);

    // A fresh load with the gun at +15°: the mouth has moved, and the nose must point up the bore.
    const up = new Rig();
    up.drill.elevation = e;
    const mouth = gunToTurret(MOUTH_GUN, e, 0, [0, 0, 0]);
    const c = RACK_SLOTS[1];
    up.move(up.right, [c[0], c[1], c[2] + 0.2]);
    up.squeeze(up.right, true);
    // Tilt the hand (and so the shell) up the bore: a turn of 15° about +X.
    const h = e / 2;
    up.right.quat = [Math.sin(h), 0, 0, Math.cos(h)];
    up.step();
    up.move(up.right, up.handForNose([mouth[0], mouth[1] - 0.03 * Math.sin(e), mouth[2] + 0.03 * Math.cos(e)]), 0.4);
    expect(up.drill.breechShell).toBe(1);
  });

  it('recoils the gun and throws each casing into the bin', () => {
    const gun = new GunAction();
    expect(recoilAt(-1)).toBe(0);
    expect(recoilAt(RECOIL.back)).toBeCloseTo(RECOIL.length, 9);
    expect(recoilAt(RECOIL.back + RECOIL.out)).toBe(0);
    gun.fire(10, 0);
    gun.update(10 + RECOIL.back);
    expect(gun.recoil).toBeCloseTo(RECOIL.length, 9);
    // Just thrown: behind the breech mouth, out of the breech.
    const c = gun.casings[0];
    expect(c.centre[2]).toBeGreaterThan(BREECH_MOUTH[2]);
    gun.update(10 + RECOIL.back + CASING_FLIGHT + 0.01);
    expect(gun.recoil).toBeLessThan(0.05);
    for (const n of [0, 1, 2, 3, 4, 5]) {
      if (n > 0) {
        gun.fire(20 + n, 0.1);
        gun.update(20 + n + 1);
      }
      const k = gun.casings[n % CASINGS_KEPT];
      expect(Math.abs(k.centre[0] - CASING_BIN.x)).toBeLessThan(CASING_BIN.halfX);
      expect(Math.abs(k.centre[2] - CASING_BIN.z)).toBeLessThan(CASING_BIN.halfZ);
      expect(k.centre[1]).toBeGreaterThan(TURRET.basketFloor);
      expect(k.centre[1]).toBeLessThan(TURRET.basketFloor + CASING_BIN.height);
      expect(Math.abs(k.axis[1])).toBeLessThan(1e-6);
    }
    expect(gun.thrown).toBe(6);
  });

  it('sends the loading in a packet and draws it between packets', () => {
    const rig = new Rig();
    rig.toMouth(2);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - 0.2], 0.3);
    const a = rig.drill.snapshot(createLoadingSnapshot());
    const buffer = new ArrayBuffer(LOADING_STATE_BYTES);
    const length = encodeLoadingState(buffer, 7, 1234, a);
    expect(length).toBe(LOADING_STATE_BYTES);
    const header = { seq: 0, timeMs: 0 };
    const b = createLoadingSnapshot();
    expect(decodeLoadingState(new DataView(buffer, 0, length), header, b)).toBe(true);
    expect(header).toEqual({ seq: 7, timeMs: 1234 });
    expect(b.breechShell).toBe(2);
    expect(b.depth).toBeCloseTo(a.depth, 3);
    expect(b.rammed).toBe(false);
    expect(Number.isNaN(b.last)).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(b.shells[i].place).toBe(a.shells[i].place);
      for (let k = 0; k < 3; k++) {
        expect(b.shells[i].centre[k]).toBeCloseTo(a.shells[i].centre[k], 3);
        expect(b.shells[i].axis[k]).toBeCloseTo(a.shells[i].axis[k], 3);
      }
    }
    // Something else isn't one.
    const other = new Uint8Array(LOADING_STATE_BYTES);
    other[0] = 7;
    expect(decodeLoadingState(new DataView(other.buffer), header, b)).toBe(false);
    // Halfway between: the lever and a pose blend; a shell that changed place is where it went.
    const from = copyLoadingSnapshot(a, createLoadingSnapshot());
    const to = copyLoadingSnapshot(a, createLoadingSnapshot());
    to.lever = 1;
    to.shells[0].place = 'hand';
    to.shells[0].centre = [0.5, 2, -0.5];
    to.shells[1].centre = [from.shells[1].centre[0] + 0.1, from.shells[1].centre[1], from.shells[1].centre[2]];
    const mid = lerpLoadingSnapshot(from, to, 0.5, createLoadingSnapshot());
    expect(mid.lever).toBeCloseTo(0.5, 9);
    expect(mid.shells[0].place).toBe('hand');
    expect(mid.shells[0].centre).toEqual([0.5, 2, -0.5]);
    expect(mid.shells[1].centre[0]).toBeCloseTo(from.shells[1].centre[0] + 0.05, 9);
  });

  it('rotates and unrotates vectors by a quaternion', () => {
    const q = yaw(90);
    const v = rotate(q, [0, 0, -1], [0, 0, 0]);
    expect(v[0]).toBeCloseTo(-1, 6);
    expect(v[2]).toBeCloseTo(0, 6);
    const back = unrotate(q, v, [0, 0, 0]);
    expect(back[2]).toBeCloseTo(-1, 6);
  });
});

/** A turn of `degrees` about +Y (to the left, seen from above). */
function yaw(degrees: number): [number, number, number, number] {
  const h = (degrees * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
}
