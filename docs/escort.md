# Scenario: escort a convoy (F5.8)

The first of the scenarios the concept lists (§ "Escort a convoy, hold a hill hull-down, recon without being spotted, ambush a column"). Four soft-skinned trucks have to get up the range road to the 600 m marker past the enemy that Advance to contact ([combat-scenario.md](combat-scenario.md)) fights: the three dug-in anti-tank guns on the left (F3.2) and, once the convoy is well up the road, the two tanks on their routes (F3.3). The crew's tank leads; the trucks follow it. The guns are there for the convoy and shoot at a truck they can see before the tank; one hit knocks a truck out.

What changes from Advance to contact is what the crew protects. There, only the tank can be hit, so it can sit and trade shots. Here, every halt is also where the trucks halt, 50 m behind, and a gun that can see them will fire on them first. The crew decides how far into a gun's sight the convoy comes: scout ahead and halt short, find and knock out the gun, lay smoke across its line, then lead the trucks on.

The logic is in [`src/sim/escort.ts`](../src/sim/escort.ts) (the trucks, the run, the lines) and [`src/sim/enemy-guns.ts`](../src/sim/enemy-guns.ts) (the battery spotting, laying on and firing at the trucks); the system is [`src/systems/escort-system.ts`](../src/systems/escort-system.ts); the truck is [`src/scene-assets/escort-truck.scene-asset.ts`](../src/scene-assets/escort-truck.scene-asset.ts).

## What players experience

- **Missions → Escort a convoy → Start** puts the tank back at the range's start, mended, warm, with the mixed rack (AP, AP, HE, smoke), brings in the three guns, and four trucks wait on the road behind it, 50 m back and 20 m apart. The sign and the commander give the briefing: "Escort a convoy: four trucks to the 600 m marker. They follow 50 m behind you. Guns dug in on the left, tanks beyond".
- **The trucks follow the tank**: the lead truck drives to stay 50 m behind the tank (measured up the road, wherever the tank is across it), each other truck 20 m behind the one ahead. They drive at up to 22 km/h, speeding up and braking gently, and stop when the tank stops. If the tank backs towards them, they back away slowly (7 km/h). They drive on the road's right half; the crew's tank can pass through them (they don't collide).
- **The enemy and the trucks**: an enemy spots the convoy as it spots the tank (about 10 s for a truck in the open at 300 m, growing with the square of the range; quicker when the trucks move; slower for a tank on the move; quicker once any enemy has fired). Once spotted it lays for its usual time and fires. A **gun** fires on a truck it can see before the tank; an enemy **tank** fires on the crew's tank before a truck. A truck is a box 6.4 m long, 2.25 m wide and 2.85 m to the top of its canvas, about the tank's size as a target. One hit knocks it out: it slews onto the verge, scorched, its tilt burnt off its bows, and the sign says "Truck 2 knocked out by Gun A. 3 of 4 trucks running". The trucks behind drive round it.
- **The enemy tanks come up** once the lead truck is 250 m up the road, or two guns are out ("Enemy tanks about").
- **Into the marker**: once the tank reaches the 600 m marker, the convoy no longer waits behind it: the trucks drive past it to the marker ("Convoy driving in").
- **The end**: won once every truck still running is past the marker, with at least two of them ("Convoy through in 6:12: 3 of 4 trucks"); lost once only one truck runs ("Convoy lost after 4:10: 3 of 4 trucks knocked out") or the tank is knocked out ("Escort knocked out after 3:05"). The second line gives enemies out, shots at the trucks, trucks lost, and hits on the tank and through its armour. The enemy then holds its fire. The same line stays under the Missions tab's buttons.
- **The crew board** shows "Convoy to the 600 m marker, 450 m" (from the lead truck), the trucks running, the enemies out, and "Lead them in: they follow you" until the convoy is released.
- **Missions → Escort a convoy → Ambush** jumps to the moment that matters for a headset check: the convoy started, the tank 210 m up the road, the trucks closed up behind it (160 to 100 m up), and gun A already laid on them; it fires about 8 s later.
- **Stop** takes the convoy and the enemy away. Starting Advance to contact stops the convoy, and starting the convoy stops Advance to contact: one fight at a time.
- The **Battle tab's tuning** holds here too: enemy spotting, accuracy and reactions apply to shots at the trucks as at the tank; our hit box, our armour and knocked out after apply to the tank only.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Trucks | 4, need 2 through | Losing one is a setback, losing three a failure |
| Following gap | 50 m behind the tank, 20 m apart | Far enough that the tank sees a gun before the trucks are in its sight (the guns first see the lane 80 to 240 m up it), close enough that a halt in the open puts them in it |
| Speed | 6 m/s (22 km/h) top, 2 m/s back, 1.5 m/s² | A loaded truck on a dirt road; faster than the tank in its low gears, so the convoy keeps up |
| Destination | the 600 m marker; the trucks drive in to 620 to 680 m | Past the battle objective (500 m), beyond the guns |
| Truck as a target | 6.4 × 2.25 × 2.85 m box, one hit knocks it out | A 2½-ton cargo truck under its tilt; soft-skinned |
| Tanks come up | lead truck 250 m up the road, or 2 guns out | As Advance to contact (which counts the tank's place) |
| Seed | 5180 | Every run meets the same fall of shot for the same play |
| Ambush | tank 210 m up, gun A laid on the convoy | Gun A sees the trucks closed up behind the tank there |

Waiting behind the start (on the road behind the cross road) the trucks are in cover: the enemy can't see a truck there. The ground repeats every 800 m, and without this the copy of gun B in the tile behind the start would see the last two trucks from 330 m.

### How it plays (headless simulation)

The battery, the convoy and the damage model run headless, 100 runs each with the recommended tuning. The crews are crude: they drive the tank up the road's middle at 18 km/h and never use the walls or smoke, so treat these as bounds, not play.

| Crew | Won | Trucks lost (median) | Tank knocked out |
| --- | --- | --- | --- |
| Drives straight to the marker, never stops or fires | 0% | 3 (lost in about 80 s) | 0% |
| Halts in the open when an enemy fires, knocks it out 25 s later | 85% | 0 | 15% |
| The same, 45 s later | 14% | 0 | 86% |

Driving through loses the convoy every time: the guns find the trucks (10 shots at them, 3 hits). A crew that halts when fired on keeps the trucks out of the guns' sight (one shot at them in a run), but then the tank is the target, in the open, and how quickly it kills each enemy decides the run, as in Advance to contact. A real crew halting behind a wall, laying smoke and spotting the flash should land between the bounds.

## Sharing

- **`escort`** (reliable, host → guest): the phase, the clock, each truck's place, speed and whether it runs (and which enemy knocked it out), whether the convoy is released, the counts and whether the tanks are in; sent on each change, when the guest joins, and every 2 s while it runs. Between messages the guest drives its trucks by the same rule from the tank it sees, so they don't jump.
- **`escort-ask`** (reliable, guest → host): Start, Stop or Ambush.
- **`enemy-shot`** gains `truck`: which truck a shot was fired at. A hit on a truck carries no damage to the tank; a page from before F5.8 reads it as a shot at the tank that missed or hit.
- The host decides everything: which truck a gun lays on, the fall of shot, and knocking a truck out as the shell gets there. No packet changes, no new PacketType or HoldKind.

Alone, this page is the host. The convoy and the enemy stop while the crewmate is away (`crewPresence.paused`).

## The practice crewmate

Nothing new to learn: as gunner it already engages a gun once it has fired and a tank once it is in range, loading HE or AP; as driver it moves and halts on the player's calls, and the trucks follow the tank whoever drives. With `?bot=1` a lone player can drive the convoy up with the crewmate gunning, or gun while it drives on calls.

## Departures from the building skill

- The trucks don't collide with the crew's tank or each other's wrecks: they drive round wrecks on the verge (the wreck is drawn 4 m to the side), and the tank can pass through a truck.
- The trucks' engines aren't heard and their wheels don't turn.
- No friendly fire: the crew's shells pass through the trucks.
- The enemy's choice of target is a rule (guns the trucks, tanks the escort), not a judgement of threat.
- The simulation numbers above come from a crude scripted crew, not play.

## Tests

- `test/escort.test.ts`: the trucks waiting behind the start on the road, following at the gap and spacing within top speed, halting and backing away slowly, a wreck left where it stopped with the trucks behind closing up, driving in past the marker once released and won, lost with too few trucks or the tank out, the tanks coming up, the shared state and the lines, a guest's trucks staying with the host's; the guns going for the trucks and the tanks for the escort, no truck in sight at the start, gun A laying on the convoy where Ambush puts it, spotting the convoy over time, firing on the tank with no truck in sight, an enemy tank firing on the tank first, shots at trucks counted apart, a truck's hit box, the shot's `truck` shared, the convoy's path clear of every obstacle; a straight drive losing the convoy.
- `test/z-fighting.test.ts`: the truck whole and knocked out.
- `npm run test:xr` (step 6zb, part 3): Start with the guns in, the trucks behind and the briefing; the trucks following the tank up the road; Ambush with gun A laid on the convoy; a truck gun A hits knocked out, drawn as a wreck on the verge with the sign, no hit on the tank; past the marker the convoy through, the debrief and the enemy holding fire (screenshot from the road behind it, `artifacts/xr-escort-through.png`); Stop.
- `npm run test:net` (`ONLY_FIRING=1` and the full run): the guest's Start runs it on both pages with the trucks drawn; the trucks following within a few metres on both; a truck the host's gun A knocks out a wreck on the guest's page with its sign; the guest's Stop ends it on both.

`window.__escort` has `state()`, `start()`, `stop()`, `ambush()`, `fireAt(i, k)` (enemy `i` fires at truck `k` now), `closeUp(d)` (the convoy closed up behind the tank at d), `drawn()` and `sign`; `window.__enemy.state().guns` gains each enemy's `truck`, `convoySpot` and `convoyTracking`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone, driver's seat. Game menu (Y) → **Missions → Escort a convoy → Start**. Read the briefing. Look back through the periscope (turn it round) or raise the seat head out: four trucks wait behind you on the road. Say how they read (shape, colour, size).
2. Drive up the road 100 m and halt: the trucks catch up and stop 50 m behind. Drive on and halt again.
3. **Ambush**. Wait for gun A to fire on the trucks (about 8 s, at 10 o'clock): the tracer goes past you to them. Swap to the gunner's seat (or have the crewmate gun with `?bot=1`) and knock gun A out, or lay smoke between it and the trucks. If a truck is hit, say how its wreck reads.
4. **Start** again and play it to the end at least twice. For each run read the debrief out: the time, trucks through, enemies out, shots at the trucks, hits on the tank. Say whether it felt like protecting the trucks or like Advance to contact with followers, and whether the 50 m gap feels right.
5. With two players: both see the trucks in the same places, a truck lost on both pages, and the briefing and debrief.
6. Press **X** for the perf HUD with all four trucks, the guns and a shell in the air in view: report the frame time and draw calls.
