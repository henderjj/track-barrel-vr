# Seated avatars (F1.1b)

From John's play test (2026-11-07): the crewmate's avatar came apart at the legs and its torso looked very stretched. This change pins the torso to the hips so the body bends rather than slides, and dresses it for sitting. John picked this approach (option A of four, with mock renders, 2026-11-08) and asked for the neck to follow the head when leaning sideways. The sums live in [`src/sim/seated-body.ts`](../src/sim/seated-body.ts); the model is in [`src/scene-assets/avatar.scene-asset.ts`](../src/scene-assets/avatar.scene-asset.ts) (`poseCrewBody` places it), and `NetSystem.applyRemote` ([`src/systems/net-system.ts`](../src/systems/net-system.ts)) draws it each frame.

## What was wrong

- **Nothing joined the body to the legs.** The legs sit still in the seat; the torso was one stiff piece hung from the crewmate's head, turning only with it. A lean in to the periscope or gunsight, a turn of the head, a raised or dropped eye height (the menu's ±15 cm) or standing up slid or twisted it off the legs.
- **It was a standing figure.** The coat hung straight from the shoulders to 1.01 m under the eyes: 11 cm below the cushion, through the seat, rather than folding at the hips.
- The seat puts the eyes 0.90 m above the cushion (`SEATED_EYE` 1.45 m, cushion 0.55 m); a 1.75 m person sitting has theirs about 0.79 m above the seat, so the body spans about 10 cm more than it would. The jacket's proportions absorb that; raising the cushion is left for later if the body still reads tall in the headset.

Eye raise and calibration ([seat-choice.md](seat-choice.md)) were working as meant: they move the head, and the body followed it.

## What players experience

The crewmate sits on the cushion in a waist-length jacket, belt and trousers, and moves like a seated person:

- **Leaning in or to the side** bends the body at the hips; the hips stay on the cushion.
- **Turning the head** turns the shoulders about a third as far (at most 34°); the neck does the rest. Looking straight back, the shoulders swing round quickly rather than jumping.
- **Nodding** bends the neck; only half a nod tips the shoulders.
- **Tilting the head** to one side as they lean tilts the neck the same way, carrying on the body's line (John's note on the mock).
- **A raised or dropped eye height** stretches or shrinks the torso a little, the neck taking the rest.
- **Standing up out of the seat** (the player's own view fades) lifts the torso off the cushion after the head once the neck is at its longest.

The practice crewmate now turns its head on its neck, as a real head does, and as gunner it leans in to the gunsight's eyecup while it lays the gun, so a lone player can see the body bend.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Neck's base from the eyes | 20 cm down, 9 cm back | between the shoulders, where a head turns and nods |
| Torso at rest, hip point to the neck's base | 0.62 m | reaches from the seat's hip point (8 cm above the cushion) to under the eye point |
| Stretch along the spine | 0.88 to 1.15 | beyond that it would look stretched again; the neck takes the rest |
| Neck, torso's top to inside the skull | 16 cm at rest (about 9 cm shows), at most 26 cm | past it the torso rises off the seat |
| Shoulders' share of the head's turn | 35%, at most 0.6 rad | the rest is the neck |
| Shoulders' turn rate | 4 rad/s | a quick swing, not a jump, past straight back |
| Share of a nod that tips the neck's base | 50% | |
| Practice gunner's lean while laying | 14 cm forward, 3 cm down | the eyecup is 16 cm ahead (the head box's front edge) |

The torso, neck, legs and head are four meshes (one more than before, the neck) of about 900 triangles in all.

## Sharing

Nothing new is sent. Each page draws its crewmate from the head pose it already receives; the legs' seat and the turret's turn come from `seating`, as before.

## Departures from the building skill

- No Practice button or XR step: only a crewmate is drawn this way, so the checks are in the net test, and the practice crewmate (which now leans in to the sight as gunner) is the way to see it alone.

## Tests

- `test/seated-body.test.ts`: in each seat the body sits up on the hips in proportion; leaning in bends it at the hips and keeps the hips on the seat; leaning to the side with the head tilted keeps the neck on the body's line; turning the head on the neck leaves the neck's base still and turns the shoulders a share; nodding; a raised or dropped eye height stretching only a little; standing up lifting the torso; the shoulders swinging round, not jumping, past straight back; the angles matching three.js's.
- `test/z-fighting.test.ts`: the neck alone, and the whole crewmate posed sitting, leaning in, to each side, looking round and at both eye heights.
- `npm run test:net` (`ONLY_BOT=1`): with the player driving, the crewmate gunner leans in to the sight while it lays, and the player's page draws its torso on its hips; the neck is among the crewmate's drawn parts.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Open the game on a PC too, set **This page plays as → Practice crewmate** in its Settings (or add `?bot=1`) and join the headset's crew from it.

1. Sit in the **driver's** seat. Look back over your right shoulder at the crewmate in the gunner's seat: it sits on the cushion with its hips, jacket and legs joined, and no coat through the seat.
2. Watch it lay on the 100 m target: it leans in to the gunsight, bending at the hips, then sits back after the shot. Its neck and shoulders turn a little as it looks about.
3. Menu → Practice → Sit in → **Gunner**. Look down and left at the crewmate driving: the same, from above.
4. With a second person in the other headset (or the PC page in a crew without the practice crewmate): ask them to lean in to their periscope, lean to each side, look over each shoulder and nod. Say whether anything still comes apart, looks stretched or bends oddly, especially the neck.
5. If the torso still reads tall, say so: raising the seat cushion about 8 cm is the next step.
6. Press **X** for the perf HUD with the crewmate in view and report the frame time and draw calls.
