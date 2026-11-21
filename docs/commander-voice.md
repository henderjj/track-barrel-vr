# The commander's voice (F6.5)

The second half of John's note of 2026-11-14 (the first is the [crew board](crew-board.md)): the news of the fight given verbally, by a tank commander in the heat of battle, through an old intercom's sound. John chose a British voice and the heavy filter on 2026-11-14 and approved every generated line on 2026-11-15, after "brewing up" (a tank catching fire, British wartime slang) was changed to "knocked out".

The rules live in [`src/sim/commander-voice.ts`](../src/sim/commander-voice.ts); [`src/systems/commander-voice-system.ts`](../src/systems/commander-voice-system.ts) plays the lines through the intercom.

## What players hear

- **The commander calls the news the board logs**, over the intercom in both crew's headphones: a click as he presses the switch, hiss and crackle while he talks, his voice narrow, nasal and driven hard, and a burst of hash as he lets go.
- **What he calls**:

| When | He says |
| --- | --- |
| Battle starts | "Right, lads! Guns dug in on the left, tanks behind them. Use the walls and the smoke. Driver, advance!" |
| Guns or tanks come into the fight | "Enemy guns ahead! Watch for their flashes!" / "Enemy tanks! Watch for them moving!" |
| An enemy fires on us (its first shot, or a hit) | A fire order: "Gunner, traverse left! Anti-tank gun! Ten o'clock! Three hundred!" (or *traverse right*, *dead ahead*; *enemy tank*). The clock is off the hull's front and the range to the nearest hundred metres, both worked out as he speaks |
| We knock one out, or the last of them | "Target! Gun's knocked out!" / "Target! Tank's knocked out!"; "That's all the guns!" / "That's the tanks done!" |
| A hit on us | "We're hit! Engine's hit!" (the worst of it: engine, a track, the transmission, the power traverse, the driver, the gunner), "It bounced off us! Keep going!", "We're hit! No harm done!" |
| Knocked out, or the fight lost | "We're knocked out! Bail out! Bail out!" |
| Repaired | "Repairs done. We're fit to fight." |
| The fight won | "Objective reached! Well done, lads!" / "That's all of them! Well done, lads!" |
| The driver's warnings | A track thrown or back on, the tracks straining, digging in or bogged in mud, the engine hot, overheating or stalled |
| No power traverse | "No power traverse! Crank it by hand!" |
| A shell misses a biathlon board, as it lands | Where it passed the board, as the loading board says it: "Missed! Just high!", "Missed! Short! Left!" (*high*, *just low*, *low*, *short*, then *just left*, *left*, *just right* or *right*; [biathlon-race.md](biathlon-race.md#calling-a-miss)). Each miss is its own call, so two the same way are both called. Added 2026-11-21 |

- **One call at a time.** A call waits for the one before; one that has waited 6 s is old news and dropped, no more than 3 wait, and a call he has just made (within 8 s) isn't made again (a knock-out ends the fight too, and he says "Bail out!" once). A fire order on each enemy is its own call.
- **The tank ducks 12 dB under him**, as it does under the crew's own voices.
- Not everything the board logs is called: the range run's, the race's and the course's notes, the crewmate's calls, gears grinding, the engine labouring or not starting (the driver hears and feels those), and the gunner's view blocked by the driver's head.
- **Game menu → Sound and view → Commander**: a slider, 0 to 100% (full by default), under Master, each player's own, kept for next time (`?commander=0` at load; [volume.md](volume.md)). Off, the board still logs every note. It was On, Quiet or Off buttons until John asked for sliders (2026-11-15).

## The lines

70 clips in `public/audio/commander` (Opus, 32 kbit/s, about 370 kB in all): the 30 calls in the table and the parts of a fire order, said once each (the twelve clock hours, the ranges one hundred to one thousand, the targets and the traverses). They were generated once, offline: a British voice (Kokoro's *bm_george*, Apache 2.0) made urgent by Chatterbox (MIT), its delivery tightened (pauses inside a line cut to 0.14 s), checked with Whisper that every word comes through the filter, then heard and approved by John. They ship dry; the filter is in the game. The 13 miss calls (nine "Missed! ..." lines and the second parts *just left*, *left*, *just right*, *right*) were made the same way on 21 November 2026, peak-normalised to −1 dB like the rest, and approved by John the same evening after one remake ("Missed! High!" was drawn out).

To change or add a line: generate it the same way (the tools are in the project files under `audio/commander-voice/tools`), have John hear it, then add its clip and its words in `LINES`; the unit test checks every line has a clip.

## The intercom

A Sherman's interphone had a throat microphone and headphones in the crew's helmets. The filter, in the Web Audio graph so its parts match across a stitched fire order:

- a band of 450–2500 Hz (4th order each side), a +8 dB nasal hump at 1300 Hz,
- the amplifier driven into a soft clip (tanh, drive 7), then a low pass at 2875 Hz,
- while keyed: hiss 30 dB under the voice in 500–4000 Hz with a 7.3 Hz flutter, and about nine crackles a second,
- the switch: a 1700 Hz click, the hiss from 0.12 s before the first word to 0.18 s after the last, then a 0.16 s burst of hash and a softer click.

The same numbers as the review reels John heard (`INTERCOM`), within the rounding of the noise's level.

## Sharing

Nothing new goes over the network. Each page calls the notes its own systems log, from the state it already shows (the host's damage and scenario events, the enemy's shared state), as the board does; both crew hear the same calls at about the same moment. The practice crewmate's page says nothing.

## Performance

A call makes a handful of audio nodes as it starts (one source a part, the click and the hash), a few times a minute at most; nothing is made on the frames between. The hiss and crackle loop all the time at zero gain, in their own small context that suspends while Commander is Off or the page is hidden.

## The practice crewmate

Nothing to teach: the commander is heard, not worked.

## Test hooks

`window.__commander`: `said()` (the calls said lately, as lines), `asked()`, `speaking()`, `loaded()`, `context()`, `say(lines)` to ask for a call, `reset()` to forget recent calls, `outputLevel()`. XR step 6za checks every clip loads, a hit on the tank is called while the tank ducks under him, a fire order's four parts go out as one call, and Commander's slider at Off keeps him quiet.

## Headset check

1. Play solo, Practice → Drive the tank. Game menu → Combat → Damage → Hit engine: the commander should say "We're hit! Engine's hit!" through the intercom, the tank's sound dropping under him. Every word should be clear over the engine.
2. Damage → Repair: "Repairs done. We're fit to fight."
3. Battle → Advance to contact → Start: the brief. Drive towards the guns; when one fires, a fire order. Turn the turret or the tank before the next: the traverse, clock and range should match where it is.
4. Throw a track in a hard turn, or run the engine hot: his warning, once.
5. Sound and view → Commander's slider down to half, then Off: quieter, then silent, with the board still logging the notes. Full again.
6. Say whether he is loud enough over the tank, too loud, or comes too often in a fight.
