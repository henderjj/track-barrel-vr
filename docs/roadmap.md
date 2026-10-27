# Track & Barrel VR: features roadmap

Every feature of the game, by phase, with where it stands. The approach behind each is in [plan.md](plan.md); the concept is in [concept.md](concept.md); what shipped and what headset checks found is in [progress.md](progress.md).

## How to update this

- Change a feature's **Status** in the same pull request that changes the feature, and put the pull request in **PR**.
- A feature is one pull request. If one grows too big, split its row (F1.4 → F1.4a, F1.4b) rather than renumbering.
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

| Phase | Goal | Features | Done |
| --- | --- | --- | --- |
| 0 Groundwork | Rename, plan, spikes | 6 | 2 |
| 1 Core controls prototype | Prove the tank's controls work in VR co-op | 14 | 0 |
| 2 Communication aids | Hatches and diegetic signals, compared against voice only | 7 | 0 |
| 3 Combat and damage | Enemies, ammunition types, damage and repairs | 9 | 0 |
| 4 Training and tutorials | Simplified systems and five training stages | 7 | 0 |
| 5 Content and replay | Tiers, scenarios, scoring, ghosts, replays | 11 | 0 |

**Current focus:** Phase 1, with Phase 0's spikes waiting on their headset checks.

## Phase 0: Groundwork

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F0.1 | Concept, implementation plan and this roadmap in the repository | Done | | #1 | `docs/concept.md`, `docs/plan.md`, `docs/roadmap.md` |
| F0.2 | Rename the template to Track & Barrel VR | Done | | #2 | `package.json` name, page title, `coop-vr.` storage keys, README, lobby Worker name |
| F0.3 | Spike S1: magnified sight render on Quest 3 | Headset check | F0.2 | #3 | Second camera into a 512² texture shown at infinity through the lens, reticle with range marks; [spike note](spikes/s1-sight-render.md) with the headset check |
| F0.4 | Spike S2: riding the tank | Headset check | F0.2 | #7 | [spikes/s2-riding.md](spikes/s2-riding.md): Practice → Ride the tank as driver or gunner; world moves round the hull; gunner's space turns with the turret; open or closed cabin; vignette on or off |
| F0.5 | Spike S3: lever feel | Headset check | F0.2 | #4 | Two test tillers and a lane board (Practice > Lever test); headset check in [spikes/s3-lever-feel.md](spikes/s3-lever-feel.md) |
| F0.6 | Spike S4: loading a shell | Headset check | F0.2 | #6 | Grab, swing, ram, close, seated; time and fumbles. [spikes/s4-loading.md](spikes/s4-loading.md); Practice → Sit at the breech |

## Phase 1: Core controls prototype

Ends when a crew can drive the range, find and hit three static targets, and the concept's Phase 1 play-test questions have answers.

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F1.1 | Cabin and seats: hull and turret basket model, driver and gunner seats, seat-local avatars, remove the demo and deck walking | Headset check | F0.2 | #8 | [cabin.md](cabin.md): `src/sim/cabin.ts` replaces `play-area.ts`; the host decides seats; Practice → Sit in Driver/Gunner |
| F1.2 | Seat choice and calibration: pick a seat on the crew page, seated head height and reach, standing mode, head kept inside the seat box | Headset check | F1.1 | #10 | [seat-choice.md](seat-choice.md): seat on the start screen, swaps only when both agree, calibration as VR starts, eye height replaces character height, head stopped under the roof |
| F1.3 | Mechanism kit: lever, wheel/crank, twist grip, yoke, button; limits, detents, haptics, grip locking | Headset check | F0.5, F1.1 | #12 | [mechanisms.md](mechanisms.md): `src/sim/mechanism.ts` and `MechanismSystem`; S3's tillers rebuilt on it; Practice → Mechanism kit bench. HoldKind 11 is `LocalControl` (12 since taken by F1.8's power grip) |
| F1.4 | Tank drive simulation and world movement: skid steer, RPM, gear ranges, ground following, obstacle bumps, host authority | Headset check | F0.4, F1.1 | #13 | [tank-drive.md](tank-drive.md): `src/sim/tank-drive.ts`, blockout ground and obstacles in `src/sim/terrain.ts`; tank-state (5) and driver-controls (6) packets; thumbstick tillers and a menu gear lever until F1.5; Practice → Drive the tank |
| F1.5 | Driver station: tillers, gear lever with grinds, hand throttle, gauges, vision slit | Headset check | F1.3, F1.4 | #18 | [driver-station.md](driver-station.md): kit levers (HoldKind 2–5) read into the drive; sticks still drive while no tiller is held; five gauges; slit frame and brow pad; tank-state packet now 53 bytes (gauges and the host driver's controls) |
| F1.6 | Periscope: two-grip rotation, magnified view | Planned | F1.5, F1.9 | | Shares the sight renderer |
| F1.7 | Test range: ground, roads, obstacles, fog, static targets at 100, 250 and 500 m | Headset check | F1.4 | #16 | [range.md](range.md): `src/sim/range.ts` and `range.scene-asset.ts` built into the ground's model; two dirt roads, three targets, markers every 100 m, fog to about 600 m (menu setting); Practice → Up the range. S1's hull-space boards gone |
| F1.8 | Turret and gun laying: basket rotation, RPM-dependent power traverse, manual traverse and elevation wheels, gunner-side prediction | Headset check | F1.3, F1.4 | #17 | [turret.md](turret.md): `src/sim/turret.ts` and `TurretSystem`; the gunner's page owns the turret, turret packet (7); power grip, crank and elevation wheel (HoldKinds 6, 7 and 12); the gun elevates; the gunner turns with the basket; Practice → Lay the gun |
| F1.9 | Gunsight: lean-in magnified view, reticle with range marks | Headset check | F0.3, F1.8 | #20 | [gunsight.md](gunsight.md): `src/sim/gunsight.ts`; an articulated sight: the eyepiece fixed in the turret, the objective and the sight camera on the gun; Practice → Lay on lays the gun on each target from wherever the tank stands (event `sight-lay`) |
| F1.10 | Loading and firing: ready rack, shells, breech, ram and close, fire trigger, casing ejection, ballistics, hits | Headset check | F0.6, F1.8 | #21 | [loading-firing.md](loading-firing.md): `src/sim/loading.ts`, `src/sim/ballistics.ts`, `LoadingSystem` and `FiringSystem`; S4's drill moved into the turret; the gunner's page owns the loading (packet 8, shell HoldKind 9); the power grip's trigger fires; `shot` and `shot-hit` events, the host decides hits; Practice → Load and fire |
| F1.11 | Range run: run timer, three-target count, restart, Practice shortcuts (parked at a target, loaded and aimed) | Building | F1.7, F1.10 | | [range-run.md](range-run.md): `src/sim/range-run.ts` and `RangeRunSystem`; the host keeps the run (`run`, `run-ask`, `range-ready` events); run clocks in both seats, a red flag by each target hit; Practice → Range run (Start, Stop) and Ready to fire (100, 250, 500 m) |
| F1.12 | Tank audio and intercom: engine by RPM, tracks, clunks and grinds, gun, breech, casings; voice ducking; plain intercom voice by default | Planned | F1.5, F1.10 | | WebAudio, no CDN assets |
| F1.13 | Practice crewmate in both seats: drives a route or follows calls; aims at and fires on the nearest target | Headset check | F1.5, F1.10 | #23 | [crewmate.md](crewmate.md): its scripted hands work the tillers, gear lever, shells, breech, power grip and elevation wheel through the kit; drives the route or follows the menu's new Calls (`crew-call` event, shown on the other player's sign); loads, lays on the nearest target not yet hit and fires from a halt |
| F1.14 | Comfort and play-test stats: motion vignette, reduced bumps, per-run CSV (time to three hits, grinds, fumbles per control, time per role) | Planned | F1.11 | | Answers the concept's §14 questions |

## Phase 2: Communication aids

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F2.1 | Hatches: driver's and commander's, stand up 25 cm above seated head height to be out | Planned | F1.2 | | Exposure matters from Phase 3 |
| F2.2 | Driver signal lamps (stop, go, left, right) with gunner's buttons and a buzz on the driver's controller | Planned | F1.5 | | |
| F2.3 | Turret position dial for the driver | Planned | F1.8 | | |
| F2.4 | Hull direction indicator in the gunner's sight | Planned | F1.9 | | |
| F2.5 | Firing lamp so the driver holds steady | Planned | F1.10 | | |
| F2.6 | Push-to-talk option and the callout vocabulary card | Planned | F1.12 | | Open mic stays the default |
| F2.7 | Signals on/off setting and comparison in the play-test stats | Planned | F2.2–F2.5, F1.14 | | Same pairs, voice only versus voice plus signals |

## Phase 3: Combat and damage

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F3.1 | Ammunition types: AP, HE and smoke with distinct effects and rack slots | Planned | F1.10 | | |
| F3.2 | Enemy anti-tank guns that shoot back (static) | Planned | F3.1 | | Decide enemy AI scope first |
| F3.3 | Enemy tanks on fixed routes | Planned | F3.2 | | |
| F3.4 | Tank damage model: hit zones, armour, crew exposure in the hatch | Planned | F3.2, F2.1 | | |
| F3.5 | Fires: fixed extinguisher handles and a handheld extinguisher | Planned | F3.4 | | |
| F3.6 | Electrical faults: fuse swaps at the radio and fuse panel | Planned | F3.4 | | |
| F3.7 | Overheating and engine management | Planned | F1.5 | | |
| F3.8 | Gun jams and misfires | Planned | F1.10 | | |
| F3.9 | Thrown track repaired outside the tank | Planned | F3.4, F2.1 | | Needs leaving the seat: a separate design note |

## Phase 4: Training and tutorials

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F4.1 | Turret travel lock | Planned | F1.8 | | |
| F4.2 | Autoloader option | Planned | F1.10 | | |
| F4.3 | Gear options: high range only, semi-automatic | Planned | F1.5 | | |
| F4.4 | Engine startup: pre-started, one button, short checklist, full procedure that can flood | Planned | F1.5 | | |
| F4.5 | Training stages 1–5 (driving course to full crew drill) | Planned | F4.1–F4.4 | | Concept §7.1 |
| F4.6 | AI commander callouts for targets and directions | Planned | F1.12 | | Recorded or synthesised voice; off at higher difficulty |
| F4.7 | Callout vocabulary taught in training | Planned | F4.5, F2.6 | | |

## Phase 5: Content and replay

| ID | Feature | Status | Depends on | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| F5.1 | Realism tiers: Recruit, Veteran, Ace | Planned | F4.1–F4.4, F3.7, F3.8 | | Concept §7.2; pick the first-session default from play tests |
| F5.2 | Expert option: tillers as brakes, hand throttle for speed | Planned | F1.5 | | |
| F5.3 | Tank biathlon time trial with medals and penalty laps | Planned | F1.11 | | |
| F5.4 | Per-role stats and crew ranks for a regular pair | Planned | F1.14 | | |
| F5.5 | Ghost replay of the crew's best run | Planned | F5.3 | | |
| F5.6 | After-action replay with both views side by side | Planned | F5.5 | | |
| F5.7 | Randomised targets, routes and weather | Planned | F1.7 | | Each random part gets a URL switch to turn it off in tests |
| F5.8 | Scenario: escort a convoy | Planned | F3.3 | | |
| F5.9 | Scenario: hold a hill hull-down | Planned | F3.3 | | |
| F5.10 | Scenarios: recon unseen, ambush a column | Planned | F3.3 | | |
| F5.11 | Night and fog conditions | Planned | F5.7 | | Retint lights, fog and sky; no new lights |

## Ideas (no phase yet)

- An optional third player (concept open question). Not planned: the lobby and presence code assume two.

## Out of scope (from the concept)

- A second vehicle, training or otherwise.
- Foot pedals or extra tracking hardware.
- Shoulder-tap signalling.
