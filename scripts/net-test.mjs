#!/usr/bin/env node
/**
 * Two-player network test (spike S4). Builds nothing itself: run `npm run
 * build` first. Starts the local lobby and `vite preview` (which proxies
 * /parties to the lobby), opens the game in two separate browser profiles,
 * joins both to one crew, and checks:
 *
 * - both reach "connected" over a direct WebRTC data channel;
 * - a third player is turned away (two-player crews);
 * - a pose sent by one arrives intact at the other, fingers too;
 * - the crewmate moves smoothly while the sender walks in a circle;
 * - the same at about 150 ms RTT with jitter and 1% loss (simulated);
 * - when the host leaves, the other player becomes host and can be rejoined;
 * - voice (spike S5): Chromium's fake microphone (a periodic beep) reaches the
 *   crewmate, muting silences it, and the loopback route starts;
 * - seats (F1.1): the host sits in the driver's seat and the guest in the
 *   gunner's; asking for the other seat asks the crewmate, and both swap
 *   once they agree (F1.2), decided by the host, and each draws the crewmate's legs in the crewmate's seat, on
 *   a clean link and at 150 ms RTT;
 * - the tank drive (F1.4): a guest driver drives the host's tank, both see
 *   it move and stop the same, and the host driving shows on the guest, on
 *   a clean link and at 150 ms RTT;
 * - the turret (F1.8): the gunner's page traverses and elevates at once and
 *   the driver's page draws it close behind, smoothly, on a clean link and
 *   at 150 ms RTT; the gunsight's Practice lay (F1.9) from the driver's
 *   page lays the gunner's gun on a target;
 * - loading and firing (F1.10): a guest gunner's loading reaches the host,
 *   and its shot is seen on both pages and decided by the host, on a clean
 *   link and at 150 ms RTT;
 * - the crew lifecycle (spike S10): stepping away, going quiet and a broken
 *   connection;
 * - the practice crewmate sits in the seat the player leaves free; as
 *   gunner it loads, lays and hits the nearest target, and as driver it
 *   follows the player's calls through the tillers (F1.13).
 *
 * Add a check for each feature that two players share (see the building
 * skill in .claude/skills/): what the guest does reaches the host, and both
 * see the host's result, on a clean link and at 150 ms RTT.
 *
 * Writes measured RTT, packet rate and route to artifacts/net-report.json.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const LOBBY_PORT = 8787;
const PREVIEW_PORT = 4173;
// The IWSDK Vite plugin serves HTTPS with a local development certificate.
const BASE = `https://localhost:${PREVIEW_PORT}/`;
// No perf HUD, and no ground: software rendering of the drive's ground
// halves the frame rate the motion checks sample (docs/testing.md).
const QUIET = 'hud=0&ground=0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!pass && process.env.GITHUB_ACTIONS) {
    console.log(`::error title=Net check failed::${name}${detail ? ` (${detail})` : ''}`.replace(/\r?\n/g, ' '));
  }
}

const children = [];
function start(command, args, readyText) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, detached: true });
    children.push(child);
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${command} ${args.join(' ')} did not start:\n${output}`)), 30000);
    const onData = (data) => {
      output += data;
      if (output.includes(readyText)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`${command} exited with ${code}:\n${output}`)));
  });
}

async function waitFor(label, fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}

const state = (page) => page.evaluate(() => window.__net?.session.state ?? 'loading');

async function openPlayer(browser, query, initScript) {
  // A small window keeps software rendering of four pages fast enough for the
  // frame-by-frame motion checks.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 320, height: 200 } });
  const page = await context.newPage();
  if (initScript) {
    await page.addInitScript(initScript);
  }
  if (process.env.THROTTLE) {
    // Slow the page's CPU, to see how the timing checks fare on a slow CI runner.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  }
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (/^\[(Net|Seat|Bot|Drive)\]/.test(m.text())) console.log(`    ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?${QUIET}&${query}`);
  await waitFor('the game to load', async () => (await state(page)) !== 'loading', 60000);
  return { context, page, errors };
}

/**
 * Sender walks its head around a 0.5 m circle at 1 rad/s; the receiver
 * records what it draws each frame. A visible backward step reads as judder.
 */
async function measureMotion(sender, receiver, seconds) {
  await sender.page.evaluate(() => {
    const pose = {
      head: { px: 0, py: 1.6, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
      left: { px: -0.2, py: 1.1, pz: -0.3, qx: 0, qy: 0, qz: 0, qw: 1 },
      right: { px: 0.2, py: 1.1, pz: -0.3, qx: 0, qy: 0, qz: 0, qw: 1 },
      flags: 3,
    };
    const t0 = performance.now();
    // Evaluated at send time, so each packet's timestamp matches its pose.
    window.__net.setTestPose((now) => {
      const t = (now - t0) / 1000;
      pose.head.px = 0.5 * Math.cos(t);
      pose.head.pz = 0.5 * Math.sin(t);
      return pose;
    });
  });
  await new Promise((r) => setTimeout(r, 600)); // fill the jitter buffer
  // Until then the receiver can still be drawing its way from the last pose
  // onto the circle: on a slow runner with 150 ms RTT, 600 ms isn't always
  // enough. Start once three frames in a row are on the circle (or after 3 s).
  await receiver.page.evaluate(
    () =>
      new Promise((resolve) => {
        let onCircle = 0;
        const end = performance.now() + 3000;
        const frame = () => {
          const p = window.__net.remotePose();
          onCircle = p && Math.abs(Math.hypot(p.head.px, p.head.pz) - 0.5) < 0.01 ? onCircle + 1 : 0;
          if (onCircle >= 3 || performance.now() > end) resolve();
          else requestAnimationFrame(frame);
        };
        frame();
      }),
  );
  const samples = await receiver.page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        const end = performance.now() + ms;
        const frame = () => {
          const p = window.__net.remotePose();
          if (p) out.push([p.head.px, p.head.pz, performance.now(), window.__net.remoteAtMs]);
          if (performance.now() < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        frame();
      }),
    seconds * 1000,
  );
  // Angle along the circle for each drawn frame; it should only ever advance,
  // at an even speed (1 rad/s) against the time the drawn pose describes.
  // That time, not when this callback ran: the test's frame callback can run
  // before or after the game's in a frame, and on a slow page frames take
  // 100 ms or more, so callback times would make even motion look jerky.
  const angles = samples.map(([x, z]) => Math.atan2(z, x));
  let backwards = 0;
  const backSteps = [];
  let maxRate = 0;
  let maxGapMs = 0;
  const rates = [];
  let last = 0;
  for (let i = 1; i < angles.length; i++) {
    let d = angles[i] - angles[last];
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    // Ignore backward steps under 15 mm: a sender frame hitch or a lost packet
    // can make the brief extrapolation overshoot by about a centimetre.
    if (d < -0.03) {
      backwards++;
      backSteps.push(`${i}:${d.toFixed(4)}`);
    }
    const dt = samples[i][3] - samples[last][3];
    maxGapMs = Math.max(maxGapMs, samples[i][2] - samples[i - 1][2]);
    if (dt < 8) continue; // the same game frame read twice; measure over the next
    rates.push((d * 1000) / dt);
    maxRate = Math.max(maxRate, (d * 1000) / dt);
    last = i;
  }
  const radiusError = Math.max(...samples.map(([x, z]) => Math.abs(Math.hypot(x, z) - 0.5)));
  rates.sort((a, b) => a - b);
  const median = rates[Math.floor(rates.length / 2)] ?? 0;
  return { frames: samples.length, backwards, backSteps, maxRate, median, maxGapMs, radiusError };
}

/** Loudest level of the crewmate's voice over `ms`. */
function peakVoiceLevel(page, ms) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let peak = 0;
        const end = performance.now() + duration;
        const tick = () => {
          peak = Math.max(peak, window.__net.voice.remoteLevel());
          if (performance.now() < end) setTimeout(tick, 10);
          else resolve(peak);
        };
        tick();
      }),
    ms,
  );
}

/**
 * Wait until pose packets flow both ways. A freshly loaded page connects
 * before its first frames, so on a slow runner it can be seconds before it
 * sends poses or picks anything up.
 */
async function waitForPoses(pages, count = 30) {
  const received = () => Promise.all(pages.map((p) => p.page.evaluate(() => window.__net.received)));
  const start = await received();
  await waitFor('pose packets both ways', async () => (await received()).every((n, i) => n - start[i] >= count), 20000);
}

/**
 * Where each seat's crewmate's hips are drawn, hull space: the seat's
 * cushion plus hipPoint's offset (src/sim/cabin.ts), the gunner's turned
 * with the turret (facing forward until F1.8) about its ring at z = 0.2.
 */
const HIPS = { driver: [-0.5, 0.63, -1.41], gunner: [0.4, 1.43, 0.16] };

/**
 * Seats (F1.1): the host decides. The host keeps the seat they had
 * (`hostSeat`: the driver's for a new crew) and the guest gets the other;
 * the guest asks for the host's seat from the game menu, the host agrees
 * and both swap (F1.2); each draws the crewmate's legs at the crewmate's
 * seat. Then the host asks to swap back and the guest agrees.
 */
async function seatChecks(host, guest, label, hostSeat = 'driver') {
  const other = { driver: 'gunner', gunner: 'driver' };
  const ids = { driver: 'row-seat-0', gunner: 'row-seat-1' };
  const seats = () => Promise.all([host, guest].map((p) => p.page.evaluate(() => ({
    mine: window.__seats.mine,
    crew: window.__seats.crew,
    legs: window.__debug.world.scene.getObjectByName('Crew 2 Legs')?.position.toArray(),
  }))));
  const legsAt = (s, seat) => s.legs !== undefined && Math.hypot(...s.legs.map((v, i) => v - HIPS[seat][i])) < 0.01;
  const seated = (hostSeat, guestSeat) => waitFor(`the host in the ${hostSeat}'s seat and the guest in the ${guestSeat}'s`, async () => {
    const [h, g] = await seats();
    return h.mine === hostSeat && h.crew === guestSeat && g.mine === guestSeat && g.crew === hostSeat && legsAt(h, guestSeat) && legsAt(g, hostSeat) ? [h, g] : null;
  }, 8000).catch(() => null);
  const start = await seated(hostSeat, other[hostSeat]);
  check(`The host sits in the ${hostSeat}'s seat and the guest in the other, each sees the other's legs in their seat (${label})`,
    start !== null, JSON.stringify(start ?? await seats()));
  // A swap needs both players (F1.2): the guest asks, the host's page says so, and nothing moves until the host agrees.
  const swaps = () => Promise.all([host, guest].map((p) => p.page.evaluate(() => ({ swap: window.__seats.swap, sign: window.__seats.swapSign, button: window.__gameMenu.text('menu-swap'), mine: window.__seats.mine }))));
  await guest.page.evaluate((id) => window.__gameMenu.click(id), ids[hostSeat]);
  const offered = await waitFor('the host to hear the guest\'s ask', async () => {
    const [h, g] = await swaps();
    // The menu redraws on its next frame.
    return h.swap === 'offered' && g.swap === 'asked' && h.button === 'Agree to swap' ? [h, g] : null;
  }, 8000).catch(() => null);
  const unmoved = offered && offered[0].mine === hostSeat && offered[1].mine === other[hostSeat];
  check(`The guest asking for the host's seat asks the host, who is told how to agree, and nobody moves yet (${label})`,
    offered !== null && unmoved && offered[0].button === 'Agree to swap' && offered[0].sign.startsWith('Your crewmate asks to swap seats') && offered[1].button === 'Asked...',
    JSON.stringify(offered ?? await swaps()));
  await host.page.evaluate(() => window.__gameMenu.click('menu-swap'));
  const swapped = await seated(other[hostSeat], hostSeat);
  const cleared = (await swaps()).every((s) => s.swap === 'none');
  check(`When the host agrees, both players swap (${label})`, swapped !== null && cleared, JSON.stringify(swapped ?? await seats()));
  // And the other way round: the host asks, the guest agrees from the menu's Swap seats.
  // The host now sits in the guest's old seat: they ask for their own back.
  await host.page.evaluate((id) => window.__gameMenu.click(id), ids[hostSeat]);
  const asked = await waitFor('the guest to hear the host\'s ask', async () => {
    const [h, g] = await swaps();
    return h.swap === 'asked' && g.swap === 'offered' ? [h, g] : null;
  }, 8000).catch(() => null);
  await guest.page.evaluate(() => window.__gameMenu.click('menu-swap'));
  const back = await seated(hostSeat, other[hostSeat]);
  check(`The host asking to swap back waits for the guest, who agrees, and both swap back (${label})`, asked !== null && back !== null,
    JSON.stringify(back ?? asked ?? await seats()));
}

/**
 * The tank drive (F1.4): the host runs the tank whichever seat it sits in.
 * The guest takes the driver's seat (the host agreeing to the swap) and drives with both tillers forwards;
 * the host's tank pulls away and the guest draws it moving smoothly close
 * behind; let go, both see it stop at the same spot; the guest's Back to
 * start parks it. Then the host drives and the guest sees it move. Seats
 * go back as they were. `host` drives first from the driver's seat.
 */
async function driveChecks(host, guest, label) {
  const tank = (p) => p.page.evaluate(() => window.__drive.state());
  // The host's word on the seats first (a fresh crew): the host drives, the guest gunner.
  await waitFor('the host in the driver\'s seat', async () => (await host.page.evaluate(() => window.__drive.driver())) === 'me'
    && (await guest.page.evaluate(() => window.__drive.driver())) === 'crew', 8000);
  // A swap needs both (F1.2): the guest asks, the host agrees.
  await guest.page.evaluate(() => window.__gameMenu.click('row-seat-0'));
  await waitFor('the host to hear the ask', async () => (await host.page.evaluate(() => window.__seats.swap)) === 'offered', 8000);
  await host.page.evaluate(() => window.__gameMenu.click('menu-swap'));
  await waitFor('the guest in the driver\'s seat', async () => (await guest.page.evaluate(() => window.__drive.driver())) === 'me'
    && (await host.page.evaluate(() => window.__drive.driver())) === 'crew', 8000);
  await host.page.evaluate(() => window.__drive.reset());
  await guest.page.evaluate(() => window.__drive.set({ left: 1, right: 1 }));
  const going = await waitFor('the host\'s tank to pull away', async () => {
    const [h, g] = await Promise.all([tank(host), tank(guest)]);
    return h.speed > 2 && g.speed > 1.5 ? { h, g } : null;
  }, 15000).catch(() => null);
  const ahead = going ? Math.abs(going.h.z - going.g.z) : NaN;
  check(`The guest driver's tillers drive the host's tank, and the guest sees it move close behind (${label})`,
    going !== null && going.h.z < -1 && ahead < going.h.speed * 0.6 + 0.3,
    going ? `host at ${going.h.speed.toFixed(1)} m/s, z ${going.h.z.toFixed(2)}; guest draws ${going.g.speed.toFixed(1)} m/s, z ${going.g.z.toFixed(2)}` : JSON.stringify(await Promise.all([tank(host), tank(guest)])));
  // The driver's station (F1.5): the host's page draws the guest's tillers forwards.
  const hostSees = await waitFor('the host to draw the guest\'s tillers', async () => {
    const st = await host.page.evaluate(() => window.__driverStation.state());
    return st.angles.tillerLeft > 20 && st.angles.tillerRight > 20 ? st : null;
  }, 5000).catch(() => null);
  check(`The host's page draws the guest driver's tillers where the guest pushed them (${label})`, hostSees !== null,
    hostSees ? `${hostSees.angles.tillerLeft.toFixed(1)}° and ${hostSees.angles.tillerRight.toFixed(1)}°` : JSON.stringify(await host.page.evaluate(() => window.__driverStation.state().angles)));
  // The periscope (F1.6): the guest driver's page owns it; the host's page draws it turned the same way, and the host's Ahead asks the guest's page.
  const periscope = (p) => p.page.evaluate(() => window.__periscope.state());
  await guest.page.evaluate(() => window.__periscope.turn(60));
  const scoped = await waitFor('the host to draw the guest\'s periscope turned', async () => {
    const [h, g] = await Promise.all([periscope(host), periscope(guest)]);
    return g.owner && !h.owner && Math.abs(h.angleDeg - 60) < 0.5 && Math.abs(g.angleDeg - 60) < 0.01 ? { h, g } : null;
  }, 5000).catch(() => null);
  check(`The host's page draws the guest driver's periscope turned where the guest turned it (${label})`, scoped !== null,
    scoped ? `${scoped.h.angleDeg.toFixed(2)}° for the driver's ${scoped.g.angleDeg.toFixed(2)}°, ${scoped.h.received} packets` : JSON.stringify(await Promise.all([periscope(host), periscope(guest)])));
  await host.page.evaluate(() => window.__gameMenu.click('menu-periscope-ahead'));
  const scopeAhead = await waitFor('both periscopes ahead', async () => {
    const [h, g] = await Promise.all([periscope(host), periscope(guest)]);
    return Math.abs(g.angleDeg) < 0.01 && Math.abs(h.angleDeg) < 0.5 ? h : null;
  }, 5000).catch(() => null);
  check(`The gunner's Practice → Periscope → Ahead turns the driver's periscope ahead on both pages (${label})`, scopeAhead !== null,
    scopeAhead ? '' : JSON.stringify(await Promise.all([periscope(host), periscope(guest)])));
  // How smoothly the guest draws it: the distance driven, frame by frame, never goes back or jumps.
  const steps = await guest.page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const end = performance.now() + 2000;
    const frame = () => {
      out.push(window.__drive.state().odometer);
      if (performance.now() < end) requestAnimationFrame(frame);
      else resolve(out);
    };
    requestAnimationFrame(frame);
  }));
  const deltas = steps.slice(1).map((v, i) => v - steps[i]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const backwards = deltas.filter((d) => d < -1e-4).length;
  const biggest = sorted.at(-1) ?? 0;
  check(`The guest draws the moving tank smoothly (${label})`, deltas.length >= 10 && backwards === 0 && biggest < Math.max(0.05, median * 5),
    `${deltas.length} frames, ${backwards} backward steps, median ${(median * 100).toFixed(1)} cm, largest ${(biggest * 100).toFixed(1)} cm a frame`);
  await guest.page.evaluate(() => window.__drive.set(null));
  const stopped = await waitFor('both to see the tank stop', async () => {
    const [h, g] = await Promise.all([tank(host), tank(guest)]);
    return h.speed === 0 && Math.abs(g.speed) < 0.01 && Math.hypot(h.x - g.x, h.z - g.z) < 0.02 ? { h, g } : null;
  }, 15000).catch(() => null);
  check(`Let go, both see the tank stop at the same spot (${label})`, stopped !== null,
    stopped ? `at z ${stopped.h.z.toFixed(2)}` : JSON.stringify(await Promise.all([tank(host), tank(guest)])));
  await guest.page.evaluate(() => window.__gameMenu.click('menu-drive-reset'));
  const home = await waitFor('the tank back at its start', async () => {
    const [h, g] = await Promise.all([tank(host), tank(guest)]);
    return Math.hypot(h.x, h.z) < 0.01 && Math.hypot(g.x, g.z) < 0.01 ? h : null;
  }, 8000).catch(() => null);
  check(`The guest's Back to start parks the host's tank (${label})`, home !== null);

  // Back as they were: the host drives, and the guest sees it.
  await guest.page.evaluate(() => window.__gameMenu.click('row-seat-1'));
  await waitFor('the host to hear the ask', async () => (await host.page.evaluate(() => window.__seats.swap)) === 'offered', 8000);
  await host.page.evaluate(() => window.__gameMenu.click('menu-swap'));
  await waitFor('the host in the driver\'s seat', async () => (await host.page.evaluate(() => window.__drive.driver())) === 'me', 8000);
  await host.page.evaluate(() => window.__drive.set({ left: 1, right: 1, throttle: 1 }));
  const hostDrives = await waitFor('the guest to see the host drive', async () => {
    const g = await tank(guest);
    return g.speed > 1 ? g : null;
  }, 15000).catch(() => null);
  // The guest gunner's page draws the host driver's levers and reads the host's tank on its gauges.
  const guestSees = await waitFor('the guest to draw the host\'s levers', async () => {
    const [st, gauges, h] = await Promise.all([
      guest.page.evaluate(() => window.__driverStation.state()),
      guest.page.evaluate(() => window.__driverStation.gauges()),
      tank(host),
    ]);
    return st.angles.tillerLeft > 20 && st.angles.throttle > 35 && Math.abs(gauges.rpm - h.rpm) < 200 ? { st, gauges, h } : null;
  }, 8000).catch(() => null);
  check(`The guest's page draws the host driver's tillers and throttle, and its gauges read the host's tank (${label})`, guestSees !== null,
    guestSees ? `tillers ${guestSees.st.angles.tillerLeft.toFixed(1)}°, throttle ${guestSees.st.angles.throttle.toFixed(1)}°, ${guestSees.gauges.rpm.toFixed(0)} rpm for the host's ${guestSees.h.rpm.toFixed(0)}`
      : JSON.stringify(await guest.page.evaluate(() => ({ ...window.__driverStation.state(), gauges: window.__driverStation.gauges() }))));
  await host.page.evaluate(() => window.__drive.set(null));
  check(`The host drives from the driver's seat and the guest sees it (${label})`, hostDrives !== null,
    hostDrives ? `${hostDrives.speed.toFixed(1)} m/s` : JSON.stringify(await tank(guest)));
  await waitFor('the tank to stop', async () => (await tank(host)).speed === 0, 15000).catch(() => null);
  await host.page.evaluate(() => window.__drive.reset());
}

/**
 * The turret (F1.8): the gunner's page owns it. With the host driving and
 * the guest in the gunner's seat (a fresh crew), the guest's power traverse
 * turns its own turret at once and the host sees it turn close behind,
 * smoothly; the guest's elevation reaches the host; the host's Forward (it
 * isn't the gunner) asks the guest's page, and both see the turret back
 * straight ahead. The driver's Practice lay on the 250 m target (F1.9) asks
 * the gunner's page too, and both see the gun on the target's mark.
 */
async function turretChecks(host, guest, label) {
  const turret = (p) => p.page.evaluate(() => window.__turret.state());
  await waitFor('the guest in the gunner\'s seat', async () => (await guest.page.evaluate(() => window.__turret.owner()))
    && !(await host.page.evaluate(() => window.__turret.owner())), 8000);
  await guest.page.evaluate(() => window.__turret.forward());
  await waitFor('the turret forward on both', async () => {
    const [h, g] = await Promise.all([turret(host), turret(guest)]);
    return Math.abs(h.yaw) < 1e-3 && Math.abs(g.yaw) < 1e-3;
  }, 8000).catch(() => null);
  await guest.page.evaluate(() => window.__turret.set({ traverse: 1 }));
  const turning = await waitFor('the host to see the turret turn', async () => {
    const [h, g] = await Promise.all([turret(host), turret(guest)]);
    return h.yawDeg > 3 ? { h, g } : null;
  }, 15000).catch(() => null);
  check(`The gunner's power traverse turns the turret on the gunner's page at once, and the host sees it close behind (${label})`,
    turning !== null && turning.g.yawDeg >= turning.h.yawDeg && turning.g.yawDeg - turning.h.yawDeg < turning.g.rateDeg * 0.6 + 0.5,
    turning ? `gunner ${turning.g.yawDeg.toFixed(2)}° at ${turning.g.rateDeg.toFixed(1)}°/s; host draws ${turning.h.yawDeg.toFixed(2)}°` : JSON.stringify(await Promise.all([turret(host), turret(guest)])));
  // How smoothly the host draws it: frame by frame it never goes back or jumps.
  const steps = await host.page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const end = performance.now() + 2000;
    const frame = () => {
      out.push(window.__turret.state().yaw);
      if (performance.now() < end) requestAnimationFrame(frame);
      else resolve(out);
    };
    requestAnimationFrame(frame);
  }));
  const deltas = steps.slice(1).map((v, i) => Math.atan2(Math.sin(v - steps[i]), Math.cos(v - steps[i])));
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const backwards = deltas.filter((d) => d < -1e-5).length;
  const biggest = sorted.at(-1) ?? 0;
  check(`The host draws the traversing turret smoothly (${label})`, deltas.length >= 10 && backwards === 0 && biggest < Math.max(0.01, median * 5),
    `${deltas.length} frames, ${backwards} backward steps, median ${((median * 180) / Math.PI).toFixed(2)}°, largest ${((biggest * 180) / Math.PI).toFixed(2)}° a frame`);
  await guest.page.evaluate(() => window.__turret.set({ traverse: 0, elevation: 5 }));
  const laid = await waitFor('both to see the turret stop and the gun at +5°', async () => {
    const [h, g] = await Promise.all([turret(host), turret(guest)]);
    const same = Math.abs(Math.atan2(Math.sin(h.yaw - g.yaw), Math.cos(h.yaw - g.yaw))) < 2e-3;
    return h.rate === 0 && g.rate === 0 && same && Math.abs(h.elevationDeg - 5) < 0.05 ? { h, g } : null;
  }, 15000).catch(() => null);
  check(`Stopped and elevated, both see the turret and gun laid the same (${label})`, laid !== null,
    laid ? `turret ${laid.h.yawDeg.toFixed(2)}°, gun ${laid.h.elevationDeg.toFixed(2)}°` : JSON.stringify(await Promise.all([turret(host), turret(guest)])));
  await guest.page.evaluate(() => window.__turret.set(null));
  await host.page.evaluate(() => window.__gameMenu.click('menu-turret-forward'));
  const home = await waitFor('the turret forward', async () => {
    const [h, g] = await Promise.all([turret(host), turret(guest)]);
    return Math.abs(h.yaw) < 1e-3 && Math.abs(g.yaw) < 1e-3 && Math.abs(h.elevation) < 1e-3 && g.elevation === 0 ? h : null;
  }, 8000).catch(() => null);
  check(`The driver's Forward puts the gunner's turret straight ahead (${label})`, home !== null,
    home ? '' : JSON.stringify(await Promise.all([turret(host), turret(guest)])));

  // The gunsight (F1.9): the driver's Practice lay asks the gunner's page, which lays the gun on the 250 m target; both see it on its mark.
  const onMark = (p) => p.page.evaluate(() => window.__sight.error(1));
  await host.page.evaluate(() => window.__gameMenu.click('menu-sight-lay-1'));
  const sighted = await waitFor('the gun laid on the 250 m target on both pages', async () => {
    const [h, g] = await Promise.all([onMark(host), onMark(guest)]);
    const near = (e) => Math.abs(e.across) < 0.1 && Math.abs(e.up) < 0.1;
    return near(h) && near(g) ? { h, g } : null;
  }, 8000).catch(() => null);
  check(`The driver's Practice lay asks the gunner's page, which lays the gun on the 250 m target's mark, and the driver sees it laid (${label})`,
    sighted !== null && Math.abs(sighted.g.range - 250) < 3,
    sighted ? `gunner ${sighted.g.across.toFixed(3)}/${sighted.g.up.toFixed(3)} mil, driver ${sighted.h.across.toFixed(3)}/${sighted.h.up.toFixed(3)} mil at ${Math.round(sighted.g.range)} m`
      : JSON.stringify(await Promise.all([onMark(host), onMark(guest), turret(guest)])));
  await host.page.evaluate(() => window.__gameMenu.click('menu-sight-lay-ahead'));
  await waitFor('the turret forward again', async () => Math.abs((await turret(guest)).yaw) < 1e-3, 8000).catch(() => null);
}

/**
 * Loading and firing (F1.10): the gunner's page owns the loading and fires.
 * With the host driving and the guest in the gunner's seat (as after
 * turretChecks), a scripted right hand on the guest's page loads a shell and
 * the host sees the breech loaded; the guest lays the gun on the 100 m target
 * and pulls the trigger, both pages see the shot, the host decides the hit
 * and the guest takes its word.
 */
async function firingChecks(host, guest, label) {
  const drill = (p) => p.page.evaluate(() => window.__loading.state());
  await host.page.evaluate(() => window.__drive.reset());
  await guest.page.evaluate(() => window.__loading.reset());
  await waitFor('the guest to own the loading with every shell in the rack', async () => {
    const g = await drill(guest);
    return g.owner && !(await drill(host)).owner && g.shells.every((s) => s.place === 'rack') && g.lever === 0;
  }, 8000);
  // The right hand's path, hull space: take shell 0 near its base, put its nose
  // to the breech mouth, ram it, then pull the lever back a quarter turn.
  await guest.page.evaluate(() => {
    const L = window.__loading.layout();
    const shell = window.__loading.state().shells[0];
    const grip = [shell.centre[0], shell.centre[1], shell.centre[2] + 0.2];
    const toNose = shell.nose.map((n, k) => grip[k] - n);
    const noseAt = (x, y, z) => [L.mouth[0] + x + toNose[0], L.mouth[1] + y + toNose[1], L.mouth[2] + z + toNose[2]];
    const handleAt = (a) => [L.pivot[0] + L.handleX, L.pivot[1] + L.leverLength * Math.cos(a), L.pivot[2] + L.leverLength * Math.sin(a)];
    const rest = [L.eye[0] + 0.15, L.eye[1] - 0.45, L.eye[2] - 0.15];
    const keys = [
      [0, grip, false], [0.5, grip, true], [1, grip, true],
      [2, noseAt(0.25, 0.05, 0.05), true], [2.8, noseAt(0, 0, 0.03), true], [4, noseAt(0, 0, -0.63), true], [4.5, noseAt(0, 0, -0.63), false],
      [5.2, handleAt(0), false], [5.7, handleAt(0), true], [7.2, handleAt(1.8), true], [7.7, handleAt(1.8), false], [8.4, rest, false],
    ];
    let start = -1;
    window.__loading.setTestHand('right', (now) => {
      if (start < 0) start = now;
      const t = (now - start) / 1000;
      let i = 0;
      while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
      const [t0, p0, s0] = keys[i];
      const [t1, p1] = keys[i + 1];
      const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      return { x: p0[0] + (p1[0] - p0[0]) * f, y: p0[1] + (p1[1] - p0[1]) * f, z: p0[2] + (p1[2] - p0[2]) * f, squeeze: s0 };
    });
  });
  const loaded = await waitFor('the host to see the breech loaded', async () => {
    const [h, g] = await Promise.all([drill(host), drill(guest)]);
    return g.loaded && h.loaded && h.breechShell === 0 && Math.abs(h.lever - Math.PI / 2) < 0.01 ? { h, g } : null;
  }, 20000).catch(() => null);
  await guest.page.evaluate(() => window.__loading.setTestHand('right', null));
  const now = loaded ?? { h: await drill(host), g: await drill(guest) };
  check(`The gunner loads a shell and the driver sees the breech loaded and closed (${label})`, loaded !== null,
    `gunner: loaded ${now.g.loaded}, board "${now.g.board.join(' | ')}"; driver draws loaded ${now.h.loaded}, breech shell ${now.h.breechShell}, lever ${now.h.lever.toFixed(2)}, ${now.h.received} loading packets`);

  // Lay the gun on the 100 m target and fire.
  const before = await Promise.all([host, guest].map((p) => p.page.evaluate(() => ({ shots: window.__firing.records().length, hits: window.__firing.hits()[0], casings: window.__loading.state().casings }))));
  await guest.page.evaluate(() => window.__firing.aimAt(0));
  await waitFor('the host to draw the gun laid', async () => {
    const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__turret.state())));
    return Math.abs(h.yaw - g.yaw) < 1e-4 && Math.abs(h.elevation - g.elevation) < 1e-4;
  }, 8000).catch(() => null);
  await guest.page.evaluate(() => window.__turret.pullTrigger());
  const shot = await waitFor('both pages to see the shot decided', async () => {
    const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => ({ records: window.__firing.records(), hits: window.__firing.hits()[0], casings: window.__loading.state().casings, loaded: window.__loading.state().loaded }))));
    const hr = h.records[before[0].shots];
    const gr = g.records[before[1].shots];
    return hr && gr && gr.line.startsWith('Hit') && h.casings > before[0].casings ? { h, g, hr, gr } : null;
  }, 15000).catch(() => null);
  const after = shot ?? { hr: null, gr: null, h: {}, g: {} };
  check(`The gunner fires, both see the shot and the casing, the host decides the hit and the gunner takes its word (${label})`,
    shot !== null && shot.hr.id === shot.gr.id && shot.hr.kind === 'target' && shot.hr.target === 0 && shot.gr.kind === 'target'
      && shot.h.hits === before[0].hits + 1 && shot.g.hits === shot.h.hits && !shot.g.loaded && shot.g.casings > before[1].casings,
    shot ? `host "${shot.hr.line}", gunner "${shot.gr.line}", hits ${shot.h.hits}/${shot.g.hits}, casings ${shot.h.casings}/${shot.g.casings}`
      : JSON.stringify(await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__firing.records())))));
  await guest.page.evaluate(() => window.__turret.forward());
}

async function lobbyChecks(browser, host, guest) {
  // Coat colours: each player's pick, told on connecting and on changing.
  const colors = async () => Promise.all([host, guest].map((p) => p.page.evaluate(() => ({ mine: window.__net.color, theirs: window.__net.remoteColor }))));
  const [h0, g0] = await colors();
  // The game menu's coat swatches pick a colour.
  const pick = (g0.mine + 1) % 8;
  await guest.page.evaluate((i) => window.__gameMenu.click(`coat-${i}`), pick);
  const recolored = await waitFor('the host to see the new coat', async () => {
    const [h] = await colors();
    return h.theirs === pick ? h : null;
  }, 3000).catch(() => null);
  check('Each player sees the coat colour the other picked', h0.theirs === g0.mine && g0.theirs === h0.mine && recolored !== null,
    `host sees ${h0.theirs} (guest wears ${g0.mine}), guest sees ${g0.theirs} (host wears ${h0.mine}), then ${recolored ? `host sees ${recolored.theirs}` : 'no change seen'}`);

  // Microphone up front, on a page that hasn't joined a crew. This page also
  // pretends to have a VR headset, for the Enter VR button.
  const solo = await openPlayer(browser, 'name=Di', () => {
    const xr = navigator.xr ?? {};
    window.__vrRequests = 0;
    xr.isSessionSupported = async (mode) => mode === 'immersive-vr';
    xr.requestSession = async () => {
      window.__vrRequests++;
      throw new DOMException('No headset in this test', 'NotSupportedError');
    };
    if (!navigator.xr) {
      Object.defineProperty(navigator, 'xr', { value: Object.assign(xr, { addEventListener() {}, removeEventListener() {} }) });
    }
  });
  const mic = (page) => page.evaluate(() => ({ text: document.getElementById('crew-mic').textContent, button: getComputedStyle(document.getElementById('crew-allow-mic')).display !== 'none',
    open: window.__net.voice.micTrack !== null }));
  const before = await mic(solo.page);
  if (before.button) {
    await solo.page.evaluate(() => document.getElementById('crew-allow-mic').click());
  }
  const after = await waitFor('the microphone to be allowed', async () => {
    const m = await mic(solo.page);
    return m.text.startsWith('Microphone allowed') ? m : null;
  }, 5000).catch(() => null);
  check('A page asks for the microphone up front without keeping it open', after !== null && !after.button && !after.open,
    `before: "${before.text}"${before.button ? ' with the Allow button' : ''}; after: ${after ? `"${after.text}", mic ${after.open ? 'open' : 'closed'}` : 'never allowed'}`);

  // The page's own Enter VR button stays once a crew is joined (the browser's
  // offer can be withdrawn then), and asks for a VR session.
  const enterVr = () => solo.page.evaluate(() => {
    const b = document.getElementById('crew-enter-vr');
    return b !== null && getComputedStyle(b).display !== 'none';
  });
  const shownSolo = await waitFor('the Enter VR button', enterVr, 5000).catch(() => false);
  // Di joins a crew of her own by typing its code on the start screen's keypad.
  await solo.page.evaluate(() => {
    const s = window.__startScreen;
    s.click('start-join');
    for (const key of ['S', 'V', 'del', 'W', 'R', 'T']) {
      s.click(`key-${key}`);
    }
    s.click('start-join-go');
  });
  const typed = await waitFor('Di waiting in the lobby', async () => ((await state(solo.page)) === 'waiting'
    ? solo.page.evaluate(() => ({ page: window.__startScreen.page, status: window.__startScreen.text('start-crew-status'), title: window.__startScreen.text('start-crew-title'), url: location.search }))
    : null), 10000).catch(() => null);
  check('The start screen joins a crew typed on its keypad', typed !== null && typed.page === 'crew' && typed.title === 'Crew SWRT' &&
    typed.status === 'Waiting for your crewmate.' && typed.url.includes('room=SWRT'), JSON.stringify(typed));
  const shownInCrew = await enterVr();
  await solo.page.evaluate(() => document.getElementById('crew-enter-vr').click());
  const requests = await waitFor('a VR session request', () => solo.page.evaluate(() => window.__vrRequests), 3000).catch(() => 0);
  check('The page has its own Enter VR button, kept after joining a crew', shownSolo && shownInCrew && requests > 0,
    `shown ${shownSolo ? 'solo' : 'not solo'}, ${shownInCrew ? 'and' : 'but not'} in a crew; ${requests} session request(s) on click`);
  // A refused request says why under the button, and the button can be pressed again.
  const vrNote = await waitFor('the reason VR didn\'t start', () => solo.page.evaluate(() => {
    const note = document.getElementById('crew-vr-status');
    const b = document.getElementById('crew-enter-vr');
    return note && getComputedStyle(note).display !== 'none' && note.textContent.startsWith("VR didn't start")
      ? { text: note.textContent, disabled: b.disabled } : null;
  }), 3000).catch(() => null);
  check('A refused VR request says why on the crew panel',
    vrNote !== null && vrNote.text.includes('No headset in this test') && !vrNote.disabled,
    vrNote ? `"${vrNote.text}", button ${vrNote.disabled ? 'disabled' : 'ready'}` : 'no reason shown');

  // The game menu changes the frame rate straight away, and keeps the choice.
  const hz = await solo.page.evaluate(() => {
    const m = window.__gameMenu;
    m.toggle(true);
    const before = m.selected('row-hz-2');
    m.click('row-hz-0');
    return { label: m.text('row-hz-label'), lit90Before: before, lit72: m.selected('row-hz-0'), hz: window.__settings.hz,
      stored: localStorage.getItem('track-barrel.settings') };
  });
  check('The game menu changes the frame rate straight away',
    hz.label === 'Frame rate (Hz)' && hz.lit90Before && hz.lit72 && hz.hz === 72 && hz.stored === 'hz=72',
    JSON.stringify(hz));
  const height = await solo.page.evaluate(() => {
    const m = window.__gameMenu;
    m.click('height-up');
    m.click('height-up');
    m.click('height-down');
    const result = { shown: m.text('height-value'), raise: window.__body.state.choice.raise, pointLit: m.selected('height-own'),
      stored: localStorage.getItem('track-barrel.settings') };
    m.click('height-own');
    result.backToPoint = window.__body.state.choice.raise === 0 && m.selected('height-own');
    m.toggle(false);
    return result;
  });
  check('The game menu steps the eye height 5 cm at a time, keeps it, and goes back to the seat\'s eye point',
    height.shown === '+5 cm' && height.raise === 0.05 && !height.pointLit && height.stored === 'hz=72&raise=0.05' && height.backToPoint,
    JSON.stringify(height));

  // The start-up settings on the page's panel: turning shadows on saves the
  // choice in the browser and reloads the page with it.
  await solo.page.evaluate(() => {
    document.getElementById('settings-menu').open = true;
    document.getElementById('setting-shadows').value = '1';
  });
  await Promise.all([
    solo.page.waitForNavigation({ waitUntil: 'load' }),
    solo.page.evaluate(() => document.getElementById('settings-save').click()),
  ]);
  await waitFor('the game to reload', async () => (await state(solo.page).catch(() => 'loading')) !== 'loading', 60000);
  const saved = await solo.page.evaluate(() => ({ shadows: window.__settings.shadows, hz: window.__settings.hz, url: location.search,
    stored: localStorage.getItem('track-barrel.settings'), shown: document.getElementById('setting-shadows').value }));
  check('The start-up settings save a choice and reload the game with it, keeping the game menu\'s',
    saved.shadows === true && saved.shown === '1' && saved.hz === 72 && !saved.url.includes('shadows') && saved.url.includes('name=Di'),
    `shadows ${saved.shadows ? 'on' : 'off'} (menu shows ${saved.shown}), ${saved.hz} Hz, URL ${saved.url}, saved ${saved.stored}`);
  await solo.context.close();
}

/** Spike S10: what one player sees of the crewmate. */
const crew = (page) => page.evaluate(() => ({ status: window.__crew.status, paused: window.__crew.paused,
  signVisible: window.__crew.signVisible, message: window.__crew.message }));

/** Make `page` look hidden (headset off or tab switched), or visible again, through the real visibilitychange path. */
function setPageHidden(page, hidden) {
  return page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Wait for `page`'s crew status to become `status`; returns what it saw then. */
function waitForCrew(page, status, timeoutMs = 10000) {
  return waitFor(`crew status ${status}`, async () => {
    const c = await crew(page);
    return c.status === status ? c : null;
  }, timeoutMs).catch(() => null);
}

/**
 * Spike S10: the game pauses when the crewmate can't play and carries on
 * when they're back. `host` and `guest` are connected players.
 */
async function lifecycleChecks(host, guest) {
  // The guest takes off the headset: the host's game waits.
  await setPageHidden(guest.page, true);
  const away = await waitForCrew(host.page, 'away');
  if (process.env.SHOT_DIR) {
    await host.page.setViewportSize({ width: 960, height: 600 });
    await host.page.evaluate(() => document.querySelectorAll("body > div:not(#scene-container)").forEach((e) => { e.style.display = "none"; }));
    await host.page.waitForTimeout(500);
    await host.page.screenshot({ path: `${process.env.SHOT_DIR}/crew-away.png` });
  }
  check('A crewmate who steps away pauses the game, with a sign saying so',
    away !== null && away.paused && away.signVisible,
    away ? `"${away.message}"` : 'host never saw the crewmate away');
  await setPageHidden(guest.page, false);
  const back = await waitForCrew(host.page, 'together');
  check('The game carries on when the crewmate is back', back !== null && !back.paused && !back.signVisible,
    back ? `status ${back.status}` : 'never back');

  // Nothing arrives from the guest for 3 s (a frozen page or a dying network).
  await host.page.evaluate(() => window.__net.session.blackout(3000));
  const silent = await waitForCrew(host.page, 'silent', 5000);
  const recovered = await waitForCrew(host.page, 'together', 8000);
  check('A crewmate who goes quiet pauses the game until packets flow again', silent !== null && silent.paused && recovered !== null,
    silent ? `"${silent.message}"` : 'never reported silent');

  // The guest's connection fails: both get back into the room on their own.
  // Reconnecting can take under a second, so look at each side's status history.
  // It keeps only the last 16, so count from the total ever seen, not its length.
  const started = Date.now();
  const mark = (page) => page.evaluate(() => window.__crew.changes);
  const [hostMark, guestMark] = [await mark(host.page), await mark(guest.page)];
  const since = (page, from) => page.evaluate((n) => {
    const { history, changes } = window.__crew;
    return history.slice(Math.max(0, history.length - (changes - n)));
  }, from);
  await guest.page.evaluate(() => window.__net.session.breakConnection());
  let reconnected = true;
  await waitFor('both reconnected', async () => (await state(host.page)) === 'connected' && (await state(guest.page)) === 'connected', 30000)
    .catch(() => { reconnected = false; });
  const seconds = (Date.now() - started) / 1000;
  const rejoins = await guest.page.evaluate(() => window.__net.session.rejoins);
  const after = reconnected ? await waitForCrew(host.page, 'together') : null;
  await waitForCrew(guest.page, 'together');
  const hostSaw = await since(host.page, hostMark);
  const guestSaw = await since(guest.page, guestMark);
  const pausedOn = (seen) => seen.some((st) => st === 'reconnecting' || st === 'waiting');
  check('A failed connection reconnects by itself and the game carries on',
    reconnected && rejoins >= 1 && pausedOn(hostSaw) && pausedOn(guestSaw) && after !== null,
    `guest saw ${guestSaw.join(' > ')}, host saw ${hostSaw.join(' > ')}, back in ${seconds.toFixed(1)} s after ${rejoins} rejoin(s)`);
}

/**
 * The practice crewmate: one player (the host) and a page set to play as
 * the bot. The bot takes the seat the player leaves free, and moves over
 * when the player changes seats. Add a check here for each two-player job
 * the bot learns.
 */
async function botChecks(browser) {
  const me = await openPlayer(browser, 'room=BOTS&name=Fay');
  await waitFor('Fay waiting in the lobby', async () => (await state(me.page)) === 'waiting');
  const bot = await openPlayer(browser, 'room=BOTS&bot=1');
  await waitFor('the bot to join', async () => (await state(me.page)) === 'connected' && (await state(bot.page)) === 'connected');

  // The bot's head is at its seat's eye point, as drawn on the player's page, and its legs in that seat.
  const near = (a, b, within) => a && Math.hypot(...a.map((v, i) => v - b[i])) < within;
  const botSeat = async () => {
    const onBot = await bot.page.evaluate(() => ({ seat: window.__bot.seat, head: window.__bot.head }));
    const onMine = await me.page.evaluate(() => ({
      mine: window.__seats.mine,
      eye: window.__seats.eye(window.__seats.crew),
      head: window.__debug.world.scene.getObjectByName('Crew 2 Head')?.position.toArray(),
      legs: window.__debug.world.scene.getObjectByName('Crew 2 Legs')?.position.toArray(),
    }));
    return { ...onBot, ...onMine };
  };
  const sat = (playerSeat, seat) => waitFor(`the bot in the ${seat}'s seat`, async () => {
    const b = await botSeat();
    // The bot looks about, so its head is within a few centimetres of the eye point.
    return b.mine === playerSeat && b.seat === seat && near(b.head, b.eye, 0.1) && near(b.legs, HIPS[seat], 0.01) ? b : null;
  }, 10000).catch(() => null);
  const gunning = await sat('driver', 'gunner');
  check('Practice crewmate: sits in the gunner\'s seat while the player drives', gunning !== null, JSON.stringify(gunning ?? await botSeat()));

  // F1.13: as gunner the bot loads, lays on the nearest target (the 100 m tank, from the start) and fires
  // from the halt; the player sees its hands on the shell, the breech lever, the power grip and the
  // elevation wheel (their HoldKinds in its pose packets), the shot decided by the player's page (the
  // host), and its calls on the sign.
  const holdsSeen = new Set();
  const crewHolds = async () => {
    const holds = await me.page.evaluate(() => window.__net.remotePose()?.holds ?? 0);
    holdsSeen.add(holds & 15);
    holdsSeen.add(holds >> 4);
  };
  const fired = await waitFor('the bot to hit a target', async () => {
    await crewHolds();
    const records = await me.page.evaluate(() => window.__firing.records());
    return records.find((r) => r.id % 2 === 1 && r.kind === 'target') ?? null;
  }, 120000).catch(() => null);
  const bot1 = await bot.page.evaluate(() => ({ ...window.__bot.gunning, status: window.__bot.status, holding: window.__bot.holding() }));
  check('Practice crewmate: as gunner it loads, lays on the nearest target and hits it, the host deciding',
    fired !== null && fired.target === 0 && bot1.loads >= 1,
    fired ? `"${fired.line}", bot ${JSON.stringify(bot1)}` : JSON.stringify({ bot: bot1, mine: await me.page.evaluate(() => window.__firing.records()) }));
  // HoldKinds: 7 elevation wheel, 9 shell, 10 breech lever, 12 power grip.
  const seenAll = [7, 9, 10, 12].every((k) => holdsSeen.has(k));
  check('Practice crewmate: the player sees its hands on the elevation wheel, a shell, the breech lever and the power grip',
    seenAll, `hold kinds seen ${[...holdsSeen].sort((a, b) => a - b).join(', ')}`);
  const heard = await waitFor('the bot\'s call on the player\'s sign', async () => {
    const c = await me.page.evaluate(() => ({ heard: window.__crewCalls.lastHeard, sign: window.__crewCalls.sign, crewmate: window.__crewCalls.crewmate }));
    return (c.heard === 'on-the-way' || c.heard === 'target') && c.crewmate !== '' ? c : null;
  }, 8000).catch(() => null);
  check('Practice crewmate: calls "On the way!" and "Target!", and tells the player\'s menu what it is doing', heard !== null,
    JSON.stringify(heard ?? await me.page.evaluate(() => ({ heard: window.__crewCalls.lastHeard, crewmate: window.__crewCalls.crewmate }))));

  await me.page.evaluate(() => window.__gameMenu.click('row-seat-1'));
  const driving = await sat('gunner', 'driver');
  check('Practice crewmate: moves to the driver\'s seat when the player takes the gunner\'s', driving !== null, JSON.stringify(driving ?? await botSeat()));

  // F1.13: as driver it works the tillers on the player's calls: Advance drives the player's (the
  // host's) tank, the player's page drawing the bot's hands on the tillers; Halt stops it; Left turns it 45°.
  const tank = () => me.page.evaluate(() => window.__drive.state());
  await me.page.evaluate(() => window.__drive.reset());
  await waitFor('the tank parked', async () => Math.hypot((await tank()).x, (await tank()).z) < 0.01, 8000).catch(() => null);
  await me.page.evaluate(() => window.__gameMenu.click('call-advance'));
  const advancing = await waitFor('the bot to drive the tank forwards', async () => {
    await crewHolds();
    const [t, st] = await Promise.all([tank(), me.page.evaluate(() => window.__driverStation.state())]);
    return t.speed > 1.5 && t.z < -2 && st.angles.tillerLeft > 15 && st.angles.tillerRight > 15 ? { t, st } : null;
  }, 40000).catch(() => null);
  check('Practice crewmate: "Driver, advance" — it takes both tillers and drives the tank forwards',
    advancing !== null && holdsSeen.has(2) && holdsSeen.has(3),
    advancing ? `${advancing.t.speed.toFixed(1)} m/s at z ${advancing.t.z.toFixed(1)}, tillers drawn at ${advancing.st.angles.tillerLeft.toFixed(0)}° and ${advancing.st.angles.tillerRight.toFixed(0)}°, holds ${[...holdsSeen].join(', ')}`
      : JSON.stringify({ tank: await tank(), bot: await bot.page.evaluate(() => ({ ...window.__bot.driving, holding: window.__bot.holding() })) }));
  await me.page.evaluate(() => window.__gameMenu.click('call-halt'));
  const halted = await waitFor('the bot to halt', async () => ((await tank()).speed === 0 ? tank() : null), 20000).catch(() => null);
  check('Practice crewmate: "Driver, halt" — it centres the tillers and the tank stops', halted !== null, JSON.stringify(halted ?? await tank()));
  const heading = (await tank()).heading;
  await me.page.evaluate(() => window.__gameMenu.click('call-left'));
  const turned = await waitFor('the bot to turn left', async () => {
    const t = await tank();
    return Math.abs(t.heading - heading - Math.PI / 4) < 3 * Math.PI / 180 && t.yawRate === 0 ? t : null;
  }, 30000).catch(() => null);
  check('Practice crewmate: "Driver, left" — at a halt it pivots 45° left', turned !== null,
    `heading ${(((turned ?? await tank()).heading - heading) * 180 / Math.PI).toFixed(1)}° from ${(heading * 180 / Math.PI).toFixed(1)}°`);
  await me.page.evaluate(() => window.__drive.reset());

  const errors = [...me.errors, ...bot.errors].filter((m) => !m.includes('net::ERR_') && !m.includes('Failed to load resource'));
  await me.context.close();
  await bot.context.close();
  return errors;
}

async function netStats(page) {
  return page.evaluate(() => {
    const n = window.__net;
    return {
      srtt: n.session.clock.stats.srtt,
      jitter: n.session.clock.stats.jitter,
      received: n.received,
      sent: n.sent,
      lost: n.session.report.lost,
      route: n.session.report.candidates,
      connectMs: n.session.connectMs,
      renderDelayMs: n.renderDelayMs,
      packetIntervalMs: n.packetIntervalMs,
      arrivalJitterMs: n.arrivalJitterMs,
      lateFrames: n.lateFrames,
      host: n.session.isHost,
      audioJitterBufferMs: n.session.report.audioJitterBufferMs,
      audioLost: n.session.report.audioLost,
      audioConcealed: n.session.report.audioConcealed,
      audioBytesReceived: n.session.report.audioBytesReceived,
      audioContext: n.voice.audioState,
    };
  });
}

async function main() {
  console.log('Starting the local lobby and the preview server...');
  await start(process.execPath, ['--experimental-strip-types', '--no-warnings', 'lobby/dev-server.ts'], 'listening');
  await start('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], 'Local');

  const browser = await chromium.launch({
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      // A fake microphone that beeps, granted without a prompt, and audio without a click.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const report = {};
  try {
    if (process.env.ONLY_BOT) {
      // Quick loop for the practice crewmate.
      const botErrors = await botChecks(browser);
      check('No console errors', botErrors.length === 0, botErrors.slice(0, 3).join(' | '));
      return;
    }
    const room = 'TEST';
    // ONLY_SEATS=lag runs the quick seat checks at about 150 ms RTT.
    const quickLag = process.env.ONLY_SEATS === 'lag' || process.env.ONLY_DRIVE === 'lag' || process.env.ONLY_TURRET === 'lag' || process.env.ONLY_FIRING === 'lag' ? '&netlag=60&netjitter=20&netloss=0.01' : '';
    const a = await openPlayer(browser, `room=${room}&name=Ann${quickLag}`);
    await waitFor('Ann waiting in the lobby', async () => (await state(a.page)) === 'waiting');
    const b = await openPlayer(browser, `room=${room}&name=Bo${quickLag}`);
    await waitFor('both connected', async () => (await state(a.page)) === 'connected' && (await state(b.page)) === 'connected');
    check('Two players connect over WebRTC', true);
    // Opened from a link with the crew code, each page's start screen shows
    // the crew and gets out of the way once the crewmate is aboard.
    const startScreens = () => Promise.all([a, b].map((p) => p.page.evaluate(() => ({ page: window.__startScreen.page, mode: window.__startScreen.mode, visible: window.__startScreen.visible }))));
    const stepped = await waitFor('the start screens to step aside', async () => {
      const s = await startScreens();
      return s.every((x) => x.page === null && !x.visible) ? s : null;
      // A cold CI runner can take over 5 s to load the panels on the first pages.
    }, 10000).catch(() => null);
    check('A crew link\'s start screen steps aside once the crewmate is aboard', stepped !== null && stepped.every((x) => x.mode === 'link'),
      JSON.stringify(stepped ?? await startScreens()));
    if (process.env.ONLY_LIFECYCLE) {
      // Quick loop for spike S10: just pausing and reconnecting.
      await lifecycleChecks(a, b);
      return;
    }
    if (process.env.ONLY_SEATS) {
      // Quick loop for F1.1: just the seats.
      await seatChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      return;
    }
    if (process.env.ONLY_DRIVE) {
      // Quick loop for F1.4: just the drive (ONLY_DRIVE=lag at about 150 ms RTT).
      await driveChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      return;
    }
    if (process.env.ONLY_TURRET) {
      // Quick loop for F1.8: just the turret (ONLY_TURRET=lag at about 150 ms RTT).
      await turretChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      return;
    }
    if (process.env.ONLY_FIRING) {
      // Quick loop for F1.10: the turret, then loading and firing (ONLY_FIRING=lag at about 150 ms RTT).
      await turretChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      await firingChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      return;
    }

    const c = await openPlayer(browser, `room=${room}&name=Cy`);
    const cState = await waitFor('the third player to be refused', async () => {
      const s = await state(c.page);
      return s === 'full' ? s : null;
    });
    check('A third player is turned away', cState === 'full');
    await c.context.close();

    // A still pose arrives intact.
    const sent = {
      head: { px: 0.3, py: 1.52, pz: -0.45, qx: 0, qy: Math.sin(Math.PI / 12), qz: 0, qw: Math.cos(Math.PI / 12) },
      left: { px: 0.05, py: 1.1, pz: -0.7, qx: 0.2, qy: 0, qz: 0, qw: Math.sqrt(0.96) },
      right: { px: 0.55, py: 1.05, pz: -0.7, qx: 0, qy: 0, qz: -0.3, qw: Math.sqrt(0.91) },
      flags: 3,
      // Posed hands: the left flat, the right pointing.
      leftFingers: { index: 0.12, grip: 0.1, thumb: 0 },
      rightFingers: { index: 0.12, grip: 1, thumb: 1 },
    };
    await a.page.evaluate((pose) => window.__net.setTestPose(pose), sent);
    await new Promise((r) => setTimeout(r, 800));
    const got = await b.page.evaluate(() => window.__net.remotePose());
    let posErr = Infinity;
    let rotDot = 0;
    if (got) {
      posErr = 0;
      rotDot = 1;
      for (const k of ['head', 'left', 'right']) {
        posErr = Math.max(posErr, Math.hypot(got[k].px - sent[k].px, got[k].py - sent[k].py, got[k].pz - sent[k].pz));
        const dot = Math.abs(got[k].qx * sent[k].qx + got[k].qy * sent[k].qy + got[k].qz * sent[k].qz + got[k].qw * sent[k].qw);
        rotDot = Math.min(rotDot, dot);
      }
    }
    check('Head and hand poses arrive intact', posErr < 0.002 && rotDot > 0.9999 && got?.flags === 3,
      `position error ${(posErr * 1000).toFixed(2)} mm, rotation error ${((Math.acos(Math.min(1, rotDot)) * 2 * 180) / Math.PI).toFixed(3)}°`);
    const fingers = await b.page.evaluate(() => {
      const pose = window.__net.remotePose();
      const hand = window.__debug.world.scene.getObjectByName('Crew 2 Right Hand');
      // Bone 1 is the index finger's first bone; bone 4 the middle finger's.
      return { left: pose?.leftFingers, right: pose?.rightFingers, index: hand?.skeleton.bones[1].rotation.x, middle: hand?.skeleton.bones[4].rotation.x };
    });
    const near = (a, b) => a !== undefined && Math.abs(a - b) < 0.01;
    check('Finger poses arrive and pose the crewmate\'s hands',
      near(fingers.left?.index, 0.12) && near(fingers.left?.thumb, 0) && near(fingers.right?.grip, 1) && near(fingers.right?.index, 0.12) &&
        fingers.index > -0.3 && fingers.middle < -1.3,
      `left ${JSON.stringify(fingers.left)}, right ${JSON.stringify(fingers.right)}, drawn index bend ${fingers.index?.toFixed(2)}, middle ${fingers.middle?.toFixed(2)} rad`);
    const visible = await b.page.evaluate(() =>
      ['Crew 2 Head', 'Crew 2 Torso', 'Crew 2 Legs', 'Crew 2 Left Hand', 'Crew 2 Right Hand'].every(
        (name) => window.__debug.world.scene.getObjectByName(name)?.visible,
      ),
    );
    check('Crewmate avatar is drawn', visible);
    if (process.env.SHOT_DIR) {
      // A picture of the crewmate facing this player, for checking the avatar by eye.
      const facing = { qx: 0, qy: 1, qz: 0, qw: 0 };
      await a.page.evaluate((pose) => window.__net.setTestPose(pose), {
        head: { px: 0, py: 1.62, pz: -1.3, ...facing },
        left: { px: -0.22, py: 1.05, pz: -1.0, ...facing },
        right: { px: 0.22, py: 1.05, pz: -1.0, ...facing },
        flags: 3,
      });
      const size = b.page.viewportSize();
      await b.page.setViewportSize({ width: 960, height: 600 });
      await b.page.evaluate(() => document.querySelectorAll('body > div:not(#scene-container)').forEach((e) => { e.style.display = 'none'; }));
      await b.page.waitForTimeout(1500);
      await b.page.screenshot({ path: `${process.env.SHOT_DIR}/crewmate.png` });
      // Back to the small page: software rendering at full size slows the timing checks that follow.
      await b.page.setViewportSize(size);
    }

    // Voice: the fake microphone beeps about once a second.
    const voicePeak = await peakVoiceLevel(b.page, 2500);
    check('Crewmate voice arrives', voicePeak > 0.01, `peak level ${voicePeak.toFixed(3)}`);
    // The game menu's mute buttons: Ann mutes her microphone, then Bo turns Ann's voice off.
    await a.page.evaluate(() => window.__gameMenu.click('row-mic-1'));
    await new Promise((r) => setTimeout(r, 500));
    const mutedPeak = await peakVoiceLevel(b.page, 2500);
    const mutedLit = await a.page.evaluate(() => window.__gameMenu.selected('row-mic-1'));
    check('Mute silences the microphone', mutedPeak < 0.002 && mutedLit, `peak level ${mutedPeak.toFixed(4)}, Muted ${mutedLit ? '' : 'not '}highlighted`);
    await a.page.evaluate(() => window.__gameMenu.click('row-mic-0'));
    await b.page.evaluate(() => window.__gameMenu.click('row-crew-1'));
    await new Promise((r) => setTimeout(r, 500));
    const crewMutedPeak = await peakVoiceLevel(b.page, 2500);
    await b.page.evaluate(() => window.__gameMenu.click('row-crew-0'));
    await new Promise((r) => setTimeout(r, 500));
    const crewBackPeak = await peakVoiceLevel(b.page, 2500);
    check('Muting the crewmate silences their voice, and unmuting brings it back', crewMutedPeak < 0.002 && crewBackPeak > 0.01,
      `peak level muted ${crewMutedPeak.toFixed(4)}, unmuted ${crewBackPeak.toFixed(3)}`);

    // Spike S8: each player sees the other's platform report, with the microphone named.
    const crews = await waitFor('platform reports', async () => {
      const r = await Promise.all([a, b].map((p) => p.page.evaluate(() => window.__platform?.crew)));
      return r.every((c) => c && c.mic !== 'not open') ? r : null;
    }, 10000).catch(() => null);
    check('Players swap platform reports', crews !== null, crews ? `Ann sees "${crews[0].browser} on ${crews[0].os}, mic ${crews[0].mic}"` : '');

    await seatChecks(a, b, 'local network');
    await driveChecks(a, b, 'local network');
    await turretChecks(a, b, 'local network');
    await firingChecks(a, b, 'local network');
    await lobbyChecks(browser, a, b);

    const motion = await measureMotion(a, b, 3);
    report.local = { ...(await netStats(b.page)), motion };
    check('Crewmate moves smoothly (local network)',
      motion.frames >= 20 && motion.backwards === 0 && motion.maxRate < Math.max(3, motion.median * 4) && motion.radiusError < 0.02,
      `${motion.frames} frames, ${motion.backwards} backward steps ${motion.backSteps.join(' ')}, fastest ${motion.maxRate.toFixed(2)} rad/s vs median ${motion.median.toFixed(2)}, longest frame ${motion.maxGapMs.toFixed(0)} ms, off circle by ${(motion.radiusError * 1000).toFixed(1)} mm`);
    const s = report.local;
    check('Round trip measured', Number.isFinite(s.srtt) && s.srtt < 50, `RTT ${s.srtt?.toFixed(1)} ms, route ${s.route}, connected in ${s.connectMs.toFixed(0)} ms`);
    check('Pose packets arrive at about 45 Hz with no loss', s.lost === 0 && s.received > 100, `${s.received} received, ${s.lost} lost`);

    // Host leaves: Bo becomes host and Ann can come back.
    await a.context.close();
    await waitFor('Bo to be told the crewmate left', async () => (await state(b.page)) === 'waiting');
    const boHost = await b.page.evaluate(() => window.__net.session.isHost);
    check('The remaining player becomes host', boHost);
    const left = await waitForCrew(b.page, 'waiting');
    check('The game waits for a crewmate who left', left !== null && left.paused && left.signVisible, left ? `"${left.message}"` : '');
    const a2 = await openPlayer(browser, `room=${room}&name=Ann`);
    await waitFor('reconnected', async () => (await state(a2.page)) === 'connected' && (await state(b.page)) === 'connected');
    check('A player can rejoin', true);
    await waitForPoses([a2, b]);

    // Bo, the gunner, became host and keeps that seat; Ann comes back as the driver.
    await seatChecks(b, a2, 'after a rejoin', 'gunner');
    await lifecycleChecks(b, a2);
    await a2.context.close();
    await b.context.close();
    await b.context.close();

    // The plan's worst playable case: about 150 ms RTT (60 ms each way plus
    // 0 to 20 ms jitter on each side, which also reorders packets) and 1% loss.
    const lag = 'netlag=60&netjitter=20&netloss=0.01&voiceloop=1';
    const d = await openPlayer(browser, `room=LAGS&name=Di&${lag}`);
    const e = await openPlayer(browser, `room=LAGS&name=Ed&${lag}`);
    await waitFor('lagged pair connected', async () => (await state(d.page)) === 'connected' && (await state(e.page)) === 'connected');
    await waitForPoses([d, e]);
    await new Promise((r) => setTimeout(r, 2500)); // let RTT and jitter settle
    const lagMotion = await measureMotion(d, e, 3);
    report.lagged = { ...(await netStats(e.page)), motion: lagMotion };
    const l = report.lagged;
    check('RTT reflects simulated lag', l.srtt > 115 && l.srtt < 200, `RTT ${l.srtt.toFixed(1)} ms, arrival jitter ${l.arrivalJitterMs.toFixed(1)} ms, packet interval ${l.packetIntervalMs.toFixed(1)} ms, render delay ${l.renderDelayMs.toFixed(0)} ms`);
    check('Crewmate moves smoothly (simulated lag and jitter)',
      lagMotion.frames >= 20 && lagMotion.backwards === 0 && lagMotion.maxRate < Math.max(3, lagMotion.median * 4) && lagMotion.radiusError < 0.02,
      `${lagMotion.frames} frames, ${lagMotion.backwards} backward steps ${lagMotion.backSteps.join(' ')}, fastest ${lagMotion.maxRate.toFixed(2)} rad/s vs median ${lagMotion.median.toFixed(2)}, longest frame ${lagMotion.maxGapMs.toFixed(0)} ms`);

    const loopVoice = await peakVoiceLevel(e.page, 2500);
    const loopActive = await e.page.evaluate(() => window.__net.voice.loopbackActive);
    check('Voice through the loopback route', loopActive && loopVoice > 0.01, `loopback ${loopActive}, peak level ${loopVoice.toFixed(3)}`);

    await seatChecks(d, e, '150 ms RTT');
    await driveChecks(d, e, '150 ms RTT');
    await turretChecks(d, e, '150 ms RTT');
    await firingChecks(d, e, '150 ms RTT');

    await d.context.close();
    await e.context.close();
    const botErrors = await botChecks(browser);

    const errors = [...a.errors, ...b.errors, ...d.errors, ...e.errors, ...botErrors].filter(
      (m) => !m.includes('net::ERR_') && !m.includes('Failed to load resource'),
    );
    check('No console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/net-report.json', JSON.stringify({ report, results }, null, 2));
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(`ERROR  ${error.message}`);
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::error title=Net test aborted::${error.message}`.replace(/\r?\n/g, ' '));
    }
    process.exitCode = 1;
  })
  .finally(() => {
    // Each server runs in its own process group so npx's children stop too.
    for (const child of children) {
      try {
        process.kill(-child.pid);
      } catch {
        // already gone
      }
    }
  });
