# WWII tank crew avatars (F6.3)

John's ask (2026-11-17): make the avatars look like WWII tank crew, with the right clothing and accessories. Until now the crew were stylised aviators: a leather flying cap, brass flying goggles over the eyes, a long coat in the crew colour and a scarf.

## Which army

**British, Royal Armoured Corps, north-west Europe, 1944.** The tank is an M4A4, which in British service was the Sherman V, the most common Sherman in British and Commonwealth regiments. The commander on the intercom is British ([commander-voice.md](commander-voice.md)), so the crew are dressed to match him. A US crew (M1938 tanker's helmet, herringbone twill coveralls, the tanker's jacket, a throat mic) would be the other choice and could be swapped in later; it only changes the head and colours in the one model file.

## What they wear

| Part | What | Notes |
| --- | --- | --- |
| Head | Black RAC beret, pulled down over the right ear | The British way of wearing it: the badge sits over the left eye |
| | Cap badge on the band over the left eye | A plain white-metal disc, not a real regiment's badge |
| | Wireless headset over the beret | Bakelite earphones and a band, as for the No. 19 set |
| | Dust goggles pushed up on the beret's crown | No longer over the eyes, so the face reads |
| Torso | Sleeveless leather jerkin, hip length, three buttons | Over khaki denim overalls, whose sleeves show at the shoulders |
| | Neckerchief knotted at the throat, in the crew colour | |
| | Slip-on shoulder titles, in the crew colour | |
| | 1937 pattern webbing belt, pale khaki, brass buckle | |
| | Pistol holster on the right hip | Webbing, with its flap |
| | Hand microphone on its cord, hung on the left of the chest | The British crews talked into a hand mic rather than the US throat mic |
| Legs | Khaki denim overalls | |
| | Webbing anklets | |
| | Black ammunition boots | |
| Hands | Brown leather gauntlets, unchanged | Their cuff band stays in the crew colour |

## The crew colour

The menu's colour swatches (You → Scarf colour, before this "Coat colour") still pick a colour, so the two crew tell each other apart in the same uniform. It now colours the neckerchief, the shoulder titles and the gauntlets' cuff bands instead of the whole coat. Nothing else about choosing or sending it changed: the same eight colours, kept in the browser and told to the crewmate as before.

## What stayed the same

Only `src/scene-assets/avatar.scene-asset.ts` changed. The seated body from F1.1b ([seated-avatars.md](seated-avatars.md)) is untouched: the same four meshes (head, torso, neck, legs), the torso pivoting at the hips with the same 0.56 m length, the neck, the seat's hip point and the real Sherman heights ([crew-heights.md](crew-heights.md)). The parts keep their names (`Crew N Head`, `Torso`, `Neck`, `Legs`), so the net test's checks and the practice crewmate need nothing new.

## Cost on a Quest 3

| | Before | After |
| --- | --- | --- |
| Draw calls for the crewmate | 4 meshes and 2 gloves | the same |
| Triangles (head, torso, neck, legs) | 872 | 1,366 |

About 500 more triangles for the one crewmate drawn, against a budget of 300,000. No new materials, textures, lights or per-frame work: the parts are merged once into the same vertex-coloured meshes. A player never sees their own avatar, only their gloves.

## Tests

- `test/z-fighting.test.ts`: the head, torso, neck and legs in two crew colours, and the whole crewmate seated, leaning in, to each side, looking round and at both eye heights, as before. The holster's flap and the anklets were moved to clear it.
- `npm run test:net` (`ONLY_BOT=1`): the crewmate is drawn with its torso on its hips, as before.

Pictures of the new crewman, made for this change, are in the project files under `avatars/wwii-crew/`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Open the game on a PC too, set **This page plays as → Practice crewmate** in its Settings (or add `?bot=1`) and join the headset's crew from it.

1. Sit in the **driver's** seat and look back over your right shoulder at the crewmate in the gunner's seat: a black beret with a headset over it, goggles up on the beret, a brown leather jerkin over khaki, a neckerchief in its colour, khaki overalls and black boots. Say whether it reads as a British tank crewman.
2. Watch it lean in to the gunsight while it lays: nothing on the head (beret, goggles, headset) pokes through the sight or the turret roof in a way that looks wrong.
3. In the cabin's light, say whether the beret and jerkin are too dark to make out, and whether the crew colour (neckerchief, shoulders, cuffs) is easy enough to see.
4. Open the menu (Y) → You → Scarf colour on the PC page and pick another colour: the crewmate's neckerchief, shoulder titles and cuffs change.
5. Note the frame time on the perf HUD (X on the left controller) looking at the crewmate: it should be no different from before.
