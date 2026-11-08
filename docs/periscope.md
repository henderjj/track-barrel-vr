# Periscopes (F1.6, F1.19)

Both crew have a periscope: the driver's in the hull roof ahead of their hatch, over the vision slit, and the gunner's in the turret roof over the gunsight. Each turns all the way round with a small crank and shows the view at 1×, as a Sherman's did. They reuse the gunsight's lens and renderer (spike S1, [gunsight.md](gunsight.md)), shared in [`src/systems/scope-lens.ts`](../src/systems/scope-lens.ts). The numbers are in [`src/sim/periscope.ts`](../src/sim/periscope.ts), the model is [`src/scene-assets/periscope.scene-asset.ts`](../src/scene-assets/periscope.scene-asset.ts) and the system [`src/systems/periscope-system.ts`](../src/systems/periscope-system.ts).

## Why two (F1.19)

John's note (2026-11-07): in a real tank the commander does the looking round and calls out directions and targets, but this game has no commander. The gunner needs to look round while the tank drives, to help find the way and the targets, and the driver can pick out targets and threats while the gunner is busy loading and firing. The driver's periscope was also in the way, at eye height to the right of the slit.

A Sherman had five crew. The commander sat in the turret behind the gunner, rode head out when he could, and steered the driver and laid the gunner by intercom. But every crewman had a periscope: the driver and co-driver one each in their hatch, the loader one in the turret roof, and the gunner's sight was itself a periscope in the roof, with a plain window over the magnified one, looking only where the gun pointed. So each of the two players gets one, sitting just above the view they use most: look ahead to drive or shoot, sit up a little to look round.

F1.6 gave only the driver a periscope, with its window at eye height 26 cm to their right and a two-handled yoke at chest height. F1.19 moved it overhead and gave the gunner the same.

## What players experience

- **Where.** Each periscope's **eyepiece** is a steel box hanging from the roof, tipped forwards 15° so its window (wide enough for both eyes, in a rubber surround) faces a little down towards the seat:
  - the driver's 13.5 cm ahead of the eyes and 9 cm above them, behind the slit's brow pad, so the slit's view is clear from the seat and leant in to it;
  - the gunner's straight above the gunsight's eyepiece, 12.5 cm higher.
  A neck rises from the eyepiece into a housing under the roof that runs forwards to the upright, and through the roof the **head**, a small armoured box with a window on its front, turns. The driver's head stands just behind the hood, ahead of the hatch (and its lid, standing open in front of it); the gunner's on the turret roof ahead of their hatch, turning with the turret.
- **Look.** Sit up a little, lean in and look up into the window: with the eyes within about 9 cm of it, it lights up with the view out of the head, life size and level: 40° across and 16° up and down. The eyes meet it 7 cm (driver's) or 11 cm (gunner's) above where they sit (see [Reach](#reach)). Lean back past 12 cm and it goes dark and stops drawing. Both eyes see the picture at infinity, as through the gunsight. The bottom of the view shows the hull's nose (the turret's roof for the gunner's); the ground starts about 15 m out. The gunner's sight and periscope never both open: whichever window the eyes are nearer has them.
- **Turn.** A small crank on the eyepiece's right turns the head: a quarter of the way round for each turn of the crank, with a tick every 15° the head turns. Turn the knob anticlockwise (as you see it) to look left. The eyepiece stays where it is, as on a panoramic sight, so the eye stays at the window while the view swings. It turns for ever and stays where it is let go. The gunner's turns with the turret too, so it keeps its angle from the gun.
- **Crewmate.** Each player sees the other's crank turn with their hand on its knob, and the head turn on the roof.
- Game menu, **Sights → Periscopes**:
  - **Driver's** and **Gunner's** put the player in that seat with their head 15 cm behind its window, facing it (from the other seat it asks to change seats first; in a crew that is a swap both must agree to). Sit up a little to look in.
  - **Ahead** turns both straight ahead (the gunner's along the gun). Either player can press it: each seat's page turns its own.
  - The line under the row says where each looks.

## Numbers

Frame space: hull space ([cabin.md](cabin.md)) for the driver's, turret space for the gunner's. The driver's eye point is (−0.5, 1.27, −1.6), the gunner's (0.4, 1.98, −0.2) ([crew-heights.md](crew-heights.md)).

| What | Driver's | Gunner's | Why |
| --- | --- | --- | --- |
| Window's middle | (−0.5, 1.36, −1.735): 13.5 cm ahead, 9 cm up | (0.32, 2.105, −0.396): 20 cm ahead, 12.5 cm up, 8 cm left, over the sight's eyepiece | Just above the main view: a short sit-up and lean, inside the head box and under its roof stop (tested) |
| Window's tilt | 15° forwards, facing a little down towards the seat (30° until John found it too steep, 2026-11-08) | the same | The eyes looking in 6 cm out are 7.5 cm (driver) and 11 cm (gunner) above the eye point; the picture stays level ([Reach](#reach)) |
| Upright (head on the roof) | x −0.5, z −1.86 | x 0.32, z −0.49 | Driver's: behind the hood's face, ahead of the hatch's open lid, outside the turret's sweep, under the level barrel. Gunner's: ahead of the hatch and clear of its collar, inside the roof's chamfers |
| Eyepiece | box 18 × 9 × 8 cm round the window, tipped with it | the same | The driver's behind the slit's brow pad, 5.5 cm or more from the eyes leant in to the slit; the gunner's 2.5 cm or more above the sight's hood |
| Window | 14 × 5 cm, 4 mm proud of the box | the same | Wide enough for both eyes (6.4 cm apart) |
| Crank | hub 19 cm right of the window, 2 cm up, its face 2 cm ahead of it; 5.5 cm to the knob, knob 5 cm long | the same | In easy reach of the right shoulder; a fist on the knob stays 10 cm from the eyes at the window and, on the driver's, out of the slit's view all the way round (tested) |
| Turn | 90° a crank turn, for ever, a tick every 15° | the same | Quick to swing round, fine to aim (1° of hand is ¼° of view) |
| Opens / closes | an eye within 9 cm of the window and behind it / beyond 12 cm | the same; and the gunsight shut, which stays shut while the eyes are nearer this window than its own | The gunsight's numbers |
| Power, field | 1×, ±20° by ±8° | the same | A Sherman's M6 periscopes had no magnification (see [Power](#power)); a wide field for driving and looking round; a rectangular field stop like a real periscope's window |
| Picture | 1024 × 395, 4× multisampling, only while open | the same | About 25 texels a degree, the Quest 3's display's own |
| Head | 10 × 10 cm, 8 cm over the roof, the camera looking 2° down | 15 cm over the roof, the same | The driver's under the gun as it sweeps over the hull; the gunner's high enough to look over the turret roof ahead to the gun and the ground |
| Camera | near plane 5 cm, far 1500 m | the same | Near enough to draw the roof in the bottom of the view and the driver's open hatch lid behind (0.3 m cut them away, so the view saw through the tank: John, 2026-11-07) |

## Reach

John's headset note (2026-11-07): it was hard to get the head up high enough to see out of the periscopes, with their windows 12 cm (driver's) and 14 cm (gunner's) above the eyes and facing straight back. He set his eyes 5 cm higher so he could drop to the slit and the sight and rise to the periscopes.

The eyepieces can't simply come down: the driver's would cut into the top of the slit's view and come within the near plane of the eyes leant in to the slit, and the gunner's sits over the sight's hood with the forehead under it while sighting. So each eyepiece was **tipped forwards 30°** about its window's middle, its window facing down towards the seat, and lowered 2 cm. The eyes meet the window lower and nearer: looking up into it 6 cm out they are 7 cm (driver's) or 9 cm (gunner's) above the eye point, where before they were 12 or 14. The picture is at infinity along the window's axis, so looking up into it shows the view out of the head level, as a real periscope's tilted eyepiece prism does.

John's next note (2026-11-08): the 30° angle was too steep to look into comfortably. The real-heights change ([crew-heights.md](crew-heights.md)) brought both roofs down to a Sherman's, close over the crew's heads, where a real M6 periscope's lower window sat just above the eyes facing back. The eyepieces now tip 15°: the driver's window is 9 cm over the eyes, met from about 7.5 cm up; the gunner's is 12.5 cm over them, just clear of the gunsight's hood, met from about 11 cm up. The driver's roof is 24 cm over the eyes so the crank and a fist on it fit above the slit's view.

Tipped, the gunner's window brings the eyes looking into it within 9 cm of the sight's lens below. So instead of the sight always having the eye, **whichever window the eyes are nearer has them**: PeriscopeSystem tells SightSystem how far the eyes are from its window (`sightStats.periscopeEye`), and the sight stays shut while they are nearer the periscope's.

## What blocks the view

John asked (2026-11-07) whether the driver's periscope should be stopped from turning, since the turret blocks its view behind. It isn't: a Sherman driver's M6 sat in a mount that turned all the way round, and looking back meant looking at the turret, or here at the open hatch lid just behind the head. The tank itself was clipped out of the view, though, because the camera cut away everything within 30 cm of it: the roof in the bottom of the view and the lid behind. The near plane is now 5 cm, and the gunner's head stands 15 cm over the turret roof so the roof fills only the bottom of its view.

## Power

John's note (2026-11-07): the picture looked low-res, worst at 3×; what power should a periscope have, and is a zoomed view worth drawing?

- **A Sherman's periscopes didn't magnify.** The driver's, co-driver's, loader's and commander's M6 periscopes were plain prisms at 1×, for looking round and driving. Magnification was the gunner's job: his M70 telescope beside the gun was 3× with a 12° field (the gunsight here, [gunsight.md](gunsight.md)), and his M4 periscopic sight had a 1.44× telescope next to its plain window.
- **So the periscopes are 1×, with no Power button.** A zoomed periscope would do the gunsight's job while making driving through it harder: at 1× things outside move as the head does, at 2× or 3× the picture swings twice or three times as fast as the head and the hull's pitching.
- **The low-res look** was the picture's texels spread over the zoom: 768 across shown 2× bigger was 9.6 texels a degree to the eye, and at 3× 6.4, where the Quest 3 shows about 25 pixels a degree. At 1× the 40° field now has 1024 texels, about 25 a degree, so the picture is as sharp as the headset can show. It draws about twice the texels of the gunsight's 512², still only while a window is open.

## Sharing

Each periscope belongs to its seat, so **that seat's page owns it** (alone, this page owns both).

- **`PeriscopeState`** (PacketType 9, the driver's) and **`GunnerPeriscopeState`** (PacketType 10, the gunner's): 9 bytes each, 45 Hz, owner's page → other page: the periscope's angle. The other page eases its periscope there over about 50 ms, turning its crank (the crank's angle follows from the periscope's) and its head on the roof, and draws the owner's hand closed on the knob (**HoldKind 8** the driver's, **14** the gunner's). The gunner's has a type of its own so a page on an older build, which knows only the driver's, leaves it alone.
- **`periscope-turn`** and **`gunner-periscope-turn`**, reliable events `{ angle }` to the owner's page: Practice → Ahead (or a test's turn) pressed on the other page.
- Each page draws its own view; nothing about the picture is sent.

## What one player can do alone

Everything: each periscope is its seat's own. Alone, the player can sit in either seat and use that seat's periscope.

## Departures from the building skill

- **The cranks are at face height**, not between knee and chest: the eyepiece is above the eyes, and the crank sits beside it so the hand is next to the face while the eye is at the window, as on a real periscope's handles. The hand is only up while turning it: it stays where it is let go. Two handles swinging round the eyepiece (a yoke, or a steering wheel) were tried on paper first: turned 90° they would come into the face or, on the driver's, across the slit.
- **No practice crewmate part.** The crewmate drives and aims without looking out (F1.13), so it has no use for a periscope; with the crewmate in a seat, its periscope stays where it was left.
- **The head isn't stopped at the eyepiece.** The head boxes let the eyes rise into an eyepiece, as before (the eyepieces are left out of the head fade on purpose, since the eyes are meant to meet them). Leaning hard into the slit, the driver's forehead goes under the eyepiece; the eyes stay more than 6 cm below it, past the near plane (tested).
- **The eyepiece stays put while the head turns**, which a plain periscope can't do; panoramic sights do it with prisms. Turning the whole periscope would make the player's head follow the window round the upright.

## Tests

- `test/periscope.test.ts`: each window 10 to 15 cm above its eye point and within a sit-up and lean, reachable inside its head box by both eyes, wide enough for both; the driver's slit clear of the eyepiece, the crank and a fist on the knob from the seat and leant in, the eyes leant in to the slit 6 cm or more under the eyepiece; the gunner's eyepiece over the sight's with room between, an eye at one beyond the other's opening distance; each knob in reach of the right shoulder, 10 cm from the eyes at the window, under the roof, and clear of the driver's levers and the gunner's wheels, grip and breech lever; the driver's head ahead of the hatch and its open lid, behind the hood, outside the turret's sweep and under the barrel, the eyepiece behind the brow pad; the gunner's head ahead of its hatch and clear of its collar, inside the roof's chamfers; which way it looks for each turn and the crank's gearing; the picture's texels square; five turns of the crank turning it 450°; both packets' round trips, wrapping, and each turning away the other's and short ones.
- `test/z-fighting.test.ts`: both periscopes turned seven ways with their cranks, the gunner's in the turret turned four ways.
- `test/interior.test.ts`: the driver's window within the short lean of the interior's layout.
- `npm run test:xr`, step 6l (in part 2, `XR_PART=2`): Sights → Periscopes → Driver's puts the head just behind the window and below it; sitting up renders the view (`artifacts/xr-periscope-driver-ahead.png`); a turn of the crank turns it 90° left, the view with it, the window still (`artifacts/xr-periscope-driver-left.png`). Then Gunner's: the same in the gunner's seat, the gunsight under it shut, half a turn looking 45° left of the gun. Ahead turns both back.
- `npm run test:net` (in the drive checks, `ONLY_DRIVE=1` or `=lag`): the guest driver's periscope turned 60° is drawn so on the host's page, and the host gunner's turned 40° right on the guest's; the host's Ahead turns both ahead on both pages. Clean link and 150 ms RTT.

`window.__periscope.driver` and `.gunner` each give `state()` (angle in degrees and as a bearing, the crank's angle, whether it is held, open, render stats, owner, packets sent and received, where it looks), `goTo()`, `turn(degrees)`, `knob(crankDegrees?)`, `lens()`, `view()`, `head()` and `pictureSpread()`; `window.__periscope.status()` gives the menu's line. The perf HUD's sight line shows a periscope's own cost while it renders (`g.periscope` for the gunner's).

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R, or close and reopen the tab), seated (menu → You → Seated), with the eye height back at 0 cm (menu → You). Turn the perf HUD on with X. Stop at once if you feel unwell.

1. Game menu (Y) → **Sights → Periscopes → Driver's**. You are in the driver's seat with the periscope's window a little above and ahead. Sit back: the slit's view is clear, and nothing is in the way to the right any more. Lean right in to the slit: the eyepiece is over your forehead, out of the view. Nothing on it flickers.
2. Sit up a little, lean in and look up into the window until it lights up. You see the range ahead life size and level, with the tank's nose at the bottom. Say whether the sit-up is comfortable now (it should be about half what it was), and whether looking up into the window to see level feels odd.
3. Take the **crank** on its right and turn it anticlockwise, letting your hand wander a little towards its middle (it should no longer jump): the view swings left, a quarter of the way round each turn, with a tick every 15°, and your eye stays at the window. Turn it all the way round. Say whether the crank is easy to find and turn with your eye at the window, and whether the speed suits.
4. **Sights → Periscopes → Gunner's**. You are in the gunner's seat with the periscope's window over the gunsight. Lean in to the sight: it opens and the periscope stays dark. Sit up to the periscope: it opens and the sight goes dark. Turn it to look left of the gun, then traverse the turret: the periscope keeps its angle from the gun.
5. **Ahead** turns both back. Look at a target far down the range through a periscope, then through the gunsight: say whether the periscope's picture is sharp enough to spot it, and whether it looks as sharp as the slit's view.
6. With the practice crewmate (`?bot=1`) or a second headset driving, look round through the gunner's periscope on the move. Report the HUD's fps and the `g.periscope` line (cpu, calls, triangles) with it open.
7. With a second headset: each of you turns your periscope and sees the other's crank turn with their hand on it, and its head turn on the roof.

Report: whether sitting up to the periscopes is comfortable, whether the cranks are easy to use, whether the picture is sharp enough, and the fps with a periscope open.
