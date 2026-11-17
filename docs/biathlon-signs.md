# Biathlon: course signs and board flags

John's play test of 2026-11-15 asked for two things on the biathlon course:

- **Signs** that say what each obstacle wants before the driver gets there: the ford's top speed, a caution for the mud, which way the penalty loop goes, and which way to steer through the slalom.
- **Board flags**: both firing lines' boards stand at about 6 o'clock from the boxes, so it was hard to tell which board to aim at and which had been hit. A flag over the board to shoot next, turning to show a hit or a miss.

The course itself is in [biathlon-course.md](biathlon-course.md), its obstacles in [biathlon-driving.md](biathlon-driving.md) and the race's rules in [biathlon-race.md](biathlon-race.md).

## The signs

All of them stand beside the track on posts, outside its edge, facing a driver coming along it. They are drawn like the rest of the course: low-poly, vertex-coloured, merged into the ground's chunks, so they cost no draw calls. Their words are in a road-sign typeface (Overpass ExtraBold, OFL, after the US highway signs' letters; `public/fonts`), drawn into one canvas and laid over the signs' faces as one textured mesh (`src/systems/sign-labels.ts`): one draw call for every sign. (The first version spelt them in blocky box letters; John, 2026-11-15: not realistic for a sign.)

| Where | Sign | Says |
| --- | --- | --- |
| 26 m before the slalom's first gate, right side | White board, black **SLALOM** over a weaving arrow (left first, then right, left, right) | The slalom starts here, and which way it weaves |
| The slalom's gates | Gates alternate red and blue, as a ski slalom's do: each post's bands and a flag at its top, flying away from the gap, in its gate's colour | Which two posts make the next gate, and that the gates swing side to side |
| 12 m before the bypass leaves for the mud, right side | Red caution triangle with **!**, a **MUD** plate under it | Mud ahead; the bypass is coming up on the left |
| 12 m before the ford's water, right side | Speed limit roundel, red ring with **8**, a **FORD** plate with blue waves | 8 km/h through the water (the drive model's limit, `FORD_SPEED`; the sign reads it from there) |
| In the mouth of the penalty loop, where it turns off the course, right side | Yellow board, **PENALTY LOOP** and an arrow up and to the right | Turn right here for a penalty loop |
| Round the outside of the penalty loop's two curves, four in all | Yellow chevron boards pointing right | The loop is driven clockwise |

The yellow is the penalty gate's flag colour. John's notes on the first version (2026-11-15) moved the penalty sign from 15 m short of the turn into its mouth, so it says where to go, and replaced blue arrow roundels before each slalom gate (confusing) with ski slalom's red and blue gates. Where each sign stands is in `src/sim/course-signs.ts` (engine-free), worked out from the course's own numbers, so a sign moves with the obstacle it belongs to. How each looks is `signLocalParts` in `src/scene-assets/course.scene-asset.ts`.

## The board flags

A flag stands over each board of the line the crew shoots at on this lap: a pole behind the board's middle, a crossbar at 4.9 m and a 2.0 × 1.3 m cloth hanging from it square over the board, its foot 0.7 m above the board's top. The cloth is narrower than the board, so it reads as that board's and nobody else's.

| Cloth | When |
| --- | --- |
| **Yellow** | The board to shoot next: this lap's line's first board still standing, left to right. From the start of the lap, so the gunner can lay on it on the way to the box. |
| **Green** | A board brought down, once its round lands (its white cover swings over its disc as before). |
| **Red** for 2.5 s | Over the yellow board when a round misses: through the white, wide, fired on the move, at a board already down or at the other line. Then yellow again. |
| **Red** | Every board left standing once the line is shot: each is a penalty loop owed. |

Only this lap's line has flags; line 2's boards have none on lap 1, and on the last lap there are none. A hit on another standing board than the flagged one counts as before, and that board turns green.

The practice crewmate now aims at the flagged board too (before, the nearest standing one), so it shoots the line left to right as a crew is shown.

## Line practice

John, 2026-11-17: the flags worked on a full race, but not when going straight to a firing line from the Practice menu. Now **Practice → Biathlon → Line 1** or **Line 2** (and **Biathlon race → Ready line 1** or **2** with no race on) start line practice there: the run's third mode (`'line'`, beside `'range'` and `'biathlon'`).

- The line's boards fall and their flags show exactly as in a race: yellow, green, red for a moment on a miss. A hit counts as in a race too: halted in the box, at a board of that line still standing.
- No countdown, no clock to beat and no rack limit. Rounds count in goes of three: once a go's third round lands the boards left standing show red, and 4 s later (`LINE_RESET`) all three stand again with the first yellow.
- It ends when the tank leaves the box (or hasn't got there 8 s after it started), and starting a range run or a race replaces it. During a race Line 1 and 2 still only move the tank, so the race's own flags stay.
- It is no run for the play-test stats (no CSV row), and the crewmate gunner shoots the yellow board as in a race. The clocks say "Line 1 practice", the time since it started, and the go's rounds and boards down.
- `laps` holds the line, so `lineFor`, `aimBoard` and `boardFlag` read it as they read a race's lap; it travels in the same `run` event (the guest asks with `run-ask` carrying `line`).

## How it works

- **Engine-free rules** in `src/sim/biathlon.ts`: `aimBoard(s)` and `boardFlag(s, j)` read the race's snapshot. A miss needs to be known on both pages, so the race keeps `misses` and `missAt` (the run's clock when the last miss landed) in `RunSnapshot` (`src/sim/range-run.ts`). The host now follows every round fired while the lap's line is open until it lands: a hit as before, anything else as a miss, counted when its shell lands, or `MISS_LANDS` (1.2 s) after the shot, whichever is sooner, since a shell over the boards flies on far past them. The line still closes when its last round has landed.
- **Shared** in the `run` event (two new fields). A page on the previous build reads no misses, so it shows no red flash, but the yellow and green flags and the line's result still come from the fields it has. No packet, no HoldKind.
- **Drawn** by `RangeRunSystem`, one mesh a board (six, at most three showing), standing where the board is drawn and recoloured only when its state changes (the cloth's vertex colours, nothing allocated).
- **Cost.** The signs are about 1,100 triangles a tile, 10,000 across the ground's nine copies (the ground was about 102,000), merged into its chunks, so no new draw calls; their words are one more draw call. A flag is 48 triangles and one draw call while it shows (three at most).

## Tests

- `test/course-signs.test.ts`: every sign is off the gravel, the mud, the water and the ditch, at least 2 m outside the nearest track's edge, clear of every gate, slalom post and the bridge, and faces the driver coming along its track; the penalty sign stands in the loop's mouth; every label has its own place in the canvas. The ford's figure is the drive model's limit.
- `test/biathlon.test.ts`: the flags through a race (yellow on line 1 from the start, a miss red for 2.5 s then yellow, a long miss landing within 1.2 s, a hit on another board green, the line shot with the standing board red, line 2's flags on lap 2, a hit within a miss's flash moving the yellow on, a second round at a board down counting as a miss, none on the last lap), and the misses in the `run` event, with a page from before them.
- `test/z-fighting.test.ts`: each sign on its own and all of them on the course with their words' quads; a red and a blue slalom post; the board flag on its own and over each board.
- `test/biathlon.test.ts` also runs line practice: line 2's flags from the start with no countdown, a miss red then a hit green, the go shot with the board left standing red and nothing owed, a round then not counting, the boards standing again after `LINE_RESET`, the mode in the `run` event, the practice ending when the tank leaves the box or never gets there, and no stats row for it.
- XR step 6q: Practice → Biathlon → Line 1 flags line 1's left board yellow, then green with the middle one yellow after the hit.
- XR step 6r: a yellow flag over line 1's first board before the first round, green over all three once the line is shot clean, none on line 2.
- Net race check: the guest sees the board down with its flag green and the next one yellow.

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated.

1. In the driver's seat: **Practice → Obstacles → Slalom**. Before the first gate, say whether you can read the SLALOM board and its weaving arrow from the slit or the periscope, and whether the red and blue gates make it clear which two posts to drive between next.
2. **Obstacles → Mud**: say whether the caution triangle and MUD plate are clear in time to choose the bypass on the left.
3. **Obstacles → Ford**: say whether the 8 roundel and FORD plate read in time to slow down.
4. Drive up the east side past the firing boxes: say whether PENALTY LOOP, in the mouth of the turn, makes it clear where to go, and whether the chevrons round the loop make its way round obvious.
5. As gunner, **Biathlon race → Start** (with the crewmate driving, or Ready line 1 alone): traverse to 6 o'clock. A yellow flag stands over line 1's left board. Say whether it is plainly the board to aim at, through the sight and with the naked eye.
6. Fire: say whether the flag turning green on a hit, and red for a moment on a miss, is clear in the sight, and whether it moves on to the next board in time to lay on it.
7. When the line is shot, say whether the red flags over the boards left standing read as the penalty loops owed.
8. With no race on, **Practice → Biathlon → Line 1**, then **Line 2**: a yellow flag over the line's left board. Fire three rounds: the flags turn green or red as in a race, and about 4 s after the third the boards stand again with the left one yellow.
9. With the performance HUD on round the course, say whether the frame time stays as before.
