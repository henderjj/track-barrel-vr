# Turret and gun laying (F1.8)

The turret turns and the gun elevates. The gunner lays the gun with three controls built from the mechanism kit ([mechanisms.md](mechanisms.md)): a power traverse grip, a manual traverse crank and an elevation handwheel. The gunner's seat is in the turret basket, so the gunner turns with the turret while the hull and the world turn past (plan decision 4, spike S2). The numbers live in [`src/sim/turret.ts`](../src/sim/turret.ts); the system is [`src/systems/turret-system.ts`](../src/systems/turret-system.ts).

## What players experience

- The **gunner** sits right of the breech, facing the gun. In front of them, below chest height:
  - the **elevation handwheel** on the left, under the breech's right edge, for the left hand. It stands sideways, its face towards the gunner and its axle running across the turret, as on a Sherman (TM 9-754, figure 13): it turns a pinion that climbs a toothed arc on the gun's left side, so you can see what it moves. Turning it clockwise (as the gunner sees it) raises the gun, 0.75° a turn, from 10° down to 20° up; it stops with a firm buzz at either end and ticks every eighth of a turn. It is turned by a handle standing out of it, like the crank (as on a Tiger or a T-34), and a trigger bar along the handle fires the gun, so the gunner can fire while laying it, as on the Tiger I.
  - the **traverse crank** right of it, for the right hand: one turn of its knob traverses the turret 2°, anticlockwise to the left, clockwise to the right, with a tick each quarter turn. It is for the last few degrees.
  - the **power traverse grip**, lower down on the right beside the seat's front edge: a twist grip standing up from a pedestal. Twist it left (anticlockwise seen from above) and the turret traverses left, right to go right; the further it is twisted, the faster. Let go and it springs back and the turret stops. Its trigger fires the gun ([loading-firing.md](loading-firing.md), F1.10).
- **Power traverse runs off the engine**, Tiger-style: at full twist the turret turns 6°/s with the engine at idle and up to 24°/s at top RPM. With the tank parked, the driver's hand throttle (F1.5) raises the idle and so the traverse. The turret speeds up and slows down at no more than 40°/s², so it never lurches.
- The **basket turns the gunner with it**: their head and hands stay put relative to the seat, the breech and the controls; the hull, the driver and the world turn past. The comfort vignette counts the turret's turn as well as the hull's for the gunner.
- The **gun** elevates on trunnions in the turret's front plate, so its breech dips beside the gunner as the muzzle rises.
- The gunsight (F1.9, [gunsight.md](gunsight.md)) turns with the turret and looks along the gun as it elevates; its eyepiece stays still in the turret.
- The **driver** sees the turret and gun move, the gunner's hands on the controls, and the crank and grip turning under them.
- Game menu: **Practice → Lay the gun → Gunner** puts the player in the gunner's seat with a sign saying how to lay the gun; **Forward** turns the turret and the gun straight ahead (either player can press it). The line under it says who lays the gun and where it points.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Power traverse at full twist | 6°/s at idle (800 rpm) rising to 24°/s at top RPM (2600) | Plan §4.4; the top is spike S2's comfort cap (`MAX_TRAVERSE` in `src/sim/comfort.ts`) |
| Traverse acceleration | at most 40°/s² | Spike S2's cap |
| Power grip | ±40° twist, 4° deadband, springs back at 12/s | The kit bench's twist grip, felt in F1.3 |
| Manual crank | 2° of turret a turn; 8 cm radius, 6 cm knob; a tick each quarter turn | Fine aim: a degree is half a turn |
| Elevation | −10° to +20°, 0.75° a handwheel turn (40 turns end to end); 11 cm rim; a tick each eighth | Plan §4.4. 3° a turn (before) covered the range targets in half a turn, which John found too fast. At 500 m the shell drops about 0.4°, half a turn |
| Elevation handwheel | turret (0.29, 1.86, −0.6), turned 90° about the vertical so its face looks right at the gunner (`yaw` in `STATION`), at the traverse crank's height; 8 cm to the handle, which stands out 6 cm with its trigger bar | Left hand, 39 cm below the eyes (its handle at least 28 cm) and 40 cm ahead, under the sight ([interior.md](interior.md)); the handle's sweep clears the breech at every elevation |
| Elevating gear | `ELEVATING_GEAR`: a 2 cm pinion at turret (0.245, 1.9, −0.8) on a column from the handwheel's gearbox; a toothed arc about the trunnion at x 0.245, a tooth every 3°, held by two arms off the gun | The pinion stays on the arc from −10° to +20° and both clear the breech and its lever (tested) |
| Traverse crank | turret (0.52, 1.86, −0.52), tilted back 20° | Right hand, 39 cm below the eyes and 32 cm ahead; it and the fist on it turn inside the turret ring (John's headset check, [interior.md](interior.md)) |
| Power grip | turret (0.71, 1.63, −0.45), upright; handle 1.665–1.775 m | Right hand, beside the seat's front edge, 25 cm ahead (13 cm higher since [interior.md](interior.md)) |
| Gun trunnions | the turret's front plate, at the gun's height (2.05 m) | The mantlet stays at the plate as it elevates; the breech's mouth is 0.45 m behind them and 0.5 m ahead of the gunner's eyes (1.3 m behind them until F1.10 moved it forward for loading) |

Every handle is between knee and chest height, 20 to 65 cm ahead of a seated gunner's eyes, and far enough from the others that a squeeze takes the one meant (`test/turret.test.ts`).

## Sharing

The gunner's page owns the turret (plan decision 2, the concept's "turret input predicted locally"): it steps the turret from its own hands at once, with the engine RPM the drive draws on that page (the host's, or the guest's copy of it), so aiming never waits on the network.

- **Turret state** (`PacketType.TurretState` = 7), gunner's page → the other, unreliable, 45 Hz, 17 bytes: the turret's turn and traverse rate, the gun's elevation, the crank's angle and the grip's twist (int16s). The elevation wheel's turn follows from the elevation. The other page keeps the last 16 in a jitter buffer (`src/net/state-buffer.ts`, which the tank's buffer now shares) and draws the turret, the gun and the gunner's controls a little in the past, the short way round past half a turn, carrying the turret on at its rate for up to 150 ms if a packet is late.
- **`turret-forward`**, reliable event, to the gunner's page: Forward from the other player's menu.
- Alone, this page owns the turret whichever seat it sits in. In a crew exactly one player sits in the gunner's seat, so exactly one page owns it; when the seats swap, the new gunner's page carries on from the turret as it drew it.
- With nobody's hands on the gunner's controls (solo in the driver's seat, or the practice crewmate as gunner until F1.13), the turret holds where it is.
- Heads and hands still go in hull space (F1.1). The crewmate's hands on the gunner's controls are drawn closed on them (HoldKinds 6, 7 and 12), on the controls as this page draws them.
- The engine's RPM reaches a guest gunner about half a round trip late; traverse speed changes slowly with RPM, so that doesn't show.

## The practice crewmate

Since F1.13 the practice crewmate lays the gun through these same mechanisms: its right hand twists the power grip and its left winds the elevation handwheel by its handle ([crewmate.md](crewmate.md)).

## Departures from the building skill

- No practice crewmate part (F1.13 does it, per the roadmap).
- The gun and the station's moving controls are made by the system, not placed in the scene JSON, as spike S1's sight is: they are children of the scene's turret.
- Heads and hands still go over the network in hull space, not turret space, as the plan once proposed. Both pages draw the turret and the crewmate's poses from buffers with about the same delay, so at 24°/s a gunner's head drifts at most a few millimetres from where it sits in the turret.

## Tests

- `test/turret.test.ts`: power traverse rate with RPM, the comfort caps on traverse, direction, wrapping round, half twist, the crank's 2° a turn, the elevation handwheel's 0.75° a turn and its limits, its sideways mount, the elevating arc staying on its pinion and clear of the breech, its trigger bar, the wheel and grip worked through the kit, drawing between packets the short way round, the barrel's direction and muzzle matching Three.js, the station's reach, spacing and clearances, the turret packet round-trip and its jitter buffer.
- `test/z-fighting.test.ts`: the turret with its gun at both ends of its elevation and the controls turned, under every turret angle tested before.
- `npm run test:xr` (step 6f): Practice → Lay the gun; the power grip twisted traverses the turret left at about the idle rate with the gunner's head kept still in the turret and the vignette darkening; let go, it stops; a turn of the crank traverses about 2°; a turn of the elevation handwheel raises the gun about 0.75° and the trigger bar on its handle pulls; Forward. Screenshot: `artifacts/xr-turret.png`.
- `npm run test:net` (`ONLY_TURRET=1`, or `=lag`, for just this): the guest gunner's traverse turns its turret at once and the host sees it close behind and smoothly; the stopped, elevated turret is the same on both; the host's Forward reaches the gunner's page; on a clean link and at 150 ms RTT.

`window.__turret` gives `state()` (radians, and `yawDeg`, `elevationDeg`, `rateDeg`), `owner()`, `set({ traverse, elevation })`, `crank(turns)`, `forward()`, `names` (each control's name in `window.__mechanisms`), `drawn()`, `headInTurret()`, `sign`, `sent`, `received` and `lateFrames`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated (menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Lay the gun → Gunner**. You are in the gunner's seat with a sign saying how to lay the gun. Look down: the elevation handwheel is in front of your left hand, the crank in front of your right, and the power grip lower on the right. All are in easy reach without leaning.
2. Take the **power grip** with your right hand and twist your wrist left: the turret traverses left, slowly (the engine is at idle), and you turn with it. The hull, the driver's seat and the world turn past through the gaps; your seat, the breech and the controls stay put. Twist further: faster. Let go: it eases to a stop. Note whether the turn was comfortable, with and without the vignette (Comfort and stats → Vignette).
3. Take the **crank** knob and wind it: the turret creeps round, a degree each half turn, ticking each quarter. Note whether it is slow enough to aim finely and fast enough not to bore you.
4. The **elevation handwheel** faces you sideways, with a column from it up to a toothed arc on the gun. Take its handle with your left hand and wind it clockwise: the gun's muzzle rises slowly (0.75° a turn, so the range targets take a few turns), the arc rides round its pinion and the breech dips beside you. Note whether it is now slow enough to lay finely and quick enough not to tire your arm. Turn it in loose circles: it should keep turning without catching. Wind it to its end if you have the patience (about 27 turns from level): it stops with a buzz at +20° and your glove stays on the handle. With the gun loaded (Practice → Ready to fire → 100 m), pull the left trigger while holding the handle: the gun fires, as from the power grip's trigger. The other way it stops at −10°. Note whether the direction feels natural.
5. Menu → **Forward**: the turret and gun swing back straight ahead (the line under it says "turret ahead").
6. With a second headset (or `?bot=1` on a PC page for a crewmate in the other seat): as the gunner, traverse while the crewmate drives; as the driver, watch the turret turn and the crewmate's hands on its controls. Both of you see the same aim. With a second headset, rev the engine as the driver while the gunner traverses: the traverse gets faster.
7. Look round the turret and at the gun as it elevates: no flickering faces, nothing passing through the controls.
8. Press **X** for the perf HUD while traversing: report the frame time and draw calls.
