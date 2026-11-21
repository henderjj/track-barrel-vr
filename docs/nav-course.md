# The map-reading course (F2.12)

The fourth of the commander's tasks for the gunner (John, 2026-11-21): "a new timed map-reading course whose checkpoints only the map shows" (the proposal John approved). A tank commander of the war spent most of his time not fighting but finding the way: reading a grid reference off an order, finding it on the map, matching the map to the ground, and talking the driver there by the compass. This drill is that, against the clock.

The places, the pick, the run and its event live in [`src/sim/nav-course.ts`](../src/sim/nav-course.ts); [`src/systems/nav-course-system.ts`](../src/systems/nav-course-system.ts) runs it; the crew board ([`crew-board-system.ts`](../src/systems/crew-board-system.ts)) shows the references and [`map-case-system.ts`](../src/systems/map-case-system.ts) rings the checkpoints on the map ([map-case.md](map-case.md)).

## What players experience

- **Practice → Map course → Start** stops any fight, mends the tank and parks it warm at SP (the start point the map already marks, at the range road's foot) facing north, and picks five checkpoints. A sign says where they are. Alone, the player is put in the driver's seat, and told to swap to the gunner's to read the map.
- **Only the map shows them.** The orders board gives the next checkpoint and the one after as six-figure grid references ("Next: CP1 at 046036", "Then: CP2 at 059069") and how many are reached. The commander's map rings all five in blue pencil, numbered CP1 to CP5, so the red of the objectives and the enemy never confuses them. Nothing marks them on the ground.
- **The places** are ones a map shows and a crew can find on the ground: the bridge's south end, the spot heights on the course hill and the hold hill, beside houses, the cross roads in the north, the ambush wall, the 600 m marker, the biathlon's firing boxes. Twelve in all; five are picked afresh each run, ordered nearest first from SP so the course never doubles back on itself much.
- **Reaching one.** Drive the tank within 20 m of the next checkpoint: the board moves on, the crew calls log "CP1 reached, CP2 at 059069", and its circle on the map is ticked. A later checkpoint passed first doesn't count; they go in order.
- **The time** runs from Start to the last checkpoint, on the board's clock. At the last the board and a sign give the time and a medal: gold within the course's par, silver within 1.3 times it, bronze within 1.7.
- **Stop** clears the board and the map. A fight, a mission or a range run started meanwhile stops the course too: the board shows one thing at a time.
- **Both crew** see the same run: the driver drives, the commander (the gunner) holds the map, works out where the tank is from the ground and the compasses, and gives the driver headings and distances.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Checkpoints a run | 5 of 12 places | Three to five minutes' driving; enough that the order matters |
| Reached within | 20 m of the tank's middle | About three tank lengths: near enough to have found it, not so near that a crew circles hunting for a point |
| Places apart | over 40 m from each other, over 60 m from SP | Reaching one never reaches another |
| Places | on the map (30 m inside its edge), out of the water and the ditch, over 5 m clear of houses and walls | Each can be driven onto |
| Par time | the straight legs from SP × 1.2 ÷ 6 m/s (22 km/h) | A Sherman's cross-country pace, with a fifth more for the way round; 3 to 5 minutes for most courses |
| Medals | gold ≤ par, silver ≤ 1.3 × par, bronze ≤ 1.7 × par | As the range run's medals: gold needs a clean, confident run |
| References | six figures, to 10 m, from the map's 100 m grid | What a 1944 order would give |

## Sharing

The host keeps the run. It picks the course from a seed, steps it each frame with its tank (frozen while the crewmate is away), and sends the whole run (`nav`: on, the seed, the next checkpoint, the time, the splits, a version) on every change and again every 5 s while one is shown. A guest rebuilds the checkpoints from the seed, so the event stays small, and runs the clock on between events. A guest's Start or Stop asks the host (`nav-ask`). No packet and no HoldKind.

## The practice crewmate

Not yet: F2.13 makes the crewmate the navigator (driving to a spot touched on the map, or giving the driver headings on the board).

## Test hooks

`window.__nav`: `state()` (the run as this page has it, its references and the sign), `start(seed?)`, `stop()`, `at(k)` (checkpoint k's world x and z). `window.__mapCase.state().checkpoints` gives the circles as last painted. XR step 6zh (part 3) checks Start's seat, SP and sign, the board's CP1 and CP2, the five circles, CP1 reached with the board on to CP2, the call and the tick, and Stop clearing both. The net test (after the map marks, both pairs) checks a guest's Start giving both pages the same course, CP1 reached on both with the guest's map ticked, and the guest's Stop clearing both.

## Departures from the building skill

- No crewmate part yet (above).
- Mission report points (start lines and points to pass and report on the missions), proposed with this feature, are split off as F2.12b so this one stays one reviewable change.

## Headset check

1. Practice → Map course → Start. The sign should name CP1's reference; the orders board should give CP1 and CP2. Alone, you're the driver.
2. Swap to the gunner's seat (Practice → Sit in → Gunner), take the map case and find CP1's reference: the first three figures across along the bottom, the second three up the side. Is the blue CP1 circle where you worked it out to be?
3. Note its bearing from SP on the map, swap back to drive, and steer for it by the compass. Within 20 m the board should move on to CP2, the calls should say "CP1 reached" and the map's circle should be ticked.
4. Carry on to CP5: the board and a sign should give the time and a medal. Was it near the par, and did the medal feel fair?
5. With John's crewmate in the gunner's seat: does the commander have enough on the map and the compasses to talk the driver there without guessing?
6. Do the blue circles and their labels read clearly at reading distance, apart from the red objectives?
