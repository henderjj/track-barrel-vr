# Testing

## What there is

| Command | What it checks | Time on CI |
| --- | --- | --- |
| `npm run typecheck` | TypeScript for the game (and `npm run --prefix lobby typecheck` for the lobby) | seconds |
| `npm test` | Unit tests in `test/` (Vitest): simulation, networking, perf stats, and the geometry check for faces that flicker ([below](#z-fighting)); no browser | seconds |
| `npm run build` | The production build | 15 s |
| `npm run test:xr` | `scripts/xr-smoke-test.mjs`: one emulated Quest 3 in the IWSDK dev runtime, driven through the IWSDK CLI (kept loaded in a worker thread with one open browser connection, `scripts/iwsdk-worker.mjs`; `IWSDK_SPAWN=1` starts a process per call as before): start screen and menu, posed hands, the seats (head limits, reseating, changing seats), seat choice and calibration, eye height and the roof stop, frame rate, the gunsight (spike S1), the lever test (spike S3) and the mechanism kit's bench (F1.3), tracked hands, riding (spike S2), driving the tank (F1.4) and its driver's station (F1.5), laying the gun (F1.8), loading and firing (F1.10), the test range (F1.7), the tank's sounds (F1.12), laying the gun with the gunsight (F1.9), the range run (F1.11), turning both crew's periscopes (F1.6, F1.19), comfort and stats (F1.14: the vignette's strength, reduced bumps, a fumble, a grind and a queasy mark counted in a run), the driver's turret dial (F2.3), the callout card (F2.6), the firing lamp (F2.5), the biathlon course (F5.3a), PC VR without the frame-rate API | about 36 min in all (the runners draw the emulator in software at a frame every 0.5 to 1 s), so CI runs it in three parts at once of about 12 min each, the longest job |
| `npm run test:net` | `scripts/net-test.mjs`: two Playwright browsers against `vite preview` and the local lobby: connection, poses and fingers, voice and muting, who sits where (the host decides; swaps once both agree), a guest driving the host's tank, each page drawing the other seat's periscope turned (F1.6, F1.19), the gunner's turret seen by the driver, on the driver's turret dial too (F2.3), and laid by the driver's Practice lay (F1.9), a guest gunner loading and firing with the host deciding the hit, a range run shared by both pages and its stats rows on each with the crewmate's numbers, a guest's reduced bumps riding the host's tank (F1.14), the biathlon course's progress shared and a guest's Line 2 parking the tank in its box (F5.3a), the intercom's duck and both pages hearing the shot (F1.12), the start screen, menu and start-up settings, presence, reconnects, 150 ms lag, the practice crewmate (its seat, and since F1.13 gunning on the range and driving on calls, and since F2.5 the firing lamp lit by its gunning and holding it steady as driver; run `npm run build` first). Its pages hide the drive's ground (`?ground=0`): the software renderer draws a few frames a second, and its frame-by-frame motion checks need every one it can get | about 7 min |

## How CI runs them

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

- **plan** decides what to run (below).
- **quick** (typecheck, unit tests, build, lobby typecheck), **xr** and **net** run at the same time, each on its own runner, so a run takes as long as the slowest of them instead of all of them in a row. **xr** is itself three jobs, `xr (part 1)` to `xr (part 3)`, each running a third of the emulated-headset test (`XR_PART=1` to `3`) in about 12 minutes; with no `XR_PART` the script runs all three parts one after another. Put a new feature's XR steps in whichever part is shortest on CI (`partOne`, `partTwo` or `partThree` in the script). A part that fails can be rerun on its own (Re-run failed jobs). If the emulated browser stops answering (a command or evaluation times out, a reply comes back empty or garbled) before any check has failed, the script exits with 75 and CI runs that part once more on a fresh dev runtime; a failed check, or a second stop, fails the job. Each run clears the game's saved settings first, so a rerun starts from the defaults.
- **check** passes only if every test job passed (or was skipped on purpose). It is the status check the `main` ruleset requires, so auto-merge waits for it. Keep the job's name.
- On `main`, **lobby** and **deploy** then publish the lobby Worker and the game.

What gets skipped, and why it is safe. "Docs" here means Markdown files, `docs/` and `LICENSE`: no test, build or page loads them.

- A change that touches only docs skips **xr** and **net**: a pull request whose files differ from its base only in docs, and a push to `main` whose files differ only in docs from the `main` it replaced (a docs pull request merged). **quick** still runs, and `main` still deploys.
- When a pull request passes, **check** records the exact code it tested (a fingerprint of every file but the docs, in the pull request merged into `main`) as an artifact named `tested-code-<fingerprint>`. When that pull request is merged, `main` skips the tests and deploys straight away if its code has the same fingerprint: nothing but docs merged in between. If another pull request changed code on `main` first, the fingerprints differ and `main` runs everything before it deploys.

The **xr** job sets `IWSDK_GPU=swiftshader`. Runners have a display device in `/dev/dri` but no GPU, and IWSDK takes any such device for a GPU: Chromium then runs on hardware GL and dies on the start-up reload or a screenshot. Software rendering on some runners draws a frame or two a second. IWSDK's ray takes a press as a click only if it is released within 0.8 s by frame time, so at that pace clicks were dropped: the test opens that window to 5 s (`relaxRayClicks`) and holds the trigger (and Y) for two and a half of the slowest recent frames. Its waits stretch with the frame time too, so all of it takes about 36 minutes there, and CI splits it in three.

The Chromium download for the browser tests is kept in the Actions cache, keyed on the Playwright version. The first run after a Playwright update downloads it again, which can take ten minutes or more.

When you add something random (a gust, a breakdown, weather), give it a URL switch that turns it off and load the browser tests with it off, so it can't push their other checks about; their own checks for it then send one on purpose, the way a Practice button does.

Each step in the browser tests drives the game through a `window.__<feature>` hook (`window.__seats`, `window.__gameMenu`, `window.__bot` and so on) the way a player would, and waits for the state it checks rather than sleeping a fixed time: emulator frames take 15 to 45 ms and a ray click needs about half a second.

## While developing

Run what covers the change, cheapest first, and leave the full run to CI:

1. Always: `npm run typecheck` and `npm test`. Add or update a unit test in `test/` for logic in `src/sim/` or `src/net/`; it runs in seconds.
2. Then the browser test whose checks touch what changed:
   - one player's hands, controls, physics or a feature's flow: `npm run test:xr`, narrowed while iterating to the part with the feature's steps (`XR_PART=1`, `2` or `3`);
   - anything sent between players, the lobby or the practice crewmate: `npm run build && npm run test:net`, narrowed while iterating with `ONLY_SEATS=1` (or `=lag`), `ONLY_DRIVE=1` (or `=lag`), `ONLY_TURRET=1` (or `=lag`), `ONLY_FIRING=1` (or `=lag`), `ONLY_RUN=1` (or `=lag`), `ONLY_COURSE=1` (or `=lag`), `ONLY_BOT=1` or `ONLY_LIFECYCLE=1`;
   - a change that only touches docs needs neither.
3. Before marking a pull request ready, run both browser tests if the change could reach either; CI runs them anyway, but a red run costs a full cycle.

## Z-fighting

Two faces of different colours that face the same way, lie in (nearly) the same plane and overlap flicker through each other in the headset as the head moves: the depth buffer can't tell which is in front. In the game this template came from, a crate's edges, a hatch's edges and a jetty's root all did, and an emulator screenshot rarely shows it. `test/z-fighting.test.ts` looks for such pairs in the built geometry (the helper is `test/support/coplanar.ts`): the hull with the turret turned several ways and its gun, controls and loading (breech open and closed, a shell rammed, the gun recoiled, casings in the bin) in several poses, the driver's station with its levers and needles, the driver's turret dial with its pointer turned, the firing lamp and its repeater, the test range's ground with its roads, targets, markers and obstacles, the biathlon course's track, gates, boxes and boards on the ground, the spikes' set-ups (the sight in the turret, the riding blockout, the lever rig), a shell and a casing, the mechanism kit's bench with its controls in several poses, and the crew's avatar parts. A failure lists each pair: how far apart, how much overlaps, where (in the mesh's own space) and which way it faces.

The rule it checks: keep faces like that at least 3 mm apart in and around the cabin (seen from 0.3 to 3 m), and 8 mm in the world (seen from 5 m on). Make the trim stand proud (a batten 4 mm out from the planks, a band 4 mm out from the battens), end one part inside another rather than flush with its face, or give the two faces the same colour. Faces flat on a floor, facing down into it, are never seen and can be left out.

When you add a new model, add it to that test. The camera's near plane (`render.near` in `iwsdk.config.json`) is 5 cm: the depth buffer's precision goes with it, so don't lower it to fix clipping close to the face without rerunning the test with smaller gaps in mind.


## In a cloud container

The browser tests need Playwright's Chromium. A cloud container may have a different Chromium build installed from the one this Playwright version expects (`npx playwright --version`; the expected revision is in `node_modules/playwright-core/browsers.json`). Rather than downloading, make a folder that links the expected names to the installed ones and point `PLAYWRIGHT_BROWSERS_PATH` at it, for example `chromium-1248 -> /opt/pw-browsers/chromium-1243` and `chromium_headless_shell-1248 -> /opt/pw-browsers/chromium_headless_shell-1243`. The headless browser can't reach CDNs, so scenes must not load assets from one. Port 8081 must be free for `npx @iwsdk/cli dev up` (a stale Vite blocks it), and don't edit `src/` while the XR test runs: Vite reloads the page and the CLI fails.
