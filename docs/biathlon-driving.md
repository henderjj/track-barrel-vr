# Biathlon: the driving challenge (F5.3d)

John's note after playing the biathlon (2026-11-13): the driving had no skill in it, since the tank could go flat out all the way round. He picked five changes (options 1 to 5) and said the 4° tilt cap shouldn't hold the tank's movement back, since the view from inside is so restricted. The shooting side (F5.3c) is in [biathlon-race.md](biathlon-race.md#harder-shooting). Rolling the tank over (option 6) is not wanted.

The result: a lap can't be driven flat out. The driver picks a gear for the hill, slows into the tight corners, picks a line through the slalom and onto the bridge, eases off in the mud or takes the bypass, and crawls through the ford.

## What the players meet

A lap of the 817 m loop, in the order it meets them (the course is in [biathlon-course.md](biathlon-course.md); all numbers are in `src/sim/course.ts`, `src/sim/terrain.ts` and `src/sim/going.ts`):

1. **The slalom** (north side). Four gates of two red-and-white posts, 4.4 m apart (a Sherman is 2.6 m wide). Each gate is set 2 m to one side of the middle line, then the other side, 16 m apart. A post the hull touches falls over, and a gate passed outside its posts counts as missed. Each one is a **fault** that adds 10 s to a race's time, and the course's sign says so ("Slalom: post knocked down, +10 s"). Knocked posts stand up again at the next lap.
2. **The hill** (option 1), straight after the slalom: a ridge 7 m high and 96 m long across the track. Its steepest middle part is about 12°, which 2nd gear climbs at full throttle and 3rd does not. The automatic box changes down by itself, and it only changes up again once the next gear can carry the load. With the stick, a driver in too high a gear slows, stops and rolls back, or stalls. Down the far side the tank runs on faster than its gear's flat top speed (the engine holds back 60% of its gear's pull, the brakes the rest), straight into the tight north-west corner.
3. **Tight corners** (option 3): the two west corners are 20 m in radius (the east ones stay 30 m). Turning pushes the tracks sideways by speed × turn rate, plus some lean on a slope, and 35% more on mud. Past 2.0 m/s² the driver's sign says "Tracks straining", and the tracks are heard straining well before that (docs/audio.md). Past 2.3 m/s² for about a second, the outside track comes off. Both players see "Right track thrown", and the tank is held while the crew refit it for 40 s. At speed the turn rate tops out at 15°/s, so a full turn on firm ground pushes the tracks by the speed × 0.26: the warning comes from about 27 km/h and a thrown track from about 32 km/h, or about 24 km/h on mud. Going that fast the tank can't turn tighter than about 34 m, so the tight corners are taken slower or run wide. (The limits were 1.5 and 1.9 m/s² until John's play test of 2026-11-14: then any turn above about 21 km/h warned, and a hard one above 26 km/h threw a track.)
4. **The treadway bridge** (option 5), on the west side over a ditch 2.5 m deep with water in its bottom. It has two steel treads, 1 m wide, under the tracks, 38 m long with ramps, standing 25 cm proud. A track off its tread over the ditch drops the tank in, and it comes back to the bridge's start, 8 m short of the ramp. The course's sign says "Fell off the bridge: back to its start", and the time lost is the penalty. Gate 4 just past the bridge makes the bridge part of every lap.
5. **The mud** (option 2), on the south side, 60 m long and 14 m wide, darker brown. It drags at the tracks: about 8 km/h in 2nd at most. More than 60% throttle at a crawl spins the tracks, and the tank digs in ("Digging in") until it is **bogged** after about 5 s ("Bogged in the mud: reverse out, then take the bypass"). Bogged, it can only back out. A firm gravel **bypass** swings round the mud on the infield side. It is longer but quicker for a careful driver.
6. **The ford** (option 5), a stream 0.9 m deep across the south side. Faster than 8 km/h through water deeper than 25 cm for a second, the bow wave drowns the engine ("Drowned in the ford: restart after 12 s, ford slower"), and the starter won't turn it for 12 s.

**Heat from load** (option 4): working against a slope or mud at more than 40% of what the gear can push heats the coolant like F3.7's high revs. At the full load the gear can push, it heads for 80% of F3.7's top strain heat. A long climb in too high a gear, or churning in the mud, brings the TEMP lamp on.

**The tilt** (John's 13 November decision): the hull's pitch and roll limit went from 4° to 15°, so the tank tips with the ground on the hill, the ditch banks and the ford. Reduced bumps (Comfort) still cap it at 6°.

## How it works

- **Engine-free rules** in `src/sim/going.ts`: each gear's steepest climb (`GEAR_GRADE`: 1st 25°, 2nd 15°, 3rd 9°, 4th 5.5°, 5th 3°, reverse 15°), `groundPull`, which leaves over whatever slope and drag the engine and brakes can't answer, the mud's sink, the throw strain and the load's heat share. `src/sim/tank-drive.ts` applies them each step. Its flat-ground drive is unchanged, the ground's leftover pull is added under the same comfort limit on acceleration, and `stepGoing` does the sink, the throw, the ford and the bridge fall.
- **The ground's shape** is in `src/sim/terrain.ts` (`courseRelief`: the hill, the ditch and the stream as part of the height field). The tracks follow it, and the drawn gravel adds a point wherever its middle line crosses a cell line of the height field, so it lies on the ground over the crest and through the ford.
- **Host-authoritative.** The host's drive sim decides everything. The tank packet (`PacketType` 5) grows by 4 bytes: sink, sideways push, which track is thrown and the refit's seconds left. A page on the previous build still decodes the old length (no going). The course's `course` event gains faults, knocked posts, slalom gates and falls. The race's `run` event gains faults. No new packet types or HoldKinds.
- **Surfaces**: mud, water and steel join grass, dirt and gravel for the track sounds (`src/sim/ground-surface.ts`).
- **The crewmate** drives the course at a speed set for each stretch of the course: 9 km/h through the slalom (weaving through the gates), 16 down the hill and round the tight corners, 8 over the bridge, 18 round the bypass and 7 through the ford. It brakes when it runs on downhill. A clean race takes it 13:00, and three penalty loops take it 15:20.
- **Medal times** retuned from that: gold 12:30, silver 13:30, bronze 15:45.

## Practice

Game menu → **Practice → Obstacles**: Slalom, Hill, Bridge, Mud or Ford parks the tank on the course short of that obstacle, facing it the way a lap drives it, with the engine running. Alone, you take the driver's seat. In a crew, the seats stay as they are.

Test hooks: `window.__course.layout()` gives `posts`, `bridge` and `obstacles`, `__course.posts()` gives each post as drawn and whether it is down, `__course.obstacle(name)` runs the shortcut, and `__drive.going({ sink, thrown, refit })` sets the going on the host. XR step 6x is in part 2. The net test checks that a thrown track reaches the guest.

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated, in the driver's seat.

1. **Practice → Obstacles → Slalom**. Drive through the four gates. Say whether you can see the posts from the slit or the periscope in time to steer, whether a knocked post is clear (it lies down and the sign says "+10 s"), and whether the gates are too tight or too easy.
2. **Obstacles → Hill**. Full ahead with the automatic box: it should change down to 2nd near the top and keep climbing. Then try the stick in 4th or 5th: it should slow and stall. Over the crest, say how the run-on downhill feels, and whether the 15° tilt is comfortable or too much.
3. Take the tight north-west corner fast (over 30 km/h): the tracks groan and squeak, "Tracks straining", then "Right track thrown" and a 40 s wait. Say whether the warning comes early enough to save it, and whether a turn at 20 to 25 km/h now goes without a warning.
4. **Obstacles → Bridge**. Line up and cross slowly. Say whether you can see the treads well enough to stay on them. Then drive off on purpose: the tank should come back to the start with the sign.
5. **Obstacles → Mud**. Full throttle into the mud: "Digging in", then "Bogged". Reverse out and take the bypass. Then try easing through at half throttle. Say which feels quicker.
6. **Obstacles → Ford**. Cross at a crawl (under 8 km/h on the speedometer), then again fast: the engine drowns with the sign, and the starter won't turn it for 12 s.
7. Drive a whole race (**Biathlon race → Start**) with the crewmate as gunner. Say your time and medal (gold 12:30, silver 13:30, bronze 15:45), whether the TEMP lamp came on, and how many faults you got.
8. Watch the crewmate drive a race from the gunner's seat. Say whether it looks careful but not silly.
9. With the performance HUD on round the course, say whether the frame time stays as before.
