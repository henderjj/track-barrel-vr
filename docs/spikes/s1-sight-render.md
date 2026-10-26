# Spike S1: magnified sight render

Status: merged in #3 (2026-10-26), waiting on the headset check below. Roadmap F0.3.

The question from the [plan](../plan.md#5-risks-and-spikes): does a 512² second-camera view fit Quest 3's budget alongside the rest of the scene, and is it readable? Pass mark: holds 90 Hz with the sight open, and the range marks are readable at 3×.

## What was built

A stand-in gunsight on a post at the deck's far right corner, looking out at three target boards 100, 250 and 500 m away on a grass plain beyond the deck. It stays until the turret (F1.8), the gunsight (F1.9) and the test range (F1.7) replace it.

- **The view is a second camera rendered into a texture.** A camera at the sight's objective, with a 12° field (±6°), renders the whole scene into a 512² texture with 4× multisampling, but only while an eye is at the eyepiece: within 9 cm of the lens and behind it, staying open out to 12 cm so it doesn't flicker on the edge. Further away the lens is dark glass and nothing extra is drawn. WebXR doesn't let a page change the headset's own projection, so this is the only way to magnify.
- **The lens shows the picture at infinity.** Its shader works out, for each eye, the direction of that eye's ray through each point of the lens, divides the ray's angle off the sight's axis by the magnification (3×), and looks the picture up at that true angle. The result behaves like a real eyepiece: the magnification is right wherever the eye is, both eyes see the distant scene in the same place without crossing their eyes at the lens 6 cm away, and backing off narrows the field rather than shrinking the picture. The full field is about ±18° to the eye. Under multiview (both eyes drawn in one pass, as the Quest Browser does) each eye's position comes from its own view matrix.
- **One eye or both.** The plan proposed drawing the picture to one eye and leaving the other dark, as when you shut one eye at a real sight. Because the picture is at infinity, both eyes can see it comfortably for no extra cost, so both is the starting point and one eye is a menu choice to compare.
- **Reticle.** An aiming chevron on the gun's line, lead chevrons every 4 mils either side, and range marks below it every 100 m out to 1000 m, long and numbered (2, 4, 6, 8, 10 hundred metres) every 200 m. A mark sits below the middle by the angle the gun must point above a target at that range for an armour-piercing shell at 600 m/s with no drag (plan §4.6), so laying the mark on a target lays the gun right. The reticle is its own 1024² texture over the picture, so it stays sharp whatever the picture's size. At 600 m/s the marks are only about 1.4 mils (0.08°) apart per 100 m, about 0.24° to the eye at 3× or roughly 5 of the Quest 3's pixels: whether they can be read is the second half of the question.
- **Targets.** Each board is 3 × 2.2 m with a dark tank silhouette and orange squares on top, one per hundred metres in its range's first digit (one, two, five), so they can be told apart through the sight.

The code: `src/sim/sight.ts` (the sums, unit-tested in `test/sight.test.ts`), `src/scene-assets/sight.scene-asset.ts` (stand, sight and range, in `test/z-fighting.test.ts`), `src/systems/sight-system.ts` (the camera, the texture, the lens shader and the reticle), and `src/perf/gpu-timer.ts` (GPU timing where the browser offers it).

### Measuring it

- **Perf HUD** (X on the left controller, H on a PC page): a new bottom line shows the sight while it renders, for example `sight 512² both cpu 0.42 gpu 1.10 ms 14 calls 25k`: the texture, the eyes it shows to, the main-thread time of its render call, its GPU time, and its draw calls and triangles. The GPU time comes from WebGL's timer queries where the browser offers them and shows `-` where it doesn't. The fps, frame time and draw-call numbers above it are the whole frame as before, and the console logs a `[Sight]` line every 10 s while it renders.
- **Practice → Gunsight (S1)** in the game menu (Y): **Go to it** puts your head 15 cm behind the eyepiece facing along the sight; **Aim** steps the sight from straight ahead to each target laid on its range mark (100, 250, 500 m), so you can see whether a mark sits on its target.
- **Practice → Sight render**: **Draw** steps between *near* (only with an eye at the eyepiece, the real behaviour), *always* (every frame, wherever you are, to compare fps with and without it) and *off*; the size steps between 256², 512² and 1024²; the eye steps between both, left and right.
- `window.__sight` for the tests: state and stats, go to it, aim, draw mode, size, eyes, and a check that the picture has something in it.

### Results in the cloud

| Test | Result |
| --- | --- |
| Unit tests | 3× magnification at any angle; the field's edge at 18° to the eye; a far point lands in the same place for both eyes; opening at 9 cm and closing at 12 cm; range marks further down for further ranges, 6.8 mils for 500 m; each target laid on its mark; all three targets in the field looking ahead |
| Z-fighting test | The stand, the sight straight and aimed, the lens, and the range with the deck's ground: no faces sharing a plane |
| XR test (emulated Quest 3) | Go to it puts the head 15 cm behind the eyepiece; leaning in to 6 cm opens the sight and renders a picture with the targets in it (`artifacts/xr-sight.png`, and laid on the 500 m target in `xr-sight-500m.png`); leaning back closes it and rendering stops; Draw always renders from anywhere; the menu's size button changes the texture |

The cloud's software renderer can't say anything about Quest 3 frame times (it took about 0.5 ms of main-thread time and, by the timer queries it does offer, 57 ms of software "GPU" time for the sight's 5 draw calls), and the emulator doesn't use multiview, so the numbers that matter come from the headset check.

## What to watch for

- **Multiview and program switches.** The main view is drawn with multiview on the Quest; the sight's texture isn't. three.js keeps a compiled shader of each kind for every material and swaps between them each frame, which costs main-thread time per object. If the HUD's `cpu` for the sight is much more than its share of the draw calls, this is why, and the fix is a smaller scene for the sight (layers, or culling the cabin).
- **Draw calls double.** The sight draws the whole scene again: the HUD's sight `calls` plus the frame's `calls` is the real total against the 150 limit.
- **The cabin and range don't exist yet.** This measures the sight against the starter's deck, three boards and the plain. F1.9 re-measures once the cabin (F1.1) and test range (F1.7) are in.

## Headset check (Quest 3, then PC over Link)

Clear the cache first (Ctrl+Shift+R on a PC, or reload the page in the Quest Browser). Turn the perf HUD on with X if it's off.

1. **Cost from anywhere.** In the game menu (Y) open Practice → Sight render and set **Draw: always**. Stand still on the deck looking at the hoop. Note the HUD's fps / Hz, the frame `p95` and the bottom `sight` line. Press **Draw** until it says **Draw: off** and note the fps and `p95` again. Repeat with the size at **1024²** and at **256²**.
2. **Looking through it.** Set **Draw: near** again and press Practice → Gunsight → **Go to it**. Lean towards the eyepiece (the rubber ring on the sight on the post) until the lens lights up, about 9 cm away. Say whether the picture looks right: three boards (one, two and five orange squares), steady as you move your head a little, not doubled, and whether it's comfortable with both eyes open.
3. **Range marks.** Through the sight, can you read the range numbers (2, 4, 6, 8, 10) and tell the short 100 m marks apart? Press **Aim** to step through 100 m, 250 m and 500 m (the menu needs to be open; close it again to look), and say whether the board sits on the right mark each time (250 m is halfway between the 2 and the short mark below it). Try each size (256², 512², 1024²) and say which is the smallest that reads well.
4. **One eye.** Press the eye button for **Right eye**, then **Left eye**, and say whether one eye feels better or worse than both.
5. **The HUD.** With the sight open at 512², send a photo or the numbers of the HUD: fps / Hz, `p95`, `cpu`, `calls`, and the `sight` line (its `gpu` number may show `-` if the browser hides GPU timers).
6. **PC over Link.** Repeat 1, 2 and 5 in Chrome over Link or Air Link.

Pass: 90 fps at 90 Hz on the Quest 3 with the sight open at 512² (step 5), and the range marks readable at 3× (step 3). If 512² fails the frame rate, the smallest size that holds it and reads well is the answer for F1.9.
