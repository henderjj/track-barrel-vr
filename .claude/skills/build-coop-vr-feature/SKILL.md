---
name: build-coop-vr-feature
description: Use when adding or changing a gameplay feature, control, prop, model or shared system in this co-op VR game, or fixing a headset playtest note. Holds the house rules for networking, VR performance and comfort, tests and the feature PR checklist.
---

# Building a feature in this co-op VR game

This repository is a two-player co-op VR game that runs in the browser, built on IWSDK (see `AGENTS.md` for how IWSDK projects differ from plain Vite, and the IWSDK skills it names for models, scenes, UI and physics). It targets 90 Hz on Meta Quest 3 and PC VR through Meta Horizon Link from the same URL. The rules below were learnt building Patchwork Airship VR, the game this template came from; each one cost at least one headset round trip to find. Follow them unless the person asks otherwise, and say when you depart from one.

Explain VR terms in plain language when they first come up: XR (an immersive session), IWER (IWSDK's browser XR emulator, which the tests drive), ECS (entity-component system), and grip versus target-ray poses.

## The shape of every feature

One feature is one pull request against `main` (never stacked on another PR branch), built in this order:

1. **Design note** in `docs/<feature>.md`: what the players experience, the numbers (sizes, speeds, timings), how both players share it, what one player can do alone, what the host decides, and what goes over the network. Put any real design choice to the person with a recommendation, and carry on with the recommended one while they decide.
2. **Engine-free logic** in `src/sim/<feature>.ts`: plain TypeScript with no IWSDK, DOM or renderer imports, so it is unit-tested in `test/<feature>.test.ts` and could move to a server. Shared dimensions go in `src/sim/cabin.ts` (or a sibling) so the model, the systems, the bot and the tests use one set of numbers.
3. **Model** in `src/scene-assets/<feature>.scene-asset.ts` (low-poly, vertex-coloured, merged with `mergeParts` into as few meshes as possible, deterministic) and registered in `test/z-fighting.test.ts` in the same PR, in every pose it is drawn in.
4. **System** in `src/systems/<feature>-system.ts`, registered in `src/index.ts` in the right order (comments there say why each system is where it is). Systems that hold a hand set `handUse[side]` while they do and clear it on letting go.
5. **Network** messages for anything both players must agree on (see below).
6. **Practice shortcut** in the game menu's Practice tab (or its Sights or Test rigs tab; `public/ui/menu.uikitml`, `src/systems/game-menu-system.ts`, tabs in `MENU_TABS` in `src/game-flow.ts`) that jumps straight to the situation a headset check needs, so the person never plays five minutes to test one thing.
7. **Practice crewmate** (`src/systems/crew-bot-system.ts`, sums in `src/sim/crew-bot.ts`): teach the bot its half of any two-player job, so one person can test it with the bot's page on a PC. It plays through the same scripted hands the tests use.
8. **Test hook** `window.__<feature>` (state, actions, any sign text), then a step in `scripts/xr-smoke-test.mjs` and, for anything shared, a check in `scripts/net-test.mjs` (clean link and 150 ms RTT).
9. **Headset check** at the end of the design note: a short numbered list naming the Practice shortcut, what to do, and what should happen. The person runs it after the deploy (with the cache cleared: Ctrl+Shift+R).
10. **Records**: update the running record of progress and plans (`docs/progress.md`; start it if there is none) and, if the project keeps them, project memory and the roadmap card.

## Networking model

Design for 50 ms round trip and stay playable at 150 ms with 20 ms jitter and 1% loss. Test that with `?netlag=60&netjitter=20&netloss=0.01`; Chrome's DevTools throttling doesn't touch WebRTC.

- **The host is the authority.** The player who started the crew runs the simulation; the guest runs the same code as a replica and only shows what the host sends. Playing solo, the page is the host (`netLink.isHost` is true when not connected). See `src/systems/seat-system.ts` for the pattern: the host decides who sits where and sends it as an event, and a guest's choice asks the host.
- **Two channels.** Things that change every frame (a shared control's angle, a vehicle's pose, the guest's hands on a control) go as small binary packets on the unreliable channel at about 45 Hz: add a `PacketType` in `src/net/pose-codec.ts` with `encode`/`decode` functions packed by hand with `DataView`, and a round-trip unit test. Things that happen once (grabbed, scored, delivered, a setting the host decides) go as reliable events: `netLink.sendEvent({ t: 'name', ... })` and `netLink.events.set('name', handler)`, removed in `cleanupFuncs`.
- **Keep packets backward compatible.** When a packet grows, decode the old length too, so a page still on the previous build works.
- **Shared controls** (something both players can hold at once): each client sends its own hands' contribution, the host combines them and broadcasts the result, and each client draws its own hand on the control at once while blending the control towards the host's state.
- **Loose objects** follow `src/net/ownership.ts` and `ThrowablesSystem` (kept in the tree, not registered, until a feature needs it): the holder owns it; a thrower keeps simulating until the catcher grabs it, so catches work at 150 ms.
- **Shared clock.** Use `netLink.toLocal()` and the clock sync for anything timed together (a beat both must hear, a countdown), never each page's own clock.
- **A moving vehicle**: keep the vehicle still at the origin and move the world by its inverse pose, so the cabin, the crewmate and loose objects stay smooth relative to each other, and send everything aboard in hull-space coordinates.
- **Presence.** `crewPresence.paused` is true while the crewmate stepped away, went quiet or is reconnecting. Freeze the host's simulation while it is true; the sign saying why is already drawn.
- **Hands on controls.** Add a `HoldKind` (`src/systems/hand-lock.ts`, up to 15) per handle, register its resolver in the owning system, and map its `handUse` name in `holdKindOf` (`src/systems/net-system.ts`), so both players see the hand closed on the handle (grip locking).

## VR rules

Performance (90 Hz on Quest 3 is 11.1 ms a frame):

| Budget | Target | Hard limit |
| --- | --- | --- |
| Game JavaScript per frame | 2 ms | 3 ms |
| Draw calls | 100 | 150 |
| Triangles | 300k | 500k |
| Real-time lights | 1 directional + ambient | 1 directional + 1 point |
| Awake dynamic physics bodies | 30 | 60 |
| Allocations in `update()` | 0 | 0 |

- Allocate in `init()` or as class fields; treat any allocation in `update()` as a bug. Use `signal.peek()` in `update()`.
- Merge static parts into one mesh, instance repeated scenery, two LOD levels for distant things, no post-processing, no real-time shadows by default, opaque clouds. Change the mood (weather, time of day) by retinting the existing lights, fog and sky rather than adding lights.
- Check the perf HUD (X on the left controller, H on a PC page) after each feature and quote the numbers.

Rendering traps:

- **Z-fighting.** Two differently coloured faces facing the same way must be at least 3 mm apart near the player and 8 mm out in the world, or they flicker in the headset; the emulator rarely shows it. `test/z-fighting.test.ts` checks every registered model. Make trim stand proud, end parts inside one another, or give the faces one colour. Don't lower the 5 cm near plane.
- **No camera-facing sprites or `Points` for world objects**: they read as odd orbs that swim as the head turns. Use real 3D geometry, with an emissive material for a glow.
- **Seams.** Weld a cylinder's seam before jittering vertices (`cornerKey` in `src/scene-assets/lowpoly.ts` rounds to integers so `-0` and `0` match); open-ended tubes need a ball at each sharp bend.
- **No CDN assets** (controller or hand models, fonts): the headless tests can't fetch them and the drawn gloves already replace the controllers.

Bodies, hands and comfort:

- Hands only, no arms. Pose the gloves from trigger, grip and touch sensors (`src/sim/hand-pose.ts`); lock them onto handles while gripped; let go when the real hand strays 25 cm from the handle.
- WebXR grip space has its origin at the fist with −Z along the handle towards the thumb: align a held thing to the model's own fist axis (`FIST_AXIS`), not the controller's.
- Read grip state from `grip` in `src/systems/grip-system.ts`, not the gamepad, so controllers and tracked hands (fist or pinch) both work.
- Put every control between knee and chest height and check it is reachable seated (eyes raised to 1.45 m); add it to `test/body-height.test.ts`.
- Keep the player in their seat by limiting where their head can go, not where the play space's origin is, so a lean or a step in the real room can't carry their head through the armour. This is `SeatSystem`, with each seat's head box in `src/sim/cabin.ts`; change the boxes there when the cabin changes. A feature that seats the player somewhere else sets `seating.away` while it does.
- Never judge an object's speed from its drawn position over one frame: after a slow frame several physics steps land at once. Read the physics body's velocity, and move held objects to the hand each frame.
- If players ride a moving vehicle, keep its floor under their feet and limit its lean to a few degrees. Whenever the game halts or pauses the vehicle by itself (the crewmate stepped away, a reconnect, a stop button), put a sign in front of the player saying why, so a sudden stop doesn't read as a bug.

Menus and input:

- Settings that apply at once live in the in-VR game menu (Y on the left controller, B or Y closes, M on a PC page); ones read at load go under Start-up settings on the page. Never ask the player to edit URL parameters, though every setting also reads from the URL for tests.
- Show every choice as a row of buttons; dropdowns don't work with a ray. Panels open about 1.3 m away and never block the view once the game is running.
- UIKitML `:hover` sticks under an XR ray; never use hover for a selected look.
- Keep the page's own Enter VR button and ask for the microphone on the 2D page before VR.
- Vibration: try WebXR haptic pulse, then Gamepad rumble (`src/systems/haptics.ts`); Chrome on PC may pass neither.

PC VR over Link and Air Link: Chrome or Edge only, Meta Horizon Link as the active OpenXR runtime, and Chrome's "Use graphics acceleration when available" on (the game warns when it sees a software renderer). Link can take a minute to start a session and its permission bubble appears on the PC monitor, so say so on screen.

## Tests

Read `docs/testing.md` first. While developing:

1. Always `npm run typecheck` (type errors can stop systems initialising without a console error) and `npm test`.
2. Then the browser test that covers the change: `npm run test:xr` for one player's hands, controls, physics and flow; `npm run build && npm run test:net` for anything shared, narrowed with `ONLY_SEATS=1` (or `=lag`), `ONLY_BOT=1` or `ONLY_LIFECYCLE=1`.
3. Both browser tests before marking a PR ready.

Habits that kept CI green:

- Each check waits for the state it checks (boards redraw every 250 ms, a ray click needs about half a second); emulator frames take 15 to 45 ms.
- Random events (gusts, breakdowns, weather) get a URL switch to turn them off in tests and a Practice button to send one on purpose.
- When a check is flaky, log the moment it fails in the page and reproduce with `THROTTLE=6`. Never skip, disable or loosen a test to get green.
- Don't edit `src/` while the XR test runs: Vite reloads the page and the CLI fails.
- In a cloud container the preinstalled Chromium may be a different build from the one Playwright expects: point `PLAYWRIGHT_BROWSERS_PATH` at a folder that links the expected `chromium-<rev>` and `chromium_headless_shell-<rev>` names to the installed ones, rather than downloading.

The pass marks the person cares about can't be proved in the cloud: feel, readability, flicker in stereo, comfort and platform quirks. That is what the headset check at the end of each design note is for; ask them to report what the screen or wrist HUD says, not only how it felt.

## Before you open the pull request

- [ ] Design note with a numbered headset check at the end
- [ ] `src/sim` logic unit-tested; packets round-trip tested
- [ ] New models in the z-fighting test; no sprites; no new real-time lights; controls reachable seated
- [ ] Practice menu shortcut, and the practice crewmate does its part
- [ ] `window.__<feature>` hook with an XR step, and a net check if it is shared
- [ ] Typecheck, unit tests and the covering browser test pass locally; both browser tests before ready
- [ ] Perf HUD still within budget
- [ ] Progress record updated

Then open the PR against `main`, turn on auto-merge if the project uses it, and drive CI to green.
