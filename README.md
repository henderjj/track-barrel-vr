# Track & Barrel VR

A two-player co-op VR tank game that runs in the browser, built with [IWSDK](https://iwsdk.dev) (Immersive Web SDK). You and a friend crew a WW2-style tank: one drives, the other aims and loads, and neither can see everything, so you talk and work the tank's levers, wheels and shells with your hands. It targets 90 Hz on Meta Quest 3 in the Quest Browser, and PC VR in Chrome or Edge through Meta Horizon Link, from the same URL.

- The game: [docs/concept.md](docs/concept.md).
- How it is being built: [docs/plan.md](docs/plan.md).
- Every feature and where it stands: [docs/roadmap.md](docs/roadmap.md); what shipped and what headset checks found: [docs/progress.md](docs/progress.md).

The repository started from a co-op VR game template, itself cut down from Patchwork Airship VR. The template's demo (blocks thrown through a hoop on a wooden deck) is gone: the two players now sit in the tank's cabin, one in the driver's seat and one in the gunner's (roadmap F1.1, [docs/cabin.md](docs/cabin.md)). The tank drives (F1.4, [docs/tank-drive.md](docs/tank-drive.md)): the driver's thumbsticks work its tracks until the driver's station is built. The turret turns and the gun elevates (F1.8, [docs/turret.md](docs/turret.md)): the gunner lays it with a power traverse grip, a crank and an elevation wheel. The other controls come next, feature by feature.

## What already works

- **Getting into VR and into a crew.** An in-VR start screen (play solo, solo with the practice crewmate, start a crew with a four-letter code, join one), a lobby on a Cloudflare Worker that pairs the two browsers, peer-to-peer WebRTC for game data and voice with a TURN relay fallback, the page's own Enter VR and microphone buttons, and handling for a crewmate stepping away, reconnecting or leaving. See [docs/start-and-menu.md](docs/start-and-menu.md) and [lobby/README.md](lobby/README.md).
- **Bodies and hands.** Low-poly gloves posed from the controllers' trigger, grip and touch sensors (point, fist, flat, thumbs-up) or from tracked hands, hands that lock onto whatever they grip, simple head-and-body avatars in a coat colour each player picks, seated or standing play with a short calibration that puts the eyes on the seat's eye point (see [docs/seat-choice.md](docs/seat-choice.md)). See [docs/hands.md](docs/hands.md).
- **The cabin and seats**: the hull and turret, each player held in their seat with their head free inside it, the host deciding who sits where, and the crewmate drawn seated (`src/sim/cabin.ts`, `src/systems/seat-system.ts`, [docs/cabin.md](docs/cabin.md)).
- **Spikes** for the riskiest controls, each behind a Practice button: the magnified gunsight, riding the moving tank and loading a shell (`docs/spikes/`).
- **Throwing and catching** code, kept for shells and casings but not used: the holder owns an object, and the thrower keeps simulating it until the catcher grabs it (`src/net/ownership.ts`, `src/systems/throwables-system.ts`).
- **The game menu** in VR: microphone and crewmate mute, coat colour, seated or standing, eye height, back in my seat, swap seats, calibrate again, perf HUD, frame rate, foveation, a Practice section (which seat, and the spikes), back to the start screen, and Exit VR.
- **The practice crewmate**: a PC page that plays the second player, sitting in the seat you leave free, so one person can test two-player features.
- **Performance tools**: a wrist perf HUD, a per-second perf CSV, a 90 Hz request that falls back to the nearest supported rate, and fixed foveation.
- **Tests and deployment**: unit tests, a geometry test that catches flicker (z-fighting), a one-player emulated-headset test, a two-player network test with simulated lag, and CI that deploys the game to GitHub Pages and the lobby to Cloudflare on every merge to `main`. See [docs/testing.md](docs/testing.md).

## Setting up a copy

1. In the repository's **Settings → Pages**, set the source to **GitHub Actions**. (Pages on a private repository needs a paid GitHub plan.)
2. For the lobby, make a free Cloudflare account and a `workers.dev` subdomain, create an API token from the **Edit Cloudflare Workers** template, and add repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (and optionally `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` for Cloudflare's TURN relay). The Worker is called `track-barrel-lobby` (`lobby/wrangler.jsonc`). CI does the rest: it deploys the Worker, allows your Pages origin (or the comma-separated list in the repository variable `ALLOWED_ORIGINS`), and builds the game against the lobby's URL. Never paste these secrets into a chat.
3. Optionally add a ruleset on `main` that requires the `check` status, so nothing merges red, and allow auto-merge.

Features are built one at a time, each in its own pull request. The repository's Claude skill, [.claude/skills/build-coop-vr-feature/SKILL.md](.claude/skills/build-coop-vr-feature/SKILL.md), holds the house rules for every feature: the order to build it in, the networking model, VR performance and comfort, the tests and the pull request checklist. Claude Code picks it up by itself when working in this repository.

The browser keeps this game's settings and coat colour under keys that start `track-barrel.`, so they don't mix with another game served from the same GitHub Pages address (all of an account's Pages sites share one origin).

Each feature has a design note in `docs/`; [docs/cabin.md](docs/cabin.md) shows the shape a note should take.

## Run it

```sh
npm install
npm run dev        # IWSDK dev server + managed browser with an emulated Quest 3
npm test           # unit tests
npm run typecheck
npm run test:xr    # one player in an emulated headset (screenshots in artifacts/)
npm run build      # static site in dist/
npm run lobby      # local crew lobby on port 8787 (the dev server proxies /parties to it)
npm run test:net   # two players over the local lobby (run after build)
```

To play two-player locally, run `npm run lobby` next to `npm run dev`, then open the game in two browsers (or a browser and a headset). The start screen stands in front of you when VR starts, and shows on the page itself in a browser without a headset. A link with `?room=CODE` joins that crew straight away.

## Controls

- **Your seat:** you start in your seat facing forward. Lean and look about freely; your head stops at the edge of the seat's space, and standing up and walking puts you back in the seat. Game menu → You → Back in my seat faces you forward again; Practice → Sit in changes seats.
- **Gripping:** squeeze the grip; tracked hands grip with a fist or a pinch.
- **Game menu:** Y on the left controller (or its menu button, where the browser passes it on) opens it in front of you; Y or B closes it. On a PC page, M or the Game menu button. Nothing pauses while it is open.
- **Perf HUD:** on the left wrist in VR, toggled with X; on a PC page, the box at the bottom right, toggled with H. It shows frame rate against the refresh rate, a frame-time graph, main-thread time, draw calls, triangles, network round trip, both players' browsers and headsets, and what each controller's sensors report. After leaving VR, CSV in the desktop HUD downloads one row per second.
- **When the crewmate can't play** (headset off, Meta button, headset asleep, network down, tab closed), a sign in front of you says why. A dropped connection reconnects by itself.

## Settings

Settings that apply at once are in the game menu. Ones read as the game loads (the crewmate's voice, shadows) are under **Start-up settings** on the page's panel: pick, then Save and reload. Both are kept in the browser. Every setting can also be given in the address bar, which wins over the saved ones, so tests and a headset can try variations without a rebuild. Defaults are in `src/settings.ts`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `hz` | 90 | Requested refresh rate; the nearest supported rate at or below is used |
| `foveation` | 1 | Fixed foveated rendering, 0 (off) to 1 (maximum) |
| `fbscale` | 1 | WebXR framebuffer scale |
| `shadows` | 0 | `1` adds one shadow-casting light |
| `hud` | 1 | Show the perf HUD from the start |
| `seat` | driver | The seat to start in, `driver` or `gunner` (in a crew the host keeps theirs); also picked on the start screen |
| `seated` | 1 | `0` plays standing (calibration then takes a standing head; the eyes still land on the seat's eye point) |
| `raise` | 0 | Raise (+) or drop (-) the eyes from the seat's eye point, m, in 5 cm steps up to 0.15 |
| `room` | | Crew code to join on load, e.g. `room=KXQT` |
| `lobby` | | Lobby URL (`wss://...`); defaults to the build's `VITE_LOBBY_URL`, else the page's own server |
| `name` | | Your name as the crewmate sees it |
| `voice` | spatial | Crewmate voice: `spatial` (from their head), `plain` (not positioned) or `off` |
| `voiceloop` | 0 | `1` routes spatial voice through a local loopback so echo cancellation can hear it |
| `fist` | 0.6 | Tracked hands grip when the fingers' curl falls below this (1 straight, about 0.4 a fist) |
| `pinch` | 2 | Tracked hands also grip when thumb and index tips are closer than this, cm; `0` turns it off |
| `netlag` | 0 | Testing: extra delay on received packets, ms |
| `netjitter` | 0 | Testing: extra random delay, 0 to this many ms |
| `netloss` | 0 | Testing: fraction of received packets dropped, 0 to 1 |
| `label` | | A tag for the session written into the perf CSV |
| `bot` | 0 | `1` makes this page the practice crewmate |

## Testing alone: the practice crewmate

Choose **Solo with the practice crewmate** on the start screen in the headset. It starts a crew and shows its code and a link: open the link on a PC, or open the game on the PC, choose **Join a crew**, type the code and press **Join as practice crewmate** (`?bot=1` in the address does the same). The PC page then plays the second player, with no microphone. It sits in the seat you leave free, looking about, and moves over when you change seats. Keep the PC page showing: a hidden tab counts as a crewmate who stepped away.

Teach it its half of each new two-player job, so every feature can be tested by one person. The code is `src/systems/crew-bot-system.ts`, with its sums in `src/sim/crew-bot.ts`; `ONLY_BOT=1 npm run test:net` checks it against a scripted player.

## Testing on a headset

On Quest 3: open the GitHub Pages URL in the Quest Browser, press Enter VR, and check the HUD shows 90 Hz. After a deploy, clear the cache with Ctrl+Shift+R if an old build shows. For a local build, run `npm run dev`, connect the headset by USB with developer mode on, run `adb reverse tcp:8081 tcp:8081`, and open `https://localhost:8081/`. On the same Wi-Fi you can instead open the network URL from `npx iwsdk dev status` and accept the certificate warning.

On PC VR: make Meta Horizon Link the active OpenXR runtime, connect the Quest with Link or Air Link, and open the same URL in Chrome or Edge on Windows, with Chrome's "Use graphics acceleration when available" turned on (the game warns when it sees a software renderer). See [docs/spikes/s8-pcvr.md](docs/spikes/s8-pcvr.md).

## How the code is laid out

```
iwsdk.config.json          IWSDK project config (scene, features, physics at 90 Hz)
public/scenes/             scene composition (the hull, turret and ground, start screen, game menu)
public/ui/                 the start screen and game menu panels (UIKitML)
src/index.ts               world creation and system registration, in order
src/settings.ts            URL and saved settings
src/live-settings.ts       settings the game menu changes while playing
src/game-flow.ts           the start screen's and game menu's words (solo or crew)
src/scene-assets/          procedural low-poly models (hull and turret, the spikes' set-ups, avatar, posed hands, merge helpers)
src/sim/                   engine-free logic, unit-tested: cabin sizes and seats, body height, the spikes' rules, release velocity, hand grip, finger poses, bot sums
src/net/                   lobby protocol, WebRTC session and reconnection, packets, clock sync, jitter buffers, object ownership, crew presence
src/perf/                  frame statistics and CSV, measured refresh rate, platform report
src/systems/               ECS systems: network, seats, body height, grip, the spikes, own hands, crew status sign, start screen, game menu, practice crewmate, frame rate, perf HUD, platform report
lobby/                     crew lobby: Cloudflare Worker (deployed) and Node server (local)
test/                      unit and geometry tests (Vitest)
scripts/xr-smoke-test.mjs  emulated-headset test driven through the IWSDK CLI
scripts/net-test.mjs       two-player test in two browser profiles
docs/                      design notes, testing, progress, and findings from the airship's spikes
.claude/skills/            the Claude skill for building features
```

Code in `src/sim/` has no rendering or IWSDK imports, so the host's simulation could later move to a server if a game needs it. Players connect peer to peer over WebRTC after meeting in the lobby ([docs/spikes/s4-networking.md](docs/spikes/s4-networking.md)); voice runs on the same connection ([docs/spikes/s5-voice.md](docs/spikes/s5-voice.md)); loose objects are simulated by whoever last held them ([docs/spikes/s7-throwing.md](docs/spikes/s7-throwing.md)).

IWSDK conventions for this project are in [AGENTS.md](AGENTS.md).
