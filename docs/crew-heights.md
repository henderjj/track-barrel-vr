# Real Sherman heights

John's play-test note (2026-11-08) asked for realistic leg, torso and neck lengths, for every crewman to see through the slit, the periscopes and the sights, and for the heights to be checked against a real tank. The periscopes' 30° tilt was also too steep to look into comfortably. The tank turned out to be about 25% too tall, with the crew stretched to fill it. John chose "real heights, comfy loading" from three options (findings: [Crew sizes vs a real Sherman](https://claude.ai/artifact/XQVG56DRh7hba7JYPpfYAT)). The numbers live in [`src/sim/cabin.ts`](../src/sim/cabin.ts), [`src/sim/body-height.ts`](../src/sim/body-height.ts), [`src/sim/periscope.ts`](../src/sim/periscope.ts) and [`src/sim/seated-body.ts`](../src/sim/seated-body.ts).

## Where the numbers come from

| What | Real value | Source |
| --- | --- | --- |
| Height over the turret hatch | 107.5 in (2.73 m) | [TM 9-754](https://archive.org/details/TM9-754) (Medium Tank M4A4), par. 4 |
| Ground clearance | 17⅛ in (0.435 m) at the front | TM 9-754, par. 4 |
| Line of fire (the gun's axis) above the ground | 88 in (2.24 m) | [AFV Database](https://afvdatabase.com/usa/m4sherman.html) |
| Turret ring | 69 in (1.75 m) inside | AFV Database |
| Seat-to-roof headroom | 86 to 97 cm for a seated crewman; the Sherman met the 90 cm standard | Fort Knox crew study, via [Tank Archives](https://www.tankarchives.com/2017/03/american-ergonomics.html) |
| A seated 1.75 m adult | eyes 79 cm over the seat, shoulders 60 cm, hip joint about 9 cm; hip to knee 44 cm; comfortable seat 44 to 48 cm | Standard seated body sizes (approximate) |
| Driver's vision | a direct-vision slit ahead of the eyes and an M6 periscope in the hatch | TM 9-754, par. 124 |
| Head-out driving | "raise seat to convoy position" with the hatch open; "lower seat, close hatch, raise periscope" for battle | [FM 17-67](https://archive.org/details/FM_17_67_A_C_D_S_P_M_T_M4_1944) (1944 crew drill) |

No measured drawing of the interior turned up, so the hull floor (about 0.46 m up), the hull roof (about 1.9 m) and the turret roof's underside (about 2.62 m) are worked out from the outside numbers and the headroom. A real driver's eyes were then about 1.27 m over the hull floor and 15 to 20 cm under the roof; a real gunner's eye was about level with the gun.

## What changed

Everything is measured from the eyes, because the game puts each player's eyes on the seat's eye point whatever their real height. Every control keeps its place relative to the eyes: the tillers, gear lever, hand throttle, parking brake, instrument box, gunsight, elevation wheel, traverse crank, power grip, breech, ready rack, firing lamp, turret dial and run clocks.

| From the eyes | Before | Now | Real Sherman |
| --- | --- | --- | --- |
| Driver: roof | +35 cm | +24 cm | about +15 to +20 cm |
| Driver: seat cushion | −90 cm | −79 cm | −79 cm |
| Driver: floor | −145 cm | −127 cm | about −127 cm |
| Driver: ground | −205 cm | −173 cm | about −173 cm |
| Gunner: turret roof | +50 cm | +35 cm | about +35 cm |
| Gunner: gun's axis | −20 cm | −20 cm | about −3 cm |
| Gunner: seat cushion | −90 cm | −79 cm | −79 cm |
| Gunner: ground | −285 cm | −244 cm | about −227 cm |
| Turret top over the ground | 3.43 m | 2.87 m | 2.73 m |
| Gun over the ground | 2.65 m | 2.24 m | 2.24 m |

- **Seats.** `SEATED_EYE` is 1.27 m (1.45 before) and the cushion 48 cm (55 before). A player in a chair at home has their eyes about 1.2 m up, so their real floor now lines up with the tank's within a few centimetres.
- **The hull.** The ground is 46 cm under the hull floor (60 before), and the roof 1.51 m over it (1.8 m before). The glacis, hood and bow gun come down with the driver's eyes, the cable conduits with the roof.
- **The turret.** The gun's axis is at 1.78 m in hull space, a Sherman's 2.24 m over the ground. The basket floor is 0.71 m (0.8 before), so the gunner's eyes stay 20 cm over the gun's axis, and the turret roof is 35 cm over them (2.33 m, 2.75 before).
- **The one departure: the gun.** A real gunner's eye was about level with the gun, but a real gunner had a loader. Ours loads, so the gun stays 20 cm under the eyes to keep the breech at chest height. The turret is about 14 cm taller than a real one for it.
- **The driver's roof** is 24 cm over the eyes, 4 to 9 cm more than a real Sherman's: the periscope's crank and the fist on it need that much room over the slit's view. It still leaves the eyes 15 cm to rise before the view fades (26 before).
- **Eye height** in the menu now goes from −15 cm to +5 cm (±15 before). Under the lower roof a raise of more than 5 cm would leave no room to sit up to the periscope. A saved raise above +5 cm reads as +5.
- **The periscopes.** Each eyepiece is tipped 15° towards the seat (30° before). The driver's window is 9 cm over the eyes and 13.5 cm ahead, and the eyes look in from about 7 cm up (7 before, at 30°). The gunner's window is 12.5 cm over the eyes, just over the gunsight's hood; looking in, the eyes are 11 cm up. The gunner's could not come lower, as its eyepiece must clear the sight's hood.
- **The avatar.** The neck's base is 16 cm under the eyes (20 before) and the shoulders 20 cm (27 before), as a seated adult's. The torso is 56 cm from the hip point to the neck's base (62 before), so it sits on the cushion without stretching. Thighs stay 44 cm; the shins follow the lower seat.
- **The gunner's callout card** is lower and a little smaller (51 × 34 cm, 54 × 36 before) to fit under the lower roof's chamfer; it reads the same size from the seat. The loading board and the gunner's run clock moved down 11 cm with it.

## Sharing

Nothing new is sent. Poses already go in hull space, and both pages build the same tank from the same numbers. A page on the old build would draw its crewmate 18 to 27 cm off, so both players need the new build (Ctrl+Shift+R).

## Tests

- `test/cabin.test.ts`: head room under each roof (a hand's width over the driver's head, more over the gunner's), and room to raise the eyes as far as the menu allows and sit up a little more.
- `test/body-height.test.ts`, `test/game-flow.test.ts`: the raise stops at +5 cm and −15 cm, from the menu and the URL.
- `test/periscope.test.ts`: each window's tilt between 12° and 17°, the eyes meeting it within a short sit-up, the slit's view clear of the eyepiece and the crank, and the crank and fist under the roof.
- `test/seated-body.test.ts`: the torso reaches from the hips to the neck's base at rest without stretching, in both seats.
- `test/callout-card.test.ts`, `test/interior.test.ts`, `test/z-fighting.test.ts`: the card under the chamfer, the head boxes measured from the new meshes, and no flicker anywhere in the new cabin.
- `npm run test:xr` and `npm run test:net` exercise every station at the new heights.

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated on a normal chair. Set **You → Eye height** back to 0 if you changed it.

1. **Driver.** Practice → Drive. The roof should feel close over your head without touching it. Look out of the slit: the road should look nearer than before, with the ground about where a car's would be from a high seat. Sit up straight: the view should fade only when your head is clearly higher than seated.
2. **Driver's periscope.** Sit up a little and lean in under the window. It should take about a 7 cm rise and a short lean, and the angle should feel like looking straight ahead, not up. Sit back and check the slit's view is clear of the eyepiece.
3. **Controls.** The tillers, gear lever, throttle and brake should be exactly where your hands remember them.
4. **Gunner.** Practice → Lay the gun. The gunsight and wheels are where they were. Sit up into the gunner's periscope: about an 11 cm rise, a gentler angle than before. Load a shell: the breech is at chest height as before.
5. **Crewmate.** With the practice crewmate on a PC page (`?bot=1`), look back at it from the driver's seat. It should sit on its cushion like a seated person, its shoulders a hand's width under its chin and its torso not stretched, with its feet on the floor.
6. **Outside.** Practice → the range, look around from the gunner's periscope: the tank should look shorter and wider than before.
7. Report the perf HUD's frame time in each seat.
