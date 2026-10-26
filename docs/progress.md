# Progress and plans

The running record of where the game is and what comes next, so anyone (or any Claude session) can pick up the work. Update it with every feature: what shipped, what the headset check found, and what is next. Feature-by-feature status is in [roadmap.md](roadmap.md).

## Where things stand

- Started from the co-op VR game template: the blocks-and-hoop demo ([play-area.md](play-area.md)), the start screen and game menu, hands, throwing and catching, the practice crewmate, the lobby, the browser tests and CI.
- The game's concept ([concept.md](concept.md)), implementation plan ([plan.md](plan.md)) and features roadmap ([roadmap.md](roadmap.md)) are written (F0.1, #1).
- Renamed to Track & Barrel VR (F0.2): package and lobby names, the page and start screen titles, and the browser storage keys, now `track-barrel.settings` and `track-barrel.colour`. Settings saved under the old `coop-vr.` keys are not carried over on purpose: on GitHub Pages every game of the account shares one origin, so those belong to the other games there. The lobby Worker is now `track-barrel-lobby`, a new Worker at a new `workers.dev` address on its first deploy; CI builds the game against whichever address it deploys.
- Spike S1, the magnified gunsight (F0.3): a sight on a post at the deck's far corner looks out at target boards at 100, 250 and 500 m. A second camera renders the view into a 512² texture only while an eye is at the eyepiece, and the lens shows it at infinity at 3× with a reticle and range marks. Practice buttons go to it, aim it at each target and change when it draws, its size and which eyes see it; the perf HUD shows its own cost ([spike note](spikes/s1-sight-render.md)).
- Spike S4, loading a shell (F0.6, [spikes/s4-loading.md](spikes/s4-loading.md)): a loading station on the deck behind the start spot (ready rack, breech, lever) where a seated player takes a shell, swings it to the breech, rams it and closes the breech, timed and with fumbles counted on a board. Practice → Sit at the breech. Each player's own for now; F1.10 makes loading shared.
- Spike S2, riding the tank (F0.4): Practice → Ride the tank puts a solo player in the driver's or gunner's seat of a blockout hull while the practice crewmate drives a scripted route and scans the turret, or the player drives and traverses with the thumbsticks. The tank stays at the origin and the repeating ground moves round it; the gunner's seat turns with the turret. Open-top or closed cabin, comfort vignette on or off, all motion within the comfort caps ([spikes/s2-riding.md](spikes/s2-riding.md)). Waiting on its headset check.
- Spike S3, lever feel (F0.5): Practice > Lever test puts two tank tillers and a lane board in front of the player. A gripped tiller follows the hand round its pivot, stops at ±25° with a tick and the drawn hand kept on the handle, springs back when let go, and the two drive a tank along a lane on the board. Tracked hands are steadied by a one-euro filter. Written up, with its headset check, in [spikes/s3-lever-feel.md](spikes/s3-lever-feel.md).

## Next

- Phase 0: spikes S1–S4 (sight render, riding the tank, lever feel, loading), alongside the cabin and seats (F1.1). Each feature is built in a thread of its own.
- Then the rest of Phase 1, each feature once the ones it depends on have merged.

## Waiting on a headset check

- Spike S2, riding the tank: ten minutes in each seat, open and closed, with and without the vignette ([checklist](spikes/s2-riding.md#headset-check)).
- Spike S1, the gunsight (F0.3): frame rate with the sight open at each size, and whether the range marks read at 3×. Steps in [s1-sight-render.md](spikes/s1-sight-render.md#headset-check-quest-3-then-pc-over-link).
- F0.6 Spike S4, loading a shell: the steps at the end of [spikes/s4-loading.md](spikes/s4-loading.md). The pass mark is ten loads in a row without a fumble, each under about 5 s; report the board's numbers.
- Spike S3, lever feel: the headset check at the end of [spikes/s3-lever-feel.md](spikes/s3-lever-feel.md), and its questions on travel, the stop at the limits, tracked hands and the spring back. The mechanism kit (F1.3) builds on the answers.
