# Turret position dial (F2.3)

A round dial on the hood's face just right of the driver's vision slit shows which way the gun points: the hull drawn from above, nose up, with an orange pointer shaped like the turret and its gun turning over it as the turret turns. The driver can tell at a glance whether the barrel is over the side before turning near a wall or a house, and can read the crew's clock directions ("traverse to 3 o'clock") straight off it. A Sherman's driver had no such dial (the gunner had an azimuth indicator); like the gear indicator it is a game's aid. The numbers live in [`src/sim/turret-dial.ts`](../src/sim/turret-dial.ts); the case is in [`src/scene-assets/turret-dial.scene-asset.ts`](../src/scene-assets/turret-dial.scene-asset.ts), merged into the hull's mesh; [`src/systems/turret-dial-system.ts`](../src/systems/turret-dial-system.ts) paints the face and turns the pointer.

## What players experience

- **The dial.** From the driver's seat it sits at eye height just right of the slit's steel frame, as the run clock sits on its left ([range-run.md](range-run.md)). Its cream face, 10 cm across, has the hull from above in olive, nose up, with its tracks either side and the driver's hood a dark patch at the front left, so it is clear which end is the front and which side the driver sits. Round the rim are a tick for every hour and the 12, 3, 6 and 9. Over the hull, the orange pointer: a disc the turret's size on the ring and its gun out towards the numbers.
- **It follows the turret.** Whichever way the gunner turns the turret, the pointer turns with it on the driver's dial: turret to the right, pointer to 3; turned round to the rear, pointer to 6. It reads the gun's direction relative to the hull, so it stands still while the whole tank turns with the turret fixed.
- **Practice → Lay the gun → To 3 o'clock.** Alone, it puts the player in the driver's seat and the turret turns itself to 3 o'clock at the power traverse's top rate, as if the gunner traversed, while a sign says "Turret to 3 o'clock: watch the dial right of the slit". In a crew it leaves the seats as they are and the gunner's page turns the turret (the other page asks it); the gunner's hand on the power grip or the crank stops the turn at once. **Forward** turns it back to 12.

## Numbers

Hull space, as in [cabin.md](cabin.md); the driver's eye point is (−0.5, 1.27, −1.6).

| What | Value | Why |
| --- | --- | --- |
| Face | 10 cm across, its middle at (−0.22, 1.27, −1.884): 28 cm right of the slit's middle, at the eyes' height | About 40 cm from the eyes and 45° off square: over 10° across, so the 12/3/6/9 read at a glance (a gauge on the instrument box is about 5.5°). Clear of the slit's frame (1.5 cm), under the brow pad, mirrors the run clock |
| Case | a drum 11.2 cm across, 1.2 cm proud of the hood's inner face and sunk 5 mm into it; the face 4 mm in front of it, the pointer 4 mm in front of the face | Flat on the hood, as the run clock is: anything there at eye height must stand under 2 cm proud, or a head leaning into the slit meets it before the hood's fade starts (`EYE_CLEARANCE`, [interior.md](interior.md)). The gaps are the 3 mm rule ([testing.md](testing.md#z-fighting)) |
| Hull drawing | the hull and its tracks shrunk about the turret ring's middle (the face's middle), its furthest end 55% of the face's radius out | The pointer turns where the turret does; the numbers (at 71%) and ticks (from 80%) stay clear |
| Pointer | the turret as a disc to the drawing's scale, the gun a 4.5 mm bar out to 60% of the radius with a wider muzzle, the gauges' needles' orange | Points at the hour it reads without covering its number |
| Hours | 12 straight ahead, 3 right, 6 behind, 9 left, to the nearest hour (`clockHour`) | The crew's callouts (F2.6) and the crewmate's calls use the same clock |
| Practice turn | the power traverse's top rate (24°/s, `MAX_TRAVERSE`) and its comfort-capped acceleration (40°/s²), slowing to stop on the hour: 90° takes about 4.4 s | Quick enough for a headset check, no faster than the gunner can turn it |

The face is a canvas painted once, unlit like the gauges so it reads in the dim hull; the pointer is one small mesh. Three draw calls in all (case merged into the hull, face, pointer); nothing new is lit.

## Sharing

Nothing new goes over the network: both pages already draw the turret as the gunner's page lays it (`PacketType.TurretState` = 7, [turret.md](turret.md)), and the dial reads that (`turretState()`). On the driver's page the pointer follows the gunner's turret a little in the past, as the turret itself is drawn.

The Practice shortcut turns the turret on the page that owns it (the gunner's, or this one alone). From the other page it asks with the existing `turret-forward` event carrying the angle (`yaw`); an older build ignores the angle and turns the turret forward.

## The practice crewmate

Nothing to learn: the dial only shows. As gunner on another page the crewmate's turret shows on the driver's dial like anyone's.

## Departures from the building skill

- **No new HoldKind or packet**: the dial is not a control (plan: no Phase 2 control is gripped).
- **Not lit by the battery.** A real turret indicator would need power; the dial reads whatever the engine's state, so it never looks broken while the tank is cold.

## Tests

- `test/turret-dial.test.ts`: the clock hours both ways; the pointer turning the way the barrel points over a nose-up hull; the hull, pointer and numbers fitting the face; the dial right of the slit's frame, under the brow pad, at eye height, 30 to 50 cm from the eyes and squarer to them than the run clock; the case sunk into the armour and under 2 cm proud, out of a leaning head's way; the Practice turn never faster than the power traverse, stopping on 3 o'clock in about 4.4 s, and going the short way round across 180°.
- `test/interior.test.ts` (unchanged): the eyes keep `EYE_CLEARANCE` from every cabin mesh along the head box's edges, the dial's case now among them.
- `test/z-fighting.test.ts`: the dial's case on the hull with its face and pointer turned five ways.
- `npm run test:xr`, step 6n (part 3): Practice → Lay the gun → To 3 o'clock seats the player as driver and the turret turns by itself with the pointer on it; it stops at 3 o'clock and the dial reads 3; Forward brings both back to 12. Screenshot: `artifacts/xr-turret-dial.png`.
- `npm run test:net` (`ONLY_TURRET=1`): the driver's To 3 o'clock asks the gunner's page, which turns the turret there, and the driver's dial reads 3 o'clock.

`window.__turretDial` gives `state()` (the turret's angle, the pointer's as drawn, the hour it reads, whether the Practice turn is running), `toHour(hour)`, and the face's place (`at`, `facing`).

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated.

1. Enter VR alone. Game menu (Y) → **Practice → Lay the gun → To 3 o'clock**. You are in the driver's seat with a sign saying to watch the dial.
2. Look right of the vision slit: the round dial shows the hull from above, nose up, and the orange turret and gun turning from 12 round to 3, stopping there. Nothing on it flickers.
3. Say whether you can read which way the gun points with a glance from the slit, without turning your head, and whether the numbers are readable from the seat.
4. Lean into the slit as you would to drive: the dial should not get in the way of your head.
5. Menu → **Forward**: the pointer swings back to 12.
6. With a second headset (or `?bot=1` on a PC page as the gunner), sit as driver while the gunner traverses with the power grip: the pointer follows their turret.

Report: whether the dial was readable at a glance, whether its place right of the slit works or it should move (nearer the slit, lower, bigger), and whether the hull drawing makes the front obvious.
