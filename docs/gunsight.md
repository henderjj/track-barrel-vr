# Gunsight (F1.9)

The gunner looks through a magnified sight on the gun and lays the reticle's range marks on the range's targets. It is spike S1's renderer ([s1-sight-render.md](spikes/s1-sight-render.md)) moved onto the gun, built as an **articulated sight**, as the Tiger's was: the objective rides on the gun beside the bore, so the sight looks wherever the gun points, while the eyepiece stays fixed in the turret, so the gunner's eye stays at it as the gun elevates. The numbers are in [`src/sim/gunsight.ts`](../src/sim/gunsight.ts) (the lens and reticle maths stay in [`src/sim/sight.ts`](../src/sim/sight.ts)); the model is [`src/scene-assets/sight.scene-asset.ts`](../src/scene-assets/sight.scene-asset.ts) and the system [`src/systems/sight-system.ts`](../src/systems/sight-system.ts).

## What players experience

- In the gunner's seat, the **eyepiece** is 28 cm ahead of the eyes, a short lean forward, with a rubber eyecup. Its arm runs forward at eye height, right of the breech and above the elevation wheel, to a **knuckle** by the turret's front plate on the trunnions' line, and a bracket holds it up from the roof.
- **Lean in** to within about 9 cm and the lens lights up with the view along the gun at 3×, with the reticle over it: an aiming chevron on the gun's line, lead chevrons every 4 mils either side, and range marks below it every 100 m to 1000 m, numbered every 200 m. Lean back past 12 cm and it goes dark (and stops drawing). Both eyes see the picture, at infinity, as in the spike.
- **The view follows the gun.** Traverse and the picture swings; wind the elevation wheel and it tilts up or down, but the eyepiece doesn't move, so the eye never has to chase it. As the tank drives and pitches, the picture moves with the hull.
- **Laying on a target**: put the range mark for the target's distance on it (the 300 m mark on a target 300 m away) and the gun points high by just the drop of an armour-piercing shell at 600 m/s over that distance. The bore is parallel to the sight and 32 cm to its left; F1.10 fires along it.
- From outside, a small hood with the objective's glass sits on the mantlet's face right of the barrel and rises and falls with the gun.
- The **driver** sees the sight and the gun move as the gunner lays it, from the turret's packets.
- Game menu, Practice:
  - **Gunsight → Go to it** puts the player in the gunner's seat with their head 15 cm behind the eyepiece, looking along the sight.
  - **Lay on → Ahead / 100 m / 250 m / 500 m** lays the gun at once so that target sits on the reticle's mark for its distance from wherever the tank stands (parked at the start, up the range, turned away, on a slope), and closes the menu so you can look. The line under it says which target was laid on, how far off it is and which mark to read, or that the gun can't reach it. Either player can press it: the gunner's page lays the gun.
  - **Sight render** keeps the spike's draw, size and eye choices for the frame-rate comparison.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Magnification, field | 3×, ±6° true (±18° to the eye) | Spike S1 |
| Opens / closes | eye within 9 cm of the lens and behind it / beyond 12 cm | Spike S1 (the plan's "about 8 cm") |
| Picture | 512² with 4× multisampling, only while open; reticle 1024² | Spike S1, pending its headset check |
| Eyepiece | turret (0.32, 2.25, −0.48): the spike's eyepiece | 28 cm ahead of a seated gunner's eyes; the head box stops the head 4 cm short of it |
| Arm | 4 cm round at eye height, x 0.28 to 0.36, forward to the knuckle | 14 cm right of the breech, 33 cm above the elevation wheel's rim; clear of F1.10's breech lever at x 0.17 |
| Knuckle | turret (0.32, 2.05, −1.04), on the trunnions' line | Its drum ends inside the front plate; the objective half turns about the same line as the gun |
| Objective | gun space (0.32, 0, −0.155): beside the bore at its height, 1 cm proud of a hood on the mantlet | Rides on the gun (the Gun mesh, which F1.10's recoiling parts are children of) |
| Sight camera's near plane | 0.5 m | The gun (barrel, brake) is hidden while the sight renders, so the barrel 32 cm to the left never shows in the picture |
| Range marks | every 100 m to 1000 m for 600 m/s, no drag | Spike S1; at 600 m/s about 1.4 mils per 100 m |
| Which target copy | the range the tank is on: the one whose start line it has passed (or is within 100 m behind) | The range repeats every 800 m tile up the lane, so the 500 m target has a copy only 300 m behind the start |

## Sharing

Nothing about the sight goes over the network: each page draws its own view, and the gun it follows is the turret's (F1.8: the gunner's page owns it and sends it in packet 7).

- **`sight-lay`**, reliable event `{ aim: 'ahead' | target index }`, to the gunner's page: the Practice lay pressed on the other page. The gunner's page works out the lay from its own copy of the tank's pose and lays the gun, which then reaches the other page in the turret's packets.
- Alone, this page owns the turret whichever seat it sits in, so Lay on works from either seat.

## What the gunner can do alone

Everything: the sight is the gunner's own. With the practice crewmate driving, the picture moves with the tank.

## Departures from the building skill

- **No practice crewmate part.** F1.13 teaches the crewmate to aim and fire through the same mechanisms; until then the crewmate in the gunner's seat doesn't look through the sight.
- **No new HoldKind or packet**: nothing is held and nothing new streams.
- **Both eyes** see the picture by default, as in the spike, not one eye as the plan first proposed; the eye choice stays in Practice → Sight render for the comparison.
- The plan put the whole sight "on the gun". An eyepiece on the gun 67 cm behind the trunnions would rise 23 cm at full elevation and drop 12 cm at full depression, far outside the gunner's head box; the articulated sight keeps it still, as real ones did.

## Tests

- `test/gunsight.test.ts`: world points into hull space match the drive's placing of the ground; the objective matches the turret and gun as Three.js draws them; the knuckle on the trunnions' line inside the front plate; the arm clear of the breech, the wheel and the gunner's head; each target laid on its mark from the start, within the gun's reach; laid from up the range (the far target for 300 m), from past the near target (the turret turned right round) and on a slope; the gun's limits reported; the error in mils right and up; the copy of a target on the range ahead.
- `test/sight.test.ts` (spike S1) still covers the lens, the field, the opening and the marks.
- `test/z-fighting.test.ts`: both halves of the sight in every turret pose already tested, and through the gun's whole elevation.
- `npm run test:xr` step 2c: leaning in opens the sight and renders the range, leaning back closes it. Step 6h: up the range, Practice → Gunsight → Go to it, then Lay on → 500 m lays the far target on its mark 300 m off, by the sums and as the sight camera and the ground are drawn; raising the gun 10° tilts the view 10° and leaves the eyepiece still; leaning in renders the target (`artifacts/xr-gunsight-500m.png`); Ahead turns the turret back.
- `npm run test:net` (in the turret checks, `ONLY_TURRET=1`): the driver's Practice lay on the 250 m target lays the gunner's gun on its mark on both pages, on a clean link and at 150 ms RTT.

`window.__sight` gives `state()` (the spike's stats, the last aim and the menu line), `goTo()`, `lay('ahead' | i)`, `error(i)` and `drawnError(i)` (target `i` from its mark, mils right and up, and its range: by the sums, and from the sight camera and the ground as drawn), `lens()`, `view()`, `pictureSpread()`, and the spike's `setMode`, `setSize` and `setEye`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated (menu → You → Seated). Turn the perf HUD on with X.

1. Game menu (Y) → **Practice → Gunsight → Go to it**. You are in the gunner's seat looking at the eyepiece's rubber cup a short lean ahead. Look round it: the arm runs forward to a knuckle at the front plate, right of the breech and well above the elevation wheel. Nothing flickers, and your hands on the wheel and crank don't hit it.
2. Lean in until the lens lights up. You should see the range at 3× with the reticle: three targets (one, two and five orange blocks). Say whether it is comfortable with both eyes open and steady as you move your head a little.
3. **Lay on → 500 m**. The line under the buttons says the target is 500 m off and to read the 500 m mark (the short mark between the 4 and the 6). Lean in: the target's middle should sit on that mark. Then **250 m** (halfway between the 2 and the short mark below it) and **100 m** (the short mark above the 2). Say whether each sits right, and whether the marks and numbers are readable.
4. With the sight to your eye, wind the **elevation wheel**: the picture tilts and the eyepiece stays where your eye is. Traverse with the power grip: the picture swings smoothly with the basket. Note whether either is uncomfortable.
5. **Practice → Test range → Up the range**, then **Lay on → 500 m**: the line says about 300 m; the target sits on the 300 m mark (the short one between the 2 and the 4). Then **250 m**: the gun target 50 m ahead on the right.
6. With the practice crewmate (`?bot=1`) or a second headset driving, look through the sight on the move: the picture moves with the hull. Report the HUD's fps and the `sight` line (cpu, calls, triangles) with the sight open on the range, at 512².
7. As the driver with a second headset: press **Lay on → 250 m**; the gunner's gun lays on it.
