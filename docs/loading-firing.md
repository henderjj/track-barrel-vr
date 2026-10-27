# Loading and firing (F1.10)

The gunner loads the gun by hand and fires it with the power grip's trigger; the shell flies to the range and the host decides what it hit. Loading is spike S4's drill ([spikes/s4-loading.md](spikes/s4-loading.md)) moved from its station beside the tank into the turret. The numbers live in [`src/sim/loading.ts`](../src/sim/loading.ts) (loading) and [`src/sim/ballistics.ts`](../src/sim/ballistics.ts) (the shell's flight); the systems are [`src/systems/loading-system.ts`](../src/systems/loading-system.ts) and [`src/systems/firing-system.ts`](../src/systems/firing-system.ts).

## What players experience

- The **gunner** sits right of the breech. The **ready rack** is on the turret wall to their right: four shells in two rows of two, lying nose forward, just above the turret ring, where a seated right hand reaches out sideways. The **breech** is on their left, its square mouth 50 cm ahead of the eyes and 40 cm to the left. Its red **lever** sticks up on the breech's right side.
- **To load**, as in spike S4: take a shell (squeeze the grip anywhere along it), swing it across and put its nose to the breech mouth. Near enough and pointing along the bore, it snaps onto the bore with a short buzz and from then on only slides along it. Ram it home by pushing it all the way, by shoving it and letting go, or by pushing its base with an open hand (strong buzz). Pull the lever back towards you a quarter turn: the breech block slides up across the mouth and the load counts. A lever pulled on a shell not home stops at 17° with a long buzz (a fumble); a shell dropped anywhere but the breech falls to the basket floor (a fumble) and is back in the rack a second later.
- The breech moves with the gun: with the gun elevated its mouth dips, and the shell must point up the bore to snap in. A shell in the breech rises and dips with the gun.
- **To fire**, squeeze the power grip's trigger (the grip that traverses the turret) with a loaded breech. The gun fires: both controllers buzz hard, a flash shows at the muzzle, the barrel and breech recoil 30 cm and run out again in half a second, the breech opens by itself (a semi-automatic breech, as the 88's), and the spent **casing** flies back out of the breech and lands in the **bin** under it, on the basket floor left of the gunner's legs. The rack refills at once (limited ammunition comes with F3.1). The trigger with nothing loaded gives a small click.
- The **shell** flies at 600 m/s with a bright orange **tracer** behind it, drawn thicker the further away it is so it stays visible, unfogged so it shows through the haze. Where it lands a **burst** goes up: brown dirt on the ground, a bright yellow flash on a target.
- The **loading board** on the turret wall above the rack, turned to face the gunner, shows the loads, the last and best load times, the fumbles and the loads in a row without one, and what to do next: "Load!", "Ram it home", "Rammed: close the breech", "Loaded: fire!". After a shot it says where it went: "Hit: the 250 m gun" or "Miss the 500 m tank: 20 m short, 3 m right".
- The **driver** sees the gunner's hands on the shells and the lever, the shells moving between the rack and the breech, the gun recoil and the casing fly, the tracer, and the bursts. The game menu's line under **Load and fire** says who loads, the loads so far, and the shots and hits.
- Game menu: **Practice → Load and fire → Gunner** puts the player in the gunner's seat with every shell in the rack, the breech open and the board's stats cleared. **Lay the gun** (F1.8) still lays the gun; the menu's **Test range → Up the range** (F1.7) parks the tank for a closer shot.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Shell | 0.6 m long, 44 mm radius; brass case the rear 0.35 m | Spike S4's: short enough to ram from a seat |
| Ready rack | four slots, turret (0.82 and 0.94, 1.98 and 2.12, −0.2) | Right of the seat above the turret ring (which turns under the hull roof up to 1.9 m), clear of the crank and the power grip; 0.4 to 0.55 m to the right of the eyes |
| Breech mouth | gun space (0, 0, 0.45): turret (0, 2.05, −0.7) with the gun level | 0.5 m ahead, 0.4 m left and 0.2 m below the gunner's eyes, spike S4's reach. `GUN.breechBack` moved from 0.15 to −0.7, so the breech is 0.37 m long now and ends well ahead of the gunner |
| Breech mouth with the gun at −10° / +20° | 8 cm higher / 15 cm lower | Moving the breech forward keeps it near the trunnions |
| Lever | pivot gun (0.165, 0, 0.39), 16 cm to its handle, which sticks 4 cm towards the gunner; open 0° (up), closed 90° (back) | Spike S4's, on the breech's right side; clear of the gunsight's arm (x 0.28 and up, F1.9) |
| Snap onto the bore, ram, slide, palm push | as spike S4: within 5 cm of the line, 8 cm outside to 4 cm in, 20°; shoves slow at 2 m/s² | Unchanged, so S4's headset check carries over |
| Recoil | 30 cm back in 0.06 s, back in battery 0.55 s later | Reads as a heavy gun without a long wait |
| Casing bin | turret (−0.24, floor, −0.38), 32 × 48 cm, 38 cm deep; the last 6 casings lie in it | Under the breech, left of the gunner's legs |
| Muzzle speed | 600 m/s (armour piercing) | Plan §4.6 |
| Drop | 3.4 m at 500 m (0.4°), 0.8 m at 250 m, 0.14 m at 100 m | Gravity, no drag (Phase 1) |
| Flight | marched in 1/240 s steps (2.5 m), up to 4 s (2.4 km) | Fine enough for a 10 cm board; a few hundred steps per shot, once per shot |
| Targets | the range's three faces (`targetFace` in `src/sim/range.ts`) on the ground under them, and the ground | F1.7. Obstacles (rocks, walls, houses) don't stop a shell yet |

Every rack slot, the breech mouth and the lever handle at every elevation are between knee and chest height for a seated player and within 0.8 m of the eyes (`test/body-height.test.ts`).

## Sharing

The gunner's page owns the turret (F1.8), so it does the loading too, and fires: the shell leaves the muzzle where that page draws the tank and the turret, so it goes where the gunner aimed. The host decides what it hit (plan §4.6).

- **Loading state** (`PacketType.LoadingState` = 8), gunner's page → the other, unreliable, 45 Hz, 75 bytes: the lever's angle, the shell in the breech and how far in, rammed and loaded, each shell's place, centre and axis in turret space (millimetres), and the board's numbers. The other page keeps the last 16 in a `StateBuffer` and draws them a little in the past, as the hands are; a shell that changed place (rack to hand, hand to breech) is drawn where it went rather than sliding between.
- **`shot`**, reliable event, from the firing page: an id (even from the host, odd from a guest), the muzzle's position and the bore's direction in world space. Both pages fly the shell with the same sums (the flight is deterministic), so both draw the same tracer and burst, and both recoil the gun and throw the casing.
- **`shot-hit`**, reliable event, host → guest: what the shot hit (target, ground or nothing), where and when, and the target's hit count. The host counts hits; the guest's board and menu take the host's word.
- Hands on the loading: a hand holding a shell is sent as `HoldKind.Shell` (9), drawn as a fist with the shell in it (not locked); a hand on the lever as `HoldKind.BreechLever` (10), drawn closed on the handle as this page draws it.
- When the seats swap, the new gunner's page carries on from the loading as it drew it: the lever and the shell in the breech stay, a shell that was in the crewmate's hand goes back in the rack.
- Alone, this page loads and fires whichever seat it sits in (as it owns the turret).

## The practice crewmate

Not yet: the crewmate learns to load, aim and fire in F1.13, through these same rules (`window.__loading.setTestHand` drives scripted hands; `aimAt` in `src/sim/ballistics.ts` lays the gun on a target). Until then, the crewmate in the gunner's seat doesn't load.

## Departures from the building skill

- No practice crewmate part (F1.13 does it, per the roadmap), as for F1.8.
- Spike S4's station beside the tank is gone with its Practice button (Sit at the breech): its drill is the turret's loading now, and **Load and fire** replaces it.
- Tracked hands have no trigger in the kit (a pinch is a grab), so a player with tracked hands can load but not fire yet. The test hook can fire; a gesture for it is left for F1.14 or later.
- The breech block and lever, the muzzle flash and the recoiling barrel are parts of the gun's mesh (`Gun Recoil`, a child of `Gun`), added by the system rather than as entities of their own, as the controls are mounted in F1.8: they only ever move with the gun.

## Tests

- `test/loading.test.ts` (spike S4's tests on the new layout, plus): a full load and the trigger firing it, the breech opening and the rack refilling; fire only with a loaded breech; a shell in the breech moving with the gun, and a load with the gun elevated; recoil and every casing landing in the bin; the loading packet's round trip and drawing between packets. An open hand drawn back out past a shell's base no longer pushes it in (a bug in S4's palm push, found moving it into the turret).
- `test/ballistics.test.ts`: the parabola and the drop; a hit on a face its path passes through, a miss short, wide and over; the nearest copy of a face on the repeating ground; hull to world space matching Three.js; laying the gun from the start onto each range target with `aimAt` hits it; the miss line's short, over, left and right.
- `test/body-height.test.ts`: the rack, the mouth and the lever in a seated gunner's reach at every elevation. `test/z-fighting.test.ts`: the turret with the breech open and closed, a shell rammed, the gun recoiled and casings in the bin, at both ends of the elevation; a shell and a casing.
- `npm run test:xr` (step 6g): Practice → Load and fire; the right controller loads a shell from the turret's rack (breech, ram, lever); the gun is laid on the 100 m target; the right hand takes the power grip and pulls its trigger: the gun recoils, the breech opens, the rack refills, the casing lands in the bin and the shell hits the target; the trigger with nothing loaded fires nothing; a dropped shell is a fumble. Screenshots: `artifacts/xr-loading-breech.png`, `artifacts/xr-loading-closed.png`.
- `npm run test:net` (`ONLY_FIRING=1`, or `=lag`): a guest gunner's loading reaches the host (the shells, the lever, loaded); the guest fires, both pages see the shot, the host decides the hit and the guest takes its word; on a clean link and at 150 ms RTT.

`window.__loading` gives `state()` (hull space with the turret as drawn: shells, holds, lever, breech, loaded, board, recoil, casings), `stats`, `start()`, `reset()`, `setTestHand(side, fn)` (hull space), `layout()` (the mouth, the lever's pivot and sizes, the rack, the eye point). `window.__firing` gives `records()`, `hits()`, `flying()`, `fire()`, `predict()`, `aimAt(i)`, `sent` and `received`. `window.__turret` gained `aim(yawDeg, elevationDeg)` and `pullTrigger()`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated (menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Load and fire → Gunner**. You are in the gunner's seat. Look right: four shells in the rack on the wall. Look left: the breech with the red lever up. Above the rack, the loading board says "Load!". Say if anything is hard to reach from the chair.
2. **One slow load.** Take the near lower shell near its base, swing it to the breech and put its nose in: it snaps onto the bore with a buzz. Push it home (strong buzz), then pull the lever back towards you: the board says "Loaded: fire!".
3. **Fire.** Take the power grip with your right hand and squeeze its trigger: a hard buzz, the flash at the muzzle, the breech kicks back and runs out, the lever flies open, and the casing drops into the bin by your left leg. Watch the tracer: through the vision gaps or with your head up in the hatch area, it should be easy to follow to the range. The board says where it went.
4. **Hit something.** Lay the gun with the elevation wheel and the crank (F1.8) on the 100 m tank (left of the road), load and fire until the board says "Hit". Then the 250 m gun. Report how many shots each took and whether the tracer and the bursts were easy to see.
5. **Elevated loading.** Wind the gun up 10° or more and load: the mouth is lower and the shell must point up into it. Say whether that is natural or a chore.
6. **Speed.** Load and fire as fast as you comfortably can for ten shots. Report the board's best and last times and the fumbles. The plan's mark is under about 5 s a load.
7. With a second headset (or `?bot=1` on a PC page for a crewmate), as the driver, look back at the gunner: you should see their hands on the shells and the lever, the gun recoil and the casing fly, and the tracer and bursts. As the gunner with a crewmate driving, fire while parked: both see the same hit.
8. Look round the turret while loading and firing: no flickering faces, nothing passing through the rack, the bin or the controls. Press **X** for the perf HUD while a shell is in the air: report the frame time and draw calls.
