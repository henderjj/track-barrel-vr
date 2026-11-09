# Tank audio and the intercom (F1.12, sound pass F6.1)

The tank has a voice: an engine that follows the revs and the throttle, gears whining, tracks rumbling, clattering and squealing, the power traverse, the handwheels' gears, and short sounds for the gearbox, the hull bumping, the loading and the gun. The crewmate's voice plays plain, like a tank intercom in the crew's headphones, and the tank's sounds drop 12 dB while either player speaks so the intercom stays clear (concept §6, plan §4.8).

Everything is synthesised with Web Audio at load: no sample files, nothing from a CDN.

F1.12's sounds were placeholders (John's play test, 2026-11-07). The sound pass (F6.1) rebuilt every one of them on the real tank: what each thing is made of, how often it is struck, and what the crew would hear of it inside a steel box. John chose modelled sounds over recordings (2026-11-09): they follow the revs, the speed and the controls exactly and need no licences or downloads, and any one of them can still be swapped for a recording later.

## What players hear

- **The engine**, all the time. An M4A4's engine is Chrysler's A57 multibank: five six-cylinder petrol car engines geared round one shaft, thirty cylinders. It is not a diesel, and it doesn't knock: it is a deep, smooth burble, five sixes not quite in step. Each bank fires three times a turn, so the beat is 40 a second at idle and 130 flat out, and the note follows the RPM gauge exactly, so a gear change sounds like one. Pulling, it is louder and harder-edged, and a roar of fan, intake and burning rises over the exhaust; with the throttle shut at the same revs it falls back to a hum. It hunts a little at idle, as engines do.
- **The gears**. A Sherman's gearbox and final drives are in the nose beside the driver, and their straight-cut gears whine: the gearbox with the engine (quiet out of gear), the final drives with the tracks, a low growl that climbs to about 250 Hz at top speed.
- **The tracks**, while the tank moves (a pivot turn too). A rumble through the floor that opens up with speed; each track's links meeting its sprocket, one clank per 15 cm of track, so at walking pace you hear each link and at speed they run together into the drone of the tracks; and now and then a dry pin squealing, most in a turn. The left track is heard on the left and the right on the right, and in a turn the inner one clatters slower than the outer.
- **The power traverse**: the electric motor's whine, the gear train growling under it and the turret ring rumbling round, all rising with the turret's speed.
- **The handwheels**: the traverse crank's and the elevation wheel's gears tick as the gunner turns them, 14 ticks a turn.
- **The gearbox**: the lever clicking through its gate, then the gear going home with a thud in the cast case; and for as long as the gears grind (shifting with a tiller pushed, docs/driver-station.md), teeth clashing 60 times a second with a rasp between.
- **The engine starting and stopping** (F1.17, [engine.md](engine.md)): the starter's whine sagging as each bank comes up on compression, eight times a second; a ragged run of firings quickening into a bark as it catches; a hollow pop when a cold engine misfires; and a stall's few weakening beats before the engine shudders to rest. Run down or run up, the engine's own burble slows or quickens with the revs. The siren, held on the driver's switch strip, wails at 620 Hz on both pages.
- **A bump**: a deep thud through the floor, the armour groaning and the stowage rattling.
- **The loading**: the shell sliding up the chamber and its rim stopping against the breech face; the block sliding across and slamming shut on a heavy lump of steel; and, opened by hand, the catch clicking and the block stopping against its buffer.
- **The gun**, from inside. The blast slams through the armour as a crack with no top to it and a boom you feel; the hull rings like a struck tank; the gun slams back, the breech flies open and throws the case out; the gun runs out and thuds into battery; everything loose in the turret jumps; and the report rolls back off the range, twice, then a third time further off. For a moment after it the crew hear little else: the engine and tracks dip to a third and come back over a second. Half a second after the shot the brass case lands in the bin, clangs, bounces lower and sooner each time, and rolls to rest.
- **The cabin**. Every sound also goes through the echo of a small steel box: reflections off walls a metre or two away and a short tail that loses its top quickly. It is what makes the breech sound as if it is in the tank with you.
- **Where sounds come from**. Each is heard from its place in the tank as you turn your head: the engine behind the bulkhead, the gearbox ahead and to the driver's right, a track at each side, the breech and the casing bin with the turret wherever it points, the traverse gear by the gunner's right hand, the siren out on the left front mudguard. Most of each sound still comes from all round, as it does in a steel hull: the place is a lean, not a pinpoint.
- **The intercom**: the crewmate's voice, plain (not positioned). While either player's voice is above the speaking level, the tank's sounds dip by 12 dB within a twentieth of a second, hold through the gaps between words, and come back over about half a second.

## How the sounds are made

Three files: the rules in `src/sim/tank-audio.ts`, the samples in `src/sim/sound-render.ts` (both engine-free and unit-tested), and the Web Audio graph in `src/systems/tank-sound-graph.ts`, which `TankAudioSystem` drives. The graph knows nothing of the game, so `scripts/render-sound-preview.mjs` can run the same graph offline.

- **Something strikes, something rings.** A short sound is a blow (a low thump, a burst of noise, steel sliding on steel) and the ring of what was struck: a set of modes, each a decaying sine. The bodies are armour plate (26 modes from 105 Hz, the lowest ringing half a second), the breech's steel, a brass case, the bin's sheet metal, the gearbox's cast case, gear teeth and loose kit. Plate and cast steel ring at frequencies that are no harmonics of each other, which is why they clang and don't sing.
- **What moves, and what stays put.** The first engine sounded like a toy because its whole sound slid up and down with the revs. In a real one only the source changes: the firings come faster, but the exhaust pipes, the silencers and the hull they are heard through ring where they always did. So the engine is one loop of exhaust pulses (every cylinder's, over 16 four-stroke cycles) played as fast as the engine turns, through filters that don't move with the revs. The tracks work the same way: a gate opens once a link, faster as the track runs faster, and lets a click of noise into resonances that stay where they are, so the links come quicker without turning into a higher note.
- **Nothing is quite even.** Thirty perfectly even cylinders would make one hum at 200 Hz. The banks aren't timed against each other, no bank is as loud at the crew's ears as the next, no two cylinders are as strong, about one firing in sixteen is weak, and none comes at quite its moment: that is the burble. No two links land as hard, no two blows on the casing excite the same mix of its modes.
- **Low, but not too low.** A headset's speakers pass little under 100 Hz, so the rumble has nothing below 38 Hz to waste the headroom, and the engine, the tracks and the gun all carry most of what they have between 100 and 1000 Hz. Levels fall away steadily above that, as they do inside real tracked vehicles.

## Numbers

All in `src/sim/tank-audio.ts` unless said.

| What | Value |
| --- | --- |
| Engine beat | one bank's firings: RPM ÷ 60 × 3, so 40 Hz at idle (800 rpm) and 130 Hz at top (2600 rpm); all thirty cylinders fire five times as often |
| Engine loop | `renderEngineLoop`: 16 cycles (2.4 s at idle), 480 firings; each bank an even six at its own place in the cycle; banks at 1, 0.8, 0.62, 0.9 and 0.55 of full level; cylinders ±30%; each firing ±25%, 6% of them weak, ±0.6 ms early or late. Played at RPM ÷ idle, wavering by 10 and 6 cents at 0.31 and 1.13 Hz |
| Exhaust filter | low-pass at 300 Hz + 240 × revs + 260 × throttle, and again at 2.5 times that; pipe resonances at 92 and 185 Hz; nothing under 28 Hz |
| Exhaust level | 0.42 + 0.23 × revs + 0.35 × throttle (revs and throttle 0 to 1) |
| Roar | noise from 520 Hz (wide) to 2.2 kHz, pulsing with the firing; 0.1 + 0.5 × revs² + 0.4 × throttle × (0.3 + 0.7 × revs) |
| Gearbox whine | 19 teeth a turn of the engine (253 Hz at idle, 823 Hz at top) through a 620 Hz band; 0.15 of full out of gear |
| Final drives' whine | 26 Hz for each m/s of track, about 250 Hz at top speed |
| Track rumble | brown noise, low-pass 140 to 640 Hz with speed, floor resonances at 78, 155 and 245 Hz, nothing under 38 Hz; level (speed ÷ top speed)^0.7 |
| Link clatter | one link per 15 cm of each track (65 a second at top speed); each lets noise into bands at 330, 590, 1040, 1730 and 2600 Hz and lands as a thud about 110 Hz |
| Pin squeal | two narrow bands of noise near 2350 and 3120 Hz, wandering in pitch, in 8 swells over 6 s at 2.5 m/s (faster with speed); 0.3 of full driving straight, full with the tracks 3 m/s apart |
| Traverse | motor 110 to 540 Hz with the turret's rate up to 24°/s; gear growl about 420 Hz beating 8 to 133 times a second; ring rumble 55 to 220 Hz |
| Handwheels | 14 ticks a turn of the crank or the elevation wheel |
| Gun's blast dip | the steady sounds to 0.3 within about 0.04 s, held 0.12 s, back over 0.5 s (a time constant) |
| Cabin echo | `renderCabinImpulse`: 0.45 s, 12 first reflections between 3 and 19 ms, a tail dying with a 0.065 s time constant; sends: gun 0.55, knocks 0.4, turret 0.22, engine 0.1, tracks 0.08 |
| Places | `SOUND_PLACES`; 0.6 of a sound from its place, the rest from all round; no quieter with distance |
| Mix peaks | gun 0.95, clunk 0.55, breech 0.5, bump 0.5, catch 0.5, clatter 0.5, stall 0.45, cough 0.42, engine 0.4, ram 0.35, crank 0.32, rumble 0.3, grind 0.3, traverse gear 0.3, hand gears 0.3, casing 0.28, latch 0.25, siren 0.16, squeal 0.14, roar 0.11, traverse rumble 0.09, final drives 0.05, traverse whine 0.03, gearbox 0.016. The continuous ones are gains on filtered noise and loops, so they aren't peaks: measured, the engine idles at about −26 dBFS RMS and the tank flat out is about −18 |
| Duck | −12 dB (−6 dB until John's play test of 2026-11-07, which nobody could hear under a voice) while a voice's RMS level is at or above 0.01; attack 0.05 s, hold 0.35 s, release 0.4 s |
| Short sounds | clunk 0.5 s, grind 0.5 s loop (30 tooth blows), shot 3.2 s, breech 0.7 s, latch 0.45 s, casing 1.4 s (six bounces), ram 0.4 s, bump 0.9 s, crank 0.5 s loop (4 compressions), catch 1.2 s, cough 0.4 s, stall 1.3 s |
| Out | the duck, the Tank sounds setting, then a soft clip: straight up to 0.7 of full scale, bending over towards 1, so the gun over a roaring engine doesn't crackle |

Building the graph renders every sample once, at page load: about a fifth of a second on a PC, so expect up to a second on a Quest 3, before Enter VR.

## How both players share it

Nothing new goes over the network. Each page plays the tank as it draws it: the engine and tracks from the tank state (the host's simulation, or a guest's copy of it), the throttle from the driver's controls as drawn, the traverse and the handwheels from the turret as drawn (how fast its crank and elevation are changing), the breech and ram from the loading as drawn (the gunner's own, or their packets), and the gun from every shot through `shotListeners`. The short sounds come from changes in that state (`SoundCues`): a new gear engaged, the bump count going up, the lever crossing just short of closed, the rammed flag. The breech opening by itself after a shot is part of the shot's sound, so the cue skips an opening within 1.2 s of a shot (the crewmate's copy of the lever arrives late). Alone, the page hears its own tank.

Each player hears the tank from their own head: the driver has the gearbox at their elbow and the engine well behind, the gunner the breech at their left.

The duck listens to both voices: this player's microphone (an analyser in `src/net/voice.ts`, `micLevel()`) and the crewmate's voice as heard (`remoteLevel()`), passed on as `netLink.micLevel` and `netLink.crewLevel`. Muting either one takes it out of the duck.

## The intercom

`?voice=plain` is the default (plan §2: both players sit within 2 m, and the intercom should sound like headphones). The start-up setting **Crewmate's voice** offers Intercom (the default), From where they stand (the old spatial voice, kept for comparison) and Off. A player who saved From where they stand keeps it. The loopback route for echo cancellation (`?voiceloop=1`) only applies to the spatial voice, so the network test's lagged pair asks for it.

## Settings and Practice

- **Settings → Sound and view → Tank sounds**: On, Quiet (half) or Off, at once and kept (`?sound=1`, `0.5`, `0`). Off suspends the audio context.
- **Practice → Tank sounds → Play each**: the clunk, a second of grind, the ram, the breech, the shot (with its casing), the latch, the bump, a second of the starter, the catch, a cough and a stall, a second apart, without driving or loading.
- **Practice → Tank sounds → Run through**: the continuous sounds without driving or laying the gun, half a minute (`soundTour`): the engine idles, is revved out of gear and let fall; the tank pulls away up through the gears to top speed, turns left and slows to a halt; the turret traverses under power one way and slowly back; then the traverse crank and the elevation wheel are turned by hand. Only the sounds: the tank and the turret don't move. Pressed again, it stops.
- The line under them says whether sound is on, the engine's beat, how long the run through has to go and whether the intercom duck is in.
- Browsers start audio only after a click, a key or Enter VR; until then the line says so. The audio context suspends while the page is hidden or the headset is off.

## Hearing them without a headset

`node scripts/render-sound-preview.mjs [out-dir] [scene ...]` renders the same graph the game plays to WAV files, offline in a headless Chromium (48 kHz stereo; `artifacts/sound-preview/` by default). Three scenes: `tour` (Run through, from the driver's seat), `gunnery` (from the gunner's seat with the engine idling: a shell rammed, the breech closed, the gun fired and its casing, loaded again, the breech opened by hand, the handwheel and the power traverse) and `starting` (from the driver's seat: the starter, the engine catching, a blip of throttle, a gear going in, a grind and the gear after it, a bump, a cough and a stall). Listen on headphones: the clips are placed for a head in the seat, looking forward.

Nobody can listen in the cloud, so the sounds were tuned by measuring these clips: each layer's level, its spectrum band by band and its strongest tones, and spectrograms of the clips. That can show a sound is the right shape (the engine's harmonics where the banks fire, no one tone drowning the rest, levels falling away with frequency as in a real tank, no clicks at a loop's join) but not that it is convincing. That is for the headset check.

## The practice crewmate

Its PC page makes no sound (it would only echo the headset's tank through the PC's speakers), and it has no microphone, so it never ducks the headset's tank. Nothing for it to learn: it hears nothing and says nothing.

## Departures from the building skill

- **No model**: nothing new to draw, so nothing for the z-fighting test.
- **One audio node per short sound played.** A Web Audio buffer source plays once, so each short sound makes one node when it plays. They come a few times a second at most (none in a quiet frame); the continuous sounds' nodes (about 170) are made once and only have their parameters glided, 20 times a second. The listener (the player's head) is moved every frame, with no allocation.
- **Placed by head-related panning, without distance.** Eight panners, one per place; everything is as loud wherever the head is. The cabin is two metres across, so falling off with distance would only make the far seat's sounds thin.

## Tests

- `test/tank-audio.test.ts`: the engine's beat, rate, filter, level and roar with revs and throttle, and its run-down; the engine loop (seamless, the banks' beat and its harmonics all present, none drowning the rest, the half-orders between them); the gears' whines; each track's rate and level, the pivot turn and the squeal in a turn; the traverse and the handwheels; where each sound comes from; the sound tour; the duck's attack, hold, release and quiet-room threshold; every cue (and none on the first frame, no clunk into neutral or while grinding, no latch after a shot); every short sound's length, peak and fade to silence, rendered the same twice; the grind's and the starter's seamless loops and the starter's eight beats a second; the gun's crack, boom and echoes; the casing's bounces and its brass still ringing; the noise, gate and squeal loops; the cabin's echo.
- `test/settings-menu.test.ts`: plain is the voice default; Tank sounds is saved and parsed.
- `npm run test:xr` step 6j: the earlier steps' loading and shot were heard; driving raises the engine's beat and roar with the throttle open, the final drives whine and both tracks rumble and clatter; the traverse crank ticks as it turns and stops; the sounds are heard from the player's head in the driver's seat; Practice → Tank sounds → Play each plays every short sound; Run through revs the engine with the tank standing and stops when pressed again; the Tank sounds row turns them off and on.
- `npm run test:net`: the voice is plain and both pages' tank sounds duck while the fake microphones beep (measured at the output, about 12 dB); both pages hear the guest gunner's ram, breech, shot and casing, on a clean link and at 150 ms RTT.

The emulator can't listen: the browser tests check what the page asks Web Audio to play. How it sounds is for the headset check.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Wear the headset's own speakers (or headphones) at a comfortable volume. Report what sounds wrong, too quiet or too loud, not only what works: every sound here was tuned by measurement, never by ear.

1. Enter VR alone. Game menu (Y) → **Practice → Tank sounds → Run through**, and listen for half a minute without touching anything. The engine idles as a deep, smooth burble (not a diesel's knock, not a buzz), revs up and falls back; then the tank "drives": the engine climbs through four gear changes, the tracks rumble and clank faster and faster with a gear whine under them, the left track slows in a turn and you may hear a squeal; then the turret's motor and gears run up, stop and run slowly back; then two bursts of fine ticking from the handwheels. Say which part is least convincing, and whether anything is shrill, buzzy or tiring.
2. **Play each**. A second apart: the gear lever's click and thud, a second of grinding, a shell going home, the breech slamming, the gun (the blast, the hull ringing, the breech flying open, the echoes off the range, then the casing clanging and bouncing in the bin), the breech opened by hand, a bump, a second of the starter, the engine catching, a cough and a stall. Each should sound as if it happened inside the tank with you. Say which is least convincing.
3. **Practice → Drive the tank**. Turn your head: the engine stays behind you, the gears ahead and to your right, a track on each side. Drive off and change up: the engine's note falls back at each change, and with your foot off at speed it quietens to a hum while the tracks carry on. Turn: the inner track clatters slower. Is the engine too loud or too quiet against the tracks at top speed?
4. Shift with a tiller pushed: the grind rasps until you let the tiller go, then the gear clunks in, both from the gearbox at your right. Drive gently into a rock or a wall: a thud and a rattle. Stop the engine and start it: the starter's whine, the catch, the burble running up.
5. **Practice → Load and fire**. Ram a shell, close the breech, fire. The breech sounds come from the gun at your left, wherever the turret points; the blast comes from everywhere, the engine drops away for a moment after it, and the casing lands in the bin by your left leg half a second later. Is the gun loud enough against everything else? Turn the turret with the power grip (motor and gears, rising with the speed), then with the crank, and lay with the elevation wheel (fine ticks).
6. **Settings → Sound and view → Tank sounds**: Quiet halves it, Off silences it at once, On brings it back. Leave it on.
7. With a second headset (or the practice crewmate on a PC, which stays silent): talk. The crewmate's voice sounds plain, like headphones. While either of you speaks, the tank clearly dips and comes back after you stop; say whether you can hear each other over the engine flat out.
8. Press **X** for the perf HUD while driving and firing: report the frame time. The sounds run off the main thread, but there are far more of them than before; the game's JavaScript should be unchanged, and the sound should never crackle or stutter. If it does, say when.
