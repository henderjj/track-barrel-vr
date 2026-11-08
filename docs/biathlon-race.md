# Biathlon race (F5.3b)

The timed tank biathlon on F5.3a's course ([biathlon-course.md](biathlon-course.md)): three laps against the clock, a firing line after laps 1 and 2 with three rounds for its three boards, a penalty loop for every board left standing, and gold, silver and bronze times. It is the range run's second mode ([range-run.md](range-run.md)), not a copy of it, so the countdown, the run clocks, the sign, Stop and Restart and F1.14's stats row serve both ([phase-2-plan.md](phase-2-plan.md)).

The rules and their numbers live in [`src/sim/biathlon.ts`](../src/sim/biathlon.ts) and the run's race mode in [`src/sim/range-run.ts`](../src/sim/range-run.ts); [`src/systems/range-run-system.ts`](../src/systems/range-run-system.ts) shares the race, covers the fallen boards and gives the gunner's rack its rounds; the limited rack is [`src/sim/loading.ts`](../src/sim/loading.ts)'s.

## What players experience

- **Start.** Practice → Biathlon race → **Start** parks the tank 10 m short of the course's start line, facing up the track, with the engine as the crew left it. The turret turns forward, the gunner's rack holds the first line's three rounds (its fourth slot empty) and the sign counts down: "Biathlon: 3, 2, 1", then "Go! Three laps, shoot at each line". The race clock runs from Go.
- **Laps.** The course counts laps as before (a lap that misses a gate doesn't count, and the crew drives another). The run clocks in both seats show "Lap 1/3", the time, and the line's rounds left or what is owed.
- **Firing lines.** On lap 1 the crew halts in firing box 1 (one blue band); on lap 2 in box 2 (two bands). Each line has three rounds in the rack. A round counts only fired from a halt inside that lap's box, at one of that line's boards still standing; a round fired anywhere else (on the move, in the wrong box, at the range's targets) is spent and hits nothing. A board that is hit falls: a white cover swings over its black disc, as a biathlon target's flap does, so the boards left to shoot still read as black discs in the sight. With the third round landed the line is shot: "Line 1: clean!" or "Line 1: 2 down, 1 penalty loop". The loading board says "No rounds left" with the rack empty.
- **Penalty loops.** Every board left standing is a loop owed. The penalty loop leaves the course just past the boxes; each pass through its yellow gate pays one ("Penalty loop done: 1 to go"). Loops driven when none is owed count for nothing. Crossing the finish with loops still owed (or with rounds not fired at the line: its standing boards become loops owed then) adds a minute for each: "+1:00: 1 penalty loop not driven".
- **Finish.** Crossing the line at the end of lap 3 stops the clock: "Finished in 9:12.4: Silver", with the penalty minutes added. The clocks show the medal, the boards down and the loops. Restart starts a new race; Stop ends it without a time, and the covers come down and the rack is full again.
- **Ready line 1 / Ready line 2** (Practice → Biathlon race) park the tank halted in that box with the engine running, the gun laid on the line's first board still standing and loaded; alone, the player takes the gunner's seat. One pull of the trigger brings it down. A race that uses it is marked assisted (its time isn't a best).
- **The practice crewmate.** As driver it drives the race from the start line once the countdown ends: it halts in the lap's box and waits there while the line is open (until the gunner's third round lands), goes round the penalty loop once for each loop owed, and halts past the finish. The gunner's Course call during a race has it join the race on the lap it is on. As gunner it loads on the way but only lays and fires halted in the lap's box, at the line's boards still standing, with its hand off the power grip until then (so the firing lamp doesn't stop the driver).

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Laps | 3 | The plan's race: about 2.4 km |
| Lines | after lap 1 (box 1, boards at 150 m) and lap 2 (box 2, 220 m) | F5.3a's boxes are on the home straight, before the finish |
| Rounds | 3 a line, in the 4-slot rack; refilled when a lap is counted; none on lap 3 | One per board, as in biathlon |
| A shot counts | halted (under 0.3 m/s) in the lap's box, the clock running, on that line's board still standing | The plan's "firing at a halt"; the course's own halt test |
| Penalty loop | one per board standing; 153 m, about 47 s at the crewmate's 12 km/h | F5.3a's loop |
| Loop not driven | +60 s each | More than driving it, so it is never worth skipping |
| Medals | gold ≤ 8:45, silver ≤ 10:00, bronze ≤ 11:30 | From the crewmate's runs (below); to tune from John's first runs |
| Board cover | white disc 3 cm wider than the board's disc, 2 cm thick, 1 cm in front of it | The 8 mm rule out in the world |

**Medal times.** `test/biathlon.test.ts` drives the whole race with the crewmate driver (20 km/h round the loop, 10 km/h into the boxes) and a pretend gunner firing a round every 8 s once halted: 9:03 clean, 11:22 with three penalty loops. So the crewmate's clean race is silver, gold asks for a quicker, clean crew, and bronze allows about three loops. The plan's "a clean run is about 8 to 10 minutes" holds.

## Sharing

The host keeps the race, as it keeps the range run: it feeds the race the course's progress each frame (laps, missed laps and penalty loops counted by what changed since the last frame, so the course starting again after a Practice jump loses nothing), and counts every shot it decides (FiringSystem's `decidedListeners`). The **`run` event gains the race's fields**: `mode`, `laps`, `rounds`, `boardAt` (when each of the six boards fell), `owed`, `loops`, `skipped`, `closed` (lines shot) and the latest `note`. A page on an older build sends none of them and reads as a range run. **`run-ask` gains `mode`** (a guest's Start of a race). `range-ready` gains `line`, so the gunner's page lays and loads in the right box when the other page pressed Ready line. No new event names and no new packet: PacketType 11 stays free.

**The limited rack.** The gunner's page does the loading, so it sets the rack from the race's `rounds` whenever the host's count changes (a new line, a line shot, a round fired) or the loading started again unlimited (the seats swapped). Between those it spends its own rounds as they are fired, ahead of the host's word, so the slot is empty at once even at 150 ms. A spent shell is a new shell place, `spent`, at the end of the loading packet's list: the other page draws the empty slot from the packet it already gets, and a page on an older build draws it in the rack.

**Covers** are drawn on both pages from `boardAt`, children of the ground at each board's nearest copy (as the range run's flags).

## Stats

F1.14's CSV gains `mode`, `laps`, `misses` (rounds that brought no board down), `penalty_loops`, `loops_skipped` and `medal` after its earlier columns, filled for a race's row; the menu's last-run line says the race's time, medal and loops.

## Departures from the building skill

- **No new model entity.** The covers are six small meshes on the ground, hidden until their board falls; the boards themselves are F5.3a's, merged into the ground's chunks.
- **No new HoldKind, packet or event name.** Nothing new is gripped; the race changes a few times a lap.

## Tests

- `test/biathlon.test.ts`: a whole race by hand (a round on the move wasted, line 1's boards falling only from a halt in box 1, the line closing on its third round with loops owed, a loop paying one, a loop skipped adding a minute, line 2 refilled, a missed lap not finishing the race, the time and medal); the course starting again losing nothing; pausing; a best for each mode; the event's round trip and an old page's event; the medals; the crewmate driving a clean race (no loops, no missed gate, on the track, between the gold and silver times) and one with three standing boards (three loops before the finish); joining the race on the lap it is on; the race's CSV row.
- `test/loading.test.ts`: the rack holding only the rounds left, spending each one fired, nothing to load once none are left ("No rounds left"), refilling; never taking a shell from a hand or the breech; a spent shell in the loading packet.
- `test/z-fighting.test.ts`: the cover on its own and over every board on the ground.
- `npm run test:xr`, step 6r (part 1): Start parks the tank at the course's start and counts down with three rounds in the rack; Ready line 1 lays and loads in box 1, and three trigger pulls bring the line's three boards down under their covers and shoot it clean (the sign says so), the rack empty and the loading board saying no rounds are left; Stop ends the race, the covers gone and the rack full. Screenshot: `artifacts/xr-race-line.png`.
- `npm run test:net` (`ONLY_RACE=1`, or `=lag` at about 150 ms RTT): the host's Start shows the race on both pages with three rounds in the guest gunner's rack (and the host drawing the empty slot); the host's Ready line 1 has the guest's page lay and load; the guest's round brings the board down and spends a round on both pages; the guest's Stop ends it on both.

`window.__rangeRun` gains `race()`, `readyLine(k)`, `covers()`, `coverAt(j)`, `rounds()` (the rack's limit on the loading page) and `lineNow()` (the line a shot counts at now).

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated. Best with the crewmate (`?bot=1` on a PC page), then once alone.

1. With the crewmate as gunner, you driving: Game menu (Y) → **Practice → Biathlon race → Start**. A countdown, then Go. Say whether the run clock beside the slit is easy to read on the move.
2. Drive lap 1 and halt in box 1. The crewmate shoots three rounds; each board it hits turns white. Say whether you can see the covers from the slit or the periscope, and whether the sign ("Line 1: …") is clear.
3. Drive the penalty loop once for each board left standing ("Penalty loop done"), then on round. Skip one on purpose on lap 2 and say whether "+1:00" at the finish is fair.
4. Finish lap 3: "Finished in …" with a medal. Say your time, and whether gold (8:45), silver (10:00) and bronze (11:30) feel right.
5. Swap: you gunner, the crewmate driving. Start a race: it drives off at Go, halts in each box and waits for your three rounds, then takes the loops you owe. Say how the rack with only three shells (the fourth slot empty) feels, and whether "No rounds left" on the loading board is clear.
6. Alone: **Ready line 2** seats you as gunner in box 2, laid and loaded; fire, and look through the sight: the board turns white at 220 m.
7. Game menu → Comfort and stats → Save the CSV: the race's row has its laps, misses, penalty loops and medal.
8. With the performance HUD on during a race, say whether the frame time stays as before.
