# Progress and plans

The running record of where the game is and what comes next, so anyone (or any Claude session) can pick up the work. Update it with every feature: what shipped, what the headset check found, and what is next. Feature-by-feature status is in [roadmap.md](roadmap.md).

## Where things stand

- Started from the co-op VR game template: the blocks-and-hoop demo ([play-area.md](play-area.md)), the start screen and game menu, hands, throwing and catching, the practice crewmate, the lobby, the browser tests and CI.
- The game's concept ([concept.md](concept.md)), implementation plan ([plan.md](plan.md)) and features roadmap ([roadmap.md](roadmap.md)) are written (F0.1, #1).
- Renamed to Track & Barrel VR (F0.2): package and lobby names, the page and start screen titles, and the browser storage keys, now `track-barrel.settings` and `track-barrel.colour`. Settings saved under the old `coop-vr.` keys are not carried over on purpose: on GitHub Pages every game of the account shares one origin, so those belong to the other games there. The lobby Worker is now `track-barrel-lobby`, a new Worker at a new `workers.dev` address on its first deploy; CI builds the game against whichever address it deploys.
- Spike S2, riding the tank (F0.4): Practice → Ride the tank puts a solo player in the driver's or gunner's seat of a blockout hull while the practice crewmate drives a scripted route and scans the turret, or the player drives and traverses with the thumbsticks. The tank stays at the origin and the repeating ground moves round it; the gunner's seat turns with the turret. Open-top or closed cabin, comfort vignette on or off, all motion within the comfort caps ([spikes/s2-riding.md](spikes/s2-riding.md)). Waiting on its headset check.

## Next

- Phase 0: spikes S1–S4 (sight render, riding the tank, lever feel, loading), alongside the cabin and seats (F1.1). Each feature is built in a thread of its own.
- Then the rest of Phase 1, each feature once the ones it depends on have merged.

## Waiting on a headset check

- Spike S2, riding the tank: ten minutes in each seat, open and closed, with and without the vignette ([checklist](spikes/s2-riding.md#headset-check)).
