# Compasses (F2.9)

John's ask (2026-11-21): a tank commander's tasks for the gunner while the tank drives, a stylised map of the layout and objectives, and a compass at both crew positions. The compasses come first: they let the gunner, reading the map, give the driver a heading ("Driver, steer 060"), and the driver hold it.

This is how real crews did it. The commander navigated by the map and told the driver which way to go. German tanks carried a gyro compass on the driver's dashboard with a course-setting dial: the commander read the course off the map (the "march number", from a clock-ray disc laid on the tank's place on the map), the driver set it on the dial and steered to keep the two dials together ([Tactical and Technical Trends No. 7, 1942](https://lonesentry.com/articles/ttt08/gyroscopic-compass.html)). British tanks tried several tank compasses, from periscopic ones to gyros, because a magnetic needle inside a steel hull reads wrong ([Royal Museums Greenwich](https://rmg.co.uk/collections/objects/rmgc-object-7760)). Ours read true: the deviation would only be a nuisance.

The numbers live in [`src/sim/compass.ts`](../src/sim/compass.ts), the models in [`src/scene-assets/compass.scene-asset.ts`](../src/scene-assets/compass.scene-asset.ts), and [`src/systems/compass-system.ts`](../src/systems/compass-system.ts) hangs, paints and turns them.

## What players experience

- **The driver's compass**, on the hood's face right of the firing lamp: the turret dial, the lamp and the compass are one glance to the right from the slit. A cream card turns behind a fixed red lubber mark at its top, so the bearing under the lubber is the way the hull faces: 000 north, 090 east, as on a map. The card is marked every 5°, every 30° in tens (3 for 030, as compass cards are), and N, E, S and W, N in red.
- **The course mark and its crank.** An orange notch rides the card's edge. A small crank right of the compass sets it: turn it clockwise and the mark goes clockwise, 90° a turn, with a tick in the hand every 5°. Told "steer 060", the driver winds the mark to 060 and then steers until it is under the lubber. The mark is the driver's own reminder: nobody else sees it moved.
- **The gunner's compass**, on the turret's front wall over the crew board, a glance up and right from the sight. It turns with the turret, so the bearing under its lubber is the way the gun points. A small dark hull in its middle turns under the lubber as the turret does, so it points to the hull's own bearing on the card: with the gun on 000 and the hull on 090, the gunner can still tell the driver which way to steer.
- **Practice → Drive the tank → Steer a course** seats a lone player as driver and gives an order on the crew board, "Commander: driver, steer 120 (ESE)", at least 60° round from the way the tank faces, with a sign saying how. Held within 5° of it for 3 s on the move, "On course 120" goes on the board. Press it again for another.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Driver's compass | 7 cm card (radius), its middle 4 cm under the eyes' height, 56 cm away, 57° right | As big to the eye as the turret dial; low enough that the periscope's crank, swung down, never hides its lubber |
| Driver's case | 0.7 cm proud of the hood, 1 cm sunk into it; card 4 mm in front, marks 4 and 8 mm in front of that | Its front no nearer a leaning head than the dial's; 3 mm or more between faces (test/z-fighting.test.ts) |
| Course crank | 3.5 cm crank, knob 3.5 cm long, right of the case, its circle 1 cm clear of the card | In a seated arm's reach (54 cm from the eyes); never passes over the card |
| Course mark | 90° a crank turn, a tick every 5° | A quarter turn for a typical 20° to 30° correction, a turn for a right angle |
| Gunner's compass | 7.2 cm card, on the front wall over the board, 98 cm away | As big as the wall allows under the roof's rounded edge and over the board's clip; its quarter letters about 1.2° tall |
| Drill | an order 60° to 300° round, in tens; on course within 5° for 3 s, faster than 0.5 m/s | A real turn to make; long enough to show the tank steadied |

## Sharing

Nothing new goes over the network. Each page turns its compasses from the tank and the turret as it already draws them (the host's tank state, the gunner's turret packets). The course crank is a control only this page has (`HoldKind.LocalControl`, never sent): the other player sees the driver's hand near it, not closed on it. The drill is the page's own; in a crew the gunner gives the orders.

## The practice crewmate

Nothing yet: a crewmate driver that steers to an ordered heading, and a crewmate gunner that gives them, come with the commander's tasks (F2.13, proposed).

## Test hooks

`window.__compass`: `state()` (each compass's bearing and reading, the card's and marks' turns, the course, the crank and whether it is held, the drill and the sign), `setCourse(deg)`, `drill(course?)`, `knob(deg)` (where the crank's knob is), `at()` (each face, for the camera). XR step 6ze (part 6) checks both read 000 facing north, the driver's 090 facing east, the gunner's 000 with the gun at 9 o'clock and its hull mark turned right, Practice → Steer a course's order and sign, a quarter turn of the crank by hand moving the mark 22.5°, and the drill finishing on course; it takes screenshots from both seats.

## Departures from the building skill

- No net test: nothing new is shared.
- No crewmate part yet (above).

## Headset check

1. Practice → Drive the tank → Steer a course. Glance right past the turret dial and the lamp: the compass should read at a glance from the slit, without leaning, with the red lubber at the top and the figures sharp. Say what the order on the board is.
2. Reach for the small crank right of the compass and wind the orange mark round to the ordered course. Does it tick in your hand, go the way you expect (clockwise raises the course), and is it easy to stop on a figure?
3. Start the engine and drive, turning until the orange mark is under the lubber, and hold it: "On course" should go on the board after 3 s. Does the card turn smoothly, and is the mark easy to keep under the lubber while watching through the slit?
4. Lean into the slit and look up into the periscope: the compass and its crank should never be in the way.
5. Swap to the gunner's seat: the compass is over the crew board, up and right from the sight. Does it read from the seat? Practice → Lay the gun → To 3 o'clock: the card should turn a quarter and the little hull point to the left.
6. Note anything that flickers on either card as you move your head.
