# WWII tank crew avatars (F6.3, F6.3b, F6.3c)

John's ask (2026-11-17): make the avatars look like WWII tank crew, with the right clothing and accessories. Until then the crew were stylised aviators: a leather flying cap, brass flying goggles over the eyes, a long coat in the crew colour and a scarf.

F6.3 (PR #121) dressed the low-poly crew as a British tank crew. John's play-through of the pictures (2026-11-18): the hat, hair and headphones combination looked odd, and a face with no eyes and no goggles was disturbing; could the crew be more realistic but still low-poly, and how good could they be on a Quest? Of three options (a faceted head with eyes, a smooth-shaded head, or a textured human with arms) he chose the third: **F6.3b, the textured crewman**. On the mock-up he asked for the beret to fit: the band tight round the head, the headset over it.

F6.3b (PR #127) used a free human base model with the uniform painted on. John, on seeing it (2026-11-19): that style of model doesn't look right; make the best attempt at a low-poly style with the correct clothing. **F6.3c, the low-poly crewman**, below, replaces it: a crewman made in code, faceted and flat-coloured like the rest of the game, in the right kit, with arms. Nothing is downloaded any more; `scripts/crewman-bake/` and the model files are gone.

## Which army

**British, Royal Armoured Corps, north-west Europe, 1944.** The tank is an M4A4, which in British service was the Sherman V, the most common Sherman in British and Commonwealth regiments. The commander on the intercom is British ([commander-voice.md](commander-voice.md)), so the crew are dressed to match him. A US crew (M1938 tanker's helmet, herringbone twill coveralls, a throat mic) would be the other choice; it would be new headgear and colours in `crewman.scene-asset.ts`.

## The model

`src/scene-assets/crewman.scene-asset.ts` builds the crewman from rings of points along his bones (lofts with squarish cross-sections, so the cloth has flat panels and edges), with the kit fitted onto those surfaces: each badge, button, buckle or earphone is placed by casting a ray at the part under it, so it sits on the cloth whatever the shape, and a fitting that misses throws when the module loads. He is made seated, as he is always drawn: hips at the origin, thighs along the cushion, shins down to the floor, hands forward. Flat-shaded vertex colours, no texture; the materials take the cabin's lamps and finishes like the tank's inside (`litInside(..., { finish: true })`).

| Part | What |
| --- | --- |
| Head | A faceted head with a nose, ears, mouth, brows and eyes (whites, brown irises, lids), a short back and sides below the beret |
| | Black RAC beret: a band tight round the head above the brows and ears, the crown a flattened disc pulled down over the right ear, 15 mm clear of the head everywhere |
| | Cap badge on the band over the left eye: a plain white-metal plate, not a real regiment's badge |
| | Wireless headset over the beret: Bakelite earphones on the ears and a band over the crown, as for the No. 19 set |
| Neck | Open khaki shirt collar, a neckerchief in the crew colour knotted at the throat |
| Torso | Brown leather jerkin (the issue one, sleeveless) with four buttons over khaki serge |
| | Pale webbing belt with a brass buckle, a holster with its flap on the right hip, an ammunition pouch at the left front |
| Arms | Khaki sleeves from round shoulders, running into the gauntlets |
| Hands | The same posable leather gauntlets as before (`PosedHand`), cuff bands in the crew colour |
| Legs | Khaki trousers, webbing anklets with brass buckles, black boots with darker soles |

Dropped from F6.3's kit, since they read poorly at this size: the dust goggles on the beret, the hand microphone and the shoulder titles.

## How it moves

`Crewman` (`src/scene-assets/crewman.ts`) poses the model's skeleton each frame from what the crewmate's page already sends; nothing new goes over the network.

- **Legs** sit in the seat: the hips on the seat's hip point, thighs along the cushion, shins down to the floor, staying within 16 cm either side of the seat's middle, clear of the driver's tiller pedestals.
- **Spine** leans from the hips towards the neck's base and turns the shoulders, from the same seated-body sums as F1.1b (`solveSeatedBody` in `src/sim/seated-body.ts`, [seated-avatars.md](seated-avatars.md)); it stretches between 0.8 and 1.3 times its length to reach.
- **Head** sits exactly at the crewmate's headset, turned as it is; the neck stretches to join it. The headgear is drawn at the same pose.
- **Arms** reach into the gauntlets wherever they are drawn, including locked onto a handle (grip locking): two-bone reach (`reachArm` in `src/sim/arm-reach.ts`) from the shoulder to a point inside the cuff, the elbow bending back along the cuff, out to the side and down. A hand whose controller isn't tracked rests on its thigh.

The bones carry the same names as F6.3b's model, so the posing didn't change; the knees no longer need drawing in, as this crewman's thighs are slimmer (the shins and boots reach 15.5 cm either side of the seat's middle). Each part is skinned to one bone, or blended between two at a joint (shoulders, elbows, hips, knees, the waist and neck), so cloth bends at the joints without tearing.

This departs from the house rule of hands only, no arms (the rule came from arms that never looked right on a low-poly body, 2026-10-10): John asked for arms. The player's own arms are still never drawn, only their gloves.

## The crew colour

The menu's colour swatches (You → Scarf colour) still pick a colour, so the two crew tell each other apart in the same uniform. It colours the neckerchief and the band of neck at the collar (vertex colours, so a change rebuilds the body's geometry once) and the gauntlets' cuff bands. Nothing about choosing or sending it changed.

## Cost on a Quest 3

| | F6.3 (low-poly) | F6.3b (textured) | F6.3c (low-poly crewman) |
| --- | --- | --- | --- |
| Draw calls for the crewmate | 4 meshes and 2 gloves | 4 meshes and 2 gloves | 2 meshes (body, headgear) and 2 gloves |
| Triangles | 1,366 and the gloves | 15,600 and the gloves | about 2,900 and the gloves |
| Textures | none | four, up to 1024 px | none |
| Download | none | about 980 kB | none: built in about 40 ms as the game starts |
| JavaScript per frame | the torso and neck | posing about 30 bones | posing 20 bones |

About 1% of the 300,000-triangle budget for the one crewmate drawn. The skinning runs on the GPU. A player never sees their own body, only their gloves.

## Tests

- `test/crewman.test.ts`: under 4,000 triangles (the headgear under 800); every vertex skinned to valid bones with weights summing to 1; made to the seats' numbers (eyes, floor and neck base); the same geometry every time, a crew colour changing only the neckerchief; posed in the gunner's seat with the hips and neck where the seated body puts them.
- `test/z-fighting.test.ts`: the crewman and his headgear, as made and posed in a seat with his hands on the controls.
- `test/arm-reach.test.ts`: the arm's two bones keep their lengths, the wrist lands on a target in reach, the elbow bends towards its pole, and a target out of reach draws the arm straight.
- `test/driver-station.test.ts`: the crewman's shins stay clear of the tiller pedestals.
- `npm run test:net` (`ONLY_BOT=1`, `ONLY_SEATS=1`): the crewmate is drawn (its head, body and gloves), in its seat, and leans in to the sight bending at the hips.

Pictures of F6.3b's mock-up are in the project files under `avatars/textured-crew/`, and of F6.3c under `avatars/low-poly-crew/`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Open the game on a PC too, set **This page plays as → Practice crewmate** in its Settings (or add `?bot=1`) and join the headset's crew from it.

1. Sit in the **driver's** seat and look back over your right shoulder at the crewmate in the gunner's seat. Say whether it reads as a British tank crewman: a faceted face with eyes, a black beret tight on the head with its crown pulled right and a badge over the left eye, a headset over it, a leather jerkin over khaki with a belt and holster, a neckerchief in its colour.
2. Watch its arms while it lays the gun and loads: the forearms should run into the gauntlets' cuffs with no gap, and the elbows bend naturally (not through the body or backwards). Note any pose that looks wrong.
3. Watch it lean in to the gunsight and look round: the neck and shoulders should bend smoothly, and the beret and headset should not poke through the sight or the turret roof.
4. Swap seats (menu → Seats) so the crewmate drives: its knees and boots sit between the tillers, and its hands on the tillers have arms.
5. Open the menu (Y) → You → Scarf colour on the PC page and pick another colour: the crewmate's neckerchief and cuffs change.
6. Note the frame time on the perf HUD (X on the left controller) looking at the crewmate, and compare it with looking away.
