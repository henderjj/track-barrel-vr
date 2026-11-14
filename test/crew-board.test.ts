import { describe, expect, it } from 'vitest';
import { type BoardInput, BOARD_CALLS, boardClock, boardKey, BOARDS, boardText, CrewLog, crewLines, damageLines, damageZones, LOG_SIZE, SAME_CALL_SECONDS, toGo } from '../src/sim/crew-board.js';
import { Matrix4, Vector3 } from '@iwsdk/core';
import { EYE_CLEARANCE, frontAt, HULL, SEATS, TURRET } from '../src/sim/cabin.js';
import { DRIVER_CONTROLS } from '../src/sim/driver-station.js';
import { createCrewBoard } from '../src/scene-assets/crew-board.scene-asset.js';
import { BOARD_BORDER, BOARD_THICK, CLIP, PAPER_GAP } from '../src/sim/crew-board.js';
import { noScenario, SCENARIO } from '../src/sim/combat.js';
import { freshDamage } from '../src/sim/damage.js';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.js';
import { LIVE_ITEMS } from '../src/live-settings.js';

function input(over: Partial<BoardInput> = {}): BoardInput {
  return {
    clock: 0,
    timed: false,
    scenario: noScenario(),
    tankZ: 0,
    guns: { out: 0, total: 0, in: false },
    tanks: { out: 0, total: 0, in: false },
    damage: freshDamage(),
    loaded: null,
    rack: { ap: 0, he: 0, smoke: 0 },
    drill: '',
    drillTasks: [],
    calls: [],
    ...over,
  };
}

describe('the crew log (F6.5)', () => {
  it('keeps the newest calls, newest first on the board', () => {
    const log = new CrewLog();
    let t = 0;
    log.now = () => t;
    for (let i = 0; i < LOG_SIZE + 3; i++) {
      t = i * 10;
      log.post(`Call ${i}`);
    }
    expect(log.entries.length).toBe(LOG_SIZE);
    expect(log.latest(BOARD_CALLS).map((c) => c.text)).toEqual([`Call ${LOG_SIZE + 2}`, `Call ${LOG_SIZE + 1}`, `Call ${LOG_SIZE}`]);
  });

  it('takes the same words again straight away as the same call (a sign redrawn), but logs them again later', () => {
    const log = new CrewLog();
    let t = 5;
    log.now = () => t;
    log.post('Engine hot: Change up or ease off the revs');
    const v = log.v;
    t += SAME_CALL_SECONDS / 2;
    log.post('Engine hot: Change up or ease off the revs');
    expect(log.entries.length).toBe(1);
    expect(log.v).toBe(v);
    t += SAME_CALL_SECONDS * 2;
    log.post('Engine hot: Change up or ease off the revs');
    expect(log.entries.length).toBe(2);
    expect(log.post('')).toBeNull();
  });

  it("updates a call in place (an enemy's bearing as the tank turns), bumping the version only on a change", () => {
    const log = new CrewLog();
    const call = log.post("Gun A firing, 2 o'clock, 300 m", 'info')!;
    const v = log.v;
    log.update(call, "Gun A firing, 2 o'clock, 300 m", '');
    expect(log.v).toBe(v);
    log.update(call, "Gun A firing, 1 o'clock, 290 m", 'Traverse right 30°');
    expect(log.v).toBe(v + 1);
    expect(log.latest(1)[0].detail).toBe('Traverse right 30°');
  });
});

describe('what the crew board says (F6.5)', () => {
  it('writes the clock in minutes and seconds', () => {
    expect(boardClock(0)).toBe('0:00');
    expect(boardClock(42.9)).toBe('0:42');
    expect(boardClock(725)).toBe('12:05');
    expect(boardClock(-3)).toBe('0:00');
  });

  it('in the fight: the objective and how far to go, the advance and the enemies to knock out', () => {
    const scenario = { ...noScenario(), phase: 'on' as const, time: 42, spottedAt: -1 };
    const t = boardText(input({ scenario, timed: true, clock: 42, tankZ: -20, guns: { out: 1, total: 3, in: true }, tanks: { out: 0, total: 2, in: false } }));
    expect(t.clock).toBe('0:42');
    expect(t.objective).toBe(`The 500 m board, ${toGo(-20)} m`);
    expect(toGo(-20)).toBe(460);
    expect(toGo(SCENARIO.objectiveZ - 30)).toBe(0);
    expect(t.tasks).toEqual([
      { text: 'Advance to contact', done: false },
      { text: 'Guns: 1 of 3 out', done: false },
      { text: 'Tanks: not seen yet', done: false },
    ]);
    const later = boardText(input({ scenario: { ...scenario, spottedAt: 12 }, guns: { out: 3, total: 3, in: true }, tanks: { out: 1, total: 2, in: true } }));
    expect(later.tasks.map((k) => k.done)).toEqual([true, true, false]);
    expect(later.tasks[2].text).toBe('Tanks: 1 of 2 out');
  });

  it('after the fight: the debrief', () => {
    const scenario = { ...noScenario(), phase: 'lost' as const, time: 118, killed: 2, enemies: 5, hits: 4, through: 3 };
    const t = boardText(input({ scenario, timed: true, clock: 118 }));
    expect(t.objective).toBe('Knocked out after 1:58');
    expect(t.tasks[0]).toEqual({ text: '2 of 5 enemies out', done: false });
  });

  it("a drill's own lines when no fight is on, and something to do when nothing is", () => {
    expect(boardText(input({ drill: 'Range run', drillTasks: ['Targets 1/3   Shots 2', '0:12.4'] })).objective).toBe('Range run');
    const idle = boardText(input());
    expect(idle.objective).toContain('free driving');
    expect(idle.clock).toBe('');
  });

  it('the round in the gun and what the rack holds', () => {
    const t = boardText(input({ loaded: 'he', rack: { ap: 3, he: 0, smoke: 1 } }));
    expect(t.round).toBe('HE');
    expect(t.rack).toBe('Rack: AP 3, Smoke 1');
    const empty = boardText(input());
    expect(empty.round).toBe('Empty');
    expect(empty.rack).toBe('Rack: empty');
  });

  it('the damage in words, red, and hatched on the drawing; the crew and the hits', () => {
    const d = { ...freshDamage(), engine: 1, immobile: 'left-track' as const, traverse: true, gunner: 2, hits: 4, through: 2 };
    expect(damageLines(d).map((l) => l.text)).toEqual(['Engine hit: weak, runs hot', 'Left track broken', 'Power traverse out: crank']);
    expect(damageLines(d).every((l) => l.bad)).toBe(true);
    expect(damageZones(d)).toEqual({ engine: true, leftTrack: true, rightTrack: false, transmission: false, turret: true, driver: false, gunner: true });
    expect(crewLines(d)).toEqual([{ text: 'Gunner badly wounded', bad: true }]);
    expect(boardText(input({ damage: d })).hits).toBe('4 (2 through)');
    const out = { ...freshDamage(), engine: 2, out: true, hits: 5, through: 3 };
    expect(damageLines(out).map((l) => l.text)).toEqual(['KNOCKED OUT']);
    expect(damageLines(freshDamage())).toEqual([{ text: 'None', bad: false }]);
    expect(crewLines(freshDamage())).toEqual([{ text: 'Both fit', bad: false }]);
  });

  it('the latest calls with their times, and a digest that changes whenever the face would', () => {
    const log = new CrewLog();
    let t = 40;
    log.now = () => t;
    log.post("Gun A firing, 2 o'clock, 300 m", 'info');
    t = 97;
    const hit = log.post('Through the left side: left track broken', 'bad')!;
    const a = boardText(input({ calls: log.latest(BOARD_CALLS) }));
    expect(a.calls.map((c) => `${c.time} ${c.text}`)).toEqual(['1:37 Through the left side: left track broken', "0:40 Gun A firing, 2 o'clock, 300 m"]);
    expect(a.calls[0].tone).toBe('bad');
    log.update(hit, hit.text, 'Traverse left 20°');
    const b = boardText(input({ calls: log.latest(BOARD_CALLS) }));
    expect(boardKey(b)).not.toBe(boardKey(a));
    expect(boardKey(boardText(input({ calls: log.latest(BOARD_CALLS) })))).toBe(boardKey(b));
  });
});

describe('where the crew boards hang (F6.5)', () => {
  const faceOf = (seat: 'driver' | 'gunner') => {
    const b = BOARDS[seat];
    // The face looks along its +Z, turned by yaw about Y, then tilted back.
    const normal = [Math.sin(b.yaw) * Math.cos(b.tilt), Math.sin(b.tilt), Math.cos(b.yaw) * Math.cos(b.tilt)];
    const [ex, ey, ez] = SEATS[seat].eye;
    const to = [ex - b.x, ey - b.y, ez - b.z];
    const distance = Math.hypot(...to);
    return { b, distance, cos: (to[0] * normal[0] + to[1] * normal[1] + to[2] * normal[2]) / distance };
  };

  it('faces each seat from close enough to read, the same 4:3 as its canvas', () => {
    for (const seat of ['driver', 'gunner'] as const) {
      const { b, distance, cos } = faceOf(seat);
      expect(b.width / b.height, seat).toBeCloseTo(4 / 3, 6);
      expect(cos, seat).toBeGreaterThan(0.75);
      expect(distance, seat).toBeGreaterThan(0.45);
      expect(distance, seat).toBeLessThan(1);
      // Its writing looks at least as big as the callout card's driver's lines (36 px on 24 cm at 63 cm).
      expect((b.height / 768) * 36 / distance, seat).toBeGreaterThan(0.95 * ((0.24 / 800) * 36) / 0.63);
    }
  });

  it('stays out of the head box and inside the armour', () => {
    const d = BOARDS.driver;
    expect(Math.abs(d.x) + d.width / 2).toBeLessThan(HULL.halfWidth);
    expect(d.y + d.height / 2).toBeLessThan(HULL.roof);
    const g = BOARDS.gunner;
    expect(g.x).toBeLessThan(TURRET.halfWidth - HULL.wall);
    expect(g.y + g.height / 2).toBeLessThan(TURRET.roof);
    for (const seat of ['driver', 'gunner'] as const) {
      const { distance } = faceOf(seat);
      expect(distance - BOARDS[seat].height / 2, seat).toBeGreaterThan(EYE_CLEARANCE);
    }
  });

  // Every point of a board's model (board, clip and brackets), in its seat's frame.
  const pointsOf = (seat: 'driver' | 'gunner') => {
    const board = createCrewBoard(BOARDS[seat]);
    board.updateMatrixWorld(true);
    const p = board.geometry.attributes.position;
    return Array.from({ length: p.count }, (_, i) => new Vector3().fromBufferAttribute(p, i).applyMatrix4(board.matrixWorld));
  };

  it("every corner is inside the armour: the driver's off the glacis and the hood, the gunner's on the turret's front wall", () => {
    for (const v of pointsOf('driver')) {
      expect(v.z - frontAt(v.y), `driver's board at ${v.toArray()}`).toBeGreaterThan(0.01);
      expect(Math.abs(v.x)).toBeLessThan(HULL.halfWidth - 0.01);
      expect(v.y).toBeLessThan(HULL.roof - 0.01);
    }
    for (const v of pointsOf('gunner')) {
      expect(v.z, `gunner's board at ${v.toArray()}`).toBeGreaterThan(TURRET.front + HULL.wall - 0.001);
      expect(Math.abs(v.x)).toBeLessThan(TURRET.halfWidth - HULL.wall);
    }
  });

  it("is clear of the driver's hands on the right tiller and the gear lever, through their whole travel", () => {
    const b = BOARDS.driver;
    const board = createCrewBoard(b);
    board.updateMatrixWorld(true);
    const toBoard = new Matrix4().copy(board.matrixWorld).invert();
    const half = [b.width / 2 + BOARD_BORDER, b.height / 2 + BOARD_BORDER];
    const back = -PAPER_GAP - BOARD_THICK - 0.03;
    // How far a point is from the board's box (its brackets' depth behind it, the clip in front).
    const gap = (p: Vector3) => {
      const q = p.clone().applyMatrix4(toBoard);
      const dx = Math.max(Math.abs(q.x) - half[0], 0);
      const dy = Math.max(Math.abs(q.y) - half[1], 0);
      const dz = Math.max(back - q.z, q.z - CLIP.proud, 0);
      return Math.hypot(dx, dy, dz);
    };
    const nearest = (id: 'tillerRight' | 'gear') => {
      const { spec, pivot } = DRIVER_CONTROLS[id];
      let min = Infinity;
      for (let a = spec.min; a <= spec.max + 1e-9; a += (spec.max - spec.min) / 20) {
        // The grip, along the lever's top, swung fore and aft about X either way.
        for (const sign of [1, -1]) {
          for (let k = 0; k <= 4; k++) {
            const r = spec.length - ((spec.gripLength ?? 0.05) * k) / 4;
            min = Math.min(min, gap(new Vector3(pivot[0], pivot[1] + r * Math.cos(a), pivot[2] - sign * r * Math.sin(a))));
          }
        }
      }
      return min;
    };
    // A hand round the grip reaches about 6 cm from it.
    expect(nearest('tillerRight')).toBeGreaterThan(0.08);
    expect(nearest('gear')).toBeGreaterThan(0.1);
  });

  it('the Pop-ups setting is off by default; ?popups=1 and the Sound and view tab turn it on', () => {
    expect(DEFAULT_SETTINGS.popups).toBe(false);
    expect(parseSettings('?popups=1').popups).toBe(true);
    const item = LIVE_ITEMS.find((i) => i.key === 'popups');
    expect(item?.options.map(([value]) => value)).toEqual(['0', '1']);
    expect(item?.current(DEFAULT_SETTINGS)).toBe('0');
  });
});
