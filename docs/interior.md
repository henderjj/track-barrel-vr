# A Sherman's interior

John's play-test note (2026-10-28): the gap between what you look through and the controls you hold is too big, and the inside should look and be lit more like a tank's. This reworks the driver's and the gunner's stations from the M4A4's layout and gives the cabin interior lighting. The numbers live in [`src/sim/cabin.ts`](../src/sim/cabin.ts) (the front, the seats), [`src/sim/driver-station.ts`](../src/sim/driver-station.ts), [`src/sim/periscope.ts`](../src/sim/periscope.ts), [`src/sim/turret.ts`](../src/sim/turret.ts) and, for the lighting, [`src/sim/interior.ts`](../src/sim/interior.ts).

## Where the layout comes from

The Medium Tank M4A4 manual, TM 9-754, has the two pictures John uploaded:

- **Figure 9, the driver's control group**: two steering levers standing up from the floor in front of the driver, the gear shift lever on the transmission to their right, the throttle control and the instrument box on their left, and the assistant driver's seat across the transmission. The driver looks out through the hood in the glacis, a hand's length from the face, with the hands on the levers.
- **Figure 13, the 75 mm gunner's controls**: the elevating hand wheel and the traverse hand wheel side by side directly under the gun's sight, the power traverse's switch box between them, the firing switches by the gunner's feet.

So a crewman's eyes and hands work together: the vision device is a short lean from the seat, and the controls are where the hands rest with the eyes at it. We had the driver's slit 80 cm ahead of the eyes (a 60 cm lean that left the tillers behind them) and the gunsight 28 cm ahead with the wheels 47 to 51 cm under the eyes. The dimensions below are taken from those pictures and a seated adult's proportions (shoulders about 20 cm under the eyes, a forearm about 35 cm), not from measured drawings.

## John's headset check (2026-10-30)

After the first pass John reported: it reads as a tank and nothing flickers, but the lighting was still bright, so the hatch and lamp light didn't show; the tillers were low and pushing them fully forwards needed a lean that put the head into the slit and pushed the view back, which made testing hard ("it might be better to fade out instead so the calibrated seating position stays fixed"); the instrument box would be handier in front (and where is a Sherman's?); the periscope works; the gunner's crank clashed with the turret ring and the controls were still a bit low; 85 fps in the gunner's seat and 90 in the driver's; the turret roof looked square and basic. The second pass:

- **Fade, don't push.** Leaning past the head box, or standing up over the roof stop, now fades the view to black over 8 cm, and leaning back clears it. The play space stays where calibration put it, so the seat never shifts under the player. A head more than 30 cm past the box's edge still puts the player back in the seat if it got there in one jump of over 20 cm (a recentre) or stays there two seconds (standing up and walking off).
- **Darker.** Away from the pools the cabin now gets about 6% of the sky's light (26% before), so the daylight under each hatch, now a tighter pool, and the dome lamps, now brighter, stand out.
- **Tillers.** The handles stand 42 cm under the eyes (55 before) and 32 cm ahead, and swing 20° each way (25° before): full forwards is 45 cm ahead, within a seated arm's reach with no lean.
- **The instrument box** on a Sherman is at the driver's left front, by the steering levers (figure 9's "instrument box", top left), which is where ours was. It now stands in front instead, on the glacis between the tillers like a car's dashboard: a glance 37° down from the slit, 57 cm away.
- **Gunner.** The elevation wheel, the traverse crank and the power grip are 5 cm higher (their hubs 39 cm under the eyes), the crank 9 cm further in, and the race ring the turret turns on is narrower and out at the hole's edge (its inner edge 87 cm from the middle, 83 before), so the crank and the fist on it turn clear of it.
- **The turret's roof** reads as a cast turret's: chamfers along the roof's edges and down the four corners take away the box, the hatch is round with a collar under it and a round lid, and the roof has the ventilator's housing over the loader's side and a rib behind the lamp.

## John's second headset check (2026-10-30)

After the second pass John found all the controls in reach. In the gunner's seat he could see the world outside through gaps at the turret's front-left and rear-right corners, and with the hatches open it still looked bright. He asked for options to open and close the hatches and to adjust the light, to find what looks best. The third pass:

- **The gaps.** The turret is a 2.3 m square on a hull 2.36 m wide outside, so once it turns more than about 1.5° two opposite corners overhang the hull's sides, and its foot was open there: through it the gunner saw the ground past the hull roof's edge. A plate now closes the turret's foot from its walls in to the ring (`TURRET_FOOT`), 1 cm over the hull roof, so it turns with the turret. A test casts rays down inside the turret at seven angles and finds the floor every time; without the plate, the front-left corner at 17° saw the ground.
- **Settings → Sound and view** has three new rows, each player's own view and kept for next time:
  - **Open hatches**: Both (the default), Driver's, Gunner's or None (`?hatches=both`, `driver`, `gunner`, `none`). A shut hatch has its lid down in the hole, lets no daylight pool under it and takes 30% of the cabin's ambient with it (`HATCH_AMBIENT_SHARE`): with both shut the ambient is 40% of the open cabin's, the rest standing for the light through the slit, the periscopes and the sight, off the ivory paint.
  - **Cabin light**: the ambient times 0.5 (Darker), 1 (Normal, about 6% of the sky's), 2 (Lighter) or 4 (Bright, about the first pass's 26%) (`?cabin=`).
  - **Dome lamps**: Off, Dim (half), Normal or Bright (twice) (`?lamps=`).

## What players experience

- **The driver** sits under a sloped glacis, as in a Sherman: the front plate stands up from the floor to knee height, slopes back over the driver's legs at 57° from upright, and meets the hood's upright face, which holds the vision slit 30 cm ahead of the eyes. From the seat the slit shows about 60° of the world (24° before), so the driver can steer with both hands on the tillers and their eyes on the road; leaning 10 cm in to the brow pad opens it to 80°.
- The tillers' handles are where seated hands rest with the elbows bent, 42 cm under the eyes and 32 cm ahead, and full forwards is reached without leaning.
- **The instrument box** stands on the glacis between the tillers, tilted to face the eyes, a glance down from the slit: speed, engine and water on the top row, oil and fuel under them with the gear lever's plate. The hand throttle is on its quadrant on the left wall.
- **Leaning into things** (past the head box, or standing up into the roof) fades the view to black instead of moving the seat.
- **The periscope** is now right of the slit, its window 15 cm ahead of the eyes and 26 cm to the right: a lean right to look in, the yoke under it at chest height. Its head stands on the roof ahead of the driver's hatch, which now opens forwards so the turret's overhang can't sweep into its lid.
- **The gunner**'s sight is an 18 cm lean (28 cm before), and the elevation wheel, the traverse crank and the power grip sit close under it: with the eye at the eyepiece, the wheels' hubs are 39 cm under it and a forearm ahead, so both hands stay on them while aiming, as in figure 13.
- **The front compartment** has what a Sherman's has round the driver: the final drive's ribbed housing in the nose between the seats, the assistant driver's seat and the bow machine gun's ball in the glacis in front of it, two red fire extinguishers on the right, six 75 mm rounds in a rack on the left sponson behind the driver, and cable conduits along both walls. The turret's bustle has the radio set on its shelf, and its roof is rounded at the edges like a cast turret's, with a round hatch, the ventilator and a rib.
- **Lighting**: the inside is dark, with daylight falling in through the open hatches and a little through the slit, and a warm dome lamp glowing in the hull roof and in the turret's. The turret's daylight and lamp turn with it. Low down in the hull it is darkest. The outside of the tank and the world are lit as before. The plates stay ivory inside, as the real crew compartments were painted, so the dim inside still reads.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Nose plate | upright from the floor to 1.0 m at z −2.4 | The final drive's housing and the driver's feet fit behind it |
| Glacis | from 1.0 m at z −2.4 to 1.32 m at z −1.9, 57° from upright | The Sherman's is 56°; above the tillers and the driver's knees |
| Hood face | upright at z −1.9 from 1.32 m to the roof | The slit 30 cm ahead of the eyes |
| Vision slit | as before (34 × 10 cm at 1.45 m), in the hood face | About 60° across from the seat, 80° leant in |
| Driver's head box forward | 10 cm (60 cm before) | Fades the view with the eyes 20 cm from the slit, the brow 5 cm short of its pad |
| Head fade | black 8 cm past the head box or the roof stop; more than 30 cm out, reseat after a jump of over 20 cm or 2 s | The seat stays where it was calibrated |
| Tiller pivots | 81 cm under the eyes, 32 cm ahead (94 and 42 before); ±20° (±25°) | Handles 42 cm under the eyes, 19 to 45 cm ahead |
| Hand throttle pivot | 0.66 m (0.8 m before) | On its quadrant by the left knee |
| Instrument box | face's middle (−0.5, 1.1, −2.06), 28 × 16 cm, facing the eyes 57 cm away, 37° down | Between the tillers with a fist's room either side, in front of the glacis |
| Periscope axis | 26 cm right of the eyes, 20 cm ahead (22 cm left, 37 cm ahead before) | Behind the hood face; its handles swing beside the chest when turned |
| Driver's hatch | 50 cm square, from 10 cm ahead of the eyes to 40 cm behind them; lid open forwards | The periscope's head stands on the roof in front of it |
| Gunsight eyepiece | turret (0.32, 2.25, −0.38), an 18 cm lean | The head stops 4 cm short of it |
| Gunner's head box forward | 14 cm (24 cm before) | |
| Elevation wheel, crank, power grip | turret (0.29, 1.86, −0.6), (0.52, 1.86, −0.52), (0.71, 1.63, −0.45) | Hubs 39 cm under the eyes; the crank's fist inside the ring |
| Turret ring | race ring 91 cm out, 4 cm tube (90 cm, 7 cm before) | Its inner edge at 87 cm, clear of the crank |
| Turret roof | 12 cm chamfers along its edges and down its corners; round hatch 54 cm across; ventilator 24 cm across | A cast turret, not a box |
| Interior ambient | 6% of the sky's light, a little warm, 55% of that on the hull floor | Dark, as a closed steel box is (26% read as bright) |
| Hatch daylight | 1.2 of daylight from 45 cm above each open hatch, falling straight down (the cosine from straight down to the 12th power), half as bright 1.2 m away | A tight pool under each hatch |
| Slit daylight | 0.25 of daylight from just inside the slit, half as bright 35 cm away | Lights the hood's inside face a little |
| Dome lamps | warm, 0.5, half as bright 0.5 m away; hull roof over the transmission, turret roof behind the gun | Glowing lenses, no real-time light |

## How the lighting works

There are still no real-time lights (the building skill's budget allows one, and shadows are off). Every model inside the tank uses `MeshStandardMaterial` lit by the sky's image-based light; `litInside` ([`src/scene-assets/cabin-light.ts`](../src/scene-assets/cabin-light.ts)) patches those materials' shaders so that wherever a surface is inside the hull or the turret, the sky's light on it is multiplied by the interior's: the dim ambient plus a pool from each of five lights (two hatches, the slit, two lamps), each falling off with distance and wrapping a little round faces turned away. It is a few multiplies a pixel. Positions are world space, which is hull space because the tank stays at the origin. `CabinLightSystem` turns the turret's lights and its inside with the turret. The same sum is `interiorLight` in `src/sim/interior.ts`, which the tests check. The lamps' lenses are a small unlit mesh in the hull and one in the turret (two draw calls).

What it lights: the cabin, the driver's and gunner's controls, the periscope, the sight, the loading parts, the run clocks, both crew's hands and the crewmate's avatar. The terrain and the riding spike's blockout are not patched. The dial faces, the boards and the needles are unlit as before, so they read clearly in the dim cabin, like illuminated instruments.

## Sharing

Nothing new goes over the network: the layout is the same numbers on both pages, and each page lights its own cabin from the turret angle it draws. The hatch and light settings are each player's own view: a hatch one player shuts stays open on the crewmate's page. Once a look is chosen it can become the tank's, shared, if a hatch is to matter in play.

## Departures and what to watch

- **The instrument box is in front, not on the left** as on a Sherman: John found the left wall awkward. Between the tillers it leaves the fists 5 cm either side; whether the hands brush it at full travel is a headset question.
- **No push at the walls.** With the fade, nothing stops a head going through a plate; the view is black by then. A head kept far out for two seconds reseats the player.
- **The periscope's yoke turned sideways** brings a handle within 8 cm of the eyes' plane (beside the right shoulder, 26 cm out); before it stayed 18 cm ahead. The unit test now asks for 7 cm. Check it doesn't knock the chest when turned.
- **The S3 lever-test rig** (Test rigs → Lever test) still stands where it did, in front of the station's tillers.
- **The run clock** in the driver's seat moved to the left of the slit (the periscope covers the right).

## Tests

- `test/interior.test.ts`: the glacis's slope and the hood; the slit 30 cm ahead and the tillers in easy reach from the seat at every angle; the gunner's wheels 35 to 45 cm under an eye at the eyepiece; outside the tank unlit, the armour's outer faces outside however the turret turns; the inside dark, darker low down, the pool under the hatch several times brighter; the turret's lights turning with it in the shader's uniforms; the lamps warm, the daylight cool.
- `test/driver-station.test.ts`: the instrument box in front, in front of the glacis and under the slit, clear of the tillers' fists, facing the eyes, the dials and the gear plate apart; the slit's field from the seat and leant in.
- `test/cabin.test.ts`: the fade's curve, black well before a head counts as a recentre. `test/turret.test.ts`: the crank's and the elevation wheel's fists inside the turret ring all the way round.
- `test/periscope.test.ts`, `test/turret.test.ts`, `test/sight.test.ts`, `test/cabin.test.ts`, `test/body-height.test.ts`: the moved controls in reach, clear of each other and of the head, inside the new front.
- `test/z-fighting.test.ts`: the new front, the details, the lamps and the instrument box, the turret at every tested angle.
- `npm run test:xr`: every seat, station and sight step, on the new layout; a lean past the head box fades the view with the seat left where it was, leaning back clears it, standing up fades it under the roof. Screenshots `artifacts/xr-driver-seat.png` and `artifacts/xr-gunner-seat.png` show the lighting.

- `test/interior.test.ts` (third pass): a shut hatch takes its pool and its share of the ambient away and leaves the other's; the cabin light scales the ambient and the lamps only their pools; the shader's uniforms follow and go back; each hatch's open lid shown and its shut one ready; the turret's foot closed at every angle. `test/z-fighting.test.ts`: the shut lids in their holes, the turret at four angles.

`window.__interior` gives `state()` (now with the look and which lids are drawn open), `setLighting(on)` (to compare with the sky's light everywhere, as before) and `light(point, normal)`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Steps 1 to 4 are for the third pass; the second pass's follow.

1. Practice → Sit in → Gunner, and turn the turret a little either way with the crank. Look down into the turret's front-left and rear-right corners: a floor at the foot of the walls, no ground showing through.
2. Settings → Sound and view → **Open hatches**: try Both, Driver's, Gunner's and None. A shut hatch has its lid down and the pool of daylight under it goes; with None the cabin is darkest. Do it in both seats.
3. **Cabin light** (Darker, Normal, Lighter, Bright) and **Dome lamps** (Off, Dim, Normal, Bright): try them with the hatches open and shut. Say which mix looks best; it can become the default.
4. Perf HUD (X): the fps in the gunner's seat with the hatches open and shut.

The second pass's:

1. Enter VR in the driver's seat (Practice → Sit in → Driver). **Lighting**: away from the hatch the inside is dark, the daylight falls in a pool under your open hatch, and the dome lamp glows warm in the roof. Say whether it is now too dark to find the controls, or still too bright.
2. Lean forward into the slit until your head goes past it: the view fades to black instead of being pushed back. Sit back: it clears and your seat is where it was. Stand up: it fades under the roof. Say whether the fade is easier to test with than the push.
3. Hands on both tillers, push them fully forwards and pull them fully back without leaning. Say whether the handles are at a comfortable height now.
4. Glance down at the instrument box between the tillers. Say whether the gauges read easily and whether your hands brush it on the tillers.
5. Practice → Sit in → Gunner. Wind the traverse crank and the elevation wheel all the way round: nothing catches on the turret ring. Say whether the controls are now at an easy height seated.
6. Look up at the turret roof: rounded edges and corners, the round hatch with its collar, the ventilator and the rib. Say whether it reads as a tank's turret.
7. Perf HUD (X): report the fps in both seats (85 in the gunner's seat and 90 in the driver's before).
