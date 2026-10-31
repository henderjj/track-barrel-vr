# Parking brake (F1.18)

The driver gets a Sherman's parking brake: a ratchet lever on the floor by the left tiller that locks the tracks. So that it has a job, a tank that nothing holds now rolls slowly downhill.

It is the last of the three features from John's notes on the driver's controls (30 October 2026), after the gearbox (F1.16, [gearbox.md](gearbox.md)) and the engine start-up (F1.17, [engine.md](engine.md)). The research and the plan are in the proposal doc *Driver's controls, second pass*.

The numbers are in [`src/sim/driver-station.ts`](../src/sim/driver-station.ts) (the lever) and [`src/sim/tank-drive.ts`](../src/sim/tank-drive.ts) (rolling and braking); the ratchet is the mechanism kit's ([mechanisms.md](mechanisms.md)).

## What players experience

- **The lever** stands on a post from the floor just left of the left tiller's pedestal, where the M4A4's is (TM 9-754, figure 9), its handle by the left knee: a hand drops to it off the left tiller. Off, it lies 35° forwards.
- **Putting it on**: grip it and pull it up and back. The ratchet clicks in the hand every 4°, and it stays wherever it is let go. From 20° back it holds, and the red BRAKE lamp on the switch strip lights (with the battery on).
- **Letting it off**: grip it, hold the trigger (the release button on its top) and push it forwards. Without the trigger the ratchet holds it and the hand strains against it (the drawn hand stays on the handle).
- **With it on** the tracks are locked. With the automatic box or Stick shift the tank won't move, whatever the tillers or the accelerator ask, and a sign says "Parking brake on" and how to let it off; the engine runs on. With the Clutch, letting the clutch out in gear against it bogs the engine, and it stalls with a sign saying the parking brake is on. Put on while moving, it stops the tank as hard as the comfort cap allows (1 m/s²).
- **Rolling on slopes**: out of gear, with the clutch in or the engine stopped, and with no brake on, the tank now rolls slowly downhill on slopes steeper than about 2°, at up to 0.4 m/s² and no faster than 9 km/h. In gear with the engine running it holds still as before, and so does a tiller pulled back with a Sherman's controls. The range is gentle (its steepest slope is about 3.5°, off the road), so this matters when stopping on a slope to start the engine, to let the gunner fire, or after a stall.
- **Taking the driver's seat** with the brake on, the sign says so before how to drive.
- On a PC page, P puts the brake on and off.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| Lever | 42 cm, 10 cm handle, on a post with its pivot 48 cm off the floor; 35° forwards (off) to 8° back | Its handle in seated reach at both ends and over 15 cm from the other handles (tested) |
| Ratchet | a click every 4° from 28° to −8°; on from 20° back | |
| Holding | the tracks locked: the speed falls at the comfort cap's 1 m/s², less the slope's pull | |
| Rolling | gravity along the slope, capped at 0.7 m/s², less the tracks' 0.3 m/s² drag; none faster than 2.5 m/s | Rolls on slopes over about 1.75°; at most 0.4 m/s², inside the comfort caps |

## Sharing

The parking brake is a switch bit (32) in the driver's controls, so neither packet changes length: the driver-controls packet (guest driver → host) carries the lever's state to the host, and the tank-state packet's copy of the controls carries it back, so the other page's lever and lamp follow. A page on an older build reads it as off. The lever is drawn on the other page at fully on or fully off.

## The practice crewmate

Driving with the brake on (after starting the engine, if it is stopped), its left hand takes the lever, holds the release and pushes it down, its right hand on a tiller; its status says "letting off the parking brake". It never puts the brake on.

## Tests

- `test/parking-brake.test.ts`: the range's slopes and the roll's pull within the comfort cap; a tank in neutral rolling downhill and staying put on the flat; the brake, a tiller pulled back and the engine in gear each holding it on the slope; the brake stopping a rolling tank within the cap; the automatic box and Stick shift not moving against it with the engine running on; the Clutch stalling against it with the cause 'brake'; the lever's ratchet (pulled up it clicks and stays, pushed down it holds until the trigger frees it).
- `test/tank-net.test.ts`: the brake's bit both ways; an F1.16 packet reads it off.
- `test/driver-station.test.ts` and `test/periscope.test.ts` take the lever in with the other handles: in seated reach at both ends, and clear of the others.
- `test/hand-lock.test.ts`: its fake hold kinds moved past the 4 bits a pose packet sends, as HoldKind 13 is now the parking brake.
- `npm run test:xr`, the driver's station step: the left hand pulls the lever up, it ratchets on and its lamp lights; the tillers don't move the tank and the sign says why; pushed down without the trigger it stays on, with it held it comes off and the lamp goes out.
- `npm run test:net`: a guest driver's parking brake holds the host's tank and lights the host's lamp; the practice crewmate lets the brake off by its lever (its hand seen on it) before it drives on "Driver, advance".

`window.__drive.parkingBrake(on)` sets it on a page as the lever would; `window.__drive.set({ parkingBrake })` overrides the controls; `window.__driverStation.state()` has `parkingBrake` and `brakeFreed`, and `engine().lamps.brake`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Game menu (Y) → **Practice → Drive the tank → Drive**, and start the engine.
2. Take your left hand off the left tiller and find the parking brake lever by your left knee. Pull it up and back: feel the ratchet click, and see the BRAKE lamp light on the instrument box.
3. Push both tillers forwards: the tank doesn't move, and a sign says the parking brake is on.
4. Try pushing the lever down without the trigger: it won't go. Hold the left trigger and push it down: it goes, the lamp goes out, and the tank drives.
5. Find a slope off the road (the ground rises either side of the range road, about 60 m out), stop on it and stop the engine: the tank creeps downhill. Put the brake on: it stops.
6. **Gearbox: Clutch.** With the brake on, put it in 2nd and let the clutch out: the engine labours and stalls, and the sign says the parking brake is on.
7. Say whether the lever is easy to find and reach from the tiller, whether the ratchet and the trigger release feel natural, and whether rolling on slopes adds anything.
