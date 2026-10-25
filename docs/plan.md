# Track & Barrel VR: implementation plan

How the game in [concept.md](concept.md) gets built on this repository's co-op VR template. The plan says what we keep, what we replace, the technical approach for the hard parts, and the order of work. Feature-by-feature status lives in [roadmap.md](roadmap.md); what shipped and what the last headset check found lives in [progress.md](progress.md).

Every feature is built the way the repository's skill says ([.claude/skills/build-coop-vr-feature/SKILL.md](../.claude/skills/build-coop-vr-feature/SKILL.md)): a design note in `docs/`, engine-free logic in `src/sim/` with unit tests, a low-poly model registered in the z-fighting test, a system, network messages, a Practice shortcut, the practice crewmate's half, a `window.__<feature>` test hook with browser-test steps, and a numbered headset check. One feature, one pull request against `main`.

A few terms used below: **XR** is an immersive WebXR session (the headset view); **IWER** is IWSDK's browser XR emulator, which the browser tests drive; **ECS** is the entity-component system IWSDK is built on (entities carry components, systems run each frame over queries of them); a controller's **grip pose** is where the hand holds it (used to put hands on handles), its **target-ray pose** is where it points (used for menu rays). See the [IWSDK guides](https://iwsdk.dev).

## 1. Targets

- **Platforms:** the browser, from one URL: Meta Quest 3 in Quest Browser, and PC VR in Chrome or Edge on Windows through Meta Horizon Link or Air Link. This answers the concept's first open question: the engine is IWSDK (Three.js) in the browser.
- **Frame rate:** 90 Hz on Quest 3 (11.1 ms a frame), with the budgets in the skill: 2 ms of game JavaScript, about 100 draw calls, 300k triangles, one directional light plus ambient, no allocation in `update()`.
- **Players:** exactly two, networked peer to peer over WebRTC after meeting in the template's lobby, voice on the same connection. Solo play works with the practice crewmate taking the other seat.
- **Posture:** seated by default (the concept's default), standing supported through calibration.

## 2. What we keep from the template

| Template part | Use in Track & Barrel |
| --- | --- |
| Lobby, WebRTC session, reconnects, crew presence and the "crewmate stepped away" sign | As is |
| Voice (`src/net/voice.ts`) | The intercom; switch the default from spatial to plain (both players sit within 2 m, and the intercom should sound like headphones), add ducking and push-to-talk |
| Hands, grip system, grip locking (`HoldKind`), haptics | The base of every control: a hand that grips a lever stays closed on it and stops at the lever's limit |
| Body height and seated play (`src/sim/body-height.ts`) | The base of seat calibration |
| Start screen, game menu, start-up settings | Kept; the crew page gains seat choice, the menu gains tank settings and Practice shortcuts |
| Practice crewmate (`crew-bot-system`) | Taught to drive and to gun, so one person can test either seat |
| Perf HUD, perf CSV, refresh rate, foveation | As is; the CSV gains play-test stats |
| Unit, z-fighting, XR and net tests, CI, Pages and Worker deploy | As is; each feature adds its steps |
| Comfort vignette (in `DeckWalkSystem`) | Moved into a comfort system driven by the tank's motion |

What goes: the deck, table, hoop and blocks (`play-area.ts`, `score.ts`, `deck.scene-asset.ts`, `game-system.ts`), thumbstick walking (a seated crew does not walk), and the bot's throwing. Throwing code (`ownership.ts`, `throwables-system.ts`) stays in the tree for shells and casings until we know whether loading needs it (see 4.6).

## 3. Decisions taken (with the alternative)

These are choices the concept leaves open or that the template forces. Each is the recommended option; we proceed with it unless John says otherwise.

1. **The host runs the tank, whichever seat it sits in.** The concept allows "host or driver's client". The template's model is host-authoritative, and a heavy tank that accelerates gently hides 25 ms of one-way delay on the driver's levers. The guest's control positions go to the host at about 45 Hz; the host sends back the tank's pose. *Alternative:* make the driver always the host, so driving has no delay; costs a role-dependent authority switch in every system. Revisit only if the headset check finds guest driving sluggish at 150 ms.
2. **The gunner's client owns the turret's angle and the gun's elevation** (the concept's "turret input predicted locally"). The gunner's page simulates traverse at once from its own hands, using the engine RPM the host sends, and sends the angles to the host and driver. A shot is a reliable event from the gunner carrying the barrel's direction and shell type; the host flies the shell and decides hits.
3. **The tank is a kinematic simulation in `src/sim/`, not a physics-engine body.** Skid-steer track speeds, gears, RPM and a height-field ground, with simple shapes for obstacles. It is deterministic, unit-testable, cheap on Quest, and lets us cap acceleration, pitch and roll for comfort, which a rigid body would fight. Rapier stays for loose things in the cabin (casings), if at all.
4. **The tank stays at the origin and the world moves** (the skill's moving-vehicle rule). The hull is the driver's frame. The gunner's play space is attached to the turret basket and turns with it, as a real basket does; the basket floor and walls are the stable reference, the gunsight a stable window. This is the riskiest comfort question, so it is spike S2 before the turret is built.
5. **Either player can take either seat.** Seat choice is on the crew page (and in the game menu, swapping both when the other agrees). Solo, the player picks a seat and the practice crewmate takes the other, or nobody does and the empty seat's systems sit idle (driver idle: tank parked; gunner idle: turret locked forward).
6. **Magnified sights are a second camera rendered into a texture** on the eyepiece (and the periscope), drawn only while a head is close to it, at a reduced resolution and field of view. WebXR does not let us change the headset's own projection. Its cost on Quest 3 is spike S1.
7. **Phase 1 runs at one realism level**, roughly the concept's Veteran: manual loading, manual gears that grind on bad shifts but are forgiving, RPM-dependent traverse, gauges shown but no failures. Realism tiers come in Phase 5, built by switching these systems' options.

## 4. Technical approach for the hard parts

### 4.1 Cabin, seats and calibration

- One cabin model, built procedurally in `src/scene-assets/` like the template's deck, vertex-coloured and merged. Detail goes into the controls, gauges and shells; the exterior is low-poly. The hull, the turret basket and each moving control are separate meshes so they can move.
- Seat space replaces deck space: `src/sim/cabin.ts` holds the seat positions, the eye point, every control's position, its throw and limits, shared by the model, the systems, the bot and the tests (the job `play-area.ts` does now).
- **Calibration:** the template already raises a seated player's eyes to a set height. We extend it with a short step in the start flow: sit back, look ahead (records seated head height), then reach to two marks (records arm reach). Phase 1 moves the seat (the play-space origin) so the eyes land on the seat's design eye point; reach scaling of control positions within the concept's 30–60 cm comes next, if the play tests show short or long arms struggling.
- **Hatch:** rising 25 cm above the calibrated seated head height puts the player "out of the hatch": the hatch lid opens and the head is allowed above the roof line. Head movement is limited to the seat's box otherwise, the way `DeckWalkSystem` limits the head, so leaning cannot put a head through armour.

### 4.2 Mechanism kit (levers, wheels, grips)

Every control is one of a few mechanisms, written once in `src/sim/mechanism.ts` (engine-free) and driven by a `MechanismSystem`:

| Mechanism | Used by | Behaviour |
| --- | --- | --- |
| Lever (one axis, limits, optional spring-to-centre and detents) | Tillers, gear lever, hand throttle, breech lever | Angle follows the projection of the gripping hand onto its arc; stops at its limits and the hand stays locked on (the concept's "hands stop at controls") |
| Wheel / crank (continuous rotation, gear ratio) | Manual traverse, elevation | Angle follows the hand's angle around the axle; turns per degree of gun set per wheel |
| Twist grip with trigger | Power traverse | Twist sets traverse rate, trigger fires |
| Two-handle yoke | Periscope | Both hands rotate it; one hand works but slower |
| Button / switch | Signal buttons, fuses, radio | Pressed by a fingertip or a grip squeeze |

Each handle gets a `HoldKind` so both players see the hand closed on it, and haptic ticks at detents and limits. Shared controls follow the skill's pattern, though in practice each control belongs to one seat.

### 4.3 Driving

- `src/sim/tank-drive.ts`: each tiller sets its track's target speed (forward or back) scaled by the gear range; the engine's RPM follows the demand with lag; track speeds approach their targets under capped acceleration (about 1 m/s², per the concept's gentle acceleration); the hull's yaw rate comes from the speed difference. Pitch and roll come from sampling the ground under the track ends, eased and capped at a few degrees.
- Gear lever: low (0–12 km/h) and high (0–35 km/h) ranges as starting numbers, tuned in play tests. Shifting with either tiller more than about 20% from centre grinds: haptic buzz, a clunk, a short lurch, no shift.
- Hand throttle sets idle RPM, which sets turret traverse speed when stationary.
- Gauges (RPM, temperature, oil, fuel) as needles in the dash, driven by the host's engine state. Temperature and fuel move slowly; no failures in Phase 1.
- Collision: the hull as a box against obstacle circles and boxes in `src/sim/`, stopping the tank with a soft bump, not a jolt.
- Vision: the slit is a real opening in the hull (no extra render); the periscope is a rotatable magnified view (shares the sight's render-to-texture code).

### 4.4 Turret and gun laying

- Turret angle relative to hull and gun elevation (about −10° to +20°) live in `src/sim/turret.ts`. Power traverse rate rises with engine RPM (about 6°/s at idle to 24°/s at full RPM, Tiger-style); the manual wheel moves it slowly and precisely; the elevation wheel sets the gun.
- The gunner's page simulates these at once from its own hands; the host and driver show them from the gunner's packets (decision 2).

### 4.5 Gunsight

- Lean the eye within about 8 cm of the eyepiece and the sight shows a magnified view (start at 3×) with range marks in the reticle, rendered by a second camera on the gun into a texture of about 512×512, drawn only while a head is close. Rendered once per frame for one eye; the other eye sees the eyepiece dark (as when you close one eye at a real sight). S1 measures whether this fits the budget and how it reads.

### 4.6 Ammunition, loading and firing

- Ready rack on the turret wall to the gunner's right, raised above knee height; shells are held objects, gripped and carried by the hand.
- Breech on the gunner's left: open with its lever, bring a shell's base to the breech mouth (snaps in when aligned within a tolerance), push to ram, close. Firing ejects the casing into a bin with a clatter, and the breech opens.
- Shells in the cabin move with the turret, so they live in turret space and do not need the network's throwing code; the other player sees them from the gunner's hand packets and reliable "loaded"/"fired" events. Revisit if the driver ever needs to hand a shell over.
- Ballistics in `src/sim/ballistics.ts`: muzzle speed per shell type (AP about 600 m/s), gravity, no drag in Phase 1, a ray-marched path tested against target shapes and the ground. The host decides hits and sends them as events. The shell is drawn as a tracer (real 3D geometry, emissive), never a sprite.

### 4.7 Test range

- A flat range of about 600 m × 600 m with low mounds, obstacles (rocks, a wall, a few houses), roads and a driving lane, with fog limiting sight to about 600 m (fog also helps performance and pushes the crew to talk). Static targets (tank and gun silhouettes, wooden boards) at about 100, 250 and 500 m.
- A run timer and the "three targets" count from the concept's play-test questions, restartable from the menu. Static parts merged; repeated props instanced; distant parts with a second, lower level of detail.

### 4.8 Audio

The template has no game audio, only voice. We add a small audio system on WebAudio with no CDN assets: a synthesised engine note that follows RPM, track rumble with speed, and short sounds for gear clunk and grind, breech slam, gun shot and casing clatter. Engine and gun duck by about 6 dB while the voice analyser hears either player speaking (concept §6). Recorded samples may replace the synthesised ones later, bundled in `public/`.

### 4.9 Networking summary

| What | Channel | Direction |
| --- | --- | --- |
| Driver's control positions (tillers, gear, throttle) | Unreliable, ~45 Hz, new `PacketType` | Guest driver → host |
| Tank state (position, heading, pitch, roll, track speeds, RPM, gauges) | Unreliable, ~45 Hz | Host → guest |
| Turret angle, elevation, traverse wheel angles | Unreliable, ~45 Hz | Gunner → other |
| Hands and heads | Existing pose packets, in seat-local coordinates with a frame tag (hull or turret) | Both ways |
| Shift, grind, loaded, fired (direction, type), hit, target down, run reset | Reliable events | As needed |

Every new packet gets a round-trip unit test and a `net-test.mjs` check at 150 ms with jitter and loss.

### 4.10 Comfort

Gentle acceleration and turning caps in the drive sim; capped pitch and roll; a vignette that darkens with the tank's turning and acceleration (the template's vignette, retargeted), on by default and adjustable in the menu; a "reduced bumps" option that flattens the ground-following. Whenever the game stops the tank by itself (crewmate away, reconnect, restart) a sign says why.

## 5. Risks and spikes

Short experiments before the features that depend on them, each written up in `docs/spikes/` like the template's.

| Spike | Question | Pass mark |
| --- | --- | --- |
| S1 Sight render | Does a 512² second-camera view fit Quest 3's budget alongside the cabin and range, and is it readable? | Holds 90 Hz with the sight open; range marks readable at 3× |
| S2 Riding the tank | Hull-at-origin with the world moving, and the gunner's play space turning with the turret: comfortable for 10 minutes? | No discomfort at the default caps from two testers, with and without the vignette |
| S3 Lever feel | Does a hand-following lever with limits feel natural and stay stable with controllers and tracked hands? | Players drive a lane with the tillers within a few minutes |
| S4 Loading | Can a seated player grab, swing, ram and close reliably in under about 5 s? | Ten loads in a row without a fumble after practice |

## 6. Phases

The concept's five phases, with a Phase 0 for groundwork. The [roadmap](roadmap.md) breaks them into features.

- **Phase 0, groundwork:** rename the template to Track & Barrel VR, bring in the concept, this plan and the roadmap, and run spikes S1–S4.
- **Phase 1, core controls prototype (current priority):** the cabin and seats, the mechanism kit, driving, the turret, the gunsight, loading and firing, the test range with static targets, tank audio, the practice crewmate in both seats, comfort options and play-test stats. Ends with the concept's Phase 1 play-test questions answered (§14 there).
- **Phase 2, communication aids:** hatches, signal lamps and buttons, turret position dial, hull direction indicator, firing lamp, push-to-talk, and a voice-only versus voice-plus-signals comparison.
- **Phase 3, combat and damage:** ammunition types with distinct effects, enemies that shoot back, damage, and repair tasks.
- **Phase 4, training:** the turret travel lock, autoloader, simplified gears and startup, and the five training stages, with optional AI commander callouts.
- **Phase 5, content and replay:** realism tiers, scenarios, biathlon and medals, ghosts, after-action replay, per-role stats, randomisation and weather, crew ranks.

## 7. Questions still open

From the concept, with what we will do until they are answered:

- **Default realism tier for a first session:** Phase 1 has one level (decision 7); decide in Phase 5 after play tests.
- **Test area size and first scenarios:** start with the range in 4.7 and change it after the first play test.
- **Enemy AI scope:** decided at the start of Phase 3, starting from static anti-tank guns, then tanks on fixed routes.
- **An optional third player:** not planned. The lobby and presence code assume two, so a third seat would be a project of its own.

## 8. How to keep this current

- When a feature's status changes, update its row in [roadmap.md](roadmap.md) in the same pull request.
- When a feature ships or a headset check reports back, add a line to [progress.md](progress.md).
- When a decision in section 3 changes, change it here and say why in the pull request.
