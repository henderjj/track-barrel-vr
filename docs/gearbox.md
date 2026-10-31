# Gearbox (F1.16)

The tank gets the Sherman's gearbox: five forward speeds and a reverse, worked one of three ways the player picks in the menu. In **Automatic** (the default) the tillers drive as they always have and the box changes gear by itself. In **Stick shift** and **Clutch** the controls work as a real Sherman's: the right trigger is the accelerator, the tillers are only brakes, and the player changes gear with the right stick, with or without working the clutch on the left trigger.

It answers John's play-test notes (30 October 2026): the two-range gearbox wasn't useful, because high gear pulled away as well as low, and shifting needed the tillers centred, which braked the tank. He asked for an automatic box for easy play, a clutch and gears on the sticks and triggers (the hands stay on the tillers), a reverse gear, and the right trigger as the accelerator so the tillers can work as a real tank's. The research and the plan are in the proposal doc *Driver's controls, second pass*. The engine start-up (F1.17) and the parking brake (F1.18) come next.

The numbers are in [`src/sim/gearbox.ts`](../src/sim/gearbox.ts). The drive that steps it is in [`src/sim/tank-drive.ts`](../src/sim/tank-drive.ts) ([tank-drive.md](tank-drive.md)), and the lever is the driver's station's ([driver-station.md](driver-station.md)).

## What players experience

- **Menu → Tank → Driving → Gearbox**: Automatic, Stick shift or Clutch. It changes at once, is kept in this browser like the other settings, and the driver's choice is the one the tank runs on (it goes to the host with the driver's controls).
- **Five gears from the Sherman's ratios** (7.56, 3.11, 1.78, 1.11, 0.73; reverse 5.65), scaled so 5th still reaches 35 km/h. The low gears pull hard but run out of speed, and the high ones are fast but slow to pull. The engine's revs follow the tracks through the gear, so the rev counter and the diesel's note climb through each gear and drop when the next one goes in.
- **Changing gear coasts.** Between gears (and with the clutch in, or in neutral) the tank rolls on, slowing gently as its tracks drag, instead of braking.
- **The gear lever** on the gearbox's hump has a notch for each gear: reverse furthest back, then neutral, then 1st to 5th going forwards (a red mark beside reverse, a green one beside neutral). It moves whenever the gear changes, however it is changed.

### Automatic (the default)

- The tillers work as before. Each one's push asks its track for a share of the tank's top speed. Both forwards drive straight, one back turns, one forwards and one back pivots on the spot, and both back reverse (at up to 4.5 km/h, as the reverse gear would).
- The box pulls away in 2nd, changes up as the revs reach 2250 rpm while the tillers ask for more, and changes down below 1100 rpm. Each change takes a third of a second out of gear. It never grinds, and the lever moves by itself and can't be taken hold of.
- A player using tracked hands rather than controllers always drives with Automatic: there are no triggers to squeeze. So does the practice crewmate.

### Stick shift and Clutch: a Sherman's controls

- **Right trigger: the accelerator.** The engine drives both tracks through the gear in. Let go of it and the engine idles.
- **The tillers are brakes.** Upright is released, and pushing them forwards does nothing. Pull one back and it brakes its track; through the controlled differential that slows that side and speeds the other, so the tank turns that way on a radius (7 m with the tiller fully back, wider part way). Pull both back to stop the tank, and hold them there to keep it stopped. A Sherman can't turn on the spot, and neither can this: standing still, a tiller does nothing.
- **Right stick, flicked forwards or back while holding the tillers: a gear up or down.** It steps along the lever, R, N, 1, 2, 3, 4, 5, one notch per flick. Driving on the sticks instead, A changes up and B changes down (B still closes the menu while it is open). The lever can also be worked by hand.
- **Changing to Stick shift or Clutch** (or taking the driver's seat with one of them) puts the lever in neutral: the driver picks the gear.
- **Reverse** is the R notch. It goes in only with the tank stopped; with the accelerator down, the tank then backs at up to 4.5 km/h.
- **Stick shift** works the clutch for the driver: a flick takes the box out of gear for a third of a second and puts the new gear in. A change that would over-rev the engine (or reverse on the move) waits, out of gear, until the tank has slowed enough. At a crawl with the accelerator released, the clutch opens so the tank stops rather than creeps.
- **Clutch**: the left trigger is the clutch pedal. Squeezed fully it is free, let out it is engaged, and in between it slips, so letting it out slowly pulls away smoothly. A gear goes in a fifth of a second after the lever reaches it if the clutch is in and the gear suits the speed. Without the clutch, or into 1st or reverse on the move, or into a gear too low for the speed, the gears **grind**: the hand on the lever buzzes, a sign says what to do, and the box stays out of gear until the clutch goes in and the tank has slowed enough. Let the clutch out in too high a gear for the speed (5th from a standstill, or at a halt in gear) and the engine **bogs**: it labours at 450 rpm, barely pulls, and a sign says to put the clutch in or pick a lower gear. Held there it stalls (F1.17, [engine.md](engine.md)). In gear with the clutch out and the accelerator released, the engine idles and the tank creeps, as a real one does.
- On a PC page: W is the accelerator, S, A and D brake, E and Q change up and down, Shift is the clutch, and keys 0 to 5 and R move the lever to that gear.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Top speed per gear | 1st 3.4, 2nd 8.2, 3rd 14.4, 4th 23, 5th 35 km/h; reverse 4.5 km/h | The Sherman's ratios ([theshermantank.com](https://www.theshermantank.com/sherman/the-transmission-differential-and-final-drives-called-the-powertrain-and-it-was-great-on-the-sherman/)), 5th at the comfort cap's top speed |
| Pull | 1st and 2nd the full 1 m/s² comfort cap, 3rd 70%, 4th 50%, 5th 35%; at no throttle 35% of that, rising to all of it at full throttle | Softer than the ratios, so 5th still gets somewhere: 0 to 35 km/h in about 20 s through the gears |
| Revs | idle 800 rpm (1600 with the hand throttle), top 2600; out of gear they follow the demand over 0.6 s, in gear the tracks over 0.15 s | F1.4's engine |
| Automatic changes | up above 2250 rpm while the tillers ask for more speed, down below 1100 rpm; never below 2nd; 0.35 s out of gear | After a change up the revs land at 1300 to 1500 rpm, above the change-down point, so it doesn't hunt |
| Coasting | 0.3 m/s² out of gear; with a Sherman's controls the engine holds the tank back at 40% of the braking cap with the accelerator released; a tiller pulled back brakes up to the full cap | A heavy tank's tracks drag; braking stays within the comfort cap |
| Stick shift | 0.35 s out of gear per change; waits for a gear that would over-rev by more than 5% | |
| Clutch | engaged up to 20% of the trigger's travel, free from 80%, slipping between; a synchromesh gear (2nd to 5th) goes in 0.2 s after the lever reaches it; 1st only below 0.8 m/s, reverse only below 0.15 m/s | The Sherman's box has synchromesh on 2nd to 5th, not on 1st or reverse |
| Bogging | the clutch fully out with the tracks turning the engine below 500 rpm: it labours at 450 rpm and pulls 15% | |
| Steering by brakes | a tiller fully back turns the tank on a 7 m radius, capped at the comfort cap's 15°/s | |
| Gear lever | notches 8° apart from 24° back (reverse) to 24° forwards (5th), 2nd upright; in a gear within 3.5° of its notch; ±27° travel | F1.5's lever had notches at -24°, 0 and +24°; the handles stay in seated reach (tested) |
| Stick flick | past 70% of the stick's travel changes gear once; it re-arms within 30% | |

## Sharing

The host runs the tank (plan decision 1), and the gearbox is part of its drive.

- **Driver controls** (`PacketType.DriverControls` = 6), guest driver → host, now 14 bytes: F1.5's tillers, gear lever and hand throttle, plus the accelerator, the clutch and the driver's Gearbox setting. A page on the F1.5 build sends 11 bytes, which the host reads as the automatic box.
- **Tank state** (`PacketType.TankState` = 5), host → guest, now 58 bytes: gears 0 to 6 (6 is reverse), a bogging flag, and the driver's controls with the same three new bytes. The F1.5 (55-byte) and F1.4 (49-byte) forms still decode.
- The gear lever on the other page follows the driver's lever, or, with the automatic box, the gear the box has engaged. The signs (grinding, labouring) show only on the driver's page.

## The practice crewmate

It drives with the automatic box whatever its page's Gearbox setting says, so its scripted hands only work the tillers (they no longer move the gear lever). Its route now names a speed per leg: 11 km/h up the range road (low range's pace) and 30 km/h back.

## Tests

- `test/gearbox.test.ts`: the five gears' and reverse's speeds from the ratios; the lever's order; which gears fit which speeds; the clutch pedal's engagement; Stick shift changing gear with a coast and waiting with an over-revving change down, and not creeping at a standstill; Clutch grinding without the clutch, into 1st on the move and putting the gear in with it; a feathered pull-away against a dropped clutch in 4th that bogs; the engine revving freely with the clutch in.
- `test/tank-drive.test.ts`: the automatic box changing up through 2nd to 5th to 35 km/h within the acceleration cap, a part push holding 12 km/h in 3rd, the pull falling gear by gear, reversing at the reverse gear's speed, the revs dropping as each gear goes in; a Sherman's controls: the accelerator driving through the gear (the tillers' push doing nothing), a tiller pulled back turning on its radius but not standing still, both back stopping and holding it, reverse waiting for a stop, 5th barely pulling away; coasting through a change; the automatic box never grinding.
- `test/driver-station.test.ts`: every handle, including the gear lever at its new ends, in seated reach; the lever's seven notches in order and out of gear between them; shifting up through 1st to 4th by hand and dropping into the notch it is let go near.
- `test/tank-net.test.ts`: both packets round-trip the new bytes (reverse, bogging, accelerator, clutch, mode), and the F1.5 and F1.4 forms still decode.
- `test/crew-bot.test.ts`: the crewmate drives the route on the automatic box, fast on the way back.
- `npm run test:xr`, step 6d: the automatic box changes up as the sticks drive; on Clutch, A moves the lever into 1st and it grinds until the left trigger goes in, A changes up to 2nd, the right trigger pulls away as the clutch comes out, both sticks back brake it to a stop, and the menu's Driving line says 2nd gear. Changing to the Clutch starts the lever in neutral. Step 6e: on Clutch, the hand on the lever from 2nd to 3rd grinds, the clutch puts 3rd in, and let go near 1st it drops into the notch.

`window.__drive.set({ accel, clutch, mode, gear, ... })` drives as a test would; `window.__drive.state()` has `gear`, `toGear`, `grinding` and `bogging`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Game menu (Y) → **Practice → Drive the tank → Drive**. The sign says how to drive in Automatic.
2. **Automatic.** Grip both tillers and push them fully forwards. The tank pulls away in 2nd and changes up through 3rd, 4th and 5th by itself (watch the gear lever move and listen for each change), reaching about 35 km/h. Let go: it slows and stops. Pivot on the spot with one tiller forwards and one back. Pull both back to reverse.
3. Menu → Tank → **Gearbox: Stick shift**. The sign says the right trigger is the accelerator. Holding the tillers, flick the right stick forwards twice (N → 1 → 2) and squeeze the right trigger: the tank pulls away. Flick forwards for 3rd, 4th and 5th as the revs rise; each change coasts a moment. Release the trigger and pull one tiller back: the tank turns that way. Pull both back: it stops.
4. Flick the stick back to R (past N) while stopped and squeeze the right trigger: it backs slowly. Try R while rolling forwards: it waits until the tank stops.
5. Menu → **Gearbox: Clutch**. Flick into 1st without the left trigger: the gears grind and your hand buzzes. Squeeze the left trigger: 1st goes in. Flick to 2nd, then hold the right trigger half down and let the left trigger out slowly: the tank pulls away smoothly. Change up to 3rd with the clutch and without it.
6. Stop, put it in 4th and drop the clutch: the engine labours and a sign says so. Clutch in, back to 2nd.
7. Say whether flicking the stick with your hands on the tillers felt natural, whether the triggers worked as pedals, whether the brake steering felt right, and which setting you would play on.
