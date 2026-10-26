#!/usr/bin/env node
/**
 * Headless XR smoke test.
 *
 * Drives the IWSDK managed browser (an emulated Meta Quest 3, through IWER,
 * IWSDK's browser-based XR emulator) with the @iwsdk/cli surface:
 *
 *  0. enters an immersive session, picks a seat and then Play solo on the
 *     start screen with a controller ray, and works the game menu (Y) with
 *     the ray;
 *  0b. calibrates (F1.2): seated, the head held still puts the eyes on the
 *     seat's eye point and both hands held out record the reach; standing,
 *     the eyes land on the same point;
 *  1. checks this player's own hands are drawn and posed by the controller
 *     (flat, fist, point, thumbs-up);
 *  1b. sits in the driver's seat (the cabin, F1.1): the eyes over its eye
 *     point, a lean stopped at the head box's edge, a recentre put back in
 *     the seat, and the game menu's Practice row moving them to the
 *     gunner's seat in the turret basket and back;
 *  1c. raises the eyes from the menu's eye height, and stops a head that
 *     stands up out of the seat under the roof;
 *  2. checks the 90 Hz request ran and the platform report (spike S8);
 *  2c. looks through the gunsight (spike S1, F1.9): it opens as the head
 *     leans in, renders a picture of the range, closes as it leans back;
 *  5b. opens Practice > Lever test (spike S3) and works a tiller with a
 *     controller: it follows the hand, stops at its limit with the hand
 *     kept on it, lets go when the hand is pulled off, springs back, and
 *     both tillers forwards drive the tank up the board's lane;
 *  5c. opens Practice > Mechanism kit (F1.3) and works its bench: a crank
 *     round a turn, the notched lever into a notch, the yoke in one hand,
 *     the twist grip and its trigger, the button and the switch;
 *  6. switches to tracked hands (spike S9) and grips with a pinch, then
 *     works a tiller with a pinch (6a);
 *  6b. spike S4: Practice → Sit at the breech, then loads a shell with the
 *     right controller (rack, breech, ram, lever) and drops one;
 *  6c. rides the tank (spike S2) from the game menu's Practice section: the
 *     driver's seat holds the head in the hull while the ground moves round
 *     it, the vignette darkens with the motion and turns off from the menu,
 *     the gunner's seat turns with the turret, and Stop brings the cabin back;
 *  6d. drives the tank (F1.4): Practice → Drive the tank, both sticks drive
 *     it and the ground moves round the hull, one stick turns it, letting go
 *     stops it, the gear lever grinds and shifts, the boulder stops it, and
 *     Back to start parks it;
 *  6e. works the driver's station (F1.5): both tillers drive the tank and
 *     the gauges read it, letting go stops it, the gear lever grinds with a
 *     tiller pushed and then shifts, and the hand throttle raises the idle;
 *  6f. lays the gun (F1.8): Practice → Lay the gun, the power grip
 *     traverses the turret with the gunner turning with it, the crank turns
 *     it 2°, the elevation wheel raises the gun, and Forward puts it back;
 *  6g. looks over the test range (F1.7): the targets stand at 100, 250 and
 *     500 m with markers up the road, the fog is on and turns off from the
 *     menu, and Practice → Up the range parks the tank 200 m up the road
 *     facing the far target;
 *  6h. lays the gun with the gunsight (F1.9): from up the range, Practice →
 *     Gunsight → Go to it and Lay on 500 m turn the turret and gun so the
 *     far target sits on its 300 m mark, by the sums and as the sight camera
 *     is drawn; elevating the gun tilts the sight's view but leaves the
 *     eyepiece still; leaning in shows the target;
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
 * system (or a spike's seat) moves and turns the origin to put the player in
 * their seat, so convert world (hull space) targets into it.
 */
function toOrigin(p) {
  const o = evalInApp(`(() => { const rig = window.__debug.world.player; rig.updateMatrixWorld(); return rig.worldToLocal(rig.position.clone().set(${p[0]}, ${p[1]}, ${p[2]})).toArray(); })()`);
  return { x: o[0], y: o[1], z: o[2] };
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
  // Seat choice (F1.2): Gunner, then back to Driver.
  const seatPick = () => evalInApp('({ mine: window.__seats.mine, saved: localStorage.getItem("track-barrel.settings") ?? "", driverLit: window.__startScreen.selected("start-seat-driver"), gunnerLit: window.__startScreen.selected("start-seat-gunner") })');
  await rayClick(elementPosition('start-panel', 'start-seat-gunner'));
  const gunnerPick = seatPick();
  await rayClick(elementPosition('start-panel', 'start-seat-driver'));
  const driverPick = seatPick();
  check('The start screen picks the seat, lights it and keeps it for next time',
    gunnerPick.mine === 'gunner' && gunnerPick.gunnerLit && !gunnerPick.driverLit && gunnerPick.saved.includes('seat=gunner') &&
      driverPick.mine === 'driver' && driverPick.driverLit && !driverPick.saved.includes('seat='),
    `${JSON.stringify(gunnerPick)} then ${JSON.stringify(driverPick)}`);
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
  const seatedFirst = seatedNow();
  await rayClick(elementPosition('menu-panel', 'row-seated-0'));
  const standing = !seatedNow();
  await rayClick(elementPosition('menu-panel', 'row-seated-1'));
  const seated = seatedNow();
  const raiseNow = () => evalInApp('({ raise: window.__body.state.choice.raise, shown: window.__gameMenu.text("height-value") })');
  await rayClick(elementPosition('menu-panel', 'height-up'));
  const up1 = raiseNow();
  await rayClick(elementPosition('menu-panel', 'height-up'));
  const up2 = raiseNow();
  await rayClick(elementPosition('menu-panel', 'height-own'));
  const own = raiseNow();
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
  check('The game menu picks standing or seated play (seated by default), and steps the eye height 5 cm at a time',
    seatedFirst && standing && seated && up1.raise === 0.05 && up1.shown === '+5 cm' && up2.raise === 0.1 && own.raise === 0 && own.shown === '0 cm',
    `seated first ${seatedFirst}, standing ${standing}, seated ${seated}, eyes ${up1.shown} then ${up2.shown}, then ${own.shown}`);

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

/** Calibration's state, and where the head is in hull space. */
const calState = () => evalInApp('({ step: window.__calibration.step, eye: window.__calibration.eye, reach: window.__calibration.reach, sign: window.__calibration.sign, calibrated: window.__body.state.calibratedEye, bodyReach: window.__body.state.reach, head: window.__seats.head(), seatEye: window.__seats.eye(window.__seats.mine), status: window.__gameMenu.text("menu-calib-status") })');

/**
 * 0b. Calibration (F1.2): once the start screen and the menu are out of the
 *     way a sign asks the player to sit back and look ahead. Held still at a
 *     chair's height, the head's height is taken and the eyes land on the
 *     driver's eye point; both hands held out with both grips squeezed take
 *     the reach, and the sign goes. Standing, calibrating again puts the
 *     eyes on the same point.
 */
async function calibrationStep() {
  iwsdk(['xr', 'set-device-state'], {});
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.2, z: 0 } });
  evalInApp('(window.__seats.reseat(), window.__calibration.start(), true)');
  const asking = await waitFor('the eyes taken', () => {
    const c = calState();
    return c.step === 'reach' && Math.abs(c.head[1] - c.seatEye[1]) < 0.005 ? c : null;
  }, 8000).catch(() => calState());
  check('Calibration: a seated head held still is taken as the eye height, and the eyes land on the seat\'s eye point',
    asking.step === 'reach' && Math.abs(asking.eye - 1.2) < 0.005 && Math.abs(asking.calibrated - 1.2) < 0.005 && Math.abs(asking.head[1] - asking.seatEye[1]) < 0.005 && asking.sign.startsWith('Hold both hands out'),
    `step ${asking.step}, eyes taken ${asking.eye?.toFixed?.(3)} m, head at ${fmt(asking.head)} for ${fmt(asking.seatEye)}, sign "${asking.sign}"`);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-calibration.png'], {});

  // Both hands 55 cm ahead and 15 cm out to the sides: 57 cm from the eyes, level.
  iwsdk(['xr', 'set-transform'], { device: 'controller-left', position: { x: -0.15, y: 1.1, z: -0.55 } });
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', position: { x: 0.15, y: 1.1, z: -0.55 } });
  await sleep(300);
  for (const device of ['controller-left', 'controller-right']) {
    iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value: 1 }] });
  }
  const reached = await waitFor('the reach taken', () => {
    const c = calState();
    return c.step === 'done' || c.step === 'off' ? c : null;
  }, 5000).catch(() => calState());
  for (const device of ['controller-left', 'controller-right']) {
    iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value: 0 }] });
  }
  // Measured from the grip poses, which sit a few centimetres from the controllers' own.
  const expected = evalInApp(`(() => { const p = window.__debug.world.player; const h = p.head.getWorldPosition(p.position.clone()); const d = (s) => { const g = p.gripSpaces[s].getWorldPosition(p.position.clone()); return Math.hypot(g.x - h.x, g.z - h.z); }; return (d('left') + d('right')) / 2; })()`);
  const gone = await waitFor('the calibration sign to go', () => {
    const c = calState();
    return c.step === 'off' && c.sign === '' ? c : null;
  }, 6000).catch(() => calState());
  check('Calibration: both hands held out with both grips squeezed take the reach, and the sign goes',
    expected > 0.45 && Math.abs(reached.reach - expected) < 0.01 && Math.abs(reached.bodyReach - expected) < 0.01 && gone.step === 'off' && gone.sign === '' && gone.status.includes(`reach ${Math.round(reached.reach * 100)} cm`),
    `reach ${reached.reach?.toFixed?.(3)} m for ${expected.toFixed(3)}, then ${gone.step}, menu says "${gone.status}"`);

  // Standing mode: calibrated standing, the eyes land on the same point.
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.68, z: 0 } });
  evalInApp('(window.__body.choose({ raise: 0, seated: false }), true)');
  const standing = await waitFor('the standing eyes taken', () => {
    const c = calState();
    return c.step === 'reach' && Math.abs(c.head[1] - c.seatEye[1]) < 0.005 ? c : null;
  }, 8000).catch(() => calState());
  check('Calibration: standing, choosing standing play calibrates again and the eyes land on the same eye point',
    standing.step === 'reach' && Math.abs(standing.eye - 1.68) < 0.005 && Math.abs(standing.head[1] - standing.seatEye[1]) < 0.005 && standing.sign.startsWith('Hold both hands out'),
    `step ${standing.step}, eyes taken ${standing.eye?.toFixed?.(3)} m, head at ${fmt(standing.head)} for ${fmt(standing.seatEye)}`);
  // Back to seated play with the headset where the later steps put it, skipping the reach this time.
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp('(window.__body.choose({ raise: 0, seated: true }), true)');
  await waitFor('the seated eyes again', () => calState().step === 'reach', 8000).catch(() => null);
  evalInApp('(window.__calibration.skip(), true)');
  await waitFor('calibration finished', () => calState().step === 'off', 6000).catch(() => null);
  await sleep(300);
}

/** Where this player sits: their seat, head and its eye point (hull space), and the play space's height. */
const seated = () => evalInApp('({ mine: window.__seats.mine, head: window.__seats.head(), eye: window.__seats.eye(window.__seats.mine), rigY: window.__debug.world.player.position.y, offset: window.__body.state.offset, fixes: { ...window.__seats.fixes } })');
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
  check("Solo, the player sits in the driver's seat with their eyes on its eye point",
    start.mine === 'driver' && flatGap(start.head, start.eye) < 0.01 && Math.abs(start.head[1] - start.eye[1]) < 0.005 && Math.abs(start.rigY - start.offset) < 1e-6,
    `${start.mine}, head ${fmt(start.head)}, eye point ${fmt(start.eye)}, floor at ${(start.rigY - start.offset).toFixed(3)} m`);
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
    gunner.mine === 'gunner' && flatGap(gunner.head, gunner.eye) < 0.01 && Math.abs(gunner.head[1] - gunner.eye[1]) < 0.005 && Math.abs(gunner.rigY - gunner.offset - 0.8) < 0.01 && lit,
    `${gunner.mine}, head ${fmt(gunner.head)}, eye point ${fmt(gunner.eye)}, floor at ${(gunner.rigY - gunner.offset).toFixed(3)} m, Gunner ${lit ? '' : 'not '}highlighted`);
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

/**
 * 6b. Spike S4, the loading drill: Practice → Sit at the breech puts the
 *     head over the loader's seat facing the gun. The right controller takes
 *     a shell from the rack near its base, swings it across to the breech
 *     where it snaps onto the bore, pushes it home, and pulls the lever back
 *     to close the breech: the drill counts and times the load, then fires,
 *     opening the breech and putting the shell back in the rack. A shell let
 *     go away from the breech is a fumble and goes back in the rack too.
 */
async function loadingDrill() {
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-loading'));
  const drill = () => evalInApp('window.__loading.state()');
  const { seat, layout } = evalInApp('({ seat: window.__loading.seat, layout: window.__loading.layout })');
  const head = evalInApp('window.__seats.head()');
  const fresh = drill();
  check('Practice → Sit at the breech puts the head over the loader\'s seat, every shell in the rack',
    Math.hypot(head[0] - seat.x, head[2] - seat.z) < 0.02 && fresh.shells.every((s) => s.place === 'rack') && fresh.lever === 0,
    `head at ${fmt(head)} for seat ${seat.x}, ${seat.z}; shells ${fresh.shells.map((s) => s.place).join(', ')}`);

  // Grip poses are where the drill takes hold; put the right one at a point by moving the controller.
  const gripWorld = () => evalInApp('window.__debug.world.player.gripSpaces.right.getWorldPosition(window.__debug.world.player.position.clone()).toArray()');
  const { result: ctrl } = iwsdk(['xr', 'get-transform'], { device: 'controller-right' });
  const g = toOrigin(gripWorld());
  const off = { x: ctrl.position.x - g.x, y: ctrl.position.y - g.y, z: ctrl.position.z - g.z };
  const gripTo = async (p, duration = 0.4) => {
    const o = toOrigin(p);
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: { x: o.x + off.x, y: o.y + off.y, z: o.z + off.z }, duration });
    await sleep(duration * 1000 + 400);
  };
  const squeeze = (on) => iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: on ? 1 : 0 }] });

  const shell = fresh.shells[0];
  await gripTo([shell.centre[0], shell.centre[1], shell.centre[2] + 0.2], 0.5);
  squeeze(true);
  const took = await waitFor('a shell in the right hand', () => drill().holds.right === 0, 4000).catch(() => false);
  const held = drill();
  const nose0 = held.shells[0].nose;
  const grip0 = gripWorld();
  const noseAt = (n) => [grip0[0] + n[0] - nose0[0], grip0[1] + n[1] - nose0[1], grip0[2] + n[2] - nose0[2]];
  await gripTo(noseAt([seat.x - 0.1, 1.15, layout.mouth[2] + 0.05]), 0.5);
  await gripTo(noseAt([layout.mouth[0], layout.mouth[1], layout.mouth[2] + 0.03]), 0.4);
  const captured = await waitFor('the shell on the bore', () => drill().breechShell === 0, 4000).catch(() => false);
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(layout.mouth) });
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-loading-breech.png'], {});
  const here = gripWorld();
  await gripTo([here[0], here[1], here[2] - 0.66], 0.6);
  const rammed = await waitFor('the shell rammed home', () => { const d = drill(); return d.rammed && d.holds.right === -1 && d; }, 4000).catch(() => drill());
  squeeze(false);
  check('A shell taken from the rack and swung to the breech snaps onto the bore and pushes home',
    took && captured && rammed.rammed && rammed.holds.right === -1,
    `took ${took}, on the bore ${captured}, depth ${rammed.depth.toFixed(3)} m, rammed ${rammed.rammed}`);

  // The lever: take its handle open (up) and pull it back towards the seat a quarter turn.
  const handleAt = (a) => [layout.pivot[0] + layout.handleX, layout.pivot[1] + layout.leverLength * Math.cos(a), layout.pivot[2] + layout.leverLength * Math.sin(a)];
  await gripTo(handleAt(0), 0.5);
  squeeze(true);
  const onLever = await waitFor('the lever in the right hand', () => drill().holds.right === -2, 4000).catch(() => false);
  for (const a of [0.4, 0.8, 1.2, 1.6, 1.8]) {
    await gripTo(handleAt(a), 0.25);
  }
  const loaded = await waitFor('the load counted', () => evalInApp('window.__loading.stats.loads') === 1, 4000).catch(() => false);
  const closed = drill();
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([seat.x - 0.2, 1.2, 0.8]) });
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-loading-closed.png'], {});
  squeeze(false);
  const stats = evalInApp('({ ...window.__loading.stats })');
  // A load counts only when the lever closes on a rammed shell. The drill may
  // already have fired (1.5 s later) by the time a slow runner reads it back.
  check('Pulling the lever back closes the breech on the rammed shell, and the drill counts and times the load',
    onLever && loaded && (closed.loaded ? Math.abs(closed.lever - Math.PI / 2) < 1e-6 : true) && stats.last > 0 && stats.fumbles === 0,
    `lever ${closed.lever.toFixed(2)} rad, loads ${stats.loads}, ${stats.last?.toFixed(1)} s, board "${closed.board.join(' | ')}"`);
  const fired = await waitFor('the drill to fire', () => { const d = drill(); return !d.loaded && d.lever === 0 && d.shells[0].place === 'rack' && d; }, 6000).catch(() => drill());
  check('The drill fires, opening the breech and putting the shell back in the rack',
    !fired.loaded && fired.lever === 0 && fired.breechShell === -1 && fired.shells[0].place === 'rack',
    `loaded ${fired.loaded}, lever ${fired.lever.toFixed(2)}, shell ${fired.shells[0].place}`);

  // A shell let go away from the breech: a fumble, and back to the rack.
  const second = fired.shells[1];
  await gripTo([second.centre[0], second.centre[1], second.centre[2] + 0.2], 0.5);
  squeeze(true);
  await waitFor('a second shell in the hand', () => drill().holds.right === 1, 4000).catch(() => false);
  await gripTo([seat.x + 0.15, 1.25, seat.z - 0.3], 0.4);
  squeeze(false);
  const dropped = await waitFor('the fumble', () => evalInApp('window.__loading.stats.dropped') === 1, 4000).catch(() => false);
  const back = await waitFor('the dropped shell back in the rack', () => drill().shells[1].place === 'rack', 6000).catch(() => false);
  check('A shell let go away from the breech counts as a fumble and goes back in the rack', dropped && back,
    `fumbles ${evalInApp('window.__loading.stats.fumbles')}, shell ${drill().shells[1].place}`);

  evalInApp('(window.__loading.reset(), window.__seats.reseat(), true)');
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
}

/** Press Y on the left controller: opens or closes the game menu. */
async function mechanismBench() {
  evalInApp('(window.__lever.hide(), true)');
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-bench'));
  iwsdk(['xr', 'set-device-state'], {});
  const shown = await waitFor('the mechanism bench', () => evalInApp('window.__bench.shown'), 5000).catch(() => false);
  const names = evalInApp('window.__bench.names');
  const state = (key) => evalInApp(`window.__mechanisms.state(${JSON.stringify(names[key])})`);
  const scene = (key, p) => evalInApp(`window.__mechanisms.toScene(${JSON.stringify(names[key])}, ${JSON.stringify(p)})`);
  const handle = (key, which = 1) => evalInApp(`window.__mechanisms.handle(${JSON.stringify(names[key])}, ${which})`);
  check('Practice > Mechanism kit puts the bench in front of the player', shown, `crank knob at ${fmt(handle('crank'))}`);
  const squeeze = (value, device = 'controller-right') => iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value }] });
  // Where to put the controller so the middle of its fist, where a handle runs through it, is at `p`.
  // The fist's offset from the controller is measured with the hand holding nothing (a held hand is
  // drawn on the handle), and kept while the controller's orientation stays the same.
  let fistOffset = [0, 0, 0];
  const measureFist = () => {
    const fist = evalInApp('window.__ownHands.fist("right")');
    const grip = evalInApp('window.__debug.world.player.gripSpaces.right.getWorldPosition(window.__debug.world.player.position.clone()).toArray()');
    fistOffset = [fist[0] - grip[0], fist[1] - grip[1], fist[2] - grip[2]];
  };
  const gripFor = (p) => toOrigin([p[0] - fistOffset[0], p[1] - fistOffset[1], p[2] - fistOffset[2]]);
  const take = async (key, label) => {
    measureFist();
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(handle(key)), duration: 0.4 });
    await sleep(600);
    squeeze(1);
    return waitFor(label, () => { const s = state(key); return s.heldBy === 'right' && s; }, 4000).catch(() => state(key));
  };
  const letGoOf = async (key) => {
    squeeze(0);
    await waitFor(`${key} let go`, () => state(key).heldBy === null, 3000).catch(() => false);
  };

  // The crank: round once, anticlockwise as seen from the front, a point every 45°.
  const crank = await take('crank', 'the crank taken hold of');
  const knob = 0.035;
  for (let k = 1; k <= 9; k++) {
    const a = (k * Math.PI) / 4;
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(scene('crank', [-0.09 * Math.sin(a), 0.09 * Math.cos(a), knob])), duration: 0.15 });
    await sleep(200);
  }
  const turned = await waitFor('the crank to turn once', () => { const s = state('crank'); return s.turns > 0.9 && s; }, 4000).catch(() => state('crank'));
  check('A gripped crank follows the hand round a full turn, ticking each quarter', crank.heldBy === 'right' && turned.turns > 0.9 && turned.turns < 1.4 && turned.detents >= 3,
    `${turned.turns.toFixed(2)} turns, ${turned.detents} ticks`);
  await letGoOf('crank');

  // The notched lever: pushed 12 cm forwards, past its front notch, and let go, it settles into that notch.
  await take('lever', 'the lever taken hold of');
  const leverAt = handle('lever');
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(scene('lever', [0, 0.21, -0.12])), duration: 0.4 });
  await waitFor('the lever past its front notch', () => state('lever').angle > 26, 4000).catch(() => false);
  await letGoOf('lever');
  const settled = await waitFor('the lever to settle', () => { const s = state('lever'); return Math.abs(s.angle - 25) < 0.5 && s; }, 4000).catch(() => state('lever'));
  check('The notched lever, let go past halfway, settles into the next notch with a tick',
    Math.abs(settled.angle - 25) < 0.5 && settled.notch === 2 && settled.detents >= 1, `angle ${settled.angle.toFixed(1)}° in notch ${settled.notch + 1}, from ${fmt(leverAt)}`);

  // The yoke in one hand: the hand swings its right handle 10 cm forwards; the yoke follows at 30°/s.
  await take('yoke', 'the yoke taken hold of');
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(scene('yoke', [0.09, 0, -0.08])), duration: 0.2 });
  await sleep(300);
  const early = state('yoke');
  const swung = await waitFor('the yoke to catch up', () => { const s = state('yoke'); return s.angle > 35 && s; }, 5000).catch(() => state('yoke'));
  check('One hand turns the yoke, slower than the hand goes, and feels the strain',
    early.angle < 35 && Math.max(...early.strain) > 2 && swung.angle > 35 && swung.heldBy === 'right', `${early.angle.toFixed(0)}° then ${swung.angle.toFixed(0)}°, strain ${Math.max(...early.strain).toFixed(0)}°`);
  await letGoOf('yoke');

  // The twist grip: take hold, roll the wrist 30° about the upright, pull the trigger.
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', orientation: { pitch: 0, yaw: 0, roll: 0 } });
  await sleep(200);
  measureFist();
  const twistAt = gripFor(handle('twist'));
  await take('twist', 'the twist grip taken hold of');
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: twistAt, orientation: { pitch: 0, yaw: 30, roll: 0 }, duration: 0.4 });
  const twisted = await waitFor('the grip to twist', () => { const s = state('twist'); return Math.abs(s.angle) > 15 && s; }, 4000).catch(() => state('twist'));
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 0, value: 1 }] });
  const fired = await waitFor('the trigger to fire', () => evalInApp('window.__bench.pulls') >= 1, 3000).catch(() => false);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 0, value: 0 }] });
  check('The twist grip twists with the wrist and fires with the trigger', Math.abs(twisted.angle) > 15 && fired,
    `twist ${twisted.angle.toFixed(1)}°, demand ${twisted.demand.toFixed(2)}, pulls ${evalInApp('window.__bench.pulls')}`);
  await letGoOf('twist');
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', orientation: { pitch: 0, yaw: 0, roll: 0 } });

  // The button and the switch, each by a squeeze.
  await take('button', 'the button pressed');
  const pressed = state('button');
  await letGoOf('button');
  const out = state('button');
  await take('switch', 'the switch pressed');
  await letGoOf('switch');
  const on = state('switch');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0, y: 1.6, z: 0 } });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(scene('yoke', [0, -0.25, 0])) });
  await sleep(400);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-mechanism-bench.png'], {});
  const lines = evalInApp('window.__bench.lines()');
  check('A squeeze presses the button while held and turns the switch on until pressed again',
    pressed.on && pressed.presses >= 1 && !out.on && on.on && on.heldBy === null, `board "${lines.join(' | ')}"`);
  evalInApp('(window.__bench.hide(), true)');
  await waitFor('the bench put away', () => !evalInApp('window.__bench.shown'), 3000).catch(() => false);
  iwsdk(['xr', 'set-device-state'], {});
}

async function menuButtonPress() {
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 1 }] });
  await sleep(300);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 0 }] });
  await sleep(300);
}

// Mirrors src/sim/ride.ts.
const RIDE = { tile: 240, driverEye: [-0.75, -1.95], gunnerEye: [-0.42, -0.4], turret: [0, 0.1] };

/**
 * 6c. Spike S2, riding the tank: Practice → As driver seats the player's
 *     head at the driver's eyes wherever they sit in their room; driving
 *     with the left stick moves the ground round the still hull (the hull
 *     floor stays where the tank is in the ground's space), and the
 *     vignette darkens as it speeds up until the menu turns it off. As
 *     gunner, the right stick traverses the turret and the head goes round
 *     with it. Stop puts the cabin back, with the player in their seat.
 */
async function ridingTheTank() {
  const state = () => evalInApp('window.__ride.state()');
  const thumbstick = (device, x, y) =>
    iwsdk(['xr', 'set-gamepad-state'], { device, axes: [{ index: 0, value: x }, { index: 1, value: y }] });
  // Seated off the room's middle, looking a little left.
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0.3, y: 1.2, z: 0.2 } });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: -0.5, y: 1.2, z: -3 } });
  await sleep(300);
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-ride-driver'));
  evalInApp("(window.__ride.set('tank', 'stick'), window.__ride.set('turret', 'still'), true)");
  const seated = await waitFor('the driver\'s seat', () => {
    const s = state();
    return s.active && Math.hypot(s.head[0] - RIDE.driverEye[0], s.head[2] - RIDE.driverEye[1]) < 0.02 && s;
  }, 5000).catch(() => state());
  check('Practice → As driver seats the head at the driver\'s eyes, the cabin hidden',
    seated.active && seated.seat === 'driver' && !seated.demoShown && seated.worldShown && Math.hypot(seated.head[0] - RIDE.driverEye[0], seated.head[2] - RIDE.driverEye[1]) < 0.02,
    `riding ${seated.active} as ${seated.seat}, head at ${fmt(seated.head)}, cabin ${seated.demoShown ? 'shown' : 'hidden'}`);

  // Drive forward: the tank moves through the ground, the hull stays put, the vignette darkens.
  thumbstick('controller-left', 0, -1);
  const moving = await waitFor('the tank to get going', () => { const s = state(); return s.tank.speed > 1 && s; }, 8000).catch(() => state());
  const placed = evalInApp(`(() => {
    const s = window.__ride.state();
    const w = (v) => v - ${RIDE.tile} * Math.round(v / ${RIDE.tile});
    const f = [-Math.sin(s.tank.heading), -Math.cos(s.tank.heading)];
    return {
      floor: window.__ride.drawnAt(w(s.tank.x), s.tank.y, w(s.tank.z)),
      ahead: window.__ride.drawnAt(w(s.tank.x) + 10 * f[0], s.tank.y, w(s.tank.z) + 10 * f[1]),
      alpha: s.vignetteAlpha,
    };
  })()`);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-ride-driver.png'], {});
  check('Driving moves the ground round the hull: the tank\'s spot stays under the hull floor, 10 m ahead stays ahead',
    moving.tank.odometer > 0.3 && Math.hypot(...placed.floor) < 0.01 && Math.abs(placed.ahead[0]) < 0.05 && Math.abs(placed.ahead[2] + 10) < 0.1,
    `${moving.tank.speed.toFixed(1)} m/s after ${moving.tank.odometer.toFixed(1)} m, the tank's spot drawn at ${fmt(placed.floor)}, 10 m ahead at ${fmt(placed.ahead)}`);
  check('The vignette darkens while the tank speeds up', placed.alpha > 0.2, `alpha ${placed.alpha.toFixed(2)}`);
  await menuButtonPress();
  const status = evalInApp('window.__gameMenu.text("menu-ride-status")');
  await rayClick(elementPosition('menu-panel', 'row-ride-vignette-1'));
  const unshaded = await waitFor('the vignette to go', () => { const s = state(); return !s.vignetteShown && s; }, 3000).catch(() => state());
  // Still moving fast enough that a vignette left on would show (40% at top speed).
  check('The menu shows the ride and turns the vignette off',
    status.startsWith('Riding as driver') && !unshaded.vignette && !unshaded.vignetteShown && unshaded.tank.speed > 5,
    `"${status}", vignette ${unshaded.vignette ? 'on' : 'off'} (alpha ${unshaded.vignetteAlpha.toFixed(2)}) at ${unshaded.tank.speed.toFixed(1)} m/s`);
  thumbstick('controller-left', 0, 0);

  // The gunner's seat goes round with the turret.
  await rayClick(elementPosition('menu-panel', 'menu-ride-gunner'));
  evalInApp("(window.__ride.set('turret', 'stick'), window.__ride.set('cabin', 'closed'), true)");
  thumbstick('controller-right', 1, 0);
  const turned = await waitFor('the turret to turn', () => { const s = state(); return s.turret.angle < -0.5 && s; }, 8000).catch(() => state());
  thumbstick('controller-right', 0, 0);
  const a = turned.turret.angle;
  const eye = [
    RIDE.turret[0] + RIDE.gunnerEye[0] * Math.cos(a) + RIDE.gunnerEye[1] * Math.sin(a),
    RIDE.turret[1] - RIDE.gunnerEye[0] * Math.sin(a) + RIDE.gunnerEye[1] * Math.cos(a),
  ];
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-ride-gunner-closed.png'], {});
  check('As gunner, the right stick turns the turret right and the head goes round with it, under the closed roof',
    turned.seat === 'gunner' && turned.roofShown && Math.hypot(turned.head[0] - eye[0], turned.head[2] - eye[1]) < 0.03,
    `turret at ${((a * 180) / Math.PI).toFixed(0)}°, head at ${fmt(turned.head)} for the seat at ${fmt(eye)}`);

  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-ride-stop'));
  await menuButtonPress();
  const backInSeat = () => {
    const s = state();
    const seat = evalInApp('({ eye: window.__seats.eye(window.__seats.mine), head: window.__seats.head() })');
    return { ...s, gap: Math.hypot(seat.head[0] - seat.eye[0], seat.head[2] - seat.eye[2]) };
  };
  const stopped = await waitFor('the player back in their seat', () => { const s = backInSeat(); return !s.active && s.gap < 0.02 && s; }, 5000).catch(() => backInSeat());
  check('Stop ends the ride, brings the cabin back and puts the player back in their seat',
    !stopped.active && stopped.demoShown && !stopped.worldShown && stopped.gap < 0.02,
    `riding ${stopped.active}, cabin ${stopped.demoShown ? 'shown' : 'hidden'}, head ${(stopped.gap * 100).toFixed(1)} cm from the seat's eye point`);
  evalInApp("(window.__ride.set('vignette', true), window.__ride.set('cabin', 'open'), window.__ride.set('tank', 'route'), window.__ride.set('turret', 'scan'), true)");
  iwsdk(['xr', 'set-device-state'], {});
}

/** Mirrors src/sim/terrain.ts and src/sim/tank-drive.ts. */
const DRIVE = { tile: 800, front: -3.0, rock: [-10, -45, 1.5] };

/**
 * 6d. The tank drive (F1.4): Practice → Drive the tank puts the player in
 *     the driver's seat with a sign; both sticks forwards drive the tank and
 *     the ground moves round the still hull (the tank's spot stays under the
 *     hull floor), the vignette darkens and S1's range rides out of sight;
 *     one stick turns the tank the other way; letting go stops it; the
 *     menu's gear lever grinds with a stick pushed and engages once both are
 *     let go; driven at the boulder, the tank stops against it without going
 *     in; Back to start parks it where it began.
 */
async function drivingTheTank() {
  const state = () => evalInApp('window.__drive.state()');
  const thumbstick = (device, x, y) =>
    iwsdk(['xr', 'set-gamepad-state'], { device, axes: [{ index: 0, value: x }, { index: 1, value: y }] });
  const sticks = (left, right) => {
    thumbstick('controller-left', 0, -left);
    thumbstick('controller-right', 0, -right);
  };
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-drive-go'));
  const seated = await waitFor('the driver\'s seat and the sign', () => {
    const s = evalInApp('({ seat: window.__seats.mine, sign: window.__drive.sign, driver: window.__drive.driver() })');
    return s.seat === 'driver' && s.sign.startsWith('Driving') && s;
  }, 5000).catch(() => evalInApp('({ seat: window.__seats.mine, sign: window.__drive.sign, driver: window.__drive.driver() })'));
  check('Practice → Drive the tank puts the player in the driver\'s seat with a sign saying how to drive',
    seated.seat === 'driver' && seated.driver === 'me' && seated.sign.startsWith('Driving'), `seat ${seated.seat}, sign "${seated.sign}"`);
  evalInApp('(window.__drive.reset(), true)');

  sticks(1, 1);
  const moving = await waitFor('the tank to get going', () => { const s = state(); return s.speed > 1.5 && s; }, 10000).catch(() => state());
  const placed = evalInApp(`(() => {
    const s = window.__drive.state();
    const w = (v) => v - ${DRIVE.tile} * Math.round(v / ${DRIVE.tile});
    const f = [-Math.sin(s.heading), -Math.cos(s.heading)];
    return {
      floor: window.__drive.drawnAt(w(s.x), s.y, w(s.z)),
      ahead: window.__drive.drawnAt(w(s.x) + 10 * f[0], s.y, w(s.z) + 10 * f[1]),
      alpha: window.__drive.vignetteAlpha,
      range: window.__range.drawnRange(0),
    };
  })()`);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-drive.png'], {});
  check('Both sticks forwards drive the tank straight ahead and the ground moves round the hull',
    moving.speed > 1.5 && moving.z < -0.5 && Math.abs(moving.yawRate) < 1e-3 && Math.hypot(...placed.floor) < 0.01 && Math.abs(placed.ahead[0]) < 0.05 && Math.abs(placed.ahead[2] + 10) < 0.1,
    `${moving.speed.toFixed(1)} m/s at ${moving.rpm.toFixed(0)} rpm after ${moving.odometer.toFixed(1)} m, the tank's spot drawn at ${fmt(placed.floor)}, 10 m ahead at ${fmt(placed.ahead)}`);
  check("The vignette darkens as the tank pulls away, and the range's 100 m target comes nearer as it drives at it",
    placed.alpha > 0.1 && placed.range < 100 - moving.odometer + 1,
    `alpha ${placed.alpha.toFixed(2)}, the 100 m target drawn ${placed.range.toFixed(1)} m away after ${moving.odometer.toFixed(1)} m`);

  sticks(1, 0);
  const turning = await waitFor('the tank to turn right', () => { const s = state(); return s.yawRate < -0.1 && s; }, 6000).catch(() => state());
  check('One stick forwards turns the tank the other way', turning.yawRate < -0.1 && turning.leftTrack > turning.rightTrack,
    `turning ${((turning.yawRate * 180) / Math.PI).toFixed(1)}°/s, tracks ${turning.leftTrack.toFixed(2)} and ${turning.rightTrack.toFixed(2)} m/s`);
  sticks(0, 0);
  const stopped = await waitFor('the tank to stop', () => { const s = state(); return Math.abs(s.speed) < 0.01 && Math.abs(s.yawRate) < 0.01 && s; }, 10000).catch(() => state());
  check('Letting go of the sticks stops the tank', Math.abs(stopped.speed) < 0.01, `${stopped.speed.toFixed(2)} m/s`);

  // The gear lever: into high with a stick pushed grinds; let go and it goes in.
  sticks(1, 1);
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'row-gear-2'));
  const grinding = await waitFor('the gears to grind', () => {
    const s = { ...state(), sign: evalInApp('window.__drive.sign') };
    return s.grinding && s;
  }, 5000).catch(() => ({ ...state(), sign: evalInApp('window.__drive.sign') }));
  check('Moving the gear lever with a stick pushed grinds: out of gear, with a sign',
    grinding.grinding && grinding.gear === 0 && grinding.sign.startsWith('Gears grinding'), `gear ${grinding.gear}, sign "${grinding.sign}"`);
  sticks(0, 0);
  // The menu's line redraws twice a second.
  const geared = () => ({ ...state(), status: evalInApp('window.__gameMenu.text("menu-drive-status")') });
  const shifted = await waitFor('high gear to engage', () => { const s = geared(); return s.gear === 2 && s.status.includes('high gear') && s; }, 5000).catch(() => geared());
  const status = shifted.status;
  check('With the sticks let go the gear goes in, and the menu says so', shifted.gear === 2 && !shifted.grinding && status.includes('high gear'),
    `gear ${shifted.gear}, "${status}"`);
  await rayClick(elementPosition('menu-panel', 'row-gear-1'));
  await menuButtonPress();

  // Into the boulder: the tank stops against it, never in it.
  const [rx, rz, rr] = DRIVE.rock;
  const stopAt = rz + rr - DRIVE.front;
  evalInApp(`(window.__drive.place(${rx}, ${stopAt + 6}, 0), true)`);
  await waitFor('low gear', () => state().gear === 1, 5000).catch(() => null);
  sticks(1, 1);
  const bumped = await waitFor('the tank to stop at the boulder', () => {
    const s = state();
    return s.touching && Math.abs(s.speed) < 0.1 && s;
  }, 15000).catch(() => state());
  sticks(0, 0);
  check('Driven at the boulder, the tank stops against it without going in',
    bumped.touching && Math.abs(bumped.speed) < 0.1 && bumped.z > stopAt - 0.02 && bumped.z < stopAt + 0.3,
    `stopped at z ${bumped.z.toFixed(2)} for the boulder's edge at ${stopAt.toFixed(2)}, ${bumped.speed.toFixed(2)} m/s, ${bumped.bumps} bump(s)`);

  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-drive-reset'));
  await menuButtonPress();
  const atStart = () => ({ ...state(), ranges: evalInApp('window.__range.targets().map((t, i) => window.__range.drawnRange(i))') });
  const home = await waitFor('the tank back at its start', () => {
    const s = atStart();
    return Math.hypot(s.x, s.z) < 0.01 && Math.abs(s.ranges[0] - 100) < 3 && s;
  }, 5000).catch(() => atStart());
  check('Back to start parks the tank where it began, with the three targets back at 100, 250 and 500 m',
    Math.hypot(home.x, home.z) < 0.01 && home.speed === 0 && [100, 250, 500].every((r, i) => Math.abs(home.ranges[i] - r) < 3),
    `at ${home.x.toFixed(2)}, ${home.z.toFixed(2)}, targets drawn at ${home.ranges.map((r) => r.toFixed(1)).join(', ')} m`);
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6g. The test range (F1.7): the three targets stand out at 100, 250 and
 *     500 m with a marker every 100 m up the road, the fog is on with the
 *     range's numbers and turns off and on from the menu's settings, and
 *     Practice → Test range → Up the range parks the tank 200 m up the road
 *     facing the far target, with the gun target the nearest and the menu
 *     naming it.
 */
async function theTestRange() {
  const range = () => evalInApp('({ targets: window.__range.targets(), markers: window.__range.markers(), fog: window.__range.fog(), tank: window.__range.tank() })');
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp('(window.__drive.reset(), true)');
  const laid = await waitFor('the range laid out round the parked tank', () => {
    const r = range();
    return Math.hypot(r.tank.x, r.tank.z) < 0.5 && r;
  }, 5000).catch(() => range());
  check('The range stands three targets at 100, 250 and 500 m, with a marker every 100 m up the road',
    laid.targets.map((t) => t.range).join() === '100,250,500' && laid.markers.join() === '100,200,300,400,500,600' &&
      laid.tank.nearest === 0 && Math.abs(laid.tank.distance - 100) < 12,
    `targets ${laid.targets.map((t) => `${t.kind} at ${t.range} m`).join(', ')}; nearest ${Math.round(laid.tank.distance)} m away; markers ${laid.markers.join(', ')} m`);
  check('The fog is on, thick enough to hide the ground\'s drawn edge and thin enough to leave the 500 m target to be found',
    laid.fog.on && laid.fog.at500 > 0.3 && laid.fog.at500 < 0.7 && laid.fog.limit > 550 && laid.fog.limit < 680,
    `fog ${laid.fog.near}–${laid.fog.far} m, ${(laid.fog.at500 * 100).toFixed(0)}% of the 500 m target, seen to about ${Math.round(laid.fog.limit)} m`);

  // Look down the range from the gunner's seat and photograph it.
  evalInApp("(window.__seats.ask('gunner'), true)");
  await sleep(600);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-range.png'], {});

  // The fog is a live setting: off and on again from the menu.
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'row-fog-1'));
  const fogOff = await waitFor('the fog off', () => { const f = evalInApp('window.__range.fog()'); return !f.on && f; }, 5000)
    .catch(() => evalInApp('window.__range.fog()'));
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-range-clear.png'], {});
  check("The menu's Range fog setting clears the air at once", fogOff.on === false, `fog ${fogOff.on ? 'on' : 'off'}`);
  await rayClick(elementPosition('menu-panel', 'row-fog-0'));
  await waitFor('the fog back on', () => evalInApp('window.__range.fog().on'), 5000).catch(() => null);

  // Practice → Up the range: parked 200 m up the road facing the far target.
  await rayClick(elementPosition('menu-panel', 'menu-range-up'));
  const up = await waitFor('the tank parked up the range', () => {
    const r = range();
    return r.tank.nearest === 1 && Math.abs(r.tank.distance - 51) < 10 && r;
  }, 8000).catch(() => range());
  const facing = evalInApp('window.__drive.state()');
  const toTarget = [up.targets[2].x - up.tank.x, up.targets[2].z - up.tank.z];
  const forward = [-Math.sin(facing.heading), -Math.cos(facing.heading)];
  const length = Math.hypot(...toTarget);
  const aligned = (forward[0] * toTarget[0] + forward[1] * toTarget[1]) / length;
  await sleep(400);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-range-up.png'], {});
  check('Practice → Up the range parks the tank 200 m up the road facing the far target, the gun target nearest',
    up.tank.nearest === 1 && Math.abs(up.tank.distance - 51) < 10 && Math.abs(up.tank.x) < 1 && aligned > 0.99 && facing.speed === 0 &&
      Math.abs(length - 300) < 10,
    `parked ${Math.round(length)} m from the ${up.targets[2].range} m target and ${Math.round(up.tank.distance)} m from the ${up.targets[1].range} m one, at x ${up.tank.x.toFixed(1)}, facing the far one within ${(Math.acos(Math.min(1, aligned)) * 180 / Math.PI).toFixed(1)}°`);
  // The menu's line redraws twice a second while it is open.
  await menuButtonPress();
  const status = await waitFor('the range line to name the target ahead', () => {
    const text = evalInApp("window.__gameMenu.text('menu-range-status')");
    return text.includes(`${up.targets[1].range} m`) ? text : null;
  }, 5000).catch(() => evalInApp("window.__gameMenu.text('menu-range-status')"));
  check("The menu's range line names the nearest target and how far the fog lets the crew see",
    status.includes(`${up.targets[1].range} m`) && /fog to about \d+ m/.test(status), `"${status}"`);
  await menuButtonPress();
  evalInApp('(window.__drive.reset(), true)');
  evalInApp("(window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6h. The gunsight (F1.9): up the range, Practice → Gunsight → Go to it puts
 *     the head behind the eyepiece and Lay on → 500 m lays the gun so the far
 *     target (300 m off from there) sits on the reticle's mark for its range,
 *     both by the sums and as the sight camera and the ground are drawn.
 *     Elevating the gun tilts the sight's view with it while the eyepiece
 *     stays still (an articulated sight). Leaning in renders the target.
 */
async function layingWithTheSight() {
  const sight = (expr) => evalInApp(`window.__sight.${expr}`);
  const fmtError = (e) => `${e.across.toFixed(3)} mil right, ${e.up.toFixed(3)} mil up at ${Math.round(e.range)} m`;
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-range-up'));
  await waitFor('the tank parked up the range', () => evalInApp('window.__range.tank().nearest') === 1, 8000).catch(() => null);
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-sight-go'));
  const lens0 = sight('lens()');
  const behindLens = (head, lens) => (head[0] - lens.at[0]) * lens.facing[0] + (head[2] - lens.at[2]) * lens.facing[2];
  const there = await waitFor('the eyepiece', () => {
    const s = seated();
    const lens = sight('lens()');
    return s.mine === 'gunner' && behindLens(s.head, lens) > 0.1 && behindLens(s.head, lens) < 0.2 ? s : null;
  }, 5000).catch(() => seated());
  check('Practice → Gunsight → Go to it sits the player in the gunner\'s seat just behind the eyepiece',
    there.mine === 'gunner', `${there.mine}, head ${fmt(there.head)}, lens ${fmt(lens0.at)}`);

  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-sight-lay-2'));
  const laid = await waitFor('the gun laid on the far target', () => {
    const e = sight('error(2)');
    return Math.abs(e.across) < 0.05 && Math.abs(e.up) < 0.05 && e;
  }, 5000).catch(() => sight('error(2)'));
  const drawn = sight('drawnError(2)');
  const status = sight('state()').status;
  const turret = evalInApp('window.__turret.state()');
  check('Lay on → 500 m turns the turret and gun so the far target, 300 m off up the range, sits on its range mark',
    Math.abs(laid.across) < 0.05 && Math.abs(laid.up) < 0.05 && Math.abs(laid.range - 300) < 10 && status.includes('500 m target'),
    `${fmtError(laid)}; turret ${turret.yawDeg.toFixed(2)}°, gun ${turret.elevationDeg.toFixed(2)}°; "${status}"`);
  check('The sight camera as drawn sees the far target on its mark too',
    Math.abs(drawn.across) < 0.3 && Math.abs(drawn.up) < 0.3 && Math.abs(drawn.range - laid.range) < 1, fmtError(drawn));

  // Elevate the gun 10° more: the sight's view tilts with it, the eyepiece stays where it was.
  const before = { lens: sight('lens()'), view: sight('view()') };
  evalInApp(`(window.__turret.set({ elevation: ${turret.elevationDeg + 10} }), true)`);
  const raised = await waitFor('the gun raised', () => {
    const t = evalInApp('window.__turret.state()');
    return t.elevationDeg > turret.elevationDeg + 9.9 && t;
  }, 4000).catch(() => evalInApp('window.__turret.state()'));
  await sleep(200);
  const after = { lens: sight('lens()'), view: sight('view()') };
  evalInApp('(window.__turret.set(null), true)');
  const pitch = (v) => (Math.asin(v.looking[1]) * 180) / Math.PI;
  const lensMoved = Math.hypot(...after.lens.at.map((v, i) => v - before.lens.at[i]));
  check('Elevating the gun tilts the sight\'s view with it, while the eyepiece stays still',
    raised.elevationDeg > turret.elevationDeg + 9.9 && Math.abs(pitch(after.view) - pitch(before.view) - 10) < 0.5 && lensMoved < 0.002,
    `view ${pitch(before.view).toFixed(2)}° to ${pitch(after.view).toFixed(2)}°, eyepiece moved ${(lensMoved * 1000).toFixed(1)} mm`);

  // Lay again and lean in: the far target in the picture.
  evalInApp('(window.__sight.lay(2), true)');
  await sleep(300);
  const lens = sight('lens()');
  const rendersBefore = sight('state()').renders;
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toRig(lens.at.map((v, i) => v + lens.facing[i] * 0.06)) });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toRig(lens.at.map((v, i) => v - lens.facing[i] * 20)) });
  const open = await waitFor('the sight to open', () => {
    const s = sight('state()');
    return s.open && s.renders > rendersBefore + 5 ? s : null;
  }, 10000).catch(() => sight('state()'));
  await sleep(500);
  const spread = sight('pictureSpread()');
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-gunsight-500m.png'], {});
  check('Leaning in to the laid sight renders the range',
    open.open && spread > 20, `open ${open.open}, ${open.renders - rendersBefore} frames, picture spread ${spread}, ${open.calls} calls, ${Math.round(open.triangles / 1000)}k triangles`);

  evalInApp("(window.__sight.lay('ahead'), true)");
  const ahead = await waitFor('the turret ahead', () => { const t = evalInApp('window.__turret.state()'); return Math.abs(t.yaw) < 1e-6 && t; }, 4000).catch(() => evalInApp('window.__turret.state()'));
  check('Lay on → Ahead turns the turret and gun straight ahead', Math.abs(ahead.yaw) < 1e-6 && ahead.elevation === 0, `turret ${ahead.yawDeg.toFixed(2)}°, gun ${ahead.elevationDeg.toFixed(2)}°`);
  evalInApp('(window.__drive.reset(), true)');
  evalInApp("(window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
  await waitFor("the driver's seat again", () => seated().mine === 'driver', 5000).catch(() => null);
}

/**
 * 6f. The turret (F1.8): Practice → Lay the gun → Gunner puts the player in
 *     the gunner's seat with a sign; the power grip twisted left traverses
 *     the turret left and the gunner's play space turns with it (the head
 *     stays put in the turret), the vignette darkening; let go, it stops;
 *     a turn of the crank traverses about 2°; a quarter turn clockwise of
 *     the elevation wheel raises the gun about 0.75°; Forward puts it back.
 */
async function layingTheGun() {
  const turret = () => evalInApp('window.__turret.state()');
  const names = evalInApp('window.__turret.names');
  const state = (key) => evalInApp(`window.__mechanisms.state(${JSON.stringify(names[key])})`);
  const scene = (key, p) => evalInApp(`window.__mechanisms.toScene(${JSON.stringify(names[key])}, ${JSON.stringify(p)})`);
  const handle = (key, which = 1) => evalInApp(`window.__mechanisms.handle(${JSON.stringify(names[key])}, ${which})`);
  const squeeze = (value) => iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value }] });
  let fistOffset = [0, 0, 0];
  const measureFist = () => {
    const fist = evalInApp('window.__ownHands.fist("right")');
    const grip = evalInApp('window.__debug.world.player.gripSpaces.right.getWorldPosition(window.__debug.world.player.position.clone()).toArray()');
    fistOffset = [fist[0] - grip[0], fist[1] - grip[1], fist[2] - grip[2]];
  };
  const gripFor = (p) => toOrigin([p[0] - fistOffset[0], p[1] - fistOffset[1], p[2] - fistOffset[2]]);
  const take = async (key, which = 1) => {
    measureFist();
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(handle(key, which)), duration: 0.4 });
    await sleep(600);
    squeeze(1);
    return waitFor(`the ${key} taken hold of`, () => { const s = state(key); return s.heldBy === 'right' && s; }, 4000).catch(() => state(key));
  };
  const letGoOf = async (key) => {
    squeeze(0);
    await waitFor(`${key} let go`, () => state(key).heldBy === null, 3000).catch(() => false);
  };

  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-turret-go'));
  const seated = await waitFor('the gunner\'s seat and the sign', () => {
    const s = evalInApp('({ seat: window.__seats.mine, sign: window.__turret.sign, owner: window.__turret.owner() })');
    return s.seat === 'gunner' && s.sign.startsWith('Laying') && s;
  }, 5000).catch(() => evalInApp('({ seat: window.__seats.mine, sign: window.__turret.sign, owner: window.__turret.owner() })'));
  check('Practice → Lay the gun puts the player in the gunner\'s seat with a sign saying how to lay the gun',
    seated.seat === 'gunner' && seated.owner && seated.sign.startsWith('Laying'), `seat ${seated.seat}, sign "${seated.sign}"`);
  evalInApp('(window.__turret.forward(), true)');
  await sleep(300);

  // The power grip: twisted left (anticlockwise seen from above) traverses left, and the basket turns the gunner with it.
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', orientation: { pitch: 0, yaw: 0, roll: 0 } });
  await sleep(200);
  measureFist();
  const gripAt = gripFor(handle('twist'));
  const held = await take('twist');
  const headBefore = evalInApp('window.__turret.headInTurret()');
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripAt, orientation: { pitch: 0, yaw: 35, roll: 0 }, duration: 0.4 });
  const traversing = await waitFor('the turret to traverse left', () => {
    const s = turret();
    return s.yawDeg > 8 && s.rateDeg > 4 && s;
  }, 8000).catch(() => turret());
  const turning = evalInApp('({ head: window.__turret.headInTurret(), drawn: window.__turret.drawn(), alpha: window.__drive.vignetteAlpha, grip: window.__mechanisms.state(window.__turret.names.twist) })');
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-turret.png'], {});
  check('Twisting the power grip left traverses the turret left, at about the idle rate',
    held.heldBy === 'right' && traversing.yawDeg > 8 && traversing.rateDeg > 4 && traversing.rateDeg < 9 && Math.abs(turning.drawn.yaw - traversing.yawDeg) < 3,
    `turret ${traversing.yawDeg.toFixed(1)}° at ${traversing.rateDeg.toFixed(1)}°/s (drawn ${turning.drawn.yaw.toFixed(1)}°), grip ${turning.grip.angle.toFixed(1)}°`);
  check('The gunner turns with the basket: the head stays put in the turret, and the vignette darkens',
    Math.hypot(turning.head[0] - headBefore[0], turning.head[2] - headBefore[2]) < 0.03 && turning.alpha > 0.05,
    `head moved ${(100 * Math.hypot(turning.head[0] - headBefore[0], turning.head[2] - headBefore[2])).toFixed(1)} cm in the turret, vignette ${turning.alpha.toFixed(2)}`);
  await letGoOf('twist');
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', orientation: { pitch: 0, yaw: 0, roll: 0 } });
  const stopped = await waitFor('the turret to stop', () => { const s = turret(); return s.rate === 0 && s; }, 4000).catch(() => turret());
  check('Let go, the power grip springs back and the turret stops', stopped.rate === 0, `${stopped.rateDeg.toFixed(2)}°/s`);

  // The crank: once round anticlockwise traverses 2° left.
  const yaw0 = turret().yawDeg;
  await take('crank');
  const r = 0.08;
  const knob = 0.03;
  for (let k = 1; k <= 9; k++) {
    const a = (k * Math.PI) / 4;
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(scene('crank', [-r * Math.sin(a), r * Math.cos(a), knob])), duration: 0.15 });
    await sleep(200);
  }
  const cranked = await waitFor('the crank to turn once', () => { const s = state('crank'); return s.turns > 0.9 && s; }, 4000).catch(() => state('crank'));
  const afterCrank = turret().yawDeg;
  check('A turn of the crank traverses the turret about 2° left',
    cranked.turns > 0.9 && afterCrank - yaw0 > 1.6 && afterCrank - yaw0 < 2.9, `${cranked.turns.toFixed(2)} turns: ${yaw0.toFixed(2)}° to ${afterCrank.toFixed(2)}°`);
  await letGoOf('crank');

  // The elevation wheel: taken at its right side and turned a quarter clockwise, the gun rises.
  const e0 = turret().elevationDeg;
  await take('elevation', 1);
  const rr = 0.11;
  for (let k = 1; k <= 6; k++) {
    const a = -Math.PI / 2 - (k * Math.PI) / 12;
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(scene('elevation', [-rr * Math.sin(a), rr * Math.cos(a), 0])), duration: 0.15 });
    await sleep(200);
  }
  const raised = await waitFor('the gun to rise', () => { const s = turret(); return s.elevationDeg - e0 > 0.4 && s; }, 4000).catch(() => turret());
  const drawn = evalInApp('window.__turret.drawn()');
  check('A quarter turn clockwise of the elevation wheel raises the gun about 0.75°',
    raised.elevationDeg - e0 > 0.4 && raised.elevationDeg - e0 < 1.0 && Math.abs(drawn.elevation - raised.elevationDeg) < 0.05,
    `gun ${e0.toFixed(2)}° to ${raised.elevationDeg.toFixed(2)}°, drawn ${drawn.elevation.toFixed(2)}°`);
  await letGoOf('elevation');

  await menuButtonPress();
  await rayClick(elementPosition('menu-panel', 'menu-turret-forward'));
  await menuButtonPress();
  const home = await waitFor('the turret forward', () => { const s = turret(); return Math.abs(s.yaw) < 1e-6 && s.elevation === 0 && s; }, 5000).catch(() => turret());
  const headHome = evalInApp('window.__turret.headInTurret()');
  check('Forward turns the turret and the gun straight ahead, with the gunner still in the seat',
    Math.abs(home.yaw) < 1e-6 && home.elevation === 0 && Math.hypot(headHome[0] - headBefore[0], headHome[2] - headBefore[2]) < 0.05,
    `turret ${home.yawDeg.toFixed(2)}°, gun ${home.elevationDeg.toFixed(2)}°`);
  // Back in the driver's seat for what follows.
  evalInApp("(window.__seats.ask('driver'), true)");
  await sleep(500);
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6e. The driver's station (F1.5): in the driver's seat, both hands take
 *     the tillers and push them forwards: the tank drives on them (not the
 *     sticks), the gloves closed on the handles and the gauges reading
 *     speed and RPM; let go, they spring back and the tank stops. One hand
 *     pushes a tiller while the other moves the gear lever from low to
 *     high: the gears grind; let go of the tiller and high goes in. The
 *     hand throttle pushed forwards raises the idle and stays where it is
 *     left.
 */
async function driverStation() {
  const station = () => evalInApp('window.__driverStation.state()');
  const gauges = () => evalInApp('window.__driverStation.gauges()');
  const tank = () => evalInApp('window.__drive.state()');
  const handle = (id, deg) => evalInApp(`window.__driverStation.handle(${JSON.stringify(id)}${deg === undefined ? '' : `, ${deg}`})`);
  const squeeze = (device, value) => iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value }] });
  const handTo = (device, p, duration = 0.4) => iwsdk(['xr', 'animate-to'], { device, position: toOrigin(p), duration });
  const take = async (device, id) => {
    handTo(device, handle(id));
    await sleep(600);
    squeeze(device, 1);
    await sleep(300);
  };

  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  evalInApp('(window.__drive.set(null), window.__drive.reset(), true)');
  const usable = await waitFor('the driver\'s seat', () => { const s = station(); return s.usable && s; }, 5000).catch(() => station());
  check('In the driver\'s seat the station\'s controls can be used', usable.usable, JSON.stringify(usable.angles));

  // Both tillers forwards.
  await take('controller-left', 'tillerLeft');
  await take('controller-right', 'tillerRight');
  const held = station();
  const locked = evalInApp('[window.__ownHands.locked("left"), window.__ownHands.locked("right")]');
  check('Squeezing at the tillers takes hold of both, the gloves closed on them',
    held.heldBy.tillerLeft === 'left' && held.heldBy.tillerRight === 'right' && locked[0] > 0.9 && locked[1] > 0.9,
    `held by ${held.heldBy.tillerLeft} and ${held.heldBy.tillerRight}, gloves ${locked.map((v) => v.toFixed(2)).join(' and ')} on`);
  handTo('controller-right', handle('tillerRight', 25));
  handTo('controller-left', handle('tillerLeft', 25));
  const pushed = await waitFor('both tillers forwards', () => { const s = station(); return s.left > 0.8 && s.right > 0.8 && s; }, 5000).catch(() => station());
  // The CLI moves one controller after the other: start the run once both are forwards.
  evalInApp('(window.__drive.reset(), true)');
  const driving = await waitFor('the tank to drive on the tillers', () => { const t = tank(); return t.speed > 1.5 && t; }, 10000).catch(() => tank());
  const readings = gauges();
  check('Both tillers pushed forwards drive the tank straight ahead',
    pushed.tillersHeld && driving.speed > 1.5 && Math.abs(driving.yawRate) < 0.02,
    `tillers ${pushed.left.toFixed(2)} and ${pushed.right.toFixed(2)} (${pushed.angles.tillerLeft.toFixed(1)}° and ${pushed.angles.tillerRight.toFixed(1)}°), ${driving.speed.toFixed(1)} m/s`);
  check('The gauges read the tank: speed and RPM up, coolant, oil and fuel in range',
    Math.abs(readings.speed - driving.speed * 3.6) < 2 && readings.rpm > 1500 && readings.coolant > 40 && readings.oil > 2 && readings.fuel > 0.9,
    `${readings.speed.toFixed(1)} km/h, ${readings.rpm.toFixed(0)} rpm, ${readings.coolant.toFixed(0)} °C, ${readings.oil.toFixed(1)} bar, fuel ${readings.fuel.toFixed(2)}`);
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin([-0.35, 1.55, -1.45]) });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([-0.45, 0.95, -2.2]) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-driver-station.png'], {});
  squeeze('controller-left', 0);
  squeeze('controller-right', 0);
  const stopped = await waitFor('the tank to stop', () => {
    const s = station();
    const t = tank();
    return !s.tillersHeld && Math.abs(s.angles.tillerLeft) < 1 && Math.abs(s.angles.tillerRight) < 1 && Math.abs(t.speed) < 0.01 && { s, t };
  }, 10000).catch(() => ({ s: station(), t: tank() }));
  check('Let go, the tillers spring back upright and the tank stops',
    !stopped.s.tillersHeld && Math.abs(stopped.s.angles.tillerLeft) < 1 && Math.abs(stopped.t.speed) < 0.01,
    `tillers at ${stopped.s.angles.tillerLeft.toFixed(1)}° and ${stopped.s.angles.tillerRight.toFixed(1)}°, ${stopped.t.speed.toFixed(2)} m/s`);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);

  // A tiller pushed while the other hand shifts from low to high: the gears grind.
  const before = station();
  await take('controller-right', 'tillerRight');
  handTo('controller-right', handle('tillerRight', 20));
  await take('controller-left', 'gear');
  const onLever = station();
  handTo('controller-left', handle('gear', 0), 0.3);
  await sleep(400);
  handTo('controller-left', handle('gear', 24), 0.3);
  // Read in one go: the station counts a grind on the frame the tank starts grinding.
  const both = () => evalInApp('({ s: window.__driverStation.state(), t: window.__drive.state(), sign: window.__drive.sign })');
  const grinding = await waitFor('the gears to grind', () => {
    const b = both();
    return b.t.grinding && b.s.gear === 2 && b.s.grinds > before.grinds && b;
  }, 6000).catch(() => both());
  check('Moving the gear lever from low to high with a tiller pushed grinds the gears',
    onLever.heldBy.gear === 'left' && grinding.t.grinding && grinding.t.gear === 0 && grinding.s.grinds > before.grinds && grinding.sign.startsWith('Gears grinding'),
    `lever held by ${onLever.heldBy.gear} at ${grinding.s.angles.gear.toFixed(1)}° (gear ${grinding.s.gear}), box in gear ${grinding.t.gear}, ${grinding.s.grinds - before.grinds} grind(s), sign "${grinding.sign}"`);
  squeeze('controller-right', 0);
  const shifted = await waitFor('high gear to go in', () => { const t = tank(); return t.gear === 2 && !t.grinding && t; }, 6000).catch(() => tank());
  check('Let go of the tiller, high gear goes in', shifted.gear === 2 && !shifted.grinding && station().shifts > before.shifts,
    `gear ${shifted.gear}, ${station().shifts - before.shifts} shift(s)`);
  // Back to low, let go near its notch: it drops in.
  handTo('controller-left', handle('gear', 0), 0.3);
  await sleep(400);
  handTo('controller-left', handle('gear', -19), 0.3);
  await sleep(500);
  squeeze('controller-left', 0);
  const low = await waitFor('low gear', () => { const s = station(); const t = tank(); return t.gear === 1 && Math.abs(s.angles.gear + 24) < 1 && { s, t }; }, 6000)
    .catch(() => ({ s: station(), t: tank() }));
  check('The gear lever let go near low drops into its notch and low goes in', low.t.gear === 1 && Math.abs(low.s.angles.gear + 24) < 1,
    `lever at ${low.s.angles.gear.toFixed(1)}°, gear ${low.t.gear}`);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);

  // The hand throttle: forwards raises the idle, and it stays where it is left.
  await take('controller-left', 'throttle');
  handTo('controller-left', handle('throttle', 40));
  await sleep(600);
  squeeze('controller-left', 0);
  const revving = await waitFor('the idle to rise', () => { const t = tank(); return t.rpm > 1400 && t; }, 6000).catch(() => tank());
  await sleep(500);
  const left = station();
  check('The hand throttle pushed forwards raises the idle and stays there when let go',
    left.throttle > 0.95 && left.angles.throttle > 38 && revving.rpm > 1400 && Math.abs(revving.speed) < 0.01,
    `throttle ${left.throttle.toFixed(2)} at ${left.angles.throttle.toFixed(1)}°, ${revving.rpm.toFixed(0)} rpm at ${revving.speed.toFixed(2)} m/s`);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  await take('controller-left', 'throttle');
  handTo('controller-left', handle('throttle', 0));
  await sleep(600);
  squeeze('controller-left', 0);
  iwsdk(['xr', 'set-device-state'], {});
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
  await calibrationStep();
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

  // 1c. Eye height (F1.2): the menu's +5 cm raises the eyes above the
  //     driver's eye point, hands too; standing up out of the chair stops
  //     the head under the roof.
  const bodyState = () => evalInApp('({ ...window.__body.state, head: window.__seats.head(), eye: window.__seats.eye("driver"), roof: window.__seats.fixes.roof, hand: window.__ownHands.position("right") })');
  const level = bodyState();
  evalInApp('(window.__body.choose({ raise: 0.05, seated: true }), true)');
  const raised = await waitFor('the eyes 5 cm up', () => { const b = bodyState(); return Math.abs(b.head[1] - (b.eye[1] + 0.05)) < 0.005 && b; }, 5000).catch(() => bodyState());
  check("The menu's eye height raises the eyes 5 cm above the seat's eye point, hands too",
    Math.abs(raised.head[1] - (raised.eye[1] + 0.05)) < 0.005 && Math.abs(raised.hand[1] - level.hand[1] - 0.05) < 0.005,
    `head at ${raised.head[1].toFixed(3)} m for ${(raised.eye[1] + 0.05).toFixed(3)}, right hand ${(raised.hand[1] - level.hand[1]).toFixed(3)} m higher`);
  evalInApp('(window.__body.choose({ raise: 0, seated: true }), true)');
  const now1c = iwsdk(['xr', 'get-transform'], { device: 'headset' }).result.position;
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: now1c.x, y: now1c.y + 0.45, z: now1c.z } });
  // Mirrors the driver's headUp in src/sim/cabin.ts: the hull roof (1.8 m) less 15 cm.
  const top = 1.8 - 0.15;
  const stood = await waitFor('the head under the roof', () => { const b = bodyState(); return b.roof > level.roof && Math.abs(b.head[1] - top) < 0.005 && b; }, 5000).catch(() => bodyState());
  check('Standing up out of the seat stops the head under the roof',
    stood.roof > level.roof && Math.abs(stood.head[1] - top) < 0.005,
    `head at ${stood.head[1].toFixed(3)} m, roof stop at ${top.toFixed(3)} m, ${stood.roof - level.roof} stop(s)`);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);


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

  // 5c. The mechanism kit (F1.3): Practice > Mechanism kit puts a bench of
  //     controls in front of the player. A crank follows the hand round a
  //     full turn ticking each quarter, the notched lever settles into the
  //     notch it is let go nearest, one hand turns the yoke (slowly), the
  //     twist grip twists with the wrist and fires with the trigger, and a
  //     squeeze presses the button and turns the switch on.
  await mechanismBench();

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
  const letGo = await waitFor('the grip to let go', () => {
    const g = pinching();
    return !g.pressed ? g : null;
  }, 3000).catch(() => pinching());
  check('A tracked hand grips with a pinch and lets go', !open.pressed && pinched.pressed && pinched.hand && !letGo.pressed,
    `before ${JSON.stringify(open)}, pinched ${JSON.stringify(pinched)}, released ${JSON.stringify(letGo)}`);
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
  // 6a. Spike S3 with tracked hands: a pinch at the handle takes hold of a
  //     tiller and it follows the hand; letting go of the pinch lets go.
  evalInApp('(window.__lever.show(), true)');
  await sleep(500);
  const handHandle = evalInApp('window.__lever.handle("right")');
  handTo('right', handHandle, 0.5, rightOffset);
  await sleep(700);
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
  await sleep(300);
  handTo('right', [handHandle[0], handHandle[1], handHandle[2] - 0.12], 0.5, rightOffset);
  const pinchedTiller = await waitFor('the tiller to follow the tracked hand', () => { const t = tillers(); return t.right.angle > 10 && t; }, 5000).catch(() => tillers());
  iwsdk(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
  const unpinched = await waitFor('the tracked hand to let go', () => { const t = tillers(); return t.right.heldBy === null && t; }, 3000).catch(() => tillers());
  check('A pinching tracked hand works a tiller and lets go with the pinch',
    pinchedTiller.right.heldBy === 'right' && pinchedTiller.right.angle > 10 && unpinched.right.heldBy === null,
    `held by ${pinchedTiller.right.heldBy} at ${pinchedTiller.right.angle.toFixed(1)}°, then ${unpinched.right.heldBy ?? 'let go'}`);
  evalInApp('(window.__lever.hide(), true)');
  await sleep(300);
  iwsdk(['xr', 'set-input-mode'], { mode: 'controller' });
  await sleep(300);

  await loadingDrill();

  // 6c. Spike S2: riding the tank.
  await ridingTheTank();

  // 6d. The tank drive (F1.4).
  await drivingTheTank();

  // 6e. The driver's station (F1.5).
  await driverStation();
  // 6f. The turret (F1.8).
  await layingTheGun();

  // 6g. The test range (F1.7).
  await theTestRange();

  // 6h. The gunsight (F1.9).
  await layingWithTheSight();

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

