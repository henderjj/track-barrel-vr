# Phase 2 plan: crew indicators and the biathlon

Agreed with John on 2026-11-07. Phase 2 is six features built in six threads, in two waves, with at most three threads open at once. The biathlon is the critical path, so its course starts first and the small indicators fill the other slots. Feature status lives in [roadmap.md](roadmap.md); this note is the order, the scope each thread starts from and what keeps them from clashing.

Every thread follows the usual feature shape (the `build-coop-vr-feature` skill): design note, engine-free logic and tests, model and z-fighting test, system, Practice shortcut, crewmate, XR and net tests, headset check. Each design note may refine the numbers below.

## Order

| Wave | Thread | Feature | Starts when |
| --- | --- | --- | --- |
| 1 | Build the biathlon course | F5.3a | John's sign-off |
| 1 | Add the driver's turret dial | F2.3 | John's sign-off |
| 1 | Add the callout card | F2.6 | John's sign-off |
| 2 | Add the biathlon race | F5.3b | F5.3a merges |
| 2 | Add the firing lamp | F2.5 | F2.3 merges (both build on the driver's hood; not a real dependency) |
| 2 | Show hull direction in the gunsight | F2.4 | the periscope fix (F1.6/F1.19) merges, as both edit `scope-lens.ts` |

Every feature's own Depends on is already merged, so the waits only keep shared files and cabin space from clashing. When F2.6 merges its slot goes to F2.4 or F1.1b (seated avatars, which touches only the avatar model), whichever is ready.

## The features

Sizes are relative: S is a day's thread, L is F1.11-sized.

### F5.3a Biathlon course (L)

- A loop of about 800 m on the range tile, round the outside of the existing targets so the range run still works, marked by posts or flags. Two firing lines: halt boxes on flat ground with their own target boards. A penalty loop of about 150 m leaves and rejoins the course beside the firing lines. The host tracks laps and gates (a missed gate is not a lap).
- Touches `src/sim/range.ts`, `src/sim/terrain.ts` (new flat corridors), `range.scene-asset.ts`, the ballistics' target list (so the new boards can be hit) and the crewmate's routes.
- Network: the host's lap and gate progress as a reliable `course` event; no packet.
- Crewmate: drives the loop and the penalty loop, halting in the firing boxes.
- Practice → Biathlon → Drive the course, Go to firing line 1 and 2.
- Risk: new corridors change the ground, so tests that park or roll the tank (parking brake slopes, Up the range) may need new spots.

### F5.3b Biathlon race (M)

- The timed race on F5.3a's course: 3 laps, a firing line after laps 1 and 2, 3 targets and 3 rounds per line, one penalty loop per target left standing, gold, silver and bronze times (set from the crewmate's run and John's first runs, then tuned). Hit targets fall or flag. Shots count only from a halt inside the firing box. A clean run is about 8 to 10 minutes with the Automatic box.
- Grows the range run (`range-run.ts`, `range-run-system.ts`) a mode rather than copying it, so the clocks, sign, countdown and F1.14's stats row serve both. Loading gets a limited-rounds rack at the line; the stats CSV gains laps, misses and penalty loops.
- Network: the `run` and `run-ask` events gain the biathlon's fields; no new names, no packet.
- Crewmate: as gunner it shoots the line's targets; as driver it takes the penalty loops it is owed.
- Practice → Biathlon → Start, plus Ready to fire at each line.

### F2.3 Turret position dial for the driver (S)

- A dial on the driver's side showing which way the gun points over a hull outline, so the driver knows before turning near walls or houses.
- No network: both pages already draw the turret's angle (packet 7). Nothing for the crewmate to learn.
- Practice: a Turret to 3 o'clock shortcut beside Lay the gun.

### F2.4 Hull direction in the gunner's sight (S)

- A small hull outline in a corner of the gunsight's view, turned by the turret's angle, and the same in the gunner's periscope (turret plus periscope angle), so the gunner can call "left" in the hull's terms.
- No network. Touches `src/systems/scope-lens.ts`, `sight-system.ts` and `periscope-system.ts`.

### F2.5 Firing lamp (S)

- A lamp by the driver's slit that lights by itself when the gun is ready to fire (shell rammed, breech closed, the gunner's hand on the power grip or the elevation handle) and flashes at the shot; no button, as the gunner's signal buttons were cut. A repeater in the turret shows the gunner what the driver sees.
- No network: both pages already have the loading state (packet 8) and the gunner's holds.
- Crewmate: as driver it holds steady while the lamp is lit. Ready to fire lights it at once.

### F2.6 Callout vocabulary card (S)

- A placard in each seat with the short callouts ("Driver, halt", "On the way", "Target, tank, 2 o'clock", "Traverse left", "Hold fire") and a clock face, matching the Calls the crewmate already uses. A setting hides it. F4.7 later teaches the same words.
- No network.

## Avoiding clashes

**Numbers.** No Phase 2 feature needs a new PacketType or HoldKind. PacketType 11 is reserved for F5.3 in case the course ever needs a 45 Hz state (not expected). HoldKind 15 is the last free value: each hand's hold is 4 bits in the pose packet and 0 to 14 are taken. The first gripped control after it (likely F3.5's extinguisher handles) must widen the holds field.

**Events.** F5.3a adds `course` (host to guest). F5.3b adds fields to `run` and `run-ask`. The indicators send nothing.

**Cabin spots.** Each design note confirms its position in centimetres and checks it against the others'.

| Feature | Where | Seat |
| --- | --- | --- |
| F2.3 turret dial | hood face, right of the slit (the run clock is on its left) | driver |
| F2.5 firing lamp | on the slit's frame, top edge, seen while looking out | driver |
| F2.5 repeater | turret wall by the gunsight | gunner |
| F2.6 card | hull wall left of the driver's seat; turret wall left of the sight | both |
| F2.4 hull outline | inside the sight's and the gunner periscope's view | gunner |

**Hot files.** Each thread merges main before enabling auto-merge.

| File | Touched by |
| --- | --- |
| `test/z-fighting.test.ts` | F5.3a, F5.3b, F2.3, F2.5, F2.6 |
| `public/ui/menu.uikitml`, `game-menu-system.ts`, `MENU_TABS` | all six (Practice shortcuts) |
| `scripts/xr-smoke-test.mjs` | all six; new steps go in whichever CI part is shortest |
| `scripts/net-test.mjs` | F5.3a, F5.3b |
| `driver-station.scene-asset.ts`, `cabin.scene-asset.ts` | F2.3, F2.5, F2.6 |
| `src/sim/range.ts`, `terrain.ts`, `range.scene-asset.ts` | F5.3a |
| `range-run.ts`, `range-run-system.ts`, play stats | F5.3b |
| `scope-lens.ts`, `sight-system.ts`, `periscope-system.ts` | F2.4, and the periscope fix |
| `crew-bot.ts`, `crew-bot-system.ts` | F5.3a, F5.3b, F2.5 |
| `src/index.ts` | any thread adding a system |
| `docs/roadmap.md`, `docs/progress.md` | all six |

## Decisions taken

1. The biathlon is split into course (F5.3a) and race (F5.3b): as one pull request it would carry terrain, models, lap tracking, game rules, the crewmate and two browser tests at once.
2. The race starts at 3 laps of about 800 m with 2 firing lines.
3. Shots count only at a halt in the firing box; firing on the move can come later.
4. The firing lamp lights by itself; no gunner's button.
5. The gunnery table stays in the roadmap's Ideas until after the biathlon's play test. It needs pop-up and moving targets, which could reuse F5.3's falling boards.

## Phase 1 items still open

- The periscope fix (F1.6 and F1.19: crank feel, window height) is in progress; F2.4 waits for it.
- F1.1b seated avatars has no thread yet and can run beside any Phase 2 thread.
- The headset checks of F1.13 (crewmate) and F1.14 (stats) are worth doing before F5.3b, which leans on the crewmate and adds rows to the stats CSV.
