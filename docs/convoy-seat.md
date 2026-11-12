# Head-out driving: the convoy position (F2.8)

A Sherman's driver drove on the march with his seat raised and his head out of the open hatch, and dropped back down behind the periscope and the vision slit for battle. The 1944 crew drill says it in two lines: "Lower periscope. Open hatch. Raise seat to convoy position", and for battle "Lower seat ... Close hatch; raise periscope" ([FM 17-67](https://archive.org/details/FM_17_67_A_C_D_S_P_M_T_M4_1944)). A 1943 Fort Knox study of the M4's seats ([Armored Medical Research Laboratory, Project 5-12](https://collections.nlm.nih.gov/catalog/nlm:nlmuid-101677018-bk)) describes the same two positions, seat down for the periscope and seat up "for outside viewing", and asks for a 10 in (25 cm) shift between them. The real driver's controls did not move: his steering levers were long enough to hold from either height.

The numbers live in [`src/sim/convoy-seat.ts`](../src/sim/convoy-seat.ts). The raised seat and the convoy grips are in [`src/scene-assets/convoy-seat.scene-asset.ts`](../src/scene-assets/convoy-seat.scene-asset.ts); [`src/systems/convoy-seat-system.ts`](../src/systems/convoy-seat-system.ts) owns the wish and shares it, and SeatSystem moves the seat.

## Why the controls come up with you

The player sits in a real chair, so raising the seat lowers the whole tank round them, and the controls with it. Our roof is 20 cm over the driver's eyes, as a Sherman's 15 to 20 cm ([crew-heights.md](crew-heights.md)), but the roof plate is drawn 8 cm thick. The eyes rise 30 cm to stand 2 cm over the roof, and at that height the tillers are about 70 cm under them: down by the knees with the arms straight, past where a seated driver's hands rest. John first picked "like the real Sherman, controls stay put" (2026-11-08); with the real heights merged, the numbers showed it wouldn't work from a chair (it was a 42 cm rise before the roof came down to real), so the tillers and the gear lever get **convoy grips**: a rod up from each handle to a grip where the hands rest. That is a game's aid, like the turret dial; a Sherman had nothing like it. Later US tanks did: the M48's steering wheel tilts up for driving with the hatch open.

## What players experience

- **Raising the seat.** Pull back the seat lever, on the cushion's right beside your thigh, leaning forward like the parking brake, or use Game menu → Practice → Drive the tank → **Head out**. The view fades to black for a quarter of a second, the seat rises 30 cm and goes back 22 cm, and the view clears with your head out of the hatch. The same lever, or Head out again, brings you back down. A lift felt through the eyes alone is a comfort problem, so the seat only moves while the view is black.
- **Head out.** Your eyes are 2 cm over the roof, about 2.03 m over the ground, about a Sherman driver's height (5 cm up felt a little high, John's headset check, 2026-11-08), in the middle of the hatch. You see the road over the hull's front, the glacis, the hoods and the sponsons ([exterior.md](exterior.md)). The hatch's lid lies open beside the hole on your left, lifted and swung aside, and the driver's periscope has gone down into its holder so nothing stands in front of your face. Your head can move about 15 cm either way and 12 cm back or 20 cm forward before the neck meets the round hatch's rim, and rise 10 cm (sitting up, not standing); past that the view fades, as it does against a wall seated.
- **Driving.** Both tillers and the gear lever have a black grip on a rod rising from their handles, where your hands are when you sit down below. Hold them as you would the handles: they move the levers exactly as the handles do, and the gloves close on them. The hand throttle, the parking brake and the switch strip stay down by the seat: set them before going up.
- **Your crewmate sees it.** The gunner sees the driver's seat raised with them on it, their hatch's lid open and their periscope down. The driver's legs hang a little longer than on the seat below: the avatar's legs are drawn for the seat down.
- **Mind the gun.** With your head out, the gun's barrel passes about where the top of your head is (its underside 15 cm over your raised eyes) when the turret is turned about 4° to 33° left (between 11 and 12 o'clock). Nothing stops it for now (John, 2026-11-08): a real driver ducked. A turret stop is built and off (`HEAD_OUT_GUN_STOP` in `src/sim/convoy-seat.ts`): turned on, the turret stops at the edges of that band, whichever control turns it, and the gunner's sign says "Driver's head is out". Raising the gun would be no way past it: over the back of the head box the barrel would need more than its 20°. Late Shermans had a travel lock on the front plate that held the gun straight ahead on the march; straight ahead the barrel clears the driver.

## Numbers

Hull space, as in [cabin.md](cabin.md). The driver's eye point seat down is (−0.5, 1.27, −1.6).

| What | Value | Why |
| --- | --- | --- |
| Rise | 30 cm (`CONVOY_RAISE`): the eyes from 20 cm under the roof to 2 cm over its top (`CONVOY_EYES_OVER_ROOF`) | Over the hull's front to the road. A real seat moved 25 to 30 cm; our roof plate is drawn thicker |
| Back | 22 cm (`CONVOY_BACK`) | The head comes up in the hatch's middle, not against its front edge, and the grips stay clear of the turret dial on the hood |
| Eye point raised | (−0.5, 1.57, −1.38) | 2.03 m over the ground; a Sherman driver's about 1.98 |
| Head box raised | 15 cm left and right, 20 cm forward, 12 cm back (the round hatch, [exterior.md](exterior.md); 17, 22 and 10 in the square one); 10 cm up (`CONVOY_HEAD_UP`) | The neck 8 cm from the hatch's rim (`NECK_CLEARANCE`), the eyes being nearly level with it; sitting up, not standing into the gun's path |
| Gun stop (off) | turret about 4° to 33° left (`GUN_STOP`, on with `HEAD_OUT_GUN_STOP`) | The barrel 3 cm from an 11 cm head anywhere in the head box, level or elevated |
| Convoy grips | 11 cm rubber grips, 1.6 cm thick, their tops 26 cm over each handle's top and 22 cm behind it | Where the hands rest seat down, from the raised eyes, 4 cm lower (`CONVOY_GRIP_DROP`), so the gear lever's stays over knee height |
| Seat lever | 20 cm, on a bracket and hinge on the cushion's right, 6 cm ahead of its middle, resting 45° forward; pulled back to 20° it moves the seat once, then must go forward past 35° | Like the parking brake, and part of the seat (John's headset check); its grip at the cushion's front edge, where a seated hand drops; one pull, one move |
| Fade | 0.25 s out, 0.25 s in | Over before the seat's move could be missed |
| Lid aside | 3 cm thick, flat, 1.5 cm over the roof and 8 cm left of the hole, on a post at its front-left corner | Its top about level with the eyes, 12 cm or more to their left; it and its post 8 cm or more from them anywhere in the head box |
| Periscope down | its head's top 6 mm over the roof | Clear of the view, and of the roof's face (the 3 mm rule) |

## Sharing

The driver's page owns its seat. It sends a reliable `convoy` event {up} when the seat moves, and again every 2 s while in a crew, so a crewmate who joins late or missed one still sees it. The gunner's page draws the driver's seat, legs, lid and periscope from it. Nothing is in the packets, and there is no new HoldKind: the seat lever is a `LocalControl` (the other page doesn't need to see a hand on it), and the convoy grips belong to the tillers and the gear lever, whose HoldKinds already go over. Each page sets the grips on its own levers from `convoyUp()`, so a crewmate driver's hand is drawn on the grip.

## The practice crewmate

As driver it stays seat down: its hands are scripted to the handles. As gunner on another page it draws your raised seat like anyone's.

## Departures

- **The convoy grips** are a game's aid (above).
- **The hatch's lid always opens aside**, whether you are head out or not (Settings → Hatches): the forward-standing lid would sit in front of the face.
- **The gun can pass through the driver's head.** A real gunner was told to mind the driver. John picked a turret stop with the real roof, then asked for it off after his headset check (2026-11-08); it is built and can be turned back on.

## Tests

- `test/convoy-seat.test.ts`: the eyes 2 cm over the roof in the hatch's middle; the head box inside the rim; the seat, the floor and the cushion moving together; the lid and the lowered periscope out of the view; the fade moving the seat while black; the seat lever's lean, length and latch; the grips under the raised eyes where the hands rest, and clear of the hood, the instrument box and the turret dial all through their travel; a hand on a grip moving the lever as on its handle; the gun stop (off) clearing every head in the head box outside its band and stopping the power traverse and the crank at its edges.
- `test/interior.test.ts`: the eyes keep `EYE_CLEARANCE` from the rim, the lid and the turret all along the raised head box.
- `test/body-height.test.ts`: the grips and the seat lever in reach from a chair.
- `test/z-fighting.test.ts`: the seat raised, the lid aside, the periscope down, the grips on the levers at both ends and the seat lever.
- `npm run test:xr`, step 6e″ (part 2): Head out raises the seat with the eyes over the roof, the lid open and the periscope down; the tillers taken by their grips and pulled back; the crank turning the turret past the hatch (no stop); Head out lowers it; the seat lever raises and lowers it. Screenshot: `artifacts/xr-convoy.png`.
- `npm run test:net` (`ONLY_SEATS=1`): the driver raising and lowering the seat, and the gunner's page drawing them raised with the lid open, its crank turning the turret past their hatch on both pages, then back down.

`window.__convoy` gives `state()` (wanted, shown, the crewmate's, the seat lever), `headOut(up?)` and `lever()` (its grip, hull space).

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated.

1. Enter VR alone. Game menu (Y) → **Practice → Drive the tank → Head out**. The view goes dark for a moment and you come up with your head out of the hatch. Say whether the move felt comfortable.
2. Look round: the road over the hull's front, the lid lying open on your left, no periscope in front of you. Say whether 2 cm over the roof is still high enough to see the road close in.
3. Put your hands where they rest: the black grips on the tillers should be there. Drive (Practice → Drive first if the engine is off) and steer with them. Change gear by the gear lever's grip.
4. Move your head about: the view should fade only as your neck comes to the hatch's rim.
5. Pull back the seat lever beside your right thigh, leaning forward on the cushion's right: you go down again, the grips gone. Pull it again: up.
6. Drive a little head out over the range. Report how the open view felt on the move, and the perf HUD's frame time head out.
7. With a second headset (or `?bot=1` on a PC page as the gunner, then sit as driver), the gunner should see you raised, your lid open.

Report: whether the rise, the grips' place and the lever work, and whether the open view on the move needs the vignette stronger.
