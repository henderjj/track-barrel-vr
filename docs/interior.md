# A Sherman's interior

John's play-test note (2026-10-28): the gap between what you look through and the controls you hold is too big, and the inside should look and be lit more like a tank's. This reworks the driver's and the gunner's stations from the M4A4's layout and gives the cabin interior lighting. The numbers live in [`src/sim/cabin.ts`](../src/sim/cabin.ts) (the front, the seats), [`src/sim/driver-station.ts`](../src/sim/driver-station.ts), [`src/sim/periscope.ts`](../src/sim/periscope.ts), [`src/sim/turret.ts`](../src/sim/turret.ts) and, for the lighting, [`src/sim/interior.ts`](../src/sim/interior.ts).

## Where the layout comes from

The Medium Tank M4A4 manual, TM 9-754, has the two pictures John uploaded:

- **Figure 9, the driver's control group**: two steering levers standing up from the floor in front of the driver, the gear shift lever on the transmission to their right, the throttle control and the instrument box on their left, and the assistant driver's seat across the transmission. The driver looks out through the hood in the glacis, a hand's length from the face, with the hands on the levers.
- **Figure 13, the 75 mm gunner's controls**: the elevating hand wheel and the traverse hand wheel side by side directly under the gun's sight, the power traverse's switch box between them, the firing switches by the gunner's feet.

So a crewman's eyes and hands work together: the vision device is a short lean from the seat, and the controls are where the hands rest with the eyes at it. We had the driver's slit 80 cm ahead of the eyes (a 60 cm lean that left the tillers behind them) and the gunsight 28 cm ahead with the wheels 47 to 51 cm under the eyes. The dimensions below are taken from those pictures and a seated adult's proportions (shoulders about 20 cm under the eyes, a forearm about 35 cm), not from measured drawings.

## What players experience

- **The driver** sits under a sloped glacis, as in a Sherman: the front plate stands up from the floor to knee height, slopes back over the driver's legs at 57° from upright, and meets the hood's upright face, which holds the vision slit 30 cm ahead of the eyes. From the seat the slit shows about 60° of the world (24° before), so the driver can steer with both hands on the tillers and their eyes on the road; leaning 10 cm in to the brow pad opens it to 80°.
- The tillers' tops are 6 cm higher than spike S3's rig (49 cm under the eyes), a forearm ahead of a driver leant in to the slit.
- **The instrument box** is on the left wall beside the driver's knee, as the M4A4's is, turned and tilted to face the eyes, half a metre away: speed, engine and water on the top row, oil and fuel under them with the gear lever's plate. The hand throttle stands under it.
- **The periscope** is now right of the slit, its window 15 cm ahead of the eyes and 26 cm to the right: a lean right to look in, the yoke under it at chest height. Its head stands on the roof ahead of the driver's hatch, which now opens forwards so the turret's overhang can't sweep into its lid.
- **The gunner**'s sight is an 18 cm lean (28 cm before), and the elevation wheel, the traverse crank and the power grip sit 7 to 8 cm higher: with the eye at the eyepiece, the wheels' hubs are 40 cm under it and a forearm ahead, so both hands stay on them while aiming, as in figure 13.
- **The front compartment** has what a Sherman's has round the driver: the final drive's ribbed housing in the nose between the seats, the assistant driver's seat and the bow machine gun's ball in the glacis in front of it, two red fire extinguishers on the right, six 75 mm rounds in a rack on the left sponson behind the driver, and cable conduits along both walls. The turret's bustle has the radio set on its shelf.
- **Lighting**: the inside is dim, with daylight falling in through the open hatches and a little through the slit, and a warm dome lamp glowing in the hull roof and in the turret's. The turret's daylight and lamp turn with it. Low down in the hull it is darkest. The outside of the tank and the world are lit as before. The plates stay ivory inside, as the real crew compartments were painted, so the dim inside still reads.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Nose plate | upright from the floor to 1.0 m at z −2.4 | The final drive's housing and the driver's feet fit behind it |
| Glacis | from 1.0 m at z −2.4 to 1.32 m at z −1.9, 57° from upright | The Sherman's is 56°; above the tillers and the driver's knees |
| Hood face | upright at z −1.9 from 1.32 m to the roof | The slit 30 cm ahead of the eyes |
| Vision slit | as before (34 × 10 cm at 1.45 m), in the hood face | About 60° across from the seat, 80° leant in |
| Driver's head box forward | 10 cm (60 cm before) | Stops the eyes 20 cm from the slit, the brow 5 cm short of its pad |
| Tiller pivots | 94 cm under the eyes (1 m before) | Tops 49 cm under the eyes |
| Hand throttle pivot | 0.66 m (0.8 m before) | Under the instrument box with a fist's room |
| Instrument box | face's middle (−0.98, 1.19, −1.66), 40 × 24 cm, facing the eyes 55 cm away | The M4A4's on the left; the slit and the periscope keep the front clear |
| Periscope axis | 26 cm right of the eyes, 20 cm ahead (22 cm left, 37 cm ahead before) | Behind the hood face; its handles swing beside the chest when turned |
| Driver's hatch | 50 cm square, from 10 cm ahead of the eyes to 40 cm behind them; lid open forwards | The periscope's head stands on the roof in front of it |
| Gunsight eyepiece | turret (0.32, 2.25, −0.38), an 18 cm lean | The head stops 4 cm short of it |
| Gunner's head box forward | 14 cm (24 cm before) | |
| Elevation wheel, crank, power grip | turret (0.29, 1.85, −0.6), (0.58, 1.81, −0.59), (0.71, 1.58, −0.45) | 7 to 8 cm higher and 3 to 4 cm further forward |
| Interior ambient | 26% of the sky's light, a little warm, 65% of that on the hull floor | Dim, as a closed steel box is |
| Hatch daylight | 0.9 of daylight from 45 cm above each open hatch, falling mostly straight down (the cosine from straight down to the 6th power), half as bright 1.4 m away | A pool under each hatch, not a glow all round it |
| Slit daylight | 0.12 of daylight from just inside the slit, half as bright 30 cm away | Lights the hood's inside face a little |
| Dome lamps | warm, 0.28, half as bright 0.6 m away; hull roof over the transmission, turret roof behind the gun | Glowing lenses, no real-time light |

## How the lighting works

There are still no real-time lights (the building skill's budget allows one, and shadows are off). Every model inside the tank uses `MeshStandardMaterial` lit by the sky's image-based light; `litInside` ([`src/scene-assets/cabin-light.ts`](../src/scene-assets/cabin-light.ts)) patches those materials' shaders so that wherever a surface is inside the hull or the turret, the sky's light on it is multiplied by the interior's: the dim ambient plus a pool from each of five lights (two hatches, the slit, two lamps), each falling off with distance and wrapping a little round faces turned away. It is a few multiplies a pixel. Positions are world space, which is hull space because the tank stays at the origin. `CabinLightSystem` turns the turret's lights and its inside with the turret. The same sum is `interiorLight` in `src/sim/interior.ts`, which the tests check. The lamps' lenses are a small unlit mesh in the hull and one in the turret (two draw calls).

What it lights: the cabin, the driver's and gunner's controls, the periscope, the sight, the loading parts, the run clocks, both crew's hands and the crewmate's avatar. The terrain and the riding spike's blockout are not patched. The dial faces, the boards and the needles are unlit as before, so they read clearly in the dim cabin, like illuminated instruments.

## Sharing

Nothing new goes over the network: the layout is the same numbers on both pages, and each page lights its own cabin from the turret angle it draws.

## Departures and what to watch

- **The instrument box moved to the left** because the periscope needs the space right of the slit and the gauges had to come out from under it. Readability from 55 cm, at the edge of the forward view, is a headset question.
- **The periscope's yoke turned sideways** brings a handle within 8 cm of the eyes' plane (beside the right shoulder, 26 cm out); before it stayed 18 cm ahead. The unit test now asks for 7 cm. Check it doesn't knock the chest when turned.
- **The S3 lever-test rig** (Practice → Lever test) still stands where it did, in front of the station's tillers.
- **The run clock** in the driver's seat moved to the left of the slit (the periscope covers the right).

## Tests

- `test/interior.test.ts`: the glacis's slope and the hood; the slit 30 cm ahead and the tillers a forearm ahead of a driver leant in to it at every angle; the gunner's wheels 35 to 45 cm under an eye at the eyepiece; outside the tank unlit, the armour's outer faces outside however the turret turns; the inside dim, darker low down, bright under the hatch; the turret's lights turning with it in the shader's uniforms; the lamps warm, the daylight cool.
- `test/driver-station.test.ts`: the instrument box inside the armour, clear of the head and over the throttle, facing the eyes, the dials and the gear plate apart; the slit's field from the seat and leant in.
- `test/periscope.test.ts`, `test/turret.test.ts`, `test/sight.test.ts`, `test/cabin.test.ts`, `test/body-height.test.ts`: the moved controls in reach, clear of each other and of the head, inside the new front.
- `test/z-fighting.test.ts`: the new front, the details, the lamps and the instrument box, the turret at every tested angle.
- `npm run test:xr`: every seat, station and sight step, on the new layout. Screenshots `artifacts/xr-driver-seat.png` and `artifacts/xr-gunner-seat.png` show the lighting.

`window.__interior` gives `state()`, `setLighting(on)` (to compare with the sky's light everywhere, as before) and `light(point, normal)`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated.

1. Enter VR in the driver's seat (Practice → Sit in → Driver). Look round: the glacis slopes over your legs to the hood in front of your face with the slit in it, the assistant driver's seat and the bow gun to your right across the ribbed transmission housing, the fire extinguishers and the sponson rounds. Say whether it reads as a tank's inside and whether anything flickers.
2. **Lighting**: the inside is dim, the hatch above you lets daylight in, and the dome lamp glows warm in the roof. Say whether it is too dark to read the gauges or find the controls, or too bright to feel like inside a tank.
3. Put your hands on both tillers and look through the slit without leaning. Then lean in to the brow pad. Say whether you could drive like that, hands on the tillers, eyes on the road.
4. Glance left at the instrument box. Say whether the speed, the engine revs and the gear plate read without leaning.
5. Lean right into the periscope and turn its yoke all the way round with both hands. Say whether the handles knock your chest or the tillers.
6. Practice → Sit in → Gunner. Lean into the sight with your hands on the elevation wheel and the crank: say whether you can aim, both hands on, without stretching or crouching. Traverse with the power grip: the turret's lamp and the daylight from your hatch turn with you.
7. Perf HUD (X): the frame rate holds 72 Hz (90 Hz if you can) in both seats; report the fps and the frame time.
