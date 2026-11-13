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
 * - the range run (F1.11): a guest's Start runs the host's run on both
 *   pages' clocks, the host driver's Ready to fire lays and loads the guest
 *   gunner's gun, and the guest's hit counts on both, on a clean link and
 *   at 150 ms RTT;
 * - the tank's sounds (F1.12): the intercom plays plain, the tank's sounds
 *   duck while someone speaks, and both pages hear the loading and the shot;
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
// Random parts off (the gun's scatter, the biathlon's ranges picked each race): their own checks turn them on.
const QUIET = 'hud=0&ground=0&scatter=0&boardranges=0';

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
  // The engine already running (F1.17's Running setting) unless a check asks for another: these checks are about the crew.
  await page.goto(`${BASE}?${QUIET}&${query}${query.includes('engine=') ? '' : '&engine=running'}`);
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
    // When each packet went out, by the sender's clock (the last few hundred).
    const sends = (window.__testSends = []);
    // Evaluated at send time, so each packet's timestamp matches its pose.
    window.__net.setTestPose((now) => {
      sends.push(now);
      if (sends.length > 400) sends.shift();
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
  const before = await netStats(receiver.page);
  const sentFrom = await sender.page.evaluate(() => performance.now());
  // At least `seconds`, and on a slow runner (from six frames a second down to two) on until there are enough
  // frames to judge, up to ten times as long: the checks need 20 of them.
  const samples = await receiver.page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        const start = performance.now();
        const frame = () => {
          const p = window.__net.remotePose();
          if (p) out.push([p.head.px, p.head.pz, performance.now(), window.__net.remoteAtMs]);
          const took = performance.now() - start;
          if (took < ms || (out.length < 25 && took < ms * 10)) requestAnimationFrame(frame);
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
  // How far off the circle a drawn pose may be. The receiver draws straight lines between the poses it was sent,
  // and a straight line between two points of a circle cuts inside it: by 0.03 mm for packets 22 ms apart (45 Hz,
  // a headset), by 9 mm for packets 375 ms apart (a page sends one with each frame, and a slow runner draws a
  // frame that seldom), by 35 mm when one of those is lost. That much is geometry, not judder, so the 20 mm
  // allowance grows with the widest gap between the packets the receiver had to draw from: the sender's own
  // record of when it sent them, a lost packet joining the gaps on either side of it.
  const after = await netStats(receiver.page);
  const sends = await sender.page.evaluate(() => window.__testSends);
  const lost = Math.max(0, after.lost - before.lost);
  // The receiver draws the past, so the first frames were drawn from packets sent before the sampling began.
  const from = sentFrom - Math.max(before.renderDelayMs, after.renderDelayMs) - 100;
  let first = sends.findIndex((t) => t > from);
  first = Math.max(0, (first < 0 ? sends.length : first) - 1);
  let packetGapMs = 0;
  for (let i = first; i + 1 + lost < sends.length; i++) {
    packetGapMs = Math.max(packetGapMs, sends[i + 1 + lost] - sends[i]);
  }
  const chord = 0.5 * (1 - Math.cos(packetGapMs / 2000)); // 0.5 m circle at 1 rad/s
  const radiusAllowed = Math.max(0.02, chord + 0.01);
  return { frames: samples.length, backwards, backSteps, maxRate, median, maxGapMs, radiusError, radiusAllowed, packetGapMs, lost };
}

/** What a motion check found, for its line in the log. */
function motionDetail(m) {
  return `${m.frames} frames, ${m.backwards} backward steps ${m.backSteps.join(' ')}, fastest ${m.maxRate.toFixed(2)} rad/s vs median ${m.median.toFixed(2)}, ` +
    `longest frame ${m.maxGapMs.toFixed(0)} ms, off circle by ${(m.radiusError * 1000).toFixed(1)} mm ` +
    `(${(m.radiusAllowed * 1000).toFixed(0)} mm allowed: packets up to ${m.packetGapMs.toFixed(0)} ms apart, ${m.lost} lost)`;
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
 * What the tank sounds put out (the audio graph's own output, after the duck)
 * with nobody speaking and then with someone speaking: the page's voice
 * levels are held at silence, then at a speaking level, and the output
 * measured once the duck has settled each way.
 */
function measureDuckedOutput(page) {
  return page.evaluate(async () => {
    const voice = window.__net.voice;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const settle = async (ok) => {
      const end = performance.now() + 20000;
      while (!ok(window.__audio.state().duckGain) && performance.now() < end) await sleep(50);
      await sleep(300);
    };
    const average = async (ms) => {
      let sum = 0;
      let n = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        sum += window.__audio.outputLevel();
        n++;
        await sleep(25);
      }
      return sum / n;
    };
    try {
      voice.micLevel = () => 0;
      voice.remoteLevel = () => 0;
      await settle((g) => g > 0.99);
      const quiet = await average(2000);
      voice.micLevel = () => 0.05;
      await settle((g) => g < 0.255);
      const ducked = await average(2000);
      return { quiet, ducked, db: 20 * Math.log10(ducked / quiet), engineHz: window.__audio.state().engineHz };
    } finally {
      delete voice.micLevel;
      delete voice.remoteLevel;
    }
  });
}

/**
 * The furthest the tank's sounds duck for the intercom over `ms`, dB (F1.12),
 * as the audio graph's own gain has it: what the player hears, not just
 * what the duck worked out.
 */
function deepestDuck(page, ms) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let deepest = 0;
        const end = performance.now() + duration;
        const tick = () => {
          deepest = Math.min(deepest, 20 * Math.log10(Math.max(1e-6, window.__audio.state().duckGain)));
          if (performance.now() < end) setTimeout(tick, 20);
          else resolve(deepest);
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
const HIPS = { driver: [-0.5, 0.56, -1.41], gunner: [0.4, 1.27, 0.16] };

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

  // The driver's convoy position (docs/convoy-seat.md): the driver raises their seat and the gunner's page draws them
  // raised, their hatch's lid open; lowered, back as before.
  const [driver, gunner] = hostSeat === 'driver' ? [host, guest] : [guest, host];
  const raisedOnGunner = () => gunner.page.evaluate(() => ({
    crew: window.__convoy.state().crew,
    lid: window.__interior.state().lids.driver,
    legs: window.__debug.world.scene.getObjectByName('Crew 2 Legs')?.position.toArray(),
  }));
  for (const up of [true, false]) {
    await driver.page.evaluate((u) => window.__convoy.headOut(u), up);
    const seen = await waitFor(`the gunner's page to draw the driver's seat ${up ? 'raised' : 'lowered'}`, async () => {
      const g = await raisedOnGunner();
      const lift = g.legs ? g.legs[1] - HIPS.driver[1] : NaN;
      return g.crew === up && (up ? lift > 0.25 && g.lid : Math.abs(lift) < 0.01) ? g : null;
    }, 8000).catch(() => null);
    check(`The driver ${up ? 'raising' : 'lowering'} their seat to ${up ? 'drive head out' : 'drive closed down'}: the gunner's page draws them ${up ? 'raised, their lid open' : 'back in the seat'} (${label})`,
      seen !== null, JSON.stringify(seen ?? await raisedOnGunner()));
    if (up) {
      // No gun stop for now (John, 2026-11-08): the gunner's turret turns past the head-out driver's hatch, on both pages.
      await gunner.page.evaluate(() => { window.__turret.forward(); window.__turret.crank(10); });
      const turrets = () => Promise.all([gunner, driver].map((p) => p.page.evaluate(() => ({ yaw: window.__turret.state().yawDeg, stops: window.__turret.headOutStops }))));
      const turned = await waitFor('the turret turned 20° left on both pages', async () => {
        const [g, d] = await turrets();
        return g.stops === 0 && g.yaw > 19 && Math.abs(d.yaw - g.yaw) < 0.5 ? [g, d] : null;
      }, 8000).catch(() => null);
      check(`With the driver's head out, the gunner's crank still turns the turret 20° left past their hatch, on both pages (${label})`,
        turned !== null, JSON.stringify(turned ?? await turrets()));
      await gunner.page.evaluate(() => window.__turret.forward());
    }
  }
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
  // F1.17: with the engine stopped, the guest driver holds the starter; the host's engine cranks and catches, and both see it run.
  await host.page.evaluate(() => window.__drive.engine('stop'));
  await waitFor('both to see the engine stopped', async () => !(await tank(host)).running && !(await tank(guest)).running, 8000).catch(() => null);
  await guest.page.evaluate(() => window.__drive.set({ starter: true }));
  let cranked = false;
  const started = await waitFor('the guest\'s starter to start the host\'s engine', async () => {
    const [h, g] = await Promise.all([tank(host), tank(guest)]);
    cranked ||= h.cranking || g.cranking;
    return h.running && g.running ? { h, g } : null;
  }, 10000).catch(() => null);
  await guest.page.evaluate(() => window.__drive.set(null));
  check(`The guest driver's starter cranks the host's engine and it catches, both seeing it run (${label})`, started !== null && cranked,
    started ? `${started.h.rpm.toFixed(0)} rpm on the host, ${started.g.rpm.toFixed(0)} drawn by the guest` : JSON.stringify(await tank(host)));
  // F1.18: the guest driver's parking brake reaches the host: the tank stays put and the host's lamp lights.
  await guest.page.evaluate(() => window.__drive.set({ left: 1, right: 1, parkingBrake: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const held = { t: await tank(host), lamp: await host.page.evaluate(() => window.__driverStation.engine().lamps.brake) };
  check(`The guest driver's parking brake holds the host's tank against the tillers, the host's lamp lit (${label})`,
    Math.abs(held.t.speed) < 0.01 && held.lamp, `${held.t.speed.toFixed(2)} m/s, lamp ${held.lamp}`);
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
    return st.angles.tillerLeft > 15 && st.angles.tillerRight > 15 ? st : null;
  }, 5000).catch(() => null);
  check(`The host's page draws the guest driver's tillers where the guest pushed them (${label})`, hostSees !== null,
    hostSees ? `${hostSees.angles.tillerLeft.toFixed(1)}° and ${hostSees.angles.tillerRight.toFixed(1)}°` : JSON.stringify(await host.page.evaluate(() => window.__driverStation.state().angles)));
  // The periscopes (F1.6, F1.19): each seat's page owns its own. The guest driver's is drawn turned on the host's page and
  // the host gunner's on the guest's; the host's Ahead turns its own and asks the guest's page to turn the driver's.
  const periscope = (p, id) => p.page.evaluate((which) => window.__periscope[which].state(), id);
  await guest.page.evaluate(() => window.__periscope.driver.turn(60));
  await host.page.evaluate(() => window.__periscope.gunner.turn(-40));
  const scoped = await waitFor('each page to draw the other\'s periscope turned', async () => {
    const [hd, gd, hg, gg] = await Promise.all([periscope(host, 'driver'), periscope(guest, 'driver'), periscope(host, 'gunner'), periscope(guest, 'gunner')]);
    return gd.owner && !hd.owner && hg.owner && !gg.owner && Math.abs(hd.angleDeg - 60) < 0.5 && Math.abs(gd.angleDeg - 60) < 0.01 && Math.abs(gg.angleDeg + 40) < 0.5 && Math.abs(hg.angleDeg + 40) < 0.01
      ? { hd, gd, hg, gg } : null;
  }, 5000).catch(() => null);
  check(`Each page draws the other seat's periscope turned where its owner turned it (${label})`, scoped !== null,
    scoped ? `the host draws the driver's at ${scoped.hd.angleDeg.toFixed(2)}° for ${scoped.gd.angleDeg.toFixed(2)}° (${scoped.hd.received} packets), the guest the gunner's at ${scoped.gg.angleDeg.toFixed(2)}° for ${scoped.hg.angleDeg.toFixed(2)}° (${scoped.gg.received} packets)`
      : JSON.stringify(await Promise.all([periscope(host, 'driver'), periscope(guest, 'driver'), periscope(host, 'gunner'), periscope(guest, 'gunner')])));
  await host.page.evaluate(() => window.__gameMenu.click('menu-periscope-ahead'));
  const scopeAhead = await waitFor('both periscopes ahead', async () => {
    const [hd, gd, hg, gg] = await Promise.all([periscope(host, 'driver'), periscope(guest, 'driver'), periscope(host, 'gunner'), periscope(guest, 'gunner')]);
    return Math.abs(gd.angleDeg) < 0.01 && Math.abs(hd.angleDeg) < 0.5 && Math.abs(hg.angleDeg) < 0.01 && Math.abs(gg.angleDeg) < 0.5 ? hd : null;
  }, 5000).catch(() => null);
  check(`The gunner's Sights → Periscopes → Ahead turns both periscopes ahead on both pages (${label})`, scopeAhead !== null,
    scopeAhead ? '' : JSON.stringify(await Promise.all([periscope(host, 'driver'), periscope(guest, 'driver'), periscope(host, 'gunner'), periscope(guest, 'gunner')])));
  // How smoothly the guest draws it: the distance driven, frame by frame, never goes back or jumps.
  const steps = await guest.page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const start = performance.now();
    const frame = () => {
      out.push(window.__drive.state().odometer);
      // 2 s, and on a slow runner (four or five frames a second) on until there are enough frames to judge, up to 6 s.
      const took = performance.now() - start;
      if (took < 2000 || (out.length < 16 && took < 6000)) requestAnimationFrame(frame);
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
    return st.angles.tillerLeft > 15 && st.angles.throttle > 35 && Math.abs(gauges.rpm - h.rpm) < 200 ? { st, gauges, h } : null;
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
  // When the gunner's page last began a frame, to know how old a reading of its turret is.
  await guest.page.evaluate(() => {
    if (window.__frameAt !== undefined) return;
    const tick = () => {
      window.__frameAt = performance.now();
      requestAnimationFrame(tick);
    };
    tick();
  });
  await guest.page.evaluate(() => window.__turret.set({ traverse: 1 }));
  const turning = await waitFor('the host to see the turret turn', async () => {
    const [h, g] = await Promise.all([
      turret(host),
      guest.page.evaluate(() => ({ ...window.__turret.state(), frameAgeMs: performance.now() - window.__frameAt })),
    ]);
    return h.yawDeg > 3 ? { h, g } : null;
  }, 15000).catch(() => null);
  // The two pages are read at nearly the same moment, not the same one: on a clean link the host can be a few
  // milliseconds further on (3.57° to the gunner's 3.52° at 6°/s), so it may lead by up to 0.1 s of turning.
  // That is against where the gunner's turret is now, and its page only knows where it was at its last frame: the
  // host carries the turret on at its rate between the gunner's packets. On a slow runner the gunner's frames are
  // 400 ms apart, so the host may also lead by the turning since the frame the gunner's reading comes from.
  const lead = turning ? turning.h.yawDeg - turning.g.yawDeg : 0;
  check(`The gunner's power traverse turns the turret on the gunner's page at once, and the host sees it close behind (${label})`,
    turning !== null && lead <= turning.g.rateDeg * (0.1 + turning.g.frameAgeMs / 1000) && -lead < turning.g.rateDeg * 0.6 + 0.5,
    turning ? `gunner ${turning.g.yawDeg.toFixed(2)}° at ${turning.g.rateDeg.toFixed(1)}°/s, its frame ${turning.g.frameAgeMs.toFixed(0)} ms old; host draws ${turning.h.yawDeg.toFixed(2)}°` : JSON.stringify(await Promise.all([turret(host), turret(guest)])));
  // How smoothly the host draws it: frame by frame it never goes back or jumps.
  const steps = await host.page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const start = performance.now();
    const frame = () => {
      out.push(window.__turret.state().yaw);
      // 2 s, and on a slow runner (four or five frames a second) on until there are enough frames to judge, up to 6 s.
      const took = performance.now() - start;
      if (took < 2000 || (out.length < 16 && took < 6000)) requestAnimationFrame(frame);
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

  // The driver's turret dial (F2.3): the driver's Practice To 3 o'clock asks the gunner's page, which turns the
  // turret there by itself; both dials read 3, the driver's following the gunner's turret.
  const dial = (p) => p.page.evaluate(() => window.__turretDial.state());
  await host.page.evaluate(() => window.__gameMenu.click('menu-turret-dial'));
  const atThree = await waitFor('both dials at 3 o\'clock', async () => {
    const [h, g] = await Promise.all([dial(host), dial(guest)]);
    return h.hour === 3 && g.hour === 3 && !g.traversing && Math.abs(g.turretDeg + 90) < 0.1 && Math.abs(h.pointerDeg - h.turretDeg) < 0.01 && Math.abs(h.turretDeg + 90) < 0.5 ? { h, g } : null;
  }, 20000).catch(() => null);
  check(`The driver's To 3 o'clock turns the gunner's turret there, and the driver's dial reads 3 o'clock (${label})`, atThree !== null,
    atThree ? `gunner ${atThree.g.turretDeg.toFixed(2)}°, driver's pointer ${atThree.h.pointerDeg.toFixed(2)}°` : JSON.stringify(await Promise.all([dial(host), dial(guest)])));
  await host.page.evaluate(() => window.__gameMenu.click('menu-turret-forward'));
  await waitFor('the turret forward again', async () => {
    const [h, g] = await Promise.all([turret(host), turret(guest)]);
    return Math.abs(h.yaw) < 1e-3 && Math.abs(g.yaw) < 1e-3;
  }, 8000).catch(() => null);

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
  const heard0 = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__audio.state().heard)));
  await waitFor('the guest to own the loading with every shell in the rack', async () => {
    const g = await drill(guest);
    return g.owner && !(await drill(host)).owner && g.shells.every((s) => s.place === 'rack') && g.lever === 0;
  }, 8000);
  // The right hand's path, hull space: take shell 0 near its base, put its nose
  // to the breech mouth, ram it, then pull the lever back a quarter turn.
  // The nose waits a second at the mouth: the breech takes the shell only while
  // its nose is within a few centimetres of the mouth, and a runner's slow frame
  // (300 ms and more) could pass that by on the way in ("Fumbles 1").
  // The hand closes on the lever and holds still for half a second before pulling, pulls a little past
  // closed and keeps hold a second: a slow frame as the hand closed took hold part-way along the pull,
  // so the lever stopped short by the angle missed (1.46 and 1.48 rad on PR #81's runs).
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
      [2, noseAt(0.25, 0.05, 0.05), true], [2.8, noseAt(0, 0, 0.03), true], [3.8, noseAt(0, 0, 0.03), true], [5, noseAt(0, 0, -0.63), true], [5.5, noseAt(0, 0, -0.63), false],
      [6.2, handleAt(0), false], [6.7, handleAt(0), true], [7.2, handleAt(0), true], [8.7, handleAt(2), true], [9.7, handleAt(2), true], [10.2, handleAt(2), false], [10.9, rest, false],
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
  // F1.12: both pages hear the loading and the shot, each from the loading and the shot as it draws them.
  const heardBy = (h, h0) => ['ram', 'breech', 'shot', 'casing'].filter((id) => h[id] > h0[id]);
  const heard = await waitFor('both pages to hear the loading and the shot', async () => {
    const h = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__audio.state().heard)));
    return heardBy(h[0], heard0[0]).length === 4 && heardBy(h[1], heard0[1]).length === 4 ? h : null;
  }, 5000).catch(() => Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__audio.state().heard))));
  check(`Both crew hear the shell rammed, the breech closing, the shot and the casing (${label})`,
    heardBy(heard[0], heard0[0]).length === 4 && heardBy(heard[1], heard0[1]).length === 4,
    `driver heard ${heardBy(heard[0], heard0[0]).join(', ') || 'nothing'}; gunner heard ${heardBy(heard[1], heard0[1]).join(', ') || 'nothing'}`);
  await guest.page.evaluate(() => window.__turret.forward());
  await ammoChecks(host, guest, label);
}

/**
 * Ammunition types (F3.1), with the guest in the gunner's seat: the host
 * driver fills the rack with smoke and the gunner's page takes it; the
 * gunner fires a smoke round at the 250 m gun, which neither page counts
 * as a hit, and both lay its screen; then an HE round bursting beside the
 * gun, which the host counts by its blast and the gunner takes its word.
 */
async function ammoChecks(host, guest, label) {
  const drill = (p) => p.page.evaluate(() => window.__loading.state());
  const state = (p) => p.page.evaluate(() => ({ records: window.__firing.records(), hits: window.__firing.hits()[1], clouds: window.__smoke.clouds().length }));
  await host.page.evaluate(() => window.__loading.setRack('smoke'));
  const racked = await waitFor("the gunner's rack to fill with smoke", async () => {
    const [h, g] = await Promise.all([drill(host), drill(guest)]);
    return g.rack === 'smoke' && g.kinds.every((k) => k === 'smoke') && h.kinds.every((k) => k === 'smoke') ? { h, g } : null;
  }, 8000).catch(() => null);
  check(`The driver's Ammunition rack reaches the gunner's page, and both draw the rack's rounds (${label})`, racked !== null,
    racked ? '' : JSON.stringify(await Promise.all([host, guest].map(async (p) => { const d = await drill(p); return { rack: d.rack, kinds: d.kinds }; }))));

  const fireRound = async (ammo, right, above) => {
    const before = await Promise.all([host, guest].map(state));
    await guest.page.evaluate(([k, r, a]) => {
      window.__loading.loadNow(k);
      window.__firing.aimAt(1, k, r, a);
    }, [ammo, right, above]);
    await waitFor('the host to draw the gun laid', async () => {
      const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__turret.state())));
      return Math.abs(h.yaw - g.yaw) < 1e-4 && Math.abs(h.elevation - g.elevation) < 1e-4;
    }, 8000).catch(() => null);
    await guest.page.evaluate(() => window.__turret.pullTrigger());
    return waitFor(`both pages to see the ${ammo} round decided`, async () => {
      const [h, g] = await Promise.all([host, guest].map(state));
      const hr = h.records[before[0].records.length];
      const gr = g.records[before[1].records.length];
      return hr && gr && gr.line !== '' && (ammo !== 'smoke' || (h.clouds > before[0].clouds && g.clouds > before[1].clouds))
        ? { h, g, hr, gr, before } : null;
    }, 15000).catch(() => null);
  };

  const smoke = await fireRound('smoke', 0, 0);
  check(`A smoke round on the gun counts no hit, and both pages lay its screen (${label})`,
    smoke !== null && smoke.hr.ammo === 'smoke' && smoke.gr.ammo === 'smoke' && smoke.hr.counted === -1 && smoke.gr.counted === -1
      && smoke.h.hits === smoke.before[0].hits && smoke.gr.line.startsWith('Smoke'),
    smoke ? `host "${smoke.hr.line}", gunner "${smoke.gr.line}", clouds ${smoke.h.clouds}/${smoke.g.clouds}`
      : JSON.stringify(await Promise.all([host, guest].map(state))));

  await host.page.evaluate(() => window.__loading.setRack('mixed'));
  await waitFor("the gunner's rack mixed again", async () => (await drill(guest)).rack === 'mixed', 8000).catch(() => null);
  const he = await fireRound('he', 3, -1.15);
  check(`An HE round bursting beside the gun: the host counts it by its blast and the gunner takes its word (${label})`,
    he !== null && he.hr.ammo === 'he' && he.hr.kind === 'ground' && he.hr.counted === 1 && he.gr.counted === 1
      && he.h.hits === he.before[0].hits + 1 && he.g.hits === he.h.hits && /^HE burst \d m from the 250 m gun: hit$/.test(he.gr.line),
    he ? `host "${he.hr.line}", gunner "${he.gr.line}", hits ${he.h.hits}/${he.g.hits}` : JSON.stringify(await Promise.all([host, guest].map(state))));
  await guest.page.evaluate(() => window.__turret.forward());
  await enemyChecks(host, guest, label);
  await enemyTankChecks(host, guest, label);
  await damageChecks(host, guest, label);
}

/**
 * Enemy anti-tank guns (F3.2) with the guest in the gunner's seat: the host
 * starts the battery with the tank where gun A first sees it, and both
 * pages draw the guns; a shot the host's gun A fires reaches the guest's
 * page with the same outcome; the guest's AP on gun A's shield knocks it
 * out on both pages; Stop takes the guns away on both.
 */
async function enemyChecks(host, guest, label) {
  const enemy = (p) => p.page.evaluate(() => window.__enemy.state());
  const was = await host.page.evaluate(() => window.__drive.state());
  await host.page.evaluate(() => {
    window.__drive.place(0, -80, 0);
    window.__enemy.start(1);
  });
  const started = await waitFor('both pages to draw the guns', async () => {
    const [h, g] = await Promise.all([enemy(host), enemy(guest)]);
    return h.on && g.on && g.guns.slice(0, 3).every((x) => x.drawn) && g.faceOff.slice(0, 3).every((off) => !off) ? { h, g } : null;
  }, 8000).catch(() => null);
  check(`The host's enemy guns appear on both pages, their shields there to hit (${label})`, started !== null,
    started ? '' : JSON.stringify(await Promise.all([host, guest].map(enemy))));

  const shotsBefore = (await guest.page.evaluate(() => window.__enemy.shots())).length;
  await host.page.evaluate(() => window.__enemy.fireNow(0));
  const shot = await waitFor("gun A's shot on both pages", async () => {
    const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__enemy.shots())));
    return g.length > shotsBefore && h.length > 0 ? { h: h[h.length - 1], g: g[g.length - 1] } : null;
  }, 8000).catch(() => null);
  check(`A shot from the host's gun A reaches the guest with the same outcome (${label})`,
    shot !== null && shot.g.gun === 0 && shot.g.hit === shot.h.hit && Math.abs(shot.g.to[0] - shot.h.to[0]) < 1e-6,
    shot ? `${shot.h.hit ? 'hit' : 'miss'} from ${Math.round(shot.h.range)} m at ${shot.h.clock} o'clock` : 'no shot');

  const records = (p) => p.page.evaluate(() => window.__firing.records());
  const before = (await records(host)).length;
  // The guest lays from where its page has the tank: wait for the place to reach it (at 150 ms RTT it can still be at the start).
  await waitFor("the guest to have the tank parked at gun A's spot", async () => {
    const t = await guest.page.evaluate(() => window.__drive.state());
    return Math.hypot(t.x, t.z + 80) < 0.5 && Math.abs(t.speed) < 0.05;
  }, 8000).catch(() => null);
  await guest.page.evaluate(() => {
    window.__loading.loadNow('ap');
    window.__firing.aimAt(9, 'ap');
  });
  await waitFor('the host to draw the gun laid on gun A', async () => {
    const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__turret.state())));
    return Math.abs(h.yaw - g.yaw) < 1e-4 && Math.abs(h.elevation - g.elevation) < 1e-4;
  }, 8000).catch(() => null);
  await guest.page.evaluate(() => window.__turret.pullTrigger());
  const out = await waitFor('gun A knocked out on both pages', async () => {
    const [h, g] = await Promise.all([enemy(host), enemy(guest)]);
    return !h.alive[0] && !g.alive[0] && g.faceOff[0] ? { h, g } : null;
  }, 15000).catch(() => null);
  const record = (await records(host))[before];
  check(`The guest gunner's AP on gun A's shield knocks it out on both pages (${label})`,
    out !== null && record?.counted === 9 && out.g.alive[1] && out.g.alive[2],
    `${record ? `host "${record.line}"` : 'no shot'}, alive ${JSON.stringify(out?.g.alive ?? (await enemy(guest)).alive)}`);

  await host.page.evaluate(() => window.__enemy.stop());
  const stopped = await waitFor('the guns gone on both pages', async () => {
    const g = await enemy(guest);
    return !g.on && g.guns.every((x) => !x.drawn) && g.faceOff.every(Boolean) ? g : null;
  }, 8000).catch(() => null);
  check(`Stop takes the enemy guns away on both pages (${label})`, stopped !== null);
  await guest.page.evaluate(() => window.__turret.forward());
  await host.page.evaluate(([x, z, h]) => window.__drive.place(x, z, h), [was.x, was.z, was.heading]);
}

/**
 * Enemy tanks (F3.3): the host's tanks drive on both pages, close
 * together; the guest's Meet B has the host place tank B and park the
 * tank; the guest gunner's AP knocks tank B out on both pages; Stop takes
 * them away on both.
 */
async function enemyTankChecks(host, guest, label) {
  const enemy = (p) => p.page.evaluate(() => window.__enemy.state());
  const A = 3;
  const B = 4;
  const was = await host.page.evaluate(() => window.__drive.state());
  await host.page.evaluate(() => {
    window.__drive.place(0, 0, 0);
    window.__enemy.start(2, 'tanks');
  });
  const started = await waitFor('both pages to draw the tanks driving', async () => {
    const [h, g] = await Promise.all([enemy(host), enemy(guest)]);
    return g.present[A] && g.guns[A].drawn && g.guns[B].drawn && !g.faceOff[A] && g.guns[A].moving && h.guns[A].along > 2 ? { h, g } : null;
  }, 10000).catch(() => null);
  const [h1, g1] = await Promise.all([enemy(host), enemy(guest)]);
  const apart = Math.hypot(h1.guns[A].x - g1.guns[A].x, h1.guns[A].z - g1.guns[A].z);
  check(`The host's enemy tanks drive on both pages, drawn within a few metres of each other (${label})`, started !== null && apart < 6,
    `tank A ${apart.toFixed(1)} m apart (host ${h1.guns[A].along.toFixed(1)} m along, guest ${g1.guns[A].along.toFixed(1)} m)`);

  await guest.page.evaluate(() => window.__enemy.meetTank(1));
  const met = await waitFor("the guest's Meet B on both pages", async () => {
    const [h, g] = await Promise.all([enemy(host), enemy(guest)]);
    const t = await guest.page.evaluate(() => window.__drive.state());
    return Math.abs(t.z + 300) < 1 && h.guns[B].sees && !g.guns[B].moving ? { h, g } : null;
  }, 15000).catch(() => null);
  check(`The guest's Meet B parks the tank where tank B sees it, and tank B halts on both pages (${label})`, met !== null,
    met ? '' : JSON.stringify((await enemy(guest)).guns[B]));
  await host.page.evaluate((i) => window.__enemy.hold(i, true), B);

  const records = (p) => p.page.evaluate(() => window.__firing.records());
  const before = (await records(host)).length;
  await guest.page.evaluate((t) => {
    window.__loading.loadNow('ap');
    window.__firing.aimAt(t, 'ap');
  }, 9 + B);
  await waitFor('the host to draw the gun laid on tank B', async () => {
    const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__turret.state())));
    return Math.abs(h.yaw - g.yaw) < 1e-4 && Math.abs(h.elevation - g.elevation) < 1e-4;
  }, 8000).catch(() => null);
  await guest.page.evaluate(() => window.__turret.pullTrigger());
  const out = await waitFor('tank B knocked out on both pages', async () => {
    const [h, g] = await Promise.all([enemy(host), enemy(guest)]);
    return !h.alive[B] && !g.alive[B] && g.faceOff[B] ? { h, g } : null;
  }, 15000).catch(() => null);
  const record = (await records(host))[before];
  check(`The guest gunner's AP on tank B knocks it out on both pages (${label})`,
    out !== null && record?.counted === 9 + B && out.g.alive[A],
    `${record ? `host "${record.line}"` : 'no shot'}, alive ${JSON.stringify(out?.g.alive ?? (await enemy(guest)).alive)}`);

  await host.page.evaluate(() => window.__enemy.stop('tanks'));
  const stopped = await waitFor('the tanks gone on both pages', async () => {
    const g = await enemy(guest);
    return !g.present[A] && !g.present[B] && !g.guns[A].drawn && !g.guns[B].drawn && g.faceOff[B] ? g : null;
  }, 8000).catch(() => null);
  check(`Stop takes the enemy tanks away on both pages (${label})`, stopped !== null);
  await guest.page.evaluate(() => window.__turret.forward());
  await host.page.evaluate(([x, z, h]) => window.__drive.place(x, z, h), [was.x, was.z, was.heading]);
}

/**
 * The damage model (F3.4) with the guest as gunner: the host's turret hit
 * knocks out the guest's power traverse; the guest's practice hit on
 * their own crewman wounds the gunner on both pages, the red only on the
 * guest's; the host's engine hits stop the engine on both; the guest's
 * Repair mends it all on both.
 */
async function damageChecks(host, guest, label) {
  const damage = (p) => p.page.evaluate(() => window.__damage.state());
  await host.page.evaluate(() => window.__damage.test('turret'));
  await waitFor("the guest to hear the traverse is out", async () => (await damage(guest)).traverse, 8000).catch(() => null);
  const yaw0 = await guest.page.evaluate(() => window.__turret.state().yaw);
  await guest.page.evaluate(() => window.__turret.set({ traverse: 1 }));
  await new Promise((r) => setTimeout(r, 1500));
  const yaw1 = await guest.page.evaluate(() => window.__turret.state().yaw);
  await guest.page.evaluate(() => window.__turret.set(null));
  check(`The host's turret hit knocks out the guest gunner's power traverse (${label})`, (await damage(guest)).traverse && Math.abs(yaw1 - yaw0) < 1e-3,
    `turned ${(yaw1 - yaw0).toFixed(4)} rad`);

  await guest.page.evaluate(() => window.__damage.test('crew'));
  const wound = await waitFor('the gunner wounded on both pages', async () => {
    const [h, g] = await Promise.all([damage(host), damage(guest)]);
    return h.gunner === 1 && g.gunner === 1 && g.dark > 0 ? { h, g } : null;
  }, 8000).catch(() => null);
  check(`The guest's own practice hit wounds the gunner on both pages, the red over the guest's eyes only (${label})`,
    wound !== null && wound.h.dark === 0, wound ? `guest dark ${wound.g.dark.toFixed(2)}, host dark ${wound.h.dark}` : JSON.stringify(await damage(guest)));

  await host.page.evaluate(() => { window.__damage.test('engine'); window.__damage.test('engine'); });
  const dead = await waitFor('the engine stopped on both pages', async () => {
    const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__drive.state())));
    return !h.running && !g.running && g.stallCause === 'hit' && (await damage(guest)).engine === 2 ? g : null;
  }, 8000).catch(() => null);
  check(`Two engine hits on the host stop the engine on both pages (${label})`, dead !== null);

  await guest.page.evaluate(() => window.__damage.repair());
  const mended = await waitFor('repaired on both pages', async () => {
    const [h, g] = await Promise.all([damage(host), damage(guest)]);
    const t = await guest.page.evaluate(() => window.__drive.state());
    return h.hits === 0 && g.hits === 0 && !g.traverse && t.running ? g : null;
  }, 8000).catch(() => null);
  check(`The guest's Repair mends it all on both pages, the engine running again (${label})`, mended !== null);
}

/**
 * The range run (F1.11) with the guest in the gunner's seat: the guest's
 * Start asks the host, both pages run the same run on the shared clock;
 * the host driver's Ready to fire has the guest gunner's page lay the gun
 * and load it; the guest's hit counts on the host and comes back; Stop
 * from the host ends it on both.
 */
async function runChecks(host, guest, label) {
  const run = (p) => p.page.evaluate(() => window.__rangeRun.state());
  await guest.page.evaluate(() => window.__rangeRun.start());
  const started = await waitFor('both pages to run the same run', async () => {
    const [h, g] = await Promise.all([run(host), run(guest)]);
    return h.phase === 'running' && g.phase === 'running' && h.id === g.id && h.id > 0 ? { h, g } : null;
  }, 8000).catch(() => null);
  const tank = await host.page.evaluate(() => window.__drive.state());
  check(`The guest's Start begins a run on the host, the tank back at the start (${label})`,
    started !== null && Math.hypot(tank.x, tank.z) < 0.5,
    started ? `run ${started.h.id}, clocks ${started.h.clock.toFixed(2)} / ${started.g.clock.toFixed(2)} s` : JSON.stringify(await Promise.all([run(host), run(guest)])));
  // The clock counts in from about -3 s and a page moves it on by no more than a frame's worth at a time: at three
  // frames a second it takes 8 s to pass 0.5 s, so give it time. What is judged is that the two pages agree.
  await waitFor('the clock to run', async () => (await run(host)).clock > 0.5, 30000).catch(() => null);
  const [h1, g1] = await Promise.all([run(host), run(guest)]);
  check(`Both pages' run clocks agree (${label})`, h1.clock > 0 && Math.abs(h1.clock - g1.clock) < 0.4,
    `host ${h1.clock.toFixed(2)} s, guest ${g1.clock.toFixed(2)} s`);

  // The host drives: its Ready to fire has the gunner's page lay and load.
  await host.page.evaluate(() => window.__rangeRun.ready(1));
  const ready = await waitFor('the gunner laid and loaded', async () => guest.page.evaluate(() => window.__rangeRun.pending === -1 && window.__loading.state().loaded && window.__firing.predict().target === 1), 10000).catch(() => false);
  check(`The driver's Ready to fire has the gunner's page lay the gun on the 250 m target and load it (${label})`, ready,
    `gunner loaded ${await guest.page.evaluate(() => window.__loading.state().loaded)}, would: ${await guest.page.evaluate(() => window.__firing.predict().line)}`);
  await waitFor('the host to draw the gun laid', async () => {
    const [h, g] = await Promise.all([host, guest].map((p) => p.page.evaluate(() => window.__turret.state())));
    return Math.abs(h.yaw - g.yaw) < 1e-4 && Math.abs(h.elevation - g.elevation) < 1e-4;
  }, 8000).catch(() => null);
  await guest.page.evaluate(() => window.__turret.pullTrigger());
  const counted = await waitFor('both pages to count the hit', async () => {
    const [h, g] = await Promise.all([run(host), run(guest)]);
    // The flags are drawn on the next frame after the run event lands: wait for that too.
    const up = await guest.page.evaluate(() => window.__rangeRun.flags()[1]);
    return h.targets === 1 && g.targets === 1 && g.hitAt[1] >= 0 && up ? { h, g } : null;
  }, 10000).catch(() => null);
  const flags = await guest.page.evaluate(() => window.__rangeRun.flags());
  check(`The gunner's hit counts on the host and comes back: one target, its flag up, the run assisted (${label})`,
    counted !== null && counted.h.shots === 1 && counted.g.shots === 1 && counted.h.assisted && counted.g.assisted && flags.join() === 'false,true,false',
    counted ? `host ${counted.h.line}; guest ${counted.g.line}; flags ${flags.join(', ')}` : JSON.stringify(await Promise.all([run(host), run(guest)])));

  await host.page.evaluate(() => window.__rangeRun.stop());
  const stopped = await waitFor('the guest to see the run stop', async () => (await run(guest)).phase === 'idle', 8000).catch(() => false);
  check(`Stop ends the run on both pages (${label})`, stopped, `guest ${(await run(guest)).line}`);
  await guest.page.evaluate(() => { window.__loading.reset(); window.__turret.forward(); });
}

/**
 * The biathlon course (F5.3a): the host keeps the crew's progress round the
 * course and sends it as a reliable `course` event. The host drives across
 * the start line and the guest hears Lap 1 start; the guest's Line 2
 * shortcut parks the tank in firing box 2 through the host, and both pages
 * show it halted there.
 */
async function courseChecks(host, guest, label) {
  const course = (p) => p.page.evaluate(() => window.__course.state());
  const wasRunning = (await host.page.evaluate(() => window.__drive.state())).running;
  const heard = await guest.page.evaluate(() => window.__course.received);
  await host.page.evaluate(() => window.__course.go());
  // Up the course a few metres a hop (each short of a jump), across the start line.
  for (const s of [-3, 5]) {
    const frames = await host.page.evaluate(() => window.__course.frames);
    await host.page.evaluate((at) => { const p = window.__course.pointAt(at); window.__drive.place(p.x, p.z, p.heading); }, s);
    await waitFor('a frame after the move', async () => (await host.page.evaluate(() => window.__course.frames)) >= frames + 2, 10000).catch(() => null);
  }
  const started = await waitFor('the guest to hear lap 1 start', async () => {
    const [h, g] = await Promise.all([course(host), course(guest)]);
    return h.started && g.started && g.note === 'Lap 1: go!' ? { h, g } : null;
  }, 8000).catch(() => null);
  const received = await guest.page.evaluate(() => window.__course.received);
  check(`The host's crossing of the start line starts lap 1 on both pages (${label})`,
    started !== null && received > heard && started.g.laps === 0,
    started ? `guest "${started.g.line}", ${received - heard} course events heard` : JSON.stringify(await Promise.all([course(host), course(guest)])));

  await guest.page.evaluate(() => window.__course.line(1));
  const inBox = await waitFor('both pages to show the tank halted in box 2', async () => {
    const [h, g] = await Promise.all([course(host), course(guest)]);
    return h.box === 1 && h.halted && g.box === 1 && g.halted ? { h, g } : null;
  }, 10000).catch(() => null);
  const tank = await host.page.evaluate(() => window.__drive.state());
  check(`The guest's Line 2 parks the tank in firing box 2 with the engine running, halted there on both pages (${label})`,
    inBox !== null && tank.running && !inBox.g.started,
    inBox ? `tank at ${tank.x.toFixed(1)}, ${tank.z.toFixed(1)}, engine ${tank.running ? 'running' : 'off'}; guest "${inBox.g.line}"` : JSON.stringify(await Promise.all([course(host), course(guest)])));

  // Back to the range start as the later checks expect, the ranges fixed again.
  await host.page.evaluate(() => window.__rangeRun.pickRanges(false));
  await host.page.evaluate((running) => { if (!running) window.__drive.engine('stop'); window.__drive.reset(); }, wasRunning);
  await waitFor('the guest to see the tank back', async () => {
    const t = await guest.page.evaluate(() => window.__drive.state());
    return Math.hypot(t.x, t.z) < 0.5;
  }, 8000).catch(() => null);
}

/**
 * The biathlon race (F5.3b), with the host driving and the guest gunner:
 * the host's Start parks the tank at the course's start and both pages
 * show the race, the guest gunner's rack holding the line's three rounds
 * (the host draws the empty slot from the loading packet); after Go the
 * host's Ready line 1 has the guest's page lay and load in box 1, and the
 * guest's trigger brings the board down on both pages and spends a round
 * on both; the guest's Stop ends the race on both, the rack full again.
 */
async function raceChecks(host, guest, label) {
  const run = (p) => p.page.evaluate(() => window.__rangeRun.state());
  const places = (p) => p.page.evaluate(() => window.__loading.state().shells.map((s) => s.place));
  const wasRunning = (await host.page.evaluate(() => window.__drive.state())).running;
  // The host picks this race's ranges, as in play (the pages load with them fixed).
  await host.page.evaluate(() => window.__rangeRun.pickRanges(true));
  await host.page.evaluate(() => window.__rangeRun.race());
  const started = await waitFor('both pages to show the race with three rounds in the rack', async () => {
    const [h, g, hp, gp, rounds] = await Promise.all([run(host), run(guest), places(host), places(guest), guest.page.evaluate(() => window.__rangeRun.rounds())]);
    const three = (p) => p.filter((x) => x === 'rack').length === 3 && p.filter((x) => x === 'spent').length === 1;
    return h.mode === 'biathlon' && h.phase === 'running' && g.mode === 'biathlon' && g.phase === 'running' && rounds === 3 && three(gp) && three(hp) ? { h, g } : null;
  }, 10000).catch(() => null);
  const tank = await host.page.evaluate(() => window.__drive.state());
  check(`The host's Start begins a race at the course's start on both pages, the guest gunner's rack holding three rounds on both (${label})`,
    started !== null && Math.abs(tank.x - 320) < 0.5 && Math.abs(tank.z + 225) < 0.5,
    started ? `guest "${started.g.line}", tank at ${tank.x.toFixed(1)}, ${tank.z.toFixed(1)}` : JSON.stringify({ h: await run(host), g: await run(guest), hp: await places(host), gp: await places(guest) }));

  const placed = await waitFor("the guest's boards at the host's ranges", async () => {
    const [h, g, hb, gb] = await Promise.all([
      host.page.evaluate(() => window.__rangeRun.ranges()),
      guest.page.evaluate(() => window.__rangeRun.ranges()),
      host.page.evaluate(() => window.__course.layout().boards),
      guest.page.evaluate(() => window.__course.layout().boards),
    ]);
    return JSON.stringify(h) === JSON.stringify(g) && hb.every((b, j) => Math.hypot(b.x - gb[j].x, b.z - gb[j].z) < 0.01) ? { h, g } : null;
  }, 10000).catch(() => null);
  check(`The host's race picks its lines' ranges (350–450 m, 450–550 m) and the guest's boards stand at them too (${label})`,
    placed !== null && placed.h[0] >= 350 && placed.h[0] <= 450 && placed.h[1] >= 450 && placed.h[1] <= 550,
    placed ? `${placed.h.join(' and ')} m` : JSON.stringify({ h: await host.page.evaluate(() => window.__rangeRun.ranges()), g: await guest.page.evaluate(() => window.__rangeRun.ranges()) }));

  await waitFor('Go', async () => (await run(host)).clock >= 0.2, 30000).catch(() => null);
  await host.page.evaluate(() => window.__rangeRun.readyLine(0));
  const laid = await waitFor("the guest's page laid and loaded in box 1", async () => {
    const [loaded, line] = await Promise.all([guest.page.evaluate(() => window.__loading.state().loaded), guest.page.evaluate(() => window.__rangeRun.lineNow())]);
    return loaded && line === 0;
  }, 15000).catch(() => false);
  await guest.page.evaluate(() => window.__turret.pullTrigger());
  const down = await waitFor('the board down on both pages, a round spent', async () => {
    const [h, g, gc, hp] = await Promise.all([run(host), run(guest), guest.page.evaluate(() => window.__rangeRun.covers()), places(host)]);
    return h.boardAt[0] >= 0 && g.boardAt[0] >= 0 && gc[0] && h.rounds === 2 && g.rounds === 2 && hp.filter((x) => x === 'spent').length === 2 ? { h, g } : null;
  }, 10000).catch(() => null);
  check(`The host's Ready line 1 has the guest gunner lay and load; the guest's round brings the board down and spends a round on both pages (${label})`,
    laid && down !== null && down.h.shots === 1,
    down ? `host "${down.h.line}"` : `laid ${laid}; ${JSON.stringify({ h: await run(host), g: await run(guest), hp: await places(host) })}`);

  await guest.page.evaluate(() => window.__rangeRun.stop());
  const stopped = await waitFor('the race over on both pages, the rack full', async () => {
    const [h, g, gp, rounds] = await Promise.all([run(host), run(guest), places(guest), guest.page.evaluate(() => window.__rangeRun.rounds())]);
    return h.phase === 'idle' && g.phase === 'idle' && rounds === null && gp.every((x) => x === 'rack') ? { h, g } : null;
  }, 10000).catch(() => null);
  check(`The guest's Stop ends the race on both pages, the rack full again (${label})`, stopped !== null,
    stopped ? '' : JSON.stringify({ h: await run(host), g: await run(guest), gp: await places(guest) }));

  // Back to the range start as the later checks expect, the ranges fixed again.
  await host.page.evaluate(() => window.__rangeRun.pickRanges(false));
  await host.page.evaluate((running) => { if (!running) window.__drive.engine('stop'); window.__drive.reset(); window.__turret.forward(); }, wasRunning);
  await waitFor('the guest to see the tank back', async () => {
    const t = await guest.page.evaluate(() => window.__drive.state());
    return Math.hypot(t.x, t.z) < 0.5;
  }, 8000).catch(() => null);
}

/**
 * Comfort and stats (F1.14), after runChecks' run: each page wrote the
 * stopped run's row and got the crewmate's seat times for it (the
 * `run-stats` event), and the guest's Bumps → Reduced makes the host's
 * tank ride on reduced bumps (the `comfort` event).
 */
async function statsChecks(host, guest, label) {
  const lastRun = (p) => p.page.evaluate(() => window.__stats.rows().filter((r) => r.kind === 'run').at(-1) ?? null);
  const rows = await waitFor("both pages' rows with the crewmate's numbers", async () => {
    const [h, g] = await Promise.all([lastRun(host), lastRun(guest)]);
    return h && g && h.run === g.run && h.crew && g.crew ? { h, g } : null;
  }, 8000).catch(() => null);
  const both = rows ?? { h: await lastRun(host), g: await lastRun(guest) };
  const say = (r) => (r ? `run ${r.run} ${r.result}, ${r.shots} shots, driver ${r.driver.toFixed(1)} s, gunner ${r.gunner.toFixed(1)} s, crewmate ${r.crewmate}` +
    (r.crew ? ` (driver ${r.crew.driver.toFixed(1)} s, gunner ${r.crew.gunner.toFixed(1)} s)` : ' (no crew numbers)') : 'no row');
  check(`Each page writes the stopped run's row with its own and the crewmate's seat times (${label})`,
    rows !== null && rows.h.result === 'stopped' && rows.g.result === 'stopped' && rows.h.shots === 1 && rows.g.shots === 1 &&
      rows.h.crewmate === 'player' && rows.g.crewmate === 'player' && rows.h.driver > 0.5 && rows.g.gunner > 0.5 &&
      rows.h.crew.gunner > 0.5 && rows.g.crew.driver > 0.5,
    `host ${say(both.h)}; guest ${say(both.g)}`);

  const bumps = (p) => p.page.evaluate(() => ({ bumps: window.__drive.bumps, crew: window.__drive.crewBumps }));
  await guest.page.evaluate(() => window.__gameMenu.click('row-bumps-1'));
  const reduced = await waitFor('the host to ride on reduced bumps', async () => {
    const [h, g] = await Promise.all([bumps(host), bumps(guest)]);
    return h.bumps === 'reduced' && h.crew === 'reduced' && g.bumps === 'reduced' ? { h, g } : null;
  }, 5000).catch(() => null);
  await guest.page.evaluate(() => window.__gameMenu.click('row-bumps-0'));
  const full = await waitFor('the host back on full bumps', async () => (await bumps(host)).bumps === 'full', 5000).catch(() => false);
  check(`The guest's Bumps → Reduced makes the host's tank ride on reduced bumps, and Full puts it back (${label})`, reduced !== null && full,
    `host ${JSON.stringify(reduced?.h ?? await bumps(host))}, then ${full ? 'full' : 'still reduced'}`);
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
    xr.requestSession = async (mode, options) => {
      window.__vrRequests++;
      window.__vrOptions = options;
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
  // A PC browser (this one) isn't asked for WebXR Layers (sessionInitFor in src/vr-messages.ts).
  const vrOptions = await solo.page.evaluate(() => window.__vrOptions ?? null);
  check('A PC VR request leaves out WebXR Layers and keeps the floor', vrOptions !== null &&
    !vrOptions.optionalFeatures.includes('layers') && vrOptions.optionalFeatures.includes('local-floor'), JSON.stringify(vrOptions));
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
    // Down a step, back up, then up twice: the second stops at +5 cm, all a Sherman's roof leaves room for.
    m.click('height-down');
    m.click('height-up');
    m.click('height-up');
    m.click('height-up');
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
  // Reconnecting can take under a second (under a frame, on a slow runner), so look at each side's status
  // history, which presence keeps at every change of the session's state, seen by a frame or not.
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
  // The bot starts the engine the long way (F1.17): battery, ignition, choke, hand throttle, starter.
  const bot = await openPlayer(browser, 'room=BOTS&bot=1&engine=full');
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
    // The bot looks about on its neck and, as gunner, leans in to the sight while it lays (F1.1b), so its
    // head is within a lean of the eye point.
    return b.mine === playerSeat && b.seat === seat && near(b.head, b.eye, 0.25) && near(b.legs, HIPS[seat], 0.01) ? b : null;
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
  // F2.5: the player's (the driver's) firing lamp, from the bot's loading and its hands' hold kinds.
  const lampSeen = { litByHand: false, flashes: (await me.page.evaluate(() => window.__firingLamp.state())).flashes };
  // F1.1b: while it lays the gun the bot leans in to the sight; the player sees its body bend on its hips.
  const lean = { seen: false, last: null };
  const crewLean = async () => {
    if ((await bot.page.evaluate(() => window.__bot.gunning.phase)) !== 'lay') return;
    const b = await me.page.evaluate(() => ({
      eye: window.__seats.eye(window.__seats.crew),
      head: window.__debug.world.scene.getObjectByName('Crew 2 Head')?.position.toArray(),
      ...window.__net.crewBody(),
    }));
    lean.last = b;
    const forward = b.head ? Math.hypot(b.head[0] - b.eye[0], b.head[2] - b.eye[2]) : 0;
    if (forward > 0.08 && near(b.pivot, b.hip, 0.01) && b.stretch > 0.85 && b.stretch < 1.2 && b.neck < 0.27) lean.seen = true;
  };
  const fired = await waitFor('the bot to hit a target', async () => {
    await crewHolds();
    await crewLean();
    const lamp = await me.page.evaluate(() => window.__firingLamp.state());
    if (lamp.look === 'lit' && lamp.loaded && lamp.handOnTrigger && !lamp.practice) lampSeen.litByHand = true;
    const records = await me.page.evaluate(() => window.__firing.records());
    return records.find((r) => r.id % 2 === 1 && r.kind === 'target') ?? null;
  }, 120000).catch(() => null);
  const bot1 = await bot.page.evaluate(() => ({ ...window.__bot.gunning, status: window.__bot.status, holding: window.__bot.holding() }));
  check('Practice crewmate: as gunner it loads, lays on the nearest target and hits it, the host deciding',
    fired !== null && fired.target === 0 && bot1.loads >= 1,
    fired ? `"${fired.line}", bot ${JSON.stringify(bot1)}` : JSON.stringify({ bot: bot1, mine: await me.page.evaluate(() => window.__firing.records()) }));
  const lampAfter = await waitFor("the driver's lamp to flash at the bot's shot", async () => {
    const lamp = await me.page.evaluate(() => window.__firingLamp.state());
    return lamp.flashes > lampSeen.flashes ? lamp : null;
  }, 5000).catch(() => me.page.evaluate(() => window.__firingLamp.state()));
  check("Firing lamp: the driver's lamp lights while the crewmate gunner's gun is loaded with its hand on a trigger, and flashes at its shot",
    lampSeen.litByHand && lampAfter.flashes > lampSeen.flashes, `lit by its hand ${lampSeen.litByHand}, ${JSON.stringify(lampAfter)}`);
  check('Seated avatar: the crewmate gunner leans in to the sight, its body bending on its hips', lean.seen, JSON.stringify(lean.last));
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
  // F1.17: the engine stopped and cold, the bot starts it in the Full procedure before it drives.
  // F1.18: and its parking brake on, which it lets off.
  await me.page.evaluate(() => { window.__drive.engine('stop'); return true; });
  await bot.page.evaluate(() => { window.__drive.parkingBrake(true); return true; });
  const botStarted = await waitFor('the bot to start the engine', async () => {
    const t = await tank();
    return t.running ? t : null;
  }, 40000).catch(() => null);
  const botBox = await bot.page.evaluate(() => ({ ...window.__driverStation.engine(), status: window.__bot.status }));
  check('Practice crewmate: with the engine stopped, its hand works the instrument box (Full procedure) and starts it',
    botStarted !== null && botBox.presses.starter >= 1 && botBox.on.battery && botBox.on.ignition,
    `${botStarted ? `running at ${botStarted.rpm.toFixed(0)} rpm` : 'not started'}, box ${JSON.stringify(botBox)}`);
  const brakeOff = await waitFor('the bot to let off the parking brake', async () => {
    await crewHolds();
    const st = await bot.page.evaluate(() => window.__driverStation.state());
    return !st.parkingBrake && holdsSeen.has(13) ? st : null;
  }, 20000).catch(() => null);
  check('Practice crewmate: lets off the parking brake by its lever (the player sees its hand on it)', brakeOff !== null,
    `hold kinds seen ${[...holdsSeen].sort((a, b) => a - b).join(', ')}, brake ${brakeOff ? 'off' : 'still on'}`);
  await me.page.evaluate(() => window.__gameMenu.click('call-advance'));
  const advancing = await waitFor('the bot to drive the tank forwards', async () => {
    await crewHolds();
    const [t, st] = await Promise.all([tank(), me.page.evaluate(() => window.__driverStation.state())]);
    // With the automatic box (F1.16) a tiller asks for a share of the top speed: 3 m/s is about a third of the way, 6°.
    return t.speed > 1.5 && t.z < -2 && st.angles.tillerLeft > 3 && st.angles.tillerRight > 3 ? { t, st } : null;
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

  // F2.5: the player (gunner) laid and loaded by Ready to fire, the bot advancing; the player's hand on the
  // power grip lights the firing lamp on the bot's page too, and it holds the tank steady until the hand lets go.
  await me.page.evaluate(() => window.__rangeRun.ready(0));
  await waitFor('the player\'s gun loaded', async () => (await me.page.evaluate(() => window.__firingLamp.state())).loaded, 15000).catch(() => null);
  await me.page.evaluate(() => window.__gameMenu.click('call-advance'));
  await waitFor('the bot to drive off', async () => (await tank()).speed > 1, 30000).catch(() => null);
  await me.page.evaluate(() => window.__firingLamp.holdGrip(true));
  const steady = await waitFor('the bot to hold the tank steady for the gun', async () => {
    const [t, lamp, botLamp, driving] = await Promise.all([
      tank(),
      me.page.evaluate(() => window.__firingLamp.state()),
      bot.page.evaluate(() => window.__firingLamp.state()),
      bot.page.evaluate(() => window.__bot.driving),
    ]);
    return t.speed === 0 && lamp.look === 'lit' && botLamp.look === 'lit' && driving.steady ? { lamp, botLamp, driving } : null;
  }, 20000).catch(() => null);
  check('Firing lamp: with the gunner\'s hand on the grip of a loaded gun, the lamp lights on both pages and the crewmate driver halts and holds steady',
    steady !== null && !steady.lamp.practice && steady.botLamp.handOnTrigger,
    JSON.stringify(steady ?? await Promise.all([tank(), me.page.evaluate(() => window.__firingLamp.state()), bot.page.evaluate(() => ({ lamp: window.__firingLamp.state(), driving: window.__bot.driving }))])));
  await me.page.evaluate(() => window.__firingLamp.holdGrip(false));
  const movesOn = await waitFor('the bot to drive on once the lamp goes out', async () => {
    const [t, driving] = await Promise.all([tank(), bot.page.evaluate(() => window.__bot.driving)]);
    return t.speed > 1 && !driving.steady ? { t, driving } : null;
  }, 20000).catch(() => null);
  check('Firing lamp: the hand off the grip puts the lamp out and the crewmate drives on as it was told', movesOn !== null,
    JSON.stringify(movesOn ?? await Promise.all([tank(), bot.page.evaluate(() => ({ lamp: window.__firingLamp.state(), driving: window.__bot.driving }))])));
  await me.page.evaluate(() => window.__gameMenu.click('call-halt'));
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
    const quickLag = process.env.ONLY_SEATS === 'lag' || process.env.ONLY_DRIVE === 'lag' || process.env.ONLY_TURRET === 'lag' || process.env.ONLY_FIRING === 'lag' || process.env.ONLY_RUN === 'lag' || process.env.ONLY_COURSE === 'lag' || process.env.ONLY_RACE === 'lag' ? '&netlag=60&netjitter=20&netloss=0.01' : '';
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
    if (process.env.ONLY_COURSE) {
      // Quick loop for F5.3a: the biathlon course's progress shared (ONLY_COURSE=lag at about 150 ms RTT).
      await courseChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      return;
    }
    if (process.env.ONLY_RACE) {
      // Quick loop for F5.3b: the biathlon race with a guest gunner (ONLY_RACE=lag at about 150 ms RTT).
      await raceChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      return;
    }
    if (process.env.ONLY_RUN) {
      // Quick loop for F1.11 and F1.14: the range run with a guest gunner, then its stats rows and bumps (ONLY_RUN=lag at about 150 ms RTT).
      await turretChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      await runChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
      await statsChecks(a, b, quickLag ? '150 ms RTT' : 'local network');
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
    // How far what Bo's page draws is from what Ann's sent.
    const poseError = (got) => {
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
      return { posErr, rotDot, intact: posErr < 0.002 && rotDot > 0.9999 && got?.flags === 3 };
    };
    // Wait for it rather than a fixed time: Ann's page sends the pose with its next frame and Bo's draws it a
    // buffer's delay later, on a frame of its own. With a frame every 400 ms (a slow runner) that is over a
    // second, and Bo's page would be read while still drawing its way over from the last pose.
    const remotePose = () => b.page.evaluate(() => window.__net.remotePose());
    const got = await waitFor('the still pose to be drawn', async () => {
      const pose = await remotePose();
      return poseError(pose).intact ? pose : null;
    }, 10000).catch(remotePose);
    const { posErr, rotDot, intact } = poseError(got);
    check('Head and hand poses arrive intact', intact,
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
      ['Crew 2 Head', 'Crew 2 Torso', 'Crew 2 Neck', 'Crew 2 Legs', 'Crew 2 Left Hand', 'Crew 2 Right Hand'].every(
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
    // F1.12: the voice plays plain, like an intercom, and the tank's sounds duck about 12 dB while either player speaks.
    const ducks = await Promise.all([a, b].map((p) => deepestDuck(p.page, 2500)));
    const modes = await Promise.all([a, b].map((p) => p.page.evaluate(() => window.__net.voice.mode)));
    check('The intercom plays plain by default, and the tank sounds duck while someone speaks', modes.every((m) => m === 'plain') && ducks.every((d) => d < -8),
      `voice ${modes.join('/')}, deepest duck ${ducks.map((d) => `${d.toFixed(1)} dB`).join(' and ')}`);
    // John's play test (2026-11-07): the menu said -6 dB but the engine sounded no quieter. Measure
    // what the tank sounds actually put out, nobody speaking and then someone speaking.
    const out = await measureDuckedOutput(a.page);
    check('The tank sounds come out about 12 dB quieter while someone speaks', out.db < -11 && out.db > -13,
      `output RMS ${out.quiet.toFixed(4)} with nobody speaking, ${out.ducked.toFixed(4)} speaking: ${out.db.toFixed(1)} dB (engine ${out.engineHz.toFixed(0)} Hz)`);
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
    await runChecks(a, b, 'local network');
    await statsChecks(a, b, 'local network');
    await courseChecks(a, b, 'local network');
    await raceChecks(a, b, 'local network');
    await lobbyChecks(browser, a, b);

    const motion = await measureMotion(a, b, 3);
    report.local = { ...(await netStats(b.page)), motion };
    check('Crewmate moves smoothly (local network)',
      motion.frames >= 20 && motion.backwards === 0 && motion.maxRate < Math.max(3, motion.median * 4) && motion.radiusError < motion.radiusAllowed,
      motionDetail(motion));
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
    // The loopback route only serves the spatial voice (plain is the default since F1.12).
    const lag = 'netlag=60&netjitter=20&netloss=0.01&voice=spatial&voiceloop=1';
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
      lagMotion.frames >= 20 && lagMotion.backwards === 0 && lagMotion.maxRate < Math.max(3, lagMotion.median * 4) && lagMotion.radiusError < lagMotion.radiusAllowed,
      motionDetail(lagMotion));

    const loopVoice = await peakVoiceLevel(e.page, 2500);
    const loopActive = await e.page.evaluate(() => window.__net.voice.loopbackActive);
    check('Voice through the loopback route', loopActive && loopVoice > 0.01, `loopback ${loopActive}, peak level ${loopVoice.toFixed(3)}`);

    await seatChecks(d, e, '150 ms RTT');
    await driveChecks(d, e, '150 ms RTT');
    await turretChecks(d, e, '150 ms RTT');
    await firingChecks(d, e, '150 ms RTT');
    await runChecks(d, e, '150 ms RTT');
    await statsChecks(d, e, '150 ms RTT');
    await courseChecks(d, e, '150 ms RTT');
    await raceChecks(d, e, '150 ms RTT');

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
