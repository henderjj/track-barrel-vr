# Mechanism kit (F1.3)

Every control in the tank is one of five mechanisms, written once and shared by the stations that use them: the driver's tillers, gear lever and hand throttle (F1.5), the periscope (F1.6), the turret's traverse and elevation wheels and its power traverse grip (F1.8), and the breech lever and buttons (F1.10). It grew out of spike S3's tiller ([spikes/s3-lever-feel.md](spikes/s3-lever-feel.md)), whose tillers are now built from it.

- The mechanisms: [`src/sim/mechanism.ts`](../src/sim/mechanism.ts), engine-free and unit-tested in [`test/mechanism.test.ts`](../test/mechanism.test.ts).
- The system that drives them: [`src/systems/mechanism-system.ts`](../src/systems/mechanism-system.ts).
- Their models: [`src/scene-assets/mechanism.scene-asset.ts`](../src/scene-assets/mechanism.scene-asset.ts).
- A test bench with one of each: [`src/sim/mechanism-bench.ts`](../src/sim/mechanism-bench.ts) and [`src/systems/mechanism-bench-system.ts`](../src/systems/mechanism-bench-system.ts).

## What players experience

The same rules hold for every control, so once a player has used one they know them all.

- **Take hold** by squeezing the grip with the fist within 10 cm of a handle (6 cm of a button), with a controller or a tracked hand (a fist or a pinch). The glove closes on the handle and the controller gives a short buzz. If two handles are in reach, the nearer one is taken. A hand holding one control can't take another.
- **It follows the hand** from where it was taken hold of, so it never jumps. A lever follows the hand round its pivot, a wheel round its axle (as many turns as the hand makes), a twist grip the roll of the wrist, a yoke the hands round its upright. Only the movement that turns it counts: sliding along a handle, or nearer to or further from the axle, doesn't move it.
- **Limits and ticks.** At a stop the control halts with a firm buzz, the glove stays on the handle while the real hand carries on, and a light buzz repeats every 0.1 s, stronger the further the hand goes past. Detents and tick marks give a small buzz as they pass. 25 cm off the handle, the hand lets go (as for every handle).
- **Let go**, a sprung control (a tiller, a twist grip) goes back to its middle; a notched lever (a gear lever) drops into the notch it is nearest; a wheel, a friction lever (a hand throttle) or a yoke stays where it was left.
- **Buttons** are pressed by a fingertip (with the index finger off the trigger) or by a squeeze of the fist at the cap, which holds the button in while it lasts. A push button is on while it is in; a switch turns on with one press and off with the next. A fingertip on a cap (or a toggle's bat) works within 1 cm of its rim, and a squeeze with a fingertip on one takes that one rather than the nearest to the fist.
- **Toggle switches** (since John's headset check, 31 October 2026, for the driver's battery and ignition) are flicked up with a fingertip to turn on and down to turn off, once a flick, or flipped by a squeeze of the fist on the bat.

**Test rigs > Mechanism kit > In front of me** in the game menu (Y on the left controller) puts a bench in front of the player with one of each: from left to right a notched lever, a crank, a handwheel with stops, a twist grip with a trigger, a push button (red) and a switch (green), with a yoke on a column behind and a board reading each one out. **Put away** takes it away; **In front of me** again moves it to where the player is now and puts every control back at its start.

## The mechanisms

Each mechanism has its own space, which its owner places in the scene (on the hull, in the turret); the system gives it the hands in that space each frame. Angles are radians in the code and degrees here.

| Mechanism | Space | Follows | Limits | Let go | Used by |
| --- | --- | --- | --- | --- | --- |
| `Lever` | Pivot at the origin, swings about X, 0 upright, positive tips forwards (−Z) | Hand's angle round the pivot in the swing's plane | `min`/`max`; `overshoot` and `strain` say how far past | Springs to `rest` at rate `spring`, or to the nearest of `notches`; `spring: 0` stays | Tillers, gear lever, hand throttle, breech lever |
| `Lever` with a `ratchet` (F1.18) | As the lever | As the lever, but only the `ratchet` way (+1 forwards, −1 back) unless the holding hand's trigger is pulled (`freed`); held against the pawl it strains | As the lever | Stays | Parking brake ([parking-brake.md](parking-brake.md)) |
| `Lever` with a `forwardStop` (1 November 2026) | As the lever | As the lever, but it can't go forwards of `forwardStop` (set while it runs; null for none) | `min` to the stop | As the lever | The driver's tillers with a Sherman's controls, resting against a stop at upright ([gearbox.md](gearbox.md)) |
| `Wheel` (`grip: 'crank'`) | Axle along Z, face towards +Z, positive anticlockwise as seen from the front, knob at the top at 0 | Hand's angle round the axle, unwrapped (many turns), read each frame from where the hand was, so a hand going round a little off the axle still turns it smoothly | `min`/`max`, or ±Infinity | Stays | Manual traverse; elevation (with a `trigger` bar on its knob that fires) |
| `Wheel` (`grip: 'rim'`) | As the crank | Each hand on the rim; with two, the mean of where each would take it | As the crank | Stays | The bench's handwheel |
| `TwistGrip` | Handle up the Y axis, positive anticlockwise seen from above | The roll of the hand's back about the handle | ±`max` | Springs to the middle | Power traverse (trigger fires) |
| `Yoke` | Turns about Y, a handle out each side along ±X | Both hands as fast as they go; one hand no faster than `oneHandSpeed` | `min`/`max`, or ±Infinity | Stays | Periscope |
| `Button` | Cap's face at the origin facing +Z, goes in along −Z | Fingertip depth past the face, or fully in while squeezed | `travel` | Comes out; a `latching` switch stays on | The driver's starter and siren ([engine.md](engine.md)); signal buttons, fuses, radio |
| `Toggle` | The bat's pivot at the origin of a face facing +Z, +Y up the face; the bat leans `lean` up when on, down when off | A fingertip in the box round the bat that has been level with its middle or below and goes `TOGGLE_FLICK` (6 mm) above turns it on, the other way off, once until the finger leaves the bat; a fresh squeeze flips it once | ±`lean` | Stays | The driver's battery and ignition ([engine.md](engine.md)) |
| `PullKnob` | The knob's back face at the origin of a face facing +Z, drawn out along +Z | A fist on the knob draws it out and pushes it in; an unheld fingertip on its face pushes it in only. With `bar`, a T-handle: taken anywhere along its bar, and a fingertip doesn't move it | 0 to `travel` | Stays where it is let go, clicking at its `detents` | The driver's choke, a T-handle half out at the detent ([engine.md](engine.md)) |

Shared by all of them:

| What | Value | Where |
| --- | --- | --- |
| Grab reach from a handle's centre line | 10 cm (buttons 6 cm, from the cap's middle) | `REACH`, `Mechanism.reachRadius` |
| A hand nearer an axis than this can't turn it (a lever, a twist grip, a yoke); a wheel taken hold of this near takes the hand to be on its knob | 5 cm | `MIN_HAND_RADIUS` |
| Nearer a wheel's axle than this, a hand turns it less the nearer it is, rather than stopping it | half its radius | `NEAR_AXLE` |
| Hand filter, controllers | one-euro, 8 Hz at rest, β 0.5 | `CONTROLLER_FILTER` |
| Hand filter, tracked hands | one-euro, 1.5 Hz at rest, β 4 | `TRACKED_HAND_FILTER` |
| A limit or tick is felt again after backing off | 1° | `REARM` |
| Trigger fires above / lets go below | 0.6 / 0.4 | `TRIGGER_ON`, `TRIGGER_OFF` |
| Button presses at / comes back out at | 70% / 30% of its travel | `BUTTON_IN`, `BUTTON_OUT` |
| A fingertip presses while the index finger is curled less than | 0.6 | `POINTING`, MechanismSystem |
| Haptics | take hold 0.4 × 20 ms; limit 0.8 × 35 ms; detent or tick 0.3 × 15 ms; press 0.5 × 20 ms; past a limit 0.15–0.6 × 40 ms every 0.1 s | MechanismSystem |

The bench's controls (sizes for trying the kit, not the stations' final numbers):

| Control | Spec | Numbers |
| --- | --- | --- |
| Notched lever | `NOTCHED_LEVER` | 28 cm, the top 10 cm the handle, ±30°, notches at −25°, 0 and +25° |
| Crank | `CRANK` | 9 cm radius, 7 cm knob, turns for ever, a tick each quarter turn |
| Handwheel | `HANDWHEEL` | 12 cm radius, stops at two turns each way, a tick each eighth |
| Twist grip | `TWIST` | 11 cm handle, ±40°, 4° deadband, springs back at rate 12/s |
| Yoke | `YOKE` | handles 7 to 17 cm out each side, turns all the way round, 30°/s in one hand, a tick each 15° |
| Button, switch | `BUTTON`, `SWITCH` | 18 mm caps, 8 mm travel |
| Bench | `BENCH` | top 36 cm ahead of the eyes and 75 cm below them, 92 cm wide; every handle between knee and chest height and 20–65 cm ahead of a seated player's eyes |

## How it works

- **Following the hand** (`src/sim/mechanism.ts`). The hand's fist centre (where a handle runs through it, `FIST_CENTRE`) is taken into the mechanism's space and its angle measured round the mechanism's axis. On taking hold the mechanism keeps the difference between its angle and the hand's, so it never jumps. Each frame the hand's angle is unwrapped (a crank can turn many times), steadied by a one-euro filter (hard while the hand is still, hardly at all while it moves) and the mechanism goes there, clamped to its limits; what was clamped off is the strain. A lost hand, or one over the axis, holds the mechanism where it is for that frame.
- **The twist grip** reads a direction across the back of the fist (the grip space's +X made square to the fist's hole) and measures its roll about the handle. A hand lying along the handle can take hold; it twists once its roll means something.
- **The yoke with one hand** moves towards where the hand would take it at no more than `oneHandSpeed`, so the hand gets ahead of it, the drawn glove stays on the handle and the strain buzz says it is heavy.
- **Buttons** take the index fingertip where the hand draws it (`indexTip()` in `hand.scene-asset.ts`, from the finger's curls; since 1 November 2026, it had been `INDEX_TIP`, a straight finger's, up to 8 cm off the drawn one) when the hand holds nothing and its finger is out; a squeeze at the cap holds it in like a handle, without drawing the hand on it.
- **MechanismSystem** (registered after GripSystem and before the systems that read controls and OwnHandsSystem) lets go of controls whose grip was released or that were put away, takes hold of the nearest control in reach of a fresh squeeze, moves each control with its hands, buzzes, and calls each owner's `moved` to draw it.

## Building a station with it

```ts
const tiller = new Lever(DRIVER_TILLER);           // spec in src/sim/cabin.ts or a sibling
const mount = new Group();                          // the lever's space: at its pivot, doesn't turn
mount.position.set(...);                            // on the hull or in the turret
const pivot = new Group();                          // turns with the lever
pivot.add(createLever(DRIVER_TILLER));
mount.add(pivot);
this.cleanupFuncs.push(addControl({
  name: 'tiller-left',                              // what handUse says while held
  mech: tiller,
  frame: mount,
  kind: HoldKind.TillerLeft,                        // F1.5 adds it to HoldKind: 2–5 are kept for the driver
  active: () => this.inDriverSeat(),
  moved: () => { pivot.rotation.x = -tiller.angle; },
}));
```

- **Hands on controls.** Give each handle a `HoldKind` (2–5 driver controls, 6–7 traverse crank and elevation wheel, 12 power traverse grip, 8 periscope: [the reserved numbers](#numbers-kept-for-later-features)). `addControl` registers its grip-locking resolver and tells `holdKindOf` its name, so there is no case to add in `net-system.ts`. The crewmate's hand on it is drawn closed on the handle nearest it on this page; this player's at the place it took hold.
- **Sharing.** The kit sends nothing itself. Each station sends its controls' values in its own packet (driver controls, PacketType 6, F1.4/F1.5; turret, PacketType 7, F1.8), and on the other page sets the mechanism's angle from the packet while no hand of that page holds it (`mech.angle = …` in the station's system before the kit runs, or in `moved`). Each control belongs to one seat, so in practice only one player holds it; a control both players can hold at once would follow the skill's shared-control pattern (each sends its hands' contribution, the host combines).
- **Controls only this page has** (the bench, spike S3's tillers) use `HoldKind.LocalControl` (11), which is never sent, and are resolved by which of this player's hands holds which. 12 is the power traverse grip (F1.8).
- **Putting a control away**: `letGo(control)` makes every hand let go of it.

## Sharing and the host

Nothing about the bench is shared: it is drawn where this player put it, like spike S3's rig, and the crewmate sees their hand where it is rather than closed on a bench handle. What the host decides for the real controls (the tank's drive on the host, the turret's angle on the gunner's page) is the stations' design (plan decisions 1 and 2).

## The practice crewmate

The bench is one player's, so the bot has nothing to do on it. The stations teach the bot their controls through the kit's same mechanisms (F1.13).

## Departures from the building skill

Because the bench is a one-player test rig: no practice crewmate part and no network check (nothing is shared; the net test still covers the sent hold kinds), and the board's lines are drawn as text 10 times a second, which allocates a few short strings each time.

## Tests

- `test/mechanism.test.ts`: each mechanism follows the hand without jumping, stops at its limits with the strain measured and one tick per hit, ignores movement that doesn't turn it, ticks at detents and marks, holds for a lost hand, springs back, settles into notches or stays put; the crank over three turns and back; the rim's hand kept where it closed, at the stop too; two hands on a rim; the crewmate's hand on the nearest point; the twist grip's trigger with its hysteresis; the yoke fast in two hands and slow in one; buttons by fingertip and squeeze, and the switch; tracked-hand jitter steadied; the bench's handles in seated reach and far enough apart that a squeeze takes the one meant.
- `test/lever.test.ts`: spike S3's tillers in seated reach, and the lane.
- `test/z-fighting.test.ts`: the bench with every control at its ends and in between; S3's rig with its tillers upright and at both limits.
- `npm run test:xr`, step 5c: Test rigs > Mechanism kit puts the bench in front of the player; a crank followed round a full turn with its ticks; the notched lever let go past halfway settling into its notch; the yoke in one hand following slower than the hand with the strain felt; the twist grip twisting with the wrist and firing with the trigger; a squeeze pressing the button and turning the switch on. Screenshot: `artifacts/xr-mechanism-bench.png`. Step 5b (spike S3's tillers) and 6a (a tiller with a pinching tracked hand) now run on the kit.

`window.__mechanisms` gives `names()`, `state(name)` (who holds it, its readings in degrees, and counts of limits, detents and presses), `handle(name, which)`, `gap(name, point)` and `toScene(name, point)`; `window.__bench` gives `shown`, `show()`, `hide()`, `lines()`, `pulls` and each control's `names`.

## Numbers kept for later features

HoldKind 2–5 the driver's controls (F1.5: 2 left tiller, 3 right tiller, 4 gear lever, 5 hand throttle), 6–7 the traverse crank and elevation wheel and 12 the power traverse grip (F1.8), 8 the periscope's yoke (F1.6, taken), 9 a shell, 10 the breech lever (spike S4), 11 `LocalControl`; 13–15 are used by `test/hand-lock.test.ts`, so none is free.

## Headset check

After the deploy, open the game in the headset with the cache cleared (on Quest, close and reopen the tab). Play solo, sit down, and open the game menu (Y).

1. **Test rigs > Mechanism kit > In front of me.** A bench appears in front of you with a board above it. Everything is within reach without leaning far, and nothing flickers.
2. **Notched lever** (far left). Take hold: your glove closes on it with a buzz. Push it forwards: it ticks at the middle and at the front notch, and stops at its end with a firm buzz while your glove stays on the handle. Let go a little past halfway: it drops into the front notch. The board says which notch.
3. **Crank.** Take the knob and wind it round several times, both ways: it keeps up with your hand and ticks each quarter turn. The board counts turns.
4. **Handwheel.** Take the rim with one hand, then with both, and turn it: it follows. Wind it to its stop at two turns: it stops with a buzz and your gloves stay on the rim.
5. **Twist grip.** Take it and twist your wrist left and right: it twists with you up to its stops and springs back when let go. Pull the trigger while holding it: the board counts a pull and says FIRE.
6. **Yoke.** Take both handles and swing it round: it keeps up. Let go with one hand and swing it: it follows slower, with a light buzz while your hand is ahead of it.
7. **Button and switch.** Press the red button with a fingertip (finger off the trigger), then with a squeeze: it goes in and lights while held. Press the green switch: it stays in and lit; press again: it goes off.
8. **Tracked hands.** Put the controllers down and repeat 2, 3 and 7 with your hands (a fist or a pinch to take hold, a fingertip for the button).
9. **Test rigs > Lever test**: spike S3's tillers work as before (they are built from the kit now).
10. **Put away**: the bench goes. Perf HUD (X): frames stay within budget with the bench out.

Report, for each control: whether it followed your hand without lag or jumps, whether the stops and ticks were felt, and anything that took the wrong control when you squeezed.
