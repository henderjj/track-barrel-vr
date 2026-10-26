# Testing

## What there is

| Command | What it checks | Time on CI |
| --- | --- | --- |
| `npm run typecheck` | TypeScript for the game (and `npm run --prefix lobby typecheck` for the lobby) | seconds |
| `npm test` | Unit tests in `test/` (Vitest): simulation, networking, perf stats, and the geometry check for faces that flicker ([below](#z-fighting)); no browser | seconds |
| `npm run build` | The production build | 15 s |
| `npm run test:xr` | `scripts/xr-smoke-test.mjs`: one emulated Quest 3 in the IWSDK dev runtime, driven through the IWSDK CLI (kept loaded in a worker thread with one open browser connection, `scripts/iwsdk-worker.mjs`; `IWSDK_SPAWN=1` starts a process per call as before): start screen and menu, posed hands, the seats (head limits, reseating, changing seats), seat choice and calibration, eye height and the roof stop, frame rate, the gunsight (spike S1), the lever test (spike S3) and the mechanism kit's bench (F1.3), tracked hands, the loading drill (spike S4), riding (spike S2), driving the tank (F1.4), PC VR without the frame-rate API | about 2 min |
| `npm run test:net` | `scripts/net-test.mjs`: two Playwright browsers against `vite preview` and the local lobby: connection, poses and fingers, voice and muting, who sits where (the host decides; swaps once both agree), a guest driving the host's tank, the start screen, menu and start-up settings, presence, reconnects, 150 ms lag, the practice crewmate (run `npm run build` first). Its pages hide the drive's ground (`?ground=0`): the software renderer draws a few frames a second, and its frame-by-frame motion checks need every one it can get | about 3 min, the longest job |

## How CI runs them

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

- **plan** decides what to run (below).
- **quick** (typecheck, unit tests, build, lobby typecheck), **xr** and **net** run at the same time, each on its own runner, so a run takes as long as the slowest of them instead of all of them in a row.
- **check** passes only if every test job passed (or was skipped on purpose). It is the status check the `main` ruleset requires, so auto-merge waits for it. Keep the job's name.
- On `main`, **lobby** and **deploy** then publish the lobby Worker and the game.

What gets skipped, and why it is safe:

- A pull request that changes only Markdown, `docs/` or `LICENSE` skips **xr** and **net**: nothing they load changed.
- When a pull request passes, **check** records the exact files it tested (the git tree of the pull request merged into `main`) as an artifact named `tested-tree-<tree>`. When that pull request is merged and `main` didn't move in between, the merge on `main` has exactly the same files, so `main` skips the tests and deploys straight away. If another pull request merged first, the files differ and `main` runs everything before it deploys.

The Chromium download for the browser tests is kept in the Actions cache, keyed on the Playwright version. The first run after a Playwright update downloads it again, which can take ten minutes or more.

When you add something random (a gust, a breakdown, weather), give it a URL switch that turns it off and load the browser tests with it off, so it can't push their other checks about; their own checks for it then send one on purpose, the way a Practice button does.

Each step in the browser tests drives the game through a `window.__<feature>` hook (`window.__seats`, `window.__gameMenu`, `window.__bot` and so on) the way a player would, and waits for the state it checks rather than sleeping a fixed time: emulator frames take 15 to 45 ms and a ray click needs about half a second.

## While developing

Run what covers the change, cheapest first, and leave the full run to CI:

1. Always: `npm run typecheck` and `npm test`. Add or update a unit test in `test/` for logic in `src/sim/` or `src/net/`; it runs in seconds.
2. Then the browser test whose checks touch what changed:
   - one player's hands, controls, physics or a feature's flow: `npm run test:xr`;
   - anything sent between players, the lobby or the practice crewmate: `npm run build && npm run test:net`, narrowed while iterating with `ONLY_SEATS=1` (or `=lag`), `ONLY_DRIVE=1` (or `=lag`), `ONLY_BOT=1` or `ONLY_LIFECYCLE=1`;
   - a change that only touches docs needs neither.
3. Before marking a pull request ready, run both browser tests if the change could reach either; CI runs them anyway, but a red run costs a full cycle.

## Z-fighting

Two faces of different colours that face the same way, lie in (nearly) the same plane and overlap flicker through each other in the headset as the head moves: the depth buffer can't tell which is in front. In the game this template came from, a crate's edges, a hatch's edges and a jetty's root all did, and an emulator screenshot rarely shows it. `test/z-fighting.test.ts` looks for such pairs in the built geometry (the helper is `test/support/coplanar.ts`): the hull with the turret turned several ways, the drive's ground with its obstacles, the spikes' set-ups (the sight in the turret, the loading station, the riding blockout, the lever rig), the mechanism kit's bench with its controls in several poses, and the crew's avatar parts. A failure lists each pair: how far apart, how much overlaps, where (in the mesh's own space) and which way it faces.

The rule it checks: keep faces like that at least 3 mm apart in and around the cabin (seen from 0.3 to 3 m), and 8 mm in the world (seen from 5 m on). Make the trim stand proud (a batten 4 mm out from the planks, a band 4 mm out from the battens), end one part inside another rather than flush with its face, or give the two faces the same colour. Faces flat on a floor, facing down into it, are never seen and can be left out.

When you add a new model, add it to that test. The camera's near plane (`render.near` in `iwsdk.config.json`) is 5 cm: the depth buffer's precision goes with it, so don't lower it to fix clipping close to the face without rerunning the test with smaller gaps in mind.


## In a cloud container

The browser tests need Playwright's Chromium. A cloud container may have a different Chromium build installed from the one this Playwright version expects (`npx playwright --version`; the expected revision is in `node_modules/playwright-core/browsers.json`). Rather than downloading, make a folder that links the expected names to the installed ones and point `PLAYWRIGHT_BROWSERS_PATH` at it, for example `chromium-1248 -> /opt/pw-browsers/chromium-1243` and `chromium_headless_shell-1248 -> /opt/pw-browsers/chromium_headless_shell-1243`. The headless browser can't reach CDNs, so scenes must not load assets from one. Port 8081 must be free for `npx @iwsdk/cli dev up` (a stale Vite blocks it), and don't edit `src/` while the XR test runs: Vite reloads the page and the CLI fails.
