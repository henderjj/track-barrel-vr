#!/usr/bin/env node
/**
 * Headless XR smoke test for the starter.
 *
 * Drives the IWSDK managed browser (an emulated Meta Quest 3, through IWER,
 * IWSDK's browser-based XR emulator) with the @iwsdk/cli surface:
 *
 *  0. enters an immersive session, picks Play solo on the start screen with
 *     a controller ray, and works the game menu (Y) with the ray;
 *  1. checks this player's own hands are drawn and posed by the controller
 *     (flat, fist, point, thumbs-up);
 *  1b. walks the deck with the thumbstick from off the room's centre and
 *     checks the head stops at the rails, then snap turns about the head;
 *  1c. picks a character height and seated play and checks the eyes and
 *     hands are raised to it;
 *  2. checks the 90 Hz request ran and the platform report (spike S8);
 *  2c. looks through the gunsight (spike S1): it opens as the head leans in,
 *     renders a picture of the range, closes as it leans back;
 *  3. checks the blocks rest on the table;
 *  4. grabs a block with the right controller's squeeze, lifts and drops it,
 *     and pulls one out of a pile without flinging the others;
 *  5. throws a block through the hoop (a scripted hand) and checks the score,
 *     then restarts from the game menu;
 *  5b. opens Practice > Lever test (spike S3) and works a tiller with a
 *     controller: it follows the hand, stops at its limit with the hand
 *     kept on it, lets go when the hand is pulled off, springs back, and
 *     both tillers forwards drive the tank up the board's lane;
 *  6. switches to tracked hands (spike S9) and picks up a block with a pinch,
 *     then works a tiller with a pinch;
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


// Mirrors src/sim/play-area.ts and src/scene-assets/deck.scene-asset.ts.
const DECK_HALF_WIDTH = 1.5;
const DECK_HALF_LENGTH = 2.0;
const TABLE = { x: 0, z: -1.2, height: 0.8, halfW: 0.5, halfD: 0.25 };
const HOOP = { x: 0, y: 2.0, z: -2.6 };
const BLOCK_COUNT = 6;
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
 * Controller poses are in the XR origin's space; the origin can drift from the
 * world origin (locomotion), so convert world targets into it.
 */
function toOrigin(p) {
  const o = evalInApp('window.__debug.world.player.position.toArray()');
  return { x: p[0] - o[0], y: p[1] - o[1], z: p[2] - o[2] };
}

const fmt = (p) => p.map((v) => v.toFixed(3)).join(', ');
const onTable = (p) =>
  Math.abs(p[0] - TABLE.x) < TABLE.halfW && Math.abs(p[2] - TABLE.z) < TABLE.halfD && p[1] > TABLE.height && p[1] < TABLE.height + 0.3;
const aboard = (p) =>
  Math.abs(p[0]) < DECK_HALF_WIDTH + 0.05 && Math.abs(p[2]) < DECK_HALF_LENGTH + 0.05 && p[1] > -0.02 && p[1] < 2.5;

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
  const reopened = evalInApp('({ open: window.__gameMenu.open, restart: window.__gameMenu.shown("menu-restart") })');
  await bButton();
  const backedOut = evalInApp('window.__gameMenu.open');
  check('B closes the game menu, which offers Restart',
    reopened.open && reopened.restart && !backedOut,
    `reopened ${JSON.stringify(reopened)}, open after B ${backedOut}`);
  iwsdk(['xr', 'set-device-state'], {});
}

/** Room-space (XR origin) coordinates of world point `p`, allowing for the rig's turn as well as its offset. */
function toRig(p) {
  const [x, y, z] = evalInApp(`window.__debug.world.player.worldToLocal(window.__debug.world.player.position.clone().set(${p.join(',')})).toArray()`);
  return { x, y, z };
}

async function sightStep() {
  evalInApp('(window.__sight.goTo(), true)');
  await sleep(300);
  const lens = evalInApp('window.__sight.lens()');
  const head = evalInApp('window.__deckWalk.head()');
  const behind = (head[0] - lens.at[0]) * lens.facing[0] + (head[2] - lens.at[2]) * lens.facing[2];
  const before = evalInApp('window.__sight.state()');
  check('Practice "Go to it" puts the head just behind the eyepiece, the sight still closed',
    behind > 0.1 && behind < 0.2 && !before.open, `head ${fmt(head)}, lens ${fmt(lens.at)}, ${(behind * 100).toFixed(0)} cm behind, open ${before.open}`);

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

  evalInApp('(window.__debug.world.player.position.set(0, 0, 0), window.__debug.world.player.rotation.set(0, 0, 0), true)');
  iwsdk(['xr', 'set-device-state'], {});
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

  // 1b. Thumbstick walking stops the head at the rails wherever the player
  //     stands in their room: here 0.8 m behind and 0.5 m left of its middle.
  const walk = evalInApp('window.__deckWalk.bounds');
  const walkHead = () => evalInApp('window.__deckWalk.head()');
  const thumbstick = (device, x, y) =>
    iwsdk(['xr', 'set-gamepad-state'], { device, axes: [{ index: 0, value: x }, { index: 1, value: y }] });
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: -0.5, y: 1.6, z: 0.8 } });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: -0.5, y: 1.4, z: -3 } });
  await sleep(300);
  thumbstick('controller-left', 0, -1);
  const atBow = await waitFor('walk to the far end', () => { const p = walkHead(); return p[2] < -walk.halfLength + 0.01 && p; }, 8000).catch(() => walkHead());
  thumbstick('controller-left', 1, 0);
  const atStarboard = await waitFor('walk to the right rail', () => { const p = walkHead(); return p[0] > walk.halfWidth - 0.01 && p; }, 8000).catch(() => walkHead());
  await sleep(500);
  const stopped = walkHead();
  thumbstick('controller-left', 0, 0);
  check('Walking takes the head to the far and right rails from off the room centre, and no further',
    Math.abs(atBow[2] + walk.halfLength) < 0.02 && Math.abs(stopped[0] - walk.halfWidth) < 0.02 && Math.abs(stopped[2] + walk.halfLength) < 0.02,
    `head at the far end ${fmt(atBow)}, at the right rail ${fmt(atStarboard)}, stopped at ${fmt(stopped)}; bounds ±${walk.halfWidth} × ±${walk.halfLength}`);
  thumbstick('controller-right', 1, 0);
  await sleep(300);
  thumbstick('controller-right', 0, 0);
  const snapped = { head: walkHead(), yaw: evalInApp('window.__debug.world.player.rotation.y') };
  check('Snap turning turns about the head', Math.abs(snapped.yaw + Math.PI / 4) < 0.01 && Math.hypot(snapped.head[0] - stopped[0], snapped.head[2] - stopped[2]) < 0.01,
    `yaw ${((snapped.yaw * 180) / Math.PI).toFixed(0)}°, head moved ${(Math.hypot(snapped.head[0] - stopped[0], snapped.head[2] - stopped[2]) * 100).toFixed(1)} cm`);
  // Back to the middle of the deck for the checks below, which place hands in room space.
  evalInApp('(window.__debug.world.player.position.set(0, 0, 0), window.__debug.world.player.rotation.set(0, 0, 0), true)');

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

  // 3. Blocks rest on the table.
  const blocks = [];
  for (let i = 1; i <= BLOCK_COUNT; i++) {
    blocks.push(await waitFor(`Block ${i}`, () => findEntity(`Block ${i}`)));
  }
  await sleep(2500);
  const settled = blocks.map((b) => position(b.entityIndex));
  const allOnTable = settled.every(onTable);
  check('The blocks rest on the table', allOnTable, allOnTable ? '' : settled.map(fmt).join(' | '));
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: 0, y: 1.2, z: -2 } });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-play-area.png'], {});
  iwsdk(['xr', 'set-device-state'], {});

  // 4. Grab a block from the table, lift it, drop it on the open deck.
  const start = settled[0];
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin(start), duration: 0.4 });
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 1 }] });
  const grabbedName = await waitFor('Grabbed tag', () => grabbedNames().find((n) => n.startsWith('Block')), 3000).catch(() => null);
  check('Squeeze grabs a block', grabbedName !== null, `grabbed: [${grabbedNames().join(', ')}]`);
  const block = (blocks.find((b) => b.name === grabbedName) ?? blocks[0]).entityIndex;
  const lift = { x: 0.1, y: 1.2, z: -0.6 };
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin([lift.x, lift.y, lift.z]), duration: 0.6 });
  await sleep(500);
  const held = position(block);
  // The grab keeps the block's offset from the grip point, so allow 20 cm.
  check('Held block follows the controller', Math.hypot(held[0] - lift.x, held[1] - lift.y, held[2] - lift.z) < 0.2, `pos ${fmt(held)}`);
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: 0, y: 0.6, z: -0.6 } });
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-holding-block.png'], {});
  // Lower it over the open deck and let go with the hand still.
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin([0.1, 0.5, -0.6]), duration: 0.6 });
  await sleep(800);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 0 }] });
  await sleep(300);
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: { x: 0.3, y: 1.0, z: 0.2 }, duration: 0.6 });
  const landed = await waitFor(
    'block to land',
    () => {
      const p = position(block);
      return p[1] < 0.12 && aboard(p) ? p : null;
    },
    5000,
  ).catch(() => null);
  check('Released block is no longer grabbed', !grabbedNames().includes(grabbedName));
  check('Released block lands on the deck', landed !== null, `pos ${fmt(landed ?? position(block))}`);


  // 4b. Pull the bottom block out of a pile: the held block must not bat its
  //     neighbours away (on slow frames it used to fling them at 50+ m/s).
  evalInApp(`(() => { for (let i = 0; i < ${BLOCK_COUNT}; i++) window.__throw.place(i, (i % 2) * 0.11 - 0.05, 0.06 + Math.floor(i / 2) * 0.105, 0.3); return 1; })()`);
  await sleep(2500);
  const bottom = evalInApp('window.__throw.objects()[0].pos');
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin(bottom), duration: 0.3 });
  await sleep(800);
  evalInApp(`(() => {
    window.__pile = { fastest: 0, flung: 0 };
    const tick = () => {
      for (const b of window.__throw.objects()) {
        if (!b.heldBy) {
          window.__pile.fastest = Math.max(window.__pile.fastest, b.speed);
          if (b.pos[1] > 1.5 || Math.abs(b.pos[0]) > ${DECK_HALF_WIDTH + 0.05}) window.__pile.flung++;
        }
      }
      window.__pile.frame = requestAnimationFrame(tick);
    };
    tick();
    return true;
  })()`);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 1 }] });
  // Pulled half a second after the grip, so the blocks above drop while the
  // emulator's frames are uneven: their speed used to be measured from the
  // drawn position and read 7-15 m/s for a 1 m/s drop (now Havok's velocity).
  await sleep(500);
  const pulledBy = evalInApp('window.__throw.objects()[0].heldBy');
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin([0.1, 1.2, -0.6]), duration: 0.6 });
  await sleep(2000);
  const pile = evalInApp('(cancelAnimationFrame(window.__pile.frame), window.__pile)');
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 0 }] });
  await sleep(500);
  check('Pulling a block out of a pile leaves the others in place', pulledBy === 'right' && pile.fastest < 8 && pile.flung === 0,
    `held by ${pulledBy}, fastest neighbour ${pile.fastest.toFixed(1)} m/s, ${pile.flung} samples off the deck`);
  evalInApp('(window.__game.resetBlocks(), true)');
  await sleep(1500);

  // 5. A block thrown through the hoop scores a point (the host decides);
  //    the game menu's Restart puts the score back to nought and the blocks
  //    back on the table. The throw is scripted: the emulator's controller
  //    can't swing an arm reliably at CI frame rates.
  const scoreBefore = evalInApp('window.__game.score');
  evalInApp(`(() => {
    const p = window.__throw.objects()[1].pos;
    // A 0.15 s swing, let go still moving, then 0.35 s of flight to the hoop's middle.
    const swing = 0.15, flight = 0.35, total = swing + flight, g = 9.81;
    const v = [(${HOOP.x} - p[0]) / total, (${HOOP.y} - p[1] + 0.5 * g * flight * flight) / total, (${HOOP.z} - p[2]) / total];
    let t0 = 0;
    window.__throw.setTestHand('right', (now) => {
      if (!t0) t0 = now;
      const t = (now - t0) / 1000;
      if (t < 0.3) return { x: p[0], y: p[1], z: p[2], squeeze: t > 0.1 };
      const s = Math.min(t - 0.3, 0.3);
      return { x: p[0] + v[0] * s, y: p[1] + v[1] * s, z: p[2] + v[2] * s, squeeze: t - 0.3 < swing };
    });
    return true;
  })()`);
  const scored = await waitFor('a point', () => evalInApp('window.__game.score') > scoreBefore, 6000).catch(() => false);
  evalInApp("(window.__throw.setTestHand('right', null), true)");
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: 1, y: 1.2, z: -2 } });
  await sleep(500);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-scored.png'], {});
  check('A block thrown through the hoop scores a point', scored, `score ${scoreBefore} → ${evalInApp('window.__game.score')}, block at ${fmt(evalInApp('window.__throw.objects()[1].pos'))}`);
  iwsdk(['xr', 'set-device-state'], {});
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-restart'));
  await sleep(1500);
  const restarted = { score: evalInApp('window.__game.score'), open: evalInApp('window.__gameMenu.open'), blocks: evalInApp('window.__throw.objects().map((o) => o.pos)') };
  check('Restart in the game menu puts the score to nought and the blocks back on the table',
    restarted.score === 0 && !restarted.open && restarted.blocks.every(onTable),
    `score ${restarted.score}, menu ${restarted.open ? 'open' : 'closed'}, ${restarted.blocks.filter(onTable).length}/${BLOCK_COUNT} on the table`);
  iwsdk(['xr', 'set-device-state'], {});

  // 5b. Spike S3, lever feel: Practice > Lever test puts two tillers in
  //     front of the player. A gripped tiller follows the hand, stops at its
  //     limit with the drawn hand kept on the handle, lets go when the hand
  //     is pulled 45 cm off, springs back, and both forwards drive the tank
  //     up the lane on the board.
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-levers'));
  iwsdk(['xr', 'set-device-state'], {});
  const leverShown = await waitFor('the lever test rig', () => evalInApp('window.__lever.shown'), 5000).catch(() => false);
  check('Practice > Lever test puts the tillers in front of the player', leverShown, `handles at ${fmt(evalInApp('window.__lever.handle("left")'))} and ${fmt(evalInApp('window.__lever.handle("right")'))}`);
  const tillers = () => evalInApp('window.__lever.tillers()');
  const handleR = evalInApp('window.__lever.handle("right")');
  const at = (p, dz, dy = 0) => toOrigin([p[0], p[1] + dy, p[2] + dz]);
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: at(handleR, 0), duration: 0.4 });
  await sleep(600);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 1 }] });
  const gripped = await waitFor('the right tiller gripped', () => {
    const t = tillers();
    return t.right.heldBy === 'right' && evalInApp('window.__ownHands.locked("right")') > 0.9 && t;
  }, 5000).catch(() => tillers());
  check('Squeezing at a tiller’s handle takes hold of it, the drawn hand closed on it', gripped.right.heldBy === 'right', `held by ${gripped.right.heldBy}, angle ${gripped.right.angle.toFixed(1)}°`);
  // 15 cm forwards at the handle's height is about 21° round the pivot.
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: at(handleR, -0.15), duration: 0.5 });
  const pushed = await waitFor('the tiller to follow', () => { const t = tillers(); return t.right.angle > 15 && t; }, 5000).catch(() => tillers());
  check('The tiller follows the hand forwards', pushed.right.angle > 15 && pushed.right.angle < 25 && pushed.right.demand > 0.5,
    `angle ${pushed.right.angle.toFixed(1)}°, demand ${pushed.right.demand.toFixed(2)}`);
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: at(handleR, -0.32), duration: 0.5 });
  const limited = await waitFor('the tiller at its limit', () => { const t = tillers(); return t.right.overshoot > 8 && t; }, 5000).catch(() => tillers());
  const gapAtLimit = evalInApp('window.__lever.handleGap("right", window.__ownHands.fist("right"))');
  check('Pushed past its limit, the tiller stops there with a tick and the drawn hand stays on the handle',
    Math.abs(limited.right.angle - 25) < 0.5 && limited.right.limits >= 1 && limited.right.heldBy === 'right' && gapAtLimit < 0.02,
    `angle ${limited.right.angle.toFixed(1)}°, hand ${limited.right.overshoot.toFixed(1)}° past it, ${limited.right.limits} limit tick(s), drawn fist ${(gapAtLimit * 100).toFixed(1)} cm from the handle`);
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0.6, y: 1.5, z: 0.3 } });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(evalInApp('window.__lever.handle("right")')) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-lever-limit.png'], {});
  iwsdk(['xr', 'set-device-state'], {});
  // Pull the hand 45 cm back off the handle with the grip still squeezed.
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: at(handleR, 0.3, 0.2), duration: 0.4 });
  const slipped = await waitFor('the hand to let go', () => { const t = tillers(); return t.right.heldBy === null && Math.abs(t.right.angle) < 1 && t; }, 5000).catch(() => tillers());
  check('A hand pulled well off the tiller lets go, and the tiller springs back upright',
    slipped.right.heldBy === null && Math.abs(slipped.right.angle) < 1, `held by ${slipped.right.heldBy}, angle ${slipped.right.angle.toFixed(1)}°`);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 0 }] });
  await sleep(300);
  // Both tillers forwards: the tank drives straight up the lane.
  const handleL = evalInApp('window.__lever.handle("left")');
  evalInApp('(window.__lever.resetLane(), true)');
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: at(handleR, 0), duration: 0.4 });
  iwsdk(['xr', 'animate-to'], { device: 'controller-left', position: at(handleL, 0), duration: 0.4 });
  await sleep(600);
  for (const device of ['controller-right', 'controller-left']) iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value: 1 }] });
  await sleep(300);
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: at(handleR, -0.25), duration: 0.4 });
  iwsdk(['xr', 'animate-to'], { device: 'controller-left', position: at(handleL, -0.25), duration: 0.4 });
  // The CLI moves one controller after the other, so the tank turns while
  // only one tiller is forwards: start the lane again once both are.
  await waitFor('both tillers forwards', () => { const t = tillers(); return t.left.demand > 0.9 && t.right.demand > 0.9; }, 5000).catch(() => false);
  evalInApp('(window.__lever.resetLane(), true)');
  const driven = await waitFor('the tank to drive up the lane', () => { const l = evalInApp('window.__lever.lane()'); return l.y > 4 && l; }, 10000).catch(() => evalInApp('window.__lever.lane()'));
  check('Both tillers forwards drive the tank straight up the lane', driven.started && driven.y > 4 && Math.abs(driven.heading) < 0.1 && !driven.off,
    `tank at ${driven.x.toFixed(2)}, ${driven.y.toFixed(2)} m heading ${((driven.heading * 180) / Math.PI).toFixed(1)}° after ${driven.time.toFixed(1)} s`);
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.6, z: 0 } });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: 0, y: 0.9, z: -0.8 } });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-lever-lane.png'], {});
  for (const device of ['controller-right', 'controller-left']) iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value: 0 }] });
  const released = await waitFor('both tillers let go', () => { const t = tillers(); return !t.left.heldBy && !t.right.heldBy && t; }, 3000).catch(() => tillers());
  check('Letting go of both grips lets go of both tillers', !released.left.heldBy && !released.right.heldBy);
  iwsdk(['xr', 'set-device-state'], {});

  // 6. Spike S9: tracked hands, gripping by pinching (the emulator's hands
  //    can pinch but not make a fist; fists are unit-tested).
  iwsdk(['xr', 'set-input-mode'], { mode: 'hand' });
  await sleep(500);
  const handOffset = (side) => {
    const { result } = iwsdk(['xr', 'get-transform'], { device: `hand-${side}` });
    const grip = evalInApp(`window.__debug.world.player.gripSpaces.${side}.getWorldPosition(window.__debug.world.player.position.clone()).toArray()`);
    const o = toOrigin(grip);
    return { x: result.position.x - o.x, y: result.position.y - o.y, z: result.position.z - o.z };
  };
  const handTo = (side, target, duration, offset) => {
    const o = toOrigin(target);
    iwsdk(['xr', 'animate-to'], { device: `hand-${side}`, position: { x: o.x + offset.x, y: o.y + offset.y, z: o.z + offset.z }, duration });
  };
  const rightOffset = handOffset('right');
  const tableBlock = evalInApp('window.__throw.objects()[2].pos');
  handTo('right', tableBlock, 0.5, rightOffset);
  await sleep(700);
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
  await sleep(300);
  handTo('right', [0.1, 1.3, -0.6], 0.6, rightOffset);
  await sleep(800);
  const handBlock = evalInApp('window.__throw.objects()[2].pos');
  check('A pinching hand picks up a block', handBlock[1] > TABLE.height + 0.3, `block at ${fmt(handBlock)}`);
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
  await sleep(1500);
  // 6b. Spike S3 with tracked hands: a pinch at the handle takes hold of a
  //     tiller and it follows the hand; letting go of the pinch lets go.
  evalInApp('(window.__lever.show(), true)');
  await sleep(500);
  const handHandle = evalInApp('window.__lever.handle("right")');
  handTo('right', handHandle, 0.5, rightOffset);
  await sleep(700);
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
  await sleep(300);
  handTo('right', [handHandle[0], handHandle[1], handHandle[2] - 0.12], 0.5, rightOffset);
  const pinched = await waitFor('the tiller to follow the tracked hand', () => { const t = tillers(); return t.right.angle > 10 && t; }, 5000).catch(() => tillers());
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
  const unpinched = await waitFor('the tracked hand to let go', () => { const t = tillers(); return t.right.heldBy === null && t; }, 3000).catch(() => tillers());
  check('A pinching tracked hand works a tiller and lets go with the pinch',
    pinched.right.heldBy === 'right' && pinched.right.angle > 10 && unpinched.right.heldBy === null,
    `held by ${pinched.right.heldBy} at ${pinched.right.angle.toFixed(1)}°, then ${unpinched.right.heldBy ?? 'let go'}`);
  evalInApp('(window.__lever.hide(), true)');
  await sleep(300);
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
  iwsdk(['xr', 'animate-to'], { device: 'controller-left', position: toOrigin([-0.03, 1.38, -0.3]), duration: 0.3 });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: -0.03, y: 1.4, z: -0.3 } });
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
