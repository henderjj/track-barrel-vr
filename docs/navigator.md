# The commander navigating, and the crewmate navigator (F2.13)

The last of the commander's tasks for the gunner (John, 2026-11-21): "with the crewmate driving, touching a spot on the map sends it there; with the crewmate as gunner, it posts headings on the driver's board" (the proposal John approved). A commander of the war rarely drove by "left a bit": he found the spot on the map, worked out its bearing and distance, and gave the driver a course to steer. This feature lets the commander point at the map to give that order, and teaches the practice crewmate both halves.

Source files:
- [`src/sim/navigator.ts`](../src/sim/navigator.ts) has the words (bearing, distance, turn).
- [`src/sim/nav-path.ts`](../src/sim/nav-path.ts) has the crewmate driver's way across country.
- [`src/sim/map-case.ts`](../src/sim/map-case.ts) has `sheetToWorld`, which turns a point on the map's window into the ground.
- [`src/systems/navigator-system.ts`](../src/systems/navigator-system.ts) gives and hears the orders.
- [`src/systems/map-case-system.ts`](../src/systems/map-case-system.ts) takes the touch and pencils the spot.
- `BotDriver.goTo` in [`src/sim/crew-bot.ts`](../src/sim/crew-bot.ts) drives there.

## What players experience

- **Touching the map.** Holding the map case in one hand, point the other controller at the map. A small blue pencil point shows where its ray meets the map. Pull that hand's trigger to touch the map there.
- **On a PC page**, hold the map up with G and click on it.
- **The order.** A touch is an order to the driver, such as "Driver, go to 046036: 045°, 320 m, right 30°". It gives the spot's six-figure reference, its bearing off north, its distance, and the turn from the way the tank faces now.
  - The commander's own board logs it.
  - The driver's page shows it on a sign and logs it on the board.
  - Both maps pencil the spot in blue: a cross in a dashed ring with "Go". A new touch replaces it.
  - Alone, the sign says "No driver aboard" with the same words, so you can work out a course and then swap seats to drive it.
- **The practice crewmate driving** takes the order. It finds a way to the spot round houses, walls and rocks, the ditch, the stream and the mud. It drives there at 18 km/h, slowing as it nears, and halts on the spot (within 3 m) and stays. Its status line in the menu's Calls says "driving to 046036", then "halted at 046036". Any driving call (Halt, Advance, Route, ...) takes it off.
- **The practice crewmate as gunner** is the commander on the map course (F2.12, [nav-course.md](nav-course.md)). At the start, at each checkpoint and every 12 s, it gives the driver the next checkpoint's heading, such as "CP2: steer 045°, 320 m, left 30°". The heading shows on the driver's sign and on both boards.
- **A human driver** gets the same orders and headings from a human commander. The bearing is for the course ring on the driver's compass (F2.9).

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Pencil point | a 4 mm blue ball, 6 mm in front of the map | Big enough to see at reading distance; no flat faces to flicker |
| Trigger | over 0.6, on the press | A deliberate pull; a resting finger doesn't touch |
| Bearing | whole degrees clockwise from north, three figures | What the driver's course ring reads |
| Distance | to 10 m, to 50 m past 1 km | A six-figure reference's precision |
| Turn | "dead ahead" within 10°, then to 5°, "behind you" past 170° | A driver can't steer finer than that by eye |
| Crewmate's grid | 8 m squares over one 800 m tile, wrapping; blocked within 6 m of a house, wall or rock, below −0.4 m (the ditch, the stream's bed), in water, or within 4 m of the mud | The hull's half width and a margin; it never needs the bridge or the ford |
| Crewmate's speed | 18 km/h, slowing from 50 m out; arrives within 3 m | A steady cross-country pace the comfort caps stop smoothly |
| Headings | at the start, at each checkpoint, every 12 s | Often enough to correct a drift, not so often it nags |

## Sharing

- **`nav-goto`** is a reliable event either way: `{x, z}`, the spot touched, on the map's copy of the ground. The receiving page pencils it, shows and logs the order, and if it is the practice crewmate driving, plans the way and drives it. The way is planned from where the map has the tank (the copy of the ground the map shows), then shifted back onto the tank's own copy.
- **`nav-heading`** is a reliable event, sent by the crewmate commander to the driver: `{text}`, shown and logged.
- The map case in a player's hand was already in their pose packets (`HoldKind.MapCase`, F2.10). Its net check, deferred from F2.10, is here.
- No new packet and no new HoldKind.

## Test hooks

- `window.__mapCase` gains:
  - `touch(x, z)`: a touch at a world point.
  - `rayAt(origin, direction)`: the world point a scene-space ray meets on the map.
  - `face()`: the map's middle and the way it faces.
  - `holdFor(side | null)`: holds the case in this page's hand without a controller.
- `window.__navigator.state()` gives the goal, the last order, the headings heard or given, and the sign.
- `window.__bot.driving` gains `goto` (the spot's name) and `there`.
- XR step 6zi (part 1) checks the pencil point with the left ray on the held map, and the left trigger's touch: the order, its sign and board line, and the goal near the ray's point.
- The net test checks:
  - In both pairs, the case in the guest's hand drawn in its hand on the host's page, and the guest's touch as an order on both pages.
  - With the practice crewmate driving, a touch 120 m up the road brings it there and it halts on the spot.
  - With it gunning, its CP1 heading reaches the player's sign and board.
- Unit tests (`test/navigator.test.ts`) cover:
  - the bearings, turns and words
  - a touch on the window mapped to the ground, and nothing in the margins
  - the way going round the ditch on clear legs
  - a way from SP to every map-course place
  - the real tank simulation driven to five of them past houses and walls, halting and staying

## Departures from the building skill

- The practice crewmate gunner doesn't hold the map case while it reads it. Its left hand stays on the elevation wheel, and taking the case would fight the kit's hold on the wheel. The case in a crewmate's hand is still checked, with a player's hand, in the net test.
- No new Practice button. Practice → Commander → Read the map's sign now says how to touch the map. The crewmate's part needs a second page, as with F1.13.

## Headset check

1. Practice → Commander → Read the map. Take the case in your right hand and hold it up to read.
2. Point the left controller at the map. A small blue dot should show where its ray meets the map. Does it sit where you point, and is it easy to see?
3. Pull the left trigger on the bridge. The sign should say "No driver aboard: Driver, go to …", with a bearing, distance and turn that match what you see from the gunner's seat. A blue cross with "Go" should be pencilled on the map.
4. With the practice crewmate on a PC page (`?bot=1`) in the driver's seat, touch a spot across the field. The crewmate should drive there round any houses and stop on it. Does the way look like a driver's, and is it comfortable to ride?
5. Take the driver's seat with the crewmate as gunner, then Practice → Map course → Start. Its headings for each checkpoint should come up on your sign and the board. Can you steer by them and the compass's course ring?
6. Do the blue order marks read clearly beside the red objectives and the blue checkpoint rings?
