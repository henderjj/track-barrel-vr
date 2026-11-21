# Map case (F2.10)

John's ask (2026-11-21): commander's tasks for the gunner while the tank drives, starting with "a stylised map showing the layout and objectives". He chose (2026-11-21) that the map must **not** show our own tank: the crew works out where they are from the ground, the compasses (F2.9, [compass.md](compass.md)) and what they see.

A commander of the war read a folded map in a map case: a stiff board with a clear window over the map, marked up with a grease pencil, kept within reach and held on the knee or up in the hatch. He "set" the map, turning it until its north lay to the ground's north, so a road on the map ran the way the road outside did, then read off grid references and bearings for the driver and for reports. Ours is that case, hung on the turret wall behind the gunner, where a Sherman's commander sat.

The numbers live in [`src/sim/field-map.ts`](../src/sim/field-map.ts) (what the map shows, the grid, the contours) and [`src/sim/map-case.ts`](../src/sim/map-case.ts) (the case's size, where it hangs, how it sits in the hand); the model in [`src/scene-assets/map-case.scene-asset.ts`](../src/scene-assets/map-case.scene-asset.ts); [`src/systems/map-case-system.ts`](../src/systems/map-case-system.ts) paints the map once and moves the case between its clips and the hand.

## What players experience

- **On the wall.** A leather-framed board hangs on two clips on the turret's right wall, just behind the gunner's right shoulder and a little under eye height, past the ready rack's shells, the map facing in. From the seat it is a glance right and back.
- **Taking it.** Reach back and squeeze anywhere on its face or near its edge: it comes into the hand in a moment, held by its edge (the right hand holds its right edge, the left hand its left), its face turned to the eyes wherever the hand goes. Rolling the wrist turns the map, so it can be set to the ground. Let go and it springs back to its clips.
- **The map.** A 1944-style sheet, north up, titled "TRAINING AREA, Sheet 1, 1:3,500". Brown contours every metre, a thicker index contour every 5 m, and spot heights on the hill and the hold hill's crest; the ford's water in blue; the range road and the cross roads in orange; the biathlon course's track, its penalty loop, the mud, the bridge and the firing boxes; houses and walls (boulders left off, as a field map leaves them); the range's marker posts and target boards with their ranges; names. A black 100 m grid with its numbers in the margin, a scale bar and a north arrow.
- **The objectives in red pencil.** SP (the start point, where Practice and the missions begin), the OBJ line of the combat scenario, the HOLD line along the hold hill's crest, the convoy's release point (Convoy RP), the Ambush wall, and a dashed arrow along the road where the enemy column is expected. Nothing else of the enemy: what the crew sees gets pencilled in by F2.11.
- **Not our tank.** Nothing on the map moves. Where the tank is, the crew works out.
- **Grid references** read eastings then northings: the start point is in square 0402, at 040020 to 10 m. Each figure pair is the line number in the margin, the square named by its south-west corner.
- **On a PC page**, G holds the map up in front of the eyes, G again puts it back.
- **Practice → Commander → Read the map** seats a lone player as gunner and puts up a sign saying where the case hangs and how to take it.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Ground shown | 1,020 m east–west by 960 m north–south, from the start point 360 m west to 660 m east and 860 m north to 100 m south | The range, its 500 m boards, the biathlon course, the ford, the hold hill, the ambush wall and the column's road, with a margin |
| Scale | 1:3,500 (29 cm of the 32 cm window over 1,020 m, inside the margins) | Every place the missions go on one sheet, with a 100 m square 2.8 cm across |
| Grid | 100 m squares, false origin 400 m west and 200 m north of the start point | Two-figure line numbers that never wrap on the sheet, and SP in an easy square (0402) |
| Contours | every 1 m, index every 5 m, from the ground sampled every 5 m | The ground's rises are a few metres; a 5 m interval would show almost nothing |
| Case | 32 cm square window, 1.5 cm frame (35 cm across), 1.2 cm thick | About an A3 sheet folded once, readable at 40 cm |
| Map painting | 2,048 px square, painted once at load | 6 px a metre on the sheet; about 6,400 contour segments, under a fifth of a second |
| Where it hangs | its middle 65 cm right of the gunner's eyes (on the wall), 5 cm under them and 50 cm behind; its near edge 74 cm from the eyes | Clear of the ready rack's shells (they end 30 cm behind the eyes) and the interphone box (77 cm behind); in a seated reach (test/body-height and test/map-case) |
| Clips | two shelves under its bottom edge and a spring clip over its top, 5 mm off the wall | It hangs, rather than floats |
| Taking it | a hand within 6 cm of its outline, or over its face; to the hand in 0.15 s, back to the clips in 0.35 s | A grab that doesn't need precision; a quick catch, an easy return |
| Held | its edge 1 cm out from the middle of the fist; face to the eyes; up it along the handle's line through the fist | Held as a board is held; the wrist's roll turns it |
| Depths | the map 4 mm in front of the board, the frame 4 mm in front of the map | Over 3 mm between faces that overlap (test/z-fighting.test.ts) |

## Sharing

Nothing new goes over the network. The map is the same on both pages (painted from the same numbers). While a hand holds the case, that hand's `HoldKind.MapCase` (15, the last free one) goes in the pose packets, as every held control's does; the other page sees it and draws the case in the crewmate's drawn hand, from their hand's pose and their head, and its own case comes off the wall while it does. Whoever's own hand holds it, their own view wins.

## The practice crewmate

Nothing yet: the crewmate navigator (F2.13) will read the map, hold the case and give the driver headings.

## Test hooks

`window.__mapCase`: `state()` (who holds it, whether it is on its clips, its middle and the way its face looks in turret space, how square its face is to the eyes, the sign), `at(out?)` (where it hangs, `out` m in front of its face, scene space), `holdUp(on)` (G), `gridRef(x, z, figures?)`, `image()` (the painted map as a PNG). XR step 6zf (part 4) checks Practice → Commander → Read the map's seat and sign, the right hand taking the case with a squeeze, the case turning its face to the eyes held up, and it springing back to its clips when let go; screenshots of it on the wall and in the hand.

## Departures from the building skill

- No net test yet: the only thing shared is the hold kind in the pose packets the net test already checks for other controls. A check that one page sees the case in the other's hand comes with F2.13, when the crewmate's scripted hands hold it.
- No crewmate part yet (above).

## Headset check

1. Practice → Commander → Read the map. The sign should say where the case hangs. Look right and back: is the case easy to see on the wall, past the shells, and are the clips holding it?
2. Reach back with the right hand and squeeze on the case. Does it come into your hand without hunting for a spot, and is the reach comfortable from the seat?
3. Hold it up in front of you, about where you'd read a book. Is the map sharp enough to read: the grid's numbers in the margin, the names, the red objectives, the contours on the hold hill? Say which (if any) you have to squint at.
4. Roll your wrist: the map should turn with it. Try setting it so the range road on the map runs the way the turret faces.
5. Find SP (the start point) and read its grid reference from the margin numbers. It should be 0402.
6. Let go: the case should spring back to its clips. Take it with the left hand too: it should be held by its left edge.
7. Note anything that flickers on the case or the map, and the frame time on the HUD with the map held up.
