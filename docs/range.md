# Test range (F1.7)

The ground the tank drives on is now a gunnery range: two dirt roads, three
static targets at 100, 250 and 500 m, a marker every hundred metres up the
road, and fog that limits how far the crew can see. It replaces the drive's
blockout (F1.4) without changing how the ground works: the numbers are in
[`src/sim/range.ts`](../src/sim/range.ts), the ground's own shape stays in
[`src/sim/terrain.ts`](../src/sim/terrain.ts), and the drawn range is built
into the ground's model, so it moves with the world as the tank drives
(plan decision 4: the tank stays at the origin).

## What players experience

- Driving out of the start, the tank sits on a **crossroads**: a dirt road
  runs straight up the range (the drive's lane, now surfaced) and another
  crosses it through the start. Both are flat and clear to drive on; the
  rolling ground, rocks, walls and houses of F1.4 are still either side of
  them.
- Looking up the range from either seat, **three targets** stand out in the
  haze: a tank silhouette at 100 m, an anti-tank gun at 250 m and another
  tank at 500 m, each a canvas board on posts with a dark silhouette on it
  and orange blocks on top — one per hundred metres of its range, so the
  gunner can say which one they mean. All three are inside the sight's field
  (±6°) with the sight looking straight ahead, so the gunner sees them at
  once and can lay the reticle's 100, 250 and 500 m marks on them (spike
  S1's whole point).
- A **range marker** stands beside the road every 100 m out to 600 m: a pale
  post with an orange band per hundred metres. The driver can see how far up
  the range the tank is without asking.
- **Fog** thickens with distance: nothing is hazed closer than 150 m,
  everything is sky colour beyond 780 m, and by about 600 m a target is three
  quarters gone. So the 500 m target is there to be found rather than
  obvious, the drawn ground's edge (800 m away at the nearest) is never seen,
  and the two players have to talk about what they can make out. The game
  menu's **Settings → Range fog** turns it off and on at once, for a
  comparison on a headset; `?fog=0` starts without it.
- The menu's new **RANGE** line names the nearest target, how far away it is
  and how far the fog lets the crew see.
- Game menu: **Practice → Test range → Up the range** parks the tank 200 m up
  the road, facing the far target 300 m off, with the gun target 50 m ahead
  on the right — a different look at the range from the one the start gives,
  and the firing point F1.11's run will use. It leaves the seats alone, so
  either player can use it. **Practice → Drive the tank → Back to start** still parks it on the
  crossroads with all three targets at their marked ranges.
- Nothing on the range can be knocked down or hit yet: the shells come with
  loading and firing (F1.10) and the three-target run with F1.11.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Targets | 100 m (tank), 250 m (gun), 500 m (tank), 7 m left, 11 m right and 7 m right of the sight's line | The plan's ranges; each within 4° of the sight's axis, so all three are in its ±6° field at once |
| Target boards | tank 3.0 × 2.2 m, bottom edge 0.5 m up; gun 2.4 × 1.6 m, 0.35 m up | A tank's silhouette at 100 m is about 1.7°, 0.3° at 500 m: small but findable at 3× |
| Clearance | every target's near edge is at least 4 m from the road's middle, 2.8 m from the tank's outline | The tank drives the whole range without clipping a board |
| Roads | up the range 8 m wide, across the start 7 m wide, surfaces 3 cm and 2 cm above the ground | Inside the ground's flat corridors (±17 m), and the two never share a plane where they cross (the 8 mm rule) |
| Markers | every 100 m to 600 m, 13 m right of the road's middle, 1.5 m tall | Off the road, on the flat, out of the way of the targets |
| Fog | linear, 150 m to 780 m, sky-horizon colour (`#d9e0e6`) | Hides the ground's edge (800 m) completely, leaves the 500 m target 46% visible, and limits useful sight to about 620 m (the plan's "about 600 m") |
| Up the range | parked 200 m up the road facing the 500 m target | 300 m to the far target, 50 m to the gun target, both within the fog's reach |
| Range | about 600 × 600 m of a tile 800 m square | The plan's size; everything repeats with the ground every 800 m, so a long drive meets the range again rather than running out of world |
| Drawn ground | 73,792 triangles in 36 meshes of 400 m square | Was 63k before the range; the renderer skips the squares out of view or past the 1.2 km far plane, about two thirds of them |

## Sharing

Nothing new goes over the network. The range is static geometry and a fog
setting, both built from the same deterministic numbers on every page, so
both players see the same range without being told about it. Two existing
messages carry everything that moves:

- The host's **tank state** (`PacketType.TankState` = 5) already says where
  the tank is, and the range is drawn in the world the tank drives through,
  so the guest's copy of the tank puts the targets in the same places.
- **`drive-place`**, a new reliable event, guest → host: the Practice
  shortcut asks the host to park the tank up the range, as Back to start
  already asks it to park at the start. The host checks the numbers and
  parks; a host does it directly.

The fog is each player's own setting, like the comfort vignette: one player
can turn it off to check something without changing the other's view. F1.11's
range run will have to agree on what has been hit, and that will be the
host's call.

## The practice crewmate

Nothing to learn: the targets stand still and the roads need no help. The bot
drives a route from F1.13, and the range gives it something to drive along.

## Tests

- `test/range.test.ts`: the three targets at their ranges on flat ground and
  inside the sight's field, each facing the sight and clear of the road, the
  obstacles and each other; the markers every 100 m, off the road and off the
  obstacles; both roads inside the ground's flat corridors and a centimetre
  apart where they cross; the fog's numbers (the edge of the ground gone, the
  500 m target still there, useful sight about 600 m); Up the range parking
  on the road facing the middle target; the nearest target named the same in
  every tile.
- `test/terrain.test.ts`: the corridor across the start is flat too, and no
  obstacle stands in either road's corridor.
- `test/z-fighting.test.ts`: the whole range (ground, roads, targets,
  markers, obstacles) with the tank parked on it, and each target and marker
  on its own. The check now rejects pairs of faces by their bounding boxes
  first, which is what keeps it quick with the range's much larger flat area.
- `npm run test:xr` (step 6e): the targets stand at 100, 250 and 500 m with
  the markers up the road; the fog is on with the range's numbers and clears
  from the menu; Up the range parks the tank 120 m short of the middle target
  facing it, and the menu's line names it. Screenshots: `artifacts/xr-range.png`,
  `xr-range-clear.png`, `xr-range-up.png`. Step 6d also checks the targets
  now stay where they stand as the tank drives at them, instead of riding
  with the hull as spike S1's boards did.
- `npm run test:net`: unchanged. Its pages still load with `?ground=0`, which
  hides the range with the ground (software rendering cannot afford it).

`window.__range` gives `targets()`, `markers()`, `fog()`, `tank()`,
`drawnRange(i)` and `up()`.

## What this replaced

Spike S1's three target boards stood in hull space, so they rode along with
the tank and the drive system had to hide them unless the tank was parked at
its start. They are gone: the range's targets are the same three ranges in
the world, `src/sim/sight.ts` no longer owns any target numbers, and
`window.__drive.sightRangeShown` is gone with them. The sight's Practice aim
buttons still lay it on a target as if the tank were parked at the start;
laying the gun from wherever the tank stands is the gunsight's job (F1.9).

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated
(menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone as the **gunner**. Look out through the turret. Report
   whether you can see three target boards up the range, and at what you
   would guess their ranges to be before you check.
2. Lean into the **eyepiece** (Sights → Gunsight (S1) → Go to it if the
   lean is awkward). Report whether you can tell the three targets apart
   through the sight at 3×, whether you can count the orange blocks on each,
   and whether the 500 m one is findable in the haze or too faint.
3. Menu → **Range**: it should name the nearest target (the tank at 100 m,
   about 100 m away) and say the fog lets you see about 620 m.
4. Menu → **Settings → Range fog → Off**, close the menu and look up the
   range again. Report which you prefer: with the fog, the distance should
   feel deep and the far target hard-won; without it, everything is crisp to
   the horizon. Say also whether the fog makes the edge of the world visible
   anywhere (it should not), and whether the frame rate changes (press X for
   the perf HUD).
5. Turn the fog back **on**. Swap to the **driver's** seat (menu → You →
   Seat) and drive up the road in low gear. Report whether the road reads as
   a road through the vision slit, whether the range markers go by at a rate
   that matches the speed you feel, and whether the surface flickers against
   the ground anywhere (it should not).
6. Drive **off the road** onto the rolling ground, then back onto it. Report
   whether the step up onto the surface is noticeable (it is 3 cm, so it
   should not be felt) and whether the hull still tilts gently.
7. Drive **across the start** on the other road for a few hundred metres,
   then come back. Report whether you can find the start crossroads again
   without help.
8. Menu → **Practice → Test range → Up the range**. You should be parked 200 m
   up the road, stopped, facing the far target, with the gun target about
   50 m ahead on your right. Report what the gun silhouette looks like from
   there, and whether you can make out the far target 300 m off through the
   haze.
9. Menu → **Practice → Drive the tank → Back to start**: all three targets
   should be back at 100, 250 and 500 m and the gunsight's range marks should
   sit on them.
10. Press **X** for the perf HUD parked at the start looking up the range,
    then while driving. Report the frame time, draw calls and triangles both
    times; the range added about 10k triangles to the ground.
