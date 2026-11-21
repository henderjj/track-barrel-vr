# Mission report points (F2.12b)

Split from the map-reading course (F2.12, [nav-course.md](nav-course.md)) so that one stayed a single reviewable change. John asked for it on 2026-11-21: "Implement mission report points". The approved proposal was "missions get start lines and report points to pass in order".

A 1944 tank troop moving up to a fight did it by the map. It crossed a **start line** (SL) at a given time, then reported passing each **report point** (RP) on the way, so the squadron knew where it was without anyone seeing it. The commander found each one on the map and called it as the tank passed. This feature gives each mission a start line and report points on the commander's map, to pass in order. It also adds an approach march, so Hold the hill and Ambush a column can begin with that navigation instead of with the tank already in place.

Source files:
- [`src/sim/report-points.ts`](../src/sim/report-points.ts) has the routes, the run, the calls and the event.
- [`src/systems/report-points-system.ts`](../src/systems/report-points-system.ts) follows the missions, steps the run on the host and shares it.
- `showMapRoute` in [`src/systems/map-case-system.ts`](../src/systems/map-case-system.ts) draws the route.

## What players experience

- **On the map.** While a mission's route is on, the commander's map shows it in blue pencil.
  - The start line is a short bar across the range road, labelled SL.
  - Each report point is a circle labelled RP1, RP2 and so on.
  - Each gets a tick when the tank passes it.
  - Blue is the crew's own pencil, as for the map course. The red objectives stay as they were.
  - Nothing marks the points on the ground, and the map still never shows our tank.
- **Escort a convoy.** Start draws the convoy's route: the SL 30 m up the road, RP1 at the 200 m marker and RP2 at the 400 m marker.
  - The board's third line, which was "Lead them in", shows the next report ("Report: RP1 at 040043") until both are passed.
  - Ambush starts the tank 210 m up the road. The SL counts as crossed, and RP1 is called as soon as it starts.
- **Hold the hill and Ambush a column: March.** The Missions tab has a new **March** button next to each mission's Start.
  - March puts the tank at SP, mended, engine warm and facing north, with the mission's rack. A sign gives the briefing: "Approach march: Hold the hill. Cross the SL, report RP1, RP2, take up position at RP3 (059063)".
  - The board shows "Approach march: Hold the hill", what to cross or pass next and after that, and the tally ("Reports: SL, 1 of 3 RPs"). Its clock runs from SP.
  - The crew drives up the road, over the SL and past each RP in turn. The commander works out where each one is from the map and the compass.
  - The last RP is the mission's own starting position. Reaching it, within 15 m, begins the mission where the tank stands: the enemy comes in, and the mission's briefing goes on the sign. The tank isn't moved or reset.
  - Start still puts the tank straight in position for a quick fight, as before.
- **The calls.** Each report goes on the board's calls as the commander would give it: "Crossed the start line, 0:12", "Passing RP1, 1:05", "RP3: in position, 2:40". When the mission ends, the tally goes on the board too.
- **In order.** An RP counts only after the SL, and only the next one. The SL counts only going north, from SP's side. Driving past RP2 before RP1 doesn't count, so the crew has to go back for RP1.
- **One thing at a time.** Starting another fight, a range run or the map course during a march ends the march. Stop on the mission's row stops the march too. When a mission stops, its route is rubbed off the map.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Start line | 40 m across the range road at z −30 (grid 040023) | Just north of SP, so every march begins by crossing it |
| A report point counts within | 20 m of its middle | The map course's arrival distance: a crew finding it by map can be that far out |
| The position counts within | 15 m | The tank has to be where the mission expects it, on the hill's reverse slope or behind the ambush wall |
| Escort | RP1 at the 200 m marker, RP2 at the 400 m marker | On the convoy's road, short of the 600 m destination |
| Hold the hill | RP1 (0, −250) on the road, RP2 (110, −360) in the field, RP3 the hill's start (192, −432) | Leaves the road where the hill's reverse slope is open going |
| Ambush a column | RP1 (0, −300), RP2 (−90, −470), RP3 the ambush's start (−160, −560) | Comes up to the wall from the south, away from the column's road |

Every point is on open ground, with a way to it from the previous one (unit-tested with the crewmate's path planner, `src/sim/nav-path.ts`).

## Sharing

- The host keeps the route. It starts the convoy's when Escort a convoy begins, or a march when March is pressed (a guest's March goes to the host as `report-ask`).
- It sends the whole run as the reliable event `report` on every change, and again every 5 s while one is shown. The guest posts the same calls when the run it gets has moved on.
- Reaching the position begins the mission on the host, through the mission's own start, with an "in place" flag that skips moving and mending the tank. The mission then shares itself as before (`hill`, `ambush`).
- No new packet and no new HoldKind.

## Alone, and the practice crewmate

- Alone, the player drives the march and swaps to the gunner's seat to read the map, as on the map course.
- With the practice crewmate driving, the commander can send it to each point by touching the map (F2.13).
- With the crewmate as commander, it doesn't yet give headings for report points. It only does that on the map course. Left for a later pass, since a march is a human commander's job.

## Test hooks

- `window.__report`:
  - `state()`: the run and the last sign.
  - `march(mission)`, `stop()`.
  - `at(k)`: RP k's place.
  - `sl()`: the start line's ends.
- `window.__mapCase.state().route` gives the route as painted.
- XR step 6zj (part 3): March to the hill from the menu.
  - The tank is at SP, with the briefing, the board and the route on the map.
  - The SL is crossed going north. RP2 before RP1 doesn't count. Then RP1 and RP2 are called and ticked.
  - RP3 begins the hill where the tank stands.
  - Stop rubs the route out.
- Net check (in the firing chain after the map course, or `ONLY_REPORT=1`, `=lag` at 150 ms RTT):
  - The guest's March starts the host's march.
  - The host's tank over the SL and on RP1 and RP2 reports them on the guest's board and map.
  - RP3 begins the ambush on both pages.
  - The guest's Stop clears the route on both.
- Unit tests (`test/report-points.test.ts`):
  - every point on clear ground with a way to it
  - the SL crossed going north only
  - the order
  - the position on a march
  - the convoy's route
  - catching up when the tank starts past the line
  - the board's lines and the briefing
  - the event round trip

## Departures from the building skill

- No new Practice shortcut beyond March itself. March is the shortcut, and Start still skips the march.
- The convoy's destination is labelled "Convoy RP" in red on the map. That RP means release point, as the F5.8 objective was named, not a report point. Ours are in blue and numbered.

## Headset check

1. Missions → Hold the hill → **March**. The tank should be at SP with the briefing sign, and the board should say "Approach march: Hold the hill", "Next: cross the SL".
2. Take the map case (Practice isn't needed: it hangs behind the gunner's seat). Can you see the blue SL bar across the road just north of SP, and RP1 to RP3 circled, with RP3 by the red HOLD line?
3. Drive north over the SL. "Crossed the start line" should come up in the board's calls, and the SL should get a tick on the map.
4. Find RP1 by the map and the compass and drive there. "Passing RP1" should come up, and its circle should get a tick. Try RP2 first on another march: it shouldn't count.
5. Drive on to RP3. When you're within about 15 m, the hill's briefing should come up and the enemy should start coming. Was it clear when you had arrived?
6. Missions → Escort a convoy → Start. The board's third line should say "Report: cross the SL", and later the next RP up the road.
7. Do the blue route marks read clearly beside the red objectives, and is "SL" easy to find?
