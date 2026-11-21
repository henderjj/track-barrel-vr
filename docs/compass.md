# Compasses (F2.9)

John's ask (2026-11-21): a tank commander's tasks for the gunner while the tank drives, a stylised map of the layout and objectives, and a compass at both crew positions. The compasses come first: they let the gunner, reading the map, give the driver a heading ("Driver, steer 060"), and the driver hold it.

This is how real crews did it. The commander navigated by the map and told the driver which way to go. German tanks carried a gyro compass on the driver's dashboard: a small box whose panel showed "two cards rotating in a horizontal plane", one above the other. The commander read the course off the map (the "march number", from a celluloid clock-ray disc laid on the tank's place on the map), the driver set it on the upper card, the course-setting dial, and steered until the figures on the lower card, turned by the gyro, came opposite them ([Tactical and Technical Trends No. 7, 1942](https://lonesentry.com/articles/ttt08/gyroscopic-compass.html)). A compass card has to lie flat (a magnetic one floats level; the gyro's turn about an upright axis), so it is read edge-on through a window, its figures sliding past a fixed line, as an aircraft's compass and directional gyro of the war were. The first build had round cards turning upright on the walls; John pointed out a compass couldn't work that way, and they were rebuilt as this. British tanks tried several tank compasses, from periscopic ones to gyros, because a magnetic needle inside a steel hull reads wrong ([Royal Museums Greenwich](https://rmg.co.uk/collections/objects/rmgc-object-7760)). Ours read true: the deviation and the gyro's drift (the 1942 report's red warning light) would only be a nuisance.

The numbers live in [`src/sim/compass.ts`](../src/sim/compass.ts), the models in [`src/scene-assets/compass.scene-asset.ts`](../src/scene-assets/compass.scene-asset.ts), and [`src/systems/compass-system.ts`](../src/systems/compass-system.ts) hangs, paints and turns them.

## What players experience

- **The driver's compass**, a small dark box on the hood's face right of the turret dial and the firing lamp, turned to face the seat: a glance right from the slit. Its window shows the edges of two cards, one over the other, with a red lubber line down the middle. The lower, cream card is the gyro card: the figure on the line is the way the hull faces, 000 north, 090 east, as on a map. It is marked every 5°, every 10° in tens (6 for 060, as compass cards are), bigger every 30°, and N, E, S and W, N in red. The cards read directly: the figures grow to the right, so the course wanted is on the side to turn towards (a gyro's gearing can mark them either way; a floating magnetic card shows them the other way round).
- **The course card and its crank.** The upper, buff card is the course card. A small crank right of the box turns it: turn it clockwise and its figures slide so the course grows, 90° a turn, with a tick in the hand every 5°. Told "steer 060", the driver winds 6 onto the line on the upper card and then steers until the lower card's figures sit under the upper's, all along the window. The two cards' ticks meet across the gap between them, so the line-up is easy to see. The course card is the driver's own reminder: nobody else sees it moved.
- **The gunner's compass**, a wider box with one gyro card on the turret's front wall over the crew board, a glance up and right from the sight. It turns with the turret, so the figure on its line is the way the gun points: the bearing to call when reporting what is seen, and the way to lay the gun from the map. The way the hull points is the hull mark in the gunsight and the gunner's periscope (F2.4).
- **Practice → Drive the tank → Steer a course** seats a lone player as driver and gives an order on the crew board, "Commander: driver, steer 120 (ESE)", at least 60° round from the way the tank faces, with a sign saying how. Held within 5° of it for 3 s on the move, "On course 120" goes on the board. Press it again for another.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Driver's box | 9.8 × 6.8 cm, its window 7.5 × 4.8 cm, 63 cm from the eyes, 66° right, turned 35° to face them | The window reads from the seat without its frame hiding the cards' ends; its near (left) side stays clear of a head leaning in (EYE_CLEARANCE), and its far side stands 8 cm out |
| Driver's cards | 7.5 cm radius, each edge 2 cm tall (1.9° to the eye), 4 mm apart, 30° either side of the line showing | Figures about as tall to the eye as the turret dial's; three figures in view at a time |
| Course crank | 3 cm crank, knob 3.5 cm long, right of the box, its circle 1.5 cm clear of it | In a seated arm's reach (72 cm from the eyes); clear of the periscope's crank |
| Course card | 90° a crank turn, a tick every 5° | A quarter turn for a typical 20° to 30° correction, a turn for a right angle |
| Gunner's box | 15 × 5.8 cm, its window 12 × 3.8 cm, on the front wall over the board, 92 cm away, square to the wall | As big to the eye as the driver's (each edge 3.4 cm, 2.1° tall); between the board's clip and the roof's rounded edge |
| Depths | the lubber line 3.5 mm in front of the cards, the frame 4.5 mm; the back plate 3 mm behind the cards' ends, 3 mm or more in front of the wall | 3 mm or more between faces that overlap (test/z-fighting.test.ts) |
| Drill | an order 60° to 300° round, in tens; on course within 5° for 3 s, faster than 0.5 m/s | A real turn to make; long enough to show the tank steadied |

## Sharing

Nothing new goes over the network. Each page turns its compasses from the tank and the turret as it already draws them (the host's tank state, the gunner's turret packets). The course crank is a control only this page has (`HoldKind.LocalControl`, never sent): the other player sees the driver's hand near it, not closed on it. Each card's edge is painted once as a strip, 0° to 360°, and turned by sliding the strip (the texture's offset), so turning costs nothing. The drill is the page's own; in a crew the gunner gives the orders.

## The practice crewmate

Nothing yet: a crewmate driver that steers to an ordered heading, and a crewmate gunner that gives them, come with the commander's tasks (F2.13, proposed).

## Test hooks

`window.__compass`: `state()` (each compass's bearing and reading, where each card is turned to (`gyroDeg`, `courseDeg`), the course, the crank and whether it is held, the drill and the sign), `setCourse(deg)`, `drill(course?)`, `knob(deg)` (where the crank's knob is), `at()` (each window's middle and which way it faces, for the camera). XR step 6ze (part 6) checks both read 000 facing north, the driver's gyro card on 090 facing east, the gunner's 000 with the gun at 9 o'clock, Practice → Steer a course's order and sign, a quarter turn of the crank by hand moving the course card 22.5°, and the drill finishing on course; it takes screenshots from both seats.

## Departures from the building skill

- No net test: nothing new is shared.
- No crewmate part yet (above).

## Headset check

1. Practice → Drive the tank → Steer a course. Glance right past the turret dial and the lamp: the compass box should read at a glance from the slit, without leaning, the figures on both cards sharp and the red line clear. Say what the order on the board is.
2. Reach for the small crank right of the box and wind the upper card round to the ordered course. Does it tick in your hand, go the way you expect (clockwise raises the course), and is it easy to stop on a figure?
3. Start the engine and drive, turning until the lower card's figures line up under the upper card's, and hold them there: "On course" should go on the board after 3 s. Do the figures slide smoothly, and is the line-up easy to keep while watching through the slit? Is the side to turn towards obvious?
4. Lean into the slit and look up into the periscope: the box and its crank should never be in the way, and the box's far side should never be in your face.
5. Swap to the gunner's seat: the compass is over the crew board, up and right from the sight. Does it read from the seat? Practice → Lay the gun → To 3 o'clock: its figures should slide a quarter turn round.
6. Note anything that flickers on either compass as you move your head.
