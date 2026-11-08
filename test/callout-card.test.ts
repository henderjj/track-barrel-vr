import { describe, expect, it } from 'vitest';
import { CARD_BORDER, CARDS, callsBy, cardText, clockAngle, VOICE_CALLS } from '../src/sim/callout-card.js';
import { EYE_CLEARANCE, GUN, HULL, SEATS, SIGHT_EYEPIECE, TURRET } from '../src/sim/cabin.js';
import { CALL_FROM, CALL_WORDS, CREW_CALLS } from '../src/sim/crew-bot.js';
import { DRIVER_CONTROLS } from '../src/sim/driver-station.js';
import { ELEVATING_GEAR } from '../src/sim/turret.js';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings.js';
import { LIVE_ITEMS } from '../src/live-settings.js';

const DEG = Math.PI / 180;

describe('the callout card (F2.6)', () => {
  it("has every call on the menu's Calls in the words the sign shows, in the seat that makes it and the seat that hears it", () => {
    for (const call of CREW_CALLS) {
      if (call === 'route') continue;
      const from = CALL_FROM[call];
      const to = from === 'driver' ? 'gunner' : 'driver';
      expect(cardText(from).say, call).toContain(CALL_WORDS[call]);
      expect(cardText(to).hear, call).toContain(CALL_WORDS[call]);
      expect(cardText(to).say, call).not.toContain(CALL_WORDS[call]);
    }
    // The practice route is a Practice button, not a crew call.
    expect([...cardText('driver').say, ...cardText('driver').hear]).not.toContain(CALL_WORDS.route);
  });

  it("carries the plan's short calls, the voice-only ones after the buttons'", () => {
    const all = [...callsBy('driver'), ...callsBy('gunner')];
    for (const words of ['Driver, halt', 'On the way!', "Target, tank, 2 o'clock", 'Traverse left', 'Gunner, hold fire']) {
      expect(all, words).toContain(words);
    }
    const driver = callsBy('driver');
    expect(driver.slice(-VOICE_CALLS.driver.length)).toEqual(VOICE_CALLS.driver);
    // The two seats' cards are each other's mirror.
    expect(cardText('driver').hear).toEqual(cardText('gunner').say);
    expect(cardText('gunner').hear).toEqual(cardText('driver').say);
    expect(cardText('driver').sayHeading).toContain('DRIVER');
    expect(cardText('gunner').sayHeading).toContain('GUNNER');
  });

  it('draws 12 at the front and goes round clockwise seen from above: 3 right, 6 behind, 9 left', () => {
    expect(clockAngle(12)).toBe(0);
    expect(clockAngle(3)).toBeCloseTo(Math.PI / 2, 9);
    expect(clockAngle(6)).toBeCloseTo(Math.PI, 9);
    expect(clockAngle(9)).toBeCloseTo((3 * Math.PI) / 2, 9);
    // On the canvas (y down) the 2 is up and to the right of the middle.
    expect(Math.sin(clockAngle(2))).toBeGreaterThan(0);
    expect(-Math.cos(clockAngle(2))).toBeLessThan(0);
  });

  it("hangs the driver's card on the left wall beside their head: a turn of the head, readable, clear of the conduit, the throttle and the head box", () => {
    const c = CARDS.driver;
    const [ex, ey, ez] = SEATS.driver.eye;
    // On the wall, facing into the cabin (+X), 3:2.
    expect(c.yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(c.x).toBeGreaterThan(-HULL.halfWidth);
    expect(c.x).toBeLessThan(-HULL.halfWidth + 0.015);
    expect(c.width / c.height).toBeCloseTo(1.5, 6);
    // 50 to 70 cm from the eyes, a little below them: a turn of the head to the left and a glance down.
    const distance = Math.hypot(c.x - ex, c.y - ey, c.z - ez);
    expect(distance).toBeGreaterThan(0.5);
    expect(distance).toBeLessThan(0.7);
    const down = Math.atan2(ey - c.y, ex - c.x) / DEG;
    expect(down).toBeGreaterThan(5);
    expect(down).toBeLessThan(30);
    // Under the cable conduit (1.62 m, 12 mm round) and over the hand throttle's handle at full travel.
    const top = c.y + c.height / 2 + CARD_BORDER;
    const bottom = c.y - c.height / 2 - CARD_BORDER;
    expect(top).toBeLessThan(1.62 - 0.012 - 0.05);
    const throttle = DRIVER_CONTROLS.throttle;
    expect(bottom).toBeGreaterThan(throttle.pivot[1] + throttle.spec.length + 0.05);
    // In front of the left sponson's ready rounds (from z -1.12) and behind the hood.
    expect(c.z + c.width / 2 + CARD_BORDER).toBeLessThan(-1.12);
    // Leaning to the head box's left edge, the eyes stay EYE_CLEARANCE from the card's face.
    const leanX = ex - SEATS.driver.headBox[0];
    expect(Math.hypot(leanX - c.x, ey - top)).toBeGreaterThan(EYE_CLEARANCE);
  });

  it("hangs the gunner's card on the turret's front wall left of the sight: under the roof's chamfer, clear of the gun and of the eyepiece", () => {
    const c = CARDS.gunner;
    const [ex, ey, ez] = SEATS.gunner.eye;
    // On the front wall's inner face, facing back towards the gunner (+Z).
    expect(c.yaw).toBe(0);
    expect(c.z).toBeGreaterThan(TURRET.front + HULL.wall);
    expect(c.z).toBeLessThan(TURRET.front + HULL.wall + 0.015);
    expect(c.width / c.height).toBeCloseTo(1.5, 6);
    const top = c.y + c.height / 2 + CARD_BORDER;
    const left = c.x - c.width / 2 - CARD_BORDER;
    const right = c.x + c.width / 2 + CARD_BORDER;
    // Under the roof's 12 cm chamfer, clear of the corner's chamfer.
    expect(top).toBeLessThan(TURRET.roof - 0.12);
    expect(left).toBeGreaterThan(-(TURRET.halfWidth - HULL.wall) + 0.12 + 0.05);
    // Left of the breech and of the elevating gear on the gun's right.
    expect(right).toBeLessThan(-GUN.breechHalfWidth - 0.1);
    expect(ELEVATING_GEAR.x).toBeGreaterThan(0);
    // About 1.3 m away, big enough that its lines look at least two thirds the size of the driver's at 60 cm.
    const distance = Math.hypot(c.x - ex, c.y - ey, c.z - ez);
    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(1.35);
    const driverDistance = Math.hypot(CARDS.driver.x - SEATS.driver.eye[0], CARDS.driver.y - SEATS.driver.eye[1], CARDS.driver.z - SEATS.driver.eye[2]);
    expect(c.height / distance).toBeGreaterThan(0.66 * (CARDS.driver.height / driverDistance));
    // From the eye point the card's near edge is further left than the eyepiece's (5 cm round, 18 cm ahead).
    const cardLeftOf = Math.atan2(ex - (c.x + c.width / 2), ez - c.z);
    const eyepiece = Math.atan2(ex - SIGHT_EYEPIECE[0], ez - SIGHT_EYEPIECE[2]) + Math.atan2(0.05, ez - SIGHT_EYEPIECE[2]);
    expect(cardLeftOf).toBeGreaterThan(eyepiece);
  });

  it('shows by default; the Sound and view tab and ?card=0 hide it', () => {
    expect(DEFAULT_SETTINGS.card).toBe(true);
    expect(parseSettings('?card=0').card).toBe(false);
    expect(parseSettings('?card=1').card).toBe(true);
    const item = LIVE_ITEMS.find((i) => i.key === 'card');
    expect(item?.options.map(([value]) => value)).toEqual(['1', '0']);
    expect(item?.current(DEFAULT_SETTINGS)).toBe('1');
  });
});
