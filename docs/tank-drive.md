# Tank drive (F1.4)

The tank moves. The host simulates its drive (skid steering, the engine's RPM, two gear ranges with grinds, the hull following the ground, soft stops at obstacles) and both players see the world move round the tank, which stays still at the origin (plan decision 4, proven comfortable enough to build on in spike S2). The numbers live in [`src/sim/tank-drive.ts`](../src/sim/tank-drive.ts), the comfort caps in [`src/sim/comfort.ts`](../src/sim/comfort.ts) and the ground in [`src/sim/terrain.ts`](../src/sim/terrain.ts).

## What players experience

- Whoever sits in the **driver's seat** drives, with the driver's station's tillers, gear lever and hand throttle since F1.5 ([driver-station.md](driver-station.md)). While no hand is on a tiller the **thumbsticks** still drive: each stick's forward push drives its own track, as a tiller does. Both forwards drive straight, one forwards turns the other way, one forwards and one back pivots on the spot, both back reverses. On a PC page without a headset, **W A S D** (or the arrow keys) drive and **0, 1, 2** move the gear lever.
- The **gear lever** is the station's (F1.5); the game menu's Driving section (Neutral, Low, High) moves it too. Low reaches 12 km/h, high 35 km/h. Moving the lever with either tiller more than 20% from centre **grinds**: the gearbox drops out of gear, nothing engages and a sign says "Gears grinding: centre both tillers to change gear". With the tillers centred the new gear engages after a third of a second.
- The engine's **RPM** rises with how far the tillers are pushed, with a lag; the tank pulls gently at idle and harder as it revs, never faster than the comfort cap. RPM, speed and gear show in the Driving section's line and, since F1.5, on the driver's gauges.
- The **ground** rolls gently, with a flat start field and flat corridors for the test range's two roads (F1.7, [range.md](range.md)): one straight ahead through the start, one across it. The hull pitches and rolls with the ground under its tracks, eased and never more than 4°.
- **Rocks, walls and houses** stand on the ground; a boulder, a wall and a house are within 110 m of the start, beside the lane. Driving at one, the tank slows into a firm, soft stop as it reaches it rather than stopping dead; it can always back or turn away. Passing close beside one slows it only as much as the corner needs.
- The **comfort vignette** (spike S2's) darkens the edge of view as the tank turns, speeds up, slows or tilts, on by default; the menu's Comfort and stats section sets how dark it gets, or turns it off (F1.14, [comfort-stats.md](comfort-stats.md)).
- The **gunner** rides along; their seat (and, from F1.8, the turret) moves with the hull.
- With nobody in the driver's seat (solo as gunner, or the crewmate's seat empty), the tillers count as let go and the tank rolls to a stop and waits. While the crew is on hold (the crewmate stepped away, went quiet, is reconnecting or left), the tank rolls to a stop too, and the hold's sign says why.
- Game menu: **Practice → Drive the tank → Drive** puts the player in the driver's seat with a sign saying how to drive; **Back to start** parks the tank where it began, with the range's three targets back at 100, 250 and 500 m. (Until F1.7 the gunsight's target boards stood in hull space and rode along with the tank, so the drive system showed them only at the start; the range's targets stand in the world instead.)

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Top speed | Low 12 km/h, high 35 km/h; reverse 11 km/h | Plan §4.3; the S2 caps |
| Acceleration and braking | at most 1 m/s²; 35% of that at idle RPM, all of it at top RPM | The concept's gentle acceleration; RPM lag felt as pull |
| Turn rate | at most 15°/s, changing by at most 20°/s² | The S2 caps |
| Pitch and roll | at most 4°, eased over 0.5 s; height eased over 0.1 s | The S2 caps |
| Track gauge | 3.0 m | The cabin model's tracks |
| RPM | 800 idle (1600 with the hand throttle full), 2600 top, follows demand over 0.6 s | A Tiger-like Maybach range |
| Grind | either tiller more than 20% from centre while the lever moves | Plan §4.3 |
| Shift time | 0.35 s in the new gear with the tillers centred | Long enough to feel, short enough not to annoy |
| Obstacle stop | no part of the outline closes on an obstacle faster than it could stop in the gap at 3 m/s² | A soft bump, not a jolt; 35 km/h stops over about 16 m |
| Outline | 3.6 × 5.6 m (the tracks' outer faces and ends), tested at 32 points | The cabin model; the gun overhangs it (F1.8) |
| Ground | repeats every 800 m, height field sampled every 16 m, waves up to about 2 m peak to peak, flat within about 18 m of the start and 16 m either side of each road's middle | The drawn edge is always 800 m or more away, on the horizon (and the range's fog hides it, F1.7); the targets stand on the road up the range |
| Obstacles | 61 per tile: 41 rocks (0.8 to 2.2 m), 11 walls, 9 houses | Enough to bump into within a minute of the start |
| Ground model | three tiles across, about 74k triangles with the range's roads, targets and markers (63k before F1.7), in 36 meshes of 400 m square; the small stones and bushes only in the middle tile and 150 m round it | Inside the 300k budget with the cabin; the renderer skips the squares out of view or beyond the 1.2 km far plane, about two thirds of them. The network test hides it (`?ground=0`): software rendering pays about 2.7 ms a frame per thousand triangles drawn, which halved the frame rate its motion checks sample |

## Sharing

The host runs the tank, whichever seat it sits in (plan decision 1).

- **Tank state** (`PacketType.TankState` = 5), host → guest, unreliable, 45 Hz, 47 bytes (53 since F1.5, with the coolant, the fuel and the controls the host drove by; the 47-byte form still decodes): position (float32), heading, pitch, roll, speed, acceleration, turn and tilt rates, both tracks' speeds, RPM, gear, grinding and touching flags, bump count and odometer. The guest keeps the last 16 in a jitter buffer (`src/net/tank-buffer.ts`) and draws the tank as it was a little in the past (the same delay rule as the crewmate's avatar), carrying it on for up to 150 ms if a packet is late.
- **Driver controls** (`PacketType.DriverControls` = 6), guest driver → host, unreliable, 45 Hz, 11 bytes: both tillers, the gear lever and the hand throttle. Controls older than 0.5 s count as let go.
- **`drive-reset`**, reliable event, guest → host: Back to start, from a guest's menu. **`drive-place`** (F1.7) is the same for a Practice shortcut that parks the tank somewhere on the range.
- Everything aboard (heads, hands, the crewmate's legs) already goes in hull space, so the tank's motion never makes the crewmate judder against the cabin, whatever the delay on the tank itself.
- A guest driver's tillers reach the host about half a round trip later and the tank's motion comes back about half a round trip plus the buffer later: about 250 ms at 150 ms RTT. A heavy tank accelerating at 1 m/s² hides it; the headset check asks.
- When the host leaves, the guest becomes host and carries on from the tank as it drew it.

## The practice crewmate

Not yet: the crewmate learns to drive in F1.13. Until then, a player alone in the gunner's seat sits in a parked tank, and a player alone drives from the driver's seat with the crewmate riding as gunner.

## Tests

- `test/tank-drive.test.ts`: straight, reverse, turning and pivoting within the caps, RPM lag and pull, top speeds, shifting and grinding, rolling to a stop, ground following within the tilt cap, soft stops at a rock and a wall with no deceleration over 3 m/s² and no overlap, backing away, passing beside one, a clear lane, drawing between states.
- `test/terrain.test.ts`: the ground repeating, flat where it should be, the drawn triangles matching the heights, obstacle distances, obstacles off the start and the lane.
- `test/tank-net.test.ts`: both packets round-trip, the jitter buffer interpolates, drops reordered states and carries on past the newest.
- `test/z-fighting.test.ts`: the ground with its obstacles under the parked hull, and S1's targets on it.
- `npm run test:xr` (step 6d): Practice → Drive, both sticks forwards drive and the ground moves round the hull, the vignette darkens, one stick turns, the lever grinds and then shifts, an obstacle stops the tank without overlap, Back to start. Screenshot: `artifacts/xr-drive.png`.
- `npm run test:net` (`ONLY_DRIVE=1`, or `=lag`, for just this): the guest in the driver's seat drives the host's tank and both see it move and stop the same, on a clean link and at 150 ms RTT; the host driving, the guest sees it.

`window.__drive` gives `state()`, `controls()`, `driver()`, `set(controls)`, `reset()`, `place(x, z, heading)`, `drawnAt(x, y, z)`, `vignetteAlpha`, `bumps`, `crewBumps`, `sightRangeShown`, `sign`, `sent`, `received` and `lateFrames`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated (menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Drive the tank → Drive**. You are in the driver's seat and a sign says how to drive.
2. Push **both sticks forwards**. The tank pulls away gently and the ground slides past the slit and the open hatch. The edge of your view darkens a little as it speeds up. Let go: it rolls to a stop.
3. Push **one stick** forwards: the tank turns the other way. One forwards and one back: it pivots on the spot. Both back: it reverses.
4. Menu → Driving: the line shows your speed, gear and RPM. Pick **High**, close the menu and drive: it reaches about 35 km/h on the lane. Note whether the speed feels right through the slit and over the hatch.
5. While driving, pick **Low** in the menu with a stick still pushed: the sign says the gears grind and the tank slows. Let go of the sticks: the gear goes in.
6. Drive off the lane onto the rolling ground: the hull tilts gently with it, never sharply. Note whether the tilt is comfortable.
7. Drive into the boulder ahead on the left of the lane (about 45 m out), then the wall to the right (70 m) or the house (110 m, left). The tank slows into a stop as it reaches each, without a jolt, and backs away. Note whether the stop feels like a bump or like the tank braking by itself.
8. Turn the **vignette off** in the Comfort and stats section and drive for a few minutes; note how it compares.
9. With a second headset (or `?bot=1` on a PC page for the crewmate in the gunner's seat), drive as the guest: both of you see the tank move the same, and your sticks feel responsive enough. Then swap seats from the menu and ride as gunner while the other drives.
10. Press **X** for the perf HUD while driving on the rolling ground: report the frame time and draw calls it shows.
