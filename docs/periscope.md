# Periscope (F1.6)

The driver gets a second way to see out: a periscope left of the vision slit that turns all the way round with a two-handled yoke and shows the view at 2×. It reuses the gunsight's lens and renderer (spike S1, [gunsight.md](gunsight.md)), now shared in [`src/systems/scope-lens.ts`](../src/systems/scope-lens.ts). The numbers are in [`src/sim/periscope.ts`](../src/sim/periscope.ts), the model is [`src/scene-assets/periscope.scene-asset.ts`](../src/scene-assets/periscope.scene-asset.ts) and the system [`src/systems/periscope-system.ts`](../src/systems/periscope-system.ts).

## What players experience

- In the driver's seat, the periscope's **eyepiece** is a steel box at eye height a lean ahead and to the left (30 cm ahead of the eyes, 22 cm left), left of the slit and clear of the view through it. Its back face has a wide window in a rubber surround, wide enough for both eyes. A shaft runs from it up through the roof to the **head**, a small armoured box on the hull roof with a window on its front, and down to the **yoke**: a hub with a yellow pointer and a rubber handle out each side, 27 cm under the eyes, just above the gauges' line of sight.
- **Lean in** until the eyes are within about 9 cm of the window and it lights up with the view out of the head at 2×: about 40° across and 16° up and down to the eye (20° by 8° of the world). Lean back past 12 cm and it goes dark, and stops drawing. Both eyes see the picture, at infinity, as through the gunsight. The bottom edge of the view shows the hull's nose; the ground starts about 15 m out. The slit is still the way to see close in.
- **Turn it** with the yoke: take both handles and swing them round, and the head on the roof turns with them. The eyepiece stays where it is, as on a panoramic sight, so the eye stays at the window while the view swings past. Pushing the right handle forwards looks left. It turns all the way round (behind, the turret fills the view), ticking every 15°. In one hand it still turns, but no faster than 30°/s, so the hand gets ahead of it and the strain buzzes; this is the kit's yoke ([mechanisms.md](mechanisms.md)). It stays where it is let go.
- The **pointer** on the hub shows which way the head looks.
- The **gunner** sees the driver's yoke turn with the driver's hands closed on its handles, and the head turn on the roof.
- Game menu, Practice → **Periscope**:
  - **Go to it** puts the player in the driver's seat with their head 15 cm behind the window, facing it (from the gunner's seat it asks for the driver's seat first; in a crew that is a swap both must agree to).
  - **Ahead** turns it straight ahead. Either player can press it: the driver's page turns it.
  - **Power 2×** steps through 1×, 2× and 3×, for the headset check to judge which reads best. The line under it says which way the periscope looks.

## Numbers

Hull space, as in [cabin.md](cabin.md); the driver's eye point is (−0.5, 1.45, −1.6).

| What | Value | Why |
| --- | --- | --- |
| Upright it turns about | x −0.72, z −1.97 | Left of the slit (its left edge is at −0.67), so neither eye's line through the slit crosses the eyepiece, from the seat or leant in to the slit (tested) |
| Eyepiece | box 20 × 9 × 10 cm, its middle at y 1.47 | At eye height; outside the lines from the eyes to the gauges |
| Window | 14 × 5 cm, its middle at (−0.72, 1.47, −1.916), 4 mm proud of the box | 30 cm from the eye point: a lean. Wide enough for both eyes (6.4 cm apart); the head box (35 cm left, 60 cm forwards) lets the eyes reach it |
| Opens / closes | an eye within 9 cm of the window and behind it / beyond 12 cm | The gunsight's numbers |
| Power, field | 2× (1× and 3× in Practice), ±20° by ±8° true, ±40° by ±16° to the eye at 2× | A wide field for driving and looking round; a rectangular field stop like a real periscope's window |
| Picture | 768 × 296, 4× multisampling, only while open | About the gunsight's 512² in texels |
| Head | 10 × 12 cm, 8 cm over the roof (top at 1.96), the camera at 1.925 looking 2° down | Under the barrel's underside (1.99) as the gun sweeps over it level; ahead of the driver's hatch and outside the turret's sweep |
| Yoke | handles 7 to 17 cm out each side, at y 1.18 (27 cm under the eyes), all the way round, 30°/s in one hand, a tick every 15° | In seated reach at every angle (0.93 m above the real floor, within 75 cm of the nearer shoulder) and at least 15 cm from every driver's lever; the gauges read over it at every angle (tested) |
| Camera's near plane | 0.3 m | The turning part (the head the camera sits in) is hidden while it renders |

## Sharing

The periscope belongs to the driver's seat, so the **driver's page owns it** (alone, this page does, whichever seat it sits in).

- **`PeriscopeState`** (PacketType 9, 9 bytes, 45 Hz, driver's page → other page): the yoke's angle. The other page eases its yoke there over about 50 ms (as the driver's levers do), which turns its head on the roof, and draws the driver's hands closed on the handles (**HoldKind 8**, `Periscope`).
- **`periscope-turn`**, reliable event `{ angle }` to the driver's page: Practice → Ahead (or a test's turn) pressed on the other page.
- Each page draws its own view; nothing about the picture is sent.

## What one player can do alone

Everything: the periscope is the driver's own.

## Departures from the building skill

- **No practice crewmate part.** The crewmate drives without looking out (F1.13), so it has no use for the periscope; with the crewmate driving, the periscope stays where it was left.
- **The head isn't stopped at the eyepiece.** The driver's head box reaches forwards to the slit's brow pad, past the eyepiece, so a head pushed on past the point where the window opens goes into the box. Leaning straight in to the slit passes it (tested). If it bothers anyone in the headset, the head box can grow a notch.
- **The eyepiece stays put while the head turns**, which a plain periscope can't do; panoramic sights do it with a prism. Turning the whole periscope would make the driver's head follow the window round the upright and out of the head box at the sides.
- **The barrel can pass through the head** at full depression with the turret turned 18° left, as it can already dip into the hull's roof there; a depression stop over the hull is a later feature's.

## Tests

- `test/periscope.test.ts`: both handles in seated reach and clear of the face at every 15°, and at least 15 cm from every driver's lever at both ends of its travel; the window within a lean, reachable inside the head box and wide enough for both eyes; the slit's view clear of the eyepiece from the seat and leant in; every gauge readable past the yoke and its shaft at every angle; the head on the roof ahead of the hatch, outside the turret's sweep and under the level barrel; the view's direction for each turn (positive left) and the bearings in the menu's line; the picture's texels square; the yoke fast in both hands and 30°/s in one with the strain; the packet's round trip, wrapping, and turning away other packets.
- `test/z-fighting.test.ts`: the hull, the turret with the gun over the head, and the periscope turned seven ways.
- `npm run test:xr`, step 6k: Practice → Periscope → Go to it puts the head just behind the window; leaning in renders the view (`artifacts/xr-periscope-ahead.png`); both handles turn it 90° left, the view and the head on the roof with it, the window still (`artifacts/xr-periscope-left.png`); one hand turns it slower than the hand, the strain felt, and gets there; Ahead turns it back and Power steps to 3×.
- `npm run test:net` (in the drive checks, `ONLY_DRIVE=1` or `=lag`): the guest driver's periscope, turned 60°, is drawn turned the same on the host's page; the host's Ahead asks the guest's page, and both turn ahead. Clean link and 150 ms RTT.

`window.__periscope` gives `state()` (angle in degrees and as a bearing, who holds which handle, the strain, whether it is open, its power, render stats, owner, packets sent and received, the menu's line), `goTo()`, `turn(degrees)`, `setPower(p)`, `handle(which, degrees?)`, `lens()`, `view()`, `head()` and `pictureSpread()`. The perf HUD's sight line shows the periscope's own cost while it renders.

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R, or close and reopen the tab), seated (menu → You → Seated). Turn the perf HUD on with X. Stop at once if you feel unwell.

1. Game menu (Y) → **Practice → Periscope → Go to it**. You are in the driver's seat with the periscope's window a short lean ahead and left. Sit back: the slit's view ahead is clear of it, and you can read all five gauges past the yoke. Nothing on the periscope flickers.
2. Lean in until the window lights up. You see the range ahead at 2×, with the tank's nose at the bottom. Say whether it is comfortable with both eyes, and steady as you move your head a little.
3. Take **both handles** and turn it slowly left and right, then all the way round. The view swings and your eye stays at the window. Say whether the swinging view is comfortable, and whether the yoke's height is easy to hold.
4. Let go with one hand and turn it: it follows slower, with a light buzz.
5. Turn it to look at one of the range's targets, then **Practice → Periscope → Ahead**: it turns back.
6. Press **Power** to try 1× and 3×. Say which power you would keep.
7. With the practice crewmate (`?bot=1`) or a second headset driving, look through it on the move (Practice → Drive the tank, or let the crewmate drive). Report the HUD's fps and the `periscope` line (cpu, calls, triangles) with it open.
8. With a second headset: the gunner looks across at the driver turning the yoke; the yoke turns and the driver's gloves are on its handles.

Report: the power you'd keep, whether turning the view while the eye stays still is comfortable, and whether the window is easy to find by leaning.
