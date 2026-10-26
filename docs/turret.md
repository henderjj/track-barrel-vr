# Turret and gun laying (F1.8)

The turret turns and the gun elevates. The gunner lays the gun with three controls built from the mechanism kit ([mechanisms.md](mechanisms.md)): a power traverse grip, a manual traverse crank and an elevation handwheel. The gunner's seat is in the turret basket, so the gunner turns with the turret while the hull and the world turn past (plan decision 4, spike S2). The numbers live in [`src/sim/turret.ts`](../src/sim/turret.ts); the system is [`src/systems/turret-system.ts`](../src/systems/turret-system.ts).

## What players experience

- The **gunner** sits right of the breech, facing the gun. In front of them, below chest height:
  - the **elevation handwheel** on the left, under the breech's right edge, for the left hand. Turning it clockwise (as the gunner sees it) raises the gun, 3° a turn, from 10° down to 20° up; it stops with a firm buzz at either end and ticks every eighth of a turn. Either hand or both can turn it by its rim.
  - the **traverse crank** right of it, for the right hand: one turn of its knob traverses the turret 2°, anticlockwise to the left, clockwise to the right, with a tick each quarter turn. It is for the last few degrees.
  - the **power traverse grip**, lower down on the right beside the seat's front edge: a twist grip standing up from a pedestal. Twist it left (anticlockwise seen from above) and the turret traverses left, right to go right; the further it is twisted, the faster. Let go and it springs back and the turret stops. Its trigger is the gun's trigger once firing comes (F1.10).
- **Power traverse runs off the engine**, Tiger-style: at full twist the turret turns 6°/s with the engine at idle and up to 24°/s at top RPM. With the tank parked, the driver's hand throttle (F1.5) raises the idle and so the traverse. The turret speeds up and slows down at no more than 40°/s², so it never lurches.
- The **basket turns the gunner with it**: their head and hands stay put relative to the seat, the breech and the controls; the hull, the driver and the world turn past. The comfort vignette counts the turret's turn as well as the hull's for the gunner.
- The **gun** elevates on trunnions in the turret's front plate, so its breech dips beside the gunner as the muzzle rises.
- Spike S1's sight hangs from the turret roof and now turns with the turret (it still doesn't elevate with the gun: F1.9 puts the real gunsight on the gun).
- The **driver** sees the turret and gun move, the gunner's hands on the controls, and the crank and grip turning under them.
- Game menu: **Practice → Lay the gun → Gunner** puts the player in the gunner's seat with a sign saying how to lay the gun; **Forward** turns the turret and the gun straight ahead (either player can press it). The line under it says who lays the gun and where it points.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Power traverse at full twist | 6°/s at idle (800 rpm) rising to 24°/s at top RPM (2600) | Plan §4.4; the top is spike S2's comfort cap (`MAX_TRAVERSE` in `src/sim/comfort.ts`) |
| Traverse acceleration | at most 40°/s² | Spike S2's cap |
| Power grip | ±40° twist, 4° deadband, springs back at 12/s | The kit bench's twist grip, felt in F1.3 |
| Manual crank | 2° of turret a turn; 8 cm radius, 6 cm knob; a tick each quarter turn | Fine aim: a degree is half a turn |
| Elevation | −10° to +20°, 3° a handwheel turn (10 turns end to end); 11 cm rim; a tick each eighth | Plan §4.4. At 500 m the shell drops about 0.4°, a bit over an eighth of a turn |
| Elevation wheel | turret (0.29, 1.78, −0.56), tilted back 20° | Left hand, 47 cm below the eyes and 36 cm ahead; its rim clears the breech at every elevation |
| Traverse crank | turret (0.60, 1.74, −0.55), tilted back 20° | Right hand, 51 cm below the eyes and 35 cm ahead |
| Power grip | turret (0.72, 1.50, −0.42), upright; handle 1.535–1.645 m | Right hand, low beside the seat's front edge, 22 cm ahead |
| Gun trunnions | the turret's front plate, at the gun's height (2.05 m) | The mantlet stays at the plate as it elevates; the breech reaches 1.2 m back beside the gunner |

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

Not yet: the crewmate learns to aim and fire in F1.13, through these same mechanisms. Until then, the crewmate in the gunner's seat leaves the turret where it is, and the player alone as gunner lays the gun while the tank stays parked.

## Departures from the building skill

- No practice crewmate part (F1.13 does it, per the roadmap).
- The gun and the station's moving controls are made by the system, not placed in the scene JSON, as spike S1's sight is: they are children of the scene's turret.
- Heads and hands still go over the network in hull space, not turret space, as the plan once proposed. Both pages draw the turret and the crewmate's poses from buffers with about the same delay, so at 24°/s a gunner's head drifts at most a few millimetres from where it sits in the turret.

## Tests

- `test/turret.test.ts`: power traverse rate with RPM, the comfort caps on traverse, direction, wrapping round, half twist, the crank's 2° a turn, the elevation wheel's 3° a turn and its limits, the wheel and grip worked through the kit, drawing between packets the short way round, the barrel's direction and muzzle matching Three.js, the station's reach, spacing and clearances, the turret packet round-trip and its jitter buffer.
- `test/z-fighting.test.ts`: the turret with its gun at both ends of its elevation and the controls turned, under every turret angle tested before.
- `npm run test:xr` (step 6e): Practice → Lay the gun; the power grip twisted traverses the turret left at about the idle rate with the gunner's head kept still in the turret and the vignette darkening; let go, it stops; a turn of the crank traverses about 2°; a quarter turn of the elevation wheel raises the gun about 0.75°; Forward. Screenshot: `artifacts/xr-turret.png`.
- `npm run test:net` (`ONLY_TURRET=1`, or `=lag`, for just this): the guest gunner's traverse turns its turret at once and the host sees it close behind and smoothly; the stopped, elevated turret is the same on both; the host's Forward reaches the gunner's page; on a clean link and at 150 ms RTT.

`window.__turret` gives `state()` (radians, and `yawDeg`, `elevationDeg`, `rateDeg`), `owner()`, `set({ traverse, elevation })`, `crank(turns)`, `forward()`, `names` (each control's name in `window.__mechanisms`), `drawn()`, `headInTurret()`, `sign`, `sent`, `received` and `lateFrames`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated (menu → You → Seated). Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Lay the gun → Gunner**. You are in the gunner's seat with a sign saying how to lay the gun. Look down: the elevation wheel is in front of your left hand, the crank in front of your right, and the power grip lower on the right. All are in easy reach without leaning.
2. Take the **power grip** with your right hand and twist your wrist left: the turret traverses left, slowly (the engine is at idle), and you turn with it. The hull, the driver's seat and the world turn past through the gaps; your seat, the breech and the controls stay put. Twist further: faster. Let go: it eases to a stop. Note whether the turn was comfortable, with and without the vignette (Driving section).
3. Take the **crank** knob and wind it: the turret creeps round, a degree each half turn, ticking each quarter. Note whether it is slow enough to aim finely and fast enough not to bore you.
4. Take the **elevation wheel**'s rim with your left hand (then both) and turn it clockwise: the gun's muzzle rises and the breech dips beside you. Wind it to its end: it stops with a buzz at +20° and your glove stays on the rim. The other way it stops at −10°. Note whether the direction feels natural.
5. Menu → **Forward**: the turret and gun swing back straight ahead (the line under it says "turret ahead").
6. With a second headset (or `?bot=1` on a PC page for a crewmate in the other seat): as the gunner, traverse while the crewmate drives; as the driver, watch the turret turn and the crewmate's hands on its controls. Both of you see the same aim. With a second headset, rev the engine as the driver while the gunner traverses: the traverse gets faster.
7. Look round the turret and at the gun as it elevates: no flickering faces, nothing passing through the controls.
8. Press **X** for the perf HUD while traversing: report the frame time and draw calls.
