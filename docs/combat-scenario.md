# Combat scenario and tuning (F3.10)

John's note (2026-11-13): the Combat practice options get the tank disabled very quickly. He wanted a more realistic scenario using the enemy anti-tank guns (F3.2) and tanks (F3.3) with the damage model (F3.4) and ammunition (F3.1), to see whether hit rate, hit boxes, the ability to take damage and the other numbers need changing to make it a playable game.

This adds:

- **Battle → Advance to contact**: an approach up the range's lane past the dug-in guns, with walls for cover, the enemy tanks coming up halfway, a briefing and a debrief.
- **Spotting**: an enemy no longer sees the tank the moment it has a clear line. It takes time to spot it, less when the tank moves or fires, more when only its turret shows over cover.
- **Cover**: houses, walls and rocks now block the enemy's view (only the ground and smoke did), and seven stretches of wall stand along the lane so a tank can halt hull down.
- **Every number that decides how hard the fight is**, in one place and on six rows of buttons in the Battle tab, so they can be changed in the headset without a new build.

The logic is in [`src/sim/combat.ts`](../src/sim/combat.ts) (tuning, spotting, the scenario) and [`src/sim/enemy-guns.ts`](../src/sim/enemy-guns.ts) (the battery: sight lines, hull down, the hit box); the system is [`src/systems/combat-system.ts`](../src/systems/combat-system.ts); the walls are `LANE_WALLS` in [`src/sim/terrain.ts`](../src/sim/terrain.ts).

## Why the tank was disabled so quickly

Simulating 200 runs of the old numbers (the battery and damage model run headless, the crew not firing back):

| Situation | Knocked out | Median time |
| --- | --- | --- |
| Parked at Meet A, still | 200 of 200 | 31 s |
| Driving up the lane at 18 km/h, guns only | 200 of 200 | 48 s, 200 m up the lane |
| Driving up the lane, guns and tanks | 200 of 200 | 34 s, 160 m up the lane |

The causes, roughly in order of weight:

1. **Seen at once.** A gun saw the tank the instant there was a clear line within 600 m (a tank within 400 m), and fired 6 s later. Houses, walls and rocks didn't hide it.
2. **Accurate too soon.** The layer's error was 8, 4, then 2 mils, so at 250 m the second shot hit a still Sherman about 80% of the time and the third almost always.
3. **Five guns at once.** The guns and the tanks together fire a shell every 1.5 s or so once they all have the tank, and nothing slowed them down.
4. **A box for a target.** The tank was a box 2.74 m tall the full length of the hull, so a shell over the hull's back deck still counted as a hit.
5. **Almost every hit gets through.** That one is right: a long German 75 goes through a Sherman's sides at any range here and its front plate at most of them. It is why the other four matter so much.

## What players experience

- **Battle → Advance to contact → Start** puts the tank back at the range's start, mended, warm, with a mixed rack (AP, AP, HE, smoke), and brings in the three guns. A sign says "Advance to contact: reach the 500 m board. Guns dug in on the left, tanks behind them. Use the walls and smoke".
- **Walls**: dry stone walls, 30 m long and 1.5 m high, stand just off the lane: five on the left (centred 135, 190, 275, 350 and 425 m up the lane) facing the guns, two on the right (300 and 420 m up) facing tank A's route. Halted behind one, a gun on that side sees only the turret: slower to spot, and a target a third the size. The gaps are where each Combat → Meet parks the tank, so those still show the whole tank (or as much as the ground does).
- **Being spotted**: the guns hold fire until they spot the tank. On a still tank in the open at 300 m that takes about 10 s, growing with the square of the range (40 s at 600 m), never less than 2.5 s. Moving makes it 2.5 times quicker; firing gives the tank away (8 times quicker for 8 s); hull down it takes almost three times as long; once any enemy has fired, the rest are alert (1.5 times quicker); an enemy tank on the move spots at half speed. Out of sight, what it has spotted fades over 10 s. Once spotted, a gun lays for 8 s and fires every 10 s; a tank halts, lays for 7 s and fires every 9 s.
- **The enemy tanks come up** once the crew is past 250 m up the lane or has knocked out two guns ("Enemy tanks about: watch for them moving").
- **The end**: reaching the 500 m board, or knocking out all five enemies, wins; the sign says "Objective reached in 4:12" with the counts: enemies out, when the crew was first spotted, hits taken of shots fired at it, and hits through the armour. Knocked out, it says "Knocked out after 2:31" with the same counts. Either way the enemy holds its fire. The same line stays under the Battle tab's Start button.
- **Battle → Stop** takes the enemy away.

The Combat tab's Meet buttons now have the enemy spot the tank at once, since they are there to see it fire.

## The tuning

Each row of the Battle tab is a multiplier on the base numbers; the recommended one is lit at first. The host's choice rules and is kept in that browser between visits; the guest's buttons ask the host. **Tuning → Recommended** puts them all back. The menu line under them says what differs ("Tuned: enemy accuracy low, knocked out after 4 through").

| Row | Choices (recommended in bold) | What it changes | Base numbers, where |
| --- | --- | --- | --- |
| Enemy spotting | Slow 0.6, **Normal 1**, Quick 1.6, Instant | How fast the enemy builds up to spotting the tank. Instant spots it the moment it sees it, as before | `SPOTTING` in `src/sim/combat.ts`: 10 s at 300 m, ×2.5 moving, ×8 just fired, ×0.35 hull down, ×1.5 alert, ×0.5 a tank on the move, forgets at 0.1 a second |
| Enemy accuracy | Low 1.4, **Normal 1**, High 0.7, Sharp 0.5 | Multiplies the layer's error and the gun's dispersion | `ENEMY_GUN.layError` 16, 9, 5 then 3 mils; `dispersion` 0.4 mil (`src/sim/enemy-guns.ts`); leading a moving tank 80% |
| Enemy reactions | Slow 1.5, **Normal 1**, Quick 0.7 | Multiplies the time to lay the first shot and to reload | Guns 8 s and 10 s (`ENEMY_GUN`); tanks 7 s and 9 s (`ENEMY_TANK`, `src/sim/enemy-tanks.ts`) |
| Our hit box | Small 0.85, **True size 1**, Large 1.15 | Scales the tank as a target (width and height) | `TANK_SILHOUETTE`: hull 2.62 m wide, 5.84 m long, 1.85 m to its top; turret 2.3 m wide, 2.74 m to its top |
| Our armour | Weaker 1.15, **True 1**, Tougher 0.8, Toughest 0.6 | Multiplies the enemy shell's penetration | `DAMAGE.penAt100` 124 mm at 100 m, −4 mm per 100 m (`src/sim/damage.ts`); the armour by zone in `ARMOUR` |
| Knocked out after | 2, **3**, 4, 5 hits through | Hits through the armour that knock the tank out | `DAMAGE.knockOut` |

Changed from F3.2 to F3.4 by default: the spotting itself, the cover, the two-part hit box, the laying error (was 8, 4, 2 mils), the guns' lay and reload (6 s and 8 s), the tanks' (5 s and 7 s), and the tanks coming up later in the scenario. The armour, penetration and the three hits through are unchanged.

What a gun's shot hits now, a still Sherman side-on (each later shot corrects by the fall of the last):

| Range | 1st | 2nd | 3rd | 4th on | Hull down, 4th on | Moving 18 km/h, 4th on |
| --- | --- | --- | --- | --- | --- | --- |
| 150 m | 26% | 59% | 92% | 100% | 67% | 74% |
| 250 m | 10% | 30% | 65% | 90% | 40% | 45% |
| 400 m | 4% | 14% | 36% | 67% | 20% | 23% |

Before, at 250 m: 34%, 78%, 99%.

### How the scenario plays with the recommended values

The same headless simulation, 300 runs each. "Bounding" is a crude crew: it drives at 18 km/h from wall to wall, halts 25 s behind each, and fires every 9 s at any gun that has fired or any tank in view, knocking it out one shot in two. A real crew sees the guns, lays smoke and picks its moments, so treat these as a floor.

| Crew | Old numbers, all five at once | Recommended | Enemy accuracy Low |
| --- | --- | --- | --- |
| Drives straight up the lane, never stops or fires | 0% reach the board, out after 50 s | 1%, out after 75 s, 350 m up | 7%, out after 81 s |
| Sits still at Meet A (just over a crest: gun A sees the turret), doesn't fire | out after 31 s | out after 107 s | out after 147 s |
| Bounds from wall to wall, fires back | 6% win | 43% win, about 2 to 3 minutes | 56% win |

### Recommended starting values, and what to try in the headset

Start with everything at the recommended values. Then, one row at a time:

1. **Enemy accuracy** first. If hits come before you have had a chance to react (spotted the flash, laid smoke, moved), try **Low**. If you can sit in the open and trade shots, try **High**.
2. **Enemy spotting**. If you are being fired on before you could reasonably have been seen (say, moving slowly behind a wall), try **Slow**. If you can drive the open lane for a long time unseen, try **Quick**.
3. **Knocked out after**. This is the main "ability to take damage" lever. If a fight ends as soon as it gets interesting, try **4 through**. Our armour (**Tougher**) makes more shells bounce instead, which may read better ("Bounced off the front plate") than taking more holes.
4. **Our hit box** should stay at true size unless hits look wrong: a hit called when the tracer clearly passed over the turret would mean Small.
5. **Enemy reactions** sets the pace once you are spotted. Slow gives more time between shots to answer back.

Each debrief line says when you were first spotted, how many shots came at you and how many hit and got through: reporting those for a few runs, with the tuning line, tells us which way to move the defaults.

## Sharing

- **`combat`** (reliable, host → guest): the scenario's phase, clock, counts, whether the tanks are in, whether the objective was reached, and the tuning; sent on change, when the guest joins, and every 5 s while it runs.
- **`combat-ask`** (reliable, guest → host): Start, Stop, a tuning value, or Recommended.
- **`enemy-ask`** gains `spot` (a guest's Meet: that gun has the tank spotted).
- The host decides everything: the battery's spotting and the hits use the host's tuning; a guest only shows it. No packet changes, no new PacketType or HoldKind.

Alone, this page is the host. The scenario stops while the crewmate is away (`crewPresence.paused`).

## The practice crewmate

Nothing new to learn: as gunner it already engages a gun once it has fired and a tank once it is in range, loading HE or AP; as driver it moves and halts on the player's calls. Driving the scenario with `?bot=1` and the crewmate as gunner works today.

## Departures from the building skill

- The walls are drawn as the range's other walls are (part of the ground's chunks), so they are in every mode, not only the scenario. They stand outside the lane's flat strip and clear of the road's targets and markers.
- A hull-down tank is judged from two points: the hull at 1.1 m and the turret's top. Partly hidden hulls (a wall covering half the length) count as whole.
- Smoke, cover and the ground block sight; trees and bushes don't exist yet.
- No new model: the walls reuse the obstacle wall.
- The simulation numbers above come from a crude scripted crew, not play.

## Tests

- `test/combat.test.ts`: the tuning rows and reading them back; spotting times by range, movement, firing, hull down, alert and a moving tank; a gun holding fire until it spots; firing giving the tank away; Meet spotting at once; forgetting; the walls' places (off the lane, clear of the boards, markers, course and other obstacles); walls hiding the hull but not the turret, houses all of it; hull down behind the first wall and every Meet spot still in sight; the turret-only aim and the two-part hit box; the hit box, aim and armour levels; the knock-out level; the scenario's clock, first spotted, the tanks coming up, won, lost and its shared state; a still tank lasting most of a minute against gun A in the open and far longer hull down.
- `test/enemy-guns.test.ts` and `test/enemy-tanks.test.ts`: the laying and firing tests use Instant spotting (`INSTANT_SPOTTING`), as F3.2 did; the accuracy test has the new numbers.
- `npm run test:xr` (step 6y, part 2): Battle → Start with the guns in and the briefing; Enemy accuracy → Low reaches the battery and lights, Recommended puts it back; behind the first wall gun A sees only the turret; past halfway the tanks come up; at the 500 m board it is won with the debrief and the enemy holds its fire; Stop.
- `npm run test:net` (`ONLY_FIRING=1`): the guest's Start runs it on both pages; the guest's Enemy accuracy → Low reaches the host's battery and both pages; the guest's Stop ends it on both.

`window.__combat` has `state()` (the scenario and the tuning), `start()`, `stop()`, `tune(key, value)`, `resetTuning()` and `sign`; `window.__enemy.state().guns` gains each enemy's `view` and `spot`, and `window.__enemy.tuning()` the battery's tuning.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell. The tuning stays as you leave it, so finish with Tuning → Recommended if you change it.

1. Enter VR alone, driver's seat. Game menu (Y) → **Battle → Advance to contact → Start**. Read the briefing. Look out of the slit and periscope: the low walls along the lane's left and, further up, its right.
2. Drive up to the first wall on the left (about 135 m up) and halt behind it. Gun A should take a while to fire, and miss more than it hits. Say how long you waited for its first shot.
3. Drive on in bounds from wall to wall. When a gun fires, swap to the gunner's seat (or have the crewmate gun with `?bot=1`) and knock it out with HE or AP, or lay smoke. Note when the tanks come up.
4. Play it to the end at least twice. For each run, read the debrief out: the time, enemies out, when first spotted, hits taken of shots, and hits through. Say whether it felt fair and whether you felt you had a chance to react.
5. Change one row and play again: **Enemy accuracy → Low**, then **Knocked out after → 4 through**. Say which felt better.
6. With two players: one changes the tuning, and both see the same buttons lit; both see the briefing and the debrief.
7. Press **X** for the perf HUD with the guns and the tanks in view and a shell in the air: report the frame time.
