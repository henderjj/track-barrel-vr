# Pedals, the seat lever's bracket and the parking brake's latch

John's headset note of 20 November 2026 on the driver's compartment:

> The accelerator and clutch pedals appear to be backwards with the pads pointing away from the driver. Can we fix it and also animate them when the accelerator and clutch controls are used? The seat raising handle looks like it's floating unattached from the seat. Can a release latch or button be added to the handbrake to indicate that it needs a trigger press to release it? If we can show the trigger finger resting on the release it would be ideal.

Reference: TM 9-754's figure 9 (`M4A4-drivers-control-group.png` in the project files).

## What players see

- **The pedals face the driver.** The clutch, under the left steering lever, is a long arm rising through a rubber-booted slot in the foot plate from a pivot under the floor and leaning forwards to a ribbed pad that faces up and back at the driver's foot. The accelerator, under the right lever, is a ribbed pad hinged at its heel on the plate, its toe raised forwards over a rubber stop. Until now both pads faced the front, and the clutch's arm ran forwards from a hinge by the driver's feet.
- **The pedals move.** The clutch pedal swings down and forwards as the clutch is held, about 7 cm each way, as a real one is pushed (John's second note: on a pivot on the plate it only tipped), (the left trigger, or Shift on a PC page, with the Clutch gearbox) and the accelerator's toe goes down as the accelerator is pressed (the right trigger with a Sherman's controls, or W). They ease to the controls in about 50 ms. The crewmate sees the driver's feet work them, from the controls the tank packets already carry. With the automatic box there is no accelerator or clutch, so they stay up.
- **The seat lever is fixed to the seat.** A steel plate is bolted along the seat pan's right side, an arm rises from it to the lever's pivot, and the lever turns in a boss from the plate, on a pin with a nut. Before, a small block stood 1 cm off the cushion's side and the lever 5 cm out from it.
- **The parking brake has a release latch.** A red squeeze latch hangs from a hinge under the handle's cap, standing off the handle's front (the side it leans towards); a rod runs from it down the lever's front to a pawl beside the lever's foot, which rides over a toothed quadrant on the post. A hand on the handle is drawn closed a hand's width under the cap, thumb up, turned so its index finger rests on the latch. Holding the trigger squeezes the latch in, the finger curling with it, and the pawl lets the lever go forwards. On the crewmate's page the latch squeezes as the lever goes forwards off.

## Numbers

In [`src/sim/interior-fittings.ts`](../src/sim/interior-fittings.ts) (`PEDALS`), [`src/sim/convoy-seat.ts`](../src/sim/convoy-seat.ts) (`SEAT_LEVER_BRACKET`), [`src/sim/driver-station.ts`](../src/sim/driver-station.ts) (`PARKING_BRAKE.latch`), [`src/scene-assets/mechanism.scene-asset.ts`](../src/scene-assets/mechanism.scene-asset.ts) (`LATCH`) and [`src/systems/hand-lock.ts`](../src/systems/hand-lock.ts) (`LATCH_INDEX_*`).

| What | Value | Why |
| --- | --- | --- |
| Clutch | pivot 2 cm under the floor, 38 cm behind the nose; 32 cm arm leaning forwards 35°; 9 × 11 cm pad facing 43° back from upright; 20° travel | Pad 24 cm off the floor and 22 cm ahead of the steering levers' pedestals, where a seated foot rests; pressed it goes 7 cm down and 7 cm forwards |
| Accelerator | heel hinge 3.5 cm up, 29 cm behind the nose; 6.5 × 16 cm pad rising 32°; 14° travel | Toe 12 cm up, 8.5 cm when pressed |
| Seat lever's bracket | 1 cm plate on the pan's side, strap 24 cm long, arm 6 cm wide to 2 cm over the pivot | Fixed to the seat, so it rises with it head out |
| Latch | hinge 5 cm over where the hand is drawn (36 cm up the 42 cm lever), 3.5 cm in front of the lever; 4.2 cm red bar; squeezes in 0.15 rad | Under the index finger of a fist drawn there (the finger lies 3 cm towards the thumb from the fist's middle) |
| Index finger on the latch | curl 0.64 resting (finger off the trigger or resting on it), 0.8 with the trigger pulled | Its last joint wraps the bar's front instead of the handle |

## How it works

- The pedals are two small meshes (two draw calls) that `DriverStationSystem` turns each frame from `shownDriverControls()`: `accel` and `clutch`, which the driver-controls and tank-state packets already carry. Nothing new goes over the network.
- The latch is a child of the parking brake lever's mesh; the station squeezes it from the lever's `freed` (the holding hand's trigger), or, while nobody here holds it, while the lever moves forwards.
- `LeverSpec.latch = { fist }` makes the mechanism kit's lever lock a hand at that point on the handle and give its resolver a `latch` direction (the lever's front). `LockedHand` then turns the hand thumb towards the handle's top and round the handle until its index finger lies on the latch, and poses the index finger from the trigger between `LATCH_INDEX_REST` and `LATCH_INDEX_SQUEEZED`. The crewmate's hands go through the same lock, so they rest on the latch too.

## Tests

- `test/interior-fittings.test.ts`: both pads face up and back through their travel, within a seated foot's reach, ahead of the pedestals and behind the nose; pressed, the clutch's pad goes at least 5 cm down and 5 cm forwards, its arm staying in its slot, and the accelerator's toe goes down.
- `test/hand-lock.test.ts`: a hand on a latched handle, taken rolled every way and upside down, is drawn thumb up with its index finger's last joint on the latch's side, 3 cm above the fist; the trigger squeezes it.
- `test/parking-brake.test.ts`: the hand on the brake is locked at the latch's point wherever it took hold, at every angle.
- `test/z-fighting.test.ts`: the pedals let go, half and fully pressed, the latch out and squeezed, the ratchet quadrant, and the seat's bracket raised and lowered.
- `npm run test:xr`, the driver's station step (part 2): the clutch pedal is drawn pressed while the left trigger holds the clutch; the latch is out while the ratchet holds the lever and squeezed while the trigger frees it.

`window.__driverStation.state()` has `pedals` ({ clutch, accelerator }, 0 to 1 as drawn) and `latch` (0 to 1).

## Headset check

On a Quest 3 after the deploy, with the cache cleared (Ctrl+Shift+R), seated.

1. Game menu (Y) → **Practice → Drive the tank → Drive**, start the engine, and set **Tank → Gearbox → Clutch**.
2. Look down between your knees: both pedals' ribbed pads face you. Hold the left trigger: the clutch pedal pushes down and forwards; let go and it comes back up. Press the right trigger: the accelerator's toe goes down.
3. Look down to the right of the seat: the seat lever stands in a boss on a plate bolted to the seat's side. Pull it to go head out and check the bracket rises with the seat.
4. Drop your left hand to the parking brake and grip it: the hand closes under the cap with your index finger on the red latch. Pull the brake on. Hold the trigger: the finger curls and the latch squeezes in; push the lever forwards and it comes off.
5. Say whether the pedals' movement reads at a glance, whether the drawn hand on the brake feels like your own hand or is twisted too far from it, and whether the latch makes the trigger release obvious.
