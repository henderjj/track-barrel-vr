# Track & Barrel VR: features roadmap

Every feature of the game, by phase, with where it stands. The approach behind each is in [plan.md](plan.md); the concept is in [concept.md](concept.md); what shipped and what headset checks found is in [progress.md](progress.md).

## How to update this

- Change a feature's **Status** in the same pull request that changes the feature, and put the pull request in **PR**.
- A feature is one pull request. If one grows too big, split its row (F1.4 → F1.4a, F1.4b) rather than renumbering.
- A feature that moves phase keeps its ID; its row moves to the new phase's table and its note says where it came from.
- New ideas go in **Ideas** at the bottom until they are given a phase.
- Keep the summary counts at the top in step with the tables.

| Status | Meaning |
| --- | --- |
| Planned | Not started |
| Design | Design note being written in `docs/` |
| Building | Pull request open |
| Headset check | Merged and deployed; waiting on the numbered headset check in its design note |
| Done | Headset check passed |
| Parked | Put off; the note says why |
| Cut | Dropped; the note says why |

## Summary

Features counts the rows not Cut.

| Phase | Goal | Features | Done |
| --- | --- | --- | --- |
| 0 Groundwork | Rename, plan, spikes | 6 | 6 |
| 1 Core controls prototype | Prove the tank's controls work in VR co-op | 20 | 15 |
| 2 Crew indicators and the first game mode | Indicators for the driver and gunner, and the biathlon to play the mechanics early | 6 | 0 |
| 3 Combat and damage | Enemies, ammunition types, damage and repairs | 8 | 0 |
| 4 Training and tutorials | Training stages and the callouts taught in them | 4 | 0 |
| 5 Content and replay | Tiers, scenarios, scoring, ghosts, replays, hatches | 10 | 0 |
| 6 Polish | Sound and graphics past the placeholders | 3 | 0 |

**Current focus:** finishing Phase 1 from John's play test (2026-11-07): the periscopes (F1.6, reworked for both crew in #62), the seated avatars (F1.1b), and trying the crewmate (F1.13) and the stats (F1.14). Then Phase 2 ([phase-2-plan.md](phase-2-plan.md)), where the biathlon (F5.3a, F5.3b) puts the controls to work in a game mode before any combat, built in six threads in two waves.

## Phase 0: Groundwork

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F0.1 | Concept, implementation plan and this roadmap in the repository | Done | | #1 | `docs/concept.md`, `docs/plan.md`, `docs/roadmap.md` |
| F0.2 | Rename the template to Track & Barrel VR | Done | | #2 | `package.json` name, page title, `coop-vr.` storage keys, README, lobby Worker name |
| F0.3 | Spike S1: magnified sight render on Quest 3 | Done | F0.2 | #3 | Second camera into a 512² texture shown at infinity through the lens, reticle with range marks; [spike note](spikes/s1-sight-render.md) with the headset check |
| F0.4 | Spike S2: riding the tank | Done | F0.2 | #7 | [spikes/s2-riding.md](spikes/s2-riding.md): Practice → Ride the tank as driver or gunner; world moves round the hull; gunner's space turns with the turret; open or closed cabin; vignette on or off. Play test passed (John, 2026-11-07) |
| F0.5 | Spike S3: lever feel | Done | F0.2 | #4 | Two test tillers and a lane board (Practice > Lever test); headset check in [spikes/s3-lever-feel.md](spikes/s3-lever-feel.md). Play test passed (John, 2026-11-07) |
| F0.6 | Spike S4: loading a shell | Done | F0.2 | #6 | Grab, swing, ram, close, seated; time and fumbles. [spikes/s4-loading.md](spikes/s4-loading.md); Practice → Sit at the breech. Play test passed (John, 2026-11-07) |

## Phase 1: Core controls prototype

Ends when a crew can drive the range, find and hit three static targets, and the concept's Phase 1 play-test questions have answers.

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F1.1 | Cabin and seats: hull and turret basket model, driver and gunner seats, seat-local avatars, remove the demo and deck walking | Done | F0.2 | #8 | [cabin.md](cabin.md): `src/sim/cabin.ts` replaces `play-area.ts`; the host decides seats; Practice → Sit in Driver/Gunner. Play test (John, 2026-11-07): done but for the seated avatars, split out as F1.1b |
| F1.1b | Seated avatars: the legs stay joined to the body and the torso keeps its proportions when seated | Headset check | F1.1 | | [seated-avatars.md](seated-avatars.md): the torso pivots at the hips and leans towards the head, a neck joins them, the coat is a waist-length jacket (`src/sim/seated-body.ts`); the practice crewmate turns its head on its neck and leans in to the gunsight while laying. Play test (John, 2026-11-07): seated avatars came apart at the legs and the torso looked very stretched. Making them look like WWII tank crew is F6.3 |
| F1.2 | Seat choice and calibration: pick a seat on the crew page, seated head height and reach, standing mode, head kept inside the seat box | Done | F1.1 | #10 | [seat-choice.md](seat-choice.md): seat on the start screen, swaps only when both agree, calibration as VR starts, eye height replaces character height, head stopped under the roof. Play test passed (John, 2026-11-07) |
| F1.3 | Mechanism kit: lever, wheel/crank, twist grip, yoke, button; limits, detents, haptics, grip locking | Done | F0.5, F1.1 | #12 | [mechanisms.md](mechanisms.md): `src/sim/mechanism.ts` and `MechanismSystem`; S3's tillers rebuilt on it; Practice → Mechanism kit bench. HoldKind 11 is `LocalControl` (12 since taken by F1.8's power grip). Play test passed (John, 2026-11-07) |
| F1.4 | Tank drive simulation and world movement: skid steer, RPM, gear ranges, ground following, obstacle bumps, host authority | Done | F0.4, F1.1 | #13 | [tank-drive.md](tank-drive.md): `src/sim/tank-drive.ts`, blockout ground and obstacles in `src/sim/terrain.ts`; tank-state (5) and driver-controls (6) packets; thumbstick tillers and a menu gear lever until F1.5; Practice → Drive the tank. Play test passed (John, 2026-11-07) |
| F1.5 | Driver station: tillers, gear lever with grinds, hand throttle, gauges, vision slit | Done | F1.3, F1.4 | #18 | [driver-station.md](driver-station.md): kit levers (HoldKind 2–5) read into the drive; sticks still drive while no tiller is held; five gauges; slit frame and brow pad; tank-state packet now 53 bytes (gauges and the host driver's controls). Play test passed (John, 2026-11-07) |
| F1.6 | Periscope: two-grip rotation, magnified view | Building | F1.5, F1.9 | #27, #62 | [periscope.md](periscope.md): `src/sim/periscope.ts`; left of the slit, a fixed eyepiece with a head on the roof turned by a kit yoke (HoldKind 8), 2× view through the gunsight's lens (now `scope-lens.ts`); the driver's page owns it, packet 9; Practice → Periscope. Play test (John, 2026-11-07): still being worked on; reworked as periscopes for both crew in #62 |
| F1.7 | Test range: ground, roads, obstacles, fog, static targets at 100, 250 and 500 m | Done | F1.4 | #16 | [range.md](range.md): `src/sim/range.ts` and `range.scene-asset.ts` built into the ground's model; two dirt roads, three targets, markers every 100 m, fog from 450 m, seen to about 700 m (menu setting; pushed out after the play test); Practice → Up the range. S1's hull-space boards gone. Play test passed (John, 2026-11-07) |
| F1.8 | Turret and gun laying: basket rotation, RPM-dependent power traverse, manual traverse and elevation wheels, gunner-side prediction | Done | F1.3, F1.4 | #17 | [turret.md](turret.md): `src/sim/turret.ts` and `TurretSystem`; the gunner's page owns the turret, turret packet (7); power grip, crank and elevation wheel (HoldKinds 6, 7 and 12); the gun elevates; the gunner turns with the basket; Practice → Lay the gun. Play test passed (John, 2026-11-07) |
| F1.9 | Gunsight: lean-in magnified view, reticle with range marks | Done | F0.3, F1.8 | #20 | [gunsight.md](gunsight.md): `src/sim/gunsight.ts`; an articulated sight: the eyepiece fixed in the turret, the objective and the sight camera on the gun; Practice → Lay on lays the gun on each target from wherever the tank stands (event `sight-lay`). Play test passed (John, 2026-11-07) |
| F1.10 | Loading and firing: ready rack, shells, breech, ram and close, fire trigger, casing ejection, ballistics, hits | Done | F0.6, F1.8 | #21 | [loading-firing.md](loading-firing.md): `src/sim/loading.ts`, `src/sim/ballistics.ts`, `LoadingSystem` and `FiringSystem`; S4's drill moved into the turret; the gunner's page owns the loading (packet 8, shell HoldKind 9); the power grip's trigger fires; `shot` and `shot-hit` events, the host decides hits; Practice → Load and fire. Play test passed (John, 2026-11-07) |
| F1.11 | Range run: run timer, three-target count, restart, Practice shortcuts (parked at a target, loaded and aimed) | Done | F1.7, F1.10 | #26 | [range-run.md](range-run.md): `src/sim/range-run.ts` and `RangeRunSystem`; the host keeps the run (`run`, `run-ask`, `range-ready` events); run clocks in both seats, a red flag by each target hit; Practice → Range run (Start, Stop) and Ready to fire (100, 250, 500 m). Play test passed (John, 2026-11-07) |
| F1.12 | Tank audio and intercom: engine by RPM, tracks, clunks and grinds, gun, breech, casings; voice ducking; plain intercom voice by default | Done | F1.5, F1.10 | #25 | [audio.md](audio.md): synthesised in `src/sim/tank-audio.ts`, played by `TankAudioSystem` from the tank as each page draws it (nothing new sent); voice ducks the tank 6 dB; plain voice by default; Settings → Tank sounds; Practice → Tank sounds → Play each. Play test (John, 2026-11-07): done for now, but the sounds are placeholders; the polish phase replaces them (F6.1) |
| F1.13 | Practice crewmate in both seats: drives a route or follows calls; aims at and fires on the nearest target | Headset check | F1.5, F1.10 | #23 | [crewmate.md](crewmate.md): its scripted hands work the tillers, gear lever, shells, breech, power grip and elevation wheel through the kit; drives the route or follows the menu's new Calls (`crew-call` event, shown on the other player's sign); loads, lays on the nearest target not yet hit and fires from a halt. Not yet tried in the play test (2026-11-07) |
| F1.14 | Comfort and play-test stats: motion vignette, reduced bumps, per-run CSV (time to three hits, grinds, fumbles per control, time per role) | Headset check | F1.11 | #33 | [comfort-stats.md](comfort-stats.md): Comfort and stats menu section: Vignette (Off/Light/Normal/Strong), Bumps (reduced if either player asks, `comfort` event), I feel queasy, Save CSV; `src/sim/play-stats.ts` and `PlayStatsSystem` write a row per range run with the crewmate's numbers (`run-stats` event); answers the concept's §14 questions. Play test (2026-11-07): comfort not an issue through the slit and sights; the stats not yet tried |
| F1.15 | Sherman interior: eyes and hands together at each station from the M4A4's layout, interior lighting (John's play-test note) | Done | F1.5, F1.6, F1.9 | #38, #39, #40, #48 | [interior.md](interior.md): glacis and hood bring the slit to 30 cm; instrument box on the left wall, periscope right; gunsight an 18 cm lean over raised wheels; final drive housing, co-driver seat, bow gun, extinguishers, sponson rounds, radio; hatch daylight and dome lamps in the cabin shader (`litInside`, `CabinLightSystem`); turret foot plate; menu options for open hatches, cabin light and dome lamps; whole-view fade at 9 cm from the walls, John's default look, gunner's dome lamp. Play test passed (John, 2026-11-07) |
| F1.16 | Gearbox: the Sherman's five speeds and reverse; Automatic, Stick shift or Clutch; a Sherman's controls (accelerator on the right trigger, tillers as brakes) in the last two (John's play-test notes) | Done | F1.5 | #43 | [gearbox.md](gearbox.md): `src/sim/gearbox.ts`; menu → Tank → Gearbox; revs follow the tracks; changes coast; right stick (or A/B) changes gear, left trigger is the clutch; grinds and bogging with the Clutch; lever notches R N 1–5; driver-controls packet 14 bytes, tank state 58. Takes in F4.3 and F5.2. After John's headset notes (2026-10-31): pedals only from a hand on a tiller, a gear indicator, Stick shift grinds on a change down at speed, the hand throttle sets cruising revs; after John's notes (2026-11-01): with Stick shift and Clutch the tillers rest against a forward stop and only brake (the kit's `Lever.forwardStop`). Play test passed (John, 2026-11-07) |
| F1.17 | Engine start-up and stalls in normal driving: starter button or the full procedure (battery, ignition, choke, warm-up), stalls and restarts, voltmeter, warning lamps, siren | Done | F1.16 | #44 | [engine.md](engine.md): `src/sim/engine.ts`; menu → Tank → Driving → Engine start (Running, Starter button default, Full procedure); the switch strip on the instrument box; cold running, choke, flooding, bog stalls; crank/catch/cough/stall/siren sounds; stalls in the stats; the crewmate starts it; driver-controls packet 16 bytes, tank state 64. Brought forward from F4.4. After John's headset notes (2026-10-31): toggle switches for battery and ignition, a big starter for the index finger (the kit's `Toggle`), and a choke pull knob with half choke (the kit's `PullKnob`); after John's notes (2026-11-01): the choke a T-handle on its own plate, worked by gripping, and buttons pressed where the drawn fingertip is. Play test passed (John, 2026-11-07) |
| F1.18 | Parking brake: a ratchet lever by the left tiller, its lamp, the tank rolling slowly downhill when nothing holds it | Done | F1.17 | #45 | [parking-brake.md](parking-brake.md): the kit's Lever gains a `ratchet` freed by the trigger; HoldKind 13; a switch bit in the driver's controls (no packet grows); stall cause 'brake'; the crewmate lets it off. Play test passed (John, 2026-11-07) |
| F1.19 | Periscopes for both crew: the driver's moved overhead, a gunner's added over the gunsight, each turned by a crank (John's note: no commander, so both crew look round) | Headset check | F1.6, F1.15 | | [periscope.md](periscope.md): `DRIVER_PERISCOPE` and `GUNNER_PERISCOPE` in `src/sim/periscope.ts`; eyepieces just above the slit and the sight, heads on the roofs; a kit crank, 90° a turn (HoldKinds 8 and 14); each seat's page owns its own, packets 9 and 10; Sights → Periscopes → Driver's, Gunner's |

## Phase 2: Crew indicators and the first game mode

The indicators the crew read most, and a game mode that needs no enemies, so the controls are played against the clock as early as possible. Reshaped after John's play test (2026-11-07): the hatches (F2.1) moved to Phase 5, the signal lamps (F2.2), push-to-talk and the signals comparison (F2.7) dropped, and the biathlon (F5.3) brought up from Phase 5 and split into its course (F5.3a) and race (F5.3b). The order, the threads and what keeps them from clashing are in [phase-2-plan.md](phase-2-plan.md).

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F2.2 | Driver signal lamps (stop, go, left, right) with gunner's buttons and a buzz on the driver's controller | Cut | F1.5 | | Dropped (John, 2026-11-07) |
| F2.3 | Turret position dial for the driver | Headset check | F1.8 | | [turret-dial.md](turret-dial.md): a 10 cm dial flat on the hood's face right of the slit, the hull from above nose up and a turret-and-gun pointer; reads the turret both pages already draw (no packet); Practice → Lay the gun → To 3 o'clock |
| F2.4 | Hull direction indicator in the gunner's sight | Planned | F1.9 | | In the gunsight and the gunner's periscope; starts after the periscope fix merges, as both edit `scope-lens.ts` |
| F2.5 | Firing lamp so the driver holds steady | Headset check | F1.10 | | [firing-lamp.md](firing-lamp.md): amber lamp on the slit frame's top bar, lit when loaded, closed and the gunner's hand is on a trigger control, three flashes at the shot; repeater right of the gunsight; no packet; the crewmate driver holds steady; Practice → Ready to fire → Driver's lamp |
| F2.6 | Callout vocabulary card | Headset check | F1.12 | #72 | [callout-card.md](callout-card.md): a card on the hull's left wall by the driver and on the turret's front wall left of the gunsight; You call, You hear (the Calls' words, plus Traverse left/right and "Target, tank, 2 o'clock" by voice) and a clock face, 12 at the hull's front; Sound and view → Callout card hides it. Push-to-talk dropped (John, 2026-11-07): open mic is the only mode |
| F2.7 | Signals on/off setting and comparison in the play-test stats | Cut | F2.2–F2.5, F1.14 | | Dropped (John, 2026-11-07), with the signal lamps |
| F2.8 | Head-out driving: the driver's seat raised to the convoy position | Headset check | F1.5, F1.6 | | [convoy-seat.md](convoy-seat.md): from John's play-test note (2026-11-08); a seat lever (or Practice → Drive the tank → Head out) raises the seat 30 cm through a fade, eyes 2 cm over the roof in the hatch; convoy grips on the tillers and gear lever where seated hands rest (a raised driver's hands can't reach the tillers from a chair); lid swung aside, periscope down; a turret stop over the driver's head built but off (John, 2026-11-08); `convoy` event, no packet or HoldKind. Takes the driver's head-out part of F2.1 |
| F5.3a | Biathlon course: a loop on the range, two firing lines with their own targets, a penalty loop, lap and gate tracking | Headset check | F1.11 | | [biathlon-course.md](biathlon-course.md): an 808 m loop east of the range's targets with 9 gates, two firing boxes on the home straight with three boards each (150 and 220 m) and a 153 m penalty loop; the host tracks laps, missed gates, penalty loops and halts (`course` event, no packet); the crewmate drives it on the Course call; Practice → Biathlon → Course, Line 1, Line 2. Split from F5.3 ([phase-2-plan.md](phase-2-plan.md), John, 2026-11-07). Concept §8 |
| F5.3b | Biathlon race: 3 laps, a firing line after laps 1 and 2 (3 targets, 3 rounds, firing at a halt), a penalty loop per target left standing, medal times | Headset check | F5.3a | | [biathlon-race.md](biathlon-race.md): the range run's biathlon mode (`run`/`run-ask` gain its fields; no packet); a round counts only from a halt in the lap's box, a hit board's disc covered white; a rack of three rounds a line (`spent` shells); a loop per standing board or +1:00 at the finish; gold 8:45, silver 10:00, bronze 11:30 from the crewmate's 9:03 clean race; the crewmate drives the race (waits at the line, takes its loops) and shoots only at the line; the CSV gains laps, misses, loops and medal; Practice → Biathlon race → Start, Stop, Ready line 1 and 2. Split from F5.3 ([phase-2-plan.md](phase-2-plan.md)) |
| F5.3c | Biathlon: harder shooting: only the black disc counts, longer ranges picked each race, gun scatter | In progress | F5.3b | | [biathlon-race.md](biathlon-race.md#harder-shooting): John's note (2026-11-13) that the shooting was easy. Boards down two flat firing lanes south of the boxes (6 o'clock), line 1 350–450 m and line 2 450–550 m, picked by the host each race and sent in `run`; the hit box is the 0.8 m disc; every shot scatters 0.3 mil; `boardranges=0` and `scatter=0` for the tests |

## Phase 3: Combat and damage

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F3.1 | Ammunition types: AP, HE and smoke with distinct effects and rack slots | Headset check | F1.10 | #91 | [ammunition.md](ammunition.md): `src/sim/ammo.ts`; mixed rack (AP, AP, HE, smoke), each round painted; AP 600 m/s direct hits, HE 450 m/s with a 5 m blast on soft targets, smoke lays a drifting opaque screen (`SmokeSystem`) and never counts; an HE scale on the sight; the loading packet gains each shell's round, `shot` its round, `shot-hit` the target counted; new Combat tab (Ammunition rack, Ready on the gun); Calls → Gunner, load AP/HE/Smoke for the crewmate |
| F3.2 | Enemy anti-tank guns that shoot back (static) | Headset check | F3.1 | #94 | [enemy-guns.md](enemy-guns.md): AI scope decided there (static, see within 600 m unless ground or smoke hides the tank, lay 6 s, fire every 8 s, correcting each shot, lead a moving tank); three guns left of the lane, each first seeing the tank partway up it; AP on the shield or HE within 5 m knocks one out; hits counted and called (damage is F3.4); `enemy`/`enemy-shot` events; Combat → Enemy guns (Start, Stop, Meet A/B/C); the crewmate engages a gun once it has fired |
| F3.3 | Enemy tanks on fixed routes | Headset check | F3.2 | #95 | [enemy-tanks.md](enemy-tanks.md): two tanks patrolling fixed routes there and back at 4 m/s, well off the lane; see within 400 m (never the start), halt, lay 5 s, fire every 7 s, drive on once they lose the tank; armoured (only AP knocks one out); the guns' battery and events carry them; Combat → Enemy tanks (Start, Stop, Meet A/B); the crewmate engages them with AP, leading them |
| F3.4 | Tank damage model: hit zones, armour, crew hits | Headset check | F3.2 | #96 | [damage.md](damage.md): `src/sim/damage.ts`; each enemy hit strikes a zone (hull or turret front, side, rear; running gear), meets an M4A4's armour (glacis 51 mm at 56°, sides 38 mm) against a 75 mm AP shell's penetration, and through it hits the engine (weaker and hotter, then stopped), a track or the transmission (immobile), the power traverse, or a crewman (red flash and dim view); three through knock the tank out; `damage`/`damage-ask` events; Combat → Damage (Repair, practice hits). Crew exposure in the hatch comes with the hatches (F2.1, now Phase 5) |
| F3.5 | Fires: fixed extinguisher handles and a handheld extinguisher | Planned | F3.4 | | |
| F3.6 | Electrical faults: fuse swaps at the radio and fuse panel | Planned | F3.4 | | |
| F3.7 | Overheating and engine management | Headset check | F1.5 | #92 | [overheating.md](overheating.md): labouring revved past 2,250 rpm in a low gear heats the coolant into the red; TEMP lamp at 100 °C, power fade from 108, knock from 112, stall after 8 s at 118, no restart above 110; Combat → Engine heat; crewmate halts to cool |
| F3.8 | Gun jams and misfires | Planned | F1.10 | | |
| F3.9 | Thrown track repaired outside the tank | Cut | F3.4, F2.1 | | Dropped (John, 2026-11-07); it needed leaving the seat |

## Phase 4: Training and tutorials

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F4.1 | Turret travel lock | Parked | F1.8 | | Deprioritised (John, 2026-11-07): the game may not need this much assist. Build it if the training stages or play tests ask for it |
| F4.2 | Autoloader option | Parked | F1.10 | | Deprioritised (John, 2026-11-07), as F4.1 |
| F4.3 | Gear options: high range only, semi-automatic | Cut | F1.5 | | Taken into F1.16's Gearbox setting (Automatic, Stick shift, Clutch) |
| F4.4 | Engine startup: pre-started, one button, short checklist, full procedure that can flood | Cut | F1.5 | | Brought forward as F1.17 (John: the start-up belongs in normal driving); training stages pick its setting |
| F4.5 | Training stages 1–5 (driving course to full crew drill) | Planned | F1.16, F1.17 | | Concept §7.1. Uses the travel lock and autoloader only if they are built (F4.1, F4.2 parked) |
| F4.6 | AI commander callouts for targets and directions | Cut | F1.12 | | Dropped (John, 2026-11-07) |
| F4.7 | Callout vocabulary taught in training | Planned | F4.5, F2.6 | | |

## Phase 5: Content and replay

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F2.1 | Hatches: driver's and commander's, stand up 25 cm above seated head height to be out | Planned | F1.2 | | Moved from Phase 2 (John, 2026-11-07). Brings crew exposure in the hatch to F3.4's damage model once that exists. If the driver can drive head out, revisit comfort (F1.14's vignette and reduced bumps): play tests found comfort a non-issue only because the slit and sights show a small field of view |
| F5.1 | Realism tiers: Recruit, Veteran, Ace | Planned | F1.16, F1.17, F3.7, F3.8 | | Concept §7.2; pick the first-session default from play tests. With F4.6 cut there are no AI callouts, and the autoloader (F4.2) is parked, so Recruit differs by the gearbox, start-up and range hints |
| F5.2 | Expert option: tillers as brakes, hand throttle for speed | Cut | F1.5 | | Taken into F1.16: Stick shift and Clutch drive by the accelerator (right trigger) with the tillers as brakes |
| F5.4 | Per-role stats and crew ranks for a regular pair | Planned | F1.14 | | |
| F5.5 | Ghost replay of the crew's best run | Planned | F5.3b | | |
| F5.6 | After-action replay with both views side by side | Planned | F5.5 | | |
| F5.7 | Randomised targets, routes and weather | Planned | F1.7 | | Each random part gets a URL switch to turn it off in tests |
| F5.8 | Scenario: escort a convoy | Planned | F3.3 | | |
| F5.9 | Scenario: hold a hill hull-down | Planned | F3.3 | | |
| F5.10 | Scenarios: recon unseen, ambush a column | Planned | F3.3 | | |
| F5.11 | Night and fog conditions | Planned | F5.7 | | Retint lights, fog and sky; no new lights |

## Phase 6: Polish

Sound and graphics past Phase 1's placeholders (John, 2026-11-07). Nothing depends on these, so each can be done whenever it is wanted.

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F6.1 | Sound pass: the engine, tracks, gun, breech, casings and the controls' clunks beyond F1.12's synthesised placeholders | Headset check | F1.12 | #88, #99, #100 | [audio.md](audio.md): every sound rebuilt on the real tank, modelled not recorded (John's choice, 2026-11-09). The engine is the A57 multibank's burble (five petrol sixes, 40 to 130 Hz a bank) following the revs and the throttle through filters that stay put; gear whine; each track's rumble, clatter and squeal on its own side; the traverse's motor and gears; the handwheels' ticks; short sounds as blows on ringing steel and brass; a steel-cabin echo; sounds placed round the player's head; the gun's blast dips everything else. `src/sim/sound-render.ts`, `src/systems/tank-sound-graph.ts`; Practice → Tank sounds → Run through; `scripts/render-sound-preview.mjs` renders clips to listen to without a headset. Tuned against John's recording of a real Sherman (2026-11-12): the engine a dense drone at speed and not a note, the roar fluttering with the cylinders, the tracks a clatter and not clicks, placed sounds no longer hollow. Each track sounds of what it is on (John's ask, 2026-11-12): grass, the dirt roads or the course's gravel, judged along the track's length, with a new surface one row in `src/sim/ground-surface.ts` |
| F6.2 | Graphics pass: the tank's exterior, the ground and range, the cabin's materials, and effects (dust, muzzle smoke, hits) | In progress | F1.15 | #93 | Within the frame budget (72–90 fps on Quest 3). The exterior first, needing a headset check (John, 2026-11-11, once the driver could drive head out): [exterior.md](exterior.md), an M4A4's sponsons, long glacis, VVSS bogies and tracks, a cast turret, round hatches (`src/sim/exterior.ts`) |
| F6.3 | WWII tank crew avatars: uniforms, tanker helmets and headsets | Planned | F1.1b | | Low priority (John, 2026-11-07) |
| F6.4 | Gauge colour bands: coloured markers on the driver's gauges for a cold engine, overheating, the rev limit, low oil, low fuel and charging | Headset check | F1.17 | #89 | [gauge-zones.md](gauge-zones.md): John's note (2026-11-10). Bands painted into the dials' faces, their edges the engine model's numbers (`Dial.zones`, `zoneOf` in `src/sim/driver-station.ts`); nothing new drawn per frame or sent |

## Ideas (no phase yet)

- Game modes that grow with the combat features (John asked which fit; each uses what has just landed, so the mechanics are played as soon as they exist):
  - **Gunnery table** (no combat needed; could join Phase 2): a scored qualification course of timed engagements, the tank halted or moving, on static, pop-up and moving targets (targets on sleds along a track), with a pass, a good and an expert score.
  - **Right round** (after F3.1): soft targets (trucks, gun crews, bunkers) that need HE and hard ones that need AP, scored on the round chosen; smoke to cross open ground.
  - **Run the gauntlet** (after F3.2): drive a road past hidden anti-tank guns, spotting them through the periscopes and killing them before they get the tank; scored by time and hits taken.
  - **Duel** (after F3.3): one enemy tank somewhere in the fog, first hit wins; later two or three on their routes. A short warm-up for the scenarios (F5.8–F5.10).
  - **Bad day** (after F3.4–F3.8): a long engagement where fires, faults, jams and overheating pile up, so the crew shares the jobs; scored by how long the tank fights on.
- A gun elevation scale on the gun mount (a pointer against a scale in mils, like the gunner's quadrant WWII tanks carried). For direct fire the reticle already shows where the barrel points, so it only matters for indirect fire or ranging by elevation. Related: F2.3 (turret position dial) and F2.4 (hull direction in the sight) are the indicators real crews used most.
- A German-style range drum as a realism option: the gunner sets the range on a knob and aims with the chevron itself, instead of the fixed range marks (the British and American style the sight has now).
- An optional third player (concept open question). Not planned: the lobby and presence code assume two.

## Out of scope (from the concept)

- A second vehicle, training or otherwise.
- Foot pedals or extra tracking hardware.
- Shoulder-tap signalling.
