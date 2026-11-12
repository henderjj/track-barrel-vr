# Overheating and engine management (F3.7)

Phase 1's engine never failed (plan decision 7): flat out it ran at 92 °C forever. Now it can overheat. Revved hard in a low gear it labours, its coolant climbs into the gauge's red, it loses power, knocks and in the end stalls, and it won't start again until it has cooled. Managing it is the driver's job: change up, ease off, or stop and let it idle. The numbers live in [`src/sim/engine.ts`](../src/sim/engine.ts) (what heat does to the engine) and [`src/sim/tank-drive.ts`](../src/sim/tank-drive.ts) (what heats it).

## What players experience

- **What heats it**: the revs past the change-up point (2,250 rpm, where the RPM dial turns amber) in a low gear. The lower the gear, the faster it heats: 1st most, then reverse, 2nd, 3rd and a little in 4th. In neutral or top gear, or anywhere in the RPM dial's green, it runs as before (72 °C at idle, 92 °C flat out). So with the automatic box, which changes up at 2,250 rpm, it hardly ever overheats; with the Stick shift or the Clutch, a driver who holds a low gear at full revs will cook it.
- **How fast**: from warm, flat out in 1st, the TEMP lamp lights after about a minute, it knocks after about two, and it stalls after about four. Flat out in 2nd it reaches the lamp in about 80 s and knocks in about three and a half minutes but never stalls; in 3rd it lights the lamp after two and a half minutes and goes no further.
- **What the driver sees and hears**, in order as it heats:

| Coolant | What happens |
| --- | --- |
| 100 °C | The needle enters the water gauge's red, and a new amber **TEMP** lamp lights at the top of the lamp column (OIL, GEN and BRAKE move down to make room). The driver's sign: "Engine hot. Change up or ease off the revs". |
| 108 °C | It starts losing pull: half of it by 118 °C, so the tank accelerates and climbs slower. |
| 112 °C | It runs rough, knocking: the same coughs as a cold engine, which the driver hears and feels in the revs. The sign: "Engine overheating. Stop and let it idle, or it will stall". The oil pressure falls with the heat; at a hot idle it drops below the oil gauge's green. |
| 118 °C for 8 s | It stalls. The sign: "Engine stalled. Overheated: let it cool below 110 °C, then start". |
| Over 110 °C, stopped | The starter turns it but it won't fire ("It won't fire. Too hot: let it cool below 110 °C"). Standing, it cools from 118 to 110 °C in about a minute and a quarter. |

- **Cooling it**: change up, ease off the accelerator, or stop and let it idle. Idling, it falls from 114 to under 100 °C in about a minute; driving gently in 4th, about as fast.
- **Combat → Engine heat**: **Hot** starts the engine if it isn't running and puts the coolant at 114 °C, knocking (a solo player goes to the driver's seat to watch the gauges); **Normal** puts it back to a warm idle's 72 °C. A line under them says the coolant and what it means.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| TEMP lamp, gauge red | 100 °C | Boiling under the radiator cap's pressure, the gauge's existing red (F6.4) |
| Labour | revs past 2,250 rpm, up to 35 °C more than flat out's 92 °C, by gear: 1st 1, 2nd 0.7, 3rd 0.4, 4th 0.15, 5th 0, reverse 0.6 | The A57's cooling was marginal at low speed and high revs: the fans turn with the engine but little air moves through a slow tank's grilles. The shares make 1st the one gear that can stall it, and 2nd sit just under the stall point |
| Heating past 92 °C | over 120 s (time constant) | Slow enough that a few seconds of full revs to climb a bank do nothing; a minute of it shows on the gauge |
| Power fade | from 108 °C, half of it by 118 °C | A hot petrol engine pre-ignites and loses power before it fails |
| Knocking | from 112 °C | Pinking: heard and felt as coughs, a warning before the stall |
| Heat stall | 8 s at 118 °C or more | Time to back off once it starts to die |
| Restart | at or under 110 °C | Vapour lock and pre-ignition stop a hot petrol engine firing |
| Cooling | 150 s running (time constant), 900 s stopped | As before (F1.5): an idling engine with its fans turning cools faster than a stopped one |

## Sharing

Nothing new is sent. The host runs the engine, and the tank state packet (PacketType 5) already carries the coolant, the rough flag and the stall's cause; `heat` is added at the end of `STALL_CAUSES`, so a page on the build before this reads a heat stall as no cause (`'none'`). Both pages light the TEMP lamp from the coolant. **Engine heat** from a guest asks the host with the reliable event `engine-heat` (`heat`: `hot` or `normal`).

## The practice crewmate

As driver it drives with the automatic box, which seldom overheats. When the coolant reaches 100 °C (from Engine heat → Hot, or a long reverse) it halts and lets the engine idle until it falls under 96 °C, then carries on with whatever it was doing ("halted to let the engine cool"). If the engine stalls hot it keeps its hands on the tillers and waits until it is cool enough to start, rather than wearing out the starter. As gunner it has nothing new to do.

## Departures from the building skill

- No new model beyond one more lamp lens, in the z-fighting test with the other lamps. The lamp column now holds four at 16 mm spacing (was three at 21 mm).
- No new sound: the knock reuses the cough sound. A boiling hiss could come with the Phase 6 sound pass.
- No setting to turn it off: F5.1's realism tiers can decide whether Recruit gets it.

## Tests

- `test/overheating.test.ts`: labouring only past the change-up point and most in the low gears; the power fade's shape; flat out in 1st going hot, knocking and stalling from the heat; pulling away slower hot; cooling when changed up or idled; refusing to fire until cooled to the restart point; never overheating flat out in 2nd, 3rd, top or neutral; the oil pressure falling hot but staying above the red; the TEMP lamp where the gauge turns red, in a column of four that don't touch; a heat stall in the tank packet; the crewmate halting to cool and waiting to restart.
- `test/driver-station.test.ts`: the coolant bands still pass blue, amber, green and never red flat out in neutral.
- `npm run test:xr` (step 6t, part 1): Combat → Engine heat → Hot lights the TEMP lamp, puts the gauge in the red, makes the engine rough, seats a solo player as driver and shows the sign and menu line; held at 125 °C flat out in 1st it stalls from the heat with the right sign; Engine heat → Normal starts it again with the lamp out.

`window.__drive.coolant(degrees)` sets the coolant on the host; `window.__driverStation.engine().lamps.temp` says whether the TEMP lamp is lit.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Combat → Engine heat → Hot**. You are in the driver's seat with the engine running. Look at the instrument box: the water needle in the red, and the amber TEMP lamp lit at the top of the lamp column. Say whether the TEMP lamp is easy to see and to tell from the red ones, and whether the four labels are readable.
2. Listen and watch the RPM needle: it knocks (coughs) every second or so. A sign says "Engine overheating".
3. Leave it idling in neutral and watch the needle fall: the knocking stops after a few seconds, and the TEMP lamp goes out within about a minute.
4. Set **Tank → Gearbox → Stick shift**, 1st gear, and hold the accelerator down while driving slowly. Within a minute or two the TEMP lamp lights and the sign says "Engine hot". Change up through the gears and see it cool.
5. **Engine heat → Hot** again, then 1st gear flat out until it stalls (a minute or so more). Press the starter: it turns but won't fire, and the sign says to let it cool. Wait for the needle to fall below 110 °C and start it.
6. With the crewmate as driver (`?bot=1`), from the gunner's seat call **Calls → Advance**, then **Combat → Engine heat → Hot**: it halts, idles until the needle falls, then drives on.
7. Say whether the times feel right: too quick to overheat in normal driving, or too slow to matter.
