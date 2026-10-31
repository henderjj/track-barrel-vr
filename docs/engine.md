# Engine start-up and stalls (F1.17)

The tank is now found with its engine stopped and cold, and the driver starts it from a switch strip on the instrument box. The engine can stall: dropping the clutch in too high a gear, idling a cold engine too slowly, or getting the choke wrong, and the driver restarts it on the starter, as a Sherman's driver would. A menu setting picks how much of the real start-up routine the player works.

It answers John's notes (30 October 2026): the start-up routine was planned as a training stage (F4.4), but he wanted the mechanic in normal driving. F4.4 is cut and its content lives here; the training stages (F4.5) will pick this setting. The research is in the proposal doc *Driver's controls, second pass*. The gearbox (F1.16, [gearbox.md](gearbox.md)) came first and the parking brake (F1.18, [parking-brake.md](parking-brake.md)) came after.

The numbers are in [`src/sim/engine.ts`](../src/sim/engine.ts), stepped by the drive in [`src/sim/tank-drive.ts`](../src/sim/tank-drive.ts) ([tank-drive.md](tank-drive.md)). The switch strip is the driver's station's ([driver-station.md](driver-station.md)).

## What players experience

- **Menu → Tank → Driving → Engine start**: Running, Starter button (the default) or Full procedure. It changes at once, is kept in this browser like the other settings, and the driver's choice is the one the tank runs on (it goes to the host with the driver's controls). `?engine=running|starter|full` in the address sets it too.
- **The switch strip** runs along the bottom of the instrument box on the left wall, under the dials: a voltmeter, three warning lamps (oil pressure, generator and, from F1.18, the parking brake), then three toggle switches, **Battery** (blue knob), **Ignition** (yellow) and **Choke** (cream), and two push buttons, a big green **Starter** and the red **Siren**. Flick a toggle up with a fingertip to switch it on (its knob lights; ON and OFF are painted over and under it), down to switch it off, or squeeze a fist on it to flip it. The starter and the siren work only while held in, by a fingertip or a fist squeezed round them, which leaves the other hand on a tiller. Pointing at a control and squeezing takes the one the fingertip is on.
- **Why toggles and a big starter** (John's headset check, 31 October 2026: the buttons were hard to press, the starter should be bigger and work with the index finger, and should there be a mix of buttons and toggle switches?). A WWII tank's panels had both: the master (battery) and ignition were toggle switches, and the starter and the siren were push buttons, the starter a large one. So the switches that stay set are toggles now, and the starter's cap is 36 mm across (it was 24) with a 10 mm allowance round every cap and bat for a drawn fingertip.
- **Starting it.** Out of gear (or with the clutch held in, on the Clutch), hold the starter. The engine cranks over with a slow, beating whirr, the voltmeter dips from 24 V to 20, and after a moment it catches with a cough and settles at idle; the lamps go out and the voltmeter climbs to 28 V as the generator charges. Let go too soon and the next press starts over. With the Clutch in gear without the clutch held, nothing turns and a sign says to take it out of gear; the automatic box and Stick shift work their own clutch, so they start in gear (the automatic box's lever can't be moved to neutral by hand, so after its engine was switched off in gear it couldn't be started again).
- **Running** is F1.16's tank: the engine starts by itself, and the starter only matters after a stall.
- **Starter button**: the battery and ignition count as on, and one held press starts the engine in 1.5 s.
- **Full procedure**: a Sherman driver's routine. Battery on (the lamps and the voltmeter come alive), ignition on, choke out if the engine is cold, the hand throttle a little open, then hold the starter. With all of that it catches in about a second. Without the choke, or with the hand throttle shut or wide open, it takes up to 3 s. Without the ignition it cranks and never fires. Without the battery nothing turns. Hold the starter for 30 s and it overheats and won't turn until it has rested for 15 s.
- **A cold engine** (Full procedure only) needs looking after: push the choke in too soon after it catches (within 2.5 s) and it dies; leave the choke out for more than 4 s and it starts running rough, and after 12 s it floods and stalls. At the 800 rpm idle it coughs and dies within 10 s; with the hand throttle at a third (1400 rpm; two thirds until the hand throttle reached full revs) it runs and warms up in about a minute. Cold, it pulls at 70%. The coolant gauge rises from the air's 15 °C to 71 °C and over as it warms, and cools again when it is stopped. In the other two settings the engine is never fussy when cold.
- **Stalling.** On the Clutch, let the clutch out in too high a gear (or at a halt in gear) and the engine bogs, as in F1.16; held there for a second (longer with the accelerator down, up to 3 s floored) it stalls. The rev counter and the oil pressure drop, the diesel's note runs down, the tank coasts on, and a sign says "Engine stalled" and what to do. Put the clutch in or go to neutral and hold the starter to restart, even on the move.
- **The parking brake** (F1.18, [parking-brake.md](parking-brake.md)): on the Clutch, letting the clutch out in gear against it stalls the engine, the sign saying the parking brake is on.
- **Switching off**: on the Full procedure, switching the ignition (or the battery) off stops the engine without counting a stall.
- **The siren** (held) sounds the tank's warning siren on both players' pages, with the engine running or not.
- **Without the engine** the tank doesn't move, and the turret's power traverse doesn't work: twisting the power grip with the engine stopped says "No power traverse". The manual traverse crank still works.
- **Signs**: with the engine stopped, the driver's sign says "Start the engine" and how, in place of how to drive. The starter held without turning says why ("Nothing turns", "Starter too hot", "In gear"); cranking for more than 4 s without catching says "It won't fire" and what to check.
- **Back to start** and the Practice shortcuts reset the tank with its engine stopped and cold (Running starts it again). A range run keeps the engine as it was. Ready to fire (and taking the gunner's seat for a Practice shortcut) starts it warm, so the power traverse works.
- **The stats**: each run's CSV row and the run's closing line count the driver's stalls.
- On a PC page: B toggles the battery, I the ignition and C the choke; hold Space for the starter and N for the siren.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Cranking | 160 rpm, reached over 0.6 s | A starter turns a diesel at 100 to 200 rpm |
| Catching | 1.5 s on the Starter button; on the Full procedure 1 s, plus 1.2 s cold without the choke, plus 0.8 s with the hand throttle below 5% or above 70% | Quick enough not to be a chore |
| Starter | overheats after 30 s cranking; rests 15 s | A real starter needs a rest after about 30 s |
| Choke | in before 2.5 s after catching: dies; out more than 4 s: rough; 12 s: floods; only matters below 40 °C | |
| Cold | below 71 °C; at idle below 1250 rpm for 10 s it stalls, coughing every 0.9 s (each a 12% dip in the revs); pulls at 70% | The hand throttle's third is 1400 rpm |
| Warming | about 60 s to warm from cold running; about 15 minutes to cool stopped | A game's minute, not a real half hour |
| Bogging to a stall | 1 s at no accelerator, plus 2 s × the accelerator | Feeding it fuel holds it a little longer |
| Voltmeter | 24 V on the battery, 20 V cranking, 28 V running and charging; 0 to 32 V scale | A Sherman's 24 V system |
| Lamps | oil pressure and generator lit with the power on and the engine stopped | |

## Sharing

The host runs the tank (plan decision 1), and the engine is part of its drive.

- **Driver controls** (`PacketType.DriverControls` = 6), guest driver → host, now 16 bytes: F1.16's, plus a byte of switch bits (battery, ignition, starter, choke, siren) and the driver's Engine start setting. A page on the F1.16 build sends 14 bytes, which the host reads as Running with nothing pressed.
- **Tank state** (`PacketType.TankState` = 5), host → guest, now 64 bytes: F1.16's 58, plus the engine's flags (running, cranking, power, rough, starter hot), the stall and cough counts and the last stall's cause. Older forms still decode, with the engine running.
- The switch caps on the other page follow the driver's switches, and its voltmeter and lamps the host's engine. The signs show only on the driver's page; the siren sounds on both.
- A guest driver's starter is a held control like the tillers: if its packets stop for half a second the host lets go of it.

## The practice crewmate

Driving, it starts a stopped engine before it does anything else, with its left hand on the switch strip and its right on a tiller: on the Full procedure it presses battery, ignition and (if cold) the choke, sets the hand throttle, holds the starter until the engine catches, pushes the choke in 5.5 s later and keeps the hand throttle at a third until the engine is warm. Its status says what it is doing ("starting the engine").

## Tests

- `test/engine.test.ts`: the setting; the Starter button cranking and catching, starting over when let go; turning over only out of gear or with the clutch in; the Full procedure's battery and ignition, the starter overheating and resting; catching quickest with the choke and a little hand throttle; the choke's early-in, flooding and eased-in cases; a cold engine stalling at idle but warming at a third, and pulling less; switching off without a stall; stalling on a dropped clutch, the needles dropping and the tank coasting; restarting on the move; Running starting by itself; the voltmeter's readings.
- `test/tank-net.test.ts`: both packets round-trip the new bytes; the older forms decode as Running.
- `test/driver-station.test.ts`: the coolant gauge warming and cooling.
- `test/turret.test.ts`: no power traverse with the engine stopped or cranking.
- `test/tank-audio.test.ts`: the crank loop, the catch, cough and stall cues, a stopped engine's note fading.
- `test/play-stats.test.ts`: the stalls column and the closing line.
- `test/crew-bot.test.ts`: the crewmate's start-up order, in the simulation, on each setting, and holding the warm-up throttle.
- `test/z-fighting.test.ts`: the voltmeter's needle, the lamps, the buttons' caps at every depth and the toggles' nuts and bats both ways.
- `test/mechanism.test.ts`: the toggle flicked up and down by a fingertip once a flick, not by a fingertip off to the side, behind the face or pushing the way it already is, and flipped once by a squeeze; a fingertip on a toggle or a cap picking it for a squeeze.
- `npm run test:xr`, step 6e' (John's notes, 31 October 2026): the starter pressed in by the right index fingertip alone cranks the engine and it catches; on the Full procedure the battery toggle flicked up by a fingertip goes on and the lamps light, flicked down goes off.
- `npm run test:xr`: taking the driver's seat, the sign says to start the engine, the lamps are lit at 24 V; a right fist on the starter cranks it (the voltmeter dips) and it catches (the lamps go out, over 27 V). On the Clutch, the dropped clutch in 4th stalls it with a sign, and the left trigger and the starter restart it. Back to start stops it cold. The sounds include the catch and the stall.
- `npm run test:net`: a guest driver's starter starts the host's engine and both see it run; the practice crewmate starts a stopped engine on the Full procedure (its battery, ignition and starter presses) before it drives on "Driver, advance".

`window.__drive.set({ battery, ignition, choke, starter, siren, start, ... })` drives as a test would; `window.__drive.state()` has `running`, `cranking`, `stalls` and `stallCause`; `window.__drive.engine('start' | 'stop')` starts it warm or stops it cold; `window.__driverStation.engine()` reads the strip's caps and lamps.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Game menu (Y) → **Practice → Drive the tank → Drive**. The sign says "Start the engine". Look down to the instrument box on your left: the two lamps are lit and the voltmeter reads 24.
2. **Starter button** (the default). Press and hold the big green starter with your index fingertip (or squeeze your left fist round it). The engine whirrs, the voltmeter dips, and it catches; the lamps go out. Let go too soon once and check it starts over.
3. Menu → Tank → Driving → **Engine start: Full procedure**, then Menu → Practice → Drive the tank → **Back to start**: the engine stops. Flick the Battery toggle up (the lamps light), then Ignition and Choke, set the hand throttle a little open, and hold the starter: it catches in about a second. A few seconds later flick the choke back down, and open the hand throttle to a third while it warms (watch the coolant gauge rise).
4. Try it wrong: Back to start, and start it without the choke and the throttle shut. It takes longer, then coughs at idle and stalls with a sign. Leave the choke out after it starts: it runs rough and floods.
5. **Gearbox: Clutch.** Put it in 4th from a standstill and let the clutch out: it labours and stalls, and the tank sign says so. Clutch in, hold the starter: it restarts.
6. Hold the red siren button: both players hear it.
7. Say whether reaching for the instrument box felt natural with a hand on a tiller, whether the toggles and the starter were easy to work with a fingertip, which Engine start setting you would play on, and whether stalling was fair.
