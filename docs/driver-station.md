# Driver's station (F1.5)

The driver drives with their hands: two tillers, a gear lever that grinds when shifted carelessly, a hand throttle on the left wall, five gauges under the vision slit, and a brow pad to lean into the slit against. Every control is a lever from the mechanism kit ([mechanisms.md](mechanisms.md)), placed in the hull and read into the tank's drive ([tank-drive.md](tank-drive.md)). The numbers live in [`src/sim/driver-station.ts`](../src/sim/driver-station.ts); the fixed parts are in [`src/scene-assets/driver-station.scene-asset.ts`](../src/scene-assets/driver-station.scene-asset.ts), merged into the hull's mesh; [`src/systems/driver-station-system.ts`](../src/systems/driver-station-system.ts) turns the levers and needles.

## What players experience

- **Tillers.** Two upright levers stand on pedestals either side of the driver's knees, their handles at lap height a forearm ahead. Squeeze the grip on one and it follows the hand fore and aft; it stops at 25° each way with a firm buzz, ticks at the middle and springs back upright when let go, exactly as spike S3's did. Each tiller drives its own track: both forwards drive straight, ease one back to turn, one forwards and one back to pivot, both back to reverse, let go to stop.
- **The thumbsticks still drive** while no hand is on a tiller (and W A S D on a PC page), and the tillers are drawn following them. Taking hold of either tiller hands driving to the tillers.
- **Gear lever** on the gearbox's hump at the right knee, with three notches: pulled back is low range (green mark beside the gate), upright neutral, pushed forwards high range (yellow mark). It ticks through each notch and drops into the nearest when let go. Between notches the gearbox is out of gear. Moving it into a gear with either tiller more than a fifth of the way from centre **grinds**: nothing engages, the hand on the lever buzzes roughly (more lightly in a hand on a tiller), and a sign says to centre the tillers. Centre them and the gear goes in after a third of a second with a clunk in the hand on the lever. The game menu's Gear lever row (and keys 0, 1, 2 on a PC page) moves the same lever.
- **Hand throttle** on a quadrant against the left wall by the left knee: a friction lever that stays where it is left. Upright is idle (800 rpm); pushed 40° forwards it holds the engine at 1600 rpm, for the turret's power traverse while parked (F1.8) and a livelier pull away. It ticks at a third and two thirds.
- **Gauges** under the slit, tilted towards the driver's eyes, left to right: speed (0–40 km/h), engine (0–3000 rpm), coolant (40–120 °C), oil pressure (0–6 bar) and fuel (E–F). A line of lettering under them says which way the gear lever goes. The coolant warms from 55 °C towards 72 °C at idle and 92 °C at full revs over a couple of minutes; the oil pressure follows the revs; fuel burns slowly (a full tank lasts two hours at full revs) and never runs out in Phase 1; Back to start refuels. Nothing fails in Phase 1 (plan decision 7).
- **Vision slit.** The slit in the front plate is now framed in steel with a leather brow pad above it. From the seat it shows about 24° of the world ahead; leaning in towards the pad (the head stops a few centimetres short of it) it opens to over 70°. It is a real opening, with no extra rendering (plan §4.3).
- **The crewmate's station.** Whoever doesn't drive sees the driver's levers move with the driver's hands on them, and the needles follow the tank. Only the player in the driver's seat can take hold of the driver's controls.

## Numbers

Hull space, as in [cabin.md](cabin.md); the driver's eye point is (−0.5, 1.45, −1.6).

| What | Value | Why |
| --- | --- | --- |
| Tillers | S3's: 45 cm, the top 12 cm the handle, ±25°, spring back at rate 10/s, 2° deadband | Players drove S3's lane with them |
| Tiller pivots | 21 cm either side of the eyes, 1.0 m below them, 42 cm ahead: (−0.71 and −0.29, 0.45, −2.02) | S3's rig's place in front of the eyes, moved out past the knees (the crewmate's drawn shins are within 16 cm of the seat's middle) |
| Gear lever | 40 cm, the top 10 cm the handle, ±28°, notches at −24° (low), 0 (neutral), +24° (high); in a gear within 8° of its notch | Pivot on the hump at (−0.1, 0.45, −1.95); its handle 21 to 49 cm ahead of the eyes |
| Grind | either tiller more than 20% from centre while the lever moves into a gear (F1.4) | Rough buzz 0.75 × 30 ms every 0.08 s in the hand on the lever, 0.4 in a hand on a tiller; a gear going in clunks 0.7 × 45 ms |
| Hand throttle | 24 cm, the top 8 cm the handle, 0 to 40°, stays where it is left; idle 800 to 1600 rpm | Pivot at (−0.98, 0.8, −1.85), on a quadrant sunk into the left wall |
| Gauges | five dials 9.6 cm across, 12.2 cm apart, on a 64 × 18 cm panel tilted back 20°, its middle at (−0.5, 1.205, −2.31) | About 75 cm from the eyes; each dial about 7° across. Read over every handle (tested) |
| Coolant | 55 °C at the start, towards 72 °C at idle and 92 °C at full revs, time constant 150 s | Moves slowly, as the plan asks |
| Oil pressure | 1.5 bar at idle, 5 at full revs, up to 0.4 lower when hot | |
| Fuel | full at the start; 2 h at full revs, a fifth of that rate at idle; stops at 10% | No failures in Phase 1 |
| Brow pad | 4 cm over the slit's top, 6 cm deep from the front plate | The head box stops the eyes 20 cm from the plate, the forehead about 5 cm short of the pad |
| Reach | every handle 0.45–1.4 m above a seated player's real floor and within 75 cm of the nearer shoulder, at both ends of its travel; handles at least 15 cm apart | `test/driver-station.test.ts`, as for the bench |

## Sharing

The host runs the tank (plan decision 1); the driver's station only feeds and shows its controls.

- **The driver's page** reads its levers into `drive` (left, right, gear, throttle). On the host that drives the simulation at once; on a guest driver it goes to the host in the **driver-controls packet** (`PacketType.DriverControls` = 6, unchanged, 11 bytes, 45 Hz).
- **The tank-state packet** (`PacketType.TankState` = 5, host → guest, 45 Hz) grew by 6 bytes to 53: the coolant and the fuel for the gauges, and the controls the host drove by (tillers, gear lever, throttle), so a guest who doesn't drive sees the host driver's levers move. A page on the F1.4 build still reads the first 47 bytes, and this build still reads an F1.4 packet (the gauges and levers then stay where they were).
- **The other page's levers** follow the controls the tank runs on, eased over about 50 ms: the guest driver's packets on the host, the host's tank states on a guest. The gear lever is drawn in its gear's notch (the packets say the gear, not the angle), so between notches it is drawn passing through neutral.
- **Hands on the controls.** Each handle has its HoldKind: 2 left tiller, 3 right tiller, 4 gear lever, 5 hand throttle (`src/systems/hand-lock.ts`), so the crewmate's hand is drawn closed on the handle it holds.
- The grind's buzz and the gear's clunk come from the tank state the page draws, so on a guest driver they come about half a round trip plus the buffer after the lever moved (about 250 ms at 150 ms RTT).

## The practice crewmate

The crewmate learns to drive in F1.13, through these same levers. Until then a player alone in the gunner's seat sits in a parked tank, and a player alone drives with the crewmate riding as gunner.

## Departures from the building skill

- **No practice crewmate part**: driving is F1.13's (the roadmap's split).
- **No new Practice shortcut**: Practice → Drive the tank → Drive already sits the player at the station, with a sign now saying to grip the tillers.
- **No lurch on a grind.** The plan mentions a short lurch; the gearbox already drops out of gear and the tank coasts. A lurch is a sudden acceleration the comfort caps exist to prevent, so it waits for the headset check to ask for it. The clunk and grind sounds are F1.12's.
- **The dials' faces are a canvas texture drawn once**, unlit like the bench's board, so they read in the dim hull; the needles are five small meshes (six draw calls for the panel).

## Tests

- `test/driver-station.test.ts`: every handle in seated reach at both ends of its travel and far enough from the others; tillers outside the knees and the gear lever on the hump; tiller angles and drive demands both ways; the gear lever in a gear only near its notch, shifted by hand from low through neutral to high and dropping into high when let go; the hand throttle staying where it is left and raising the idle; needles sweeping 270° and pinned at their ends; each dial covering what the tank can show; the panel under the slit, facing the eyes and readable over every handle; the coolant warming, the fuel burning down to the reserve, the oil pressure following the revs; the slit's frame off the opening and its brow pad just out of the head's reach.
- `test/tank-net.test.ts`: the longer tank state round-trips its gauges and controls, and an F1.4 packet still decodes.
- `test/z-fighting.test.ts`: the hull with the station's fixed parts (also from outside, 8 mm), and its levers at both ends and at rest with the needles on the panel.
- `npm run test:xr`, step 6e: both tillers taken (gloves closed on them) and pushed forwards drive the tank, the gauges reading its speed and RPM; let go, they spring back and the tank stops; a tiller pushed while the other hand moves the gear lever from low to high grinds, and letting go of the tiller puts high in; the lever let go near low drops into its notch; the hand throttle pushed forwards raises the idle and stays there. Screenshot: `artifacts/xr-driver-station.png`. Step 6d (the sticks and the menu's gear lever) passes unchanged.
- `npm run test:net` (`ONLY_DRIVE=1`, or `=lag`): the host's page draws the guest driver's tillers where the guest pushed them; the guest's page draws the host driver's tillers and throttle, and its gauges read the host's RPM.

`window.__driverStation` gives `names`, `state()` (each lever's angle in degrees and who holds it, what the station reads, grind and shift counts, whether this player can use it), `gauges()` (each needle's reading in its dial's units) and `handle(id, degrees?)`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated (menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Drive the tank → Drive**. You are in the driver's seat. Look down: two tillers in front of your knees, the gear lever by your right knee, the hand throttle by your left on the wall, five gauges under the slit. Nothing flickers.
2. Take hold of **both tillers** and push them forwards. Your gloves close on them with a buzz and the tank pulls away; the speed and RPM needles rise. Push one, pull the other: it pivots. Let go: they spring back and the tank stops.
3. With the tillers centred, pull the **gear lever** back past the middle to see the click through neutral, then push it forwards into high: after a moment it goes in with a clunk in your hand. Drive in high.
4. **Grind it**: push a tiller forwards and move the gear lever: your hand buzzes roughly, a sign says the gears grind, and the tank coasts. Centre the tillers: the gear goes in.
5. Push the **hand throttle** forwards with your left hand and let go: it stays, and the RPM needle settles higher. Pull it back.
6. **Lean into the vision slit** until your brow nearly reaches the pad: the view through it widens. Say whether you could steer down the lane like that.
7. Let go of the tillers and drive with the **thumbsticks**: the tillers move with the sticks.
8. With a second headset (or `?bot=1` on a PC page as the guest), drive while the other sits as gunner and watches your levers, then swap.
9. Perf HUD (X) while driving: report frame time and draw calls.

Report: whether the tillers and the gear lever were easy to find without looking, whether the grind was clear, whether the gauges were readable from the seat, and whether the slit was usable for steering.
