#!/usr/bin/env node
/**
 * Headless XR smoke test.
 *
 * Drives the IWSDK managed browser (an emulated Meta Quest 3, through IWER,
 * IWSDK's browser-based XR emulator) with the @iwsdk/cli surface:
 *
 *  0. enters an immersive session, picks Play solo on the start screen with
 *     a controller ray, and works the game menu (Y) with the ray;
 *  1. checks this player's own hands are drawn and posed by the controller
 *     (flat, fist, point, thumbs-up);
 *  1b. sits in the driver's seat (the cabin, F1.1): the eyes over its eye
 *     point, a lean stopped at the head box's edge, a recentre put back in
 *     the seat, and the game menu's Practice row moving them to the
 *     gunner's seat in the turret basket and back;
 *  1c. picks a character height and seated play and checks the eyes and
 *     hands are raised to it;
 *  2. checks the 90 Hz request ran and the platform report (spike S8);
 *  2c. looks through the gunsight (spike S1): it opens as the head leans in,
 *     renders a picture of the range, closes as it leans back;
 *  6. switches to tracked hands (spike S9) and grips with a pinch;
 *  7. checks the perf CSV has rows, then re-enters XR with the frame-rate
 *     API removed, as desktop Chrome and Edge over Link may have it, and
 *     checks the game measures the refresh rate instead; IWSDK's controller
 *     models never loaded and no console errors were logged.
 *
 * Add a numbered step for each feature you add (see the building skill in
 * .claude/skills/), with a screenshot where it helps a review.
 *
 * Usage: npm run test:xr   (starts the dev runtime headless if needed)
 * Exit code 0 = all checks passed. Screenshots go to artifacts/.
 */


import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const CLI = fileURLToPath(new URL('../node_modules/@iwsdk/cli/dist/cli.js', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// CLI calls and page evaluations go through a worker thread that keeps the
// CLI loaded and one browser connection open (see scripts/iwsdk-worker.mjs);
// a fresh process per call cost about a second each. IWSDK_SPAWN=1 goes back
// to a process per call.
const shared = new SharedArrayBuffer(8 + 32 * 1024 * 1024);
const header = new Int32Array(shared, 0, 2);
const worker = process.env.IWSDK_SPAWN
  ? null
  : new Worker(new URL('./iwsdk-worker.mjs', import.meta.url), { workerData: { root: ROOT, shared } });
worker?.unref();

/** Sends a request to the worker and waits for its answer: { stdout } or { error }. */
function ask(request) {
  Atomics.store(header, 0, 0);
  worker.postMessage(request);
  if (Atomics.wait(header, 0, 0, 300000) === 'timed-out') throw new Error(`no answer to ${JSON.stringify(request)} in 300 s`);
  const text = new TextDecoder().decode(new Uint8Array(shared, 8, Atomics.load(header, 1)).slice());
  return JSON.parse(text);
}


const SQUEEZE = 1; // gamepad button index for proximity grab

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function iwsdk(args, input) {
  const argv = [CLI, ...args];
  if (input !== undefined) argv.push('--input-json', JSON.stringify(input));
  let stdout;
  if (worker) {
    const reply = ask({ kind: 'cli', argv: argv.slice(1) });
    if (reply.error) throw new Error(`iwsdk ${args.join(' ')}: ${reply.error}`);
    stdout = reply.stdout;
  } else try {
    stdout = execFileSync(process.execPath, argv, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    stdout = error.stdout ?? '';
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`iwsdk ${args.join(' ')}: unparseable output\n${stdout}`);
  }
  if (!parsed.ok) {
    throw new Error(`iwsdk ${args.join(' ')} failed: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.data;
}

/** Evaluate an expression in the app frame (needs --allow-browser-automation). */
function evalInApp(expression) {
  if (worker) {
    const reply = ask({ kind: 'eval', expression });
    if (reply.error) throw new Error(`evaluating ${expression.slice(0, 80)}: ${reply.error}`);
    const data = JSON.parse(reply.stdout);
    if (!data.ok) throw new Error(`iwsdk browser run failed: ${JSON.stringify(data.error)}`);
    return data.data.result?.value ?? data.data.result;
  }
  const file = 'artifacts/.eval.mjs';
  writeFileSync(
    `${ROOT}/${file}`,
    `export default async function run({ page, frame }) {\n` +
      `  const target = frame ?? page;\n` +
      `  return await target.evaluate(() => (${expression}));\n}\n`,
  );
  try {
    const data = iwsdk(['browser', 'run', file, '--timeout', '20000']);
    return data.result?.value ?? data.result;
  } finally {
    rmSync(`${ROOT}/${file}`, { force: true });
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!pass && process.env.GITHUB_ACTIONS) {
    // An annotation shows on the run summary without needing the full log.
    console.log(`::error title=XR check failed::${name}${detail ? ` (${detail})` : ''}`.replace(/\r?\n/g, ' '));
  }
}

async function waitFor(label, fn, timeoutMs = 60000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function findEntity(name) {
  const { result } = iwsdk(['ecs', 'find'], { namePattern: name, limit: 5 });
  return result.entities.find((entity) => entity.name === name);
}

function position(entityIndex) {
  const { result } = iwsdk(['ecs', 'query'], { entityIndex, components: ['Transform'] });
  return result.components.find((c) => c.componentId === 'Transform').values.position;
}

function grabbedNames() {
  const { result } = iwsdk(['ecs', 'find'], { withComponents: ['Grabbed'], limit: 10 });
  return result.entities.map((entity) => entity.name);
}

/**
 * Controller and headset poses are in the XR origin's space; the seat
 * system moves and turns the origin to put the player in their seat, so
 * convert world (hull space) targets into it.
 */
function toOrigin(p) {
  const [x, y, z] = evalInApp(`window.__debug.world.player.worldToLocal(window.__debug.world.player.position.clone().set(${p.join(',')})).toArray()`);
  return { x, y, z };
}

const fmt = (p) => p.map((v) => v.toFixed(3)).join(', ');
async function ensureRuntime() {
  console.log('Starting (or attaching to) the headless dev runtime...');
  iwsdk(['dev', 'up', '--headless', '--allow-browser-automation', '--timeout', '120000']);
  await waitFor('managed browser', () => iwsdk(['dev', 'status']).state?.browserCommandReady === true, 180000, 2000);
  try {
    evalInApp('1');
  } catch (error) {
    if (!String(error.message).includes('automation')) throw error;
    console.log('Restarting the runtime with browser automation enabled...');
    iwsdk(['dev', 'down']);
    iwsdk(['dev', 'up', '--headless', '--allow-browser-automation', '--timeout', '120000']);
    await waitFor('managed browser', () => iwsdk(['dev', 'status']).state?.browserCommandReady === true, 180000, 2000);
  }
}

/** World position of element `id` on scene panel `panel`. */
function elementPosition(panel, id) {
  return evalInApp(`(() => { const w = window.__debug.world; const p = w.getSceneObject('${panel}').getElementById('${id}').getWorldPosition(w.player.head.position.clone()); return [p.x, p.y, p.z]; })()`);
}

/** Point the right controller's ray at `target` from a little in front of the head, and pull the trigger. */
async function rayClick(target) {
  const from = [target[0] + 0.2, target[1] - 0.45, target[2] + 0.55];
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', position: toOrigin(from) });
  const o = toOrigin(target);
  iwsdk(['xr', 'look-at'], { device: 'controller-right', target: o });
  // Clicks closer together than the slow CLI calls used to space them (a
  // couple of seconds) were sometimes lost on CI runners, so aim, wait,
  // click and wait about as long as before. The trigger is held for half a
  // second: software rendering can drop to a few frames a second with the
  // menu open, and a press shorter than a frame is never seen.
  await sleep(1000);
  iwsdk(['xr', 'select'], { device: 'controller-right', duration: 0.5 });
  await sleep(1000);
}

/**
 * 0. The start screen stands in front of the player as VR starts, and a
 *    controller ray picks Play solo on it, after which nothing is left in
 *    front of them. Y on the left controller opens the game menu in front
 *    of them, the ray turns the perf HUD off and on again, picks seated
 *    play, steps the height and picks a coat, and another press closes it.
 */
async function startScreenAndMenu() {
  const start = await waitFor('the start screen in front of the player', () => {
    const s = evalInApp('({ page: window.__startScreen.page, visible: window.__startScreen.visible, at: window.__startScreen.position() })');
    return s.visible && s.at[2] < -0.5 ? s : null;
  }, 10000).catch(() => evalInApp('({ page: window.__startScreen.page, visible: window.__startScreen.visible, at: window.__startScreen.position() })'));
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-start-screen.png'], {});
  await rayClick(elementPosition('start-panel', 'start-solo'));
  const after = evalInApp('({ page: window.__startScreen.page, mode: window.__startScreen.mode, visible: window.__startScreen.visible })');
  check('The start screen stands in front of the player in VR, and a ray click on Play solo starts the game',
    start.page === 'home' && start.visible && after.page === null && after.mode === 'solo' && !after.visible,
    `shown ${start.page} at ${fmt(start.at)}, then ${after.page ?? 'closed'} (${after.mode})`);

  const menuButton = async () => {
    iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 1 }] });
    await sleep(300);
    iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 0 }] });
    await sleep(300);
  };
  await menuButton();
  const opened = evalInApp('({ open: window.__gameMenu.open, at: window.__gameMenu.position(), exit: window.__gameMenu.shown("menu-exit") })');
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-game-menu.png'], {});
  const hud = () => evalInApp('({ on: window.__settings.hud, offLit: window.__gameMenu.selected("row-hud-1") })');
  await rayClick(elementPosition('menu-panel', 'row-hud-1'));
  const off = hud();
  await rayClick(elementPosition('menu-panel', 'row-hud-0'));
  const on = hud();
  const seatedNow = () => evalInApp('window.__body.state.choice.seated');
  await rayClick(elementPosition('menu-panel', 'row-seated-1'));
  const seated = seatedNow();
  await rayClick(elementPosition('menu-panel', 'row-seated-0'));
  const standing = !seatedNow();
  const heightNow = () => evalInApp('window.__body.state.choice.height');
  await rayClick(elementPosition('menu-panel', 'height-up'));
  const up1 = heightNow();
  await rayClick(elementPosition('menu-panel', 'height-up'));
  const up2 = heightNow();
  await rayClick(elementPosition('menu-panel', 'height-own'));
  const own = heightNow();
  const swatches = () => evalInApp(`(() => { const a = window.__debug.world.getSceneObject('menu-panel'); const out = []; for (let i = 0; i < 8; i++) { const e = a.getElementById('coat-' + i); const size = e.size.peek(); out.push({ ring: String(e.properties.peek().borderColor) !== 'rgba(0, 0, 0, 0)', round: Math.abs(size[0] - size[1]) < 0.5 }); } return out; })()`);
  await rayClick(elementPosition('menu-panel', 'coat-2'));
  await rayClick(elementPosition('menu-panel', 'coat-5'));
  const coats = swatches();
  const ringed = coats.map((c, i) => (c.ring ? i : -1)).filter((i) => i >= 0);
  await menuButton();
  const closed = evalInApp('window.__gameMenu.open');
  check('The coat swatches are round, and only the colour picked last has a ring',
    coats.every((c) => c.round) && ringed.length === 1 && ringed[0] === 5,
    `ringed ${ringed.join(', ') || 'none'}, ${coats.filter((c) => !c.round).length} not round`);
  check('Y opens the game menu in front of the player, its ray turns the perf HUD off and on, and it closes again',
    opened.open && opened.at[2] < -0.5 && opened.exit && !off.on && off.offLit && on.on && !on.offLit && !closed,
    `opened ${opened.open} at ${fmt(opened.at)}, HUD ${off.on ? 'on' : 'off'} then ${on.on ? 'on' : 'off'}, closed ${!closed}`);
  check('The game menu picks seated or standing play, and steps the character height 5 cm at a time',
    seated && standing && up1 > 0 && Math.abs(up2 - up1 - 0.05) < 1e-6 && own === 0,
    `seated ${seated}, standing ${standing}, height ${up1} then ${up2} m, then ${own === 0 ? 'their own' : own}`);

  // B on the right controller closes the menu too.
  const bButton = async () => {
    iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 4, value: 1 }] });
    await sleep(300);
    iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 4, value: 0 }] });
    await sleep(300);
  };
  await menuButton();
  const reopened = evalInApp('({ open: window.__gameMenu.open, seats: window.__gameMenu.shown("row-seat-0") && window.__gameMenu.shown("row-seat-1"), driverLit: window.__gameMenu.selected("row-seat-0") })');
  await bButton();
  const backedOut = evalInApp('window.__gameMenu.open');
  check("B closes the game menu, whose Practice row shows the driver's seat taken",
    reopened.open && reopened.seats && reopened.driverLit && !backedOut,
    `reopened ${JSON.stringify(reopened)}, open after B ${backedOut}`);
  iwsdk(['xr', 'set-device-state'], {});
}

const toRig = toOrigin;

/** Where this player sits: their seat, head and its eye point (hull space), and the play space's height. */
const seated = () => evalInApp('({ mine: window.__seats.mine, head: window.__seats.head(), eye: window.__seats.eye(window.__seats.mine), rigY: window.__debug.world.player.position.y, fixes: { ...window.__seats.fixes } })');
const flatGap = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * 1b. The cabin (F1.1): playing solo the player sits in the driver's seat,
 *     eyes over its eye point; a lean forward stops at the head box's edge
 *     (the controls and the front plate are beyond); a recentre, a jump of
 *     over a metre, puts them back in the seat; the game menu's Practice
 *     row moves them to the gunner's seat in the turret basket, its floor
 *     80 cm up, and back.
 */
async function seatStep() {
  evalInApp('(window.__seats.reseat(), true)');
  const start = await waitFor("the driver's seat", () => {
    const s = seated();
    return s.mine === 'driver' && flatGap(s.head, s.eye) < 0.01 ? s : null;
  }, 5000).catch(() => seated());
  check("Solo, the player sits in the driver's seat with their eyes over its eye point",
    start.mine === 'driver' && flatGap(start.head, start.eye) < 0.01 && Math.abs(start.rigY) < 1e-6,
    `${start.mine}, head ${fmt(start.head)}, eye point ${fmt(start.eye)}, floor at ${start.rigY.toFixed(3)} m`);
  const eye = start.eye;
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([eye[0] + 0.1, eye[1] - 0.15, eye[2] - 3]) });
  await sleep(500);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-driver-seat.png'], {});

  // Lean 80 cm forward in the room: the head box reaches 60 cm ahead of the eye point (src/sim/cabin.ts).
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin([eye[0], eye[1], eye[2] - 0.8]) });
  const leant = await waitFor('the lean to stop', () => {
    const s = seated();
    return s.fixes.push > start.fixes.push ? s : null;
  }, 5000).catch(() => seated());
  check('Leaning past the head box stops the head at its edge',
    leant.fixes.push > start.fixes.push && Math.abs(leant.head[2] - (eye[2] - 0.6)) < 0.01 && Math.abs(leant.head[0] - eye[0]) < 0.01,
    `head at ${fmt(leant.head)}, edge at z ${(eye[2] - 0.6).toFixed(3)}`);

  // A recentre: the head jumps 1.5 m sideways in the room.
  const now = iwsdk(['xr', 'get-transform'], { device: 'headset' }).result.position;
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: now.x + 1.5, y: now.y, z: now.z } });
  const back = await waitFor('back in the seat', () => {
    const s = seated();
    return s.fixes.reseat > start.fixes.reseat && flatGap(s.head, s.eye) < 0.01 ? s : null;
  }, 5000).catch(() => seated());
  check('A head far outside the seat (a recentre) is put back in the seat',
    back.fixes.reseat > start.fixes.reseat && flatGap(back.head, back.eye) < 0.01,
    `head ${fmt(back.head)}, eye point ${fmt(back.eye)}, ${back.fixes.reseat - start.fixes.reseat} reseat(s)`);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);

  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'row-seat-1'));
  const gunner = await waitFor("the gunner's seat", () => {
    const s = seated();
    return s.mine === 'gunner' && flatGap(s.head, s.eye) < 0.01 ? s : null;
  }, 5000).catch(() => seated());
  const lit = evalInApp('window.__gameMenu.selected("row-seat-1")');
  await menuButtonPress();
  check("The game menu's Practice row sits the player in the gunner's seat, on the turret basket's floor",
    gunner.mine === 'gunner' && flatGap(gunner.head, gunner.eye) < 0.01 && Math.abs(gunner.rigY - 0.8) < 0.01 && lit,
    `${gunner.mine}, head ${fmt(gunner.head)}, eye point ${fmt(gunner.eye)}, floor at ${gunner.rigY.toFixed(3)} m, Gunner ${lit ? '' : 'not '}highlighted`);
  const g = gunner.eye;
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([g[0] - 1.2, g[1] - 0.5, g[2] - 2.5]) });
  await sleep(500);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-gunner-seat.png'], {});
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([g[0] - 0.6, g[1] - 1.3, g[2] - 2.2]) });
  await sleep(500);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-gunner-to-driver.png'], {});
  evalInApp("(window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
  await waitFor("the driver's seat again", () => seated().mine === 'driver', 5000).catch(() => null);
  await sleep(300);
}

async function sightStep() {
  // From the driver's seat, "Go to it" first moves the player to the gunner's.
  evalInApp('(window.__sight.goTo(), true)');
  const lens = evalInApp('window.__sight.lens()');
  const behindLens = (head) => (head[0] - lens.at[0]) * lens.facing[0] + (head[2] - lens.at[2]) * lens.facing[2];
  const there = await waitFor('the eyepiece', () => {
    const s = seated();
    return s.mine === 'gunner' && behindLens(s.head) > 0.1 && behindLens(s.head) < 0.2 ? s : null;
  }, 5000).catch(() => seated());
  const head = there.head;
  const behind = behindLens(head);
  const before = evalInApp('window.__sight.state()');
  check('Practice "Go to it" sits the player in the gunner\'s seat with their head just behind the eyepiece, the sight still closed',
    there.mine === 'gunner' && behind > 0.1 && behind < 0.2 && !before.open, `${there.mine}, head ${fmt(head)}, lens ${fmt(lens.at)}, ${(behind * 100).toFixed(0)} cm behind, open ${before.open}`);

  const along = (d) => lens.at.map((v, i) => v + lens.facing[i] * d);
  const lookDown = () => iwsdk(['xr', 'look-at'], { device: 'headset', target: toRig(along(-20)) });
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toRig(along(0.06)) });
  lookDown();
  const open = await waitFor('the sight to open and render', () => {
    const s = evalInApp('window.__sight.state()');
    return s.open && s.renders > before.renders + 5 ? s : null;
  }, 10000).catch(() => evalInApp('window.__sight.state()'));
  const spread = evalInApp('window.__sight.pictureSpread()');
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-sight.png'], {});
  check('Leaning in to the eyepiece opens the sight, which renders a picture of the range',
    open.open && open.renders > before.renders && spread > 20,
    `open ${open.open}, ${open.renders - before.renders} frames rendered, ${open.size}², ${open.calls} calls, cpu ${open.cpuMs?.toFixed(2)} ms, picture spread ${spread}`);

  evalInApp("(window.__sight.setAim('500'), true)");
  await sleep(300);
  const aimed = evalInApp('window.__sight.lens()');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toRig(aimed.at.map((v, i) => v + aimed.facing[i] * 0.06)) });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toRig(aimed.at.map((v, i) => v - aimed.facing[i] * 20)) });
  await sleep(1000);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-sight-500m.png'], {});
  evalInApp("(window.__sight.setAim('ahead'), true)");

  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toRig(along(0.3)) });
  lookDown();
  const shut = await waitFor('the sight to close', () => {
    const s = evalInApp('window.__sight.state()');
    return !s.open ? s : null;
  }, 5000).catch(() => evalInApp('window.__sight.state()'));
  await sleep(1000);
  const later = evalInApp('window.__sight.state()');
  check('Leaning back closes the sight and it stops rendering',
    !shut.open && later.renders === shut.renders, `open ${shut.open}, ${later.renders - shut.renders} frames rendered after closing`);

  evalInApp("(window.__sight.setMode('always'), true)");
  await sleep(1000);
  const always = evalInApp('window.__sight.state()');
  evalInApp("(window.__sight.setMode('auto'), true)");
  check('"Draw: always" renders the sight from anywhere, to measure its cost',
    always.open && always.renders > later.renders, `${always.renders - later.renders} frames rendered from 30 cm away`);

  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-sight-size'));
  const sized = evalInApp("({ size: window.__sight.state().size, label: window.__gameMenu.text('menu-sight-size') })");
  await menuButtonPress();
  evalInApp('(window.__sight.setSize(512), true)');
  check("The game menu's Practice button changes the sight's texture size",
    sized.size === 1024 && sized.label === '1024²', `size ${sized.size}, label ${sized.label}`);

  evalInApp("(window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
  await waitFor("the driver's seat again", () => seated().mine === 'driver', 5000).catch(() => null);
  await sleep(300);
}

/** Press Y on the left controller: opens or closes the game menu. */
async function menuButtonPress() {
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 1 }] });
  await sleep(300);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 0 }] });
  await sleep(300);
}

async function main() {
  mkdirSync(`${ROOT}/artifacts`, { recursive: true });
  await ensureRuntime();
  const startedAt = Date.now();

  iwsdk(['browser', 'reload'], {});
  if (process.env.THROTTLE) {
    // Slow the page's CPU, to see how the checks fare on a slow CI runner.
    const file = 'artifacts/.throttle.mjs';
    writeFileSync(`${ROOT}/${file}`,
      `export default async function run({ cdp }) {\n  await cdp.send('Emulation.setCPUThrottlingRate', { rate: ${Number(process.env.THROTTLE)} });\n  return true;\n}\n`);
    try {
      iwsdk(['browser', 'run', file]);
    } finally {
      rmSync(`${ROOT}/${file}`, { force: true });
    }
  }
  await waitFor('XR offer after reload', () => {
    const { result } = iwsdk(['xr', 'status'], {});
    return result.sessionOffered || result.sessionActive;
  });
  if (!iwsdk(['xr', 'status'], {}).result.sessionActive) {
    iwsdk(['xr', 'enter'], {});
  }
  // Reset the emulated headset and controllers (buttons, poses) left over
  // from any earlier session.
  iwsdk(['xr', 'set-device-state'], {});
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 0 }] });
  check('XR session active', iwsdk(['xr', 'status'], {}).result.sessionActive);
  await sleep(500);
  await startScreenAndMenu();
  const ownHands = evalInApp('({ shown: window.__ownHands.shown(), right: window.__ownHands.position("right") })');
  check('This player sees their own hands', ownHands.shown.length === 2, `shown: ${ownHands.shown.join(', ') || 'none'}, right at ${fmt(ownHands.right)}`);
  // 1a. Phase 3 posed hands: the fingers follow the controller's trigger,
  //     grip and touch sensors. A picture of each named pose, held up in
  //     front of the face against the sky.
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0.5, y: 1.6, z: 0 } });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: 2, y: 1.75, z: 0 } });
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', position: { x: 0.8, y: 1.6, z: 0.09 }, orientation: { pitch: -45, yaw: 0, roll: 0 } });
  iwsdk(['xr', 'set-transform'], { device: 'controller-left', position: { x: 0.8, y: 1.6, z: -0.09 }, orientation: { pitch: -45, yaw: 0, roll: 0 } });
  const handPoses = {
    // Trigger (0) and thumbstick (2) touch sensors, trigger and grip (1) pulls.
    flat: [{ index: 0, value: 0, touched: false }, { index: 1, value: 0 }, { index: 2, value: 0, touched: false }],
    fist: [{ index: 0, value: 1, touched: true }, { index: 1, value: 1 }, { index: 2, value: 0, touched: true }],
    point: [{ index: 0, value: 0, touched: false }, { index: 1, value: 1 }, { index: 2, value: 0, touched: true }],
    'thumbs-up': [{ index: 0, value: 1, touched: true }, { index: 1, value: 1 }, { index: 2, value: 0, touched: false }],
  };
  // Touch something first: until a controller reports a touch, its sensors
  // count as unknown and the hand rests on the controller.
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 2, value: 0, touched: true }] });
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 2, value: 0, touched: true }] });
  await sleep(200);
  const posesSeen = [];
  for (const [name, buttons] of Object.entries(handPoses)) {
    iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons });
    iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons });
    const seen = await waitFor(`the ${name} pose`, () => {
      const p = evalInApp('[window.__ownHands.pose("left"), window.__ownHands.pose("right")]');
      return p[0] === name && p[1] === name && p;
    }, 5000).catch(() => evalInApp('[window.__ownHands.pose("left"), window.__ownHands.pose("right")]'));
    posesSeen.push(`${name}: ${seen.join('/')}`);
    iwsdk(['browser', 'screenshot', '--output-file', `artifacts/xr-hands-${name}.png`], {});
  }
  check('The controllers pose the hands: flat, fist, pointing and thumbs-up',
    posesSeen.every((line) => { const [name, seen] = line.split(': '); return seen === `${name}/${name}`; }), posesSeen.join(', '));
  for (const device of ['controller-right', 'controller-left']) {
    iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: 0, value: 0, touched: false }, { index: 1, value: 0 }, { index: 2, value: 0, touched: false }] });
  }
  iwsdk(['xr', 'set-device-state'], {});

  await seatStep();

  // 1c. Character height and seated play: a chosen height puts the eyes at
  //     it, seated play lifts a seated player to standing eye height, and
  //     back at their own height nothing moves. The rig carries the hands.
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.6, z: 0 } });
  await sleep(300);
  const bodyState = () => evalInApp('({ ...window.__body.state, rigY: window.__debug.world.player.position.y, hand: window.__ownHands.position("right") })');
  evalInApp('(window.__body.choose({ height: 1.8, seated: false }), true)');
  const tall = await waitFor('the 1.8 m character', () => { const b = bodyState(); return Math.abs(b.eye - 1.67) < 0.01 && b; }, 5000).catch(() => bodyState());
  check('A chosen character height puts the eyes at it', Math.abs(tall.eye - 1.67) < 0.01 && Math.abs(tall.rigY - 0.07) < 0.01,
    `eyes at ${tall.eye?.toFixed(3)} m, rig raised ${tall.rigY?.toFixed(3)} m`);
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.15, z: 0 } });
  await sleep(300);
  evalInApp('(window.__body.choose({ height: 0, seated: true }), true)');
  // Mirrors SEATED_EYE in src/sim/body-height.ts.
  const seatedEye = 1.45;
  const seated = await waitFor('seated play', () => { const b = bodyState(); return Math.abs(b.eye - seatedEye) < 0.01 && b; }, 5000).catch(() => bodyState());
  check('Seated play lifts a seated player to a little under average eye height, hands too',
    Math.abs(seated.eye - seatedEye) < 0.01 && Math.abs(seated.rigY - (seatedEye - 1.15)) < 0.01 && seated.hand[1] > tall.hand[1] + 0.2,
    `eyes at ${seated.eye?.toFixed(3)} m for ${seatedEye.toFixed(3)} m, rig raised ${seated.rigY?.toFixed(3)} m, right hand at ${fmt(seated.hand)}`);
  evalInApp('(window.__body.choose({ height: 0, seated: false }), true)');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.6, z: 0 } });
  await sleep(300);
  const own = bodyState();
  check('At their own height, standing, the player is not moved', own.rigY === 0 && own.offset === 0, `rig at ${own.rigY} m`);
  iwsdk(['xr', 'set-device-state'], {});
  iwsdk(['xr', 'set-device-state'], {});


  // 2. The frame-rate system ran when the session started.
  const rateLog = await waitFor(
    'frame-rate log',
    () => iwsdk(['browser', 'logs'], { count: 200, since: startedAt }).result.find((e) => e.message.includes('[FrameRate]')),
    15000,
  ).catch(() => null);
  check('90 Hz requested on session start', rateLog !== null, rateLog?.message);

  // 2b. The platform report (spike S8) describes the emulated Quest 3.
  const platform = await waitFor(
    'platform report',
    () => evalInApp('window.__platform.mine && window.__platform.mine.inputs.length > 0 ? window.__platform.mine : null'),
    10000,
  ).catch(() => null);
  check(
    'Platform report lists the session',
    platform !== null && platform.hzSource === 'reported' && platform.canSetRate && platform.inputs.some((i) => i.includes('controller')),
    platform ? `${platform.hz} Hz ${platform.hzSource}, multiview ${platform.multiview}, layers ${platform.layers}, ${platform.buffer}, [${platform.inputs.join('; ')}], features [${platform.features.join(', ')}]` : 'none',
  );


  // 2c. Spike S1, the gunsight: Practice "Go to it" puts the head just
  //     behind the eyepiece; leaning in to 6 cm opens it and the second
  //     camera renders a picture with something in it (screenshots straight
  //     ahead and laid on the 500 m target); leaning back closes it and the
  //     rendering stops; "Draw: always" renders from anywhere; the menu's
  //     size button changes the texture.
  await sightStep();

  // 6. Spike S9: tracked hands, gripping by pinching (the emulator's hands
  //    can pinch but not make a fist; fists are unit-tested).
  iwsdk(['xr', 'set-input-mode'], { mode: 'hand' });
  await sleep(500);
  const pinching = () => evalInApp('({ ...window.__grip.state.right })');
  const open = pinching();
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
  const pinched = await waitFor('the pinch to grip', () => {
    const g = pinching();
    return g.pressed ? g : null;
  }, 3000).catch(() => pinching());
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
  const released = await waitFor('the grip to let go', () => {
    const g = pinching();
    return !g.pressed ? g : null;
  }, 3000).catch(() => pinching());
  check('A tracked hand grips with a pinch and lets go', !open.pressed && pinched.pressed && pinched.hand && !released.pressed,
    `before ${JSON.stringify(open)}, pinched ${JSON.stringify(pinched)}, released ${JSON.stringify(released)}`);
  await sleep(500);
  iwsdk(['xr', 'set-input-mode'], { mode: 'controller' });
  await sleep(300);

  // 7. Perf log.
  const rows = evalInApp('window.__perf.recorder.rows.length');
  check('Perf CSV is recording', rows > 2, `${rows - 1} rows`);

  // 8. A runtime without the frame-rate API (desktop browsers over Link may
  //    lack it): the game skips the request and measures the rate instead.
  iwsdk(['xr', 'exit'], {});
  await waitFor('XR session to end', () => !iwsdk(['xr', 'status'], {}).result.sessionActive, 10000);
  await sleep(2500);
  const flatHz = evalInApp("window.__perf.recorder.rows.at(-1).split(',')[1]");
  check('Leaving VR stops budgeting frames at the headset rate', flatHz === '60', `latest perf row at ${flatHz} Hz`);
  evalInApp(`(() => {
    const proto = Object.getPrototypeOf(window.__debug.world.session ?? {}) ?? {};
    const target = window.XRSession?.prototype ?? proto;
    Object.defineProperty(target, 'frameRate', { configurable: true, get: () => undefined });
    Object.defineProperty(target, 'supportedFrameRates', { configurable: true, get: () => undefined });
    Object.defineProperty(target, 'updateTargetFrameRate', { configurable: true, value: undefined });
  })()`);
  const pcStart = Date.now();
  await waitFor('XR offer', () => iwsdk(['xr', 'status'], {}).result.sessionOffered, 10000);
  iwsdk(['xr', 'enter'], {});
  const pcRateLog = await waitFor(
    'frame-rate log',
    () => iwsdk(['browser', 'logs'], { count: 200, since: pcStart }).result.find((e) => e.message.includes('[FrameRate] supported')),
    15000,
  ).catch(() => null);
  check('No rate request without the frame-rate API', pcRateLog?.message.includes('requesting=none') === true, pcRateLog?.message);
  const pcPlatform = await waitFor(
    'measured platform report',
    () => evalInApp("window.__platform.mine && window.__platform.mine.hzSource === 'measured' ? window.__platform.mine : null"),
    12000,
  ).catch(() => null);
  check(
    'Refresh rate is measured instead',
    pcPlatform !== null && pcPlatform.hz > 0 && !pcPlatform.canSetRate,
    pcPlatform ? `~${pcPlatform.hz} Hz` : `report ${JSON.stringify(evalInApp('window.__platform.mine'))}`,
  );
  // Hold the left wrist up to see the HUD's platform lines.
  const wrist = evalInApp("window.__seats.eye('driver')").map((v, i) => v + [0.07, -0.07, -0.3][i]);
  iwsdk(['xr', 'animate-to'], { device: 'controller-left', position: toOrigin(wrist), duration: 0.3 });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(wrist) });
  await sleep(800);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-pcvr-hud.png'], {});

  // The game draws its own gloves; IWSDK's controller and hand models (from
  // a CDN, which CI's runners can reach) must not load behind them.
  const inputModels = evalInApp('window.__ownHands.inputModels()');
  check("IWSDK's controller and hand models stay unloaded", inputModels.length === 0, `loaded: ${inputModels.join(', ') || 'none'}`);

  // Console.
  const { result: logs } = iwsdk(['browser', 'logs'], { level: 'error', count: 20, since: startedAt });
  // Controller models come from a CDN the cloud test runner can't reach; a
  // headset can. Ignore only those fetch failures.
  const errors = logs
    .map((entry) => entry.message)
    .filter((m) => !(m.includes('ERR_TUNNEL_CONNECTION_FAILED') || m.includes('webxr-input-profiles')))
    // Module requests cancelled by the page reload at the start of the test.
    .filter((m) => !m.includes('net::ERR_ABORTED'));
  check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`ERROR  ${error.message}`);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::error title=XR test aborted::${error.message}`.replace(/\r?\n/g, ' '));
  }
  process.exitCode = 1;
});
