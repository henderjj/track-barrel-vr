# Tank audio and the intercom (F1.12)

The tank gets its voice: an engine note that follows the revs, the tracks rumbling and clattering, the power traverse's whine, and short sounds for the gears, the hull bumping, the loading and the gun. The crewmate's voice now plays plain, like a tank intercom in the crew's headphones, and the tank's sounds drop 6 dB while either player speaks so the intercom stays clear (concept §6, plan §4.8).

Everything is synthesised with Web Audio at load: no sample files, nothing from a CDN.

## What players hear

- **The engine**, all the time: a big V12 diesel heard through the hull, a deep lumpy beat of firings rather than a note. It quickens from 30 firings a second at idle to 62 flat out (a narrower spread than the RPM gauge's, as a heavy diesel sounds) and grows louder and harder-edged under load. The hand throttle raises it. (The first version was a sawtooth note from 80 to 260 Hz; the first headset listen said it sounded like an 8-bit racing car.)
- **The tracks**, while the tank moves (a pivot turn too): a low rumble that deepens and opens up with speed, and the links' clatter, one tick per 15 cm of track, so at walking pace you hear each link and at speed they blur into the rumble.
- **The power traverse**: a thin electric whine rising with the turret's turn.
- **The gearbox**: a heavy clunk as a gear goes in, and a rasping grind for as long as the gears grind (shifting with a tiller pushed, docs/driver-station.md).
- **The engine starting and stopping** (F1.17, [engine.md](engine.md)): the starter's slow whirr, beating four times a second while it cranks, a cough and roar as it catches, single coughs when a cold engine misfires, and a sigh as it stalls, the engine's beat slowing and fading as it runs down. The siren, held on the driver's switch strip, wails at 620 Hz on both pages.
- **A bump**: a deep thud through the floor when the hull meets an obstacle.
- **The loading**: a thunk as the shell goes home, the breech block slamming shut as the lever closes, and a lighter clack when a hand opens it again.
- **The gun**: a crack, a boom and a long rumble, the breech flying open as the gun runs out, then the casing ringing and bouncing in the bin half a second later.
- **The intercom**: the crewmate's voice, plain (not positioned). While either player's voice is above the speaking level, the tank's sounds dip by 6 dB within a twentieth of a second, hold through the gaps between words, and come back over about half a second.

## Numbers

All in `src/sim/tank-audio.ts`.

| What | Value |
| --- | --- |
| Engine beat | 30 Hz at idle (800 rpm) to 62 Hz at top (2600 rpm), linear in the revs: one rendered cycle of 12 firings (`renderEngineCycle`), each a dull thump of the block, a chuff of exhaust and a short knock, with its timing (±6%) and strength (±20%) varied so the beat is lumpy, played faster as it revs |
| Engine filter | low-pass 380 Hz at idle to 900 Hz at top RPM, Q 0.9: the hull muffles it |
| Track rumble | brown noise, low-pass 90 to 590 Hz, level (speed / top speed)^0.7 |
| Link clatter | white noise through a 1.1 kHz band-pass, one tick per 15 cm of track, up to 45 a second |
| Traverse whine | triangle, 180 to 880 Hz with the turret's rate up to 24°/s |
| Mix peaks | gun 0.95, clunk 0.55, breech 0.5, bump 0.5, catch 0.5, stall 0.45, cough 0.42, ram 0.35, engine 0.32, crank 0.32, rumble 0.3, grind 0.3, casing 0.28, latch 0.25, siren 0.16, clatter 0.1, whine 0.03 |
| Duck | −6 dB while a voice's RMS level is at or above 0.01; attack 0.05 s, hold 0.35 s, release 0.4 s |
| Short sounds | clunk 0.45 s, grind 0.5 s loop (30 tooth beats), shot 2.2 s, breech 0.6 s, latch 0.35 s, casing 1.1 s (four bounces), ram 0.35 s, bump 0.7 s |

The short sounds are rendered once into buffers from decaying sines, gliding thumps and filtered noise bursts (`renderSound`), deterministic so both pages hear the same tank and the tests can check them. The noise loops for the rumble and clatter meet themselves at the join, so they loop without a click.

## How both players share it

Nothing new goes over the network. Each page plays the tank as it draws it: the engine and tracks from the tank state (the host's simulation, or a guest's copy of it), the whine from the turret as drawn, the breech and ram from the loading as drawn (the gunner's own, or their packets), and the gun from every shot through `shotListeners`. The short sounds come from changes in that state (`SoundCues`): a new gear engaged, the bump count going up, the lever crossing just short of closed, the rammed flag. The breech opening by itself after a shot is part of the shot's sound, so the cue skips an opening within 1.2 s of a shot (the crewmate's copy of the lever arrives late). Alone, the page hears its own tank.

The duck listens to both voices: this player's microphone (a new analyser in `src/net/voice.ts`, `micLevel()`) and the crewmate's voice as heard (`remoteLevel()`), passed on as `netLink.micLevel` and `netLink.crewLevel`. Muting either one takes it out of the duck.

## The intercom

`?voice=plain` is now the default (plan §2: both players sit within 2 m, and the intercom should sound like headphones). The start-up setting **Crewmate's voice** offers Intercom (the default), From where they stand (the old spatial voice, kept for comparison) and Off. A player who saved From where they stand keeps it. The loopback route for echo cancellation (`?voiceloop=1`) only applies to the spatial voice, so the network test's lagged pair now asks for it.

## Settings and Practice

- **Settings → Sound and view → Tank sounds**: On, Quiet (half) or Off, at once and kept (`?sound=1`, `0.5`, `0`). Off suspends the audio context.
- **Practice → Tank sounds → Play each**: the clunk, a second of grind, the ram, the breech, the shot (with its casing), the latch and the bump, a second apart, without driving or loading. The line under it says whether sound is on, the engine's note and whether the intercom duck is in.
- Browsers start audio only after a click, a key or Enter VR; until then the line says so. The audio context suspends while the page is hidden or the headset is off.

## The practice crewmate

Its PC page makes no sound (it would only echo the headset's tank through the PC's speakers), and it has no microphone, so it never ducks the headset's tank. Nothing for it to learn: it hears nothing and says nothing.

## Departures from the building skill

- **No model**: nothing new to draw, so nothing for the z-fighting test.
- **One audio node per short sound played.** A Web Audio buffer source plays once, so each short sound makes one node when it plays. They come a few times a second at most (none in a quiet frame); the continuous sounds' nodes are made once and only have their parameters glided, 20 times a second.
- **Not positioned.** Everything is heard from the middle of the tank. The cabin is small and the engine is everywhere; positioning the breech and casing for the gunner can come later if the headset check asks for it.

## Tests

- `test/tank-audio.test.ts`: the engine, track and whine numbers; the diesel cycle (seamless, a pulse per firing, uneven); the duck's attack, hold, release and quiet-room threshold; every cue (and none on the first frame, no clunk into neutral or while grinding, no latch after a shot); every short sound's length, peak and fade to silence, rendered the same twice; the grind's seamless loop; the casing's bounces; the noise loops.
- `test/settings-menu.test.ts`: plain is the voice default; Tank sounds is saved and parsed.
- `npm run test:xr` step 6i: the earlier steps' shifts, loading and shot were heard; driving quickens the diesel's beat and the tracks rumble; Practice → Tank sounds → Play each plays every short sound; the Tank sounds row turns them off and on.
- `npm run test:net`: the voice is plain and both pages' tank sounds duck while the fake microphones beep; both pages hear the guest gunner's ram, breech, shot and casing, on a clean link and at 150 ms RTT.

The emulator can't listen: the browser tests check what the page asks Web Audio to play. How it sounds is for the headset check.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Wear the headset's own speakers (or headphones) at a comfortable volume. Report what sounds wrong, too quiet or too loud, not only what works.

1. Enter VR alone. Game menu (Y) → **Practice → Tank sounds → Play each**. You hear, a second apart: a gear clunk, a second of grinding, a shell thunk, the breech slam, the gun (crack, boom, rumble, then the casing bouncing), a lighter clack and a deep thud. The line under the button says "Sound on". Say which sound is least convincing.
2. **Practice → Drive the tank**. At idle the engine is a slow, deep, uneven diesel thrum. Drive off: the beat quickens (no higher than about double) and hardens, the tracks rumble and you can hear the links tick at low speed, blurring as you speed up. Pivot on the spot: the tracks still rumble. Raise the hand throttle: the idle rises.
3. Shift with a tiller pushed: the grind rasps until you let the tiller go, then the gear clunks in. Drive gently into a rock or a wall: a thud.
4. **Practice → Load and fire**. Ram a shell (thunk), close the breech (slam), fire (crack and boom, the breech flying open, the casing ringing in the bin by your left leg). Open the breech by hand once without firing: a lighter clack. Turn the turret with the power grip: a thin whine that rises with the speed.
5. **Settings → Sound and view → Tank sounds**: Quiet halves it, Off silences it at once, On brings it back. Leave it on.
6. With a second headset (or the practice crewmate on a PC, which stays silent): talk. The crewmate's voice sounds plain, like headphones, not from where they sit. While either of you speaks, the engine and the gun dip a little and come back after you stop; say whether the dip is enough to hear each other over the engine flat out, and whether it pumps annoyingly. The game menu's line under Tank sounds says "ducked -6 dB" while someone speaks.
7. As the driver with a crewmate gunner: you hear their shell go home, the breech close and the gun fire. As the gunner with a crewmate driver: you hear the engine and gears follow their driving.
8. Press **X** for the perf HUD while driving and firing: report the frame time (the sounds run off the main thread; the game's JavaScript should be unchanged).
