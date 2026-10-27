# The practice crewmate in both seats (F1.13)

One person can test either seat: a second page set to play as the **practice crewmate** (Settings → This page plays as → Practice crewmate, or `?bot=1`) joins the crew and takes the other seat. Until now it only sat and looked about; now it drives from the driver's seat and loads, lays and fires from the gunner's, through the same controls a player uses, and the two of you talk with **calls**. The sums are in [`src/sim/crew-bot.ts`](../src/sim/crew-bot.ts) and the system is [`src/systems/crew-bot-system.ts`](../src/systems/crew-bot-system.ts).

## What players experience

- **Calls.** In a crew, the game menu has a **Calls** section. In the gunner's seat it calls the driver: **Advance**, **Halt**, **Reverse**, **Left**, **Right** and **Route**. In the driver's seat it calls the gunner: **Fire at will** and **Hold fire**. A call shows on a sign in front of the crewmate for 4 s ("Gunner: Driver, halt"), so two players can use the buttons too when the intercom is noisy. The line under the section's title says what the practice crewmate is doing ("advancing", "driving the route to 180 m up the road", "laying on the 250 m target").
- **The crewmate driving.** It takes both tillers with its hands, so the gunner sees its gloves on them and the levers move. It starts halted (a tank that drives off on its own the moment you sit down is a comfort problem). **Advance** drives forwards in low gear, **Reverse** backs up slowly, both holding the heading it had; **Halt** centres the tillers; **Left** and **Right** turn a further 45°, on the spot at a halt or as a curve on the move. **Route** sends it round the practice route: up the range road in low gear with firing halts at 50 m, 180 m and 300 m (15, 15 and 10 s), back to the start in high gear (it takes its right hand off the tiller, moves the gear lever with the tillers centred so the gears don't grind, and puts it back), and round again. Any other driving call takes it off the route.
- **The crewmate gunning.** Its right hand takes a shell from the rack, swings it to the breech, rams it and pulls the lever closed, as you would; its left hand rests on the elevation wheel. Loaded, it picks the nearest range target it hasn't hit yet (within the sight's reach, about 620 m), twists the power grip to traverse onto it, easing off as it closes, and winds the elevation wheel to the range. Laid, and with the tank halted, it pulls the trigger and calls "On the way!"; a hit gets "Target!" and it moves on to the next nearest; a miss gets another go at the same target. Once all three are hit it starts again. With the tank moving it keeps the gun laid and calls "Driver, halt" (at most every 15 s). **Hold fire** stops it firing (it still loads and lays); **Fire at will** lets it go again.
- The driver watching sees the crewmate's hands on the shells, the breech lever, the power grip and the elevation wheel, the turret turning and the gun firing, as with a second player.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Hands | move at 0.8 m/s between things, squeeze once on a handle, let go and try again after 0.6 s without a hold | Quick but readable; a person's reach is about that fast |
| Turning | 1°/s for every degree off the heading (15°/s at most, the comfort cap); stops within 1° at a halt | Gentle near the mark: the tank turns about a third of a second after the bot moves its hands (levers, network, the turn's acceleration) and a keener gain swings past and back (found in the net test) |
| Advance, reverse | tillers 0.9 forwards, 0.6 back | Below full, so the engine note (F1.12) has room |
| Pivot first | more than 60° off its heading, it stops going forwards and pivots | So a route's U-turn is a pivot, not a wide loop off the road, while a 45° call on the move is a curve |
| Route | (0, −50) low, halt 15 s; (0, −180) low, 15 s; (0, −300) low, 10 s; (0, −20) high, 5 s | On the road's corridor (no obstacles); each halt has a target ahead in reach |
| Arrival | within 3 m; slows from 12 m out in low, 50 m in high | The comfort caps' 1 m/s² stops it from top speed in about 47 m |
| Laying | traverse rate no faster than it can stop in (√(2·40°/s²·error), less a fifth) nor 1.5× the error per second; laid within 0.05° and 0.03° elevation, turret under 0.05°/s, for 0.3 s | 0.05° is 9 cm at 100 m and 44 cm at 500 m: well inside every target's face |
| Fires | tank under 0.3 m/s and not turning | Phase 1 fires from the halt |
| Elevation wheel | its hand winds the rim at up to 6 rad/s (about one turn a second) | |

## Sharing

Nothing new in the packets. The crewmate's page is an ordinary second player: as driver its station's levers feed the drive's controls (packet 6 when it is the guest), as gunner its page owns the turret and the loading (packets 7 and 8) and fires (`shot`); its hands go in its pose packets with their HoldKinds (from `handUse`, as the kit and the loading set it), so the player's page draws them closed on the controls.

- **`crew-call`**, reliable event, either way: `{ call }`, one of `advance`, `halt`, `reverse`, `left`, `right`, `route`, `fire`, `hold`, `on-the-way`, `target`. The other page shows it on its sign; the practice crewmate does what a call for its seat says.
- **`bot-status`**, reliable event, crewmate → player: `{ line }`, what it is doing, when that changes (at most once a second). Shown in the menu's Calls section.
- The host still decides hits, whichever page fires.

## How it works

- `BotDriver` (in `src/sim/crew-bot.ts`) turns the calls or the route and the tank as drawn into tiller demands and a gear; `steer` sets the tracks apart for a turn rate, and while the gear it wants isn't in it asks for the tillers centred. The system puts its hands on the station's tillers at the angle for each demand (`leverGrip` with the station's `tillerAngle`), and on the gear lever at the new gear's notch.
- `loadPlan` makes the right hand's next move at the breech as a timed path in turret space (take a shell and ram it, or only push a shell home, close the lever, or open a lever closed on nothing), from how the breech stands; `pathAt` plays it. The loading takes the hand through `scriptLoadingHand` (the same hook as `window.__loading.setTestHand`).
- `chooseTarget` picks the target, `aimAt` (F1.10's, now allocating nothing) gives the turret's turn and the gun's elevation for it, and `traverseDemand` and `twistForDemand` turn the turret's error into a twist of the power grip.
- The kit (`MechanismSystem`) takes **scripted hands** (`scriptedHands` in `src/systems/mechanism-system.ts`): a fist, the direction across it, a squeeze and a trigger, in place of a controller. The crewmate's hands go there, so they take hold, move and let go of controls by the kit's own rules, and the twist grip reads their roll and their trigger. `findControl(name)` gives the crewmate each control's mechanism and mount.

## Departures from the building skill

- No new model, Practice button or XR step: the crewmate needs a second page, so its checks are in the net test, and the Calls section is its way in.
- The crewmate uses the power traverse only, not the crank, for its aim: it can twist the grip finely enough, and its right hand would otherwise move between three things.
- Calls are buttons for now; voice recognition is not planned. F2.2's signal lamps and F2.6's callout card may grow out of them.

## Tests

- `test/crew-bot.test.ts`: the bot drives the real tank simulation: standing until called, advancing straight, halting, reversing; Left at a halt turning 45° on the spot and Right on the move; settling on its heading while seeing the tank a third of a second late; the whole route, reaching each stop in turn, shifting to high without a grind and staying on the road; steering; the calls' words. Gunning: the nearest target not yet hit; laying the turret onto 30°, −100° and 0.4° through the grip's twist without overshooting; the twist for a demand; its hand on a lever's handle and a wheel's rim and crank where the kit takes hold; loading through the loading rules at three elevations, and finishing a load someone else left half done.
- `npm run test:net` (`ONLY_BOT=1`): with the player driving, the crewmate loads, lays on the 100 m target and hits it, the player's page (the host) deciding; the player sees its hands on the elevation wheel, a shell, the breech lever and the power grip; its "On the way!"/"Target!" reach the player's sign and its status the menu. With the player gunning, Advance has it take both tillers and drive (the player's page drawing the tillers forwards), Halt stops the tank, and Left pivots it 45°.

`window.__bot` gives `seat`, `head`, `hand(side)`, `holding()`, `status`, `driving` (mode, motion, route leg, arrivals, what it asks of the controls), `gunning` (phase, target, aim, loads, shots, hits) and `call(name)` (as if called). `window.__crewCalls` gives `send(call)`, `sign`, `crewmate` (its status line) and `lastHeard`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Open the game on a PC too, set **This page plays as → Practice crewmate** in its Settings (or add `?bot=1`) and join the headset's crew from it; keep the PC page showing.

1. Sit in the **driver's** seat. The crewmate sits in the gunner's. Look back over your right shoulder: within a few seconds its right hand takes a shell from the rack, puts it in the breech and pulls the lever, and its left hand rests on the elevation wheel.
2. Stay parked. The turret turns towards the 100 m target (left of the road) and stops; the gun fires. A sign in front of you says "Gunner: On the way!", then "Gunner: Target!" when it hits. It loads again and moves on to the 250 m gun, then the 500 m tank. Report how long each took and whether any shot missed.
3. Drive off up the road (tillers forwards). The crewmate keeps the gun on its target as you drive; after a couple of seconds its sign says "Gunner: Driver, halt". Halt: it fires. Menu → Calls → **Hold fire**: it stops firing; **Fire at will**: it carries on.
4. Menu → Practice → Sit in → **Gunner**. The crewmate moves to the driver's seat (look down and left: its hands go to the tillers).
5. Menu → Calls → **Advance**: the tank pulls away and the crewmate's tillers lean forwards. **Left**: it curves 45° left. **Halt**: it stops. **Right** at a halt: it pivots 45° right on the spot. **Reverse**, then **Halt**. Say whether the starts, stops and turns are comfortable, and whether a sign appears on the PC page (it shouldn't: calls show on the other player's sign).
6. **Route**: it drives up the road, halting at three stops; lay and fire on the targets from each halt (or while it drives, to feel why a gunner calls halt). At the top it pivots round and drives back in high gear: watch its right hand move the gear lever with the tillers centred, and listen to (F1.12) or feel for a grind (there should be none).
7. Press **X** for the perf HUD while the crewmate drives the route and you lay the gun: report the frame time and draw calls.
