# Range run (F1.11)

A timed run on the test range that answers the concept's play-test question "how long does a pair take to hit three targets?" (concept §14, plan §4.7). Start it from the game menu: the tank goes back to the start, a sign counts down, and a clock runs until each of the range's three targets has been hit once. The numbers live in [`src/sim/range-run.ts`](../src/sim/range-run.ts); the system is [`src/systems/range-run-system.ts`](../src/systems/range-run-system.ts).

## What players experience

- Game menu (Y) → **Practice → Range run → Start**. The tank is put back on the crossroads at the start, where the three targets stand at their marked ranges (100, 250 and 500 m), the turret turns forward and every shell goes back in the rack with the breech open. A sign in front of each player counts **3, 2, 1**, then **Go! Hit all three targets**. The seats stay as they are. Pressed again while a run is on (the button then says **Restart**), it starts over.
- The **run clock** shows the run in each seat: on the driver's front plate just right of the vision slit, and over the gunner's loading board on the turret's right wall. It reads "Get ready" and the countdown, then the time in big figures (0:42.1) with "Targets 1/3 Shots 4" under it, on a blue face while the clock runs. With no run on it shows the best time this session.
- The crew drive and shoot as they like: from the start all three targets are in the sight's field, so a crew can stay put or drive closer. Only shots fired while the clock runs count.
- When a shell hits a target for the first time, a **red flag** goes up on a pole beside it (on the side away from the road), as the hit burst shows, so both seats can see which targets are done. A second hit on the same target counts as a shot, not a target.
- The third target's hit stops the clock on the crew's time: the clocks turn green and say **Three hits!** with the time and the shots, and the sign says "Three targets in 1:23.4, 7 shots" for eight seconds. The menu's line under Range run keeps it, with the best time this session.
- **Stop** ends a run without a time: the clock goes back to the best time and the flags come down.
- If the crewmate steps away or the link drops (the crew-on-hold sign), the clock stands still and counts no shots until they are back; the clocks say "paused".
- **Practice → Ready to fire → 100 m / 250 m / 500 m** is the shortcut for checking a hit on a headset: the tank is parked at the start, the gun is laid on that target and a shell is rammed and the breech closed, so one pull of the power grip's trigger hits it. Alone, it puts the player in the gunner's seat; in a crew it leaves the seats and the gunner's page lays and loads. Used during a run, the run is marked **assisted**: it still finishes, but its time is not a best.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Countdown | 3 s | Long enough to take hold of the controls after closing the menu |
| Clock | tenths of a second, m:ss.s | A run takes minutes; tenths are enough to compare runs |
| Start | the crossroads at the start, facing up the range | Every target at its reticle mark (F0.3, F1.7), the same place as Back to start |
| A hit counts | when the shell lands (its flight time after the shot) | The count and the flag change as the burst shows, not before |
| Run clocks | 22 × 11 cm on the front plate 37 cm right of the slit's middle; 24 × 11 cm 10 cm over the loading board; faces 8 mm in front of their backings | Readable at 0.7 to 0.8 m from the seat's eyes, about 25° off the line of sight; clear of the slit's frame, the brow pad and the gauges |
| Hit flag | pole 4.2 m, flag 1.8 × 1.1 m, red, 1.2 m beyond the board's outer edge, flying away from the road | Above the boards (2.7 m at the most) so it reads over them; at 500 m about 0.2°, findable through the 3× sight |
| Ready to fire | waits up to 5 s for the tank to stand at the start (within 0.5 m, under 0.1 m/s), then lays with `aimAt` and loads | A guest gunner's page sees the host park the tank a few packets later |
| Sign | the countdown, Go! for 1.5 s, the finish for 8 s | |

Each run clock's backing is part of the hull's or turret's merged mesh (`src/scene-assets/range-run.scene-asset.ts`); the faces are canvases drawn only when a figure on them changes (ten times a second while the clock runs). The three flags are three small meshes on the ground, shown only when up. Nothing new is lit.

## Sharing

The host keeps the run, as it decides hits (plan §4.6):

- **`run`**, reliable event, host → guest, whenever the run changes (started, a shot counted, a target hit, finished, stopped, paused, assisted) and when the crewmate joins: the run's id, phase, clock, shots, when each target was hit, the time, the best time and whether it was assisted, with the host's clock when sent. The guest takes it, moves the clock on by the message's age (the shared clock, `netLink.toLocal`), and runs the clock on itself between events; it never finishes a run by itself.
- **`run-ask`**, reliable event, guest → host: Start, Stop, or "a Practice shortcut was used" (assisted).
- **`range-ready`**, reliable event, to the gunner's page: Ready to fire pressed on the other page. The tank is parked by the existing Back to start (`drive-reset` from a guest).
- Shots reach the run through FiringSystem's new `decidedListeners`, which the host calls with the target hit and the flight time for every shot it decides, its own page's or the crewmate's.
- A new run (a new id) seen during its countdown has the gunner's page put the turret forward and the loading back to the rack; a guest that joins part-way only copies the run.
- Alone, the page is the host and does all of it.

## The practice crewmate

Not yet: F1.13 (in progress) teaches the crewmate to drive, lay and fire; once it can, it runs the range with the player through these same rules. Until then, one person can check the run alone with Ready to fire.

## Departures from the building skill

- No practice crewmate part (F1.13 does it, per the roadmap), as for F1.8 and F1.10.
- The run clocks' faces are canvases added by the system, as the loading board's is (F1.10); their backings are in the cabin's model and its z-fighting test.
- The best time is kept for the session on the host only (not saved); per-run records and a CSV come with F1.14.

## Tests

- `test/range-run.test.ts`: the countdown, shots in it not counting, a hit counting when the shell lands, a second hit on a target, the run finishing on the third target with the time; the best time, assisted runs not counting as a best, a clean restart; Stop bringing the flags down and a shell in the air landing on nothing; the clock holding while paused; the `run` event's round trip, the guest's clock moving on by its age and never finishing a run by itself, bad events refused; the time format and the sign's text; each flag beside its target, away from the road, never over the board, on the flat corridor.
- `test/loading.test.ts`: Ready to fire's instant load (no load or fumble counted, a held shell back in the rack, fires normally).
- `test/z-fighting.test.ts`: the hull and turret with the clocks' backings (the existing cabin checks), and the hit flag alone and raised beside each target on the ground.
- `npm run test:xr` (step 6i): Practice → Range run → Start brings the tank back from up the road and counts down on the sign and the clocks; the clock runs; Ready to fire → 100 m (a ray click) puts the player in the gunner's seat laid and loaded, the trigger hits, the flag goes up beside the target; 250 m and 500 m the same; the third hit stops the clock (assisted), with the sign and the menu's line; Stop takes the flags down. Screenshots: `artifacts/xr-run-countdown.png`, `artifacts/xr-run-done.png`.
- A fix found on the way: the floating signs (`FloatingSign`, the drive's, the turret's and this run's) no longer catch controller rays. The finish sign, floating between the player and the game menu, swallowed the click on Stop.
- `npm run test:net` (`ONLY_RUN=1`, or `=lag`): a guest gunner's Start runs the host's run on both pages with clocks within 0.4 s; the host driver's Ready to fire has the guest's page lay and load; the guest's hit counts on the host and comes back with the flag up; the host's Stop ends it on both; on a clean link and at 150 ms RTT.

`window.__rangeRun` gives `state()` (the run with `targets` and the menu `line`), `start()`, `stop()`, `ready(i)`, `clock()` (the clocks' three lines), `flags()`, `flagAt(i)`, `pending`, `sign`, `sent` and `received`. `shownRun()` in the system is the hook for F1.14's play-test stats.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated (menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Range run → Start**. The menu closes, the sign counts 3, 2, 1, Go! Say whether the sign is easy to read and in the way or not.
2. Look at the **run clock**: from the driver's seat (Practice → Sit in → Driver), on the front plate right of the slit; from the gunner's, over the loading board. Report whether the time and the targets line are readable from the seat without leaning.
3. Menu → **Practice → Ready to fire → 100 m**: you are in the gunner's seat, the breech closed. Take the power grip and pull its trigger: the shot hits, and a red flag goes up beside the 100 m target (look out of the turret's vision gaps or the sight). The clock says Targets 1/3.
4. **250 m** and **500 m** the same way. On the third hit the clock stops and turns green, "Three hits (assisted)", and the sign gives the time. Report whether you could see each flag from the gunner's seat and through the sight, and whether the 500 m one shows through the fog.
5. **Stop**: the flags come down. Then **Start** again and hit all three by hand: load from the rack, lay with the wheel and crank (or the power grip), fire. Report the time and the shots from the clock.
6. With a second headset (or `?bot=1` on a PC page for a crewmate), one in each seat: start a run from either seat, drive and shoot together, and report the crew's time, the shots, and whether both clocks agreed. The play-test questions (concept §14): how long it took, whether you talked without prompting, and which control you fumbled most.
7. Press **X** for the perf HUD while the clock runs: report the frame time and draw calls (the two clocks and three flags add five draw calls at most).
