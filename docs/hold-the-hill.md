# Hold the hill (F5.9)

The roadmap's "Scenario: hold a hill hull-down" (concept §7.3). The crew drives up behind the crest of a hill, halts where only the turret shows over it (hull down), and holds the hill against four enemy tanks coming at it from the north in two waves.

Hull down is how a tank defends: halted behind a crest with only its turret above it, the enemy sees a third of the target and takes far longer to spot it, while the gun still clears the crest. Too far forward and the hull shows; too far back and the gun is masked by the crest. The scenario is about finding that spot and holding it.

The logic is in [`src/sim/hill.ts`](../src/sim/hill.ts) (the run, the hold check, the debrief), the hill in [`src/sim/terrain.ts`](../src/sim/terrain.ts) (`HOLD_HILL`), the attackers' routes in [`src/sim/enemy-tanks.ts`](../src/sim/enemy-tanks.ts) (`HILL_TANKS`); the system is [`src/systems/hill-system.ts`](../src/systems/hill-system.ts).

## What players experience

- **Missions → Hold the hill → Start** puts the tank on the hill's reverse slope, 64 m behind the crest, facing north up the slope, mended, the engine warm, with a rack of AP. A sign (and the board) says "Hold the hill: take up a hull-down position on the crest. Four enemy tanks coming from the north. Knock them out before they reach the hill".
- **The hill**: a ridge 6 m high east of the range road beyond the 500 m board, its crest running east and west for 128 m (x 128 to 256, z −496), fading out 48 m beyond each end. The reverse slope behind it is gentle (about 4° where a tank halts hull down), the forward slope falls to the field over 64 m. The ground's rolling is smoothed away on it, so the hull-down band is the same all along the crest: **22 to 30 m behind it**. Nearer the crest the hull shows; further back the tank is below the crest and can't see over.
- **The commander helps the driver.** Halted on the hill for a second and a half, the board gets a call: "Hull down: only the turret shows" (green), "Hull showing: back up a little" (red), "Gun can't clear the crest: edge forward a little" or "Below the crest: edge forward to see over". It is judged from the nearest attacker, or before any comes from the road 300 m north. The board's tasks line keeps the latest.
- **The first wave** comes 15 s after the start, out of the north: two tanks (C and D) from the cross road 300 m away, driving straight at the hill at 14 km/h. "Enemy tanks coming from the north." Like the patrolling tanks (F3.3) they halt to lay and fire once they spot the tank, and drive on while they don't.
- **The second wave** comes at 1:40, or as soon as the first is knocked out: tank E along the road from the east and tank F from the west, each turning in at an end of the hill. "Two more tanks coming."
- **Won**: all four knocked out. "Hill held: all 4 tanks knocked out in 2:14", with the counts.
- **Lost**: the tank knocked out ("Knocked out after 1:52"), or an attacker reaches the foot of the hill's forward slope, the end of its route, 80 m in front of the crest ("The enemy took the hill after 1:11"). A crew that hides below the crest and never fights is overrun in about 70 s.
- **The debrief** gives the time, the tanks out, when the enemy first spotted the tank, hits taken of shots fired, hits through, and **how much of the time in the enemy's sight only the turret showed**: "hull down 85% of the time in their sight". The same line stays under the Missions tab's Start button.
- **Missions → Hold the hill → Hull down** parks the tank at the hull-down spot (24 m behind the crest's middle) facing north: the headset check's shortcut to look over the crest. **Stop** takes the enemy away.

The Battle tab's tuning (enemy spotting, accuracy, reactions, our hit box and armour, hits to knock out) applies here too. Starting the hill stops the advance to contact, and starting the advance to contact (or the Combat tab's enemies) ends the hill.

## The numbers

| What | Number | Where |
| --- | --- | --- |
| The hill | 6 m high, crest x 128 to 256 at z −496 (fading 48 m beyond each end), forward slope 64 m, reverse slope 80 m, the ground smoothed 32 m round it | `HOLD_HILL` |
| Hull-down band | 22 to 30 m behind the crest; Hull down parks at 24 m | `HILL.hullDownZ`, test/hill.test.ts |
| The start | 64 m behind the crest, facing north | `HILL.startZ` |
| Waves | 2 at 15 s; 2 more at 100 s or once the first two are out | `HILL.firstWave`, `secondWave`, `waves` |
| Attackers | Start on the cross road's copy at z −800, 300 to 330 m from the hull-down spot; drive at 4 m/s; end at the forward slope's foot, 80 m in front of the crest | `HILL_TANKS` |
| Their gun and eyes | As the patrolling tanks: spot within 400 m, lay 7 s, fire every 9 s | `ENEMY_TANK` |
| The commander's call | Halted (under 0.4 m/s) for 1.5 s | `HILL.still`, `stillFor` |

The hold check (`holdView`) judges as the enemy battery does: from the attacker's muzzle (1.95 m up) to the hull 1.1 m above the ground under the tank and to the turret's top; and from the crew's muzzle (2.24 m up, 5.47 m ahead of the hull's middle) to the attacker's middle.

### How it plays

A headless simulation (test/hill.test.ts, "how it plays"): the battery and the damage model against a crude crew halted at one spot, firing every 9 s at the nearest attacker it can see over the crest and knocking it out one shot in two. 200 runs each with the recommended tuning:

| Crew | Held | Knocked out | Overrun |
| --- | --- | --- | --- |
| Hull down (24 m behind the crest), fighting back | 93% | 7% | 0% |
| Hull showing (12 m behind), fighting back | 77% | 23% | 0% |
| Hull down, one shot in three, every 12 s | 57% | 43% | 0% |
| Below the crest (40 m), never firing | 0% | 0% | 100%, in about 70 s |
| Hull down, never firing | 0% | 100%, after about 90 s | 0% |

A real crew has to drive up and find the band first, and its gunner hits less often than one in two at 300 m, so treat these as an upper bound. A won fight is short: about a minute and a quarter for the crude crew.

## Sharing

- **`hill`** (reliable, host → guest): the run's phase, clock, wave, counts, the seconds seen hull and turret, and the commander's last call; sent on change, when the guest joins, and every 5 s while it runs.
- **`hill-ask`** (reliable, guest → host): Start or Stop. Hull down is the drive's own `drive-place`.
- The attackers are four more enemies in the battery (group `hill`, enemy indices 9 to 12 here, shells' targets 18 to 21), shared by the `enemy` event as the others are: the arrays grow and an older page reads what it has. No new PacketType or HoldKind.

Alone, this page is the host. The run stops while the crewmate is away (`crewPresence.paused`).

## The practice crewmate

As gunner it already engages any enemy tank in sight with AP, so one person can drive to the crest with `?bot=1` and the crewmate gunning. Finding the hull-down spot is the driver's job, helped by the commander's calls; the crewmate as driver halts on the player's calls as before.

## Departures from the building skill

- The hill is part of the ground in every mode, not only the scenario, as F3.10's walls are. Obstacles that stood on it are taken out (as the course's field does), so nothing on the crest blocks the gun.
- No new model: the attackers reuse the enemy tank and its wreck.
- The balance numbers come from a crude scripted crew, not play.

## Tests

- `test/hill.test.ts`: the hill's shape and slope; clear of the lane, course, firing lanes, tank A's route and every obstacle; the hull-down band all along the crest (exposed nearer, masked further back); the hull-down spot never showing the hull to any point of any route, hull down to 85%+ of them; the battery seeing only the turret there; the four attackers' indices, names and armour; their routes (start on the road, end at the foot, clear of obstacles, held at the end); entering one by one, driving, halting for good at the end and having arrived; halting to fire and driving on; the waves; won, knocked out, overrun; the seen-time shares and the commander's call only when halted; the `hill` event; and the simulation above (25 runs each).
- `test/enemy-tanks.test.ts`, `test/terrain.test.ts`: the counts now leave the hill's attackers out; the terrain's rolling check leaves the hill out.
- `npm run test:xr` (step 6zb, part 3): Start with nothing in and the briefing; Hull down and the commander's call (screenshot); the first wave seeing only the turret; knocking it out brings the second; all four out wins with the debrief; an attacker at its route's end takes the hill; Stop.
- `npm run test:net` (`ONLY_FIRING=1`): the guest's Start runs it on both pages; the host's first wave drawn on the guest's page; all four out wins on both; the guest's Stop ends it on both.

`window.__hill` has `state()`, `start()`, `stop()`, `hullDown()`, `nextWave()` (host: the clock on to the next wave, for the tests), `view()` (host: where the tank stands now) and `sign`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone, gunner's seat. Game menu (Y) → **Missions → Hold the hill → Hull down**. Look through the gunsight and the periscope: the crest should be just below the view, with the field and the road beyond it. Swap to the driver's seat and look out: the slit should show the slope up to the crest. Say whether the hill reads as a hill.
2. **Missions → Hold the hill → Start**, driver's seat. Drive up the slope and halt where you think the turret just clears the crest. Read the board's call. Edge forward and back until it says "Hull down". Say whether the calls helped and how long it took.
3. Swap to the gunner's seat (or play with the crewmate gunning, `?bot=1`) and fight the first wave. Note whether the attackers took long to fire at you, and whether your shots cleared the crest.
4. Play it to the end at least twice. Read out the debrief for each: the time, tanks out, when first spotted, hits taken of shots, hits through and the hull-down share. Say whether it felt fair and whether the second wave from the flanks made you move.
5. Try once without halting hull down (stay far forward with the hull showing) and compare the debrief.
6. With two players: one starts it, both see the briefing, the waves and the debrief.
7. Press **X** for the perf HUD with all four attackers in view: report the frame time.
