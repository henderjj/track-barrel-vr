# Comfort and play-test stats (F1.14)

The last feature of Phase 1. Two halves: comfort settings each player picks for themselves, and play-test stats that answer the concept's Phase 1 questions (§14 in [concept.md](concept.md)) with numbers instead of memories.

## What the players get

The game menu (Y) has a new **Comfort and stats** section near the top:

- **Vignette: Off, Light, Normal, Strong.** How dark the edge of view gets at its darkest while the tank turns, speeds up, slows or tilts (and the turret turns, for the gunner). Normal (0.5) is spike S2's, the default; Light is 0.3, Strong 0.8, Off none. It used to be an on/off row in the Driving section; it is now a setting of its own, kept in this browser like the others, and `?vignette=0.8` sets it at load. Each player's own: it only darkens their view.
- **Bumps: Full, Reduced.** Reduced bumps make the hull take 40% of the ground's tilt (1.6° at most instead of 4°), ease into it over 1.2 s instead of 0.5 s, and rise and fall over 0.3 s instead of 0.1 s, so a mound is a slow sway rather than a pitch. Both players ride the same tank, so **the tank rides reduced if either player asks**; the menu row shows that player's own choice. `?bumps=reduced` at load.
- **How I feel: I feel queasy.** Press it the moment you feel unwell. It writes a row with the time, the run clock if a run is on, your seat, the tank's speed and how fast your view was turning, so "does anyone feel motion sick, and when?" has an answer. The status line under it says it was marked and suggests a break.
- **Play-test stats: Save CSV, Clear**, and a line on the last run: "Last: run 3 0:42.1, 5 shots, 2 grinds, 3 fumbles (most: shell). 4 runs, 1 queasy mark recorded." Save CSV downloads the log (in the headset it lands in Quest Browser's downloads; on a PC page the perf overlay's **Stats** link does the same). Clear forgets it.

## What is counted

Each page counts what its own player does while a range run's clock runs (F1.11: after the countdown, not while the crewmate is away), and writes one row when the run ends: done (all three targets hit), stopped, or restarted.

| Column | What |
| --- | --- |
| `kind` | `run`, `queasy` (a mark) or `visit` (the last row of a saved CSV: everything since the page loaded, runs or not) |
| `run`, `at`, `seat`, `crewmate` | The run's number, the local time the row was written, this player's seat at the end, and `none`, `player` or `bot` |
| `result`, `time_s` | done, stopped or restarted, and the crew's time for three hits (or the clock when stopped) |
| `shots`, `targets`, `assisted` | As the run clock showed them; assisted if Ready to fire was used |
| `grinds` | Times the gears ground (the tank's, so both players' rows agree) |
| `fumbles`, `fumbles_<control>`, `most_fumbled` | This player's fumbles, in total and per control: tillers, gear, throttle, power_traverse, crank, elevation, periscope, breech, shell, other |
| `driver_s`, `gunner_s` | Seconds this player spent in each seat (seats can be swapped mid-run) |
| `talk_s`, `crew_talk_s` | Seconds this player's microphone, and the crewmate's voice, were above the intercom's speaking level (gaps under 0.3 s between words count as talking; a muted microphone reads silent) |
| `crew_driver_s`, `crew_gunner_s`, `crew_fumbles`, `crew_most_fumbled` | The crewmate's own numbers for the same run, sent by their page, so either player's CSV has the whole crew |
| `queasy` | Queasy marks during the run (1 on a mark's own row) |
| `vignette`, `bumps` | The vignette strength and the bumps the tank rode on |
| `speed_kmh`, `turn_dps` | For a mark: the tank's speed and the view's turn rate at that moment |
| `label` | The `?label=` tag, as the perf CSV has |

A **fumble** is one of:

- a hand pulled off a control because the real hand strayed 25 cm from the handle (grip locking lets go): a slip, counted against that control;
- a squeeze that took hold of nothing within 20 cm of a control (twice the kit's 10 cm reach): a miss, counted against the nearest one. A squeeze the loading took a shell with is not a miss;
- a shell dropped (shell), or the breech closed on a shell not rammed home (breech), as the loading board already counts them.

The rows are kept in this browser (`track-barrel.stats`, the last 500), so a crash, a reload or leaving VR doesn't lose them.

## How both players share it

- The vignette is each page's own.
- Bumps: each page tells the other its choice with a reliable `comfort {bumps}` event when it connects and when it changes; the host, which runs the tank, follows the ground with reduced bumps if either asked. Because the hull's tilt is the simulation's, the gun's aim, the sight and the shots all agree with what is drawn.
- Stats: every page watches the run as it shows it (`shownRun()`), so the host's and the guest's rows describe the same run. When a run ends each page sends its own numbers to the other (`run-stats {run, driver, gunner, grinds, fumbles, bot}`); they are matched to that run's row whichever arrives first.
- The practice crewmate's page counts and sends its numbers too (marked `bot`), so a solo tester's CSV says what the crewmate did.

Nothing new goes over the unreliable channel.

## Code

- `src/sim/comfort.ts`: `VIGNETTE_STRENGTHS`, `FULL_BUMPS`/`REDUCED_BUMPS` (`GroundFeel`), `crewBumps`. `stepDrive` and `settle` in `src/sim/tank-drive.ts` take a `GroundFeel`.
- `src/sim/play-stats.ts`: fumble groups, `RunTally` and `stepTally`, `RunRecorder` (watches the run, says when it ended and how), the `run-stats` event, `StatsLog` (rows, matching the crewmate's numbers, CSV, JSON for storage), the menu line.
- `src/systems/fumbles.ts`: `reportFumble` and `squeezeNear`, which `MechanismSystem` (slips, near misses) and `LoadingSystem` (drops, blocked breech) report into.
- `src/systems/play-stats-system.ts`: `PlayStatsSystem`, registered after every system that holds a hand. `DriveSystem` reads `settings.vignette` and the crew's bumps.
- Settings: `vignette` and `bumps` are live settings (`LIVE_ITEMS`), rows `row-vignette` and `row-bumps` in `public/ui/menu.uikitml`; buttons `menu-queasy`, `menu-stats-save`, `menu-stats-clear`, line `menu-stats-status`.

## Tests

- `test/play-stats.test.ts`: fumble groups, seat and talk time, rows for a done, stopped and restarted run, nothing counted during the countdown or while paused, the crewmate's numbers matched either way round, the CSV's columns, storage round trip.
- `test/tank-drive.test.ts`: reduced bumps take less tilt, more gently, along the same path with the tracks on the ground; either player asking gives reduced.
- `npm run test:xr` (step 6m): Vignette → Strong darkens beyond Normal's limit while the tank pulls away and Off leaves the view clear; Bumps → Reduced; in a run, a squeeze 14 cm wide of the gear lever is a fumble against it, a grind is counted, I feel queasy marks the run time, Stop writes the row and the menu line and CSV show it.
- `npm run test:net` (`statsChecks`, also under `ONLY_RUN`): after a shared run each page has the stopped run's row with the crewmate's seat times; the guest's Reduced bumps make the host's tank ride reduced, and Full puts it back.

`window.__stats` gives `rows()`, `csv()`, `tally()` (the run on now), `visit()`, `counting`, `line`, `queasy()`, `clear()`, `fumble(control, how)`, `sent` and `received`. `window.__drive` adds `bumps` and `crewBumps`.

## Still open

- Tracked hands still have no trigger gesture, so they can load but not fire (from F1.10).
- The stats count only during a range run (and the visit row). If free driving turns out to be where people get queasy, a "session" mode could count without a run.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Comfort and stats → Vignette → Strong**, then **Practice → Drive the tank** and drive about with turns. The edge of view should darken more than before. Try **Light** and **Off** too and say which you would pick.
2. **Bumps → Reduced**, then **Practice → Test range → Up the range** and drive across the rough ground off the roads. Report whether the hull sways more gently than with Full, and whether the ground looks wrong through the slit (with reduced bumps the hull tilts less than the ground, so its front can sit a few centimetres into a slope).
3. **Practice → Range run → Start** and play the run through by hand, as driver or gunner (`?bot=1` on a PC page gives a crewmate). During it, squeeze once just beside a control without taking hold, and press **I feel queasy** once.
4. After the run, open the menu: the Comfort and stats line gives the run's time, shots, grinds and fumbles with the most fumbled control. Report the line.
5. **Save CSV**, then exit VR and find the file in Quest Browser's downloads (or press **Stats** on the PC page's perf overlay). Open it on a PC: one row for the run (with your squeeze as a fumble and the queasy mark), one for the mark, and a visit row. Report whether it opened and what it said.
6. With a second headset: both players play a run, one picks Bumps → Reduced. Both should feel the gentler ride. Each saves the CSV: each row should have the crewmate's seat times (`crew_driver_s`, `crew_gunner_s`).
7. Press **X** for the perf HUD while a run is on: report the frame time (the stats add no draw calls).
