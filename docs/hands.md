# Hands

Each player sees their own hands as low-poly gloves posed from the controllers or tracked hands, and sees the crewmate's the same way. No arms are drawn: elbow angles worked out from the hands never looked right in the headset. While a hand grips a handle it is drawn closed on the handle (grip locking). This note is how it was built in the game this template came from; the numbers are the ones in the code.

## Controller models are never loaded

IWSDK draws the WebXR input-profile model of each controller (and a generic hand model for tracked hands) at its grip pose, fetched from a CDN. Hiding them isn't enough: IWSDK 1.0.1's input manager sets the model visible again every frame (`visualAdapter.visual.model.visible = isPrimary` in `XRInputManager.updateControllersAndHands`), so they showed inside the gloves. `OwnHandsSystem` stops the adapters loading a model at all. On Quest 3 that saves two models of 4,470 triangles in six draw calls each, a 430 KB download and their per-frame button animation. The emulated-headset test checks the models stay unloaded.

In WebXR the grip space's origin is the middle of the fist, −Z runs along the controller's handle towards the thumb and +X points out of the back of a right hand ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/XRInputSource/gripSpace)). The glove is modelled in its own wrist frame and placed in grip space with IWSDK's wrist pose for a hand squeezing a controller (`AnimatedControllerHand.pressedPose`). Left hands are the right one mirrored, as the grip spaces are.

## Posed low-poly hands

A fist, pointing, a flat hand and a thumbs-up, from what the controllers report.

### What the controllers report

Quest Touch Plus controllers (Quest 3) use the `meta-quest-touch-plus` input profile ([registry](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/meta/meta-quest-touch-plus.json)) with the `xr-standard` gamepad mapping:

| Index | Control | Gives |
| --- | --- | --- |
| 0 | Trigger | value 0–1, touched |
| 1 | Grip (squeeze) | value 0–1 |
| 3 | Thumbstick | pressed, touched, axes 2–3 |
| 4, 5 | A/B (right) or X/Y (left) | pressed, touched |
| 6 | Thumb rest | touched |

IWSDK exposes these as `getButtonValue(id)` and `getButtonTouched(id)` on `this.input.xr.gamepads[side]`. The trigger, thumbstick, face buttons and thumb rest have capacitive sensors, which is what Meta's own apps use to pose hands on controllers. The grip has only its pull value. The wrist perf HUD (X button) shows two lines for it, one per controller: the trigger and grip values, then `*` for each sensor that reports a touch (`trig`, `st` thumbstick, `lo` and `up` the lower and upper face buttons, `rest` the thumb rest), and the pose they give. Until a controller has reported a touch at all, its sensors count as unknown and its hand rests on the controller (index on the trigger, thumb down), so a browser that never reports touches gives fists and relaxed hands rather than pointing with its thumb up.

### Poses from the inputs

Each hand has three finger groups, each with a curl from 0 (open) to 1 (closed), eased towards its target with a 25 ms time constant (most of the way in about 50 ms) so they don't snap (`src/sim/hand-pose.ts`, read each frame in `GripSystem`):

- **Index finger:** 0.12 when the trigger is not touched (lifted off, so it points), 0.4 when resting on it, rising to 1 with the trigger's pull. A pulled trigger counts as touched.
- **Middle, ring and little fingers:** the grip's pull, from a relaxed 0.1 to 1.
- **Thumb:** down on the controller when the thumbstick, either face button or the thumb rest is touched; lifted and straight when none is.

That gives the named poses for free: a flat hand (nothing held), a fist (grip and trigger pulled, thumb down), pointing (grip pulled, finger off the trigger) and a thumbs-up (grip pulled, thumb lifted). With tracked hands, the same three curls come from the joints: each finger's straightness as `src/sim/hand-grip.ts` measures it for fist grips (spike S9; 0.97 straight to 0.45 curled), and the thumb from its tip's distance to the index knuckle (7 cm lifted to 3.5 cm tucked in), so one hand model serves both.

### The model

A procedurally built, flat-shaded skinned mesh per hand (`src/scene-assets/hand.scene-asset.ts`), like the rest of the low-poly models: a palm block with a knuckle ridge and a thumb heel, three box segments per finger and three for the thumb, each segment weighted fully to one bone (rigid skinning, which keeps the faceted look and needs no weight painting). Segments overlap past each joint so a bent joint shows no notch. 16 bones and about 300 triangles with the cuff and its band (the old glove was 124), one draw call per hand as before, coloured by vertex like the avatars. Built in code rather than loaded, so there is nothing to download and it can't fail to arrive. The gauntlet cuff ends in a narrow band of the player's coat colour, so the two players' hands are told apart. A fully curled finger bends 83°, 100° and 52° at its three joints; the thumb turns from lying out along the palm to across the front of the curled fingers. The left hand is the right one mirrored.

The CPU cost is setting 15 bone rotations per hand per frame from three numbers; skinning runs on the GPU. The crewmate's hands take the three curls too: three bytes per hand at the end of the pose packet. A packet without them, from a page on an older build, draws fists. The practice crewmate's scripted hands are sent closed while they hold something and relaxed otherwise.

Pictures of each pose in the emulated headset: the XR test saves `artifacts/xr-hands-flat.png`, `-fist`, `-point` and `-thumbs-up` (CI uploads them with the test artifacts).

Alternatives considered: morph targets per finger group (cheap, but blending straight lines between open and closed shortens fingers mid-curl), swapping between pre-built pose meshes (no smooth transitions) and the input-profile hand models (realistic rather than low-poly, a CDN download, and the same per-frame re-show bug as the controllers).

## Locking hands to what they hold

While a hand grips a handle (a crank, a rope, a lever, a wheel: whatever the game adds), the hand is drawn on the handle instead of at the controller, closed round it. Built in `src/systems/hand-lock.ts`:

- **Where each control is held.** Controls built from the mechanism kit ([mechanisms.md](mechanisms.md)) get their resolver from `addControl`. Any other control's system registers a resolver for its `HoldKind`: the point on the handle's centre line the palm closes round, and which way the handle runs. In the airship, a crank was held along its rod, a rope at the point level with the real hand along the rope, a tiller at the middle of its grip.
- **How the hand sits on it.** The drawn hand goes so the handle runs through the middle of the closed fist (the hole the curled fingers make, which lies 47° off the controller's grip axis: `FIST_AXIS`), turned only as far as that takes, so it keeps the twist the player's real hand has about the handle. Which way round the hand holds a handle follows the controller, fixed when it takes hold. The fingers close.
- **Easing.** Taking hold and letting go ease the drawn hand between the controller and the handle over 80 ms (smoothstep).
- **Letting go.** A grip ends when the grip button is let go, and also when the real hand is more than 25 cm from what it holds: the grip then reads as released until the button is let go (`forcedRelease` in GripSystem), so the drawn hand never stretches far from the real one.
- **The crewmate.** Each pose packet ends with one byte saying what each hand holds (four bits per hand, so up to fifteen kinds), and the crewmate's hands are locked the same way to the controls as drawn on this page; otherwise their hand would be drawn where the handle was a network delay ago. Map each system's `handUse` name to its kind in `holdKindOf` (`src/systems/net-system.ts`).
- **Order.** OwnHandsSystem runs after the systems that move controls, so a locked hand sits on its handle in the same frame the handle moves; it also locks the crewmate's hands (through NetSystem).

Checks: unit tests for the easing, the turn onto the handle and the kept twist (`test/hand-lock.test.ts`). When you add a handle, add an XR step that the drawn hand sits on it while it is worked and that pulling the hand 40 cm off lets go, and a net check that the crewmate's hand is drawn on it.
