#!/usr/bin/env node
/**
 * Headless XR smoke test.
 *
 * Drives the IWSDK managed browser (an emulated Meta Quest 3, through IWER,
 * IWSDK's browser-based XR emulator) with the @iwsdk/cli surface:
 *
 *  0. enters an immersive session, picks a seat and then Play solo on the
 *     start screen with a controller ray, and works the game menu (Y) with
 *     the ray, its tabs included (later steps show a control's tab through
 *     the menu's hook before ray-clicking the control);
 *  0b. calibrates (F1.2): seated, the head held still puts the eyes on the
 *     seat's eye point and both hands held out record the reach; standing,
 *     the eyes land on the same point;
 *  1. checks this player's own hands are drawn and posed by the controller
 *     (flat, fist, point, thumbs-up);
 *  1b. sits in the driver's seat (the cabin, F1.1): the eyes over its eye
 *     point, a lean past the head box's edge fading the view, a recentre put back in
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
 *  6c. rides the tank (spike S2) from the game menu's Practice section: the
 *     driver's seat holds the head in the hull while the ground moves round
 *     it, the vignette darkens with the motion and turns off from the menu,
 *     the gunner's seat turns with the turret, and Stop brings the cabin back;
 *  6d. drives the tank (F1.4): Practice → Drive the tank, both sticks drive
 *     it and the ground moves round the hull, one stick turns it, letting go
 *     stops it, the automatic box changes up, the Clutch's gears grind
 *     without the clutch and shift with it, the accelerator pulls away and
 *     the sticks brake (F1.16), the boulder stops it, and Back to start parks it;
 *  6e'. John's headset notes (31 October 2026): the starter pressed by a
 *     fingertip, the battery toggle flicked, the accelerator only from a hand
 *     on a tiller, the gear indicator, the hand throttle cruising and Stick
 *     shift refusing a change down at speed (driverFeedback).
 *  6e. works the driver's station (F1.5): both tillers drive the tank and
 *     the gauges read it, letting go stops it, the gear lever by hand grinds
 *     without the clutch and then shifts, and the hand throttle raises the idle;
 *  6f. lays the gun (F1.8): Practice → Lay the gun, the power grip
 *     traverses the turret with the gunner turning with it, the crank turns
 *     it 2°, the elevation handwheel raises the gun and its trigger bar
 *     pulls, and Forward puts it back;
 *  6g. loads and fires (F1.10): Practice → Load and fire, the right
 *     controller loads a shell from the turret's rack (breech, ram, lever),
 *     the power grip's trigger fires it at the 100 m target, which it hits;
 *     the gun recoils and the casing lands in the bin; a dropped shell is a
 *     fumble;
 *  6h. looks over the test range (F1.7): the targets stand at 100, 250 and
 *     500 m with markers up the road, the fog is on and turns off from the
 *     menu, and Practice → Up the range parks the tank 200 m up the road
 *     facing the far target;
 *  6i. lays the gun with the gunsight (F1.9): from up the range, Practice →
 *     Gunsight → Go to it and Lay on 500 m turn the turret and gun so the
 *     far target sits on its 300 m mark, by the sums and as the sight camera
 *     is drawn; elevating the gun tilts the sight's view but leaves the
 *     eyepiece still; leaning in shows the target;
 *  6j. listens to the tank (F1.12): the earlier steps' shifts, loading and
 *     shot made their sounds, the engine note climbs with the revs and the
 *     tracks rumble as it drives, Practice → Tank sounds → Play each plays
 *     every short sound, and the menu's Tank sounds row turns them off;
 *  6k. runs the range (F1.11): Practice → Range run → Start parks the tank
 *     at the start with a countdown sign, the clocks in both seats run,
 *     Ready to fire on each target lays and loads the gun so the trigger
 *     hits it, a red flag goes up by each target hit, and the third hit
 *     stops the clock on the crew's time (marked assisted); Stop clears it;
 *  6l. turns both crew's periscopes (F1.6, F1.19): Sights → Periscopes →
 *     Driver's (then Gunner's) sits the player in that seat behind its
 *     window, above the eyes and facing down to them; sitting up and
 *     looking up into it renders the view (the gunner's
 *     with the gunsight under it shut); the crank on its right turns it,
 *     a quarter of the way round a turn, the view and the head on the roof
 *     with it while the window stays still; Ahead works from the menu
 *     (run in part 2);
 *  6m. comfort and stats (F1.14): the menu's Vignette row makes the
 *     vignette strong or turns it off, Bumps → Reduced makes the tank ride
 *     on reduced bumps, and during a range run a squeeze that misses the
 *     gear lever is a fumble against it, a grind is counted, I feel queasy
 *     marks the moment, and stopping the run writes its row to the stats
 *     CSV;
 *  7. checks the perf CSV has rows, then re-enters XR with the frame-rate
 *     API removed, as desktop Chrome and Edge over Link may have it, and
 *     checks the game measures the refresh rate instead; IWSDK's controller
 *     models never loaded and no console errors were logged.
 *
 * Add a numbered step for each feature you add (see the building skill in
 * .claude/skills/), with a screenshot where it helps a review.
 *
 * CI runs the steps in three parts at once, on three runners: part 1 is
 * steps 0 to 6c and 6r (the biathlon race), part 2 is 6d to 6f (the driver and the turret), 6l
 * (the periscopes) and 6x (the biathlon's driving challenge), part 3 is 6g to 6k and 6m to 6q. Each part ends with step 7. Put a new feature's steps in
 * partOne, partTwo or partThree, whichever is shortest on CI.
 *
 * Usage: npm run test:xr   (starts the dev runtime headless if needed)
 *        XR_PART=2 npm run test:xr   (only part 2, as one CI runner does)
 * Exit code 0 = all checks passed. Screenshots go to artifacts/.
 */


import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * An error from the emulated browser no longer answering (a command timing
 * out, an empty or garbled reply, the page gone), as opposed to a check
 * failing. If one stops the test before any check has failed, the script
 * exits with STALLED, and CI runs that part once more (.github/workflows/ci.yml).
 */
const STALLED = 75;
const BROWSER_GONE = /evaluation timed out|browser_command_timeout|browser_not_launched|browser_relaunched|outcome_unknown|automation is not available|managed application page|frame is unavailable|has been closed|Target closed/i;
function stalled(message) {
  return Object.assign(new Error(message), { stalled: true });
}

/** Sends a request to the worker and waits for its answer: { stdout } or { error }. */
function ask(request) {
  Atomics.store(header, 0, 0);
  worker.postMessage(request);
  if (Atomics.wait(header, 0, 0, 300000) === 'timed-out') throw stalled(`no answer to ${JSON.stringify(request)} in 300 s`);
  const text = new TextDecoder().decode(new Uint8Array(shared, 8, Atomics.load(header, 1)).slice());
  return JSON.parse(text);
}


const SQUEEZE = 1; // gamepad button index for proximity grab

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function iwsdk(args, input) {
  // A screenshot waits for the page to draw; on a runner at a frame or more
  // a second one through the gunsight has outlasted the browser's 27 s limit
  // and left the page stuck. On CI the frames hover around 600 ms, and three
  // runs in a row lost the browser to a screenshot let through at just under
  // that (31 October 2026). Screenshots are pictures, not checks: skip them
  // well before the page is that slow.
  if (args[1] === 'screenshot' && slowestFrameMs() > 400) {
    console.log(`      (no screenshot for ${args.at(-1)}: the page is drawing a frame every ${Math.round(slowestFrameMs())} ms)`);
    return null;
  }
  const argv = [CLI, ...args];
  if (input !== undefined) argv.push('--input-json', JSON.stringify(input));
  let stdout;
  let stderr = '';
  if (worker) {
    const reply = ask({ kind: 'cli', argv: argv.slice(1) });
    if (reply.error) {
      const message = `iwsdk ${args.join(' ')}: ${reply.error}`;
      throw BROWSER_GONE.test(reply.error) ? stalled(message) : new Error(message);
    }
    stdout = reply.stdout;
    stderr = reply.stderr ?? '';
  } else try {
    stdout = execFileSync(process.execPath, argv, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // A screenshot is a picture for people to look at, not a check: on a slow
    // runner one has failed with the page still working, so say so and go on.
    if (args[1] === 'screenshot') {
      console.log(`      (no screenshot for ${args.at(-1)}: ${`${stdout}${stderr}`.replace(/\s+/g, ' ').slice(0, 600)})`);
      return null;
    }
    throw stalled(`iwsdk ${args.join(' ')}: unparseable output\n${stdout}${stderr ? `\nstderr: ${stderr.slice(0, 2000)}` : ''}`);
  }
  if (!parsed.ok) {
    if (args[1] === 'screenshot') {
      console.log(`      (no screenshot for ${args.at(-1)}: ${JSON.stringify(parsed.error).slice(0, 600)})`);
      return null;
    }
    const message = `iwsdk ${args.join(' ')} failed: ${JSON.stringify(parsed.error)}`;
    throw BROWSER_GONE.test(message) ? stalled(message) : new Error(message);
  }
  return parsed.data;
}

/** Evaluate an expression in the app frame (needs --allow-browser-automation). */
function evalInApp(expression) {
  if (worker) {
    let reply = ask({ kind: 'eval', expression });
    // Straight after a screenshot that timed out, the page can still be busy
    // and an evaluation through the CLI comes back empty: try again.
    for (let retry = 0; retry < 6 && !reply.error && !reply.stdout; retry++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
      reply = ask({ kind: 'eval', expression });
    }
    if (reply.error) {
      const message = `evaluating ${expression.slice(0, 80)}: ${reply.error}`;
      throw BROWSER_GONE.test(reply.error) ? stalled(message) : new Error(message);
    }
    if (!reply.stdout) throw stalled(`evaluating ${expression.slice(0, 80)}: no answer`);
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
  // Timeouts are set for a page drawing a few frames a second; on a runner
  // drawing slower than that (software rendering, up to a second a frame),
  // allow proportionally longer.
  const deadline = Date.now() + timeoutMs * Math.min(4, Math.max(1, slowestFrameMs() / 300));
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
  const message = `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`;
  throw lastError?.stalled ? stalled(message) : new Error(message);
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

/** Set once XR has started, so the app's frame times can be read. */
let appRunning = false;
/** When the test started, for the console and frame-rate logs since then. */
let startedAt = Date.now();

/**
 * The test comes in three parts of about the same length, which CI runs on
 * three runners at once (XR_PART=1, 2 or 3); with no XR_PART all three run
 * one after another. Parts 2 and 3 start the game with Play solo
 * (playSolo) and every part ends with lastChecks. A new feature's steps go
 * in the part that is shortest on CI.
 */
const XR_PART = Number(process.env.XR_PART ?? 0);
if (![0, 1, 2, 3].includes(XR_PART)) throw new Error(`XR_PART is 1, 2 or 3, not ${process.env.XR_PART}`);
const inPart = (n) => XR_PART === 0 || XR_PART === n;

/** The slowest frame a ray click has had to wait for so far, to log when it grows. */
let slowestClickFrameMs = 400;

/** Point the right controller's ray at `target` from a little in front of the head, and pull the trigger. */
async function rayClick(target) {
  const from = [target[0] + 0.2, target[1] - 0.45, target[2] + 0.55];
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', position: toOrigin(from) });
  const o = toOrigin(target);
  iwsdk(['xr', 'look-at'], { device: 'controller-right', target: o });
  // Clicks closer together than the slow CLI calls used to space them (a
  // couple of seconds) were sometimes lost on CI runners, so aim, wait,
  // click and wait about as long as before. Software rendering can drop to a
  // frame or two a second with the menu open, and a press shorter than a
  // frame is never seen, so the trigger is held for two and a half of the
  // slowest recent frames (at least half a second; a frame can run longer
  // than the last second's slowest), the waits stretched to match. The ray
  // then needs a longer click window than IWSDK's 0.8 s: relaxRayClicks()
  // opens it to 5 s.
  const frameMs = slowestFrameMs();
  const holdMs = Math.min(4000, Math.max(500, 2.5 * frameMs));
  const settleMs = Math.max(1000, 3 * frameMs);
  if (frameMs > slowestClickFrameMs + 100) {
    slowestClickFrameMs = frameMs;
    console.log(`      (ray clicks: frames up to ${Math.round(frameMs)} ms, so the trigger is held ${Math.round(holdMs)} ms)`);
  }
  await sleep(settleMs);
  iwsdk(['xr', 'select'], { device: 'controller-right', duration: holdMs / 1000 });
  await sleep(holdMs + settleMs);
}

/**
 * Let a ray press count as a click for up to 5 s, on both controllers.
 * IWSDK's ray pointer takes a press as a click only when its release lands
 * within 0.8 s (by frame time). Software rendering on a CI runner can take
 * 0.7 s a frame, so a press seen on one frame and its release on the next
 * but one was dropped. A headset draws 72 frames a second, so this only
 * matters for the emulator. Call again after any reload.
 */
function relaxRayClicks() {
  evalInApp(`(() => {
    const pointers = window.__debug.world.input.xr.multiPointers;
    for (const side of ['left', 'right']) pointers[side].ray.pointer.options.clickThresholdMs = 5000;
    return true;
  })()`);
}

/** The slowest frame the page drew in its last full second, in ms (0 if not known yet). */
function slowestFrameMs() {
  // Not before the app is up: an evaluation during a reload can wait 20 s.
  if (!appRunning) return 0;
  try {
    const ms = Number(evalInApp('window.__perf?.recorder.latest.frameMax ?? 0'));
    // A frame over 2 s is a stall (a reload, a screenshot), not the pace to click at.
    return Number.isFinite(ms) ? Math.min(ms, 2000) : 0;
  } catch {
    return 0;
  }
}

/** The game menu's tab each of its elements is on: the page (page-<tab> in public/ui/menu.uikitml) it sits in. */
const MENU_TAB_OF = (() => {
  const source = readFileSync(new URL('../public/ui/menu.uikitml', import.meta.url), 'utf8');
  const pages = source.slice(0, source.indexOf('class="footer"'));
  const tabOf = new Map();
  let tab = null;
  for (const [, id] of pages.matchAll(/id="([a-z0-9-]+)"/g)) {
    if (id.startsWith('page-')) {
      tab = id.slice('page-'.length);
    } else if (tab !== null) {
      tabOf.set(id, tab);
    }
  }
  return tabOf;
})();

/**
 * Ray-click element `id` on the open game menu, showing its tab first if
 * another is showing (step 0 presses the tabs themselves with the ray).
 */
async function menuClick(id) {
  const tab = MENU_TAB_OF.get(id);
  if (tab !== undefined && evalInApp('window.__gameMenu.tab') !== tab) {
    evalInApp(`window.__gameMenu.showTab('${tab}')`);
    // The page lays out on the next frames, which can be slow with the menu open.
    await sleep(600);
  }
  await rayClick(elementPosition('menu-panel', id));
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
  // The menu opens on its You tab; the ray presses Sound and view, then You again.
  const tabNow = () => evalInApp('({ tab: window.__gameMenu.tab, lit: window.__gameMenu.selected("tab-" + window.__gameMenu.tab), you: window.__gameMenu.shown("page-you"), view: window.__gameMenu.shown("page-view") })');
  const firstTab = tabNow();
  await rayClick(elementPosition('menu-panel', 'tab-view'));
  const viewTab = tabNow();
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-game-menu-view.png'], {});
  const hud = () => evalInApp('({ on: window.__settings.hud, offLit: window.__gameMenu.selected("row-hud-1") })');
  await menuClick('row-hud-1');
  const off = hud();
  await menuClick('row-hud-0');
  const on = hud();
  await rayClick(elementPosition('menu-panel', 'tab-you'));
  const youTab = tabNow();
  const seatedNow = () => evalInApp('window.__body.state.choice.seated');
  const seatedFirst = seatedNow();
  await menuClick('row-seated-0');
  const standing = !seatedNow();
  await menuClick('row-seated-1');
  const seated = seatedNow();
  const raiseNow = () => evalInApp('({ raise: window.__body.state.choice.raise, shown: window.__gameMenu.text("height-value") })');
  await menuClick('height-up');
  const up1 = raiseNow();
  await menuClick('height-up');
  const up2 = raiseNow();
  await menuClick('height-own');
  const own = raiseNow();
  const swatches = () => evalInApp(`(() => { const a = window.__debug.world.getSceneObject('menu-panel'); const out = []; for (let i = 0; i < 8; i++) { const e = a.getElementById('coat-' + i); const size = e.size.peek(); out.push({ ring: String(e.properties.peek().borderColor) !== 'rgba(0, 0, 0, 0)', round: Math.abs(size[0] - size[1]) < 0.5 }); } return out; })()`);
  await menuClick('coat-2');
  await menuClick('coat-5');
  const coats = swatches();
  const ringed = coats.map((c, i) => (c.ring ? i : -1)).filter((i) => i >= 0);
  await menuButton();
  const closed = evalInApp('window.__gameMenu.open');
  check('The coat swatches are round, and only the colour picked last has a ring',
    coats.every((c) => c.round) && ringed.length === 1 && ringed[0] === 5,
    `ringed ${ringed.join(', ') || 'none'}, ${coats.filter((c) => !c.round).length} not round`);
  check('The game menu opens on its You tab, and the ray picks the Sound and view tab and back, one page showing at a time',
    firstTab.tab === 'you' && firstTab.lit && firstTab.you && !firstTab.view &&
      viewTab.tab === 'view' && viewTab.lit && viewTab.view && !viewTab.you &&
      youTab.tab === 'you' && youTab.you && !youTab.view,
    `${JSON.stringify(firstTab)}, then ${JSON.stringify(viewTab)}, then ${JSON.stringify(youTab)}`);
  check('Y opens the game menu in front of the player, its ray turns the perf HUD off and on, and it closes again',
    opened.open && opened.at[2] < -0.5 && opened.exit && !off.on && off.offLit && on.on && !on.offLit && !closed,
    `opened ${opened.open} at ${fmt(opened.at)}, HUD ${off.on ? 'on' : 'off'} then ${on.on ? 'on' : 'off'}, closed ${!closed}`);
  check('The game menu picks standing or seated play (seated by default), and steps the eye height 5 cm at a time, up to +5 cm under a Sherman\'s roof',
    seatedFirst && standing && seated && up1.raise === 0.05 && up1.shown === '+5 cm' && up2.raise === 0.05 && own.raise === 0 && own.shown === '0 cm',
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

/**
 * Parts 2 and 3 start the game the quick way (part 1 checks each of these):
 * Play solo on the start screen, then the eyes taken at the headset's height
 * and the reach skipped, as part 1 leaves them.
 */
async function playSolo() {
  await waitFor('the start screen in front of the player', () => {
    const s = evalInApp('({ visible: window.__startScreen.visible, at: window.__startScreen.position() })');
    return s.visible && s.at[2] < -0.5;
  }, 10000).catch(() => null);
  await rayClick(elementPosition('start-panel', 'start-solo'));
  const solo = await waitFor('solo play', () => {
    const s = evalInApp('({ mode: window.__startScreen.mode, visible: window.__startScreen.visible })');
    return s.mode === 'solo' && !s.visible && s;
  }, 10000).catch(() => evalInApp('({ mode: window.__startScreen.mode, visible: window.__startScreen.visible })'));
  check('Play solo starts the game', solo.mode === 'solo' && !solo.visible, JSON.stringify(solo));
  iwsdk(['xr', 'set-device-state'], {});
  await waitFor('the eyes taken', () => calState().step === 'reach', 15000).catch(() => null);
  evalInApp('(window.__calibration.skip(), true)');
  await waitFor('calibration finished', () => calState().step === 'off', 8000).catch(() => null);
  await sleep(300);
}

/** Where this player sits: their seat, head and its eye point (hull space), and the play space's height. */
const seated = () => evalInApp('({ mine: window.__seats.mine, head: window.__seats.head(), eye: window.__seats.eye(window.__seats.mine), rigY: window.__debug.world.player.position.y, offset: window.__body.state.offset, fixes: { ...window.__seats.fixes }, fade: window.__seats.fade })');
const flatGap = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * 1b. The cabin (F1.1): playing solo the player sits in the driver's seat,
 *     eyes over its eye point; a lean forward past the head box's edge fades the view
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

  // Lean 26 cm forward in the room, 6 cm past the head box's front edge (20 cm ahead of the eye point, where the eyes come
  // up to the hood, src/sim/cabin.ts) and 2 cm past black: the view fades to black and the seat stays put; leaning back clears it.
  const lean = 0.26;
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin([eye[0], eye[1], eye[2] - lean]) });
  const leant = await waitFor('the view to fade', () => {
    const s = seated();
    return s.fixes.walls > start.fixes.walls && s.fade > 0.99 ? s : null;
  }, 5000).catch(() => seated());
  check('Leaning past the head box fades the view to black, the seat staying where it was',
    leant.fixes.walls > start.fixes.walls && leant.fade > 0.99 && Math.abs(leant.head[2] - (eye[2] - lean)) < 0.01 && Math.abs(leant.rigY - start.rigY) < 1e-6,
    `head at ${fmt(leant.head)}, fade ${leant.fade.toFixed(2)}, box edge at z ${(eye[2] - 0.2).toFixed(3)}`);
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin([eye[0], eye[1], eye[2] - 0.05]) });
  const clear = await waitFor('the view to clear', () => {
    const s = seated();
    return s.fade === 0 ? s : null;
  }, 5000).catch(() => seated());
  check('Leaning back inside the box clears the view, the eyes back where they were',
    clear.fade === 0 && Math.abs(clear.head[2] - (eye[2] - 0.05)) < 0.01 && clear.fixes.reseat === start.fixes.reseat,
    `head at ${fmt(clear.head)}, fade ${clear.fade}`);

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
  await menuClick('row-seat-1');
  const gunner = await waitFor("the gunner's seat", () => {
    const s = seated();
    return s.mine === 'gunner' && flatGap(s.head, s.eye) < 0.01 ? s : null;
  }, 5000).catch(() => seated());
  const lit = evalInApp('window.__gameMenu.selected("row-seat-1")');
  await menuButtonPress();
  check("The game menu's Practice row sits the player in the gunner's seat, on the turret basket's floor",
    gunner.mine === 'gunner' && flatGap(gunner.head, gunner.eye) < 0.01 && Math.abs(gunner.head[1] - gunner.eye[1]) < 0.005 && Math.abs(gunner.rigY - gunner.offset - 0.71) < 0.01 && lit,
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

  // Pressed right up to the eyecup (3 cm, inside the headset's 5 cm near
  // plane): the lens moves back into the eyepiece, 7 cm from the eye, and
  // the picture stays (it used to vanish, clipped by the near plane).
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toRig(along(0.03)) });
  lookDown();
  const pressed = await waitFor('the lens to move back', () => {
    const l = evalInApp('window.__sight.lens()');
    return l.setback > 0.02 ? l : null;
  }, 5000).catch(() => evalInApp('window.__sight.lens()'));
  const pressedState = evalInApp('window.__sight.state()');
  // The cabin's head box may hold the head a little short of where the headset was put.
  const pressedHead = behindLens(seated().head);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-sight-close.png'], {});
  check('With the eye pressed to the eyecup the lens moves back past the near plane and the sight stays open',
    pressedState.open && pressed.setback > 0.02 && Math.abs(pressedHead + pressed.setback - 0.07) < 0.005,
    `open ${pressedState.open}, head ${(pressedHead * 100).toFixed(1)} cm behind the eyecup, lens ${(pressed.setback * 100).toFixed(1)} cm back`);

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

  // Drawn in software the page can lag a frame or two behind the button
  // press, so wait for the menu to open and for the size to change.
  await menuButtonPress();
  await waitFor('the game menu open', () => evalInApp('window.__gameMenu.open'), 5000).catch(() => null);
  await menuClick('menu-sight-size');
  const sizeNow = () => evalInApp("({ size: window.__sight.state().size, label: window.__gameMenu.text('menu-sight-size') })");
  const sized = await waitFor('the sight size to change', () => { const s = sizeNow(); return s.size !== 512 && s; }, 5000)
    .catch(() => sizeNow());
  await menuButtonPress();
  evalInApp('(window.__sight.setSize(512), true)');
  check("The game menu's Practice button changes the sight's texture size",
    sized.size === 1024 && sized.label === '1024 px', `size ${sized.size}, label ${sized.label}`);

  evalInApp("(window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
  await waitFor("the driver's seat again", () => seated().mine === 'driver', 5000).catch(() => null);
  await sleep(300);
}

/**
 * 6g. Loading and firing (F1.10): Practice → Load and fire puts the player
 *     in the gunner's seat. The right controller takes a shell from the
 *     ready rack on the turret wall, swings it across to the breech where it
 *     snaps onto the bore, pushes it home, and pulls the lever back to close
 *     the breech: the load counts and is timed. The gun is laid on the
 *     100 m target, the right hand takes the power grip and pulls its
 *     trigger: the gun fires and recoils, the breech opens, the casing
 *     lands in the bin, the rack refills, and the shell's flight hits the
 *     target. The trigger with nothing loaded fires nothing. A shell let go
 *     away from the breech is a fumble and goes back in the rack.
 */
async function loadingAndFiring() {
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  evalInApp('(window.__drive.reset(), true)');
  await menuButtonPress();
  await menuClick('menu-loading');
  const drill = () => evalInApp('window.__loading.state()');
  const seatedHere = await waitFor("the gunner's seat", () => evalInApp('window.__seats.mine') === 'gunner', 5000).catch(() => false);
  evalInApp('(window.__turret.forward(), window.__loading.reset(), true)');
  await sleep(500);
  const layout = evalInApp('window.__loading.layout()');
  const fresh = drill();
  check("Practice → Load and fire puts the player in the gunner's seat, every shell in the rack and the breech open",
    seatedHere && fresh.owner && fresh.shells.every((s) => s.place === 'rack') && fresh.lever === 0,
    `seat ${evalInApp('window.__seats.mine')}; shells ${fresh.shells.map((s) => s.place).join(', ')}, lever ${fresh.lever}`);

  // Grip poses are where the loading takes hold; put the right one at a point by moving the controller.
  iwsdk(['xr', 'set-transform'], { device: 'controller-right', orientation: { pitch: 0, yaw: 0, roll: 0 } });
  await sleep(200);
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
  const trigger = (on) => iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 0, value: on ? 1 : 0 }] });
  const rest = [layout.eye[0] + 0.15, layout.eye[1] - 0.45, layout.eye[2] - 0.15];

  const shell = fresh.shells[0];
  await gripTo([shell.centre[0], shell.centre[1], shell.centre[2] + 0.2], 0.5);
  squeeze(true);
  const took = await waitFor('a shell in the right hand', () => drill().holds.right === 0, 4000).catch(() => false);
  const held = drill();
  const nose0 = held.shells[0].nose;
  const grip0 = gripWorld();
  const noseAt = (n) => [grip0[0] + n[0] - nose0[0], grip0[1] + n[1] - nose0[1], grip0[2] + n[2] - nose0[2]];
  const m = layout.mouth;
  await gripTo(noseAt([m[0] + 0.25, m[1] + 0.05, m[2] + 0.05]), 0.5);
  await gripTo(noseAt([m[0], m[1], m[2] + 0.03]), 0.4);
  const captured = await waitFor('the shell on the bore', () => drill().breechShell === 0, 4000).catch(() => false);
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(m) });
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-loading-breech.png'], {});
  const here = gripWorld();
  await gripTo([here[0], here[1], here[2] - 0.66], 0.6);
  const rammed = await waitFor('the shell rammed home', () => { const d = drill(); return d.rammed && d.holds.right === -1 && d; }, 4000).catch(() => drill());
  squeeze(false);
  check('A shell taken from the rack on the turret wall and swung to the breech snaps onto the bore and pushes home',
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
  squeeze(false);
  await gripTo(rest, 0.3);
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([m[0] + 0.1, m[1] - 0.1, m[2]]) });
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-loading-closed.png'], {});
  const stats = evalInApp('({ ...window.__loading.stats })');
  check('Pulling the lever back closes the breech on the rammed shell; the load counts and waits for the trigger',
    onLever && loaded && closed.loaded && Math.abs(closed.lever - Math.PI / 2) < 1e-6 && stats.last > 0 && stats.fumbles === 0 && closed.board[2] === 'Loaded AP: fire!',
    `lever ${closed.lever.toFixed(2)} rad, loads ${stats.loads}, ${stats.last?.toFixed(1)} s, board "${closed.board.join(' | ')}"`);

  // Lay the gun on the 100 m target, take the power grip and pull its trigger.
  evalInApp('(window.__firing.aimAt(0), true)');
  await sleep(300);
  const names = evalInApp('window.__turret.names');
  const fist = evalInApp('window.__ownHands.fist("right")');
  const gripNow = gripWorld();
  const twistHandle = evalInApp(`window.__mechanisms.handle(${JSON.stringify(names.twist)}, 1)`);
  await gripTo([twistHandle[0] - (fist[0] - gripNow[0]), twistHandle[1] - (fist[1] - gripNow[1]), twistHandle[2] - (fist[2] - gripNow[2])], 0.5);
  squeeze(true);
  const onGrip = await waitFor('the power grip in the right hand', () => evalInApp(`window.__mechanisms.state(${JSON.stringify(names.twist)})`).heldBy === 'right', 4000).catch(() => false);
  trigger(true);
  const fired = await waitFor('the gun to fire', () => { const d = drill(); return !d.loaded && d.casings === 1 && d; }, 4000).catch(() => drill());
  trigger(false);
  const landed = await waitFor('the shot to land', () => { const r = evalInApp('window.__firing.records()'); return r.length === 1 && evalInApp('window.__firing.flying()') === 0 && r[0]; }, 4000).catch(() => null);
  const after = await waitFor('the gun back in battery and the casing in the bin', () => { const d = drill(); return d.recoil === 0 && d; }, 3000).catch(() => drill());
  // The CLI's calls are slower than the recoil (and the first look can be the frame it fired): read how far it went.
  const recoiled = after.kick;
  check('The power grip\'s trigger fires the loaded gun: it recoils, the breech opens and the rack refills',
    onGrip && !fired.loaded && fired.lever === 0 && fired.breechShell === -1 && recoiled > 0 && after.shells[0].place === 'rack',
    `held ${onGrip}, loaded ${fired.loaded}, lever ${fired.lever.toFixed(2)}, recoil ${(100 * recoiled).toFixed(0)} cm, shell ${after.shells[0].place}`);
  const bin = after.casingInBin;
  check('The casing flies out of the breech into the bin under it',
    bin !== null && bin[1] < layout.eye[1] - 1 && after.recoil === 0,
    `casing at ${bin ? fmt(bin) : 'none'}`);
  check('The shell flies to the 100 m target and hits it (the host decides)',
    landed !== null && landed.kind === 'target' && landed.target === 0 && evalInApp('window.__firing.hits()')[0] === 1,
    landed ? `${landed.line}, after ${landed.time.toFixed(2)} s` : 'no shot recorded');
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([layout.eye[0], layout.eye[1], layout.eye[2] - 5]) });
  trigger(true);
  await sleep(400);
  trigger(false);
  check('The trigger with nothing loaded fires nothing', evalInApp('window.__firing.records()').length === 1,
    `${evalInApp('window.__firing.records()').length} shots`);
  squeeze(false);
  await sleep(300);

  // A shell let go away from the breech: a fumble, and back to the rack.
  const second = drill().shells[1];
  await gripTo([second.centre[0], second.centre[1], second.centre[2] + 0.2], 0.5);
  squeeze(true);
  await waitFor('a second shell in the hand', () => drill().holds.right === 1, 4000).catch(() => false);
  await gripTo(rest, 0.4);
  squeeze(false);
  const dropped = await waitFor('the fumble', () => evalInApp('window.__loading.stats.dropped') === 1, 4000).catch(() => false);
  const back = await waitFor('the dropped shell back in the rack', () => drill().shells[1].place === 'rack', 6000).catch(() => false);
  check('A shell let go away from the breech counts as a fumble and goes back in the rack', dropped && back,
    `fumbles ${evalInApp('window.__loading.stats.fumbles')}, shell ${drill().shells[1].place}`);

  evalInApp("(window.__loading.reset(), window.__turret.forward(), window.__seats.ask('driver'), true)");
  await sleep(500);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
}

/** Press Y on the left controller: opens or closes the game menu. */
async function mechanismBench() {
  evalInApp('(window.__lever.hide(), true)');
  await menuButtonPress();
  await menuClick('menu-bench');
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
  const wasOpen = evalInApp('window.__gameMenu.open');
  // A press shorter than a frame is never seen: hold Y for two and a half of
  // the slowest recent frames (at least 0.3 s), then wait for the menu to
  // open or close.
  const holdMs = Math.max(300, 2.5 * slowestFrameMs());
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 1 }] });
  await sleep(holdMs);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 4, value: 0 }] });
  await waitFor('the game menu to open or close', () => evalInApp('window.__gameMenu.open') !== wasOpen, 3000).catch(() => null);
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
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  const state = () => evalInApp('window.__ride.state()');
  const thumbstick = (device, x, y) =>
    iwsdk(['xr', 'set-gamepad-state'], { device, axes: [{ index: 0, value: x }, { index: 1, value: y }] });
  // Seated off the room's middle, looking a little left.
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: 0.3, y: 1.2, z: 0.2 } });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: { x: -0.5, y: 1.2, z: -3 } });
  await sleep(300);
  await menuButtonPress();
  await menuClick('menu-ride-driver');
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
  await menuClick('row-ride-vignette-1');
  const unshaded = await waitFor('the vignette to go', () => { const s = state(); return !s.vignetteShown && s; }, 3000).catch(() => state());
  // Still moving fast enough that a vignette left on would show (40% at top speed).
  check('The menu shows the ride and turns the vignette off',
    status.startsWith('Riding as driver') && !unshaded.vignette && !unshaded.vignetteShown && unshaded.tank.speed > 5,
    `"${status}", vignette ${unshaded.vignette ? 'on' : 'off'} (alpha ${unshaded.vignetteAlpha.toFixed(2)}) at ${unshaded.tank.speed.toFixed(1)} m/s`);
  thumbstick('controller-left', 0, 0);

  // The gunner's seat goes round with the turret.
  await menuClick('menu-ride-gunner');
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
  await menuClick('menu-ride-stop');
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
  // The head was seated off the room's middle, so putting the headset back moves it a lean forwards and
  // left of the driver's eyes, where a window that opens (F1.6 put the driver's periscope there) would,
  // drawn in software, slow the page to a couple of frames a second. Seat it again where the headset now is.
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  evalInApp('(window.__seats.reseat(), true)');
  await sleep(300);
}

/** Mirrors src/sim/terrain.ts and src/sim/tank-drive.ts. */
const DRIVE = { tile: 800, front: -3.0, rock: [-10, -45, 1.5] };

/**
 * 6d. The tank drive (F1.4): Practice → Drive the tank puts the player in
 *     the driver's seat with a sign; both sticks forwards drive the tank and
 *     the ground moves round the still hull (the tank's spot stays under the
 *     hull floor), the vignette darkens and S1's range rides out of sight;
 *     one stick turns the tank the other way; letting go stops it; the
 *     automatic box changes up by itself (F1.16); with the menu's Gearbox
 *     on Clutch, A moves the lever into 1st and it grinds until the clutch
 *     (left trigger) goes in, A changes up, the accelerator (right trigger)
 *     pulls away as the clutch comes out, and both sticks back brake it to a
 *     stop; driven at the boulder, the tank stops against it without going
 *     in; Back to start parks it where it began.
 */
/** Where to put the right controller so the middle of its fist is at `p` (scene space), the hand holding nothing. */
function rightGripFor(p) {
  const fist = evalInApp('window.__ownHands.fist("right")');
  const grip = evalInApp('window.__debug.world.player.gripSpaces.right.getWorldPosition(window.__debug.world.player.position.clone()).toArray()');
  return toOrigin([p[0] - (fist[0] - grip[0]), p[1] - (fist[1] - grip[1]), p[2] - (fist[2] - grip[2])]);
}

/** Hold the instrument box's `id` button in with a squeeze of the right fist (F1.17); `until` is checked while it is held. */
async function holdEngineButton(id, until, label, timeoutMs = 6000) {
  const name = evalInApp(`window.__driverStation.engine().names.${id}`);
  const cap = evalInApp(`window.__mechanisms.handle(${JSON.stringify(name)}, 1)`);
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: rightGripFor(cap), duration: 0.3 });
  await sleep(500);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 1 }] });
  const seen = await waitFor(label, until, timeoutMs).catch(() => null);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 0 }] });
  await sleep(300);
  return seen;
}

/**
 * 6e'. John's headset notes on the driver's controls (31 October 2026):
 *     the starter pressed in by the index fingertip alone cranks and
 *     starts the engine; on the Full procedure the battery toggle is
 *     flicked up and down by a fingertip, and the choke's T-handle is drawn
 *     half out by a fist, isn't moved by a fingertip, and is pushed in by a
 *     fist; with Stick shift the tillers can't be pushed forwards; the right trigger works the
 *     accelerator only from the hand on a tiller (not a hand off it, nor
 *     with the menu open); the gear indicator shows the gear engaged; the
 *     hand throttle drives the tank with the accelerator let go; and with
 *     Stick shift a change down too low for the speed grinds, the box
 *     keeping its gear and the lever going back.
 */
async function driverFeedback() {
  const station = () => evalInApp('window.__driverStation.state()');
  const tank = () => evalInApp('window.__drive.state()');
  const controls = () => evalInApp('window.__drive.controls()');
  const box = () => evalInApp('window.__driverStation.engine()');
  const handle = (id, deg) => evalInApp(`window.__driverStation.handle(${JSON.stringify(id)}${deg === undefined ? '' : `, ${deg}`})`);
  const squeeze = (device, value) => iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value }] });
  const trigger = (device, value) => iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: 0, value }] });
  const handTo = (device, p, duration = 0.4) => iwsdk(['xr', 'animate-to'], { device, position: toOrigin(p), duration });
  const take = async (device, id) => {
    handTo(device, handle(id));
    await sleep(600);
    squeeze(device, 1);
    const hand = device.replace('controller-', '');
    await waitFor(`the ${hand} hand on the ${id}`, () => station().heldBy[id] === hand, 3000, 100).catch(() => {});
  };
  // Put the drawn index fingertip at a point: the controller moves without turning, so the tip keeps its offset from
  // the controller's own position (which isn't its grip space's). Measured where it stands, then corrected once.
  const settle = () => sleep(Math.max(300, 2.5 * slowestFrameMs()));
  const tipTo = async (device, target, duration = 0.3) => {
    const side = device.replace('controller-', '');
    const goal = toOrigin(target);
    for (let pass = 0; pass < 2; pass++) {
      const tip = evalInApp(`window.__mechanisms.tip(${JSON.stringify(side)})`);
      if (!tip) return false;
      const at = toOrigin(tip);
      const pos = iwsdk(['xr', 'get-transform'], { device }).result.position;
      const to = { x: goal.x - (at.x - pos.x), y: goal.y - (at.y - pos.y), z: goal.z - (at.z - pos.z) };
      iwsdk(['xr', 'animate-to'], { device, position: to, duration: pass === 0 ? duration : 0.1 });
      // A slow runner draws a frame every few hundred ms: let one or two land at the point.
      await sleep((pass === 0 ? duration : 0.1) * 1000);
      await settle();
      const now = toOrigin(evalInApp(`window.__mechanisms.tip(${JSON.stringify(side)})`) ?? tip);
      if (Math.hypot(now.x - goal.x, now.y - goal.y, now.z - goal.z) < 0.002) break;
    }
    return true;
  };
  const on = (cap, out, up = 0) => [0, 1, 2].map((i) => cap.at[i] + cap.out[i] * out + cap.up[i] * up);

  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  evalInApp('(window.__drive.set(null), window.__drive.parkingBrake(false), window.__drive.place(0, 0, 0), window.__drive.engine("stop"), true)');
  await waitFor('the driver\'s seat', () => station().usable, 5000).catch(() => null);

  // The starter by the index fingertip alone: in front of its cap, then in.
  const starter = evalInApp('window.__driverStation.cap("starter")');
  const pointed = await tipTo('controller-right', on(starter, 0.03));
  await tipTo('controller-right', on(starter, -0.006));
  const caught = await waitFor('the engine to catch on the fingertip', () => { const t = tank(); return t.running && t; }, 6000).catch(() => tank());
  const pressed = box();
  check('The starter pressed in by the right index fingertip, without a squeeze, cranks the engine and it catches',
    pointed && caught.running && pressed.presses.starter >= 1 && evalInApp('window.__mechanisms.holding().right') === null,
    `fingertip ${pointed ? 'pointing' : 'not pointing'}, ${pressed.presses.starter} press(es), engine ${caught.running ? 'running' : 'stopped'}`);
  await tipTo('controller-right', on(starter, 0.06));

  // The battery toggle, flicked up and down by a fingertip (Engine start: Full procedure).
  evalInApp('(window.__gameMenu.click("row-engine-2"), window.__drive.engine("stop"), true)');
  await sleep(300);
  const battery = evalInApp('window.__driverStation.cap("battery")');
  const was = box();
  await tipTo('controller-right', on(battery, 0.012, -0.014));
  await tipTo('controller-right', on(battery, 0.012, 0.016));
  const up = await waitFor('the battery on', () => { const b = box(); return b.on.battery && b; }, 3000).catch(() => box());
  await tipTo('controller-right', on(battery, 0.04, 0.016));
  await tipTo('controller-right', on(battery, 0.012, 0.016));
  await tipTo('controller-right', on(battery, 0.012, -0.016));
  const down = await waitFor('the battery off', () => { const b = box(); return !b.on.battery && b; }, 3000).catch(() => box());
  check('On the Full procedure the battery toggle flicked up by a fingertip goes on (the lamps light), flicked down goes off',
    !was.on.battery && up.on.battery && up.lamps.oil && !down.on.battery && down.presses.battery === was.presses.battery + 2,
    `on ${up.on.battery} (lamps ${up.lamps.oil}), then on ${down.on.battery}, ${down.presses.battery - was.presses.battery} flick(s)`);
  await tipTo('controller-right', on(battery, 0.06));

  // The choke's T-handle (John, 31 October 2026; on its own plate, gripped both ways, 1 November): a fist draws it half
  // out and it stays; a fingertip doesn't move it; a fist pushes it back in.
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  const knobName = evalInApp('window.__driverStation.engine().names.choke');
  const knob = evalInApp('window.__driverStation.cap("choke")');
  const travel = 0.05;
  const depth = 0.016;
  // Grip the handle, then move the controller `by` metres out of the plate, and let go.
  const drawChoke = async (by) => {
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: rightGripFor(evalInApp(`window.__mechanisms.handle(${JSON.stringify(knobName)}, 1)`)), duration: 0.3 });
    await sleep(600);
    squeeze('controller-right', 1);
    const held = await waitFor('the right hand on the choke', () => evalInApp('window.__mechanisms.holding().right') === knobName, 3000, 100).catch(() => false);
    const from = iwsdk(['xr', 'get-transform'], { device: 'controller-right' }).result.position;
    const a0 = toOrigin(knob.at);
    const a1 = toOrigin(on(knob, by));
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: { x: from.x + a1.x - a0.x, y: from.y + a1.y - a0.y, z: from.z + a1.z - a0.z }, duration: 0.4 });
    await sleep(700);
    await settle();
    squeeze('controller-right', 0);
    await settle();
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin(on(knob, 0.2)), duration: 0.3 });
    await sleep(500);
    return held;
  };
  const tookChoke = await drawChoke(travel / 2);
  const pulled = { box: box(), c: controls() };
  const share = pulled.box.choke;
  const face = (z) => on(knob, share * travel + depth + z);
  await tipTo('controller-right', face(0.01));
  await tipTo('controller-right', face(-0.02));
  const tipped = box();
  await tipTo('controller-right', face(0.06));
  await drawChoke(-share * travel - 0.01);
  const pushed = { box: box(), c: controls() };
  check('The choke\'s T-handle drawn out by a fist stays half out; a fingertip doesn\'t move it; a fist pushes it back in',
    tookChoke && share > 0.35 && share < 0.65 && Math.abs(pulled.c.choke - share) < 0.01 && Math.abs(tipped.choke - share) < 0.01 &&
      pushed.box.choke < 0.05 && pushed.c.choke < 0.05,
    `out ${(share * 100).toFixed(0)}% (choke ${pulled.c.choke.toFixed(2)}), after a fingertip ${(tipped.choke * 100).toFixed(0)}%, pushed in to ${(pushed.box.choke * 100).toFixed(0)}%`);
  evalInApp('(window.__gameMenu.click("row-engine-1"), window.__drive.engine("start"), true)');
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);

  // Stick shift in 2nd: the right trigger accelerates from the hand on the right tiller only.
  evalInApp('(window.__gameMenu.click("row-gearbox-1"), true)');
  await sleep(300);
  evalInApp('(window.__drive.set({ gear: 2 }), window.__drive.set(null), true)');
  await take('controller-left', 'tillerLeft');
  await take('controller-right', 'tillerRight');
  // With a Sherman's controls the tillers only brake: pushed forwards they stay against their stop (1 November 2026).
  handTo('controller-left', handle('tillerLeft', 20));
  handTo('controller-right', handle('tillerRight', 20));
  await sleep(700);
  await settle();
  const pushedTillers = station();
  check('With Stick shift the tillers rest against a forward stop: pushed forwards they stay upright and ask nothing',
    pushedTillers.heldBy.tillerLeft === 'left' && pushedTillers.heldBy.tillerRight === 'right' &&
      pushedTillers.angles.tillerLeft < 0.5 && pushedTillers.angles.tillerRight < 0.5 && pushedTillers.left === 0 && pushedTillers.right === 0,
    `held by ${pushedTillers.heldBy.tillerLeft} and ${pushedTillers.heldBy.tillerRight}, at ${pushedTillers.angles.tillerLeft.toFixed(1)}° and ${pushedTillers.angles.tillerRight.toFixed(1)}°, asking ${pushedTillers.left} and ${pushedTillers.right}`);
  handTo('controller-left', handle('tillerLeft', 0));
  handTo('controller-right', handle('tillerRight', 0));
  await sleep(500);
  trigger('controller-right', 1);
  const onTiller = await waitFor('the accelerator from the hand on the tiller', () => { const c = controls(); return c.accel > 0.9 && c; }, 3000).catch(() => controls());
  trigger('controller-right', 0);
  squeeze('controller-right', 0);
  await waitFor('the right hand off its tiller', () => station().heldBy.tillerRight === null, 3000, 100).catch(() => null);
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin(on(starter, 0.25)), duration: 0.3 });
  await sleep(500);
  trigger('controller-right', 1);
  await sleep(500);
  const offTiller = controls();
  trigger('controller-right', 0);
  squeeze('controller-left', 0);
  // Its ray down at the floor, so the trigger pulled with the menu open clicks none of the menu's buttons
  // (Practice → Range run → Start once lay in its path: it closed the menu, so later steps' menu presses opened it when they meant to close it).
  const below = on(starter, 0.25);
  iwsdk(['xr', 'look-at'], { device: 'controller-right', target: toOrigin([below[0], below[1] - 1, below[2]]) });
  await menuButtonPress();
  trigger('controller-right', 1);
  await sleep(500);
  const menuOpen = controls();
  trigger('controller-right', 0);
  await menuButtonPress();
  check('The right trigger works the accelerator from the hand on a tiller, not from a hand off it or with the menu open',
    onTiller.accel > 0.9 && offTiller.accel === 0 && menuOpen.accel === 0,
    `on the tiller ${onTiller.accel.toFixed(2)}, off it (the other on its tiller) ${offTiller.accel.toFixed(2)}, menu open ${menuOpen.accel.toFixed(2)}`);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);

  // The gear indicator, and the hand throttle driving with the accelerator let go.
  const shows = station();
  check('The gear indicator shows the gear engaged', shows.readout === String(tank().gear) && shows.readout === '2',
    `indicator "${shows.readout}" in gear ${tank().gear}`);
  evalInApp('(window.__drive.place(0, 0, 0), true)');
  await take('controller-left', 'throttle');
  handTo('controller-left', handle('throttle', 20));
  await sleep(600);
  squeeze('controller-left', 0);
  const cruising = await waitFor('the tank to cruise on the hand throttle', () => { const t = tank(); return t.speed > 1.2 && t.rpm > 1500 && t; }, 15000).catch(() => tank());
  check('The hand throttle half open drives the tank in 2nd with the accelerator let go',
    cruising.speed > 1.2 && controls().accel === 0 && cruising.rpm > 1500,
    `${cruising.speed.toFixed(1)} m/s at ${cruising.rpm.toFixed(0)} rpm, accelerator ${controls().accel}`);

  // Stick shift: from 3rd at speed, 2nd is refused with a grind, the box stays in 3rd and the lever goes back.
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  evalInApp('(window.__drive.set({ gear: 3, accel: 1 }), true)');
  await waitFor('3rd at speed', () => { const t = tank(); return t.gear === 3 && t.speed > 3.2 && t; }, 15000).catch(() => null);
  const ground = station().grinds;
  evalInApp('(window.__drive.set({ gear: 2, accel: 1 }), window.__drive.set(null), true)');
  const refused = await waitFor('the change down refused', () => { const s = station(); const t = tank(); return s.grinds > ground && { s, t }; }, 3000).catch(() => ({ s: station(), t: tank() }));
  await sleep(500);
  const after = { s: station(), t: tank() };
  check('With Stick shift a change down too low for the speed grinds: the box stays in 3rd, the indicator says 3 and the lever goes back',
    refused.s.grinds > ground && after.t.gear === 3 && after.s.gear === 3 && after.s.readout === '3',
    `${after.s.grinds - ground} grind(s), box in ${after.t.gear}, lever in ${after.s.gear}, indicator "${after.s.readout}"`);
  await take('controller-left', 'throttle');
  handTo('controller-left', handle('throttle', 0));
  await sleep(600);
  squeeze('controller-left', 0);
  evalInApp('(window.__gameMenu.click("row-gearbox-0"), window.__drive.set(null), window.__drive.place(0, 0, 0), true)');
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
}

/**
 * 6d'. Starting the engine (F1.17): the tank begins with its engine
 *     stopped, the oil and generator lamps lit and the voltmeter on the
 *     battery's 24 V; held in, the starter cranks it (the voltmeter
 *     dipping) and it catches, the lamps going out and the voltmeter
 *     reading 28 V; the gunner's power traverse has nothing while it is off.
 */
async function startingTheEngine() {
  const engine = () => ({
    ...evalInApp('(({ running, cranking, rpm, power, stalls }) => ({ running, cranking, rpm, power, stalls }))(window.__drive.state())'),
    box: evalInApp('window.__driverStation.engine()'),
    volts: evalInApp('window.__driverStation.gauges().volts'),
    zones: evalInApp('window.__driverStation.zones().at'),
  });
  const off = engine();
  check('The tank starts with its engine stopped: the oil and generator lamps lit, the voltmeter at 24 V',
    !off.running && off.rpm < 50 && off.box.lamps.oil && off.box.lamps.generator && Math.abs(off.volts - 24) < 0.5,
    `running ${off.running}, ${off.rpm.toFixed(0)} rpm, lamps ${JSON.stringify(off.box.lamps)}, ${off.volts} V`);
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(evalInApp('window.__mechanisms.handle(window.__driverStation.engine().names.starter, 1)')) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-engine-off.png'], {});
  let cranked = null;
  const caught = await holdEngineButton('starter', () => {
    const e = engine();
    if (e.cranking && cranked === null) cranked = e;
    return e.running && e;
  }, 'the engine to catch');
  check('Held in by a squeeze, the starter cranks the engine (the voltmeter dipping) and it catches',
    cranked !== null && cranked.volts < 24 && caught !== null && caught.running,
    `cranking at ${cranked?.rpm.toFixed(0)} rpm and ${cranked?.volts} V, then ${caught ? `running at ${caught.rpm.toFixed(0)} rpm` : 'never caught'}`);
  const running = await waitFor('the lamps out and the voltmeter up', () => {
    const e = engine();
    return !e.box.lamps.oil && !e.box.lamps.generator && e.volts > 27 && e;
  }, 4000).catch(() => engine());
  check('Running, the lamps go out and the voltmeter reads the generator\'s 28 V',
    running.running && !running.box.lamps.oil && running.volts > 27, `lamps ${JSON.stringify(running.box.lamps)}, ${running.volts.toFixed(1)} V`);
  // The gauges' coloured bands (docs/gauge-zones.md): stopped, the oil in the red and the voltmeter on the battery's amber;
  // running (once the revs have risen to idle), both green.
  const banded = await waitFor('the oil and volts bands green', () => {
    const e = engine();
    return e.zones.oil === 'normal' && e.zones.volts === 'normal' && e;
  }, 3000).catch(() => engine());
  check('The bands say what the readings mean: oil red and volts amber stopped, both green running',
    off.zones.oil === 'danger' && off.zones.volts === 'caution' && banded.zones.oil === 'normal' && banded.zones.volts === 'normal',
    `stopped oil ${off.zones.oil}, volts ${off.zones.volts}; running (${banded.rpm.toFixed(0)} rpm) oil ${banded.zones.oil}, volts ${banded.zones.volts}`);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
}

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
  await menuClick('menu-drive-go');
  const seated = await waitFor('the driver\'s seat and the sign', () => {
    const s = evalInApp('({ seat: window.__seats.mine, sign: window.__drive.sign, driver: window.__drive.driver() })');
    return s.seat === 'driver' && s.sign.startsWith('Start the engine') && s;
  }, 5000).catch(() => evalInApp('({ seat: window.__seats.mine, sign: window.__drive.sign, driver: window.__drive.driver() })'));
  check('Practice → Drive the tank puts the player in the driver\'s seat with a sign saying how to start the engine (F1.17)',
    seated.seat === 'driver' && seated.driver === 'me' && seated.sign.startsWith('Start the engine'), `seat ${seated.seat}, sign "${seated.sign}"`);
  evalInApp('(window.__drive.reset(), true)');
  await startingTheEngine();

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

  // The automatic box (F1.16, the default) changes up by itself as the tank speeds up. From the start, facing up the road:
  // on a slow runner the turn above can go on long enough to leave the tank facing something that holds it still.
  evalInApp('(window.__drive.place(0, 0, 0), true)');
  await sleep(300);
  sticks(1, 1);
  const upshifted = await waitFor('the automatic box to change up', () => { const s = state(); return s.gear >= 3 && s; }, 15000).catch(() => state());
  check('With the automatic box the tank changes up by itself as it speeds up', upshifted.gear >= 3 && !upshifted.grinding,
    `${upshifted.speed.toFixed(1)} m/s in gear ${upshifted.gear} at ${upshifted.rpm.toFixed(0)} rpm at ${upshifted.x.toFixed(1)}, ${upshifted.z.toFixed(1)} heading ${((upshifted.heading * 180) / Math.PI).toFixed(0)}°, sign "${evalInApp('window.__drive.sign')}", controls ${JSON.stringify(evalInApp('window.__drive.controls()'))}`);
  sticks(0, 0);
  await waitFor('the tank to stop again', () => Math.abs(state().speed) < 0.01, 15000).catch(() => null);

  // The Clutch (menu → Tank → Gearbox): A changes up; without the clutch (the left trigger) the gears grind; with it the
  // gear goes in; the right trigger is the accelerator; the sticks pulled back brake.
  // Each change held for two and a half of the slowest recent frames (at least 0.3 s): a shorter press is never seen.
  const button = async (device, index, value) => {
    iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index, value }] });
    await sleep(Math.max(300, 2.5 * slowestFrameMs()));
  };
  // The CLI counts the gamepad's buttons without the empty slot: 3 is A (4 is B, as bButton presses).
  const pressA = async () => {
    await button('controller-right', 3, 1);
    await button('controller-right', 3, 0);
  };
  // Back at the start first: on a slow runner the drive so far can end up near the wall 70 m up, which would hold
  // the tank still when it pulls away.
  evalInApp('(window.__drive.place(0, 0, 0), true)');
  await menuButtonPress();
  await menuClick('row-gearbox-2');
  await menuButtonPress();
  await pressA();
  const grinding = await waitFor('the gears to grind', () => {
    const s = { ...state(), sign: evalInApp('window.__drive.sign'), lever: evalInApp('window.__driverStation.state().gear') };
    return s.grinding && s;
  }, 5000).catch(() => ({ ...state(), sign: evalInApp('window.__drive.sign'), lever: evalInApp('window.__driverStation.state().gear') }));
  check('With the Clutch, A moves the gear lever into 1st, and without the clutch it grinds: out of gear, with a sign',
    grinding.grinding && grinding.gear === 0 && grinding.lever === 1 && grinding.sign.startsWith('Gears grinding'),
    `lever in ${grinding.lever}, gear ${grinding.gear}, sign "${grinding.sign}"`);
  await button('controller-left', 0, 1);
  await waitFor('1st to go in', () => state().gear === 1, 5000).catch(() => null);
  await pressA();
  const second = await waitFor('2nd to go in', () => { const s = state(); return s.gear === 2 && s; }, 5000).catch(() => state());
  check('Holding the clutch, the gear goes in and A changes up', second.gear === 2 && !second.grinding, `gear ${second.gear}`);
  await button('controller-right', 0, 1);
  await button('controller-left', 0, 0);
  const pulling = await waitFor('the accelerator to pull away', () => { const s = state(); return s.speed > 1 && s; }, 8000).catch(() => state());
  check('Letting out the clutch with the right trigger (the accelerator) down pulls away in 2nd', pulling.speed > 1 && pulling.gear === 2,
    `${pulling.speed.toFixed(2)} m/s in gear ${pulling.gear} at ${pulling.rpm.toFixed(0)} rpm${pulling.bogging ? ', bogging' : ''}, controls ${JSON.stringify(evalInApp('window.__drive.controls()'))}`);
  await button('controller-right', 0, 0);
  sticks(-1, -1);
  const braked = await waitFor('the brakes to stop the tank', () => { const s = state(); return Math.abs(s.speed) < 0.01 && s; }, 8000).catch(() => state());
  check('Both sticks pulled back brake it to a stop', Math.abs(braked.speed) < 0.01, `${braked.speed.toFixed(2)} m/s`);
  sticks(0, 0);
  // Stopped in 2nd with the clutch out, the engine labours and stalls (F1.17); with the clutch held the starter restarts it.
  const stalled = await waitFor('the engine to stall', () => {
    const s = { ...state(), sign: evalInApp('window.__drive.sign') };
    return !s.running && s;
  }, 8000).catch(() => ({ ...state(), sign: evalInApp('window.__drive.sign') }));
  check('Stopped in gear with the clutch out, the engine stalls, with a sign saying why',
    !stalled.running && stalled.stallCause === 'bog' && stalled.sign.startsWith('Engine stalled'),
    `running ${stalled.running}, cause ${stalled.stallCause}, ${stalled.stalls} stall(s), sign "${stalled.sign}"`);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 0, value: 1 }] });
  const restarted = await holdEngineButton('starter', () => { const s = state(); return s.running && s; }, 'the engine to restart');
  check('With the clutch held, the starter restarts it in gear', restarted !== null && restarted.gear === 2, `${restarted ? `running in gear ${restarted.gear}` : 'not running'}`);
  await menuButtonPress();
  // The menu's Driving line ticks on only while the menu is open.
  await sleep(700);
  const status = evalInApp('window.__gameMenu.text("menu-drive-status")');
  check('The menu\'s Driving line says the gear', status.includes('2nd gear'), `"${status}"`);
  await menuClick('row-gearbox-0');
  await menuButtonPress();
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-left', buttons: [{ index: 0, value: 0 }] });

  // Into the boulder: the tank stops against it, never in it.
  const [rx, rz, rr] = DRIVE.rock;
  const stopAt = rz + rr - DRIVE.front;
  evalInApp(`(window.__drive.place(${rx}, ${stopAt + 6}, 0), true)`);
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
  await menuClick('menu-drive-reset');
  await menuButtonPress();
  const atStart = () => ({ ...state(), ranges: evalInApp('window.__range.targets().map((t, i) => window.__range.drawnRange(i))') });
  const home = await waitFor('the tank back at its start', () => {
    const s = atStart();
    return Math.hypot(s.x, s.z) < 0.01 && Math.abs(s.ranges[0] - 100) < 3 && s;
  }, 5000).catch(() => atStart());
  check('Back to start parks the tank where it began, with the three targets back at 100, 250 and 500 m, its engine stopped and cold (F1.17)',
    Math.hypot(home.x, home.z) < 0.01 && home.speed === 0 && [100, 250, 500].every((r, i) => Math.abs(home.ranges[i] - r) < 3) && !home.running && home.coolant < 20,
    `at ${home.x.toFixed(2)}, ${home.z.toFixed(2)}, targets drawn at ${home.ranges.map((r) => r.toFixed(1)).join(', ')} m, engine ${home.running ? 'running' : 'off'} at ${home.coolant.toFixed(0)} °C`);
  // The rest of the test drives: start it again as a Practice shortcut does.
  evalInApp("(window.__drive.engine('start'), true)");
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6h. The test range (F1.7): the three targets stand out at 100, 250 and
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
  check('The fog is on, thick enough to hide the ground\'s drawn edge and thin enough to leave the 500 m target clear',
    laid.fog.on && laid.fog.at500 < 0.25 && laid.fog.far < 800 && laid.fog.limit > 650 && laid.fog.limit < 750,
    `fog ${laid.fog.near}–${laid.fog.far} m, ${(laid.fog.at500 * 100).toFixed(0)}% of the 500 m target, seen to about ${Math.round(laid.fog.limit)} m`);

  // Look down the range from the gunner's seat and photograph it.
  evalInApp("(window.__seats.ask('gunner'), true)");
  await sleep(600);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-range.png'], {});

  // The fog is a live setting: off and on again from the menu.
  await menuButtonPress();
  await menuClick('row-fog-1');
  const fogOff = await waitFor('the fog off', () => { const f = evalInApp('window.__range.fog()'); return !f.on && f; }, 5000)
    .catch(() => evalInApp('window.__range.fog()'));
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-range-clear.png'], {});
  check("The menu's Range fog setting clears the air at once", fogOff.on === false, `fog ${fogOff.on ? 'on' : 'off'}`);
  await menuClick('row-fog-0');
  await waitFor('the fog back on', () => evalInApp('window.__range.fog().on'), 5000).catch(() => null);

  // The cabin's look (docs/interior.md): the hatches start shut; open both from the menu, then shut them again.
  const interior = () => evalInApp('window.__interior.state()');
  const shutFirst = interior();
  await menuClick('row-hatches-0');
  const opened = await waitFor('the hatches open', () => { const s = interior(); return s.lids.driver && s.lids.gunner && s; }, 5000).catch(() => interior());
  await menuClick('row-hatches-3');
  const shut = await waitFor('the hatches shut', () => { const s = interior(); return !s.lids.driver && !s.lids.gunner && s; }, 5000).catch(() => interior());
  check("The hatches start shut, and the menu's Open hatches opens both lids to let the daylight in, and shuts them again",
    !shutFirst.lids.driver && !shutFirst.lids.gunner && opened.lids.driver && opened.lids.gunner && opened.look.driverHatch && opened.look.gunnerHatch &&
      !shut.lids.driver && !shut.lids.gunner && !shut.look.driverHatch && !shut.look.gunnerHatch,
    `first ${JSON.stringify(shutFirst.lids)}, opened ${JSON.stringify(opened.lids)}, shut ${JSON.stringify(shut.lids)}`);

  // Practice → Up the range: parked 200 m up the road facing the far target.
  await menuClick('menu-range-up');
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
 * 6m. Comfort and stats (F1.14): in the driver's seat, Comfort and stats →
 *     Vignette → Strong darkens the view more than Normal can while the
 *     tank pulls away, and Off leaves it clear; Bumps → Reduced makes the
 *     tank ride on reduced bumps. A range run then counts what the player
 *     does while its clock runs, on the Clutch gearbox (F1.16) so the gear
 *     lever can be taken hold of: a squeeze 14 cm wide of the gear lever
 *     takes hold of nothing and is a fumble against it, shifting without
 *     the clutch grinds, I feel queasy writes a mark with the run's
 *     time; Stop writes the run's row, and the menu and the CSV show it.
 */
async function comfortAndStats() {
  const station = () => evalInApp('window.__driverStation.state()');
  const tally = () => evalInApp('window.__stats.tally()');
  const GEAR = 1; // FUMBLE_GROUPS' 'gear', src/sim/play-stats.ts
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp("(window.__seats.ask('driver'), window.__drive.set(null), window.__drive.reset(), window.__stats.clear(), true)");
  await waitFor('the driver\'s seat', () => station().usable, 5000).catch(() => false);
  await sleep(300);

  // The vignette's strength.
  await menuButtonPress();
  await menuClick('row-vignette-3');
  const strong = evalInApp("window.__gameMenu.selected('row-vignette-3')");
  evalInApp('(window.__drive.set({ left: 1, right: 1 }), true)');
  const dark = await waitFor('the strong vignette', () => { const a = evalInApp('window.__drive.vignetteAlpha'); return a > 0.55 && a; }, 6000).catch(() => evalInApp('window.__drive.vignetteAlpha'));
  check('Comfort → Vignette → Strong darkens the view further than Normal can while the tank pulls away',
    strong && dark > 0.55, `selected ${strong}, alpha ${dark.toFixed(2)} (normal tops out at 0.5)`);
  await menuClick('row-vignette-0');
  const clear = await waitFor('the vignette to go', () => { const a = evalInApp('window.__drive.vignetteAlpha'); return a < 0.01 && { a, speed: evalInApp('window.__drive.state().speed') }; }, 4000)
    .catch(() => ({ a: evalInApp('window.__drive.vignetteAlpha'), speed: evalInApp('window.__drive.state().speed') }));
  check('Vignette → Off leaves the view clear while the tank still drives', clear.a < 0.01 && clear.speed > 1,
    `alpha ${clear.a.toFixed(3)} at ${clear.speed.toFixed(1)} m/s`);
  await menuClick('row-vignette-2');
  // Reduced bumps.
  await menuClick('row-bumps-1');
  const bumps = await waitFor('reduced bumps', () => evalInApp('window.__drive.bumps') === 'reduced', 3000).catch(() => false);
  check('Comfort → Bumps → Reduced makes the tank ride on reduced bumps', bumps && evalInApp("window.__gameMenu.selected('row-bumps-1')"),
    `the tank rides on ${evalInApp('window.__drive.bumps')} bumps`);
  await menuButtonPress();
  evalInApp('(window.__drive.set(null), true)');

  // A range run, in the driver's seat.
  evalInApp('(window.__rangeRun.start(), true)');
  await waitFor('the run\'s clock to run', () => evalInApp('window.__stats.counting'), 8000).catch(() => false);
  // With the automatic box the lever can't be taken hold of (F1.16): drive on the Clutch.
  evalInApp("(window.__drive.set({ mode: 'clutch' }), true)");
  await sleep(300);
  // A squeeze 14 cm wide of the gear lever's handle: out of reach, so nothing is taken hold of.
  const handle = evalInApp("window.__driverStation.handle('gear')");
  iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin([handle[0] + 0.14, handle[1], handle[2]]), duration: 0.3 });
  await sleep(600);
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 1 }] });
  const missed = await waitFor('the miss counted', () => { const t = tally(); return t.fumbles[GEAR] > 0 && t; }, 3000, 100).catch(() => tally());
  const holding = evalInApp('window.__mechanisms.holding().right');
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value: 0 }] });
  check('During a run, a squeeze that misses the gear lever is a fumble against it',
    missed.fumbles[GEAR] === 1 && holding === null, `fumbles ${JSON.stringify(missed.fumbles)}, right hand holding ${holding}`);
  // Shifting without the clutch grinds.
  evalInApp("(window.__drive.set({ mode: 'clutch', clutch: 0, gear: 2 }), true)");
  const ground = await waitFor('a grind counted', () => { const t = tally(); return t.grinds > 0 && t; }, 4000).catch(() => tally());
  evalInApp("(window.__drive.set({ mode: 'clutch', clutch: 1, gear: 0 }), true)");
  check('A grind during the run is counted', ground.grinds >= 1, `${ground.grinds} grinds`);
  evalInApp('(window.__drive.set(null), true)');
  // I feel queasy, from the menu.
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  await menuButtonPress();
  await menuClick('menu-queasy');
  const marks = evalInApp("window.__stats.rows().filter((r) => r.kind === 'queasy')");
  const run = evalInApp('window.__rangeRun.state()');
  check('I feel queasy marks the moment in the stats with the run and its clock',
    marks.length === 1 && marks[0].run === run.id && marks[0].time > 0 && marks[0].seat === 'driver',
    JSON.stringify(marks.map((m) => ({ run: m.run, time: m.time, seat: m.seat }))));
  await menuClick('menu-run-stop');
  const row = await waitFor('the run\'s row', () => evalInApp("window.__stats.rows().find((r) => r.kind === 'run') ?? null"), 4000).catch(() => null);
  const line = await waitFor('the menu line', () => { const t = evalInApp("window.__gameMenu.text('menu-stats-status')"); return t.startsWith('Last: run') && t; }, 3000)
    .catch(() => evalInApp("window.__gameMenu.text('menu-stats-status')"));
  const csv = evalInApp('window.__stats.csv()').trim().split('\n');
  check('Stopping the run writes its row: stopped, the miss, the grind, the queasy mark and time in the driver\'s seat',
    row !== null && row.run === run.id && row.result === 'stopped' && row.fumbles[GEAR] === 1 && row.grinds >= 1 && row.queasy === 1 && row.driver > 1 &&
      row.bumps === 'reduced',
    row ? `run ${row.run} ${row.result} at ${row.time.toFixed(1)} s, gear fumbles ${row.fumbles[GEAR]}, grinds ${row.grinds}, queasy ${row.queasy}, driver ${row.driver.toFixed(1)} s, bumps ${row.bumps}` : 'no row');
  check("The menu's stats line and the CSV show it",
    /^Last: run \d+ stopped at \d:\d\d\.\d, 0 shots, \d+ grinds?, 1 fumble \(most: gear\)/.test(line) && csv[0].startsWith('kind,run,at,seat') &&
      csv.filter((l) => l.startsWith('run,')).length === 1 && csv.at(-1).startsWith('visit,'),
    `"${line}"; CSV ${csv.length - 1} rows`);
  await menuClick('row-bumps-0');
  await menuButtonPress();
  evalInApp('(window.__stats.clear(), window.__drive.set(null), window.__drive.reset(), true)');
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
}

/**
 * 6k. The range run (F1.11): Practice → Range run → Start puts the tank
 *     back at the start and counts down on a sign; the clocks in both seats
 *     say "Get ready", then the clock runs. Practice → Ready to fire → 100 m
 *     puts a solo player in the gunner's seat with the gun laid on the 100 m
 *     target and loaded; the trigger hits it, its flag goes up and the count
 *     says one target. The 250 m and 500 m the same way; the third hit stops
 *     the clock on the run's time, marked assisted (Ready to fire was used),
 *     with a sign. Stop takes the flags down.
 */
async function theRangeRun() {
  const run = () => evalInApp('window.__rangeRun.state()');
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp("(window.__seats.ask('driver'), window.__drive.place(0, -150, 0), true)");
  await sleep(300);
  await menuButtonPress();
  // The page notes the run, the sign, the clocks and the tank the first time it sees the countdown: on a slow
  // runner the ray click and each call to the page take long enough for the 3 s countdown to be over before
  // the test could look.
  const read = '({ r: window.__rangeRun.state(), sign: window.__rangeRun.sign, clocks: window.__rangeRun.clock(), tank: window.__drive.state() })';
  evalInApp(`(() => {
    window.__countdownSeen = null;
    const id = setInterval(() => {
      const v = ${read};
      if (v.r.phase === 'running' && v.r.clock < 0) { window.__countdownSeen = JSON.parse(JSON.stringify(v)); clearInterval(id); }
    }, 20);
    setTimeout(() => clearInterval(id), 20000);
    return true;
  })()`);
  await menuClick('menu-run-start');
  const seen = await waitFor('the countdown', () => evalInApp('window.__countdownSeen'), 8000).catch(() => evalInApp(read));
  const { r: counting, sign, clocks, tank } = seen;
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-run-countdown.png'], {});
  check('Practice → Range run → Start parks the tank at the start and counts down on a sign and the run clock',
    counting.phase === 'running' && counting.clock < 0 && /^Range run: [123]$/.test(sign) && clocks[0] === 'Get ready' && Math.hypot(tank.x, tank.z) < 0.5,
    `clock ${counting.clock.toFixed(1)} s, sign "${sign}", clock board "${clocks.join(' | ')}", tank at ${tank.x.toFixed(1)}, ${tank.z.toFixed(1)}`);
  const going = await waitFor('the clock to run', () => { const r = run(); return r.clock > 0.5 && r; }, 6000).catch(() => run());
  const shown = evalInApp('window.__rangeRun.clock()');
  check('After the countdown the clock runs and the clocks in both seats show it',
    going.clock > 0.5 && /^\d+:\d\d\.\d$/.test(shown[1]) && shown[2] === 'Targets 0/3   Shots 0',
    `clock ${going.clock.toFixed(1)} s, board "${shown.join(' | ')}"`);

  // Practice → Ready to fire → 100 m: alone, into the gunner's seat, laid and loaded.
  await menuButtonPress();
  await menuClick('menu-ready-0');
  const ready = await waitFor('laid and loaded', () => evalInApp('window.__rangeRun.pending') === -1 && evalInApp('window.__loading.state().loaded') && evalInApp('window.__seats.mine') === 'gunner', 6000).catch(() => false);
  const predicted = evalInApp('window.__firing.predict()');
  check('Practice → Ready to fire → 100 m puts a solo player in the gunner\'s seat with the gun laid on the target and loaded',
    ready && predicted.kind === 'target' && predicted.target === 0,
    `seat ${evalInApp('window.__seats.mine')}, loaded ${evalInApp('window.__loading.state().loaded')}, the shot would: ${predicted.line}`);
  const shots0 = evalInApp('window.__firing.records().length');
  evalInApp('(window.__turret.pullTrigger(), true)');
  const one = await waitFor('the first target counted', () => { const r = run(); return r.targets === 1 && r; }, 5000).catch(() => run());
  const flags1 = evalInApp('window.__rangeRun.flags()');
  check('The trigger hits the 100 m target: its flag goes up and the run counts one target and one shot',
    one.targets === 1 && one.shots === 1 && one.hitAt[0] > 0 && flags1.join() === 'true,false,false' && one.assisted &&
      evalInApp('window.__firing.records().length') === shots0 + 1,
    `${one.targets} targets, ${one.shots} shots, flags ${flags1.join(', ')}, assisted ${one.assisted}`);
  // The flag stands by the target in the world as drawn.
  const flagAt = evalInApp('window.__rangeRun.flagAt(0)');
  const target = evalInApp('window.__range.targets()[0]');
  check('The hit flag stands beside the target, away from the road',
    flagAt !== null && Math.abs(flagAt[2] - target.z) < 0.01 && flagAt[0] < target.x - 1.5,
    `flag at ${flagAt ? fmt(flagAt) : 'none'}, target at ${target.x}, ${target.z}`);

  for (const i of [1, 2]) {
    evalInApp(`(window.__rangeRun.ready(${i}), true)`);
    await waitFor(`laid and loaded on target ${i}`, () => evalInApp('window.__rangeRun.pending') === -1 && evalInApp('window.__loading.state().loaded'), 6000).catch(() => false);
    await sleep(200);
    evalInApp('(window.__turret.pullTrigger(), true)');
    await waitFor(`target ${i} counted`, () => run().targets === i + 1, 5000).catch(() => null);
  }
  const done = await waitFor('the run done', () => { const r = run(); return r.phase === 'done' && r; }, 5000).catch(() => run());
  const doneSign = evalInApp('window.__rangeRun.sign');
  const doneClock = evalInApp('window.__rangeRun.clock()');
  evalInApp('(window.__turret.forward(), true)');
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(evalInApp('window.__loading.layout()').rack[0].map((v, k) => v + [0, 0.45, 0][k])) });
  await sleep(500);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-run-done.png'], {});
  check('The third hit stops the clock on the crew\'s time, marked assisted, with a sign',
    done.phase === 'done' && done.targets === 3 && done.shots === 3 && done.time > 0 && done.assisted && done.best < 0 &&
      evalInApp('window.__rangeRun.flags()').every(Boolean) && /^Three targets in \d:\d\d\.\d, 3 shots/.test(doneSign) &&
      doneClock[0] === 'Three hits (assisted)',
    `${done.targets} targets in ${done.time.toFixed(1)} s, ${done.shots} shots, sign "${doneSign}", board "${doneClock.join(' | ')}"`);

  // Look ahead again (the menu opens where the head looks), then open it: it redraws its lines as it opens.
  const eye = evalInApp('window.__loading.layout()').eye;
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([eye[0], eye[1], eye[2] - 5]) });
  await sleep(300);
  await menuButtonPress();
  const menuLine = await waitFor('the menu to say the time', () => {
    const text = evalInApp("window.__gameMenu.text('menu-run-status')");
    return text.startsWith('Three targets in') ? text : null;
  }, 3000).catch(() => evalInApp("window.__gameMenu.text('menu-run-status')"));
  check("The menu's range run line gives the run's time and shots",
    /^Three targets in \d:\d\d\.\d, 3 shots \(assisted\)\./.test(menuLine), `"${menuLine}"`);
  await menuClick('menu-run-stop');
  const stopped = await waitFor('the run stopped', () => { const r = run(); return r.phase === 'idle' && r; }, 4000).catch(() => run());
  await menuButtonPress();
  check('Stop ends the run and takes the flags down', stopped.phase === 'idle' && !evalInApp('window.__rangeRun.flags()').some(Boolean),
    `phase ${stopped.phase}, flags ${evalInApp('window.__rangeRun.flags()').join(', ')}`);
  evalInApp("(window.__loading.reset(), window.__turret.forward(), window.__drive.reset(), window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
}

/**
 * 6i. The gunsight (F1.9): up the range, Practice → Gunsight → Go to it puts
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
  await menuClick('menu-range-up');
  await waitFor('the tank parked up the range', () => evalInApp('window.__range.tank().nearest') === 1, 8000).catch(() => null);
  await menuButtonPress();
  await menuClick('menu-sight-go');
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
  await menuClick('menu-sight-lay-2');
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
 * 6l. The crew's periscopes (F1.6, both crew since F1.19): Sights →
 *     Periscopes → Driver's sits the player in the driver's seat just
 *     behind its window, 12 cm over the eyes; sitting up and leaning in
 *     opens it and renders a picture; a turn of the crank on its right
 *     turns it 90° left, the view and the head on the roof turning with it
 *     while the window stays put. Gunner's does the same in the gunner's
 *     seat over the gunsight, a half turn looking 45° left of the gun, with
 *     the gunsight left shut. Ahead turns both back and Power cycles.
 */
async function thePeriscopes() {
  const squeeze = (value) => iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: SQUEEZE, value }] });
  // Where to put the right controller so the middle of its fist, as the mechanism kit takes it, is at `p`: the
  // kit's fist is FIST_CENTRE (src/scene-assets/hand.scene-asset.ts) in the grip space, and the grip space isn't
  // where the emulator puts the controller. So the controller is put at a known point and the kit's fist read
  // there. The crank measures the hand's angle round its axle, so the offset must be right to a centimetre or
  // two. It holds while the controller's orientation stays the same.
  let fistOffset = [0, 0, 0];
  const measureFist = async (near) => {
    iwsdk(['xr', 'set-transform'], { device: 'controller-right', position: toOrigin(near) });
    await sleep(400);
    const fist = evalInApp(`(() => {
      const w = window.__debug.world;
      const space = w.player.gripSpaces.right;
      space.updateWorldMatrix(true, false);
      const q = space.getWorldQuaternion(w.player.quaternion.clone());
      return w.player.position.clone().set(0.016, -0.019, 0.011).applyQuaternion(q)
        .add(space.getWorldPosition(w.player.position.clone())).toArray();
    })()`);
    fistOffset = fist.map((v, i) => v - near[i]);
  };
  const handTo = (p, duration = 0.4) => {
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: toOrigin([p[0] - fistOffset[0], p[1] - fistOffset[1], p[2] - fistOffset[2]]), duration });
  };
  const behindLens = (head, lens) => (head[0] - lens.at[0]) * lens.facing[0] + (head[2] - lens.at[2]) * lens.facing[2];
  const flatAngle = (a, b) => Math.atan2(a[2] * b[0] - a[0] * b[2], a[0] * b[0] + a[2] * b[2]) * (180 / Math.PI);

  for (const id of ['driver', 'gunner']) {
    const scope = (expr) => evalInApp(`window.__periscope.${id}.${expr}`);
    const label = id === 'driver' ? "driver's" : "gunner's";
    iwsdk(['xr', 'set-device-state'], {});
    await sleep(300);
    evalInApp(`(window.__periscope.${id}.turn(0), true)`);
    await menuButtonPress();
    await menuClick(`menu-periscope-${id}`);
    const there = await waitFor(`the ${label} periscope's window`, () => {
      const s = seated();
      const lens = scope('lens()');
      return s.mine === id && behindLens(s.head, lens) > 0.1 && behindLens(s.head, lens) < 0.2 ? s : null;
    }, 8000).catch(() => seated());
    const lens0 = scope('lens()');
    // Tipped 15° towards the seat since John found 30° too steep (2026-11-08, docs/crew-heights.md).
    check(`Sights → Periscopes → ${id === 'driver' ? "Driver's" : "Gunner's"} sits the player in the ${label} seat just behind its window, above the eyes and facing down to them`,
      there.mine === id && behindLens(there.head, lens0) > 0.1 && behindLens(there.head, lens0) < 0.2 && lens0.at[1] - there.eye[1] > 0.07 && lens0.facing[1] < -0.2 && lens0.facing[1] > -0.3,
      `${there.mine}, head ${fmt(there.head)}, eye point ${fmt(there.eye)}, window ${fmt(lens0.at)}`);

    // Sit up and lean in, looking up into the window (it faces down towards the seat): it opens on the view.
    const rendersBefore = scope('state()').renders;
    iwsdk(['xr', 'set-transform'], { device: 'headset', position: toRig(lens0.at.map((v, i) => v + lens0.facing[i] * 0.06)) });
    iwsdk(['xr', 'look-at'], { device: 'headset', target: toRig(lens0.at.map((v, i) => v - lens0.facing[i] * 20)) });
    const open = await waitFor(`the ${label} periscope to open`, () => {
      const s = scope('state()');
      return s.open && s.renders > rendersBefore + 5 ? s : null;
    }, 10000).catch(() => scope('state()'));
    await sleep(500);
    const spread = scope('pictureSpread()');
    const sightOpen = evalInApp('window.__sight.state().open');
    iwsdk(['browser', 'screenshot', '--output-file', `artifacts/xr-periscope-${id}-ahead.png`], {});
    check(`Sitting up to the ${label} periscope's window renders the view ahead${id === 'gunner' ? ', the gunsight under it shut' : ''}`,
      open.open && spread > 20 && !sightOpen,
      `open ${open.open}, ${open.renders - rendersBefore} frames, picture spread ${spread}, ${open.calls} calls, ${Math.round(open.triangles / 1000)}k triangles, gunsight ${sightOpen ? 'open' : 'shut'}`);

    // The right hand on the crank's knob, turned anticlockwise (as the player sees it) a full turn for the driver's, half for the gunner's.
    const turns = id === 'driver' ? 1 : 0.5;
    const start = scope('state()').crankDeg;
    const knob = (deg) => scope(`knob(${deg})`);
    await measureFist(knob(start).map((v, i) => v + (i === 2 ? 0.1 : 0)));
    handTo(knob(start));
    await sleep(600);
    squeeze(1);
    const held = await waitFor(`a hand on the ${label} crank`, () => { const s = scope('state()'); return s.held && s; }, 3000, 100).catch(() => scope('state()'));
    check(`Squeezing at the ${label} periscope's crank takes hold of it`, held.held === true, `held ${held.held}`);
    const before = { lens: scope('lens()'), view: scope('view()') };
    for (let deg = 30; deg <= 360 * turns; deg += 30) {
      handTo(knob(start + deg), 0.25);
      await sleep(450);
    }
    const want = 90 * turns;
    const turned = await waitFor(`the ${label} periscope turned ${want}° left`, () => { const s = scope('state()'); return Math.abs(s.angleDeg - want) < 4 && s; }, 6000).catch(() => scope('state()'));
    squeeze(0);
    const after = { lens: scope('lens()'), view: scope('view()'), head: scope('head()') };
    const lensMoved = Math.hypot(...after.lens.at.map((v, i) => v - before.lens.at[i]));
    const swung = flatAngle(before.view.looking, after.view.looking);
    check(`${turns === 1 ? 'A turn' : 'Half a turn'} of the crank turns the ${label} periscope ${want}° left: the view and the head on the roof with it, the window still`,
      Math.abs(turned.angleDeg - want) < 4 && Math.abs(swung - want) < 5 && lensMoved < 0.002,
      `${turned.angleDeg.toFixed(1)}° (${turned.status}), crank ${(turned.crankDeg - start).toFixed(0)}°, view swung ${swung.toFixed(1)}°, head facing ${fmt(after.head.facing)}, window moved ${(lensMoved * 1000).toFixed(1)} mm`);
    iwsdk(['browser', 'screenshot', '--output-file', `artifacts/xr-periscope-${id}-left.png`], {});
    iwsdk(['xr', 'set-device-state'], {});
    await sleep(300);
  }

  // The menu: Ahead turns both back.
  await menuButtonPress();
  await menuClick('menu-periscope-ahead');
  await menuButtonPress();
  const ahead = await waitFor('both periscopes ahead', () => {
    const d = evalInApp('window.__periscope.driver.state()');
    const g = evalInApp('window.__periscope.gunner.state()');
    return Math.abs(d.angleDeg) < 0.01 && Math.abs(g.angleDeg) < 0.01 && { d, g };
  }, 4000).catch(() => ({ d: evalInApp('window.__periscope.driver.state()'), g: evalInApp('window.__periscope.gunner.state()') }));
  check('Sights → Periscopes → Ahead turns both straight ahead',
    Math.abs(ahead.d.angleDeg) < 0.01 && Math.abs(ahead.g.angleDeg) < 0.01,
    `driver's ${ahead.d.angleDeg.toFixed(2)}°, gunner's ${ahead.g.angleDeg.toFixed(2)}°, "${evalInApp('window.__periscope.status()')}"`);
  evalInApp('(window.__seats.reseat(), true)');
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
}

/**
 * 6f. The turret (F1.8): Practice → Lay the gun → Gunner puts the player in
 *     the gunner's seat with a sign; the power grip twisted left traverses
 *     the turret left and the gunner's play space turns with it (the head
 *     stays put in the turret), the vignette darkening; let go, it stops;
 *     a turn of the crank traverses about 2°; a turn clockwise of the
 *     sideways elevation handwheel raises the gun about 0.75° and the
 *     trigger bar on its handle pulls; Forward puts it back.
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
  await menuClick('menu-turret-go');
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

  // The elevation handwheel: taken by its handle and turned once clockwise as the gunner sees it from the seat (its top
  // going forward; anticlockwise seen from its face, which is turned away from them), the gun rises.
  const e0 = turret().elevationDeg;
  await take('elevation');
  const rr = 0.08;
  const out = 0.03;
  for (let k = 1; k <= 24; k++) {
    const a = (k * Math.PI) / 12;
    iwsdk(['xr', 'animate-to'], { device: 'controller-right', position: gripFor(scene('elevation', [-rr * Math.sin(a), rr * Math.cos(a), out])), duration: 0.15 });
    await sleep(200);
  }
  const raised = await waitFor('the gun to rise', () => { const s = turret(); return s.elevationDeg - e0 > 0.6 && s; }, 4000).catch(() => turret());
  const drawn = evalInApp('window.__turret.drawn()');
  check('A turn clockwise of the elevation handwheel raises the gun about 0.75°',
    raised.elevationDeg - e0 > 0.6 && raised.elevationDeg - e0 < 0.9 && Math.abs(drawn.elevation - raised.elevationDeg) < 0.05,
    `gun ${e0.toFixed(2)}° to ${raised.elevationDeg.toFixed(2)}°, drawn ${drawn.elevation.toFixed(2)}°`);
  // The trigger bar on its handle pulls like the power grip's trigger.
  const pressesBefore = state('elevation').presses;
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 0, value: 1 }] });
  const pulled = await waitFor('the trigger bar pulled', () => { const s = state('elevation'); return s.firing && s; }, 3000, 100).catch(() => state('elevation'));
  iwsdk(['xr', 'set-gamepad-state'], { device: 'controller-right', buttons: [{ index: 0, value: 0 }] });
  const eased = await waitFor('the trigger bar let go', () => { const s = state('elevation'); return !s.firing && s; }, 3000, 100).catch(() => state('elevation'));
  check("The trigger on the elevation handwheel's handle pulls while it is held",
    pulled.firing && !eased.firing && eased.presses === pressesBefore + 1, `firing ${pulled.firing} then ${eased.firing}, presses ${pressesBefore} to ${eased.presses}`);
  await letGoOf('elevation');

  await menuButtonPress();
  await menuClick('menu-turret-forward');
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
 * 6j. The tank's sounds (F1.12): the driving, loading and firing steps
 *     before this one made their short sounds on the way (a gear going in,
 *     a shell rammed, the breech slammed, the shot and its casing). Driving
 *     raises the engine's note and roar, the gears whine and the tracks
 *     rumble (F6.1), each track sounding of what it is on (dirt road,
 *     grass, gravel); the pins squeak now and then, and in a hard turn at
 *     speed the tracks strain and squeak more; the traverse crank ticks; Practice → Tank sounds →
 *     Play each plays every short sound and Run through revs the engine;
 *     the menu's Tank sounds row turns them off and on. The emulator can't listen, so this checks what
 *     the page sends to Web Audio.
 */
async function tankSounds() {
  const audio = () => evalInApp('window.__audio.state()');
  const before = audio();
  const h = before.heard;
  // The drive's sounds (gears, the engine catching and stalling) are
  // checked at the end of part 2.
  check('Loading and firing were heard: a shell rammed, the breech closing, the shot and its casing',
    h.ram >= 1 && h.breech >= 1 && h.shot >= 1 && h.casing >= 1,
    `${Object.entries(h).map(([id, n]) => `${id} ${n}`).join(', ')}; audio ${before.context}`);

  iwsdk(['xr', 'set-device-state'], {});
  // Warm, so the engine is running whichever steps ran before (part 3 on
  // CI never starts it by hand).
  evalInApp("(window.__seats.ask('driver'), window.__drive.reset('warm'), true)");
  await sleep(400);
  const idle = audio();
  evalInApp('(window.__drive.set({ left: 1, right: 1, gear: 1, throttle: 0 }), true)');
  const driving = await waitFor('the engine note to climb', () => { const a = audio(); return a.engineHz > 80 && a.rumble > 0.2 && a; }, 8000)
    .catch(() => audio());
  evalInApp('(window.__drive.set(null), window.__drive.reset(), true)');
  check("Driving off raises the multibank's beat (40 Hz a bank at idle, 130 flat out) and its roar, the gears whine and each track rumbles and clatters",
    idle.engineHz >= 39 && idle.engineHz < 60 && idle.rumble < 0.01 && idle.finalDrive === 0
      && driving.engineHz > 80 && driving.engineHz <= 131 && driving.load > 0.5 && driving.roar > idle.roar * 2
      && driving.finalDrive > 0 && driving.rumble > 0.2 && driving.leftHz > 3 && driving.rightHz > 3,
    `engine ${idle.engineHz.toFixed(0)} Hz at idle, ${driving.engineHz.toFixed(0)} Hz driving (throttle ${driving.load.toFixed(2)}, roar ${idle.roar.toFixed(2)} to ${driving.roar.toFixed(2)}); `
      + `final drives ${driving.finalDrive.toFixed(2)}, rumble ${driving.rumble.toFixed(2)}, links ${driving.leftHz.toFixed(1)} and ${driving.rightHz.toFixed(1)} a second`);

  // What each track is on (docs/audio.md, "What the tracks run on"): the tank put on the road up the range, astride
  // its east edge, on the grass beside it and on the course's gravel, facing north each time.
  const groundAt = async (x, z, want) => {
    evalInApp(`(window.__drive.place(${x}, ${z}, 0), true)`);
    return waitFor(`the tracks on ${want}`, () => { const a = audio(); return `${a.ground.left}/${a.ground.right}` === want && a; }, 5000).catch(() => audio());
  };
  const onRoad = await groundAt(0, -100, 'dirt/dirt');
  const astride = await groundAt(4, -100, 'dirt/grass');
  const onGrass = await groundAt(30, -100, 'grass/grass');
  const onGravel = await groundAt(320, -150, 'gravel/gravel');
  const grounds = [onRoad, astride, onGrass, onGravel].map((a) => `${a.ground.left}/${a.ground.right}`);
  check('Each track sounds of what it is on: the dirt road, one track on the road and one on the verge, grass, and the gravel of the course',
    grounds.join(' ') === 'dirt/dirt dirt/grass grass/grass gravel/gravel'
      && astride.top.left === onRoad.top.left && astride.top.right === onGrass.top.right && astride.gritHz.left > astride.gritHz.right * 1.5
      && onGrass.top.left < onRoad.top.left * 0.7 && onGravel.top.left > onRoad.top.left && onGravel.gritHz.left > onRoad.gritHz.left * 1.5,
    `${grounds.join(', ')}; clink ${onGrass.top.left.toFixed(2)} on grass, ${onRoad.top.left.toFixed(2)} on dirt, ${onGravel.top.left.toFixed(2)} on gravel; `
      + `the ground's noise about ${onGrass.gritHz.left.toFixed(0)}, ${onRoad.gritHz.left.toFixed(0)} and ${onGravel.gritHz.left.toFixed(0)} Hz`);
  // Driving up the course's east side: the gravel crunches under both tracks.
  evalInApp('(window.__drive.set({ left: 1, right: 1, gear: 1, throttle: 0 }), true)');
  const crunching = await waitFor('the gravel to crunch', () => { const a = audio(); return a.grit.left > 0.1 && a.grit.right > 0.1 && a; }, 8000).catch(() => audio());
  evalInApp('(window.__drive.set(null), window.__drive.reset(), true)');
  check("Driving on the gravel, the ground's own noise comes in under both tracks",
    crunching.ground.left === 'gravel' && crunching.ground.right === 'gravel' && crunching.grit.left > 0.1 && crunching.grit.right > 0.1 && onGravel.grit.left === 0,
    `standing ${onGravel.grit.left.toFixed(2)}, driving ${crunching.grit.left.toFixed(2)} and ${crunching.grit.right.toFixed(2)} on ${crunching.ground.left}`);

  // A hard turn at speed: the tracks strain, the outer one most (the sideways push that, past THROW_WARN, puts up the
  // driver's sign), and the pins squeak far more often than driving straight. The run through held at its left turn at
  // speed, so slow frames can't miss it.
  const squeaks0 = audio().squeaks;
  evalInApp('(window.__audio.tour(25.6, true), true)');
  const straining = await waitFor('the tracks to strain in the turn', () => { const a = audio(); return a.strain > 0.8 && a.squeaks > squeaks0 && a; }, 10000)
    .catch(() => audio());
  evalInApp('(window.__audio.state().tour && window.__audio.tour(), true)');
  check('Driving straight the pins squeak now and then; in a hard turn at speed the tracks strain, the outer one most, and squeak far more',
    driving.strain === 0 && driving.squeakRate > 0.2 && driving.squeakRate < 1
      && straining.strain > 0.8 && straining.strainSides.right > straining.strainSides.left && straining.squeakRate > driving.squeakRate * 3 && straining.squeaks > squeaks0,
    `straight: strain ${driving.strain.toFixed(2)}, ${driving.squeakRate.toFixed(2)} squeaks a second; turning: push ${straining.side.toFixed(2)} m/s², `
      + `strain ${straining.strain.toFixed(2)} (left ${straining.strainSides.left.toFixed(2)}, right ${straining.strainSides.right.toFixed(2)}), `
      + `${straining.squeakRate.toFixed(2)} squeaks a second, ${straining.squeaks - squeaks0} heard`);

  // The gunner's traverse crank ticks as it turns: 0.3 of a turn a second, as a slow hand would (by the clock,
  // since a timer only gets a turn between the emulator's slow frames).
  evalInApp('(window.__crankAt = performance.now(), window.__crankTimer = setInterval(() => { const now = performance.now(); window.__turret.crank(0.3 * (now - window.__crankAt) / 1000); window.__crankAt = now; }, 30), true)');
  const ticking = await waitFor('the crank to tick', () => { const a = audio(); return a.handHz > 1 && a; }, 8000).catch(() => audio());
  evalInApp('(clearInterval(window.__crankTimer), true)');
  const quiet = await waitFor('the crank to fall quiet', () => { const a = audio(); return a.handHz < 0.5 && a; }, 8000).catch(() => audio());
  const ear = ticking.ear;
  check("The handwheels' gears tick while the crank turns, and the sounds are heard from the player's head in the tank",
    ticking.handHz > 1 && quiet.handHz < 0.5 && Math.abs(ear[0]) < 1.2 && ear[1] > 0.8 && ear[1] < 2.6 && Math.abs(ear[2]) < 2.6,
    `${ticking.handHz.toFixed(1)} ticks a second turning, ${quiet.handHz.toFixed(1)} after; ear at (${ear.map((v) => v.toFixed(2)).join(', ')})`);

  await menuButtonPress();
  const heard0 = audio().heard;
  await menuClick('menu-audio-play');
  const played = await waitFor('every short sound played', () => {
    const now = audio().heard;
    return Object.keys(now).every((id) => now[id] > heard0[id]) && now;
  }, 16000).catch(() => audio().heard);
  const line = evalInApp("window.__gameMenu.text('menu-audio-status')");
  check('Practice → Tank sounds → Play each plays every short sound, and the menu says whether sound is on',
    Object.keys(played).every((id) => played[id] > heard0[id]) && line.length > 0,
    `${Object.keys(played).filter((id) => played[id] > heard0[id]).join(', ')}; "${line}"`);

  // Run through: the tour takes the engine up out of gear within a few seconds; pressed again, it stops.
  await menuClick('menu-audio-tour');
  const touring = await waitFor('the tour to rev the engine', () => { const a = audio(); return a.tour && a.engineHz > 100 && a; }, 12000)
    .catch(() => audio());
  const tourLine = evalInApp("window.__gameMenu.text('menu-audio-status')");
  await menuClick('menu-audio-tour');
  const toured = await waitFor('the tour to stop', () => { const a = audio(); return !a.tour && a.engineHz < 60 && a; }, 8000).catch(() => audio());
  check('Practice → Tank sounds → Run through revs the engine with the tank standing still, and stops when pressed again',
    touring.tour && touring.engineHz > 100 && touring.rumble < 0.01 && !toured.tour && toured.engineHz < 60,
    `touring: engine ${touring.engineHz.toFixed(0)} Hz, "${tourLine}"; after: ${toured.tour ? 'still touring' : 'stopped'}, engine ${toured.engineHz.toFixed(0)} Hz`);

  await menuClick('row-sound-2');
  const off = await waitFor('the sounds off', () => { const a = audio(); return a.sound === 0 && a; }, 5000).catch(() => audio());
  const offLit = evalInApp("window.__gameMenu.selected('row-sound-2')");
  await menuClick('row-sound-0');
  const on = await waitFor('the sounds back on', () => { const a = audio(); return a.sound === 1 && a; }, 5000).catch(() => audio());
  check("The menu's Tank sounds row turns the tank's sounds off and on again",
    off.sound === 0 && offLit && on.sound === 1, `off: ${off.sound} (${off.context}), on: ${on.sound} (${on.context})`);
  await menuButtonPress();
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6e. The driver's station (F1.5): in the driver's seat, both hands take
 *     the tillers and push them forwards: the tank drives on them (not the
 *     sticks), the gloves closed on the handles and the gauges reading
 *     speed and RPM; let go, they spring back and the tank stops. With the
 *     Gearbox on Clutch, the hand moves the gear lever from 2nd to 3rd
 *     without the clutch: the gears grind; the clutch in, 3rd goes in; let
 *     go near 1st, the lever drops into its notch (F1.16). The
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
  // A slow runner can take a few hundred ms to draw the frame the grab lands on: wait for it.
  const take = async (device, id) => {
    handTo(device, handle(id));
    await sleep(600);
    squeeze(device, 1);
    const hand = device.replace('controller-', '');
    await waitFor(`the ${hand} hand on the ${id}`, () => station().heldBy[id] === hand, 3000, 100).catch(() => {});
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
  // The second glove is still closing on its handle a frame or two after the grab.
  const gloves = () => evalInApp('[window.__ownHands.locked("left"), window.__ownHands.locked("right")]');
  const locked = await waitFor('both gloves on the tillers', () => { const g = gloves(); return g[0] > 0.9 && g[1] > 0.9 && g; }, 3000, 100).catch(() => gloves());
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
    Math.abs(readings.speed - driving.speed * 3.6) < 2 && readings.rpm > 1500 && readings.coolant > 10 && readings.coolant < 120 && readings.oil > 2 && readings.fuel > 0.9,
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

  // The gear lever by hand (F1.16): with the automatic box it moves by itself; with the Clutch (the menu's Gearbox
  // row) the hand works it, from 2nd up to 3rd without the clutch grinds, the clutch (left trigger) puts it in, and let
  // go near 1st it drops into the notch.
  const before = station();
  evalInApp('(window.__gameMenu.click("row-gearbox-2"), true)');
  await sleep(300);
  // Taken over from the automatic box the lever starts in neutral: put it in 2nd.
  evalInApp('(window.__drive.set({ gear: 2 }), window.__drive.set(null), true)');
  await sleep(300);
  const trigger = (device, value) => iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: 0, value }] });
  trigger('controller-left', 1);
  await waitFor('2nd in with the clutch held', () => tank().gear === 2, 5000).catch(() => null);
  trigger('controller-left', 0);
  await take('controller-left', 'gear');
  const onLever = station();
  handTo('controller-left', handle('gear', 4), 0.3);
  await sleep(400);
  handTo('controller-left', handle('gear', 8), 0.3);
  // Read in one go: the station counts a grind on the frame the tank starts grinding.
  const both = () => evalInApp('({ s: window.__driverStation.state(), t: window.__drive.state(), sign: window.__drive.sign })');
  const grinding = await waitFor('the gears to grind', () => {
    const b = both();
    return b.t.grinding && b.s.gear === 3 && b.s.grinds > before.grinds && b;
  }, 6000).catch(() => both());
  check('With the Clutch, moving the gear lever from 2nd to 3rd without the clutch grinds the gears',
    onLever.heldBy.gear === 'left' && grinding.t.grinding && grinding.t.gear === 0 && grinding.s.grinds > before.grinds && grinding.sign.startsWith('Gears grinding'),
    `lever held by ${onLever.heldBy.gear} at ${grinding.s.angles.gear.toFixed(1)}° (gear ${grinding.s.gear}), box in gear ${grinding.t.gear}, ${grinding.s.grinds - before.grinds} grind(s), sign "${grinding.sign}"`);
  trigger('controller-left', 1);
  const shifted = await waitFor('3rd to go in', () => { const t = tank(); return t.gear === 3 && !t.grinding && t; }, 6000).catch(() => tank());
  check('The clutch (left trigger) in, 3rd goes in', shifted.gear === 3 && !shifted.grinding && station().shifts > before.shifts,
    `gear ${shifted.gear}, ${station().shifts - before.shifts} shift(s)`);
  // Back past 2nd, let go near 1st: it drops into its notch and 1st goes in.
  handTo('controller-left', handle('gear', 0), 0.3);
  await sleep(400);
  handTo('controller-left', handle('gear', -10), 0.3);
  await sleep(500);
  squeeze('controller-left', 0);
  const first = await waitFor('1st', () => { const s = station(); const t = tank(); return t.gear === 1 && Math.abs(s.angles.gear + 8) < 1 && { s, t }; }, 6000)
    .catch(() => ({ s: station(), t: tank() }));
  check('The gear lever let go near 1st drops into its notch and 1st goes in', first.t.gear === 1 && Math.abs(first.s.angles.gear + 8) < 1,
    `lever at ${first.s.angles.gear.toFixed(1)}°, gear ${first.t.gear}`);
  trigger('controller-left', 0);
  evalInApp('(window.__gameMenu.click("row-gearbox-0"), true)');
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  // The clutch let out in 1st at a halt stalls the engine (F1.17): start it again for the hand throttle.
  evalInApp('(window.__drive.engine("start"), true)');

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
  await sleep(300);

  // The parking brake (F1.18): pulled up, it ratchets on, lights its lamp and holds the tank against the tillers;
  // pushed down without the trigger the ratchet holds it; with the trigger held it goes down and comes off.
  evalInApp('(window.__drive.parkingBrake(false), window.__drive.place(0, 0, 0), true)');
  await take('controller-left', 'brake');
  handTo('controller-left', handle('brake', 0), 0.5);
  const braked = await waitFor('the parking brake on', () => { const s = station(); return s.parkingBrake && s; }, 4000).catch(() => station());
  squeeze('controller-left', 0);
  await sleep(300);
  const lamp = () => evalInApp('window.__driverStation.engine().lamps.brake');
  check('The parking brake lever pulled up by the left hand ratchets on and lights its lamp',
    braked.parkingBrake && braked.angles.brake < 20 && lamp(),
    `lever at ${braked.angles.brake.toFixed(1)}°, ${braked.parkingBrake ? 'on' : 'off'}, lamp ${lamp()}`);
  evalInApp('(window.__drive.set({ left: 1, right: 1 }), true)');
  await sleep(1500);
  const against = evalInApp('({ t: window.__drive.state(), sign: window.__drive.sign })');
  evalInApp('(window.__drive.set(null), true)');
  check('With the parking brake on the tillers don\'t move the tank, and a sign says why',
    Math.abs(against.t.speed) < 0.01 && against.t.running && against.sign.startsWith('Parking brake on'),
    `${against.t.speed.toFixed(2)} m/s, sign "${against.sign}"`);
  await take('controller-left', 'brake');
  handTo('controller-left', handle('brake', 30), 0.4);
  await sleep(700);
  const ratcheted = station();
  trigger('controller-left', 1);
  handTo('controller-left', handle('brake', 35), 0.4);
  const off = await waitFor('the parking brake off', () => { const s = station(); return !s.parkingBrake && s.angles.brake > 30 && s; }, 4000).catch(() => station());
  trigger('controller-left', 0);
  squeeze('controller-left', 0);
  await sleep(300);
  check('Pushed down, the ratchet holds it until the trigger frees it; then it goes down and the lamp goes out',
    ratcheted.parkingBrake && !off.parkingBrake && !lamp(),
    `pushed without the trigger ${ratcheted.angles.brake.toFixed(1)}° (${ratcheted.parkingBrake ? 'on' : 'off'}), with it ${off.angles.brake.toFixed(1)}°, lamp ${lamp()}`);
  iwsdk(['xr', 'set-device-state'], {});
}

async function main() {
  mkdirSync(`${ROOT}/artifacts`, { recursive: true });
  await ensureRuntime();
  startedAt = Date.now();
  // Start from the game's defaults: settings a run saves (an Engine start of
  // Full procedure, a seat) stay in the managed browser's profile, and the
  // rerun after a stalled browser (or a local run after one stopped part
  // way) would start with them.
  // The gun's scatter and the biathlon's ranges picked afresh each race are
  // random: the test turns both off (as `scatter=0&boardranges=0` in the
  // URL would), and its own checks of them set them on purpose.
  evalInApp('(localStorage.clear(), localStorage.setItem("track-barrel.settings", "scatter=0&boardranges=0"), true)');

  try {
    iwsdk(['browser', 'reload'], {});
  } catch (error) {
    // On CI the first reload after start-up has died with no output, and the managed browser has not come back by
    // itself (runtime status and wait never relaunch it): relaunch it explicitly, wait for its bridge, retry once.
    console.log(`Reload failed, relaunching the managed browser and retrying once: ${error.message}`);
    const lifecycle = () => {
      try {
        const { state, failures, nextAction, history } = iwsdk(['runtime', 'status'], {}).result.browser.lifecycle;
        return JSON.stringify({ state, failures, nextAction, last: history?.at(-1) });
      } catch (statusError) {
        return statusError.message;
      }
    };
    console.log(`Runtime: ${lifecycle()}`);
    try {
      iwsdk(['runtime', 'recover'], {});
    } catch (recoverError) {
      console.log(`Recover: ${recoverError.message}`);
    }
    await waitFor('managed browser', () => iwsdk(['dev', 'status']).state?.browserCommandReady === true, 180000, 2000)
      .catch((waitError) => {
        console.log(`Runtime: ${lifecycle()}`);
        throw waitError;
      });
    iwsdk(['browser', 'reload'], {});
  }
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
  relaxRayClicks();
  appRunning = true;
  check('XR session active', iwsdk(['xr', 'status'], {}).result.sessionActive);
  await sleep(500);
  if (inPart(1)) await partOne();
  else await playSolo();
  if (inPart(2)) await partTwo();
  if (inPart(3)) await partThree();
  await lastChecks();
}

/**
 * Part 1: the start screen and menu, calibration, the hands, the seats and
 * eye height, the frame rate, the gunsight spike, the lever test, the
 * mechanism kit, tracked hands and riding the tank.
 */
async function partOne() {
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
  //     driver's eye point, hands too; standing up out of the chair fades
  //     the view under the roof.
  const bodyState = () => evalInApp('({ ...window.__body.state, head: window.__seats.head(), eye: window.__seats.eye("driver"), roof: window.__seats.fixes.roof, fade: window.__seats.fade, hand: window.__ownHands.position("right") })');
  const level = bodyState();
  evalInApp('(window.__body.choose({ raise: 0.05, seated: true }), true)');
  const raised = await waitFor('the eyes 5 cm up', () => { const b = bodyState(); return Math.abs(b.head[1] - (b.eye[1] + 0.05)) < 0.005 && b; }, 5000).catch(() => bodyState());
  check("The menu's eye height raises the eyes 5 cm above the seat's eye point, hands too",
    Math.abs(raised.head[1] - (raised.eye[1] + 0.05)) < 0.005 && Math.abs(raised.hand[1] - level.hand[1] - 0.05) < 0.005,
    `head at ${raised.head[1].toFixed(3)} m for ${(raised.eye[1] + 0.05).toFixed(3)}, right hand ${(raised.hand[1] - level.hand[1]).toFixed(3)} m higher`);
  evalInApp('(window.__body.choose({ raise: 0, seated: true }), true)');
  const now1c = iwsdk(['xr', 'get-transform'], { device: 'headset' }).result.position;
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: { x: now1c.x, y: now1c.y + 0.32, z: now1c.z } });
  // Mirrors the driver's headUp in src/sim/cabin.ts: the hull roof (1.8 m) less EYE_CLEARANCE (9 cm); black 4 cm above.
  const top = 1.8 - 0.09;
  const stood = await waitFor('the view to fade under the roof', () => { const b = bodyState(); return b.roof > level.roof && b.fade > 0.99 && b; }, 5000).catch(() => bodyState());
  check('Standing up out of the seat fades the view under the roof, the seat staying where it was',
    stood.roof > level.roof && stood.fade > 0.99 && Math.abs(stood.head[1] - (level.head[1] + 0.32)) < 0.005,
    `head at ${stood.head[1].toFixed(3)} m, roof stop at ${top.toFixed(3)} m, fade ${stood.fade.toFixed(2)}, ${stood.roof - level.roof} time(s)`);
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
  await menuClick('menu-levers');
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

  // 6c. Spike S2: riding the tank.
  await ridingTheTank();

  // 6r. The biathlon race (F5.3b).
  await theBiathlonRace();

  // 6s. Ammunition types (F3.1).
  await theAmmunition();

  // 6t. Overheating (F3.7).
  await theEngineHeat();

  // 6u. Enemy anti-tank guns (F3.2).
  await theEnemyGuns();

  // 6v. Enemy tanks on fixed routes (F3.3).
  await theEnemyTanks();

  // 6w. The tank damage model (F3.4).
  await theDamage();
}

/**
 * 6w. The tank damage model (F3.4): Combat → Damage → Me wounds this
 *     player's crewman: the view flashes red and dims, and the sign says
 *     so. Hit engine once: it runs on, weaker; twice: it stops and won't
 *     start. Repair starts it again. Track: the tank won't move under full
 *     throttle until repaired. Turret: the power traverse does nothing, the
 *     hand crank still turns the turret. A shot from an enemy gun that hits
 *     says what it did. Three hits through the armour knock the tank out
 *     and the guns hold their fire; Repair puts it all right.
 */
async function theDamage() {
  const damage = () => evalInApp('window.__damage.state()');
  const tank = () => evalInApp('window.__drive.state()');
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp('(window.__drive.reset("warm"), true)');
  // The enemy tanks' shells in the step before did what damage they did (a driver hit twice can't be hit again, and
  // a knocked-out tank says nothing of a new hit): this step starts from a mended tank, whatever came before it.
  evalInApp('(window.__damage.repair(), true)');
  await waitFor('a mended tank', () => { const d = damage(); return d.hits === 0 && d.driver === 0 && d.gunner === 0 && !d.out; }, 5000).catch(() => null);
  await sleep(500);

  await menuButtonPress();
  await menuClick('menu-damage-crew');
  const seat = evalInApp('window.__seats.mine');
  const hurt = await waitFor('the wound', () => { const d = damage(); return d[seat] === 1 && d.dark > 0 && d; }, 5000).catch(() => damage());
  const hurtSign = evalInApp('window.__damage.sign');
  check('Combat → Damage → Me: this player\'s crewman is wounded, the view flashes red and dims, and the sign says so',
    hurt[seat] === 1 && hurt.dark > 0 && new RegExp(`${seat} hit`).test(hurtSign),
    `seat ${seat}, wounds ${hurt[seat]}, dark ${hurt.dark?.toFixed?.(2)}, sign "${hurtSign}"`);
  await waitFor('the view to clear', () => damage().dark === 0, 10000).catch(() => null);
  await menuClick('menu-damage-repair');
  await waitFor('the wound mended', () => damage().hits === 0, 5000).catch(() => null);

  await menuClick('menu-damage-engine');
  const weak = await waitFor('the engine damaged', () => damage().engine === 1, 5000).then(() => tank()).catch(() => tank());
  await menuClick('menu-damage-engine');
  const dead = await waitFor('the engine knocked out', () => { const t = tank(); return !t.running && t.stallCause === 'hit' && t; }, 5000).catch(() => tank());
  check('Hit engine: once it runs on damaged; twice it stops, knocked out',
    weak.running && dead.running === false && dead.stallCause === 'hit' && /engine knocked out/i.test(evalInApp("window.__gameMenu.text('menu-damage-status')") ?? ''),
    `once running ${weak.running}, twice running ${dead.running} (${dead.stallCause}), "${evalInApp("window.__gameMenu.text('menu-damage-status')")}"`);
  evalInApp('(window.__drive.set({ start: "starter", starter: true }), true)');
  await sleep(4000);
  const still = tank().running;
  evalInApp('(window.__drive.set(null), true)');
  await menuClick('menu-damage-repair');
  const fixed = await waitFor('the engine running again', () => { const t = tank(); return t.running && damage().hits === 0 && t; }, 5000).catch(() => tank());
  check('A knocked-out engine won\'t start; Repair mends it and starts it again', !still && fixed.running && damage().engine === 0,
    `started on the starter ${still}, after Repair running ${fixed.running}, "${evalInApp('window.__damage.sign')}"`);

  await menuClick('menu-damage-track');
  await waitFor('the track broken', () => damage().immobile !== '', 5000).catch(() => null);
  await menuButtonPress();
  const at = tank();
  evalInApp('(window.__drive.set({ mode: "auto", left: 1, right: 1 }), true)');
  await sleep(3000);
  const held = tank();
  evalInApp('(window.__drive.set(null), true)');
  check('Track: the tank won\'t move under full throttle', Math.hypot(held.x - at.x, held.z - at.z) < 0.3,
    `moved ${Math.hypot(held.x - at.x, held.z - at.z).toFixed(2)} m, "${evalInApp("window.__gameMenu.text('menu-damage-status')")}"`);

  await menuButtonPress();
  await menuClick('menu-damage-turret');
  await waitFor('the traverse out', () => damage().traverse, 5000).catch(() => null);
  await menuButtonPress();
  const owner = evalInApp('window.__turret.owner()');
  const yaw0 = evalInApp('window.__turret.state().yaw');
  evalInApp('(window.__turret.set({ traverse: 1 }), true)');
  await sleep(1500);
  const yaw1 = evalInApp('window.__turret.state().yaw');
  evalInApp('(window.__turret.set(null), window.__turret.crank(1), true)');
  await sleep(500);
  const yaw2 = evalInApp('window.__turret.state().yaw');
  check('Turret: the power traverse does nothing, the hand crank still turns it',
    owner && Math.abs(yaw1 - yaw0) < 1e-3 && Math.abs(yaw2 - yaw1) > 0.01, `power ${(yaw1 - yaw0).toFixed(4)} rad, crank ${(yaw2 - yaw1).toFixed(3)} rad`);
  evalInApp('(window.__turret.forward(), window.__damage.repair(), true)');
  await sleep(500);

  // A hit from gun A says what it did.
  evalInApp('(window.__enemy.start(3), window.__drive.place(0, -80, 0), true)');
  await sleep(500);
  let struck = null;
  for (let n = 0; n < 8 && !struck; n++) {
    const before = damage().hits;
    evalInApp('(window.__enemy.fireNow(0), true)');
    struck = await waitFor("gun A's hit taken", () => { const d = damage(); return d.hits > before && d; }, 2500).catch(() => null);
  }
  const line = evalInApp('window.__damage.sign');
  check("An enemy gun's hit is taken when the shell gets there, and the sign says where and what it did",
    struck !== null && struck.last !== null && /^(Bounced off|Through|Struck)/.test(line), `"${line}", ${evalInApp("window.__gameMenu.text('menu-damage-status')")}`);

  // Knocked out: the guns hold their fire.
  evalInApp('(window.__damage.repair(), [0, 1, 2].forEach(() => window.__damage.take({ zone: "hull-side", through: true, armour: 38, pen: 110, effects: [], right: true })), true)');
  const out = await waitFor('knocked out', () => { const d = damage(); return d.out && d; }, 3000).catch(() => damage());
  const outSign = await waitFor('the knock-out sign', () => /^Knocked out/.test(evalInApp('window.__damage.sign')) && evalInApp('window.__damage.sign'), 3000).catch(() => evalInApp('window.__damage.sign'));
  const shots = evalInApp('window.__enemy.state().shots');
  await sleep(6000);
  const later = evalInApp('window.__enemy.state().shots');
  check('Three hits through the armour knock the tank out: its engine stops, the guns hold their fire, and the sign says so',
    out.out && !tank().running && later === shots && /^Knocked out/.test(outSign), `shots ${shots} → ${later}, sign "${outSign}"`);
  // Stop the guns first: repaired, the tank is a target again, and on a slow runner gun A's next shell can land before the check reads.
  evalInApp('(window.__enemy.stop(), true)');
  await menuButtonPress();
  await menuClick('menu-damage-repair');
  const mended = await waitFor('repaired', () => { const d = damage(); return !d.out && d.hits === 0 && tank().running && d; }, 5000).catch(() => damage());
  check('Damage → Repair puts it all right', !mended.out && mended.hits === 0, `"${evalInApp("window.__gameMenu.text('menu-damage-status')")}"`);
  await menuButtonPress();
  evalInApp('(window.__drive.reset("keep"), true)');
}

/**
 * 6v. Enemy tanks on fixed routes (F3.3): Combat → Enemy tanks → Meet A
 *     draws both tanks and parks the tank on the lane where tank A sees it,
 *     and tank A halts for it. Its shots (fired at once through the hook)
 *     strike and a hit is called. HE laid on tank A bursts on its armour to
 *     no effect; AP knocks it out (its wreck drawn, the sign). With the
 *     tank back at the start, out of its sight, tank B drives along its
 *     route. Stop takes the tanks away.
 */
async function theEnemyTanks() {
  const enemy = () => evalInApp('window.__enemy.state()');
  const A = 3;
  const B = 4;
  iwsdk(['xr', 'set-device-state'], {});
  await menuButtonPress();
  await menuClick('menu-tanks-meet-0');
  const met = await waitFor('the tanks drawn and tank A halted for the tank', () => {
    const e = enemy();
    const t = evalInApp('window.__drive.state()');
    return e.present[A] && e.guns[A].drawn && e.guns[B].drawn && !e.faceOff[A] && Math.abs(t.z + 230) < 1 && e.guns[A].sees && !e.guns[A].moving && e;
  }, 15000).catch(() => enemy());
  check('Combat → Enemy tanks → Meet A: both tanks are drawn, and tank A sees the tank and halts for it',
    met.guns[A].drawn && met.guns[B].drawn && met.guns[A].sees && !met.guns[A].moving && !met.faceOff[A],
    `drawn ${met.guns[A].drawn}/${met.guns[B].drawn}, A sees ${met.guns[A].sees}, moving ${met.guns[A].moving}, at (${Math.round(met.guns[A].x)}, ${Math.round(met.guns[A].z)}), "${evalInApp("window.__gameMenu.text('menu-tanks-status')")}"`);
  evalInApp(`(window.__enemy.hold(${A}, true), true)`);

  // Tank A fires until it hits.
  let hit = null;
  let fired = 0;
  for (let n = 0; n < 6 && !hit; n++) {
    const before = evalInApp('window.__enemy.shots().length');
    evalInApp(`(window.__enemy.fireNow(${A}), true)`);
    fired++;
    // Tank B may fire too: take tank A's shot.
    const shot = await waitFor("tank A's shot to strike", () => evalInApp('window.__enemy.shots()').slice(before).find((x) => x.gun === 3), 5000).catch(() => null);
    if (shot?.hit) hit = shot;
    else await sleep(800);
  }
  // Read the sign as soon as the hit lands: tank B's own firing puts its sign up over it a moment later.
  const hitSign = hit ? await waitFor('the hit on the sign', () => /^Hit! Tank A/.test(evalInApp('window.__enemy.sign')) && evalInApp('window.__enemy.sign'), 5000, 100).catch(() => evalInApp('window.__enemy.sign')) : '';
  check("Tank A's shells strike the tank, and a hit is called on the sign",
    hit !== null && /^Hit! Tank A, \d+ o'clock, \d+ m$/.test(hitSign), `${fired} shots, sign "${hitSign}"`);

  // HE on its armour does nothing; AP knocks it out.
  const target = 9 + A;
  const fireAt = async (round) => {
    const records = evalInApp('window.__firing.records().length');
    evalInApp(`(window.__loading.loadNow('${round}'), window.__firing.aimAt(${target}, '${round}'), true)`);
    await sleep(300);
    evalInApp(`(window.__firing.fire('${round}'), true)`);
    return waitFor(`the ${round} shot's result`, () => evalInApp('window.__firing.records()')[records], 10000).catch(() => null);
  };
  const he = await fireAt('he');
  await sleep(1500);
  check('HE on tank A bursts on its armour to no effect', he?.counted === -1 && /no effect on its armour/.test(he?.line ?? '') && enemy().alive[A],
    he ? `"${he.line}"` : 'no shot');
  const ap = await fireAt('ap');
  const out = await waitFor('tank A knocked out', () => { const e = enemy(); return !e.alive[A] && e; }, 10000).catch(() => enemy());
  const outSign = await waitFor('the knock-out on the sign', () => /^Tank A knocked out/.test(evalInApp('window.__enemy.sign')) && evalInApp('window.__enemy.sign'), 5000).catch(() => evalInApp('window.__enemy.sign'));
  check('AP on tank A knocks it out: its wreck is drawn, shells pass where it stood, and the sign says so',
    !out.alive[A] && out.alive[B] && out.guns[A].drawn && out.faceOff[A] && ap?.counted === target && /^Tank A knocked out/.test(outSign),
    `${ap ? `"${ap.line}"` : 'no shot'}, alive ${out.alive.join('/')}, sign "${outSign}"`);

  // Back at the start, out of its sight, tank B drives along its route.
  evalInApp('window.__drive.place(0, 0, 0)');
  // It loses the tank after 4 s out of sight, then drives on.
  await waitFor('tank B to drive on', () => enemy().guns[B].moving, 20000).catch(() => null);
  const from = enemy().guns[B];
  await sleep(3000);
  const to = enemy().guns[B];
  check('Out of its sight, tank B drives along its route', to.moving && Math.hypot(to.x - from.x, to.z - from.z) > 0.5,
    `moved ${Math.hypot(to.x - from.x, to.z - from.z).toFixed(1)} m, along ${from.along.toFixed(1)} → ${to.along.toFixed(1)} m`);

  await menuButtonPress();
  await menuClick('menu-tanks-stop');
  const stopped = await waitFor('the tanks gone', () => { const e = enemy(); return !e.present[A] && !e.present[B] && !e.guns[A].drawn && !e.guns[B].drawn && e; }, 5000).catch(() => enemy());
  check('Enemy tanks → Stop takes the tanks away', !stopped.present[B] && stopped.faceOff[B] && !stopped.guns[B].drawn,
    `"${evalInApp("window.__gameMenu.text('menu-tanks-status')")}"`);
  await menuButtonPress();
  evalInApp('(window.__drive.reset("keep"), true)');
}

/**
 * 6t. Overheating (F3.7): Combat → Engine heat → Hot seats a solo player
 *     as driver with the engine running past knocking: the TEMP lamp lit,
 *     the coolant gauge in the red, the engine rough, the driver's sign
 *     and the menu's line saying so. Held hotter than the stall point and
 *     flat out in 1st with the Stick shift, it stalls from the heat and
 *     the sign says why; Engine heat → Normal starts it again warm with
 *     the lamp out.
 */
async function theEngineHeat() {
  const tank = () => evalInApp('window.__drive.state()');
  const box = () => evalInApp('window.__driverStation.engine()');
  iwsdk(['xr', 'set-device-state'], {});
  await menuButtonPress();
  await menuClick('menu-heat-hot');
  const hot = await waitFor('the engine hot', () => { const s = tank(); return s.running && s.coolant >= 112 && box().lamps.temp && s; }, 8000).catch(() => tank());
  await sleep(1500);
  const zone = evalInApp('window.__driverStation.zones().at.coolant');
  const status = evalInApp("window.__gameMenu.text('menu-heat-status')");
  const sign = evalInApp('window.__drive.sign');
  check('Combat → Engine heat → Hot: the driver sees the TEMP lamp lit, the coolant gauge in the red, the engine knocking and a sign to idle it',
    hot.running && hot.coolant >= 112 && box().lamps.temp && zone === 'danger' && tank().rough && evalInApp('window.__seats.mine') === 'driver' &&
      /^Engine overheating/.test(sign) && /knocking/.test(status ?? ''),
    `seat ${evalInApp('window.__seats.mine')}, ${Math.round(hot.coolant)} °C, lamp ${box().lamps.temp}, gauge ${zone}, rough ${tank().rough}, sign "${sign}", menu "${status}"`);
  await menuButtonPress();

  // Hotter than the stall point and labouring flat out in 1st: it dies within HEAT_STALL_SECONDS (8 s).
  const stalls = tank().stalls;
  evalInApp('(window.__drive.coolant(125), window.__drive.set({ mode: "stick", gear: 1, accel: 1 }), true)');
  const stalled = await waitFor('the engine to stall from the heat', () => { const s = tank(); return !s.running && s.stalls > stalls && s; }, 15000).catch(() => tank());
  await sleep(500);
  const why = evalInApp('window.__drive.sign');
  check('Held too hot, the engine stalls from the heat and the driver is told to let it cool',
    !stalled.running && stalled.stallCause === 'heat' && /^Engine stalled\. Overheated/.test(why),
    `running ${stalled.running}, cause ${stalled.stallCause}, sign "${why}"`);
  evalInApp('(window.__drive.set(null), true)');
  await menuButtonPress();
  await menuClick('menu-heat-normal');
  const normal = await waitFor('the engine back to normal', () => { const s = tank(); return s.running && s.coolant < 100 && !box().lamps.temp && s; }, 8000).catch(() => tank());
  check('Engine heat → Normal starts it again, warm, with the TEMP lamp out',
    normal.running && normal.coolant < 100 && !box().lamps.temp, `running ${normal.running}, ${Math.round(normal.coolant)} °C, lamp ${box().lamps.temp}`);
  await menuButtonPress();
  evalInApp('(window.__drive.reset("keep"), true)');
}

/**
 * 6u. Enemy anti-tank guns (F3.2): Combat → Enemy guns → Meet A parks the
 *     tank on the lane where gun A first sees it, with the guns drawn and
 *     their shields there to hit; gun A sees the tank there. A shot from
 *     gun A strikes (fired at once through the hook: the emulator's slow
 *     frames stretch its 6 s lay); a hit puts a "Hit!" note on the sign.
 *     AP laid on gun A's shield knocks it out: its wreck is drawn, its
 *     shield no longer hit, and the sign says so. Smoke laid between the
 *     tank and gun B hides the tank from it. Stop takes the guns away.
 */
async function theEnemyGuns() {
  const enemy = () => evalInApp('window.__enemy.state()');
  iwsdk(['xr', 'set-device-state'], {});
  await menuButtonPress();
  await menuClick('menu-enemy-meet-0');
  const met = await waitFor('the guns drawn and the tank where gun A sees it', () => {
    const e = enemy();
    const t = evalInApp('window.__drive.state()');
    return e.on && e.guns.slice(0, 3).every((g) => g.drawn) && e.faceOff.slice(0, 3).every((off) => !off) && Math.abs(t.z + 80) < 1 && e;
  }, 10000).catch(() => enemy());
  const sees = evalInApp('window.__enemy.canSee(0)');
  check('Combat → Enemy guns → Meet A: the three guns are drawn, their shields there to hit, and gun A sees the tank',
    met.on && met.guns.slice(0, 3).every((g) => g.drawn) && met.faceOff.slice(0, 3).every((off) => !off) && sees,
    `on ${met.on}, drawn ${met.guns.map((g) => g.drawn).join('/')}, gun A sees ${sees}, "${evalInApp("window.__gameMenu.text('menu-enemy-status')")}"`);

  // Gun A fires until it hits (each shot corrects the last).
  let hit = null;
  let fired = 0;
  for (let n = 0; n < 6 && !hit; n++) {
    const before = evalInApp('window.__enemy.shots().length');
    evalInApp('(window.__enemy.fireNow(0), true)');
    fired++;
    const shot = await waitFor("gun A's shot to strike", () => {
      const s = evalInApp('window.__enemy.shots()');
      return s.length > before && s[s.length - 1];
    }, 5000).catch(() => null);
    if (shot?.hit) hit = shot;
    await sleep(800);
  }
  const hitSign = hit ? await waitFor('the hit on the sign', () => /^Hit! Gun A/.test(evalInApp('window.__enemy.sign')) && evalInApp('window.__enemy.sign'), 5000).catch(() => evalInApp('window.__enemy.sign')) : '';
  check("Gun A's shells strike the tank, and a hit is counted and called on the sign",
    hit !== null && enemy().hits >= 1 && /^Hit! Gun A, \d+ o'clock, \d+ m$/.test(hitSign),
    `${fired} shots, hits ${enemy().hits}, sign "${hitSign}"`);

  // John's play test (14 November 2026): the notice follows the tank. Turned 90° left where it stands, gun A
  // moves from 10 o'clock round to 1, on the sign that is up; the gunner is told which way to traverse.
  let fresh = false;
  for (let n = 0; n < 6 && hit && !fresh; n++) {
    const hits = enemy().hits;
    evalInApp('(window.__enemy.fireNow(0), true)');
    fresh = await waitFor('a fresh hit on the sign', () => enemy().hits > hits && /^Hit! Gun A/.test(evalInApp('window.__enemy.sign')), 3000, 50).catch(() => false);
  }
  const before = evalInApp("({ sign: window.__enemy.sign, line: window.__enemy.signLine, mine: window.__seats.mine })");
  evalInApp('(window.__drive.place(0, -80, Math.PI / 2), true)');
  const turned = await waitFor('the notice to follow the tank', () => {
    const s = evalInApp("({ sign: window.__enemy.sign, line: window.__enemy.signLine })");
    return / 1 o'clock/.test(s.sign) && s;
  }, 3000, 50).catch(() => evalInApp("({ sign: window.__enemy.sign, line: window.__enemy.signLine })"));
  evalInApp('(window.__drive.place(0, -80, 0), window.__damage.repair(), true)');
  const lineOk = before.mine === 'gunner' ? /^(Traverse (left|right) \d+°|Dead ahead of your gun)$/.test(turned.line) : turned.line === '';
  check("The enemy notice's clock follows the tank as it turns, and only the gunner is told which way to traverse",
    !hit || (fresh && / 10 o'clock/.test(before.sign) && / 1 o'clock/.test(turned.sign) && lineOk),
    `${before.mine}: "${before.sign}" / "${before.line}" then turned "${turned.sign}" / "${turned.line}"`);

  // The gunner's AP on gun A's shield.
  const records = evalInApp('window.__firing.records().length');
  evalInApp("(window.__loading.loadNow('ap'), window.__firing.aimAt(9, 'ap'), true)");
  await sleep(300);
  evalInApp("(window.__firing.fire('ap'), true)");
  const out = await waitFor('gun A knocked out', () => { const e = enemy(); return !e.alive[0] && e; }, 10000).catch(() => enemy());
  const shot = evalInApp('window.__firing.records()')[records];
  const outSign = await waitFor('the knock-out on the sign', () => /^Gun A knocked out/.test(evalInApp('window.__enemy.sign')) && evalInApp('window.__enemy.sign'), 5000).catch(() => evalInApp('window.__enemy.sign'));
  check('AP on gun A\'s shield knocks it out: its wreck is drawn, shells pass where it stood, and the sign says so',
    !out.alive[0] && out.alive[1] && out.alive[2] && out.guns[0].drawn && out.faceOff[0] && shot?.counted === 9 && /^Gun A knocked out/.test(outSign),
    `${shot ? `"${shot.line}"` : 'no shot'}, alive ${out.alive.join('/')}, sign "${outSign}"`);

  // Smoke between the tank and gun B hides it from the gun.
  evalInApp('window.__drive.place(0, -160, 0)');
  await sleep(500);
  const bSees = evalInApp('window.__enemy.canSee(1)');
  evalInApp('(window.__smoke.lay(-45, 0, -265), true)');
  const hidden = await waitFor('the smoke to hide the tank from gun B', () => !evalInApp('window.__enemy.canSee(1)'), 20000).catch(() => false);
  check('Smoke laid between the tank and gun B hides the tank from it', bSees && hidden, `sees before ${bSees}, hidden ${hidden}`);

  await menuButtonPress();
  await menuClick('menu-enemy-stop');
  const stopped = await waitFor('the guns gone', () => { const e = enemy(); return !e.on && e.guns.every((g) => !g.drawn) && e; }, 5000).catch(() => enemy());
  check('Enemy guns → Stop takes the guns away and their shields with them', !stopped.on && stopped.faceOff.every(Boolean),
    `"${evalInApp("window.__gameMenu.text('menu-enemy-status')")}"`);
  await menuButtonPress();
  evalInApp('(window.__drive.reset("keep"), true)');
}

/**
 * 6s. Ammunition types (F3.1): Combat → Ammunition rack → All HE fills
 *     every rack slot with HE and Mixed puts the mixed rack back; Combat →
 *     Ready on the gun → HE seats a solo player as gunner laid on the 250 m
 *     gun and loaded with HE, whose shot hits it; an HE round laid to burst
 *     on the ground 3 m beside the gun counts by its blast; Ready on the
 *     gun → Smoke fires a smoke round that counts no hit and lays a screen
 *     that grows and hides the gun from the tank (screenshot from the
 *     gunner's eyes).
 */
async function theAmmunition() {
  const loading = () => evalInApp('window.__loading.state()');
  iwsdk(['xr', 'set-device-state'], {});
  await menuButtonPress();
  await menuClick('menu-rack-he');
  const allHe = await waitFor('the rack all HE', () => { const s = loading(); return s.kinds.every((k) => k === 'he') && s; }, 5000).catch(() => loading());
  check('Combat → Ammunition rack → All HE fills every rack slot with HE, and the button shows it',
    allHe.rack === 'he' && allHe.kinds.every((k) => k === 'he') && evalInApp("window.__gameMenu.selected('menu-rack-he')"),
    `rack ${allHe.rack}: ${allHe.kinds.join(', ')}`);
  await menuClick('menu-rack-mixed');
  const mixed = await waitFor('the mixed rack', () => { const s = loading(); return s.rack === 'mixed' && s; }, 5000).catch(() => loading());
  check('Mixed puts back AP in the lower row, HE and smoke above', mixed.kinds.join() === 'ap,ap,he,smoke', mixed.kinds.join(', '));

  await menuClick('menu-ammo-ready-he');
  const ready = await waitFor('laid on the gun and loaded with HE', () => evalInApp('window.__rangeRun.pending') === -1 && loading().loaded && loading().loadedRound === 'he' && evalInApp('window.__seats.mine') === 'gunner', 8000).catch(() => false);
  const predicted = evalInApp("window.__firing.predict('he')");
  check('Combat → Ready on the gun → HE seats a solo player as gunner, loaded with HE and laid for its drop on the 250 m gun',
    ready && predicted.kind === 'target' && predicted.target === 1,
    `seat ${evalInApp('window.__seats.mine')}, loaded ${loading().loadedRound}, the shot would: ${predicted.line}; board "${loading().board[2]}"`);
  const fireAndWait = async (label) => {
    const n = evalInApp('window.__firing.records().length');
    evalInApp('(window.__turret.pullTrigger(), true)');
    return waitFor(label, () => { const r = evalInApp('window.__firing.records()'); return r.length > n && evalInApp('window.__firing.flying()') === 0 && r[r.length - 1]; }, 6000).catch(() => null);
  };
  const hits0 = evalInApp('window.__firing.hits()[1]');
  const he = await fireAndWait('the HE round to land');
  check('The HE round hits the gun', he !== null && he.ammo === 'he' && he.counted === 1 && evalInApp('window.__firing.hits()[1]') === hits0 + 1,
    he ? `"${he.line}"` : 'no shot');

  // Laid 3 m right of the gun's middle and down at its foot: it bursts on the ground beside it.
  evalInApp("(window.__loading.loadNow('he'), window.__firing.aimAt(1, 'he', 3, -1.15), true)");
  await sleep(300);
  const blast = await fireAndWait('the HE round to burst beside the gun');
  check("An HE round bursting on the ground beside the gun counts by its blast",
    blast !== null && blast.kind === 'ground' && blast.counted === 1 && /^HE burst \d m from the 250 m gun: hit$/.test(blast.line),
    blast ? `"${blast.line}"` : 'no shot');

  await menuButtonPress();
  await menuClick('menu-ammo-ready-smoke');
  await waitFor('loaded with smoke', () => evalInApp('window.__rangeRun.pending') === -1 && loading().loadedRound === 'smoke', 8000).catch(() => null);
  const clouds0 = evalInApp('window.__smoke.clouds().length');
  const smoke = await fireAndWait('the smoke round to land');
  const grown = await waitFor('the screen to grow', () => { const c = evalInApp('window.__smoke.clouds()'); return c.length > clouds0 && c[c.length - 1].radius > 8 && c[c.length - 1]; }, 15000).catch(() => null);
  // From the muzzle's height at the tank to the gun's middle, world space.
  const hidden = evalInApp(`(() => {
    const t = window.__drive.state();
    const g = window.__range.targets()[1];
    return window.__smoke.blocks([t.x, (t.y ?? 0) + 2.4, t.z], [g.x, 1.2, g.z]);
  })()`);
  const eye = evalInApp('window.__seats.eye("gunner")');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin(eye) });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([eye[0] + 2, eye[1], eye[2] - 30]) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-smoke-screen.png'], {});
  check('A smoke round on the gun counts no hit and lays a screen that grows and hides the gun',
    smoke !== null && smoke.ammo === 'smoke' && smoke.counted === -1 && grown !== null && hidden,
    `${smoke ? `"${smoke.line}"` : 'no shot'}, cloud ${grown ? `radius ${grown.radius.toFixed(1)} m at (${grown.x.toFixed(0)}, ${grown.z.toFixed(0)})` : 'none'}, hides the gun ${hidden}`);

  // The bank stays where it landed: its upwind end holds while the wind draws it out downwind.
  const upwind = (c) => {
    const n = Math.hypot(c.x - c.laidX, c.z - c.laidZ) || 1;
    return [c.x - ((c.x - c.laidX) / n) * c.halfLength, c.z - ((c.z - c.laidZ) / n) * c.halfLength];
  };
  const last = () => { const c = evalInApp('window.__smoke.clouds()'); return c[c.length - 1]; };
  // Fully grown first (4 s): while it grows its upwind edge spreads too.
  const before = await waitFor('the bank fully grown', () => { const c = last(); return c && c.age > 4.5 && c; }, 20000).catch(() => last());
  await waitFor('the wind to draw the bank out', () => { const c = last(); return c && c.halfLength > before.halfLength + 2 && c; }, 20000).catch(() => null);
  const after = last();
  const held = Math.hypot(upwind(after)[0] - upwind(before)[0], upwind(after)[1] - upwind(before)[1]);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-smoke-stretched.png'], {});
  check('The smoke bank stays where it landed, its upwind end put, while the wind draws it out downwind',
    after.halfLength > before.halfLength + 2 && held < 0.5,
    `half length ${before.halfLength.toFixed(1)} → ${after.halfLength.toFixed(1)} m over ${(after.age - before.age).toFixed(1)} s, upwind end moved ${held.toFixed(2)} m`);
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6r. The biathlon race (F5.3b): Practice → Biathlon race → Start parks
 *     the tank short of the course's start line and counts down, the
 *     gunner's rack holding the line's three rounds (its fourth slot
 *     empty); after Go, Ready line 1 puts a solo player in the gunner's
 *     seat halted in firing box 1, laid on a board and loaded. Each trigger
 *     pull brings a board down (its white cover over the disc) and spends a
 *     round; after the third the line is shot clean (a sign says so), the
 *     rack is empty and the loading board says no rounds are left
 *     (screenshot from the gunner's eyes). Stop ends the race: the covers
 *     go and the rack is full again.
 */
async function theBiathlonRace() {
  const run = () => evalInApp('window.__rangeRun.state()');
  const tank = () => evalInApp('window.__drive.state()');
  const places = () => evalInApp('window.__loading.state().shells.map((s) => s.place)');
  iwsdk(['xr', 'set-device-state'], {});
  // This race picks its lines' ranges, as a player's does (the test loads with them fixed).
  evalInApp('(window.__rangeRun.pickRanges(true), true)');
  await menuButtonPress();
  await menuClick('menu-race-start');
  const started = await waitFor('the race counting down at the course start', () => {
    const s = run();
    const t = tank();
    return s.mode === 'biathlon' && s.phase === 'running' && Math.abs(t.x - 320) < 0.5 && Math.abs(t.z + 225) < 0.5 && s;
  }, 10000).catch(() => run());
  const rack = await waitFor("the line's three rounds in the rack", () => {
    const p = places();
    return p.filter((x) => x === 'spent').length === 1 && p;
  }, 8000).catch(() => places());
  check('Practice → Biathlon race → Start parks the tank short of the course\'s start line and counts down, three rounds in the rack',
    started.mode === 'biathlon' && started.phase === 'running' && started.rounds === 3 && started.laps === 0 &&
      evalInApp('window.__rangeRun.rounds()') === 3 && rack.filter((x) => x === 'rack').length === 3,
    `${started.mode} ${started.phase}, clock ${started.clock?.toFixed(1)}, rounds ${started.rounds}, rack ${rack.join('/')}, "${started.line}"`);
  const ranges = started.ranges ?? [];
  const drawn = evalInApp('window.__rangeRun.boardAt(4)');
  const layout = evalInApp('window.__course.layout().boards[4]');
  check("The race stands each line's boards at a range of its own picking: line 1 350 to 450 m, line 2 450 to 550 m, drawn there",
    ranges.length === 2 && ranges[0] >= 350 && ranges[0] <= 450 && ranges[1] >= 450 && ranges[1] <= 550 && ranges.every((r) => r % 10 === 0) &&
      JSON.stringify(evalInApp('window.__rangeRun.ranges()')) === JSON.stringify(ranges) && drawn !== null &&
      Math.hypot(drawn[0] - 320, drawn[2] + 170) > ranges[1] - 1 && Math.abs(Math.hypot(layout.x - 320, layout.z + 170) - ranges[1]) < 1,
    `ranges ${ranges.join(' and ')} m, board 5 drawn at (${drawn?.map((v) => v.toFixed(0)).join(', ')})`);
  // Go! (the run's clock steps at most 0.25 s a frame, so a slow runner takes a while over the countdown).
  await waitFor('Go', () => run().clock >= 0.2, 60000).catch(() => null);

  await menuButtonPress();
  await menuClick('menu-race-ready-0');
  const fallen = [];
  for (let k = 0; k < 3; k++) {
    if (k > 0) evalInApp('(window.__rangeRun.readyLine(0), true)');
    const loaded = await waitFor(`laid on board ${k + 1} and loaded`, () => {
      const l = evalInApp('window.__loading.state()');
      return l.loaded && evalInApp('window.__rangeRun.lineNow()') === 0 && evalInApp('window.__seats.mine') === 'gunner' && l;
    }, 15000).catch(() => null);
    if (loaded === null) break;
    evalInApp('(window.__turret.pullTrigger(), true)');
    const down = await waitFor(`board ${k + 1} down`, () => {
      const s = run();
      return s.boardAt[k] >= 0 && evalInApp('window.__firing.flying()') === 0 && s;
    }, 15000).catch(() => null);
    fallen.push(down !== null);
  }
  const shot = await waitFor('the line shot clean', () => {
    const s = run();
    return s.closed === 1 && s.owed === 0 && s;
  }, 10000).catch(() => run());
  const covers = evalInApp('window.__rangeRun.covers()');
  check('Ready line 1 lays and loads in firing box 1; each round fired brings a line 1 board down under its cover; the third shoots the line clean',
    fallen.length === 3 && fallen.every(Boolean) && shot.closed === 1 && shot.owed === 0 && shot.rounds === 0 && shot.shots === 3 &&
      covers.slice(0, 3).every(Boolean) && !covers.slice(3).some(Boolean) && evalInApp('window.__rangeRun.coverAt(0)') !== null,
    `boards down ${fallen.join('/')}, covers ${covers.join('/')}, rounds ${shot.rounds}, owed ${shot.owed}, note "${shot.note}", "${shot.line}"`);
  const sign = await waitFor('the line\'s sign', () => { const t = evalInApp('window.__rangeRun.sign'); return t === 'Line 1: clean!' && t; }, 5000)
    .catch(() => evalInApp('window.__rangeRun.sign'));
  const empty = await waitFor('the rack empty', () => {
    const l = evalInApp('window.__loading.state()');
    return l.shells.every((x) => x.place === 'spent') && /No rounds left$/.test(l.board[2]) && l;
  }, 8000).catch(() => evalInApp('window.__loading.state()'));
  const eye = evalInApp('window.__seats.eye("gunner")');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin(eye) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-race-line.png'], {});
  check('With the line shot a sign says so, the rack is empty and the loading board says no rounds are left',
    sign === 'Line 1: clean!' && empty.shells.every((x) => x.place === 'spent') && /No rounds left$/.test(empty.board[2]),
    `sign "${sign}", rack ${empty.shells.map((x) => x.place).join('/')}, board "${empty.board[2]}"`);

  // The boards are at 6 o'clock, and the seated gunner turns with the turret: face forward again for the menu's ray.
  evalInApp('(window.__turret.forward(), true)');
  await sleep(500);
  await menuButtonPress();
  await menuClick('menu-race-stop');
  const stopped = await waitFor('the race stopped, the rack full', () => {
    const s = run();
    return s.phase === 'idle' && places().every((x) => x !== 'spent') && evalInApp('window.__rangeRun.rounds()') === null && s;
  }, 8000).catch(() => run());
  const after = evalInApp('window.__rangeRun.covers()');
  check('Biathlon race → Stop ends the race: the covers come down and the rack is full again',
    stopped.phase === 'idle' && !after.some(Boolean) && places().every((x) => x === 'rack'),
    `${stopped.phase}, covers ${after.join('/')}, rack ${places().join('/')}`);
  await menuButtonPress();
  evalInApp("(window.__rangeRun.pickRanges(false), window.__drive.reset(), window.__turret.forward(), window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6e''. The driver's convoy position (docs/convoy-seat.md): Practice → Drive
 *     the tank → Head out raises the driver's seat through a fade: the eyes
 *     come up over the roof in the hatch's middle, the hatch's lid lies open
 *     beside it, the periscope is down, and the view clears (screenshot from
 *     the eyes); both hands take the tillers by their convoy grips and pull
 *     them back; Head out again lowers the seat. Then the seat lever, pulled
 *     back, raises it, and pulled again lowers it.
 */
async function theConvoySeat() {
  const convoy = () => evalInApp('window.__convoy.state()');
  const station = () => evalInApp('window.__driverStation.state()');
  const handle = (id, deg) => evalInApp(`window.__driverStation.handle(${JSON.stringify(id)}${deg === undefined ? '' : `, ${deg}`})`);
  const squeeze = (device, value) => iwsdk(['xr', 'set-gamepad-state'], { device, buttons: [{ index: SQUEEZE, value }] });
  const handTo = (device, p, duration = 0.4) => iwsdk(['xr', 'animate-to'], { device, position: toOrigin(p), duration });
  const take = async (device, id) => {
    handTo(device, handle(id));
    await sleep(600);
    squeeze(device, 1);
    const hand = device.replace('controller-', '');
    await waitFor(`the ${hand} hand on the ${id}`, () => station().heldBy[id] === hand, 3000, 100).catch(() => {});
  };
  const roofTop = 1.47 + 0.08;

  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);
  evalInApp('(window.__drive.set(null), window.__drive.reset(), true)');
  const downEye = evalInApp('window.__seats.eye("driver")');
  await menuButtonPress();
  await menuClick('menu-head-out');
  const up = await waitFor('the seat raised and the view clear', () => {
    const c = convoy();
    const s = seated();
    return c.shown && s.fade === 0 && s.head[1] > roofTop + 0.01 && { c, s };
  }, 10000).catch(() => ({ c: convoy(), s: seated() }));
  const looks = evalInApp('({ lid: window.__interior.state().lids.driver, scope: window.__periscope.driver.head().at, eye: window.__seats.eye("driver") })');
  check('Practice → Head out raises the driver\'s seat: the eyes come up over the roof in the hatch, the lid lies open, the periscope is down, the view clear',
    up.c.shown && up.s.mine === 'driver' && up.s.head[1] > roofTop + 0.01 && up.s.fade === 0 && looks.lid && looks.scope[1] < roofTop + 0.04 &&
      looks.eye[1] - downEye[1] > 0.25 && flatGap(up.s.head, looks.eye) < 0.08,
    `seat ${up.s.mine}, head ${fmt(up.s.head)}, eye point ${fmt(looks.eye)} (down ${fmt(downEye)}), fade ${up.s.fade}, lid open ${looks.lid}, periscope head at ${looks.scope[1].toFixed(3)}`);
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([looks.eye[0], looks.eye[1] - 0.4, looks.eye[2] - 6]) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-convoy.png'], {});

  // The tillers by their convoy grips: pulled back, they steer as from the seat below.
  const gripAt = handle('tillerLeft');
  await take('controller-left', 'tillerLeft');
  await take('controller-right', 'tillerRight');
  handTo('controller-left', handle('tillerLeft', -15));
  handTo('controller-right', handle('tillerRight', -15));
  const pulled = await waitFor('both tillers pulled back by their convoy grips', () => { const s = station(); return s.left < -0.4 && s.right < -0.4 && s; }, 5000).catch(() => station());
  check('Raised, both hands take the tillers by their convoy grips, up where the hands rest, and pull them back',
    pulled.heldBy.tillerLeft === 'left' && pulled.heldBy.tillerRight === 'right' && pulled.left < -0.4 && pulled.right < -0.4 && looks.eye[1] - gripAt[1] < 0.55,
    `held by ${pulled.heldBy.tillerLeft} and ${pulled.heldBy.tillerRight}, tillers ${pulled.left.toFixed(2)} and ${pulled.right.toFixed(2)}, grip ${(looks.eye[1] - gripAt[1]).toFixed(2)} m under the eyes`);
  squeeze('controller-left', 0);
  squeeze('controller-right', 0);
  iwsdk(['xr', 'set-device-state'], {});
  await sleep(300);

  // No gun stop for now (John, 2026-11-08): with the driver's head out, the turret still turns past their hatch.
  evalInApp('(window.__turret.forward(), true)');
  await sleep(200);
  evalInApp('(window.__turret.crank(10), true)');
  const turned = await waitFor('the turret turned 20° left', () => {
    const t = evalInApp('({ yaw: window.__turret.state().yawDeg, stops: window.__turret.headOutStops })');
    return t.yaw > 19 && t;
  }, 3000, 100).catch(() => evalInApp('({ yaw: window.__turret.state().yawDeg, stops: window.__turret.headOutStops })'));
  check('Head out, the crank still turns the turret 20° left, past the driver\'s hatch (the gun stop is off)',
    turned.yaw > 19 && turned.stops === 0, `turret ${turned.yaw.toFixed(1)}° left, stops ${turned.stops}`);
  evalInApp('(window.__turret.forward(), true)');

  await menuButtonPress();
  await menuClick('menu-head-out');
  const down = await waitFor('the seat lowered', () => { const c = convoy(); const s = seated(); return !c.shown && s.fade === 0 && s.head[1] < roofTop - 0.1 && { c, s }; }, 10000)
    .catch(() => ({ c: convoy(), s: seated() }));
  check('Head out again lowers the seat: the eyes back under the roof, the lid back as set',
    !down.c.shown && down.s.head[1] < roofTop - 0.1 && !evalInApp('window.__interior.state().lids.driver'),
    `head ${fmt(down.s.head)}, lid open ${evalInApp('window.__interior.state().lids.driver')}`);

  // The seat lever, right of the cushion: drawn leaning forward where the hand finds it; pull it back to raise the seat, and again to lower it.
  const resting = convoy();
  check('The seat lever is drawn leaning forward at rest, where its grip is',
    Math.abs(resting.drawn - resting.lever) < 0.01 && resting.lever > 40 * Math.PI / 180,
    `lever ${(resting.lever * 180 / Math.PI).toFixed(1)}°, drawn ${(resting.drawn * 180 / Math.PI).toFixed(1)}°`);
  for (const want of [true, false]) {
    const lever = evalInApp('window.__convoy.lever()');
    handTo('controller-right', lever);
    await sleep(600);
    squeeze('controller-right', 1);
    await waitFor('the hand on the seat lever', () => convoy().held, 3000, 100).catch(() => {});
    handTo('controller-right', [lever[0], lever[1] + 0.045, lever[2] + 0.085]);
    const moved = await waitFor(`the seat ${want ? 'up' : 'down'} by its lever`, () => { const c = convoy(); return c.shown === want && c; }, 8000).catch(() => convoy());
    squeeze('controller-right', 0);
    check(`Pulling the seat lever back ${want ? 'raises' : 'lowers'} the seat, the lever drawn where the hand has it`, moved.shown === want && Math.abs(moved.drawn - moved.lever) < 0.01, `lever ${(moved.lever * 180 / Math.PI).toFixed(1)}°, drawn ${(moved.drawn * 180 / Math.PI).toFixed(1)}°, held ${moved.held}, seat ${moved.shown ? 'up' : 'down'}`);
    iwsdk(['xr', 'set-device-state'], {});
    await waitFor('the view clear', () => seated().fade === 0, 5000).catch(() => {});
  }
}

/** Part 2: driving the tank, the driver's station and controls, laying the gun, and both crew's periscopes. */
async function partTwo() {
  // 6d. The tank drive (F1.4).
  await drivingTheTank();

  // 6e. The driver's station (F1.5).
  await driverStation();
  // 6e'. John's headset notes on the driver's controls (31 October 2026).
  await driverFeedback();
  // 6e''. The driver's convoy position: head out of the hatch (docs/convoy-seat.md).
  await theConvoySeat();
  // 6f. The turret (F1.8).
  await layingTheGun();

  // The driving steps' sounds (the rest are checked in part 3 with the
  // tank's sounds).
  const heard = evalInApp('window.__audio.state().heard');
  check('The drive was heard: gears going in, the engine catching and stalling',
    heard.clunk >= 1 && heard.catch >= 1 && heard.stall >= 1,
    Object.entries(heard).map(([id, n]) => `${id} ${n}`).join(', '));

  // 6l. The periscopes for both crew (F1.6, F1.19).
  await thePeriscopes();

  // 6x. The biathlon's driving challenge (F5.3d).
  await theDrivingChallenge();

  // 6y. The combat scenario and the fight's tuning (F3.10).
  await theCombatScenario();
}

/**
 * 6y. The combat scenario and the fight's tuning (F3.10): Battle →
 *     Advance to contact → Start puts the tank back at the start, mended,
 *     with the guns in (not yet the tanks) and the briefing on the sign;
 *     Battle → Enemy accuracy → Low reaches the enemy's battery and lights
 *     its button, and Recommended puts it back; halted behind the first
 *     wall, gun A sees only the turret; past halfway the tanks come up;
 *     at the 500 m board the scenario is won, the debrief on the sign, and
 *     the enemy holds its fire; Stop takes the enemy away.
 */
async function theCombatScenario() {
  const combat = () => evalInApp('window.__combat.state()');
  const enemy = () => evalInApp('window.__enemy.state()');
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp('(window.__damage.repair(), true)');
  await menuButtonPress();
  await menuClick('menu-battle-start');
  const started = await waitFor('the scenario on, the guns in', () => {
    const c = combat();
    const e = enemy();
    const t = evalInApp('window.__drive.state()');
    return c.phase === 'on' && e.present.slice(0, 3).every(Boolean) && !e.present[3] && !e.present[4] && Math.hypot(t.x, t.z) < 1 && c;
  }, 10000).catch(() => combat());
  const briefing = await waitFor('the briefing on the sign', () => /^Advance to contact/.test(evalInApp('window.__combat.sign')) && evalInApp('window.__combat.sign'), 5000)
    .catch(() => evalInApp('window.__combat.sign'));
  check('Battle → Advance to contact → Start: the tank at the start with the guns in (the tanks not yet), and the briefing on the sign',
    started.phase === 'on' && !started.tanksIn && /^Advance to contact: reach the 500 m board/.test(briefing),
    `phase ${started.phase}, present ${enemy().present.join('/')}, sign "${briefing}"`);

  await menuButtonPress();
  // The menu lays out its page on the next frames, which can be slow with it open.
  await sleep(600);
  await menuClick('menu-tune-aim-0');
  const low = await waitFor('the enemy aiming worse', () => evalInApp('window.__enemy.tuning().aim') === 1.4 && combat().tune.aim === 1.4, 5000).catch(() => false);
  const lit = evalInApp('window.__gameMenu.selected("menu-tune-aim-0")') && !evalInApp('window.__gameMenu.selected("menu-tune-aim-1")');
  const line = evalInApp("window.__gameMenu.text('menu-tune-status')");
  await menuClick('menu-tune-reset');
  const back = await waitFor('the recommended tuning', () => evalInApp('window.__enemy.tuning().aim') === 1 && combat().tune.aim === 1, 5000).catch(() => false);
  check('Battle → Enemy accuracy → Low reaches the enemy and lights its button; Recommended puts it back',
    low !== false && lit && /enemy accuracy low/.test(line) && back !== false, `"${line}", lit ${lit}, back ${back !== false}`);
  await menuButtonPress();

  // Halted behind the first wall by the lane (LANE_WALLS in src/sim/terrain.ts, at z -135), gun A sees only the turret.
  evalInApp('(window.__drive.place(0, -135, 0), true)');
  const hullDown = await waitFor('gun A to see only the turret', () => { const g = enemy().guns[0]; return g.view === 'turret' && g; }, 5000).catch(() => enemy().guns[0]);
  check('Behind the wall by the lane, gun A sees only the turret (hull down)', hullDown.view === 'turret', `view ${hullDown.view}, spot ${hullDown.spot.toFixed(2)}`);

  // Past halfway, the tanks come up.
  evalInApp('(window.__drive.place(0, -262, 0), true)');
  const tanks = await waitFor('the tanks to come up', () => { const c = combat(); const e = enemy(); return c.tanksIn && e.present[3] && e.present[4] && c; }, 8000).catch(() => combat());
  check('Past halfway up the lane the enemy tanks come up', tanks.tanksIn && enemy().present[3], `tanks in ${tanks.tanksIn}, present ${enemy().present.join('/')}`);

  // At the 500 m board: won, the debrief, and the enemy holds its fire.
  evalInApp('(window.__drive.place(0, -486, 0), true)');
  const won = await waitFor('the scenario won', () => { const c = combat(); return c.phase === 'won' && c; }, 8000).catch(() => combat());
  const debrief = await waitFor('the debrief on the sign', () => /^Objective reached/.test(evalInApp('window.__combat.sign')) && evalInApp('window.__combat.sign'), 5000)
    .catch(() => evalInApp('window.__combat.sign'));
  const shots = enemy().shots;
  await sleep(4000);
  check('At the 500 m board the scenario is won, the debrief is on the sign and the enemy holds its fire',
    won.phase === 'won' && won.reached && /^Objective reached in \d+:\d\d\. \d of 5 enemies out/.test(debrief) && enemy().shots === shots,
    `phase ${won.phase}, sign "${debrief}", shots ${shots} → ${enemy().shots}, "${evalInApp("window.__gameMenu.text('menu-battle-status')")}"`);

  await menuButtonPress();
  await menuClick('menu-battle-stop');
  const stopped = await waitFor('the enemy gone', () => { const e = enemy(); const c = combat(); return !e.on && c.phase === 'off' && e; }, 5000).catch(() => enemy());
  check('Battle → Stop takes the enemy away', !stopped.on && combat().phase === 'off', `on ${stopped.on}, phase ${combat().phase}`);
  await menuButtonPress();
  evalInApp('(window.__damage.repair(), window.__drive.place(0, 0, 0), true)');
}

/**
 * 6x. The biathlon's driving challenge (F5.3d, docs/biathlon-driving.md):
 *     Practice → Obstacles → Ford seats a solo player as driver short of
 *     the ford with the engine running; both tillers full forward take the
 *     tank in too fast and the water drowns the engine, the sign saying so.
 *     Obstacles → Bridge parks the tank short of the treadway bridge
 *     (screenshot from the driver's eyes); set down off line over the ditch
 *     it falls and comes back to the bridge's start, the course's sign
 *     saying so. Obstacles → Slalom, then the tank moved straight down the
 *     middle line knocks a post down: drawn lying, a fault on the sign
 *     (screenshot). A track thrown puts up a sign and holds the tank.
 */
async function theDrivingChallenge() {
  const tank = () => evalInApp('window.__drive.state()');
  const course = () => evalInApp('window.__course.state()');
  iwsdk(['xr', 'set-device-state'], {});
  const layout = evalInApp('window.__course.layout()');
  check('The course has a slalom of 8 posts, a bridge and a Practice spot for each of its 5 obstacles',
    layout.posts.length === 8 && layout.bridge.length > 30 && Object.keys(layout.obstacles).length === 5,
    `${layout.posts.length} posts, bridge ${layout.bridge.length} m, obstacles ${Object.keys(layout.obstacles).join(', ')}`);

  // The ford: in too fast.
  await menuButtonPress();
  await menuClick('menu-obstacle-ford');
  const ford = layout.obstacles.ford;
  const parked = await waitFor('the tank parked short of the ford', () => {
    const t = tank();
    return Math.abs(t.x - ford.x) < 0.5 && Math.abs(t.z - ford.z) < 0.5 && t.running && evalInApp('window.__seats.mine') === 'driver' && t;
  }, 8000).catch(() => tank());
  check('Practice → Obstacles → Ford seats a solo player as driver short of the ford, the engine running',
    Math.abs(parked.x - ford.x) < 0.5 && Math.abs(parked.z - ford.z) < 0.5 && parked.running && evalInApp('window.__seats.mine') === 'driver',
    `tank at ${parked.x.toFixed(1)}, ${parked.z.toFixed(1)}, engine ${parked.running ? 'running' : 'off'}, seat ${evalInApp('window.__seats.mine')}`);
  evalInApp('(window.__drive.set({ left: 1, right: 1 }), true)');
  const drowned = await waitFor('the engine to drown in the ford', () => { const t = tank(); return !t.running && t; }, 40000).catch(() => tank());
  const drownSign = evalInApp('window.__drive.sign');
  evalInApp('(window.__drive.set(null), true)');
  check('Full ahead into the ford drowns the engine, and the sign says to ford slower',
    !drowned.running && drowned.stallCause === 'water' && /Drowned in the ford/.test(drownSign),
    `engine ${drowned.running ? 'running' : 'off'} (${drowned.stallCause}) at x ${drowned.x.toFixed(1)}, sign "${drownSign}"`);

  // The bridge: off line, it falls back to its start.
  await menuButtonPress();
  await menuClick('menu-obstacle-bridge');
  const start = layout.obstacles.bridge;
  await waitFor('the tank parked short of the bridge', () => { const t = tank(); return Math.abs(t.z - start.z) < 0.5 && t.running; }, 8000).catch(() => null);
  await sleep(500);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-bridge.png'], {});
  const falls = tank().falls;
  evalInApp(`(window.__drive.place(${layout.bridge.x + 0.9}, ${layout.bridge.z - 10}, ${start.heading}), true)`);
  const fell = await waitFor('the tank to fall and come back', () => {
    const t = tank();
    return t.falls === falls + 1 && Math.abs(t.z - start.z) < 0.5 && Math.abs(t.x - start.x) < 0.5 && t;
  }, 8000).catch(() => tank());
  const fallNote = await waitFor("the course's sign", () => /bridge/.test(evalInApp('window.__course.sign')) && evalInApp('window.__course.sign'), 4000)
    .catch(() => evalInApp('window.__course.sign'));
  check("Off line over the ditch the tank falls off the bridge and comes back to its start, the course's sign saying so",
    fell.falls === falls + 1 && Math.abs(fell.z - start.z) < 0.5 && /Fell off the bridge/.test(fallNote) && course().falls >= 1,
    `falls ${fell.falls - falls}, tank at ${fell.x.toFixed(1)}, ${fell.z.toFixed(1)}; sign "${fallNote}"`);

  // The slalom: straight down the middle line knocks a post.
  await menuButtonPress();
  await menuClick('menu-obstacle-slalom');
  const slalom = layout.obstacles.slalom;
  await waitFor('the tank parked short of the slalom', () => { const t = tank(); return Math.abs(t.x - slalom.x) < 0.5; }, 8000).catch(() => null);
  const standing = evalInApp('window.__course.posts()');
  // The first fault's sign, caught as it goes up (it stays 3 s, less than the hops take).
  let slalomSign = '';
  for (let x = slalom.x - 2; x >= layout.posts[0][0] - 12; x -= 2) {
    const frames = evalInApp('window.__course.frames');
    evalInApp(`(window.__drive.place(${x}, ${slalom.z}, ${slalom.heading}), true)`);
    await waitFor('a frame after the move', () => evalInApp('window.__course.frames') >= frames + 2, 10000).catch(() => null);
    if (slalomSign === '') slalomSign = evalInApp('window.__course.sign');
  }
  const knocked = course();
  const posts = evalInApp('window.__course.posts()');
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-slalom.png'], {});
  check('Driven straight down the slalom\'s middle line the tank knocks a post down: drawn lying, a fault counted and on the sign',
    standing.every((p) => !p.down) && knocked.faults >= 1 && knocked.knocked !== 0 && posts.some((p) => p.down) && /^Slalom: /.test(slalomSign),
    `faults ${knocked.faults}, posts down ${posts.filter((p) => p.down).length}, sign "${slalomSign}"`);

  // A thrown track: a sign for the crew, the tank held for the refit.
  evalInApp('(window.__drive.going({ thrown: 2, refit: 40 }), window.__drive.set({ left: 1, right: 1 }), true)');
  const held = await waitFor('the sign for the thrown track', () => /Right track thrown/.test(evalInApp('window.__drive.sign')) && tank(), 5000).catch(() => tank());
  await sleep(1500);
  const after = tank();
  evalInApp('(window.__drive.set(null), window.__drive.going({ thrown: 0, refit: 0 }), true)');
  check('A thrown track puts up a sign and holds the tank while the crew refit it',
    held.thrown === 2 && Math.abs(after.speed) < 0.3 && Math.hypot(after.x - held.x, after.z - held.z) < 0.5,
    `thrown ${held.thrown}, speed ${after.speed.toFixed(2)} m/s, moved ${Math.hypot(after.x - held.x, after.z - held.z).toFixed(2)} m`);
  evalInApp("(window.__drive.reset(), window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6o. The callout card (F2.6): a card hangs on the hull's left wall beside
 *     the driver and on the turret's front wall in front of the gunner,
 *     each facing its seat, with the Calls' words on it; the game menu's
 *     Sound and view → Callout card → Off hides both and On brings them back.
 */
async function theCalloutCard() {
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp("(window.__seats.ask('driver'), true)");
  await waitFor("the driver's seat", () => evalInApp('window.__seats.mine') === 'driver', 5000).catch(() => null);
  const cards = evalInApp(`(() => {
    const c = window.__calloutCard;
    return { shown: c.shown(), driver: c.face('driver'), gunner: c.face('gunner'), say: c.text('driver').say, hear: c.text('driver').hear,
      driverEye: window.__seats.eye('driver'), gunnerEye: window.__seats.eye('gunner') };
  })()`);
  const towards = (face, eye) => {
    const d = face.at.map((v, i) => eye[i] - v);
    const length = Math.hypot(...d);
    return { length, cos: d.reduce((sum, v, i) => sum + v * face.normal[i], 0) / length };
  };
  const driverSees = towards(cards.driver, cards.driverEye);
  const gunnerSees = towards(cards.gunner, cards.gunnerEye);
  check("A callout card hangs in each seat facing it: the driver's on the left wall, the gunner's on the turret's front wall",
    cards.shown && cards.driver.normal[0] > 0.99 && cards.driver.at[0] < -1.05 && driverSees.length > 0.5 && driverSees.length < 0.7 && driverSees.cos > 0.6
      && gunnerSees.length > 1 && gunnerSees.length < 1.35 && gunnerSees.cos > 0.6
      && cards.hear.includes('Driver, halt') && cards.say.includes('Gunner, hold fire'),
    `driver's ${driverSees.length.toFixed(2)} m away at ${fmt(cards.driver.at)}, facing ${fmt(cards.driver.normal)}; gunner's ${gunnerSees.length.toFixed(2)} m away; says ${cards.say.length}, hears ${cards.hear.length}`);
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(cards.driver.at) });
  await sleep(800);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-callout-card.png'], {});

  iwsdk(['xr', 'set-device-state'], {});
  await menuButtonPress();
  await menuClick('row-card-1');
  const hidden = await waitFor('the cards to hide', () => evalInApp('window.__calloutCard.shown()') === false, 5000).catch(() => false);
  const offLit = evalInApp('window.__gameMenu.selected("row-card-1")');
  await menuClick('row-card-0');
  const back = await waitFor('the cards to show', () => evalInApp('window.__calloutCard.shown()'), 5000).catch(() => false);
  check('Sound and view → Callout card → Off hides both cards, On shows them again',
    hidden !== false && offLit && back === true && evalInApp('window.__settings.card') === true,
    `hidden ${hidden !== false} (Off lit ${offLit}), back ${back === true}`);
  if (evalInApp('window.__gameMenu.open')) await menuButtonPress();
}

/**
 * Part 3: loading and firing, the test range, the gunsight, the tank's
 * sounds, the range run, comfort and stats, the driver's turret dial and
 * the callout card.
 */
async function partThree() {
  // 6g. Loading and firing (F1.10).
  await loadingAndFiring();

  // 6h. The test range (F1.7).
  await theTestRange();

  // 6i. The gunsight (F1.9).
  await layingWithTheSight();

  // 6j. The tank's sounds (F1.12).
  await tankSounds();
  // 6k. The range run (F1.11).
  await theRangeRun();

  // 6m. Comfort and stats (F1.14).
  await comfortAndStats();

  // 6n. The driver's turret position dial (F2.3).
  await theTurretDial();

  // 6o. The callout card (F2.6).
  await theCalloutCard();

  // 6p. The firing lamp (F2.5).
  await theFiringLamp();

  // 6q. The biathlon course (F5.3a).
  await theBiathlonCourse();
}

/**
 * 6q. The biathlon course (F5.3a): Practice → Biathlon → Course puts a
 *     solo player in the driver's seat parked short of the start line
 *     (screenshot from the driver's eyes); moving the tank up the course a
 *     few metres a frame crosses the start line (Lap 1: go! on the sign)
 *     and the first two gates, which the menu's line counts; Line 1 puts
 *     the player in the gunner's seat halted in firing box 1 with the
 *     engine running, and a shell laid on a line 1 board hits it.
 */
async function theBiathlonCourse() {
  const course = () => evalInApp('window.__course.state()');
  const tank = () => evalInApp('window.__drive.state()');
  iwsdk(['xr', 'set-device-state'], {});
  const layout = evalInApp('window.__course.layout()');
  check('The course is a loop of about 800 m with 7 gates, 2 firing boxes, 6 boards and a penalty loop of about 150 m',
    layout.length > 780 && layout.length < 830 && layout.gates.length === 7 && layout.boxes.length === 2 && layout.boards.length === 6 &&
      layout.penalty > 140 && layout.penalty < 170,
    `${Math.round(layout.length)} m, ${layout.gates.length} gates, ${layout.boxes.length} boxes, ${layout.boards.length} boards, penalty loop ${Math.round(layout.penalty)} m`);

  await menuButtonPress();
  await menuClick('menu-course-go');
  const parked = await waitFor('the tank parked on the course', () => {
    const t = tank();
    return Math.abs(t.x - 320) < 0.5 && Math.abs(t.z + 225) < 0.5 && evalInApp('window.__seats.mine') === 'driver' && t;
  }, 8000).catch(() => tank());
  await sleep(500);
  const before = course();
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-course.png'], {});
  check('Practice → Biathlon → Course seats a solo player as driver, parked on the course short of the start line, no lap started',
    Math.abs(parked.x - 320) < 0.5 && Math.abs(parked.z + 225) < 0.5 && Math.abs(parked.heading) < 0.01 && !before.started && before.laps === 0 &&
      evalInApp('window.__seats.mine') === 'driver' && /^Cross the start line/.test(before.line),
    `tank at ${parked.x.toFixed(1)}, ${parked.z.toFixed(1)}, seat ${evalInApp('window.__seats.mine')}, "${before.line}"`);

  // Up the course a few metres a frame (each move short of a jump), across the start line and past gates 1 and 2.
  const hop = async (s) => {
    const p = evalInApp(`window.__course.pointAt(${s})`);
    const frames = evalInApp('window.__course.frames');
    evalInApp(`(window.__drive.place(${p.x}, ${p.z}, ${p.heading}), true)`);
    await waitFor('a frame after the move', () => evalInApp('window.__course.frames') >= frames + 2, 10000).catch(() => null);
  };
  await hop(-3);
  await hop(5);
  const started = course();
  const sign = evalInApp('window.__course.sign');
  check('Crossing the start line starts lap 1, with a sign saying so',
    started.started && started.laps === 0 && started.note === 'Lap 1: go!' && sign === 'Lap 1: go!',
    `started ${started.started}, note "${started.note}", sign "${sign}"`);
  // Gate 2 is on the hill's crest (F5.3d), past the slalom (whose posts the hops knock down).
  for (let s = 15; s <= 220; s += 10) await hop(s);
  await menuButtonPress();
  const line = await waitFor("the menu's course line", () => {
    const text = evalInApp("window.__gameMenu.text('menu-course-status')");
    return /gates 2 of 6/.test(text) && text;
  }, 5000).catch(() => evalInApp("window.__gameMenu.text('menu-course-status')"));
  check('Driving on past gates 1 and 2 counts them, and the menu\'s Biathlon line says so', /^Lap 1 \d+:\d\d\.\d: gates 2 of 6/.test(line), `"${line}"`);

  // Line 1: the gunner's seat, halted in box 1, the engine running for the power traverse.
  await menuClick('menu-course-line-0');
  const inBox = await waitFor('halted in firing box 1', () => { const c = course(); return c.box === 0 && c.halted && evalInApp('window.__seats.mine') === 'gunner' && c; }, 8000)
    .catch(() => course());
  const engine = tank();
  check('Practice → Biathlon → Line 1 seats a solo player as gunner, halted in firing box 1 with the engine running; the progress starts again',
    inBox.box === 0 && inBox.halted && !inBox.started && engine.running && evalInApp('window.__seats.mine') === 'gunner',
    `box ${inBox.box + 1}, halted ${inBox.halted}, started ${inBox.started}, engine ${engine.running ? 'running' : 'off'}, seat ${evalInApp('window.__seats.mine')}`);
  evalInApp('(window.__firing.aimAt(3), true)');
  const predicted = await waitFor('the gun laid on the line 1 left board', () => { const p = evalInApp('window.__firing.predict()'); return p.target === 3 && p; }, 8000)
    .catch(() => evalInApp('window.__firing.predict()'));
  await sleep(400);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-course-line.png'], {});
  const shots = evalInApp('window.__firing.records().length');
  evalInApp('(window.__firing.fire(), true)');
  const shot = await waitFor('the shot at the board to land', () => {
    const r = evalInApp('window.__firing.records()');
    return r.length === shots + 1 && evalInApp('window.__firing.flying()') === 0 && r.at(-1);
  }, 5000).catch(() => evalInApp('window.__firing.records()').at(-1));
  check("A shell laid on a line 1 board from firing box 1 (its lane at 6 o'clock) hits it, the course's boards being among the gun's targets",
    predicted.target === 3 && shot?.kind === 'target' && shot.target === 3 && shot.line === 'Hit: the line 1 left board' && evalInApp('window.__firing.hits()')[3] >= 1,
    `would: ${predicted.line}; shot: ${shot?.line}`);
  // Only the black disc counts: laid on the white at the corner of the old square hit box, a miss.
  const fireOnce = async (what) => {
    const n = evalInApp('window.__firing.records().length');
    evalInApp('(window.__firing.fire(), true)');
    return waitFor(what, () => {
      const r = evalInApp('window.__firing.records()');
      return r.length === n + 1 && evalInApp('window.__firing.flying()') === 0 && r.at(-1);
    }, 5000).catch(() => evalInApp('window.__firing.records()').at(-1));
  };
  evalInApp("(window.__firing.aimAt(3, 'ap', 0.55, 0.55), true)");
  await sleep(300);
  const white = await fireOnce('the shot at the white to land');
  check('A shell through the board\'s white, outside its black disc, misses it',
    white?.kind !== 'target' && /^Miss the line 1 left board/.test(white?.line ?? ''), `shot: ${white?.line}`);
  // The gun's scatter (on for this check): two rounds on one lay land apart, both close to it.
  evalInApp('(window.__firing.scatter(true), window.__firing.aimAt(3), true)');
  await sleep(300);
  const first = await fireOnce('the first scattered shot');
  const second = await fireOnce('the second scattered shot');
  evalInApp('(window.__firing.scatter(false), true)');
  const apart = first && second ? Math.hypot(first.point[0] - second.point[0], first.point[1] - second.point[1], first.point[2] - second.point[2]) : NaN;
  check("With the gun's scatter on, two rounds laid alike on a board 400 m off land apart, within a metre or so of each other",
    apart > 0.002 && apart < 1.5, `${apart.toFixed(3)} m apart: ${first?.line}; ${second?.line}`);
  await menuButtonPress();
  evalInApp("(window.__drive.reset(), window.__turret.forward(), window.__seats.ask('driver'), true)");
  iwsdk(['xr', 'set-device-state'], {});
}

/**
 * 6n. The driver's turret position dial (F2.3): Practice → Lay the gun →
 *     To 3 o'clock puts the player in the driver's seat and the turret
 *     turns itself there, the dial's pointer turning with it; it stops at
 *     3 o'clock and the dial reads 3 (screenshot from the driver's eyes);
 *     Forward brings both back to 12.
 */
async function theTurretDial() {
  const dial = () => evalInApp('window.__turretDial.state()');
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp('(window.__turret.set(null), window.__turret.forward(), true)');
  await sleep(300);
  await menuButtonPress();
  await menuClick('menu-turret-dial');
  const turning = await waitFor('the turret turning by itself', () => { const s = dial(); return s.traversing && s.turretDeg < -5 && s; }, 8000).catch(() => dial());
  const seated = evalInApp('({ seat: window.__seats.mine, sign: window.__turret.sign })');
  check("Practice → Lay the gun → To 3 o'clock puts the player in the driver's seat, and the turret turns by itself with the dial's pointer on it",
    seated.seat === 'driver' && turning.traversing && turning.turretDeg < -5 && Math.abs(turning.pointerDeg - turning.turretDeg) < 1 && seated.sign.startsWith('Turret to 3'),
    `seat ${seated.seat}, turret ${turning.turretDeg.toFixed(1)}°, pointer ${turning.pointerDeg.toFixed(1)}°, sign "${seated.sign}"`);
  const there = await waitFor("the turret at 3 o'clock", () => { const s = dial(); return !s.traversing && s.hour === 3 && s; }, 20000).catch(() => dial());
  check("The turret stops at 3 o'clock and the driver's dial reads 3, its pointer to the right",
    !there.traversing && there.hour === 3 && Math.abs(there.turretDeg + 90) < 0.1 && Math.abs(there.pointerDeg + 90) < 0.1,
    `turret ${there.turretDeg.toFixed(2)}°, pointer ${there.pointerDeg.toFixed(2)}°, reads ${there.hour} o'clock`);
  const eye = evalInApp('window.__seats.eye("driver")');
  const at = evalInApp('window.__turretDial.at');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin(eye) });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([(eye[0] + at[0]) / 2, at[1], at[2]]) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-turret-dial.png'], {});
  iwsdk(['xr', 'set-device-state'], {});
  await menuButtonPress();
  await menuClick('menu-turret-forward');
  await menuButtonPress();
  const home = await waitFor('the turret forward', () => { const s = dial(); return s.hour === 12 && Math.abs(s.pointerDeg) < 0.1 && s; }, 8000).catch(() => dial());
  check('Practice → Lay the gun → Forward brings the turret back and the dial reads 12', home.hour === 12 && Math.abs(home.pointerDeg) < 0.1,
    `turret ${home.turretDeg.toFixed(2)}°, pointer ${home.pointerDeg.toFixed(2)}°`);
}

/**
 * 6p. The firing lamp (F2.5): Practice → Ready to fire → Driver's lamp puts
 *     the player in the driver's seat with the gun laid and loaded, and the
 *     lamp on the slit's frame lights at once (screenshot from the driver's
 *     eyes); the pretend gunner fires about 3 s later, the lamp flashes and
 *     goes dark with the breech open. Then, as gunner, the repeater right of
 *     the gunsight (screenshot), and a hand on the power grip seen as the
 *     gunner's hand on a trigger, which with the breech open leaves it dark.
 */
async function theFiringLamp() {
  const lamp = () => evalInApp('window.__firingLamp.state()');
  iwsdk(['xr', 'set-device-state'], {});
  evalInApp('(window.__turret.set(null), window.__turret.forward(), true)');
  await sleep(300);
  await menuButtonPress();
  await menuClick('menu-ready-lamp');
  const lit = await waitFor('the firing lamp lit', () => { const s = lamp(); return s.look === 'lit' && s; }, 15000).catch(() => lamp());
  const litAt = Date.now();
  const seated = evalInApp('({ seat: window.__seats.mine, sign: window.__turret.sign })');
  check("Practice → Ready to fire → Driver's lamp seats the player as driver with the gun loaded, and the firing lamp lights at once",
    seated.seat === 'driver' && lit.look === 'lit' && lit.loaded && lit.practice && lit.practiceFire && seated.sign.startsWith('Gun ready'),
    `seat ${seated.seat}, lamp ${JSON.stringify(lit)}, sign "${seated.sign}"`);
  const eye = evalInApp('window.__seats.eye("driver")');
  const at = evalInApp('window.__firingLamp.at()');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin(eye) });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin([at.driver[0], (eye[1] + at.driver[1]) / 2, at.driver[2]]) });
  await sleep(300);
  if (lamp().look === 'lit') iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-firing-lamp.png'], {});
  const fired = await waitFor('the pretend gunner to fire and the lamp to flash', () => { const s = lamp(); return s.flashes > lit.flashes && s; }, 15000).catch(() => null);
  const firedAfter = (Date.now() - litAt) / 1000;
  // Past the whole flash sequence, not in the dark gap between two flashes (each lasts several frames on a slow runner).
  const dark = await waitFor('the lamp dark after its flashes', () => { const s = lamp(); return !s.flashing && s.look === 'dark' && !s.loaded && s; }, 8000).catch(() => lamp());
  check('Alone, the pretend gunner fires: the lamp flashes at the shot, then goes dark with the breech open',
    fired !== null && firedAfter > 2 && !dark.practiceFire && !dark.flashing && dark.look === 'dark' && !dark.loaded && !dark.practice,
    `${fired ? `fired ${firedAfter.toFixed(1)} s after the lamp lit` : 'never fired'}, then ${JSON.stringify(dark)}`);

  evalInApp("(window.__seats.ask('gunner'), window.__firingLamp.holdGrip(true), true)");
  const gripped = await waitFor("the gunner's hand on the power grip", () => { const s = lamp(); return s.handOnTrigger && s; }, 10000).catch(() => lamp());
  const gunnerEye = evalInApp('window.__seats.eye("gunner")');
  const repeater = evalInApp('window.__firingLamp.at().gunner');
  iwsdk(['xr', 'set-transform'], { device: 'headset', position: toOrigin(gunnerEye) });
  iwsdk(['xr', 'look-at'], { device: 'headset', target: toOrigin(repeater) });
  await sleep(300);
  iwsdk(['browser', 'screenshot', '--output-file', 'artifacts/xr-firing-lamp-repeater.png'], {});
  evalInApp('(window.__firingLamp.holdGrip(false), true)');
  const letGo = await waitFor('the hand off the grip', () => { const s = lamp(); return !s.handOnTrigger && s; }, 10000).catch(() => lamp());
  check("A gunner's hand on the power grip counts as a hand on the trigger, but with the breech open the lamp stays dark",
    gripped.handOnTrigger && gripped.look === 'dark' && !gripped.ready && !letGo.handOnTrigger,
    `holding ${JSON.stringify(gripped)}, let go ${JSON.stringify(letGo)}`);
  iwsdk(['xr', 'set-device-state'], {});
}

/** Every part ends with these: the perf log, PC VR without the frame-rate API, and the console. */
async function lastChecks() {
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
  // Stopped by the browser, not by a failed check: CI may run it again.
  const retry = error.stalled === true && results.every((r) => r.pass);
  if (retry) console.error(`The emulated browser stopped answering after ${results.length} passed checks (exit ${STALLED}).`);
  if (process.env.GITHUB_ACTIONS) {
    const title = retry ? 'XR test stopped: the emulated browser stopped answering' : 'XR test aborted';
    console.log(`::${retry ? 'warning' : 'error'} title=${title}::${error.message}`.replace(/\r?\n/g, ' '));
  }
  process.exitCode = retry ? STALLED : 1;
});

