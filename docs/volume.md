# Volume sliders

John's play test (2026-11-15): "We need volume controls (sliders): master volume, engine volume, effects volume, and commander volume." Until now the game menu had two rows of buttons for sound: Tank sounds (On, Quiet, Off) and Commander (On, Quiet, Off).

## What the player gets

Game menu → **Sound and view** opens with four sliders, one row each:

| Slider | What it turns up or down |
| --- | --- |
| Master | Every game sound: the tank and the commander |
| Engine | The engine's exhaust and roar, the gearbox and final drives' whine, and the engine's own short sounds (the starter, catching, a cough, a stall) |
| Effects | The rest of the tank: the tracks' rumble, clatter, grit, strain and squeaks, the gun, the breech, ramming and the casing, the traverse motor and gears, the handwheels' ticks, the siren, gears going in or grinding, bumps |
| Commander | The commander's voice over the intercom ([commander-voice.md](commander-voice.md)) |

Each row is a track with − and + either side and the level beside it (100%, 35%, Off). Point the controller's ray at the track and pull the trigger to set the level there; hold the trigger and sweep the ray along the track to drag it. − and + step a tenth at a time, for a precise level without a steady hand. The track snaps to 5%. Every slider starts full, which is the mix as it was tuned, and each change is heard at once and kept in this browser for next time, as the other Sound and view settings are. Each player sets their own: nothing goes over the network.

The crewmate's voice isn't a game sound, so Master leaves it alone; it keeps its own mute in the Crew tab (and the start-up setting Crewmate's voice).

The Tank sounds and Commander button rows are gone. A choice saved from them still holds: Tank sounds became Master (its setting is still `sound`), so a player who had picked Quiet starts at Master 50%, and Commander's Quiet is Commander 50%.

## How a level becomes a gain

Ears hear loudness about as the square root of power, so a slider straight in gain does nearly all its work in its last quarter and sounds hardly to change across the top half. The gain is the level squared (`volumeGain`, `src/sim/volume.ts`): 100% is the mix as tuned, 50% is −12 dB, 25% −24 dB, 10% −40 dB and 0 silence. So each step down sounds about as big as the last. (The old Quiet was half the gain, −6 dB; 50% on the slider is quieter than that, and about 70% matches it.)

## How it is wired

- `src/sim/volume.ts` holds the rules, engine-free and unit-tested (`test/volume.test.ts`): `volumeGain`, `volumeAt` (a touch on the track to a level snapped to 5%), `stepVolume` (− and + to the next whole tenth), `volumeText`, and `tankHeard` / `commanderHeard` / `commanderGain`. Which short sound is under Engine and which under Effects is `SOUND_GROUP` beside `SOUND_FROM` in `src/sim/tank-audio.ts`.
- The settings are `sound` (Master), `enginevol`, `effectsvol` and `commander`, each 0 to 1 (`?sound=0.5&enginevol=0.3` in the URL too). `VOLUME_ITEMS` in `src/live-settings.ts` lists them for the menu and goes through `changeSetting`, so saving and `onSettingChange` work as for every live setting.
- The tank's sound graph (`src/systems/tank-sound-graph.ts`) puts a gain for the sound's group between each sound and its place in the tank (`into(group, place)`: one gain per group and place, made once, so a short sound played later makes nothing new), before the place's head-related panning, the cabin's echo, the intercom's duck and the gun's blast dip, which all work as before. Master is the graph's output level. With Master off, or Engine and Effects both off, the tank's audio context is suspended, as Tank sounds Off did.
- The commander's level is the intercom's own level times Master's gain times Commander's. With either off he says nothing (his calls are dropped as old news, and the board still logs every note), and his audio context is suspended.
- The menu row (`public/ui/menu.uikitml`, `vol-<key>`) is plain UIKit: a track with a fill whose width is the level, and two of the menu's stepper buttons. `GameMenuSystem.wireVolume` listens for the ray's pointer down, move and up on the track, capturing the pointer while the trigger is held as the Horizon kit's own slider does, and reads where it touched in the track's own frame (−0.5 at its left end, 0.5 at its right). The kit's slider wasn't used because its touch area is 64 px tall and labelled underneath, too tall for four rows on the page. The Sound and view page is 540 px tall now, inside the pages' 548 px.

## Practice and the crewmate

Nothing to practise: the sliders are in the menu wherever the player is. Practice → Tank sounds → Play each and Run through play the sounds to set them against. The practice crewmate's page is silent anyway.

## Test hooks

- `window.__gameMenu.slide(key, level)` sets a slider as a touch on its track would; `__gameMenu.text('vol-<key>-value')` reads its level.
- `window.__audio.state()` has `sound` (Master's level) and `engineVolume` and `effectsVolume` (the gains the groups play at now).
- XR step 6j: − steps Master to 90%, a ray touch at the track's left end turns it off (the audio suspended), at its right end full again, and a touch half way along Engine sets the engine's gain to a quarter while Effects stays full. Step 6za: Commander's track at its left end keeps him quiet while the board still asks for his calls, and at its right end he is full again.

## Headset check

1. Play solo, Practice → Drive the tank, start the engine and drive off. Game menu (Y) → Sound and view.
2. Drag Engine down to Off and back up with the ray held on the track: the engine's drone should go and come back while the tracks keep clattering. The level beside the track should follow the ray.
3. Drag Effects down: the tracks should go quiet while the engine stays. Press − and + a few times and check each press moves it a tenth.
4. Master down to about 30%: everything should be quieter together, nothing left at full. Then Off: silence; back to 100%.
5. Combat → Damage → Hit engine, with Commander at 50%: he should be clearly quieter than before but still easy to understand. Set it where you like it.
6. Close the menu and reload the page (Ctrl+Shift+R on a PC page, or leave and come back on the headset): the four levels should be as you left them.
7. Say whether the sliders are easy to hit and drag with the ray, and whether each step down sounds about as big as the last.
