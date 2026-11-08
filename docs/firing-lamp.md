# Firing lamp (F2.5)

A small amber lamp in the middle of the vision slit's top bar lights by itself whenever the gun is ready to fire, so the driver knows to hold the tank steady, and flashes at the shot, so they know it has gone. Nobody presses anything: the plan dropped the gunner's signal buttons (F2.2), and the lamp reads what both pages already know. A repeater on the turret's front wall, right of the gunsight, shows the gunner what the driver sees. The numbers live in [`src/sim/firing-lamp.ts`](../src/sim/firing-lamp.ts); the bezels are in [`src/scene-assets/firing-lamp.scene-asset.ts`](../src/scene-assets/firing-lamp.scene-asset.ts), merged into the hull's and turret's meshes; [`src/systems/firing-lamp-system.ts`](../src/systems/firing-lamp-system.ts) decides and lights the lenses. A Sherman had no such lamp (the gunner called "On the way" over the intercom); like the turret dial it is a game's aid.

## What players experience

- **Ready.** The lamp lights steady amber once all three hold: a shell rammed, the breech closed, and one of the gunner's hands on a control with a trigger (the power traverse grip, or the elevation handwheel's handle with its trigger bar). That is the moment a pull of the trigger fires the gun, so the driver should stop and keep the tank still.
- **The shot.** At the shot it flashes bright, nearly white, three times in two-thirds of a second, then goes dark: the breech has opened and thrown the casing, so the gun is not ready again until the next load.
- **Not ready.** It goes out as soon as the gunner lets go of both trigger controls or the breech is opened, so a lit lamp always means "a shot could come now".
- **The repeater.** The gunner sees the same lamp, 3.6 cm across, on the turret's front wall just right of where the gunsight's arm meets it, in view when they sit back from the eyepiece.
- **Practice → Ready to fire → Driver's lamp.** Alone, it puts the player in the driver's seat, parks the tank at the start, lays the gun on the 100 m target and loads it: the lamp lights at once (a gun loaded for a lone player counts as the gunner's hand), and a sign says to hold steady. Three seconds later a pretend gunner fires: the lamp flashes and goes out, and the shot hits the 100 m tank. In a crew it leaves the seats as they are; the gunner's page lays and loads, and the lamp lights when the gunner takes the grip. The existing **100 m / 250 m / 500 m** buttons also light it at once when played alone.

## Numbers

Hull space for the lamp, turret space for the repeater, as in [cabin.md](cabin.md). The driver's eye point is (−0.5, 1.45, −1.6); the gunner's (0.4, 2.25, −0.2).

| What | Value | Why |
| --- | --- | --- |
| Driver's lamp | lens 1.6 cm across, middle at (−0.5, 1.524, −1.857): the slit frame's top bar, in the slit's middle | 27 cm from the eyes, about 15° over the line through the slit: in sight while looking out, 3.4° across. Not on the hood's face either side, where the run clock and the turret dial are |
| Its bezel | a dark ring 2.4 cm across, 9 mm proud of the bar's face (4 mm sunk); the lens 4 mm in front of it | Under the brow pad (its bottom 4 mm above the ring) and 1.2 cm behind the pad's front, so a head leaning into the slit meets the pad first (`EYE_CLEARANCE`, [interior.md](interior.md)). 9 mm, as the hull is also seen from outside on the range (8 mm rule, [testing.md](testing.md#z-fighting)) |
| Repeater | lens 3.6 cm across, middle at (0.52, 2.27, −1.07): the turret's front wall, 20 cm right of the gunsight and 2 cm over the eyes | 88 cm from the eyes, 2.3° across; the line to it passes the sight's arm by over 5 cm, so the sight never hides it |
| Lit | amber (#ffa21f), unlit (tone-mapping off, like the gauges) | Reads in the dim hull; not the warning lamps' red |
| Dark | 10% of the amber | A visible lens, clearly off |
| Flash | 3 flashes, 0.12 s on, 0.1 s off, near white (#fff4d0) | Past the recoil and the casing; unmistakable even in the corner of the eye |
| Practice fire | 3 s after the lamp lights (alone only) | Time to look at it lit before it flashes |

Two draw calls (the two lenses share one material); the bezels are in meshes already drawn. Nothing new is lit.

## Sharing

Nothing new goes over the network: each page decides from what it already has.

- **Loaded and closed**: the loading as drawn (`loadingShown()`), the gunner's own on their page, the gunner's packets on the driver's (`PacketType.LoadingState` = 8).
- **The gunner's hand**: on the gunner's page (or alone) its own hands' `handUse`, mapped to HoldKinds; on the driver's page the hold kinds in the gunner's pose packets (`netLink.remote.holds`): `PowerTraverse` (12) or `ElevationWheel` (7) in either hand.
- **The shot**: FiringSystem's `shotListeners`, which hear every shot on both pages (the gunner's own, or the `shot` event).

The driver's page lights its lamp a packet or two after the gunner's, as it draws everything the gunner does. The Practice load counts as the gunner's hand only on a page playing alone, so in a crew both pages always agree.

## The practice crewmate

As driver it holds the tank steady while the lamp is lit on its page (`BotDriver.update`'s `steady`): tillers centred, no turning, and a route's halt doesn't run out. A call heard while it is lit waits until the lamp goes out (the gunner fired or let go); the menu's Calls line says "holding steady: the gun is ready". As gunner its hands rest on the elevation wheel and the power grip while it loads and lays, so the player's lamp lights as soon as it has loaded, and flashes at its shot.

A lit lamp halts the crewmate wherever it is going: a gunner who wants to move with a loaded gun lets go of the grip first. This is the plan's "firing at a halt" rule (decision 3) as a habit rather than a lock: a player driver is free to ignore it.

## Departures from the building skill

- **No new HoldKind, packet or event** (plan: Phase 2's indicators send nothing).
- **The XR step can't put a real gunner's hand on the grip and load by hand** in its time, so it uses the Practice load and `holdGrip`, a scripted hand on the power grip through the kit (the crewmate's own way of holding it); the net test covers the hand rule end to end with the crewmate.

## Tests

- `test/firing-lamp.test.ts`: the ready rule; lit while ready, dark when not, three flashes of the right lengths at a shot whatever the gun does, then lit or dark as the gun stands; the lamp in the middle of the top bar, under the brow pad, behind its front, 20 to 35 cm from the eyes, under 20° up and over 3° across, clear of the turret dial and the run clock; the driver's eyes keeping `EYE_CLEARANCE` from the lens all along the head box's edges; the repeater on the front wall right of the sight's knuckle, the line to it clear of the sight's arm, 80 cm to 1 m away and over 2° across. The crewmate: halting and holding while lit, a call waiting until it goes out, and a route halt not running out.
- `test/interior.test.ts` (unchanged): the eyes keep `EYE_CLEARANCE` from every cabin mesh, the bezels now among them.
- `test/z-fighting.test.ts`: the hull with the lamp's lens, the turret (turned two ways) with the repeater's; the hull on the range (8 mm) with the bezel.
- `npm run test:xr`, step 6p (part 3): Practice → Ready to fire → Driver's lamp seats the player as driver and lights the lamp at once; about 3 s later the gun fires, the lamp flashes and goes dark with the breech open. Then, as gunner, `holdGrip` puts a hand on the power grip, seen as a hand on a trigger with the lamp dark (breech open). Screenshots: `artifacts/xr-firing-lamp.png`, `artifacts/xr-firing-lamp-repeater.png`.
- `npm run test:net` (`ONLY_BOT=1`): the crewmate gunner loads with its hands on the wheel and grip, and the player driver's lamp lights from its packets and flashes at its shot. Then with the player gunning (Ready to fire, then a hand on the grip) and the crewmate advancing, the lamp lights on both pages and the crewmate halts and holds steady; the hand off the grip puts it out and the crewmate drives on.

`window.__firingLamp` gives `state()` (loaded, handOnTrigger, practice, ready, look, flashing, flashes, practiceFire), `watch()` (the Practice shortcut), `holdGrip(on)` (the tests' scripted hand on the power grip) and `at()` (each lens's place, hull space, and which way it faces).

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated.

1. Enter VR alone. Game menu (Y) → **Practice → Ready to fire → Driver's lamp**. You are in the driver's seat with a sign saying "Gun ready".
2. Look out of the slit: the amber lamp in the middle of the slit's top bar is lit. After about 3 s it flashes three times at the shot and goes dark. Say whether you noticed it without looking straight at it, and whether the flash read as "shot away".
3. Lean into the slit: the lamp should not get in the way of your head, and nothing near it flickers.
4. Menu → **Practice → Ready to fire → 100 m**: you are in the gunner's seat. Sit back from the sight and look right of where its arm meets the front wall: the repeater is lit. Take the power grip and pull the trigger: it flashes and goes dark. Load a shell by hand and close the breech: it stays dark until you take the grip (or the elevation handle), then lights.
5. With `?bot=1` on a PC page as the driver: Calls → **Advance**, then load and take the grip. The crewmate halts and its menu line says "holding steady"; fire or let go and it drives on.

Report: whether the lamp is bright enough by day through the slit, whether its place (top bar's middle) works or it should move (lower, bigger, to one side), and whether the repeater is useful or clutter.
