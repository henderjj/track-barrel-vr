# Enemy tanks on fixed routes (F3.3)

Two enemy tanks that patrol fixed routes, there and back, well off the range's lane. Each halts to fire once it has the crew's tank in sight and drives on when it loses it. They join the F3.2 guns ([enemy-guns.md](enemy-guns.md)) in the same battery, which looks, lays and fires for both, so everything there about sight, smoke, laying and sharing holds for the tanks too. The routes and how a tank moves are in [`src/sim/enemy-tanks.ts`](../src/sim/enemy-tanks.ts); the battery is [`src/sim/enemy-guns.ts`](../src/sim/enemy-guns.ts); [`src/systems/enemy-system.ts`](../src/systems/enemy-system.ts) draws them; the model is [`src/scene-assets/enemy-tank.scene-asset.ts`](../src/scene-assets/enemy-tank.scene-asset.ts).

## Enemy AI scope

As the plan said, fixed routes after the static guns:

- **Routes**: each tank drives its route at 4 m/s (about 14 km/h), out and back, for ever. No path finding, no reacting to the crew beyond halting and turning its turret.
- **Eyes**: it sees the crew's tank within 400 m (buttoned up, less far than a dug-in gun's crew) when the ground and smoke don't hide it, looking four times a second. Neither route comes within 400 m of the range's start.
- **Halting to fire**: once it sees the tank it halts, turns its turret on it, and fires 5 s later, then every 7 s while it still sees it. Out of sight 4 s, it loses the tank and drives on.
- **Aim**: as the guns' (the same 0.4 mil dispersion, the same laying errors corrected shot by shot, the same lead), from its turret's muzzle 1.95 m up.
- **Armour**: only AP knocks a tank out. HE bursts on its armour to no effect ("HE on tank A: no effect on its armour"), and an HE burst beside it does nothing.
- **Damage**: hits on the crew's tank are counted and called as the guns' are, and do what F3.4's damage model says ([damage.md](damage.md)).

## What players experience

- **Combat → Enemy tanks → Start** puts the tank back at the range's start with the engine running and brings the tanks in: "Enemy tanks about: watch for them moving". Tank A patrols east and west about 380 m up the range, beyond the biathlon field on the right; tank B north-east and south-west on the far left, beyond the guns. Neither can see the start; driving up the lane, each comes into range from about 100 to 150 m up it.
- **Meet A / Meet B** put that tank partway along its route and park the crew's tank on the lane facing up it where that tank sees it (A at 230 m up the lane, B at 300 m), starting the tanks if they aren't.
- **The tanks** are a generic late-war medium tank in dark yellow: a boxy hull over its tracks with a sloped glacis, a box turret with a cupola and a long gun. On the move the turret faces ahead; halted for the crew's tank it turns its turret onto it at about 30°/s, then fires.
- **Hitting one on the move** needs a lead: at 300 m an AP shell takes half a second, in which the tank drives 2 m. A tank seen side-on is 5.9 m long, seen head-on 2.9 m wide.
- **Knocked out**: drawn scorched dark, its turret knocked round and askew on its ring and its gun drooping; the sign says "Tank A knocked out", then "Both tanks knocked out".
- The menu's line under the buttons: "1 of 2 tanks in action, 1 knocked out. Hits taken 2 of 5 shots" (hits taken counts the guns' and the tanks' shots).
- The guns and the tanks start and stop apart, and both can run at once.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Tank A's route | (330, −380) to (140, −380), 190 m | Open ground beyond the biathlon field, across the line of sight from the lane, out of 400 m of the start |
| Tank B's route | (−310, −305) to (−190, −395), 150 m | Open ground on the far left beyond the guns, clear of the houses and walls, out of 400 m of the start |
| Speed | 4 m/s | A medium tank across country, slow enough to hit with a lead |
| Spot range | 400 m | Buttoned up; keeps the start out of sight |
| First shot / reload | 5 s / 7 s (since F3.10: 7 s / 9 s, after spotting the tank) | Halting, traversing and laying; a tank gun's aimed rate, slowed for play |
| Lose the tank after | 4 s out of sight | Then it drives on |
| Muzzle | 1.95 m up, 3.3 m ahead of the turret's middle; 790 m/s | A long 75 mm |
| Size as a target | 5.9 m long, 2.9 m wide, 2.6 m tall | The model |
| Turret traverse | 0.5 rad/s | Drawn only |

## Sharing

The F3.2 events carry the tanks too:

- **`enemy`** gains which enemies are there (`present`, the guns and the tanks start apart), each tank's distance along its route (`d`) and whether it is driving on (`moving`). The host sends it when a tank halts or drives on, besides the old reasons; between messages a guest drives its tanks on at their speed, and each message puts them back where the host has them. A message from a build before F3.3 reads as the guns only.
- **`enemy-shot`** as before; enemy 3 and 4 are the tanks.
- **`enemy-ask`** gains `group` (`guns` or `tanks`) and `meet` (a tank's Meet: the host starts the tanks if need be, places that tank and parks the crew's tank).
- Each tank is a target for the crew's shells (targets 12 and 13 of `targetFaces()`, after the guns' 9 to 11): a face square to the crew's tank the size of its silhouette that way, front, side or between, moved every frame (`setFacePose`) to where an AP shell fired now would find it. The host decides hits as before; `armouredTargets()` tells `decideShot` only AP counts on them.
- No packet changes.

## The practice crewmate

As gunner it engages a tank as soon as it is in range (in the open, a tank shows itself; a gun only once it has fired), the nearest enemy first, before any range board, loading AP for a tank and HE for a gun. It lays on the tank's moving face, so it leads it.

## Departures from the building skill

- The tanks drive through nothing in their way because their routes are clear; they don't avoid the crew's tank, which has no reason to drive there.
- The tanks' tracks don't turn and they leave no track marks or dust; the engine isn't heard.
- The turret's traverse is drawn only: the battery's laying time already covers it.
- A tank seen at an angle is a flat face the size of its silhouette that way, not a box: close enough for hits at these ranges.

## Tests

- `test/enemy-tanks.test.ts`: the routes (off the lane, clear of obstacles, the course and the guns); driving there and back, facing the way they go; never seeing the start, seeing the tank where Meet parks it; driving on, halting to lay and fire, driving on again after smoke, stopping when knocked out; their own muzzle and numbers, missing more on a moving tank; starting apart from the guns; the face square to the crew, side or front, ahead where the shell finds it; armour (AP counts, HE direct or beside doesn't); the shared state, with an older message; the menu line.
- `test/z-fighting.test.ts`: the tank with its turret turned every way, and the wreck.
- `npm run test:xr` (step 6v, part 1): Meet A draws both tanks, tank A seeing the crew's tank and halting; it fires and hits are called; HE on it does nothing; AP knocks it out (its wreck drawn, the sign); tank B drives on its route; Stop takes them away.
- `npm run test:net` (`ONLY_FIRING=1`): the host's tanks appear on both pages, driving, within a few metres of each other; a guest's Meet B; the guest gunner's AP knocks tank B out on both pages; Stop.

`window.__enemy` adds `start(seed, 'tanks')`, `stop('tanks')`, `hold(i, held)`, `place(i, d)`, `meetTank(j)`, and in `state().guns` each one's group, whether it is there, how far along its route, whether it drives on, where it is drawn and its turret's turn.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Combat → Enemy tanks → Meet A**. From the gunner's seat look right of ahead (about 1 to 2 o'clock) through the gunsight: find tank A, about 280 m out. Say how readable it is (shape, colour, the turret turning on you).
2. Wait for it to fire: the flash at its gun, the tracer, the hit or miss.
3. Fire HE at it: the sign says it does nothing. Then AP: it is knocked out and drawn as a wreck.
4. **Meet B**, and before it halts, try hitting it on the move with AP, leading it. Say whether the lead feels right.
5. **Start**, take the driver's seat and drive up the lane with the guns started too: say whether the fight feels fair.
6. With the crewmate as gunner (`?bot=1`), **Meet A** from the driver's seat: the crewmate lays on tank A and fires AP.
7. Press **X** for the perf HUD with both tanks and the guns in view: report the frame time and draw calls.
