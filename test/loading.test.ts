import { describe, expect, it } from 'vitest';
import {
  boardLines,
  BREECH_MOUTH,
  CAPTURE_ANGLE,
  createDrillHand,
  type DrillHand,
  type DrillEventKind,
  FIRE_DELAY,
  HOLD_LEVER,
  HOLD_NONE,
  LEVER_BLOCKED,
  LEVER_CLOSED,
  LEVER_LENGTH,
  LEVER_PIVOT,
  LoadingDrill,
  RACK_SLOTS,
  RETURN_DELAY,
  rotate,
  SHELL_LENGTH,
  STREAK_GOAL,
  unrotate,
  type Vec3,
} from '../src/sim/loading.js';

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
    this.left.pos = [-0.3, 0.8, 1.6];
    this.right.pos = [0.3, 0.8, 1.6];
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
    this.move(this.right, this.handForNose([-0.1, 1.15, 1.0]), 0.4);
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
    this.move(this.left, [-0.3, 0.8, 1.6], 0.2);
  }

  /** One clean load: rack, breech, ram by pushing, close. */
  load(slot: number): void {
    this.toMouth(slot);
    this.move(this.right, [this.right.pos[0], this.right.pos[1], this.right.pos[2] - SHELL_LENGTH - 0.05], 0.4);
    this.squeeze(this.right, false);
    this.move(this.right, [0.3, 0.8, 1.6], 0.2);
    this.pullLever(LEVER_CLOSED + 0.2);
  }
}

describe('loading drill (spike S4)', () => {
  it('loads a shell: grab from the rack, swing to the breech, ram, close; then fires and opens', () => {
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
    rig.move(rig.right, [0.3, 0.8, 1.6], 0.2);
    const before = rig.drill.time;
    rig.pullLever(LEVER_CLOSED + 0.2);
    expect(rig.drill.lever).toBe(LEVER_CLOSED);
    expect(rig.drill.loaded).toBe(true);
    expect(rig.drill.stats.loads).toBe(1);
    expect(rig.drill.stats.last).toBeGreaterThan(before);
    expect(rig.drill.stats.lastHandling).toBeLessThan(rig.drill.stats.last);
    expect(rig.drill.stats.streak).toBe(1);
    rig.wait(FIRE_DELAY + 0.1);
    expect(rig.seen).toContain('fired');
    expect(rig.drill.loaded).toBe(false);
    expect(rig.drill.lever).toBe(0);
    expect(rig.drill.breechShell).toBe(-1);
    expect(rig.drill.shells[0].place).toBe('rack');
    expect(rig.drill.shells[0].centre).toEqual([...RACK_SLOTS[0]]);
  });

  it('times each load from the breech opening', () => {
    const rig = new Rig();
    rig.load(0);
    rig.wait(FIRE_DELAY + 0.1);
    const opened = rig.drill.readyAt;
    rig.wait(1);
    rig.load(1);
    expect(rig.drill.stats.loads).toBe(2);
    expect(rig.drill.stats.last).toBeCloseTo(rig.drill.fireAt - FIRE_DELAY - opened, 6);
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
    rig.move(rig.right, [0.1, 1.1, base + 0.15]);
    rig.move(rig.right, [BREECH_MOUTH[0], BREECH_MOUTH[1], base + 0.08]);
    expect(rig.drill.depth).toBe(depth);
    rig.move(rig.right, [BREECH_MOUTH[0], BREECH_MOUTH[1], BREECH_MOUTH[2] - 0.02], 0.4);
    expect(rig.drill.rammed).toBe(true);
  });

  it('stops the lever against a shell not rammed home, and counts it as a fumble', () => {
    const rig = new Rig();
    rig.load(0);
    expect(rig.drill.stats.streak).toBe(1);
    rig.wait(FIRE_DELAY + 0.1);
    rig.toMouth(1);
    rig.move(rig.right, [rig.right.pos[0], rig.right.pos[1], rig.right.pos[2] - 0.2], 0.5);
    rig.wait(0.1);
    rig.squeeze(rig.right, false);
    rig.move(rig.right, [0.3, 0.8, 1.6]);
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
    rig.move(rig.right, [0.1, 1.2, 1.0]);
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
      rig.wait(FIRE_DELAY + 0.1);
    }
    expect(rig.drill.stats.loads).toBe(STREAK_GOAL);
    expect(rig.drill.stats.bestStreak).toBe(STREAK_GOAL);
    const lines = boardLines(rig.drill);
    expect(lines[0]).toMatch(/^Loads 10 {3}last \d+\.\d s {3}best \d+\.\d s$/);
    expect(lines[1]).toBe('Fumbles 0   10 in a row: passed');
    expect(lines[2]).toBe('Load!');
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
