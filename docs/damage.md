# Tank damage model (F3.4)

Until now an enemy shell that struck the crew's tank was only counted and called ([enemy-guns.md](enemy-guns.md), [enemy-tanks.md](enemy-tanks.md)). Now each one strikes somewhere on the tank, meets the armour there, and if it gets through it can hit the engine, a track or the transmission, the power traverse, or a crewman. Three hits through the armour knock the tank out. The model is [`src/sim/damage.ts`](../src/sim/damage.ts); [`src/systems/damage-system.ts`](../src/systems/damage-system.ts) keeps it, shares it and shows it.

## What a hit does

**Where it strikes.** The shell's path decides the zone: above the hull's top (1.85 m) it is the turret, below 0.75 m on the side it is the running gear, otherwise the hull. Front, side or rear is decided by the angle between the shot and the hull (for the turret, the turret's own facing, so a turret turned to 9 o'clock takes a shell from ahead on its side).

**The armour.** An M4A4's:

| Zone | Plate | Laid back | Met head on |
| --- | --- | --- | --- |
| Hull front (glacis) | 51 mm | 56° | about 91 mm |
| Hull side | 38 mm | upright | 38 mm |
| Hull rear | 38 mm | 10° | 39 mm |
| Turret front (with mantlet) | 76 mm | about 30° | about 88 mm |
| Turret side | 51 mm | 5° | 51 mm |
| Turret rear | 51 mm | upright | 51 mm |
| Running gear | none | | a track breaks 70% of the time |

Angling the tank to the shot adds armour as it does in life (38 mm met 60° off square is 76 mm), and a shell striking 65° or more off square glances off whatever the armour: the glacis angled about 35° or more to the gun.

**The shell.** An enemy 75 mm AP shell gets through 124 mm of upright armour at 100 m, losing 4 mm per 100 m further, each shell ±8%. So at the ranges here the sides and the rear always give, the turret front nearly always, and the front plate mostly when met square, less the further the shell comes, and seldom once the hull is angled. That is about right for a Sherman against the long German 75: the crew's best defence is the glacis turned to the enemy and not being seen.

**Inside.** A shell through the armour hits what is where it got in:

| Got in through | What it can hit |
| --- | --- |
| The rear, or the side behind the fighting compartment | the engine, every time |
| The front plate | the driver (70% on the driver's side, 30% on the other), the transmission (40%) |
| The side ahead of the turret | the driver (60%) |
| The side under the turret | the gunner (40%) |
| The turret | the gunner (60%), the power traverse (40%, not through the front where the gun's mount takes it) |
| The running gear | that side's track |

| Damage | What the crew finds |
| --- | --- |
| Engine hit once | It runs on with 60% of its pull and a coolant leak that runs it 25 °C hotter, into the TEMP lamp's range (F3.7) when worked hard |
| Engine hit twice | It stops and won't start: "Knocked out by a hit: it will not start until repaired" |
| Track broken or transmission hit | The tank won't move, whatever the driver does; the engine still runs |
| Power traverse out | The power grip does nothing ("Its motor is knocked out by a hit"); the hand crank still turns the turret |
| Crewman hit | That player's view flashes red and dims for 4 s (8 s badly wounded, a second hit). Nothing else: no one is killed and the controls still work |
| Three hits through the armour | Knocked out: the engine stops for good and the enemy hold their fire. "Knocked out! Combat → Damage → Repair to fight on" |

A sign below the enemy's says what each hit did ("Bounced off the front plate", "Through the right side: engine hit", "Struck the left running gear: the track is broken"), and the menu's status line sums up the damage ("Engine damaged, power traverse out. 2 of 4 hits through the armour").

## What players experience

- Fighting the enemy guns or tanks, each hit now says what it did, and the tank breaks down as it takes them.
- **Combat → Damage**: Repair (everything mended, the engine restarted if a hit stopped it) and four practice hits to learn what each does: **Hit engine**, **Track**, **Turret** (the power traverse) and **Me** (on this player's own seat). Starting the enemy guns or tanks, or a Meet, repairs the tank first.

## Sharing

- The host keeps the damage. It decides each enemy hit when the enemy fires (where it will strike, with the tank and turret as they are then, so both pages agree) and sends it in the `enemy-shot` event's new `damage`; it takes the hit when the shell gets there.
- **`damage`** (reliable, new): the whole damage state and the last hit, sent on every change, when a guest joins, and every 5 s while there is any.
- **`damage-ask`** (reliable, new): a guest's Repair or practice hit (with its seat).
- The host's drive takes the engine and the tracks from it every frame; the engine's new stall cause, `hit`, is appended to the tank packet's list, so its index for the others is unchanged. The gunner's page reads the power traverse from it.
- No packet layout, PacketType or HoldKind changes.

## Departures from the building skill

- The crew isn't killed or put out of action: a wound is a red flash and a dim view for a few seconds. A game that takes a player's seat away mid-fight isn't fun for a two-player crew.
- The practice crewmate isn't stunned by a wound, and as gunner it can't lay the gun with the power traverse out (it doesn't use the crank).
- The driver's Forward (the turret slewed ahead) ignores a broken power traverse.
- The hull's zones are boxes and the turret's a box above the hull's top; the round cast turret and the sponsons are not modelled for armour.
- No fire, no ammunition explosion, no electrical faults: fires (F3.5) and faults (F3.6) build on this.
- Crew exposure in an open hatch waits for the hatches (F2.1, Phase 5).

## Tests

- `test/damage.test.ts`: the armour and penetration numbers; the zones from every side and height, the turret turned; the sides always through, the glacis less at range and never when angled; what each zone hits inside; adding up to a knock-out and repairing it; the hit lines; a held, a weakened and hot, and a stopped engine, its stall cause through the tank packet; the shared state and the enemy shot carrying its hit.
- `npm run test:xr` (step 6w, part 1): Me wounds this player (red, the sign); Hit engine once runs on, twice stops it and the starter won't start it; Repair starts it; Track holds it under full throttle; Turret stops the power traverse but not the crank; gun A's hit says what it did; three hits knock the tank out and the guns hold their fire; Repair.
- `npm run test:net` (`ONLY_FIRING=1`): the host's turret hit stops the guest gunner's power traverse; the guest's Me wounds the gunner on both pages, the red only on the guest's; the host's engine hits stop the engine on both pages; the guest's Repair mends it all on both.

`window.__damage` has `state()` (with the last hit, the stun left and how dark the view is), `take(hit)` (host), `test(kind)`, `repair()` and `sign`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone, take the driver's seat. Game menu (Y) → **Combat → Damage → Me**: the view flashes red and dims for a few seconds. Say whether it reads as being hit and whether it is comfortable.
2. **Hit engine** once and drive: it pulls less. **Hit engine** again: it stops and won't start. **Repair**: it starts again.
3. **Track**, then try to drive: the tank won't move. **Repair**.
4. From the gunner's seat, **Turret**: the power grip does nothing, the crank still turns. **Repair**.
5. **Combat → Enemy guns → Meet A** and let gun A hit you a few times: read the sign after each hit. Say whether it feels fair and how soon you are knocked out.
6. With two players: one takes the hits, and both see the same damage and signs.
