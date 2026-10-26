# Spike S2: riding the tank

**Question** (plan §5): with the tank kept still at the origin and the world moved round it, and the gunner's play space turning with the turret, is riding comfortable for 10 minutes?

**Pass mark:** no discomfort at the default caps from two testers, with and without the vignette.

**Status:** built; waiting on the headset check below. Roadmap F0.4.

## What was built

A throwaway ride, reached from the game menu's Practice section, so the comfort question can be answered before the real cabin (F1.1), driving (F1.4) and turret (F1.8) are built on the same approach.

- **The tank stays at the origin and the world moves** by the inverse of the tank's pose (plan decision 4). The hull is the driver's frame; the ground, rocks, bushes and trees move round it. The ground repeats every 240 m and is drawn three tiles across, moved by the tank's position less whole tiles, so a ride of any length never reaches an edge; fog from 60 m to 230 m hides the far side.
- **The gunner's play space turns with the turret**, as a real turret basket does: the basket floor, the seat, the breech and the gun turn with them, and the hull and the world turn past.
- **Sitting down** (Practice → As driver or As gunner) puts the rider's head at the seat's eyes and faces them along the hull (driver) or the gun (gunner), wherever they are in their room and whichever way they face. Pressing it again sits them down afresh. Choose Seated in the menu's You section first if you are sitting.
- **Who moves the tank and turret.** By default the practice crewmate does both: the tank follows a scripted route and the turret a scripted scan, so a rider in either seat feels the other crew member's motion without anyone else. The menu's Riding section (shown only while riding) can hand either to the rider's thumbsticks or stop it.
- **Blockout model** in `src/scene-assets/ride.scene-asset.ts`, sizes in `src/sim/ride.ts`: a hull roughly a Tiger I's footprint (6.2 × 3.3 m) with tracks, wheels, ivory interior walls, ammunition bins, the engine bay, the driver's seat, dash and tillers; the turret basket with its floor, posts, the gunner's seat, the breech and the gun. Two cabins:
  - **Open top** (the default): hull sides 1 m high, below a seated rider's eyes, so the world is in full view: the worst case for comfort, and the view a rider will have out of a hatch (F2.1).
  - **Closed:** hull sides up to a roof at 1.75 m, a 70 × 20 cm vision slit in front of the driver's eyes, and the turret's walls and roof above the basket. The gunner sees only the inside of the hull turning round the basket, which is what Phase 1's gunner sees until the gunsight (F1.9).
- **Trees in the tank's way sink into the ground** from 14 m to 5 m away rather than pass through the hull (there are no collisions until F1.4). Rocks and bushes are low enough to pass under the hull.
- The template's deck, blocks and scoreboard are hidden while riding and come back on Stop (F1.1 removes them). The blocks are still there, invisible, so a squeeze near the old table can pick one up.
- **Solo only.** Each page rides on its own; in a crew, the crewmate is drawn wherever they are, with the hull round them. Sharing the tank and turret over the network is F1.4 and F1.8.

## The numbers

All motion passes through the comfort caps in `src/sim/ride.ts` (plan §4.10), unit-tested in `test/ride.test.ts`:

| What | Default cap |
| --- | --- |
| Top speed | 35 km/h forward (high range), 11 km/h back |
| Acceleration and braking | 1 m/s² |
| Hull turn rate | 15°/s, changing by at most 20°/s² |
| Pitch and roll following the ground | 4°, eased over 0.5 s |
| Turret traverse | 24°/s at most, changing by at most 40°/s² |

The route loops every 2.9 minutes: parked, 12 km/h straight, a gentle left, 25 km/h, a firmer right, 35 km/h straight, slowing, a stop, a 180° pivot on the spot, reversing, and a long sweeping right. The scan loops every 75 s: a slow search left, a fast 24°/s swing right as if laying on a target, a fine adjustment and back.

**The comfort vignette** (on by default) darkens the edge of view with what the rider's eyes see move: fully at 20°/s of turning (the hull's turn, plus the turret's for the gunner), 1 m/s² of speeding up or braking, or 8°/s of pitching and rolling; only lightly (40% at top speed) at a steady speed. It is the deck walk's vignette, moved into `src/systems/comfort-vignette.ts`; F1.14 makes it a setting of its own.

After 10 minutes in VR riding, a sign asks how the rider feels. The menu's Riding section shows the seat, the time riding and the speed.

## Code

| File | What |
| --- | --- |
| `src/sim/ride.ts` | Sizes, caps, the ground, route and scan, the tank and turret steps, the vignette level, where each seat puts the rig |
| `src/scene-assets/ride.scene-asset.ts` | The blockout: hull, closed roof, turret basket, open and closed turret, ground, trees |
| `src/systems/ride-system.ts` | Moves the world, turns the turret, seats the rider, the vignette and signs; `window.__ride` |
| `src/systems/game-menu-system.ts`, `public/ui/menu.uikitml` | Practice → Ride the tank, and the Riding section |
| `test/ride.test.ts`, `test/z-fighting.test.ts` | The caps, the ground repeating, seating, the vignette; no flickering faces in the hull, turret or ground |
| `scripts/xr-smoke-test.mjs` step 6b | Rides as driver and gunner in the emulator |

What carries into Phase 1: the world-moves approach and the tile-wrapped ground (F1.4, F1.7), the caps and the vignette level (F1.4, F1.14), seating the rig on a seat's eyes and turning the gunner's with the turret (F1.1, F1.2, F1.8). The blockout model, the route and the scan are thrown away.

## Headset check

On Quest 3 (and over Link if you can), after the deploy, with the cache cleared (Ctrl+Shift+R). Sit in a chair. Ride 10 minutes in each of the four combinations if you can, with a break between, and stop at once if you feel unwell.

1. Play solo. Open the menu (Y), choose **Seated** under You, then **Practice → Ride the tank → As driver**. You should be in the driver's seat at the front left of an open-topped hull, looking along it, with the hull's front edge and the ground ahead in view. A sign says "Riding as driver".
2. Ride the crewmate's route with the **vignette on** for 10 minutes. The tank idles, drives off gently, turns, speeds up to 35 km/h, stops and pivots on the spot. The edge of your view should darken as it turns or changes speed. The ground should never jolt; trees in the way sink before they reach you. At 10 minutes a sign asks how you feel. Note it: fine, slight unease, or discomfort, and when in the route.
3. Open the menu: the **Riding** section says "Riding as driver for 10:…". Set **Vignette → Off** and ride another 10 minutes. Note how it compares.
4. Set **Cabin → Closed**. You should see out only through the slit in front of you. Note whether the slit view feels better or worse than the open top.
5. Set **Driven by → Left stick** and drive yourself for a few minutes: forward, back, turn, pivot. Note whether it feels better than being driven.
6. **Practice → As gunner.** You sit left of the gun in the turret basket. Set **Cabin → Open top**, vignette on, and ride 10 minutes with the crewmate driving and scanning. The basket, gun and seat turn with you; the hull and the world turn past, as fast as 24°/s plus the hull's turn. Then 10 minutes with the vignette off.
7. Set **Cabin → Closed** as gunner: only the hull's inside turns round you. Note how that feels.
8. Set **Turret → Right stick** and traverse yourself. Note whether it is better than being turned.
9. Press **X** for the perf HUD while riding as gunner with the open top: report the frame time and draw calls it shows.
10. Report for each step: how you felt (fine, slight, discomfort), at what moment if not fine, and whether the vignette helped. The spike passes if two testers report no discomfort at these defaults, with and without the vignette.

## Findings

Waiting on the headset check.
