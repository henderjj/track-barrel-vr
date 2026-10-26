# Progress and plans

The running record of where the game is and what comes next, so anyone (or any Claude session) can pick up the work. Update it with every feature: what shipped, what the headset check found, and what is next. Feature-by-feature status is in [roadmap.md](roadmap.md).

## Where things stand

- Started from the co-op VR game template: a blocks-and-hoop demo on a wooden deck (removed in F1.1), the start screen and game menu, hands, throwing and catching, the practice crewmate, the lobby, the browser tests and CI.
- The game's concept ([concept.md](concept.md)), implementation plan ([plan.md](plan.md)) and features roadmap ([roadmap.md](roadmap.md)) are written (F0.1, #1).
- Renamed to Track & Barrel VR (F0.2): package and lobby names, the page and start screen titles, and the browser storage keys, now `track-barrel.settings` and `track-barrel.colour`. Settings saved under the old `coop-vr.` keys are not carried over on purpose: on GitHub Pages every game of the account shares one origin, so those belong to the other games there. The lobby Worker is now `track-barrel-lobby`, a new Worker at a new `workers.dev` address on its first deploy; CI builds the game against whichever address it deploys.
- Spike S1, the magnified gunsight (F0.3): a sight (on a post at the deck's far corner, at the gunner's eyepiece since F1.1) looks out at target boards at 100, 250 and 500 m. A second camera renders the view into a 512² texture only while an eye is at the eyepiece, and the lens shows it at infinity at 3× with a reticle and range marks. Practice buttons go to it, aim it at each target and change when it draws, its size and which eyes see it; the perf HUD shows its own cost ([spike note](spikes/s1-sight-render.md)).
- Spike S4, loading a shell (F0.6, [spikes/s4-loading.md](spikes/s4-loading.md)): a loading station (on the deck behind the start spot, beside the tank since F1.1: ready rack, breech, lever) where a seated player takes a shell, swings it to the breech, rams it and closes the breech, timed and with fumbles counted on a board. Practice → Sit at the breech. Each player's own for now; F1.10 makes loading shared.
- The cabin and seats (F1.1, [cabin.md](cabin.md)): the hull with the driver's seat under a hatch and a vision slit, the turret with its basket, the gun's breech and the gunner's seat, on a wide ground. Each player sits in a seat: eyes at its eye point when VR starts, the head free to move inside the seat's box and stopped at its edge, back in the seat if they stand and walk. The host decides who sits where (the host drives by default) and the guest asks from Practice → Sit in; the crewmate is drawn seated in their seat, and the practice crewmate takes the free seat. The demo, the deck and thumbstick walking are gone. S1's sight now hangs at the gunner's eyepiece, S4's loading station stands beside the tank, and riding (S2) hides the cabin while it shows its own blockout. Every model is now lit by the sky's image-based light (they had been drawn black, as the scene has no lights).
- Spike S2, riding the tank (F0.4): Practice → Ride the tank puts a solo player in the driver's or gunner's seat of a blockout hull while the practice crewmate drives a scripted route and scans the turret, or the player drives and traverses with the thumbsticks. The tank stays at the origin and the repeating ground moves round it; the gunner's seat turns with the turret. Open-top or closed cabin, comfort vignette on or off, all motion within the comfort caps ([spikes/s2-riding.md](spikes/s2-riding.md)). Waiting on its headset check.

## Next

- Spike S3 (lever feel), then the rest of Phase 1, each feature once the ones it depends on have merged. Each feature is built in a thread of its own.
- F1.4 moves the cabin with the tank and retires the ride's blockout; F1.10 moves loading into the turret.

## Waiting on a headset check

- F1.1 the cabin and seats: the numbered steps in [cabin.md](cabin.md#headset-check), both seats, with the practice crewmate or a second headset.

- Spike S2, riding the tank: ten minutes in each seat, open and closed, with and without the vignette ([checklist](spikes/s2-riding.md#headset-check)).
- Spike S1, the gunsight (F0.3): frame rate with the sight open at each size, and whether the range marks read at 3×. Steps in [s1-sight-render.md](spikes/s1-sight-render.md#headset-check-quest-3-then-pc-over-link).
- F0.6 Spike S4, loading a shell: the steps at the end of [spikes/s4-loading.md](spikes/s4-loading.md). The pass mark is ten loads in a row without a fumble, each under about 5 s; report the board's numbers.
