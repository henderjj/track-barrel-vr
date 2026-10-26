# Spike S4 (Track & Barrel): loading a shell

The question from the [plan](../plan.md#5-risks-and-spikes): can a seated player grab a shell, swing it to the breech, ram it and close the breech reliably in under about 5 seconds? Pass mark: ten loads in a row without a fumble, after some practice. (Not to be confused with [s4-networking.md](s4-networking.md), the airship template's fourth spike.)

Since F1.10 the drill is the gunner's loading in the turret, shared between the crew, and the gun fires: see [loading-firing.md](../loading-firing.md). Its station beside the tank and Practice → Sit at the breech are gone; the steps below are now done from Practice → Load and fire, and the numbers below are S4's (the rack and breech positions moved into the turret).

Status: built, unit-tested, and tested in the emulated headset (IWER, IWSDK's browser XR emulator) with the controller taking a shell, loading it and closing the breech. Whether it feels right, how fast it gets and how often it fumbles can only be found on a headset: the steps are at the end.

## What the player does

**Practice → Sit at the breech** in the game menu (Y) puts your head over a stool at the back of the deck, facing the gun, with the breech open and four shells in the ready rack. Choose **Playing: Seated** in the same menu and sit on a real chair first.

1. **Take a shell** from the rack on your right (two rows of two, lying nose forward, at 0.84 and 0.98 m: above a seated knee). Squeeze the grip anywhere along it; the shell stays where it was in your hand. Hold it near its base: the bore is 0.38 m to your left and 0.5 m ahead, and you push the base all the way to the mouth.
2. **Swing it across** to the breech on your left and put its nose to the breech mouth. Within 5 cm of the bore's line, from 8 cm short of the mouth to 4 cm in, and pointing within 20° of the bore, it snaps onto the bore with a short buzz. From then on it only slides along the bore; pull it 10 cm back out and it comes free in your hand again.
3. **Ram it home**, any of three ways: push it all the way while holding it (the hand lets go of it when it is home); shove it and let go, so it slides on at the speed you pushed it, slowing at 2 m/s² (a shove at 1.2 m/s travels about 35 cm); or let go part-way and push its base in with an open hand. Home gives a strong buzz.
4. **Close the breech**: take the red lever on the breech's right side (handle up when open) and pull it back towards you a quarter turn. The breech block slides up across the mouth as it turns. With a shell part-way in, the lever stops at about 17° (the block meets the case), with a long buzz: that counts as a fumble. Closed on a rammed shell, the lever latches and lets go of your hand, and the load counts.
5. The drill **fires** 1.5 s later: both controllers buzz, the breech opens and the shell goes back in the rack. The next load is timed from that moment.

A shell let go anywhere but in the breech falls to the deck (a fumble) and goes back in the rack a second after it lands; a seated player can't reach the deck.

The board on the post ahead of you shows the loads, the last and best time, the fumbles and the loads in a row without one out of ten ("10 in a row: passed"), and what to do next. Each load is also logged to the console as `[Loading] load N in T s (handling H s), F fumbles, S in a row`. The time is from the breech opening (or the drill starting) to it closing on a rammed shell; the handling time is from first taking hold of a shell.

## The numbers

All in `src/sim/loading.ts`, deck space (deck at y = 0, facing -Z), shared by the model, the system and the tests.

| What | Value |
| --- | --- |
| Seated eyes | (0, 1.45, 1.45): the seat's x and z, at seated play's eye height |
| Shell | 0.6 m long, 44 mm radius (a real 88 mm round is 0.93 m; shortened so a seated arm can ram it) |
| Rack slots | x 0.36 and 0.47, y 0.84 and 0.98, centred at z 1.15 |
| Breech mouth | (-0.38, 1.1, 0.95), bore to -Z |
| Lever | pivot (-0.23, 1.1, 0.89), 0.16 m to the handle, which sticks 4.5 cm towards you; open 0°, closed 90° |
| Grab reach | 7 cm from a shell's surface, 9 cm from the lever handle |
| Snap onto the bore | nose within 5 cm of the line, 8 cm outside to 4 cm in, within 20° |
| Let go | a hand 25 cm from what it holds lets go (as grip locking does) |
| Fire delay, return delay | 1.5 s, 1 s |

Every height is checked to be within a seated player's reach in `test/body-height.test.ts`.

## How it is built

- **Rules** (`src/sim/loading.ts`, engine-free): a `LoadingDrill` stepped once a frame with each hand's grip pose and squeeze. It holds the shells (rack, hand, breech, falling, floor), the lever angle, the shell in the breech and how far in, and the stats, and lists what happened each frame (grab, snap, rammed, closed, fumble, loaded, fired) for buzzes and the log. No allocation per frame.
- **Model** (`src/scene-assets/loading-drill.scene-asset.ts`): the breech ring, barrel, pedestal, block guides, rack, stool and board post as one mesh; the four shells, the breech block and the lever move. Registered in the z-fighting test with the breech open and closed and a shell rammed.
- **System** (`src/systems/loading-drill-system.ts`): reads the hands from the grip system (controllers or tracked hands), feeds the drill, sets `handUse` to `shell` or `breech-lever` while a hand holds one (so the throwables leave that hand alone, and a hand holding a block takes nothing here), buzzes, and draws the shells, block, lever and board. A hand on the lever is drawn closed round its handle (grip locking, `HoldKind.BreechLever`, number 10 as reserved for F1.10).
- **Practice button** in the menu's Practice section; **test hook** `window.__loading` (state, stats, start, reset, scripted hands, layout); a step in `scripts/xr-smoke-test.mjs`.

### What this spike leaves out

- **Not shared.** Each player has their own drill; the crewmate sees your hands but not your shells or lever. Loading and firing are shared in F1.10 (loaded and fired events, the shell drawn from the gunner's hand packets), so there is no network message, net test or practice-crewmate part here: loading is a one-person job.
- **One hand per shell.** A real 88 mm round weighs about 15 kg and takes two hands. Here one hand carries it; a second hand can't help yet. Whether that feels too light is a headset question (below).
- **The drill fires by itself.** There is no gunner, trigger, recoil, casing ejection or sound yet (F1.10 and F1.12). The breech opens itself after a shot, as the 88's semi-automatic breech did.
- **The station stands beside the tank.** It stood on the template's deck; since the cabin (F1.1) it stands beside the tank's left track on a platform level with the hull floor (`STATION_SPOT` in `src/sim/loading.ts`; its numbers are in station space, the old deck space), until F1.10 moves loading into the turret.

## Results in the cloud

| Test | Result |
| --- | --- |
| Unit tests (`test/loading.test.ts`, 12) | A full load (rack, swing, snap, push home, lever) counts, is timed from the breech opening, then fires, opens and puts the shell back. The snap refuses a nose 7 cm off the line and a shell 30° off the bore, and takes one 4 cm off and 15° off. A shell pulled 10 cm back comes free. A shove at about 1.4 m/s let go after 35 cm slides home; a shell left part-way is rammed by an open hand on its base. The lever stops at 17° on a shell not home and counts a fumble; a dropped shell is a fumble and returns to the rack. A hand holding a block takes nothing. Ten clean loads pass the streak |
| Seated reach (`test/body-height.test.ts`) | Every rack slot, the mouth and the lever's handle are between 0.45 and 1.4 m above the real floor for a seated player raised to 1.45 m eyes |
| Z-fighting (`test/z-fighting.test.ts`) | Station, block, lever and shells with the breech open and closed: no flickering faces |
| Emulated Quest 3 (`npm run test:xr`, step 6b) | Practice puts the head over the seat. The right controller takes a shell, the nose snaps onto the bore, a 0.66 m push rams it, and pulling the lever round closes the breech and counts the load (14 s in the emulator, which runs at 15–40 fps and moves the controller in scripted steps: not a measure of real speed). The drill fires and the shell is back in the rack. A shell let go away from the breech counts a fumble and returns. Every other check in the test still passes, with no console errors |

Not measured here: real load times, fumble rates, and whether the snap tolerances and the one-handed 0.6 m shell feel right. That is the headset check.

## Headset check

Choose **Playing: Seated** in the game menu and sit on a chair with room to swing your arms. Open the game menu (Y) and press **Practice → Sit at the breech**.

1. **Find everything.** Without leaning, you should see the rack of four shells by your right knee, the breech and barrel to your front left, and the board ahead. Say if anything is hard to reach from the chair.
2. **One slow load.** Take the near top shell near its base, swing it to the breech and put its nose in. It should snap onto the bore with a buzz and from then on slide only along it. Push it home (strong buzz), then pull the red lever back towards you. The board should count the load; after 1.5 s the breech opens and the shell is back in the rack.
3. **The three ways to ram.** Load once pushing all the way while holding, once with a shove and letting go, and once letting go half-way and pushing the base in with an open hand. Say which is natural and whether the slide after a shove looks right.
4. **Try to fumble.** Close the lever on a shell half-way in: it should stop with a long buzz and the board's fumbles go up. Drop a shell: it falls and goes back in the rack.
5. **Speed and the pass mark.** Load as fast as you comfortably can until the board says **10 in a row: passed** (or give up). Report the board's best and last times, the fumbles, and how many tries it took. The plan's mark is under about 5 s per load.
6. **Feel.** Is the snap onto the bore too forgiving, or too fussy (5 cm and 20°)? Is the 0.6 m shell too short to feel like a tank round, and is carrying it one-handed too light? Is the lever's direction (pull back to close) natural? With tracked hands (put the controllers down), try a load with a fist grip.

Report what the board says, not only how it felt.
