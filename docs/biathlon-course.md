# Biathlon course (F5.3a)

A tank biathlon course on the range tile, east of the range's targets: an 808 m loop of gravel track marked with flagged gates, two firing boxes on its home straight, each with three boards of its own down a firing lane behind it, and a 153 m penalty loop beside them. The host follows the tank round it and counts laps; a lap that misses a gate doesn't count. This is the course only: the timed race (3 laps, shooting at each line, a penalty loop per board left standing, medal times) is F5.3b ([phase-2-plan.md](phase-2-plan.md)), which builds on it.

The numbers and the lap rules live in [`src/sim/course.ts`](../src/sim/course.ts); the track, gates, boxes and boards are drawn into the ground's model by [`src/scene-assets/course.scene-asset.ts`](../src/scene-assets/course.scene-asset.ts); [`src/systems/course-system.ts`](../src/systems/course-system.ts) keeps and shares the crew's progress and shows its notes.

## What players experience

- **The course.** From the range's start, the loop lies off to the right: a 10 m wide gravel track, a little lighter than the ground, round a flat field of about 260 by 170 m. It runs anticlockwise seen from above, so the infield is always on the driver's left. Corners are 30 m in radius, easy at 20 km/h.
- **The start and finish line** is on the east side: two banded posts with a chequered banner across the track about 4.5 m up and a chequered line painted on the gravel. Practice → Biathlon → Course parks the tank 10 m short of it, facing up the track.
- **Gates.** A pair of red-flagged poles every 80 m from the finish round to the south side, 1.5 m outside the track's edges: eight to pass on a lap besides the finish. Drive through each one forwards. Miss one and a sign says "Missed gate 3: this lap won't count"; crossing the finish then says "Lap not counted: missed gate 3" and the next lap starts clean.
- **Laps.** Crossing the start line the first time says "Lap 1: go!" and starts the lap clock; each counted lap says "Lap 2 in 1:58.4". The game menu's Biathlon row shows the lap, its clock, the gates passed ("gates 2 of 8"), laps done and the best lap.
- **The firing boxes** are on the home straight, just before the finish: two 12 × 8 m rectangles painted on the track, with a blue-banded post at each corner (one band for box 1, two for box 2). Halting inside one (under 0.3 m/s) says "Halted in firing box 1". Each box's three boards stand down a firing lane behind it, square to the box: white boards 2.2 m square with a black disc 80 cm across, a blue bar on top with one or two white blocks so the gunner can tell which line they belong to. Since the harder shooting ([biathlon-race.md](biathlon-race.md#harder-shooting)) they stand 400 m (line 1) and 500 m (line 2) away until a race picks its own ranges, 6 m apart. From a box the gunner traverses to 6 o'clock to lay on them.
- **The penalty loop** leaves the course to the right just past the boxes and comes back onto it a little short of where it left: a tight 8 m wide oval, a darker gravel, with a yellow-flagged gate on its far straight. Each pass through that gate says "Penalty loop 1" and counts.
- **Practice → Biathlon → Line 1 / Line 2** parks the tank halted in that box with the engine running (for the power traverse). Alone, the player takes the gunner's seat; in a crew the seats stay as they are. Shots at the boards count as hits like the range's targets ("Hit: the line 1 left board").
- **The practice crewmate** drives the course when the gunner calls **Course** (Calls row): two laps at about 20 km/h, slowing for box 1 on the first lap and box 2 on the second, halting 15 s in each, and taking the penalty loop once on the first lap. Halted in a box, a crewmate gunner shoots that line's boards.

## Numbers

World space on the range tile (`x` east, `z` south; the range's start at the origin faces north, −z).

| What | Value | Why |
| --- | --- | --- |
| Loop | middle line x 60 to 320, z −110 to −280, corners 30 m; 808.5 m round | The plan's 800 m. East of the range's targets and out of the sight's view from the range start, so the range is unchanged |
| Track | 10 m wide, 3 cm above the ground; gravel `0xb4a684` | A Sherman is 2.6 m wide: room to pick a line. 3 cm is the roads' 8 mm rule with room to spare |
| Field | x 45 to 370, z −95 to −295 flattened, blending out over 25 m; no obstacles within 4 m of it, and no scatter on the track | Firing boxes need flat ground, and a lap must not drive over rocks. Obstacles are filtered after they are placed, so every other one stays where it was |
| Gates | 9 at 0, 80, … 640 m (gate 0 is the finish); posts 6.5 m from the middle line | Close enough that cutting a corner misses one; wide enough that a driver on the track never clips a post |
| Firing boxes | 12 × 8 m, middles at (320, −152) and (320, −170), facing north | On flat ground on the home straight, back to back, so the race's laps pass both |
| Boards | 2.2 m square, disc 0.8 m (the disc is the hit box); 6 m apart, down a firing lane south of each box, 400 m (line 1) and 500 m (line 2) until a race picks its own | Since the harder shooting ([biathlon-race.md](biathlon-race.md#harder-shooting)); they began at 150 and 220 m across the infield. Square to the box so each disc reads round |
| Penalty loop | 153 m: curves of 18 m radius, 8 m wide, leaving at z −215 and rejoining at −195, the gate at (356, −205) | The plan's 150 m. One loop takes about 40 s at 12 km/h |
| Halted | under 0.3 m/s with the tank's middle in a box | The range run's halt |
| Jump | a move over 15 m in one frame (a Practice shortcut) starts the progress again, keeping the best lap | So placing the tank never counts a gate |

The track and fixtures are part of the ground's model, one merged mesh per chunk, so they add no draw calls. The ground grows from 73,792 to 101,642 triangles across its 9 tile copies (most of it the track's ribbons, sampled every 5 m); the frustum culls all but a few chunks.

## Sharing

The host follows the tank round the course (`CourseProgress.step` from `tankState()`) and sends the whole progress as a reliable **`course` event** whenever it changes: laps, missed laps, penalty loops, the gates passed, the lap clock, the last and best lap, the box the tank is in and whether it is halted, and the latest note. It sends it again when a guest joins. The guest copies it and runs the lap clock on between events (allowing for the event's age). No new packet: PacketType 11 stays reserved. While the crewmate is away (`crewPresence.paused`) the lap clock stands still.

The Practice shortcuts work from either page: a guest's `placeTank` and `startEngine` already ask the host (`drive-place`, `engine-start`).

F5.3b reads the progress through `shownCourse()` and the boards' hits through FiringSystem's `decidedListeners` (`targetFaces()` puts the range's three targets first, then the six boards: indices 3 to 8, from `COURSE_TARGET_FIRST`).

## The practice crewmate

The gunner's call **Course** ("Driver, drive the course") has a crewmate driver follow `COURSE_ROUTE`: route legs every 10 m along the middle line, which it passes through rather than stopping at (`through` legs), so it holds its speed round the loop. It starts from the leg nearest the tank, so the call works from anywhere on the course. Left or Right halts it.

## Departures from the building skill

- **No new model entity.** The course is drawn into the ground's chunks (it must move and wrap with the ground), so the z-fighting test checks the course's pieces on the ground rather than a separate prop.
- **No new HoldKind or packet**: nothing new is gripped, and the progress changes a few times a lap.

## Tests

- `test/course.test.ts`: the loop's and penalty loop's lengths; the field flat and clear of obstacles; gates spaced along the track; boxes on flat ground; boards in their lines and clear of each other's lines of fire and of the range's targets; a shell from each box hitting its own boards; laps counting, a missed gate spoiling a lap, penalty loops counting, a jump starting again; the `course` event's round trip.
- `test/crew-bot.test.ts`: the crewmate drives two laps, halting in box 1 then box 2, takes one penalty loop, misses no gate and stays on the track; and picks up the course where the tank stands.
- `test/z-fighting.test.ts`: the track, gates, finish, boxes and boards on the ground.
- `npm run test:xr`, step 6q (part 3): Practice → Biathlon → Course seats a solo player as driver short of the start line; driving up the course crosses it ("Lap 1: go!" sign) and passes gates 1 and 2, which the menu line shows; Line 1 seats the gunner halted in box 1 with the engine running, and a shot at the line 1 left board hits it. Screenshots: `artifacts/xr-course.png`, `artifacts/xr-course-line.png`.
- `npm run test:net` (`ONLY_COURSE=1`, or `=lag` at about 150 ms RTT): the host crosses the start line and the guest hears lap 1 start; the guest's Line 2 parks the tank in box 2, halted there on both pages.

`window.__course` gives `state()` (the progress and the menu's line), `layout()` (gates, boxes, boards, lengths), `pointAt(s)` (the middle line `s` m from the finish), `go()`, `line(k)`, the sign's text, and counts of events sent and received and frames run.

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated.

1. Enter VR alone. Game menu (Y) → **Practice → Biathlon → Course**. You are in the driver's seat on a gravel track, the chequered finish banner just ahead. Nothing on the track or the banner flickers.
2. Drive off. Crossing the line a sign says "Lap 1: go!". Drive the loop: say whether the red-flagged gates are easy to see coming, and whether the corners are comfortable at the speed you drive.
3. Cut inside a gate on purpose: a sign says it was missed and the lap won't count. Finish the lap: "Lap not counted".
4. Drive a clean lap: at the finish, "Lap 2 in m:ss.s". Open the menu: the Biathlon row shows the lap, gates and best lap.
5. On the home straight, drive into box 1 (one blue band on its posts) and stop: "Halted in firing box 1". Then go round the penalty loop beside the boxes: "Penalty loop 1".
6. Menu → **Line 1**: you are the gunner, halted in box 1. Traverse to 6 o'clock: the three boards (400 m before any race) read as white squares with black discs. Fire at one: a hit says "Hit: the line 1 … board". Repeat with **Line 2** (500 m, two blue blocks).
7. With the crewmate (`?bot=1` on a PC page, you as gunner), Calls → **Course**: it drives two laps, halting in each box, and takes the penalty loop once.
8. With the performance HUD on, drive past the course and the range: say whether the frame time stays as before.
