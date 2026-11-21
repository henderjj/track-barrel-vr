# Enemies seen, pencilled on the map (F2.11)

The third of the commander's tasks for the gunner (John, 2026-11-21): "an enemy seen through the sight or the periscope is pencilled on the map in red, where it was seen" (the proposal John approved). A commander of the war kept his map marked up with a grease pencil: what had been seen and where, what had fired, what was knocked out, so he could brief the crew, warn the driver off a gun's arc and report back. Ours does the pencilling for the crew; what they have to do is look.

The numbers and the book live in [`src/sim/map-marks.ts`](../src/sim/map-marks.ts); [`src/systems/map-marks-system.ts`](../src/systems/map-marks-system.ts) looks through the crew's sights and keeps the book; [`src/systems/map-case-system.ts`](../src/systems/map-case-system.ts) pencils it on the map ([map-case.md](map-case.md)).

## What players experience

- **Seen.** Look at an enemy through the gunsight or either periscope, with its picture open (the eye at it), for a second: it goes on the map in red where it is, numbered in the order seen (1, 2, 3 ...). The guns, houses, walls and the ground hide what is behind them, smoke hides what is in it, and nothing past 1.5 km is made out.
- **The symbols**, as a 1944 map would draw them: an anti-tank gun as an arrow standing on a bar, a tank as a track's oval, a lorry as a box on two wheels. The number stands beside it.
- **A flash.** An enemy gun or tank that fires gives itself away: it goes on the map dashed, with a "?" after its number, until someone sees it properly.
- **On the move.** A tank or lorry seen again more than 25 m from its mark is rubbed out and pencilled where it is now, keeping its number. A gun never moves.
- **Knocked out**, a marked enemy is crossed through, and stays where it was.
- **A clean map.** When a fight or mission ends and its enemies go, their marks are rubbed out; the next fight's numbers start from 1 again.
- **Both crew** see the same marks: what either of them sees goes on the one map.
- **Practice → Commander → Spot on the map** seats a lone player as gunner, brings the three enemy guns out holding their fire, and parks the tank on the lane where gun A is ahead, with a sign. Turn the turret and look: each gun you see goes on the map.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Seeing time | 1 s in the field with a clear line; out of view, the clock runs back at half speed | Long enough that a sweep past doesn't count; a glance away doesn't lose it |
| Range | 1.5 km | Past every place the missions put an enemy; a gun's shield at 1.5 km is under a mil, a dot even in the sight |
| Fields | gunsight ±6° (true), periscopes ±20° across and ±8° up and down, as they are drawn | What the eye actually sees through each |
| Looking from | the gunsight's objective 1.85 m over the hull floor, the gunner's periscope head 2.5 m, the driver's 1.62 m | Their heights on the tank, so a crest hides what it would |
| Line | the ground every 8 m, houses, walls and rocks, smoke clouds | The same checks the enemy uses to see the tank (F3.10) |
| Marks | to 10 m (a six-figure reference), on the map's copy of the ground | The map shows one copy of the repeating ground |
| Moved | a tank or lorry more than 25 m from its mark | About a tank's length either way |
| Looking every | 0.1 s, the line checked only for enemies in a field | Under 0.1 ms a frame |

## Sharing

The host keeps the book. Each page looks through its own player's open sights (the host can't know whether the guest's eye is at the sight), and a guest's page that sees an enemy sends `mark-seen` (the enemy and where it saw it); the host pencils it, and its own crew's sightings, every flash and every knock-out, and rubs out marks of enemies gone. The host sends the whole book (`marks`: a version and each mark as five numbers) on every change, and again every 5 s while it has marks, for a guest that missed one. No packet and no HoldKind. The map's sheet is painted again only when the book changes: the map as painted at load, then the marks over it.

## The practice crewmate

Nothing yet: the crewmate navigator (F2.13) can look for enemies and report them.

## Test hooks

`window.__mapMarks`: `state()` (the book as this page has it, how many of its sights and periscopes are open, and the sign), `practice()`, `layOn(i)` (the gun laid straight on enemy `i`), `where(i)` (where enemy `i` is). `window.__mapCase.image()` gives the painted map with the marks. XR step 6zg (part 4) checks Practice → Commander → Spot on the map's seat, guns and sign, gun A pencilled as mark 1 where it stands with the sight open and the gun on it, its mark crossed through when it is knocked out, and the map clean when the guns stop. The net test (after the enemy guns, both pairs) checks the guest gunner's sighting going on both maps as the same mark, and Stop rubbing it out on both.

## Departures from the building skill

- No crewmate part yet (above).

## Headset check

1. Practice → Commander → Spot on the map. The sign should say what to do.
2. Lean into the gunsight and turn the turret slowly to the left: gun A should be ahead, a little left. Hold it in the sight for a moment.
3. Take the map case (behind your right shoulder): gun A should be on it in red, an arrow on a bar with a 1 beside it, beside the range road. Is it where you'd expect from where you were looking?
4. Find guns B and C through the gunner's periscope as well as the sight (drive up the lane if they're hidden). Each should go on the map, numbered in turn.
5. Combat → Enemy guns → Meet gun A (it fires): a gun not yet seen should go on the map dashed with a "?". Knock one out: its mark should be crossed through.
6. Combat → Enemy guns → Stop: the marks should be rubbed out.
7. Do the red marks read clearly at reading distance, and does anything stutter when a mark goes on (the map is painted again then)? Note the frame time on the HUD.
