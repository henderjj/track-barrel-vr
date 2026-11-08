# Callout card (F2.6)

A placard in each seat with the crew's short callouts and a clock face for target directions, so a new crew has the words in front of them while they learn to talk the tank round (concept §6: "a short callout vocabulary"). It uses the same words as the game menu's Calls and the practice crewmate ([crewmate.md](crewmate.md)), so the card, the sign and the crewmate speak one vocabulary; F4.7's training will teach the same words. The numbers and words live in [`src/sim/callout-card.ts`](../src/sim/callout-card.ts), the model in [`src/scene-assets/callout-card.scene-asset.ts`](../src/scene-assets/callout-card.scene-asset.ts), and [`src/systems/callout-card-system.ts`](../src/systems/callout-card-system.ts) hangs the cards and draws their faces.

## What players experience

- **The driver** turns their head to the left and glances down: a dark steel plate with cream lettering is bolted to the hull's left wall beside their head, under the cable conduit and above the hand throttle.
- **The gunner** sits back from the gunsight and looks to the front left: a bigger card is bolted to the turret's front wall, over the breech and left of the sight, and turns with the turret.
- Each card says **CREW CALLS** and has three columns:
  - **You call** (this seat's calls). The driver's: *Gunner, fire at will*, *Gunner, hold fire*, *Traverse left*, *Traverse right*, *Target, tank, 2 o'clock*. The gunner's: *Driver, advance*, *Driver, halt*, *Driver, reverse*, *Driver, left*, *Driver, right*, *On the way!*, *Target!*
  - **You hear** (the other seat's calls), so each card is the other's mirror.
  - **Targets by the clock**: a clock face round a hull outline seen from above, 12 at the hull's front (the gun drawn pointing there), 3 to its right, 6 behind, 9 to its left, with a dashed line out to 2 as in the example call. "12 is the hull's front" is written under it.
- The words that are also buttons on the menu's Calls are written exactly as the call's sign shows them. *Traverse left/right* and the target call are voice only: the crewmate doesn't act on them (below).
- **Game menu → Sound and view → Callout card → Off** hides both cards at once, for a crew that knows the words; **On** brings them back. It is each player's own setting, kept for next time (`?card=0` at load).

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Driver's card | 36 × 24 cm face, middle 1.24 m up the left wall, level with the eyes fore and aft (z −1.6), 63 cm from the eyes, 20° below them | A turn of the head and a glance down; clear of the conduit (1.62 m), the throttle's handle (under 1.0 m), the sponson rounds behind (from z −1.12) and the hood ahead |
| Gunner's card | 54 × 36 cm face, middle at (−0.58, 2.42) on the turret's front wall, 1.3 m from the eyes | Left of the gunsight's eyepiece as seen from the eye point, so the eyepiece doesn't hide it; under the roof's 12 cm chamfer; bigger so its lines look at least two thirds the size of the driver's (a line 0.7° tall against 1°, about 18 of the Quest 3's pixels) |
| Lettering | lines 36 px on a 1200 × 800 canvas: 11 mm tall on the driver's card, 16 mm on the gunner's | |
| Plate | the face 4 mm in front of a steel plate 1.2 cm wider all round, which stands 6 mm off the wall (8 mm sunk into it), a bolt in each corner | The 3 mm z-fighting rule with room to spare; thin enough that leaning to the head box's edge keeps the eyes more than 9 cm from it |
| Face | drawn once at load, unlit (as the choke plate and the switch strip are), cream and amber on a dark olive-black | Readable in the dim cabin without glaring; a dark card doesn't glow like a white one |

Two draw calls a card (the plate and the face), four in all, and nothing per frame.

## Sharing

Nothing goes over the network: each page hangs both cards and draws them, and the setting is each player's own.

## The practice crewmate

Nothing new to learn. The card's button calls are the Calls it already acts on; it does not act on the voice-only *Traverse left/right* or the target call, as it picks its own targets (F1.13). Teaching it those (and adding them to the Calls) would grow `crew-bot.ts`, which the biathlon threads are changing now, so it is left for F4.7's training if the play tests want it.

## Departures from the building skill

- No Practice shortcut: the card hangs in the seat, so Practice → Sit in → Driver or Gunner (or the start screen's seat choice) is all a headset check needs.
- No net test: nothing is shared.
- The cards' faces are unlit canvases, as the choke plate's and the switch strip's are (F1.17), so they read in the dark cabin.

## Tests

- `test/callout-card.test.ts`: every Calls button's words (but the Practice route) on the card of the seat that makes it and as heard on the other; the plan's calls ("Driver, halt", "On the way!", "Target, tank, 2 o'clock", "Traverse left", "Gunner, hold fire") on the cards; the clock face's hours; the driver's card on the left wall, 50 to 70 cm from the eyes and a little below them, clear of the conduit, the throttle, the sponson rounds and the head box's edge; the gunner's on the front wall under the roof's chamfer, clear of the corner, the breech and the elevating gear, about 1.3 m away and big enough, and clear of the eyepiece from the eye point; the setting's default, `?card=0` and its menu row.
- `test/z-fighting.test.ts`: the driver's card on the hull, and the gunner's on the turret turned four ways with the gun at both ends of its elevation.
- `npm run test:xr` (part 3, step 6n): both cards drawn, each facing its seat at the right distance with the Calls' words; a screenshot looking at the driver's card (`artifacts/xr-callout-card.png`); Sound and view → Callout card → Off (a ray click) hides both, On shows them again.

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated.

1. Sit in the **driver's** seat. Turn your head to the left and look a little down: the card is on the wall beside you. Can you read every line without leaning? Does it glare or look too dark against the wall?
2. Lean left as far as the view lets you (until it fades): the card should never fill the view or poke into your face.
3. Menu → Practice → Sit in → **Gunner**. Sit back from the gunsight and look to the front left, over the breech: the card is on the turret's front wall. Can you read it from the seat? Report which lines, if any, are too small. Turn the turret (power grip): the card turns with you.
4. Lean into the gunsight and the periscope: the card should not be in the way of either.
5. Menu → Sound and view → **Callout card → Off**: both cards go (check from both seats). **On** brings them back.
6. Say whether the words are the ones you'd want to use on the intercom, and whether the clock face reads the right way round (12 ahead, 3 to the right).
7. Press **X** for the perf HUD in each seat with the card in view: report the frame time and draw calls.
