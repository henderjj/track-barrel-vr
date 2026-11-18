// Runs the bake page (bake.ts) in a headless browser and writes what it makes into public/models/crewman/.
// Usage (with the page served, see README.md): node scripts/crewman-bake/export.mjs [http://localhost:8099/]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:8099/';
const out = new URL('../../public/models/crewman/', import.meta.url);
const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error', e.message));
  await page.goto(url);
  await page.waitForFunction('window.done === true', null, { timeout: 240000 });
  mkdirSync(out, { recursive: true });
  writeFileSync(new URL('crewman.glb', out), Buffer.from(await page.evaluate('window.glb'), 'base64'));
  const mask = await page.evaluate('window.mask');
  writeFileSync(new URL('crewman-crew-mask.png', out), Buffer.from(mask.split(',')[1], 'base64'));
  console.log(JSON.stringify(await page.evaluate('window.exportInfo')));
} finally {
  await browser.close();
}
