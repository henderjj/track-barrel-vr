# Crew board (F6.5)

From John's note (2026-11-14): the signs that float in front of the players' eyes (an enemy firing, a hit, a thrown track) can hide the view and take you out of the game. He wanted the orders and the tank's state on a board or notebook in the tank, and the news spoken by a tank commander over the intercom. This is the board; the commander's voice comes next ([below](#next-the-commanders-voice)), once John has heard and approved the generated lines. He approved the board's design from a mock-up on 2026-11-14.

The numbers and words live in [`src/sim/crew-board.ts`](../src/sim/crew-board.ts), the model in [`src/scene-assets/crew-board.scene-asset.ts`](../src/scene-assets/crew-board.scene-asset.ts), and [`src/systems/crew-board-system.ts`](../src/systems/crew-board-system.ts) hangs the boards and draws their paper.

## What players experience

- **A clipboard in each seat.** An olive-drab board with a cream sheet under a steel clip, written in typed labels and blue pencil, red for bad news:
  - **ORDERS** and the clock (the fight's or the drill's time; none when nothing is timed).
  - **OBJECTIVE**: in the fight, the 500 m board and how far there is still to go (to 10 m); after it, the debrief; in a range run, a race or the driving course, that drill; otherwise "None: free driving".
  - **TASKS**: in the fight, *Advance to contact* (crossed off once the enemy has seen the tank), *Guns: 1 of 3 out*, *Tanks: not seen yet* then *0 of 2 out*, each crossed off when done; in a drill, its targets, shots, laps and gates.
  - **ROUND IN GUN**: AP, HE, Smoke or Empty, and what the rack still holds.
  - **OUR TANK**: the tank from above, front up, with its tracks, turret and gun, the engine bay behind a dashed line, and where the driver and gunner sit. A broken track, the engine, the transmission and a power traverse knocked out are hatched red; a wounded crewman's seat gets a red cross.
  - **DAMAGE** in words (*Engine hit: weak, runs hot*, *Left track broken*, *Power traverse out: crank*, *KNOCKED OUT*), **CREW** (*Both fit*, *Gunner wounded*) and **HITS** (*4 (2 through)*).
  - **LAST CALLS**: the three newest notes, newest first, each with its time: everything the signs used to say. The newest is bigger, red if it is bad news. For the gunner an enemy's call carries which way to traverse, kept up to date as the tank and turret turn (F3.10's live bearing).
- **The signs that carried news no longer float in view**: combat's briefing and debrief, the enemy's (guns ahead, firing, a hit, knocked out), the damage's (each hit, knocked out, repaired), the crewmate's calls, the driver's warnings (tracks straining or thrown, digging in, bogged, engine hot, overheating, stalled, gears grinding, labouring, won't start), the turret's (no power traverse, the driver's head in the way), the range run's Go! and finish, and the race's and course's notes. They all go on the board.
- **Signs that help a player set up still float**: calibration, the seat swap, the crewmate stepping away or reconnecting, how a station's controls work as you sit down (Laying the gun, Start the engine, Driving, Parking brake on), the Practice shortcuts' explanations and the ride's 10-minute check-in. They are about the game, not the fight, and come at a moment the player is looking for them.
- **Game menu → Sound and view → Pop-ups → On** floats the news signs again as well, as before the board; **Off** (the default) puts them on the board only. Each player's own setting, kept for next time (`?popups=1` at load).

## Where the boards hang

| Board | Where | Why |
| --- | --- | --- |
| Driver's | 36 × 27 cm, standing at their front right over the final drive's housing, in front of the empty assistant driver's seat, below and right of the turret dial; turned and leaned back to face the eyes, 75 cm away | A glance down and right from the slit, as the turret dial is a glance right. The front left has the callout card, the run clock and the slit; the front right was empty. Clear of the right tiller's travel, the periscope and the slit's view (it sits at the edge of the view through the slit) |
| Gunner's | 44 × 33 cm, flat on the turret's front wall right of the gunsight, under the firing lamp's repeater, 92 cm away | A glance right from the sight, turning with the turret. The right wall is the ready rack and the loading board, the left of the sight has the callout card. Bigger than the driver's so its writing looks as big from further off |

Both are 4:3, as the canvas (1024 × 768). The writing on them looks at least as big as the callout card's ([callout-card.md](callout-card.md)), and both face their seat's eyes within 40°.

## Drawing

- One canvas for both boards on a page, drawn for that page's seat (the gunner's calls carry the traverse). Unlit, as the callout card is, so it reads in the dark cabin; cream paper rather than a white one so it doesn't glow.
- Four times a second the system compares a handful of numbers (the log's version, the damage's, the scenario's, the enemy's, the round and the rack, the distance to go to 10 m, the clock's second, the run's shots and hits, the course's gates) and builds and draws the board only when one has changed: about once a second in a fight (the clock), not at all when nothing happens. Nothing is allocated on the frames in between.
- Three fonts ship with the game in `public/fonts`, cut down to Latin letters (85 kB together): Stardos Stencil for ORDERS, Special Elite (a typewriter) for the labels and the clock, Kalam (handwriting) for what the crew wrote. All three are free to ship (SIL Open Font Licence; Special Elite under Apache 2.0); their licences are beside them. Until they load the board is drawn in the browser's own fonts.
- Two draw calls a board (the board and the paper), four in all.

## Sharing

Nothing new goes over the network. Each page builds its board from the state it already shows (the host's `damage`, `combat`, `run` and `course` events, the enemy's shared state, the gunner's loading packets) and logs the notes its own systems raise from those, as they raised the signs. Both crew see the same orders, damage and calls; only the gunner's traverse detail is the gunner's own.

## The practice crewmate

Nothing to learn: the board is read, not worked.

## Test hooks

`window.__crewBoard`: `text()` (what it says now), `key()` (a digest of what was last drawn), `draws`, `fonts`, `calls()`, `post(text, tone)` to log a call as a system would, and `face(seat)` (where the paper is and which way it faces). XR step 6z checks both boards face their seats, that a hit goes on the board with its sign kept out of view, and that Pop-ups → On floats it again.

## Departures from the building skill

- No Practice shortcut: the board hangs in the seat, and Combat → Damage's test hits (or Battle's scenario) put news on it.
- No net test: nothing new is shared.

## Next: the commander's voice

John chose a British voice, urgent, through the heavy intercom filter (2026-11-14). The plan:

- The lines are generated once (Kokoro's British voice, made urgent by Chatterbox; both free to ship) and stored dry; the intercom filter is applied in the game's Web Audio graph (band-pass, a nasal lift, soft clipping, hiss and crackle while keyed, the switch's click and hash), so its strength can be a setting and it matches across stitched parts.
- A fire order is stitched from parts said as one call: *Gunner, traverse left! Anti-tank gun! Ten o'clock! Three hundred!*, the direction worked out when it is spoken (F3.10's `enemyBearing`).
- The same notes that go on the board trigger the lines, so voice and board never disagree; both pages play them, ducking the tank under the voice.
- Nothing goes in until John has listened to every line.

## Headset check

1. Sit in the driver's seat. Glance down and right, past the turret dial: the board should be easy to read without leaning, with *None: free driving* as the objective and *None yet* under LAST CALLS.
2. Game menu → Combat → Damage → Hit engine. Nothing should float in front of you; the board should hatch the engine red, say *Engine hit: weak, runs hot* under DAMAGE, and show the hit as the newest call, in red.
3. Damage → Track: the left or right track hatched, *… track broken*. Repair: all clear, *Repaired* as the newest call.
4. Battle → Start: the board shows the 500 m board and the distance going down as you drive, the clock running, and the tasks. When a gun fires, its call goes on the board; in the gunner's seat it says which way to traverse and keeps up as you turn.
5. Swap to the gunner's seat: the board is on the front wall right of the gunsight, under the firing lamp's repeater. It should read from the seat without leaning out of the sight much, and not crowd the loading board.
6. Game menu → Sound and view → Pop-ups → On: the next hit's sign floats in front of you as it used to. Off again.
7. Say whether the handwriting is easy to read at a glance in both seats, and whether either board is in the way of anything.
