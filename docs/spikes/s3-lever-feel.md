# Spike S3: lever feel

Status: built and tested in the emulated headset with controllers and with tracked hands (pinch). Whether the levers feel natural, and whether a player can drive the lane with them within a few minutes (the plan's pass mark), can only be judged in a headset: the steps are at the end.

The question from [the plan](../plan.md#5-risks-and-spikes): does a hand-following lever with limits feel natural and stay stable with controllers and tracked hands? The answer decides how the mechanism kit (F1.3) builds every lever in the tank: the tillers, the gear lever, the hand throttle and the breech lever.

## What the player gets

**Practice > Lever test > In front of me** in the game menu (Y on the left controller) puts a test rig in front of the player, facing the way they face: two tank tillers coming up out of a housing on a post, and a board above them showing a winding lane from above with a tank on it. **Put away** hides it. Pressing **In front of me** again moves the rig to where the player is now and starts the lane afresh.

- **Take hold** of a tiller by squeezing the grip with the fist within 10 cm of its handle (with tracked hands, a fist or a pinch, as for everything else). The glove closes on the handle (grip locking, [hands.md](../hands.md)) and the controller gives a short buzz.
- **Push and pull.** The tiller follows the hand round its pivot. Only the hand's movement in the tiller's swing matters; moving sideways or up and down along the handle doesn't move it. It never jumps on taking hold, wherever on the handle the hand closes.
- **Limits.** Each tiller goes 25° forwards and 25° back. At a limit it stops, with a firm tick in the hand. The drawn hand stays on the handle while the real hand carries on, and a light buzz repeats every 0.1 s, stronger the further past the limit the real hand goes, so the player feels they are pushing against a stop. Pulled more than 25 cm from the handle, the hand lets go (as for every handle).
- **The middle.** A small tick as the tiller passes upright while held.
- **Let go**, and the tiller springs back upright, most of the way in about a third of a second.
- **The lane.** Each tiller drives one track of the tank on the board, as in a real tank: both forwards to go, one ahead of the other to turn, opposed to turn on the spot, both back to reverse. The board shows the run's time, the time spent off the lane (the tank turns red), the best time this session, and each tiller's demand as a bar down each side (yellow while held). The lane is about 105 m long with three bends, 6 m wide for a 3.4 m wide tank. After finishing, or with the tank off the lane, letting go of both tillers for 3 s starts again.

## Numbers

| What | Value | Where |
| --- | --- | --- |
| Tiller length, pivot to top | 45 cm, the top 12 cm the handle | `TILLER` in `src/sim/lever.ts` |
| Travel | ±25°, rest upright | `TILLER` |
| Spring back | exponential, rate 10/s (63% in 0.1 s, 95% in 0.3 s) | `TILLER.spring` |
| Deadband round upright, read as no drive | ±2° | `TILLER.deadband` |
| Grab reach from the handle's centre line | 10 cm | `LEVER_RIG.reach` |
| Rig placement | pivots 42 cm ahead of the eyes and 1 m below them, 34 cm apart | `LEVER_RIG` |
| Hand filter, controllers | one-euro, 8 Hz at rest, β 0.5 | `CONTROLLER_FILTER` |
| Hand filter, tracked hands | one-euro, 1.5 Hz at rest, β 4 | `TRACKED_HAND_FILTER` |
| Haptics | take hold 0.4 × 20 ms; limit 0.8 × 35 ms; middle 0.3 × 15 ms; past a limit 0.15–0.6 × 40 ms every 0.1 s | `LeverSystem` |
| Lane tank | tracks 2.8 m apart, 5 m/s (18 km/h) each at full tiller, reaching it at rate 2.5/s | `src/sim/lever-lane.ts` |
| Board | 42 cm square, 25° tilted back, 20 redraws a second | `LEVER_RIG.board`, `LeverSystem` |

The rig is placed from the eyes, not the floor, so the handles land at lap height a forearm's length ahead whether the player stands or sits; seated (eyes raised to 1.45 m) the handles are about 0.84 m up in the game, 0.6 m above a chair player's real floor, within the seated reach `test/body-height.test.ts` uses.

## How it works

- **The lever** (`src/sim/lever.ts`, engine-free). The hand's position is taken into lever space and its angle round the pivot measured in the plane the lever swings in. On taking hold the lever keeps the difference between its angle and the hand's, so it never jumps. Each frame the angle is the hand's angle plus that difference, clamped to the limits; the amount clamped off is the overshoot. Let go, it eases back to rest. A hand closer than 5 cm to the pivot can't steer it (its angle there is meaningless); a lost hand holds the lever where it is for that frame.
- **Steadiness.** Tracked hands jitter by a few millimetres, about a degree on a 39 cm lever arm. A [one-euro filter](https://gery.casiez.net/1euro/) on the hand's angle smooths hard while the hand is nearly still and hardly at all while it moves, so a held lever stays still without lagging behind a deliberate push. Unit-tested: ±0.6° of jitter becomes under 0.3° of wobble, and a 15° push in 0.2 s is followed to within 2° 0.1 s after it ends. Controllers get a much lighter filter.
- **Which point is the hand.** The middle of the fist (where a handle runs through it, `FIST_CENTRE`), not the controller's grip origin, so a hand closed on the handle and the lever agree on where the hand is.
- **Hands on the handle.** Each tiller has a `HoldKind` (11 and 12) with a resolver that returns the point on the handle nearest the hand and the lever's direction, so OwnHandsSystem draws the glove closed on the handle, keeping the hand's twist, and lets go at 25 cm.
- **One player's.** The rig is drawn where this player put it and its tillers aren't shared. The two hold kinds are in `LOCAL_HOLD_KINDS` and sent to the crewmate as nothing held, so their page doesn't pull the hand onto its own rig. Shared controls come with the mechanism kit (F1.3), following the skill's pattern.
- **The lane** (`src/sim/lever-lane.ts`, engine-free) is a stand-in for the tank drive (F1.4): skid steering, each track easing to its tiller's demand, the tank moving at their mean and turning by their difference. It exists so the plan's pass mark can be tried before there is a tank to ride.

Testing note: the emulator's CLI moves one controller after the other, so in the test the tank turns while only one tiller is forwards; the test starts the lane again once both are.

Departures from the building skill, because this is a one-player spike: no practice crewmate part and no network check (nothing is shared); the Practice shortcut is the way in rather than a URL switch; the board's figures are drawn as text 20 times a second, which allocates a few short strings each time.

## Results in the cloud

| Test | Result |
| --- | --- |
| Unit tests (`test/lever.test.ts`, 14) | Hand angle round the pivot; no jump on taking hold; follows the hand; stops at both limits with the overshoot measured and one tick per hit (felt again after backing off); ignores sideways movement and distance from the pivot; a tick at the middle; holds for a lost hand; springs back; drive demand with its deadband; tracked-hand jitter steadied without lag; handles in seated reach at every angle; the lane's distance measure, straight driving, turning, turning on the spot, a simple steering rule finishing the 105 m lane in 24 s without leaving it, and time off the lane counted |
| Z-fighting (`test/z-fighting.test.ts`) | The rig with its tillers upright and at both limits: no faces sharing a plane |
| Emulated headset, controller (`npm run test:xr`, step 5b) | Practice > Lever test puts the handles 0.99 m up and 0.42 m ahead for a standing 1.6 m head. Squeezing at the handle takes hold, the glove closed on it. A 15 cm push turns the tiller 23.8°. Pushed 32 cm, it stops at 25° with one limit tick while the hand is 20° past, the drawn fist still on the handle (0.0 cm off). Pulled 45 cm off, the hand lets go and the tiller is back upright within the check's polling. Both tillers forwards drive the tank 6.2 m straight up the lane in 1.6 s |
| Emulated headset, tracked hand pinching (step 6b) | A pinch at the handle takes hold; moving the hand 12 cm forwards turns the tiller 16.4°; letting go of the pinch lets go |

## Questions for the headset

1. Does a 45 cm tiller with ±25° of travel feel like a heavy tank's tiller, or does it want more travel, a longer lever or some resistance (the lever moving less than the hand near the limits)?
2. Is the drawn hand staying on the handle at the limit, with the strain buzz, a convincing stop, or does the gap between the real and the drawn hand feel wrong? If it does, fall back to a softer limit (a few degrees of give before it stops).
3. Do tracked hands hold a tiller steady, and does the filter make it feel sluggish?
4. Does the spring back help or hinder? Real tillers do spring back; the gear lever and throttle won't.
5. Is the handle where the hands expect it, seated and standing?

## Headset check

After the deploy, open the game in the headset with the cache cleared (Ctrl+Shift+R on a PC page; on Quest, close and reopen the tab). Note the wrist HUD (X on the left controller): its buzz line says whether the controllers can buzz.

1. **Practice.** Play solo, open the game menu (Y), and press **Practice > Lever test > In front of me**. Two tillers and a board appear in front of you. Sit down and press it again: they move to suit you.
2. **One tiller.** Squeeze the grip on the right tiller's handle. Your glove should close on it with a buzz. Push it forwards and pull it back slowly: it should follow your hand exactly, with a tick as it passes upright.
3. **Limits.** Push it as far forwards as it goes and keep pushing: it stops with a firm tick, your glove stays on the handle, and a light buzz grows the further you push. Keep going: about 25 cm past, your hand lets go and the tiller springs upright.
4. **The lane.** Take both tillers and drive the tank on the board from the start line to the finish line: both forwards to go, one ahead of the other to turn. Note your time and time off the lane on your first try and after a few minutes (the board keeps your best). Pass: you can drive the lane cleanly within a few minutes.
5. **Tracked hands.** Put the controllers down and repeat 2 to 4 with your hands, gripping with a fist or a pinch. The tiller should hold still while your hand does, and not lag a deliberate push.
6. **Put away.** Press **Practice > Lever test > Put away**: the rig goes.

Report the board's times from step 4, and an answer to each question above.
