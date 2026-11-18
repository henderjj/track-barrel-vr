# WWII tank crew avatars (F6.3, F6.3b)

John's ask (2026-11-17): make the avatars look like WWII tank crew, with the right clothing and accessories. Until then the crew were stylised aviators: a leather flying cap, brass flying goggles over the eyes, a long coat in the crew colour and a scarf.

F6.3 (PR #121) dressed the low-poly crew as a British tank crew. John's play-through of the pictures (2026-11-18): the hat, hair and headphones combination looked odd, and a face with no eyes and no goggles was disturbing; could the crew be more realistic but still low-poly, and how good could they be on a Quest? Of three options (a faceted head with eyes, a smooth-shaded head, or a textured human with arms) he chose the third: **F6.3b, the textured crewman**, below. On the mock-up he asked for the beret to fit: the band tight round the head, the headset over it.

## Which army

**British, Royal Armoured Corps, north-west Europe, 1944.** The tank is an M4A4, which in British service was the Sherman V, the most common Sherman in British and Commonwealth regiments. The commander on the intercom is British ([commander-voice.md](commander-voice.md)), so the crew are dressed to match him. A US crew (M1938 tanker's helmet, herringbone twill coveralls, a throat mic) would be the other choice; it would be a new bake (scripts/crewman-bake/).

## The model

A free human base model, **Quaternius's Universal Base Characters [Standard]** (CC0, public domain; <https://quaternius.itch.io/universal-base-characters>), its "Superhero" male: a rigged body of about 12,600 triangles with a 65-bone skeleton, separate eyes and eyebrows, and a painted face. The pack's "Regular" build, with ordinary proportions rather than broad shoulders and big arms, is only in the paid Source edition (US$19.99); it uses the same skeleton, so it would swap in through the same bake.

`scripts/crewman-bake/` turns it into `public/models/crewman/crewman.glb` (970 kB) and `crewman-crew-mask.png` (8 kB); its README says how to run it again. The game loads both before it starts (`src/assets.ts`).

| Part | What | How |
| --- | --- | --- |
| Head | His own face, eyes and eyebrows, a short back and sides | The hair is painted into the texture, below the beret |
| | Black RAC beret: a band tight round the head above the brows and ears, the crown pulled down over the right ear | The band is the head's own skin pushed out 6 mm; the crown a flattened disc on it |
| | Cap badge on the band over the left eye | A plain white-metal disc, not a real regiment's badge |
| | Wireless headset over the beret, earphones on the ears | Bakelite cups and a band, as for the No. 19 set |
| Torso | Leather jerkin over khaki denim overalls, khaki collar | Painted |
| | Neckerchief at the throat, in the crew colour | Painted mid grey and tinted in the game through the mask |
| | Webbing belt | Painted |
| Arms | Khaki overall sleeves, reaching into the gauntlets | See below |
| Hands | Brown leather gauntlets with a cuff band in the crew colour | The same posable gloves as before (`PosedHand`); the model's own hands are folded away inside the cuffs |
| Legs | Khaki overalls, webbing anklets, black boots | Painted |

Dropped from F6.3's kit, since they read poorly or would need more geometry: the dust goggles on the beret, the holster, the hand microphone and the shoulder titles.

## How it moves

`Crewman` (`src/scene-assets/crewman.ts`) poses the model's skeleton each frame from what the crewmate's page already sends; nothing new goes over the network.

- **Legs** sit in the seat: the hips on the seat's hip point, thighs along the cushion, knees drawn in a little (so the shins stay 16 cm either side of the seat's middle, clear of the driver's tiller pedestals), shins down to the floor.
- **Spine** leans from the hips towards the neck's base and turns the shoulders, from the same seated-body sums as F1.1b (`solveSeatedBody` in `src/sim/seated-body.ts`, [seated-avatars.md](seated-avatars.md)); it stretches between 0.8 and 1.3 times its length to reach.
- **Head** sits exactly at the crewmate's headset, turned as it is; the neck stretches to join it. The headgear is drawn at the same pose.
- **Arms** reach into the gauntlets wherever they are drawn, including locked onto a handle (grip locking): two-bone reach (`reachArm` in `src/sim/arm-reach.ts`) from the shoulder to a point inside the cuff, the elbow bending back along the cuff, out to the side and down. A hand whose controller isn't tracked rests on its thigh.

This departs from the house rule of hands only, no arms (the rule came from arms that never looked right on a low-poly body, 2026-10-10): John asked for arms. The player's own arms are still never drawn, only their gloves.

## The crew colour

The menu's colour swatches (You → Scarf colour) still pick a colour, so the two crew tell each other apart in the same uniform. It colours the neckerchief (a tint in the body's material, through the mask) and the gauntlets' cuff bands. Nothing about choosing or sending it changed.

## Cost on a Quest 3

| | F6.3 (low-poly) | F6.3b (textured) |
| --- | --- | --- |
| Draw calls for the crewmate | 4 meshes and 2 gloves | 4 meshes (body, eyes, eyebrows, headgear) and 2 gloves |
| Triangles | 1,366 and the gloves | 15,600 and the gloves |
| Textures | none | one 1024 px (the body), two 256 px (eyes, eyebrows), one 512 px mask |
| Download | none | about 980 kB, loaded once at the start |
| JavaScript per frame | the torso and neck | posing about 30 bones: 0.07 ms on a desktop, so about 0.3 ms on a Quest |

About 5% of the 300,000-triangle budget for the one crewmate drawn. The skinning runs on the GPU. A player never sees their own body, only their gloves.

## Tests

- `test/crewman.test.ts`: the model stays under 16,000 triangles and 1.2 MB with textures of at most 1024 px, and has the bones and parts `Crewman` poses.
- `test/z-fighting.test.ts`: the headgear (beret, badge, headset) against itself and against the head's skin under it.
- `test/arm-reach.test.ts`: the arm's two bones keep their lengths, the wrist lands on a target in reach, the elbow bends towards its pole, and a target out of reach draws the arm straight.
- `test/driver-station.test.ts`: the crewman's shins stay clear of the tiller pedestals.
- `npm run test:net` (`ONLY_BOT=1`, `ONLY_SEATS=1`): the crewmate is drawn (its head, body and gloves), in its seat, and leans in to the sight bending at the hips.

Pictures of the mock-up and the fitted beret are in the project files under `avatars/textured-crew/`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Open the game on a PC too, set **This page plays as → Practice crewmate** in its Settings (or add `?bot=1`) and join the headset's crew from it.

1. Sit in the **driver's** seat and look back over your right shoulder at the crewmate in the gunner's seat. Say whether it reads as a British tank crewman: a face with eyes, a black beret tight on the head with its crown pulled right and a badge over the left eye, a headset over it, a leather jerkin over khaki, a neckerchief in its colour.
2. Watch its arms while it lays the gun and loads: the forearms should run into the gauntlets' cuffs with no gap, and the elbows bend naturally (not through the body or backwards). Note any pose that looks wrong.
3. Watch it lean in to the gunsight and look round: the neck and shoulders should bend smoothly, and the beret and headset should not poke through the sight or the turret roof.
4. Swap seats (menu → Seats) so the crewmate drives: its knees and boots sit between the tillers, and its hands on the tillers have arms.
5. Open the menu (Y) → You → Scarf colour on the PC page and pick another colour: the crewmate's neckerchief and cuffs change.
6. Note the frame time on the perf HUD (X on the left controller) looking at the crewmate, and compare it with looking away.
