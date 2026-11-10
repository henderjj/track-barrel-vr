# Gauge colour bands

John's note (10 November 2026): put coloured markers on the driver's gauges for things like a cold engine, overheating and the rev limit, so the gauges mean something rather than only giving a number.

## What the driver sees

Each dial in the instrument box between the tillers ([driver-station.md](driver-station.md)), and the voltmeter on the switch strip ([engine.md](engine.md)), has coloured bands painted just inside its rim, under the marks. A glance tells the driver whether the needle is where it should be. Every band's edges are the engine model's own numbers, so a needle crossing into a band means the simulation has crossed that line too.

| Dial | Band | Colour | From the engine's numbers | Meaning |
| --- | --- | --- | --- | --- |
| RPM | 1100–2250 | green | `DOWN_RPM` to `UP_RPM` (src/sim/gearbox.ts) | The driving band: where the automatic box keeps the engine. Idle (800) sits just below it |
| RPM | 2250–2600 | amber | `UP_RPM` to `MAX_RPM` | Change up: the automatic box would |
| RPM | 2600–3000 | red | `MAX_RPM` to the dial's end | The governed top: the needle stops on the red line |
| Water °C | 0–40 | blue | to `CHOKE_COOLANT` (src/sim/engine.ts) | Cold: starting needs the choke |
| Water °C | 40–71 | amber | `CHOKE_COOLANT` to `WARM_COOLANT` | Warming: push the choke in; in the Full procedure a cold engine coughs and stalls at an 800 rpm idle, so keep the hand throttle at a third |
| Water °C | 71–92 | green | `WARM_COOLANT` to `COOLANT_FULL` (src/sim/tank-drive.ts) | Warm: from the manual's 160 °F to the hottest it runs flat out |
| Water °C | 100–120 | red | `OVERHEAT_COOLANT` (src/sim/driver-station.ts) | Boiling. Nothing fails in Phase 1 (plan decision 7), so the engine tops out at 92 °C and never reaches it |
| Oil bar | 0–0.6 | red | `LOW_OIL` | Too low for a running engine: only a stopping or stopped engine reads here |
| Oil bar | 1–5.2 | green | `OIL_NORMAL` | Every running engine, from a hot idle (1.1) to a cold one flat out (5.0) |
| Fuel | E–⅕ | red | `LOW_FUEL` | Low: about 24 minutes left flat out. The Phase 1 tank never burns below its reserve (`FUEL_RESERVE`, a tenth), which sits in the red |
| Volts | 22–26 | amber | round `BATTERY_VOLTS` (24) | The battery alone: the engine is not charging it. Cranking dips the needle under the band (20 V) |
| Volts | 26–30 | green | round `RUNNING_VOLTS` (28) | The generator charging: the engine is running |

The speedometer has no bands: no speed is wrong in itself.

Colours: blue `#2f6fd0`, amber `#e0a020`, green `#2f9a3c` and red `#d02a22` on the cream faces, a band an eighth of the dial's radius wide. They are game aids in the spirit of a period gauge's painted arcs; a Sherman's own gauges had numbers only.

## How it works

- `Dial.zones` in `src/sim/driver-station.ts` lists each dial's bands, lowest first; `zoneOf(dial, value)` says which band a reading falls in (null between bands). The voltmeter's are on `VOLT_DIAL`.
- `DriverStationSystem` paints the bands into the dials' canvas faces once, under the marks (`zoneBands`). Nothing new is drawn per frame: no extra meshes, draw calls or per-frame work, and nothing to z-fight, since the bands are part of the face's texture.
- Both players see the same bands, since the needles already follow the host's tank state. Nothing new is sent.
- `window.__driverStation.zones()` gives the band each gauge's reading is in (`at`) and each dial's bands (`bands`).

## Tests

- `test/driver-station.test.ts`: every band inside its dial, lowest first and apart; the revs' bands at the gearbox's change points and the governed top; the coolant's at the engine's choke and warm temperatures, a cold engine warmed at a fast idle passing blue, amber, green in that order and never reaching red flat out for four hours; every running engine's oil pressure in the green and a stopped one's in the red; the fuel reserve in the red; the voltmeter amber on the battery, under the band while cranking and green running.
- `npm run test:xr`, step 6d' (starting the engine): stopped, the oil gauge is in the red and the voltmeter in the amber; running, both are green.

## Headset check

1. Enter VR alone. Game menu (Y) → **Tank → Driving → Engine start: Full procedure**, then **Practice → Drive the tank → Back to start**. Look down at the instrument box: every dial but the speedometer has coloured bands round its rim, and they read clearly in the dim hull without hiding the marks or numbers. Nothing flickers.
2. With the engine stopped and the battery on: the oil needle sits in the red, the voltmeter in the amber, the water needle in the blue.
3. Start the engine (choke out, starter): the voltmeter swings into the green, the oil needle into the green.
4. Open the hand throttle to a third and wait: the water needle climbs through the amber into the green in about a minute. With the hand throttle full open in neutral, the RPM needle stops on the red line.
5. Drive off with the automatic box: the RPM needle stays mostly in the green, touching the amber before each change up.

Report: whether the bands are easy to read at a glance from the seat, whether any colour is hard to tell apart in the hull's light, and whether a band's place feels wrong for what the tank does.
