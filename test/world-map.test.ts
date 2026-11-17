import { describe, expect, it } from 'vitest';
import { MAP_SIZE, MAP_WINDOW, worldMapPage } from '../scripts/world-map.js';
import { TILE } from '../src/sim/terrain.js';

// The docs' world map (docs/world-map.md) is drawn from the game's own numbers by scripts/draw-map.mjs: this keeps its page building as they change.
describe('world map', () => {
  it('builds a page showing the range, the course, the firing lines and the enemies over a little more than one tile', () => {
    const page = worldMapPage();
    for (const words of ['Start', '100 m tank', '500 m tank', 'Biathlon course', 'Penalty loop', 'Line 1 boards, 350–450 m', 'Line 2 boards, 450–550 m', 'Gun A', "Tank B's route", 'Battle objective']) {
      expect(page).toContain(words);
    }
    expect(MAP_WINDOW.east - MAP_WINDOW.west).toBeGreaterThan(TILE);
    expect(MAP_WINDOW.south - MAP_WINDOW.north).toBeGreaterThan(TILE);
    expect(MAP_SIZE.width).toBeGreaterThan(MAP_WINDOW.east - MAP_WINDOW.west);
  });
});
