# Enemy anti-tank guns (F3.2)

The first enemies that shoot back: three anti-tank guns dug in on the left of the range's lane. Each one watches for the tank, lays on it and fires, and the crew has to find it by its flash, knock it out with AP on its shield or an HE burst beside it, or hide from it in smoke. The numbers live in [`src/sim/enemy-guns.ts`](../src/sim/enemy-guns.ts); the guns are drawn and run by [`src/systems/enemy-system.ts`](../src/systems/enemy-system.ts); the model is [`src/scene-assets/enemy-gun.scene-asset.ts`](../src/scene-assets/enemy-gun.scene-asset.ts).

## Enemy AI scope

The roadmap asked for the enemy AI's scope to be decided first, and the plan (§ open questions) already said: start from static anti-tank guns, then tanks on fixed routes (F3.3). For the guns that means:

- **Static**: each gun stays where it is dug in. It turns its barrel up to about 35° either way towards the tank, no further.
- **Eyes**: a gun sees the tank when it is within 600 m (inside the fog), the ground between doesn't hide it and no smoke bank stands in the way. It looks four times a second. Houses, walls and rocks don't hide the tank from it yet.
- **Laying and firing**: from first sight it takes 6 s to lay and fire, then fires every 8 s while it still sees the tank. Out of sight for 3 s, it loses the tank and must lay afresh (6 s) when it sees it again.
- **Aim**: its layer corrects by the fall of each shot, so its first shot is the least accurate and its third the best. It leads a moving tank, but not perfectly. No memory, no moving to new positions, no talking to the other guns.
- **Damage**: a hit is counted and called, and the hull rings; since F3.4 it also strikes the tank somewhere, meets its armour and may break something inside ([damage.md](damage.md)).

Say if any of this should change before F3.3 builds tanks on the same pattern.

Since F3.10 ([combat-scenario.md](combat-scenario.md)) a gun has to spot the tank before it lays (quicker on a moving tank or one that has just fired, slower on one hull down), houses, walls and rocks block its view, and its numbers are tuned in the game menu's Battle tab.

## What players experience

- **Combat → Enemy guns → Start** puts the tank back at the range's start with the engine running and brings the guns in. None of them can see the start. Driving up the lane, gun A first sees the tank about 80 m up it, from about 240 m out on the left; gun B from 160 m up, from about 230 m; gun C from 240 m up, close, about 120 m off the lane. A sign says "Enemy guns ahead: watch for their flashes".
- **Meet A / Meet B / Meet C** park the tank on the lane where that gun first sees it, facing up the lane (starting the guns if they aren't), so a headset check doesn't have to drive there.
- **The guns** are low, dark grey-green 75 mm guns behind an angled shield, on two wheels, with their trails spread behind and a few cut bushes either side for camouflage. Through the sight at 240 m the shield is about 9 mils across.
- **When a gun fires** there is a bright flash at its muzzle and a puff of dust in front of it, and an orange tracer streaks at the tank at 790 m/s (a third of a second at 250 m). Its first shot puts a note on the sign: "Gun A firing, 10 o'clock, 240 m". A miss low kicks up dirt in front of the tank; a miss high or wide lands well beyond it.
- **A hit**: a bright flash on the hull's near side, the hull rings (the bump sound for now), and the sign says "Hit! Gun B, 11 o'clock, 230 m" in red. Both crew see the same note. Hits are counted.
- **Knocking a gun out**: AP that strikes its shield, or an HE burst within 5 m of it (the guns are soft targets, as the range's gun board is since F3.1). The gun is drawn scorched dark, its shield askew and barrel drooping, and the sign says "Gun A knocked out"; once all three are, "All 3 guns knocked out". Shells then pass where it stood.
- **Smoke** (F3.1) between the tank and a gun hides the tank from it: it holds fire, loses the tank after 3 s, and has to lay afresh once the smoke thins.
- **Moving** spoils its aim: on a tank going 20 km/h it hits a good deal less often.
- The menu's line under the buttons: "2 of 3 guns in action, 1 knocked out. Hits taken 1 of 4 shots".

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Gun A, B, C | (−200, −220), (−90, −370), (−110, −280) world m; first see the lane at z −80, −160, −240 | The only spots near the lane, found by search, that can't see the start, see the lane over a long stretch, and have no rise between them and the lane, so their whole shield is in view when they first fire. The ground right of the lane is too open to hide a gun from the start |
| Muzzle velocity | 790 m/s | A 7.5 cm PaK 40's AP |
| Spot range | 600 m | Inside the fog's far edge (780 m) |
| First shot | 6 s after first sight (since F3.10: 8 s after it has spotted the tank, which takes time) | Traversing, laying and the order to fire |
| Reload | 8 s (since F3.10: 10 s) | A trained crew's aimed rate, slowed for play |
| Spread | 0.4 mil dispersion plus a laying error of 8, 4 then 2 mils on a sighting's first, second and later shots (since F3.10: 16, 9, 5 then 3); plus the tank's movement during the flight | At about 240 m on a stationary Sherman: about half the first shot, over 90% by the third (since F3.10: about one in seven, then nine in ten by the fourth). Moving at 20 km/h, much less |
| Lead | 80% of the tank's movement during the flight | Good but not perfect |
| Shield (the face shells hit) | 2.1 m × 1.24 m, its middle 0.82 m up | The model's shield |
| Tank as a target | 2.62 m wide, 5.84 m long, 2.74 m tall | An M4A4's |

## Sharing

The host runs the battery and decides everything:

- **`enemy`** (reliable): on, which guns are alive, hits and shots so far, and a version; sent when it changes, when the crewmate joins, and every 5 s while the guns are on. A guest draws the guns from it and turns their shields on or off as shells' targets.
- **`enemy-shot`** (reliable): one per shot: the gun, where it fired from and where the shell goes (world space), whether it hit, its flight time, and the clock direction and range for the sign. Both pages draw the same tracer and strike.
- **`enemy-ask`** (reliable): a guest's Start or Stop.
- A gun is knocked out by the host's usual hit decision (`decideShot`, F3.1): a shell the host decides hit gun A (target 9 of `targetFaces()`, after the range's 3 and the course's 6 boards) knocks it out when the shell gets there.
- No packet changes. The guns are frozen while the crewmate is away (`crewPresence.paused`).

Alone, this page is the host.

Since F3.3 the same battery and events also run the enemy tanks ([enemy-tanks.md](enemy-tanks.md)): enemies 0 to 2 are the guns and 3 and 4 the tanks, the guns and the tanks start and stop apart, and `window.__enemy.state().guns` lists all five.

## The practice crewmate

As gunner it engages a gun once that gun has fired (the crew has seen its flash) and is within the fog: before any range board, the nearest such gun, loading HE if the rack has it. It fires from a halt as before, asking the driver to halt. As driver it has nothing new to do: call it forward and halt it as before.

## Departures from the building skill

- No new sound: a hit rings the hull with the bump sound, and the guns' reports aren't heard. A distant report, a ricochet and a near miss's crack would come with a sound pass.
- The tracer flies straight: over a few hundred metres at 790 m/s a shell drops only a few centimetres.
- Obstacles (houses, walls, rocks) don't block the guns' view, only the ground and smoke do.

## Tests

- `test/enemy-guns.test.ts`: the spots (off the lane, clear of obstacles and the course, none seeing the start, each seeing the lane where Meet parks and its shield in the crew's view); the ground and smoke blocking sight; the 6 s lay and 8 s reload; losing the tank in smoke and laying afresh; accuracy improving shot by shot and falling on a moving tank; where hits and misses land; the clock direction; knocked-out guns falling silent; the shields as shells' targets, off until the battery is on, hit by AP and soft to HE; the shared state and shots read back, malformed ones refused; the menu line.
- `test/z-fighting.test.ts`: the gun whole and wrecked.
- `test/ammo.test.ts`, `test/biathlon.test.ts`, `test/course.test.ts`: the target list's new length and soft targets.
- `npm run test:xr` (step 6u, part 1): Meet A draws the guns with gun A seeing the tank; gun A's shells strike and a hit is called on the sign; AP on gun A's shield knocks it out (its wreck drawn, its shield gone from the targets, the sign); smoke laid between the tank and gun B hides it; Stop takes the guns away.
- `npm run test:net` (`ONLY_FIRING=1`, or `=lag`): the host's guns appear on both pages; a shot from gun A reaches the guest with the same outcome; the guest gunner's AP knocks gun A out on both pages; Stop takes them away on both.

`window.__enemy` gives `state()` (on, alive, hits, shots, each gun's seeing and laying, whether it is drawn, and which shields are off), `start(seed)`, `stop()`, `fireNow(i)`, `kill(i)`, `canSee(i)`, `shots()`, `meet(i)` and `sign`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Combat → Enemy guns → Meet A**. Take the gunner's seat and look left through the gunsight or periscope towards 10 o'clock: find gun A, about 240 m out. Say how easy it is to spot before it fires, and once it does (the flash and the dust).
2. Wait: within about 6 s it fires. Watch the tracer come in and where it lands; a hit puts "Hit! Gun A ..." on the sign and rings the hull. Say whether the tracer and the strike read well from inside, and whether the hit is too quiet.
3. Load AP, lay on its shield and fire: it is knocked out and drawn as a wreck, and the sign says so. Then **Meet B** and do the same with HE, bursting it on the ground beside the gun.
4. **Meet C**, and fire a smoke round between you and gun C: it stops firing once the smoke is up, and starts again a while after the smoke thins.
5. **Start**, take the driver's seat and drive up the lane, zigzagging: say whether the guns feel fair (too accurate, too slow, too easy to find).
6. With the crewmate as gunner (`?bot=1`), **Meet A** from the driver's seat: once gun A fires, the crewmate lays on it and fires HE.
7. Press **X** for the perf HUD with all three guns in view and a shell in the air: report the frame time and draw calls.
