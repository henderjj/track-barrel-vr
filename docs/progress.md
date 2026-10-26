# Progress and plans

The running record of where the game is and what comes next, so anyone (or any Claude session) can pick up the work. Update it with every feature: what shipped, what the headset check found, and what is next. Feature-by-feature status is in [roadmap.md](roadmap.md).

## Where things stand

- Started from the co-op VR game template: the blocks-and-hoop demo ([play-area.md](play-area.md)), the start screen and game menu, hands, throwing and catching, the practice crewmate, the lobby, the browser tests and CI.
- The game's concept ([concept.md](concept.md)), implementation plan ([plan.md](plan.md)) and features roadmap ([roadmap.md](roadmap.md)) are written (F0.1, #1).
- Renamed to Track & Barrel VR (F0.2): package and lobby names, the page and start screen titles, and the browser storage keys, now `track-barrel.settings` and `track-barrel.colour`. Settings saved under the old `coop-vr.` keys are not carried over on purpose: on GitHub Pages every game of the account shares one origin, so those belong to the other games there. The lobby Worker is now `track-barrel-lobby`, a new Worker at a new `workers.dev` address on its first deploy; CI builds the game against whichever address it deploys.

- Spike S4, loading a shell (F0.6, [spikes/s4-loading.md](spikes/s4-loading.md)): a loading station on the deck behind the start spot (ready rack, breech, lever) where a seated player takes a shell, swings it to the breech, rams it and closes the breech, timed and with fumbles counted on a board. Practice → Sit at the breech. Each player's own for now; F1.10 makes loading shared.

## Next

- Phase 0: spikes S1–S4 (sight render, riding the tank, lever feel, loading), alongside the cabin and seats (F1.1). Each feature is built in a thread of its own.
- Then the rest of Phase 1, each feature once the ones it depends on have merged.

## Waiting on a headset check

- F0.6 Spike S4, loading a shell: the steps at the end of [spikes/s4-loading.md](spikes/s4-loading.md). The pass mark is ten loads in a row without a fumble, each under about 5 s; report the board's numbers.
