# Driver's station (F1.5)

The driver drives with their hands: two tillers, a gear lever (worked by hand, the right stick or the automatic box, [gearbox.md](gearbox.md)), a hand throttle on the left wall, five gauges in front between the tillers, and a brow pad to lean into the slit against. Every control is a lever from the mechanism kit ([mechanisms.md](mechanisms.md)), placed in the hull and read into the tank's drive ([tank-drive.md](tank-drive.md)). The numbers live in [`src/sim/driver-station.ts`](../src/sim/driver-station.ts); the fixed parts are in [`src/scene-assets/driver-station.scene-asset.ts`](../src/scene-assets/driver-station.scene-asset.ts), merged into the hull's mesh; [`src/systems/driver-station-system.ts`](../src/systems/driver-station-system.ts) turns the levers and needles.

## What players experience

- **Tillers.** Two upright levers stand on pedestals either side of the driver's knees, their handles where seated hands rest with the elbows bent, 42 cm under the eyes and 32 cm ahead ([interior.md](interior.md)). Squeeze the grip on one and it follows the hand fore and aft; it stops at 20° each way with a firm buzz (S3's went 25°, which needed a lean at full forwards), ticks at the middle and springs back upright when let go, as spike S3's did. Each tiller drives its own track: both forwards drive straight, ease one back to turn, one forwards and one back to pivot, both back to reverse, let go to stop. That is the automatic box, the default; with Stick shift or Clutch (F1.16) the tillers only brake, pulled back, and the right trigger is the accelerator ([gearbox.md](gearbox.md)).
- **The thumbsticks still drive** while no hand is on a tiller (and W A S D on a PC page), and the tillers are drawn following them. Taking hold of either tiller hands driving to the tillers.
- **Gear lever** on the gearbox's hump at the right knee, with seven notches since F1.16 ([gearbox.md](gearbox.md)): reverse furthest back (a red mark beside the gate), neutral (green mark), then 1st to 5th going forwards, 2nd upright. It ticks through each notch and drops into the nearest when let go. Between notches the gearbox is out of gear. With the automatic box it moves by itself and can't be taken hold of; with Stick shift and Clutch the hand, the right stick (A and B on the sticks) and keys 0 to 5 and R move it. With Stick shift a change down too low for the speed grinds and the lever goes back to the gear the box kept (John's headset check, 31 October 2026). With the Clutch, moving it into a gear without the clutch (the left trigger) **grinds**: nothing engages, the hand on the lever buzzes roughly (more lightly in a hand on a tiller), and a sign says to hold the clutch. With the clutch in the gear goes in after a fifth of a second with a clunk in the hand on the lever.
- **Hand throttle** on a quadrant against the left wall by the left knee: a friction lever that stays where it is left. Upright is idle (800 rpm); pushed 40° forwards it holds the engine at full revs, 2600 rpm (it stopped at 1600 until John's headset check, 31 October 2026). With Stick shift and the Clutch it sets cruising revs, so the tank drives on with the accelerator let go, and only lowering it brings them down ([gearbox.md](gearbox.md)); with the automatic box it raises the revs for the turret's power traverse (F1.8). It ticks at a third (1400 rpm, a cold engine's warm-up) and two thirds.
- **Gauges** in the instrument box standing on the glacis between the tillers, like a dashboard, a glance down from the slit and facing the driver's eyes (a Sherman's is at the left front, where ours was for a while; John found it handier in front, [interior.md](interior.md)): speed (0–40 km/h), engine (0–3000 rpm) and coolant (0–120 °C since F1.17) on the top row, oil pressure (0–6 bar) and fuel (E–F) under them, and the gear plate beside those, with a lit gear indicator showing the gear engaged (R, N, 1 to 5; red while the gears grind; since John's headset check, 31 October 2026) and the lever's gate under it. The coolant warms towards 72 °C at idle and 92 °C at full revs over about a minute, and since F1.17 starts at the air's 15 °C and cools slowly with the engine stopped; the oil pressure follows the revs; fuel burns slowly (a full tank lasts two hours at full revs) and never runs out in Phase 1; Back to start refuels. Nothing fails in Phase 1 (plan decision 7).
- **Parking brake** (F1.18, [parking-brake.md](parking-brake.md)) on a post just left of the left tiller's pedestal: a ratchet lever pulled up and back to put it on (it clicks every 4° and stays), pushed down with the trigger held to let it off. Its BRAKE lamp is on the switch strip.
- **Switch strip** (F1.17, [engine.md](engine.md)) along the bottom of the instrument box: a voltmeter (0–32 V), the oil, generator and parking brake warning lamps, two toggle switches, Battery and Ignition (flicked up for on), a Choke pull knob that stays where it is drawn to (in, half or out), and two push buttons held in, a big Starter and the Siren (since John's headset check, 31 October 2026; they were five small push buttons), worked by a fingertip or a fist. The tank is found with its engine stopped; the strip starts it.
- **Vision slit.** The slit in the hood's face is framed in steel with a leather brow pad above it. Since [interior.md](interior.md) it is 30 cm ahead of the eyes: from the seat it shows about 60° of the world ahead; leaning in towards the pad (the head stops a few centimetres short of it) it opens to 80°. It is a real opening, with no extra rendering (plan §4.3).
- **The crewmate's station.** Whoever doesn't drive sees the driver's levers move with the driver's hands on them, and the needles follow the tank. Only the player in the driver's seat can take hold of the driver's controls.

## Numbers

Hull space, as in [cabin.md](cabin.md); the driver's eye point is (−0.5, 1.45, −1.6).

| What | Value | Why |
| --- | --- | --- |
| Tillers | S3's: 45 cm, the top 12 cm the handle, ±20° (S3's ±25°), spring back at rate 10/s, 2° deadband; pivots 81 cm under the eyes, 32 cm ahead | Players drove S3's lane with them; full forwards in reach without a lean |
| Tiller pivots | 21 cm either side of the eyes, 1.0 m below them, 42 cm ahead: (−0.71 and −0.29, 0.45, −2.02) | S3's rig's place in front of the eyes, moved out past the knees (the crewmate's drawn shins are within 16 cm of the seat's middle) |
| Gear lever | 40 cm, the top 10 cm the handle, ±27°, notches 8° apart from −24° (reverse) through −16° (neutral) to +24° (5th), 2nd upright; in a gear within 3.5° of its notch | Pivot on the hump at (−0.1, 0.45, −1.95); its handle 21 to 49 cm ahead of the eyes |
| Grind | with the Clutch, the lever moved into a gear without the clutch in or too low a gear for the speed (F1.16); with Stick shift, too low a gear for the speed | Rough buzz 0.75 × 30 ms every 0.08 s in the hand on the lever, 0.4 in a hand on a tiller; a gear going in clunks 0.7 × 45 ms |
| Hand throttle | 24 cm, the top 8 cm the handle, 0 to 40°, stays where it is left; 800 to 2600 rpm | Pivot at (−0.98, 0.8, −1.85), on a quadrant sunk into the left wall |
| Gauges | five dials 9.6 cm across, 12.2 cm apart, on a 64 × 18 cm panel tilted back 20°, its middle at (−0.5, 1.205, −2.31) | About 75 cm from the eyes; each dial about 7° across. Read over every handle (tested) |
| Coolant | 55 °C at the start, towards 72 °C at idle and 92 °C at full revs, time constant 150 s | Moves slowly, as the plan asks |
| Oil pressure | 1.5 bar at idle, 5 at full revs, up to 0.4 lower when hot | |
| Fuel | full at the start; 2 h at full revs, a fifth of that rate at idle; stops at 10% | No failures in Phase 1 |
| Brow pad | 4 cm over the slit's top, 6 cm deep from the hood's face | The fade starts with the eyes 10 cm from the plate, 9 cm from the pad's bottom edge ([interior.md](interior.md#johns-third-headset-check-2026-10-31)) |
| Reach | every handle 0.45–1.4 m above a seated player's real floor and within 75 cm of the nearer shoulder, at both ends of its travel; handles at least 15 cm apart | `test/driver-station.test.ts`, as for the bench |

## Sharing

The host runs the tank (plan decision 1); the driver's station only feeds and shows its controls.

- **The driver's page** reads its levers into `drive` (left, right, gear, throttle). On the host that drives the simulation at once; on a guest driver it goes to the host in the **driver-controls packet** (`PacketType.DriverControls` = 6, 11 bytes, 45 Hz; 14 since F1.16 with the accelerator, clutch and Gearbox setting; 16 since F1.17 with the engine's switches and the Engine start setting).
- **The tank-state packet** (`PacketType.TankState` = 5, host → guest, 45 Hz) grew by 6 bytes to 55 (58 since F1.16, 64 since F1.17): the coolant and the fuel for the gauges, and the controls the host drove by (tillers, gear lever, throttle), so a guest who doesn't drive sees the host driver's levers move. A page on the F1.4 build still reads the first 49 bytes, and this build still reads an F1.4 packet (the gauges and levers then stay where they were).
- **The other page's levers** follow the controls the tank runs on, eased over about 50 ms: the guest driver's packets on the host, the host's tank states on a guest. The gear lever is drawn in its gear's notch (the packets say the gear, not the angle), so between notches it is drawn passing through the notches between; with the automatic box it is drawn in the gear the box engaged.
- **Hands on the controls.** Each handle has its HoldKind: 2 left tiller, 3 right tiller, 4 gear lever, 5 hand throttle (`src/systems/hand-lock.ts`), so the crewmate's hand is drawn closed on the handle it holds.
- The grind's buzz and the gear's clunk come from the tank state the page draws, so on a guest driver they come about half a round trip plus the buffer after the lever moved (about 250 ms at 150 ms RTT).

## The practice crewmate

Since F1.13 the practice crewmate drives through these same levers: its hands take the tillers (with the automatic box since F1.16, so it no longer moves the gear lever), on the gunner's calls or round a route ([crewmate.md](crewmate.md)).

## Departures from the building skill

- **No practice crewmate part**: driving is F1.13's (the roadmap's split).
- **No new Practice shortcut**: Practice → Drive the tank → Drive already sits the player at the station, with a sign now saying to grip the tillers.
- **No lurch on a grind.** The plan mentions a short lurch; the gearbox already drops out of gear and the tank coasts. A lurch is a sudden acceleration the comfort caps exist to prevent, so it waits for the headset check to ask for it. The clunk and grind sounds are F1.12's.
- **The dials' faces are a canvas texture drawn once**, unlit like the bench's board, so they read in the dim hull; the needles are five small meshes (six draw calls for the panel).

## Tests

- `test/driver-station.test.ts`: every handle in seated reach at both ends of its travel and far enough from the others; tillers outside the knees and the gear lever on the hump; tiller angles and drive demands both ways; the gear lever's seven notches in order and in a gear only near each, shifted by hand up through 1st to 4th and dropping into the notch it is let go near; the hand throttle staying where it is left and raising the idle; needles sweeping 270° and pinned at their ends; each dial covering what the tank can show; the instrument box in front between the tillers, in front of the glacis and under the slit, clear of the tillers' fists, facing the eyes and readable over every handle; the coolant warming, the fuel burning down to the reserve, the oil pressure following the revs; the slit's frame off the opening and its brow pad just out of the head's reach.
- `test/tank-net.test.ts`: the longer tank state round-trips its gauges and controls, and an F1.4 packet still decodes.
- `test/z-fighting.test.ts`: the hull with the station's fixed parts (also from outside, 8 mm), and its levers at both ends and at rest with the needles on the panel.
- `npm run test:xr`, step 6e: both tillers taken (gloves closed on them) and pushed forwards drive the tank, the gauges reading its speed and RPM; let go, they spring back and the tank stops; with the Clutch, the hand moving the gear lever from 2nd to 3rd grinds, and the clutch (left trigger) puts 3rd in; the lever let go near 1st drops into its notch; the hand throttle pushed forwards raises the idle and stays there. Screenshot: `artifacts/xr-driver-station.png`. Step 6d covers the sticks and the gearbox's settings.
- `npm run test:net` (`ONLY_DRIVE=1`, or `=lag`): the host's page draws the guest driver's tillers where the guest pushed them; the guest's page draws the host driver's tillers and throttle, and its gauges read the host's RPM.

`window.__driverStation` gives `names`, `state()` (each lever's angle in degrees and who holds it, what the station reads, grind and shift counts, whether this player can use it), `gauges()` (each needle's reading in its dial's units) and `handle(id, degrees?)`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated (menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Drive the tank → Drive**. You are in the driver's seat. Look down: two tillers in front of your knees, the gear lever by your right knee, the hand throttle by your left on the wall, and the instrument box's five gauges between the tillers. Nothing flickers.
2. Take hold of **both tillers** and push them forwards. Your gloves close on them with a buzz and the tank pulls away; the speed and RPM needles rise. Push one, pull the other: it pivots. Let go: they spring back and the tank stops.
3. Watch the **gear lever** move by itself as the automatic box changes up. Then menu → Tank → Gearbox: Clutch, and move the lever by hand from 2nd to 3rd: your hand buzzes roughly and a sign says the gears grind. Squeeze the left trigger (the clutch): the gear goes in with a clunk in your hand. Set Automatic again.
4. The rest of the gearbox's steps are in [gearbox.md](gearbox.md#headset-check).
5. Push the **hand throttle** forwards with your left hand and let go: it stays, and the RPM needle settles higher. Pull it back.
6. **Lean into the vision slit** until your brow nearly reaches the pad: the view through it widens. Say whether you could steer down the lane like that.
7. Let go of the tillers and drive with the **thumbsticks**: the tillers move with the sticks.
8. With a second headset (or `?bot=1` on a PC page as the guest), drive while the other sits as gunner and watches your levers, then swap.
9. Perf HUD (X) while driving: report frame time and draw calls.

Report: whether the tillers and the gear lever were easy to find without looking, whether the grind was clear, whether the gauges were readable from the seat, and whether the slit was usable for steering.
