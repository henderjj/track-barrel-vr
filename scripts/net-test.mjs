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
 * - the crew lifecycle (spike S10): stepping away, going quiet and a broken
 *   connection;
 * - the practice crewmate sits in the seat the player leaves free.
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
const QUIET = 'hud=0';

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
    if (/^\[(Net|Seat|Bot)\]/.test(m.text())) console.log(`    ${m.text()}`);
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
  await me.page.evaluate(() => window.__gameMenu.click('row-seat-1'));
  const driving = await sat('gunner', 'driver');
  check('Practice crewmate: moves to the driver\'s seat when the player takes the gunner\'s', driving !== null, JSON.stringify(driving ?? await botSeat()));

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
    const quickLag = process.env.ONLY_SEATS === 'lag' ? '&netlag=60&netjitter=20&netloss=0.01' : '';
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
