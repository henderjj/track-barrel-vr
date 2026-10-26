# Cabin and seats (F1.1)

The crew's place in the tank: the hull with the driver's seat, the turret with its basket and the gunner's seat, and the code that sits each player in their seat. It replaces the template's deck, blocks and hoop, and the thumbstick walking. The numbers live in [`src/sim/cabin.ts`](../src/sim/cabin.ts), shared by the model ([`src/scene-assets/cabin.scene-asset.ts`](../src/scene-assets/cabin.scene-asset.ts)), the seat system ([`src/systems/seat-system.ts`](../src/systems/seat-system.ts)), the crewmate's avatar, the practice crewmate and the tests.

## What players experience

- On entering VR each player is in their seat: eyes at the seat's eye point, facing the tank's front, wherever they are in their real room. Their real floor goes at the seat's floor, with the body-height offset on top, which since F1.2 puts the calibrated eyes on the eye point ([seat-choice.md](seat-choice.md)).
- The **driver** sits front left in the hull under an open hatch. The vision slit is 80 cm ahead of their eyes; the space in front of them is kept clear for the tillers and the gear lever (F1.5).
- The **gunner** sits right of the gun in the turret basket, 80 cm above the hull floor. The breech is on their left at chest height, and spike S1's sight hangs from the turret roof 28 cm ahead of their eyes: leaning in opens it.
- A player moves their head freely inside their seat. Leaning past the edge of the seat's head box stops the head there, as if it met the wall, the breech or the controls. A head far outside the box (the headset recentred, or the player stood up and walked across the room) puts the player back in the seat.
- The crewmate is drawn sitting in their seat: head and hands from their poses, legs bent on their seat's cushion.
- Game menu: **Practice → Sit in Driver / Gunner** changes seats; **You → Seat → Back in my seat** puts the player back at the eye point facing forward.
- The spikes' Practice buttons still work. Riding (S2) hides the cabin while it shows its own blockout and puts the player back in their seat when it stops. Loading (S4) is in the turret since F1.10 ([loading-firing.md](loading-firing.md)). While a spike seats the player somewhere else, the seat system leaves the play space alone (`seating.away`); choosing a seat or Back in my seat ends that.

## Numbers

Hull space: hull floor at y = 0, front towards −Z, +X to the right. The tank stays at the origin (plan decision 4), so hull space is the scene's space. Turret space is the same turned about the ring's centre (hull z = 0.2) by the turret's angle, which the gunner sets since F1.8 ([turret.md](turret.md)); a seated gunner's play space turns with it.

| What | Value | Why |
| --- | --- | --- |
| Hull inside | 2.2 m wide, z −2.4 to 2.0, roof at 1.8 m | 35 cm over a seated driver's eyes |
| Turret ring | radius 0.92 m at z 0.2 | The basket and turret walls fit inside the hull's width |
| Turret basket floor | 0.8 m above the hull floor | Puts the gunner's eyes near the gun's height |
| Turret roof | 2.75 m | 50 cm over the gunner's eyes |
| Gun axis | 2.05 m, breech mouth 45 cm behind the trunnions, 70 cm back from the front wall (F1.10; 1.3 m behind them before) | The mouth is 50 cm ahead of the gunner's eyes, where a seated player rams a shell |
| Driver's eye point | (−0.5, 1.45, −1.6), hull | Seated eye height (1.45 m, `body-height.ts`) over a 55 cm cushion |
| Driver's head box | 35 cm left, 30 cm right, 60 cm forward, 35 cm back | Up to the slit, short of the side wall and the turret basket |
| Gunner's eye point | (0.4, 2.25, −0.2), turret | Right of the breech |
| Gunner's head box | 22 cm left, 35 cm right, 24 cm forward, 45 cm back | The breech on the left; forward stops 4 cm short of the sight's lens |
| Sight eyepiece | (0.32, 2.25, −0.48), turret | A 28 cm lean from the eye point; the sight opens within 9 cm |
| Reseat distance | 30 cm past the head box | Further than any lean, nearer than a step |
| Ground | 0.6 m under the hull floor; the drive's rolling ground since F1.4 ([tank-drive.md](tank-drive.md)) | The tracks reach it |

The models are lit by the sky's image-based light (`IBLGradient` in the scene), which only lights `MeshStandardMaterial`: every model uses it, rough and not metallic. There are no lights in the scene.

## Sharing

The host decides who sits where; the guest asks.

- When a crew connects, the host keeps their seat (the driver's, unless they changed it) and sends a reliable `seats` event `{ host, guest }`. The guest sits where it says.
- A guest choosing a seat sends `seat-ask` `{ seat }`. Since F1.2 the host swaps only once both players have asked ([seat-choice.md](seat-choice.md#sharing)), then sends `seats`; with two seats and two players there is no other answer.
- A host choosing a seat takes it and sends `seats`.
- Alone, the player sits where they like.
- Each page draws the crewmate's legs in the crewmate's seat. Poses go over the network in hull space as before; the seated player's feet height is their seat's floor.

When the host leaves and the guest becomes host, they keep their seat and give a rejoining player the other.

## The practice crewmate

The bot sits in the seat the player leaves free (it is a guest, so the host's `seats` event places it): head at the eye point, looking about now and then, hands resting in front of it. It moves over when the player changes seats. Driving and gunning for it come in F1.13.

## Tests

- `test/cabin.test.ts`: head boxes inside the armour, headroom, the turret transform matching Three.js, the head-box fixes, seat placement, the host's seat answer.
- `test/body-height.test.ts`: a seated player's eyes land on either seat's eye point.
- `test/sight.test.ts`: the sight hangs where a seated gunner can lean into it, and their head stops short of the lens.
- `test/z-fighting.test.ts`: the hull with the turret at several angles, the ground, the S1 sight inside the turret, the loading in the turret (F1.10), the seated crew avatars.
- `npm run test:xr`: in the driver's seat on entering VR, a lean stopped at the head box, a big jump reseating, the menu changing to the gunner's seat and back, the S1 sight from the gunner's seat, back in the seat after riding. Screenshots: `artifacts/xr-driver-seat.png`, `xr-gunner-seat.png`.
- `npm run test:net` (`ONLY_SEATS=1`, or `=lag`, for just this): the host in the driver's seat and the guest in the gunner's, the guest's ask swapping both, legs drawn in the crewmate's seat, on a clean link, after a rejoin and at 150 ms RTT; the practice crewmate in the free seat, moving over when the player changes seats.

`window.__seats` gives `mine`, `crew`, `ask(seat)`, `reseat()`, `eye(seat)`, `head()` and `fixes` (how often the head was stopped and the player reseated).

## Headset check

On a Quest 3, with a second headset or the practice crewmate:

1. Enter VR alone. You are in the driver's seat facing the vision slit, with the hatch open above. Your eyes are at a natural seated height, and the space in front of you is clear.
2. Lean forward towards the slit, then left and right. Your head stops before the front plate and the side wall, and the stop doesn't feel like being shoved.
3. Stand up and take a step. You are put back in the seat.
4. Game menu → Practice → Sit in Gunner. You are in the turret right of the gun, with the breech on your left at chest height.
5. Lean forward into the sight. It opens before your head stops, and your head stops just short of the lens.
6. Look round the turret and down into the hull: no flickering faces, no gaps to see through, and every surface is lit, not black.
7. Game menu → You → Back in my seat: you face forward at the eye point again.
8. With a crewmate (or `?bot=1` on a PC page), the crewmate sits in the other seat with its legs on the cushion, and swaps when either of you changes seats from the menu.
9. Perf HUD (X): frames stay within budget at 72 Hz in both seats.
