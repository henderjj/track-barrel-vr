/**
 * Draws the top-down world map for the docs (docs/world-map.md) from the
 * game's own numbers: bundles scripts/world-map.ts with esbuild, renders
 * the page it builds in headless Chromium and saves a PNG.
 *
 *   node scripts/draw-map.mjs [out.png]
 *
 * (`CHROMIUM_PATH=/path/to/chrome` to use a Chromium other than Playwright's own.)
 *
 * The default is docs/images/world-map.png. Run it again after moving
 * anything on the ground (the range, the course, the lanes, the enemies,
 * the obstacles) and commit the new picture with the change.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'docs/images/world-map.png'));
const work = mkdtempSync(join(tmpdir(), 'world-map-'));

try {
  const bundle = join(work, 'world-map.mjs');
  await build({ entryPoints: [join(root, 'scripts/world-map.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning' });
  const { worldMapPage, MAP_SIZE } = await import(pathToFileURL(bundle).href);
  const page = join(work, 'world-map.html');
  writeFileSync(page, worldMapPage());

  // CHROMIUM_PATH: a Chromium of another version than Playwright's own download, if that is what the machine has.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const tab = await browser.newPage({ viewport: { width: MAP_SIZE.width, height: MAP_SIZE.height }, deviceScaleFactor: 2 });
    await tab.goto(pathToFileURL(page).href);
    await tab.waitForSelector('body[data-ready="1"]');
    await tab.locator('#map').screenshot({ path: out });
  } finally {
    await browser.close();
  }
  console.log(`World map: ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
