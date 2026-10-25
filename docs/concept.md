# Co-op VR Tank Game: Concept Document

*Working title: TBD · Draft 1 · October 2026*

## 1. Pitch

A two-player co-op VR game where you and a friend crew a WW2-style tank. One player drives, the other aims and loads. Neither can see everything, so you have to talk, coordinate and physically operate the tank's levers, wheels and shells to complete exercises and, later, survive combat.

## 2. Design pillars

1. **Physical controls are the fun.** Every action is done with your hands: pulling tillers, cranking wheels, lifting and ramming shells, standing up through a hatch.
2. **Forced cooperation through split information.** The driver sees the route, the gunner sees the targets. Success depends on communication.
3. **Visually simple.** Low-poly, flat-shaded world. Detail is spent on the cabin interior and controls.
4. **Mastery and replay.** Clear scores and times so a crew can see themselves improve session to session.

## 3. Platform and players

- VR with head and hand tracking only (no foot pedals or extra trackers).
- Exactly two players, networked, in separate physical spaces.
- Seated play by default. A standing mode is supported via calibration.

## 4. Roles

### Driver
- Sits in the hull, front-left.
- Limited forward vision via a vision slit or rotatable periscope. Can open the hatch for a full view at the cost of exposure.
- Controls movement, gears and engine RPM.

### Gunner (includes loader duties)
- Sits in the rotating turret basket, to the right of the gun breech.
- Sees through a magnified gunsight. Little awareness of where the tank is heading.
- Aims, loads, chooses ammunition and fires.

### Commander duties
Not a dedicated player. Split between the two players and/or automated:
- **Spotting:** either player can stand up through a hatch (the commander's hatch is in the turret, behind-left of the gunner).
- **AI commander:** optional voice callouts for targets and directions, used in training and easier difficulties, removed at higher difficulties.
- **Radio and fuses:** panel on the driver's right.

## 5. The tank

A single **composite WW2 tank**, designed for fun controls rather than historical accuracy to any one vehicle. Inspired by Sherman/T-34 levers and gearbox, Tiger-style RPM-dependent turret traverse, and Sherman-style manual loading.

**Decision:** one tank design only, iterated on throughout development. No secondary or training vehicle.

### 5.1 Driver controls (hands only)
| Control | Behaviour |
|---|---|
| Left and right tillers | Skid-steer: each lever sets its track's speed, forward or back. Both forward to drive, ease one back to turn, opposite directions to pivot, centre both to stop. Throttle is built into the tillers. |
| Gear lever | Low and high range. Shift only with tillers near centre, otherwise grind, haptic buzz and lurch. |
| Hand throttle | Left wall. Sets idle RPM, which drives turret traverse speed when stationary. |
| Periscope / vision slit | Rotate the periscope with two grips, or lean into the fixed slit. |
| Gauges | RPM, temperature, oil pressure, fuel. |

*Expert option (later):* tillers act as brakes, as on real tanks, and the hand throttle controls speed.

### 5.2 Gunner controls
| Control | Behaviour |
|---|---|
| Gunsight | Lean into the eyepiece to switch to the magnified scope view. Range markings in the reticle. |
| Power traverse grip | Right hand. Speed depends on engine RPM. Fire trigger on the grip. |
| Manual traverse wheel | Right hand, for fine aiming. |
| Elevation wheel | Left hand. |
| Ready rack | Turret wall to the gunner's right. |
| Breech | Gunner's left. Load by twisting: grab shell, swing across, ram, close. |
| Ammo types | AP, HE, smoke. |

### 5.3 Cabin layout
```
            FRONT
  +-------------------------+
  | [Driver]   |  [Radio/   |
  |  tillers,  |   fuses]   |
  |  gear      |            |
  |       .----|----.       |
  |      /   breech  \      |
  |     |  [B] [Gunner][R]  |   R = ready rack
  |     | (H)           |   |   H = commander's hatch
  |      \  turret     /    |
  |       '-----------'     |
  |       [Engine bay]      |
  +-------------------------+
             REAR
```

### 5.4 Ergonomic rules
- All controls in the front 180° of each player. Nothing behind them.
- Everything between knee and head height. No real-floor-level interactions (ammo bins are raised).
- Controls within 30–60 cm of the shoulders. A calibration step records arm reach and seated head height and adjusts control positions.
- Hands stop at controls: levers follow the hand to their limit rather than letting it pass through.
- Hatch: rising roughly 25 cm above calibrated seated head height puts the player "out of the hatch".

## 6. Communication

**Voice is the primary channel.**
- Open mic by default (hands are always busy). Push-to-talk optional.
- Intercom kept clear and intelligible. Engine and gun audio ducks slightly while someone speaks.
- A short callout vocabulary taught in training ("driver stop", "on the way", "target, tank, 2 o'clock").

**Diegetic visual signals as a backup** (to be compared against voice-only in play tests):
- **Driver signal lamps** below the vision slit: stop, go, left, right. Triggered by buttons at the gunner's right hand, with a short buzz on the driver's controller.
- **Turret position dial** for the driver.
- **Hull direction indicator** in the gunner's sight.
- **Firing lamp** so the driver knows to hold steady.

Shoulder taps were considered and dropped: with only controller vibration and sound, they don't carry enough information.

## 7. Progression and difficulty

Difficulty comes from **enabling systems** on the same tank rather than building new vehicles.

### 7.1 Training missions (later phase)
| Stage | Turret | Loading | Gears | Engine |
|---|---|---|---|---|
| 1. Driving course | Locked forward | n/a | High range only | Pre-started |
| 2. Stationary gunnery | Locked forward | Autoloader | n/a | Pre-started |
| 3. Hull aiming on the move | Locked forward | Manual | Low/high | Pre-started |
| 4. Turret released | Free, power traverse | Manual | Low/high | Short startup |
| 5. Full crew drill | Free, RPM-dependent | Manual, restock | Grinds on bad shifts | Full startup |

The turret travel lock (a real WW2 feature) forces the driver to aim the hull in early training and eases players into motion.

### 7.2 Realism tiers
| Element | Recruit | Veteran | Ace |
|---|---|---|---|
| Startup | One button | Short checklist | Full procedure, can flood |
| Gears | Semi-auto | Manual, forgiving | Grinds and stalls |
| Loading | Autoloader | Manual, rack refills | Manual, restock by hand, jams |
| Range finding | Shown | Reticle with hints | Estimate unaided |
| Engine | No management | Temperature only | Temp, oil, RPM-dependent traverse |
| Commander | AI callouts | Map only | No help |

### 7.3 Combat scenarios (ideas)
Escort a convoy, hold a hill hull-down, recon without being spotted, ambush a column, night with limited vision, fog.

## 8. Replay value

- Time trials and medals, including a tank biathlon mode (drive a course, stop at firing lines, penalty laps for misses).
- Ghost replays of the crew's previous best run.
- Per-role stats: accuracy, reload time, stalls, time spent in the hatch.
- Shared after-action replay showing both players' views side by side.
- Randomised target placement, routes and weather.
- Crew ranks tied to a regular pair.

## 9. Damage and maintenance (later phase)

Fires (fixed extinguisher handles and a handheld extinguisher), electrical faults (fuse swaps), overheating, gun jams and misfires, thrown tracks repaired outside under fire. Whoever has free hands deals with it.

## 10. Visual and audio style

- Low-poly, flat-shaded exterior. Fog and haze for atmosphere, performance and to increase reliance on communication.
- Detailed, tactile cabin interior: levers, gauges, shells, casings.
- Heavy, mechanical audio: engine note tied to RPM, gear clunks and grinds, breech slam, casing clatter.

## 11. Comfort

- Seated default; the cabin provides a stable reference frame.
- Gentle tank acceleration. Avoid sudden jolts and lateral shakes.
- The gunsight acts as a stable window during turret rotation.
- Comfort options: vignetting, reduced bumps.

## 12. Technical notes

- One authority for tank physics (host or driver's client).
- Gunner's turret input predicted locally so aiming feels responsive.
- Voice chat integrated with intercom audio processing.

## 13. Development plan

### Phase 1: Core controls prototype (current priority)
Goal: prove the main tank controls work well in VR co-op.
- One tank cabin with both stations and full controls: tillers, gear lever, hand throttle, traverse and elevation wheels, gunsight, manual loading.
- Networking with physics authority and local turret prediction.
- Flat test area with obstacles and static targets at varied ranges.
- Voice chat only.

### Phase 2: Communication aids
- Add signal lamps, turret position dial and hull direction indicator.
- Compare voice-only and voice-plus-signals with the same pairs.

### Phase 3: Combat and damage
- Enemies that shoot back, ammo types, damage and repair tasks.

### Phase 4: Training and tutorials
- Turret travel lock, autoloader and simplified systems for staged training missions.

### Phase 5: Content and replay
- Scenarios, scoring, ghosts, after-action replays, realism tiers.

## 14. Play-test questions (Phase 1)

- Do the controls feel natural within a few minutes?
- Do players start talking to each other without prompting?
- How long does a pair take to hit three targets?
- Does anyone feel motion sick, and when?
- Which control do players fumble most?

## 15. Open questions

- Engine and target hardware (standalone headset vs PC VR).
- Default realism tier for a first session.
- Exact size and shape of the test area and first scenarios.
- Enemy AI scope.
- Whether an optional third player slot is worth supporting later.

## 16. Out of scope

- A second vehicle (training or otherwise).
- Foot pedals or additional tracking hardware.
- Shoulder-tap signalling.
