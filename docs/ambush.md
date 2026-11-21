# Ambush a column (F5.10)

A scenario on the **Missions** tab, built on the combat scenario's enemy and spotting (F3.2, F3.3, F3.10): wait hull down behind a wall while an enemy column (a tank, two lorries, a tank) drives down a road across the front, then knock out three of the four before they get away or knock the tank out.

The logic is engine-free in [`src/sim/ambush.ts`](../src/sim/ambush.ts) and [`src/sim/column.ts`](../src/sim/column.ts) (the column's road and how it moves), with the column added to the enemy battery in [`src/sim/enemy-guns.ts`](../src/sim/enemy-guns.ts). The system is [`src/systems/missions-system.ts`](../src/systems/missions-system.ts); the column is drawn and driven by [`src/systems/enemy-system.ts`](../src/systems/enemy-system.ts); the lorry is [`src/scene-assets/enemy-truck.scene-asset.ts`](../src/scene-assets/enemy-truck.scene-asset.ts).

## What players experience

- **Missions → Ambush a column → Start** puts the tank hull down behind a dry stone wall, 240 m south of the range's second cross road (the copy at z −800, a tile north of the start), facing it. The wall is new (`AMBUSH_WALL` in [`terrain.ts`](../src/sim/terrain.ts)), 15 m long and 1.5 m high, 9 m in front of the tank. A sign says "Ambush: a column is coming down the road ahead. A tank, two lorries, a tank. Hold fire till they are close, then knock out three".
- **The column** comes onto the road from the right, 460 m off where the fog starts, at 18 km/h, 30 m apart, and drives west past the tank, then away north 520 m off. The lead tank is level with the ambush about 80 s in.
- **Springing it**: the crew's first shot springs the ambush. So does any of the column's vehicles spotting the tank first (spotting as in Advance to contact: it builds up with time and the square of the range, quicker while the tank moves or fires, about three times slower hull down; a tank on the move at half speed): "The column has seen you. Its tanks are halting to fire: engage now". From the road the column sees only the turret over the wall; a still tank there is not spotted before the lead tank is level with it.
- **Sprung**: each tank halts while it has the crew's tank, lays and fires as the patrolling tanks do (F3.3). The lorries run for it at 32 km/h. A vehicle can't drive through one stopped ahead (a wreck, or a tank halted to fire): it stops 14 m behind, waits 5 s, then pulls 7 m off the road to its right and passes, and comes back on once clear. A lorry is soft: one hit of any shell knocks it out, scorched with its canvas burnt off. The tanks need the damage model's armour, as the patrolling tanks do.
- **The end**: knocking out three of the four wins ("Ambush won: 3 of 4 knocked out", or "Column destroyed in 2:41" for all four); the column getting away with two (off the road's far end), or the tank knocked out, loses. The counts follow: tanks and lorries out, how many got away, when it was sprung (or seen), hits taken of shots, and hits through the armour.

Also:

- Starting it stops the Battle tab's Advance to contact, Escort a convoy (F5.8) and Hold the hill (F5.9): they share the enemy battery. Starting one of those ends the ambush. **Stop** takes the enemy away.
- The result stays as a line under the Missions tab's buttons, and the orders board (F6.5) shows the mission's tasks while it runs.

## Numbers

| | Value | Why |
| --- | --- | --- |
| Column pace | 5 m/s (18 km/h), lorries running 9 m/s | a road march, a lorry flat out |
| Column spacing | 30 m | |
| Held up | stops 14 m behind, passes after 5 s, 7 m to its right, 2.5 m/s across | |
| Ambush range | 240 m to the road | close enough that the 75 hits, far enough that the column's tanks take time |
| To win | 3 of 4 | |
| Seed | 6060 | the same play meets the same fall of shot |

The Battle tab's tuning (spotting, aim, reactions, armour) applies to it.

## The column in the battery

The column is the battery's fourth group, `'column'`, at indices 5–8 (after guns 0–2 and tanks 3–4; `FIRST_COLUMN`), so its shells' targets are 14–17 (`ENEMY_TARGET_FIRST + i`). F5.9's hill group comes after it (`FIRST_HILL = FIRST_COLUMN + COLUMN_LENGTH`). Its vehicles start strung out behind the road's start, off the road and unseeing until they reach it. Only its tanks lay and fire; the lorries never do. Lorries are soft targets (HE knocks them out) and not armoured; the column's tanks are both.

The road lies within 400 m of the ambush in x and z, so the copy of the column drawn (the ground repeats every 800 m) is always the one on this road. It can't come in from the north east of x 100: that is the biathlon course's copy.

## Sharing

Host-run, as the combat scenario. The `ambush` event (reliable) carries the run's state; a guest's Start and Stop go as `ambush-ask`. The column's places go with the battery's existing message (`enemy`), with two new fields: who is passing and how far off the road, and whether the ambush is sprung; a guest reading an older message without them goes on as before. The guest drives the column between messages by the same rule. No new packet, PacketType or HoldKind.

## The practice crewmate

It holds fire until the lead vehicle is within 300 m or the ambush is sprung, then fires at will.

## Departures from the building skill

- **The column pops in** where the road starts, 460 m off: in the fog, but not hidden by a rise. A road coming in from further would leave the 400 m window the tiled world draws.
- **The lorries make no sound**: the enemy tanks' engine sound is not heard at these ranges either.
- **No wreck smoke or fire** yet: that is F3.5 (fires).
- Only the crew's tank is spotted; a lorry doesn't call the column's tanks onto it.

## Tests

- [`test/ambush.test.ts`](../test/ambush.test.ts): the column's road, pace, gaps, passing and getting away; the column in the battery (sprung by the first shot, hull down at the wall, time to wait, only tanks fire, shared state); the ambush run, its lines, events and board.
- `test/enemy-tanks.test.ts`, `test/ammo.test.ts`: the column's targets, soft and armoured.
- `test/z-fighting.test.ts`: the lorry, whole and wrecked.
- XR smoke test step 6zc (part 6): start an ambush, see the column, spring it and see it react.
- Net test (`missionChecks`): the guest starts the ambush, sees the host's run and the column move, and stops it.

## Headset check

1. Missions tab: an Ambush a column row with Start and Stop, and a status line under it.
2. **Ambush → Start**: the tank is behind a low wall, facing a road 240 m off; the briefing shows.
3. Wait: the column comes in from the right, a tank, two lorries, a tank, evenly spaced, and drives across the front. The lorries look like army lorries (bonnet, cab, canvas tilt).
4. Fire at the lead tank as it crosses: the tanks halt and fire back; the lorries speed up and pull round anything stopped ahead.
5. Knock out a lorry: it is scorched, its canvas gone.
6. Knock out three: "Ambush won". Try again and let them go by: "The column got away".
7. With two players, the guest sees the same column, signs and status lines, and can start and stop it.

## Recon unseen, cut

F5.10 also built a second mission, Recon unseen (#125): find and report the three guns and two tanks by laying the gun on each for 3 s, and come back to the start without being spotted. John cut it on 2026-11-21: a Sherman is big and loud, so sneaking about unseen isn't what a tank crew did, and it didn't fit the game. Its code, menu row, `recon` and `recon-ask` events, `__recon` hook, crewmate behaviour and tests were taken out. The ambush and its column are unchanged.
