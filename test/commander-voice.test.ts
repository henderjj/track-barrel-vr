import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  callSeconds,
  CommanderQueue,
  fireOrder,
  hitCue,
  INTERCOM,
  missCue,
  LINE_IDS,
  LINES,
  phaseCue,
  QUEUE_SIZE,
  rangeLine,
  REPEAT_SECONDS,
  SIGN_LINES,
  signCue,
  STALE_SECONDS,
} from '../src/sim/commander-voice.js';
import { CrewLog } from '../src/sim/crew-board.js';
import { commander } from '../src/sim/commander-voice.js';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.js';
import { VOLUME_ITEMS } from '../src/live-settings.js';

const hit = (over: object) => ({ zone: 'hull-side' as const, through: true, armour: 38, pen: 90, effects: [], right: false, ...over });

describe("the commander's lines (docs/commander-voice.md)", () => {
  it('has a small clip for every line John approved, and no clip without a line', () => {
    expect(LINE_IDS.length).toBe(70);
    for (const id of LINE_IDS) {
      const file = `public/audio/commander/${id}.ogg`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThan(40_000);
    }
    expect(LINES['tank-out']).toBe("Target! Tank's knocked out!");
    expect(LINES['clock-10']).toBe("Ten o'clock!");
    expect(LINES['range-1000']).toBe('One thousand!');
  });

  it('every line a note can call exists', () => {
    for (const id of Object.values(SIGN_LINES)) expect(LINES[id], id).toBeDefined();
    for (const phase of ['on', 'won', 'lost']) for (const id of phaseCue(phase, true) as string[]) expect(LINES[id]).toBeDefined();
  });
});

describe('which line a note calls', () => {
  it('a biathlon board miss: "Missed!" with the first way, then the second on its own, every pair said', () => {
    expect(missCue(['just high'])).toEqual(['missed-just-high']);
    expect(missCue(['short', 'left'])).toEqual(['missed-short', 'left']);
    expect(missCue(['high', 'just right'])).toEqual(['missed-high', 'just-right']);
    expect(missCue([])).toEqual([]);
    const ups = ['just high', 'high', 'just low', 'low', 'short'];
    const sides = ['just left', 'left', 'just right', 'right'];
    for (const first of [...ups, ...sides]) for (const id of missCue([first])) expect(LINES[id], id).toBeDefined();
    for (const up of ups) for (const side of sides) for (const id of missCue([up, side])) expect(LINES[id], id).toBeDefined();
    expect(LINES['missed-high']).toBe('Missed! High!');
  });

  it('a hit: the worst of it first, a bounce, a broken track, no harm', () => {
    expect(hitCue(hit({ effects: ['gunner', 'engine'] }))).toEqual(['hit-engine']);
    expect(hitCue(hit({ effects: ['traverse'] }))).toEqual(['hit-traverse']);
    expect(hitCue(hit({ effects: ['driver'] }))).toEqual(['hit-driver']);
    expect(hitCue(hit({ through: false }))).toEqual(['bounced']);
    expect(hitCue(hit({ effects: [] }))).toEqual(['hit-no-harm']);
    expect(hitCue(hit({ zone: 'running-gear', right: true }))).toEqual(['hit-right-track']);
    expect(hitCue(hit({ zone: 'running-gear', through: false }))).toEqual(['hit-no-harm']);
  });

  it("the driver's and turret's warnings by their sign's title; the ones a driver hears and feels say nothing", () => {
    expect(signCue('Left track thrown')).toEqual(['track-thrown-left']);
    expect(signCue('Engine overheating')).toEqual(['overheating']);
    expect(signCue('No power traverse')).toEqual(['no-power-traverse']);
    expect(signCue('Gears grinding')).toBeUndefined();
  });

  it('the brief, and the debrief by how the fight ended', () => {
    expect(phaseCue('on', false)).toEqual(['brief']);
    expect(phaseCue('won', true)).toEqual(['won-objective']);
    expect(phaseCue('won', false)).toEqual(['won-all']);
    expect(phaseCue('lost', false)).toEqual(['lost']);
    expect(phaseCue('off', false)).toBeUndefined();
  });

  it('a fire order: which way to traverse, what, where on the clock, how far to the hundred', () => {
    expect(fireOrder({ clock: 10, range: 320, traverse: 45 }, false)).toEqual(['traverse-left', 'anti-tank-gun', 'clock-10', 'range-300']);
    expect(fireOrder({ clock: 2, range: 560, traverse: -30 }, true)).toEqual(['traverse-right', 'enemy-tank', 'clock-2', 'range-600']);
    expect(fireOrder({ clock: 12, range: 400, traverse: 5 }, false)[0]).toBe('on-the-gun');
    expect(rangeLine(20)).toBe('range-100');
    expect(rangeLine(1490)).toBe('range-1000');
    for (const id of fireOrder({ clock: 7, range: 870, traverse: -90 }, true)) expect(LINES[id], id).toBeDefined();
  });
});

describe('how calls wait their turn', () => {
  const queue = () => {
    const q = new CommanderQueue();
    let t = 100;
    q.now = () => t;
    return { q, at: (s: number) => (t = s) };
  };

  it('one at a time, in order; old news dropped; no more than a few waiting', () => {
    const { q, at } = queue();
    q.ask(['gun-out']);
    q.ask(['bounced']);
    expect(q.next()).toEqual(['gun-out']);
    at(100 + STALE_SECONDS + 1);
    expect(q.next()).toBeNull();
    for (const id of ['hit-engine', 'hit-driver', 'hit-gunner', 'hit-traverse', 'hit-transmission']) q.ask([id]);
    expect(q.waiting.length).toBe(QUEUE_SIZE);
    expect(q.next()).toEqual(['hit-gunner']);
  });

  it("doesn't say the same call twice straight away (a knock-out's damage and debrief)", () => {
    const { q, at } = queue();
    expect(q.ask(['lost'])).toBe(true);
    expect(q.ask(['lost'])).toBe(false);
    at(100 + REPEAT_SECONDS + 1);
    expect(q.ask(['lost'])).toBe(true);
  });

  it("works a fire order out when it is said, not when it was asked for; each enemy's its own", () => {
    const { q } = queue();
    let clock = 10;
    q.ask(() => [`clock-${clock}`], 'fire-order-0');
    expect(q.ask(() => ['clock-1'], 'fire-order-0')).toBe(false);
    expect(q.ask(() => ['clock-3'], 'fire-order-1')).toBe(true);
    clock = 11;
    expect(q.next()).toEqual(['clock-11']);
    expect(q.said.at(-1)?.lines).toEqual(['clock-11']);
  });

  it("a note on the crew board asks for its call once, as the board logs it once", () => {
    const log = new CrewLog();
    let t = 0;
    log.now = () => t;
    commander.clear();
    const asked = commander.asked;
    log.post('Through the rear: engine hit', 'bad', ['hit-engine']);
    t = 1;
    log.post('Through the rear: engine hit', 'bad', ['hit-engine']);
    log.post('Enemy guns ahead: watch for their flashes');
    expect(commander.asked).toBe(asked + 1);
    expect(commander.next()).toEqual(['hit-engine']);
  });
});

describe('the intercom', () => {
  it("is the heavy setting John chose: a narrow band, driven hard, with the switch's lead-in and hash", () => {
    expect(INTERCOM.low).toBe(450);
    expect(INTERCOM.high).toBe(2500);
    expect(INTERCOM.drive).toBe(7);
    expect(callSeconds([1, 0.5, 0.6, 0.7])).toBeCloseTo(INTERCOM.pre + 2.8 + 3 * INTERCOM.join + INTERCOM.post + INTERCOM.hash, 6);
  });

  it("the Commander setting: full by default, ?commander=0 and the Sound and view tab's slider turn it off or down", () => {
    expect(DEFAULT_SETTINGS.commander).toBe(1);
    expect(parseSettings('?commander=0').commander).toBe(0);
    expect(parseSettings('?commander=0.35').commander).toBe(0.35);
    expect(VOLUME_ITEMS.find((i) => i.key === 'commander')?.label).toBe('Commander');
  });
});
