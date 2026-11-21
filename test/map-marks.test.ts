import { describe, expect, it } from 'vitest';
import {
  createViewer,
  inField,
  kindOf,
  MarkBook,
  MAX_SEE_RANGE,
  MOVED,
  onMap,
  parseMarks,
  parseMarkSeen,
  SEE_FORGET,
  SEE_TIME,
  SeeingClocks,
} from '../src/sim/map-marks.js';
import { ENEMY_COUNT, FIRST_COLUMN, FIRST_TANK } from '../src/sim/enemy-guns.js';
import { COLUMN_VEHICLES } from '../src/sim/column.js';
import { FIELD_MAP } from '../src/sim/field-map.js';
import { TILE } from '../src/sim/terrain.js';

const DEG = Math.PI / 180;
const present = (...on: number[]) => Array.from({ length: ENEMY_COUNT }, (_, i) => on.includes(i));

describe('seeing through a sight (F2.11)', () => {
  const v = createViewer();
  Object.assign(v, { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, halfX: 6 * DEG, halfY: 6 * DEG });

  it('sees what is in its field and in range, not beside it, behind it or too far', () => {
    // Facing north (−Z): 300 m ahead, a little left and right.
    expect(inField(v, 0, 2, -300)).toBe(true);
    expect(inField(v, -25, 2, -300)).toBe(true);
    expect(inField(v, 25, 2, -300)).toBe(true);
    expect(inField(v, 40, 2, -300)).toBe(false);
    expect(inField(v, 0, 2, 300)).toBe(false);
    expect(inField(v, 0, 2, -(MAX_SEE_RANGE + 10))).toBe(false);
    // Too high or low for the field.
    expect(inField(v, 0, 60, -300)).toBe(false);
  });

  it('turns with the turret: positive yaw looks left (west, facing north)', () => {
    const left = { ...v, yaw: 90 * DEG };
    expect(inField(left, -300, 2, 0)).toBe(true);
    expect(inField(left, 300, 2, 0)).toBe(false);
    // Across the ±180° seam.
    const back = { ...v, yaw: 179 * DEG };
    expect(inField(back, 2, 2, 300)).toBe(true);
  });

  it('follows the gun up and down', () => {
    const up = { ...v, pitch: 5 * DEG };
    expect(inField(up, 0, 2 + Math.tan(5 * DEG) * 300, -300)).toBe(true);
    expect(inField(up, 0, 2 - 30, -300)).toBe(false);
  });

  it('takes SEE_TIME in view to see an enemy, and forgets slowly out of it', () => {
    const c = new SeeingClocks();
    let seen = false;
    let t = 0;
    while (!seen && t < 5) {
      seen = c.step(3, true, 0.1);
      t += 0.1;
    }
    expect(t).toBeCloseTo(SEE_TIME, 1);
    // Half seen, then out of view for a moment: still most of the way.
    c.step(3, true, SEE_TIME / 2);
    c.step(3, false, 0.2);
    expect(c.t[3]).toBeCloseTo(SEE_TIME / 2 - 0.2 * SEE_FORGET, 5);
    c.clear();
    expect(c.t[3]).toBe(0);
  });
});

describe('the mark book (F2.11)', () => {
  it('pencils each enemy once, numbered in the order seen, to 10 m', () => {
    const b = new MarkBook();
    expect(b.seen(1, -91.6, -368.2, 'seen')).toBe(true);
    expect(b.seen(0, -200, -220, 'seen')).toBe(true);
    expect(b.seen(1, -90, -370, 'seen')).toBe(false);
    expect(b.marks.map((m) => [m.enemy, m.n, m.x, m.z, m.kind])).toEqual([
      [1, 1, -90, -370, 'gun'],
      [0, 2, -200, -220, 'gun'],
    ]);
    expect(b.v).toBe(2);
  });

  it('moves a tank seen again further on, but never a gun', () => {
    const b = new MarkBook();
    const tank = FIRST_TANK;
    b.seen(tank, 0, -400, 'seen');
    expect(b.seen(tank, MOVED / 2, -400, 'seen')).toBe(false);
    expect(b.seen(tank, 0, -400 - 2 * MOVED, 'seen')).toBe(true);
    expect(b.marks[0].z).toBe(-450);
    expect(b.marks[0].n).toBe(1);
    b.seen(0, -200, -220, 'seen');
    expect(b.seen(0, -100, -220, 'seen')).toBe(false);
  });

  it('marks a flash as uncertain until the enemy is seen', () => {
    const b = new MarkBook();
    b.seen(2, -110, -280, 'flash');
    expect(b.marks[0].how).toBe('flash');
    expect(b.seen(2, -110, -280, 'seen')).toBe(true);
    expect(b.marks[0].how).toBe('seen');
  });

  it('crosses out what is knocked out, once, and only what it has marked', () => {
    const b = new MarkBook();
    b.seen(0, -200, -220, 'seen');
    expect(b.knockedOut(0)).toBe(true);
    expect(b.knockedOut(0)).toBe(false);
    expect(b.knockedOut(1)).toBe(false);
    expect(b.marks[0].out).toBe(true);
    // A knocked-out tank stays where it was crossed out.
    b.seen(FIRST_TANK, 0, -400, 'seen');
    b.knockedOut(FIRST_TANK);
    expect(b.seen(FIRST_TANK, 0, -500, 'seen')).toBe(false);
  });

  it('rubs out the marks of enemies gone, and numbers from 1 again on a clean map', () => {
    const b = new MarkBook();
    b.seen(0, -200, -220, 'seen');
    b.seen(1, -90, -370, 'seen');
    expect(b.keep(present(0, 1))).toBe(false);
    expect(b.keep(present(1))).toBe(true);
    expect(b.marks.map((m) => m.enemy)).toEqual([1]);
    b.keep(present());
    b.seen(2, -110, -280, 'seen');
    expect(b.marks[0].n).toBe(1);
  });

  it('goes to the guest whole, and an older book never replaces a newer one', () => {
    const host = new MarkBook();
    host.seen(0, -200, -220, 'seen');
    host.seen(FIRST_TANK, 10, -400, 'flash');
    host.knockedOut(0);
    const guest = new MarkBook();
    const sent = JSON.parse(JSON.stringify(host.encode()));
    expect(guest.apply(sent)).toBe(true);
    expect(guest.marks).toEqual(host.marks);
    expect(guest.v).toBe(host.v);
    expect(guest.apply(sent)).toBe(false);
    const older = { ...sent, v: sent.v - 1, m: [] };
    expect(guest.apply(older)).toBe(false);
    expect(guest.marks.length).toBe(2);
  });

  it('turns away a malformed book or sighting', () => {
    expect(parseMarks(null)).toBeNull();
    expect(parseMarks({ t: 'marks', v: 1, m: [[0, 1, 2]] })).toBeNull();
    expect(parseMarks({ t: 'marks', v: 1, m: [[ENEMY_COUNT, 0, 0, 1, 0]] })).toBeNull();
    expect(parseMarks({ t: 'marks', v: 1, m: [[0, Number.NaN, 0, 1, 0]] })).toBeNull();
    expect(parseMarkSeen({ t: 'mark-seen', i: 1.5, x: 0, z: 0 })).toBeNull();
    expect(parseMarkSeen({ t: 'mark-seen', i: -1, x: 0, z: 0 })).toBeNull();
    expect(parseMarkSeen({ t: 'mark-seen', i: 2, x: 5, z: -7 })).toEqual({ i: 2, x: 5, z: -7 });
  });

  it("pencils a far copy of the repeating ground at its place on the map's copy", () => {
    const at = onMap(-200 + TILE, -220 - TILE, [0, 0]);
    expect(at).toEqual([-200, -220]);
    const b = new MarkBook();
    b.seen(0, -200 - 2 * TILE, -220, 'seen');
    const m = b.marks[0];
    expect(m.x).toBeGreaterThanOrEqual(FIELD_MAP.west);
    expect(m.x).toBeLessThanOrEqual(FIELD_MAP.east);
    expect([m.x, m.z]).toEqual([-200, -220]);
  });

  it('draws guns as guns, tanks as tanks and lorries as lorries', () => {
    expect(kindOf(0)).toBe('gun');
    expect(kindOf(FIRST_TANK)).toBe('tank');
    COLUMN_VEHICLES.forEach((v, k) => expect(kindOf(FIRST_COLUMN + k)).toBe(v.kind === 'tank' ? 'tank' : 'lorry'));
  });
});
